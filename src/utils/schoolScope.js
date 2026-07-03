const { queryAsync } = require("../config/database");

const getSingleRow = async (sql, params) => {
    const rows = await queryAsync(sql, params);
    return rows[0] || null;
};

const getClassBySchool = (classId, schoolId) => getSingleRow(
    "SELECT * FROM classes WHERE id = ? AND school_id = ? LIMIT 1",
    [classId, schoolId]
);

const getStudentBySchool = (studentId, schoolId, classId = null) => {
    const params = [studentId, schoolId];
    let sql = "SELECT * FROM students WHERE id = ? AND school_id = ?";

    if (classId !== null) {
        sql += " AND class_id = ?";
        params.push(classId);
    }

    sql += " LIMIT 1";
    return getSingleRow(sql, params);
};

const getTeacherBySchool = (teacherId, schoolId) => getSingleRow(
    "SELECT * FROM teachers WHERE id = ? AND school_id = ? LIMIT 1",
    [teacherId, schoolId]
);

const getSubjectBySchool = (subjectId, schoolId, classId = null) => {
    const params = [subjectId, schoolId];
    let sql = "SELECT * FROM subjects WHERE id = ? AND school_id = ?";

    if (classId !== null) {
        sql += " AND class_id = ?";
        params.push(classId);
    }

    sql += " LIMIT 1";
    return getSingleRow(sql, params);
};

const getExamBySchool = (examId, schoolId) => getSingleRow(
    "SELECT * FROM exams WHERE id = ? AND school_id = ? LIMIT 1",
    [examId, schoolId]
);

const getStudentsBySchoolAndClass = async (studentIds, schoolId, classId) => {
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
        return [];
    }

    return queryAsync(
        "SELECT id FROM students WHERE school_id = ? AND class_id = ? AND id IN (?)",
        [schoolId, classId, studentIds]
    );
};

const getSubjectsBySchoolAndClass = async (subjectIds, schoolId, classId) => {
    if (!Array.isArray(subjectIds) || subjectIds.length === 0) {
        return [];
    }

    return queryAsync(
        "SELECT id FROM subjects WHERE school_id = ? AND class_id = ? AND id IN (?)",
        [schoolId, classId, subjectIds]
    );
};

module.exports = { getClassBySchool, getExamBySchool, getStudentBySchool, getStudentsBySchoolAndClass, getSubjectBySchool, getSubjectsBySchoolAndClass, getTeacherBySchool};
