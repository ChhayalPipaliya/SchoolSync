const cron = require('node-cron');
const db = require('../config/database');
const NotificationService = require('./notificationService');

async function runSalaryGenerationAutomation(force = false) {
    const today = new Date();
    if (!force && today.getDate() !== 1) {
        console.log('[SalaryGenerationCron] Skipping run — today is not the 1st of the month.');
        return;
    };

    console.log('[SalaryGenerationCron] Starting salary generation automation run...');

    try {
        const [schools] = await db.query(`SELECT id FROM schools WHERE status = 'active' OR status IS NULL`);
        const salaryMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

        let generatedSchoolsCount = 0;
        let totalSalariesCreated = 0;

        for (const school of schools) {
            try {
                const [[existing]] = await db.query(
                    `SELECT COUNT(*) as count FROM monthly_salaries WHERE school_id = ? AND salary_month = ?`,
                    [school.id, salaryMonth]
                );

                if (existing && existing.count > 0) {
                    console.log(`[SalaryGenerationCron] Salaries already generated for school ID ${school.id} for month ${salaryMonth}. Skipping.`);
                    continue;
                };

                const [structures] = await db.query(
                    `SELECT ss.user_id, ss.amount, u.role 
                    FROM salary_structures ss 
                    JOIN users u ON ss.user_id = u.id 
                    WHERE ss.school_id = ? AND u.deleted_at IS NULL AND u.status = 'active' AND u.role IN ('teacher','driver','librarian')`,
                    [school.id]
                );

                if (!structures || structures.length === 0) {
                    console.log(`[SalaryGenerationCron] No active salary structures found for school ID ${school.id}. Skipping.`);
                    continue;
                };

                await db.withTransaction(async (tx) => {
                    for (const struct of structures) {
                        await tx.query(
                            `INSERT INTO monthly_salaries (school_id, user_id, salary_month, total_amount, paid_amount, status) 
                            VALUES (?, ?, ?, ?, 0.00, 'pending')`,
                            [school.id, struct.user_id, salaryMonth, struct.amount]
                        );
                    };
                });

                generatedSchoolsCount++;
                totalSalariesCreated += structures.length;

                for (const struct of structures) {
                    try {
                        await NotificationService.createAndSend({
                            recipient_id: struct.user_id,
                            recipient_role: struct.role || 'teacher',
                            school_id: school.id,
                            title: '💰 Salary Generated',
                            message: `Your salary slip for ${salaryMonth} has been generated. Total Amount: ₹${parseFloat(struct.amount || 0).toFixed(2)}.`,
                            type: 'info',
                            category: 'salary'
                        });
                    } catch (userNotifErr) {
                        console.error(`[SalaryGenerationCron] Failed to notify user ${struct.user_id}:`, userNotifErr.message);
                    };
                };

                try {
                    const [adminUsers] = await db.query(
                        `SELECT id, role FROM users WHERE school_id = ? AND (role = 'school_admin' || role = 'admin') AND status = 'active'`,
                        [school.id]
                    );

                    for (const admin of adminUsers) {
                        try {
                            await NotificationService.createAndSend({
                                recipient_id: admin.id,
                                recipient_role: admin.role || 'school_admin',
                                school_id: school.id,
                                title: '💰 Monthly Salaries Generated',
                                message: `Monthly salaries for ${salaryMonth} have been successfully generated for ${structures.length} staff member(s).`,
                                type: 'info',
                                category: 'salary'
                            });
                        } catch (adminNotifErr) {
                            console.error(`[SalaryGenerationCron] Failed to notify admin user ${admin.id}:`, adminNotifErr.message);
                        };
                    };
                } catch (adminQueryErr) {
                    console.error(`[SalaryGenerationCron] Failed to query admins for school ${school.id}:`, adminQueryErr.message);
                };

            } catch (schoolErr) {
                console.error(`[SalaryGenerationCron] Error processing school ID ${school.id}:`, schoolErr.message);
            };
        };

        console.log(`[SalaryGenerationCron] Run complete. Month: ${salaryMonth} | Schools processed: ${generatedSchoolsCount} | Total salaries generated: ${totalSalariesCreated}`);

    } catch (err) {
        console.error('[SalaryGenerationCron] Fatal error during salary generation automation run:', err);
    };
};

function initSalaryGenerationCron() {
    cron.schedule('0 6 1 * *', () => {
        runSalaryGenerationAutomation().catch(err => console.error('[SalaryGenerationCron] Unhandled error:', err));
    });
};

module.exports = { runSalaryGenerationAutomation, initSalaryGenerationCron };