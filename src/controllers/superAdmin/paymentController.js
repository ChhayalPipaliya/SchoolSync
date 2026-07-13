const { queryAsync, executeAsync } = require("../../config/database");

const paymentController = {
    list: async (req, res) => {
        try {
            const { status, school_id, method, from, to, page = 1 } = req.query;
            const limit = 20;
            const offset = (page - 1) * limit;

            let whereClause = "WHERE 1=1";
            let params = [];

            if (status) { whereClause += " AND sp.status = ?"; params.push(status); }
            if (school_id) { whereClause += " AND sp.school_id = ?"; params.push(school_id); }
            if (method) { whereClause += " AND sp.payment_method = ?"; params.push(method); }
            if (from) { whereClause += " AND sp.paid_at >= ?"; params.push(from); }
            if (to) { whereClause += " AND sp.paid_at <= ?"; params.push(to); }

            const payments = await queryAsync(`
                SELECT 
                    sp.*,
                    s.school_name, s.subdomain,
                    p.name as plan_name
                FROM subscription_payments sp
                JOIN schools s ON sp.school_id = s.id
                JOIN plans p ON sp.plan_id = p.id
                ${whereClause}
                ORDER BY sp.created_at DESC
                LIMIT ? OFFSET ?
            `, [...params, limit, offset]);

            const [totalResult] = await queryAsync(`
                SELECT COUNT(*) as total, COALESCE(SUM(total_amount), 0) as total_amount 
                FROM subscription_payments sp ${whereClause}
            `, params);

            const schools = await queryAsync("SELECT id, school_name FROM schools");

            res.render("superAdmin/payments/list", {
                title: "Payments - SchoolSync",
                payments,
                schools,
                filters: { status, school_id, method, from, to },
                summary: { total: totalResult.total, amount: totalResult.total_amount },
                pagination: {
                    page: parseInt(page),
                    totalPages: Math.ceil(totalResult.total / limit),
                    total: totalResult.total
                },
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            req.flash("error", "Failed to load payments");
            res.redirect("/superadmin/dashboard");
        }
    },

    detail: async (req, res) => {
        try {
            const paymentId = req.params.id;
            const [payment] = await queryAsync(`
                SELECT sp.*, s.school_name, p.name as plan_name
                FROM subscription_payments sp
                JOIN schools s ON sp.school_id = s.id
                JOIN plans p ON sp.plan_id = p.id
                WHERE sp.id = ?
            `, [paymentId]);

            if (!payment) {
                req.flash("error", "Payment not found");
                return res.redirect("/superadmin/payments");
            };

            res.render("superAdmin/payments/detail", {
                title: `Payment ${payment.receipt_no} - SchoolSync`,
                payment,
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            req.flash("error", "Failed to load payment");
            res.redirect("/superadmin/payments");
        };
    },

    refund: async (req, res) => {
        try {
            const paymentId = req.params.id;
            const { amount, reason } = req.body;

            await executeAsync(
                `UPDATE subscription_payments SET 
                    status = 'refunded', notes = CONCAT(IFNULL(notes, ''), ' | Refund: ', ?)
                WHERE id = ?`,
                [`${reason} (₹${amount})`, paymentId]
            );

            req.flash("success", "Refund processed");
            res.redirect(`/superadmin/payments/${paymentId}`);
        } catch (error) {
            req.flash("error", "Refund failed");
            res.redirect(`/superadmin/payments/${paymentId}`);
        };
    }
};

module.exports = paymentController;