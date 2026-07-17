const razorpayConfig = require("../config/razorpay");

function verificationError(message, statusCode = 409, code = "RAZORPAY_PAYMENT_MISMATCH") {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
};

function assertCapturedPayment(
    providerPayment,
    { paymentId, orderId = null, referenceId = null, amount, currency = "INR" }
) {
    const expectedAmount = Math.round(Number(amount) * 100);
    if (
        !paymentId ||
        (!orderId && !referenceId) ||
        !Number.isSafeInteger(expectedAmount) ||
        expectedAmount <= 0
    ) {
        throw verificationError(
            "Stored payment verification details are invalid.",
            500,
            "INVALID_STORED_PAYMENT"
        );
    };

    const expectedCurrency = String(currency || "INR").toUpperCase();
    if (!providerPayment || String(providerPayment.id || "") !== String(paymentId)) {
        throw verificationError("Razorpay returned a different payment identity.");
    };
    if (orderId && String(providerPayment.order_id || "") !== String(orderId)) {
        throw verificationError("Razorpay payment order does not match this checkout.");
    };
    if (referenceId) {
        const providerReference = providerPayment.qr_code_id ||
            providerPayment.acquirer_data?.upi_transaction_id || null;
        if (String(providerReference || "") !== String(referenceId)) {
            throw verificationError("Razorpay payment reference does not match this checkout.");
        };
    };
    if (
        String(providerPayment.status || "").toLowerCase() !== "captured" ||
        providerPayment.captured !== true
    ) {
        throw verificationError(
            "Payment has not been captured by Razorpay.",
            409,
            "RAZORPAY_PAYMENT_NOT_CAPTURED"
        );
    };
    if (Number(providerPayment.amount) !== expectedAmount) {
        throw verificationError("Razorpay payment amount does not match this checkout.");
    };
    if (String(providerPayment.currency || "").toUpperCase() !== expectedCurrency) {
        throw verificationError("Razorpay payment currency does not match this checkout.");
    };

    return providerPayment;
};

function assertPaidOrder(providerOrder, { orderId, amount, currency = "INR" }) {
    const expectedAmount = Math.round(Number(amount) * 100);
    const expectedCurrency = String(currency || "INR").toUpperCase();
    if (!orderId || !Number.isSafeInteger(expectedAmount) || expectedAmount <= 0) {
        throw verificationError(
            "Stored order verification details are invalid.",
            500,
            "INVALID_STORED_PAYMENT"
        );
    };
    if (!providerOrder || String(providerOrder.id || "") !== String(orderId)) {
        throw verificationError("Razorpay returned a different order identity.");
    };
    if (String(providerOrder.status || "").toLowerCase() !== "paid") {
        throw verificationError("Razorpay order has not been paid.");
    };
    if (
        Number(providerOrder.amount) !== expectedAmount ||
        Number(providerOrder.amount_paid) !== expectedAmount
    ) {
        throw verificationError("Razorpay paid order amount does not match this checkout.");
    };
    if (String(providerOrder.currency || "").toUpperCase() !== expectedCurrency) {
        throw verificationError("Razorpay paid order currency does not match this checkout.");
    };
    return providerOrder;
};

async function fetchCapturedPayment({
    paymentId,
    orderId,
    amount,
    currency = "INR",
    instance = razorpayConfig.instance
}) {
    if (!instance?.payments?.fetch) {
        throw verificationError(
            "Payment gateway is not configured. Please contact support.",
            503,
            "RAZORPAY_NOT_CONFIGURED"
        );
    };

    let providerPayment;
    try {
        providerPayment = await instance.payments.fetch(paymentId);
    } catch (cause) {
        const error = verificationError(
            "Unable to confirm the captured payment with Razorpay. Please try again.",
            502,
            "RAZORPAY_CONFIRMATION_FAILED"
        );
        error.cause = cause;
        throw error;
    };

    return assertCapturedPayment(providerPayment, { paymentId, orderId, amount, currency });
};

module.exports = { assertCapturedPayment, assertPaidOrder, fetchCapturedPayment, _test: Object.freeze({ verificationError })};