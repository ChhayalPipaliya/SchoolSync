const Razorpay = require("razorpay");

const keyId = process.env.RAZORPAY_KEY_ID || "";
const keySecret = process.env.RAZORPAY_KEY_SECRET || "";
const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || "";
const isConfigured = Boolean(keyId && keySecret);

let instance = null;
if (isConfigured) {
    instance = new Razorpay({
        key_id: keyId,
        key_secret: keySecret
    });
}

module.exports = {
    instance,
    keyId,
    keySecret,
    webhookSecret,
    isConfigured
};
