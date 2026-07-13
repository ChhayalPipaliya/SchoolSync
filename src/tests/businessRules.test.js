const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    addCycleToDate,
    amountForPlan,
    calculateSubscriptionEndDate,
    normalizeBillingCycle,
    toSqlDate
} = require("../utils/subscriptionPeriods");

function replaceModule(modulePath, exports) {
    const resolved = require.resolve(modulePath);
    const previous = require.cache[resolved];
    require.cache[resolved] = {
        id: resolved,
        filename: resolved,
        loaded: true,
        exports
    };
    return () => {
        if (previous) require.cache[resolved] = previous;
        else delete require.cache[resolved];
    };
}

function fakePlanRequest(overrides = {}) {
    const flashes = [];
    return {
        req: {
            body: {
                name: "Trial",
                plan_key: "trial",
                monthly_price: "0",
                yearly_price: "0",
                max_students: "",
                max_teachers: "",
                max_classes: "",
                trial_days: "15",
                is_active: "on",
                ...overrides
            },
            params: { id: "44" },
            path: "/superadmin/plans",
            user: { id: 1, role: "super_admin" },
            flash: (type, message) => flashes.push({ type, message })
        },
        res: {
            redirectPath: null,
            redirect(path) { this.redirectPath = path; }
        },
        flashes
    };
}

function loadPlanController() {
    const calls = [];
    const database = {
        queryAsync: async (sql) => {
            calls.push({ kind: "query", sql, params: arguments[1] });
            if (/SELECT \* FROM plans WHERE id/.test(sql)) return [{ id: 44, plan_key: "trial" }];
            return [];
        },
        executeAsync: async (sql, params = []) => {
            calls.push({ kind: "execute", sql, params });
            if (/INSERT INTO plans/.test(sql)) return { insertId: 44, affectedRows: 1 };
            return { affectedRows: 1 };
        }
    };
    const restores = [
        replaceModule("../config/database", database),
        replaceModule("../utils/auditLogger", { logSchoolActivity: async () => {} }),
        replaceModule("../utils/planCache", {
            invalidatePlanCache: async () => {},
            invalidateSubscriptionCache: async () => {}
        })
    ];
    const controllerPath = require.resolve("../controllers/superAdmin/planController");
    delete require.cache[controllerPath];
    const controller = require(controllerPath);
    return {
        calls,
        controller,
        restore() {
            delete require.cache[controllerPath];
            restores.reverse().forEach((fn) => fn());
        }
    };
}

test("monthly and yearly subscriptions use calendar durations", () => {
    assert.equal(normalizeBillingCycle("monthly"), "monthly");
    assert.equal(normalizeBillingCycle("yearly"), "yearly");
    assert.equal(normalizeBillingCycle("weekly"), null);
    assert.equal(toSqlDate(addCycleToDate(new Date("2025-01-31T00:00:00Z"), "monthly")), "2025-02-28");
    assert.equal(toSqlDate(addCycleToDate(new Date("2024-02-29T00:00:00Z"), "yearly")), "2025-02-28");
    assert.equal(toSqlDate(calculateSubscriptionEndDate(new Date("2026-07-01T00:00:00Z"), "monthly")), "2026-08-01");
    assert.equal(toSqlDate(calculateSubscriptionEndDate(new Date("2026-07-01T00:00:00Z"), "yearly")), "2027-07-01");
    assert.equal(amountForPlan({ monthly_price: "999", yearly_price: "9999" }, "monthly"), 999);
    assert.equal(amountForPlan({ monthly_price: "999", yearly_price: "9999" }, "yearly"), 9999);
});

test("Trial plan creation always stores 7 days and all features", async () => {
    const harness = loadPlanController();
    try {
        const { req, res } = fakePlanRequest({ trial_days: "15" });
        await harness.controller.create(req, res);
        const insert = harness.calls.find((call) => call.kind === "execute" && /INSERT INTO plans/.test(call.sql));
        assert.ok(insert, "plan INSERT should execute");
        assert.equal(insert.params[12], 7);
        const features = JSON.parse(insert.params[11]);
        assert.equal(features.admissions, true);
        assert.equal(Object.values(features).every(Boolean), true);
        assert.equal(res.redirectPath, "/superadmin/plans");
    } finally {
        harness.restore();
    }
});

test("Trial plan update stores 7 days while paid plans require zero", async () => {
    const harness = loadPlanController();
    try {
        const trial = fakePlanRequest({ trial_days: "0" });
        await harness.controller.update(trial.req, trial.res);
        const update = harness.calls.find((call) => call.kind === "execute" && /UPDATE plans SET/.test(call.sql));
        assert.ok(update, "plan UPDATE should execute");
        assert.equal(update.params[12], 7);

        assert.equal(harness.controller._test.resolveTrialDays("basic", "Basic", "0"), 0);
        assert.throws(
            () => harness.controller._test.resolveTrialDays("basic", "Basic", "7"),
            /Paid plans must use 0 trial days/
        );
        assert.throws(
            () => harness.controller._test.resolveTrialDays("trial", "Trial", "abc"),
            /non-negative whole number/
        );
    } finally {
        harness.restore();
    }
});

function loadSubscriptionService({ school, historyRows = [] }) {
    const writes = [];
    const db = {
        queryAsync: async (sql) => {
            if (/FROM subscriptions sub/.test(sql)) return historyRows;
            if (/SELECT id FROM subscriptions/.test(sql)) return [];
            return [];
        },
        executeAsync: async (sql, params) => {
            writes.push({ sql, params });
            return { affectedRows: 1 };
        },
        query: async (sql) => {
            if (/SELECT \* FROM schools/.test(sql)) return [[school], []];
            if (/SELECT \* FROM plans/.test(sql)) return [[{ id: 1, plan_key: "trial", features: "{}" }], []];
            if (/subscription_plan_features/.test(sql)) return [[], []];
            return [[], []];
        }
    };
    const restores = [
        replaceModule("../config/database", db),
        replaceModule("../services/notificationService", { createAndSend: async () => {} })
    ];
    const servicePath = require.resolve("../services/subscriptionService");
    delete require.cache[servicePath];
    const service = require(servicePath);
    return {
        service,
        writes,
        restore() {
            delete require.cache[servicePath];
            restores.reverse().forEach((fn) => fn());
        }
    };
}

test("Trial usage cannot be reset by changing plan or status fields", async () => {
    const datedSchool = { id: 9, trial_started_at: "2026-01-01", trial_used: 0, is_trial_used: 0 };
    const harness = loadSubscriptionService({ school: datedSchool });
    try {
        assert.equal(harness.service.hasSchoolUsedTrial(datedSchool), true);
        assert.equal(await harness.service.hasSchoolEverUsedTrial(9, { id: 9 }), false);
    } finally {
        harness.restore();
    }

    const historyHarness = loadSubscriptionService({ school: { id: 9 }, historyRows: [{ id: 1 }] });
    try {
        assert.equal(await historyHarness.service.hasSchoolEverUsedTrial(9, { id: 9 }), true);
    } finally {
        historyHarness.restore();
    }
});

test("active Trial grants admissions and expired Trial locks non-dashboard features", async () => {
    const activeHarness = loadSubscriptionService({
        school: {
            id: 7,
            status: "trial",
            subscription_status: "trial",
            current_plan_id: 1,
            trial_used: 1,
            trial_started_at: new Date(Date.now() - 86400000),
            trial_ends_at: new Date(Date.now() + 3 * 86400000)
        }
    });
    try {
        const state = await activeHarness.service.getSubscriptionState(7);
        assert.equal(state.isTrialActive, true);
        assert.equal(state.hasFeature("admissions"), true);
    } finally {
        activeHarness.restore();
    }

    const expiredHarness = loadSubscriptionService({
        school: {
            id: 8,
            status: "trial",
            subscription_status: "trial",
            current_plan_id: 1,
            trial_used: 1,
            trial_started_at: new Date(Date.now() - 10 * 86400000),
            trial_ends_at: new Date(Date.now() - 86400000)
        }
    });
    try {
        const state = await expiredHarness.service.getSubscriptionState(8);
        assert.equal(state.subscriptionLocked, true);
        assert.equal(state.hasFeature("dashboard"), true);
        assert.equal(state.hasFeature("admissions"), false);
        assert.ok(expiredHarness.writes.some((write) => /UPDATE schools/.test(write.sql)));
    } finally {
        expiredHarness.restore();
    }
});

function loadBillingHarness({ candidates = [], plan = null, existingRenewalIds = [], failAfterPdf = false, materializePdf = false } = {}) {
    const queryCalls = [];
    const transactionCalls = [];
    const emails = [];
    const claimedIds = new Set();
    const existingRenewals = new Set(existingRenewalIds.map(Number));
    const candidatesById = new Map(candidates.map((candidate) => [Number(candidate.id), candidate]));
    const defaultPlan = plan || {
        id: 8,
        name: "Basic",
        plan_key: "basic",
        slug: "basic",
        monthly_price: "1000.00",
        yearly_price: "10000.00"
    };

    const database = {
        queryAsync: async (sql, params = []) => {
            queryCalls.push({ sql, params });
            if (/s\.auto_renew = 1/.test(sql)) return candidates;
            if (/SELECT \* FROM plans WHERE id/.test(sql)) return [defaultPlan];
            return [];
        },
        executeAsync: async (sql, params = []) => {
            queryCalls.push({ sql, params, kind: "execute" });
            return { affectedRows: 1 };
        },
        withTransaction: async (handler) => handler({
            query: async (sql, params = []) => {
                transactionCalls.push({ kind: "query", sql, params });
                const sourceId = Number(params[0]);
                if (/renewed_from_id = \?/.test(sql)) {
                    return existingRenewals.has(sourceId) ? [{ id: 999 }] : [];
                };
                if (/FOR UPDATE/.test(sql)) {
                    const candidate = candidatesById.get(sourceId);
                    if (!candidate) return [];
                    return [{
                        id: sourceId,
                        status: candidate.status,
                        auto_renew: claimedIds.has(sourceId) ? 0 : candidate.auto_renew
                    }];
                };
                return [];
            },
            execute: async (sql, params = []) => {
                transactionCalls.push({ kind: "execute", sql, params });
                if (/WHERE id = \? AND status = 'active' AND auto_renew = 1/.test(sql)) {
                    const sourceId = Number(params[0]);
                    if (claimedIds.has(sourceId)) return { affectedRows: 0 };
                    claimedIds.add(sourceId);
                    return { affectedRows: 1 };
                };
                if (/INSERT INTO subscriptions/.test(sql)) return { insertId: 501, affectedRows: 1 };
                if (/INSERT INTO invoices/.test(sql)) return { insertId: 601, affectedRows: 1 };
                if (failAfterPdf && /INSERT INTO school_activity_logs/.test(sql)) {
                    throw new Error("simulated post-PDF database failure");
                };
                return { affectedRows: 1 };
            }
        })
    };
    const notificationModel = {
        archiveOldNotifications: async () => 0,
        enqueueEmail: async (...args) => emails.push(args)
    };
    const restores = [
        replaceModule("../config/database", database),
        replaceModule("../models/notificationModel", notificationModel),
        replaceModule("../services/notificationService", { createAndSend: async () => {} })
    ];
    const servicePath = require.resolve("../services/billingService");
    delete require.cache[servicePath];
    const service = require(servicePath);
    service.generatePDFInvoice = async ({ invoice_no }) => {
        const relativePath = `/uploads/invoices/invoice_${invoice_no}.pdf`;
        if (materializePdf) {
            const filePath = path.resolve(__dirname, "../../storage/uploads/invoices", path.basename(relativePath));
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, "test invoice");
        };
        return relativePath;
    };

    return {
        emails,
        queryCalls,
        service,
        transactionCalls,
        restore() {
            delete require.cache[servicePath];
            restores.reverse().forEach((fn) => fn());
        }
    };
};

function renewalCandidate(overrides = {}) {
    return {
        id: 71,
        school_id: 12,
        plan_id: 8,
        plan: "basic",
        status: "active",
        auto_renew: 1,
        billing_cycle: "monthly",
        end_date: "2099-07-31",
        school_name: "Calendar School",
        school_email: "admin@example.test",
        subdomain: "calendar-school",
        razorpay_id: null,
        ...overrides
    };
};

test("billing renewal period starts after the old end date and rejects Trial plans", () => {
    const harness = loadBillingHarness();
    try {
        const period = harness.service._test.getAutoRenewalPeriod("2026-01-31", "monthly");
        assert.equal(toSqlDate(period.startDate), "2026-02-01");
        assert.equal(toSqlDate(period.endDate), "2026-02-28");
        assert.equal(harness.service._test.isTrialRenewalCandidate({ status: "active", plan: "trial" }, {}), true);
        assert.equal(harness.service._test.isTrialRenewalCandidate({ status: "active", plan: "basic" }, { plan_key: "basic" }), false);
    } finally {
        harness.restore();
    }
});

test("unverified auto-renewal is cancelled and cannot activate the school", async () => {
    const candidate = renewalCandidate();
    const harness = loadBillingHarness({ candidates: [candidate] });
    try {
        await harness.service.runDailyBillingSweep();
        const autoRenewQuery = harness.queryCalls.find((call) => /s\.auto_renew = 1/.test(call.sql));
        assert.match(autoRenewQuery.sql, /s\.status = 'active'/);
        assert.match(autoRenewQuery.sql, /p\.plan_key/);

        const subscriptionInsert = harness.transactionCalls.find((call) => /INSERT INTO subscriptions/.test(call.sql));
        assert.ok(subscriptionInsert);
        assert.equal(toSqlDate(subscriptionInsert.params[4]), "2099-08-01");
        assert.equal(toSqlDate(subscriptionInsert.params[5]), "2099-08-31");
        assert.equal(subscriptionInsert.params[6], "cancelled");
        assert.equal(subscriptionInsert.params[7], "failed");
        assert.equal(subscriptionInsert.params[8], 0);

        const historyInsert = harness.transactionCalls.find((call) => /INSERT INTO subscription_history/.test(call.sql));
        assert.equal(historyInsert, undefined);
        const invoiceInsert = harness.transactionCalls.find((call) => /INSERT INTO invoices/.test(call.sql));
        assert.equal(invoiceInsert.params[6], "failed");
        assert.equal(harness.transactionCalls.some((call) => /UPDATE schools/.test(call.sql)), false);
        assert.equal(harness.transactionCalls.some((call) => /SET status = 'expired'/.test(call.sql)), false);

        const cronSource = fs.readFileSync(path.resolve(__dirname, "../services/subscriptionCron.js"), "utf8");
        assert.match(cronSource, /sub\.status = 'scheduled'[\s\S]*sub\.payment_status = 'paid'[\s\S]*sub\.start_date <= CURRENT_DATE\(\)/);
        assert.match(cronSource, /status = 'scheduled'[\s\S]*payment_status = 'paid'[\s\S]*FOR UPDATE/);
    } finally {
        harness.restore();
    }
});

test("a Razorpay reference alone cannot mark renewal paid and stale candidates process once", async () => {
    const candidate = renewalCandidate({ razorpay_id: "rzp_mandate_71" });
    const harness = loadBillingHarness({ candidates: [candidate, candidate] });
    try {
        await harness.service.runDailyBillingSweep();
        const sourceLocks = harness.transactionCalls.filter((call) => call.kind === "query" && /FOR UPDATE/.test(call.sql));
        const subscriptionInserts = harness.transactionCalls.filter((call) => /INSERT INTO subscriptions/.test(call.sql));
        const invoiceInserts = harness.transactionCalls.filter((call) => /INSERT INTO invoices/.test(call.sql));
        assert.equal(sourceLocks.length, 2);
        assert.equal(subscriptionInserts.length, 1);
        assert.equal(invoiceInserts.length, 1);
        assert.equal(subscriptionInserts[0].params[6], "cancelled");
        assert.equal(subscriptionInserts[0].params[7], "failed");
        assert.equal(subscriptionInserts[0].params[8], 0);
        assert.equal(invoiceInserts[0].params[2], "INV-REN-71");
        assert.equal(invoiceInserts[0].params[6], "failed");
        assert.equal(harness.emails.length, 1);
    } finally {
        harness.restore();
    }
});

test("legacy Trial rows are excluded even if auto-renew remains enabled", async () => {
    const candidate = renewalCandidate({ plan: "trial", status: "trial" });
    const harness = loadBillingHarness({
        candidates: [candidate],
        plan: { id: 8, name: "Trial", plan_key: "trial", slug: "trial", monthly_price: "0", yearly_price: "0" }
    });
    try {
        await harness.service.runDailyBillingSweep();
        assert.equal(harness.transactionCalls.length, 0);
    } finally {
        harness.restore();
    }
});

test("auto-renewal removes a generated PDF when its database transaction rolls back", async () => {
    const candidate = renewalCandidate({ id: 987654321 });
    const invoicePath = path.resolve(__dirname, "../../storage/uploads/invoices/invoice_INV-REN-987654321.pdf");
    const harness = loadBillingHarness({ candidates: [candidate], failAfterPdf: true, materializePdf: true });
    try {
        await harness.service.runDailyBillingSweep();
        assert.equal(fs.existsSync(invoicePath), false);
        assert.equal(harness.emails.length, 0);
    } finally {
        if (fs.existsSync(invoicePath)) fs.unlinkSync(invoicePath);
        harness.restore();
    }
});

test("scheduled activation re-locks paid renewal rows and activates each only once", async () => {
    const writes = [];
    const invalidations = [];
    let status = "scheduled";
    const scheduled = {
        sub_id: 812,
        school_id: 91,
        plan_id: 8,
        plan: "basic",
        start_date: "2026-08-01",
        end_date: "2026-08-31",
        school_name: "Lock School"
    };
    const database = {
        queryAsync: async (sql) => /sub\.status = 'scheduled'/.test(sql) ? [scheduled, scheduled] : [],
        executeAsync: async () => ({ affectedRows: 1 }),
        withTransaction: async (handler) => handler({
            query: async (sql) => {
                if (/FROM schools/.test(sql)) {
                    assert.match(sql, /FOR UPDATE/);
                    return [{ id: scheduled.school_id }];
                };
                assert.match(sql, /payment_status = 'paid'/);
                assert.match(sql, /FOR UPDATE/);
                return status === "scheduled" ? [{ id: scheduled.sub_id }] : [];
            },
            execute: async (sql, params = []) => {
                writes.push({ sql, params });
                if (/SET status = 'active'/.test(sql)) status = "active";
                return { affectedRows: 1 };
            }
        })
    };
    const restores = [
        replaceModule("../config/database", database),
        replaceModule("../services/notificationService", { createAndSend: async () => {} }),
        replaceModule("../utils/planCache", {
            invalidateSubscriptionCache: async (schoolId) => invalidations.push(["subscription", schoolId]),
            invalidatePlanCache: async (schoolId) => invalidations.push(["plan", schoolId])
        })
    ];
    const cronPath = require.resolve("../services/subscriptionCron");
    delete require.cache[cronPath];
    const subscriptionCron = require(cronPath);
    try {
        await subscriptionCron.runScheduledSubscriptionActivationCheck();
        assert.equal(writes.filter((write) => /UPDATE schools/.test(write.sql)).length, 1);
        assert.deepEqual(invalidations, [["subscription", 91], ["plan", 91]]);
    } finally {
        delete require.cache[cronPath];
        restores.reverse().forEach((fn) => fn());
    }
});
