const { queryAsync, executeAsync, withTransaction } = require("../config/database");

const NotificationModel = {
    async create(data) {
        const sql = `
            INSERT INTO notifications 
            (recipient_id, recipient_role, school_id, title, message, type, category, reference_type, reference_id, created_by, action_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const params = [ data.recipient_id, data.recipient_role, data.school_id || null, data.title, data.message, data.type || "info", data.category || "general", data.reference_type || null, data.reference_id || null, data.created_by || null, data.action_url || null];
        const result = await executeAsync(sql, params);
        return result.insertId;
    },

    async getByUser(recipientId, recipientRole, limit = 20, offset = 0) {
        const sql = `
            SELECT * FROM notifications 
            WHERE recipient_id = ? AND recipient_role = ? AND (reference_type IS NULL OR reference_type != 'chat')
            ORDER BY created_at DESC 
            LIMIT ? OFFSET ?
        `;
        return await queryAsync(sql, [recipientId, recipientRole, Number(limit), Number(offset)]);
    },

    async getUnreadCount(recipientId, recipientRole) {
        const sql = `
            SELECT COUNT(*) as count FROM notifications 
            WHERE recipient_id = ? AND recipient_role = ? AND is_read = 0 AND (reference_type IS NULL OR reference_type != 'chat')
        `;
        const rows = await queryAsync(sql, [recipientId, recipientRole]);
        return Number(rows[0]?.count || 0);
    },

    async markAsRead(id, recipientId, recipientRole) {
        const sql = `
            UPDATE notifications 
            SET is_read = 1, read_at = NOW() 
            WHERE id = ? AND recipient_id = ? AND recipient_role = ?
        `;
        const result = await executeAsync(sql, [id, recipientId, recipientRole]);
        return result.affectedRows > 0;
    },

    async markAllAsRead(recipientId, recipientRole) {
        const sql = `
            UPDATE notifications 
            SET is_read = 1, read_at = NOW() 
            WHERE recipient_id = ? AND recipient_role = ? AND is_read = 0 AND (reference_type IS NULL OR reference_type != 'chat')
        `;
        const result = await executeAsync(sql, [recipientId, recipientRole]);
        return result.affectedRows;
    },

    async delete(id, recipientId, recipientRole) {
        const sql = `
            DELETE FROM notifications 
            WHERE id = ? AND recipient_id = ? AND recipient_role = ?
        `;
        const result = await executeAsync(sql, [id, recipientId, recipientRole]);
        return result.affectedRows > 0;
    },

    async enqueueEmail(email, subject, bodyHtml) {
        const sql = `
            INSERT INTO email_queue (recipient_email, subject, body_html, status, attempts)
            VALUES (?, ?, ?, 'pending', 0)
        `;
        const result = await executeAsync(sql, [email, subject, bodyHtml]);
        return result.insertId;
    },

    async getPendingEmails(limit = 10) {
        const sql = `
            SELECT * FROM email_queue 
            WHERE status = 'pending' AND attempts < 3
            ORDER BY created_at ASC 
            LIMIT ?
        `;
        return await queryAsync(sql, [limit]);
    },

    async updateEmailStatus(id, status, errorMsg = null) {
        const sql = `
            UPDATE email_queue 
            SET status = ?, 
                attempts = attempts + 1, 
                last_error = ?, 
                sent_at = IF(? = 'sent', NOW(), sent_at)
            WHERE id = ?
        `;
        return await executeAsync(sql, [status, errorMsg, status, id]);
    },

    async archiveOldNotifications() {
        return await withTransaction(async (helpers) => {
            await helpers.execute(`
                CREATE TABLE IF NOT EXISTS \`notifications_archive\` LIKE \`notifications\`
            `);

            const copySql = `
                INSERT INTO \`notifications_archive\`
                SELECT * FROM \`notifications\` 
                WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)
            `;
            await helpers.execute(copySql);

            const deleteSql = `
                DELETE FROM \`notifications\` 
                WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)
            `;
            const result = await helpers.execute(deleteSql);
            return result.affectedRows;
        });
    }
};

module.exports = NotificationModel;