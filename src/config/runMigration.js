const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const ROOT_DIR = path.join(__dirname, '..', '..');
const MAIN_MIGRATION = path.join(__dirname, 'migration.sql');
const MIGRATIONS_DIR = path.join(ROOT_DIR, 'migrations');
const DATABASE_SCHEMA = path.join(ROOT_DIR, 'database.sql');

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    socketPath: process.env.DB_SOCKET_PATH || undefined,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'schoolsync_db',
    multipleStatements: false
};

const ignorableErrorNumbers = new Set([1050, 1060, 1061, 1068, 1091, 1826]);
function stripSqlComments(sql) {
    return sql
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(/\r?\n/)
        .filter((line) => {
            const trimmed = line.trim();
            return trimmed && !trimmed.startsWith('--') && !trimmed.startsWith('#');
        })
        .join('\n');
};

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
        };

        if (char === ';' && !quote) {
            const statement = current.trim();
            if (statement) statements.push(statement);
            current = '';
        } else {
            current += char;
        };
    };

    const finalStatement = current.trim();
    if (finalStatement) statements.push(finalStatement);
    return statements;
};

async function ensureMigrationTable(connection) {
    await connection.query(`
        CREATE TABLE IF NOT EXISTS migrations (
            id int unsigned NOT NULL AUTO_INCREMENT,
            migration_name varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
            run_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
            status enum('completed','failed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'completed',
            executed_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            error_message text COLLATE utf8mb4_unicode_ci,
            PRIMARY KEY (id),
            UNIQUE KEY migration_name (migration_name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
};

async function tableExists(connection, tableName) {
    const [rows] = await connection.query(
        `SELECT COUNT(*) AS count
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ?`,
        [tableName]
    );
    return Number(rows[0]?.count || 0) > 0;
};

async function columnExists(connection, tableName, columnName) {
    const [rows] = await connection.query(
        `SELECT COUNT(*) AS count
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ?
            AND COLUMN_NAME = ?`,
        [tableName, columnName]
    );
    return Number(rows[0]?.count || 0) > 0;
};

async function hasMigrationRun(connection, migrationName) {
    const [rows] = await connection.query(
        `SELECT id
        FROM migrations
        WHERE migration_name = ?
            AND COALESCE(status, 'completed') = 'completed'
        LIMIT 1`,
        [migrationName]
    );
    return rows.length > 0;
};

async function recordMigration(connection, migrationName) {
    await connection.query(
        `INSERT INTO migrations (migration_name, status, executed_at)
        VALUES (?, 'completed', CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE
            status = 'completed',
            executed_at = CURRENT_TIMESTAMP,
            error_message = NULL`,
        [migrationName]
    );
};

async function recordMigrationFailure(connection, migrationName, errorMessage) {
    try {
        await connection.query(
            `INSERT INTO migrations (migration_name, status, executed_at, error_message)
            VALUES (?, 'failed', CURRENT_TIMESTAMP, ?)
            ON DUPLICATE KEY UPDATE
                status = 'failed',
                executed_at = CURRENT_TIMESTAMP,
                error_message = VALUES(error_message)`,
            [migrationName, String(errorMessage || '').slice(0, 5000)]
        );
    } catch (_) {
        // Do not hide original migration error with failure logging error.
    };
};

async function shouldSkipKnownLegacyStatement(connection, statement) {
    const compact = statement
        .replace(/\s+/g, ' ')
        .replace(/`/g, '')
        .trim()
        .toLowerCase();

    const referencesMeetings = /\bmeetings\b/.test(compact);
    const referencesLegacyMeetingColumns =
        /\bmeeting_date\b/.test(compact) ||
        /\bstart_time\b/.test(compact) ||
        /\bend_time\b/.test(compact);

    if (!referencesMeetings || !referencesLegacyMeetingColumns) {
        return false;
    };

    const meetingsExists = await tableExists(connection, 'meetings');
    if (!meetingsExists) {
        return false;
    };

    const legacyColumns = ['meeting_date', 'start_time', 'end_time'];
    const existingLegacyColumns = [];
    for (const column of legacyColumns) {
        if (await columnExists(connection, 'meetings', column)) {
            existingLegacyColumns.push(column);
        };
    };

    if (existingLegacyColumns.length === 0) {
        return true;
    };
    return false;
};

// Legacy teacher columns historically stored users.id.  Before changing the
// foreign keys, prove every value is either already a teachers.id or maps to
// exactly one teacher in the same school.  Ambiguous/unmatched rows are
// reported and abort the migration; they must be resolved by an operator.
async function preflightTeacherReferences(connection) {
    const tables = ['class_subjects', 'homeworks', 'teacher_attendance', 'timetables', 'marks'];
    const unresolved = [];
    for (const table of tables) {
        const [rows] = await connection.query(
            `SELECT x.id, x.school_id, x.teacher_id,
                    current_teacher.id AS current_id,
                    COUNT(legacy.id) AS legacy_count
             FROM ${table} x
             LEFT JOIN teachers current_teacher
               ON current_teacher.id = x.teacher_id
              AND current_teacher.school_id = x.school_id
             LEFT JOIN teachers legacy
               ON legacy.user_id = x.teacher_id
              AND legacy.school_id = x.school_id
             WHERE x.teacher_id IS NOT NULL
             GROUP BY x.id, x.school_id, x.teacher_id, current_teacher.id
             HAVING current_id IS NULL AND legacy_count <> 1`
        );
        for (const row of rows) unresolved.push({ table, id: row.id, school_id: row.school_id, teacher_id: row.teacher_id, legacy_count: Number(row.legacy_count) });
    }
    if (unresolved.length) {
        const details = unresolved.slice(0, 50).map((r) => `${r.table}#${r.id}(school ${r.school_id}, teacher ${r.teacher_id}, matches ${r.legacy_count})`).join(', ');
        throw new Error(`Unresolved or ambiguous teacher references; no rows changed: ${details}${unresolved.length > 50 ? ` (+${unresolved.length - 50} more)` : ''}`);
    }
    return unresolved;
}

async function preflightParentLinks(connection) {
    if (!(await tableExists(connection, 'student_family'))) return [];
    const [rows] = await connection.query(`
        SELECT sf.id, sf.school_id,
               COUNT(DISTINCT u.id) AS candidates
        FROM student_family sf
        LEFT JOIN users u
          ON u.school_id = sf.school_id
         AND u.role = 'parent' AND u.status = 'active'
         AND (LOWER(NULLIF(u.email, '')) = LOWER(NULLIF(sf.father_email, ''))
           OR LOWER(NULLIF(u.email, '')) = LOWER(NULLIF(sf.mother_email, ''))
           OR LOWER(NULLIF(u.email, '')) = LOWER(NULLIF(sf.guardian_email, '')))
        WHERE sf.parent_user_id IS NULL
        GROUP BY sf.id, sf.school_id
        HAVING candidates <> 1`);
    if (rows.length) {
        const details = rows.slice(0, 50).map((r) => `student_family#${r.id}(school ${r.school_id}, candidates ${r.candidates})`).join(', ');
        throw new Error(`Unresolved parent_user_id mappings; no rows changed: ${details}${rows.length > 50 ? ` (+${rows.length - 50} more)` : ''}`);
    }
    return rows;
}

async function preflightPaymentIntegrity(connection) {
    const checks = [
        { table: 'fee_payments', column: 'razorpay_order_id', binary: true, ignoreBlank: true },
        { table: 'fee_payments', column: 'razorpay_payment_id', binary: true, ignoreBlank: true },
        { table: 'fee_payments', column: 'receipt_no', ignoreBlank: true },
        { table: 'fee_payments', column: 'receipt_number', ignoreBlank: true },
        { table: 'subscription_payments', column: 'razorpay_order_id', binary: true, ignoreBlank: true },
        { table: 'subscription_payments', column: 'razorpay_payment_id', binary: true, ignoreBlank: true },
        { table: 'subscription_payments', column: 'receipt_no' },
        { table: 'subscription_payments', column: 'subscription_id', numeric: true, ignoreNull: true },
        { table: 'invoices', column: 'subscription_id', numeric: true, ignoreNull: true }
    ];
    const duplicateChecks = [];

    for (const check of checks) {
        if (!(await tableExists(connection, check.table)) || !(await columnExists(connection, check.table, check.column))) {
            throw new Error(`Payment integrity preflight requires ${check.table}.${check.column}.`);
        };
        const expression = check.binary ? `BINARY \`${check.column}\`` : `\`${check.column}\``;
        const predicates = [];
        if (check.ignoreNull || check.ignoreBlank) predicates.push(`\`${check.column}\` IS NOT NULL`);
        if (check.ignoreBlank && !check.numeric) predicates.push(`TRIM(\`${check.column}\`) <> ''`);
        const whereSql = predicates.length ? `WHERE ${predicates.join(' AND ')}` : '';
        const [rows] = await connection.query(
            `SELECT COUNT(*) AS duplicate_groups
            FROM (
                SELECT ${expression} AS value_key
                FROM \`${check.table}\`
                ${whereSql}
                GROUP BY ${expression}
                HAVING COUNT(*) > 1
            ) duplicate_values`
        );
        const duplicateGroups = Number(rows[0]?.duplicate_groups || 0);
        if (duplicateGroups > 0) {
            duplicateChecks.push(`${check.table}.${check.column} (${duplicateGroups} duplicate group${duplicateGroups === 1 ? '' : 's'})`);
        };
    };

    if (duplicateChecks.length) {
        throw new Error(
            `Duplicate financial identifiers must be reconciled before migration: ${duplicateChecks.join(', ')}`
        );
    };
    return [];
};

async function runSqlFile(connection, filePath, migrationName) {
    if (!fs.existsSync(filePath)) {
        console.log(`[Migration] Missing ${migrationName}, skipping.`);
        return;
    };

    if (await hasMigrationRun(connection, migrationName)) {
        console.log(`[Migration] Already applied: ${migrationName}`);
        return;
    };

    if (migrationName === 'migrations/002_normalize_teacher_references.sql') {
        await preflightTeacherReferences(connection);
        await preflightParentLinks(connection);
    }
    if (migrationName === 'migrations/004_payment_integrity_guards.sql') {
        await preflightPaymentIntegrity(connection);
    };

    const sql = fs.readFileSync(filePath, 'utf8');
    const statements = splitStatements(sql);
    console.log(`[Migration] Applying ${migrationName} (${statements.length} statements)`);
    try {
        for (const statement of statements) {
            if (await shouldSkipKnownLegacyStatement(connection, statement)) {
                console.warn(
                    `[Migration] Skipped legacy meetings statement because meeting_date/start_time/end_time do not exist in current schema.`
                );
                continue;
            };

            try {
                await connection.query(statement);
            } catch (error) {
                if (ignorableErrorNumbers.has(error.errno)) {
                    console.warn(
                        `[Migration] Ignored ${error.code || error.errno}: ${error.sqlMessage || error.message}`
                    );
                    continue;
                };

                error.message = `${error.message}\nWhile running migration ${migrationName}:\n${statement.slice(0, 500)}`;
                throw error;
            };
        };

        await recordMigration(connection, migrationName);
        console.log(`[Migration] Applied: ${migrationName}`);
    } catch (error) {
        await recordMigrationFailure(connection, migrationName, error.message || error);
        throw error;
    };
}

function getMigrationFiles() {
    if (!fs.existsSync(MIGRATIONS_DIR)) return [];

    return fs.readdirSync(MIGRATIONS_DIR)
        .filter((file) => file.toLowerCase().endsWith('.sql'))
        .sort()
        .map((file) => path.join(MIGRATIONS_DIR, file));
};

async function main() {
    const connection = await mysql.createConnection(dbConfig);
    try {
        await ensureMigrationTable(connection);
        const migrationFiles = getMigrationFiles();
        const hasMainMigration = fs.existsSync(MAIN_MIGRATION);
        const hasUsersTable = await tableExists(connection, 'users');

        if (!hasUsersTable && !hasMainMigration && fs.existsSync(DATABASE_SCHEMA)) {
            await runSqlFile(connection, DATABASE_SCHEMA, 'database.sql');
        };

        await runSqlFile(connection, MAIN_MIGRATION, 'src/config/migration.sql');

        for (const filePath of migrationFiles) {
            const migrationName = path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
            await runSqlFile(connection, filePath, migrationName);
        };

        console.log('[Migration] Complete.');
    } finally {
        await connection.end();
    };
};

if (require.main === module) {
    main().catch((error) => {
        console.error('[Migration] Failed:', error.message || error);
        process.exitCode = 1;
    });
};

module.exports = {
    getMigrationFiles,
    main,
    splitStatements,
    stripSqlComments,
    preflightPaymentIntegrity,
    preflightTeacherReferences,
    preflightParentLinks
};
