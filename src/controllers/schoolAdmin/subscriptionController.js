const db = require("../../config/database");
const billingService = require("../../services/billingService");
const NotificationService = require("../../services/notificationService");
const { logSchoolActivity } = require("../../utils/auditLogger");
const { invalidatePlanCache, invalidateSubscriptionCache } = require("../../utils/planCache");
const { getSubscriptionState, getPublicPlans } = require("../../services/subscriptionService");
const subscriptionPaymentService = require("../../services/subscriptionPaymentService");

const subscriptionController = {
    index: async (req, res) => {
        try {
            const schoolId = req.user.school_id;
            const subscriptionState = req.subscriptionState || await getSubscriptionState(schoolId, {
                createReminders: true,
                userId: req.user.id
            });

            const [schools] = await db.query('SELECT * FROM schools WHERE id = ? LIMIT 1', [schoolId]);
            const school = schools[0];
            if (!school) {
                req.flash("error", "School not found");
                return res.redirect("/login");
            }

            const [subscriptions] = await db.query(`
                SELECT s.*, p.name as plan_name, p.monthly_price, p.yearly_price, p.features,
                    p.max_students, p.max_teachers, p.max_classes
                FROM subscriptions s
                JOIN plans p ON s.plan_id = p.id
                WHERE s.school_id = ? AND s.status IN ('active', 'trial')
                ORDER BY s.end_date DESC, s.id DESC
                LIMIT 1
            `, [schoolId]);
            const subscription = subscriptions[0];

            const [studentRows] = await db.query(
                'SELECT COUNT(*) as count FROM students WHERE school_id = ? AND deleted_at IS NULL',
                [schoolId]
            );
            const studentCount = studentRows[0] ? studentRows[0].count : 0;

            const [teacherRows] = await db.query(
                `SELECT COUNT(*) as count FROM teachers t 
                JOIN users u ON t.user_id = u.id 
                WHERE t.school_id = ? AND u.deleted_at IS NULL`,
                [schoolId]
            );
            const teacherCount = teacherRows[0] ? teacherRows[0].count : 0;

            let classCount = 0;
            try {
                const [classRows] = await db.query('SELECT COUNT(*) as count FROM classes WHERE school_id = ?', [schoolId]);
                classCount = classRows[0] ? classRows[0].count : 0;
            } catch (err) {
                console.error("Classes count query error:", err);
            };

            const usage = {
                students: studentCount,
                teachers: teacherCount,
                classes: classCount
            };

            const [payments] = await db.query(
                'SELECT * FROM subscription_payments WHERE school_id = ? ORDER BY created_at DESC LIMIT 5',
                [schoolId]
            );

            const plans = await getPublicPlans();

            let daysRemaining = 0;
            if (subscription && subscription.end_date) {
                const end = new Date(subscription.end_date);
                if (end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0 && end.getMilliseconds() === 0) {
                    end.setHours(23, 59, 59, 999);
                }
                const now = new Date();
                daysRemaining = now > end ? 0 : Math.ceil((end - now) / (1000 * 60 * 60 * 24));
            };

            let featuresList = {};
            if (subscription && subscription.features) {
                try {
                    featuresList = typeof subscription.features === "string" ? JSON.parse(subscription.features) : subscription.features;
                } catch (e) {
                    featuresList = {};
                };
            };

            res.render("schoolAdmin/subscription/index", {
                title: "My Subscription - SchoolSync",
                school,
                subscription,
                usage,
                payments,
                plans,
                daysRemaining,
                featuresList,
                subscriptionState,
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            console.error("School Admin Subscription Error:", error);
            req.flash("error", "Failed to load subscription status");
            res.redirect("/schooladmin/dashboard");
        };
    },

    prorationPreview: async (req, res) => {
        try {
            const schoolId = req.user.school_id;
            const newPlanId = req.params.newPlanId || req.query.newPlanId;
            if (!newPlanId) {
                return res.status(400).json({ success: false, message: "New plan ID is required" });
            }
            const preview = await billingService.calculateProration(schoolId, newPlanId);
            return res.json({ success: true, proration: preview });
        } catch (error) {
            console.error("Proration preview error:", error);
            return res.status(500).json({ success: false, message: error.message || "Failed to calculate proration preview" });
        };
    },

    renewRequest: async (req, res) => {
        try {
            const schoolId = req.user.school_id;
            const [schools] = await db.query('SELECT * FROM schools WHERE id = ? LIMIT 1', [schoolId]);
            const school = schools[0];
            if (!school) {
                return res.status(404).json({ success: false, message: "School not found" });
            }

            const [superadmins] = await db.query("SELECT id FROM users WHERE role = 'super_admin'");
            for (const sa of superadmins) {
                await NotificationService.createAndSend({
                    recipient_id: sa.id,
                    recipient_role: 'super_admin',
                    school_id: schoolId,
                    title: 'Renewal Request',
                    message: `School "${school.school_name}" has requested a subscription renewal.`,
                    type: 'info',
                    category: 'system',
                    created_by: req.user.id,
                    action_url: '/superadmin/schools'
                });
            };

            await db.query(`
                INSERT INTO school_activity_logs (school_id, actor_id, actor_role, action, entity_type, entity_id, description, created_at)
                VALUES (?, ?, 'school_admin', 'Renewal Requested', 'subscription', NULL, 'Principal submitted a subscription renewal request.', NOW())
            `, [schoolId, req.user.id]);

            if (req.xhr || req.headers.accept.indexOf('json') > -1) {
                return res.json({ success: true, message: "Renewal request submitted successfully to Super Admin" });
            };

            req.flash("success", "Renewal request submitted successfully");
            res.redirect("/schooladmin/subscription");
        } catch (error) {
            console.error("Renewal Request Error:", error);
            if (req.xhr || req.headers.accept.indexOf('json') > -1) {
                return res.status(500).json({ success: false, message: "Failed to submit renewal request" });
            };
            req.flash("error", "Failed to submit renewal request");
            res.redirect("/schooladmin/subscription");
        };
    },

    createCheckoutSession: async (req, res) => {
        try {
            const schoolId = req.user.school_id;
            const planId = req.body.plan_id || req.body.target_plan_id;
            const result = await subscriptionPaymentService.createOrder({
                schoolId,
                userId: req.user.id,
                planId,
                billingCycle: req.body.billing_cycle
            });

            if (!result.success) {
                return res.status(result.statusCode || 400).json(result);
            };

            res.json({
                ...result,
                data: {
                    order_id: result.order_id,
                    amount: result.amount,
                    currency: result.currency,
                    payment_record_id: result.payment_record_id,
                    key_id: result.key_id,
                    plan: result.plan,
                    school: result.school,
                    prefill: result.prefill
                }
            });
        } catch (error) {
            console.error("Subscription checkout error:", error);
            res.status(500).json({ success: false, message: error.message || "Failed to create checkout order." });
        };
    },

    verifySubscriptionPayment: async (req, res) => {
        try {
            const schoolId = req.user.school_id;
            const result = await subscriptionPaymentService.verifyPayment({
                schoolId,
                orderId: req.body.razorpay_order_id,
                paymentId: req.body.razorpay_payment_id,
                signature: req.body.razorpay_signature,
                planId: req.body.plan_id,
                billingCycle: req.body.billing_cycle
            });

            if (!result.success) {
                return res.status(result.statusCode || 400).json(result);
            };

            res.json(result);
        } catch (err) {
            console.error("verifySubscriptionPayment error:", err);
            res.status(500).json({ success: false, message: err.message || 'Verification failed' });
        };
    },

    paymentFailed: async (req, res) => {
        try {
            const result = await subscriptionPaymentService.markPaymentFailed({
                schoolId: req.user.school_id,
                orderId: req.body.razorpay_order_id || req.body.order_id,
                paymentId: req.body.razorpay_payment_id || null,
                reason: req.body.reason || req.body.error_description || "Payment failed or was cancelled."
            });
            res.json(result);
        } catch (err) {
            console.error("paymentFailed error:", err);
            res.status(500).json({ success: false, message: "Failed to record payment failure." });
        };
    }
};

module.exports = subscriptionController;