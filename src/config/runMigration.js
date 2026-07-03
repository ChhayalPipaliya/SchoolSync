#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const ROOT_DIR = path.join(__dirname, '..', '..');
const MAIN_MIGRATION = path.join(__dirname, 'migration.sql');
const MIGRATIONS_DIR = path.join(ROOT_DIR, 'migrations');

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    socketPath: process.env.DB_SOCKET_PATH || undefined,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'schoolsync_db',
    multipleStatements: false
};

const ignorableErrorNumbers = new Set([ 1050, 1060, 1061, 1068, 1091, 1826 ]);

function stripSqlComments(sql) {
    return sql
        .split(/\r?\n/)
        .filter((line) => {
            const trimmed = line.trim();
            return trimmed && !trimmed.startsWith('--') && !trimmed.startsWith('#');
        })
        .join('\n');
}

function splitStatements(sql) {
    const cleaned = stripSqlComments(sql);
    const statements = [];
    let current = '';
    let quote = null;

    for (let i = 0; i < cleaned.length; i += 1) {
        const char = cleaned[i];
        const prev = cleaned[i - 1];

        if ((char === '"' || char === "'" || char === '`') && prev !== '\\') {
            quote = quote === char ? null : (quote || char);
        }

        if (char === ';' && !quote) {
            const statement = current.trim();
            if (statement) statements.push(statement);
            current = '';
        } else {
            current += char;
        }
    }

    const finalStatement = current.trim();
    if (finalStatement) statements.push(finalStatement);
    return statements;
}

async function ensureMigrationTable(connection) {
    await connection.query(`
        CREATE TABLE IF NOT EXISTS migrations (
            id int unsigned NOT NULL AUTO_INCREMENT,
            migration_name varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
            run_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY migration_name (migration_name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

async function hasMigrationRun(connection, migrationName) {
    const [rows] = await connection.query(
        'SELECT id FROM migrations WHERE migration_name = ? LIMIT 1',
        [migrationName]
    );
    return rows.length > 0;
}

async function recordMigration(connection, migrationName) {
    await connection.query(
        'INSERT IGNORE INTO migrations (migration_name) VALUES (?)',
        [migrationName]
    );
}

async function runSqlFile(connection, filePath, migrationName) {
    if (!fs.existsSync(filePath)) {
        console.log(`[Migration] Missing ${migrationName}, skipping.`);
        return;
    }

    if (await hasMigrationRun(connection, migrationName)) {
        console.log(`[Migration] Already applied: ${migrationName}`);
        return;
    }

    const sql = fs.readFileSync(filePath, 'utf8');
    const statements = splitStatements(sql);
    console.log(`[Migration] Applying ${migrationName} (${statements.length} statements)`);

    for (const statement of statements) {
        try {
            await connection.query(statement);
        } catch (error) {
            if (ignorableErrorNumbers.has(error.errno)) {
                console.warn(`[Migration] Ignored ${error.code || error.errno}: ${error.sqlMessage || error.message}`);
                continue;
            }
            error.message = `${error.message}\nWhile running migration ${migrationName}:\n${statement.slice(0, 500)}`;
            throw error;
        };
    }

    await recordMigration(connection, migrationName);
    console.log(`[Migration] Applied: ${migrationName}`);
}

function getMigrationFiles() {
    if (!fs.existsSync(MIGRATIONS_DIR)) return [];
    return fs.readdirSync(MIGRATIONS_DIR)
        .filter((file) => file.toLowerCase().endsWith('.sql'))
        .sort()
        .map((file) => path.join(MIGRATIONS_DIR, file));
}

async function main() {
    const connection = await mysql.createConnection(dbConfig);
    try {
        await ensureMigrationTable(connection);
        await runSqlFile(connection, MAIN_MIGRATION, 'src/config/migration.sql');

        for (const filePath of getMigrationFiles()) {
            const migrationName = path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
            await runSqlFile(connection, filePath, migrationName);
        }

        console.log('[Migration] Complete.');
    } finally {
        await connection.end();
    }
}

main().catch((error) => {
    console.error('[Migration] Failed:', error.message || error);
    process.exit(1);
});
