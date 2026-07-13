const cron = require("node-cron");
const db = require("../config/database");
const { subscriptionExpiryReminder, subscriptionExpiredNotice } = require("../utils/notificationTemplates");
const { invalidateSubscriptionCache, invalidatePlanCache } = require("../utils/planCache");
const NotificationService = require("./notificationService");

async function queueEmail(toEmail, subject, body) {
    try {
        await db.executeAsync(
            `INSERT INTO email_queue (recipient_email, subject, body_html, status, created_at)
            VALUES (?, ?, ?, 'pending', NOW())`,
            [toEmail, subject, body]
        );
        console.log(`[SubscriptionCron] Email queued for ${toEmail}: ${subject}`);
    } catch (err) {
        console.error(`[SubscriptionCron] Failed to queue email for ${toEmail}:`, err.message);
    };
};

async function createNotification(userId, schoolId, title, message, role = 'school_admin') {
    try {
        await NotificationService.createAndSend({
            recipient_id: userId,
            recipient_role: role,
            school_id: schoolId,
            title,
            message,
            type: "info",
            category: "system",
            action_url: "/schooladmin/subscription"
        });
        console.log(`[SubscriptionCron] Notification created for school ${schoolId}, user ${userId || 'all admins'}`);
    } catch (err) {
        console.error(`[SubscriptionCron] Failed to create notification:`, err.message);
    };
};

async function runScheduledSubscriptionActivationCheck() {
    console.log("[SubscriptionCron] Running scheduled subscription activation check...");
    try {
        const scheduledSubs = await db.queryAsync(`
            SELECT sub.id AS sub_id, sub.school_id, sub.plan_id, sub.plan, sub.start_date, sub.end_date,
                sch.school_name, p.name AS plan_name
            FROM subscriptions sub
            JOIN schools sch ON sub.school_id = sch.id
            JOIN plans p ON sub.plan_id = p.id
            WHERE sub.status = 'scheduled'
                AND sub.payment_status = 'paid'
                AND sub.start_date <= CURRENT_DATE()
            ORDER BY sub.start_date ASC, sub.id ASC
        `).catch(() => []);

        for (const sub of scheduledSubs) {
            const activated = await db.withTransaction(async ({ query, execute }) => {
                const lockedSchools = await query(
                    "SELECT id FROM schools WHERE id = ? FOR UPDATE",
                    [sub.school_id]
                );
                if (!lockedSchools.length) return false;

                const lockedRows = await query(
                    `SELECT id
                    FROM subscriptions
                    WHERE id = ?
                        AND status = 'scheduled'
                        AND payment_status = 'paid'
                        AND start_date <= CURRENT_DATE()
                    FOR UPDATE`,
                    [sub.sub_id]
                );
                if (!lockedRows.length) return false;

                await execute(
                    `UPDATE subscriptions SET status = 'active', updated_at = NOW()
                    WHERE id = ? AND status = 'scheduled' AND payment_status = 'paid'`,
                    [sub.sub_id]
                );

                await execute(
                    `UPDATE subscriptions
                    SET status = 'expired', updated_at = NOW()
                    WHERE school_id = ? AND status IN ('active', 'trial') AND id <> ?`,
                    [sub.school_id, sub.sub_id]
                );

                await execute(
                    `UPDATE schools
                    SET plan_id = ?,
                        current_plan_id = ?,
                        plan = ?,
                        status = 'active',
                        subscription_status = 'active',
                        subscription_start = ?,
                        subscription_end = ?,
                        subscription_started_at = ?,
                        subscription_ends_at = ?,
                        updated_at = NOW()
                    WHERE id = ?`,
                    [sub.plan_id, sub.plan_id, sub.plan, sub.start_date, sub.end_date, sub.start_date, sub.end_date, sub.school_id]
                );
                return true;
            });
            if (!activated) continue;

            await invalidateSubscriptionCache(sub.school_id);
            await invalidatePlanCache(sub.school_id);
            console.log(`[SubscriptionCron] Scheduled subscription #${sub.sub_id} activated for ${sub.school_name}.`);
        };
        console.log("[SubscriptionCron] Scheduled subscription activation check completed.");
    } catch (error) {
        console.error("SubscriptionCron Error in runScheduledSubscriptionActivationCheck:", error);
    };
};

async function runSubscriptionExpiryReminderCheck() {
    console.log("[SubscriptionCron] Running daily expiry reminder check...");
    try {
        const sql = `
            SELECT sub.id as sub_id, sub.school_id, sub.end_date, sub.status as sub_status, sch.school_name, sch.school_email, sch.school_principal_name AS principal_name, p.name as plan_name,
                DATEDIFF(sub.end_date, CURRENT_DATE()) as days_remaining
            FROM subscriptions sub
            JOIN schools sch ON sub.school_id = sch.id
            JOIN plans p ON sub.plan_id = p.id
            WHERE sub.status IN ('active', 'trial')
            AND (
                (sub.status = 'trial' AND DATEDIFF(sub.end_date, CURRENT_DATE()) = 2)
                OR
                (sub.status = 'active' AND DATEDIFF(sub.end_date, CURRENT_DATE()) = 7)
            )
         `;
        const expiringSubs = await db.queryAsync(sql);

        for (const sub of expiringSubs) {
            const daysRemaining = sub.days_remaining;
            const subStatus = sub.sub_status;
            const reminderType = subStatus === 'trial' ? 'trial_2_days' : 'active_7_days';

            const checkSql = `
                SELECT id FROM subscription_reminder_logs
                WHERE school_id = ? AND subscription_id = ? AND reminder_type = ?
                LIMIT 1
            `;
            const checkRows = await db.queryAsync(checkSql, [sub.school_id, sub.sub_id, reminderType]);

            if (checkRows && checkRows.length > 0) {
                console.log(`[SubscriptionCron] Expiry reminder '${reminderType}' already sent for school ${sub.school_name} (Sub ID: ${sub.sub_id})`);
                continue;
            };

            const renewUrl = `${process.env.APP_URL || process.env.BASE_URL}/schooladmin/subscription`;
            const formattedDate = new Date(sub.end_date).toLocaleDateString('en-IN');

            const { subject, html } = subscriptionExpiryReminder({
                schoolName: sub.school_name,
                principalName: sub.principal_name,
                planName: sub.plan_name,
                daysRemaining,
                endDate: formattedDate,
                renewUrl
            });

            if (sub.school_email) {
                await queueEmail(sub.school_email, subject, html);
            };

            const admins = await db.queryAsync(
                "SELECT id, email FROM users WHERE school_id = ? AND role = 'school_admin' AND status = 'active'",
                [sub.school_id]
            );

            for (const admin of admins) {
                await queueEmail(admin.email, subject, html);
                await createNotification(
                    admin.id,
                    sub.school_id,
                    "Subscription Expiring",
                    `Your ${subStatus === 'trial' ? 'trial' : 'subscription'} plan will expire in ${daysRemaining} day(s) on ${formattedDate}. Renew now to avoid disruptions.`,
                    "school_admin"
                );
            };

            const insertSql = `
                INSERT INTO subscription_reminder_logs (school_id, subscription_id, reminder_type, sent_at)
                VALUES (?, ?, ?, NOW())
            `;
            await db.executeAsync(insertSql, [sub.school_id, sub.sub_id, reminderType]);
            console.log(`[SubscriptionCron] Sent and logged expiry reminder '${reminderType}' for school ${sub.school_name}`);
        };
        console.log("[SubscriptionCron] Daily expiry reminder check completed.");
    } catch (error) {
        console.error("SubscriptionCron Error in runSubscriptionExpiryReminderCheck:", error);
    };
};

async function runExpiredSubscriptionCheck() {
    console.log("[SubscriptionCron] Running expired subscription check...");
    try {
        const expiredSchools = await db.queryAsync(`
            SELECT id, school_name, subscription_status
            FROM schools
            WHERE (
                subscription_status = 'trial' AND trial_ends_at IS NOT NULL AND trial_ends_at < NOW()
            ) OR (
                subscription_status = 'active' AND subscription_ends_at IS NOT NULL AND subscription_ends_at < NOW()
            )
        `).catch(() => []);

        for (const school of expiredSchools) {
            const reminderType = school.subscription_status === 'trial' ? 'trial_expired' : 'subscription_expired';
            const message = school.subscription_status === 'trial'
                ? 'Your 7-day full access demo has expired. Please choose a subscription plan to continue using SchoolSync.'
                : 'Your subscription has expired. Please choose a subscription plan to continue using SchoolSync.';

            await db.executeAsync(
                `UPDATE schools
                SET subscription_status = 'expired',
                    status = 'expired',
                    trial_used = GREATEST(COALESCE(trial_used, 0), COALESCE(is_trial_used, 0)),
                    is_trial_used = GREATEST(COALESCE(is_trial_used, 0), COALESCE(trial_used, 0)),
                    updated_at = NOW()
                WHERE id = ?`,
                [school.id]
            );

            const alreadyLogged = await db.queryAsync(
                `SELECT id FROM subscription_reminder_logs
                WHERE school_id = ? AND reminder_type = ?
                LIMIT 1`,
                [school.id, reminderType]
            ).catch(() => []);

            if (!alreadyLogged.length) {
                const admins = await db.queryAsync(
                    "SELECT id, email FROM users WHERE school_id = ? AND role = 'school_admin' AND status = 'active'",
                    [school.id]
                ).catch(() => []);

                for (const admin of admins) {
                    await createNotification(admin.id, school.id, "Subscription Required", message, "school_admin");
                };

                await db.executeAsync(
                    "INSERT INTO subscription_reminder_logs (school_id, subscription_id, reminder_type, sent_at) VALUES (?, NULL, ?, NOW())",
                    [school.id, reminderType]
                ).catch(() => { });
            };

            await invalidateSubscriptionCache(school.id);
            await invalidatePlanCache(school.id);
        };

        const sql = `
            SELECT sub.id as sub_id, sub.school_id, sub.end_date, sch.school_name, sch.school_email, sch.school_principal_name AS principal_name, p.name as plan_name
            FROM subscriptions sub
            JOIN schools sch ON sub.school_id = sch.id
            JOIN plans p ON sub.plan_id = p.id
            WHERE sub.status IN ('active', 'trial')
                AND sub.end_date < CURRENT_DATE()
        `;
        const expiredSubs = await db.queryAsync(sql);

        for (const sub of expiredSubs) {
            await db.withTransaction(async ({ execute }) => {
                await execute(
                    "UPDATE subscriptions SET status = 'expired', updated_at = NOW() WHERE id = ?",
                    [sub.sub_id]
                );

                await execute(
                    `UPDATE schools
                    SET status = 'expired',
                        subscription_status = 'expired',
                        trial_used = GREATEST(COALESCE(trial_used, 0), COALESCE(is_trial_used, 0)),
                        is_trial_used = GREATEST(COALESCE(is_trial_used, 0), COALESCE(trial_used, 0)),
                        updated_at = NOW()
                    WHERE id = ?`,
                    [sub.school_id]
                );

                await execute(
                    `INSERT INTO school_activity_logs
                    (school_id, actor_id, actor_role, action, entity_type, entity_id, description, created_at)
                    VALUES (?, NULL, 'system', 'Subscription Expired', 'subscription', ?, 'Subscription plan has ended on schedule. Status set to expired.', NOW())`,
                    [sub.school_id, sub.sub_id]
                );
            });

            console.log(`[SubscriptionCron] Subscription #${sub.sub_id} for school "${sub.school_name}" marked as expired.`);
            const checkSql = `
                SELECT id FROM subscription_reminder_logs
                WHERE school_id = ? AND subscription_id = ? AND reminder_type = 'expired'
                LIMIT 1
            `;
            const checkRows = await db.queryAsync(checkSql, [sub.school_id, sub.sub_id]);

            if (!checkRows || checkRows.length === 0) {
                const renewUrl = `${process.env.APP_URL}/schooladmin/subscription`;
                const formattedDate = new Date(sub.end_date).toLocaleDateString('en-IN');
                const { subject, html } = subscriptionExpiredNotice({
                    schoolName: sub.school_name,
                    principalName: sub.principal_name,
                    planName: sub.plan_name,
                    expiredDate: formattedDate,
                    renewUrl
                });

                if (sub.school_email) {
                    await queueEmail(sub.school_email, subject, html);
                };

                const admins = await db.queryAsync(
                    "SELECT id, email FROM users WHERE school_id = ? AND role = 'school_admin' AND status = 'active'",
                    [sub.school_id]
                );

                for (const admin of admins) {
                    await queueEmail(admin.email, subject, html);
                    await createNotification(
                        admin.id,
                        sub.school_id,
                        "Subscription Expired",
                        `Your subscription expired on ${formattedDate}. Access to the portal is now restricted.`,
                        "school_admin"
                    );
                };

                const insertSql = `
                    INSERT INTO subscription_reminder_logs (school_id, subscription_id, reminder_type, sent_at)
                    VALUES (?, ?, 'expired', NOW())
                `;
                await db.executeAsync(insertSql, [sub.school_id, sub.sub_id]);
                console.log(`[SubscriptionCron] Sent and logged deactivation alert for expired school ${sub.school_name}`);
            };

            await invalidateSubscriptionCache(sub.school_id);
            await invalidatePlanCache(sub.school_id);
            console.log(`[SubscriptionCron] Invalidated Redis caches for school ${sub.school_name} (ID: ${sub.school_id})`);
        };
        console.log("[SubscriptionCron] Expired subscription check completed.");
    } catch (error) {
        console.error("SubscriptionCron Error in runExpiredSubscriptionCheck:", error);
    };
};

async function runQuotaUsageMonitoringCheck() {
    console.log("[SubscriptionCron] Running daily quota usage monitoring check...");
    try {
        const sql = `
            SELECT sub.id as sub_id, sub.school_id, sch.school_name, p.id as plan_id, p.name as plan_name, p.max_students, p.max_teachers
            FROM subscriptions sub
            JOIN schools sch ON sub.school_id = sch.id
            JOIN plans p ON sub.plan_id = p.id
            WHERE sub.status IN ('active', 'trial')
        `;
        const activeSubs = await db.queryAsync(sql);

        for (const sub of activeSubs) {
            const { school_id, sub_id, school_name, max_students, max_teachers } = sub;
            if (max_students !== null && max_students > 0) {
                const studentCountSql = "SELECT COUNT(*) as count FROM students WHERE school_id = ? AND deleted_at IS NULL";
                const studentRows = await db.queryAsync(studentCountSql, [school_id]);
                const studentCount = studentRows[0] ? studentRows[0].count : 0;

                if (studentCount >= max_students * 0.8) {
                    const reminderType = 'student_quota_80';
                    const checkSql = `
                        SELECT id FROM subscription_reminder_logs
                        WHERE school_id = ? AND subscription_id = ? AND reminder_type = ?
                        LIMIT 1
                    `;
                    const checkRows = await db.queryAsync(checkSql, [school_id, sub_id, reminderType]);

                    if (!checkRows || checkRows.length === 0) {
                        const admins = await db.queryAsync(
                            "SELECT id, email FROM users WHERE school_id = ? AND role = 'school_admin' AND status = 'active'",
                            [school_id]
                        );

                        const title = "Student Limit Warning (80%)";
                        const message = `Your school has used ${studentCount} of ${max_students} student slots (${((studentCount / max_students) * 100).toFixed(0)}%). Please upgrade your plan to prevent service disruption.`;

                        for (const admin of admins) {
                            await createNotification(admin.id, school_id, title, message, 'school_admin');
                        };

                        const insertSql = `
                            INSERT INTO subscription_reminder_logs (school_id, subscription_id, reminder_type, sent_at)
                            VALUES (?, ?, ?, NOW())
                        `;
                        await db.executeAsync(insertSql, [school_id, sub_id, reminderType]);
                        console.log(`[SubscriptionCron] Sent student limit warning to school ${school_name}`);
                    };
                };
            };

            if (max_teachers !== null && max_teachers > 0) {
                const teacherCountSql = `
                    SELECT COUNT(*) as count FROM teachers t 
                    JOIN users u ON t.user_id = u.id 
                    WHERE t.school_id = ? AND u.deleted_at IS NULL
                `;
                const teacherRows = await db.queryAsync(teacherCountSql, [school_id]);
                const teacherCount = teacherRows[0] ? teacherRows[0].count : 0;

                if (teacherCount >= max_teachers * 0.8) {
                    const reminderType = 'teacher_quota_80';
                    const checkSql = `
                        SELECT id FROM subscription_reminder_logs
                        WHERE school_id = ? AND subscription_id = ? AND reminder_type = ?
                        LIMIT 1
                    `;
                    const checkRows = await db.queryAsync(checkSql, [school_id, sub_id, reminderType]);

                    if (!checkRows || checkRows.length === 0) {
                        const admins = await db.queryAsync(
                            "SELECT id, email FROM users WHERE school_id = ? AND role = 'school_admin' AND status = 'active'",
                            [school_id]
                        );

                        const title = "Teacher Limit Warning (80%)";
                        const message = `Your school has used ${teacherCount} of ${max_teachers} teacher slots (${((teacherCount / max_teachers) * 100).toFixed(0)}%). Please upgrade your plan to prevent service disruption.`;

                        for (const admin of admins) {
                            await createNotification(admin.id, school_id, title, message, 'school_admin');
                        };

                        const insertSql = `
                            INSERT INTO subscription_reminder_logs (school_id, subscription_id, reminder_type, sent_at)
                            VALUES (?, ?, ?, NOW())
                        `;
                        await db.executeAsync(insertSql, [school_id, sub_id, reminderType]);
                        console.log(`[SubscriptionCron] Sent teacher limit warning to school ${school_name}`);
                    };
                };
            };
        };
        console.log("[SubscriptionCron] Daily quota usage monitoring check completed.");
    } catch (error) {
        console.error("SubscriptionCron Error in runQuotaUsageMonitoringCheck:", error);
    };
};

function initSubscriptionCron() {
    cron.schedule("15 4 * * *", () => {
        runScheduledSubscriptionActivationCheck().catch(err => console.error(err));
    });

    cron.schedule("30 3 * * *", () => {
        runSubscriptionExpiryReminderCheck().catch(err => console.error(err));
    });

    cron.schedule("30 4 * * *", () => {
        runExpiredSubscriptionCheck().catch(err => console.error(err));
    });

    cron.schedule("30 5 * * *", () => {
        runQuotaUsageMonitoringCheck().catch(err => console.error(err));
    });
};

module.exports = { initSubscriptionCron, runScheduledSubscriptionActivationCheck, runSubscriptionExpiryReminderCheck, runExpiredSubscriptionCheck, runQuotaUsageMonitoringCheck};
