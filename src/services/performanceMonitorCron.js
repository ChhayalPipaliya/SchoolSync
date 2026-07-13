const cron = require("node-cron");
const { queryAsync, executeAsync } = require("../config/database");

const SLOW_QUERY_THRESHOLD_MINUTES = 15;
const ALERT_TYPE = "DATABASE_SLOW_QUERIES";

async function runSlowQueryMonitorCheck() {
    try {
        const [result] = await queryAsync(`
            SELECT COUNT(*) as count
            FROM slow_queries
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
        `, [SLOW_QUERY_THRESHOLD_MINUTES]);

        const slowCount = result?.count || 0;
        if (slowCount > 0) {
            const existing = await queryAsync(
                `SELECT id FROM system_alerts WHERE alert_type = ? AND status = 'active' LIMIT 1`,
                [ALERT_TYPE]
            );

            if (existing.length === 0) {
                const message = `${slowCount} ${slowCount === 1 ? "query" : "queries"} exceeded the 2-second timeout threshold in the last ${SLOW_QUERY_THRESHOLD_MINUTES} minutes.`;
                await executeAsync(
                    `INSERT INTO system_alerts (alert_type, message, status, created_at) VALUES (?, ?, 'active', NOW())`,
                    [ALERT_TYPE, message]
                );
                console.log(`[PerfMonitor] Created ${ALERT_TYPE} alert: ${message}`);
            } else {
                const message = `${slowCount} ${slowCount === 1 ? "query" : "queries"} exceeded the 2-second timeout threshold in the last ${SLOW_QUERY_THRESHOLD_MINUTES} minutes.`;
                await executeAsync(
                    `UPDATE system_alerts SET message = ?, created_at = NOW() WHERE alert_type = ? AND status = 'active'`,
                    [message, ALERT_TYPE]
                );
                console.log(`[PerfMonitor] Updated ${ALERT_TYPE} alert count to ${slowCount}.`);
            };
        } else {
            const resolved = await executeAsync(
                `UPDATE system_alerts SET status = 'resolved' WHERE alert_type = ? AND status = 'active'`,
                [ALERT_TYPE]
            );
            if (resolved.affectedRows > 0) {
                console.log(`[PerfMonitor] Auto-resolved ${ALERT_TYPE} alert — no slow queries in the last ${SLOW_QUERY_THRESHOLD_MINUTES} minutes.`);
            };
        };
    } catch (err) {
        console.error("[PerfMonitor] Slow query monitor check failed:", err.message);
    };
};

function initPerformanceMonitorCron() {
    cron.schedule("*/15 * * * *", () => {
        runSlowQueryMonitorCheck().catch(err =>
            console.error("[PerfMonitor] Cron error:", err)
        );
    });

    runSlowQueryMonitorCheck().catch(err =>
        console.error("[PerfMonitor] Startup check error:", err)
    );
    // console.log("[PerfMonitor] Performance monitor cron initialized (runs every 15 minutes).");
};

module.exports = { initPerformanceMonitorCron, runSlowQueryMonitorCheck };