const jitsiConfig = require("../config/jitsi");

const securityHeaders = (req, res, next) => {
    const isProd = process.env.NODE_ENV === "production";
    const jitsiDomain = jitsiConfig?.domain || "meet.jit.si";
    const jitsiOrigin = `https://${jitsiDomain}`;

    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    
    if (isProd) {
        res.setHeader(
            "Strict-Transport-Security",
            "max-age=31536000; includeSubDomains; preload"
        );
    };
    
    const cspDirectives = {
        "default-src": ["'self'"],
        "script-src": [
            "'self'",
            "'unsafe-inline'",
            "https://cdn.jsdelivr.net",
            "https://cdnjs.cloudflare.com",
            "https://cdn.tailwindcss.com",
            "https://unpkg.com",
            "https://checkout.razorpay.com",
            jitsiOrigin,
            "https://meet.jit.si"
        ],
        "style-src": [
            "'self'",
            "'unsafe-inline'",
            "https://fonts.googleapis.com",
            "https://cdn.jsdelivr.net",
            "https://cdnjs.cloudflare.com",
            "https://unpkg.com"
        ],
        "font-src": [
            "'self'",
            "https://fonts.gstatic.com",
            "https://cdn.jsdelivr.net",
            "https://cdnjs.cloudflare.com"
        ],
        "img-src": ["'self'", "data:", "blob:", "https:"],
        "connect-src": [
            "'self'",
            "https://nominatim.openstreetmap.org",
            "https://router.project-osrm.org",
            "https://api.razorpay.com",
            "https://lumberjack.razorpay.com",
            jitsiOrigin,
            "https://meet.jit.si"
        ],
        "frame-src": [
            "'self'",
            "https://api.razorpay.com",
            jitsiOrigin,
            "https://meet.jit.si"
        ],
        "frame-ancestors": ["'self'"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'", "https://api.razorpay.com"]
    };

    if (isProd) {
        cspDirectives["upgrade-insecure-requests"] = [];
    };

    const csp = Object.entries(cspDirectives)
        .map(([key, values]) => {
            return values.length > 0 ? `${key} ${values.join(" ")}` : key;
        })
        .join("; ");

    res.setHeader("Content-Security-Policy", csp);

    const permissionsPolicy = [
        "camera=*",
        "microphone=*",
        "display-capture=*",
        "geolocation=(self)",
        "payment=*"
    ].join(", ");

    res.setHeader("Permissions-Policy", permissionsPolicy);
    res.setHeader("Feature-Policy", permissionsPolicy);
    res.removeHeader("X-Powered-By");

    return next();
};

const noCache = (req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    return next();
};

const staticCache = (req, res, next) => {
    const maxAgeSeconds = isProd 
        ? 30 * 24 * 60 * 60
        : 24 * 60 * 60;
    
    res.setHeader("Cache-Control", `public, max-age=${maxAgeSeconds}`);
    res.setHeader("Vary", "Accept-Encoding");
    return next();
};

module.exports = { securityHeaders, noCache, staticCache };