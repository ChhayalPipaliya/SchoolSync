const express = require("express");
const router = express.Router();
const { queryAsync } = require("../config/database");
const { optionalAuth } = require("../middleware/auth");
const { normalizeLanguageName, setLanguageCookies, applyLanguage } = require("../utils/language");

router.post("/language/set", optionalAuth, async (req, res) => {
    try {
        const rawLang = req.body?.language || req.body?.lang;
        const selectedLang = normalizeLanguageName(rawLang) || "english";

        setLanguageCookies(res, selectedLang);
        applyLanguage(req, res, selectedLang);

        const currentUser = req.user || req.session?.user;
        if (currentUser?.id) {
            try {
                await queryAsync("UPDATE users SET preferred_language = ? WHERE id = ?", [selectedLang, currentUser.id]);
                if (req.user) {
                    req.user.preferred_language = selectedLang;
                };
                if (req.session?.user) {
                    req.session.user.preferred_language = selectedLang;
                };
            } catch (dbErr) {
                console.error("[LanguageRoutes] DB preference update warning:", dbErr.message);
            };
        };

        return res.json({
            success: true,
            language: selectedLang,
            message: "Language changed successfully"
        });
    } catch (error) {
        console.error("[LanguageRoutes] Set Language Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to update language"
        });
    };
});

router.get("/language/change/:lang", optionalAuth, async (req, res) => {
    try {
        const rawLang = req.params?.lang;
        const selectedLang = normalizeLanguageName(rawLang) || "english";

        setLanguageCookies(res, selectedLang);
        applyLanguage(req, res, selectedLang);

        const currentUser = req.user || req.session?.user;
        if (currentUser?.id) {
            try {
                await queryAsync("UPDATE users SET preferred_language = ? WHERE id = ?", [selectedLang, currentUser.id]);
                if (req.user) {
                    req.user.preferred_language = selectedLang;
                };
                if (req.session?.user) {
                    req.session.user.preferred_language = selectedLang;
                };
            } catch (dbErr) {
                console.error("[LanguageRoutes] DB preference update warning:", dbErr.message);
            };
        };

        const referer = req.get("Referrer") || "/";
        return res.redirect(referer);
    } catch (error) {
        console.error("[LanguageRoutes] Change Language GET Error:", error);
        return res.redirect("/");
    };
});

module.exports = router;