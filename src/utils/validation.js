const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STRONG_PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

const normalizeText = (value) => {
    if (typeof value !== "string") {
        return "";
    }
    return value.trim();
};

const normalizeNullableText = (value) => {
    const normalized = normalizeText(value);
    return normalized || null;
};

const normalizeEmail = (value) => normalizeText(value).toLowerCase();
const isValidEmail = (value) => EMAIL_REGEX.test(normalizeEmail(value));
const isStrongPassword = (value) => STRONG_PASSWORD_REGEX.test(normalizeText(value));

const slugify = (value) => normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

const normalizeDateInput = (value) => {
    const normalized = normalizeText(value);

    if (!normalized) {
        return null;
    }

    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : normalized;
};

const normalizeInteger = (value) => {
    if (value === null || typeof value === "undefined" || value === "") {
        return null;
    }

    const parsed = Number.parseInt(String(value), 10);
    return Number.isNaN(parsed) ? null : parsed;
};

module.exports = { isStrongPassword, isValidEmail, normalizeDateInput, normalizeEmail, normalizeInteger, normalizeNullableText, normalizeText, slugify };