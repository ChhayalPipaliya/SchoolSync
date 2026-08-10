const express = require("express");
const router = express.Router();
const { verifyToken, optionalAuth } = require("../middleware/auth");
const { apiLimiter } = require("../middleware/rateLimit");
const { requirePlanFeature } = require("../middleware/planAccess");
const aiController = require("../controllers/aiController");

const AI_PERMITTED_ROLES = new Set([
    "school_admin",
    "teacher",
    "student",
    "parent",
]);

function requireAIAccess(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ success: false, message: "Please sign in to use SchoolSync AI." });
    }
    if (!AI_PERMITTED_ROLES.has(req.user.role)) {
        return res.status(403).json({ success: false, message: "AI access is not available for your role." });
    }
    next();
}

router.post("/chat", verifyToken, requirePlanFeature("ai_assistant"), requireAIAccess, apiLimiter, aiController.handleChat);
router.get("/status", optionalAuth, aiController.getStatus);

module.exports = router;