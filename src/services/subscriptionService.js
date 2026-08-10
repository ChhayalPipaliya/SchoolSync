const db = require("../config/database");
const NotificationService = require("./notificationService");

const FULL_ACCESS_FEATURES = [
    "dashboard", "students", "teachers", "classes", "subjects", "attendance", "fees",
    "exams", "homework", "timetable", "time_table", "class_timetable", "weekly_timetable",
    "schedule", "weekly_schedule", "library", "transport", "hostel", "payroll",
    "salary", "certificates", "reports", "parent_portal", "student_portal",
    "messaging", "support_tickets", "settings", "analytics", "notices", "events",
    "admissions", "meetings", "leaves", "portal", "ai_assistant"
];

const TRIAL_ALREADY_USED_MESSAGE = "Trial plan has already been used for this school.";
const REMINDER_MESSAGES = {
    trial_2_days_left: "Your free demo will expire in 2 days. Choose a plan to continue using SchoolSync.",
    trial_1_day_left: "Your free demo will expire tomorrow. Please select a plan.",
    trial_expired: "Your 7-day full access demo has expired. Please choose a subscription plan to continue using SchoolSync.",
    subscription_expired: "Your subscription has expired. Please choose a subscription plan to continue using SchoolSync."
};

const toDate = (value) => value ? new Date(value) : null;
const endOfDayBoundary = (value) => {
    const date = toDate(value);
    if (!date) return null;
    if (date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0) {
        date.setHours(23, 59, 59, 999);
    };
    return date;
};

const hasNotEnded = (value, now = new Date()) => {
    const end = endOfDayBoundary(value);
    return Boolean(end && end >= now);
};

const isFiniteLimit = (value) => value !== null && value !== undefined && Number(value) > 0;
const daysUntil = (dateValue) => {
    const end = endOfDayBoundary(dateValue);
    if (!end) return 0;
    const now = new Date();
    if (now > end) return 0;
    return Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
};

const normalizeFeatureKey = (value) => String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

function isTrialPlan(plan) {
    if (!plan) return false;
    return [plan.plan_key, plan.slug, plan.name, plan.plan]
        .map(normalizeFeatureKey)
        .some((key) => key === "trial" || key === "free_trial" || key === "demo");
};

function hasSchoolUsedTrial(school) {
    if (!school) return false;
    return Number(school.trial_used || 0) === 1 || Number(school.is_trial_used || 0) === 1 || Boolean(school.trial_started_at) || Boolean(school.trial_ends_at);
};

async function hasSchoolEverUsedTrial(schoolId, school = null) {
    if (hasSchoolUsedTrial(school)) return true;
    if (!schoolId) return false;

    const rows = await db.queryAsync(
        `SELECT sub.id
        FROM subscriptions sub
        LEFT JOIN plans p ON p.id = sub.plan_id
        WHERE sub.school_id = ?
            AND (
                sub.status = 'trial'
                OR sub.trial_start_date IS NOT NULL
                OR sub.trial_end_date IS NOT NULL
                OR LOWER(COALESCE(sub.plan, '')) = 'trial'
                OR LOWER(COALESCE(p.plan_key, '')) = 'trial'
                OR LOWER(COALESCE(p.slug, '')) = 'trial'
            )
        LIMIT 1`,
        [schoolId]
    );
    return rows.length > 0;
};

async function getTrialPlanId() {
    const rows = await db.queryAsync(
        `SELECT id FROM plans
        WHERE COALESCE(is_active, 1) = 1
            AND COALESCE(status, 'active') = 'active'
            AND (
                LOWER(COALESCE(plan_key, '')) = 'trial'
                OR LOWER(COALESCE(slug, '')) = 'trial'
                OR LOWER(COALESCE(name, '')) = 'trial'
            )
        ORDER BY id ASC
        LIMIT 1`
    ).catch(() => []);
    return rows[0]?.id || null;
};

function featureAliases(key) {
    const aliases = {
        students: ["students", "student", "student_management"],
        teachers: ["teachers", "teacher", "teacher_management", "staff", "staff_management"],
        classes: ["classes", "class", "class_management", "class_and_subject_management"],
        subjects: ["subjects", "subject", "subject_management", "class_and_subject_management"],
        fees: ["fees", "fee", "fee_management", "fees_structure_collections", "fees_basic", "fee_structure_management"],
        exams: ["exams", "exam", "exams_grading_system", "marks", "report_cards", "marks_and_exams"],
        attendance: ["attendance", "attendance_management", "attendance_monitoring"],
        payroll: ["salary", "payroll"],
        salary: ["salary", "payroll"],
        driver: ["transport", "driver", "transport_drivers_management"],
        drivers: ["transport", "driver", "transport_drivers_management"],
        library: ["library", "librarian", "library_module", "library_management"],
        transport: ["transport", "driver", "transport_drivers_management", "transport_management", "driver_panel", "parent_live_bus_tracking"],
        reports: ["reports", "analytics", "basic_reports", "advanced_reports", "advanced_analytics"],
        analytics: ["reports", "analytics", "advanced_reports", "advanced_analytics"],
        homework: ["homework", "homework_management"],
        meetings: ["meetings", "meeting_management", "online_meetings"],
        messaging: ["messages", "chat", "messaging", "role_based_chat_permissions"],
        notices: ["notices", "notice_board", "announcements"],
        parent_portal: ["parent_portal", "parent"],
        student_portal: ["student_portal", "student"],
        timetable: ["timetable", "time_table", "class_timetable", "weekly_timetable", "schedule", "weekly_schedule"],
        time_table: ["timetable", "time_table", "class_timetable", "weekly_timetable", "schedule", "weekly_schedule"],
        class_timetable: ["timetable", "time_table", "class_timetable", "weekly_timetable", "schedule", "weekly_schedule"],
        weekly_timetable: ["timetable", "time_table", "class_timetable", "weekly_timetable", "schedule", "weekly_schedule"],
        schedule: ["timetable", "time_table", "class_timetable", "weekly_timetable", "schedule", "weekly_schedule"],
        weekly_schedule: ["timetable", "time_table", "class_timetable", "weekly_timetable", "schedule", "weekly_schedule"],
        settings: ["settings"],
        certificates: ["certificates", "certificate", "certificate_generator", "student_certificates"],
        ai_assistant: ["ai_assistant"],
    };
    return aliases[key] || [key];
};

function parsePlanFeatures(plan, featureRows = []) {
    const keys = new Set();
    const add = (value) => {
        const normalized = normalizeFeatureKey(value);
        if (normalized) keys.add(normalized);
    };

    if (plan?.features) {
        try {
            const parsed = typeof plan.features === "string" ? JSON.parse(plan.features) : plan.features;
            if (Array.isArray(parsed)) parsed.forEach(add);
            else if (parsed && typeof parsed === "object") {
                Object.entries(parsed)
                    .filter(([, enabled]) => enabled === true || enabled === "true" || enabled === "on" || enabled === 1)
                    .forEach(([key]) => add(key));
            };
        } catch (err) {
            String(plan.features).split(",").forEach(add);
        };
    };
    featureRows.forEach((row) => add(row.feature_key || row.feature_name || row.name));
    return Array.from(keys);
};

async function getPublicPlans() {
    const plans = await db.queryAsync(`
    SELECT p.*,
        COALESCE(p.student_limit, p.max_students) AS display_student_limit,
        COALESCE(p.teacher_limit, p.max_teachers) AS display_teacher_limit
    FROM plans p
    WHERE COALESCE(p.is_active, 1) = 1
        AND COALESCE(p.status, 'active') = 'active'
        AND LOWER(COALESCE(p.plan_key, p.slug, p.name, '')) IN ('basic', 'standard', 'premium')
        AND LOWER(COALESCE(p.plan_key, '')) NOT IN ('starter', 'professional', 'enterprise', 'basic_monthly', 'standard_monthly', 'premium_monthly')
        AND LOWER(COALESCE(p.slug, '')) NOT IN ('starter', 'professional', 'enterprise', 'basic-monthly', 'standard-monthly', 'premium-monthly')
        AND LOWER(COALESCE(p.name, '')) NOT IN ('starter', 'professional', 'enterprise')
    ORDER BY COALESCE(p.display_order, 999), COALESCE(p.monthly_price, 0), p.id
  `).catch(async (err) => {
        if (err.code !== "ER_BAD_FIELD_ERROR") throw err;
        return db.queryAsync(`
            SELECT * FROM plans
            WHERE is_active = 1
                AND LOWER(COALESCE(plan_key, slug, name, '')) IN ('basic', 'standard', 'premium')
            ORDER BY monthly_price ASC
        `);
    });

    for (const plan of plans) {
        const featureRows = await db.queryAsync(
            "SELECT * FROM subscription_plan_features WHERE plan_id = ? ORDER BY id",
            [plan.id]
        ).catch(() => []);
        plan.featuresList = parsePlanFeatures(plan, featureRows);
    };
    return plans;
};

async function getSubscriptionState(schoolId, options = {}) {
    if (!schoolId) {
        return {
            isTrialActive: false,
            isTrialExpired: false,
            trialDaysLeft: 0,
            isSubscriptionActive: false,
            isSubscriptionExpired: false,
            subscriptionLocked: false,
            currentPlan: null,
            enabledFeatures: [],
            isFullDemoAccess: false,
            hasFeature: () => true
        };
    };

    let [[school]] = await db.query("SELECT * FROM schools WHERE id = ? LIMIT 1", [schoolId]);
    if (!school) throw new Error("School not found.");

    const activePaidRows = await db.queryAsync(
        "SELECT id FROM subscriptions WHERE school_id = ? AND status = 'active' AND end_date >= CURDATE() ORDER BY end_date DESC, id DESC LIMIT 1",
        [schoolId]
    ).catch(() => []);

    const existingStatus = school.subscription_status || school.status || "trial";
    const existingSubscriptionEndsAt = school.subscription_ends_at || school.subscription_end;
    const existingSchoolPaidActive = existingStatus === "active" && hasNotEnded(existingSubscriptionEndsAt);
    const trialAlreadyUsed = await hasSchoolEverUsedTrial(schoolId, school);

    if (
        !school.trial_started_at &&
        !trialAlreadyUsed &&
        !activePaidRows.length &&
        !existingSchoolPaidActive &&
        !["expired", "cancelled"].includes(existingStatus)
    ) {
        const trialPlanId = await getTrialPlanId();
        if (!trialPlanId) {
            throw new Error("Trial plan is not configured.");
        };
        const updateResult = await db.executeAsync(
            `UPDATE schools
            SET trial_started_at = NOW(),
                trial_ends_at = DATE_ADD(NOW(), INTERVAL 7 DAY),
                subscription_status = 'trial',
                status = 'trial',
                plan_id = ?,
                current_plan_id = ?,
                plan = 'trial',
                subscription_started_at = NULL,
                subscription_ends_at = NULL,
                subscription_start = NULL,
                subscription_end = DATE_ADD(NOW(), INTERVAL 7 DAY),
                trial_used = 1,
                is_trial_used = 1,
                updated_at = NOW()
            WHERE id = ?
                AND trial_started_at IS NULL
                AND trial_ends_at IS NULL
                AND COALESCE(trial_used, 0) = 0
                AND COALESCE(is_trial_used, 0) = 0
                AND NOT EXISTS (
                    SELECT 1
                    FROM subscriptions sub
                    LEFT JOIN plans p ON p.id = sub.plan_id
                    WHERE sub.school_id = schools.id
                        AND (
                            sub.status = 'trial'
                            OR sub.trial_start_date IS NOT NULL
                            OR sub.trial_end_date IS NOT NULL
                            OR LOWER(COALESCE(sub.plan, '')) = 'trial'
                            OR LOWER(COALESCE(p.plan_key, '')) = 'trial'
                            OR LOWER(COALESCE(p.slug, '')) = 'trial'
                        )
                )`,
            [trialPlanId, trialPlanId, schoolId]
        );
        if (updateResult.affectedRows === 1) {
            school.trial_started_at = new Date();
            school.trial_ends_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            school.subscription_status = "trial";
            school.status = "trial";
            school.plan_id = trialPlanId;
            school.current_plan_id = trialPlanId;
            school.plan = "trial";
            school.trial_used = 1;
            school.is_trial_used = 1;
        } else {
            [[school]] = await db.query("SELECT * FROM schools WHERE id = ? LIMIT 1", [schoolId]);
            if (!school) throw new Error("School not found.");
        };
    }

    const status = school.subscription_status || school.status || "trial";
    const trialEndsAt = school.trial_ends_at || school.subscription_end || school.subscription_ends_at;
    const subscriptionEndsAt = school.subscription_ends_at || school.subscription_end;
    const now = new Date();
    const isTrialActive = status === "trial" && hasNotEnded(trialEndsAt, now);
    const isTrialExpired = status === "trial" && trialEndsAt && !hasNotEnded(trialEndsAt, now);
    const isSubscriptionActive = status === "active" && hasNotEnded(subscriptionEndsAt, now);
    const isSubscriptionExpired = status === "active" && subscriptionEndsAt && !hasNotEnded(subscriptionEndsAt, now);
    const shouldExpire = isTrialExpired || isSubscriptionExpired || status === "expired";

    if ((isTrialExpired || isSubscriptionExpired) && status !== "expired") {
        await db.executeAsync(
            `UPDATE schools
            SET subscription_status = 'expired',
                status = 'expired',
                trial_used = GREATEST(COALESCE(trial_used, 0), COALESCE(is_trial_used, 0)),
                is_trial_used = GREATEST(COALESCE(is_trial_used, 0), COALESCE(trial_used, 0)),
                updated_at = NOW()
            WHERE id = ?`,
            [schoolId]
        );
        await db.executeAsync(
            `UPDATE subscriptions
            SET status = 'expired', updated_at = NOW()
            WHERE school_id = ?
                AND status IN ('active', 'trial')
                AND end_date < CURDATE()`,
            [schoolId]
        );
    };

    const planId = school.current_plan_id || school.plan_id;
    let currentPlan = null;
    let enabledFeatures = [];
    if (planId) {
        const [[plan]] = await db.query("SELECT * FROM plans WHERE id = ? LIMIT 1", [planId]).catch(() => [[]]);
        if (plan) {
            const [featureRows] = await db.query(
                "SELECT * FROM subscription_plan_features WHERE plan_id = ? ORDER BY id",
                [plan.id]
            ).catch(() => [[]]);
            currentPlan = {
                ...plan,
                max_students: plan.max_students ?? plan.student_limit,
                max_teachers: plan.max_teachers ?? plan.teacher_limit
            };
            enabledFeatures = parsePlanFeatures(plan, featureRows);
        };
    };

    const noActiveAccess = !isTrialActive && !isSubscriptionActive && (
        !status || ["inactive", "pending", "expired", "cancelled", "no_plan"].includes(String(status).toLowerCase()) || !school.current_plan_id
    );

    const shouldLock = isTrialExpired || isSubscriptionExpired || status === "expired" || noActiveAccess;
    const isFullDemoAccess = Boolean(isTrialActive);
    const subscriptionLocked = Boolean(shouldLock && !isSubscriptionActive && !isTrialActive);
    const state = {
        school,
        isTrialActive,
        isTrialExpired: Boolean(isTrialExpired || (status === "expired" && !isSubscriptionActive)),
        trialDaysLeft: isTrialActive ? daysUntil(trialEndsAt) : 0,
        isSubscriptionActive,
        isSubscriptionExpired: Boolean(isSubscriptionExpired || (status === "expired" && !isSubscriptionActive)),
        subscriptionLocked,
        currentPlan,
        enabledFeatures: isFullDemoAccess ? FULL_ACCESS_FEATURES : enabledFeatures,
        isFullDemoAccess,
        status: subscriptionLocked ? "locked" : (shouldExpire ? "expired" : status)
    };

    state.hasFeature = (featureKey) => {
        if (state.isFullDemoAccess) return true;
        if (state.subscriptionLocked) return featureKey === "dashboard";
        const allowed = new Set(state.enabledFeatures);
        return featureAliases(normalizeFeatureKey(featureKey)).some((key) => allowed.has(key));
    };

    if (options.createReminders) {
        await createDueReminders(schoolId, options.userId, state);
    };
    return state;
};

async function logReminderOnce(schoolId, subscriptionId, reminderType, userId, message) {
    const rows = await db.queryAsync(
        `SELECT id FROM subscription_reminder_logs
        WHERE school_id = ? AND COALESCE(subscription_id, 0) = COALESCE(?, 0) AND reminder_type = ?
        LIMIT 1`,
        [schoolId, subscriptionId || null, reminderType]
    ).catch(() => []);

    if (rows.length) return false;

    await db.executeAsync(
        "INSERT INTO subscription_reminder_logs (school_id, subscription_id, reminder_type, sent_at) VALUES (?, ?, ?, NOW())",
        [schoolId, subscriptionId || null, reminderType]
    ).catch(() => { });

    if (userId) {
        await NotificationService.createAndSend({
            recipient_id: userId,
            recipient_role: "school_admin",
            school_id: schoolId,
            title: reminderType.includes("expired") ? "Subscription Required" : "Demo Reminder",
            message,
            type: "warning",
            category: "subscription",
            action_url: "/schooladmin/subscription"
        }).catch((err) => console.error("[SubscriptionReminder] notification failed:", err.message));
    };
    return true;
};

async function createDueReminders(schoolId, userId, state) {
    const [[subscription]] = await db.query(
        "SELECT id FROM subscriptions WHERE school_id = ? ORDER BY created_at DESC LIMIT 1",
        [schoolId]
    ).catch(() => [[null]]);
    const subscriptionId = subscription?.id || null;

    if (state.isTrialActive && state.trialDaysLeft === 2) {
        await logReminderOnce(schoolId, subscriptionId, "trial_2_days_left", userId, REMINDER_MESSAGES.trial_2_days_left);
    };
    if (state.isTrialActive && state.trialDaysLeft === 1) {
        await logReminderOnce(schoolId, subscriptionId, "trial_1_day_left", userId, REMINDER_MESSAGES.trial_1_day_left);
    };
    if (state.isTrialExpired || state.subscriptionLocked) {
        const type = state.status === "expired" && state.school?.subscription_status === "active"
            ? "subscription_expired"
            : "trial_expired";
        await logReminderOnce(schoolId, subscriptionId, type, userId, REMINDER_MESSAGES[type]);
    };
};

function isUnlimitedLimit(value) {
    return value === null || value === undefined || Number(value) <= 0;
};

module.exports = { FULL_ACCESS_FEATURES, REMINDER_MESSAGES, TRIAL_ALREADY_USED_MESSAGE, getPublicPlans, getSubscriptionState, createDueReminders, isFiniteLimit, isUnlimitedLimit, normalizeFeatureKey, featureAliases, parsePlanFeatures, isTrialPlan, hasSchoolUsedTrial, hasSchoolEverUsedTrial };