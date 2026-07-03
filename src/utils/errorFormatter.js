const makeFieldError = (field, message, value) => {
    const err = { field, message };
    if (process.env.NODE_ENV !== "production" && value !== undefined) {
        err.rejected = value;
    }
    return err;
};

const sendValidationError = (req, res, errors = [], redirectTo = null) => {
    const list = Array.isArray(errors) ? errors : [{ field: "general", message: String(errors) }];

    if (req.accepts("json") && !req.accepts("html")) {
        return res.status(422).json({
            success: false,
            message: "Validation failed.",
            errors: list,
        });
    }

    const first = list[0]?.message || "Validation failed. Please check your input.";
    req.flash("error", first);
    return res.redirect(redirectTo || req.get("Referer") || "/");
};

const sendBadRequest = (req, res, message, field = "general", redirectTo = null) => {
    return sendValidationError(req, res, [{ field, message }], redirectTo);
};

const createValidator = () => {
    const errors = [];

    return {
        check(condition, field, message) {
            if (!condition) errors.push({ field, message });
            return this;
        },
        checkAsync: async function (asyncFn, field, message) {
            try {
                const result = await asyncFn();
                if (!result) errors.push({ field, message });
            } catch {
                errors.push({ field, message });
            }
            return this;
        },
        hasErrors:  () => errors.length > 0,
        errors,
    };
};

const logError = (context, error) => {
    if (process.env.NODE_ENV !== "production") {
        console.error(`[ERROR] ${context}:`, error);
    } else {
        console.error(`[ERROR] ${context}: ${error?.message ?? "Unknown error"}`);
    }
};

const sendServerError = (req, res, error, context = "Unknown") => {
    logError(context, error);

    const message =
        process.env.NODE_ENV === "production"
            ? "Something went wrong. Please try again later."
            : (error?.message || "Internal Server Error");

    if (req.accepts("json") && !req.accepts("html")) {
        return res.status(500).json({ success: false, message });
    }

    req.flash("error", "Something went wrong. Please try again.");
    return res.redirect(req.get("Referer") || "/");
};

module.exports = { makeFieldError, sendValidationError, sendBadRequest, createValidator, logError, sendServerError,};
