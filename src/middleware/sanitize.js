const stripTags = (str) =>
    String(str)
        .replace(/<<script\b[^<<]*(?:(?!<\/script>)<<[^<<]*)*<<\/script>/gi, "")
        .replace(/<[^>]+>/g, "")
        .replace(/javascript:/gi, "")
        .replace(/on\w+\s*=/gi, "")
        .trim();

const deepSanitize = (value) => {
    if (typeof value === "string") {
        return stripTags(value);
    }
    if (Array.isArray(value)) {
        return value.map(deepSanitize);
    }
    if (value !== null && typeof value === "object") {
        const cleaned = {};
        for (const [k, v] of Object.entries(value)) {
            cleaned[k] = deepSanitize(v);
        }
        return cleaned;
    }
    return value;
};

const sanitizeRequest = (req, res, next) => {
    if (req.body && typeof req.body === "object") {
        req.body = deepSanitize(req.body);
    }
    if (req.query && typeof req.query === "object") {
        req.query = deepSanitize(req.query);
    }
    if (req.params && typeof req.params === "object") {
        req.params = deepSanitize(req.params);
    }
    return next();
};

const stripPrototypePollution = (obj) => {
    const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
    if (typeof obj !== "object" || obj === null) return obj;

    for (const key of Object.keys(obj)) {
        if (DANGEROUS_KEYS.has(key)) {
            delete obj[key];
        } else if (typeof obj[key] === "object") {
            stripPrototypePollution(obj[key]);
        }
    }
    return obj;
};

const preventPrototypePollution = (req, res, next) => {
    if (req.body)   stripPrototypePollution(req.body);
    if (req.query)  stripPrototypePollution(req.query);
    if (req.params) stripPrototypePollution(req.params);
    return next();
};

module.exports = { sanitizeRequest, preventPrototypePollution, stripTags, deepSanitize };
