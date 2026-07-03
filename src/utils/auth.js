const jwt = require("jsonwebtoken");
const {
    JWT_EXPIRY_DEFAULT,
    JWT_EXPIRY_REMEMBER,
    COOKIE_MAXAGE_DEFAULT,
    COOKIE_MAXAGE_REMEMBER
} = require("../config/constants");

const AUTH_COOKIE_NAME = "token";

const getJwtSecret = () => {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        if (process.env.NODE_ENV === "production") {
            throw new Error("JWT_SECRET is required in environment variables");
        }
        console.warn("[Auth] JWT_SECRET is not set. Using development-only fallback secret.");
        return "schoolsync-development-jwt-secret";
    }
    return secret;
};

const parseUserImages = (imageValue) => {
    if (!imageValue) {
        return [];
    }

    if (Array.isArray(imageValue)) {
        return imageValue;
    }

    try {
        const parsed = JSON.parse(imageValue);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
};

const buildJwtPayload = (user) => ({
    id: user.id,
    first_name: user.first_name || user.first_name,
    last_name: user.last_name || user.last_name,
    email: user.email,
    role: user.role,
    school_id: user.school_id || null
});

const signAuthToken = (user, options = {}) => {
    const rememberMe = Boolean(options.rememberMe);

    return jwt.sign(buildJwtPayload(user), getJwtSecret(), {
        expiresIn: rememberMe ? JWT_EXPIRY_REMEMBER : JWT_EXPIRY_DEFAULT
    });
};

const getDashboardPath = (role) => {
    switch (role) {
        case "super_admin":
            return "/superadmin/dashboard";
        case "group_admin":
            return "/groupadmin/dashboard";
        case "school_admin":
            return "/schooladmin/dashboard";
        case "teacher":
            return "/teacher/dashboard";
        case "student":
            return "/student/dashboard";
        case "driver":
            return "/driver/dashboard";
        case "librarian":
            return "/librarian/dashboard";
        case "parent":
            return "/parent/dashboard";
        default:
            return "/";
    }
};

const getAuthCookieOptions = (rememberMe = false) => ({
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: rememberMe ? COOKIE_MAXAGE_REMEMBER : COOKIE_MAXAGE_DEFAULT
});

const clearAuthCookie = (res) => {
    res.clearCookie(AUTH_COOKIE_NAME, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production"
    });
};

const sanitizeUserForClient = (user) => ({
    id: user.id,
    first_name: user.first_name || user.first_name,
    last_name: user.last_name || user.last_name,
    email: user.email,
    image: parseUserImages(user.image),
    role: user.role,
    school_id: user.school_id || null
});

module.exports = { AUTH_COOKIE_NAME, buildJwtPayload, clearAuthCookie, getDashboardPath, getAuthCookieOptions, getJwtSecret, parseUserImages, sanitizeUserForClient, signAuthToken};
