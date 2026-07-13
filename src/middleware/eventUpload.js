const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { createRateLimiter } = require("./rateLimit");

const protectedUploadsDir = path.join(__dirname, "../../storage/uploads");
if (!fs.existsSync(protectedUploadsDir)) {
    fs.mkdirSync(protectedUploadsDir, { recursive: true });
};

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, protectedUploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, `event-media-${uniqueSuffix}${path.extname(file.originalname).toLowerCase()}`);
    }
});

const mimeToExtensions = {
    "image/jpeg": [".jpg", ".jpeg"],
    "image/jpg": [".jpg", ".jpeg"],
    "image/png": [".png"],
    "image/webp": [".webp"],
    "video/mp4": [".mp4"],
    "video/quicktime": [".mov"],
    "video/x-msvideo": [".avi"],
    "video/avi": [".avi"]
};

const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExtensions = mimeToExtensions[file.mimetype];
    if (allowedExtensions && allowedExtensions.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error("Invalid file type. Allowed: jpg, jpeg, png, webp, mp4, mov, avi"), false);
    };
};

const eventUploadRaw = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 50 * 1024 * 1024
    }
});

const eventUploadLimiter = createRateLimiter({
    windowMs: 5 * 60 * 1000,
    max: 10,
    message: "Rate limit exceeded. You can only perform 10 uploads per 5 minutes.",
    keyPrefix: "event_upload",
    keyFn: (req) => (req.user && req.user.id ? req.user.id : (req.ip || "unknown"))
});

const eventUpload = {
    single: (fieldname) => [eventUploadLimiter, eventUploadRaw.single(fieldname)],
    array: (fieldname, maxCount) => [eventUploadLimiter, eventUploadRaw.array(fieldname, maxCount)],
    fields: (fields) => [eventUploadLimiter, eventUploadRaw.fields(fields)],
    any: () => [eventUploadLimiter, eventUploadRaw.any()]
};

async function validateMagicNumbers(filePath) {
    let fileHandle;
    try {
        fileHandle = await fs.promises.open(filePath, "r");
        const buffer = Buffer.alloc(12);
        const { bytesRead } = await fileHandle.read(buffer, 0, 12, 0);
        if (bytesRead < 4) return false;

        const hex = buffer.toString("hex", 0, bytesRead).toLowerCase();

        if (hex.startsWith("ffd8ff")) {
            return true;
        };

        if (hex.startsWith("89504e47")) {
            return true;
        };
        if (hex.startsWith("52494646") && hex.substring(16, 24) === "57454250") {
            return true;
        };
        if (bytesRead >= 8 && hex.substring(8, 16) === "66747970") {
            return true;
        };
        if (bytesRead >= 8 && (hex.substring(8, 16) === "6d6f6f76" || hex.substring(8, 16) === "66726565" || hex.substring(8, 20) === "667479707174")) {
            return true;
        };
        if (hex.startsWith("52494646") && hex.substring(16, 24) === "41564920") {
            return true;
        };
        return false;
    } catch (err) {
        console.error("Magic numbers validation error:", err);
        return false;
    } finally {
        if (fileHandle) {
            await fileHandle.close();
        };
    };
};

module.exports = { eventUpload, validateMagicNumbers, protectedUploadsDir};