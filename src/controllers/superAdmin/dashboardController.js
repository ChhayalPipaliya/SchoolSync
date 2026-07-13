const { queryAsync } = require("../../config/database");
const { getRedisClient } = require("../../config/redis");
const { getIO } = require("../../config/socket");
const revenueService = require("../../services/revenueService");
const healthService = require("../../services/healthService");

let ioIntervalInitialized = false;

const broadcastDashboardUpdates = async () => {
    try {
        let io;
        try {
            io = getIO();
        } catch (e) {
            return;
        };
        if (!io) return;

        const [metrics, health] = await Promise.all([
            getDashboardMetrics(),
            healthService.getPlatformHealth()
        ]);

        io.to("superadmin:global").emit("dashboard:kpi-update", {
            mrr: metrics.revenue.mrr,
            arr: metrics.revenue.arr,
            schools: metrics.schools.active,
            tickets: metrics.tickets.total,
            health: health.score
        });

        io.to("superadmin:global").emit("dashboard:health-update", {
            score: health.score,
            components: health.components,
            timestamp: new Date()
        });
    } catch (err) {
        console.error("[Socket Broadcast] Error broadcasting dashboard updates:", err.message);
    };
};

const initDashboardSocketInterval = () => {
    if (ioIntervalInitialized) return;
    ioIntervalInitialized = true;
    setInterval(() => {
        broadcastDashboardUpdates();
    }, 30000);
};

const getDashboardMetrics = async (filters = {}) => {
    let schoolWhere = "WHERE 1=1";
    let params = [];

    if (filters.status) {
        schoolWhere += " AND s.status = ?";
        params.push(filters.status);
    };
    if (filters.plan) {
        schoolWhere += " AND (s.plan_id = ? OR s.plan = ?)";
        params.push(Number.parseInt(filters.plan, 10) || 0, filters.plan);
    };
    if (filters.startDate && filters.endDate) {
        schoolWhere += " AND s.created_at >= ? AND s.created_at <= CONCAT(?, ' 23:59:59')";
        params.push(filters.startDate, filters.endDate);
    };

    const [schoolsCount] = await queryAsync(`
    SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'trial' THEN 1 ELSE 0 END) as trial,
        SUM(CASE WHEN status = 'expired' OR status = 'inactive' THEN 1 ELSE 0 END) as expired
    FROM schools s
    ${schoolWhere}
  `, params);

    const [studentsCount] = await queryAsync(`SELECT COUNT(*) as total FROM students`);
    const [teachersCount] = await queryAsync(`SELECT COUNT(*) as total FROM teachers`);
    const [ticketsCount] = await queryAsync(`
    SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN priority = 'critical' THEN 1 ELSE 0 END) as critical,
        SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) as high,
        SUM(CASE WHEN priority = 'medium' OR priority = 'normal' THEN 1 ELSE 0 END) as medium
    FROM support_tickets 
    WHERE status IN ('open', 'in_progress')
  `);

    const mrr = await revenueService.getMRR();
    const arr = await revenueService.getARR(mrr);
    const totalRevenue = await revenueService.getTotalRevenue();
    const revenueGrowth = await revenueService.getRevenueGrowth();
    const avgRevenue = await revenueService.getAverageRevenuePerSchool(totalRevenue);
    const forecast = await revenueService.getRevenueForecast(mrr);
    return {
        schools: {
            total: parseInt(schoolsCount.total || 0),
            active: parseInt(schoolsCount.active || 0),
            trial: parseInt(schoolsCount.trial || 0),
            expired: parseInt(schoolsCount.expired || 0)
        },
        students: parseInt(studentsCount.total || 0),
        teachers: parseInt(teachersCount.total || 0),
        tickets: {
            total: parseInt(ticketsCount.total || 0),
            critical: parseInt(ticketsCount.critical || 0),
            high: parseInt(ticketsCount.high || 0),
            medium: parseInt(ticketsCount.medium || 0)
        },
        revenue: {
            mrr,
            arr,
            total: totalRevenue,
            growth: revenueGrowth,
            average: avgRevenue,
            forecast
        }
    };
};

const getSchoolLeaderboard = async () => {
    const sql = `
    SELECT 
        s.id,
        s.school_name as name,
        COALESCE(p.plan_key, s.plan) as plan,
        p.name as plan_name,
        s.status,
        s.created_at,
        s.subscription_end,
        DATEDIFF(s.subscription_end, CURDATE()) as days_left,
        (SELECT COUNT(*) FROM students WHERE school_id = s.id) as students,
        (SELECT COUNT(*) FROM teachers WHERE school_id = s.id) as teachers,
        COALESCE((SELECT SUM(total_amount) FROM subscription_payments WHERE school_id = s.id AND (status = 'completed' OR status = 'paid')), 0) as revenue,
        ROUND(
            COALESCE(
                (SELECT COUNT(CASE WHEN status IN ('present', 'late') THEN 1 END) / NULLIF(COUNT(*), 0) * 25 FROM attendance WHERE school_id = s.id),
                20
            ) +
            COALESCE(
                (SELECT COUNT(CASE WHEN status = 'paid' THEN 1 END) / NULLIF(COUNT(*), 0) * 25 FROM student_fees WHERE school_id = s.id),
                20
            ) +
            20 +
            15 +
            (CASE WHEN s.status = 'active' THEN 15 ELSE 10 END)
        ) as health_score
    FROM schools s
    LEFT JOIN plans p ON s.plan_id = p.id
    ORDER BY revenue DESC
  `;
    const rows = await queryAsync(sql);

    const topRevenue = [...rows].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
    const recentSignups = [...rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10);
    const expiringSoon = rows.filter(r => r.status === 'active' && r.subscription_end && r.days_left >= 0 && r.days_left <= 30).sort((a, b) => a.days_left - b.days_left).slice(0, 10);
    const atRisk = rows.filter(r => r.health_score < 80).sort((a, b) => a.health_score - b.health_score).slice(0, 10);

    return {
        topRevenue,
        recentSignups,
        expiringSoon,
        atRisk
    };
};

const getPlanIntelligence = async () => {
    const rows = await queryAsync(`
    SELECT
        p.id,
        p.name,
        p.plan_key,
        p.color_code,
        p.monthly_price,
        p.yearly_price,
        COALESCE(school_stats.active_schools, 0) AS active_schools,
        COALESCE(school_stats.trial_schools, 0) AS trial_schools,
        COALESCE(sub_stats.monthly_subscriptions, 0) AS monthly_subscriptions,
        COALESCE(sub_stats.yearly_subscriptions, 0) AS yearly_subscriptions,
        COALESCE(sub_stats.expiring_soon, 0) AS expiring_soon,
        0 AS pending_requests,
        COALESCE(pay_stats.paid_revenue, 0) AS paid_revenue
    FROM plans p
    LEFT JOIN (
        SELECT
            plan_id,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_schools,
            SUM(CASE WHEN status = 'trial' THEN 1 ELSE 0 END) AS trial_schools
        FROM schools
        GROUP BY plan_id
    ) school_stats ON school_stats.plan_id = p.id
    LEFT JOIN (
        SELECT
            plan_id,
            SUM(CASE WHEN billing_cycle = 'monthly' AND status IN ('active', 'trial') THEN 1 ELSE 0 END) AS monthly_subscriptions,
            SUM(CASE WHEN billing_cycle = 'yearly' AND status IN ('active', 'trial') THEN 1 ELSE 0 END) AS yearly_subscriptions,
            SUM(CASE WHEN status IN ('active', 'trial') AND end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS expiring_soon
        FROM subscriptions
        GROUP BY plan_id
    ) sub_stats ON sub_stats.plan_id = p.id
    LEFT JOIN (
        SELECT
            plan_id,
            SUM(COALESCE(total_amount, amount, 0)) AS paid_revenue
        FROM subscription_payments
        WHERE status IN ('completed', 'paid')
      GROUP BY plan_id
    ) pay_stats ON pay_stats.plan_id = p.id
    WHERE p.is_active = 1
    ORDER BY p.monthly_price ASC, p.id ASC
  `);

    const totals = rows.reduce((acc, row) => {
        acc.activeSchools += Number(row.active_schools || 0);
        acc.trialSchools += Number(row.trial_schools || 0);
        acc.monthlySubscriptions += Number(row.monthly_subscriptions || 0);
        acc.yearlySubscriptions += Number(row.yearly_subscriptions || 0);
        acc.expiringSoon += Number(row.expiring_soon || 0);
        acc.pendingRequests += Number(row.pending_requests || 0);
        acc.paidRevenue += Number(row.paid_revenue || 0);
        return acc;
    }, {
        activeSchools: 0,
        trialSchools: 0,
        monthlySubscriptions: 0,
        yearlySubscriptions: 0,
        expiringSoon: 0,
        pendingRequests: 0,
        paidRevenue: 0
    });
    return { rows, totals };
};

const getTrialConversion = async () => {
    const [row] = await queryAsync(`
    SELECT
        SUM(CASE
            WHEN (
                COALESCE(s.trial_used, 0) = 1
                OR COALESCE(s.is_trial_used, 0) = 1
                OR s.trial_started_at IS NOT NULL
                OR s.trial_ends_at IS NOT NULL
                OR EXISTS (
                    SELECT 1
                    FROM subscriptions sub
                    WHERE sub.school_id = s.id
                        AND (sub.status = 'trial' OR sub.trial_start_date IS NOT NULL OR sub.trial_end_date IS NOT NULL)
                )
            )
        THEN 1 ELSE 0
        END) AS total_trials,
        SUM(CASE
            WHEN (s.status = 'active' OR s.subscription_status = 'active')
                AND (
                    COALESCE(s.trial_used, 0) = 1
                    OR COALESCE(s.is_trial_used, 0) = 1
                    OR s.trial_started_at IS NOT NULL
                    OR s.trial_ends_at IS NOT NULL
                    OR EXISTS (
                        SELECT 1
                        FROM subscriptions sub
                        WHERE sub.school_id = s.id
                            AND (sub.status = 'trial' OR sub.trial_start_date IS NOT NULL OR sub.trial_end_date IS NOT NULL)
                    )
                )
            THEN 1 ELSE 0
        END) AS converted_trials
    FROM schools s
    `);

    const totalTrials = Number(row?.total_trials || 0);
    const convertedTrials = Number(row?.converted_trials || 0);
    const percentage = totalTrials > 0 ? Math.round((convertedTrials / totalTrials) * 100) : 0;

    return {
        converted: convertedTrials,
        total: totalTrials,
        percentage
    };
};

const getSecurityEvents = async () => {
    const [failedLoginRow] = await queryAsync(`
    SELECT COUNT(*) AS total
    FROM super_admin_login_activities
    WHERE status = 'failed'
        AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
  `);

    return {
        failedLogins: {
            count: Number(failedLoginRow?.total || 0),
            isLogged: true
        },
        rateLimitTriggers: {
            count: null,
            isLogged: false
        },
        webhookSignatureFailures: {
            count: null,
            isLogged: false
        }
    };
};

const formatRelativeTime = (value) => {
    if (!value) return "just now";
    const timestamp = new Date(value).getTime();
    if (Number.isNaN(timestamp)) return "just now";

    const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (diffSeconds < 60) return "just now";
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths < 12) return `${diffMonths}mo ago`;
    return `${Math.floor(diffMonths / 12)}y ago`;
};

const getRecentActivity = async () => {
    const rows = await queryAsync(`
    SELECT event_type, description, created_at
    FROM (
      SELECT
        'school_created' AS event_type,
        CONCAT(s.school_name, ' created') AS description,
        s.created_at
      FROM schools s
      WHERE s.created_at IS NOT NULL

      UNION ALL

      SELECT
        sal.action AS event_type,
        COALESCE(sal.description, CONCAT('Subscription activity for ', sc.school_name)) AS description,
        sal.created_at
      FROM school_activity_logs sal
      LEFT JOIN schools sc ON sc.id = sal.school_id
      WHERE sal.entity_type = 'subscriptions'
         OR sal.action LIKE '%subscription%'
         OR sal.action LIKE '%renewal%'
      UNION ALL
      SELECT
        CASE
          WHEN sp.status IN ('completed', 'paid') THEN 'payment_succeeded'
          WHEN sp.status = 'failed' THEN 'payment_failed'
          ELSE CONCAT('payment_', sp.status)
        END AS event_type,
        CONCAT(
          sc.school_name,
          CASE
            WHEN sp.status IN ('completed', 'paid') THEN ' payment succeeded'
            WHEN sp.status = 'failed' THEN ' payment failed'
            ELSE CONCAT(' payment ', sp.status)
          END,
          ' · ₹',
          FORMAT(COALESCE(sp.total_amount, sp.amount, 0), 2)
        ) AS description,
        COALESCE(sp.paid_at, sp.updated_at, sp.created_at) AS created_at
      FROM subscription_payments sp
      JOIN schools sc ON sc.id = sp.school_id
      WHERE sp.status IN ('completed', 'paid', 'failed')
    ) recent_events
    ORDER BY created_at DESC
    LIMIT 15
  `);

    return rows.map((row) => ({
        eventType: row.event_type || "activity",
        description: row.description || "Platform activity recorded",
        createdAt: row.created_at,
        relativeTime: formatRelativeTime(row.created_at)
    }));
};

const compileDashboardData = async (filters = {}) => {
    const [metrics, health, leaderboard, trend, planDistribution, planIntelligence, trialConversion, securityEvents, recentActivity] = await Promise.all([
        getDashboardMetrics(filters),
        healthService.getPlatformHealth(),
        getSchoolLeaderboard(),
        revenueService.getRevenueTrend(),
        revenueService.getPlanRevenueDistribution(),
        getPlanIntelligence(),
        getTrialConversion(),
        getSecurityEvents(),
        getRecentActivity()
    ]);

    const plans = await queryAsync("SELECT plan_key, name FROM plans WHERE is_active = 1");
    return {
        metrics,
        health,
        leaderboard,
        charts: {
            revenue: trend,
            plans: planDistribution
        },
        planIntelligence,
        trialConversion,
        securityEvents,
        recentActivity,
        plans
    };
};

const dashboardController = {
    getDashboard: async (req, res) => {
        try {
            const { startDate, endDate, plan, status } = req.query;

            initDashboardSocketInterval();
            const data = await compileDashboardData({ startDate, endDate, plan, status });
            res.render("superAdmin/dashboard", {
                title: "Super Admin Dashboard - SchoolSync",
                date: new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
                user: req.user,
                filters: { startDate, endDate, plan, status },
                ...data,
                currentPath: req.path
            });
        } catch (error) {
            console.error("Dashboard Render Error:", error);
            req.flash("error", "Failed to load dashboard data");
            res.redirect("/");
        };
    },

    getStatsAPI: async (req, res) => {
        try {
            const data = await compileDashboardData(req.query);
            res.json({ success: true, data });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        };
    },

    getRevenueChart: async (req, res) => {
        try {
            const data = await revenueService.getRevenueTrend();
            res.json({ success: true, data });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        };
    },

    getSchoolsGrowth: async (req, res) => {
        try {
            const data = await queryAsync(`
                SELECT 
                    DATE_FORMAT(created_at, '%b %Y') as label,
                    COUNT(*) as count
                FROM schools
                WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
                GROUP BY DATE_FORMAT(created_at, '%Y-%m'), DATE_FORMAT(created_at, '%b %Y')
                ORDER BY DATE_FORMAT(created_at, '%Y-%m')
            `);
            res.json({
                success: true,
                data: {
                    labels: data.map(r => r.label),
                    data: data.map(r => r.count)
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        };
    },

    resolveAlert: async (req, res) => {
        try {
            const { id } = req.params;
            const numericId = id.includes('-') ? id.split('-')[1] : id;

            if (id.startsWith('backup_delay-') || id.startsWith('alert-')) {
                await queryAsync("UPDATE system_alerts SET status = 'resolved' WHERE id = ?", [numericId]);
            };

            req.flash("success", "System alert marked as resolved.");
            res.redirect("/superadmin/dashboard");
        } catch (error) {
            console.error("Resolve Alert Error:", error);
            req.flash("error", "Failed to resolve system alert.");
            res.redirect("/superadmin/dashboard");
        };
    }
};

module.exports = dashboardController;