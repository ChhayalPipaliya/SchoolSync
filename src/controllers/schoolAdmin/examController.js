const db = require('../../config/database');
const NotificationService = require('../../services/notificationService');

function calculateGrade(marksObtained, maxMarks, schemes = []) {
    if (!marksObtained || !maxMarks || maxMarks === 0) {
        return { grade: 'E', gradePoint: 0.0, description: 'Fail' };
    }
    const pct = (parseFloat(marksObtained) / parseFloat(maxMarks)) * 100;
    if (schemes && schemes.length > 0) {
        for (const s of schemes) {
            const min = parseFloat(s.min_marks);
            const max = parseFloat(s.max_marks);
            if (pct >= min && pct <= max) {
                return { grade: s.grade, gradePoint: parseFloat(s.grade_point) || 0.0, description: s.description || '' };
            };
        };
    };
    if (pct >= 91) return { grade: 'A1', gradePoint: 10.0, description: 'Outstanding' };
    if (pct >= 81) return { grade: 'A2', gradePoint: 9.0, description: 'Excellent' };
    if (pct >= 71) return { grade: 'B1', gradePoint: 8.0, description: 'Very Good' };
    if (pct >= 61) return { grade: 'B2', gradePoint: 7.0, description: 'Good' };
    if (pct >= 51) return { grade: 'C1', gradePoint: 6.0, description: 'Above Average' };
    if (pct >= 41) return { grade: 'C2', gradePoint: 5.0, description: 'Average' };
    if (pct >= 33) return { grade: 'D', gradePoint: 4.0, description: 'Pass' };
    return { grade: 'E', gradePoint: 0.0, description: 'Fail' };
};

function isPassed(marksObtained, passMarks) {
    return parseFloat(marksObtained) >= parseFloat(passMarks);
};

function getGradingScale() {
    return [
        { range: '91–100%', grade: 'A1', gradePoint: 10.0, description: 'Outstanding' },
        { range: '81–90%', grade: 'A2', gradePoint: 9.0, description: 'Excellent' },
        { range: '71–80%', grade: 'B1', gradePoint: 8.0, description: 'Very Good' },
        { range: '61–70%', grade: 'B2', gradePoint: 7.0, description: 'Good' },
        { range: '51–60%', grade: 'C1', gradePoint: 6.0, description: 'Above Average' },
        { range: '41–50%', grade: 'C2', gradePoint: 5.0, description: 'Average' },
        { range: '33–40%', grade: 'D', gradePoint: 4.0, description: 'Pass (Below Average)' },
        { range: '0–32%', grade: 'E', gradePoint: 0.0, description: 'Fail' }
    ];
};

function getSchoolId(req) {
    return req.user?.school_id || req.session?.user?.school_id;
};

exports.listExams = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        if (!schoolId) return res.redirect('/login');

        const [exams] = await db.query(
            `SELECT e.*,
                c.class_name, c.section,
                COUNT(DISTINCT m.student_id) AS total_marked,
                COUNT(m.id) AS total_marks_records,
                SUM(CASE WHEN m.status = 'pass' THEN 1 ELSE 0 END) AS total_pass,
                SUM(CASE WHEN m.status = 'fail' THEN 1 ELSE 0 END) AS total_fail,
                AVG(m.obtained_marks) AS avg_marks
            FROM exams e
            LEFT JOIN classes c ON e.class_id = c.id
            LEFT JOIN marks m ON m.exam_id = e.id AND m.school_id = e.school_id
            WHERE e.school_id = ?
            GROUP BY e.id
            ORDER BY e.start_date DESC`,
            [schoolId]
        );

        const [classes] = await db.query(
            'SELECT * FROM classes WHERE school_id = ? ORDER BY class_name, section',
            [schoolId]
        );

        const totalExams = exams.length;
        const publishedExams = exams.filter(e => e.is_published).length;
        const totalMarked = exams.reduce((s, e) => s + (e.total_marked || 0), 0);

        res.render('schoolAdmin/exams/list', {
            title: 'Exams & Results',
            exams,
            classes,
            stats: { totalExams, publishedExams, totalMarked },
            user: req.session?.user || req.user
        });
    } catch (err) {
        console.error('[listExams]:', err);
        req.flash('error', 'Failed to load exams');
        res.redirect('/schooladmin/dashboard');
    }
};

exports.addExam = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        if (!schoolId) return res.redirect('/login');

        const { name, class_id, start_date, end_date, exam_type, term, max_marks, pass_marks, academic_year, description } = req.body;
        if (!name || !class_id || !start_date) {
            req.flash('error', 'Exam name, class, and start date are required');
            return res.redirect('/schooladmin/exams');
        };

        const [result] = await db.query(
            `INSERT INTO exams (school_id, class_id, name, exam_type, term, max_marks, pass_marks,
                start_date, end_date, academic_year, description, is_published, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW())`,
            [ schoolId, class_id, name.trim(), exam_type || 'unit_test', term || 'first_term', parseInt(max_marks) || 100, parseInt(pass_marks) || 33, start_date, end_date || null, academic_year || '2025-26', description || null]
        );

        const examId = result.insertId;
        const formattedDate = new Date(start_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        NotificationService.notifyClass(class_id, schoolId, {
            title: `New Exam Scheduled: ${name.trim()}`,
            message: `A new exam '${name.trim()}' has been scheduled starting on ${formattedDate}. Check your exam schedule for details.`,
            category: 'academic',
            type: 'exam_scheduled',
            reference_type: 'exam',
            reference_id: examId,
            action_url: '/student/exams/schedule'
        }, req.user?.id || req.session?.user?.id).catch(err => console.error('[addExam Notification Error]:', err));

        req.flash('success', 'Exam created successfully');
        res.redirect('/schooladmin/exams');
    } catch (err) {
        console.error('[addExam]:', err);
        req.flash('error', 'Failed to create exam');
        res.redirect('/schooladmin/exams');
    };
};

exports.editExam = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;
        if (!schoolId) return res.redirect('/login');

        const { name, class_id, start_date, end_date, exam_type, term, max_marks, pass_marks, academic_year, description } = req.body;
        const [[exam]] = await db.query('SELECT id FROM exams WHERE id = ? AND school_id = ?', [id, schoolId]);
        if (!exam) {
            req.flash('error', 'Exam not found');
            return res.redirect('/schooladmin/exams');
        };

        await db.query(
            `UPDATE exams SET name=?, class_id=?, exam_type=?, term=?, max_marks=?, pass_marks=?,
                start_date=?, end_date=?, academic_year=?, description=?
            WHERE id = ? AND school_id = ?`,
            [name, class_id, exam_type, term, parseInt(max_marks) || 100, parseInt(pass_marks) || 33, start_date, end_date || null, academic_year || '2025-26', description || null, id, schoolId]
        );

        req.flash('success', 'Exam updated successfully');
        res.redirect('/schooladmin/exams');
    } catch (err) {
        console.error('[editExam]:', err);
        req.flash('error', 'Failed to update exam');
        res.redirect('/schooladmin/exams');
    };
};

exports.deleteExam = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;
        if (!schoolId) return res.redirect('/login');

        const [[exam]] = await db.query('SELECT id FROM exams WHERE id = ? AND school_id = ?', [id, schoolId]);
        if (!exam) {
            req.flash('error', 'Exam not found');
            return res.redirect('/schooladmin/exams');
        };

        await db.query('DELETE FROM marks WHERE exam_id = ? AND school_id = ?', [id, schoolId]);
        await db.query('DELETE FROM exams WHERE id = ? AND school_id = ?', [id, schoolId]);

        req.flash('success', 'Exam deleted successfully');
        res.redirect('/schooladmin/exams');
    } catch (err) {
        console.error('[deleteExam]:', err);
        req.flash('error', 'Failed to delete exam');
        res.redirect('/schooladmin/exams');
    };
};

exports.togglePublish = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;
        if (!schoolId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const [[exam]] = await db.query('SELECT id, name, class_id, is_published FROM exams WHERE id = ? AND school_id = ?', [id, schoolId]);
        if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });

        const newStatus = exam.is_published ? 0 : 1;
        await db.query('UPDATE exams SET is_published = ? WHERE id = ? AND school_id = ?', [newStatus, id, schoolId]);

        if (newStatus === 1 && exam.class_id) {
            NotificationService.notifyClass(exam.class_id, schoolId, {
                title: `Exam Results Published: ${exam.name}`,
                message: `Results for exam '${exam.name}' have been published. View your results now!`,
                category: 'academic',
                type: 'exam_published',
                reference_type: 'exam',
                reference_id: exam.id,
                action_url: '/student/results'
            }, req.user?.id || req.session?.user?.id).catch(err => console.error('[togglePublish Notification Error]:', err));
        }

        res.json({ success: true, is_published: newStatus, message: newStatus ? 'Results published!' : 'Results unpublished' });
    } catch (err) {
        console.error('[togglePublish]:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    };
};

exports.getMarksEntry = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;
        const { subjectId } = req.query;
        if (!schoolId) return res.redirect('/login');

        const [[exam]] = await db.query(
            `SELECT e.*, c.class_name, c.section
            FROM exams e LEFT JOIN classes c ON e.class_id = c.id
            WHERE e.id = ? AND e.school_id = ?`,
            [id, schoolId]
        );

        if (!exam) {
            req.flash('error', 'Exam not found');
            return res.redirect('/schooladmin/exams');
        };

        const [subjects] = await db.query(
            `SELECT s.id, s.subject_name, s.code
            FROM subjects s
            JOIN class_subjects cs ON s.id = cs.subject_id AND s.school_id = cs.school_id
            WHERE cs.class_id = ?
                AND cs.school_id = ?
                AND COALESCE(cs.status, 'active') = 'active'
                AND s.status = 'active'
            ORDER BY s.subject_name`,
            [exam.class_id, schoolId]
        );

        const [schemes] = await db.query(
            'SELECT min_marks, max_marks, grade, grade_point, description FROM grade_schemes WHERE school_id = ? AND is_active = 1 ORDER BY min_marks DESC',
            [schoolId]
        );

        let students = [];
        if (subjectId) {
            [students] = await db.query(
                `SELECT s.id, u.first_name AS first_name, u.last_name AS last_name, s.roll_no,
                    m.obtained_marks AS marks_obtained, m.grade, m.grade_point, m.remarks AS remark, m.status
                FROM students s
                JOIN users u ON s.user_id = u.id
                LEFT JOIN marks m ON s.id = m.student_id AND m.exam_id = ? AND m.subject_id = ?
                WHERE s.school_id = ? AND s.class_id = ? AND s.deleted_at IS NULL
                ORDER BY CAST(s.roll_no AS UNSIGNED) ASC, s.roll_no ASC`,
                [id, subjectId, schoolId, exam.class_id]
            );
        };

        const studentsWithGrades = students.map(s => ({
            ...s,
            gradeInfo: s.marks_obtained !== null ? calculateGrade(s.marks_obtained, exam.max_marks, schemes) : null
        }));

        res.render('schoolAdmin/exams/marks', {
            title: `Enter Marks — ${exam.name}`,
            exam,
            subjects,
            selectedSubjectId: subjectId || '',
            students: studentsWithGrades,
            gradingScale: schemes.length > 0 ? schemes : getGradingScale(),
            user: req.session?.user || req.user
        });
    } catch (err) {
        console.error('[getMarksEntry]:', err);
        req.flash('error', 'Failed to load marks entry');
        res.redirect('/schooladmin/exams');
    };
};

exports.postMarksEntry = async (req, res) => {
    let connection;
    try {
        const schoolId = getSchoolId(req);
        const { exam_id, subject_id, marks } = req.body;
        if (!schoolId) return res.redirect('/login');

        if (!subject_id) {
            req.flash('error', 'Please select a subject');
            return res.redirect(`/schooladmin/exams/${exam_id}/marks`);
        };

        if (!marks || Object.keys(marks).length === 0) {
            req.flash('error', 'No marks data provided');
            return res.redirect(`/schooladmin/exams/${exam_id}/marks?subjectId=${subject_id}`);
        };

        const [[exam]] = await db.query('SELECT * FROM exams WHERE id = ? AND school_id = ?', [exam_id, schoolId]);
        if (!exam) {
            req.flash('error', 'Exam not found');
            return res.redirect('/schooladmin/exams');
        };

        const [schemes] = await db.query(
            'SELECT min_marks, max_marks, grade, grade_point, description FROM grade_schemes WHERE school_id = ? AND is_active = 1 ORDER BY min_marks DESC',
            [schoolId]
        );

        connection = await db.getConnection();
        await connection.beginTransaction();

        for (const [studentKey, data] of Object.entries(marks)) {
            const studentId = studentKey.replace('student_', '');
            const marksObtained = parseFloat(data.marks);
            if (isNaN(marksObtained) || marksObtained < 0) continue;

            if (marksObtained > exam.max_marks) {
                await connection.rollback();
                req.flash('error', `Marks cannot exceed maximum (${exam.max_marks})`);
                return res.redirect(`/schooladmin/exams/${exam_id}/marks?subjectId=${subject_id}`);
            };

            const gradeInfo = calculateGrade(marksObtained, exam.max_marks, schemes);
            const status = isPassed(marksObtained, exam.pass_marks) ? 'pass' : 'fail';
            const remark = String(data.remark ?? '').trim().substring(0, 255);

            const [[existing]] = await connection.query(
                'SELECT id FROM marks WHERE student_id = ? AND exam_id = ? AND subject_id = ?',
                [studentId, exam_id, subject_id]
            );

            if (existing) {
                await connection.query(
                    `UPDATE marks SET obtained_marks=?, grade=?, grade_point=?, status=?, remarks=?, entry_date=CURDATE()
                    WHERE id=?`,
                    [marksObtained, gradeInfo.grade, gradeInfo.gradePoint, status, remark, existing.id]
                );
            } else {
                await connection.query(
                    `INSERT INTO marks (school_id, student_id, exam_id, subject_id, obtained_marks, grade, grade_point, status, remarks, entry_date)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE())`,
                    [schoolId, studentId, exam_id, subject_id, marksObtained, gradeInfo.grade, gradeInfo.gradePoint, status, remark]
                );
            };
        };

        await connection.commit();
        req.flash('success', 'Marks saved successfully');
        res.redirect(`/schooladmin/exams/${exam_id}/marks?subjectId=${subject_id}`);
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('[postMarksEntry]:', err);
        req.flash('error', 'Failed to save marks');
        res.redirect(`/schooladmin/exams/${req.body.exam_id || exam_id}/marks${subject_id ? `?subjectId=${subject_id}` : ''}`);
    } finally {
        if (connection) connection.release();
    };
};

exports.getResultOverview = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;
        if (!schoolId) return res.redirect('/login');

        const [[exam]] = await db.query(
            `SELECT e.*, c.class_name, c.section
            FROM exams e LEFT JOIN classes c ON e.class_id = c.id
            WHERE e.id = ? AND e.school_id = ?`,
            [id, schoolId]
        );
        
        if (!exam) {
            req.flash('error', 'Exam not found');
            return res.redirect('/schooladmin/exams');
        };

        const [results] = await db.query(
            `SELECT u.first_name AS first_name, u.last_name AS last_name, s.roll_no,
                m.obtained_marks, m.grade, m.grade_point, m.status, m.remarks
            FROM marks m
            JOIN students s ON m.student_id = s.id
            JOIN users u ON s.user_id = u.id
            WHERE m.exam_id = ? AND m.school_id = ?
            ORDER BY m.obtained_marks DESC`,
            [id, schoolId]
        );

        const total = results.length;
        const passed = results.filter(r => r.status === 'pass').length;
        const failed = total - passed;
        const avgMarks = total > 0 ? (results.reduce((s, r) => s + parseFloat(r.obtained_marks || 0), 0) / total).toFixed(2) : 0;
        const highestMarks = total > 0 ? Math.max(...results.map(r => parseFloat(r.obtained_marks || 0))) : 0;
        const lowestMarks = total > 0 ? Math.min(...results.map(r => parseFloat(r.obtained_marks || 0))) : 0;
        const gradeDistrib = {};
        results.forEach(r => {
            gradeDistrib[r.grade] = (gradeDistrib[r.grade] || 0) + 1;
        });

        const toppers = results.slice(0, 5).map((r, i) => ({
            rank: i + 1, ...r,
            percentage: ((parseFloat(r.obtained_marks) / exam.max_marks) * 100).toFixed(1)
        }));

        const failingStudents = results.filter(r => r.status === 'fail').map(r => ({
            ...r,
            percentage: ((parseFloat(r.obtained_marks) / exam.max_marks) * 100).toFixed(1)
        }));

        res.render('schoolAdmin/exams/results', {
            title: `Results — ${exam.name}`,
            exam,
            results,
            stats: { total, passed, failed, avgMarks, highestMarks, lowestMarks, passPercent: total > 0 ? ((passed / total) * 100).toFixed(1) : 0 },
            gradeDistrib,
            toppers,
            failingStudents,
            needsCharts: true,
            user: req.session?.user || req.user
        });
    } catch (err) {
        console.error('[getResultOverview]:', err);
        req.flash('error', 'Failed to load results');
        res.redirect('/schooladmin/exams');
    };
};

exports.generateReportCard = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;
        if (!schoolId) return res.redirect('/login');

        const [[exam]] = await db.query(
            `SELECT e.*, c.class_name, c.section
            FROM exams e LEFT JOIN classes c ON e.class_id = c.id
            WHERE e.id = ? AND e.school_id = ?`,
            [id, schoolId]
        );

        if (!exam) {
            req.flash('error', 'Exam not found');
            return res.redirect('/schooladmin/exams');
        };

        const [schemes] = await db.query(
            'SELECT min_marks, max_marks, grade, grade_point, description FROM grade_schemes WHERE school_id = ? AND is_active = 1 ORDER BY min_marks DESC',
            [schoolId]
        );

        const [results] = await db.query(
            `SELECT u.first_name AS first_name, u.last_name AS last_name, s.roll_no, c.class_name, c.section,
                m.obtained_marks AS marks_obtained, m.grade, m.grade_point, m.status, m.remarks AS remark,
                e.name AS exam_name, e.max_marks, e.pass_marks,
                sch.school_name, sch.school_address
            FROM marks m
            JOIN students s ON m.student_id = s.id
            JOIN users u ON s.user_id = u.id
            JOIN exams e ON m.exam_id = e.id
            JOIN classes c ON s.class_id = c.id
            LEFT JOIN schools sch ON e.school_id = sch.id
            WHERE m.exam_id = ? AND m.school_id = ?
            ORDER BY CAST(s.roll_no AS UNSIGNED) ASC`,
            [id, schoolId]
        );

        const resultsWithDetails = results.map(r => ({
            ...r,
            gradeInfo: calculateGrade(r.marks_obtained, r.max_marks, schemes),
            percentage: ((parseFloat(r.marks_obtained) / parseFloat(r.max_marks)) * 100).toFixed(1)
        }));

        const totalStudents = resultsWithDetails.length;
        const passedStudents = resultsWithDetails.filter(r => r.status === 'pass').length;
        const classAverage = totalStudents > 0 ? (resultsWithDetails.reduce((s, r) => s + parseFloat(r.marks_obtained), 0) / totalStudents).toFixed(2) : 0;

        res.render('schoolAdmin/exams/reportCard', {
            title: `Report Cards — ${exam.name}`,
            exam,
            results: resultsWithDetails,
            statistics: { totalStudents, passedStudents, failedStudents: totalStudents - passedStudents, classAverage },
            gradingScale: getGradingScale(),
            user: req.session?.user || req.user,
            layout: false
        });
    } catch (err) {
        console.error('[generateReportCard]:', err);
        req.flash('error', 'Failed to generate report cards');
        res.redirect('/schooladmin/exams');
    };
};

exports.getBulkEntry = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;
        if (!schoolId) return res.redirect('/login');

        const [[exam]] = await db.query(
            `SELECT e.*, c.class_name, c.section
            FROM exams e LEFT JOIN classes c ON e.class_id = c.id
            WHERE e.id = ? AND e.school_id = ?`,
            [id, schoolId]
        );

        if (!exam) {
            req.flash('error', 'Exam not found');
            return res.redirect('/schooladmin/exams');
        };

        const [students] = await db.query(
            `SELECT s.id, u.first_name AS first_name, u.last_name AS last_name, s.roll_no
            FROM students s JOIN users u ON s.user_id = u.id
            WHERE s.school_id = ? AND s.class_id = ? AND s.deleted_at IS NULL
            ORDER BY CAST(s.roll_no AS UNSIGNED) ASC`,
            [schoolId, exam.class_id]
        );

        res.render('schoolAdmin/exams/bulkEntry', {
            title: `Bulk Entry — ${exam.name}`,
            exam, students,
            gradingScale: getGradingScale(),
            user: req.session?.user || req.user
        });
    } catch (err) {
        console.error('[getBulkEntry]:', err);
        req.flash('error', 'Failed to load bulk entry');
        res.redirect('/schooladmin/exams');
    };
};

exports.postBulkEntry = async (req, res) => {
    let connection;
    try {
        const schoolId = getSchoolId(req);
        const { exam_id, csv_data } = req.body;
        if (!schoolId) return res.redirect('/login');

        if (!csv_data || !csv_data.trim()) {
            req.flash('error', 'No CSV data provided');
            return res.redirect(`/schooladmin/exams/${exam_id}/bulk-entry`);
        };

        const [[exam]] = await db.query('SELECT * FROM exams WHERE id = ? AND school_id = ?', [exam_id, schoolId]);
        if (!exam) {
            req.flash('error', 'Exam not found');
            return res.redirect('/schooladmin/exams');
        };

        const [schemes] = await db.query(
            'SELECT min_marks, max_marks, grade, grade_point, description FROM grade_schemes WHERE school_id = ? AND is_active = 1 ORDER BY min_marks DESC',
            [schoolId]
        );

        connection = await db.getConnection();
        await connection.beginTransaction();
        const lines = csv_data.trim().split('\n').filter(l => l.trim());
        let processed = 0;
        const errors = [];

        for (const line of lines) {
            const parts = line.split(',').map(s => s.trim());
            const [rollNo, marksStr, remark] = parts;
            if (!rollNo || !marksStr) continue;

            const marksObtained = parseFloat(marksStr);
            if (isNaN(marksObtained)) { errors.push(`Invalid marks for roll ${rollNo}`); continue; }
            if (marksObtained > exam.max_marks) { errors.push(`Marks exceed max for roll ${rollNo}`); continue; }

            const [[student]] = await connection.query(
                'SELECT id FROM students WHERE roll_no = ? AND class_id = ? AND school_id = ? AND deleted_at IS NULL',
                [rollNo, exam.class_id, schoolId]
            );
            if (!student) { errors.push(`Student not found: roll ${rollNo}`); continue; }

            const gradeInfo = calculateGrade(marksObtained, exam.max_marks, schemes);
            const status = isPassed(marksObtained, exam.pass_marks) ? 'pass' : 'fail';
            const [[existing]] = await connection.query(
                'SELECT id FROM marks WHERE student_id = ? AND exam_id = ?',
                [student.id, exam_id]
            );

            if (existing) {
                await connection.query(
                    'UPDATE marks SET obtained_marks=?, grade=?, grade_point=?, status=?, remarks=?, entry_date=CURDATE() WHERE id=?',
                    [marksObtained, gradeInfo.grade, gradeInfo.gradePoint, status, remark || null, existing.id]
                );
            } else {
                await connection.query(
                    'INSERT INTO marks (school_id, student_id, exam_id, obtained_marks, grade, grade_point, status, remarks, entry_date) VALUES (?,?,?,?,?,?,?,?,CURDATE())',
                    [schoolId, student.id, exam_id, marksObtained, gradeInfo.grade, gradeInfo.gradePoint, status, remark || null]
                );
            };
            processed++;
        };

        await connection.commit();
        if (errors.length > 0) {
            req.flash('error', `Processed ${processed} records with ${errors.length} error(s): ${errors.slice(0, 3).join('; ')}`);
        } else {
            req.flash('success', `Successfully processed ${processed} records`);
        };
        res.redirect(`/schooladmin/exams/${exam_id}/marks`);
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('[postBulkEntry]:', err);
        req.flash('error', 'Bulk entry failed');
        res.redirect('/schooladmin/exams');
    } finally {
        if (connection) connection.release();
    };
};

exports.getGradeSchemes = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        if (!schoolId) return res.redirect('/login');

        const [schemes] = await db.query(
            'SELECT * FROM grade_schemes WHERE school_id = ? ORDER BY min_marks DESC',
            [schoolId]
        );

        res.render('schoolAdmin/exams/gradeSchemes', {
            title: 'Grade Schemes',
            schemes,
            user: req.session?.user || req.user
        });
    } catch (err) {
        console.error('[getGradeSchemes]:', err);
        req.flash('error', 'Failed to load grade schemes');
        res.redirect('/schooladmin/exams');
    };
};

exports.addGradeScheme = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        if (!schoolId) return res.redirect('/login');

        const { scheme_name, min_marks, max_marks, grade, grade_point, description } = req.body;
        if (!min_marks || !max_marks || !grade) {
            req.flash('error', 'Min marks, max marks and grade are required');
            return res.redirect('/schooladmin/exams/grade-schemes');
        };

        await db.query(
            `INSERT INTO grade_schemes (school_id, scheme_name, min_marks, max_marks, grade, grade_point, description) 
            VALUES (?,?,?,?,?,?,?)`,
            [schoolId, scheme_name || 'Default', parseFloat(min_marks), parseFloat(max_marks), grade.trim(), parseFloat(grade_point) || 0, description || null]
        );

        req.flash('success', 'Grade scheme added');
        res.redirect('/schooladmin/exams/grade-schemes');
    } catch (err) {
        console.error('[addGradeScheme]:', err);
        req.flash('error', 'Failed to add grade scheme');
        res.redirect('/schooladmin/exams/grade-schemes');
    };
};

exports.deleteGradeScheme = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;
        if (!schoolId) return res.redirect('/login');

        await db.query('DELETE FROM grade_schemes WHERE id = ? AND school_id = ?', [id, schoolId]);
        req.flash('success', 'Grade scheme removed');
        res.redirect('/schooladmin/exams/grade-schemes');
    } catch (err) {
        console.error('[deleteGradeScheme]:', err);
        req.flash('error', 'Failed to delete grade scheme');
        res.redirect('/schooladmin/exams/grade-schemes');
    };
};

exports.exportResults = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;
        if (!schoolId) return res.redirect('/login');

        const [[exam]] = await db.query(
            'SELECT e.*, c.class_name, c.section FROM exams e LEFT JOIN classes c ON e.class_id = c.id WHERE e.id = ? AND e.school_id = ?',
            [id, schoolId]
        );
        if (!exam) return res.redirect('/schooladmin/exams');

        const [results] = await db.query(
            `SELECT u.first_name AS first_name, u.last_name AS last_name, s.roll_no, m.obtained_marks, e.max_marks, m.grade, m.grade_point, m.status, m.remarks
            FROM marks m
            JOIN students s ON m.student_id = s.id
            JOIN users u ON s.user_id = u.id
            JOIN exams e ON m.exam_id = e.id
            WHERE m.exam_id = ? AND m.school_id = ?
            ORDER BY CAST(s.roll_no AS UNSIGNED) ASC`,
            [id, schoolId]
        );

        const headers = ['Roll No', 'First Name', 'Last Name', 'Marks Obtained', 'Max Marks', 'Percentage', 'Grade', 'Grade Point', 'Status', 'Remarks'];
        const rows = results.map(r => [
            r.roll_no, r.first_name, r.last_name,
            r.obtained_marks, r.max_marks,
            ((parseFloat(r.obtained_marks) / parseFloat(r.max_marks)) * 100).toFixed(2),
            r.grade, r.grade_point, r.status, r.remarks || ''
        ]);

        const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${exam.name.replace(/\s+/g, '_')}_results.csv"`);
        res.send(csvContent);
    } catch (err) {
        console.error('[exportResults]:', err);
        req.flash('error', 'Export failed');
        res.redirect('/schooladmin/exams');
    };
};

exports.calculateGrade = calculateGrade;
exports.getGradingScale = getGradingScale;