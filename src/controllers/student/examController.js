const db = require('../../config/database');

function calculateGrade(marksObtained, maxMarks) {
    if (!marksObtained || !maxMarks || maxMarks === 0) return { grade: 'E', description: 'Fail', color: '#EF4444' };
    const pct = (parseFloat(marksObtained) / parseFloat(maxMarks)) * 100;
    if (pct >= 91) return { grade: 'A1', description: 'Outstanding', color: '#4F46E5' };
    if (pct >= 81) return { grade: 'A2', description: 'Excellent', color: '#6366F1' };
    if (pct >= 71) return { grade: 'B1', description: 'Very Good', color: '#10B981' };
    if (pct >= 61) return { grade: 'B2', description: 'Good', color: '#34D399' };
    if (pct >= 51) return { grade: 'C1', description: 'Above Average', color: '#F59E0B' };
    if (pct >= 41) return { grade: 'C2', description: 'Average', color: '#FBBF24' };
    if (pct >= 33) return { grade: 'D', description: 'Pass', color: '#94A3B8' };
    return { grade: 'E', description: 'Fail', color: '#EF4444' };
}

exports.myMarks = async (req, res) => {
    try {
        const userId = req.session?.user?.id || req.user?.id;

        if (!userId) {
            req.flash('error', 'Please log in first');
            return res.redirect('/auth/login');
        }

        const [students] = await db.query(
            `SELECT s.id, s.class_id, s.roll_no,
                c.class_name, c.section,
                u.first_name AS first_name, u.last_name AS last_name
            FROM students s
            LEFT JOIN classes c ON s.class_id = c.id
            LEFT JOIN users u ON s.user_id = u.id
            WHERE s.user_id = ? AND s.deleted_at IS NULL
            LIMIT 1`,
            [userId]
        );

        if (!students.length) {
            req.flash('error', 'Student record not found');
            return res.redirect('/student/dashboard');
        };

        const student = students[0];
        const [examRows] = await db.query(
            `SELECT e.id, e.name, e.exam_type, e.term, e.max_marks, e.pass_marks,
                e.start_date, e.is_published
            FROM exams e
            WHERE e.class_id = ? AND e.is_published = 1
            ORDER BY e.start_date DESC`,
            [student.class_id]
        );

        const examsList = [];
        for (const exam of examRows) {
            const [marksRows] = await db.query(
                `SELECT m.obtained_marks, m.status,
                    s.subject_name AS subjectName, s.code AS subject_code
                FROM marks m
                LEFT JOIN subjects s ON m.subject_id = s.id
                WHERE m.student_id = ? AND m.exam_id = ?
                ORDER BY s.subject_name`,
                [student.id, exam.id]
            );

            let examObtained = 0;
            let examTotal = 0;

            const subjectsList = marksRows.map(m => {
                const obt = parseFloat(m.obtained_marks || 0);
                const maxM = parseFloat(exam.max_marks || 100);
                examObtained += obt;
                examTotal += maxM;
                const gInfo = calculateGrade(obt, maxM);
                return {
                    subjectName: m.subjectName || 'Subject',
                    obtained_marks: obt,
                    total_marks: maxM,
                    grade: gInfo.grade
                };
            });

            examsList.push({
                id: exam.id,
                name: exam.name,
                date: exam.start_date,
                obtained: examObtained,
                total: examTotal,
                subjects: subjectsList
            });
        }

        res.render('student/marks', {
            title: 'My Marks',
            student,
            exams: examsList,
            user: req.session?.user || req.user
        });
    } catch (err) {
        console.error('[Student myMarks]:', err);
        req.flash('error', 'Failed to load marks');
        res.redirect('/student/dashboard');
    };
};

exports.myResults = async (req, res) => {
    try {
        const userId = req.session?.user?.id || req.user?.id;
        const { exam_id } = req.query;

        if (!userId) {
            req.flash('error', 'Please log in first');
            return res.redirect('/auth/login');
        }

        const [students] = await db.query(
            `SELECT s.id, s.class_id, s.roll_no,
                c.class_name, c.section,
                u.first_name AS first_name, u.last_name AS last_name
            FROM students s
            LEFT JOIN classes c ON s.class_id = c.id
            LEFT JOIN users u ON s.user_id = u.id
            WHERE s.user_id = ? AND s.deleted_at IS NULL
            LIMIT 1`,
            [userId]
        );

        if (!students.length) {
            req.flash('error', 'Student record not found');
            return res.redirect('/student/dashboard');
        };

        const student = students[0];
        const [exams] = await db.query(
            `SELECT e.id, e.name, e.exam_type, e.term, e.max_marks, e.pass_marks,
                e.start_date, e.is_published
            FROM exams e
            WHERE e.class_id = ? AND e.is_published = 1
            ORDER BY e.start_date DESC`,
            [student.class_id]
        );

        let selectedExam = null;
        let marks = [];
        let totalMarks = 0;
        let obtainedMarks = 0;
        let percentage = 0;
        let grade = '-';
        let resultStatus = 'N/A';
        let gradeInfo = null;

        if (exam_id) {
            const [[examRow]] = await db.query(
                'SELECT * FROM exams WHERE id = ? AND class_id = ? AND is_published = 1',
                [exam_id, student.class_id]
            );

            if (examRow) {
                selectedExam = examRow;

                const [marksRows] = await db.query(
                    `SELECT m.*, e.name AS exam_name, e.max_marks AS exam_max_marks, e.pass_marks AS exam_pass_marks,
                        s.subject_name, s.code AS subject_code
                    FROM marks m
                    JOIN exams e ON m.exam_id = e.id
                    LEFT JOIN subjects s ON m.subject_id = s.id
                    WHERE m.student_id = ? AND m.exam_id = ?
                    ORDER BY s.subject_name`,
                    [student.id, exam_id]
                );

                if (marksRows.length > 0) {
                    obtainedMarks = marksRows.reduce((sum, m) => sum + parseFloat(m.obtained_marks || 0), 0);
                    totalMarks = marksRows.length * parseFloat(examRow.max_marks || 100);
                    percentage = totalMarks > 0 ? ((obtainedMarks / totalMarks) * 100).toFixed(2) : 0;
                    gradeInfo = calculateGrade(obtainedMarks, totalMarks);
                    grade = gradeInfo.grade;

                    const hasFailed = marksRows.some(m => String(m.status).toLowerCase() === 'fail');
                    resultStatus = hasFailed ? 'Fail' : 'Pass';
                    marks = marksRows;
                };
            };
        } else if (exams.length > 0) {
            return res.redirect(`/student/results?exam_id=${exams[0].id}`);
        };

        res.render('student/results', {
            title: 'My Results',
            student,
            exams,
            selectedExam,
            marks,
            totalMarks,
            obtainedMarks,
            percentage,
            grade,
            gradeInfo,
            resultStatus,
            user: req.session?.user || req.user
        });
    } catch (err) {
        console.error('[Student myResults]:', err);
        req.flash('error', 'Failed to load results');
        res.redirect('/student/dashboard');
    };
};

exports.myExamSchedule = async (req, res) => {
    try {
        const userId = req.session?.user?.id || req.user?.id;
        if (!userId) {
            req.flash('error', 'Please log in first');
            return res.redirect('/auth/login');
        };

        const [students] = await db.query(
            'SELECT s.id, s.class_id, c.class_name, c.section FROM students s LEFT JOIN classes c ON s.class_id = c.id WHERE s.user_id = ? AND s.deleted_at IS NULL LIMIT 1',
            [userId]
        );

        if (!students.length) {
            req.flash('error', 'Student record not found');
            return res.redirect('/student/dashboard');
        };

        const student = students[0];
        const [upcomingExams] = await db.query(
            `SELECT e.id, e.name, e.exam_type, e.term, e.max_marks, e.pass_marks,
                e.start_date, e.end_date, e.is_published, e.academic_year,
                m.obtained_marks, m.grade, m.status
            FROM exams e
            LEFT JOIN marks m ON m.exam_id = e.id AND m.student_id = ?
            WHERE e.class_id = ?
            ORDER BY e.start_date DESC`,
            [student.id, student.class_id]
        );

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const categorized = {
            upcoming: upcomingExams.filter(e => {
                if (!e.start_date) return false;
                const s = new Date(e.start_date);
                s.setHours(0, 0, 0, 0);
                return s > today;
            }),
            ongoing: upcomingExams.filter(e => {
                if (!e.start_date) return false;
                const s = new Date(e.start_date);
                s.setHours(0, 0, 0, 0);
                const en = e.end_date ? new Date(e.end_date) : null;
                if (en) en.setHours(23, 59, 59, 999);
                return today >= s && (!en || today <= en);
            }),
            completed: upcomingExams.filter(e => {
                if (!e.end_date) return false;
                const en = new Date(e.end_date);
                en.setHours(23, 59, 59, 999);
                return en < today;
            })
        };

        res.render('student/examSchedule', {
            title: 'Exam Schedule',
            student,
            allExams: upcomingExams,
            categorized,
            user: req.session?.user || req.user
        });
    } catch (err) {
        console.error('[Student myExamSchedule]:', err);
        req.flash('error', 'Failed to load schedule');
        res.redirect('/student/dashboard');
    };
};