const { queryAsync, withTransaction } = require("../../config/database");
const { invalidatePlanCache, invalidateSubscriptionCache } = require("../../utils/planCache");
const { isTrialPlan, hasSchoolUsedTrial, hasSchoolEverUsedTrial, TRIAL_ALREADY_USED_MESSAGE } = require("../../services/subscriptionService");
const {
    addDays,
    amountForPlan,
    calculateSubscriptionEndDate,
    normalizeBillingCycle,
    toSqlDate,
    validDate
} = require("../../utils/subscriptionPeriods");

async function invalidateSchoolSubscriptionCaches(schoolId) {
    await Promise.all([
        invalidatePlanCache(schoolId),
        invalidateSubscriptionCache(schoolId)
    ]);
};

async function trialHistoryExists(query, schoolId) {
    const rows = await query(
        `SELECT sub.id
        FROM subscriptions sub
        LEFT JOIN plans p ON p.id = sub.plan_id
        WHERE sub.school_id = ?
            AND (
                sub.status = 'trial'
                OR sub.trial_start_date IS NOT NULL
                OR sub.trial_end_date IS NOT NULL
                OR LOWER(COALESCE(sub.plan, '')) = 'trial'
                OR LOWER(COALESCE(p.plan_key, '')) = 'trial'
                OR LOWER(COALESCE(p.slug, '')) = 'trial'
            )
        LIMIT 1`,
        [schoolId]
    );
    return rows.length > 0;
};

const subscriptionController = {
    list: async (req, res) => {
        try {
            const { status, plan_id, search, start_date, end_date, page = 1 } = req.query;
            const limit = 15;
            const offset = (page - 1) * limit;

            let whereClauses = [];
            let params = [];

            if (status && status !== 'all') {
                whereClauses.push('s.status = ?');
                params.push(status);
            };
            if (plan_id) {
                whereClauses.push('s.plan_id = ?');
                params.push(plan_id);
            };
            if (search) {
                whereClauses.push('sch.school_name LIKE ?');
                params.push(`%${search}%`);
            };
            if (start_date) {
                whereClauses.push('s.start_date >= ?');
                params.push(start_date);
            };
            if (end_date) {
                whereClauses.push('s.end_date <= ?');
                params.push(end_date);
            };

            const whereSQL = whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : '';
            const countRes = await queryAsync(`
                SELECT COUNT(*) as total
                FROM subscriptions s
                JOIN schools sch ON s.school_id = sch.id
                ${whereSQL}
            `, params);
            const total = countRes[0] ? countRes[0].total : 0;

            const subscriptions = await queryAsync(`
                SELECT s.*, sch.school_name, sch.subdomain,
                    p.name as plan_name, p.monthly_price, p.yearly_price
                FROM subscriptions s
                JOIN schools sch ON s.school_id = sch.id
                JOIN plans p ON s.plan_id = p.id
                ${whereSQL}
                ORDER BY s.created_at DESC
                LIMIT ? OFFSET ?
            `, [...params, limit, offset]);

            const schools = await queryAsync(`SELECT id, school_name FROM schools WHERE status = 'active'`);
            const plans   = await queryAsync(`SELECT id, name FROM plans WHERE is_active = 1`);

            res.render("superAdmin/subscriptions/index", {
                title: "Subscription Management - SchoolSync",
                subscriptions,
                schools,
                plans,
                filters: { status, plan_id, search, start_date, end_date },
                pagination: {
                    page: parseInt(page),
                    totalPages: Math.ceil(total / limit),
                    total
                },
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            console.error("List Subscriptions Error:", error);
            req.flash("error", "Failed to load subscriptions");
            res.redirect("/superadmin/dashboard");
        };
    },

    expiring: async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = 15;
            const offset = (page - 1) * limit;

            const countRes = await queryAsync(`
                SELECT COUNT(*) as total
                FROM subscriptions s
                WHERE s.status = 'active'
                    AND s.end_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 30 DAY)
            `);
            const total = countRes[0] ? countRes[0].total : 0;

            const subscriptions = await queryAsync(`
                SELECT s.*, sch.school_name, sch.subdomain,
                    p.name as plan_name, p.monthly_price, p.yearly_price
                FROM subscriptions s
                JOIN schools sch ON s.school_id = sch.id
                JOIN plans p ON s.plan_id = p.id
                WHERE s.status = 'active'
                    AND s.end_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 30 DAY)
                ORDER BY s.end_date ASC
                LIMIT ? OFFSET ?
            `, [limit, offset]);

            res.render("superAdmin/subscriptions/index", {
                title: "Expiring Subscriptions - SchoolSync",
                subscriptions,
                plans: [],
                filters: { status: 'expiring' },
                pagination: {
                    page,
                    totalPages: Math.ceil(total / limit),
                    total
                },
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            console.error("Expiring Subscriptions Error:", error);
            req.flash("error", "Failed to load expiring subscriptions");
            res.redirect("/superadmin/subscriptions");
        }
    },

    detail: async (req, res) => {
        try {
            const subscriptionId = req.params.id;
            const subRows = await queryAsync(`
                SELECT s.*, sch.school_name, sch.subdomain, sch.school_email, sch.school_phone, sch.city, sch.state,
                    p.name as plan_name, p.monthly_price, p.yearly_price, p.features,
                    p.max_students, p.max_teachers, p.max_classes
                FROM subscriptions s
                JOIN schools sch ON s.school_id = sch.id
                JOIN plans p ON s.plan_id = p.id
                WHERE s.id = ?
                LIMIT 1
            `, [subscriptionId]);

            if (!subRows.length) {
                req.flash("error", "Subscription not found");
                return res.redirect("/superadmin/subscriptions");
            }
            const subscription = subRows[0];

            const studentCountRes = await queryAsync(
                `SELECT COUNT(*) as count FROM students WHERE school_id = ? AND deleted_at IS NULL`,
                [subscription.school_id]
            );
            const teacherCountRes = await queryAsync(
                `SELECT COUNT(*) as count FROM teachers WHERE school_id = ? AND deleted_at IS NULL`,
                [subscription.school_id]
            );

            const usage = {
                students: studentCountRes[0] ? studentCountRes[0].count : 0,
                teachers: teacherCountRes[0] ? teacherCountRes[0].count : 0,
                classes: 0
            };

            const payments = await queryAsync(`SELECT * FROM subscription_payments WHERE school_id = ? ORDER BY COALESCE(paid_at, created_at) DESC`, [subscription.school_id]);
            const invoices = await queryAsync(`SELECT * FROM invoices WHERE school_id = ? ORDER BY created_at DESC`, [subscription.school_id]);
            const activityLogs = await queryAsync(`SELECT * FROM school_activity_logs WHERE school_id = ? ORDER BY created_at DESC`, [subscription.school_id]);
            const plans = await queryAsync(`SELECT * FROM plans WHERE is_active = 1`);

            res.render("superAdmin/subscriptions/detail", {
                title: `Subscription Detail - ${subscription.school_name}`,
                subscription,
                usage,
                payments,
                invoices,
                activityLogs,
                plans,
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            console.error("Subscription Detail Error:", error);
            req.flash("error", "Failed to load subscription details");
            res.redirect("/superadmin/subscriptions");
        };
    },

    assignForm: async (req, res) => {
        try {
            const schools = await queryAsync(`
                SELECT s.id, s.school_name
                FROM schools s
                LEFT JOIN subscriptions sub ON s.id = sub.school_id AND sub.status = 'active'
                WHERE sub.id IS NULL
            `);
            const plans = await queryAsync(`SELECT * FROM plans WHERE is_active = 1`);

            res.render("superAdmin/subscriptions/assign", {
                title: "Assign Subscription - SchoolSync",
                schools,
                plans,
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            console.error("Assign Form Error:", error);
            req.flash("error", "Failed to load assignment form");
            res.redirect("/superadmin/subscriptions");
        };
    },

    assign: async (req, res) => {
        try {
            const { school_id, plan_id, billing_cycle, start_date, notes } = req.body;
            const selectedBillingCycle = normalizeBillingCycle(billing_cycle);
            const selectedStartDate = validDate(start_date || new Date());

            const planRows = await queryAsync(`SELECT * FROM plans WHERE id = ? LIMIT 1`, [plan_id]);
            if (!planRows.length) {
                req.flash("error", "Plan not found");
                return res.redirect("/superadmin/subscriptions/assign");
            };
            const plan = planRows[0];

            const schoolRows = await queryAsync(`SELECT * FROM schools WHERE id = ? LIMIT 1`, [school_id]);
            if (!schoolRows.length) {
                req.flash("error", "School not found");
                return res.redirect("/superadmin/subscriptions/assign");
            };
            const school = schoolRows[0];

            if (isTrialPlan(plan)) {
                if (await hasSchoolEverUsedTrial(school_id, school)) {
                    req.flash("error", TRIAL_ALREADY_USED_MESSAGE);
                    return res.redirect("/superadmin/subscriptions/assign");
                };

                const trialStartDate = selectedStartDate;
                const trialEndDate = calculateSubscriptionEndDate(trialStartDate, "monthly", { isTrial: true });

                await withTransaction(async ({ query, execute: exec }) => {
                    const lockedSchools = await query(
                        "SELECT * FROM schools WHERE id = ? LIMIT 1 FOR UPDATE",
                        [school_id]
                    );
                    const lockedSchool = lockedSchools[0];
                    if (!lockedSchool || hasSchoolUsedTrial(lockedSchool) || await trialHistoryExists(query, school_id)) {
                        throw new Error(TRIAL_ALREADY_USED_MESSAGE);
                    };
                    await exec(
                        `UPDATE subscriptions SET status='expired', updated_at=NOW()
                        WHERE school_id=? AND status IN ('active','trial')`,
                        [school_id]
                    );
                    const subRes = await exec(
                        `INSERT INTO subscriptions (school_id, plan_id, plan, price, billing_cycle, start_date, end_date, status, payment_status, auto_renew, created_at, updated_at)
                        VALUES (?,?,?,?,?,?,?,'trial','pending',0,NOW(),NOW())`,
                        [school_id, plan_id, plan.plan_key || "trial", 0, "monthly", trialStartDate, trialEndDate]
                    );
                    const subId = subRes.insertId;
                    const schoolUpdate = await exec(
                        `UPDATE schools
                        SET plan_id=?,
                            current_plan_id=?,
                            plan=?,
                            status='trial',
                            subscription_status='trial',
                            trial_started_at=?,
                            trial_ends_at=?,
                            subscription_started_at=NULL,
                            subscription_ends_at=NULL,
                            subscription_start=NULL,
                            subscription_end=?,
                            trial_used=1,
                            is_trial_used=1,
                            updated_at=NOW()
                        WHERE id=?
                            AND trial_started_at IS NULL
                            AND trial_ends_at IS NULL
                            AND COALESCE(trial_used, 0) = 0
                            AND COALESCE(is_trial_used, 0) = 0`,
                        [plan_id, plan_id, plan.plan_key || "trial", trialStartDate, trialEndDate, trialEndDate, school_id]
                    );
                    if (schoolUpdate.affectedRows !== 1) throw new Error(TRIAL_ALREADY_USED_MESSAGE);
                    await exec(
                        `INSERT INTO school_activity_logs (school_id, actor_id, actor_role, action, entity_type, entity_id, description, created_at)
                        VALUES (?,?,'super_admin','Trial Assigned','subscription',?,?,NOW())`,
                        [school_id, req.user ? req.user.id : null, subId, `7-day trial assigned by Super Admin. ${notes || ''}`]
                    );
                });

                await invalidateSchoolSubscriptionCaches(school_id);
                req.flash("success", "7-day trial assigned successfully");
                return res.redirect("/superadmin/subscriptions");
            };

            if (!selectedBillingCycle) {
                req.flash("error", "Invalid billing cycle. Choose monthly or yearly.");
                return res.redirect("/superadmin/subscriptions/assign");
            };
            const calculatedEndDate = calculateSubscriptionEndDate(selectedStartDate, selectedBillingCycle);
            const price = amountForPlan(plan, selectedBillingCycle);
            if (price <= 0) throw new Error("Selected plan price is invalid.");
            await withTransaction(async ({ execute: exec }) => {
                const subRes = await exec(
                    `INSERT INTO subscriptions (school_id, plan_id, plan, price, billing_cycle, start_date, end_date, status, payment_status, created_at, updated_at)
                    VALUES (?,?,?,?,?,?,?,'scheduled','pending',NOW(),NOW())`,
                    [school_id, plan_id, plan.plan_key, price, selectedBillingCycle, selectedStartDate, calculatedEndDate]
                );
                const subId = subRes.insertId;
                await exec(
                    `INSERT INTO school_activity_logs (school_id, actor_id, actor_role, action, entity_type, entity_id, description, created_at)
                    VALUES (?,?,'super_admin','Subscription Awaiting Payment','subscription',?,?,NOW())`,
                    [school_id, req.user ? req.user.id : null, subId, `Plan "${plan.name}" (${selectedBillingCycle}) scheduled pending payment. ${notes || ''}`]
                );
            });

            await invalidateSchoolSubscriptionCaches(school_id);

            req.flash("success", "Subscription scheduled. It will remain inactive until payment is completed.");
            res.redirect("/superadmin/subscriptions");
        } catch (error) {
            console.error("Assign Subscription Error:", error);
            req.flash("error", "Failed to assign subscription: " + error.message);
            res.redirect("/superadmin/subscriptions/assign");
        };
    },

    renew: async (req, res) => {
        try {
            const subscriptionId = req.params.id;
            const subRows = await queryAsync(`SELECT * FROM subscriptions WHERE id = ? LIMIT 1`, [subscriptionId]);
            if (!subRows.length) {
                req.flash("error", "Subscription not found");
                return res.redirect("/superadmin/subscriptions");
            };
            const sub = subRows[0];

            const planRows = await queryAsync(`SELECT * FROM plans WHERE id = ? LIMIT 1`, [sub.plan_id]);
            const plan = planRows[0] || {};
            if (isTrialPlan(plan) || sub.status === "trial") {
                req.flash("error", "Trial plan is not available for renewal.");
                return res.redirect(`/superadmin/subscriptions/${subscriptionId}`);
            };
            const billingCycle = normalizeBillingCycle(sub.billing_cycle);
            if (!billingCycle) throw new Error("Subscription has an invalid billing cycle.");
            const renewalPrice = planRows.length
                ? amountForPlan(plan, billingCycle)
                : Number(sub.price);
            if (!Number.isFinite(Number(renewalPrice)) || Number(renewalPrice) <= 0) {
                throw new Error("Subscription renewal price is invalid.");
            };

            const currentDate = new Date();
            const currentEnd = sub.end_date ? new Date(sub.end_date) : null;
            const stillActive = sub.status === "active" && currentEnd && currentEnd >= new Date(toSqlDate(currentDate));
            const startDate = stillActive ? addDays(currentEnd, 1) : currentDate;
            const endDate = calculateSubscriptionEndDate(startDate, billingCycle);
            const renewal = await withTransaction(async ({ query, execute: exec }) => {
                const lockedSources = await query(
                    "SELECT id FROM subscriptions WHERE id = ? LIMIT 1 FOR UPDATE",
                    [subscriptionId]
                );
                if (!lockedSources.length) throw new Error("Subscription not found.");
                const existingRows = await query(
                    `SELECT id
                    FROM subscriptions
                    WHERE renewed_from_id = ? AND status = 'scheduled' AND payment_status = 'pending'
                    ORDER BY id DESC
                    LIMIT 1`,
                    [subscriptionId]
                );
                if (existingRows.length) return { id: existingRows[0].id, alreadyExists: true };

                const newSubRes = await exec(
                    `INSERT INTO subscriptions (school_id, plan_id, plan, price, billing_cycle, start_date, end_date, status, payment_status, renewed_from_id, created_at, updated_at)
                    VALUES (?,?,?,?,?,?,?,'scheduled','pending',?,NOW(),NOW())`,
                    [sub.school_id, sub.plan_id, sub.plan, renewalPrice, billingCycle, startDate, endDate, subscriptionId]
                );
                const newSubId = newSubRes.insertId;
                await exec(
                    `INSERT INTO school_activity_logs (school_id, actor_id, actor_role, action, entity_type, entity_id, description, created_at)
                    VALUES (?,?,'super_admin','Renewal Awaiting Payment','subscription',?,?,NOW())`,
                    [sub.school_id, req.user ? req.user.id : null, newSubId, `Subscription renewal scheduled for ${billingCycle}; activation is pending payment.`]
                );
                return { id: newSubId, alreadyExists: false };
            });

            await invalidateSchoolSubscriptionCaches(sub.school_id);

            req.flash("success", renewal.alreadyExists
                ? "A renewal is already awaiting payment."
                : "Renewal scheduled. It will remain inactive until payment is completed.");
            res.redirect(`/superadmin/subscriptions/${subscriptionId}`);
        } catch (error) {
            console.error("Renew Subscription Error:", error);
            req.flash("error", "Failed to renew subscription");
            res.redirect(`/superadmin/subscriptions/${req.params.id}`);
        };
    },

    cancel: async (req, res) => {
        try {
            const subscriptionId = req.params.id;
            const { reason } = req.body;

            const subRows = await queryAsync(`SELECT * FROM subscriptions WHERE id = ? LIMIT 1`, [subscriptionId]);
            if (!subRows.length) {
                req.flash("error", "Subscription not found");
                return res.redirect("/superadmin/subscriptions");
            };
            const sub = subRows[0];

            await withTransaction(async ({ execute: exec }) => {
                await exec(
                    `UPDATE subscriptions SET status='cancelled', cancelled_at=NOW(), cancellation_reason=?, updated_at=NOW() WHERE id=?`,
                    [reason, subscriptionId]
                );
                await exec(
                    `UPDATE schools
                    SET status='inactive',
                        subscription_status='cancelled',
                        updated_at=NOW()
                    WHERE id=?`,
                    [sub.school_id]
                );
                await exec(
                    `INSERT INTO school_activity_logs (school_id, actor_id, actor_role, action, entity_type, entity_id, description, created_at)
                    VALUES (?,?,'super_admin','Subscription Cancelled','subscription',?,?,NOW())`,
                    [sub.school_id, req.user ? req.user.id : null, subscriptionId, `Subscription cancelled. Reason: ${reason || 'No reason provided'}`]
                );
            });

            await invalidateSchoolSubscriptionCaches(sub.school_id);

            req.flash("success", "Subscription cancelled successfully");
            res.redirect(`/superadmin/subscriptions/${subscriptionId}`);
        } catch (error) {
            console.error("Cancel Subscription Error:", error);
            req.flash("error", "Failed to cancel subscription");
            res.redirect(`/superadmin/subscriptions/${req.params.id}`);
        };
    },

    changePlan: async (req, res) => {
        try {
            const subscriptionId = req.params.id;
            const { plan_id, billing_cycle = 'monthly' } = req.body;
            const selectedBillingCycle = normalizeBillingCycle(billing_cycle);
            if (!selectedBillingCycle) {
                req.flash("error", "Invalid billing cycle. Choose monthly or yearly.");
                return res.redirect(`/superadmin/subscriptions/${subscriptionId}`);
            };

            const subRows = await queryAsync(`SELECT * FROM subscriptions WHERE id = ? LIMIT 1`, [subscriptionId]);
            if (!subRows.length) {
                req.flash("error", "Subscription not found");
                return res.redirect("/superadmin/subscriptions");
            };
            const sub = subRows[0];

            const planRows = await queryAsync(`SELECT * FROM plans WHERE id = ? LIMIT 1`, [plan_id]);
            if (!planRows.length) {
                req.flash("error", "New plan not found");
                return res.redirect(`/superadmin/subscriptions/${subscriptionId}`);
            };
            const plan = planRows[0];
            const schoolRows = await queryAsync(`SELECT * FROM schools WHERE id = ? LIMIT 1`, [sub.school_id]);
            const school = schoolRows[0] || null;
            if (isTrialPlan(plan)) {
                req.flash("error", hasSchoolUsedTrial(school) ? TRIAL_ALREADY_USED_MESSAGE : "Trial plan is only available through demo signup.");
                return res.redirect(`/superadmin/subscriptions/${subscriptionId}`);
            };
            const price = amountForPlan(plan, selectedBillingCycle);
            if (price <= 0) throw new Error("Selected plan price is invalid.");
            const startDate = new Date();
            const endDate = calculateSubscriptionEndDate(startDate, selectedBillingCycle);

            await withTransaction(async ({ execute: exec }) => {
                await exec(
                    `UPDATE subscriptions SET plan_id=?, plan=?, price=?, billing_cycle=?, start_date=?, end_date=?, updated_at=NOW() WHERE id=?`,
                    [plan_id, plan.plan_key, price, selectedBillingCycle, startDate, endDate, subscriptionId]
                );
                await exec(
                    `UPDATE schools
                    SET plan_id=?,
                        current_plan_id=?,
                        plan=?,
                        status='active',
                        subscription_status='active',
                        subscription_start=?,
                        subscription_end=?,
                        subscription_started_at=?,
                        subscription_ends_at=?,
                        updated_at=NOW()
                    WHERE id=?`,
                    [plan_id, plan_id, plan.plan_key, startDate, endDate, startDate, endDate, sub.school_id]
                );
                await exec(
                    `INSERT INTO school_activity_logs (school_id, actor_id, actor_role, action, entity_type, entity_id, description, created_at)
                    VALUES (?,?,'super_admin','Subscription Plan Changed','subscription',?,?,NOW())`,
                    [sub.school_id, req.user ? req.user.id : null, subscriptionId, `Plan changed to "${plan.name}" (${selectedBillingCycle}) by Super Admin.`]
                );
            });

            await invalidateSchoolSubscriptionCaches(sub.school_id);

            req.flash("success", "Plan changed successfully");
            res.redirect(`/superadmin/subscriptions/${subscriptionId}`);
        } catch (error) {
            console.error("Change Plan Error:", error);
            req.flash("error", "Failed to change plan: " + error.message);
            res.redirect(`/superadmin/subscriptions/${req.params.id}`);
        };
    },

    generateInvoice: async (req, res) => {
        try {
            const subscriptionId = req.params.id;
            const { due_date } = req.body;
            const defaultDue = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            const invoice = await withTransaction(async ({ query, execute: exec }) => {
                const subRows = await query(
                    "SELECT * FROM subscriptions WHERE id = ? LIMIT 1 FOR UPDATE",
                    [subscriptionId]
                );
                if (!subRows.length) {
                    const error = new Error("Subscription not found");
                    error.statusCode = 404;
                    throw error;
                };
                const sub = subRows[0];
                const existingRows = await query(
                    "SELECT id, invoice_no FROM invoices WHERE subscription_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE",
                    [subscriptionId]
                );
                if (existingRows.length) {
                    return { ...existingRows[0], alreadyExists: true };
                };

                const baseAmount = Number(sub.price);
                if (!Number.isFinite(baseAmount) || baseAmount < 0) {
                    const error = new Error("Subscription amount is invalid");
                    error.statusCode = 400;
                    throw error;
                };
                const taxAmount = parseFloat((baseAmount * 0.18).toFixed(2));
                const totalAmount = baseAmount + taxAmount;
                const invoiceNo = `INV-SUB-${subscriptionId}`;
                const invRes = await exec(
                    `INSERT INTO invoices (school_id, subscription_id, invoice_no, amount, tax_amount, discount_amount, total_amount, billing_date, due_date, status, created_at)
                    VALUES (?,?,?,?,?,0,?,NOW(),?,'unpaid',NOW())`,
                    [sub.school_id, subscriptionId, invoiceNo, baseAmount, taxAmount, totalAmount, due_date ? new Date(due_date) : defaultDue]
                );
                await exec(
                    `INSERT INTO school_activity_logs (school_id, actor_id, actor_role, action, entity_type, entity_id, description, created_at)
                    VALUES (?,?,'super_admin','Invoice Generated','invoice',?,?,NOW())`,
                    [sub.school_id, req.user ? req.user.id : null, invRes.insertId, `Invoice ${invoiceNo} generated manually by Super Admin for ₹${totalAmount.toFixed(2)}.`]
                );
                return { id: invRes.insertId, invoice_no: invoiceNo, alreadyExists: false };
            });
            const invoiceNo = invoice.invoice_no;

            if (req.xhr || req.headers.accept.indexOf('json') > -1) {
                return res.json({
                    success: true,
                    alreadyExists: invoice.alreadyExists,
                    message: invoice.alreadyExists
                        ? `Invoice ${invoiceNo} already exists`
                        : `Invoice ${invoiceNo} generated successfully`
                });
            };
            req.flash("success", invoice.alreadyExists
                ? `Invoice ${invoiceNo} already exists`
                : `Invoice ${invoiceNo} generated successfully`);
            res.redirect(`/superadmin/subscriptions/${subscriptionId}`);
        } catch (error) {
            console.error("Generate Invoice Error:", error);
            if (req.xhr || req.headers.accept.indexOf('json') > -1) {
                return res.status(error.statusCode || 500).json({ success: false, message: "Failed to generate invoice: " + error.message });
            };
            req.flash("error", "Failed to generate invoice");
            res.redirect(`/superadmin/subscriptions/${req.params.id}`);
        };
    }
};

module.exports = subscriptionController;
