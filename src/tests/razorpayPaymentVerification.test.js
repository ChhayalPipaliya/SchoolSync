"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
    assertCapturedPayment,
    assertPaidOrder,
    fetchCapturedPayment
} = require("../services/razorpayPaymentVerificationService");

function providerWith(payment) {
    return {
        payments: {
            fetch: async () => payment
        }
    };
};

const expected = Object.freeze({
    paymentId: "pay_verified_1",
    orderId: "order_verified_1",
    amount: 999,
    currency: "INR"
});

function capturedPayment(overrides = {}) {
    return {
        id: expected.paymentId,
        order_id: expected.orderId,
        amount: 99900,
        currency: "INR",
        status: "captured",
        captured: true,
        ...overrides
    };
};

test("provider confirmation accepts only the matching captured payment", async () => {
    const result = await fetchCapturedPayment({
        ...expected,
        instance: providerWith(capturedPayment())
    });
    assert.equal(result.id, expected.paymentId);
});

test("provider confirmation rejects uncaptured, wrong-order, wrong-amount, and wrong-currency payments", async () => {
    const invalidPayments = [
        capturedPayment({ status: "authorized", captured: false }),
        capturedPayment({ order_id: "order_other" }),
        capturedPayment({ amount: 99800 }),
        capturedPayment({ currency: "USD" })
    ];

    for (const payment of invalidPayments) {
        await assert.rejects(
            fetchCapturedPayment({ ...expected, instance: providerWith(payment) }),
            (error) => error?.statusCode === 409
        );
    };
});

test("provider lookup failures fail closed without activating from the checkout signature", async () => {
    const providerError = new Error("upstream unavailable");
    await assert.rejects(
        fetchCapturedPayment({
            ...expected,
            instance: { payments: { fetch: async () => { throw providerError; } } }
        }),
        (error) => error?.statusCode === 502 && error?.code === "RAZORPAY_CONFIRMATION_FAILED"
    );
});

test("signed webhook entities require explicit captured status and a paid order requires the full stored amount", () => {
    assert.throws(
        () => assertCapturedPayment(capturedPayment({ captured: undefined }), expected),
        /has not been captured/
    );
    assert.doesNotThrow(() => assertPaidOrder({
        id: expected.orderId,
        amount: 99900,
        amount_paid: 99900,
        currency: "INR",
        status: "paid"
    }, expected));
    assert.throws(() => assertPaidOrder({
        id: expected.orderId,
        amount: 99900,
        amount_paid: 99800,
        currency: "INR",
        status: "paid"
    }, expected), /amount does not match/);
});
