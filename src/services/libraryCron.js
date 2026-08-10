const cron = require('node-cron');
const db = require('../config/database');
const NotificationService = require('./notificationService');

const DAY_MS = 24 * 60 * 60 * 1000;
async function runLibraryAutomation() {
    try {
        const overdueResult = await db.queryAsync(`
            UPDATE library_issues
            SET status = 'overdue'
            WHERE status IN ('issued', 'renewed') AND due_date < CURDATE()
        `);
        if (overdueResult.affectedRows > 0) { };

        const overdueIssues = await db.queryAsync(`
            SELECT 
                li.id AS issue_id,
                li.school_id,
                li.user_id,
                li.due_date,
                li.fine_per_day,
                lb.title AS book_title,
                lb.isbn,
                u.first_name,
                u.last_name,
                u.role AS user_role,
                ls.fine_per_day AS setting_fine_per_day,
                ls.due_reminder_days
            FROM library_issues li
            JOIN library_books lb ON lb.id = li.book_id AND lb.school_id = li.school_id
            JOIN users u ON u.id = li.user_id
            JOIN library_settings ls ON ls.school_id = li.school_id
            WHERE li.status = 'overdue'
                AND li.return_date IS NULL
                AND (li.last_notified_at IS NULL OR DATE(li.last_notified_at) < CURDATE())
            ORDER BY li.school_id ASC, li.due_date ASC
        `);

        let notifiedCount = 0;
        let fineUpdateCount = 0;
        let parentNotificationCount = 0;

        for (const issue of overdueIssues) {
            try {
                const dueDate = new Date(issue.due_date);
                const today = new Date();
                const overdueDays = Math.max(0, Math.floor((today - dueDate) / DAY_MS));
                const finePerDay = Number(issue.fine_per_day || issue.setting_fine_per_day || 1);
                const totalFine = parseFloat((overdueDays * finePerDay).toFixed(2));

                if (totalFine > 0) {
                    const existingFine = await db.queryAsync(
                        `SELECT id, status FROM library_fines 
                         WHERE issue_id = ? AND school_id = ? AND fine_type = 'late' LIMIT 1`,
                        [issue.issue_id, issue.school_id]
                    );

                    if (existingFine.length > 0 && !['paid', 'waived'].includes(existingFine[0].status)) {
                        await db.queryAsync(
                            `UPDATE library_fines SET amount = ?, updated_by = NULL WHERE id = ? AND school_id = ?`,
                            [totalFine, existingFine[0].id, issue.school_id]
                        );
                    } else if (existingFine.length === 0) {
                        await db.queryAsync(
                            `INSERT INTO library_fines 
                            (school_id, issue_id, user_id, fine_type, amount, status, created_by, updated_by)
                            VALUES (?, ?, ?, 'late', ?, 'pending', NULL, NULL)`,
                            [issue.school_id, issue.issue_id, issue.user_id, totalFine]
                        );
                    };
                    fineUpdateCount++;
                };

                try {
                    await NotificationService.createAndSend({
                        recipient_id: issue.user_id,
                        recipient_role: issue.user_role,
                        school_id: issue.school_id,
                        title: '📚 Overdue Library Book',
                        message: `Your library book "${issue.book_title}" (ISBN: ${issue.isbn || 'N/A'}) was due on ${dueDate.toLocaleDateString('en-IN')}. You have ${overdueDays} overdue day(s). Current late fine: ₹${totalFine.toFixed(2)}. Please return immediately.`,
                        type: 'warning',
                        category: 'library'
                    });
                    notifiedCount++;
                } catch (notifyErr) {
                    console.error(`[LibraryCron] Failed to notify user ${issue.user_id}:`, notifyErr.message);
                };

                if (issue.user_role === 'student') {
                    try {
                        const parentUsers = await db.queryAsync(
                            `SELECT DISTINCT u.id AS parent_user_id
                            FROM students s
                            JOIN users u ON u.id = s.parent_id AND u.role = 'parent'
                            WHERE s.user_id = ? AND s.school_id = ?
                            LIMIT 2`,
                            [issue.user_id, issue.school_id]
                        );

                        for (const parent of parentUsers) {
                            try {
                                await NotificationService.createAndSend({
                                    recipient_id: parent.parent_user_id,
                                    recipient_role: 'parent',
                                    school_id: issue.school_id,
                                    title: '📚 Overdue Library Book - Action Required',
                                    message: `Your child's library book "${issue.book_title}" was due on ${dueDate.toLocaleDateString('en-IN')}. Overdue: ${overdueDays} day(s). Late fine: ₹${totalFine.toFixed(2)}. Please ensure the book is returned.`,
                                    type: 'warning',
                                    category: 'library'
                                });
                                parentNotificationCount++;
                            } catch (parentNotifyErr) {
                                console.error(`[LibraryCron] Failed to notify parent ${parent.parent_user_id}:`, parentNotifyErr.message);
                            };
                        };
                    } catch (parentQueryErr) {
                        console.error(`[LibraryCron] Failed to query parents for user ${issue.user_id}:`, parentQueryErr.message);
                    };
                };

                await db.queryAsync(
                    `UPDATE library_issues SET last_notified_at = NOW() WHERE id = ?`,
                    [issue.issue_id]
                );
            } catch (issueErr) {
                console.error(`[LibraryCron] Error processing issue ID ${issue.issue_id}:`, issueErr.message);
            };
        };

        const dueSoonIssues = await db.queryAsync(`
            SELECT 
                li.id AS issue_id,
                li.school_id,
                li.user_id,
                li.due_date,
                lb.title AS book_title,
                u.role AS user_role,
                ls.due_reminder_days
            FROM library_issues li
            JOIN library_books lb ON lb.id = li.book_id AND lb.school_id = li.school_id
            JOIN users u ON u.id = li.user_id
            JOIN library_settings ls ON ls.school_id = li.school_id
            WHERE li.status IN ('issued', 'renewed')
              AND DATEDIFF(li.due_date, CURDATE()) BETWEEN 1 AND COALESCE(ls.due_reminder_days, 2)
              AND (li.due_reminder_sent_at IS NULL OR DATE(li.due_reminder_sent_at) < CURDATE())
            ORDER BY li.due_date ASC
        `);

        let dueSoonCount = 0;
        for (const issue of dueSoonIssues) {
            try {
                const dueDate = new Date(issue.due_date);
                const daysLeft = Math.ceil((dueDate - new Date()) / DAY_MS);

                await NotificationService.createAndSend({
                    recipient_id: issue.user_id,
                    recipient_role: issue.user_role,
                    school_id: issue.school_id,
                    title: '⏰ Library Book Due Soon',
                    message: `Reminder: Your library book "${issue.book_title}" is due in ${daysLeft} day(s) on ${dueDate.toLocaleDateString('en-IN')}. Please return it on time to avoid late fines.`,
                    type: 'info',
                    category: 'library'
                });

                await db.queryAsync(
                    `UPDATE library_issues SET due_reminder_sent_at = NOW() WHERE id = ?`,
                    [issue.issue_id]
                );
                dueSoonCount++;
            } catch (dueSoonErr) {
                console.error(`[LibraryCron] Failed to send due-soon reminder for issue ID ${issue.issue_id}:`, dueSoonErr.message);
            };
        };
    } catch (err) {
        console.error('[LibraryCron] Fatal error during library automation run:', err);
    };
};

function initLibraryCron() {
    cron.schedule('0 7 * * *', () => {
        runLibraryAutomation().catch(err => console.error('[LibraryCron] Unhandled error:', err));
    });
};

module.exports = { initLibraryCron, runLibraryAutomation };