const QRCode = require('qrcode');
const db = require('../../config/database');
const razorpayConfig = require('../../config/razorpay');
const { claimFeeItems, lockPayableFeeItems, normalizeFeeIds } = require('../../services/feePaymentService');

exports.createOrder = async (req, res, next) => {
    let connection;
    try {
        const userId = (req.user?.id || req.session.user?.id);
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Session expired' });
        };
        if (!razorpayConfig.isConfigured || !razorpayConfig.instance) {
            return res.status(503).json({ success: false, message: 'Payment gateway is not configured. Please contact support.' });
        };

        const [students] = await db.query(
            'SELECT id, school_id FROM students WHERE user_id = ? AND deleted_at IS NULL',
            [userId]
        );

        if (!students.length) {
            return res.status(404).json({ success: false, message: 'Student record not found' });
        };

        const student = students[0];
        const student_id = student.id;
        const schoolId = student.school_id;

        const { fee_ids } = req.body;
        if (!fee_ids) {
            return res.status(400).json({ success: false, message: 'Missing fee_ids' });
        };

        const feeIds = normalizeFeeIds(fee_ids);

        connection = await db.getConnection();
        await connection.beginTransaction();
        const fees = await lockPayableFeeItems(connection, { feeIds, studentId: student_id, schoolId });
        const totalPending = fees.reduce(
            (sum, fee) => sum + Number(fee.total_amount) - Number(fee.paid_amount || 0),
            0
        );

        let finalAmount = totalPending;
        const requestedAmount = parseFloat(req.body.amount || req.body.custom_amount || req.body.installment_amount);
        if (!isNaN(requestedAmount) && requestedAmount > 0) {
            if (requestedAmount > totalPending + 0.01) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: `Payment amount (₹${requestedAmount.toFixed(2)}) cannot exceed total pending balance (₹${totalPending.toFixed(2)})`
                });
            };
            finalAmount = requestedAmount;
        };

        if (finalAmount <= 0) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Amount must be greater than zero' });
        };

        const feeAmounts = {};
        if (fees.length === 1) {
            feeAmounts[fees[0].id] = finalAmount;
        } else {
            let rem = finalAmount;
            fees.forEach((f, i) => {
                const itemPending = Number(f.total_amount) - Number(f.paid_amount || 0);
                const alloc = i === fees.length - 1 ? rem : Math.min(rem, itemPending);
                feeAmounts[f.id] = alloc;
                rem = Math.max(0, rem - alloc);
            });
        };

        const STALE_PAYMENT_THRESHOLD_MS = 30 * 60 * 1000;
        const now = Date.now();

        const activePendingPayments = fees
            .filter(f => f.payment_id && f.allocated_payment_status === 'pending' && f.allocated_payment_created_at && (now - new Date(f.allocated_payment_created_at).getTime() <= STALE_PAYMENT_THRESHOLD_MS))
            .map(f => ({
                id: f.payment_id,
                orderId: f.allocated_razorpay_order_id,
                userId: f.allocated_user_id,
                amount: f.allocated_payment_amount
            }));

        const uniquePendingIds = [...new Set(activePendingPayments.map(p => p.id))];

        if (uniquePendingIds.length === 1 && activePendingPayments.length === fees.length && Math.abs(Number(activePendingPayments[0].amount) - finalAmount) < 0.01) {
            const existing = activePendingPayments[0];
            if (existing.orderId && String(existing.userId) === String(userId)) {
                await connection.commit();
                return res.json({
                    success: true,
                    data: {
                        order_id: existing.orderId,
                        amount: Math.round(Number(existing.amount) * 100),
                        currency: 'INR',
                        payment_id: existing.id,
                        key_id: razorpayConfig.keyId,
                        reused: true
                    }
                });
            }
        }

        const receiptId = `rcpt_${student_id}_${Date.now()}`;
        const order = await razorpayConfig.instance.orders.create({
            amount: Math.round(finalAmount * 100),
            currency: 'INR',
            receipt: receiptId
        });

        const [payment] = await connection.query(
            `INSERT INTO fee_payments 
            (school_id, student_id, initiated_by_user_id, initiated_by_role, amount, status, payment_method, razorpay_order_id, created_at)
            VALUES (?, ?, ?, 'student', ?, 'pending', 'online', ?, NOW())`,
            [schoolId, student_id, userId, finalAmount, order.id]
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
        console.error("Student Razorpay createOrder Error:", err);
        res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Failed to create payment order' });
    } finally {
        if (connection) connection.release();
    };
};

exports.generateQRCode = async (req, res, next) => {
    let connection;
    try {
        const userId = (req.user?.id || req.session.user?.id);
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Session expired' });
        };
        if (!razorpayConfig.isConfigured || !razorpayConfig.instance) {
            return res.status(503).json({ success: false, message: 'Payment gateway is not configured. Please contact support.' });
        };

        const [students] = await db.query(
            'SELECT id, school_id FROM students WHERE user_id = ? AND deleted_at IS NULL',
            [userId]
        );

        if (!students.length) {
            return res.status(404).json({ success: false, message: 'Student record not found' });
        };

        const student = students[0];
        const { paymentId } = req.params;
        if (!paymentId) {
            return res.status(400).json({ success: false, message: 'Payment ID is required' });
        };

        connection = await db.getConnection();
        await connection.beginTransaction();
        const [[payment]] = await connection.query(
            `SELECT * FROM fee_payments
            WHERE id = ? AND school_id = ? AND student_id = ? AND status = 'pending'
            FOR UPDATE`,
            [paymentId, student.school_id, student.id]
        );

        if (!payment) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Pending payment record not found' });
        };
        if (payment.razorpay_qr_id) {
            let existingQrImage = null;
            try {
                const fetchedQr = await razorpayConfig.instance.qrCode.fetch(payment.razorpay_qr_id);
                existingQrImage = fetchedQr?.image_url || null;
            } catch (qrFetchErr) {
                console.warn("[generateQRCode] Failed to fetch existing QR code from Razorpay:", qrFetchErr.message);
            }
            await connection.commit();
            return res.json({
                success: true,
                data: {
                    qr_id: payment.razorpay_qr_id,
                    image_url: existingQrImage,
                    payment_id: payment.id,
                    amount: payment.amount,
                    order_id: payment.razorpay_order_id || payment.razorpay_qr_id
                }
            });
        };

        let qrCodeId = null;
        let qrImageUrl = null;

        try {
            const rzpQr = await razorpayConfig.instance.qrCode.create({
                type: "upi_qr",
                name: `SchoolSync Fee #${payment.id}`,
                usage: "single_use",
                fixed_amount: true,
                payment_amount: Math.round(payment.amount * 100),
                description: `SchoolSync Fee Payment #${payment.id}`
            });
            qrCodeId = rzpQr.id;
            qrImageUrl = rzpQr.image_url;
        } catch (qrCreateError) {
            console.warn("[generateQRCode] Razorpay dynamic QR unavailable, generating fallback UPI QR code:", qrCreateError.message || qrCreateError);
            qrCodeId = `upi_qr_${payment.id}_${Date.now()}`;
            const schoolVpa = process.env.SCHOOL_UPI_VPA || 'schoolsync@upi';
            const payeeName = 'SchoolSync Fees';
            const upiString = `upi://pay?pa=${encodeURIComponent(schoolVpa)}&pn=${encodeURIComponent(payeeName)}&am=${Number(payment.amount).toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Fee Payment #${payment.id}`)}&tr=${payment.id}`;
            qrImageUrl = await QRCode.toDataURL(upiString, {
                width: 300,
                margin: 2,
                color: { dark: '#1E293B', light: '#FFFFFF' }
            });
        };

        const [paymentUpdate] = await connection.query(
            `UPDATE fee_payments SET razorpay_qr_id = ?
            WHERE id = ? AND school_id = ? AND student_id = ?
                AND status = 'pending' AND razorpay_qr_id IS NULL`,
            [qrCodeId, payment.id, student.school_id, student.id]
        );
        if (paymentUpdate.affectedRows !== 1) {
            throw new Error('Payment changed while its QR code was being generated.');
        };
        await connection.commit();

        res.json({
            success: true,
            data: {
                qr_id: qrCodeId,
                image_url: qrImageUrl,
                payment_id: payment.id,
                order_id: payment.razorpay_order_id || qrCodeId
            }
        });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error("Student Razorpay generateQRCode Error:", err);
        res.status(err.statusCode || 500).json({ success: false, message: 'Failed to generate QR Code' });
    } finally {
        if (connection) connection.release();
    };
};