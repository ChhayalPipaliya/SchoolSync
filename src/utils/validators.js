const isValidAadhaar = (v) => {
    const raw = String(v ?? "").trim();
    if (!raw) return true;
    return raw.replace(/\D/g, "").length === 12;
};
const isValidPAN = (v) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(String(v ?? "").trim().toUpperCase());
const isValidGST = (v) => /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(String(v ?? "").trim().toUpperCase());
const isValidIFSC = (v) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(v ?? "").trim().toUpperCase());
const isValidPincode = (v) => {
    const raw = String(v ?? "").trim();
    if (!raw) return true;
    return raw.replace(/\D/g, "").length === 6;
};
const isValidPhone = (v) => {
    const raw = String(v ?? "").trim();
    if (!raw) return true;

    const cleaned = raw.replace(/\D/g, "");
    if (!cleaned) return false;

    if (cleaned.length === 10) return true;
    if (cleaned.length === 11 && cleaned.startsWith("0")) return true;
    if (cleaned.length === 12 && cleaned.startsWith("91")) return true;

    return false;
};

const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v ?? "").trim().toLowerCase());
const isValidURL = (v) => {
    try {
        const url = new URL(String(v ?? "").trim());
        return ["http:", "https:"].includes(url.protocol);
    } catch {
        return false;
    };
};

const isStrongPassword = (v) => /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/.test(String(v ?? ""));
const isAcceptablePassword = (v) => /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(String(v ?? ""));
const isValidDate = (v) => {
    if (!v) return false;
    const d = new Date(v);
    return !isNaN(d.getTime());
};

const isValidAge = (dob, min = 3, max = 120) => {
    if (!isValidDate(dob)) return false;
    const today = new Date();
    const birth = new Date(dob);
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age >= min && age <= max;
};

const isNotFutureDate = (v) => {
    if (!isValidDate(v)) return false;
    return new Date(v) <= new Date();
};

const isAlphaName = (v) => /^[A-Za-z\s'-]+$/.test(String(v ?? "").trim());
const isAlphanumeric = (v) => /^[A-Za-z0-9\s]+$/.test(String(v ?? "").trim());
const hasMinLength = (v, min) => String(v ?? "").trim().length >= min;
const hasMaxLength = (v, max) => String(v ?? "").trim().length <= max;
const isInRange = (v, min, max) => {
    const n = Number(v);
    return !isNaN(n) && n >= min && n <= max;
};

const isPositiveInt = (v) => Number.isInteger(Number(v)) && Number(v) > 0;
const isNonNegative = (v) => !isNaN(Number(v)) && Number(v) >= 0;
const isValidEnum = (v, allowedValues = []) => allowedValues.includes(v);
const isSafeId = (v) => Number.isInteger(Number(v)) && Number(v) > 0;
const hasSchoolId = (user) => Boolean(user?.school_id) && isSafeId(user.school_id);


const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"]);
const ALLOWED_DOC_MIMES = new Set(["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
const ALLOWED_ALL_MIMES = new Set([...ALLOWED_IMAGE_MIMES, ...ALLOWED_DOC_MIMES]);
const DANGEROUS_EXTENSIONS = new Set([".exe", ".sh", ".bat", ".cmd", ".php", ".py", ".rb", ".js", ".ts", ".msi", ".dll", ".jar", ".vbs", ".ps1"]);
const isAllowedMimeType = (mime, allowed = ALLOWED_ALL_MIMES) => allowed.has(mime?.toLowerCase());
const isAllowedFileSize = (bytes, maxMB = 5) => bytes <= maxMB * 1024 * 1024;

const hasDangerousExtension = (filename) => {
    const ext = require("path").extname(filename ?? "").toLowerCase();
    return DANGEROUS_EXTENSIONS.has(ext);
};

const hasDoubleExtension = (filename) => {
    const parts = (filename ?? "").split(".");
    return parts.length > 2;
};

module.exports = { isValidAadhaar, isValidPAN, isValidGST, isValidIFSC, isValidPincode, isValidPhone, isValidEmail, isValidURL, isStrongPassword, isAcceptablePassword, isValidDate, isValidAge, isNotFutureDate, isAlphaName, isAlphanumeric, hasMinLength, hasMaxLength, isInRange, isPositiveInt, isNonNegative, isValidEnum, isSafeId, hasSchoolId, ALLOWED_IMAGE_MIMES, ALLOWED_DOC_MIMES, ALLOWED_ALL_MIMES, isAllowedMimeType, isAllowedFileSize, hasDangerousExtension, hasDoubleExtension, };