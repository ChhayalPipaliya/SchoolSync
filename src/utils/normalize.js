const normalizeText = (v) => (typeof v === "string" ? v.trim() : "");
const normalizeNullableText = (v) => normalizeText(v) || null;
const normalizeEmail = (v) => normalizeText(v).toLowerCase();
const normalizeName  = (v) => {
    return normalizeText(v)
        .split(/\s+/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ");
};

const normalizeInteger = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = parseInt(String(v), 10);
    return isNaN(n) ? null : n;
};

const normalizeFloat = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = parseFloat(String(v));
    return isNaN(n) ? null : n;
};

const normalizePositiveInt = (v) => {
    const n = normalizeInteger(v);
    return n !== null && n > 0 ? n : null;
};

const normalizeBool = (v) => ["1", "true", "yes", "on", true, 1].includes(v) ? 1 : 0;

const normalizeDate = (v) => {
    const s = normalizeText(v);
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : s;
};

const toISODate = (v) => {
    const d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split("T")[0];
};

const normalizePhone  = (v) => String(v ?? "").replace(/\D/g, "").slice(-10) || null;
const normalizeAadhaar = (v) => String(v ?? "").replace(/\D/g, "").slice(0, 12) || null;
const normalizePAN = (v) => normalizeText(v).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || null;
const normalizePincode = (v) => String(v ?? "").replace(/\D/g, "").slice(0, 6) || null;
const normalizeIFSC = (v) => normalizeText(v).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11) || null;
const normalizeGST = (v) => normalizeText(v).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15) || null;

const normalizeEnum = (v, allowed = []) => {
    const normalized = normalizeText(String(v ?? "")).toLowerCase();
    return allowed.includes(normalized) ? normalized : null;
};

const slugify = (v) =>
    normalizeText(v)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/-{2,}/g, "-");

const toArray = (v) => (Array.isArray(v) ? v : v != null ? [v] : []);

const csvToArray = (v) =>
    String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

module.exports = {
    normalizeText, normalizeNullableText, normalizeEmail, normalizeName,
    normalizeInteger, normalizeFloat, normalizePositiveInt,
    normalizeBool,
    normalizeDate, toISODate,
    normalizePhone, normalizeAadhaar, normalizePAN, normalizePincode, normalizeIFSC, normalizeGST,
    normalizeEnum,
    slugify,
    toArray, csvToArray,
};
