const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

const envPath = path.resolve(__dirname, "../../.env");

let lastEnvMtime = 0;

const refreshEnv = () => {
    try {
        if (fs.existsSync(envPath)) {
            const stats = fs.statSync(envPath);
            if (stats.mtimeMs !== lastEnvMtime) {
                lastEnvMtime = stats.mtimeMs;
                const envConfig = dotenv.parse(fs.readFileSync(envPath));
                if (envConfig && Object.prototype.hasOwnProperty.call(envConfig, "FILE_UPLOAD_ENABLED")) {
                    process.env.FILE_UPLOAD_ENABLED = envConfig.FILE_UPLOAD_ENABLED;
                }
            }
        }
    } catch (_) {}
};

const isFileUploadEnabled = () => {
    refreshEnv();
    const val = process.env.FILE_UPLOAD_ENABLED;
    if (typeof val !== "string") return false;
    return val.trim().toLowerCase() === "true";
};

const fileUploadGuard = (req, res, next) => {
    if (isFileUploadEnabled()) {
        return next();
    }

    const contentType = (req.headers["content-type"] || "").toLowerCase();
    const isMultipart = contentType.includes("multipart/form-data");
    const targetUrl = req.originalUrl || req.url || req.path || "";
    const isExplicitUploadRoute = Boolean(
        req.isDedicatedUploadRoute ||
        targetUrl.includes("/media") ||
        targetUrl.includes("/api/import/") ||
        targetUrl.includes("/settings/documents") ||
        targetUrl.includes("/settings/upi-qr") ||
        targetUrl.includes("/fees/school-qr/submit") ||
        targetUrl.includes("/profile/document/upload")
    );

    if (isMultipart || isExplicitUploadRoute) {
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
        }

        if (req.flash) {
            req.flash("error", "File uploads are currently disabled.");
        }

        if (req.get("Referrer")) {
            return res.redirect("back");
        }

        return res.status(403).render("errors/403", {
            message: "File uploads are currently disabled."
        });
    }

    return next();
};

module.exports = { isFileUploadEnabled, fileUploadGuard };