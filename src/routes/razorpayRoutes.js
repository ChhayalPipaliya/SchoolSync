const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../config/database');
const NotificationService = require('../services/notificationService');
const NotificationModel = require('../models/notificationModel');
const templates = require('../utils/notificationTemplates');
const { verifyToken } = require('../middleware/auth');
const { completeFeePayment } = require('../services/feePaymentService');
const {
    assertCapturedPayment,
    fetchCapturedPayment
} = require('../services/razorpayPaymentVerificationService');

async function notifyFeePayment(result) {
    if (result.alreadyProcessed) return;
    const { payment, studentUser } = result;
    const schoolId = payment.school_id;
    const amount = payment.amount;
    const receiptNumber = payment.receipt_no;

    if (studentUser) {
        const studentName = `${studentUser.first_name} ${studentUser.last_name}`;

        NotificationService.createAndSend({
            recipient_id: studentUser.user_id,
            recipient_role: "student",
            school_id: schoolId,
            created_by: null,
            ...templates.feePaidStudent(amount, payment.id)
        }).catch(err => console.error("Webhook notification error student:", err));

        NotificationService.notifyAdmins(
            schoolId,
            templates.feePaid(studentName, amount, payment.id),
            null
        ).catch(err => console.error("Webhook notification error admins:", err));

        if (studentUser.email) {
            const mailTemplate = templates.feePaidStudent(amount, payment.id);
            const subject = `[SchoolSync] ${mailTemplate.title}`;
            const bodyHtml = templates.emailWrapper ? templates.emailWrapper(mailTemplate.title, `<p>${mailTemplate.message}</p>`) : `<p>${mailTemplate.message}</p>`;
            NotificationModel.enqueueEmail(studentUser.email, subject, bodyHtml)
                .catch(err => console.error("Webhook email queue error:", err));
        };
    };

    if (payment.initiated_by_role === 'parent' && payment.initiated_by_user_id) {
        try {
            const [[parentUser]] = await db.query(
                `SELECT id, first_name, last_name, email FROM users WHERE id = ? AND school_id = ?`,
                [payment.initiated_by_user_id, schoolId]
            );

            if (parentUser) {
                const studentName = studentUser ? `${studentUser.first_name} ${studentUser.last_name}` : 'your child';
                const baseTemplate = templates.feePaidStudent(amount, payment.id);
                const parentTemplate = {
                    title: baseTemplate.title,
                    message: `Your payment of ₹${amount} for ${studentName} was received successfully. Receipt No: ${receiptNumber || payment.id}`
                };

                NotificationService.createAndSend({
                    recipient_id: parentUser.id,
                    recipient_role: "parent",
                    school_id: schoolId,
                    created_by: null,
                    title: parentTemplate.title,
                    message: parentTemplate.message,
                    type: "info",
                    category: "general",
                    action_url: "/parent/fees"
                }).catch(err => console.error("Webhook notification error parent:", err));

                if (parentUser.email) {
                    const subject = `[SchoolSync] ${parentTemplate.title}`;
                    const bodyHtml = templates.emailWrapper ? templates.emailWrapper(parentTemplate.title, `<p>${parentTemplate.message}</p>`) : `<p>${parentTemplate.message}</p>`;
                    NotificationModel.enqueueEmail(parentUser.email, subject, bodyHtml)
                        .catch(err => console.error("Webhook parent email queue error:", err));
                };
            };
        } catch (parentErr) {
            console.error("Failed to notify paying parent:", parentErr);
        };
    };
};

async function completePayment(paymentId, razorpayPaymentId, razorpaySignature) {
    const result = await completeFeePayment({ paymentId, razorpayPaymentId, razorpaySignature });
    await notifyFeePayment(result);
    return result.payment;
};

async function findFeePaymentForWebhook({ orderId = null, qrId = null }) {
    if (orderId) {
        const [[payment]] = await db.query(
            `SELECT * FROM fee_payments WHERE razorpay_order_id = ? LIMIT 1`,
            [orderId]
        );
        if (payment) return payment;
    };
    if (!qrId) return null;

    const [[canonicalQrPayment]] = await db.query(
        `SELECT * FROM fee_payments WHERE razorpay_qr_id = ? LIMIT 1`,
        [qrId]
    );
    if (canonicalQrPayment) return canonicalQrPayment;

    const [legacyPayments] = await db.query(
        `SELECT *
        FROM fee_payments
        WHERE razorpay_qr_id IS NULL
            AND transaction_id = ?
            AND payment_method = 'online'
        ORDER BY id DESC
        LIMIT 2`,
        [qrId]
    );
    if (legacyPayments.length > 1) {
        const error = new Error('Ambiguous legacy fee QR reference.');
        error.statusCode = 409;
        throw error;
    };
    return legacyPayments[0] || null;
};

async function findFeePaymentStatusRow({ reference, schoolId = null }) {
    const scopeSql = schoolId === null ? '' : ' AND school_id = ?';
    const scopeParams = schoolId === null ? [] : [schoolId];
    const selectColumns = `id, status, school_id, student_id,
        initiated_by_user_id, initiated_by_role`;
    const numericId = Number(reference);
    if (Number.isSafeInteger(numericId) && numericId > 0) {
        const [[payment]] = await db.query(
            `SELECT ${selectColumns} FROM fee_payments WHERE id = ?${scopeSql} LIMIT 1`,
            [numericId, ...scopeParams]
        );
        if (payment) return payment;
    };

    for (const column of ['razorpay_order_id', 'razorpay_qr_id']) {
        const [[payment]] = await db.query(
            `SELECT ${selectColumns} FROM fee_payments WHERE ${column} = ?${scopeSql} LIMIT 1`,
            [reference, ...scopeParams]
        );
        if (payment) return payment;
    };

    const [legacyPayments] = await db.query(
        `SELECT ${selectColumns}
        FROM fee_payments
        WHERE razorpay_qr_id IS NULL
            AND transaction_id = ?
            AND payment_method = 'online'${scopeSql}
        ORDER BY id DESC
        LIMIT 2`,
        [reference, ...scopeParams]
    );
    if (legacyPayments.length > 1) {
        const error = new Error('Ambiguous legacy fee payment reference.');
        error.statusCode = 409;
        throw error;
    };
    return legacyPayments[0] || null;
};

router.post('/verify', verifyToken, async (req, res, next) => {
    try {
        const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
        if (!keySecret) {
            return res.status(503).json({ success: false, message: 'Payment gateway is not configured. Please contact support.' });
        };

        const { razorpay_payment_id, razorpay_order_id, razorpay_signature, payment_id, localPaymentId } = req.body;
        const actualPaymentId = localPaymentId || payment_id;

        if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature || !actualPaymentId) {
            return res.status(400).json({ success: false, message: 'Missing required signature parameters' });
        };

        const [[paymentRow]] = await db.query(
            `SELECT * FROM fee_payments WHERE id = ?`,
            [actualPaymentId]
        );

        if (!paymentRow) {
            return res.status(404).json({ success: false, message: 'Payment record not found' });
        };

        if (paymentRow.razorpay_order_id !== razorpay_order_id) {
            return res.status(400).json({ success: false, message: 'Payment order ID mismatch' });
        };

        const role = req.user?.role;
        const schoolId = req.user?.school_id;
        const userId = req.user?.id;

        if (role === 'school_admin') {
            if (paymentRow.school_id !== schoolId) {
                return res.status(403).json({ success: false, message: 'Access Denied: School mismatch' });
            };
        } else if (role === 'student') {
            const [[student]] = await db.query(
                `SELECT id FROM students WHERE user_id = ? AND school_id = ? AND deleted_at IS NULL LIMIT 1`,
                [userId, schoolId]
            );
            if (!student || paymentRow.student_id !== student.id || paymentRow.school_id !== schoolId) {
                return res.status(403).json({ success: false, message: 'Access Denied: Student mismatch' });
            };
        } else if (role === 'parent') {
            const [rows] = await db.query(
                `SELECT s.id 
                FROM students s
                JOIN student_family sf ON s.id = sf.student_id
                WHERE s.id = ? 
                    AND s.school_id = ?
                    AND sf.school_id = s.school_id
                    AND sf.parent_user_id = ?
                    AND s.parent_portal_enabled = 1
                    AND s.deleted_at IS NULL
                LIMIT 1`,
                [paymentRow.student_id, paymentRow.school_id, userId]
            );
            if (rows.length === 0 || paymentRow.school_id !== schoolId) {
                return res.status(403).json({ success: false, message: 'Access Denied: Student not linked to parent account' });
            };
        } else if (role !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Access Denied: Unauthorized' });
        };

        const generated_signature = crypto
            .createHmac('sha256', keySecret)
            .update(razorpay_order_id + "|" + razorpay_payment_id)
            .digest('hex');

        const sigBuffer = Buffer.from(generated_signature);
        const receivedBuffer = Buffer.from(razorpay_signature);
        const isValid = sigBuffer.length === receivedBuffer.length &&
            crypto.timingSafeEqual(sigBuffer, receivedBuffer);

        if (!isValid) {
            return res.status(400).json({ success: false, message: 'Payment verification signature mismatch' });
        };

        if (!['completed', 'paid'].includes(paymentRow.status)) {
            await fetchCapturedPayment({
                paymentId: razorpay_payment_id,
                orderId: razorpay_order_id,
                amount: paymentRow.amount,
                currency: 'INR'
            });
        };

        const payment = await completePayment(actualPaymentId, razorpay_payment_id, razorpay_signature);
        res.json({
            success: true,
            data: {
                receiptId: payment.id,
                receiptNo: payment.receipt_no
            }
        });
    } catch (err) {
        console.error("Payment Verify Route Error:", err);
        res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Payment verification failed' });
    };
});

router.get('/payment-status/:orderId', verifyToken, async (req, res, next) => {
    try {
        const { orderId } = req.params;
        const schoolId = req.user?.school_id;
        const role = req.user?.role;
        const userId = req.user?.id;
        const isSuperAdmin = role === 'super_admin';
        if (!['super_admin', 'school_admin', 'student', 'parent'].includes(role)) {
            return res.status(403).json({ success: false, message: 'Access Denied: Unauthorized role' });
        };

        if (!isSuperAdmin && !schoolId) {
            return res.status(403).json({ success: false, message: 'School context required.' });
        };
        const payment = await findFeePaymentStatusRow({
            reference: orderId,
            schoolId: isSuperAdmin ? null : schoolId
        });

        if (!payment) {
            return res.status(404).json({ success: false, message: 'Payment record not found' });
        };
        if (role === 'student') {
            const [[student]] = await db.query(
                'SELECT id FROM students WHERE user_id = ? AND school_id = ? AND deleted_at IS NULL LIMIT 1',
                [userId, schoolId]
            );
            if (!student || Number(student.id) !== Number(payment.student_id)) {
                return res.status(403).json({ success: false, message: 'Access Denied: Payment owner mismatch' });
            };
        } else if (role === 'parent') {
            const [linkedStudents] = await db.query(
                `SELECT s.id
                FROM students s
                JOIN student_family sf ON sf.student_id = s.id AND sf.school_id = s.school_id
                WHERE s.id = ? AND s.school_id = ? AND sf.parent_user_id = ?
                    AND s.parent_portal_enabled = 1 AND s.deleted_at IS NULL
                LIMIT 1`,
                [payment.student_id, schoolId, userId]
            );
            const initiatedByParent = payment.initiated_by_role === 'parent' &&
                Number(payment.initiated_by_user_id) === Number(userId);
            if (!initiatedByParent && !linkedStudents.length) {
                return res.status(403).json({ success: false, message: 'Access Denied: Payment owner mismatch' });
            };
        } else if (!isSuperAdmin && role !== 'school_admin') {
            return res.status(403).json({ success: false, message: 'Access Denied: Unauthorized role' });
        };

        res.json({
            success: true,
            status: payment.status
        });
    } catch (err) {
        console.error("Payment Status Route Error:", err);
        res.status(500).json({ success: false, message: err.message || 'Failed to poll status' });
    };
});

router.post('/webhook', async (req, res, next) => {
    try {
        const signature = req.headers['x-razorpay-signature'];
        if (!signature) {
            return res.status(400).json({ success: false, message: 'Missing x-razorpay-signature header' });
        };

        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
        if (!secret) {
            // Fail secure: reject all webhooks when secret is not configured
            console.error('[Webhook/fees] RAZORPAY_WEBHOOK_SECRET is not set — rejecting webhook.');
            return res.status(503).json({ success: false, message: 'Webhook not configured on this server.' });
        };

        const bodyStr = req.rawBody ? req.rawBody.toString() : JSON.stringify(req.body);
        const generated_signature = crypto
            .createHmac('sha256', secret)
            .update(bodyStr)
            .digest('hex');

        const expectedBuffer = Buffer.from(generated_signature);
        const signatureBuffer = Buffer.from(String(signature));
        if (expectedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
            return res.status(400).json({ success: false, message: 'Webhook signature mismatch' });
        };

        const event = req.body;
        const payload = event.payload;

        if (event.event === 'payment.captured') {
            const paymentDetails = payload.payment.entity;
            const orderId = paymentDetails.order_id;
            const alternateReference = paymentDetails.qr_code_id || paymentDetails.acquirer_data?.upi_transaction_id || null;

            const payment = await findFeePaymentForWebhook({
                orderId,
                qrId: alternateReference
            });

            if (payment) {
                assertCapturedPayment(paymentDetails, {
                    paymentId: paymentDetails.id,
                    orderId: orderId ? payment.razorpay_order_id : null,
                    referenceId: orderId ? null : (payment.razorpay_qr_id || payment.transaction_id),
                    amount: payment.amount,
                    currency: 'INR'
                });
                if (payment.status === 'completed' || payment.status === 'paid') {
                    return res.json({ status: 'ok', message: 'Already processed' });
                };
                await completePayment(payment.id, paymentDetails.id, signature);
            };
        } else if (event.event === 'payment.failed') {
            const paymentDetails = payload.payment.entity;
            const orderId = paymentDetails.order_id;

            await db.query(
                `UPDATE fee_payments SET status = 'failed' WHERE razorpay_order_id = ? AND status = 'pending'`,
                [orderId]
            );
        };

        res.json({ status: 'ok' });
    } catch (err) {
        console.error("Razorpay Webhook Error:", err);
        res.status(500).json({ success: false, message: err.message || 'Webhook processing failed' });
    };
});

module.exports = router;
