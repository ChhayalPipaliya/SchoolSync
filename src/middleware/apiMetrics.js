const { pool } = require("../config/database");

const apiMetricsMiddleware = (req, res, next) => {
    const start = Date.now();
    
    res.on("finish", () => {
        const duration = Date.now() - start;
        const endpoint = req.baseUrl + req.path;
        const method = req.method;
        const statusCode = res.statusCode;
        const schoolId = req.user?.school_id || null;
        const userId = req.user?.id || null;

        if (
            endpoint.includes("/css/") || 
            endpoint.includes("/js/") || 
            endpoint.includes("/images/") || 
            endpoint.includes("/uploads/") ||
            endpoint.includes("/favicon.png")
        ) {
            return;
        }

        pool.query(
            "INSERT INTO api_metrics (endpoint, method, response_time_ms, status_code, school_id, user_id) VALUES (?, ?, ?, ?, ?, ?)",
            [endpoint, method, duration, statusCode, schoolId, userId],
            (err) => {
                if (err) {
                    console.error("Failed to log API metrics in database:", err.message);
                }
            }
        );
    });

    next();
};

module.exports = { apiMetricsMiddleware };
