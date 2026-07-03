const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../config/database');
const NotificationService = require('../services/notificationService');
const NotificationModel = require('../models/notificationModel');
const templates = require('../utils/notificationTemplates');

async function completePayment(paymentId, razorpayPaymentId, razorpaySignature, connectionInput = null) {
    const connection = connectionInput || await db.getConnection();
    if (!connectionInput) await connection.beginTransaction();

    try {
        const [[payment]] = await connection.query(
            `SELECT * FROM fee_payments WHERE id = ? FOR UPDATE`,
            [paymentId]
        );

        if (!payment) {
            throw new Error('Payment record not found');
        }

        if (payment.status === 'completed' || payment.status === 'paid') {
            if (!connectionInput) await connection.commit();
            return payment;
        }

        const schoolId = payment.school_id;
        const studentId = payment.student_id;
        const amount = payment.amount;

        const [[countRow]] = await connection.query(
            `SELECT COUNT(*) as count FROM fee_payments WHERE school_id = ? AND status = 'completed'`,
            [schoolId]
        );
        const nextVal = (countRow?.count || 0) + 1;
        const year = new Date().getFullYear();
        const receiptNumber = `RCP-${schoolId}-${year}-${String(nextVal).padStart(6, '0')}`;

        await connection.query(
            `UPDATE fee_payments 
             SET status = 'completed', 
                 payment_method = 'online', 
                 razorpay_payment_id = ?, 
                 razorpay_signature = ?, 
                 transaction_id = ?, 
                 receipt_no = ?, 
                 receipt_number = ?, 
                 paid_at = NOW(), 
                 payment_date = CURDATE() 
             WHERE id = ?`,
            [razorpayPaymentId, razorpaySignature, razorpayPaymentId, receiptNumber, receiptNumber, paymentId]
        );

        await connection.query(
            `UPDATE student_fees 
             SET status = 'paid', 
                 paid_amount = total_amount,
                 paid_at = NOW() 
             WHERE payment_id = ?`,
            [paymentId]
        );

        // console.log("[Dev Log] Payment marked paid in database. Payment ID:", paymentId, "Razorpay Payment ID:", razorpayPaymentId);

        const [[studentUser]] = await connection.query(
            `SELECT s.id, u.id as user_id, u.first_name as first_name, u.last_name as last_name, u.email 
             FROM students s 
             JOIN users u ON s.user_id = u.id 
             WHERE s.id = ?`,
            [studentId]
        );

        if (!connectionInput) await connection.commit();

        if (studentUser) {
            const studentName = `${studentUser.first_name} ${studentUser.last_name}`;
            
            NotificationService.createAndSend({
                recipient_id: studentUser.user_id,
                recipient_role: "student",
                school_id: schoolId,
                created_by: null,
                ...templates.feePaidStudent(amount, paymentId)
            }).catch(err => console.error("Webhook notification error student:", err));

            NotificationService.notifyAdmins(
                schoolId,
                templates.feePaid(studentName, amount, paymentId),
                null
            ).catch(err => console.error("Webhook notification error admins:", err));

            if (studentUser.email) {
                const mailTemplate = templates.feePaidStudent(amount, paymentId);
                const subject = `[SchoolSync] ${mailTemplate.title}`;
                const bodyHtml = templates.emailWrapper ? templates.emailWrapper(mailTemplate.title, `<p>${mailTemplate.message}</p>`) : `<p>${mailTemplate.message}</p>`;
                NotificationModel.enqueueEmail(studentUser.email, subject, bodyHtml)
                    .catch(err => console.error("Webhook email queue error:", err));
            }
        }

        // Notify the paying parent if initiated by a parent
        if (payment.initiated_by_role === 'parent' && payment.initiated_by_user_id) {
            try {
                const [[parentUser]] = await connection.query(
                    `SELECT id, first_name, last_name, email FROM users WHERE id = ?`,
                    [payment.initiated_by_user_id]
                );

                if (parentUser) {
                    const studentName = studentUser ? `${studentUser.first_name} ${studentUser.last_name}` : 'your child';
                    const baseTemplate = templates.feePaidStudent(amount, paymentId);
                    const parentTemplate = {
                        title: baseTemplate.title,
                        message: `Your payment of ₹${amount} for ${studentName} was received successfully. Receipt No: ${receiptNumber || paymentId}`
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
                    }
                }
            } catch (parentErr) {
                console.error("Failed to notify paying parent:", parentErr);
            }
        }

        return { ...payment, status: 'completed', receipt_no: receiptNumber };

    } catch (err) {
        if (!connectionInput) await connection.rollback();
        throw err;
    } finally {
        if (!connectionInput) connection.release();
    }
}

const { verifyToken } = require('../middleware/auth');

router.post('/verify', async (req, res, next) => {
    try {
        const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
        if (!keySecret) {
            return res.status(503).json({ success: false, message: 'Payment gateway is not configured. Please contact support.' });
        }

        const { razorpay_payment_id, razorpay_order_id, razorpay_signature, payment_id, localPaymentId } = req.body;
        const actualPaymentId = localPaymentId || payment_id;

        if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature || !actualPaymentId) {
            return res.status(400).json({ success: false, message: 'Missing required signature parameters' });
        }

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
        }

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
        res.status(500).json({ success: false, message: err.message || 'Payment verification failed' });
    }
});

router.get('/payment-status/:orderId', verifyToken, async (req, res, next) => {
    try {
        const { orderId } = req.params;
        
        const [[payment]] = await db.query(
            `SELECT * FROM fee_payments WHERE id = ? OR razorpay_order_id = ? OR transaction_id = ?`,
            [orderId, orderId, orderId]
        );

        if (!payment) {
            return res.status(404).json({ success: false, message: 'Payment record not found' });
        }

        res.json({
            success: true,
            status: payment.status
        });

    } catch (err) {
        console.error("Payment Status Route Error:", err);
        res.status(500).json({ success: false, message: err.message || 'Failed to poll status' });
    }
});

router.post('/webhook', async (req, res, next) => {
    try {
        const signature = req.headers['x-razorpay-signature'];
        if (!signature) {
            return res.status(400).json({ success: false, message: 'Missing x-razorpay-signature header' });
        }

        const secret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
        const bodyStr = req.rawBody ? req.rawBody.toString() : JSON.stringify(req.body);
        const generated_signature = crypto
            .createHmac('sha256', secret)
            .update(bodyStr)
            .digest('hex');

        if (generated_signature !== signature) {
            return res.status(400).json({ success: false, message: 'Webhook signature mismatch' });
        }

        const event = req.body;
        const payload = event.payload;

        if (event.event === 'payment.captured') {
            const paymentDetails = payload.payment.entity;
            const orderId = paymentDetails.order_id;
            
            const [[payment]] = await db.query(
                `SELECT * FROM fee_payments WHERE razorpay_order_id = ? OR transaction_id = ?`,
                [orderId, paymentDetails.method === 'upi' ? paymentDetails.acquirer_data?.upi_transaction_id : '']
            );

            if (payment) {
                if (payment.status === 'completed' || payment.status === 'paid') {
                    return res.json({ status: 'ok', message: 'Already processed' });
                }
                await completePayment(payment.id, paymentDetails.id, signature);
            }
        } else if (event.event === 'payment.failed') {
            const paymentDetails = payload.payment.entity;
            const orderId = paymentDetails.order_id;

            await db.query(
                `UPDATE fee_payments SET status = 'failed' WHERE razorpay_order_id = ? AND status = 'pending'`,
                [orderId]
            );
        }

        res.json({ status: 'ok' });

    } catch (err) {
        console.error("Razorpay Webhook Error:", err);
        res.status(500).json({ success: false, message: err.message || 'Webhook processing failed' });
    }
});

module.exports = router;
