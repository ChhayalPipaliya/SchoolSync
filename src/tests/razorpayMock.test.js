const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
process.env.RAZORPAY_WEBHOOK_SECRET = 'unit-webhook-secret';
const { amountForPlan, addCycleToDate } = require('../utils/subscriptionPeriods');
const verifyWebhookSignature = (raw, signature) => {
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex');
    return expected.length === String(signature || '').length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature || '')));
};

test('mocked Razorpay plan amounts and calendar periods are server-side', () => {
    const plan = { monthly_price: 999, yearly_price: 9999 };
    assert.equal(amountForPlan(plan, 'monthly'), 999);
    assert.equal(amountForPlan(plan, 'yearly'), 9999);
    assert.equal(addCycleToDate(new Date('2024-02-29T00:00:00Z'), 'monthly').toISOString().slice(0, 10), '2024-03-29');
    assert.equal(addCycleToDate(new Date('2024-02-29T00:00:00Z'), 'yearly').toISOString().slice(0, 10), '2025-02-28');
});

test('mocked Razorpay webhook signatures reject tampering', () => {
    const raw = JSON.stringify({ order_id: 'order_1', payment_id: 'pay_1', amount: 99900 });
    const signature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex');
    assert.equal(verifyWebhookSignature(raw, signature), true);
    assert.equal(verifyWebhookSignature(raw, `${signature.slice(0, -1)}0`), false);
    assert.equal(verifyWebhookSignature(JSON.stringify({ order_id: 'order_2' }), signature), false);
});
