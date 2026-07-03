const { queryAsync, executeAsync } = require('../config/database');

const AdmissionModel = {
    async createQRToken(schoolId, role, token, expiresAt) {
        return executeAsync(
            `INSERT INTO qr_tokens (school_id, role, token, expires_at) VALUES (?, ?, ?, ?)`,
            [schoolId, role, token, expiresAt]
        );
    },

    async getQRToken(token) {
        const rows = await queryAsync(
            `SELECT qt.*, s.school_name AS school_name, s.school_address AS school_address, s.logo AS school_logo
             FROM qr_tokens qt
             JOIN schools s ON s.id = qt.school_id
             WHERE qt.token = ? AND qt.used = 0 AND qt.expires_at > NOW()
             LIMIT 1`,
            [token]
        );
        return rows[0] || null;
    },

    async markTokenUsed(token) {
        return executeAsync(`UPDATE qr_tokens SET used = 1 WHERE token = ?`, [token]);
    },

    async listQRTokens(schoolId) {
        return queryAsync(
            `SELECT * FROM qr_tokens WHERE school_id = ? ORDER BY created_at DESC LIMIT 20`,
            [schoolId]
        );
    },

    async createAdmissionRequest(data) {
        const {
            school_id, role, token, full_name, email, phone, date_of_birth,
            gender, address, class_applied, applied_standard, applied_class_id, guardian_name, guardian_phone,
            guardian_relation, blood_group, previous_school, extra_data
        } = data;
        return executeAsync(
            `INSERT INTO admission_requests
             (school_id, role, token, full_name, email, phone, date_of_birth,
              gender, address, class_applied, applied_standard, applied_class_id, guardian_name, guardian_phone,
              guardian_relation, blood_group, previous_school, extra_data)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [school_id, role, token, full_name, email, phone, date_of_birth,
             gender, address, class_applied, applied_standard || class_applied || null, applied_class_id || null, guardian_name, guardian_phone,
             guardian_relation, blood_group, previous_school, extra_data ? JSON.stringify(extra_data) : null]
        );
    },

    async checkDuplicateApplication(schoolId, email, role) {
        const rows = await queryAsync(
            `SELECT id FROM admission_requests
             WHERE school_id = ? AND email = ? AND role = ? AND status != 'rejected'
             LIMIT 1`,
            [schoolId, email, role]
        );
        return rows.length > 0;
    },

    async listAdmissionRequests(schoolId, status = null) {
        let sql = `SELECT * FROM admission_requests WHERE school_id = ?`;
        const params = [schoolId];
        if (status) {
            sql += ` AND status = ?`;
            params.push(status);
        }
        sql += ` ORDER BY submitted_at DESC`;
        return queryAsync(sql, params);
    },

    async getAdmissionRequest(id, schoolId) {
        const rows = await queryAsync(
            `SELECT ar.*, s.school_name AS school_name
             FROM admission_requests ar
             JOIN schools s ON s.id = ar.school_id
             WHERE ar.id = ? AND ar.school_id = ?
             LIMIT 1`,
            [id, schoolId]
        );
        return rows[0] || null;
    },

    async updateStatus(id, schoolId, status, adminNote) {
        return executeAsync(
            `UPDATE admission_requests
             SET status = ?, admin_note = ?, reviewed_at = NOW()
             WHERE id = ? AND school_id = ?`,
            [status, adminNote || null, id, schoolId]
        );
    },

    async countByStatus(schoolId) {
        const rows = await queryAsync(
            `SELECT status, COUNT(*) AS cnt
             FROM admission_requests
             WHERE school_id = ?
             GROUP BY status`,
            [schoolId]
        );
        const counts = { pending: 0, approved: 0, rejected: 0, total: 0 };
        rows.forEach(r => {
            counts[r.status] = r.cnt;
            counts.total += r.cnt;
        });
        return counts;
    },

    async checkDuplicateTeacher(schoolId, email) {
        const rows = await queryAsync(
            `SELECT id FROM admission_requests 
             WHERE school_id = ? AND email = ? AND role = 'teacher' AND status != 'rejected'
             LIMIT 1`,
            [schoolId, email]
        );
        return rows.length > 0;
    },

    async listTeacherApplications(schoolId, status = null) {
        let sql = `SELECT * FROM admission_requests WHERE school_id = ? AND role = 'teacher'`;
        const params = [schoolId];
        if (status) {
            sql += ` AND status = ?`;
            params.push(status);
        }
        sql += ` ORDER BY submitted_at DESC`;
        return queryAsync(sql, params);
    },

    async getTeacherApplication(id, schoolId) {
        const rows = await queryAsync(
            `SELECT ar.*, s.school_name AS school_name, s.school_address AS school_address, s.logo AS school_logo
             FROM admission_requests ar
             JOIN schools s ON s.id = ar.school_id
             WHERE ar.id = ? AND ar.school_id = ? AND ar.role = 'teacher'
             LIMIT 1`,
            [id, schoolId]
        );
        return rows[0] || null;
    },

    async getActiveToken(schoolId, role) {
        const rows = await queryAsync(
            `SELECT qt.*, s.school_name AS school_name, s.school_address AS school_address, s.logo AS school_logo
             FROM qr_tokens qt
             JOIN schools s ON s.id = qt.school_id
             WHERE qt.school_id = ? AND qt.role = ? AND qt.used = 0 AND qt.expires_at > NOW()
             ORDER BY qt.created_at DESC
             LIMIT 1`,
            [schoolId, role]
        );
        return rows[0] || null;
    },

    async createTeacherAdmissionRequest(data) {
        const {
            school_id, token, full_name, email, phone, date_of_birth,
            address, previous_school, extra_data
        } = data;
        return executeAsync(
            `INSERT INTO admission_requests
             (school_id, role, token, full_name, email, phone, date_of_birth,
              address, previous_school, extra_data)
             VALUES (?, 'teacher', ?, ?, ?, ?, ?, ?, ?, ?)`,
            [school_id, token, full_name, email, phone, date_of_birth,
             address, previous_school || null, JSON.stringify(extra_data)]
        );
    },

    async createDriverAdmissionRequest(data) {
        const {
            school_id, token, full_name, email, phone, date_of_birth,
            gender, address, blood_group, extra_data
        } = data;
        return executeAsync(
            `INSERT INTO admission_requests
             (school_id, role, token, full_name, email, phone, date_of_birth,
              gender, address, blood_group, extra_data)
             VALUES (?, 'driver', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [school_id, token, full_name, email, phone, date_of_birth,
             gender || null, address || null, blood_group || null, JSON.stringify(extra_data || {})]
        );
    },

    async listDriverApplications(schoolId, status = null) {
        let sql = `SELECT * FROM admission_requests WHERE school_id = ? AND role = 'driver'`;
        const params = [schoolId];
        if (status) {
            sql += ` AND status = ?`;
            params.push(status);
        }
        sql += ` ORDER BY submitted_at DESC`;
        return queryAsync(sql, params);
    },

    async getDriverApplication(id, schoolId) {
        const rows = await queryAsync(
            `SELECT ar.*, s.school_name AS school_name, s.school_address AS school_address, s.logo AS school_logo
             FROM admission_requests ar
             JOIN schools s ON s.id = ar.school_id
             WHERE ar.id = ? AND ar.school_id = ? AND ar.role = 'driver'
             LIMIT 1`,
            [id, schoolId]
        );
        return rows[0] || null;
    }
};

module.exports = AdmissionModel;
