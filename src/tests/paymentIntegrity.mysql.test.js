"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { after, before, describe, test } = require("node:test");
const mysql = require("mysql2/promise");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
require("dotenv").config({ path: path.join(ROOT_DIR, ".env") });

const databaseName = `schoolsync_pi_${process.pid}_${Date.now()}`;
if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) {
    throw new Error("Unsafe disposable database name.");
};

const serverConfig = {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    socketPath: process.env.DB_SOCKET_PATH || undefined,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || ""
};

const PAYMENT_GUARD_INDEXES = Object.freeze([
    ["fee_payments", "uq_fee_payments_razorpay_order"],
    ["fee_payments", "uq_fee_payments_razorpay_payment"],
    ["fee_payments", "uq_fee_payments_receipt_no"],
    ["fee_payments", "uq_fee_payments_receipt_number"],
    ["subscription_payments", "uq_subpay_razorpay_order"],
    ["subscription_payments", "uq_subpay_razorpay_payment"],
    ["subscription_payments", "uq_subpay_receipt"],
    ["subscription_payments", "uq_subpay_subscription"],
    ["invoices", "uq_invoices_subscription"],
    ["fee_payment_allocations", "uq_fee_payment_allocation"]
]);

let adminConnection;
let schemaConnection;
let appDb;
let feePaymentService;
let subscriptionPaymentService;
let schoolAdminRazorpayController;
let razorpayConfig;

const fixtures = {
    legacyFeePaymentIds: [],
    legacySubscriptionPaymentIds: []
};

function migrationStatements(sql) {
    return sql
        .split(";")
        .map((statement) => statement.trim())
        .filter(Boolean);
};

async function insertSchool(label, status = "active", subscriptionStatus = "active") {
    const [result] = await schemaConnection.execute(
        `INSERT INTO schools
        (school_name, school_type, medium, status, subscription_status, created_at, updated_at)
        VALUES (?, 'secondary', 'English', ?, ?, NOW(), NOW())`,
        [`Payment Integrity ${label}`, status, subscriptionStatus]
    );
    return result.insertId;
};

async function insertStudentFixture(label, status = "active", subscriptionStatus = "active") {
    const schoolId = await insertSchool(label, status, subscriptionStatus);
    const [userResult] = await schemaConnection.execute(
        `INSERT INTO users
        (school_id, first_name, last_name, email, role, status, created_at, updated_at)
        VALUES (?, 'Integrity', ?, ?, 'student', 'active', NOW(), NOW())`,
        [schoolId, label, `${label.toLowerCase()}@payment-integrity.test`]
    );
    const [studentResult] = await schemaConnection.execute(
        `INSERT INTO students
        (school_id, user_id, admission_no, dob, admission_date, status, created_at, updated_at)
        VALUES (?, ?, ?, '2010-01-01', '2025-06-01', 'active', NOW(), NOW())`,
        [schoolId, userResult.insertId, `PI-${label}`]
    );
    return { schoolId, userId: userResult.insertId, studentId: studentResult.insertId };
};

async function insertPendingSubscriptionPayment({ schoolId, orderId, receiptNo }) {
    const notes = JSON.stringify({
        gateway: "razorpay",
        razorpay_order_id: orderId,
        school_id: schoolId,
        plan_id: fixtures.planId,
        billing_cycle: "monthly"
    });
    const [result] = await schemaConnection.execute(
        `INSERT INTO subscription_payments
        (school_id, plan_id, amount, tax_amount, discount_amount, total_amount,
         payment_method, transaction_id, receipt_no, status, notes, razorpay_order_id,
         billing_cycle, currency, payment_status, payment_reference, created_at, updated_at)
        VALUES (?, ?, 100.00, 0.00, 0.00, 100.00,
                'online', ?, ?, 'pending', ?, ?,
                'monthly', 'INR', 'pending', ?, NOW(), NOW())`,
        [schoolId, fixtures.planId, orderId, receiptNo, notes, orderId, orderId]
    );
    return result.insertId;
};

async function seedFixturesBeforeMigration() {
    const [planResult] = await schemaConnection.execute(
        `INSERT INTO plans
        (name, plan_key, price, monthly_price, yearly_price, trial_days, is_active, status, created_at)
        VALUES ('Integrity Paid', 'integrity_paid', 100.00, 100.00, 1000.00, 0, 1, 'active', NOW())`
    );
    fixtures.planId = planResult.insertId;

    fixtures.feeRace = await insertStudentFixture("FeeRace");
    fixtures.feeRollback = await insertStudentFixture("FeeRollback");
    fixtures.feeSupersession = await insertStudentFixture("FeeSupersession");
    fixtures.subscriptionRace = {
        schoolId: await insertSchool("SubscriptionRace", "inactive", "inactive")
    };
    fixtures.subscriptionRollback = {
        schoolId: await insertSchool("SubscriptionRollback", "inactive", "inactive")
    };
    fixtures.constraintSchoolId = await insertSchool("Constraints");

    const [legacyFeeOne] = await schemaConnection.execute(
        `INSERT INTO fee_payments
        (school_id, amount, payment_method, status, razorpay_order_id, razorpay_payment_id,
         receipt_no, receipt_number, created_at)
        VALUES (?, 1.00, 'online', 'failed', '', '', '', '', NOW())`,
        [fixtures.constraintSchoolId]
    );
    const [legacyFeeTwo] = await schemaConnection.execute(
        `INSERT INTO fee_payments
        (school_id, amount, payment_method, status, razorpay_order_id, razorpay_payment_id,
         receipt_no, receipt_number, created_at)
        VALUES (?, 1.00, 'online', 'failed', '', '', '', '', NOW())`,
        [fixtures.constraintSchoolId]
    );
    fixtures.legacyFeePaymentIds.push(legacyFeeOne.insertId, legacyFeeTwo.insertId);

    for (const suffix of ["one", "two"]) {
        const [legacySubscription] = await schemaConnection.execute(
            `INSERT INTO subscription_payments
            (school_id, plan_id, amount, total_amount, payment_method, receipt_no, status,
             razorpay_order_id, razorpay_payment_id, created_at, updated_at)
            VALUES (?, ?, 1.00, 1.00, 'online', ?, 'failed', '', '', NOW(), NOW())`,
            [fixtures.constraintSchoolId, fixtures.planId, `legacy-sub-${suffix}`]
        );
        fixtures.legacySubscriptionPaymentIds.push(legacySubscription.insertId);
    };
};

async function assertDuplicatePair(sql, firstParams, secondParams) {
    await schemaConnection.beginTransaction();
    try {
        await schemaConnection.execute(sql, firstParams);
        await assert.rejects(
            schemaConnection.execute(sql, secondParams),
            (error) => error && error.code === "ER_DUP_ENTRY"
        );
    } finally {
        await schemaConnection.rollback();
    };
};

function fakeJsonResponse() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };
};

async function insertStudentFee({ schoolId, studentId, month, amount }) {
    const [result] = await schemaConnection.execute(
        `INSERT INTO student_fees
        (school_id, student_id, fee_month, due_date, total_amount, paid_amount, status, created_at, updated_at)
        VALUES (?, ?, ?, '2026-08-01', ?, 0.00, 'pending', NOW(), NOW())`,
        [schoolId, studentId, month, amount]
    );
    return result.insertId;
};

describe("payment integrity against a disposable MySQL database", { concurrency: false }, () => {
    before(async () => {
        adminConnection = await mysql.createConnection(serverConfig);
        await adminConnection.query(
            `CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        );

        schemaConnection = await mysql.createConnection({
            ...serverConfig,
            database: databaseName,
            multipleStatements: true
        });
        const schemaSql = fs.readFileSync(path.join(ROOT_DIR, "database.sql"), "utf8");
        await schemaConnection.query(schemaSql);

        // Recreate an upgrade target so this run proves migration 004, not only the fresh schema.
        await schemaConnection.query("DROP TABLE fee_payment_allocations");
        // Keep a non-unique supporting index while removing the unique index used by the FK.
        await schemaConnection.query(
            "ALTER TABLE subscription_payments ADD KEY pi_subscription_fk_support (subscription_id)"
        );
        for (const [tableName, indexName] of PAYMENT_GUARD_INDEXES) {
            if (tableName === "fee_payment_allocations") continue;
            await schemaConnection.query(
                `ALTER TABLE \`${tableName}\` DROP INDEX \`${indexName}\``
            );
        };
        await schemaConnection.query(
            `ALTER TABLE fee_payments
             MODIFY razorpay_order_id VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
             MODIFY razorpay_payment_id VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL`
        );
        await schemaConnection.query(
            `ALTER TABLE subscription_payments
             MODIFY razorpay_order_id VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
             MODIFY razorpay_payment_id VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL`
        );

        await seedFixturesBeforeMigration();

        const migrationPath = path.join(ROOT_DIR, "migrations", "004_payment_integrity_guards.sql");
        const migrationSql = fs.readFileSync(migrationPath, "utf8");
        for (const statement of migrationStatements(migrationSql)) {
            await schemaConnection.query(statement);
        };

        process.env.NODE_ENV = "test";
        process.env.DB_NAME = databaseName;
        process.env.RAZORPAY_KEY_ID = "rzp_test_payment_integrity";
        process.env.RAZORPAY_KEY_SECRET = "payment-integrity-secret";
        process.env.RAZORPAY_WEBHOOK_SECRET = "payment-integrity-webhook-secret";

        appDb = require("../config/database");
        feePaymentService = require("../services/feePaymentService");
        subscriptionPaymentService = require("../services/subscriptionPaymentService");
        razorpayConfig = require("../config/razorpay");
        schoolAdminRazorpayController = require("../controllers/schoolAdmin/razorpayController");
        await appDb.query("SELECT 1");
    });

    after(async () => {
        let cleanupError = null;
        try {
            if (appDb?.pool) await appDb.pool.promise().end();
        } catch (error) {
            cleanupError = error;
        };
        try {
            if (schemaConnection) await schemaConnection.end();
        } catch (error) {
            cleanupError ||= error;
        };
        try {
            if (adminConnection) {
                await adminConnection.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
            };
        } catch (error) {
            cleanupError ||= error;
        } finally {
            if (adminConnection) await adminConnection.end().catch(() => {});
        };
        if (cleanupError) throw cleanupError;
    });

    test("migration 004 installs all unique guards and normalizes legacy blank IDs", async () => {
        const [indexes] = await schemaConnection.query(
            `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE
             FROM information_schema.statistics
             WHERE table_schema = ? AND INDEX_NAME IN (${PAYMENT_GUARD_INDEXES.map(() => "?").join(",")})`,
            [databaseName, ...PAYMENT_GUARD_INDEXES.map(([, indexName]) => indexName)]
        );
        for (const [tableName, indexName] of PAYMENT_GUARD_INDEXES) {
            const matching = indexes.filter((index) =>
                index.TABLE_NAME === tableName && index.INDEX_NAME === indexName
            );
            assert.ok(matching.length >= 1, `${tableName}.${indexName} must exist`);
            assert.ok(matching.every((index) => Number(index.NON_UNIQUE) === 0), `${indexName} must be unique`);
        };

        const [idColumns] = await schemaConnection.query(
            `SELECT TABLE_NAME, COLUMN_NAME, COLLATION_NAME
             FROM information_schema.columns
             WHERE table_schema = ?
               AND TABLE_NAME IN ('fee_payments', 'subscription_payments')
               AND COLUMN_NAME IN ('razorpay_order_id', 'razorpay_payment_id')`,
            [databaseName]
        );
        assert.equal(idColumns.length, 4);
        assert.ok(idColumns.every((column) => column.COLLATION_NAME === "utf8mb4_bin"));

        const [legacyFees] = await schemaConnection.query(
            `SELECT razorpay_order_id, razorpay_payment_id, receipt_no, receipt_number
             FROM fee_payments WHERE id IN (?, ?)`,
            fixtures.legacyFeePaymentIds
        );
        assert.equal(legacyFees.length, 2);
        assert.ok(legacyFees.every((row) => Object.values(row).every((value) => value === null)));

        const [legacySubscriptions] = await schemaConnection.query(
            `SELECT razorpay_order_id, razorpay_payment_id
             FROM subscription_payments WHERE id IN (?, ?)`,
            fixtures.legacySubscriptionPaymentIds
        );
        assert.equal(legacySubscriptions.length, 2);
        assert.ok(legacySubscriptions.every((row) => Object.values(row).every((value) => value === null)));
    });

    test("Razorpay IDs, receipts, subscription links, and invoice links reject duplicates", async () => {
        const feeInsert = `INSERT INTO fee_payments
            (school_id, amount, payment_method, status, receipt_no, receipt_number,
             razorpay_order_id, razorpay_payment_id, created_at)
            VALUES (?, 10.00, 'online', 'pending', ?, ?, ?, ?, NOW())`;
        const feeCases = [
            ["fee-receipt", null, null, null],
            [null, "fee-receipt-number", null, null],
            [null, null, "order_fee_unique", null],
            [null, null, null, "pay_fee_unique"]
        ];
        for (const values of feeCases) {
            const params = [fixtures.constraintSchoolId, ...values];
            await assertDuplicatePair(feeInsert, params, params);
        };

        const subscriptionInsert = `INSERT INTO subscription_payments
            (school_id, plan_id, amount, total_amount, payment_method, receipt_no, status,
             razorpay_order_id, razorpay_payment_id, created_at, updated_at)
            VALUES (?, ?, 10.00, 10.00, 'online', ?, 'pending', ?, ?, NOW(), NOW())`;
        await assertDuplicatePair(
            subscriptionInsert,
            [fixtures.constraintSchoolId, fixtures.planId, "sub-receipt-a", "order_sub_unique", null],
            [fixtures.constraintSchoolId, fixtures.planId, "sub-receipt-b", "order_sub_unique", null]
        );
        await assertDuplicatePair(
            subscriptionInsert,
            [fixtures.constraintSchoolId, fixtures.planId, "sub-receipt-c", null, "pay_sub_unique"],
            [fixtures.constraintSchoolId, fixtures.planId, "sub-receipt-d", null, "pay_sub_unique"]
        );
        await assertDuplicatePair(
            subscriptionInsert,
            [fixtures.constraintSchoolId, fixtures.planId, "sub-receipt-duplicate", null, null],
            [fixtures.constraintSchoolId, fixtures.planId, "sub-receipt-duplicate", null, null]
        );

        await schemaConnection.beginTransaction();
        try {
            const [subscription] = await schemaConnection.execute(
                `INSERT INTO subscriptions
                (school_id, plan_id, plan, price, start_date, end_date, status, payment_status, billing_cycle)
                VALUES (?, ?, 'integrity_paid', 100.00, '2026-07-01', '2026-08-01', 'active', 'paid', 'monthly')`,
                [fixtures.constraintSchoolId, fixtures.planId]
            );
            await schemaConnection.execute(subscriptionInsert, [
                fixtures.constraintSchoolId,
                fixtures.planId,
                "sub-link-a",
                null,
                null
            ]);
            const [[firstPayment]] = await schemaConnection.query(
                "SELECT id FROM subscription_payments WHERE receipt_no = 'sub-link-a'"
            );
            await schemaConnection.execute(
                "UPDATE subscription_payments SET subscription_id = ? WHERE id = ?",
                [subscription.insertId, firstPayment.id]
            );
            await assert.rejects(
                schemaConnection.execute(
                    `${subscriptionInsert.replace("created_at, updated_at)", "subscription_id, created_at, updated_at)")
                        .replace("?, ?, NOW(), NOW())", "?, ?, ?, NOW(), NOW())")}`,
                    [fixtures.constraintSchoolId, fixtures.planId, "sub-link-b", null, null, subscription.insertId]
                ),
                (error) => error && error.code === "ER_DUP_ENTRY"
            );

            const invoiceInsert = `INSERT INTO invoices
                (school_id, subscription_id, invoice_no, amount, tax_amount, discount_amount,
                 total_amount, status, billing_date, due_date, created_at, updated_at)
                VALUES (?, ?, ?, 100.00, 0.00, 0.00, 100.00, 'unpaid', '2026-07-01', '2026-07-02', NOW(), NOW())`;
            await schemaConnection.execute(invoiceInsert, [
                fixtures.constraintSchoolId,
                subscription.insertId,
                "INV-UNIQUE-A"
            ]);
            await assert.rejects(
                schemaConnection.execute(invoiceInsert, [
                    fixtures.constraintSchoolId,
                    subscription.insertId,
                    "INV-UNIQUE-B"
                ]),
                (error) => error && error.code === "ER_DUP_ENTRY"
            );

            const [studentFee] = await schemaConnection.execute(
                `INSERT INTO student_fees
                (school_id, student_id, fee_month, total_amount, paid_amount, status, created_at, updated_at)
                VALUES (?, ?, '2025-01', 10.00, 0.00, 'pending', NOW(), NOW())`,
                [fixtures.feeSupersession.schoolId, fixtures.feeSupersession.studentId]
            );
            const [feePayment] = await schemaConnection.execute(
                `INSERT INTO fee_payments
                (school_id, student_id, amount, payment_method, status, razorpay_order_id, created_at)
                VALUES (?, ?, 10.00, 'online', 'pending', 'order_allocation_unique', NOW())`,
                [fixtures.feeSupersession.schoolId, fixtures.feeSupersession.studentId]
            );
            const allocationInsert = `INSERT INTO fee_payment_allocations
                (school_id, payment_id, student_fee_id, amount, created_at)
                VALUES (?, ?, ?, 10.00, NOW())`;
            const allocationParams = [
                fixtures.feeSupersession.schoolId,
                feePayment.insertId,
                studentFee.insertId
            ];
            await schemaConnection.execute(allocationInsert, allocationParams);
            await assert.rejects(
                schemaConnection.execute(allocationInsert, allocationParams),
                (error) => error && error.code === "ER_DUP_ENTRY"
            );
        } finally {
            await schemaConnection.rollback();
        };
    });

    test("concurrent database writes retain only one payment and one invoice", async () => {
        const feeOrder = "order_concurrent_db_fee";
        const feeSql = `INSERT INTO fee_payments
            (school_id, amount, payment_method, status, receipt_no, razorpay_order_id, created_at)
            VALUES (?, 20.00, 'online', 'pending', ?, ?, NOW())`;
        const feeResults = await Promise.allSettled([
            appDb.execute(feeSql, [fixtures.constraintSchoolId, "db-fee-a", feeOrder]),
            appDb.execute(feeSql, [fixtures.constraintSchoolId, "db-fee-b", feeOrder])
        ]);
        assert.equal(feeResults.filter((result) => result.status === "fulfilled").length, 1);
        assert.equal(feeResults.filter((result) => result.status === "rejected" && result.reason.code === "ER_DUP_ENTRY").length, 1);

        const subscriptionOrder = "order_concurrent_db_subscription";
        const subscriptionSql = `INSERT INTO subscription_payments
            (school_id, plan_id, amount, total_amount, payment_method, receipt_no, status,
             razorpay_order_id, created_at, updated_at)
            VALUES (?, ?, 20.00, 20.00, 'online', ?, 'pending', ?, NOW(), NOW())`;
        const subscriptionResults = await Promise.allSettled([
            appDb.execute(subscriptionSql, [fixtures.constraintSchoolId, fixtures.planId, "db-sub-a", subscriptionOrder]),
            appDb.execute(subscriptionSql, [fixtures.constraintSchoolId, fixtures.planId, "db-sub-b", subscriptionOrder])
        ]);
        assert.equal(subscriptionResults.filter((result) => result.status === "fulfilled").length, 1);
        assert.equal(subscriptionResults.filter((result) => result.status === "rejected" && result.reason.code === "ER_DUP_ENTRY").length, 1);

        const [subscription] = await schemaConnection.execute(
            `INSERT INTO subscriptions
            (school_id, plan_id, plan, price, start_date, end_date, status, payment_status, billing_cycle)
            VALUES (?, ?, 'integrity_paid', 100.00, '2026-09-01', '2026-10-01', 'scheduled', 'paid', 'monthly')`,
            [fixtures.constraintSchoolId, fixtures.planId]
        );
        const invoiceSql = `INSERT INTO invoices
            (school_id, subscription_id, invoice_no, amount, tax_amount, discount_amount,
             total_amount, status, billing_date, due_date, created_at, updated_at)
            VALUES (?, ?, ?, 100.00, 0.00, 0.00, 100.00, 'unpaid', '2026-09-01', '2026-09-02', NOW(), NOW())`;
        const invoiceResults = await Promise.allSettled([
            appDb.execute(invoiceSql, [fixtures.constraintSchoolId, subscription.insertId, "INV-CONCURRENT-A"]),
            appDb.execute(invoiceSql, [fixtures.constraintSchoolId, subscription.insertId, "INV-CONCURRENT-B"])
        ]);
        assert.equal(invoiceResults.filter((result) => result.status === "fulfilled").length, 1);
        assert.equal(invoiceResults.filter((result) => result.status === "rejected" && result.reason.code === "ER_DUP_ENTRY").length, 1);

        const [[counts]] = await schemaConnection.query(
            `SELECT
                (SELECT COUNT(*) FROM fee_payments WHERE razorpay_order_id = ?) AS fee_count,
                (SELECT COUNT(*) FROM subscription_payments WHERE razorpay_order_id = ?) AS subscription_payment_count,
                (SELECT COUNT(*) FROM invoices WHERE subscription_id = ?) AS invoice_count`,
            [feeOrder, subscriptionOrder, subscription.insertId]
        );
        assert.deepEqual(
            [Number(counts.fee_count), Number(counts.subscription_payment_count), Number(counts.invoice_count)],
            [1, 1, 1]
        );
    });

    test("concurrent fee order attempts allocate a fee once and callbacks complete it once", async () => {
        const feeId = await insertStudentFee({
            ...fixtures.feeRace,
            month: "2026-07",
            amount: 250
        });
        const originalCreateOrder = razorpayConfig.instance.orders.create;
        let gatewayCalls = 0;
        razorpayConfig.instance.orders.create = async ({ amount, currency }) => {
            gatewayCalls += 1;
            return { id: `order_fee_allocation_${gatewayCalls}`, amount, currency };
        };

        try {
            const responses = [fakeJsonResponse(), fakeJsonResponse()];
            await Promise.all([
                schoolAdminRazorpayController.createOrder({
                    session: { user: { school_id: fixtures.feeRace.schoolId } },
                    body: { student_id: fixtures.feeRace.studentId, fee_ids: [feeId] }
                }, responses[0]),
                schoolAdminRazorpayController.createOrder({
                    session: { user: { school_id: fixtures.feeRace.schoolId } },
                    body: { student_id: fixtures.feeRace.studentId, fee_ids: [feeId] }
                }, responses[1])
            ]);

            const successfulResponses = responses.filter((response) => response.statusCode === 200 && response.body?.success);
            const rejectedResponses = responses.filter((response) => response.statusCode === 409 && !response.body?.success);
            assert.equal(successfulResponses.length, 1);
            assert.equal(rejectedResponses.length, 1);
            assert.equal(gatewayCalls, 1, "the losing transaction must fail before creating another gateway order");

            const paymentId = successfulResponses[0].body.data.payment_id;
            const completionResults = await Promise.all([
                feePaymentService.completeFeePayment({
                    paymentId,
                    razorpayPaymentId: "pay_fee_callback_race",
                    razorpaySignature: "callback-signature"
                }),
                feePaymentService.completeFeePayment({
                    paymentId,
                    razorpayPaymentId: "pay_fee_callback_race",
                    razorpaySignature: "webhook-signature"
                })
            ]);
            assert.deepEqual(
                completionResults.map((result) => result.alreadyProcessed).sort(),
                [false, true]
            );

            const [[fee]] = await schemaConnection.query(
                "SELECT status, paid_amount, payment_id FROM student_fees WHERE id = ?",
                [feeId]
            );
            const [[payment]] = await schemaConnection.query(
                `SELECT status, razorpay_payment_id, receipt_no, receipt_number
                 FROM fee_payments WHERE id = ?`,
                [paymentId]
            );
            const [[paymentCount]] = await schemaConnection.query(
                "SELECT COUNT(*) AS count FROM fee_payments WHERE student_id = ? AND status = 'completed'",
                [fixtures.feeRace.studentId]
            );
            const [[allocation]] = await schemaConnection.query(
                `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount
                 FROM fee_payment_allocations WHERE payment_id = ? AND student_fee_id = ?`,
                [paymentId, feeId]
            );
            assert.equal(fee.status, "paid");
            assert.equal(Number(fee.paid_amount), 250);
            assert.equal(Number(fee.payment_id), Number(paymentId));
            assert.equal(payment.status, "completed");
            assert.equal(payment.razorpay_payment_id, "pay_fee_callback_race");
            assert.ok(payment.receipt_no);
            assert.equal(payment.receipt_no, payment.receipt_number);
            assert.equal(Number(paymentCount.count), 1);
            assert.equal(Number(allocation.count), 1);
            assert.equal(Number(allocation.amount), 250);
        } finally {
            razorpayConfig.instance.orders.create = originalCreateOrder;
        };
    });

    test("fee order transaction rolls back earlier writes when allocation ledger insertion fails", async () => {
        const feeId = await insertStudentFee({
            ...fixtures.feeRollback,
            month: "2026-08",
            amount: 75
        });
        const orderId = "order_forced_fee_claim_rollback";
        const triggerName = "pi_fail_fee_allocation";
        const originalCreateOrder = razorpayConfig.instance.orders.create;
        razorpayConfig.instance.orders.create = async ({ amount, currency }) => ({
            id: orderId,
            amount,
            currency
        });

        await schemaConnection.query(
            `CREATE TRIGGER ${triggerName}
             BEFORE INSERT ON fee_payment_allocations
             FOR EACH ROW
             BEGIN
                IF NEW.student_fee_id = ${Number(feeId)} THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced fee allocation failure';
                END IF;
             END`
        );
        try {
            const response = fakeJsonResponse();
            await schoolAdminRazorpayController.createOrder({
                session: { user: { school_id: fixtures.feeRollback.schoolId } },
                body: { student_id: fixtures.feeRollback.studentId, fee_ids: [feeId] }
            }, response);
            assert.equal(response.statusCode, 500);
            assert.equal(response.body?.success, false);

            const [[paymentCount]] = await schemaConnection.query(
                "SELECT COUNT(*) AS count FROM fee_payments WHERE razorpay_order_id = ?",
                [orderId]
            );
            const [[allocationCount]] = await schemaConnection.query(
                "SELECT COUNT(*) AS count FROM fee_payment_allocations WHERE student_fee_id = ?",
                [feeId]
            );
            const [[fee]] = await schemaConnection.query(
                "SELECT status, paid_amount, payment_id FROM student_fees WHERE id = ?",
                [feeId]
            );
            assert.equal(Number(paymentCount.count), 0, "the inserted payment must roll back");
            assert.equal(Number(allocationCount.count), 0, "the allocation ledger write must not survive");
            assert.equal(fee.status, "pending");
            assert.equal(Number(fee.paid_amount), 0);
            assert.equal(fee.payment_id, null);
        } finally {
            razorpayConfig.instance.orders.create = originalCreateOrder;
            await schemaConnection.query(`DROP TRIGGER IF EXISTS ${triggerName}`);
        };
    });

    test("a callback racing a captured webhook activates one subscription and history row", async () => {
        const orderId = "order_subscription_callback_webhook_race";
        const paymentId = "pay_subscription_callback_webhook_race";
        await insertPendingSubscriptionPayment({
            schoolId: fixtures.subscriptionRace.schoolId,
            orderId,
            receiptNo: "sub-race-receipt"
        });
        const signature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(`${orderId}|${paymentId}`)
            .digest("hex");

        const [callbackResult, webhookResult] = await Promise.all([
            subscriptionPaymentService.verifyPayment({
                schoolId: fixtures.subscriptionRace.schoolId,
                orderId,
                paymentId,
                signature,
                planId: fixtures.planId,
                billingCycle: "monthly"
            }),
            subscriptionPaymentService.handleCapturedWebhook(orderId, paymentId, "webhook-event-signature")
        ]);
        assert.equal(callbackResult.success, true);
        assert.equal(webhookResult.success, true);

        const [[counts]] = await schemaConnection.query(
            `SELECT
                (SELECT COUNT(*) FROM subscriptions WHERE school_id = ?) AS subscription_count,
                (SELECT COUNT(*) FROM subscription_history WHERE school_id = ?) AS history_count,
                (SELECT COUNT(*) FROM subscription_payments WHERE school_id = ? AND status = 'completed') AS payment_count`,
            [
                fixtures.subscriptionRace.schoolId,
                fixtures.subscriptionRace.schoolId,
                fixtures.subscriptionRace.schoolId
            ]
        );
        assert.deepEqual(
            [Number(counts.subscription_count), Number(counts.history_count), Number(counts.payment_count)],
            [1, 1, 1]
        );

        const [[payment]] = await schemaConnection.query(
            `SELECT status, subscription_id, razorpay_order_id, razorpay_payment_id
             FROM subscription_payments WHERE razorpay_order_id = ?`,
            [orderId]
        );
        assert.equal(payment.status, "completed");
        assert.equal(payment.razorpay_payment_id, paymentId);
        assert.ok(payment.subscription_id);
    });

    test("subscription activation rolls back all earlier writes when history insertion fails", async () => {
        const orderId = "order_forced_subscription_rollback";
        const paymentId = "pay_forced_subscription_rollback";
        await insertPendingSubscriptionPayment({
            schoolId: fixtures.subscriptionRollback.schoolId,
            orderId,
            receiptNo: "sub-rollback-receipt"
        });
        const triggerName = "pi_fail_subscription_history";
        await schemaConnection.query(
            `CREATE TRIGGER ${triggerName}
             BEFORE INSERT ON subscription_history
             FOR EACH ROW
             SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced subscription history failure'`
        );

        try {
            await assert.rejects(
                subscriptionPaymentService.handleCapturedWebhook(orderId, paymentId, "webhook-signature"),
                /forced subscription history failure/
            );

            const [[counts]] = await schemaConnection.query(
                `SELECT
                    (SELECT COUNT(*) FROM subscriptions WHERE school_id = ?) AS subscription_count,
                    (SELECT COUNT(*) FROM subscription_history WHERE school_id = ?) AS history_count`,
                [fixtures.subscriptionRollback.schoolId, fixtures.subscriptionRollback.schoolId]
            );
            const [[payment]] = await schemaConnection.query(
                `SELECT status, subscription_id, transaction_id, razorpay_payment_id
                 FROM subscription_payments WHERE razorpay_order_id = ?`,
                [orderId]
            );
            const [[school]] = await schemaConnection.query(
                "SELECT status, subscription_status, plan_id, current_plan_id FROM schools WHERE id = ?",
                [fixtures.subscriptionRollback.schoolId]
            );
            assert.equal(Number(counts.subscription_count), 0);
            assert.equal(Number(counts.history_count), 0);
            assert.equal(payment.status, "pending");
            assert.equal(payment.subscription_id, null);
            assert.equal(payment.transaction_id, orderId);
            assert.equal(payment.razorpay_payment_id, null);
            assert.equal(school.status, "inactive");
            assert.equal(school.subscription_status, "inactive");
            assert.equal(school.plan_id, null);
            assert.equal(school.current_plan_id, null);
        } finally {
            await schemaConnection.query(`DROP TRIGGER IF EXISTS ${triggerName}`);
        };
    });
});
