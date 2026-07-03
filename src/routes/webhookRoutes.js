const express = require("express");
const router = express.Router();
const subscriptionPayments = require("../services/subscriptionPaymentService");

router.post("/razorpay", async (req, res) => {
    try {
        const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || "";
        if (!webhookSecret) {
            console.log("[Webhook] RAZORPAY_WEBHOOK_SECRET not configured — webhook ignored (using client-side verify flow).");
            return res.json({ success: true, ignored: true, reason: "webhook_secret_not_configured" });
        }

        const signature = req.headers["x-razorpay-signature"];
        if (!subscriptionPayments.verifyWebhookSignature(req.rawBody, signature)) {
            return res.status(400).json({ success: false, message: "Invalid webhook signature." });
        }

        const event = req.body;
        const paymentEntity = event?.payload?.payment?.entity;
        const orderEntity = event?.payload?.order?.entity;
        const orderId = paymentEntity?.order_id || orderEntity?.id;
        const paymentId = paymentEntity?.id;

        if (event.event === "payment.captured") {
            if (orderId && paymentId) {
                await subscriptionPayments.handleCapturedWebhook(orderId, paymentId, signature);
            }
            return res.json({ success: true });
        }

        if (event.event === "order.paid") {
            if (orderId) {
                if (paymentId) {
                    await subscriptionPayments.handleCapturedWebhook(orderId, paymentId, signature);
                } else {
                    await subscriptionPayments.handlePaidOrderWebhook(orderId, signature);
                }
            }
            return res.json({ success: true });
        }

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
                }
            }
            return res.json({ success: true });
        }

        return res.json({ success: true, ignored: true });
    } catch (error) {
        console.error("Razorpay webhook error:", error);
        return res.status(500).json({ success: false, message: "Webhook processing failed." });
    }
});

module.exports = router;
