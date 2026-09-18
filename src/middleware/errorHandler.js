const handleNotFound = (req, res) => {
    try {
        if (req.accepts("json") && !req.accepts("html")) {
            return res.status(404).json({
                success: false,
                message: "Route not found"
            });
        };
        return res.status(404).render("errors/404", {
            title: "Page Not Found",
            message: "The page you requested was not found.",
            errorCode: "404"
        });
    } catch (error) {
        console.error("NotFound Handler Error:", error);
        return res.status(500).send("Internal Server Error");
    };
};

const handleError = (error, req, res, next) => {
    try {
        console.error("Global Error:", error);
        if (res.headersSent) {
            return next(error);
        };

        if (error.code === 'LIMIT_FILE_SIZE' || error.name === 'MulterError') {
            const limitMsg = "File size limit exceeded. Maximum file size allowed is 5MB.";
            if (req.accepts("json") && !req.accepts("html")) {
                return res.status(400).json({
                    success: false,
                    message: limitMsg
                });
            };
            if (req.flash) {
                req.flash("error", limitMsg);
            };
            return res.redirect("back");
        };

        if (error.code === 'FILE_UPLOADS_DISABLED' || error.message === 'File uploads are currently disabled.') {
            const isJson = Boolean(
                req.xhr ||
                req.headers["x-requested-with"] === "XMLHttpRequest" ||
                (req.headers.accept && req.headers.accept.includes("application/json")) ||
                (req.path && (req.path.startsWith("/api/") || req.path.includes("/api/"))) ||
                !(req.headers.accept && req.headers.accept.includes("text/html"))
            );
            if (isJson) {
                return res.status(403).json({
                    success: false,
                    message: "File uploads are currently disabled."
                });
            };
            if (req.flash) {
                req.flash("error", "File uploads are currently disabled.");
            };
            if (req.get("Referrer")) {
                return res.redirect("back");
            };
            return res.status(403).render("errors/403", {
                message: "File uploads are currently disabled."
            });
        };

        if (error.status === 403 || error.statusCode === 403 || error.message?.toLowerCase().includes('forbidden')) {
            const isJson = Boolean(
                req.xhr ||
                req.headers["x-requested-with"] === "XMLHttpRequest" ||
                (req.headers.accept && req.headers.accept.includes("application/json")) ||
                (req.path && (req.path.startsWith("/api/") || req.path.includes("/api/"))) ||
                !(req.headers.accept && req.headers.accept.includes("text/html"))
            );
            if (isJson) {
                return res.status(403).json({
                    success: false,
                    message: error.message || "Access forbidden"
                });
            };
            return res.status(403).render("errors/403", {
                message: error.message || "You don't have permission to access this resource."
            });
        };

        const isProduction = process.env.NODE_ENV === 'production';
        const displayMessage = isProduction ? "Something went wrong. Please try again later." : (error.message || "Something went wrong. Please try again later.");

        if (req.accepts("json") && !req.accepts("html")) {
            return res.status(500).json({
                success: false,
                message: displayMessage
            });
        };

        return res.status(500).render("errors/500", {
            message: displayMessage
        });
    } catch (err) {
        console.error("Error Handler Failed:", err);
        return res.status(500).send("Critical Server Error");
    };
};

module.exports = { handleError, handleNotFound };