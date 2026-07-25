const { getIO } = require("../config/socket");
const NotificationModel = require("../models/notificationModel");
const NotificationPreferenceModel = require("../models/notificationPreferenceModel");
const { queryAsync } = require("../config/database");
const https = require("https");

const sendMsg91SMS = (phone, title, message) => {
    return new Promise((resolve, reject) => {
        const authKey = process.env.MSG91_AUTH_KEY;
        const sender = process.env.MSG91_SENDER_ID || "SCHSNC";
        const templateId = process.env.MSG91_TEMPLATE_ID;

        if (!authKey) {
            return reject(new Error("Msg91 AUTH_KEY not configured"));
        };

        const cleanPhone = phone.replace(/\+/g, '');
        const postData = JSON.stringify({
            template_id: templateId || "default",
            sender: sender,
            recipients: [
                {
                    mobiles: cleanPhone,
                    message: `[SchoolSync] ${title}: ${message}`
                }
            ]
        });

        const options = {
            hostname: 'control.msg91.com',
            port: 443,
            path: '/api/v5/flow/',
            method: 'POST',
            headers: {
                'authkey': authKey,
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve({ raw: data });
                };
            });
        });

        req.on('error', (e) => reject(e));
        req.write(postData);
        req.end();
    });
};

const sendTwilioWhatsApp = async (phone, title, message) => {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioWhatsAppFrom = process.env.TWILIO_WHATSAPP_FROM;

    if (accountSid && authToken && twilioWhatsAppFrom) {
        const twilio = require('twilio');
        const client = twilio(accountSid, authToken);
        await client.messages.create({
            body: `[SchoolSync] *${title}*\n\n${message}`,
            from: `whatsapp:${twilioWhatsAppFrom}`,
            to: `whatsapp:${phone}`
        });
        console.log(`[NotificationService] WhatsApp sent via Twilio to ${phone}`);
    };
};

const getRecipientEmail = async (userId, role) => {
    const rows = await queryAsync("SELECT email FROM users WHERE id = ? LIMIT 1", [userId]);
    return rows[0]?.email || null;
};

const getRecipientPhone = async (userId) => {
    const rows = await queryAsync("SELECT phone FROM users WHERE id = ? LIMIT 1", [userId]);
    return rows[0]?.phone || null;
};

const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const getSafeRelativeUrl = (url) => {
    if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//")) {
        return null;
    };
    return url;
};

const DEFAULT_CATEGORIES = NotificationPreferenceModel.DEFAULT_CATEGORIES || ["academic", "fee", "transport", "library", "general", "system"];
const normalizeCategory = (category) => {
    return DEFAULT_CATEGORIES.includes(category) ? category : "general";
};

const toPreferenceBoolean = (value) => value === true || value === 1 || value === "1";
const getRecipient = async (userId, role) => {
    const rows = await queryAsync(
        "SELECT id, role, school_id, status FROM users WHERE id = ? AND role = ? LIMIT 1",
        [userId, role]
    );
    return rows[0] || null;
};

const isUserOnline = async (userId) => {
    try {
        const io = getIO();
        const sockets = await io.in(`user:${userId}`).fetchSockets();
        return sockets && sockets.length > 0;
    } catch (e) {
        return false;
    };
};

const NotificationService = {
    async createAndSend(data) {
        const { recipient_id, recipient_role, title, message, type, reference_type, reference_id, created_by } = data;
        const recipientId = Number(recipient_id);
        if (!Number.isInteger(recipientId) || recipientId <= 0 || !recipient_role || !title || !message) {
            throw new Error("Invalid notification payload");
        };

        const recipient = await getRecipient(recipientId, recipient_role);
        if (!recipient || recipient.status !== "active") {
            console.warn(`[NotificationService] Recipient not found or inactive: ${recipient_role}#${recipientId}`);
            return null;
        };

        if (data.school_id && recipient.school_id && Number(data.school_id) !== Number(recipient.school_id)) {
            console.warn(`[NotificationService] School mismatch for recipient ${recipient_role}#${recipientId}`);
            return null;
        };

        const school_id = data.school_id || recipient.school_id || null;
        const category = normalizeCategory(data.category || "general");
        const action_url = getSafeRelativeUrl(data.action_url);

        let pref = await NotificationPreferenceModel.getByUserIdAndRole(recipientId, recipient_role);
        if (!pref) {
            pref = {
                email_notifications: true,
                push_notifications: true,
                sms_notifications: false,
                categories_enabled: ["academic", "fee", "transport", "library", "general", "system"]
            };
        };

        const enabledCategories = Array.isArray(pref.categories_enabled) ? pref.categories_enabled : ["academic", "fee", "transport", "library", "general", "system"];
        const isCategoryEnabled = enabledCategories.includes(category);
        if (!isCategoryEnabled) {
            console.log(`[NotificationService] Category "${category}" disabled for user ID ${recipient_id}`);
            return null;
        };

        const notificationId = await NotificationModel.create({
            recipient_id: recipientId,
            recipient_role,
            school_id,
            title,
            message,
            type,
            category,
            reference_type,
            reference_id,
            created_by,
            action_url
        });

        const savedNotification = {
            id: notificationId,
            recipient_id: recipientId,
            recipient_role,
            school_id,
            title,
            message,
            type,
            category,
            reference_type,
            reference_id,
            is_read: 0,
            created_at: new Date(),
            action_url
        };

        if (toPreferenceBoolean(pref.push_notifications)) {
            try {
                const io = getIO();
                io.to(`user:${recipientId}`).emit("new_notification", savedNotification);

                const unreadCount = await NotificationModel.getUnreadCount(recipientId, recipient_role);
                io.to(`user:${recipientId}`).emit("unread_count_update", { unreadCount });
            } catch (err) {
                console.error("[NotificationService] Socket emission failed:", err.message || String(err));
            };
        };

        const isNoticeEmail = title.startsWith('Notice Board:') || 
                              title.toLowerCase().includes('notice') || 
                              type === 'notice' || 
                              category === 'notice' || 
                              data.disable_email === true || 
                              data.skip_email === true;
        if (toPreferenceBoolean(pref.email_notifications) && !isNoticeEmail) {
            const email = await getRecipientEmail(recipientId, recipient_role);
            const isDummyRecipient = email && (
                email.endsWith('@schoolsync.com') ||
                email.endsWith('@demo.schoolsync.local') ||
                email.endsWith('@example.com') ||
                email.includes('.local')
            );

            if (email && !isDummyRecipient) {
                const online = await isUserOnline(recipientId);
                if (!online) {
                    const safeTitle = escapeHtml(title);
                    const safeMessage = escapeHtml(message);
                    const safeActionUrl = getSafeRelativeUrl(action_url);
                    const subject = `[SchoolSync] ${title}`;
                    const bodyHtml = `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #edf2f7; border-radius: 8px;">
                            <h2 style="color: #2b6cb0; border-bottom: 2px solid #edf2f7; padding-bottom: 10px;">${safeTitle}</h2>
                            <p style="font-size: 16px; color: #4a5568; line-height: 1.6;">${safeMessage}</p>
                            ${safeActionUrl ? `
                            <div style="margin: 25px 0;">
                                <a href="${process.env.APP_URL || 'http://localhost:8000'}${safeActionUrl}" style="background-color: #3182ce; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">View in SchoolSync</a>
                            </div>` : ''}
                            <hr style="border: 0; border-top: 1px solid #edf2f7; margin-top: 30px;" />
                            <p style="font-size: 12px; color: #a0aec0;">You received this because email notifications are enabled in your preferences. You can update this in the notification settings page.</p>
                        </div>
                    `;
                    await NotificationModel.enqueueEmail(email, subject, bodyHtml);
                };
            };
        };

        if (toPreferenceBoolean(pref.sms_notifications)) {
            const phone = await getRecipientPhone(recipientId);
            if (phone) {
                try {
                    if (process.env.MSG91_AUTH_KEY) {
                        await sendMsg91SMS(phone, title, message);
                        console.log(`[NotificationService] SMS sent via Msg91 to ${phone}`);
                    } else if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_PHONE_NUMBER) {
                        const accountSid = process.env.TWILIO_ACCOUNT_SID;
                        const authToken = process.env.TWILIO_AUTH_TOKEN;
                        const twilioPhone = process.env.TWILIO_PHONE_NUMBER;
                        const twilio = require('twilio');
                        const client = twilio(accountSid, authToken);
                        await client.messages.create({
                            body: `[SchoolSync] ${title}: ${message}`,
                            from: twilioPhone,
                            to: phone
                        });
                        console.log(`[NotificationService] SMS sent via Twilio to ${phone}`);
                    } else {
                        console.log(`[Twilio SMS Stub] Sending to ${phone}: [${title}] ${message}`);
                    };
                } catch (smsErr) {
                    console.error("[NotificationService] SMS dispatch failed:", smsErr.message);
                };

                try {
                    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_WHATSAPP_FROM) {
                        await sendTwilioWhatsApp(phone, title, message);
                    } else {
                        console.log(`[Twilio WhatsApp Stub] Sending to ${phone}: [${title}] ${message}`);
                    };
                } catch (waErr) {
                    console.error("[NotificationService] WhatsApp dispatch failed:", waErr.message);
                };
            };
        };
        return savedNotification;
    },

    async notifyClass(classId, schoolId, details, createdBy = null) {
        const students = await queryAsync(
            "SELECT user_id FROM students WHERE class_id = ? AND school_id = ? AND deleted_at IS NULL",
            [classId, schoolId]
        );
        const list = [];
        for (const s of students) {
            const res = await this.createAndSend({
                recipient_id: s.user_id,
                recipient_role: "student",
                school_id: schoolId,
                created_by: createdBy,
                ...details
            });
            if (res) list.push(res);
        };
        return list;
    },

    async notifyAdmins(schoolId, details, createdBy = null) {
        const admins = await queryAsync(
            "SELECT id FROM users WHERE school_id = ? AND role = 'school_admin' AND status = 'active'",
            [schoolId]
        );
        const list = [];
        for (const a of admins) {
            const res = await this.createAndSend({
                recipient_id: a.id,
                recipient_role: "school_admin",
                school_id: schoolId,
                created_by: createdBy,
                ...details
            });
            if (res) list.push(res);
        };
        return list;
    }
};

module.exports = NotificationService;