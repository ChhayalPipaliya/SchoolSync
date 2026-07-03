const buckets = new Map();

setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, bucket] of buckets.entries()) {
    if (now > bucket.resetAt) {
      buckets.delete(key);
      cleaned++;
    }
  }
}, 5 * 60 * 1000);

const getClientKey = (req) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || "unknown";
};

const createRateLimiter = ({
  windowMs,
  max,
  message = "Too many requests. Please try again later.",
  keyPrefix = "",
  keyFn = null,
}) => {
  return (req, res, next) => {
    const now = Date.now();
    const clientId = keyFn ? keyFn(req) : getClientKey(req);
    const key = `${keyPrefix}:${req.path}:${clientId}`;
    const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }

    bucket.count += 1;
    buckets.set(key, bucket);

    res.setHeader("X-RateLimit-Limit", max);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, max - bucket.count));
    res.setHeader("X-RateLimit-Reset", Math.ceil(bucket.resetAt / 1000));

    if (bucket.count > max) {
      res.setHeader("Retry-After", Math.ceil((bucket.resetAt - now) / 1000));
      return res.status(429).json({
        success: false,
        message,
      });
    }
    return next();
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

// Redirect-based limiter for plain HTML form POSTs (no JS/fetch), e.g. /support.
// Unlike createRateLimiter (which always responds with JSON — correct for the
// fetch()-based /login and /reset-password forms), this flashes an error and
// redirects back to the referring page so the normal <form> UX still works.
const createRedirectRateLimiter = ({ windowMs, max, message, keyPrefix, redirectTo }) => {
  return (req, res, next) => {
    const now = Date.now();
    const clientId = getClientKey(req);
    const key = `${keyPrefix}:${req.path}:${clientId}`;
    const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }

    bucket.count += 1;
    buckets.set(key, bucket);

    if (bucket.count > max) {
      req.flash("error", message);
      return res.redirect(typeof redirectTo === "function" ? redirectTo(req) : redirectTo);
    }
    return next();
  };
};

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

// Factory for the three public admission forms (student / teacher / driver).
// NOTE: these routers are mounted with a path prefix (e.g. app.use('/admission', ...)),
// so req.path INSIDE the router is relative ("/student", not "/admission/student").
// Passing the full public-facing redirect path explicitly avoids redirecting to a 404.
const makeAdmissionLimiter = (redirectTo) => createRedirectRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: "Too many submissions from this connection. Please try again later or contact the school directly.",
  keyPrefix: "admission",
  redirectTo,
});

module.exports = { createRateLimiter, createRedirectRateLimiter, loginLimiter, otpLimiter, passwordResetLimiter, apiLimiter, uploadLimiter, registrationLimiter, supportLimiter, demoLimiter, makeAdmissionLimiter };