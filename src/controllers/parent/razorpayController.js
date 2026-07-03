const db = require('../../config/database');
const Razorpay = require('razorpay');

let razorpay;
try {
    razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID || 'mock_key',
        key_secret: process.env.RAZORPAY_KEY_SECRET || 'mock_secret'
    });
} catch (e) {
    console.error("Razorpay SDK initialization failed:", e.message);
}

/**
 * Verifies that a student is linked to the parent account via email matching.
 */
async function verifyParentStudentLink(parentEmail, schoolId, studentId) {
    const normalizedEmail = String(parentEmail || '').trim().toLowerCase();
    const [rows] = await db.query(
        `SELECT s.id 
         FROM students s
         JOIN student_family sf ON s.id = sf.student_id
         WHERE s.id = ? 
           AND s.school_id = ?
           AND (LOWER(sf.father_email) = ? OR LOWER(sf.mother_email) = ? OR LOWER(sf.guardian_email) = ?)
           AND s.parent_portal_enabled = 1
           AND s.deleted_at IS NULL
         LIMIT 1`,
        [studentId, schoolId, normalizedEmail, normalizedEmail, normalizedEmail]
    );
    return rows.length > 0;
}

exports.createOrder = async (req, res, next) => {
    let connection;
    try {
        const parentEmail = req.user?.email;
        const schoolId = req.user?.school_id;
        if (!parentEmail || !schoolId) {
            return res.status(401).json({ success: false, message: 'Session expired' });
        }

        const { studentId, fee_ids } = req.body;
        if (!studentId || !fee_ids) {
            return res.status(400).json({ success: false, message: 'Missing studentId or fee_ids' });
        }

        // 1. Verify parent-child relationship
        const isLinked = await verifyParentStudentLink(parentEmail, schoolId, studentId);
        if (!isLinked) {
            return res.status(403).json({ success: false, message: 'Access Denied: Student is not linked to your account' });
        }

        const feeIds = Array.isArray(fee_ids) ? fee_ids : [fee_ids];
        if (feeIds.length === 0) {
            return res.status(400).json({ success: false, message: 'Select at least one fee item' });
        }

        connection = await db.getConnection();
        await connection.beginTransaction();

        let totalAmount = 0;
        for (const feeId of feeIds) {
            const [[fee]] = await connection.query(
                `SELECT * FROM student_fees WHERE id = ? AND student_id = ? AND status = 'pending'`,
                [feeId, studentId]
            );
            if (!fee) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Fee item not found or already paid' });
            }
            totalAmount += parseFloat(fee.total_amount) - parseFloat(fee.paid_amount || 0);
        }

        if (totalAmount <= 0) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Amount must be greater than zero' });
        }

        const receiptId = `rcpt_${studentId}_${Date.now()}`;
        const order = await razorpay.orders.create({
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

        for (const feeId of feeIds) {
            await connection.query(
                `UPDATE student_fees SET payment_id = ? WHERE id = ?`,
                [payment.insertId, feeId]
            );
        }

        await connection.commit();

        res.json({
            success: true,
            data: {
                order_id: order.id,
                amount: order.amount,
                currency: order.currency,
                payment_id: payment.insertId,
                key_id: process.env.RAZORPAY_KEY_ID
            }
        });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error("Parent Razorpay createOrder Error:", err);
        res.status(500).json({ success: false, message: err.message || 'Failed to create payment order' });
    } finally {
        if (connection) connection.release();
    }
};

exports.generateQRCode = async (req, res, next) => {
    try {
        const parentEmail = req.user?.email;
        const schoolId = req.user?.school_id;
        if (!parentEmail || !schoolId) {
            return res.status(401).json({ success: false, message: 'Session expired' });
        }

        const { paymentId } = req.params;
        if (!paymentId) {
            return res.status(400).json({ success: false, message: 'Payment ID is required' });
        }

        const [[payment]] = await db.query(
            `SELECT * FROM fee_payments WHERE id = ? AND school_id = ? AND status = 'pending'`,
            [paymentId, schoolId]
        );

        if (!payment) {
            return res.status(404).json({ success: false, message: 'Pending payment record not found' });
        }

        const studentId = payment.student_id;

        // Verify parent-child relationship
        const isLinked = await verifyParentStudentLink(parentEmail, schoolId, studentId);
        if (!isLinked) {
            return res.status(403).json({ success: false, message: 'Access Denied: Student is not linked to your account' });
        }

        const qrCode = await razorpay.qrCode.create({
            type: "upi_qr",
            name: `SchoolSync Fee #${payment.id}`,
            usage: "single_use",
            fixed_amount: true,
            payment_amount: Math.round(payment.amount * 100),
            description: `SchoolSync Fee Payment #${payment.id}`
        });

        await db.query(
            `UPDATE fee_payments SET transaction_id = ? WHERE id = ?`,
            [qrCode.id, payment.id]
        );

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
        console.error("Parent Razorpay generateQRCode Error:", err);
        res.status(500).json({ success: false, message: err.message || 'Failed to generate QR Code' });
    }
};
