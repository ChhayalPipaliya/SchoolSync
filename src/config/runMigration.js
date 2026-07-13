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
const PAYMENT_INTEGRITY_INDEXES = Object.freeze([
    { table: 'fee_payments', index: 'uq_fee_payments_id_school', columns: ['id', 'school_id'] },
    { table: 'fee_payments', index: 'uq_fee_payments_razorpay_order', columns: ['razorpay_order_id'] },
    { table: 'fee_payments', index: 'uq_fee_payments_razorpay_payment', columns: ['razorpay_payment_id'] },
    { table: 'fee_payments', index: 'uq_fee_payments_razorpay_qr', columns: ['razorpay_qr_id'] },
    { table: 'fee_payments', index: 'uq_fee_payments_receipt_no', columns: ['receipt_no'] },
    { table: 'fee_payments', index: 'uq_fee_payments_receipt_number', columns: ['receipt_number'] },
    { table: 'subscription_payments', index: 'uq_subpay_razorpay_order', columns: ['razorpay_order_id'] },
    { table: 'subscription_payments', index: 'uq_subpay_razorpay_payment', columns: ['razorpay_payment_id'] },
    { table: 'subscription_payments', index: 'uq_subpay_receipt', columns: ['receipt_no'] },
    { table: 'subscription_payments', index: 'uq_subpay_subscription', columns: ['subscription_id'] },
    { table: 'invoices', index: 'uq_invoices_subscription', columns: ['subscription_id'] },
    { table: 'student_fees', index: 'uq_student_fees_id_school', columns: ['id', 'school_id'] },
    { table: 'fee_payment_allocations', index: 'uq_fee_payment_allocation', columns: ['payment_id', 'student_fee_id'] }
]);
const PAYMENT_INTEGRITY_FOREIGN_KEYS = Object.freeze([
    {
        table: 'fee_payment_allocations',
        constraint: 'fk_fee_allocations_payment_school',
        columns: ['payment_id', 'school_id'],
        referencedTable: 'fee_payments',
        referencedColumns: ['id', 'school_id']
    },
    {
        table: 'fee_payment_allocations',
        constraint: 'fk_fee_allocations_student_fee_school',
        columns: ['student_fee_id', 'school_id'],
        referencedTable: 'student_fees',
        referencedColumns: ['id', 'school_id']
    }
]);
const PAYMENT_INTEGRITY_BINARY_COLUMNS = Object.freeze([
    { table: 'fee_payments', column: 'razorpay_order_id' },
    { table: 'fee_payments', column: 'razorpay_payment_id' },
    { table: 'fee_payments', column: 'razorpay_qr_id' },
    { table: 'subscription_payments', column: 'razorpay_order_id' },
    { table: 'subscription_payments', column: 'razorpay_payment_id' }
]);
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

    const metadataColumns = [
        {
            name: 'status',
            definition: "enum('completed','failed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'completed'"
        },
        {
            name: 'executed_at',
            definition: 'timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP'
        },
        {
            name: 'error_message',
            definition: 'text COLLATE utf8mb4_unicode_ci NULL'
        }
    ];
    for (const column of metadataColumns) {
        if (!(await columnExists(connection, 'migrations', column.name))) {
            await connection.query(
                `ALTER TABLE migrations ADD COLUMN \`${column.name}\` ${column.definition}`
            );
        };
    };
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

async function getForeignKeyRows(connection, foreignKey) {
    const [rows] = await connection.query(
        `SELECT kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_NAME,
            kcu.REFERENCED_COLUMN_NAME, kcu.ORDINAL_POSITION, rc.DELETE_RULE
        FROM information_schema.KEY_COLUMN_USAGE kcu
        JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
            ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
            AND rc.TABLE_NAME = kcu.TABLE_NAME
            AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
        WHERE kcu.CONSTRAINT_SCHEMA = DATABASE()
            AND kcu.TABLE_NAME = ?
            AND kcu.CONSTRAINT_NAME = ?
        ORDER BY kcu.ORDINAL_POSITION`,
        [foreignKey.table, foreignKey.constraint]
    );
    return rows;
};

function hasExactForeignKey(rows, foreignKey) {
    return rows.length === foreignKey.columns.length && rows.every((row, index) =>
        row.COLUMN_NAME === foreignKey.columns[index] &&
        row.REFERENCED_TABLE_NAME === foreignKey.referencedTable &&
        row.REFERENCED_COLUMN_NAME === foreignKey.referencedColumns[index] &&
        String(row.DELETE_RULE).toUpperCase() === 'CASCADE'
    );
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

function canonicalizeReceiptCheckClause(clause) {
    const normalized = String(clause || '')
        .toLowerCase()
        .replace(/`/g, '')
        .replace(
            /cast\s*\(\s*(receipt_no|receipt_number)\s+as\s+binary(?:\s*\(\s*\d+\s*\))?\s*\)/g,
            'binary $1'
        )
        .replace(/\s+/g, ' ')
        .trim();
    const tokens = normalized.match(/receipt_number|receipt_no|binary|is|not|null|and|or|[()=]/g) || [];
    if (!tokens.length || tokens.join('') !== normalized.replace(/\s+/g, '')) return null;

    let position = 0;
    const peek = () => tokens[position];
    const take = (expected) => {
        const token = tokens[position];
        if (expected && token !== expected) {
            throw new Error(`Expected ${expected}, received ${token || 'end of expression'}.`);
        };
        position += 1;
        return token;
    };
    const isReceiptColumn = (token) => token === 'receipt_no' || token === 'receipt_number';

    const parsePredicate = () => {
        if (peek() === 'binary') {
            take('binary');
            const left = take();
            if (!isReceiptColumn(left)) throw new Error('Invalid binary receipt operand.');
            take('=');
            take('binary');
            const right = take();
            if (!isReceiptColumn(right)) throw new Error('Invalid binary receipt operand.');
            return { type: 'binary_equal', columns: [left, right] };
        };

        const column = take();
        if (!isReceiptColumn(column)) throw new Error('Invalid receipt null predicate.');
        take('is');
        let negated = false;
        if (peek() === 'not') {
            take('not');
            negated = true;
        };
        take('null');
        return { type: negated ? 'is_not_null' : 'is_null', column };
    };

    let parseOr;
    const parsePrimary = () => {
        if (peek() !== '(') return parsePredicate();
        take('(');
        const expression = parseOr();
        take(')');
        return expression;
    };
    const parseAnd = () => {
        const children = [parsePrimary()];
        while (peek() === 'and') {
            take('and');
            children.push(parsePrimary());
        };
        return children.length === 1 ? children[0] : { type: 'and', children };
    };
    parseOr = () => {
        const children = [parseAnd()];
        while (peek() === 'or') {
            take('or');
            children.push(parseAnd());
        };
        return children.length === 1 ? children[0] : { type: 'or', children };
    };

    const canonicalizeNode = (node) => {
        if (node.type === 'and' || node.type === 'or') {
            const flattened = [];
            for (const child of node.children) {
                if (child.type === node.type) flattened.push(...child.children);
                else flattened.push(child);
            };
            const children = flattened.map(canonicalizeNode).sort();
            return `${node.type}(${children.join(',')})`;
        };
        if (node.type === 'binary_equal') {
            return `binary_equal(${[...node.columns].sort().join(',')})`;
        };
        return `${node.type}(${node.column})`;
    };

    try {
        const parsed = parseOr();
        if (position !== tokens.length) return null;
        return canonicalizeNode(parsed);
    } catch (_) {
        return null;
    };
};

const REQUIRED_RECEIPT_CHECK = canonicalizeReceiptCheckClause(`
    (receipt_no IS NULL AND receipt_number IS NULL)
    OR (
        receipt_no IS NOT NULL
        AND receipt_number IS NOT NULL
        AND BINARY receipt_no = BINARY receipt_number
    )
`);

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

    if (!(await columnExists(connection, 'fee_payments', 'transaction_id'))) {
        throw new Error('Payment integrity preflight requires fee_payments.transaction_id.');
    };
    const hasQrColumn = await columnExists(connection, 'fee_payments', 'razorpay_qr_id');
    const qrNamespaceSql = hasQrColumn
        ? `SELECT COUNT(*) AS duplicate_groups
            FROM (
                SELECT qr_value
                FROM (
                    SELECT id, razorpay_qr_id AS qr_value
                    FROM fee_payments
                    WHERE NULLIF(TRIM(razorpay_qr_id), '') IS NOT NULL
                    UNION ALL
                    SELECT id, transaction_id AS qr_value
                    FROM fee_payments
                    WHERE NULLIF(TRIM(transaction_id), '') IS NOT NULL
                        AND LEFT(transaction_id, 3) = 'qr_'
                        AND NULLIF(TRIM(razorpay_qr_id), '') IS NULL
                ) qr_values
                GROUP BY BINARY qr_value
                HAVING COUNT(DISTINCT id) > 1
            ) duplicate_qr_values`
        : `SELECT COUNT(*) AS duplicate_groups
            FROM (
                SELECT BINARY transaction_id AS qr_value
                FROM fee_payments
                WHERE NULLIF(TRIM(transaction_id), '') IS NOT NULL
                    AND LEFT(transaction_id, 3) = 'qr_'
                GROUP BY BINARY transaction_id
                HAVING COUNT(*) > 1
            ) duplicate_qr_values`;
    const [[qrDuplicates]] = await connection.query(qrNamespaceSql);
    const qrDuplicateGroups = Number(qrDuplicates?.duplicate_groups || 0);
    if (qrDuplicateGroups > 0) {
        duplicateChecks.push(
            `fee_payments Razorpay QR namespace (${qrDuplicateGroups} duplicate group${qrDuplicateGroups === 1 ? '' : 's'})`
        );
    };

    const [[receiptMismatch]] = await connection.query(
        `SELECT COUNT(*) AS mismatch_count
        FROM fee_payments
        WHERE NULLIF(TRIM(receipt_no), '') IS NOT NULL
            AND NULLIF(TRIM(receipt_number), '') IS NOT NULL
            AND BINARY receipt_no <> BINARY receipt_number`
    );
    if (Number(receiptMismatch?.mismatch_count || 0) > 0) {
        duplicateChecks.push(
            `fee_payments receipt columns (${Number(receiptMismatch.mismatch_count)} mismatched row${Number(receiptMismatch.mismatch_count) === 1 ? '' : 's'})`
        );
    };

    const [[crossReceiptDuplicates]] = await connection.query(
        `SELECT COUNT(*) AS duplicate_groups
        FROM (
            SELECT receipt_value
            FROM (
                SELECT id, receipt_no AS receipt_value
                FROM fee_payments
                WHERE NULLIF(TRIM(receipt_no), '') IS NOT NULL
                UNION ALL
                SELECT id, receipt_number AS receipt_value
                FROM fee_payments
                WHERE NULLIF(TRIM(receipt_number), '') IS NOT NULL
            ) receipt_values
            GROUP BY receipt_value
            HAVING COUNT(DISTINCT id) > 1
        ) duplicate_receipts`
    );
    if (Number(crossReceiptDuplicates?.duplicate_groups || 0) > 0) {
        duplicateChecks.push(
            `fee_payments receipt namespace (${Number(crossReceiptDuplicates.duplicate_groups)} cross-column duplicate group${Number(crossReceiptDuplicates.duplicate_groups) === 1 ? '' : 's'})`
        );
    };

    if (await tableExists(connection, 'fee_payment_allocations')) {
        for (const column of ['school_id', 'payment_id', 'student_fee_id']) {
            if (!(await columnExists(connection, 'fee_payment_allocations', column))) {
                throw new Error(`Payment integrity preflight requires fee_payment_allocations.${column}.`);
            };
        };
        if (!(await tableExists(connection, 'student_fees'))) {
            throw new Error('Payment integrity preflight requires student_fees.');
        };

        const [[crossSchoolAllocations]] = await connection.query(
            `SELECT COUNT(*) AS invalid_count
            FROM fee_payment_allocations fpa
            LEFT JOIN fee_payments fp
                ON fp.id = fpa.payment_id
                AND fp.school_id = fpa.school_id
            LEFT JOIN student_fees sf
                ON sf.id = fpa.student_fee_id
                AND sf.school_id = fpa.school_id
            WHERE fp.id IS NULL OR sf.id IS NULL`
        );
        const invalidAllocationCount = Number(crossSchoolAllocations?.invalid_count || 0);
        if (invalidAllocationCount > 0) {
            duplicateChecks.push(
                `fee_payment_allocations tenant ownership (${invalidAllocationCount} cross-school or orphaned row${invalidAllocationCount === 1 ? '' : 's'})`
            );
        };

        for (const foreignKey of PAYMENT_INTEGRITY_FOREIGN_KEYS) {
            const rows = await getForeignKeyRows(connection, foreignKey);
            if (rows.length > 0 && !hasExactForeignKey(rows, foreignKey)) {
                throw new Error(
                    `Payment integrity preflight found an incompatible existing constraint: ${foreignKey.table}.${foreignKey.constraint}.`
                );
            };
        };
    };

    if (duplicateChecks.length) {
        throw new Error(
            `Duplicate financial identifiers must be reconciled before migration: ${duplicateChecks.join(', ')}`
        );
    };
    return [];
};

async function verifyPaymentIntegrityGuards(connection) {
    const invalidGuards = [];

    for (const guard of PAYMENT_INTEGRITY_INDEXES) {
        const [rows] = await connection.query(
            `SELECT COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = ?
                AND INDEX_NAME = ?
            ORDER BY SEQ_IN_INDEX`,
            [guard.table, guard.index]
        );
        const columns = rows.map((row) => row.COLUMN_NAME);
        const isUnique = rows.length > 0 && rows.every((row) => Number(row.NON_UNIQUE) === 0);
        const hasExactColumns = columns.length === guard.columns.length &&
            columns.every((column, index) => column === guard.columns[index]);
        if (!isUnique || !hasExactColumns) {
            invalidGuards.push(`${guard.table}.${guard.index}(${guard.columns.join(', ')})`);
        };
    };

    for (const foreignKey of PAYMENT_INTEGRITY_FOREIGN_KEYS) {
        const rows = await getForeignKeyRows(connection, foreignKey);
        if (!hasExactForeignKey(rows, foreignKey)) {
            invalidGuards.push(
                `${foreignKey.table}.${foreignKey.constraint}(${foreignKey.columns.join(', ')})`
            );
        };
    };

    for (const guard of PAYMENT_INTEGRITY_BINARY_COLUMNS) {
        const [rows] = await connection.query(
            `SELECT COLLATION_NAME
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = ?
                AND COLUMN_NAME = ?`,
            [guard.table, guard.column]
        );
        if (rows.length !== 1 || String(rows[0].COLLATION_NAME || '').toLowerCase() !== 'utf8mb4_bin') {
            invalidGuards.push(`${guard.table}.${guard.column}(utf8mb4_bin)`);
        };
    };

    const [receiptChecks] = await connection.query(
        `SELECT cc.CHECK_CLAUSE, tc.ENFORCED
        FROM information_schema.CHECK_CONSTRAINTS cc
        JOIN information_schema.TABLE_CONSTRAINTS tc
            ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA
            AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
        WHERE cc.CONSTRAINT_SCHEMA = DATABASE()
            AND tc.TABLE_NAME = 'fee_payments'
            AND cc.CONSTRAINT_NAME = 'chk_fee_payment_receipts_match'
            AND tc.CONSTRAINT_TYPE = 'CHECK'`
    );
    const receiptCheckIsExact = receiptChecks.length === 1 &&
        String(receiptChecks[0].ENFORCED || '').toUpperCase() === 'YES' &&
        canonicalizeReceiptCheckClause(receiptChecks[0].CHECK_CLAUSE) === REQUIRED_RECEIPT_CHECK;
    if (!receiptCheckIsExact) {
        invalidGuards.push('fee_payments.chk_fee_payment_receipts_match');
    };

    if (invalidGuards.length) {
        throw new Error(
            `Payment integrity migration did not install the required guards: ${invalidGuards.join(', ')}`
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

    try {
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
                const duplicatePaymentCheck =
                    migrationName === 'migrations/004_payment_integrity_guards.sql' &&
                    error.errno === 3822;
                if (ignorableErrorNumbers.has(error.errno) || duplicatePaymentCheck) {
                    console.warn(
                        `[Migration] Ignored ${error.code || error.errno}: ${error.sqlMessage || error.message}`
                    );
                    continue;
                };

                error.message = `${error.message}\nWhile running migration ${migrationName}:\n${statement.slice(0, 500)}`;
                throw error;
            };
        };

        if (migrationName === 'migrations/004_payment_integrity_guards.sql') {
            await verifyPaymentIntegrityGuards(connection);
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
    ensureMigrationTable,
    getMigrationFiles,
    main,
    runSqlFile,
    splitStatements,
    stripSqlComments,
    verifyPaymentIntegrityGuards,
    preflightPaymentIntegrity,
    preflightTeacherReferences,
    preflightParentLinks
};
