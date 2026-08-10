const cron = require('node-cron');
const db = require('../config/database');
const { calculateStudentAttendanceStats } = require('./attendanceEngineService');
const NotificationService = require('./notificationService');

async function runAttendanceDefaulterAutomation() {
    try {
        const [schools] = await db.query(`SELECT id FROM schools WHERE status = 'active' OR status IS NULL`);
        const today = new Date();
        const startDateStr = `${today.getFullYear()}-01-01`;
        const endDateStr = today.toISOString().slice(0, 10);

        let notifiedParentsCount = 0;
        let totalDefaultersFound = 0;

        for (const school of schools) {
            try {
                const [students] = await db.query(
                    `SELECT s.id, s.user_id, s.parent_id, u.first_name, u.last_name 
                     FROM students s 
                     JOIN users u ON u.id = s.user_id 
                     WHERE s.school_id = ? AND s.deleted_at IS NULL`,
                    [school.id]
                );

                for (const student of students) {
                    try {
                        const stats = await calculateStudentAttendanceStats(school.id, student.id, startDateStr, endDateStr);
                        if (!stats || stats.totalWorkingDays <= 0 || stats.percentage >= 75) {
                            continue;
                        };

                        totalDefaultersFound++;
                        if (!student.parent_id) continue;
                        const [recentNotifs] = await db.query(
                            `SELECT id FROM notifications 
                             WHERE recipient_id = ? AND recipient_role = 'parent' AND category = 'attendance_defaulter' 
                               AND created_at > DATE_SUB(NOW(), INTERVAL 7 DAY) 
                             LIMIT 1`,
                            [student.parent_id]
                        );

                        if (recentNotifs && recentNotifs.length > 0) {
                            continue;
                        };

                        const studentName = `${student.first_name || ''} ${student.last_name || ''}`.trim() || 'Student';
                        const absentDays = Math.max(0, stats.totalWorkingDays - stats.presentDays);
                        await NotificationService.createAndSend({
                            recipient_id: student.parent_id,
                            recipient_role: 'parent',
                            school_id: school.id,
                            title: '⚠️ Low Attendance Warning',
                            message: `Attendance Alert: Your child ${studentName}'s attendance is currently at ${stats.percentage.toFixed(1)}% (${stats.presentDays} present, ${absentDays} absent out of ${stats.totalWorkingDays} working days), which is below the 75% requirement.`,
                            type: 'warning',
                            category: 'attendance_defaulter'
                        });

                        notifiedParentsCount++;
                    } catch (stErr) {
                        console.error(`[AttendanceDefaulterCron] Error evaluating student ID ${student.id}:`, stErr.message);
                    };
                };
            } catch (schoolErr) {
                console.error(`[AttendanceDefaulterCron] Error processing school ID ${school.id}:`, schoolErr.message);
            };
        };
    } catch (err) {
        console.error('[AttendanceDefaulterCron] Fatal error during attendance defaulter automation run:', err);
    };
};

function initAttendanceDefaulterCron() {
    cron.schedule('0 8 * * 1', () => {
        runAttendanceDefaulterAutomation().catch(err => console.error('[AttendanceDefaulterCron] Unhandled error:', err));
    });
};

module.exports = { runAttendanceDefaulterAutomation, initAttendanceDefaulterCron };