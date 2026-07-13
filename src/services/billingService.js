const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const nodemailer = require("nodemailer");
const { queryAsync, executeAsync, withTransaction } = require("../config/database");
const templates = require("../utils/notificationTemplates");
const NotificationModel = require("../models/notificationModel");
const NotificationService = require("./notificationService");
const { addCycleToDate, addDays, toSqlDate } = require("../utils/subscriptionPeriods");

function normalizePlanKey(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
};

function isTrialRenewalCandidate(subscription, plan) {
    return [subscription?.status, subscription?.plan, plan?.plan_key, plan?.slug, plan?.name]
        .map(normalizePlanKey)
        .some((key) => key === "trial" || key === "free_trial" || key === "demo");
};

function getAutoRenewalPeriod(currentEndDate, billingCycle) {
    return {
        startDate: addDays(currentEndDate, 1),
        endDate: addCycleToDate(currentEndDate, billingCycle)
    };
};

async function removeGeneratedInvoice(pdfPath) {
    if (!pdfPath) return;
    const filePath = path.resolve(
        __dirname,
        "../../storage/uploads/invoices",
        path.basename(String(pdfPath))
    );
    try {
        await fs.promises.unlink(filePath);
    } catch (error) {
        if (error.code !== "ENOENT") {
            console.error(`[Billing] Failed to remove invoice PDF ${filePath}:`, error.message);
        };
    };
};

const getTransporter = () => {
    return nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
};

const billingService = {
    generatePDFInvoice: async (invoiceDetails, school) => {
        return new Promise((resolve, reject) => {
            let filePath = null;
            let settled = false;
            const rejectAndCleanup = (error) => {
                if (settled) return;
                settled = true;
                removeGeneratedInvoice(filePath).finally(() => reject(error));
            };

            try {
                const doc = new PDFDocument({ margin: 50 });
                const fileName = `invoice_${invoiceDetails.invoice_no}.pdf`;
                const uploadDir = path.resolve(__dirname, "../../storage/uploads/invoices");

                if (!fs.existsSync(uploadDir)) {
                    fs.mkdirSync(uploadDir, { recursive: true });
                };

                filePath = path.join(uploadDir, fileName);
                const writeStream = fs.createWriteStream(filePath);

                doc.pipe(writeStream);
                doc.fillColor("#1E3A8A").font("Helvetica-Bold").fontSize(26).text("SchoolSync", 50, 50);
                doc.fillColor("#4B5563").font("Helvetica").fontSize(10).text("Comprehensive Multi-Tenant SMS", 50, 80);
                doc.fillColor("#1F2937").font("Helvetica-Bold").fontSize(18).text("INVOICE", 400, 50, { align: "right" });
                doc.fillColor("#6B7280").font("Helvetica").fontSize(9).text(`Invoice No: ${invoiceDetails.invoice_no}`, 400, 75, { align: "right" });
                doc.text(`Date: ${new Date(invoiceDetails.billing_date).toLocaleDateString()}`, 400, 90, { align: "right" });
                doc.text(`Due Date: ${new Date(invoiceDetails.due_date).toLocaleDateString()}`, 400, 105, { align: "right" });
                doc.moveDown(3);
                doc.strokeColor("#E5E7EB").lineWidth(1).moveTo(50, 130).lineTo(550, 130).stroke();
                doc.fillColor("#1F2937").font("Helvetica-Bold").fontSize(11).text("Billed To:", 50, 150);
                doc.fillColor("#4B5563").font("Helvetica").fontSize(10)
                    .text(school.school_name, 50, 165)
                    .text(`Email: ${school.school_email || "N/A"}`, 50, 180)
                    .text(`Phone: ${school.school_phone || "N/A"}`, 50, 195)
                    .text(`Address: ${school.school_address || "N/A"}, ${school.city || ""}`, 50, 210);

                doc.fillColor("#1F2937").font("Helvetica-Bold").fontSize(11).text("Service Provider:", 350, 150);
                doc.fillColor("#4B5563").font("Helvetica").fontSize(10)
                    .text("SchoolSync Platform Ltd.", 350, 165)
                    .text("Billing & Support Desk", 350, 180)
                    .text("billing@schoolsync.com", 350, 195);

                doc.moveDown(4);

                const tableTop = 270;
                doc.fillColor("#1F2937").font("Helvetica-Bold").fontSize(10);
                doc.text("Description", 50, tableTop);
                doc.text("Plan", 220, tableTop);
                doc.text("Base Rate", 320, tableTop, { width: 80, align: "right" });
                doc.text("Tax (18% GST)", 410, tableTop, { width: 60, align: "right" });
                doc.text("Total", 480, tableTop, { width: 70, align: "right" });

                doc.strokeColor("#9CA3AF").lineWidth(1.5).moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

                const rowTop = tableTop + 25;
                doc.fillColor("#374151").font("Helvetica").fontSize(9.5);
                doc.text(`Monthly Subscription - ${school.school_name}`, 50, rowTop, { width: 160 });
                doc.text(school.plan_name || "Basic", 220, rowTop);
                doc.text(`INR ${Number(invoiceDetails.amount).toFixed(2)}`, 320, rowTop, { width: 80, align: "right" });
                doc.text(`INR ${Number(invoiceDetails.tax_amount).toFixed(2)}`, 410, rowTop, { width: 60, align: "right" });
                doc.text(`INR ${Number(invoiceDetails.total_amount).toFixed(2)}`, 480, rowTop, { width: 70, align: "right" });

                doc.strokeColor("#E5E7EB").lineWidth(1).moveTo(50, rowTop + 25).lineTo(550, rowTop + 25).stroke();

                const summaryTop = rowTop + 45;
                doc.fillColor("#4B5563").font("Helvetica").fontSize(10).text("Subtotal:", 350, summaryTop, { align: "right", width: 100 });
                doc.fillColor("#1F2937").font("Helvetica-Bold").text(`INR ${Number(invoiceDetails.amount).toFixed(2)}`, 460, summaryTop, { align: "right", width: 90 });

                doc.fillColor("#4B5563").font("Helvetica").text("Tax Amount:", 350, summaryTop + 15, { align: "right", width: 100 });
                doc.fillColor("#1F2937").font("Helvetica-Bold").text(`INR ${Number(invoiceDetails.tax_amount).toFixed(2)}`, 460, summaryTop + 15, { align: "right", width: 90 });

                doc.strokeColor("#D1D5DB").lineWidth(1).moveTo(350, summaryTop + 32).lineTo(550, summaryTop + 32).stroke();

                doc.fillColor("#1E3A8A").font("Helvetica-Bold").fontSize(12).text("Amount Due:", 350, summaryTop + 38, { align: "right", width: 100 });
                doc.text(`INR ${Number(invoiceDetails.total_amount).toFixed(2)}`, 460, summaryTop + 38, { align: "right", width: 90 });

                doc.fillColor("#9CA3AF").font("Helvetica-Oblique").fontSize(8.5)
                    .text("Thank you for partnering with SchoolSync. For queries, reach out to billing@schoolsync.com.", 50, 680, { align: "center", width: 500 });

                doc.end();

                writeStream.once("finish", () => {
                    if (settled) return;
                    settled = true;
                    resolve(`/uploads/invoices/${fileName}`);
                });

                writeStream.once("error", rejectAndCleanup);
                doc.once("error", rejectAndCleanup);
            } catch (err) {
                rejectAndCleanup(err);
            };
        });
    },

    runDailyBillingSweep: async () => {
        console.log("[CRON] Running daily billing sweep...");

        async function logSystemAlert(alertType, message) {
            try {
                await executeAsync(
                    "INSERT INTO system_alerts (alert_type, message, status, created_at) VALUES (?, ?, 'active', NOW())",
                    [alertType, message]
                );
            } catch (err) {
                console.error(`[CRON-Alert] Failed to log alert: ${err.message}`);
            };
        };

        try {
            try {
                const expiringSoon = await queryAsync(`
                    SELECT s.*, sch.school_name, sch.subdomain 
                    FROM subscriptions s 
                    JOIN schools sch ON s.school_id = sch.id 
                    WHERE s.end_date <= DATE_ADD(CURDATE(), INTERVAL 3 DAY) 
                        AND s.end_date >= CURDATE() 
                        AND s.status IN ('active', 'trial')
                `);

                for (const sub of expiringSoon) {
                    try {
                        const end = new Date(sub.end_date);
                        if (end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0 && end.getMilliseconds() === 0) {
                            end.setHours(23, 59, 59, 999);
                        }
                        const now = new Date();
                        const daysRemaining = now > end ? 0 : Math.ceil((end - now) / (1000 * 60 * 60 * 24));
                        const admins = await queryAsync(
                            "SELECT id, email FROM users WHERE school_id = ? AND role = 'school_admin' AND status = 'active'",
                            [sub.school_id]
                        );

                        const renewalUrl = `https://${sub.subdomain}.schoolsync.in/schooladmin/subscription`;
                        const formattedExpiry = new Date(sub.end_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

                        for (const admin of admins) {
                            const emailContent = templates.subscriptionExpiringSoon(
                                sub.school_name,
                                sub.plan,
                                formattedExpiry,
                                daysRemaining,
                                renewalUrl
                            );
                            await NotificationModel.enqueueEmail(admin.email, emailContent.subject, emailContent.bodyHtml);

                            await NotificationService.createAndSend({
                                recipient_id: admin.id,
                                recipient_role: "school_admin",
                                school_id: sub.school_id,
                                title: "Subscription Expiring Soon",
                                message: `Your ${sub.plan} plan subscription is expiring in ${daysRemaining} days on ${formattedExpiry}. Renew now to avoid disruptions.`,
                                type: "warning",
                                category: "general",
                                action_url: "/schooladmin/subscription"
                            });
                        };
                    } catch (err) {
                        console.error(`[CRON] Step 1 failed for subscription ID ${sub.id}:`, err);
                        await logSystemAlert('renewal_reminder_failed', `Renewal reminder failed for subscription ID ${sub.id}: ${err.message}`);
                    };
                };
            } catch (err) {
                console.error("[CRON] Step 1 main query/processing failed:", err);
                await logSystemAlert('step_1_failed', `Renewal reminders step failed: ${err.message}`);
            };
            try {
                const expiredList = await queryAsync(`
                    SELECT s.*, sch.school_name, sch.subdomain 
                    FROM subscriptions s 
                    JOIN schools sch ON s.school_id = sch.id 
                    WHERE s.end_date < CURDATE() 
                      AND s.status IN ('active', 'trial')
                `);

                for (const sub of expiredList) {
                    try {
                        await withTransaction(async (tx) => {
                            await tx.execute("UPDATE subscriptions SET status = 'expired', updated_at = NOW() WHERE id = ?", [sub.id]);
                            await tx.execute("UPDATE schools SET status = 'expired', updated_at = NOW() WHERE id = ?", [sub.school_id]);

                            await tx.execute(`
                                INSERT INTO school_activity_logs
                                (school_id, actor_id, actor_role, action, entity_type, entity_id, description, created_at)
                                VALUES (?, NULL, 'system', 'subscription_expired', 'subscriptions', ?, ?, NOW())
                            `, [
                                sub.school_id,
                                sub.id,
                                `Subscription plan (${sub.plan}) expired on ${new Date(sub.end_date).toLocaleDateString('en-IN')}. School status set to expired.`
                            ]);
                        });

                        const admins = await queryAsync(
                            "SELECT id, email FROM users WHERE school_id = ? AND role = 'school_admin' AND status = 'active'",
                            [sub.school_id]
                        );

                        const renewalUrl = `https://${sub.subdomain}.schoolsync.in/schooladmin/subscription`;
                        for (const admin of admins) {
                            const emailContent = templates.subscriptionExpired(
                                sub.school_name,
                                sub.plan,
                                renewalUrl
                            );
                            await NotificationModel.enqueueEmail(admin.email, emailContent.subject, emailContent.bodyHtml);

                            await NotificationService.createAndSend({
                                recipient_id: admin.id,
                                recipient_role: "school_admin",
                                school_id: sub.school_id,
                                title: "URGENT: School Account Suspended",
                                message: `Your subscription has expired. Please renew immediately to reactivate access.`,
                                type: "error",
                                category: "general",
                                action_url: "/schooladmin/subscription"
                            });
                        };
                    } catch (err) {
                        console.error(`[CRON] Step 2 failed for subscription ID ${sub.id}:`, err);
                        await logSystemAlert('mark_expired_failed', `Failed to mark expired for subscription ID ${sub.id}: ${err.message}`);
                    };
                };
            } catch (err) {
                console.error("[CRON] Step 2 main query/processing failed:", err);
                await logSystemAlert('step_2_failed', `Mark expired step failed: ${err.message}`);
            };
            try {
                const graceExpiredList = await queryAsync(`
                    SELECT id, school_name, school_email, subdomain, subscription_end 
                    FROM schools 
                    WHERE status = 'expired' 
                        AND subscription_end < DATE_SUB(CURDATE(), INTERVAL 7 DAY)
                `);

                for (const sch of graceExpiredList) {
                    try {
                        await withTransaction(async (tx) => {
                            await tx.execute("UPDATE schools SET status = 'inactive', updated_at = NOW() WHERE id = ?", [sch.id]);
                            await tx.execute("UPDATE users SET status = 'inactive', updated_at = NOW() WHERE school_id = ? AND role = 'school_admin'", [sch.id]);

                            await tx.execute(`
                                INSERT INTO school_activity_logs
                                (school_id, actor_id, actor_role, action, entity_type, entity_id, description, created_at)
                                VALUES (?, NULL, 'system', 'school_deactivated', 'schools', ?, ?, NOW())
                            `, [
                                sch.id,
                                sch.id,
                                `School deactivated and school admin users disabled after 7-day grace period expiration.`
                            ]);
                        });

                        const admins = await queryAsync(
                            "SELECT id, email FROM users WHERE school_id = ? AND role = 'school_admin'",
                            [sch.id]
                        );

                        const renewalUrl = `https://${sch.subdomain}.schoolsync.in/schooladmin/subscription`;
                        for (const admin of admins) {
                            const emailBody = `
                                <h2>Hello Administrator,</h2>
                                <p>Your SchoolSync account for <strong>${sch.school_name}</strong> has been completely deactivated because the 7-day grace period has expired without a renewal.</p>
                                <p>All administrative and user logins have been suspended. To restore access and prevent automatic data deletion, please contact billing or renew your plan immediately.</p>
                                <div class="btn-container">
                                    <a href="${renewalUrl}" class="btn btn-primary" style="background-color: #DC2626;">Renew Subscription</a>
                                </div>
                            `;
                            const html = templates.emailWrapper("School Account Deactivated", emailBody);
                            await NotificationModel.enqueueEmail(admin.email, "URGENT: SchoolSync Account Deactivated", html);
                        };
                    } catch (err) {
                        console.error(`[CRON] Step 3 failed for school ID ${sch.id}:`, err);
                        await logSystemAlert('grace_deactivation_failed', `Failed to deactivate school ID ${sch.id} after grace period: ${err.message}`);
                    };
                };
            } catch (err) {
                console.error("[CRON] Step 3 main query/processing failed:", err);
                await logSystemAlert('step_3_failed', `Grace period handling step failed: ${err.message}`);
            };

            try {
                const autoRenewList = await queryAsync(`
                    SELECT s.*, sch.school_name, sch.school_email, sch.subdomain 
                    FROM subscriptions s 
                    JOIN schools sch ON s.school_id = sch.id 
                    JOIN plans p ON p.id = s.plan_id
                    WHERE s.auto_renew = 1
                        AND s.end_date <= DATE_ADD(CURDATE(), INTERVAL 1 DAY)
                        AND s.status = 'active'
                        AND LOWER(COALESCE(s.plan, '')) NOT IN ('trial', 'free_trial', 'demo')
                        AND LOWER(COALESCE(p.plan_key, '')) NOT IN ('trial', 'free_trial', 'demo')
                        AND LOWER(COALESCE(p.slug, '')) NOT IN ('trial', 'free_trial', 'demo')
                `);

                for (const sub of autoRenewList) {
                    try {
                        const [plan] = await queryAsync("SELECT * FROM plans WHERE id = ?", [sub.plan_id]);
                        if (!plan) {
                            throw new Error(`Plan ID ${sub.plan_id} not found for auto-renewal`);
                        };
                        if (isTrialRenewalCandidate(sub, plan)) {
                            continue;
                        };
                        const price = parseFloat(sub.billing_cycle === 'yearly' ? plan.yearly_price : plan.monthly_price);
                        if (!Number.isFinite(price) || price <= 0) {
                            throw new Error(`Plan ID ${sub.plan_id} has an invalid auto-renewal price`);
                        };
                        const { startDate: start_date, endDate: end_date } = getAutoRenewalPeriod(sub.end_date, sub.billing_cycle);

                        const taxAmount = parseFloat((price * 0.18).toFixed(2));
                        const totalAmount = price + taxAmount;
                        const invoiceNo = `INV-REN-${sub.id}`;

                        // A stored Razorpay reference proves neither a new charge nor capture.
                        // This sweep cannot charge it, so the attempt is recorded as failed and
                        // the normal verified checkout must create any replacement subscription.
                        const paymentSuccess = false;
                        const paymentMethodLog = sub.razorpay_id
                            ? "Razorpay reference present; renewal charge unverified"
                            : "None";

                        let generatedInvoicePath = null;
                        let renewalResult;
                        try {
                            renewalResult = await withTransaction(async (tx) => {
                                const [lockedSource] = await tx.query(
                                    `SELECT id, status, auto_renew
                                    FROM subscriptions
                                    WHERE id = ?
                                    FOR UPDATE`,
                                    [sub.id]
                                );
                                if (!lockedSource || lockedSource.status !== 'active' || Number(lockedSource.auto_renew) !== 1) {
                                    return { processed: false };
                                };

                                const [existingRenewal] = await tx.query(
                                    `SELECT id
                                    FROM subscriptions
                                    WHERE renewed_from_id = ?
                                    LIMIT 1`,
                                    [sub.id]
                                );
                                if (existingRenewal) {
                                    await tx.execute(
                                        "UPDATE subscriptions SET auto_renew = 0, updated_at = NOW() WHERE id = ?",
                                        [sub.id]
                                    );
                                    return { processed: false };
                                };

                                const claimResult = await tx.execute(
                                    `UPDATE subscriptions
                                    SET auto_renew = 0, updated_at = NOW()
                                    WHERE id = ? AND status = 'active' AND auto_renew = 1`,
                                    [sub.id]
                                );
                                if (claimResult.affectedRows !== 1) {
                                    return { processed: false };
                                };

                                const startsInFuture = toSqlDate(start_date) > toSqlDate(new Date());
                                const newStatus = paymentSuccess
                                    ? (startsInFuture ? 'scheduled' : 'active')
                                    : 'cancelled';
                                const paymentStatus = paymentSuccess ? 'paid' : 'failed';
                                const renewalAutoRenew = paymentSuccess ? 1 : 0;

                                const insertSubSql = `
                                    INSERT INTO subscriptions
                                    (school_id, plan_id, plan, price, start_date, end_date, status, payment_status, auto_renew, renewed_from_id, billing_cycle, created_at, updated_at)
                                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
                                `;
                                const subRes = await tx.execute(insertSubSql, [
                                    sub.school_id,
                                    sub.plan_id,
                                    sub.plan,
                                    price,
                                    start_date,
                                    end_date,
                                    newStatus,
                                    paymentStatus,
                                    renewalAutoRenew,
                                    sub.id,
                                    sub.billing_cycle
                                ]);
                                const newSubId = subRes.insertId;

                                if (newStatus === 'active') {
                                    await tx.execute("UPDATE subscriptions SET status = 'expired', updated_at = NOW() WHERE id = ?", [sub.id]);
                                };
                                if (paymentSuccess) {
                                    await tx.execute(`
                                        INSERT INTO subscription_history
                                        (school_id, old_plan_id, old_plan_name, new_plan_id, new_plan_name, change_type, billing_cycle, amount_paid, payment_ref, created_at)
                                        VALUES (?, ?, ?, ?, ?, 'renewal', ?, ?, ?, NOW())
                                    `, [sub.school_id, sub.plan_id, sub.plan, sub.plan_id, sub.plan, sub.billing_cycle, totalAmount, invoiceNo ]);
                                };

                                const invoiceStatus = paymentSuccess ? 'paid' : 'failed';
                                const insertInvSql = `
                                    INSERT INTO invoices
                                    (school_id, subscription_id, invoice_no, amount, tax_amount, total_amount, status, billing_date, due_date, created_at, updated_at)
                                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
                                `;
                                const invRes = await tx.execute(insertInvSql, [ sub.school_id, newSubId, invoiceNo, price, taxAmount, totalAmount, invoiceStatus, start_date, start_date ]);
                                const invoiceId = invRes.insertId;
                                generatedInvoicePath = await billingService.generatePDFInvoice({
                                    invoice_no: invoiceNo,
                                    amount: price,
                                    tax_amount: taxAmount,
                                    total_amount: totalAmount,
                                    billing_date: start_date,
                                    due_date: start_date
                                }, {
                                    school_name: sub.school_name,
                                    school_email: sub.school_email,
                                    subdomain: sub.subdomain,
                                    plan_name: sub.plan
                                });

                                await tx.execute("UPDATE invoices SET pdf_path = ? WHERE id = ?", [generatedInvoicePath, invoiceId]);
                                if (newStatus === 'active') {
                                    await tx.execute(`
                                        UPDATE schools
                                        SET subscription_start = ?, subscription_end = ?, status = 'active', plan_id = ?, updated_at = NOW()
                                        WHERE id = ?
                                    `, [start_date, end_date, sub.plan_id, sub.school_id]);
                                };

                                const activityAction = paymentSuccess ? 'auto_renewal_initiated' : 'auto_renewal_failed';
                                const activityDescription = paymentSuccess
                                    ? `Auto-renewal subscription initiated for plan: ${sub.plan}. Invoice ${invoiceNo} generated. Payment method: ${paymentMethodLog}. Payment status: ${paymentStatus}.`
                                    : `Auto-renewal was not activated for plan: ${sub.plan} because no verified renewal charge was captured. Attempt ${invoiceNo} recorded as failed; use verified checkout to renew.`;
                                await tx.execute(`
                                    INSERT INTO school_activity_logs
                                    (school_id, actor_id, actor_role, action, entity_type, entity_id, description, created_at)
                                    VALUES (?, NULL, 'system', ?, 'subscriptions', ?, ?, NOW())
                                `, [sub.school_id, activityAction, newSubId, activityDescription]);

                                return { processed: true, newStatus };
                            });
                        } catch (transactionError) {
                            await removeGeneratedInvoice(generatedInvoicePath);
                            throw transactionError;
                        };

                        if (!renewalResult?.processed) {
                            continue;
                        };

                        if (paymentSuccess) {
                            const emailBody = `
                                <h2>Subscription Auto-Renewed Successfully</h2>
                                <p>Hello Administrator,</p>
                                <p>We have successfully processed your auto-renewal payment of <strong>INR ${totalAmount}</strong> for your SchoolSync subscription (Plan: <strong>${sub.plan}</strong>).</p>
                                <p>Your renewed subscription starts on <strong>${start_date.toLocaleDateString('en-IN')}</strong> and runs until <strong>${end_date.toLocaleDateString('en-IN')}</strong>.</p>
                                <p>The invoice <strong>${invoiceNo}</strong> has been marked as paid. You can view or download it inside your school admin panel.</p>
                            `;
                            const html = templates.emailWrapper("Subscription Renewed Successfully", emailBody);
                            await NotificationModel.enqueueEmail(sub.school_email, "SchoolSync Subscription Renewed Successfully", html);
                        } else {
                            const emailBody = `
                                <h2>Subscription Renewal Requires Payment</h2>
                                <p>Hello Administrator,</p>
                                <p>We could not verify a new payment for the automatic renewal of <strong>${sub.school_name}</strong>. No renewal was activated and no payable invoice was created.</p>
                                <p>Your current subscription remains available through its existing end date. Please complete payment through the verified checkout in your school admin subscription page to continue service.</p>
                            `;
                            const html = templates.emailWrapper("Subscription Renewal Requires Payment", emailBody);
                            await NotificationModel.enqueueEmail(sub.school_email, "Action Required: Complete Subscription Renewal", html);
                        };
                    } catch (err) {
                        console.error(`[CRON] Step 4 auto-renew failed for subscription ID ${sub.id}:`, err);
                        await logSystemAlert('auto_renew_failed', `Auto-renew processing failed for subscription ID ${sub.id}: ${err.message}`);
                    };
                };
            } catch (err) {
                console.error("[CRON] Step 4 main query/processing failed:", err);
                await logSystemAlert('step_4_failed', `Auto-renewal step failed: ${err.message}`);
            };

            try {
                const archivedCount = await NotificationModel.archiveOldNotifications();
                console.log(`[CRON] Archived ${archivedCount} notifications.`);

                const deleteEmailsSql = `
                    DELETE FROM email_queue 
                    WHERE status = 'sent' AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
                `;
                const deleteResult = await executeAsync(deleteEmailsSql);
                console.log(`[CRON] Cleaned up ${deleteResult.affectedRows} sent emails from email_queue.`);

                await logSystemAlert('cron_billing_sweep', `Daily billing sweep executed successfully. Archived notifications count: ${archivedCount}. Cleaned up sent emails: ${deleteResult.affectedRows}.`);
            } catch (err) {
                console.error("[CRON] Step 6 cleanup failed:", err);
                await logSystemAlert('step_6_failed', `Cleanup phase failed: ${err.message}`);
            };
        } catch (error) {
            console.error("[CRON] Daily billing sweep failed with critical error:", error);
            await logSystemAlert('critical_billing_sweep_error', `Critical error in daily billing sweep: ${error.message}`);
            try {
                await NotificationModel.enqueueEmail(
                    "admin@schoolsync.in",
                    "CRITICAL ALERT: Daily Billing Sweep Failed",
                    `<h2 style="color:#DC2626;">Daily Billing Sweep Failed</h2>
                    <p>A critical error occurred while executing the daily billing sweep cron job.</p>
                    <p><strong>Error Message:</strong> ${error.message}</p>
                    <p><strong>Stack Trace:</strong></p>
                    <pre>${error.stack}</pre>`
                );
            } catch (mailErr) {
                console.error("Failed to email super admin about critical error:", mailErr.message);
            };
        };
    },

    calculateProration: async (schoolId, newPlanId) => {
        const [school] = await queryAsync("SELECT * FROM schools WHERE id = ?", [schoolId]);
        const [newPlan] = await queryAsync("SELECT * FROM plans WHERE id = ?", [newPlanId]);

        if (!school || !newPlan) {
            throw new Error("School or Plan not found");
        };

        const [oldPlan] = await queryAsync("SELECT * FROM plans WHERE id = ?", [school.plan_id]);
        const [sub] = await queryAsync(
            "SELECT * FROM subscriptions WHERE school_id = ? AND status IN ('active', 'trial') ORDER BY created_at DESC LIMIT 1",
            [schoolId]
        );
        const billingCycle = sub ? sub.billing_cycle : 'monthly';
        const oldPrice = oldPlan ? parseFloat(billingCycle === 'yearly' ? oldPlan.yearly_price : oldPlan.monthly_price) : 0;
        const newPrice = parseFloat(billingCycle === 'yearly' ? newPlan.yearly_price : newPlan.monthly_price);
        const subEnd = new Date(school.subscription_end || Date.now());
        const today = new Date();
        const diffTime = subEnd - today;
        const remainingDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
        const cycleDays = billingCycle === 'yearly' ? 365 : 30;
        const oldPlanDaily = oldPrice / cycleDays;
        const oldPlanCredit = parseFloat((oldPlanDaily * remainingDays).toFixed(2));
        const newPlanDaily = newPrice / cycleDays;
        const newPlanCharge = parseFloat((newPlanDaily * remainingDays).toFixed(2));
        const netAdjustment = parseFloat((newPlanCharge - oldPlanCredit).toFixed(2));

        return {
            remainingDays,
            oldPlanName: oldPlan ? oldPlan.name : "None",
            oldPlanPrice: oldPrice,
            newPlanName: newPlan.name,
            newPlanPrice: newPrice,
            oldPlanCredit,
            newPlanCharge,
            netAdjustment: netAdjustment > 0 ? netAdjustment : 0.00,
            hasCredit: netAdjustment < 0,
            creditAmount: netAdjustment < 0 ? Math.abs(netAdjustment) : 0.00,
            billingCycle
        };
    },

    runOverduePaymentSweep: async () => {
        console.log("[CRON] Running overdue payments sweep...");
        try {
            const invoices = await queryAsync(`
                SELECT i.*, s.school_name, s.school_email, s.status as school_status
                FROM invoices i
                JOIN schools s ON i.school_id = s.id
                WHERE i.status = 'unpaid'
                  AND i.due_date < CURDATE()
            `);

            console.log(`[CRON] Found ${invoices.length} overdue invoices.`);

            for (const invoice of invoices) {
                const nextRetry = invoice.payment_retry_count + 1;
                const schoolId = invoice.school_id;

                if (nextRetry >= 3) {
                    await withTransaction(async (tx) => {
                        await tx.execute("UPDATE invoices SET status = 'failed', payment_retry_count = 3 WHERE id = ?", [invoice.id]);
                        await tx.execute("UPDATE schools SET status = 'expired' WHERE id = ?", [schoolId]);
                        await tx.execute("UPDATE subscriptions SET status = 'expired' WHERE school_id = ? AND status = 'active'", [schoolId]);

                        const transporter = getTransporter();
                        await transporter.sendMail({
                            from: process.env.EMAIL_USER,
                            to: invoice.school_email,
                            subject: `SchoolSync Account SUSPENDED - Unpaid Invoice ${invoice.invoice_no}`,
                            html: `
                                <div style="font-family:sans-serif;color:#334155;max-width:600px;margin:auto;border:1px solid #EF4444;border-radius:12px;overflow:hidden;">
                                    <div style="background:#EF4444;padding:25px;color:#fff;text-align:center;">
                                        <h2 style="margin:0;">Account Suspended</h2>
                                        <p style="margin:5px 0 0;font-size:14px;opacity:0.9;">Invoice ${invoice.invoice_no} Overdue</p>
                                    </div>
                                    <div style="padding:25px;background:#fff;">
                                        <h3>Dear Principal/Admin,</h3>
                                        <p>After three unsuccessful collection attempts, your SchoolSync account for <strong>${invoice.school_name}</strong> has been suspended.</p>
                                        <p>Please contact billing@schoolsync.com or pay the outstanding dues of <strong>INR ${invoice.total_amount}</strong> immediately to reactivate your portal access.</p>
                                        <p style="margin-top:20px;color:#EF4444;font-weight:700;">All user access (Admins, Teachers, Librarians, Students) is blocked until payment is settled.</p>
                                        <br/>
                                        <p>Warm Regards,<br/><strong>SchoolSync Recovery Team</strong></p>
                                    </div>
                                </div>
                            `
                        });
                        console.log(`[CRON] Maximum retries reached. Suspended school: ${invoice.school_name}`);
                    });
                } else {
                    const newDueDate = new Date();
                    newDueDate.setDate(newDueDate.getDate() + 7);

                    await executeAsync(
                        `UPDATE invoices SET 
                            payment_retry_count = ?, 
                            last_retry_at = CURRENT_TIMESTAMP,
                            due_date = ? 
                        WHERE id = ?`,
                        [nextRetry, newDueDate, invoice.id]
                    );

                    const transporter = getTransporter();
                    await transporter.sendMail({
                        from: process.env.EMAIL_USER,
                        to: invoice.school_email,
                        subject: `URGENT REMINDER: Overdue Invoice ${invoice.invoice_no} (Attempt ${nextRetry}/3)`,
                        html: `
                            <div style="font-family:sans-serif;color:#334155;max-width:600px;margin:auto;border:1px solid #F59E0B;border-radius:12px;overflow:hidden;">
                                <div style="background:#F59E0B;padding:25px;color:#fff;text-align:center;">
                                    <h2 style="margin:0;">Payment Reminder</h2>
                                    <p style="margin:5px 0 0;font-size:14px;opacity:0.9;">Attempt ${nextRetry} of 3</p>
                                </div>
                                <div style="padding:25px;background:#fff;">
                                    <h3>Dear Principal/Admin,</h3>
                                    <p>This is the <strong>${nextRetry === 1 ? "First" : "Second"} reminder</strong> that invoice <strong>${invoice.invoice_no}</strong> for <strong>INR ${invoice.total_amount}</strong> remains unpaid and is past its due date.</p>
                                    <p>Your portal will automatically be suspended if payment is not received before <strong>${newDueDate.toLocaleDateString()}</strong>.</p>
                                    <p>Kindly settle your dues to maintain active services.</p>
                                    <br/>
                                    <p>Warm Regards,<br/><strong>SchoolSync Billing Team</strong></p>
                                </div>
                            </div>
                        `
                    });
                    console.log(`[CRON] Overdue retry ${nextRetry} logged and email dispatched for ${invoice.school_name}`);
                };
            };
        } catch (error) {
            console.error("[CRON] Overdue payment sweep failed:", error);
        };
    }
};

billingService._test = {
    getAutoRenewalPeriod,
    isTrialRenewalCandidate
};

module.exports = billingService;
