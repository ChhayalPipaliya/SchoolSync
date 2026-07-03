const express = require("express");
const router = express.Router();
const auth = require("../controllers/authController");
const { loginLimiter, otpLimiter, passwordResetLimiter, supportLimiter, registrationLimiter, demoLimiter } = require("../middleware/rateLimit");
const { validateLogin, validatePasswordReset } = require("../middleware/validate");
const { getPublicPlans } = require("../services/subscriptionService");
const { queryAsync } = require("../config/database");
const { optionalAuth } = require("../middleware/auth");

router.get("/", async (req, res, next) => {
    try {
      const plans = await getPublicPlans();
      return res.render("landing/index", { plans, demoSuccess: req.query.demo === "success" });
    } catch (err) {
      console.error("Landing render error:", err);
      return next(err);
    }
  });
router.get("/login", (req, res) => res.render("auth/login"));
router.post("/login", loginLimiter, validateLogin, auth.login);

const normalizePlanKey = (value) => String(value || "")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");

const fallbackPublicPlans = [
  { name: "Basic", slug: "basic", plan_key: "basic", monthly_price: 999, yearly_price: 9999 },
  { name: "Standard", slug: "standard", plan_key: "standard", monthly_price: 2499, yearly_price: 24999 },
  { name: "Premium", slug: "premium", plan_key: "premium", monthly_price: 4999, yearly_price: 49999 }
];

const renderStartDemo = async (req, res, next) => {
  try {
    const plans = await getPublicPlans();
    const selectedPlanKey = normalizePlanKey(req.query.plan);
    const selectedBilling = req.query.billing === "yearly" ? "yearly" : "monthly";
    const selectedPlan = plans.find((plan) =>
      normalizePlanKey(plan.slug) === selectedPlanKey ||
      normalizePlanKey(plan.plan_key) === selectedPlanKey ||
      normalizePlanKey(plan.name) === selectedPlanKey ||
      String(plan.id) === String(req.query.plan || "")
    ) || fallbackPublicPlans.find((plan) => normalizePlanKey(plan.slug || plan.name) === selectedPlanKey) || null;

    return res.render("auth/start-demo", {
      plans,
      selectedPlan,
      selectedPlanKey,
      selectedBilling
    });
  } catch (err) {
    console.error("Start demo render error:", err);
    return next(err);
  }
};

router.get("/register", (req, res) => res.render("auth/register"));
router.post("/register", registrationLimiter, auth.register);

router.get("/start-demo", renderStartDemo);
router.post("/start-demo", demoLimiter, auth.startDemo);

router.get("/forgot_password", (req, res) => res.render("auth/forgotPassword"));
router.post("/send-otp", otpLimiter, auth.sendOtp);
const passport = require("../config/passport");
const { signAuthToken, AUTH_COOKIE_NAME, getAuthCookieOptions, getDashboardPath } = require("../utils/auth");

router.post("/reset-password", passwordResetLimiter, validatePasswordReset, auth.resetPassword);

router.get("/logout", auth.logout);
router.post("/logout", auth.logout);

// Google OAuth routes
router.get("/auth/google", (req, res, next) => {
  if (!passport.googleEnabled) {
    req.flash("error", "Google sign-in is not configured yet.");
    return res.redirect("/");
  }
  return passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
  })(req, res, next);
});

router.get("/auth/google/callback", (req, res, next) => {
  if (!passport.googleEnabled) {
    req.flash("error", "Google sign-in is not configured yet.");
    return res.redirect("/login");
  }

  passport.authenticate("google", { session: false }, (err, user, info) => {
    if (err) {
      console.error("Google OAuth callback error:", err);
      req.flash("error", "Google sign-in failed. Please try again.");
      return res.redirect("/login");
    }
    if (!user) {
      req.flash("error", info?.message || "Google sign-in failed. Please use a registered SchoolSync email.");
      return res.redirect("/login");
    }

    const token = signAuthToken(user, { rememberMe: true });
    res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions(true));
    return res.redirect(getDashboardPath(user.role));
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
    }

    try {
        const userId = req.user?.id || null;
        const schoolLinkedRoles = new Set(["school_admin", "teacher", "student", "parent", "driver", "librarian"]);
        const schoolId = req.user && schoolLinkedRoles.has(req.user.role) ? (req.user.school_id || null) : null;
        await queryAsync(
            `INSERT INTO support_tickets (school_id, user_id, reporter_name, reporter_email, title, description, priority, status)
             VALUES (?, ?, ?, ?, ?, ?, 'medium', 'open')`,
            [
                schoolId,
                userId,
                name,
                email,
                `Website support request from ${name}`,
                message
            ]
        );
        req.flash("success", "Thanks for reaching out! Our team will get back to you soon.");
    } catch (err) {
        console.error("[Support Contact] Failed to save support request:", err);
        const supportEmail = process.env.SUPER_ADMIN_EMAIL || process.env.EMAIL_USER || "support@schoolsync.com";
        req.flash("error", `Something went wrong, please email us directly at ${supportEmail}.`);
    }
    res.redirect("/support");
});

router.get("/home", (req, res) => res.redirect("/"));

module.exports = router;
