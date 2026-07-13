const crypto = require("crypto");

module.exports = (req, res, next) => {
    if (req.session && !req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    };
    
    res.locals.csrfToken = req.session ? req.session.csrfToken : '';
    const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (safeMethods.includes(req.method)) {
        return next();
    };

    const cryptographicallyVerifiedWebhooks = new Set([
        '/webhooks/razorpay',
        '/api/fees/razorpay/webhook'
    ]);
    if (cryptographicallyVerifiedWebhooks.has(req.path)) {
        return next();
    };

    // These public multipart forms are authorized by a high-entropy, school-bound
    // admission token. Express cannot read their body token before Multer parses it,
    // so only the exact capability URLs are exempted (never the admission prefix).
    const tokenAuthorizedAdmissionPosts = new Set([
        '/admission/student',
        '/admission/teacher/submit',
        '/admission/driver/submit'
    ]);
    if (tokenAuthorizedAdmissionPosts.has(req.path)) {
        return next();
    };

    const token = req.body?._csrf || req.headers['x-csrf-token'] || req.headers['x-xsrf-token'];
    const expected = req.session?.csrfToken;
    const tokenBuffer = Buffer.from(String(token || ''));
    const expectedBuffer = Buffer.from(String(expected || ''));
    const valid = tokenBuffer.length > 0
        && tokenBuffer.length === expectedBuffer.length
        && crypto.timingSafeEqual(tokenBuffer, expectedBuffer);
    if (!valid) {
        console.warn(`[CSRF] Blocked potential CSRF attack on ${req.method} ${req.path}`);
        const err = new Error("Security verification failed (CSRF token invalid or expired). Please go back, refresh, and try again.");
        err.status = 403;
        return next(err);
    };
    next();
};
