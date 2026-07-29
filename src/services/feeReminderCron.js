const cron = require('node-cron');
const db = require('../config/database');
const NotificationService = require('./notificationService');

async function runFeeReminderAutomation() {
    console.log('[FeeReminderCron] Starting fee reminder automation run...');

    try {
        const [dueSoonFees] = await db.query(`
            SELECT sf.id, sf.school_id, sf.student_id, sf.status, fs.fee_name, 
            fs.due_date, sf.amount, sf.paid_amount, s.user_id AS student_user_id, 
            s.parent_id, u.first_name, u.last_name
            FROM student_fees sf
            JOIN fee_structures fs ON sf.fee_structure_id = fs.id
            JOIN students s ON sf.student_id = s.id
            JOIN users u ON u.id = s.user_id
            WHERE sf.status IN ('pending','partial') AND s.deleted_at IS NULL
              AND DATEDIFF(fs.due_date, CURDATE()) BETWEEN 0 AND 3
              AND (sf.last_reminder_sent_at IS NULL OR DATE(sf.last_reminder_sent_at) < CURDATE())
        `);

        const [overdueFees] = await db.query(`
            SELECT sf.id, sf.school_id, sf.student_id, sf.status, fs.fee_name, 
            fs.due_date, sf.amount, sf.paid_amount, s.user_id AS student_user_id, 
            s.parent_id, u.first_name, u.last_name
            FROM student_fees sf
            JOIN fee_structures fs ON sf.fee_structure_id = fs.id
            JOIN students s ON sf.student_id = s.id
            JOIN users u ON u.id = s.user_id
            WHERE sf.status IN ('pending','partial') AND s.deleted_at IS NULL
              AND DATEDIFF(CURDATE(), fs.due_date) > 0
              AND (sf.last_reminder_sent_at IS NULL OR DATE(sf.last_reminder_sent_at) < CURDATE())
        `);

        let dueSoonCount = 0;
        let overdueCount = 0;

        for (const sf of dueSoonFees) {
            try {
                const pendingAmount = parseFloat(sf.amount || 0) - parseFloat(sf.paid_amount || 0);
                const dueDateStr = sf.due_date ? new Date(sf.due_date).toLocaleDateString('en-IN') : 'N/A';
                const studentName = `${sf.first_name || ''} ${sf.last_name || ''}`.trim() || 'Student';

                try {
                    await NotificationService.createAndSend({
                        recipient_id: sf.student_user_id,
                        recipient_role: 'student',
                        school_id: sf.school_id,
                        title: '💳 Fee Due Soon',
                        message: `Reminder: Your fee "${sf.fee_name}" of ₹${pendingAmount.toFixed(2)} is due on ${dueDateStr}. Please pay on time.`,
                        type: 'warning',
                        category: 'fees'
                    });
                } catch (stErr) {
                    console.error(`[FeeReminderCron] Failed to notify student user ${sf.student_user_id}:`, stErr.message);
                };

                if (sf.parent_id) {
                    try {
                        const [[parent]] = await db.query(
                            `SELECT id FROM users WHERE id = ? AND role = 'parent' AND deleted_at IS NULL LIMIT 1`,
                            [sf.parent_id]
                        );
                        if (parent) {
                            await NotificationService.createAndSend({
                                recipient_id: parent.id,
                                recipient_role: 'parent',
                                school_id: sf.school_id,
                                title: '💳 Student Fee Due Soon',
                                message: `Fee "${sf.fee_name}" for ${studentName} of ₹${pendingAmount.toFixed(2)} is due on ${dueDateStr}.`,
                                type: 'warning',
                                category: 'fees'
                            });
                        };
                    } catch (pErr) {
                        console.error(`[FeeReminderCron] Failed to notify parent user ${sf.parent_id}:`, pErr.message);
                    };
                };

                await db.query(`UPDATE student_fees SET last_reminder_sent_at = NOW() WHERE id = ?`, [sf.id]);
                dueSoonCount++;
            } catch (itemErr) {
                console.error(`[FeeReminderCron] Error processing due-soon fee ID ${sf.id}:`, itemErr.message);
            };
        };

        for (const sf of overdueFees) {
            try {
                const pendingAmount = parseFloat(sf.amount || 0) - parseFloat(sf.paid_amount || 0);
                const dueDate = new Date(sf.due_date);
                const dueDateStr = sf.due_date ? dueDate.toLocaleDateString('en-IN') : 'N/A';
                const daysOverdue = Math.max(1, Math.floor((new Date() - dueDate) / (24 * 60 * 60 * 1000)));
                const studentName = `${sf.first_name || ''} ${sf.last_name || ''}`.trim() || 'Student';

                try {
                    await NotificationService.createAndSend({
                        recipient_id: sf.student_user_id,
                        recipient_role: 'student',
                        school_id: sf.school_id,
                        title: '🚨 Fee Overdue Alert',
                        message: `Your fee "${sf.fee_name}" of ₹${pendingAmount.toFixed(2)} is ${daysOverdue} day(s) overdue (due date: ${dueDateStr}). Please clear pending dues immediately.`,
                        type: 'warning',
                        category: 'fees'
                    });
                } catch (stErr) {
                    console.error(`[FeeReminderCron] Failed to notify student user ${sf.student_user_id}:`, stErr.message);
                };

                if (sf.parent_id) {
                    try {
                        const [[parent]] = await db.query(
                            `SELECT id FROM users WHERE id = ? AND role = 'parent' AND deleted_at IS NULL LIMIT 1`,
                            [sf.parent_id]
                        );
                        if (parent) {
                            await NotificationService.createAndSend({
                                recipient_id: parent.id,
                                recipient_role: 'parent',
                                school_id: sf.school_id,
                                title: '🚨 Student Fee Overdue Alert',
                                message: `Fee "${sf.fee_name}" for ${studentName} of ₹${pendingAmount.toFixed(2)} is ${daysOverdue} day(s) overdue (due date: ${dueDateStr}). Please clear pending dues immediately.`,
                                type: 'warning',
                                category: 'fees'
                            });
                        };
                    } catch (pErr) {
                        console.error(`[FeeReminderCron] Failed to notify parent user ${sf.parent_id}:`, pErr.message);
                    };
                };

                await db.query(`UPDATE student_fees SET last_reminder_sent_at = NOW() WHERE id = ?`, [sf.id]);
                overdueCount++;
            } catch (itemErr) {
                console.error(`[FeeReminderCron] Error processing overdue fee ID ${sf.id}:`, itemErr.message);
            };
        };

        console.log(`[FeeReminderCron] Run complete. Due-soon reminders: ${dueSoonCount} | Overdue reminders: ${overdueCount}`);
    } catch (err) {
        console.error('[FeeReminderCron] Fatal error during fee reminder automation run:', err);
    };
};

function initFeeReminderCron() {
    cron.schedule('0 8 * * *', () => {
        runFeeReminderAutomation().catch(err => console.error('[FeeReminderCron] Unhandled error:', err));
    });
};

module.exports = { runFeeReminderAutomation, initFeeReminderCron };