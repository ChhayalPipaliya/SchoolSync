const db = require('../../config/database');
const teacherPermissions = require('../../services/teacherPermissionService');
const { calculateGrade, isPassed } = require('../../utils/marksHelper');

exports.getEnterMarks = async (req, res) => {
    try {
        const user = req.user;
        const schoolId = user?.school_id;
        if (!schoolId) return res.redirect('/login');

        const teacher = await teacherPermissions.getLoggedInTeacher(req);
        const { examId, classId, subjectId } = req.query;

        const teachingAssignments = await teacherPermissions.getTeachingAssignmentsForTeacher(teacher.id, schoolId);
        const [exams] = await db.query(
            `SELECT DISTINCT e.*
            FROM exams e
            JOIN teacher_class_assign tca
                ON tca.class_id = e.class_id
                AND tca.school_id = e.school_id
                AND tca.teacher_id = ?
                AND tca.subject_id IS NOT NULL
                AND COALESCE(tca.is_class_teacher, 0) = 0
                AND COALESCE(tca.can_mark_attendance, 0) = 0
                AND COALESCE(tca.status, 'active') = 'active'
            WHERE e.school_id = ?
            ORDER BY e.start_date DESC`,
            [teacher.id, schoolId]
        );
        const classMap = new Map();
        teachingAssignments.forEach((assignment) => {
            if (!classMap.has(assignment.class_id)) {
                classMap.set(assignment.class_id, {
                    id: assignment.class_id,
                    class_name: assignment.class_name,
                    section: assignment.section_name || assignment.section
                });
            };
        });
        const classes = Array.from(classMap.values());

        let subjects = [];
        if (classId) {
            subjects = teachingAssignments
                .filter((assignment) => String(assignment.class_id) === String(classId))
                .map((assignment) => ({
                    id: assignment.subject_id,
                    subject_name: assignment.subject_name,
                    code: assignment.subject_code || assignment.code
                }));
        };

        let students = [];
        let existingMarks = [];
        let selectedExamData = null;
        if (examId && classId) {
            if (!subjectId || !await teacherPermissions.canTeachSubject(teacher.id, schoolId, classId, subjectId)) {
                req.flash('error', 'You are not assigned to teach this class/subject.');
                return res.redirect('/teacher/marks');
            };

            const [[examRow]] = await db.query('SELECT * FROM exams WHERE id = ? AND class_id = ? AND school_id = ?', [examId, classId, schoolId]);
            selectedExamData = examRow || null;
            if (!selectedExamData) {
                req.flash('error', 'Exam not found for this class.');
                return res.redirect('/teacher/marks');
            };

            const [stuRows] = await db.query(
                `SELECT s.id, s.roll_no, u.first_name AS first_name, u.last_name AS last_name
                FROM students s
                JOIN users u ON s.user_id = u.id
                WHERE s.class_id = ? AND s.school_id = ? AND s.deleted_at IS NULL
                ORDER BY CAST(s.roll_no AS UNSIGNED) ASC, s.roll_no ASC`,
                [classId, schoolId]
            );
            students = stuRows;

            const [markRows] = await db.query(
                `SELECT student_id, obtained_marks AS marks_obtained, grade, grade_point, status, remarks
                FROM marks
                WHERE exam_id = ? AND school_id = ?
                ${subjectId ? 'AND subject_id = ?' : ''}`,
                subjectId ? [examId, schoolId, subjectId] : [examId, schoolId]
            );
            existingMarks = markRows;
        };

        res.render('teacher/marks', {
            title: 'Enter Marks',
            user,
            exams,
            classes,
            subjects,
            students,
            existingMarks,
            selectedExam: examId,
            selectedClass: classId,
            selectedSubject: subjectId,
            selectedExamData,
            layout: 'teacher/layout'
        });
    } catch (err) {
        console.error('[Teacher getEnterMarks]:', err);
        req.flash('error', 'Failed to load marks page');
        res.redirect('/teacher/dashboard');
    };
};

exports.postEnterMarks = async (req, res) => {
    let conn;
    try {
        const user = req.user;
        const schoolId = user?.school_id;
        if (!schoolId) return res.redirect('/login');

        const { exam_id, class_id, subject_id, marks } = req.body;
        const teacher = await teacherPermissions.getLoggedInTeacher(req);
        const teacherId = teacher?.id || null;

        if (!teacher || !await teacherPermissions.canTeachSubject(teacher.id, schoolId, class_id, subject_id)) {
            req.flash('error', 'You are not assigned to teach this class/subject.');
            return res.redirect('/teacher/marks');
        };

        const [[exam]] = await db.query('SELECT * FROM exams WHERE id = ? AND class_id = ? AND school_id = ?', [exam_id, class_id, schoolId]);
        if (!exam) {
            req.flash('error', 'Exam not found for this class.');
            return res.redirect('/teacher/marks');
        };

        if (!marks || Object.keys(marks).length === 0) {
            req.flash('error', 'No marks data provided');
            return res.redirect(`/teacher/marks?examId=${exam_id}&classId=${class_id}&subjectId=${subject_id || ''}`);
        };

        conn = await db.getConnection();
        await conn.beginTransaction();

        for (const [studentKey, data] of Object.entries(marks)) {
            const studentId = studentKey.replace('student_', '');
            const marksObtained = parseFloat(data.obtained || data.marks);
            if (isNaN(marksObtained) || marksObtained < 0) continue;

            const [studentRows] = await conn.query(
                'SELECT id FROM students WHERE id = ? AND school_id = ? AND class_id = ? AND deleted_at IS NULL LIMIT 1',
                [studentId, schoolId, class_id]
            );
            if (!studentRows.length) continue;

            if (marksObtained > exam.max_marks) {
                await conn.rollback();
                req.flash('error', `Marks cannot exceed maximum (${exam.max_marks})`);
                return res.redirect(`/teacher/marks?examId=${exam_id}&classId=${class_id}&subjectId=${subject_id || ''}`);
            };

            const gradeInfo = calculateGrade(marksObtained, exam.max_marks);
            const status = isPassed(marksObtained, exam.pass_marks) ? 'pass' : 'fail';
            const remark = String(data.remark ?? '').trim().substring(0, 255);

            await conn.query(
                `INSERT INTO marks (school_id, exam_id, student_id, obtained_marks, grade, grade_point, status, remarks, teacher_id, entry_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE())
                ON DUPLICATE KEY UPDATE
                    obtained_marks = VALUES(obtained_marks),
                    grade = VALUES(grade),
                    grade_point = VALUES(grade_point),
                    status = VALUES(status),
                    remarks = VALUES(remarks),
                    teacher_id = VALUES(teacher_id),
                    entry_date = CURDATE()`,
                [schoolId, exam_id, studentId, marksObtained, gradeInfo.grade, gradeInfo.gradePoint, status, remark, teacherId]
            );
        };

        await conn.commit();
        req.flash('success', `Marks saved for ${Object.keys(marks).length} students`);
        res.redirect(`/teacher/marks?examId=${exam_id}&classId=${class_id}&subjectId=${subject_id || ''}`);
    } catch (err) {
        if (conn) await conn.rollback();
        console.error('[Teacher postEnterMarks]:', err);
        req.flash('error', 'Failed to save marks');
        res.redirect('/teacher/marks');
    } finally {
        if (conn) conn.release();
    };
};

exports.getMyExams = async (req, res) => {
    try {
        const user = req.user;
        const schoolId = user?.school_id;
        if (!schoolId) return res.redirect('/login');

        const teacher = await teacherPermissions.getLoggedInTeacher(req);

        let exams = [];
        const [rows] = await db.query(
            `SELECT DISTINCT e.*, c.class_name, c.section,
                COUNT(DISTINCT m.student_id) AS total_marked
            FROM exams e
            JOIN teacher_class_assign tca
                ON e.class_id = tca.class_id
                AND e.school_id = tca.school_id
                AND tca.subject_id IS NOT NULL
                AND COALESCE(tca.is_class_teacher, 0) = 0
                AND COALESCE(tca.can_mark_attendance, 0) = 0
                AND COALESCE(tca.status, 'active') = 'active'
            JOIN classes c ON e.class_id = c.id AND c.school_id = e.school_id
            LEFT JOIN marks m ON m.exam_id = e.id AND m.school_id = e.school_id AND m.teacher_id = ?
            WHERE tca.teacher_id = ? AND e.school_id = ?
            GROUP BY e.id
            ORDER BY e.start_date DESC`,
            [teacher.id, teacher.id, schoolId]
        );
        exams = rows;
        res.render('teacher/exams', {
            title: 'My Exam Schedule',
            user,
            exams,
            layout: 'teacher/layout'
        });
    } catch (err) {
        console.error('[Teacher getMyExams]:', err);
        req.flash('error', 'Failed to load exams');
        res.redirect('/teacher/dashboard');
    };
};

exports.getResultAnalysis = async (req, res) => {
    try {
        const user = req.user;
        const schoolId = user?.school_id;
        const { examId, classId } = req.query;
        if (!schoolId) return res.redirect('/login');

        const teacher = await teacherPermissions.getLoggedInTeacher(req);

        const teachingAssignments = await teacherPermissions.getTeachingAssignmentsForTeacher(teacher.id, schoolId);
        const [exams] = await db.query(
            `SELECT DISTINCT e.*
            FROM exams e
            JOIN teacher_class_assign tca
                ON tca.class_id = e.class_id
                AND tca.school_id = e.school_id
                AND tca.teacher_id = ?
                AND tca.subject_id IS NOT NULL
                AND COALESCE(tca.is_class_teacher, 0) = 0
                AND COALESCE(tca.can_mark_attendance, 0) = 0
                AND COALESCE(tca.status, 'active') = 'active'
            WHERE e.school_id = ?
            ORDER BY e.start_date DESC`,
            [teacher.id, schoolId]
        );
        const classMap = new Map();
        teachingAssignments.forEach((assignment) => {
            if (!classMap.has(assignment.class_id)) {
                classMap.set(assignment.class_id, {
                    id: assignment.class_id,
                    class_name: assignment.class_name,
                    section: assignment.section_name || assignment.section
                });
            };
        });
        const classes = Array.from(classMap.values());

        let analysisData = null;
        let selectedExam = null;

        if (examId && classId) {
            if (!teachingAssignments.some((assignment) => String(assignment.class_id) === String(classId))) {
                req.flash('error', 'You are not assigned to teach this class.');
                return res.redirect('/teacher/marks/analysis');
            };

            const [[examRow]] = await db.query(
                `SELECT e.*, c.class_name, c.section
                FROM exams e
                LEFT JOIN classes c ON e.class_id = c.id AND c.school_id = e.school_id
                WHERE e.id = ? AND e.class_id = ? AND e.school_id = ?`,
                [examId, classId, schoolId]
            );
            selectedExam = examRow;

            if (selectedExam) {
                const [results] = await db.query(
                    `SELECT u.first_name AS first_name, u.last_name AS last_name, s.roll_no, m.obtained_marks, m.grade, m.status
                    FROM marks m
                    JOIN students s ON m.student_id = s.id
                    JOIN users u ON s.user_id = u.id
                    WHERE m.exam_id = ? AND m.school_id = ? AND s.class_id = ?
                    ORDER BY m.obtained_marks DESC`,
                    [examId, schoolId, classId]
                );

                const total = results.length;
                const passed = results.filter(r => r.status === 'pass').length;
                const avgMarks = total > 0 ? (results.reduce((s, r) => s + parseFloat(r.obtained_marks || 0), 0) / total).toFixed(2) : 0;
                const gradeDistrib = {};
                results.forEach(r => { gradeDistrib[r.grade] = (gradeDistrib[r.grade] || 0) + 1; });

                analysisData = { results, total, passed, failed: total - passed, avgMarks, gradeDistrib };
            };
        };

        res.render('teacher/analysis', {
            title: 'Result Analysis',
            user,
            exams,
            classes,
            selectedExam,
            selectedClass: classId,
            analysisData,
            needsCharts: true,
            layout: 'teacher/layout'
        });
    } catch (err) {
        console.error('[Teacher getResultAnalysis]:', err);
        req.flash('error', 'Failed to load analysis');
        res.redirect('/teacher/dashboard');
    };
};