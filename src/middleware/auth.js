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

const hydrateTeacherData = async (req, res, user) => {
    if (!user || user.role !== 'teacher') return;
    try {
        const teacherRows = await queryAsync(
            `SELECT t.id, t.designation,
                (SELECT COUNT(*) FROM teacher_class_assign tca 
                 WHERE tca.teacher_id = t.id AND tca.school_id = t.school_id 
                 AND COALESCE(tca.is_primary, 0) = 1 AND COALESCE(tca.status, 'active') = 'active') AS primary_count
             FROM teachers t 
             WHERE t.user_id = ? AND t.school_id = ? AND t.deleted_at IS NULL 
             LIMIT 1`,
            [user.id, user.school_id]
        );
        if (teacherRows && teacherRows.length > 0) {
            const t = teacherRows[0];
            const norm = String(t.designation || '').trim().toLowerCase();
            const hasPrimaryClass = Number(t.primary_count || 0) > 0;
            const isPrimary = hasPrimaryClass;
            const resolvedDesignation = hasPrimaryClass 
                ? (t.designation || 'Primary Teacher') 
                : (norm === 'primary teacher' ? null : (t.designation || null));

            user.teacher_id = t.id;
            user.designation = resolvedDesignation;
            user.isPrimaryTeacher = isPrimary;
            user.is_primary = hasPrimaryClass ? 1 : 0;

            res.locals.teacherDesignation = resolvedDesignation;
            res.locals.isPrimaryTeacher = isPrimary;

            if (req.session?.user) {
                req.session.user.teacher_id = t.id;
                req.session.user.designation = resolvedDesignation;
                req.session.user.isPrimaryTeacher = isPrimary;
                req.session.user.is_primary = hasPrimaryClass ? 1 : 0;
            }
        } else {
            user.designation = null;
            user.isPrimaryTeacher = false;
            user.is_primary = 0;
            res.locals.teacherDesignation = null;
            res.locals.isPrimaryTeacher = false;
        }
    } catch (err) {
        console.error("[Auth] Failed to hydrate teacher designation:", err.message);
    }
};

const rejectRequest = (req, res, status, message) => {
    try {
        if ((req.accepts("json") && !req.accepts("html")) || (req.path && req.path.startsWith("/uploads/"))) {
            return res.status(status).json({ success: false, message });
        };
        req.flash("error", message);
        return res.redirect("/");
    } catch (error) {
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
            await hydrateTeacherData(req, res, req.user);
            return next();
        };
        const token = extractToken(req);
        if (!token) {
            if (req.session?.user) {
                req.user = req.session.user;
                res.locals.user = req.session.user;
                await hydrateTeacherData(req, res, req.user);
                return next();
            };
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
            await hydrateTeacherData(req, res, liveUser);

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
        clearAuthCookie(res);
        return rejectRequest(req, res, 500, "Authentication failed. Please try again.");
    };
};

const optionalAuth = async (req, res, next) => {
    if (req.user) {
        await hydrateTeacherData(req, res, req.user);
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
        await hydrateTeacherData(req, res, liveUser);
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

const isPrimaryTeacher = async (req, res, next) => {
    try {
        const currentUser = req.session?.user || req.user;
        if (!currentUser) {
            return rejectRequest(req, res, 401, "Please sign in to continue.");
        }
        if (currentUser.role !== "teacher") {
            return rejectRequest(req, res, 403, "Access denied. Teachers only.");
        }

        const teacherRows = await queryAsync(
            `SELECT t.id, t.designation,
                (SELECT COUNT(*) FROM teacher_class_assign tca 
                 WHERE tca.teacher_id = t.id AND tca.school_id = t.school_id 
                 AND COALESCE(tca.is_primary, 0) = 1 AND COALESCE(tca.status, 'active') = 'active') AS primary_count
             FROM teachers t 
             WHERE t.user_id = ? AND t.school_id = ? AND t.deleted_at IS NULL 
             LIMIT 1`,
            [currentUser.id, currentUser.school_id]
        );

        if (!teacherRows || !teacherRows.length) {
            return rejectRequest(req, res, 403, "Teacher profile not found.");
        }

        const t = teacherRows[0];
        const rawDesignation = t.designation;
        const normalized = String(rawDesignation || "").trim().toLowerCase();
        const hasPrimaryClass = Number(t.primary_count || 0) > 0;
        const isPrimary = hasPrimaryClass;

        if (!isPrimary) {
            const isJson = (req.accepts("json") && !req.accepts("html")) || req.xhr || String(req.get("x-requested-with") || "").toLowerCase() === "xmlhttprequest" || req.path.startsWith("/api/");
            if (isJson || req.method === "POST") {
                return res.status(403).json({
                    success: false,
                    message: "Access denied. Attendance access is restricted to Primary Teachers only."
                });
            }
            return res.status(403).render("errors/403", {
                title: "403 - Access Denied | SchoolSync",
                message: "Access denied. Attendance is restricted to Primary Teachers only.",
                errorCode: "403",
                layout: false
            });
        }

        const resolvedDesignation = rawDesignation || (hasPrimaryClass ? "Primary Teacher" : null);
        req.teacher = t;
        req.teacher.designation = resolvedDesignation;
        req.teacher.isPrimaryTeacher = true;
        req.teacher.is_primary = hasPrimaryClass ? 1 : 0;

        if (req.user) {
            req.user.teacher_id = t.id;
            req.user.designation = resolvedDesignation;
            req.user.isPrimaryTeacher = true;
            req.user.is_primary = hasPrimaryClass ? 1 : 0;
        }
        if (req.session?.user) {
            req.session.user.teacher_id = t.id;
            req.session.user.designation = resolvedDesignation;
            req.session.user.isPrimaryTeacher = true;
            req.session.user.is_primary = hasPrimaryClass ? 1 : 0;
        }

        res.locals.isPrimaryTeacher = true;
        res.locals.teacherDesignation = resolvedDesignation;
        return next();
    } catch (err) {
        return rejectRequest(req, res, 500, "Authorization error occurred.");
    }
};

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

module.exports = { verifyToken, optionalAuth, requireRole, isAdmin, isGroupAdmin, isSchoolAdmin, isTeacher, isPrimaryTeacher, isStudent, isDriver, isLibrarian, isLibrary, isParent, tenantIsolation, isAuthenticatedSession, isSuperAdminSession, isSchoolAdminSession, isTeacherSession, isStudentSession, tenantIsolationSession };