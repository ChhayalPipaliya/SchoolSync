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

        if (error.status === 403 || error.statusCode === 403 || error.message?.toLowerCase().includes('forbidden')) {
            if (req.accepts("json") && !req.accepts("html")) {
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