const db = require('../config/database');

class TeacherModel {
    async createTeacher(data) {
        const [result] = await db.execute(
            `INSERT INTO teachers 
            (school_id, user_id, subject, qualification, experience, gender, dob, marital_status, 
            father_name, mother_name, current_address, permanent_address, joining_date) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [data.school_id, data.user_id, data.subject, data.qualification, data.experience, data.gender, data.dob, data.marital_status, data.father_name, data.mother_name, data.current_address, data.permanent_address, data.joining_date]
        );
        return result.insertId;
    };

    async getTeacherByUserId(userId) {
        const [rows] = await db.execute(
            `SELECT t.*, CONCAT_WS(' ', u.first_name, u.last_name) AS name,
                u.first_name AS first_name, u.last_name AS last_name, u.email, u.phone, u.image AS avatar
            FROM teachers t 
            JOIN users u ON t.user_id = u.id 
            WHERE t.user_id = ?`,
            [userId]
        );
        return rows[0];
    };

    async getTeacherById(teacherId) {
        const [rows] = await db.execute(
            `SELECT t.*, CONCAT_WS(' ', u.first_name, u.last_name) AS name,
                u.first_name AS first_name, u.last_name AS last_name, u.email, u.phone, u.image AS avatar, u.status
            FROM teachers t 
            JOIN users u ON t.user_id = u.id 
            WHERE t.id = ?`,
            [teacherId]
        );
        return rows[0];
    };

    async getTeachersBySchool(schoolId, filters = {}) {
        let query = `SELECT t.*, CONCAT_WS(' ', u.first_name, u.last_name) AS name,
                        u.first_name AS first_name, u.last_name AS last_name, u.email, u.phone, u.status
                    FROM teachers t 
                    JOIN users u ON t.user_id = u.id 
                    WHERE t.school_id = ?`;
        const params = [schoolId];

        if (filters.subject) {
            query += ` AND t.subject LIKE ?`;
            params.push(`%${filters.subject}%`);
        };
        if (filters.gender) {
            query += ` AND t.gender = ?`;
            params.push(filters.gender);
        };
        if (filters.status) {
            query += ` AND u.status = ?`;
            params.push(filters.status);
        };

        query += ` ORDER BY t.created_at DESC`;
        const [rows] = await db.execute(query, params);
        return rows;
    };

    async updateTeacher(teacherId, data) {
        const fields = [];
        const values = [];

        const allowedFields = ['subject', 'qualification', 'experience', 'gender', 'dob', 'marital_status', 'father_name', 'mother_name', 'current_address', 'permanent_address', 'joining_date', 'emergency_contact'];
        for (const key of allowedFields) {
            if (data[key] !== undefined) {
                fields.push(`${key} = ?`);
                values.push(data[key]);
            };
        };

        if (fields.length === 0) return false;
        values.push(teacherId);

        const [result] = await db.execute(
            `UPDATE teachers SET ${fields.join(', ')} WHERE id = ?`,
            values
        );
        return result.affectedRows > 0;
    };

    async deleteTeacher(teacherId) {
        const [result] = await db.execute(`DELETE FROM teachers WHERE id = ?`, [teacherId]);
        return result.affectedRows > 0;
    };

    async getMedicalInfo(teacherId) {
        const [rows] = await db.execute(
            `SELECT * FROM teacher_medical WHERE teacher_id = ?`, [teacherId]
        );
        return rows[0] || null;
    };

    async saveMedicalInfo(teacherId, data) {
        const existing = await this.getMedicalInfo(teacherId);
        if (existing) {
            await db.execute(
                `UPDATE teacher_medical SET medical_issues=?, height=?, weight=?, blood_group=? 
                WHERE teacher_id=?`,
                [data.medical_issues, data.height, data.weight, data.blood_group, teacherId]
            );
        } else {
            await db.execute(
                `INSERT INTO teacher_medical (teacher_id, medical_issues, height, weight, blood_group) 
                VALUES (?, ?, ?, ?, ?)`,
                [teacherId, data.medical_issues, data.height, data.weight, data.blood_group]
            );
        };
        return true;
    };

    async getExperiences(teacherId) {
        const [rows] = await db.execute(
            `SELECT * FROM teacher_experience WHERE teacher_id = ? ORDER BY joining_date DESC`,
            [teacherId]
        );
        return rows;
    };

    async addExperience(teacherId, data) {
        const [result] = await db.execute(
            `INSERT INTO teacher_experience (teacher_id, previous_school, total_experience, joining_date) 
            VALUES (?, ?, ?, ?)`,
            [teacherId, data.previous_school, data.total_experience, data.joining_date]
        );
        return result.insertId;
    };

    async updateExperience(expId, data) {
        const [result] = await db.execute(
            `UPDATE teacher_experience SET previous_school=?, total_experience=?, joining_date=? 
            WHERE id=?`,
            [data.previous_school, data.total_experience, data.joining_date, expId]
        );
        return result.affectedRows > 0;
    };

    async deleteExperience(expId) {
        const [result] = await db.execute(`DELETE FROM teacher_experience WHERE id = ?`, [expId]);
        return result.affectedRows > 0;
    };

    async getDocuments(teacherId) {
        const [rows] = await db.execute(
            `SELECT * FROM teacher_documents WHERE teacher_id = ? ORDER BY uploaded_at DESC`,
            [teacherId]
        );
        return rows;
    };

    async addDocument(teacherId, data) {
        const [result] = await db.execute(
            `INSERT INTO teacher_documents (teacher_id, document_name, document_type, file_path) 
            VALUES (?, ?, ?, ?)`,
            [teacherId, data.document_name, data.document_type, data.file_path]
        );
        return result.insertId;
    };

    async deleteDocument(docId) {
        const [result] = await db.execute(`DELETE FROM teacher_documents WHERE id = ?`, [docId]);
        return result.affectedRows > 0;
    };

    async getDashboardStats(teacherId, schoolId) {
        const [[students]] = await db.execute(
            `SELECT COUNT(*) as count FROM students s
            JOIN class_subjects cs ON s.class_id = cs.class_id AND s.school_id = cs.school_id
            WHERE cs.teacher_id = ? AND cs.school_id = ?`,
            [teacherId, schoolId]
        );

        const [[attendance]] = await db.execute(
            `SELECT COUNT(*) as count FROM attendance 
            WHERE marked_by = (SELECT user_id FROM teachers WHERE id = ? AND school_id = ?)
                AND school_id = ? AND date = CURDATE()`,
            [teacherId, schoolId, schoolId]
        );

        const [[homeworks]] = await db.execute(
            `SELECT COUNT(*) as count FROM homeworks 
            WHERE teacher_id = ? AND school_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
            [teacherId, schoolId]
        );

        const [[classes]] = await db.execute(
            `SELECT COUNT(DISTINCT class_id) as count FROM class_subjects WHERE teacher_id = ? AND school_id = ?`,
            [teacherId, schoolId]
        );

        return {
            totalStudents: students.count,
            todayAttendance: attendance.count,
            weeklyHomeworks: homeworks.count,
            assignedClasses: classes.count
        };
    };
};

module.exports = new TeacherModel();