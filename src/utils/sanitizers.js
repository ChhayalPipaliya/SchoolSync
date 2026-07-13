const path = require("path");

const trim = (v) => (typeof v === "string" ? v.trim() : "");
const toNullable = (v) => trim(v) || null;
const toLowerCase = (v) => trim(v).toLowerCase();
const toUpperCase = (v) => trim(v).toUpperCase();
const normalizeEmail = (v) => toLowerCase(v);
const toInt = (v) => {
    const n = parseInt(String(v ?? ""), 10);
    return isNaN(n) ? null : n;
};
const toFloat = (v) => {
    const n = parseFloat(String(v ?? ""));
    return isNaN(n) ? null : n;
};

const toBool = (v) => ["1", "true", "yes", "on"].includes(String(v ?? "").toLowerCase());
const slugify = (v) =>
    trim(v)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/-{2,}/g, "-");

const stripTags = (v) => trim(v).replace(/<[^>]*>/g, "");

const sanitizeBody = (obj = {}) => {
    const clean = {};
    for (const [key, val] of Object.entries(obj)) {
        if (typeof val === "string") {
            clean[key] = stripTags(val);
        } else if (Array.isArray(val)) {
            clean[key] = val.map((v) => (typeof v === "string" ? stripTags(v) : v));
        } else {
            clean[key] = val;
        };
    };
    return clean;
};

const normalizeDate = (v) => {
    const s = trim(v);
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : s;
};

const normalizeAadhaar = (v) => String(v ?? "").replace(/\D/g, "").slice(0, 12);
const normalizePAN = (v) => trim(v).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
const normalizePhone = (v) => String(v ?? "").replace(/\D/g, "").slice(-10);
const normalizePincode = (v) => String(v ?? "").replace(/\D/g, "").slice(0, 6);
const normalizeIFSC = (v) => trim(v).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11);

const sanitizeFilename = (originalName) => {
    const base = path.basename(originalName ?? "unknown");
    const safe = base.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-{2,}/g, "-");
    return `${Date.now()}-${safe}`;
};

const pickFields = (body = {}, allowed = []) => {
    const result = {};
    for (const key of allowed) {
        if (key in body) {
            result[key] = body[key];
        };
    };
    return result;
};

const omitFields = (body = {}, blocked = ["role", "school_id", "id", "password", "is_admin", "is_active"]) => {
    const result = { ...body };
    for (const key of blocked) {
        delete result[key];
    };
    return result;
};

const clamp = (v, min, max) => Math.min(Math.max(Number(v) || 0, min), max);

module.exports = { trim, toNullable, toLowerCase, toUpperCase, normalizeEmail, toInt, toFloat, toBool, slugify, stripTags, sanitizeBody, normalizeDate, normalizeAadhaar, normalizePAN, normalizePhone, normalizePincode, normalizeIFSC, sanitizeFilename, pickFields, omitFields, clamp };