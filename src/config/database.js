const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
const mysql = require("mysql2");

const isProduction = process.env.NODE_ENV === "production";
const dbConfig = {
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    socketPath: process.env.DB_SOCKET_PATH || undefined,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "schoolsync_db",
    connectionLimit: 10,
    waitForConnections: true,
    queueLimit: 0
};

if (isProduction) {
    const missing = ["DB_USER", "DB_NAME"].filter(key => !process.env[key]);
    if (!process.env.DB_HOST && !process.env.DB_SOCKET_PATH) {
        missing.push("DB_HOST or DB_SOCKET_PATH");
    }
    if (missing.length > 0) {
        throw new Error(`Missing required database environment variables: ${missing.join(", ")}`);
    }
}

if (!isProduction && (!process.env.DB_USER || !process.env.DB_NAME)) {
    console.warn(
        `[DB] Using development database defaults (${dbConfig.user}@${dbConfig.socketPath || dbConfig.host}/${dbConfig.database}). ` +
        "Create .env from .env.example to override them."
    );
}

const pool = mysql.createPool({
    host: dbConfig.host,
    port: dbConfig.port,
    socketPath: dbConfig.socketPath,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    connectionLimit: dbConfig.connectionLimit,
    waitForConnections: dbConfig.waitForConnections,
    queueLimit: dbConfig.queueLimit
});

pool.getConnection((err, connection) => {
    if (err) {
        console.error(
            `MySQL connection failed (${dbConfig.user}@${dbConfig.host}/${dbConfig.database}):`,
            err.code || err.message || String(err)
        );
        return;
    }

    console.log("MySQL Connected...");
    connection.release();
});

const normalizeParams = (params) => {
    if (typeof params === "undefined") {
        return [];
    }

    return params;
};

const query = (sql, params, callback) => {
    if (typeof params === "function") {
        return pool.query(sql, params);
    }

    if (typeof callback !== "function") {
        return pool.promise().query(sql, normalizeParams(params));
    }

    return pool.query(sql, normalizeParams(params), callback);
};

const execute = (sql, params, callback) => {
    if (typeof params === "function") {
        return pool.execute(sql, params);
    }

    if (typeof callback !== "function") {
        return pool.promise().execute(sql, normalizeParams(params));
    }

    return pool.execute(sql, normalizeParams(params), callback);
};

const queryAsync = async (sql, params = []) => {
    const start = Date.now();
    try {
        const [rows] = await pool.promise().query(sql, params);
        const duration = (Date.now() - start) / 1000;
        if (duration > 2.0) {
            pool.query(
                "INSERT INTO slow_queries (query_text, execution_time_seconds) VALUES (?, ?)",
                [sql.substring(0, 2000), duration],
                (err) => { if (err) console.error("Slow query logging failed:", err); }
            );
        }
        return rows;
    } catch (error) {
        throw error;
    }
};

const executeAsync = async (sql, params = []) => {
    const start = Date.now();
    try {
        const [rows] = await pool.promise().execute(sql, params);
        const duration = (Date.now() - start) / 1000;
        if (duration > 2.0) {
            pool.query(
                "INSERT INTO slow_queries (query_text, execution_time_seconds) VALUES (?, ?)",
                [sql.substring(0, 2000), duration],
                (err) => { if (err) console.error("Slow query logging failed:", err); }
            );
        }
        return rows;
    } catch (error) {
        throw error;
    }
};

const withTransaction = async (handler) => {
    const connection = await pool.promise().getConnection();

    try {
        await connection.beginTransaction();

        const helpers = {
            connection,
            query: async (sql, params = []) => {
                const [rows] = await connection.query(sql, params);
                return rows;
            },
            execute: async (sql, params = []) => {
                const [rows] = await connection.execute(sql, params);
                return rows;
            }
        };

        const result = await handler(helpers);
        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

const checkConnection = async () => {
    try {
        await pool.promise().query("SELECT 1");
        return { ok: true };
    } catch (error) {
        return {
            ok: false,
            code: error.code,
            message: error.sqlMessage || error.message || String(error),
            config: {
                host: dbConfig.host,
                port: dbConfig.port,
                socketPath: dbConfig.socketPath,
                user: dbConfig.user,
                database: dbConfig.database,
                passwordConfigured: Boolean(dbConfig.password)
            }
        };
    }
};

module.exports = {
    pool,
    query,
    execute,
    queryAsync,
    executeAsync,
    withTransaction,
    checkConnection,
    promise: () => pool.promise(),
    getConnection: () => pool.promise().getConnection()
};
