const db = require('../config/database');

class ImportLogModel {
    async createLog(data) {
        const result = await db.executeAsync(
            `INSERT INTO import_logs 
            (school_id, imported_by, user_role, entity_type, file_name, file_path, total_rows, success_count, failed_count, error_report_path, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [data.school_id, data.imported_by, data.user_role, data.entity_type, data.file_name, data.file_path, data.total_rows || 0, data.success_count || 0, data.failed_count || 0, data.error_report_path || null, data.status || 'processing']
        );
        return result.insertId;
    };

    async getLogById(id, schoolId) {
        const rows = await db.queryAsync(
            `SELECT il.*, CONCAT_WS(' ', u.first_name, u.last_name) as imported_by_name 
            FROM import_logs il
            LEFT JOIN users u ON il.imported_by = u.id
            WHERE il.id = ? AND il.school_id = ?`,
            [id, schoolId]
        );
        return rows[0] || null;
    };

    async getLogsBySchool(schoolId) {
        return await db.queryAsync(
            `SELECT il.*, CONCAT_WS(' ', u.first_name, u.last_name) as imported_by_name 
            FROM import_logs il
            LEFT JOIN users u ON il.imported_by = u.id
            WHERE il.school_id = ? 
            ORDER BY il.created_at DESC`,
            [schoolId]
        );
    };

    async updateLog(id, schoolId, data) {
        const fields = [];
        const values = [];
        const allowedFields = ['total_rows', 'success_count', 'failed_count', 'error_report_path', 'status'];

        for (const key of allowedFields) {
            if (data[key] !== undefined) {
                fields.push(`\`${key}\` = ?`);
                values.push(data[key]);
            };
        };

        if (fields.length === 0) return false;
        values.push(id, schoolId);

        const result = await db.executeAsync(
            `UPDATE import_logs SET ${fields.join(', ')} WHERE id = ? AND school_id = ?`,
            values
        );
        return result.affectedRows > 0;
    };
};

module.exports = new ImportLogModel();