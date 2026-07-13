const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationRunner = require("../config/runMigration");
const seed = require("../../seed");

test("migration splitter preserves quoted semicolons and ordered migration files", () => {
    const statements = migrationRunner.splitStatements("INSERT INTO x(v) VALUES ('a;b'); UPDATE x SET v='c';");
    assert.equal(statements.length, 2);
    const files = migrationRunner.getMigrationFiles().map((file) => path.basename(file));
    assert.deepEqual(files, [...files].sort());
    assert.ok(files.includes("001_transport_active_trip_guards.sql"));
    assert.ok(files.includes("002_normalize_teacher_references.sql"));
    assert.ok(files.includes("003_disable_trial_auto_renew.sql"));
    assert.ok(files.includes("004_payment_integrity_guards.sql"));
});

test("payment migration postflight requires exact unique index definitions", async () => {
    const definitions = new Map([
        ["fee_payments.uq_fee_payments_id_school", ["id", "school_id"]],
        ["fee_payments.uq_fee_payments_razorpay_order", ["razorpay_order_id"]],
        ["fee_payments.uq_fee_payments_razorpay_payment", ["razorpay_payment_id"]],
        ["fee_payments.uq_fee_payments_razorpay_qr", ["razorpay_qr_id"]],
        ["fee_payments.uq_fee_payments_receipt_no", ["receipt_no"]],
        ["fee_payments.uq_fee_payments_receipt_number", ["receipt_number"]],
        ["subscription_payments.uq_subpay_razorpay_order", ["razorpay_order_id"]],
        ["subscription_payments.uq_subpay_razorpay_payment", ["razorpay_payment_id"]],
        ["subscription_payments.uq_subpay_receipt", ["receipt_no"]],
        ["subscription_payments.uq_subpay_subscription", ["subscription_id"]],
        ["invoices.uq_invoices_subscription", ["subscription_id"]],
        ["student_fees.uq_student_fees_id_school", ["id", "school_id"]],
        ["fee_payment_allocations.uq_fee_payment_allocation", ["payment_id", "student_fee_id"]]
    ]);
    const foreignKeys = new Map([
        ["fee_payment_allocations.fk_fee_allocations_payment_school", {
            columns: ["payment_id", "school_id"],
            referencedTable: "fee_payments",
            referencedColumns: ["id", "school_id"]
        }],
        ["fee_payment_allocations.fk_fee_allocations_student_fee_school", {
            columns: ["student_fee_id", "school_id"],
            referencedTable: "student_fees",
            referencedColumns: ["id", "school_id"]
        }]
    ]);
    let brokenGuard = null;
    let brokenForeignKey = null;
    let brokenBinaryColumn = null;
    let weakReceiptCheck = false;
    const connection = {
        query: async (sql, params = []) => {
            if (sql.includes("CHECK_CONSTRAINTS")) {
                return [[{
                    CHECK_CLAUSE: weakReceiptCheck
                        ? "receipt_no is null or receipt_number is not null and cast(receipt_no as binary) = cast(receipt_number as binary)"
                        : "receipt_no is null and receipt_number is null or receipt_no is not null and receipt_number is not null and cast(receipt_no as binary) = cast(receipt_number as binary)",
                    ENFORCED: "YES"
                }]];
            };
            const [table, index] = params;
            const key = `${table}.${index}`;
            if (sql.includes("KEY_COLUMN_USAGE")) {
                const definition = foreignKeys.get(key);
                if (!definition) return [[]];
                return [definition.columns.map((column, position) => ({
                    COLUMN_NAME: brokenForeignKey === key && position === 0 ? "id" : column,
                    REFERENCED_TABLE_NAME: definition.referencedTable,
                    REFERENCED_COLUMN_NAME: definition.referencedColumns[position],
                    ORDINAL_POSITION: position + 1,
                    DELETE_RULE: "CASCADE"
                }))];
            };
            if (sql.includes("information_schema.COLUMNS")) {
                return [[{
                    COLLATION_NAME: brokenBinaryColumn === key ? "utf8mb4_unicode_ci" : "utf8mb4_bin"
                }]];
            };
            const columns = brokenGuard === key ? ["id"] : definitions.get(key) || [];
            return [columns.map((column, position) => ({
                COLUMN_NAME: column,
                NON_UNIQUE: brokenGuard === key ? 1 : 0,
                SEQ_IN_INDEX: position + 1
            }))];
        }
    };

    await assert.doesNotReject(migrationRunner.verifyPaymentIntegrityGuards(connection));
    brokenGuard = "fee_payments.uq_fee_payments_razorpay_order";
    await assert.rejects(
        migrationRunner.verifyPaymentIntegrityGuards(connection),
        /required guards: fee_payments\.uq_fee_payments_razorpay_order/
    );
    brokenGuard = null;
    brokenForeignKey = "fee_payment_allocations.fk_fee_allocations_payment_school";
    await assert.rejects(
        migrationRunner.verifyPaymentIntegrityGuards(connection),
        /fk_fee_allocations_payment_school/
    );
    brokenForeignKey = null;
    brokenBinaryColumn = "fee_payments.razorpay_order_id";
    await assert.rejects(
        migrationRunner.verifyPaymentIntegrityGuards(connection),
        /fee_payments\.razorpay_order_id\(utf8mb4_bin\)/
    );
    brokenBinaryColumn = null;
    weakReceiptCheck = true;
    await assert.rejects(
        migrationRunner.verifyPaymentIntegrityGuards(connection),
        /chk_fee_payment_receipts_match/
    );
});

test("every fee QR endpoint serializes creation on the pending payment row", () => {
    const controllerPaths = [
        "../controllers/schoolAdmin/razorpayController.js",
        "../controllers/parent/razorpayController.js",
        "../controllers/student/razorpayController.js"
    ];
    for (const controllerPath of controllerPaths) {
        const source = fs.readFileSync(path.resolve(__dirname, controllerPath), "utf8");
        const qrHandler = source.slice(source.indexOf("exports.generateQRCode"));
        assert.match(qrHandler, /FOR UPDATE/);
        assert.match(qrHandler, /razorpay_qr_id IS NULL/);
        assert.match(qrHandler, /status\(409\)/);
    };
});

test("production seed reset is refused and destructive reset requires both flags", () => {
    const credentials = { demoPassword: "strong-demo", superAdminPassword: "strong-admin" };
    assert.throws(
        () => seed.validateSeedConfiguration({ ...credentials, hasResetFlag: true, hasResetConfirmation: false }),
        /requires both --reset and --yes/
    );
    assert.throws(
        () => seed.validateSeedConfiguration({ ...credentials, hasResetFlag: true, hasResetConfirmation: true, nodeEnv: "production" }),
        /Refusing to reset demo data/
    );
    assert.doesNotThrow(() => seed.validateSeedConfiguration({ ...credentials, hasResetFlag: false, hasResetConfirmation: false, nodeEnv: "production" }));
});

test("seed and migration modules are import-safe and do not run automatically", () => {
    const seedSource = fs.readFileSync(path.resolve(__dirname, "../../seed.js"), "utf8");
    const migrationSource = fs.readFileSync(path.resolve(__dirname, "../config/runMigration.js"), "utf8");
    assert.match(seedSource, /require\.main === module/);
    assert.match(migrationSource, /require\.main === module/);
    assert.match(seedSource, /finally[\s\S]*FOREIGN_KEY_CHECKS = 1/);
});
