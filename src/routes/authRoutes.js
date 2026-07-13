const express = require("express");
const router = express.Router();
const auth = require("../controllers/authController");
const { loginLimiter, otpLimiter, passwordResetLimiter, supportLimiter, demoLimiter } = require("../middleware/rateLimit");
const { validateLogin, validatePasswordReset } = require("../middleware/validate");
const { getPublicPlans } = require("../services/subscriptionService");
const { queryAsync } = require("../config/database");
const { optionalAuth, verifyToken } = require("../middleware/auth");
const { signAuthToken, AUTH_COOKIE_NAME, getAuthCookieOptions, getDashboardPath } = require("../utils/auth");
const passport = require("../config/passport");

router.get("/", async (req, res, next) => {
    try {
        const plans = await getPublicPlans();
        return res.render("landing/index", { plans, demoSuccess: req.query.demo === "success" });
    } catch (err) {
        console.error("Landing render error:", err);
        return next(err);
    };
});
router.get("/login", (req, res) => res.render("auth/login"));
router.post("/login", loginLimiter, validateLogin, auth.login);

const renderStartDemo = async (req, res, next) => {
    try {
        const plans = await getPublicPlans();
        return res.render("auth/start-demo", {
            plans
        });
    } catch (err) {
        console.error("Start demo render error:", err);
        return next(err);
    };
};

router.get("/register", (req, res) => {
    return res.redirect("/start-demo");
});

router.post("/register", (req, res) => {
    return res.redirect("/start-demo");
});

router.get("/start-demo", renderStartDemo);
router.post("/start-demo", demoLimiter, auth.startDemo);

router.get("/forgot-password", (req, res) => res.render("auth/forgotPassword"));
router.get("/forgot_password", (req, res) => res.redirect("/forgot-password"));
router.post("/send-otp", otpLimiter, auth.sendOtp);

router.post("/reset-password", passwordResetLimiter, validatePasswordReset, auth.resetPassword);

router.get("/logout", auth.logout);
router.post("/logout", auth.logout);

router.get("/change-password", verifyToken, auth.changePasswordForm);
router.post("/change-password", verifyToken, auth.changePassword);

router.get("/auth/google", (req, res, next) => {
    if (!passport.googleEnabled) {
        req.flash("error", "Google sign-in is not configured yet.");
        return res.redirect("/");
    };
    return passport.authenticate("google", {
        scope: ["profile", "email"],
        session: false,
    })(req, res, next);
});

router.get("/auth/google/callback", (req, res, next) => {
    if (!passport.googleEnabled) {
        req.flash("error", "Google sign-in is not configured yet.");
        return res.redirect("/login");
    };

    passport.authenticate("google", { session: false }, (err, user, info) => {
        if (err) {
            console.error("Google OAuth callback error:", err);
            req.flash("error", "Google sign-in failed. Please try again.");
            return res.redirect("/login");
        };
        if (!user) {
            req.flash("error", info?.message || "Google sign-in failed. Please use a registered SchoolSync email.");
            return res.redirect("/login");
        };

        const finishLogin = () => {
            const token = signAuthToken(user, { rememberMe: true });
            res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions(true));
            return res.redirect(getDashboardPath(user.role));
        };
        if (req.session && typeof req.session.regenerate === "function") {
            return req.session.regenerate((sessionError) => {
                if (sessionError) return next(sessionError);
                return finishLogin();
            });
        };
        return finishLogin();
    })(req, res, next);
});

router.get("/privacy", (req, res) => res.render("privacy"));
router.get("/terms", (req, res) => res.render("terms"));
router.get("/support", optionalAuth, (req, res) => res.render("support"));
router.post("/support", supportLimiter, optionalAuth, async (req, res) => {
    const { name, email, message } = req.body;
    if (!name || !email || !message) {
        req.flash("error", "Please fill in all fields.");
        return res.redirect("/support");
    };

    try {
        const userId = req.user?.id || null;
        const schoolLinkedRoles = new Set(["school_admin", "teacher", "student", "parent", "driver", "librarian"]);
        const schoolId = req.user && schoolLinkedRoles.has(req.user.role) ? (req.user.school_id || null) : null;
        if (schoolId && userId) {
            const ticketNo = `TKT-${Date.now()}`;
            await queryAsync(
                `INSERT INTO support_tickets
                (school_id, user_id, ticket_no, reporter_name, reporter_email, subject, description, category, priority, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'general', 'normal', 'open')`,
                [ schoolId, userId, ticketNo, name, email, `Website support request from ${name}`, message]
            );
        };
        req.flash("success", "Thanks for reaching out! Our team will get back to you soon.");
    } catch (err) {
        console.error("[Support Contact] Failed to save support request:", err);
        const supportEmail = process.env.SUPER_ADMIN_EMAIL || process.env.EMAIL_USER || "support@schoolsync.com";
        req.flash("error", `Something went wrong, please email us directly at ${supportEmail}.`);
    };
    res.redirect("/support");
});

router.get("/home", (req, res) => res.redirect("/"));

module.exports = router;
