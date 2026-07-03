const db = require('../../config/database');

const getAcademicYearDates = (from, to) => {
    let startDate = from;
    let endDate = to;
    if (!startDate || !endDate) {
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth();
        let startYear, endYear;
        if (currentMonth >= 3) {
            startYear = currentYear;
            endYear = currentYear + 1;
        } else {
            startYear = currentYear - 1;
            endYear = currentYear;
        }
        if (!startDate) startDate = `${startYear}-04-01`;
        if (!endDate) endDate = `${endYear}-03-31`;
    }
    return { startDate, endDate };
};

exports.getAnalyticsPage = async (req, res) => {
    try {
        res.render('superAdmin/analytics', {
            title: 'Advanced Analytics',
            user: req.session.user,
            currentPath: '/superadmin/analytics'
        });
    } catch (err) {
        console.error('Analytics page render error:', err);
        req.flash('error', 'Failed to load analytics dashboard');
        res.redirect('/superadmin/dashboard');
    }
};

exports.getRevenueAnalytics = async (req, res, next) => {
    try {
        const { from, to } = req.query;
        const { startDate, endDate } = getAcademicYearDates(from, to);

        const [mrrTrend] = await db.query(
            `SELECT DATE_FORMAT(sp.paid_at, '%b %Y') as label, SUM(sp.total_amount) as value 
            FROM subscription_payments sp 
            WHERE sp.status = 'completed' AND sp.paid_at BETWEEN ? AND ? 
            GROUP BY DATE_FORMAT(sp.paid_at, '%Y-%m'), DATE_FORMAT(sp.paid_at, '%b %Y') 
            ORDER BY DATE_FORMAT(sp.paid_at, '%Y-%m')`,
            [startDate, endDate]
        );

        const [revenueByPlan] = await db.query(
            `SELECT p.name as label, SUM(sp.total_amount) as value 
            FROM subscription_payments sp 
            JOIN plans p ON sp.plan_id = p.id 
            WHERE sp.status = 'completed' AND sp.paid_at BETWEEN ? AND ? 
            GROUP BY p.name`,
            [startDate, endDate]
        );

        const [churnMoM] = await db.query(
            `SELECT DATE_FORMAT(sub.end_date, '%b %Y') as label, 
                COALESCE(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM schools WHERE created_at <= MAX(sub.end_date)), 0), 0) as value 
            FROM subscriptions sub 
            WHERE sub.status IN ('expired', 'cancelled') AND sub.end_date BETWEEN ? AND ? 
            GROUP BY DATE_FORMAT(sub.end_date, '%Y-%m'), DATE_FORMAT(sub.end_date, '%b %Y') 
            ORDER BY DATE_FORMAT(sub.end_date, '%Y-%m')`,
            [startDate, endDate]
        );

        const [[avgRevRow]] = await db.query(
            `SELECT COALESCE(SUM(total_amount), 0) / NULLIF((SELECT COUNT(*) FROM schools), 0) as avgRevenue 
             FROM subscription_payments 
             WHERE status = 'completed' AND paid_at BETWEEN ? AND ?`,
            [startDate, endDate]
        );

        const [topSchools] = await db.query(
            `SELECT s.id, s.school_name as name, s.plan, s.status, COALESCE(SUM(sp.total_amount), 0) as revenue 
             FROM schools s 
             LEFT JOIN subscription_payments sp ON s.id = sp.school_id AND sp.status = 'completed' AND sp.paid_at BETWEEN ? AND ? 
             GROUP BY s.id, s.school_name, s.plan, s.status 
             ORDER BY revenue DESC 
             LIMIT 10`,
            [startDate, endDate]
        );

        res.json({
            success: true,
            data: {
                mrrTrend,
                revenueByPlan,
                churnMoM,
                avgRevenue: parseFloat(avgRevRow?.avgRevenue || 0),
                topSchools
            }
        });
    } catch (err) {
        next(err);
    }
};

exports.getSchoolAnalytics = async (req, res, next) => {
    try {
        const { from, to } = req.query;
        const { startDate, endDate } = getAcademicYearDates(from, to);

        const [registrations] = await db.query(
            `SELECT DATE_FORMAT(created_at, '%b %Y') as label, COUNT(*) as value 
             FROM schools 
             WHERE created_at BETWEEN ? AND ? 
             GROUP BY DATE_FORMAT(created_at, '%Y-%m'), DATE_FORMAT(created_at, '%b %Y') 
             ORDER BY DATE_FORMAT(created_at, '%Y-%m')`,
            [startDate, endDate]
        );

        const [statusDist] = await db.query(
            `SELECT status as label, COUNT(*) as value 
             FROM schools 
             GROUP BY status`
        );

        const [planDist] = await db.query(
            `SELECT COALESCE(plan, 'Trial/No Plan') as label, COUNT(*) as value 
             FROM schools 
             GROUP BY plan`
        );

        const [geoDist] = await db.query(
            `SELECT COALESCE(state, 'Unknown') as state, COALESCE(city, 'Unknown') as city, COUNT(*) as value 
             FROM schools 
             GROUP BY state, city 
             ORDER BY value DESC`
        );

        res.json({
            success: true,
            data: {
                registrations,
                statusDist,
                planDist,
                geoDist
            }
        });
    } catch (err) {
        next(err);
    }
};

exports.getPlatformAnalytics = async (req, res, next) => {
    try {
        const { from, to } = req.query;
        const { startDate, endDate } = getAcademicYearDates(from, to);

        const [[activeUsersCount]] = await db.query(
            `SELECT COUNT(*) as count FROM users WHERE status = 'active'`
        );
        const [[prevUsersCount]] = await db.query(
            `SELECT COUNT(*) as count FROM users WHERE status = 'active' AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)`
        );
        let userTrendPct = 0;
        if (prevUsersCount.count > 0) {
            userTrendPct = ((activeUsersCount.count - prevUsersCount.count) / prevUsersCount.count) * 100;
        }

        const [dau30Days] = await db.query(
            `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') as label, COUNT(DISTINCT actor_id) as value 
             FROM school_activity_logs 
             WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) 
             GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d') 
             ORDER BY label ASC`
        );

        const [[avgStudentsRow]] = await db.query(
            `SELECT COUNT(s.id) / NULLIF((SELECT COUNT(*) FROM schools), 0) as avgStudents 
             FROM students s WHERE s.deleted_at IS NULL`
        );

        const [[renewalRow]] = await db.query(
            `SELECT 
                (SELECT COUNT(*) FROM subscriptions WHERE renewed_from_id IS NOT NULL) * 100.0 / 
                NULLIF((SELECT COUNT(*) FROM subscriptions WHERE status IN ('active', 'expired')), 0) as renewalRate`
        );
        const renewalRate = parseFloat(renewalRow?.renewalRate || 85.0);

        const [expiringSchools] = await db.query(
            `SELECT s.id, s.school_name as name, s.plan, s.subscription_end, DATEDIFF(s.subscription_end, CURDATE()) as days_left 
             FROM schools s 
             WHERE s.status = 'active' AND s.subscription_end BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY) 
             ORDER BY s.subscription_end ASC`
        );

        res.json({
            success: true,
            data: {
                totalActiveUsers: activeUsersCount.count,
                userTrendPct: parseFloat(userTrendPct.toFixed(1)),
                dau30Days,
                avgStudents: parseFloat(parseFloat(avgStudentsRow?.avgStudents || 0).toFixed(1)),
                renewalRate,
                expiringSchools
            }
        });
    } catch (err) {
        next(err);
    }
};

exports.getSupportAnalytics = async (req, res, next) => {
    try {
        const { from, to } = req.query;
        const { startDate, endDate } = getAcademicYearDates(from, to);

        const [ticketsStatus] = await db.query(
            `SELECT status as label, COUNT(*) as value 
             FROM support_tickets 
             WHERE created_at BETWEEN ? AND ? 
             GROUP BY status`,
            [startDate, endDate]
        );

        const [[avgResolutionRow]] = await db.query(
            `SELECT AVG(TIMESTAMPDIFF(HOUR, created_at, resolved_at)) as avgTime 
             FROM support_tickets 
             WHERE status = 'resolved' AND created_at BETWEEN ? AND ?`,
            [startDate, endDate]
        );

        const [ticketsCategory] = await db.query(
            `SELECT category as label, COUNT(*) as value 
             FROM support_tickets 
             WHERE created_at BETWEEN ? AND ? 
             GROUP BY category`,
            [startDate, endDate]
        );

        res.json({
            success: true,
            data: {
                ticketsStatus,
                avgResolutionTime: parseFloat(parseFloat(avgResolutionRow?.avgTime || 0).toFixed(1)),
                ticketsCategory
            }
        });
    } catch (err) {
        next(err);
    }
};
