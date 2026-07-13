const test = require("node:test");
const assert = require("node:assert/strict");

const csrf = require("../middleware/csrf");
const { requireOwnership } = require("../middleware/tenantIsolation");
const {
    createTransportAuthorizationService,
    validateTripStudentTransition
} = require("../services/transportAuthorizationService");
const { createParentStudentService } = require("../services/parentStudentService");
const { unresolvedTripStudentStatuses } = require("../services/transportAuthorizationService");
const { createParentChildContext } = require("../middleware/parentChildContext");
const {
    createUploadAuthorizationService,
    normalizeUploadSubPath
} = require("../services/uploadAuthorizationService");

const subscriptionServicePath = require.resolve("../services/subscriptionService");
const previousSubscriptionService = require.cache[subscriptionServicePath];
require.cache[subscriptionServicePath] = {
    id: subscriptionServicePath,
    filename: subscriptionServicePath,
    loaded: true,
    exports: { getSubscriptionState: async () => ({}) }
};
const { featureRouteMap, routeFeatureForPath } = require("../middleware/subscriptionGuard");
if (previousSubscriptionService) require.cache[subscriptionServicePath] = previousSubscriptionService;
else delete require.cache[subscriptionServicePath];

function runCsrf(overrides = {}) {
    const req = {
        method: "POST",
        path: "/schooladmin/students/add",
        session: { csrfToken: "known-token" },
        body: {},
        headers: {},
        ...overrides
    };
    const res = { locals: {} };
    let nextValue = Symbol("not-called");
    csrf(req, res, (value) => { nextValue = value; });
    return { req, res, nextValue };
}

test("CSRF blocks unsafe requests and only bypasses exact signed/capability endpoints", () => {
    const blocked = runCsrf();
    assert.equal(blocked.nextValue.status, 403);

    const allowed = runCsrf({ headers: { "x-csrf-token": "known-token" } });
    assert.equal(allowed.nextValue, undefined);

    const queryToken = runCsrf({ query: { _csrf: "known-token" } });
    assert.equal(queryToken.nextValue.status, 403, "query-string CSRF tokens must not be accepted");

    const admission = runCsrf({ path: "/admission/student" });
    assert.equal(admission.nextValue, undefined);
    const admissionPrefixGuess = runCsrf({ path: "/admission/student/delete" });
    assert.equal(admissionPrefixGuess.nextValue.status, 403);

    const webhook = runCsrf({ path: "/webhooks/razorpay" });
    assert.equal(webhook.nextValue, undefined);
    const webhookGuess = runCsrf({ path: "/webhooks/anything" });
    assert.equal(webhookGuess.nextValue.status, 403);
});

test("tenant ownership middleware always supplies the authenticated school id", async () => {
    let received;
    const middleware = requireOwnership(async (id, schoolId) => {
        received = { id, schoolId };
        return null;
    });
    const req = {
        params: { id: "17" },
        user: { id: 3, role: "school_admin", school_id: 9 },
        accepts: (type) => type === "json" ? "json" : false,
        get: () => null,
        flash: () => {}
    };
    const response = {
        statusCode: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
        redirect() { throw new Error("unexpected redirect"); }
    };
    await middleware(req, response, () => { throw new Error("ownership should fail"); });
    assert.deepEqual(received, { id: 17, schoolId: 9 });
    assert.equal(response.statusCode, 404);
});

test("driver student transitions enforce pickup/drop state machines", () => {
    assert.equal(validateTripStudentTransition({ tripType: "pickup", currentStatus: "pending", nextStatus: "picked" }).allowed, true);
    assert.equal(validateTripStudentTransition({ tripType: "pickup", currentStatus: "pending", nextStatus: "dropped" }).allowed, false);
    assert.equal(validateTripStudentTransition({ tripType: "drop", currentStatus: "pending", nextStatus: "dropped" }).allowed, true);
    assert.equal(validateTripStudentTransition({ tripType: "drop", currentStatus: "picked", nextStatus: "dropped" }).allowed, true);
    assert.equal(validateTripStudentTransition({ tripType: "drop", currentStatus: "dropped", nextStatus: "picked" }).allowed, false);
});

test("trip completion requires terminal student states", () => {
    assert.deepEqual(unresolvedTripStudentStatuses(['pending', 'picked', 'dropped', 'absent']), ['pending', 'picked']);
    assert.deepEqual(unresolvedTripStudentStatuses(['dropped', 'absent', 'missed', 'no_show']), []);
    assert.deepEqual(unresolvedTripStudentStatuses(['picked']), ['picked']);
});

test("Socket trip rooms authorize assigned driver, student, and parent through school-scoped SQL", async () => {
    const calls = [];
    const service = createTransportAuthorizationService({
        query: async (sql, params) => {
            calls.push({ sql, params });
            return [{ id: 55 }];
        }
    });

    assert.equal(await service.canJoinTripRoom({ user: { id: 4, school_id: 8, role: "driver" }, tripId: 55 }), true);
    assert.match(calls.at(-1).sql, /d\.user_id = \?/);
    assert.deepEqual(calls.at(-1).params, [4, 55, 8]);

    assert.equal(await service.canJoinTripRoom({ user: { id: 6, school_id: 8, role: "student" }, tripId: 55 }), true);
    assert.match(calls.at(-1).sql, /transport_trip_students/);
    assert.deepEqual(calls.at(-1).params, [6, 55, 8]);

    assert.equal(await service.canJoinTripRoom({ user: { id: 7, school_id: 8, role: "parent" }, tripId: 55 }), true);
    assert.match(calls.at(-1).sql, /sf\.parent_user_id = \?/);
    assert.deepEqual(calls.at(-1).params, [7, 55, 8]);

    assert.equal(await service.canJoinTripRoom({ user: { id: 1, school_id: 8, role: "teacher" }, tripId: 55 }), false);
});

test("parent-child authorization uses parent_user_id, student_id, and school_id", async () => {
    const calls = [];
    const service = createParentStudentService({
        query: async (sql, params) => {
            calls.push({ sql, params });
            return [[{ id: 23 }], []];
        }
    });
    assert.equal(await service.canAccessStudent({ parentUserId: 5, schoolId: 9, studentId: 23 }), true);
    assert.match(calls[0].sql, /sf\.parent_user_id = \?/);
    assert.match(calls[0].sql, /sf\.school_id = \?/);
    assert.match(calls[0].sql, /s\.id = \?/);
    assert.deepEqual(calls[0].params, [5, 9, 23]);
    assert.equal(await service.canAccessStudent({ parentUserId: 5, schoolId: 9, studentId: 0 }), false);
});

test("parent child context allows linked children and rejects ID tampering", async () => {
    const middleware = createParentChildContext(async () => [{ id: 11 }, { id: 12 }]);
    const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    const allowed = { user: { id: 5, school_id: 9 }, params: {}, body: {}, query: { studentId: '12' }, session: {} };
    let nextCalled = false;
    await middleware(allowed, response, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(allowed.activeChild.id, 12);
    assert.equal(allowed.session.selectedStudentId, 12);

    const denied = { user: { id: 5, school_id: 9 }, params: {}, body: { studentId: 99 }, query: {}, session: {} };
    await middleware(denied, response, () => assert.fail('tampered child must not continue'));
    assert.equal(response.statusCode, 403);
});

test("protected upload authorization scopes certificates to their recipient", async () => {
    const calls = [];
    const service = createUploadAuthorizationService({
        query: async (sql, params) => {
            calls.push({ sql, params });
            return params[0] === 41 ? [{ id: 1 }] : [];
        }
    });

    assert.equal(await service.canAccessProtectedUpload({
        user: { id: 41, role: "student", school_id: 9 },
        subPath: "certificates/CERT-9-0001.pdf"
    }), true);
    assert.match(calls[0].sql, /s\.user_id = \?/);
    assert.match(calls[0].sql, /ic\.student_id/);
    assert.deepEqual(calls[0].params, [
        41,
        9,
        "/uploads/certificates/CERT-9-0001.pdf",
        "storage/uploads/certificates/CERT-9-0001.pdf"
    ]);

    assert.equal(await service.canAccessProtectedUpload({
        user: { id: 42, role: "student", school_id: 9 },
        subPath: "certificates/CERT-9-0001.pdf"
    }), false, "another student in the same school must be denied");

    calls.length = 0;
    await service.canAccessProtectedUpload({
        user: { id: 51, role: "parent", school_id: 9 },
        subPath: "certificates/CERT-9-0001.pdf"
    });
    assert.match(calls[0].sql, /sf\.parent_user_id = \?/);
    assert.match(calls[0].sql, /sf\.school_id = s\.school_id/);
});

test("subscription invoices and subscription receipts are admin-only tenant files", async () => {
    const calls = [];
    const service = createUploadAuthorizationService({
        query: async (sql, params) => {
            calls.push({ sql, params });
            if (sql.includes("subscription_payments")) return [{ id: 1 }];
            return [{ id: 1 }];
        }
    });

    for (const role of ["student", "parent", "teacher", "driver", "librarian"]) {
        assert.equal(await service.canAccessProtectedUpload({
            user: { id: 10, role, school_id: 9 },
            subPath: "invoices/invoice_INV-0001.pdf"
        }), false, `${role} must not access a subscription invoice by guessing its path`);
    };
    assert.equal(calls.length, 0, "unauthorized invoice roles should be rejected before a database lookup");

    assert.equal(await service.canAccessProtectedUpload({
        user: { id: 2, role: "school_admin", school_id: 9 },
        subPath: "invoices/invoice_INV-0001.pdf"
    }), true);
    assert.match(calls.at(-1).sql, /i\.school_id = \?/);
    assert.deepEqual(calls.at(-1).params, [
        9,
        "/uploads/invoices/invoice_INV-0001.pdf",
        "storage/uploads/invoices/invoice_INV-0001.pdf"
    ]);

    calls.length = 0;
    assert.equal(await service.canAccessProtectedUpload({
        user: { id: 10, role: "student", school_id: 9 },
        subPath: "receipts/SUB-RCP-0001.pdf"
    }), false);
    assert.match(calls[0].sql, /subscription_payments/);
    assert.equal(calls.length, 1, "a subscription receipt must not fall through to fee receipt ownership");
});

test("fee receipt authorization scopes the file to the student or linked parent", async () => {
    const calls = [];
    const service = createUploadAuthorizationService({
        query: async (sql, params) => {
            calls.push({ sql, params });
            if (sql.includes("subscription_payments")) return [];
            return params[0] === 41 ? [{ id: 1 }] : [];
        }
    });

    assert.equal(await service.canAccessProtectedUpload({
        user: { id: 41, role: "student", school_id: 9 },
        subPath: "receipts/RCP-9-0001"
    }), true);
    assert.match(calls[1].sql, /s\.user_id = \?/);
    assert.match(calls[1].sql, /COALESCE\(fp\.student_id, student_fee\.student_id\)/);

    calls.length = 0;
    assert.equal(await service.canAccessProtectedUpload({
        user: { id: 42, role: "student", school_id: 9 },
        subPath: "receipts/RCP-9-0001"
    }), false, "another student in the same school must not access the receipt");

    calls.length = 0;
    await service.canAccessProtectedUpload({
        user: { id: 51, role: "parent", school_id: 9 },
        subPath: "receipts/RCP-9-0001"
    });
    assert.match(calls[1].sql, /sf\.parent_user_id = \?/);
});

test("protected upload paths are canonicalized before authorization", () => {
    assert.equal(
        normalizeUploadSubPath("certificates/../invoices/invoice_INV-0001.pdf"),
        "invoices/invoice_INV-0001.pdf"
    );
    assert.equal(normalizeUploadSubPath("../database.sql"), null);
    assert.equal(normalizeUploadSubPath("certificates\\..\\invoices\\secret.pdf"), null);
});

test("subscription route map is deduplicated and uses exact business feature keys", () => {
    for (const entry of featureRouteMap) {
        assert.equal(new Set(entry.prefixes).size, entry.prefixes.length, `${entry.feature} contains duplicate prefixes`);
    };
    assert.equal(routeFeatureForPath("/schooladmin/admissions/42"), "admissions");
    assert.equal(routeFeatureForPath("/schooladmin/certificates/7/download"), "certificates");
    assert.equal(routeFeatureForPath("/driver/trips/9/end"), "transport");
    assert.equal(routeFeatureForPath("/schooladmin/salary/monthly"), "salary");
});

test("teacher permission SQL uses teachers.id and school_id", async () => {
    const dbPath = require.resolve("../config/database");
    const servicePath = require.resolve("../services/teacherPermissionService");
    const previous = require.cache[dbPath];
    const calls = [];
    require.cache[dbPath] = {
        id: dbPath,
        filename: dbPath,
        loaded: true,
        exports: {
            execute: async (sql, params) => {
                calls.push({ sql, params });
                return [[{ id: 1 }], []];
            },
            query: async () => [[], []]
        }
    };
    delete require.cache[servicePath];
    try {
        const permissions = require(servicePath);
        assert.equal(await permissions.canTeachSubject(41, 9, 12, 3), true);
        assert.match(calls[0].sql, /tca\.teacher_id = \?/);
        assert.match(calls[0].sql, /tca\.school_id = \?/);
        assert.deepEqual(calls[0].params, [41, 9, 12, 3]);
    } finally {
        delete require.cache[servicePath];
        if (previous) require.cache[dbPath] = previous;
        else delete require.cache[dbPath];
    }
});
