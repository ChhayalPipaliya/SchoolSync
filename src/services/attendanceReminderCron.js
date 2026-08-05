const cron = require('node-cron');
const db = require('../config/database');
const { calculateAttendanceCompletion } = require('./attendanceEngineService');
const NotificationService = require('./notificationService');

async function sendAttendanceReminders(isEscalation = false) {
    try {
        const [schools] = await db.query(`SELECT id, school_name FROM schools WHERE status = 'active' OR status IS NULL`);

        for (const school of schools) {
            const { isWorkingDay, pendingClasses } = await calculateAttendanceCompletion(school.id);
            if (!isWorkingDay || !pendingClasses.length) continue;

            if (isEscalation) {
                const [adminUsers] = await db.query(
                    `SELECT id, role FROM users WHERE school_id = ? AND (role = 'school_admin' OR role = 'admin') AND status = 'active'`,
                    [school.id]
                ).catch(() => [[]]);

                for (const pc of pendingClasses) {
                    const title = `🚨 High Priority: Attendance Escalation`;
                    const message = `Attendance for ${pc.className} (Teacher: ${pc.teacherName}) is PENDING. Please review immediately.`;

                    for (const admin of adminUsers) {
                        NotificationService.createAndSend({
                            recipient_id: admin.id,
                            recipient_role: admin.role || 'school_admin',
                            school_id: school.id,
                            title,
                            message,
                            type: 'attendance_escalation',
                            category: 'general',
                            action_url: '/schooladmin/attendance/mark'
                        }).catch(e => console.error('[Attendance Escalation Cron Notification Error]', e.message));
                    };
                };
            } else {
                for (const pc of pendingClasses) {
                    if (!pc.teacherId) continue;

                    const [[teacher]] = await db.query(
                        `SELECT user_id FROM teachers WHERE id = ? AND school_id = ? LIMIT 1`,
                        [pc.teacherId, school.id]
                    );

                    if (teacher && teacher.user_id) {
                        const title = `⚠️ Attendance Pending`;
                        const message = `Attendance for ${pc.className} has not been marked today. Please mark it as soon as possible.`;

                        NotificationService.createAndSend({
                            recipient_id: teacher.user_id,
                            recipient_role: 'teacher',
                            school_id: school.id,
                            title,
                            message,
                            type: 'attendance_reminder',
                            category: 'general',
                            action_url: '/teacher/attendance'
                        }).catch(e => console.error('[Attendance Reminder Cron Notification Error]', e.message));
                    };
                };
            };
        };
    } catch (err) {
        console.error('[Attendance Reminder Cron Error]', err);
    };
};

function initAttendanceReminderCron() {
    cron.schedule('30 9 * * 1-6', () => {
        sendAttendanceReminders(false).catch(err => console.error('[Attendance Reminder Cron Error]', err));
    });
    cron.schedule('0 11 * * 1-6', () => {
        sendAttendanceReminders(false).catch(err => console.error('[Attendance Reminder Cron Error]', err));
    });
    cron.schedule('0 13 * * 1-6', () => {
        sendAttendanceReminders(true).catch(err => console.error('[Attendance Escalation Cron Error]', err));
    });
};

module.exports = { sendAttendanceReminders, initAttendanceReminderCron };