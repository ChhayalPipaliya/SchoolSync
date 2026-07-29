const crypto = require("crypto");

const verifyToken = (req, token) => {
    const expected = req.session?.csrfToken;
    const tokenBuffer = Buffer.from(String(token || ''));
    const expectedBuffer = Buffer.from(String(expected || ''));
    return tokenBuffer.length > 0
        && tokenBuffer.length === expectedBuffer.length
        && crypto.timingSafeEqual(tokenBuffer, expectedBuffer);
};

const csrfMiddleware = (req, res, next) => {
    if (req.session && !req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    };

    res.locals.csrfToken = req.session ? req.session.csrfToken : '';
    const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (safeMethods.includes(req.method)) {
        return next();
    };

    const publicExemptedPaths = new Set([
        '/webhooks/razorpay',
        '/api/fees/razorpay/webhook',
        '/login',
        '/start-demo'
    ]);
    if (publicExemptedPaths.has(req.path)) {
        return next();
    };

    const tokenAuthorizedAdmissionPosts = new Set([
        '/admission/student',
        '/admission/teacher/submit',
        '/admission/driver/submit'
    ]);
    if (tokenAuthorizedAdmissionPosts.has(req.path)) {
        return next();
    };

    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data') && !req.headers['x-csrf-token'] && !req.headers['x-xsrf-token']) {
        req.isMultipartDeferred = true;
        return next();
    }

    const token = req.body?._csrf || req.headers['x-csrf-token'] || req.headers['x-xsrf-token'];
    if (!verifyToken(req, token)) {
        console.warn(`[CSRF] Blocked potential CSRF attack on ${req.method} ${req.path}`);
        const isJson = req.xhr || req.headers.accept?.includes('json') || contentType.includes('json');
        if (isJson) {
            return res.status(403).json({
                success: false,
                message: "Security verification failed (CSRF token invalid or expired). Please refresh the page and try again."
            });
        };
        const err = new Error("Security verification failed (CSRF token invalid or expired). Please go back, refresh, and try again.");
        err.status = 403;
        return next(err);
    };
    next();
};

const verifyMultipartCsrf = (req, res, next) => {
    if (req.isMultipartDeferred) {
        const token = req.body?._csrf;
        if (!verifyToken(req, token)) {
            console.warn(`[CSRF] Blocked potential CSRF attack on deferred ${req.method} ${req.path}`);
            const err = new Error("Security verification failed (CSRF token invalid or expired). Please go back, refresh, and try again.");
            err.status = 403;
            return next(err);
        }
    }
    next();
};

module.exports = csrfMiddleware;
module.exports.verifyMultipartCsrf = verifyMultipartCsrf;