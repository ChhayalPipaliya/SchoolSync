const { validateEducationPrompt } = require("../middleware/educationGuard");
const { getSubscriptionState } = require("../services/subscriptionService");
const aiService = require("../services/aiService");

async function handleChat(req, res) {
    try {
        const userRole = req.user.role;
        const schoolId = req.user.school_id;
        const state = req.subscriptionState || (schoolId ? await getSubscriptionState(schoolId) : null);

        if (!state || !state.hasFeature("ai_assistant")) {
            return res.status(403).json({
                success: false,
                message: "SchoolSync AI Assistant is not included in your current subscription plan. Please upgrade to Premium to access this feature.",
                code: "FEATURE_LOCKED",
                feature: "ai_assistant"
            });
        };

        const message = req.body?.message;
        const history = Array.isArray(req.body?.history) ? req.body.history : [];
        const contentType = req.headers["content-type"] || "";

        const guardResult = validateEducationPrompt({
            message,
            contentType,
            body: req.body,
            userRole
        });

        if (!guardResult.allowed) {
            return res.status(200).json({
                success: false,
                response: guardResult.message,
                blocked: true,
                reason: guardResult.errorType
            });
        };

        const aiResponse = await aiService.generateEducationResponse({
            message: guardResult.cleanMessage,
            userRole,
            isHomeworkDirectAnswer: Boolean(guardResult.isHomeworkDirectAnswer),
            user: req.user,
            history
        });

        return res.status(200).json({
            success: true,
            response: aiResponse
        });
    } catch (error) {
        if (error.isConfigError) {
            return res.status(503).json({
                success: false,
                message: "AI is temporarily unavailable. Please try again."
            });
        };

        console.error("[AI] Chat controller error:", error.message || "Unknown error");
        return res.status(500).json({
            success: false,
            message: "Something went wrong while processing your request. Please try again later."
        });
    };
};

function getStatus(req, res) {
    return res.status(200).json({
        success: true,
        configured: aiService.isGeminiConfigured(),
        service: "SchoolSync Education AI"
    });
};

module.exports = { handleChat, getStatus };