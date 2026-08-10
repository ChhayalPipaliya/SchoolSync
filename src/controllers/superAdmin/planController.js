const { queryAsync, executeAsync } = require("../../config/database");
const { logSchoolActivity } = require("../../utils/auditLogger");
const { invalidatePlanCache, invalidateSubscriptionCache } = require("../../utils/planCache");

const SUPPORTED_PLAN_FEATURES = [
    "dashboard", "students", "teachers", "classes", "subjects", "attendance", "fees",
    "exams", "homework", "timetable", "library", "transport", "salary", "certificates",
    "reports", "parent_portal", "student_portal", "messaging", "settings", "analytics",
    "notices", "events", "admissions", "meetings", "leaves", "portal", "ai_assistant"
];

const TIMETABLE_FEATURE_ALIASES = [
    "timetable",
    "time_table",
    "class_timetable",
    "weekly_timetable",
    "schedule",
    "weekly_schedule"
];

const TRIAL_DAYS = 7;

function isTrialPlanInput(planKey, name) {
    const normalizedKey = String(planKey || "").trim().toLowerCase();
    const normalizedName = String(name || "").trim().toLowerCase();
    return normalizedKey === "trial" || normalizedName === "trial";
}

function resolveTrialDays(planKey, name, rawTrialDays) {
    const hasValue = rawTrialDays !== undefined
        && rawTrialDays !== null
        && String(rawTrialDays).trim() !== "";
    const parsed = hasValue ? Number(rawTrialDays) : 0;

    if (hasValue && (!Number.isInteger(parsed) || parsed < 0)) {
        throw new Error("Trial days must be a non-negative whole number.");
    }

    if (isTrialPlanInput(planKey, name)) return TRIAL_DAYS;
    if (parsed !== 0) {
        throw new Error("Paid plans must use 0 trial days.");
    }
    return 0;
}

const FEATURE_LABELS = {
    dashboard: "Dashboard",
    students: "Students",
    teachers: "Teachers",
    classes: "Classes",
    subjects: "Subjects",
    attendance: "Attendance",
    fees: "Fees",
    exams: "Exams",
    homework: "Homework",
    timetable: "Timetable",
    library: "Library",
    transport: "Transport",
    salary: "Salary",
    certificates: "Certificates",
    reports: "Reports",
    parent_portal: "Parent Portal",
    student_portal: "Student Portal",
    messaging: "Messaging",
    settings: "Settings",
    analytics: "Analytics",
    notices: "Notices",
    events: "Events",
    admissions: "Admissions",
    meetings: "Meetings",
    leaves: "Leaves",
    portal: "Portal",
    ai_assistant: "AI Assistant"
};

function collectFeatures(body, forceAll = false, planKey = "", planName = "") {
    const featuresObj = {};
    const enabledKeys = new Set();
    const normalizedKey = String(planKey || planName || "").trim().toLowerCase();
    const isPremiumOrTrial = normalizedKey === "premium" || normalizedKey === "trial" || normalizedKey.includes("premium");

    for (const key of SUPPORTED_PLAN_FEATURES) {
        let enabled = forceAll || body[`feature_${key}`] === "on";
        if (key === "ai_assistant" && !isPremiumOrTrial) {
            enabled = false;
        }
        featuresObj[key] = enabled;
        if (enabled) enabledKeys.add(key);
    };

    if (TIMETABLE_FEATURE_ALIASES.some((key) => featuresObj[key])) {
        for (const key of TIMETABLE_FEATURE_ALIASES) {
            featuresObj[key] = true;
            enabledKeys.add(key);
        };
    };
    return { featuresObj, enabledKeys: Array.from(enabledKeys) };
};

function normalizeTimetableFeatureObject(features) {
    if (!features || typeof features !== "object") return features || {};
    const timetableEnabled = TIMETABLE_FEATURE_ALIASES.some((key) => {
        const value = features[key];
        return value === true || value === "true" || value === "on" || value === 1;
    });
    if (timetableEnabled) {
        for (const key of TIMETABLE_FEATURE_ALIASES) {
            features[key] = true;
        };
    };
    return features;
};

async function syncPlanFeatures(planId, enabledKeys) {
    await executeAsync("DELETE FROM subscription_plan_features WHERE plan_id = ?", [planId]);
    for (const feat of enabledKeys) {
        await executeAsync(
            `INSERT INTO subscription_plan_features (plan_id, feature_name)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE feature_name = VALUES(feature_name)`,
            [planId, feat]
        );
    };
};

async function invalidateSchoolsUsingPlan(planId) {
    const schools = await queryAsync(
        "SELECT id FROM schools WHERE plan_id = ? OR current_plan_id = ?",
        [planId, planId]
    ).catch(() => []);

    await Promise.all(schools.map((school) => Promise.all([
        invalidatePlanCache(school.id),
        invalidateSubscriptionCache(school.id)
    ])));
};

function normalizeFeatures(featuresRaw) {
    if (!featuresRaw) return [];
    let parsed = [];
    try {
        parsed = typeof featuresRaw === "string" ? JSON.parse(featuresRaw) : featuresRaw;
    } catch (e) {
        return [];
    };
    if (Array.isArray(parsed)) {
        return parsed;
    };
    if (typeof parsed === "object" && parsed !== null) {
        return Object.entries(parsed)
            .filter(([key, val]) => val === true || val === 'true' || val === 'on')
            .map(([key]) => key.charAt(0).toUpperCase() + key.slice(1));
    };
    return [];
};

const planController = {
    list: async (req, res) => {
        try {
            const plans = await queryAsync(`
                SELECT p.*,
                    (SELECT COUNT(*) FROM schools s WHERE s.plan_id = p.id AND s.status = 'active') as school_count
                FROM plans p
                ORDER BY p.id
            `);

            const planStats = await queryAsync(`
                SELECT COALESCE(p.name, s.plan, 'Unassigned') AS plan,
                    COUNT(*) as totalSchools,
                    SUM(CASE WHEN s.status = 'active' THEN 1 ELSE 0 END) as active,
                    SUM(CASE WHEN s.status = 'trial' THEN 1 ELSE 0 END) as trial
                FROM schools s
                LEFT JOIN plans p ON p.id = s.plan_id
                GROUP BY COALESCE(p.name, s.plan, 'Unassigned')
            `).catch(err => {
                console.error("Failed to query plan stats:", err);
                return [];
            });

            const processedPlans = plans.map(p => ({
                ...p,
                accent_color: p.color_code || "#3B82F6",
                featuresList: normalizeFeatures(p.features)
            }));

            res.render("superAdmin/plans/index", {
                title: "Plans - SchoolSync",
                plans: processedPlans,
                planStats,
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            console.error("List Plans Error:", error);
            req.flash("error", "Failed to load plans");
            res.redirect("/superadmin/dashboard");
        };
    },

    addForm: async (req, res) => {
        res.render("superAdmin/plans/form", {
            title: "Add Plan - SchoolSync",
            plan: null,
            supportedFeatures: SUPPORTED_PLAN_FEATURES,
            user: req.user,
            currentPath: req.path
        });
    },

    create: async (req, res) => {
        try {
            const { name, plan_key, monthly_price, yearly_price, max_students, max_teachers, max_classes, trial_days, color_code, icon, is_active, description, is_popular } = req.body;
            const isTrial = isTrialPlanInput(plan_key, name);
            const normalizedTrialDays = resolveTrialDays(plan_key, name, trial_days);
            const { featuresObj, enabledKeys } = collectFeatures(req.body, isTrial, plan_key, name);
            const isActiveVal = (is_active === 'on' || is_active === '1' || is_active === true) ? 1 : 0;
            const statusVal = isActiveVal ? 'active' : 'inactive';
            const isPopularVal = (is_popular === 'on' || is_popular === '1' || is_popular === true) ? 1 : 0;
            const result = await executeAsync(
                `INSERT INTO plans (name, plan_key, slug, description, monthly_price, yearly_price, student_limit, max_students, max_teachers, teacher_limit, max_classes, features, trial_days, color_code, icon, is_active, is_popular, status, created_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
                [ name, plan_key, plan_key, description || "", parseFloat(monthly_price) || 0, parseFloat(yearly_price) || 0, max_students ? parseInt(max_students) : null, max_students ? parseInt(max_students) : null, max_teachers ? parseInt(max_teachers) : null, max_teachers ? parseInt(max_teachers) : null, max_classes  ? parseInt(max_classes)  : null, JSON.stringify(featuresObj), normalizedTrialDays, color_code || "#3B82F6", icon || "package", isActiveVal,  isPopularVal, statusVal ]
            );
            const planId = result.insertId;

            await syncPlanFeatures(planId, enabledKeys);
            await invalidateSchoolsUsingPlan(planId);

            await logSchoolActivity(req, {
                action: "create_plan",
                entityType: "plan",
                entityId: planId,
                newValues: { name, plan_key, monthly_price, yearly_price, features: enabledKeys },
                description: `Created subscription plan: ${name}`
            });

            req.flash("success", "Plan created successfully");
            res.redirect("/superadmin/plans");
        } catch (error) {
            console.error("Create Plan Error:", error);
            req.flash("error", error.message || "Failed to create plan");
            res.redirect("/superadmin/plans");
        };
    },

    editForm: async (req, res) => {
        try {
            const rows = await queryAsync(`SELECT * FROM plans WHERE id = ? LIMIT 1`, [req.params.id]);
            if (!rows.length) {
                req.flash("error", "Plan not found");
                return res.redirect("/superadmin/plans");
            };
            const plan = rows[0];
            try {
                plan.features = typeof plan.features === "string" ? JSON.parse(plan.features || "{}") : plan.features;
            } catch (e) {
                plan.features = {};
            };
            const featureRows = await queryAsync(
                "SELECT feature_name FROM subscription_plan_features WHERE plan_id = ?",
                [plan.id]
            ).catch(() => []);
            for (const row of featureRows) {
                if (row.feature_name) {
                    plan.features[String(row.feature_name).trim().toLowerCase()] = true;
                };
            };
            plan.features = normalizeTimetableFeatureObject(plan.features);

            res.render("superAdmin/plans/form", {
                title: "Edit Plan - SchoolSync",
                plan,
                supportedFeatures: SUPPORTED_PLAN_FEATURES,
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            console.error("Edit Form Error:", error);
            req.flash("error", "Failed to load plan");
            res.redirect("/superadmin/plans");
        };
    },

    update: async (req, res) => {
        try {
            const planId = req.params.id;
            const { name, plan_key, monthly_price, yearly_price, max_students, max_teachers, max_classes, trial_days, color_code, icon, is_active, description, is_popular } = req.body;
            const [oldPlan] = await queryAsync(`SELECT * FROM plans WHERE id = ? LIMIT 1`, [planId]);
            const isTrial = isTrialPlanInput(plan_key, name);
            const normalizedTrialDays = resolveTrialDays(plan_key, name, trial_days);
            const { featuresObj, enabledKeys } = collectFeatures(req.body, isTrial, plan_key, name);
            const isActiveVal = (is_active === 'on' || is_active === '1' || is_active === true) ? 1 : 0;
            const statusVal = isActiveVal ? 'active' : 'inactive';
            const isPopularVal = (is_popular === 'on' || is_popular === '1' || is_popular === true) ? 1 : 0;

            await executeAsync(
                `UPDATE plans SET name=?, plan_key=?, slug=?, description=?, monthly_price=?, yearly_price=?, student_limit=?, max_students=?, max_teachers=?, teacher_limit=?, max_classes=?, features=?, trial_days=?, color_code=?, icon=?, is_active=?, is_popular=?, status=?, updated_at=NOW()
                WHERE id=?`,
                [ name, plan_key, plan_key, description || "", parseFloat(monthly_price) || 0, parseFloat(yearly_price) || 0, max_students ? parseInt(max_students) : null, max_students ? parseInt(max_students) : null, max_teachers ? parseInt(max_teachers) : null, max_teachers ? parseInt(max_teachers) : null, max_classes  ? parseInt(max_classes)  : null, JSON.stringify(featuresObj), normalizedTrialDays, color_code || "#3B82F6", icon || "package", isActiveVal, isPopularVal, statusVal, planId ]
            );

            await syncPlanFeatures(planId, enabledKeys);
            await invalidateSchoolsUsingPlan(planId);

            await logSchoolActivity(req, {
                action: "update_plan",
                entityType: "plan",
                entityId: planId,
                oldValues: oldPlan,
                newValues: { name, plan_key, monthly_price, yearly_price, features: enabledKeys },
                description: `Updated subscription plan: ${name}`
            });

            req.flash("success", "Plan updated successfully");
            res.redirect("/superadmin/plans");
        } catch (error) {
            console.error("Update Plan Error:", error);
            req.flash("error", error.message || "Failed to update plan");
            res.redirect("/superadmin/plans");
        };
    },

    delete: async (req, res) => {
        try {
            const planId = req.params.id;

            const [plan] = await queryAsync(`SELECT * FROM plans WHERE id = ? LIMIT 1`, [planId]);
            if (!plan) {
                req.flash("error", "Plan not found");
                return res.redirect("/superadmin/plans");
            };

            const schoolCheck = await queryAsync(
                `SELECT (
                    SELECT COUNT(*) FROM schools WHERE plan_id = ? OR current_plan_id = ?
                ) + (
                    SELECT COUNT(*) FROM subscriptions WHERE plan_id = ?
                ) AS count`,
                [planId, planId, planId]
            );
            const count = schoolCheck[0] ? schoolCheck[0].count : 0;

            if (count > 0) {
                await executeAsync(`UPDATE plans SET status = 'inactive', is_active = 0 WHERE id = ?`, [planId]);                
                await logSchoolActivity(req, {
                    action: "deactivate_plan",
                    entityType: "plan",
                    entityId: planId,
                    description: `Marked plan '${plan.name}' as inactive because it has active subscribers.`
                });

                req.flash("success", `Plan has active subscribers. It has been marked as inactive rather than deleted.`);
                return res.redirect("/superadmin/plans");
            };

            const result = await executeAsync(`DELETE FROM plans WHERE id = ?`, [planId]);

            if (result.affectedRows === 0) {
                req.flash("error", "Plan not found or already deleted");
            } else {
                await logSchoolActivity(req, {
                    action: "delete_plan",
                    entityType: "plan",
                    entityId: planId,
                    description: `Deleted plan: ${plan.name}`
                });
                req.flash("success", "Plan deleted successfully");
            };

            res.redirect("/superadmin/plans");
        } catch (error) {
            console.error("Delete Plan Error:", error);
            req.flash("error", "Failed to delete plan: " + error.message);
            res.redirect("/superadmin/plans");
        };
    },

    toggleActive: async (req, res) => {
        try {
            const planId = req.params.id;
            const rows = await queryAsync(`SELECT is_active FROM plans WHERE id = ? LIMIT 1`, [planId]);

            if (!rows.length) {
                req.flash("error", "Plan not found");
                return res.redirect("/superadmin/plans");
            };

            const newIsActive = rows[0].is_active ? 0 : 1;
            const newStatus = newIsActive ? 'active' : 'inactive';
            await executeAsync(`UPDATE plans SET is_active = ?, status = ? WHERE id = ?`, [newIsActive, newStatus, planId]);

            req.flash("success", `Plan ${newIsActive ? "enabled" : "disabled"} successfully`);
            res.redirect("/superadmin/plans");
        } catch (error) {
            console.error("Toggle Plan Error:", error);
            req.flash("error", "Failed to toggle plan");
            res.redirect("/superadmin/plans");
        };
    }
};

planController._test = Object.freeze({
    TRIAL_DAYS,
    collectFeatures,
    isTrialPlanInput,
    resolveTrialDays
});

module.exports = planController;
