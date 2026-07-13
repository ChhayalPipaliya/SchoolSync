const { getRedisClient } = require("../config/redis");
const { queryAsync } = require("../config/database");

const CACHE_PREFIX = "plan:features:";
const buildCacheKey = (school_id) => `${CACHE_PREFIX}${school_id}`;

const getPlanFeatures = async (school_id) => {
    if (!school_id) return null;

    const key = buildCacheKey(school_id);
    const redisClient = getRedisClient();

    if (redisClient) {
        try {
            const cached = await redisClient.get(key);
            if (cached) {
                return JSON.parse(cached);
            };
        } catch (error) {
            console.error("Redis Cache Get Error:", error);
        };
    };

    const sql = `
        SELECT s.status, s.end_date, p.plan_key, p.features, p.max_students, p.max_teachers, p.max_classes
        FROM subscriptions s
        JOIN plans p ON s.plan_id = p.id
        WHERE s.school_id = ?
        ORDER BY s.created_at DESC
        LIMIT 1
    `;

    try {
        let rows = await queryAsync(sql, [school_id]);
        let row;
        if (!rows || rows.length === 0) {
            const fallbackSql = `
                SELECT s.status, p.plan_key, p.features, p.max_students, p.max_teachers, p.max_classes
                FROM schools s
                LEFT JOIN plans p ON s.plan_id = p.id OR s.plan = p.plan_key
                WHERE s.id = ?
            `;
            const fallbackRows = await queryAsync(fallbackSql, [school_id]);
            if (!fallbackRows || fallbackRows.length === 0) {
                return null;
            };
            row = fallbackRows[0];
        } else {
            row = rows[0];
        };

        let featuresObj = {};
        if (row.features) {
            if (typeof row.features === "string") {
                try {
                    featuresObj = JSON.parse(row.features);
                } catch (e) {
                    console.error("Failed to parse plan features JSON string:", e);
                };
            } else {
                featuresObj = row.features;
            };
        };

        const planData = {
            status: row.status,
            end_date: row.end_date ? row.end_date : null,
            max_students: row.max_students,
            max_teachers: row.max_teachers,
            max_classes: row.max_classes,
            features: featuresObj,
            plan_key: row.plan_key,
        };

        if (redisClient) {
            try {
                await redisClient.setEx(key, 300, JSON.stringify(planData));
            } catch (error) {
                console.error("Redis Cache Set Error:", error);
            };
        };
        return planData;
    } catch (error) {
        console.error(`Database Query Error in getPlanFeatures for school_id ${school_id}:`, error);
        throw error;
    };
};

const invalidatePlanCache = async (school_id) => {
    if (!school_id) return;

    const key = buildCacheKey(school_id);
    const redisClient = getRedisClient();

    if (redisClient) {
        try {
            await redisClient.del(key);
        } catch (error) {
            console.error("Redis Cache Del Error:", error);
        };
    };
};

const invalidateSubscriptionCache = async (school_id) => {
    if (!school_id) return;

    const key = `sub:status:${school_id}`;
    const redisClient = getRedisClient();

    if (redisClient) {
        try {
            await redisClient.del(key);
        } catch (error) {
            console.error("Redis Cache Del Error (subscription status):", error);
        };
    };
};

module.exports = { getPlanFeatures, invalidatePlanCache, invalidateSubscriptionCache };
