const path = require("path");
const fs   = require("fs");

const ALLOWED_IMAGE_MIMES = new Set([
    "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif",
]);

const ALLOWED_DOC_MIMES = new Set([
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const ALLOWED_ALL_MIMES = new Set([...ALLOWED_IMAGE_MIMES, ...ALLOWED_DOC_MIMES]);

const DANGEROUS_EXTENSIONS = new Set([
    ".exe", ".sh", ".bat", ".cmd", ".php", ".php3", ".php4", ".php5",
    ".phtml", ".py", ".rb", ".pl", ".cgi", ".asp", ".aspx", ".jsx",
    ".ts", ".tsx", ".js", ".mjs", ".msi", ".dll", ".jar", ".vbs",
    ".ps1", ".psm1", ".htaccess", ".htpasswd",
]);

const isAllowedMime = (mime, allowed = ALLOWED_ALL_MIMES) => allowed.has((mime ?? "").toLowerCase());

const hasDangerousExtension = (filename) => {
    const ext = path.extname(filename ?? "").toLowerCase();
    return DANGEROUS_EXTENSIONS.has(ext);
};

const hasDoubleExtension = (filename) => {
    const base = path.basename(filename ?? "");
    return base.split(".").length > 2;
};

const hasPathTraversal = (filename) => /(\.\.|\/|\\)/.test(filename ?? "");
const isAllowedSize = (bytes, maxMB = 5) => bytes <= maxMB * 1024 * 1024;

const sanitizeFilename = (originalName) => {
    const base = path.basename(originalName ?? "file");
    const safe = base
        .replace(/[^a-zA-Z0-9._-]/g, "-")
        .replace(/-{2,}/g, "-")
        .toLowerCase();
    return `${Date.now()}-${safe}`;
};

const validateUploadedFile = (file, { allowed = ALLOWED_ALL_MIMES, maxMB = 5 } = {}) => {
    if (!file) return { valid: false, reason: "No file provided." };

    if (hasPathTraversal(file.originalname))
        return { valid: false, reason: "Filename contains invalid characters." };

    if (hasDangerousExtension(file.originalname))
        return { valid: false, reason: "File type not permitted." };

    if (hasDoubleExtension(file.originalname))
        return { valid: false, reason: "File has multiple extensions." };

    if (!isAllowedMime(file.mimetype, allowed))
        return { valid: false, reason: `Unsupported file type: ${file.mimetype}.` };

    if (!isAllowedSize(file.size, maxMB))
        return { valid: false, reason: `File exceeds the ${maxMB}MB size limit.` };

    return { valid: true };
};

const ensureUploadDir = (dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    }
};

const deleteFile = (absolutePath) => {
    if (absolutePath && fs.existsSync(absolutePath)) {
        fs.unlinkSync(absolutePath);
    }
};

module.exports = { ALLOWED_IMAGE_MIMES, ALLOWED_DOC_MIMES, ALLOWED_ALL_MIMES, DANGEROUS_EXTENSIONS, isAllowedMime, hasDangerousExtension, hasDoubleExtension, hasPathTraversal, isAllowedSize, sanitizeFilename, validateUploadedFile, ensureUploadDir, deleteFile,};
