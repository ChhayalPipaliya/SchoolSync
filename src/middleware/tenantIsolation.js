const { isSafeId } = require("../utils/validators");
const { sendBadRequest } = require("../utils/errorFormatter");

const requireSchoolContext = (req, res, next) => {
    const user = req.user;

    if (!user) {
        return sendBadRequest(req, res, "Authentication required.", "auth");
    }

    if (user.role === "super_admin") {
        return next();
    }

    if (!isSafeId(user.school_id)) {
        return sendBadRequest(
            req, res,
            "Your account is not associated with any school.",
            "school_id"
        );
    }

    return next();
};

const enforceSchoolParam = (paramName = "school_id") => (req, res, next) => {
    const user     = req.user;
    const paramVal = parseInt(req.params[paramName], 10);

    if (user?.role === "super_admin") return next();

    if (!isSafeId(paramVal)) {
        return sendBadRequest(req, res, "Invalid school reference.", paramName);
    }

    if (Number(user?.school_id) !== paramVal) {
        return res.status(403).json({
            success: false,
            message: "Access denied: You cannot access another school's data.",
        });
    }

    return next();
};

const injectSchoolId = (req, res, next) => {
    if (req.user?.school_id) {
        req.body.school_id = req.user.school_id;
    }
    return next();
};

const requireOwnership = (fetchFn, paramName = "id", attachAs = "resource") => {
    return async (req, res, next) => {
        try {
            const id       = parseInt(req.params[paramName], 10);
            const schoolId = req.user?.school_id;

            if (!isSafeId(id)) {
                return sendBadRequest(req, res, "Invalid resource ID.", paramName);
            }

            if (req.user?.role === "super_admin") {
                return next();
            }

            if (!isSafeId(schoolId)) {
                return sendBadRequest(req, res, "Missing school context.", "school_id");
            }

            const record = await fetchFn(id, schoolId);

            if (!record) {
                if (req.accepts("json") && !req.accepts("html")) {
                    return res.status(404).json({ success: false, message: "Resource not found or access denied." });
                }
                req.flash("error", "Resource not found or access denied.");
                return res.redirect(req.get("Referer") || "/");
            }

            req[attachAs] = record;
            return next();

        } catch (error) {
            console.error("[TenantIsolation] requireOwnership error:", error);
            return res.status(500).json({ success: false, message: "Server error during authorization." });
        }
    };
};

module.exports = { requireSchoolContext, enforceSchoolParam, injectSchoolId, requireOwnership };
