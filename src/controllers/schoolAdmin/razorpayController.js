const db = require('../../config/database');
const razorpayConfig = require('../../config/razorpay');
const { claimFeeItems, lockPayableFeeItems, normalizeFeeIds } = require('../../services/feePaymentService');

const parseOptionalAmount = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

exports.createOrder = async (req, res, next) => {
    let connection;
    try {
        if (!razorpayConfig.isConfigured || !razorpayConfig.instance) {
            return res.status(503).json({ success: false, message: 'Payment gateway is not configured. Please contact support.' });
        };

        const schoolId = req.session.user?.school_id;
        if (!schoolId) {
            return res.status(401).json({ success: false, message: 'Session expired' });
        };

        const { student_id, fee_ids, discount, paying_amount } = req.body;
        if (!student_id || !fee_ids) {
            return res.status(400).json({ success: false, message: 'Missing student_id or fee_ids' });
        };

        const feeIds = normalizeFeeIds(fee_ids);

        connection = await db.getConnection();
        await connection.beginTransaction();

        const fees = await lockPayableFeeItems(connection, { feeIds, studentId: student_id, schoolId });
        let totalAmount = 0;
        const feeAmounts = {};
        for (const fee of fees) {
            const remainingBalance = Number(fee.total_amount) - Number(fee.paid_amount || 0);
            const rawRequestedAmount = parseOptionalAmount(paying_amount?.[fee.id] ?? paying_amount?.[String(fee.id)]);
            let amountToPay = remainingBalance;
            if (rawRequestedAmount !== null) {
                if (rawRequestedAmount <= 0) {
                    throw new Error(`Payment amount must be greater than zero for fee ${fee.id}.`);
                };
                if (rawRequestedAmount > remainingBalance + 0.01) {
                    throw new Error(`Payment amount exceeds the remaining balance for fee ${fee.id}.`);
                };
                amountToPay = rawRequestedAmount;
            };
            feeAmounts[fee.id] = amountToPay;
            totalAmount += amountToPay;
        };

        const parsedDiscount = discount === undefined || discount === null || discount === '' ? 0 : Number(discount);
        if (!Number.isFinite(parsedDiscount) || parsedDiscount < 0) {
            throw new Error('Discount must be a non-negative amount.');
        };
        if (parsedDiscount >= totalAmount) {
            throw new Error('Discount cannot equal or exceed the collected amount.');
        };

        const netAmount = totalAmount - parsedDiscount;
        if (netAmount <= 0) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Net amount must be greater than zero' });
        };

        const receiptId = `rcpt_${student_id}_${Date.now()}`;
        const order = await razorpayConfig.instance.orders.create({
            amount: Math.round(netAmount * 100),
            currency: 'INR',
            receipt: receiptId
        });
        // console.log("Razorpay Order Created successfully for admin:", order.id, "amount:", order.amount, "studentId:", student_id);

        const [payment] = await connection.query(
            `INSERT INTO fee_payments 
                (school_id, student_id, amount, discount, status, payment_method, razorpay_order_id, created_at)
                VALUES (?, ?, ?, ?, 'pending', 'online', ?, NOW())`,
            [schoolId, student_id, netAmount, parsedDiscount, order.id]
        );

        await claimFeeItems(connection, {
            fees,
            paymentId: payment.insertId,
            studentId: student_id,
            schoolId,
            feeAmounts
        });

        await connection.commit();
        res.json({
            success: true,
            data: {
                order_id: order.id,
                amount: order.amount,
                currency: order.currency,
                payment_id: payment.insertId,
                key_id: razorpayConfig.keyId
            }
        });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error("Razorpay createOrder Error:", err);
        res.status(err.statusCode || 500).json({ success: false, message: 'Failed to create payment order' });
    } finally {
        if (connection) connection.release();
    };
};

exports.generateQRCode = async (req, res, next) => {
    let connection;
    try {
        if (!razorpayConfig.isConfigured || !razorpayConfig.instance) {
            return res.status(503).json({ success: false, message: 'Payment gateway is not configured. Please contact support.' });
        };

        const schoolId = req.session.user?.school_id;
        if (!schoolId) {
            return res.status(401).json({ success: false, message: 'Session expired' });
        };

        const { paymentId } = req.params;
        if (!paymentId) {
            return res.status(400).json({ success: false, message: 'Payment ID is required' });
        };

        connection = await db.getConnection();
        await connection.beginTransaction();
        const [[payment]] = await connection.query(
            `SELECT * FROM fee_payments
            WHERE id = ? AND school_id = ? AND status = 'pending'
            FOR UPDATE`,
            [paymentId, schoolId]
        );

        if (!payment) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Pending payment record not found' });
        };
        if (payment.razorpay_qr_id) {
            await connection.commit();
            return res.status(409).json({ success: false, message: 'A QR code already exists for this payment.' });
        };

        const qrCode = await razorpayConfig.instance.qrCode.create({
            type: "upi_qr",
            name: `SchoolSync Fee #${payment.id}`,
            usage: "single_use",
            fixed_amount: true,
            payment_amount: Math.round(payment.amount * 100),
            description: `SchoolSync Fee Payment #${payment.id}`
        });

        const [paymentUpdate] = await connection.query(
            `UPDATE fee_payments SET razorpay_qr_id = ?
            WHERE id = ? AND school_id = ? AND status = 'pending' AND razorpay_qr_id IS NULL`,
            [qrCode.id, payment.id, schoolId]
        );
        if (paymentUpdate.affectedRows !== 1) {
            throw new Error('Payment changed while its QR code was being generated.');
        };
        await connection.commit();

        res.json({
            success: true,
            data: {
                qr_id: qrCode.id,
                image_url: qrCode.image_url,
                payment_id: payment.id,
                order_id: payment.razorpay_order_id || qrCode.id
            }
        });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error("Razorpay generateQRCode Error:", err);
        res.status(err.statusCode || 500).json({ success: false, message: 'Failed to generate QR Code' });
    } finally {
        if (connection) connection.release();
    };
};
