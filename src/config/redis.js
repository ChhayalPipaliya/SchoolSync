const { createClient } = require("redis");
const connectRedis = require("connect-redis");

const RedisStore = connectRedis.default || connectRedis.RedisStore || connectRedis;
const SESSION_PREFIX = "schoolsync:sess:";
let redisClient = null;

const buildRedisUrl = () => {
    if (process.env.REDIS_URL) {
        return process.env.REDIS_URL;
    };

    if (!process.env.REDIS_HOST) {
        return null;
    };

    const username = process.env.REDIS_USERNAME ? encodeURIComponent(process.env.REDIS_USERNAME) : "";
    const password = process.env.REDIS_PASSWORD ? `:${encodeURIComponent(process.env.REDIS_PASSWORD)}` : "";
    const auth = username || password ? `${username}${password}@` : "";
    const port = process.env.REDIS_PORT || "6379";
    const db = process.env.REDIS_DB ? `/${process.env.REDIS_DB}` : "";

    return `redis://${auth}${process.env.REDIS_HOST}:${port}${db}`;
};

const getRedisClient = () => {
    if (redisClient && redisClient.isReady) {
        return redisClient;
    };
    return null;
};

const initializeRedis = async () => {
    const url = buildRedisUrl();
    if (!url) {
        console.log("Redis is not configured. Using in-memory session and OTP stores.");
        return null;
    };

    if (redisClient && redisClient.isReady) {
        return redisClient;
    };

    const client = createClient({
        url,
        socket: {
            connectTimeout: 3000,
            reconnectStrategy: (retries) => {
                if (retries >= 3) {
                    console.error("[Redis] Max reconnection retries (3) reached. Disabling Redis.");
                    return new Error("Max reconnection retries reached");
                }
                return Math.min(retries * 500, 1000);
            }
        }
    });
    client.on("ready", () => {
        console.log("Redis Connected...");
    });

    client.on("end", () => {
        console.warn("Redis connection closed.");
    });

    client.on("error", (error) => {
        console.error("Redis Error:", error.message || String(error));
    });

    try {
        await client.connect();
        redisClient = client;
        return redisClient;
    } catch (error) {
        console.error("Redis connection failed. Falling back to in-memory storage.");
        try {
            if (client.isOpen) {
                await client.disconnect();
            }
        } catch (disconnectError) {
            console.error("Redis cleanup failed:", disconnectError.message || String(disconnectError));
        };

        redisClient = null;
        return null;
    };
};

const createRedisSessionStore = () => {
    const client = getRedisClient();
    if (!client) {
        return null;
    };

    return new RedisStore({
        client,
        prefix: SESSION_PREFIX
    });
};

module.exports = { createRedisSessionStore, getRedisClient, initializeRedis };