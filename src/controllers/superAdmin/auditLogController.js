const { queryAsync, executeAsync } = require("../../config/database");

const auditLogController = {
    index: async (req, res) => {
        try {
            const stats = await queryAsync(`
                SELECT 
                    (SELECT COUNT(*) FROM schools) as total_schools,
                    (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL) as total_users,
                    (SELECT COUNT(*) FROM support_tickets WHERE status = 'open') as open_tickets,
                    (SELECT COUNT(*) FROM logs WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)) as weekly_logs
            `);

            const recentLogs = await queryAsync(`
                SELECT 
                    sal.*, s.school_name,
                    u.first_name as actor_first_name, u.last_name as actor_last_name
                FROM school_activity_logs sal
                LEFT JOIN schools s ON sal.school_id = s.id
                LEFT JOIN users u ON sal.actor_id = u.id
                ORDER BY sal.created_at DESC
                LIMIT 10
            `);

            res.render("superAdmin/settings/index", {
                title: "Platform Settings - SchoolSync",
                stats: stats[0],
                recentLogs,
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            req.flash("error", "Failed to load settings");
            res.redirect("/superadmin/dashboard");
        };
    },

    auditLogs: async (req, res) => {
        try {
            const { school_id, action, entity_type, from, to, page = 1 } = req.query;
            const limit = 50;
            const offset = (page - 1) * limit;
            let whereClause = "WHERE 1=1";
            let params = [];

            if (school_id) { whereClause += " AND sal.school_id = ?"; params.push(school_id); }
            if (action) { whereClause += " AND sal.action = ?"; params.push(action); }
            if (entity_type) { whereClause += " AND sal.entity_type = ?"; params.push(entity_type); }
            if (from) { whereClause += " AND sal.created_at >= ?"; params.push(from); }
            if (to) { whereClause += " AND sal.created_at <= ?"; params.push(to); }

            const logs = await queryAsync(`
                SELECT 
                    sal.*, s.school_name,
                    u.first_name as actor_first_name, u.last_name as actor_last_name
                FROM school_activity_logs sal
                LEFT JOIN schools s ON sal.school_id = s.id
                LEFT JOIN users u ON sal.actor_id = u.id
                ${whereClause}
                ORDER BY sal.created_at DESC
                LIMIT ? OFFSET ?
            `, [...params, limit, offset]);

            const [totalResult] = await queryAsync(`
                SELECT COUNT(*) as total FROM school_activity_logs sal ${whereClause}
            `, params);

            const schools = await queryAsync("SELECT id, school_name FROM schools");
            const actions = await queryAsync("SELECT DISTINCT action FROM school_activity_logs ORDER BY action");
            const entityTypes = await queryAsync("SELECT DISTINCT entity_type FROM school_activity_logs ORDER BY entity_type");

            res.render("superAdmin/settings/auditLogs", {
                title: "Audit Logs - SchoolSync",
                logs,
                schools,
                actions: actions.map(a => a.action),
                entityTypes: entityTypes.map(e => e.entity_type),
                filters: { school_id, action, entity_type, from, to },
                pagination: {
                    page: parseInt(page),
                    totalPages: Math.ceil(totalResult.total / limit),
                    total: totalResult.total,
                    hasPrev: parseInt(page) > 1,
                    hasNext: parseInt(page) < Math.ceil(totalResult.total / limit)
                },
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            req.flash("error", "Failed to load audit logs");
            res.redirect("/superadmin/settings");
        };
    },

    platformSettings: async (req, res) => {
        try {
            const settings = await queryAsync("SELECT * FROM platform_settings ORDER BY setting_group, setting_key");

            res.render("superAdmin/settings/platform", {
                title: "Platform Settings - SchoolSync",
                settings,
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            req.flash("error", "Failed to load settings");
            res.redirect("/superadmin/settings");
        };
    },

    updateSettings: async (req, res) => {
        try {
            const settings = req.body; 

            for (const [key, value] of Object.entries(settings)) {
                await executeAsync(
                    `INSERT INTO platform_settings (setting_key, setting_value)
                     VALUES (?, ?)
                     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP`,
                    [key, value]
                );
            };

            req.flash("success", "Settings updated");
            res.redirect("/superadmin/settings/platform");
        } catch (error) {
            req.flash("error", "Failed to update settings");
            res.redirect("/superadmin/settings/platform");
        };
    },

    impersonationLogs: async (req, res) => {
        try {
            const logs = await queryAsync(`
                SELECT 
                    ail.*,
                    sa.first_name as super_first_name, sa.last_name as super_last_name,
                    s.school_name,
                    tu.first_name as target_first_name, tu.last_name as target_last_name
                FROM admin_impersonation_logs ail
                JOIN users sa ON ail.super_admin_id = sa.id
                JOIN schools s ON ail.target_school_id = s.id
                JOIN users tu ON ail.target_user_id = tu.id
                ORDER BY ail.started_at DESC
                LIMIT 100
            `);

            res.render("superAdmin/settings/impersonationLogs", {
                title: "Impersonation Logs - SchoolSync",
                logs,
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            req.flash("error", "Failed to load logs");
            res.redirect("/superadmin/settings");
        };
    },

    purgeExpiredLogs: async (req, res) => {
        try {
            const [retentionSetting] = await queryAsync(
                "SELECT setting_value FROM platform_settings WHERE setting_key = 'log_retention_days'"
            );
            const days = retentionSetting ? parseInt(retentionSetting.setting_value) : 0;
            
            if (days <= 0) {
                req.flash("info", "No audit log retention policy is currently active (Keep Forever).");
                return res.redirect("/superadmin/settings");
            };
            
            const resultLogs = await executeAsync(
                "DELETE FROM school_activity_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)",
                [days]
            );
            
            const resultLogins = await executeAsync(
                "DELETE FROM super_admin_login_activities WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)",
                [days]
            );
            
            let resultImpersonation = { affectedRows: 0 };
            try {
                resultImpersonation = await executeAsync(
                    "DELETE FROM admin_impersonation_logs WHERE started_at < DATE_SUB(NOW(), INTERVAL ? DAY)",
                    [days]
                );
            } catch (err) {
                console.warn("admin_impersonation_logs table might not exist or failed to sweep:", err.message);
            };
            
            req.flash("success", `Log retention sweep completed. Purged ${resultLogs.affectedRows} audit logs, ${resultLogins.affectedRows} login records, and ${resultImpersonation.affectedRows} impersonation logs.`);
            res.redirect("/superadmin/settings");
        } catch (error) {
            console.error("Purge Logs Error:", error);
            req.flash("error", "Failed to perform log retention sweep: " + error.message);
            res.redirect("/superadmin/settings");
        };
    },

    performanceMetrics: async (req, res) => {
        try {
            const slowQueries = await queryAsync(`
                SELECT * FROM slow_queries 
                ORDER BY created_at DESC 
                LIMIT 50
            `);

            const apiStats = await queryAsync(`
                SELECT 
                    endpoint, method, 
                    COUNT(*) as call_count, 
                    ROUND(AVG(response_time_ms), 2) as avg_response_time, 
                    MAX(response_time_ms) as max_response_time,
                    SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as error_count
                FROM api_metrics
                GROUP BY endpoint, method
                ORDER BY avg_response_time DESC
                LIMIT 50
            `);

            const statusCodes = await queryAsync(`
                SELECT status_code, COUNT(*) as count 
                FROM api_metrics 
                GROUP BY status_code
                ORDER BY status_code ASC
            `);

            const [overall] = await queryAsync(`
                SELECT COUNT(*) as total_calls, ROUND(AVG(response_time_ms), 2) as avg_time
                FROM api_metrics
            `);

            res.render("superAdmin/settings/performance", {
                title: "Performance Monitoring - SchoolSync",
                slowQueries,
                apiStats,
                statusCodes,
                overall: overall || { total_calls: 0, avg_time: 0 },
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            console.error("Performance Page Error:", error);
            req.flash("error", "Failed to load performance metrics");
            res.redirect("/superadmin/settings");
        };
    },

    emailQueue: async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = 50;
            const offset = (page - 1) * limit;

            const emails = await queryAsync(`
                SELECT * FROM email_queue
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
            `, [limit, offset]);

            const [totalResult] = await queryAsync(`
                SELECT COUNT(*) as total FROM email_queue
            `);

            const stats = await queryAsync(`
                SELECT 
                    COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as pending_count,
                    COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed_count,
                    COALESCE(SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END), 0) as sent_count
                FROM email_queue
            `);

            res.render("superAdmin/settings/emails", {
                title: "Email Queue Monitor - SchoolSync",
                emails,
                stats: stats[0] || { pending_count: 0, failed_count: 0, sent_count: 0 },
                pagination: {
                    page,
                    totalPages: Math.ceil((totalResult?.total || 0) / limit) || 1,
                    total: totalResult?.total || 0,
                    hasPrev: page > 1,
                    hasNext: page < Math.ceil((totalResult?.total || 0) / limit)
                },
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            console.error("Email Queue Page Error:", error);
            req.flash("error", "Failed to load email queue");
            res.redirect("/superadmin/settings");
        };
    },

    retryEmails: async (req, res) => {
        try {
            await executeAsync(`
                UPDATE email_queue 
                SET status = 'pending', attempts = 0, last_error = NULL 
                WHERE status = 'failed'
            `);
            req.flash("success", "Failed emails have been queued for retry.");
            res.redirect("/superadmin/settings/emails");
        } catch (error) {
            console.error("Retry Emails Error:", error);
            req.flash("error", "Failed to retry emails");
            res.redirect("/superadmin/settings/emails");
        };
    },

    purgeEmails: async (req, res) => {
        try {
            await executeAsync(`
                DELETE FROM email_queue WHERE status = 'sent' OR status = 'failed'
            `);
            req.flash("success", "Processed emails successfully cleared from queue.");
            res.redirect("/superadmin/settings/emails");
        } catch (error) {
            console.error("Purge Emails Error:", error);
            req.flash("error", "Failed to purge emails");
            res.redirect("/superadmin/settings/emails");
        };
    }
};

module.exports = auditLogController;