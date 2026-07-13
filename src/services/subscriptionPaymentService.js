const crypto = require("crypto");
const db = require("../config/database");
const razorpayConfig = require("../config/razorpay");
const NotificationService = require("./notificationService");
const {
    assertCapturedPayment,
    assertPaidOrder,
    fetchCapturedPayment
} = require("./razorpayPaymentVerificationService");
const { invalidatePlanCache, invalidateSubscriptionCache } = require("../utils/planCache");
const { isTrialPlan, hasSchoolUsedTrial, TRIAL_ALREADY_USED_MESSAGE } = require("./subscriptionService");
const {
    addCycleToDate,
    addDays,
    amountForPlan,
    normalizeBillingCycle,
    toSqlDate
} = require("../utils/subscriptionPeriods");

const PAYMENT_CONFIG_ERROR = "Payment gateway is not configured. Please contact support.";
const SUPERSEDED_CHECKOUT_REASON = "Superseded by a newer checkout order.";

function receiptNo(schoolId) {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    return `RCP-SUB-${schoolId}-${today}-${suffix}`;
};

function orderReceipt(schoolId) {
    return `sub_${schoolId}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
};

async function supersedeUnresolvedCheckouts(connection, { schoolId, olderThanId = null }) {
    const boundarySql = olderThanId ? " AND id < ?" : "";
    const params = [SUPERSEDED_CHECKOUT_REASON, schoolId];
    if (olderThanId) params.push(olderThanId);
    const [result] = await connection.query(
        `UPDATE subscription_payments
        SET notes = CASE
                WHEN LOWER(COALESCE(notes, '')) LIKE '%superseded by a newer checkout order%'
                    THEN notes
                ELSE CONCAT(COALESCE(notes, ''), '\n${SUPERSEDED_CHECKOUT_REASON}')
            END,
            status = 'failed',
            payment_status = 'failed',
            failure_reason = ?,
            updated_at = NOW()
        WHERE school_id = ?
            AND subscription_id IS NULL
            AND status IN ('pending', 'failed')
            AND payment_method IN ('online', 'razorpay')${boundarySql}`,
        params
    );
    return result;
};

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
};

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
};

async function getSchoolForTrialCheck(schoolId) {
    const [[school]] = await db.query("SELECT * FROM schools WHERE id = ? LIMIT 1", [schoolId]);
    return school || null;
};

function verifyRazorpaySignature(orderId, paymentId, signature) {
    if (!razorpayConfig.keySecret) return false;
    const expected = crypto
        .createHmac("sha256", razorpayConfig.keySecret)
        .update(`${orderId}|${paymentId}`)
        .digest("hex");
    const actual = String(signature || "");
    return expected.length === actual.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
};

function verifyWebhookSignature(rawBody, signature) {
    if (!razorpayConfig.webhookSecret || !rawBody || !signature) return false;
    const expected = crypto
        .createHmac("sha256", razorpayConfig.webhookSecret)
        .update(rawBody)
        .digest("hex");
    const actual = String(signature);
    return expected.length === actual.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
};

async function createOrder({ schoolId, userId, planId, billingCycle }) {
    const cycle = normalizeBillingCycle(billingCycle);
    if (!cycle) {
        return { success: false, statusCode: 400, message: "Invalid billing cycle." };
    };

    const plan = await getPlanForPurchase(planId);
    if (!plan) {
        return { success: false, statusCode: 404, message: "Selected plan is not available." };
    };

    if (isTrialPlan(plan)) {
        const school = await getSchoolForTrialCheck(schoolId);
        return {
            success: false,
            statusCode: 400,
            message: hasSchoolUsedTrial(school) ? TRIAL_ALREADY_USED_MESSAGE : "Trial plan is only available through demo signup."
        };
    };

    const amount = amountForPlan(plan, cycle);
    if (amount <= 0) {
        return { success: false, statusCode: 400, message: "Selected plan price is invalid." };
    };

    const admin = await getSchoolAdmin(schoolId, userId);
    if (!admin) {
        return { success: false, statusCode: 403, message: "Only school admins can purchase subscriptions." };
    };

    if (!razorpayConfig.isConfigured || !razorpayConfig.instance) {
        return { success: false, statusCode: 503, message: PAYMENT_CONFIG_ERROR };
    };

    let connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [lockedSchools] = await connection.query(
            "SELECT id FROM schools WHERE id = ? LIMIT 1 FOR UPDATE",
            [schoolId]
        );
        if (!lockedSchools.length) {
            await connection.rollback();
            return { success: false, statusCode: 404, message: "School not found." };
        };

        const [unresolvedPayments] = await connection.query(
            `SELECT *
            FROM subscription_payments
            WHERE school_id = ?
                AND subscription_id IS NULL
                AND status IN ('pending', 'failed')
                AND payment_method IN ('online', 'razorpay')
            ORDER BY id DESC
            FOR UPDATE`,
            [schoolId]
        );
        const latestUnresolvedPayment = unresolvedPayments[0] || null;
        const reusablePayment = latestUnresolvedPayment?.status === 'pending' &&
            Number(getPaymentPlanId(latestUnresolvedPayment)) === Number(plan.id) &&
            getPaymentCycle(latestUnresolvedPayment) === cycle &&
            Math.abs(Number(latestUnresolvedPayment.total_amount) - amount) <= 0.005 &&
            (latestUnresolvedPayment.razorpay_order_id || latestUnresolvedPayment.transaction_id)
            ? latestUnresolvedPayment
            : null;
        if (reusablePayment) {
            await supersedeUnresolvedCheckouts(connection, {
                schoolId,
                olderThanId: reusablePayment.id
            });
            await connection.commit();
            const existingOrderId = reusablePayment.razorpay_order_id || reusablePayment.transaction_id;
            return {
                success: true,
                reused: true,
                key_id: razorpayConfig.keyId,
                order_id: existingOrderId,
                payment_record_id: reusablePayment.id,
                amount: Math.round(Number(reusablePayment.total_amount) * 100),
                currency: reusablePayment.currency || "INR",
                plan: { id: plan.id, name: plan.name, billing_cycle: cycle, amount },
                school: { name: admin.school_name, email: admin.school_email, phone: admin.school_phone },
                prefill: {
                    name: `${admin.first_name || ""} ${admin.last_name || ""}`.trim(),
                    email: admin.email,
                    contact: admin.phone || admin.school_phone || ""
                }
            };
        };
        if (unresolvedPayments.length) {
            await supersedeUnresolvedCheckouts(connection, { schoolId });
        };

        const amountPaise = Math.round(amount * 100);
        const order = await razorpayConfig.instance.orders.create({
            amount: amountPaise,
            currency: "INR",
            receipt: orderReceipt(schoolId),
            notes: {
                school_id: String(schoolId),
                plan_id: String(plan.id),
                billing_cycle: cycle
            }
        });
        if (Number(order.amount) !== amountPaise || String(order.currency || "").toUpperCase() !== "INR") {
            throw new Error("Payment gateway returned an inconsistent order amount or currency.");
        };
        const notes = JSON.stringify({
            gateway: "razorpay",
            razorpay_order_id: order.id,
            school_id: schoolId,
            plan_id: plan.id,
            billing_cycle: cycle
        });
        const [paymentResult] = await connection.query(
            `INSERT INTO subscription_payments
            (school_id, plan_id, amount, tax_amount, discount_amount, total_amount,
            payment_method, transaction_id, receipt_no, status, notes, razorpay_order_id,
            billing_cycle, currency, payment_status, payment_reference, created_at, updated_at)
            VALUES (?, ?, ?, 0.00, 0.00, ?, 'online', ?, ?, 'pending', ?, ?, ?, 'INR', 'pending', ?, NOW(), NOW())`,
            [schoolId, plan.id, amount, amount, order.id, receiptNo(schoolId), notes, order.id, cycle, order.id]
        );
        await connection.commit();
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
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    };
};

async function findPaymentByOrder(connection, schoolId, orderId, lock = true) {
    const lockSql = lock ? " FOR UPDATE" : "";
    const [[canonicalPayment]] = await connection.query(
        `SELECT *
        FROM subscription_payments
        WHERE school_id = ?
            AND razorpay_order_id = ?
        LIMIT 1${lockSql}`,
        [schoolId, orderId]
    );
    if (canonicalPayment) return canonicalPayment;

    const [legacyPayments] = await connection.query(
        `SELECT *
        FROM subscription_payments
        WHERE school_id = ?
            AND razorpay_order_id IS NULL
            AND payment_method IN ('online', 'razorpay')
            AND (transaction_id = ? OR payment_reference = ?)
        ORDER BY id DESC
        LIMIT 2${lockSql}`,
        [schoolId, orderId, orderId]
    );
    if (legacyPayments.length > 1) {
        throw new Error("Ambiguous legacy subscription payment order reference.");
    };
    return legacyPayments[0] || null;
};

async function findPaymentByOrderAnySchool(connection, orderId, lock = true) {
    const lockSql = lock ? " FOR UPDATE" : "";
    const [[canonicalPayment]] = await connection.query(
        `SELECT *
        FROM subscription_payments
        WHERE razorpay_order_id = ?
        LIMIT 1${lockSql}`,
        [orderId]
    );
    if (canonicalPayment) return canonicalPayment;

    const [legacyPayments] = await connection.query(
        `SELECT *
        FROM subscription_payments
        WHERE razorpay_order_id IS NULL
            AND payment_method IN ('online', 'razorpay')
            AND (transaction_id = ? OR payment_reference = ?)
        ORDER BY id DESC
        LIMIT 2${lockSql}`,
        [orderId, orderId]
    );
    if (legacyPayments.length > 1) {
        throw new Error("Ambiguous legacy subscription payment order reference.");
    };
    return legacyPayments[0] || null;
};

function getPaymentCycle(payment) {
    if (payment.billing_cycle) return normalizeBillingCycle(payment.billing_cycle);
    if (!payment.notes) return null;
    try {
        const notes = typeof payment.notes === "string" ? JSON.parse(payment.notes) : payment.notes;
        return normalizeBillingCycle(notes.billing_cycle);
    } catch (err) {
        return null;
    };
};

function getPaymentPlanId(payment) {
    if (payment.plan_id) return payment.plan_id;
    if (!payment.notes) return null;
    try {
        const notes = typeof payment.notes === "string" ? JSON.parse(payment.notes) : payment.notes;
        return notes.plan_id || notes.target_plan_id || null;
    } catch (err) {
        return null;
    };
};

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
    };
};

async function runActivationSideEffects(activation) {
    if (!activation || activation.alreadyProcessed) return;
    try {
        await Promise.all([
            invalidatePlanCache(activation.schoolId),
            invalidateSubscriptionCache(activation.schoolId)
        ]);
        await notifySchoolAdmins(activation.schoolId, {
            paymentId: activation.paymentId,
            title: activation.startsInFuture ? "Renewal scheduled" : "Payment successful",
            message: activation.startsInFuture
                ? `Payment successful. Your ${activation.planName} plan will start on ${activation.startDate}.`
                : `Payment successful. Your ${activation.planName} plan is now active.`,
            type: "success"
        });
    } catch (error) {
        console.error("[SubscriptionPayment] post-commit side effect failed:", error.message);
    };
};

async function activateSubscription(connection, { payment, plan, billingCycle, razorpayPaymentId, razorpaySignature }) {
    if (payment.status === "completed" && payment.subscription_id) {
        return { alreadyProcessed: true, subscriptionId: payment.subscription_id };
    };
    if (!['pending', 'failed'].includes(payment.status)) {
        throw new Error("Payment cannot be activated from its current status.");
    };
    if (
        payment.status === 'failed' &&
        /superseded/i.test(`${payment.failure_reason || ''}\n${payment.notes || ''}`)
    ) {
        throw new Error("A superseded checkout was captured and requires manual payment reconciliation.");
    };
    if (isTrialPlan(plan)) throw new Error("Trial plans cannot be activated through a paid checkout.");

    const schoolId = payment.school_id;
    const cycle = normalizeBillingCycle(billingCycle);
    if (!cycle || cycle !== getPaymentCycle(payment)) {
        throw new Error("Stored payment billing cycle is invalid or inconsistent.");
    };
    const planAmount = amountForPlan(plan, cycle);
    const recordedAmount = Number(payment.total_amount ?? payment.amount);
    if (!Number.isFinite(recordedAmount) || Math.abs(recordedAmount - planAmount) > 0.005) {
        throw new Error("Plan price changed after this order was created. Create a new payment order.");
    };
    if (payment.currency && String(payment.currency).toUpperCase() !== "INR") {
        throw new Error("Stored payment currency is invalid.");
    };
    const [lockedSchools] = await connection.query(
        "SELECT id FROM schools WHERE id = ? LIMIT 1 FOR UPDATE",
        [schoolId]
    );
    if (!lockedSchools.length) throw new Error("School not found for subscription payment.");
    if (payment.status === 'failed') {
        const [[newerCheckout]] = await connection.query(
            `SELECT id
            FROM subscription_payments
            WHERE school_id = ?
                AND id > ?
                AND payment_method IN ('online', 'razorpay')
            ORDER BY id DESC
            LIMIT 1
            FOR UPDATE`,
            [schoolId, payment.id]
        );
        if (newerCheckout) {
            throw new Error(
                "An older failed checkout was captured after a newer checkout and requires manual payment reconciliation."
            );
        };
    };

    const [[activeSub]] = await connection.query(
        `SELECT *
        FROM subscriptions
        WHERE school_id = ? AND status IN ('active', 'trial')
        ORDER BY end_date DESC, created_at DESC
        LIMIT 1
        FOR UPDATE`,
        [schoolId]
    );
    const [[paidScheduledSub]] = await connection.query(
        `SELECT *
        FROM subscriptions
        WHERE school_id = ? AND status = 'scheduled' AND payment_status = 'paid'
        ORDER BY end_date DESC, created_at DESC
        LIMIT 1
        FOR UPDATE`,
        [schoolId]
    );
    const currentSub = paidScheduledSub || activeSub || null;

    const now = new Date();
    const currentPlanKey = currentSub ? String(currentSub.plan || "").trim().toLowerCase().replace(/_monthly|_yearly/g, "") : "";
    const newPlanKey = String(plan.plan_key || plan.name || "").trim().toLowerCase().replace(/_monthly|_yearly/g, "");
    const isSameTier = currentSub && (currentPlanKey === newPlanKey || Number(currentSub.plan_id) === Number(plan.id));
    const samePlanRenewal = Boolean(currentSub && isSameTier);
    const currentEnd = currentSub?.end_date ? new Date(currentSub.end_date) : null;
    const stillActive = currentEnd && currentEnd >= new Date(toSqlDate(now));
    const startDate = samePlanRenewal && stillActive ? addDays(currentEnd, 1) : now;
    const endDate = addCycleToDate(startDate, cycle);
    const startsInFuture = toSqlDate(startDate) > toSqlDate(now);
    const newSubscriptionStatus = startsInFuture ? "scheduled" : "active";

    if (!startsInFuture) {
        await connection.query(
            `UPDATE subscriptions
            SET status = 'expired', updated_at = NOW()
            WHERE school_id = ?
                AND (status IN ('active', 'trial') OR (status = 'scheduled' AND payment_status = 'paid'))`,
            [schoolId]
        );
    };

    const currentPrice = Number(currentSub?.price || 0);
    const currentMonthlyPrice = currentSub?.billing_cycle === "yearly" ? (currentPrice / 12) : currentPrice;
    const newPrice = amountForPlan(plan, cycle);
    const newMonthlyPrice = cycle === "yearly" ? (newPrice / 12) : newPrice;

    const changeType = !currentSub
        ? "purchase"
        : samePlanRenewal
            ? "renewal"
            : newMonthlyPrice >= currentMonthlyPrice
                ? "upgrade"
                : "downgrade";

    const [subResult] = await connection.query(
        `INSERT INTO subscriptions
        (school_id, plan_id, plan, price, start_date, end_date, status, payment_status, billing_cycle, renewed_from_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, NOW(), NOW())`,
        [schoolId, plan.id, plan.plan_key || plan.name, planAmount, toSqlDate(startDate), toSqlDate(endDate), newSubscriptionStatus, cycle, currentSub?.id || null]
    );

    const subscriptionId = subResult.insertId;
    const paymentReference = razorpayPaymentId || payment.payment_reference || payment.razorpay_order_id || payment.transaction_id;

    if (!startsInFuture) {
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
    };

    const [paymentUpdate] = await connection.query(
        `UPDATE subscription_payments
        SET status = 'completed',
            subscription_id = ?,
            transaction_id = ?,
            razorpay_payment_id = COALESCE(?, razorpay_payment_id),
            razorpay_signature = COALESCE(?, razorpay_signature),
            payment_status = 'success',
            payment_reference = ?,
            billing_cycle = ?,
            paid_at = NOW(),
            updated_at = NOW()
        WHERE id = ? AND status IN ('pending', 'failed')`,
        [subscriptionId, paymentReference, razorpayPaymentId, razorpaySignature, paymentReference, cycle, payment.id]
    );
    if (paymentUpdate.affectedRows !== 1) {
        throw new Error("Subscription payment status changed while it was being completed.");
    };
    // console.log("[Dev Log] Subscription payment marked completed/paid. Payment ID:", payment.id, "School ID:", schoolId);

    await connection.query(
        `INSERT INTO subscription_history
        (school_id, old_plan_id, old_plan_name, new_plan_id, new_plan_name, change_type, billing_cycle, amount_paid, payment_ref, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [ schoolId, currentSub?.plan_id || null, currentSub?.plan || null, plan.id, plan.name, changeType, cycle, planAmount, paymentReference]
    );

    return {
        subscriptionId,
        changeType,
        schoolId,
        paymentId: payment.id,
        planName: plan.name,
        startDate: toSqlDate(startDate),
        startsInFuture,
        alreadyProcessed: false
    };
};

async function verifyPayment({ schoolId, orderId, paymentId, signature, planId, billingCycle }) {
    if (!orderId || !paymentId || !signature) {
        return { success: false, statusCode: 400, message: "Missing payment verification details." };
    };
    if (!verifyRazorpaySignature(orderId, paymentId, signature)) {
        return { success: false, statusCode: 400, message: "Payment verification failed." };
    };

    const preliminaryPayment = await findPaymentByOrder(db, schoolId, orderId, false);
    if (!preliminaryPayment) {
        return { success: false, statusCode: 404, message: "Pending payment record not found." };
    };
    if (preliminaryPayment.status === "completed") {
        if (preliminaryPayment.razorpay_payment_id && preliminaryPayment.razorpay_payment_id !== paymentId) {
            return { success: false, statusCode: 409, message: "Payment identity mismatch." };
        };
        return {
            success: true,
            message: "Payment already processed.",
            redirect: "/schooladmin/dashboard"
        };
    };

    const providerPayment = await fetchCapturedPayment({
        paymentId,
        orderId,
        amount: preliminaryPayment.total_amount,
        currency: preliminaryPayment.currency || "INR"
    });

    let connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        await connection.query("SELECT id FROM schools WHERE id = ? LIMIT 1 FOR UPDATE", [schoolId]);
        const payment = await findPaymentByOrder(connection, schoolId, orderId, true);
        if (!payment) {
            await connection.rollback();
            return { success: false, statusCode: 404, message: "Pending payment record not found." };
        };

        if (payment.status === "completed") {
            if (payment.razorpay_payment_id && payment.razorpay_payment_id !== paymentId) {
                await connection.rollback();
                return { success: false, statusCode: 409, message: "Payment identity mismatch." };
            };
            await connection.commit();
            return {
                success: true,
                message: "Payment already processed.",
                redirect: "/schooladmin/dashboard"
            };
        };

        assertCapturedPayment(providerPayment, {
            paymentId,
            orderId,
            amount: payment.total_amount,
            currency: payment.currency || "INR"
        });

        const pendingPlanId = Number(getPaymentPlanId(payment));
        if (Number(planId || pendingPlanId) !== pendingPlanId) {
            await connection.rollback();
            return { success: false, statusCode: 400, message: "Payment plan mismatch." };
        };

        const storedCycle = getPaymentCycle(payment);
        const requestedCycle = billingCycle === undefined || billingCycle === null || billingCycle === ""
            ? storedCycle
            : normalizeBillingCycle(billingCycle);
        if (!storedCycle || !requestedCycle || requestedCycle !== storedCycle) {
            await connection.rollback();
            return { success: false, statusCode: 400, message: "Payment billing cycle mismatch." };
        };

        const [[plan]] = await connection.query("SELECT * FROM plans WHERE id = ? LIMIT 1", [pendingPlanId]);
        if (!plan) {
            await connection.rollback();
            return { success: false, statusCode: 404, message: "Plan not found." };
        };

        const activation = await activateSubscription(connection, {
            payment,
            plan,
            billingCycle: storedCycle,
            razorpayPaymentId: paymentId,
            razorpaySignature: signature
        });

        await connection.commit();
        const committedConnection = connection;
        connection = null;
        committedConnection.release();
        await runActivationSideEffects(activation);
        return {
            success: true,
            message: activation.startsInFuture
                ? `Payment successful. Your plan will start on ${activation.startDate}.`
                : "Payment successful. Your plan is now active.",
            redirect: "/schooladmin/dashboard"
        };
    } catch (err) {
        if (connection) await connection.rollback();
        throw err;
    } finally {
        if (connection) connection.release();
    };
};

async function markPaymentFailed({ schoolId, orderId, reason, paymentId = null }) {
    let connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        await connection.query("SELECT id FROM schools WHERE id = ? LIMIT 1 FOR UPDATE", [schoolId]);
        const payment = orderId ? await findPaymentByOrder(connection, schoolId, orderId, true) : null;
        if (!payment) {
            await connection.commit();
            return { success: true, message: "Payment failure recorded." };
        };
        if (payment.status === "completed") {
            await connection.commit();
            return { success: true, message: "Payment was already completed." };
        };
        if (payment.status === "failed") {
            await connection.commit();
            return { success: true, message: "Payment failure was already recorded." };
        };

        await connection.query(
            `UPDATE subscription_payments
            SET status = 'failed',
                razorpay_payment_id = COALESCE(?, razorpay_payment_id),
                failure_reason = ?,
                payment_status = 'failed',
                payment_note = ?,
                notes = CONCAT(COALESCE(notes, ''), ?),
                updated_at = NOW()
            WHERE id = ? AND status = 'pending'`,
            [paymentId, reason || "Payment failed", reason || "Payment failed", `\nFailure: ${reason || "Payment failed"}`, payment.id]
        );

        await connection.commit();
        const committedConnection = connection;
        connection = null;
        committedConnection.release();
        await notifySchoolAdmins(schoolId, {
            paymentId: payment.id,
            title: "Payment failed",
            message: "Payment failed. Please try again or contact support.",
            type: "error"
        });
        return { success: true, message: "Payment failed. Please try again or contact support." };
    } catch (err) {
        if (connection) await connection.rollback();
        throw err;
    } finally {
        if (connection) connection.release();
    };
};

async function markPaymentFailedByOrder({ orderId, reason, paymentId = null }) {
    if (!orderId) {
        return { success: true, message: "Payment failure recorded." };
    };

    let connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const initialPayment = await findPaymentByOrderAnySchool(connection, orderId, false);
        if (!initialPayment) {
            await connection.commit();
            return { success: true, message: "Payment failure recorded." };
        };
        await connection.query("SELECT id FROM schools WHERE id = ? LIMIT 1 FOR UPDATE", [initialPayment.school_id]);
        const payment = await findPaymentByOrderAnySchool(connection, orderId, true);

        if (!payment || payment.status === "completed") {
            await connection.commit();
            return { success: true, message: "Payment failure recorded." };
        };
        if (payment.status === "failed") {
            await connection.commit();
            return { success: true, message: "Payment failure was already recorded." };
        };

        await connection.query(
            `UPDATE subscription_payments
            SET status = 'failed',
                razorpay_payment_id = COALESCE(?, razorpay_payment_id),
                failure_reason = ?,
                payment_status = 'failed',
                payment_note = ?,
                notes = CONCAT(COALESCE(notes, ''), ?),
                updated_at = NOW()
            WHERE id = ? AND status = 'pending'`,
            [paymentId, reason || "Payment failed", reason || "Payment failed", `\nFailure: ${reason || "Payment failed"}`, payment.id]
        );

        await connection.commit();
        const committedConnection = connection;
        connection = null;
        committedConnection.release();
        await notifySchoolAdmins(payment.school_id, {
            paymentId: payment.id,
            title: "Payment failed",
            message: "Payment failed. Please try again or contact support.",
            type: "error"
        });
        return { success: true, message: "Payment failed. Please try again or contact support." };
    } catch (err) {
        if (connection) await connection.rollback();
        throw err;
    } finally {
        if (connection) connection.release();
    };
};

async function handleCapturedWebhook(orderId, paymentId, signature = null, paymentEntity = null) {
    let connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const initialPayment = await findPaymentByOrderAnySchool(connection, orderId, false);
        if (!initialPayment) {
            await connection.commit();
            return { success: true, ignored: true };
        };
        await connection.query("SELECT id FROM schools WHERE id = ? LIMIT 1 FOR UPDATE", [initialPayment.school_id]);
        const payment = await findPaymentByOrderAnySchool(connection, orderId, true);
        if (!payment) {
            await connection.commit();
            return { success: true, ignored: true };
        };
        assertCapturedPayment(paymentEntity, {
            paymentId,
            orderId,
            amount: payment.total_amount,
            currency: payment.currency || "INR"
        });
        if (payment.status === "completed") {
            if (payment.razorpay_payment_id && payment.razorpay_payment_id !== paymentId) {
                throw new Error("Completed payment is linked to a different Razorpay payment ID.");
            };
            if (!payment.razorpay_payment_id) {
                await connection.query(
                    `UPDATE subscription_payments
                    SET razorpay_payment_id = ?, razorpay_signature = COALESCE(?, razorpay_signature), updated_at = NOW()
                    WHERE id = ? AND razorpay_payment_id IS NULL`,
                    [paymentId, signature, payment.id]
                );
            };
            await connection.commit();
            return { success: true, alreadyProcessed: true };
        };

        const planId = getPaymentPlanId(payment);
        const [[plan]] = await connection.query("SELECT * FROM plans WHERE id = ? LIMIT 1", [planId]);
        if (!plan) {
            throw new Error("Plan not found for webhook payment.");
        };

        const activation = await activateSubscription(connection, {
            payment,
            plan,
            billingCycle: getPaymentCycle(payment),
            razorpayPaymentId: paymentId,
            razorpaySignature: signature
        });
        await connection.commit();
        const committedConnection = connection;
        connection = null;
        committedConnection.release();
        await runActivationSideEffects(activation);
        return { success: true };
    } catch (err) {
        if (connection) await connection.rollback();
        throw err;
    } finally {
        if (connection) connection.release();
    };
};

async function handlePaidOrderWebhook(orderId, signature = null, orderEntity = null) {
    if (!orderId) return { success: true };

    let connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const initialPayment = await findPaymentByOrderAnySchool(connection, orderId, false);
        if (!initialPayment) {
            await connection.commit();
            return { success: true, ignored: true };
        };
        await connection.query("SELECT id FROM schools WHERE id = ? LIMIT 1 FOR UPDATE", [initialPayment.school_id]);
        const payment = await findPaymentByOrderAnySchool(connection, orderId, true);
        if (!payment || payment.status === "completed") {
            await connection.commit();
            return { success: true, alreadyProcessed: true };
        };
        assertPaidOrder(orderEntity, {
            orderId,
            amount: payment.total_amount,
            currency: payment.currency || "INR"
        });

        const planId = getPaymentPlanId(payment);
        const [[plan]] = await connection.query("SELECT * FROM plans WHERE id = ? LIMIT 1", [planId]);
        if (!plan) {
            throw new Error("Plan not found for webhook order.");
        };

        const activation = await activateSubscription(connection, {
            payment,
            plan,
            billingCycle: getPaymentCycle(payment),
            razorpayPaymentId: payment.razorpay_payment_id || null,
            razorpaySignature: signature
        });
        await connection.commit();
        const committedConnection = connection;
        connection = null;
        committedConnection.release();
        await runActivationSideEffects(activation);
        return { success: true };
    } catch (err) {
        if (connection) await connection.rollback();
        throw err;
    } finally {
        if (connection) connection.release();
    };
};

module.exports = {
    PAYMENT_CONFIG_ERROR,
    createOrder,
    verifyPayment,
    markPaymentFailed,
    markPaymentFailedByOrder,
    verifyWebhookSignature,
    handleCapturedWebhook,
    handlePaidOrderWebhook,
    normalizeBillingCycle,
    _test: Object.freeze({
        activateSubscription,
        findPaymentByOrder,
        findPaymentByOrderAnySchool,
        getPaymentCycle,
        getPaymentPlanId,
        orderReceipt,
        receiptNo,
        runActivationSideEffects,
        verifyRazorpaySignature
    })
};
