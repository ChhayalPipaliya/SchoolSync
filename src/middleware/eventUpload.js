const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { createRateLimiter } = require("./rateLimit");

// Ensure uploads folder exists
const protectedUploadsDir = path.join(__dirname, "../public/uploads");
if (!fs.existsSync(protectedUploadsDir)) {
    fs.mkdirSync(protectedUploadsDir, { recursive: true });
}

// Disk Storage configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, protectedUploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, `event-media-${uniqueSuffix}${path.extname(file.originalname).toLowerCase()}`);
    }
});

// Extension and MIME validation
const mimeToExtensions = {
    // Images
    "image/jpeg": [".jpg", ".jpeg"],
    "image/jpg": [".jpg", ".jpeg"],
    "image/png": [".png"],
    "image/webp": [".webp"],
    // Videos
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
    }
};

// Multer instances
const eventUploadRaw = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB maximum (videos are up to 50MB, images checked individually in handler/validator)
    }
});

// Helper to get client key for rate limit
const getClientKey = (req) => {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
        return forwarded.split(",")[0].trim();
    }
    return req.ip || "unknown";
};

// Rate limiter: 10 uploads per 5 minutes per user
const eventUploadLimiter = createRateLimiter({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10,
    message: "Rate limit exceeded. You can only perform 10 uploads per 5 minutes.",
    keyPrefix: "event_upload",
    keyFn: (req) => (req.user ? req.user.id : getClientKey(req))
});

// Custom wrapper to include rate limiting before multer execution
const eventUpload = {
    single: (fieldname) => [eventUploadLimiter, eventUploadRaw.single(fieldname)],
    array: (fieldname, maxCount) => [eventUploadLimiter, eventUploadRaw.array(fieldname, maxCount)],
    fields: (fields) => [eventUploadLimiter, eventUploadRaw.fields(fields)],
    any: () => [eventUploadLimiter, eventUploadRaw.any()]
};

/**
 * Validates the file signature (magic numbers) of a file on disk.
 * Supports jpg/jpeg, png, webp, mp4, mov, avi.
 * @param {string} filePath - Absolute path to the file
 * @returns {Promise<boolean>} Resolves to true if magic numbers match extension, false otherwise
 */
async function validateMagicNumbers(filePath) {
    let fileHandle;
    try {
        fileHandle = await fs.promises.open(filePath, "r");
        const buffer = Buffer.alloc(12);
        const { bytesRead } = await fileHandle.read(buffer, 0, 12, 0);
        if (bytesRead < 4) return false;

        const hex = buffer.toString("hex", 0, bytesRead).toLowerCase();

        // 1. JPEG: ffd8ff
        if (hex.startsWith("ffd8ff")) {
            return true;
        }
        // 2. PNG: 89504e47
        if (hex.startsWith("89504e47")) {
            return true;
        }
        // 3. WebP: 52494646 (RIFF) ... 57454250 (WEBP)
        if (hex.startsWith("52494646") && hex.substring(16, 24) === "57454250") {
            return true;
        }
        // 4. MP4: ftyp at offset 4 (hex starting with anything, but bytes 4-7 are 66747970)
        if (bytesRead >= 8 && hex.substring(8, 16) === "66747970") {
            return true;
        }
        // 5. MOV: ftypqt or moov (typically ftypqt at offset 4, i.e. hex bytes 4-7 are 667479707174 or starts with moov/free/wide)
        if (bytesRead >= 8 && (hex.substring(8, 16) === "6d6f6f76" || hex.substring(8, 16) === "66726565" || hex.substring(8, 20) === "667479707174")) {
            return true;
        }
        // 6. AVI: RIFF at offset 0 (52494646) and AVI  at offset 8 (41564920)
        if (hex.startsWith("52494646") && hex.substring(16, 24) === "41564920") {
            return true;
        }

        return false;
    } catch (err) {
        console.error("Magic numbers validation error:", err);
        return false;
    } finally {
        if (fileHandle) {
            await fileHandle.close();
        }
    }
}

module.exports = {
    eventUpload,
    validateMagicNumbers,
    protectedUploadsDir
};
