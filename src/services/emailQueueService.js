const cron = require("node-cron");
const nodemailer = require("nodemailer");
const NotificationModel = require("../models/notificationModel");

const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

const sendMailAsync = (mailOptions) => {
    return Promise.resolve({ messageId: 'disabled' });
};

const processEmailQueue = async () => {
    return;
};

const runArchiveJob = async () => {
    try {
        const count = await NotificationModel.archiveOldNotifications();
    } catch (err) {
        console.error("[ArchiveWorker] Archiver error:", err);
    };
};

const checkFeeDueReminders = async () => {
    try {
        const { queryAsync } = require("../config/database");
        const NotificationService = require("./notificationService");
        const templates = require("../utils/notificationTemplates");
        const pending = await queryAsync(`
            SELECT sf.id, sf.student_id, sf.school_id, fs.fee_name, fs.due_date, fs.amount, u.id as user_id 
            FROM student_fees sf
            JOIN fee_structures fs ON sf.fee_structure_id = fs.id
            JOIN students s ON sf.student_id = s.id
            JOIN users u ON s.user_id = u.id
            WHERE sf.status = 'pending' AND fs.due_date = DATE_ADD(CURDATE(), INTERVAL 3 DAY)
        `);

        for (const item of pending) {
            await NotificationService.createAndSend({
                recipient_id: item.user_id,
                recipient_role: "student",
                school_id: item.school_id,
                created_by: null,
                ...templates.feeDueReminder(item.fee_name, item.due_date, item.amount)
            }).catch(err => console.error(`[ReminderWorker] Fee due reminder failed for user ${item.user_id}:`, err.message));
        };
    } catch (err) {
        console.error("[ReminderWorker] Fee reminders check failed:", err);
    };
};

const checkBookDueReminders = async () => {
    try {
        const { queryAsync } = require("../config/database");
        const NotificationService = require("./notificationService");
        const templates = require("../utils/notificationTemplates");
        const issues = await queryAsync(`
            SELECT li.id, li.user_id, li.school_id, b.title, u.role 
            FROM library_issues li 
            JOIN library_books b ON li.book_id = b.id 
            JOIN users u ON li.user_id = u.id 
            WHERE li.status IN ('issued', 'renewed') AND li.due_date = DATE_ADD(CURDATE(), INTERVAL 1 DAY)
        `);

        for (const item of issues) {
            await NotificationService.createAndSend({
                recipient_id: item.user_id,
                recipient_role: item.role,
                school_id: item.school_id,
                created_by: null,
                ...templates.bookDueReminder(item.title, new Date(Date.now() + 24 * 60 * 60 * 1000))
            }).catch(err => console.error(`[ReminderWorker] Book due reminder failed for user ${item.user_id}:`, err.message));
        };
    } catch (err) {
        console.error("[ReminderWorker] Library book reminders check failed:", err);
    };
};

const initCronJobs = () => {
    cron.schedule("*/5 * * * *", () => {
        processEmailQueue();
    });

    cron.schedule("0 0 * * *", () => {
        runArchiveJob();
        checkFeeDueReminders();
        checkBookDueReminders();

        const billingService = require("./billingService");
        billingService.runDailyBillingSweep().catch(err => console.error("Daily Billing Sweep Failed:", err));
        billingService.runOverduePaymentSweep().catch(err => console.error("Overdue Payment Sweep Failed:", err));
    });
};

module.exports = { initCronJobs, processEmailQueue, runArchiveJob, checkFeeDueReminders, checkBookDueReminders };