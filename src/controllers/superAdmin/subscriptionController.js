const { queryAsync, executeAsync, withTransaction } = require("../../config/database");
const { invalidatePlanCache } = require("../../utils/planCache");

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
            }
            if (plan_id) {
                whereClauses.push('s.plan_id = ?');
                params.push(plan_id);
            }
            if (search) {
                whereClauses.push('sch.school_name LIKE ?');
                params.push(`%${search}%`);
            }
            if (start_date) {
                whereClauses.push('s.start_date >= ?');
                params.push(start_date);
            }
            if (end_date) {
                whereClauses.push('s.end_date <= ?');
                params.push(end_date);
            }

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
        }
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

            const payments     = await queryAsync(`SELECT * FROM subscription_payments WHERE school_id = ? ORDER BY COALESCE(paid_at, created_at) DESC`, [subscription.school_id]);
            const invoices     = await queryAsync(`SELECT * FROM invoices WHERE school_id = ? ORDER BY created_at DESC`, [subscription.school_id]);
            const activityLogs = await queryAsync(`SELECT * FROM school_activity_logs WHERE school_id = ? ORDER BY created_at DESC`, [subscription.school_id]);
            const plans        = await queryAsync(`SELECT * FROM plans WHERE is_active = 1`);

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
        }
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
        }
    },

    assign: async (req, res) => {
        try {
            const { school_id, plan_id, billing_cycle, start_date, end_date, notes } = req.body;

            const planRows = await queryAsync(`SELECT * FROM plans WHERE id = ? LIMIT 1`, [plan_id]);
            if (!planRows.length) {
                req.flash("error", "Plan not found");
                return res.redirect("/superadmin/subscriptions/assign");
            }
            const plan = planRows[0];

            const schoolRows = await queryAsync(`SELECT * FROM schools WHERE id = ? LIMIT 1`, [school_id]);
            if (!schoolRows.length) {
                req.flash("error", "School not found");
                return res.redirect("/superadmin/subscriptions/assign");
            }

            const calculatedEndDate = new Date(start_date);
            if (billing_cycle === 'yearly') {
                calculatedEndDate.setFullYear(calculatedEndDate.getFullYear() + 1);
            } else {
                calculatedEndDate.setMonth(calculatedEndDate.getMonth() + 1);
            }
            const finalEndDate = end_date ? new Date(end_date) : calculatedEndDate;
            const price = billing_cycle === 'yearly' ? plan.yearly_price : plan.monthly_price;

            await withTransaction(async ({ execute: exec }) => {
                await exec(
                    `UPDATE subscriptions SET status='expired', updated_at=NOW() WHERE school_id=? AND status='active'`,
                    [school_id]
                );
                const subRes = await exec(
                    `INSERT INTO subscriptions (school_id, plan_id, plan, price, billing_cycle, start_date, end_date, status, payment_status, created_at, updated_at)
                     VALUES (?,?,?,?,?,?,?,'active','pending',NOW(),NOW())`,
                    [school_id, plan_id, plan.plan_key, price, billing_cycle, new Date(start_date), finalEndDate]
                );
                const subId = subRes.insertId;
                await exec(
                    `UPDATE schools SET plan_id=?, plan=?, status='active', subscription_start=?, subscription_end=?, updated_at=NOW() WHERE id=?`,
                    [plan_id, plan.plan_key, new Date(start_date), finalEndDate, school_id]
                );
                await exec(
                    `INSERT INTO school_activity_logs (school_id, actor_id, actor_role, action, entity_type, entity_id, description, created_at)
                     VALUES (?,?,'super_admin','Subscription Assigned','subscription',?,?,NOW())`,
                    [school_id, req.user ? req.user.id : null, subId, `Plan "${plan.name}" (${billing_cycle}) assigned by Super Admin. ${notes || ''}`]
                );
            });

            await invalidatePlanCache(school_id);

            req.flash("success", "Subscription assigned successfully");
            res.redirect("/superadmin/subscriptions");
        } catch (error) {
            console.error("Assign Subscription Error:", error);
            req.flash("error", "Failed to assign subscription: " + error.message);
            res.redirect("/superadmin/subscriptions/assign");
        }
    },

    renew: async (req, res) => {
        try {
            const subscriptionId = req.params.id;
            const { months = 12 } = req.body;

            const subRows = await queryAsync(`SELECT * FROM subscriptions WHERE id = ? LIMIT 1`, [subscriptionId]);
            if (!subRows.length) {
                req.flash("error", "Subscription not found");
                return res.redirect("/superadmin/subscriptions");
            }
            const sub = subRows[0];

            const planRows = await queryAsync(`SELECT * FROM plans WHERE id = ? LIMIT 1`, [sub.plan_id]);
            const monthlyPrice = planRows.length ? planRows[0].monthly_price : sub.price;

            const startDate = new Date();
            const endDate   = new Date();
            endDate.setMonth(endDate.getMonth() + parseInt(months));

            await withTransaction(async ({ execute: exec }) => {
                await exec(`UPDATE subscriptions SET status='expired', updated_at=NOW() WHERE id=?`, [subscriptionId]);
                const newSubRes = await exec(
                    `INSERT INTO subscriptions (school_id, plan_id, plan, price, billing_cycle, start_date, end_date, status, payment_status, renewed_from_id, created_at, updated_at)
                     VALUES (?,?,?,?,?,?,?,'active','pending',?,NOW(),NOW())`,
                    [sub.school_id, sub.plan_id, sub.plan, monthlyPrice * parseInt(months), sub.billing_cycle || 'monthly', startDate, endDate, subscriptionId]
                );
                const newSubId = newSubRes.insertId;
                await exec(
                    `UPDATE schools SET status='active', subscription_start=?, subscription_end=?, updated_at=NOW() WHERE id=?`,
                    [startDate, endDate, sub.school_id]
                );
                await exec(
                    `INSERT INTO school_activity_logs (school_id, actor_id, actor_role, action, entity_type, entity_id, description, created_at)
                     VALUES (?,?,'super_admin','Subscription Renewed','subscription',?,?,NOW())`,
                    [sub.school_id, req.user ? req.user.id : null, newSubId, `Subscription renewed for ${months} months. Status set to active.`]
                );
            });

            await invalidatePlanCache(sub.school_id);

            req.flash("success", "Subscription renewed successfully");
            res.redirect(`/superadmin/subscriptions/${subscriptionId}`);
        } catch (error) {
            console.error("Renew Subscription Error:", error);
            req.flash("error", "Failed to renew subscription");
            res.redirect(`/superadmin/subscriptions/${req.params.id}`);
        }
    },

    cancel: async (req, res) => {
        try {
            const subscriptionId = req.params.id;
            const { reason } = req.body;

            const subRows = await queryAsync(`SELECT * FROM subscriptions WHERE id = ? LIMIT 1`, [subscriptionId]);
            if (!subRows.length) {
                req.flash("error", "Subscription not found");
                return res.redirect("/superadmin/subscriptions");
            }
            const sub = subRows[0];

            await withTransaction(async ({ execute: exec }) => {
                await exec(
                    `UPDATE subscriptions SET status='cancelled', cancelled_at=NOW(), cancellation_reason=?, updated_at=NOW() WHERE id=?`,
                    [reason, subscriptionId]
                );
                await exec(`UPDATE schools SET status='inactive', updated_at=NOW() WHERE id=?`, [sub.school_id]);
                await exec(
                    `INSERT INTO school_activity_logs (school_id, actor_id, actor_role, action, entity_type, entity_id, description, created_at)
                     VALUES (?,?,'super_admin','Subscription Cancelled','subscription',?,?,NOW())`,
                    [sub.school_id, req.user ? req.user.id : null, subscriptionId, `Subscription cancelled. Reason: ${reason || 'No reason provided'}`]
                );
            });

            await invalidatePlanCache(sub.school_id);

            req.flash("success", "Subscription cancelled successfully");
            res.redirect(`/superadmin/subscriptions/${subscriptionId}`);
        } catch (error) {
            console.error("Cancel Subscription Error:", error);
            req.flash("error", "Failed to cancel subscription");
            res.redirect(`/superadmin/subscriptions/${req.params.id}`);
        }
    },

    changePlan: async (req, res) => {
        try {
            const subscriptionId = req.params.id;
            const { plan_id, billing_cycle = 'monthly' } = req.body;

            const subRows = await queryAsync(`SELECT * FROM subscriptions WHERE id = ? LIMIT 1`, [subscriptionId]);
            if (!subRows.length) {
                req.flash("error", "Subscription not found");
                return res.redirect("/superadmin/subscriptions");
            }
            const sub = subRows[0];

            const planRows = await queryAsync(`SELECT * FROM plans WHERE id = ? LIMIT 1`, [plan_id]);
            if (!planRows.length) {
                req.flash("error", "New plan not found");
                return res.redirect(`/superadmin/subscriptions/${subscriptionId}`);
            }
            const plan = planRows[0];
            const price = billing_cycle === 'yearly' ? plan.yearly_price : plan.monthly_price;

            await withTransaction(async ({ execute: exec }) => {
                await exec(
                    `UPDATE subscriptions SET plan_id=?, plan=?, price=?, billing_cycle=?, updated_at=NOW() WHERE id=?`,
                    [plan_id, plan.plan_key, price, billing_cycle, subscriptionId]
                );
                await exec(
                    `UPDATE schools SET plan_id=?, plan=?, updated_at=NOW() WHERE id=?`,
                    [plan_id, plan.plan_key, sub.school_id]
                );
                await exec(
                    `INSERT INTO school_activity_logs (school_id, actor_id, actor_role, action, entity_type, entity_id, description, created_at)
                     VALUES (?,?,'super_admin','Subscription Plan Changed','subscription',?,?,NOW())`,
                    [sub.school_id, req.user ? req.user.id : null, subscriptionId, `Plan changed to "${plan.name}" (${billing_cycle}) by Super Admin.`]
                );
            });

            await invalidatePlanCache(sub.school_id);

            req.flash("success", "Plan changed successfully");
            res.redirect(`/superadmin/subscriptions/${subscriptionId}`);
        } catch (error) {
            console.error("Change Plan Error:", error);
            req.flash("error", "Failed to change plan: " + error.message);
            res.redirect(`/superadmin/subscriptions/${req.params.id}`);
        }
    },

    generateInvoice: async (req, res) => {
        try {
            const subscriptionId = req.params.id;
            const { amount, due_date } = req.body;

            const subRows = await queryAsync(`SELECT * FROM subscriptions WHERE id = ? LIMIT 1`, [subscriptionId]);
            if (!subRows.length) {
                return res.status(404).json({ success: false, message: "Subscription not found" });
            }
            const sub = subRows[0];

            const invoiceNo   = 'INV-' + Date.now().toString().slice(-8);
            const baseAmount  = parseFloat(amount) || sub.price;
            const taxAmount   = parseFloat((baseAmount * 0.18).toFixed(2));
            const totalAmount = baseAmount + taxAmount;
            const defaultDue  = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

            const invRes = await executeAsync(
                `INSERT INTO invoices (school_id, subscription_id, invoice_no, amount, tax_amount, discount_amount, total_amount, billing_date, due_date, status, created_at)
                 VALUES (?,?,?,?,?,0,?,NOW(),?,'unpaid',NOW())`,
                [sub.school_id, subscriptionId, invoiceNo, baseAmount, taxAmount, totalAmount, due_date ? new Date(due_date) : defaultDue]
            );
            const invoiceId = invRes.insertId;

            await executeAsync(
                `INSERT INTO school_activity_logs (school_id, actor_id, actor_role, action, entity_type, entity_id, description, created_at)
                 VALUES (?,?,'super_admin','Invoice Generated','invoice',?,?,NOW())`,
                [sub.school_id, req.user ? req.user.id : null, invoiceId, `Invoice ${invoiceNo} generated manually by Super Admin for ₹${amount}.`]
            );

            if (req.xhr || req.headers.accept.indexOf('json') > -1) {
                return res.json({ success: true, message: `Invoice ${invoiceNo} generated successfully` });
            }
            req.flash("success", `Invoice ${invoiceNo} generated successfully`);
            res.redirect(`/superadmin/subscriptions/${subscriptionId}`);
        } catch (error) {
            console.error("Generate Invoice Error:", error);
            if (req.xhr || req.headers.accept.indexOf('json') > -1) {
                return res.status(500).json({ success: false, message: "Failed to generate invoice: " + error.message });
            }
            req.flash("error", "Failed to generate invoice");
            res.redirect(`/superadmin/subscriptions/${req.params.id}`);
        }
    }
};

module.exports = subscriptionController;
