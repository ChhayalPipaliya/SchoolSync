const express = require("express");
const router = express.Router();
const subscriptionPayments = require("../services/subscriptionPaymentService");

router.post("/razorpay", async (req, res) => {
    try {
        const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
        if (!webhookSecret) {
            console.error("[Webhook/subscriptions] RAZORPAY_WEBHOOK_SECRET is not set — rejecting webhook.");
            return res.status(503).json({ success: false, message: "Webhook not configured on this server." });
        };

        const signature = req.headers["x-razorpay-signature"];
        if (!subscriptionPayments.verifyWebhookSignature(req.rawBody, signature)) {
            return res.status(400).json({ success: false, message: "Invalid webhook signature." });
        };

        const event = req.body;
        const paymentEntity = event?.payload?.payment?.entity;
        const orderEntity = event?.payload?.order?.entity;
        const orderId = paymentEntity?.order_id || orderEntity?.id;
        const paymentId = paymentEntity?.id;

        if (event.event === "payment.captured") {
            if (orderId && paymentId) {
                const result = await subscriptionPayments.handleCapturedWebhook(
                    orderId,
                    paymentId,
                    signature,
                    paymentEntity
                );
                if (!result.success) throw new Error(result.message || "Captured payment was not processed.");
            };
            return res.json({ success: true });
        };

        if (event.event === "order.paid") {
            if (orderId) {
                if (paymentId) {
                    const result = await subscriptionPayments.handleCapturedWebhook(
                        orderId,
                        paymentId,
                        signature,
                        paymentEntity
                    );
                    if (!result.success) throw new Error(result.message || "Paid order was not processed.");
                } else {
                    const result = await subscriptionPayments.handlePaidOrderWebhook(
                        orderId,
                        signature,
                        orderEntity
                    );
                    if (!result.success) throw new Error(result.message || "Paid order was not processed.");
                };
            };
            return res.json({ success: true });
        };

        if (event.event === "payment.failed") {
            if (orderId) {
                const schoolId = Number(paymentEntity?.notes?.school_id || 0);
                if (schoolId) {
                    await subscriptionPayments.markPaymentFailed({
                        schoolId,
                        orderId,
                        paymentId,
                        reason: paymentEntity?.error_description || "Razorpay payment failed."
                    });
                } else {
                    await subscriptionPayments.markPaymentFailedByOrder({
                        orderId,
                        paymentId,
                        reason: paymentEntity?.error_description || "Razorpay payment failed."
                    });
                };
            };
            return res.json({ success: true });
        };

        return res.json({ success: true, ignored: true });
    } catch (error) {
        console.error("Razorpay webhook error:", error);
        return res.status(500).json({ success: false, message: "Webhook processing failed." });
    };
});

module.exports = router;
