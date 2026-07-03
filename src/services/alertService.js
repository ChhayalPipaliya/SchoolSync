const { queryAsync } = require("../config/database");

const alertService = {
  /**
   * Fetches and compiles all active critical alerts
   */
  getCriticalAlerts: async () => {
    const alerts = [];

    // 1. Expiring subscriptions (next 7 days)
    const expiringSql = `
      SELECT s.id, s.school_name, s.subscription_end, p.name as plan_name
      FROM schools s
      JOIN plans p ON s.plan_id = p.id
      WHERE s.subscription_end BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
        AND s.status = 'active'
    `;
    const expiringRows = await queryAsync(expiringSql);
    expiringRows.forEach(row => {
      const daysLeft = Math.max(0, Math.ceil((new Date(row.subscription_end) - new Date()) / (1000 * 60 * 60 * 24)));
      alerts.push({
        id: `expiring-${row.id}`,
        type: 'expiring',
        message: `${row.school_name} subscription is expiring ${daysLeft === 0 ? 'today' : `in ${daysLeft} days`}`,
        detail: `Expires on ${new Date(row.subscription_end).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} (Plan: ${row.plan_name})`,
        priority: 'high'
      });
    });

    // 2. Failed payments (last 24h)
    const failedPaymentsSql = `
      SELECT sp.id, sp.school_id, sp.total_amount, sp.created_at, s.school_name
      FROM subscription_payments sp
      JOIN schools s ON sp.school_id = s.id
      WHERE sp.status = 'failed' 
        AND sp.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `;
    const failedRows = await queryAsync(failedPaymentsSql);
    failedRows.forEach(row => {
      alerts.push({
        id: `payment_failed-${row.id}`,
        type: 'payment_failed',
        message: `Failed payment attempt of ₹${parseFloat(row.total_amount).toLocaleString('en-IN')} for ${row.school_name}`,
        detail: `Attempted on ${new Date(row.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`,
        priority: 'critical'
      });
    });

    // 3. Critical tickets unresolved (>24h)
    const criticalTicketsSql = `
      SELECT t.id, t.subject, t.created_at, s.school_name
      FROM support_tickets t
      JOIN schools s ON t.school_id = s.id
      WHERE t.priority = 'critical' 
        AND t.status = 'open' 
        AND t.created_at <= DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `;
    const ticketRows = await queryAsync(criticalTicketsSql);
    ticketRows.forEach(row => {
      alerts.push({
        id: `critical_ticket-${row.id}`,
        type: 'critical_ticket',
        message: `Critical support ticket unresolved (>24h): "${row.subject}"`,
        detail: `Opened by ${row.school_name} on ${new Date(row.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`,
        priority: 'high'
      });
    });

    // 4. Database backup delayed
    const backupSql = `
      SELECT id, message, created_at 
      FROM system_alerts
      WHERE alert_type = 'backup_delay' AND status = 'active'
    `;
    const backupRows = await queryAsync(backupSql);
    backupRows.forEach(row => {
      alerts.push({
        id: `backup_delay-${row.id}`,
        type: 'backup_delay',
        message: row.message,
        detail: "System backup scheduled every 24 hours has failed or delayed",
        priority: 'high'
      });
    });

    return alerts;
  }
};

module.exports = alertService;
