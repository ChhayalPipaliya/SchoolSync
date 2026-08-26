const jwt = require("jsonwebtoken");
const { AUTH_COOKIE_NAME, clearAuthCookie, getJwtSecret } = require("../utils/auth");
const { queryAsync } = require("../config/database");
const birthdayService = require("../services/birthdayService");

const CHAT_PATHS = {
    super_admin: "",
    group_admin: "",
    school_admin: "/schooladmin/chat",
    teacher: "/teacher/chat",
    librarian: "/librarian/chat",
    driver: "/driver/chat"
};

const shouldLoadUnreadChatCount = (req) => {
    if (!["GET", "HEAD"].includes(req.method)) return false;

    const path = (req.path || req.originalUrl || "").toLowerCase();
    if (
        path.startsWith("/api/") ||
        path.startsWith("/uploads/") ||
        path.startsWith("/css/") ||
        path.startsWith("/js/") ||
        path.startsWith("/images/") ||
        path.startsWith("/fonts/") ||
        path.startsWith("/media/")
    ) {
        return false;
    };

    if (req.xhr || String(req.get("x-requested-with") || "").toLowerCase() === "xmlhttprequest") {
        return false;
    };

    const fetchDest = String(req.get("sec-fetch-dest") || "").toLowerCase();
    if (fetchDest && fetchDest !== "document" && fetchDest !== "empty") {
        return false;
    };

    const fetchMode = String(req.get("sec-fetch-mode") || "").toLowerCase();
    if (fetchMode && fetchMode !== "navigate") {
        return false;
    };

    return Boolean(req.accepts("html"));
};

const hydrateChatLocals = async (req, res, user) => {
    res.locals.unreadMessages = res.locals.unreadMessages || 0;
    res.locals.chatPath = res.locals.chatPath || "";

    if (!user || !CHAT_PATHS[user.role]) {
        return;
    };

    res.locals.chatPath = CHAT_PATHS[user.role];
    if (!shouldLoadUnreadChatCount(req)) {
        return;
    };

    try {
        const rows = await queryAsync(
            "SELECT COUNT(*) AS count FROM chat_messages WHERE school_id = ? AND receiver_id = ? AND is_read = 0 AND deleted_at IS NULL",
            [user.school_id, user.id]
        );
        res.locals.unreadMessages = Number(rows[0]?.count || 0);
    } catch (err) {
        console.error("[AuthChatLocals] Failed to load unread message count:", err.message);
    };
};

const rejectRequest = (req, res, status, message) => {
    try {
        if (req.accepts("json") && !req.accepts("html")) {
            return res.status(status).json({ success: false, message });
        };
        req.flash("error", message);
        return res.redirect("/");
    } catch (error) {
        console.error("Reject Request Error:", error);
        return res.status(500).send("Internal Server Error");
    };
};

const extractToken = (req) => {
    const authHeader = req.headers["authorization"];
    return (authHeader && authHeader.split(" ")[1]) || req.cookies?.[AUTH_COOKIE_NAME] || null;
};

const verifyToken = async (req, res, next) => {
    try {
        if (req.user) {
            return next();
        };
        const token = extractToken(req);
        if (!token) {
            return rejectRequest(req, res, 401, "Please sign in to continue.");
        };
        try {
            const decoded = jwt.verify(token, getJwtSecret());
            const users = await queryAsync("SELECT status, deleted_at, must_change_password, role, school_id, email, preferred_language FROM users WHERE id = ? LIMIT 1", [decoded.id]);
            if (!users.length || users[0].deleted_at || (users[0].status && users[0].status !== "active")) {
                clearAuthCookie(res);
                return rejectRequest(req, res, 403, "Your portal access is currently disabled. Please contact school admin.");
            };
            const liveUser = {
                ...decoded,
                role: users[0].role,
                school_id: users[0].school_id,
                email: users[0].email || decoded.email,
                preferred_language: users[0].preferred_language || decoded.preferred_language || "en"
            };
            req.user = liveUser;
            res.locals.user = liveUser;
            if (req.session) {
                req.session.user = liveUser;
                const todayStr = new Date().toISOString().slice(0, 10);
                if (req.session.birthdayCheckedDate !== todayStr) {
                    req.session.birthdayCheckedDate = todayStr;
                    birthdayService.checkAndNotifyUserBirthday(liveUser).then(wish => {
                        if (wish) {
                            req.session.birthdayWish = wish;
                            req.session.birthdayPopupShown = false;
                        }
                    }).catch(err => console.error('[BirthdayCheck Error]', err));
                };

                if (req.session.birthdayWish && !req.session.birthdayPopupShown) {
                    res.locals.birthdayWish = req.session.birthdayWish;
                    req.session.birthdayPopupShown = true;
                };
            };
            await hydrateChatLocals(req, res, liveUser);

            if (users[0].must_change_password === 1) {
                const isChangePasswordPath = req.path === "/change-password" || req.originalUrl === "/change-password";
                const isLogoutPath = req.path === "/logout" || req.originalUrl === "/logout";
                const isApiPath = req.path.startsWith("/api/") || req.originalUrl.startsWith("/api/");
                if (!isChangePasswordPath && !isLogoutPath && !isApiPath) {
                    req.flash("info", "You must configure a personal password for security compliance.");
                    return res.redirect("/change-password");
                };
            };

            return next();
        } catch (err) {
            clearAuthCookie(res);
            return rejectRequest(req, res, 401, "Your session has expired. Please sign in again.");
        };
    } catch (error) {
        console.error("Verify Token Error:", error);
        clearAuthCookie(res);
        return rejectRequest(req, res, 500, "Authentication failed. Please try again.");
    };
};

const optionalAuth = async (req, res, next) => {
    if (req.user) {
        return next();
    };
    const token = extractToken(req);
    if (!token) {
        return next();
    };

    try {
        const decoded = jwt.verify(token, getJwtSecret());
        const users = await queryAsync("SELECT status, deleted_at, role, school_id, email, preferred_language FROM users WHERE id = ? LIMIT 1", [decoded.id]);
        if (!users.length || users[0].deleted_at || (users[0].status && users[0].status !== "active")) {
            return next();
        };

        const liveUser = {
            ...decoded,
            role: users[0].role,
            school_id: users[0].school_id,
            email: users[0].email || decoded.email,
            preferred_language: users[0].preferred_language || decoded.preferred_language || "en"
        };
        req.user = liveUser;
        res.locals.user = liveUser;
        if (req.session) {
            req.session.user = liveUser;
        };
        return next();
    } catch (err) {
        return next();
    };
};

const requireRole = (allowedRoles) => {
    return (req, res, next) => {
        try {
            if (req.user && allowedRoles.includes(req.user.role)) {
                return next();
            };
            return rejectRequest(req, res, 403, "You do not have permission to access this page.");
        } catch (error) {
            console.error("Role Middleware Error:", error);
            return rejectRequest(req, res, 500, "Authorization error occurred.");
        };
    };
};

const isAdmin = requireRole(["super_admin"]);
const isGroupAdmin = requireRole(["group_admin"]);
const isSchoolAdmin = requireRole(["school_admin"]);
const isTeacher = requireRole(["teacher"]);
const isStudent = requireRole(["student"]);
const isDriver = requireRole(["driver"]);
const isLibrarian = requireRole(["librarian"]);
const isLibrary = requireRole(["librarian"]);
const isParent = requireRole(["parent"]);

const tenantIsolation = (req, res, next) => {
    try {
        if (!req.user) {
            return rejectRequest(req, res, 401, "Please sign in to continue.");
        };

        if (req.user.role === "group_admin" || req.user.role === "super_admin") {
            return next();
        };
        if (!req.user.school_id) {
            req.flash("error", "No school assigned");
            return res.redirect("/login");
        };
        next();
    } catch (error) {
        console.error("Tenant Isolation Error:", error);
        return rejectRequest(req, res, 500, "Authorization error occurred.");
    };
};

const isAuthenticatedSession = (req, res, next) => {
    if (req.isAuthenticated && req.isAuthenticated()) {
        return next();
    };
    req.flash("error", "Please login to access this page");
    res.redirect("/login");
};

const isSuperAdminSession = (req, res, next) => {
    if (req.user && req.user.role === "super_admin") {
        return next();
    };
    req.flash("error", "Access denied. Super Admin only.");
    res.redirect("/");
};

const isSchoolAdminSession = (req, res, next) => {
    if (req.session && req.session.user && req.session.user.role === 'school_admin') {
        return next();
    };
    req.flash('error', 'Access denied. School Admin only.');
    res.redirect('/login');
};

const isTeacherSession = (req, res, next) => {
    if (req.isAuthenticated && req.isAuthenticated() && req.user && req.user.role === 'teacher') {
        return next();
    };
    req.flash('error', 'Access denied. Teachers only.');
    res.redirect('/login');
};

const isStudentSession = (req, res, next) => {
    if (req.user && req.user.role === "student") {
        return next();
    };
    req.flash("error", "Access denied. Student only.");
    res.redirect("/");
};

const tenantIsolationSession = (req, res, next) => {
    if (req.session?.user && (req.session.user.role === "group_admin" || req.session.user.role === "super_admin")) {
        return next();
    };
    if (!req.session || !req.session.user || !req.session.user.school_id) {
        req.flash("error", "No school assigned");
        return res.redirect("/login");
    };
    next();
};

module.exports = { verifyToken, optionalAuth, requireRole, isAdmin, isGroupAdmin, isSchoolAdmin, isTeacher, isStudent, isDriver, isLibrarian, isLibrary, isParent, tenantIsolation, isAuthenticatedSession, isSuperAdminSession, isSchoolAdminSession, isTeacherSession, isStudentSession, tenantIsolationSession};