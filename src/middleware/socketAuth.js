const jwt = require("jsonwebtoken");
const { AUTH_COOKIE_NAME, getJwtSecret } = require("../utils/auth");
const { queryAsync } = require("../config/database");

const parseCookies = (cookieHeader) => {
    const list = {};
    if (!cookieHeader) return list;
    cookieHeader.split(";").forEach((cookie) => {
        const parts = cookie.split("=");
        list[parts.shift().trim()] = decodeURIComponent(parts.join("="));
    });
    return list;
};

module.exports = async (socket, next) => {
    try {
        let token = null;

        const authHeader = socket.handshake.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
            token = authHeader.substring(7);
        };

        if (!token) {
            const cookies = parseCookies(socket.handshake.headers.cookie);
            token = cookies[AUTH_COOKIE_NAME] || null;
        };

        if (!token && socket.handshake.auth) {
            token = socket.handshake.auth.token || null;
        };

        if (!token) {
            console.warn("[Socket Auth Warning] Connection rejected: no authentication token found.");
            return next(new Error("Authentication error: No token found."));
        };

        const decoded = jwt.verify(token, getJwtSecret());
        const users = await queryAsync(
            "SELECT id, first_name, last_name, email, role, school_id, status, deleted_at FROM users WHERE id = ? LIMIT 1",
            [decoded.id]
        );
        const user = users[0];
        if (!user || user.deleted_at || (user.status && user.status !== "active")) {
            return next(new Error("Authentication error: User is not active."));
        };

        socket.user = {
            id: user.id,
            first_name: user.first_name,
            last_name: user.last_name,
            email: user.email,
            role: user.role,
            school_id: user.school_id
        };
        next();
    } catch (err) {
        console.error("Socket authentication failed:", err.message || String(err));
        next(new Error("Authentication error: Invalid token."));
    };
};
