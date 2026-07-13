const jitsiConfig = require("../config/jitsi");

const securityHeaders = (req, res, next) => {
    const isProd = process.env.NODE_ENV === "production";
    const jitsiDomain = jitsiConfig?.domain || "meet.jit.si";
    const jitsiOrigin = `https://${jitsiDomain}`;

    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

    if (isProd) {
        res.setHeader(
            "Strict-Transport-Security",
            "max-age=31536000; includeSubDomains; preload"
        );
    };

    const csp = [
        "default-src 'self'",
        `script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://cdn.tailwindcss.com ${jitsiOrigin} https://meet.jit.si https://unpkg.com https://checkout.razorpay.com`,
        `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com`,
        "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
        "img-src 'self' data: blob: https:",
        `connect-src 'self' ${jitsiOrigin} https://meet.jit.si https://nominatim.openstreetmap.org https://router.project-osrm.org https://api.razorpay.com https://lumberjack.razorpay.com`,
        `frame-src 'self' ${jitsiOrigin} https://meet.jit.si https://api.razorpay.com`,
        "frame-ancestors 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self' https://api.razorpay.com",
    ].join("; ");

    res.setHeader("Content-Security-Policy", csp);
    res.setHeader(
        "Permissions-Policy",
        "camera=*, microphone=*, display-capture=*, geolocation=(self), payment=()"
    );

    res.removeHeader("X-Powered-By");
    return next();
};

const noCache = (req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    return next();
};

module.exports = { securityHeaders, noCache };