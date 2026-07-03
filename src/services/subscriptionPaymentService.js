const crypto = require("crypto");
const db = require("../config/database");
const razorpayConfig = require("../config/razorpay");
const NotificationService = require("./notificationService");
const { invalidatePlanCache, invalidateSubscriptionCache } = require("../utils/planCache");

const PAYMENT_CONFIG_ERROR = "Payment gateway is not configured. Please contact support.";
const VALID_BILLING_CYCLES = new Set(["monthly", "yearly"]);

const schemaCache = new Map();

function normalizeBillingCycle(cycle) {
    return VALID_BILLING_CYCLES.has(cycle) ? cycle : null;
}

function addCycleToDate(date, cycle) {
    const next = new Date(date);
    if (cycle === "yearly") next.setFullYear(next.getFullYear() + 1);
    else next.setMonth(next.getMonth() + 1);
    return next;
}

function toSqlDate(date) {
    return date.toISOString().slice(0, 10);
}

function amountForPlan(plan, billingCycle) {
    const amount = Number(billingCycle === "yearly" ? plan.yearly_price : plan.monthly_price);
    return Number.isFinite(amount) ? Number(amount.toFixed(2)) : 0;
}

function receiptNo(schoolId) {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const suffix = Math.floor(1000 + Math.random() * 9000);
    return `RCP-SUB-${schoolId}-${today}-${suffix}`;
}

function orderReceipt(schoolId) {
    return `sub_${schoolId}_${Date.now()}`;
}

async function hasColumn(tableName, columnName) {
    const key = `${tableName}.${columnName}`;
    if (schemaCache.has(key)) return schemaCache.get(key);

    const rows = await db.queryAsync(
        `SELECT COUNT(*) AS count
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND COLUMN_NAME = ?`,
        [tableName, columnName]
    );
    const exists = Number(rows[0]?.count || 0) > 0;
    schemaCache.set(key, exists);
    return exists;
}

async function insertFlexible(connection, tableName, values) {
    const columns = [];
    const params = [];

    for (const [column, value] of Object.entries(values)) {
        if (await hasColumn(tableName, column)) {
            columns.push(column);
            params.push(value);
        }
    }

    const placeholders = columns.map(() => "?").join(", ");
    const [result] = await connection.query(
        `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${placeholders})`,
        params
    );
    return result;
}

async function updateFlexible(connection, tableName, values, whereSql, whereParams) {
    const sets = [];
    const params = [];

    for (const [column, value] of Object.entries(values)) {
        if (await hasColumn(tableName, column)) {
            sets.push(`${column} = ?`);
            params.push(value);
        }
    }

    if (!sets.length) return null;
    const [result] = await connection.query(
        `UPDATE ${tableName} SET ${sets.join(", ")} WHERE ${whereSql}`,
        [...params, ...whereParams]
    );
    return result;
}

async function getPlanForPurchase(planId) {
    const [[plan]] = await db.query(
        `SELECT *
         FROM plans
         WHERE id = ?
           AND COALESCE(is_active, 1) = 1
           AND COALESCE(status, 'active') = 'active'
         LIMIT 1`,
        [planId]
    );
    return plan || null;
}

async function getSchoolAdmin(schoolId, userId) {
    const [[user]] = await db.query(
        `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, s.school_name, s.school_email, s.school_phone
         FROM users u
         JOIN schools s ON s.id = u.school_id
         WHERE u.id = ? AND u.school_id = ? AND u.role = 'school_admin'
         LIMIT 1`,
        [userId, schoolId]
    );
    return user || null;
}

function verifyRazorpaySignature(orderId, paymentId, signature) {
    if (!razorpayConfig.keySecret) return false;
    const expected = crypto
        .createHmac("sha256", razorpayConfig.keySecret)
        .update(`${orderId}|${paymentId}`)
        .digest("hex");
    const actual = String(signature || "");
    return expected.length === actual.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

function verifyWebhookSignature(rawBody, signature) {
    if (!razorpayConfig.webhookSecret || !rawBody || !signature) return false;
    const expected = crypto
        .createHmac("sha256", razorpayConfig.webhookSecret)
        .update(rawBody)
        .digest("hex");
    const actual = String(signature);
    return expected.length === actual.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

async function createOrder({ schoolId, userId, planId, billingCycle }) {
    const cycle = normalizeBillingCycle(billingCycle);
    if (!cycle) {
        return { success: false, statusCode: 400, message: "Invalid billing cycle." };
    }
    if (!razorpayConfig.isConfigured || !razorpayConfig.instance) {
        return { success: false, statusCode: 503, message: PAYMENT_CONFIG_ERROR };
    }

    const plan = await getPlanForPurchase(planId);
    if (!plan) {
        return { success: false, statusCode: 404, message: "Selected plan is not available." };
    }

    const amount = amountForPlan(plan, cycle);
    if (amount <= 0) {
        return { success: false, statusCode: 400, message: "Selected plan price is invalid." };
    }

    const admin = await getSchoolAdmin(schoolId, userId);
    if (!admin) {
        return { success: false, statusCode: 403, message: "Only school admins can purchase subscriptions." };
    }

    const amountPaise = Math.round(amount * 100);
    const receipt = `sub_rcpt_${schoolId}_${Date.now()}`;
    const order = await razorpayConfig.instance.orders.create({
        amount: amountPaise,
        currency: "INR",
        receipt,
        notes: {
            school_id: String(schoolId),
            plan_id: String(plan.id),
            billing_cycle: cycle
        }
    });
    // console.log("[Dev Log] Subscription Order Created successfully:", order.id, "amount:", order.amount, "schoolId:", schoolId);

    const notes = JSON.stringify({
        gateway: "razorpay",
        razorpay_order_id: order.id,
        school_id: schoolId,
        plan_id: plan.id,
        billing_cycle: cycle
    });

    const connection = await db.getConnection();
    try {
        const [paymentResult] = await connection.query(
            `INSERT INTO subscription_payments
             (school_id, plan_id, amount, tax_amount, discount_amount, total_amount,
              payment_method, transaction_id, receipt_no, status, notes, created_at, updated_at)
             VALUES (?, ?, ?, 0.00, 0.00, ?, 'online', ?, ?, 'pending', ?, NOW(), NOW())`,
            [schoolId, plan.id, amount, amount, order.id, receiptNo(schoolId), notes]
        );

        await updateFlexible(connection, "subscription_payments", {
            razorpay_order_id: order.id,
            billing_cycle: cycle,
            currency: "INR",
            payment_status: "pending",
            payment_reference: order.id
        }, "id = ?", [paymentResult.insertId]);

        return {
            success: true,
            key_id: razorpayConfig.keyId,
            order_id: order.id,
            payment_record_id: paymentResult.insertId,
            amount: order.amount,
            currency: order.currency,
            plan: {
                id: plan.id,
                name: plan.name,
                billing_cycle: cycle,
                amount
            },
            school: {
                name: admin.school_name,
                email: admin.school_email,
                phone: admin.school_phone
            },
            prefill: {
                name: `${admin.first_name || ""} ${admin.last_name || ""}`.trim(),
                email: admin.email,
                contact: admin.phone || admin.school_phone || ""
            }
        };
    } finally {
        connection.release();
    }
}

async function findPaymentByOrder(connection, schoolId, orderId, lock = true) {
    const lockSql = lock ? " FOR UPDATE" : "";
    const [[payment]] = await connection.query(
        `SELECT *
         FROM subscription_payments
         WHERE school_id = ?
           AND (transaction_id = ? OR razorpay_order_id = ? OR payment_reference = ?)
         ORDER BY id DESC
         LIMIT 1${lockSql}`,
        [schoolId, orderId, orderId, orderId]
    ).catch(async (err) => {
        if (err.code !== "ER_BAD_FIELD_ERROR") throw err;
        const [[fallback]] = await connection.query(
            `SELECT *
             FROM subscription_payments
             WHERE school_id = ? AND transaction_id = ?
             ORDER BY id DESC
             LIMIT 1${lockSql}`,
            [schoolId, orderId]
        );
        return [fallback ? [fallback] : []];
    });
    return payment || null;
}

function getPaymentCycle(payment) {
    if (payment.billing_cycle) return payment.billing_cycle;
    if (!payment.notes) return "monthly";
    try {
        const notes = typeof payment.notes === "string" ? JSON.parse(payment.notes) : payment.notes;
        return normalizeBillingCycle(notes.billing_cycle) || "monthly";
    } catch (err) {
        return "monthly";
    }
}

function getPaymentPlanId(payment) {
    if (payment.plan_id) return payment.plan_id;
    if (!payment.notes) return null;
    try {
        const notes = typeof payment.notes === "string" ? JSON.parse(payment.notes) : payment.notes;
        return notes.plan_id || notes.target_plan_id || null;
    } catch (err) {
        return null;
    }
}

async function notifySchoolAdmins(schoolId, payload) {
    const admins = await db.queryAsync(
        "SELECT id FROM users WHERE school_id = ? AND role = 'school_admin' AND status = 'active'",
        [schoolId]
    ).catch(() => []);

    for (const admin of admins) {
        await NotificationService.createAndSend({
            recipient_id: admin.id,
            recipient_role: "school_admin",
            school_id: schoolId,
            title: payload.title,
            message: payload.message,
            type: payload.type,
            category: "system",
            reference_type: "subscription_payment",
            reference_id: payload.paymentId,
            action_url: "/schooladmin/subscription"
        }).catch((err) => console.error("[SubscriptionPayment] notification failed:", err.message));
    }
}

async function activateSubscription(connection, { payment, plan, billingCycle, razorpayPaymentId, razorpaySignature }) {
    if (payment.status === "completed" && payment.subscription_id) {
        return { alreadyProcessed: true, subscriptionId: payment.subscription_id };
    }
    if (payment.status !== "pending") {
        throw new Error("Payment is not pending.");
    }

    const schoolId = payment.school_id;
    const planAmount = amountForPlan(plan, billingCycle);
    const [[currentSub]] = await connection.query(
        `SELECT *
         FROM subscriptions
         WHERE school_id = ? AND status IN ('active', 'trial')
         ORDER BY end_date DESC, created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [schoolId]
    );

    const now = new Date();
    const samePlanRenewal = currentSub && Number(currentSub.plan_id) === Number(plan.id);
    const currentEnd = currentSub?.end_date ? new Date(currentSub.end_date) : null;
    const stillActive = currentEnd && currentEnd >= new Date(toSqlDate(now));
    const startDate = samePlanRenewal && stillActive ? currentEnd : now;
    const endDate = addCycleToDate(startDate, billingCycle);

    if (currentSub) {
        await connection.query("UPDATE subscriptions SET status = 'expired', updated_at = NOW() WHERE id = ?", [currentSub.id]);
    }

    const changeType = !currentSub
        ? "purchase"
        : samePlanRenewal
            ? "renewal"
            : Number(amountForPlan(plan, billingCycle)) >= Number(currentSub.price || 0)
                ? "upgrade"
                : "downgrade";

    const [subResult] = await connection.query(
        `INSERT INTO subscriptions
         (school_id, plan_id, plan, price, start_date, end_date, status, payment_status, billing_cycle, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', 'paid', ?, NOW(), NOW())`,
        [schoolId, plan.id, plan.plan_key || plan.name, planAmount, toSqlDate(startDate), toSqlDate(endDate), billingCycle]
    );

    const subscriptionId = subResult.insertId;
    const paymentReference = razorpayPaymentId || payment.razorpay_payment_id || payment.payment_reference || payment.transaction_id;

    await connection.query(
        `UPDATE schools
         SET plan_id = ?,
             current_plan_id = ?,
             plan = ?,
             status = 'active',
             subscription_status = 'active',
             subscription_start = ?,
             subscription_end = ?,
             subscription_started_at = ?,
             subscription_ends_at = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [plan.id, plan.id, plan.plan_key || plan.name, toSqlDate(startDate), toSqlDate(endDate), startDate, endDate, schoolId]
    );

    await connection.query(
        `UPDATE subscription_payments
         SET status = 'completed',
             subscription_id = ?,
             transaction_id = ?,
             paid_at = NOW(),
             updated_at = NOW()
         WHERE id = ?`,
        [subscriptionId, paymentReference, payment.id]
    );
    // console.log("[Dev Log] Subscription payment marked completed/paid. Payment ID:", payment.id, "School ID:", schoolId);

    const paymentUpdates = {
        payment_status: "success",
        payment_reference: paymentReference,
        billing_cycle: billingCycle,
        paid_at: new Date()
    };
    if (razorpayPaymentId) paymentUpdates.razorpay_payment_id = razorpayPaymentId;
    if (razorpaySignature) paymentUpdates.razorpay_signature = razorpaySignature;
    await updateFlexible(connection, "subscription_payments", paymentUpdates, "id = ?", [payment.id]);

    await connection.query(
        `INSERT INTO subscription_history
         (school_id, old_plan_id, old_plan_name, new_plan_id, new_plan_name, change_type, billing_cycle, amount_paid, payment_ref, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
            schoolId,
            currentSub?.plan_id || null,
            currentSub?.plan || null,
            plan.id,
            plan.name,
            changeType,
            billingCycle,
            planAmount,
            paymentReference
        ]
    );

    await Promise.all([
        invalidatePlanCache(schoolId),
        invalidateSubscriptionCache(schoolId)
    ]);

    await notifySchoolAdmins(schoolId, {
        paymentId: payment.id,
        title: "Payment successful",
        message: `Payment successful. Your ${plan.name} plan is now active.`,
        type: "success"
    });

    return { subscriptionId, changeType };
}

async function verifyPayment({ schoolId, orderId, paymentId, signature, planId, billingCycle }) {
    if (!orderId || !paymentId || !signature) {
        return { success: false, statusCode: 400, message: "Missing payment verification details." };
    }
    if (!verifyRazorpaySignature(orderId, paymentId, signature)) {
        await markPaymentFailed({ schoolId, orderId, reason: "Invalid Razorpay signature" });
        return { success: false, statusCode: 400, message: "Payment verification failed." };
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const payment = await findPaymentByOrder(connection, schoolId, orderId, true);
        if (!payment) {
            await connection.rollback();
            return { success: false, statusCode: 404, message: "Pending payment record not found." };
        }

        if (payment.status === "completed") {
            await connection.commit();
            return {
                success: true,
                message: "Payment already processed.",
                redirect: "/schooladmin/dashboard"
            };
        }

        const pendingPlanId = Number(getPaymentPlanId(payment));
        if (Number(planId || pendingPlanId) !== pendingPlanId) {
            await connection.rollback();
            return { success: false, statusCode: 400, message: "Payment plan mismatch." };
        }

        const cycle = normalizeBillingCycle(billingCycle) || getPaymentCycle(payment);
        if (cycle !== getPaymentCycle(payment)) {
            await connection.rollback();
            return { success: false, statusCode: 400, message: "Payment billing cycle mismatch." };
        }

        const [[plan]] = await connection.query("SELECT * FROM plans WHERE id = ? LIMIT 1", [pendingPlanId]);
        if (!plan) {
            await connection.rollback();
            return { success: false, statusCode: 404, message: "Plan not found." };
        }

        await activateSubscription(connection, {
            payment,
            plan,
            billingCycle: cycle,
            razorpayPaymentId: paymentId,
            razorpaySignature: signature
        });

        await connection.commit();
        return {
            success: true,
            message: "Payment successful. Your plan is now active.",
            redirect: "/schooladmin/dashboard"
        };
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
}

async function markPaymentFailed({ schoolId, orderId, reason, paymentId = null }) {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const payment = orderId ? await findPaymentByOrder(connection, schoolId, orderId, true) : null;
        if (!payment) {
            await connection.commit();
            return { success: true, message: "Payment failure recorded." };
        }
        if (payment.status === "completed") {
            await connection.commit();
            return { success: true, message: "Payment was already completed." };
        }

        await connection.query(
            "UPDATE subscription_payments SET status = 'failed', updated_at = NOW(), notes = CONCAT(COALESCE(notes, ''), ?) WHERE id = ?",
            [`\nFailure: ${reason || "Payment failed"}`, payment.id]
        );
        await updateFlexible(connection, "subscription_payments", {
            razorpay_payment_id: paymentId,
            failure_reason: reason || "Payment failed",
            payment_status: "failed",
            payment_note: reason || "Payment failed"
        }, "id = ?", [payment.id]);

        await connection.commit();
        await notifySchoolAdmins(schoolId, {
            paymentId: payment.id,
            title: "Payment failed",
            message: "Payment failed. Please try again or contact support.",
            type: "error"
        });
        return { success: true, message: "Payment failed. Please try again or contact support." };
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
}

async function markPaymentFailedByOrder({ orderId, reason, paymentId = null }) {
    if (!orderId) {
        return { success: true, message: "Payment failure recorded." };
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [[payment]] = await connection.query(
            `SELECT *
             FROM subscription_payments
             WHERE transaction_id = ? OR razorpay_order_id = ? OR payment_reference = ?
             ORDER BY id DESC
             LIMIT 1
             FOR UPDATE`,
            [orderId, orderId, orderId]
        ).catch(async (err) => {
            if (err.code !== "ER_BAD_FIELD_ERROR") throw err;
            const [[fallback]] = await connection.query(
                `SELECT * FROM subscription_payments WHERE transaction_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE`,
                [orderId]
            );
            return [fallback ? [fallback] : []];
        });

        if (!payment || payment.status === "completed") {
            await connection.commit();
            return { success: true, message: "Payment failure recorded." };
        }

        await connection.query(
            "UPDATE subscription_payments SET status = 'failed', updated_at = NOW(), notes = CONCAT(COALESCE(notes, ''), ?) WHERE id = ?",
            [`\nFailure: ${reason || "Payment failed"}`, payment.id]
        );
        await updateFlexible(connection, "subscription_payments", {
            razorpay_payment_id: paymentId,
            failure_reason: reason || "Payment failed",
            payment_status: "failed",
            payment_note: reason || "Payment failed"
        }, "id = ?", [payment.id]);

        await connection.commit();
        await notifySchoolAdmins(payment.school_id, {
            paymentId: payment.id,
            title: "Payment failed",
            message: "Payment failed. Please try again or contact support.",
            type: "error"
        });
        return { success: true, message: "Payment failed. Please try again or contact support." };
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
}

async function handleCapturedWebhook(orderId, paymentId, signature = null) {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [[payment]] = await connection.query(
            `SELECT *
             FROM subscription_payments
             WHERE transaction_id = ? OR razorpay_order_id = ? OR razorpay_payment_id = ?
             ORDER BY id DESC
             LIMIT 1
             FOR UPDATE`,
            [orderId, orderId, paymentId]
        ).catch(async (err) => {
            if (err.code !== "ER_BAD_FIELD_ERROR") throw err;
            const [[fallback]] = await connection.query(
                `SELECT * FROM subscription_payments WHERE transaction_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE`,
                [orderId]
            );
            return [fallback ? [fallback] : []];
        });

        if (!payment || payment.status === "completed") {
            await connection.commit();
            return { success: true };
        }

        const planId = getPaymentPlanId(payment);
        const [[plan]] = await connection.query("SELECT * FROM plans WHERE id = ? LIMIT 1", [planId]);
        if (!plan) {
            await connection.rollback();
            return { success: false, message: "Plan not found for webhook payment." };
        }

        await activateSubscription(connection, {
            payment,
            plan,
            billingCycle: getPaymentCycle(payment),
            razorpayPaymentId: paymentId,
            razorpaySignature: signature
        });
        await connection.commit();
        return { success: true };
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
}

async function handlePaidOrderWebhook(orderId, signature = null) {
    if (!orderId) return { success: true };

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [[payment]] = await connection.query(
            `SELECT *
             FROM subscription_payments
             WHERE transaction_id = ? OR razorpay_order_id = ? OR payment_reference = ?
             ORDER BY id DESC
             LIMIT 1
             FOR UPDATE`,
            [orderId, orderId, orderId]
        ).catch(async (err) => {
            if (err.code !== "ER_BAD_FIELD_ERROR") throw err;
            const [[fallback]] = await connection.query(
                `SELECT * FROM subscription_payments WHERE transaction_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE`,
                [orderId]
            );
            return [fallback ? [fallback] : []];
        });

        if (!payment || payment.status === "completed") {
            await connection.commit();
            return { success: true };
        }
        if (payment.status !== "pending") {
            await connection.commit();
            return { success: true };
        }

        const planId = getPaymentPlanId(payment);
        const [[plan]] = await connection.query("SELECT * FROM plans WHERE id = ? LIMIT 1", [planId]);
        if (!plan) {
            await connection.rollback();
            return { success: false, message: "Plan not found for webhook order." };
        }

        await activateSubscription(connection, {
            payment,
            plan,
            billingCycle: getPaymentCycle(payment),
            razorpayPaymentId: payment.razorpay_payment_id || null,
            razorpaySignature: signature
        });
        await connection.commit();
        return { success: true };
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
}

module.exports = {
    PAYMENT_CONFIG_ERROR,
    createOrder,
    verifyPayment,
    markPaymentFailed,
    markPaymentFailedByOrder,
    verifyWebhookSignature,
    handleCapturedWebhook,
    handlePaidOrderWebhook,
    normalizeBillingCycle
};
