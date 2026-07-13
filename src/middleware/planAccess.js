const { getSubscriptionState } = require("../services/subscriptionService");

const FEATURE_NAMES = {
    dashboard: "Dashboard",
    students: "Students",
    teachers: "Teachers",
    classes: "Classes",
    subjects: "Subjects",
    attendance: "Attendance",
    library: "Library",
    transport: "Transport",
    exams: "Exams",
    fees: "Fees",
    reports: "Reports",
    certificates: "Certificates",
    homework: "Homework",
    timetable: "Timetable",
    hostel: "Hostel",
    parent_portal: "Parent Portal",
    student_portal: "Student Portal",
    salary: "Salary",
    payroll: "Payroll",
    analytics: "Analytics",
    settings: "Settings",
    attendance_prediction: "Attendance Prediction",
    fee_defaulter_prediction: "Fee Defaulter Prediction",
    smart_dashboard_insights: "Smart Dashboard Insights"
};

const wantsJson = (req) => req.accepts("json") && !req.accepts("html");

const requirePlanFeature = (featureName) => {
    return async (req, res, next) => {
        try {
            if (req.user?.role === "super_admin") return next();

            const schoolId = req.user?.school_id || req.session?.user?.school_id;
            if (!schoolId) {
                if (wantsJson(req)) {
                    return res.status(401).json({ success: false, message: "School context is missing." });
                };
                req.flash("error", "School context is missing.");
                return res.redirect("/login");
            };

            const state = req.subscriptionState || await getSubscriptionState(schoolId);
            req.subscriptionState = state;
            res.locals.subscriptionState = state;
            res.locals.hasFeature = state.hasFeature;

            if (state.hasFeature(featureName)) {
                return next();
            };

            const readableName = FEATURE_NAMES[featureName] || featureName;
            const message = `${readableName} is not included in your current plan. Please upgrade your subscription.`;
            if (wantsJson(req)) {
                return res.status(403).json({ success: false, message, code: "FEATURE_LOCKED" });
            };
            req.flash("error", message);
            return res.redirect("/schooladmin/subscription?upgrade=required");
        } catch (error) {
            console.error("Plan Access Middleware Error:", error);
            if (wantsJson(req)) {
                return res.status(500).json({ success: false, message: "Unable to validate feature access." });
            };
            req.flash("error", "Unable to validate feature access.");
            return res.redirect("/schooladmin/dashboard");
        };
    };
};

const requireBranchPlanFeature = (featureName) => {
    return async (req, res, next) => {
        try {
            if (req.user?.role === "super_admin") return next();

            const schoolId = req.params.schoolId || req.user?.school_id || req.session?.user?.school_id;
            if (!schoolId) {
                if (wantsJson(req)) {
                    return res.status(401).json({ success: false, message: "School context is missing." });
                };
                req.flash("error", "School context is missing.");
                return res.redirect("/login");
            };

            const state = await getSubscriptionState(schoolId);
            req.subscriptionState = state;
            res.locals.subscriptionState = state;
            res.locals.hasFeature = state.hasFeature;

            if (state.hasFeature(featureName)) {
                return next();
            };

            const readableName = FEATURE_NAMES[featureName] || featureName;
            const message = `${readableName} is not included in this branch's current plan.`;
            if (wantsJson(req)) {
                return res.status(403).json({ success: false, message, code: "FEATURE_LOCKED" });
            };
            req.flash("error", message);
            return res.redirect("/groupadmin/dashboard");
        } catch (error) {
            console.error("Branch Plan Access Middleware Error:", error);
            if (wantsJson(req)) {
                return res.status(500).json({ success: false, message: "Unable to validate feature access." });
            };
            req.flash("error", "Unable to validate feature access.");
            return res.redirect("/groupadmin/dashboard");
        };
    };
};

module.exports = { checkFeatureAccess: requirePlanFeature, requirePlanFeature, requireBranchPlanFeature };