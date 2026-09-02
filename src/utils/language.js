const jwt = require("jsonwebtoken");
const { getJwtSecret } = require("./auth");
const languageData = require("../language/language.json");

const normalizeLanguageName = (input) => {
    if (!input || typeof input !== "string") return null;
    const clean = input.toLowerCase().trim();
    if (clean === "hindi" || clean === "hi") return "hindi";
    if (clean === "gujrati" || clean === "gujarati" || clean === "gu") return "gujrati";
    if (clean === "english" || clean === "en") return "english";
    return null;
};

const resolveLanguage = (req) => {
    const queryLang = normalizeLanguageName(req?.query?.lang || req?.query?.language);
    if (queryLang) return queryLang;

    const directCookieLang = normalizeLanguageName(req?.cookies?.lang || req?.cookies?.language);
    if (directCookieLang) return directCookieLang;

    const rawDapplan = req?.cookies?.dapplan;
    if (rawDapplan) {
        const directNorm = normalizeLanguageName(rawDapplan);
        if (directNorm) return directNorm;

        try {
            const decoded = jwt.verify(rawDapplan, getJwtSecret());
            const decodedLang = normalizeLanguageName(decoded?.lang);
            if (decodedLang) return decodedLang;
        } catch (_) { }
    };

    const userObj = req?.user || req?.session?.user;
    if (userObj?.preferred_language) {
        const userPref = normalizeLanguageName(userObj.preferred_language);
        if (userPref) return userPref;
    };

    const sessionLang = normalizeLanguageName(req?.session?.language);
    if (sessionLang) return sessionLang;

    return "english";
};

const setLanguageCookies = (res, lang) => {
    if (!res || typeof res.cookie !== "function") return;
    const selectedLang = normalizeLanguageName(lang) || "english";
    const token = jwt.sign({ lang: selectedLang }, getJwtSecret(), { expiresIn: "365d" });

    const cookieOptions = {
        path: "/",
        httpOnly: false,
        sameSite: "lax",
        maxAge: 365 * 24 * 60 * 60 * 1000
    };

    res.cookie("dapplan", token, cookieOptions);
    res.cookie("lang", selectedLang, cookieOptions);
    res.cookie("language", selectedLang, cookieOptions);
};

const applyLanguage = (req, res, lang) => {
    const selectedLang = normalizeLanguageName(lang) || "english";

    let rawLanObj = languageData.english;
    if (selectedLang === "hindi" && languageData.hindi) {
        rawLanObj = languageData.hindi;
    } else if (selectedLang === "gujrati" && languageData.gujrati) {
        rawLanObj = languageData.gujrati;
    };

    const safeLanProxy = new Proxy(rawLanObj, {
        get(target, prop) {
            if (typeof prop === "string") {
                if (prop in target && target[prop] !== undefined && target[prop] !== null && target[prop] !== "") {
                    return target[prop];
                }
                if (languageData.english && prop in languageData.english) {
                    return languageData.english[prop];
                };
                return prop;
            };
            return target[prop];
        }
    });

    req.lan = safeLanProxy;
    if (res.locals) {
        res.locals.lan = safeLanProxy;
        res.locals.currentLang = selectedLang;
        res.locals.lang = selectedLang;
        res.locals.currentLanguage = selectedLang;
    };

    if (req.session) {
        req.session.language = selectedLang;
        if (req.session.user) {
            req.session.user.preferred_language = selectedLang;
        };
    };
    if (req.user) {
        req.user.preferred_language = selectedLang;
    };
    return selectedLang;
};

module.exports = { normalizeLanguageName, resolveLanguage, setLanguageCookies, applyLanguage, languageData };