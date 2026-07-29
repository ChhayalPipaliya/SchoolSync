const { queryAsync, executeAsync } = require("../config/database");

let isTableInitialized = false;

async function ensureAuditTableExists() {
    if (isTableInitialized) return;
    try {
        const createTableSql = `
            CREATE TABLE IF NOT EXISTS attendance_audit_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                school_id INT NOT NULL,
                entity_type VARCHAR(30) NOT NULL DEFAULT 'student',
                entity_id INT NOT NULL,
                class_id INT NULL,
                date DATE NOT NULL,
                old_status VARCHAR(30) NULL,
                new_status VARCHAR(30) NOT NULL,
                action VARCHAR(30) NOT NULL DEFAULT 'mark',
                reason TEXT NULL,
                performed_by INT NOT NULL,
                user_role VARCHAR(30) NOT NULL,
                ip_address VARCHAR(45) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_school_date (school_id, date),
                INDEX idx_entity (entity_type, entity_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `;
        await executeAsync(createTableSql);
        isTableInitialized = true;
    } catch (err) {
        console.error('[AttendanceAuditModel] Table initialization failed:', err.message);
    };
};

const AttendanceAuditModel = {
    async log(data) {
        try {
            await ensureAuditTableExists();
            const sql = `
                INSERT INTO attendance_audit_logs 
                (school_id, entity_type, entity_id, class_id, date, old_status, new_status, action, reason, performed_by, user_role, ip_address)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            const params = [
                data.school_id,
                data.entity_type || 'student',
                data.entity_id,
                data.class_id || null,
                data.date,
                data.old_status || null,
                data.new_status,
                data.action || 'mark',
                data.reason || null,
                data.performed_by,
                data.user_role || 'user',
                data.ip_address || null
            ];
            const result = await executeAsync(sql, params);
            return result.insertId;
        } catch (err) {
            console.error('[AttendanceAuditModel log Error]:', err.message);
            return null;
        };
    },

    async getLogs(schoolId, filters = {}, limit = 50, offset = 0) {
        try {
            await ensureAuditTableExists();
            let sql = `SELECT * FROM attendance_audit_logs WHERE school_id = ?`;
            const params = [schoolId];

            if (filters.date) {
                sql += ` AND date = ?`;
                params.push(filters.date);
            }
            if (filters.entity_type) {
                sql += ` AND entity_type = ?`;
                params.push(filters.entity_type);
            }
            if (filters.entity_id) {
                sql += ` AND entity_id = ?`;
                params.push(filters.entity_id);
            };

            sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
            params.push(Number(limit), Number(offset));

            return await queryAsync(sql, params);
        } catch (err) {
            console.error('[AttendanceAuditModel getLogs Error]:', err.message);
            return [];
        };
    }
};

module.exports = AttendanceAuditModel;