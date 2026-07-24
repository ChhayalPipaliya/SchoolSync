const db = require('../../config/database');
const razorpayConfig = require('../../config/razorpay');
const { canAccessStudent, createParentStudentService } = require('../../services/parentStudentService');
const { claimFeeItems, lockPayableFeeItems, normalizeFeeIds } = require('../../services/feePaymentService');

async function verifyParentStudentLink(parentUserId, schoolId, studentId, database = db) {
    const checker = database === db
        ? canAccessStudent
        : createParentStudentService(database).canAccessStudent;
    return checker({ parentUserId, schoolId, studentId });
};

exports.createOrder = async (req, res, next) => {
    let connection;
    try {
        const parentUserId = req.user?.id;
        const schoolId = req.user?.school_id;
        if (!parentUserId || !schoolId) {
            return res.status(401).json({ success: false, message: 'Session expired' });
        };
        if (!razorpayConfig.isConfigured || !razorpayConfig.instance) {
            return res.status(503).json({ success: false, message: 'Payment gateway is not configured. Please contact support.' });
        };

        const { studentId, fee_ids } = req.body;
        if (!studentId || !fee_ids) {
            return res.status(400).json({ success: false, message: 'Missing studentId or fee_ids' });
        };

        const feeIds = normalizeFeeIds(fee_ids);
        connection = await db.getConnection();
        await connection.beginTransaction();
        const isLinked = await verifyParentStudentLink(parentUserId, schoolId, studentId, connection);
        if (!isLinked) {
            await connection.rollback();
            return res.status(403).json({ success: false, message: 'Access Denied: Student is not linked to your account' });
        };

        const fees = await lockPayableFeeItems(connection, { feeIds, studentId, schoolId });
        const totalAmount = fees.reduce(
            (sum, fee) => sum + Number(fee.total_amount) - Number(fee.paid_amount || 0),
            0
        );

        if (totalAmount <= 0) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Amount must be greater than zero' });
        };

        const receiptId = `rcpt_${studentId}_${Date.now()}`;
        const order = await razorpayConfig.instance.orders.create({
            amount: Math.round(totalAmount * 100),
            currency: 'INR',
            receipt: receiptId
        });

        const [payment] = await connection.query(
            `INSERT INTO fee_payments 
            (school_id, student_id, initiated_by_user_id, initiated_by_role, amount, status, payment_method, razorpay_order_id, created_at)
            VALUES (?, ?, ?, 'parent', ?, 'pending', 'online', ?, NOW())`,
            [schoolId, studentId, req.user.id, totalAmount, order.id]
        );

        await claimFeeItems(connection, {
            fees,
            paymentId: payment.insertId,
            studentId,
            schoolId
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
        console.error("Parent Razorpay createOrder Error:", err);
        res.status(err.statusCode || 500).json({ success: false, message: 'Failed to create payment order' });
    } finally {
        if (connection) connection.release();
    };
};

exports.generateQRCode = async (req, res, next) => {
    let connection;
    try {
        const parentUserId = req.user?.id;
        const schoolId = req.user?.school_id;
        if (!parentUserId || !schoolId) {
            return res.status(401).json({ success: false, message: 'Session expired' });
        };
        if (!razorpayConfig.isConfigured || !razorpayConfig.instance) {
            return res.status(503).json({ success: false, message: 'Payment gateway is not configured. Please contact support.' });
        };

        const { paymentId } = req.params;
        if (!paymentId) {
            return res.status(400).json({ success: false, message: 'Payment ID is required' });
        };

        connection = await db.getConnection();
        await connection.beginTransaction();
        const [[payment]] = await connection.query(
            `SELECT fp.*
            FROM fee_payments fp
            JOIN students s
                ON s.id = fp.student_id
                AND s.school_id = fp.school_id
            JOIN student_family sf
                ON sf.student_id = s.id
                AND sf.school_id = s.school_id
            WHERE fp.id = ?
                AND fp.school_id = ?
                AND fp.status = 'pending'
                AND fp.initiated_by_user_id = ?
                AND fp.initiated_by_role = 'parent'
                AND sf.parent_user_id = ?
                AND s.parent_portal_enabled = 1
                AND s.status = 'active'
                AND s.deleted_at IS NULL
            FOR UPDATE`,
            [paymentId, schoolId, parentUserId, parentUserId]
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
            WHERE id = ? AND school_id = ? AND initiated_by_user_id = ?
                AND initiated_by_role = 'parent' AND status = 'pending' AND razorpay_qr_id IS NULL`,
            [qrCode.id, payment.id, schoolId, parentUserId]
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
        console.error("Parent Razorpay generateQRCode Error:", err);
        res.status(err.statusCode || 500).json({ success: false, message: 'Failed to generate QR Code' });
    } finally {
        if (connection) connection.release();
    };
};

exports._test = Object.freeze({ verifyParentStudentLink });
