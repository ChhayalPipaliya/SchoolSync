const { getSubscriptionState } = require("../services/subscriptionService");

const allowedExpiredSchoolAdminPaths = [
    "/schooladmin/dashboard",
    "/schooladmin/subscription"
];

const isStaticAsset = (path) => (
    path.startsWith("/css/") ||
    path.startsWith("/js/") ||
    path.startsWith("/images/") ||
    path.startsWith("/uploads/") ||
    path.startsWith("/favicon")
);

const wantsJson = (req) => req.accepts("json") && !req.accepts("html");

const featureRouteMap = [
    { prefixes: ["/schooladmin/students", "/teacher/students"], feature: "students" },
    { prefixes: ["/schooladmin/teachers"], feature: "teachers" },
    { prefixes: ["/schooladmin/classes"], feature: "classes" },
    { prefixes: ["/schooladmin/subjects"], feature: "subjects" },
    { prefixes: ["/schooladmin/attendance", "/student/attendance", "/teacher/attendance", "/driver/attendance", "/parent/attendance"], feature: "attendance" },
    { prefixes: ["/schooladmin/fees", "/student/fees", "/parent/fees"], feature: "fees" },
    { prefixes: ["/schooladmin/exams", "/schooladmin/marks", "/student/exams", "/student/examschedule", "/student/marks", "/student/results", "/teacher/exams", "/teacher/marks", "/parent/results"], feature: "exams" },
    { prefixes: ["/schooladmin/homework", "/student/homework", "/teacher/homework", "/parent/homework"], feature: "homework" },
    { prefixes: ["/schooladmin/timetable", "/student/timetable", "/teacher/timetable", "/parent/timetable"], feature: "timetable" },
    { prefixes: ["/schooladmin/library", "/schooladmin/librarians", "/librarian/books", "/librarian/categories", "/librarian/racks", "/librarian/issues", "/librarian/fines", "/student/library", "/parent/library"], feature: "library" },
    { prefixes: ["/schooladmin/transport", "/schooladmin/drivers", "/driver/my_route", "/driver/students", "/driver/vehicle", "/driver/transport", "/driver/trips", "/driver/sos", "/student/transport", "/parent/transport"], feature: "transport" },
    { prefixes: ["/schooladmin/salary"], feature: "salary" },
    { prefixes: ["/schooladmin/reports", "/librarian/reports"], feature: "reports" },
    { prefixes: ["/schooladmin/analytics", "/schooladmin/api/analytics"], feature: "analytics" },
    { prefixes: ["/schooladmin/admissions"], feature: "admissions" },
    { prefixes: ["/schooladmin/notices", "/student/notices", "/teacher/notices", "/driver/notices", "/librarian/notices", "/parent/notices"], feature: "notices" },
    { prefixes: ["/schooladmin/events", "/student/academic-calendar", "/student/api/academic-events", "/teacher/academic-calendar", "/teacher/api/academic-events", "/events"], feature: "events" },
    { prefixes: ["/schooladmin/meetings", "/student/meetings", "/teacher/meetings", "/driver/meetings", "/librarian/meetings", "/parent/meetings"], feature: "meetings" },
    { prefixes: ["/schooladmin/leaves", "/student/leaves", "/teacher/leaves", "/driver/leaves", "/librarian/leaves"], feature: "leaves" },
    { prefixes: ["/schooladmin/chat", "/student/chat", "/teacher/chat", "/driver/chat", "/librarian/chat"], feature: "messaging" },
    { prefixes: ["/schooladmin/portal"], feature: "portal" },
    { prefixes: ["/schooladmin/settings"], feature: "settings" },
    { prefixes: ["/schooladmin/certificates", "/parent/certificates"], feature: "certificates" },
];

const rolePortalFeature = {
    parent: "parent_portal",
    student: "student_portal"
};

const routeFeatureForPath = (path) => {
    const normalizedPath = String(path || "").split("?")[0].toLowerCase().replace(/\/+$/, "") || "/";
    const match = featureRouteMap.find(({ prefixes }) =>
        prefixes.some((prefix) => normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`))
    );
    return match?.feature || null;
};

const subscriptionGuard = async (req, res, next) => {
    try {
        if (!req.user || req.user.role === "super_admin" || req.user.role === "group_admin" || isStaticAsset(req.path)) {
            return next();
        };

        const schoolId = req.user.school_id;
        if (!schoolId) {
            if (wantsJson(req)) {
                return res.status(401).json({ success: false, message: "School context is missing." });
            };
            req.flash("error", "School context is missing.");
            return res.redirect("/login");
        };

        const state = await getSubscriptionState(schoolId, {
            createReminders: req.user.role === "school_admin",
            userId: req.user.id
        });

        req.subscriptionState = state;
        req.subscription = state;
        res.locals.subscriptionState = state;
        res.locals.hasFeature = state.hasFeature;

        const schoolStatus = state.school?.status;
        if (schoolStatus === "suspended" || schoolStatus === "inactive") {
            const message = "Your school account has been suspended or deactivated. Please contact support.";
            if (wantsJson(req)) {
                return res.status(403).json({ success: false, message, code: "SCHOOL_SUSPENDED" });
            };
            req.flash("error", message);
            return res.redirect("/login");
        };

        if (!state.subscriptionLocked) {
            const portalFeature = rolePortalFeature[req.user.role];
            if (portalFeature && typeof state.hasFeature === "function" && !state.hasFeature(portalFeature)) {
                const message = "Your portal is not included in the school's current subscription plan.";
                if (wantsJson(req)) {
                    return res.status(403).json({ success: false, message, code: "FEATURE_LOCKED", feature: portalFeature });
                };
                req.flash("error", message);
                return res.redirect("/login");
            };
            const feature = routeFeatureForPath(req.originalUrl || req.path);
            if (feature && typeof state.hasFeature === "function" && !state.hasFeature(feature)) {
                const message = "This feature is not included in your current subscription plan.";
                if (wantsJson(req)) {
                    return res.status(403).json({ success: false, message, code: "FEATURE_LOCKED", feature });
                };
                req.flash("error", message);
                const fallback = req.user.role === "school_admin" ? "/schooladmin/subscription?upgrade=required" : "/login";
                return res.redirect(fallback);
            };
            return next();
        };

        if (req.user.role === "school_admin") {
            const path = (req.originalUrl || req.path).split("?")[0].toLowerCase();
            const isAllowed = allowedExpiredSchoolAdminPaths.some((allowed) => path === allowed || path.startsWith(`${allowed}/`));
            if (isAllowed) return next();

            if (wantsJson(req)) {
                return res.status(403).json({
                    success: false,
                    message: "Your demo or subscription has expired. Please choose a plan to continue.",
                    code: "SUBSCRIPTION_EXPIRED"
                });
            };
            return res.redirect("/schooladmin/dashboard?subscription=expired");
        };

        const message = "Your school's subscription has expired. Please contact your school administrator.";
        if (wantsJson(req)) {
            return res.status(403).json({ success: false, message, code: "SUBSCRIPTION_EXPIRED" });
        };
        req.flash("error", message);
        return res.redirect("/login");
    } catch (error) {
        console.error("SubscriptionGuard Error:", error);
        if (wantsJson(req)) {
            return res.status(500).json({ success: false, message: "Unable to validate subscription status." });
        };
        req.flash("error", "Unable to validate subscription status.");
        return res.redirect("/login");
    };
};

module.exports = { allowedExpiredSchoolAdminPaths, featureRouteMap, routeFeatureForPath, subscriptionGuard };
