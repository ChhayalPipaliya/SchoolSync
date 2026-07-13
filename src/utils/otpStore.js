const { getRedisClient } = require("../config/redis");

const OTP_PREFIX = "schoolsync:otp:";
const memoryOtpStore = new Map();

const buildOtpKey = (email) => `${OTP_PREFIX}${email}`;
const readMemoryOtpRecord = (email) => {
    const record = memoryOtpStore.get(email);
    if (!record) return null;
    if (Number(record.expireAt) <= Date.now()) {
        memoryOtpStore.delete(email);
        return null;
    };
    return record;
};

const getOtpRecord = async (email) => {
    const redisClient = getRedisClient();
    if (!redisClient) {
        return readMemoryOtpRecord(email);
    };

    const key = buildOtpKey(email);
    const rawValue = await redisClient.get(key);
    if (!rawValue) return null;

    try {
        const record = JSON.parse(rawValue);
        if (!record || Number(record.expireAt) <= Date.now()) {
            await redisClient.del(key);
            return null;
        }
        return record;
    } catch (error) {
        await redisClient.del(key);
        return null;
    };
};

const setOtpRecord = async (email, record, ttlMs) => {
    const redisClient = getRedisClient();
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));

    if (!redisClient) {
        memoryOtpStore.set(email, record);
        return;
    };

    await redisClient.setEx(
        buildOtpKey(email),
        ttlSeconds,
        JSON.stringify(record)
    );
};

const deleteOtpRecord = async (email) => {
    const redisClient = getRedisClient();
    if (!redisClient) {
        memoryOtpStore.delete(email);
        return;
    };
    await redisClient.del(buildOtpKey(email));
};

module.exports = { deleteOtpRecord, getOtpRecord, setOtpRecord };