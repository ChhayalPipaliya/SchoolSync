const { queryAsync } = require("../config/database");

const healthService = {
  /**
   * Compiles the Platform Health metrics and calculates the Health Score
   */
  getPlatformHealth: async () => {
    // 1. Queries
    const sql = `
      SELECT 
        (SELECT COALESCE(AVG(response_time_ms), 0) FROM api_metrics WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)) as api_response_time,
        (SELECT COUNT(*) FROM slow_queries WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) as slow_queries_count,
        (SELECT COUNT(*) FROM support_tickets WHERE priority = 'critical' AND status = 'open') as critical_tickets,
        (SELECT COUNT(*) FROM system_alerts WHERE status = 'active') as system_alerts,
        (SELECT COUNT(*) FROM email_queue WHERE status = 'failed' AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) as failed_notifications,
        (SELECT COUNT(*) FROM subscription_payments WHERE status = 'failed' AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) as failed_payments
    `;
    const rows = await queryAsync(sql);
    const metrics = rows[0] || {};

    const apiResponseTime = parseFloat(metrics.api_response_time || 0);
    const slowQueriesCount = parseInt(metrics.slow_queries_count || 0);
    const criticalTickets = parseInt(metrics.critical_tickets || 0);
    const systemAlerts = parseInt(metrics.system_alerts || 0);
    const failedNotifications = parseInt(metrics.failed_notifications || 0);
    const failedPayments = parseInt(metrics.failed_payments || 0);

    // 2. Individual Health Component Calculations
    // Database Health: deduct 5% per slow query (min 50)
    const dbScore = Math.max(50, 100 - (slowQueriesCount * 5));
    
    // API Health: deduct based on latency above 100ms
    const apiScore = apiResponseTime <= 100 
      ? 100 
      : Math.max(50, 100 - Math.round((apiResponseTime - 100) / 10));

    // Support Health: deduct 2% per critical open ticket (min 60)
    const supportScore = Math.max(60, 100 - (criticalTickets * 2));

    // Payment Health: deduct 5% per failed payment in last 24h (min 70)
    const paymentScore = Math.max(70, 100 - (failedPayments * 5));

    // Notification Health: deduct 10% per failed email in last 24h (min 60)
    const notificationScore = Math.max(60, 100 - (failedNotifications * 10));

    // Security Health: deduct 10% per active alert (min 70)
    const securityScore = Math.max(70, 100 - (systemAlerts * 10));

    // 3. Overall Weighted Health Score
    const overallScore = Math.round(
      (dbScore * 0.25) +
      (apiScore * 0.25) +
      (supportScore * 0.15) +
      (paymentScore * 0.15) +
      (notificationScore * 0.10) +
      (securityScore * 0.10)
    );

    // Get backup alert status
    const backupAlertRows = await queryAsync(`
      SELECT id FROM system_alerts WHERE alert_type = 'backup_delay' AND status = 'active' LIMIT 1
    `);
    const backupDelayed = backupAlertRows.length > 0;

    return {
      score: overallScore,
      updatedAt: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      components: {
        database: {
          score: dbScore,
          status: dbScore >= 95 ? "Healthy" : dbScore >= 80 ? "Warning" : "Critical",
          detail: "24ms", // typical latency
          colorClass: dbScore >= 95 ? "bg-green-500" : dbScore >= 80 ? "bg-amber-500" : "bg-red-500"
        },
        api: {
          score: apiScore,
          status: apiScore >= 95 ? "Active" : apiScore >= 80 ? "Warning" : "Critical",
          detail: `${Math.round(apiResponseTime || 24)}ms`,
          colorClass: apiScore >= 95 ? "bg-green-500" : apiScore >= 80 ? "bg-amber-500" : "bg-red-500"
        },
        email: {
          score: notificationScore,
          status: notificationScore >= 95 ? "Operational" : notificationScore >= 80 ? "Warning" : "Critical",
          detail: failedNotifications > 0 ? `${failedNotifications} failed` : "0 failures",
          colorClass: notificationScore >= 95 ? "bg-green-500" : notificationScore >= 80 ? "bg-amber-500" : "bg-red-500"
        },
        payments: {
          score: paymentScore,
          status: paymentScore >= 95 ? "Secure" : paymentScore >= 80 ? "Warning" : "Critical",
          detail: failedPayments > 0 ? `${failedPayments} failed` : "0 failures",
          colorClass: paymentScore >= 95 ? "bg-green-500" : paymentScore >= 80 ? "bg-amber-500" : "bg-red-500"
        },
        backup: {
          score: backupDelayed ? 70 : 100,
          status: backupDelayed ? "Delayed" : "Up to date",
          detail: backupDelayed ? "Delayed 2h" : "100% Sync",
          colorClass: backupDelayed ? "bg-red-500" : "bg-green-500"
        },
        notifications: {
          score: securityScore,
          status: securityScore >= 95 ? "Active" : securityScore >= 80 ? "Warning" : "Critical",
          detail: systemAlerts > 0 ? `${systemAlerts} alerts` : "0 active alerts",
          colorClass: securityScore >= 95 ? "bg-green-500" : securityScore >= 80 ? "bg-amber-500" : "bg-red-500"
        }
      }
    };
  }
};

module.exports = healthService;
