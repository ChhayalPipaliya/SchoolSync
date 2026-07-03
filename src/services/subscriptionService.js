const db = require("../config/database");
const NotificationService = require("./notificationService");

const FULL_ACCESS_FEATURES = [
  "dashboard", "students", "teachers", "classes", "subjects", "attendance", "fees",
  "exams", "homework", "timetable", "library", "transport", "hostel", "payroll",
  "salary", "certificates", "reports", "parent_portal", "student_portal",
  "messaging", "support_tickets", "settings", "analytics", "notices", "events",
  "admissions", "meetings", "leaves", "portal"
];

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
  // MySQL DATE values are commonly returned at 00:00:00. Treat those as valid until day end.
  if (date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0) {
    date.setHours(23, 59, 59, 999);
  }
  return date;
};

const hasNotEnded = (value, now = new Date()) => {
  const end = endOfDayBoundary(value);
  return Boolean(end && end >= now);
};

const isFiniteLimit = (value) => value !== null && value !== undefined && Number(value) > 0;

const daysUntil = (dateValue) => {
  const end = toDate(dateValue);
  if (!end) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDay = new Date(end);
  endDay.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((endDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
};

const normalizeFeatureKey = (value) => String(value || "")
  .trim()
  .toLowerCase()
  .replace(/&/g, "and")
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");

function featureAliases(key) {
  const aliases = {
    students: ["students", "student", "student_management"],
    teachers: ["teachers", "teacher", "teacher_management", "staff", "staff_management"],
    classes: ["classes", "class", "class_management"],
    subjects: ["subjects", "subject", "subject_management"],
    fees: ["fees", "fee", "fee_management", "fees_structure_collections", "fees_basic"],
    exams: ["exams", "exam", "exams_grading_system", "marks", "report_cards"],
    attendance: ["attendance", "attendance_monitoring"],
    payroll: ["salary", "payroll"],
    salary: ["salary", "payroll"],
    driver: ["transport", "driver", "transport_drivers_management"],
    drivers: ["transport", "driver", "transport_drivers_management"],
    library: ["library", "librarian", "library_module"],
    transport: ["transport", "driver", "transport_drivers_management"],
    reports: ["reports", "analytics", "basic_reports", "advanced_reports"],
    analytics: ["reports", "analytics", "advanced_reports"],
    messaging: ["messages", "chat", "messaging"],
    notices: ["notices", "announcements"],
    parent_portal: ["parent_portal", "parent"],
    student_portal: ["student_portal", "student"],
    timetable: ["timetable", "schedule"]
  };
  return aliases[key] || [key];
}

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
      }
    } catch (err) {
      String(plan.features).split(",").forEach(add);
    }
  }

  featureRows.forEach((row) => add(row.feature_key || row.feature_name || row.name));
  return Array.from(keys);
}

async function getPublicPlans() {
  const plans = await db.queryAsync(`
    SELECT p.*,
      COALESCE(p.student_limit, p.max_students) AS display_student_limit,
      COALESCE(p.teacher_limit, p.max_teachers) AS display_teacher_limit
    FROM plans p
    WHERE COALESCE(p.is_active, 1) = 1
      AND COALESCE(p.status, 'active') = 'active'
      AND COALESCE(p.is_public, 1) = 1
      AND LOWER(COALESCE(p.plan_key, p.slug, p.name, '')) IN ('basic', 'standard', 'premium')
      AND LOWER(COALESCE(p.plan_key, '')) NOT IN ('starter', 'professional', 'enterprise', 'basic_monthly', 'standard_monthly', 'premium_monthly')
      AND LOWER(COALESCE(p.slug, '')) NOT IN ('starter', 'professional', 'enterprise', 'basic-monthly', 'standard-monthly', 'premium-monthly')
      AND LOWER(COALESCE(p.name, '')) NOT IN ('starter', 'professional', 'enterprise')
    ORDER BY COALESCE(p.sort_order, 999), COALESCE(p.monthly_price, 0), p.id
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
  }

  return plans;
}

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
  }

  const [[school]] = await db.query("SELECT * FROM schools WHERE id = ? LIMIT 1", [schoolId]);
  if (!school) throw new Error("School not found.");

  const activePaidRows = await db.queryAsync(
    "SELECT id FROM subscriptions WHERE school_id = ? AND status = 'active' AND end_date >= CURDATE() LIMIT 1",
    [schoolId]
  ).catch(() => []);

  const existingStatus = school.subscription_status || school.status || "trial";
  const existingSubscriptionEndsAt = school.subscription_ends_at || school.subscription_end;
  const existingSchoolPaidActive = existingStatus === "active" && hasNotEnded(existingSubscriptionEndsAt);
  const trialAlreadyUsed = Number(school.is_trial_used || 0) === 1;

  // Legacy safety bootstrap:
  // Only old schools that have never used a trial should be auto-started on a 7-day demo.
  // Direct-paid pending/expired schools have is_trial_used = 1 and must stay locked.
  if (
    !school.trial_started_at &&
    !trialAlreadyUsed &&
    !activePaidRows.length &&
    !existingSchoolPaidActive &&
    !["expired", "cancelled"].includes(existingStatus)
  ) {
    await db.query(
      `UPDATE schools
       SET trial_started_at = NOW(),
           trial_ends_at = DATE_ADD(NOW(), INTERVAL 7 DAY),
           subscription_status = 'trial',
           status = 'trial',
           current_plan_id = NULL,
           subscription_started_at = NULL,
           subscription_ends_at = NULL,
           subscription_start = NULL,
           subscription_end = DATE_ADD(NOW(), INTERVAL 7 DAY),
           is_trial_used = 1,
           updated_at = NOW()
       WHERE id = ?`,
      [schoolId]
    ).catch(() => {});
    school.trial_started_at = new Date();
    school.trial_ends_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    school.subscription_status = "trial";
    school.status = "trial";
    school.is_trial_used = 1;
  }

  const status = school.subscription_status || school.status || "trial";
  const trialEndsAt = school.trial_ends_at;
  const subscriptionEndsAt = school.subscription_ends_at || school.subscription_end;
  const now = new Date();
  const isTrialActive = status === "trial" && hasNotEnded(trialEndsAt, now);
  const isTrialExpired = status === "trial" && trialEndsAt && !hasNotEnded(trialEndsAt, now);
  const isSubscriptionActive = status === "active" && hasNotEnded(subscriptionEndsAt, now);
  const isSubscriptionExpired = status === "active" && subscriptionEndsAt && !hasNotEnded(subscriptionEndsAt, now);
  // Determine if trial/subscription have expired or are explicitly marked expired
  const shouldExpire = isTrialExpired || isSubscriptionExpired || status === "expired";

  if ((isTrialExpired || isSubscriptionExpired) && status !== "expired") {
    await db.query(
      "UPDATE schools SET subscription_status = 'expired', status = 'expired', updated_at = NOW() WHERE id = ?",
      [schoolId]
    ).catch(() => {});
  }

  const planId = school.current_plan_id || school.plan_id;
  let currentPlan = null;
  let enabledFeatures = [];
  if (planId) {
    const [[plan]] = await db.query("SELECT * FROM plans WHERE id = ? LIMIT 1", [planId]).catch(() => [[]]);
    if (plan) {
      const featureRows = await db.query(
        "SELECT * FROM subscription_plan_features WHERE plan_id = ? ORDER BY id",
        [plan.id]
      ).catch(() => []);
      currentPlan = {
        ...plan,
        max_students: plan.max_students ?? plan.student_limit,
        max_teachers: plan.max_teachers ?? plan.teacher_limit
      };
      enabledFeatures = parsePlanFeatures(plan, featureRows);
    }
  }

  // Determine if the school has any active access (trial or paid subscription). If not,
  // consider a range of status values as requiring lock (inactive, pending, expired, cancelled, no_plan).
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
    // If locked due to no active access, return status as 'locked' to help UI show appropriate label
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
  }

  return state;
}

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
  ).catch(() => {});

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
  }

  return true;
}

async function createDueReminders(schoolId, userId, state) {
  const [[subscription]] = await db.query(
    "SELECT id FROM subscriptions WHERE school_id = ? ORDER BY created_at DESC LIMIT 1",
    [schoolId]
  ).catch(() => [[null]]);
  const subscriptionId = subscription?.id || null;

  if (state.isTrialActive && state.trialDaysLeft === 2) {
    await logReminderOnce(schoolId, subscriptionId, "trial_2_days_left", userId, REMINDER_MESSAGES.trial_2_days_left);
  }
  if (state.isTrialActive && state.trialDaysLeft === 1) {
    await logReminderOnce(schoolId, subscriptionId, "trial_1_day_left", userId, REMINDER_MESSAGES.trial_1_day_left);
  }
  if (state.isTrialExpired || state.subscriptionLocked) {
    const type = state.status === "expired" && state.school?.subscription_status === "active"
      ? "subscription_expired"
      : "trial_expired";
    await logReminderOnce(schoolId, subscriptionId, type, userId, REMINDER_MESSAGES[type]);
  }
}

function isUnlimitedLimit(value) {
  return value === null || value === undefined || Number(value) <= 0;
}

module.exports = {
  FULL_ACCESS_FEATURES,
  REMINDER_MESSAGES,
  getPublicPlans,
  getSubscriptionState,
  createDueReminders,
  isFiniteLimit,
  isUnlimitedLimit,
  normalizeFeatureKey,
  parsePlanFeatures
};
