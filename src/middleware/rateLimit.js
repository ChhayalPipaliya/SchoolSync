const { getRedisClient } = require("../config/redis");
const { queryAsync } = require("../config/database");

const inMemoryBuckets = new Map();

// Helper to clean up in-memory fallback
const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of inMemoryBuckets.entries()) {
        if (now > bucket.resetAt) {
            inMemoryBuckets.delete(key);
        }
    }
}, 5 * 60 * 1000);

if (typeof cleanupInterval.unref === "function") {
    cleanupInterval.unref();
}

// Periodically clean up database-backed rate limits
const dbCleanupInterval = setInterval(async () => {
    try {
        const now = Date.now();
        await queryAsync("DELETE FROM rate_limits WHERE reset_at < ?", [now]);
    } catch (err) {
        console.error("[RateLimiter] Failed to clean up expired database rate limits:", err.message);
    }
}, 10 * 60 * 1000);

if (typeof dbCleanupInterval.unref === "function") {
    dbCleanupInterval.unref();
}

const getClientKey = (req) => {
    return req.ip || "unknown";
};

// Retrieve rate limit state atomically using Redis (if active), MySQL (as shared fallback), or in-memory Map
const getRateLimitState = async (key, windowMs) => {
    const now = Date.now();

    // 1. Try Redis first
    const redisClient = getRedisClient();
    if (redisClient) {
        try {
            const luaScript = `
                local key = KEYS[1]
                local windowMs = tonumber(ARGV[1])
                local current = redis.call('get', key)
                if not current then
                    redis.call('set', key, 1, 'PX', windowMs)
                    return {1, windowMs}
                else
                    local count = redis.call('incr', key)
                    local ttl = redis.call('pttl', key)
                    if ttl < 0 then
                        redis.call('pexpire', key, windowMs)
                        ttl = windowMs
                    end
                    return {count, ttl}
                end
            `;
            const result = await redisClient.eval(luaScript, {
                keys: [key],
                arguments: [String(windowMs)]
            });
            const count = Number(result[0]);
            const ttl = Number(result[1]);
            return {
                count,
                resetAt: now + (ttl > 0 ? ttl : windowMs)
            };
        } catch (err) {
            console.error("[RateLimiter] Redis operation failed, falling back to Database:", err.message);
        }
    }

    // 2. Try MySQL Database
    try {
        const resetAt = now + windowMs;
        // Atomic insert / conditional update
        await queryAsync(
            `INSERT INTO rate_limits (\`key\`, \`count\`, \`reset_at\`)
             VALUES (?, 1, ?)
             ON DUPLICATE KEY UPDATE
               \`count\` = IF(? > \`reset_at\`, 1, \`count\` + 1),
               \`reset_at\` = IF(? > \`reset_at\`, ?, \`reset_at\`)`,
            [key, resetAt, now, now, resetAt]
        );

        // Fetch the updated count and reset timestamp
        const rows = await queryAsync(
            "SELECT `count`, `reset_at` FROM rate_limits WHERE `key` = ? LIMIT 1",
            [key]
        );
        if (rows.length > 0) {
            return {
                count: Number(rows[0].count),
                resetAt: Number(rows[0].reset_at)
            };
        }
    } catch (err) {
        console.error("[RateLimiter] Database operation failed, falling back to In-Memory:", err.message);
    }

    // 3. Try In-Memory Map
    const bucket = inMemoryBuckets.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > bucket.resetAt) {
        bucket.count = 0;
        bucket.resetAt = now + windowMs;
    }
    bucket.count += 1;
    inMemoryBuckets.set(key, bucket);
    return bucket;
};

const createRateLimiter = ({ windowMs, max, message = "Too many requests. Please try again later.", keyPrefix = "", keyFn = null }) => {
    return async (req, res, next) => {
        try {
            const now = Date.now();
            const clientId = keyFn ? keyFn(req) : getClientKey(req);
            const key = `${keyPrefix}:${req.path}:${clientId}`;
            const { count, resetAt } = await getRateLimitState(key, windowMs);

            res.setHeader("X-RateLimit-Limit", max);
            res.setHeader("X-RateLimit-Remaining", Math.max(0, max - count));
            res.setHeader("X-RateLimit-Reset", Math.ceil(resetAt / 1000));

            if (count > max) {
                res.setHeader("Retry-After", Math.ceil((resetAt - now) / 1000));
                return res.status(429).json({
                    success: false,
                    message,
                });
            }
            return next();
        } catch (err) {
            console.error("[RateLimiter] Middleware error:", err);
            return next(); // Fail-open on general errors to ensure user access
        }
    };
};

const createRedirectRateLimiter = ({ windowMs, max, message, keyPrefix, redirectTo }) => {
    return async (req, res, next) => {
        try {
            const clientId = getClientKey(req);
            const key = `${keyPrefix}:${req.path}:${clientId}`;
            const { count } = await getRateLimitState(key, windowMs);

            if (count > max) {
                req.flash("error", message);
                return res.redirect(typeof redirectTo === "function" ? redirectTo(req) : redirectTo);
            }
            return next();
        } catch (err) {
            console.error("[RedirectRateLimiter] Middleware error:", err);
            return next();
        }
    };
};

const loginLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: "Too many login attempts. Please wait 15 minutes before trying again.",
    keyPrefix: "login",
});

const otpLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 6,
    message: "Too many OTP requests. Please wait before trying again.",
    keyPrefix: "otp",
});

const passwordResetLimiter = createRateLimiter({
    windowMs: 30 * 60 * 1000,
    max: 5,
    message: "Too many password reset requests. Please try again later.",
    keyPrefix: "reset",
});

const apiLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 100,
    message: "API rate limit exceeded. Please slow down your requests.",
    keyPrefix: "api",
});

const uploadLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 20,
    message: "Too many file uploads. Please wait before uploading again.",
    keyPrefix: "upload",
});

const registrationLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 3,
    message: "Too many registration attempts from this IP. Please try again later.",
    keyPrefix: "register",
});



const supportLimiter = createRedirectRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: "Too many support requests from this connection. Please wait 15 minutes and try again, or email us directly.",
    keyPrefix: "support",
    redirectTo: "/support",
});

const demoLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: "Too many demo requests from this IP. Please try again later.",
    keyPrefix: "demo",
});

const sosLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 3,
    message: "Too many SOS requests. Wait briefly before sending another alert.",
    keyPrefix: "transport-sos",
    keyFn: (req) => req.user?.id || getClientKey(req)
});

const makeAdmissionLimiter = (redirectTo) => createRedirectRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: "Too many submissions from this connection. Please try again later or contact the school directly.",
    keyPrefix: "admission",
    redirectTo,
});

module.exports = { createRateLimiter, createRedirectRateLimiter, loginLimiter, otpLimiter, passwordResetLimiter, apiLimiter, uploadLimiter, registrationLimiter, supportLimiter, demoLimiter, sosLimiter, makeAdmissionLimiter };
