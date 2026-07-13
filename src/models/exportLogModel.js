const db = require('../config/database');

class ExportLogModel {
    async createLog(data) {
        const result = await db.executeAsync(
            `INSERT INTO export_logs 
            (school_id, exported_by, entity_type, filters_applied, file_name, file_path, file_size, record_count, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [data.school_id, data.exported_by, data.entity_type, data.filters_applied ? JSON.stringify(data.filters_applied) : null, data.file_name, data.file_path, data.file_size || 0, data.record_count || 0, data.status || 'processing']
        );
        return result.insertId;
    };

    async getLogById(id, schoolId) {
        const rows = await db.queryAsync(
            `SELECT el.*, CONCAT_WS(' ', u.first_name, u.last_name) as exported_by_name 
            FROM export_logs el
            LEFT JOIN users u ON el.exported_by = u.id
            WHERE el.id = ? AND el.school_id = ?`,
            [id, schoolId]
        );
        return rows[0] || null;
    };

    async getLogsBySchool(schoolId) {
        return await db.queryAsync(
            `SELECT el.*, CONCAT_WS(' ', u.first_name, u.last_name) as exported_by_name 
            FROM export_logs el
            LEFT JOIN users u ON el.exported_by = u.id
            WHERE el.school_id = ? 
            ORDER BY el.created_at DESC`,
            [schoolId]
        );
    };

    async updateLog(id, schoolId, data) {
        const fields = [];
        const values = [];
        const allowedFields = ['file_size', 'record_count', 'status', 'downloaded_at'];

        for (const key of allowedFields) {
            if (data[key] !== undefined) {
                fields.push(`\`${key}\` = ?`);
                values.push(data[key]);
            };
        };

        if (fields.length === 0) return false;
        values.push(id, schoolId);

        const result = await db.executeAsync(
            `UPDATE export_logs SET ${fields.join(', ')} WHERE id = ? AND school_id = ?`,
            values
        );
        return result.affectedRows > 0;
    };
};

module.exports = new ExportLogModel();