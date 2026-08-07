const db = require('../../config/database');
const teacherPermissions = require('../../services/teacherPermissionService');

const getAuthorizedHomework = async (homeworkId, teacher) => {
    const [rows] = await db.execute(
        `SELECT h.*, c.class_name as className, c.section, s.subject_name as subjectName
        FROM homeworks h
        JOIN classes c ON h.class_id = c.id AND c.school_id = h.school_id
        JOIN subjects s ON h.subject_id = s.id AND s.school_id = h.school_id
        WHERE h.id = ?
            AND h.teacher_id = ?
            AND h.school_id = ?
        LIMIT 1`,
        [homeworkId, teacher.id, teacher.school_id]
    );
    return rows[0] || null;
};

exports.getHomework = async (req, res) => {
    try {
        const teacher = await teacherPermissions.getTeacherByUserOrFail(req.user.id, req.user.school_id);
        if (!teacher) {
            req.flash('error', 'Teacher profile not found. Please contact administration.');
            return res.redirect('/teacher/dashboard');
        }

        const [homeworks] = await db.execute(
            `SELECT h.*, c.class_name as className, c.section, s.subject_name as subjectName,
                (SELECT COUNT(*) FROM homework_submissions hs WHERE hs.homework_id = h.id) as submissionCount
            FROM homeworks h 
            JOIN classes c ON h.class_id = c.id 
            JOIN subjects s ON h.subject_id = s.id 
            WHERE h.teacher_id = ?
                AND h.school_id = ?
            ORDER BY h.created_at DESC`,
            [teacher.id, teacher.school_id]
        );

        const teachingAssignments = await teacherPermissions.getTeachingAssignmentsForTeacher(teacher.id, teacher.school_id);
        const classMap = new Map();
        teachingAssignments.forEach((assignment) => {
            if (!classMap.has(assignment.class_id)) {
                classMap.set(assignment.class_id, {
                    id: assignment.class_id,
                    name: assignment.name,
                    class_name: assignment.class_name,
                    section: assignment.section_name || assignment.section
                });
            };
        });
        const classes = Array.from(classMap.values());
        const subjects = teachingAssignments.map((assignment) => ({
            id: assignment.subject_id,
            name: assignment.subject_name,
            subject_name: assignment.subject_name,
            class_id: assignment.class_id
        }));

        res.render('teacher/homeworks', {
            title: 'Homework Management',
            user: req.user,
            homeworks,
            classes,
            subjects,
            layout: 'teacher/layout'
        });
    } catch (error) {
        console.error('Homework Error:', error);
        req.flash('error', 'Failed to load homework');
        res.redirect('/teacher/dashboard');
    };
};

exports.createHomework = async (req, res) => {
    try {
        const teacher = await teacherPermissions.getTeacherByUserOrFail(req.user.id, req.user.school_id);
        if (!teacher) {
            req.flash('error', 'Teacher profile not found. Please contact administration.');
            return res.redirect('/teacher/dashboard');
        };

        let filePath = null;
        if (req.file) {
            filePath = `/uploads/homeworks/${req.file.filename}`;
        };

        if (!await teacherPermissions.canTeachSubject(teacher.id, teacher.school_id, req.body.class_id, req.body.subject_id)) {
            req.flash('error', 'You are not assigned to teach this class/subject.');
            return res.redirect('/teacher/homework');
        };

        const [result] = await db.query(
            `INSERT INTO homeworks (school_id, teacher_id, class_id, subject_id, title, description, due_date, file_path, status) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
            [teacher.school_id, teacher.id, req.body.class_id, req.body.subject_id,
            req.body.title, req.body.description, req.body.due_date, filePath]
        );

        const [[classRow]] = await db.query("SELECT class_name, section FROM classes WHERE id = ? AND school_id = ?", [req.body.class_id, teacher.school_id]);
        const [[subjectRow]] = await db.query("SELECT subject_name FROM subjects WHERE id = ? AND school_id = ?", [req.body.subject_id, teacher.school_id]);
        const className = classRow ? `${classRow.class_name}-${classRow.section}` : "Class";
        const subjectName = subjectRow ? subjectRow.subject_name : "Subject";
        const NotificationService = require('../../services/notificationService');
        const templates = require('../../utils/notificationTemplates');
        NotificationService.notifyClass(
            req.body.class_id,
            teacher.school_id,
            templates.homeworkAssigned(req.body.title, className, subjectName, result.insertId),
            req.user.id
        ).catch(err => console.error("Failed to notify class about homework:", err));

        req.flash('success', 'Homework assigned successfully');
        res.redirect('/teacher/homework');
    } catch (error) {
        console.error('Create Homework Error:', error);
        req.flash('error', 'Failed to assign homework');
        res.redirect('/teacher/homework');
    };
};

exports.deleteHomework = async (req, res) => {
    try {
        const teacher = await teacherPermissions.getTeacherByUserOrFail(req.user.id, req.user.school_id);
        if (!teacher) {
            req.flash('error', 'Teacher profile not found. Please contact administration.');
            return res.redirect('/teacher/dashboard');
        };

        const homework = await getAuthorizedHomework(req.params.id, teacher);
        if (!homework) {
            req.flash('error', 'Homework not found');
            return res.redirect('/teacher/homework');
        };

        await db.execute(`DELETE FROM homeworks WHERE id = ? AND school_id = ?`, [req.params.id, teacher.school_id]);
        req.flash('success', 'Homework deleted');
        res.redirect('/teacher/homework');
    } catch (error) {
        console.error('Delete Homework Error:', error);
        req.flash('error', 'Failed to delete homework');
        res.redirect('/teacher/homework');
    };
};

exports.closeHomework = async (req, res) => {
    try {
        const teacher = await teacherPermissions.getTeacherByUserOrFail(req.user.id, req.user.school_id);
        if (!teacher) {
            req.flash('error', 'Teacher profile not found. Please contact administration.');
            return res.redirect('/teacher/dashboard');
        };

        const homework = await getAuthorizedHomework(req.params.id, teacher);
        if (!homework) {
            req.flash('error', 'Homework not found');
            return res.redirect('/teacher/homework');
        };

        await db.execute(`UPDATE homeworks SET status = 'closed' WHERE id = ? AND school_id = ?`, [req.params.id, teacher.school_id]);
        req.flash('success', 'Homework closed');
        res.redirect('/teacher/homework');
    } catch (error) {
        console.error('Close Homework Error:', error);
        req.flash('error', 'Failed to close homework');
        res.redirect('/teacher/homework');
    };
};

exports.getHomeworkDetails = async (req, res) => {
    try {
        const teacher = await teacherPermissions.getTeacherByUserOrFail(req.user.id, req.user.school_id);
        if (!teacher) {
            req.flash('error', 'Teacher profile not found.');
            return res.redirect('/teacher/dashboard');
        };

        const homeworkId = req.params.id;
        const homework = await getAuthorizedHomework(homeworkId, teacher);
        if (!homework) {
            req.flash('error', 'Homework not found or unauthorized');
            return res.redirect('/teacher/homework');
        };

        const [students] = await db.execute(
            `SELECT 
                s.id as studentId,
                s.roll_no,
                u.id as userId,
                CONCAT(u.first_name, ' ', COALESCE(u.last_name, '')) as studentName,
                hs.id as submissionId,
                hs.file_path as submittedFile,
                hs.note as studentNote,
                hs.submitted_at as submittedAt,
                hs.viewed_at as viewedAt,
                hs.status as submissionStatus,
                hs.teacher_remark as teacherRemark
            FROM students s
            JOIN users u ON s.user_id = u.id
            LEFT JOIN homework_submissions hs ON hs.student_id = s.id AND hs.homework_id = ?
            WHERE s.class_id = ?
                AND s.school_id = ?
                AND s.status = 'active'
                AND s.deleted_at IS NULL
            ORDER BY CAST(s.roll_no AS UNSIGNED) ASC, u.first_name ASC`,
            [homeworkId, homework.class_id, teacher.school_id]
        );

        const totalStudents = students.length;
        const completedCount = students.filter(s => s.submissionStatus === 'completed').length;
        const pendingCount = totalStudents - completedCount;
        const completionRate = totalStudents > 0 ? ((completedCount / totalStudents) * 100).toFixed(1) : '0.0';

        res.render('teacher/homeworkDetail', {
            title: 'Homework Details',
            user: req.user,
            homework,
            students,
            stats: {
                total: totalStudents,
                completed: completedCount,
                pending: pendingCount,
                rate: completionRate
            },
            layout: 'teacher/layout'
        });
    } catch (error) {
        console.error('Get Homework Details Error:', error);
        req.flash('error', 'Failed to load homework details');
        res.redirect('/teacher/homework');
    };
};

exports.postCheckHomework = async (req, res) => {
    try {
        const teacher = await teacherPermissions.getTeacherByUserOrFail(req.user.id, req.user.school_id);
        if (!teacher) {
            req.flash('error', 'Teacher profile not found.');
            return res.redirect('/teacher/dashboard');
        };

        const homeworkId = req.params.id;
        const homework = await getAuthorizedHomework(homeworkId, teacher);
        if (!homework) {
            req.flash('error', 'Homework not found or unauthorized');
            return res.redirect('/teacher/homework');
        };

        const statusUpdates = req.body.status || {};
        const remarkUpdates = req.body.remarks || {};
        const studentIds = Object.keys(statusUpdates);

        for (const studentId of studentIds) {
            const status = statusUpdates[studentId];
            const remark = remarkUpdates[studentId] || '';
            const [studentRows] = await db.execute(
                'SELECT id FROM students WHERE id = ? AND class_id = ? AND school_id = ? AND deleted_at IS NULL LIMIT 1',
                [studentId, homework.class_id, teacher.school_id]
            );
            if (studentRows.length === 0) continue;

            const [existing] = await db.execute(
                `SELECT id FROM homework_submissions WHERE homework_id = ? AND student_id = ?`,
                [homeworkId, studentId]
            );

            if (existing.length > 0) {
                await db.execute(
                    `UPDATE homework_submissions 
                     SET status = ?, teacher_remark = ? 
                     WHERE homework_id = ? AND student_id = ?`,
                    [status, remark, homeworkId, studentId]
                );
            } else {
                await db.execute(
                    `INSERT INTO homework_submissions (homework_id, student_id, status, teacher_remark) 
                     VALUES (?, ?, ?, ?)`,
                    [homeworkId, studentId, status, remark]
                );
            };
        };

        req.flash('success', 'Homework checking updated successfully');
        res.redirect(`/teacher/homework/${homeworkId}`);
    } catch (error) {
        console.error('Post Check Homework Error:', error);
        req.flash('error', 'Failed to update homework statuses');
        res.redirect('/teacher/homework');
    };
};

exports.exportHomeworkReport = async (req, res) => {
    try {
        const teacher = await teacherPermissions.getTeacherByUserOrFail(req.user.id, req.user.school_id);
        if (!teacher) {
            return res.status(403).send('Unauthorized');
        };

        const homeworkId = req.params.id;
        const format = req.params.format;
        const homework = await getAuthorizedHomework(homeworkId, teacher);
        if (!homework) {
            return res.status(404).send('Homework not found');
        };

        const [students] = await db.execute(
            `SELECT 
                s.id as studentId,
                s.roll_no,
                CONCAT(u.first_name, ' ', COALESCE(u.last_name, '')) as studentName,
                hs.submitted_at as submittedAt,
                hs.viewed_at as viewedAt,
                hs.status as submissionStatus,
                hs.teacher_remark as teacherRemark
            FROM students s
            JOIN users u ON s.user_id = u.id
            LEFT JOIN homework_submissions hs ON hs.student_id = s.id AND hs.homework_id = ?
            WHERE s.class_id = ?
                AND s.school_id = ?
                AND s.status = 'active'
                AND s.deleted_at IS NULL
            ORDER BY CAST(s.roll_no AS UNSIGNED) ASC, u.first_name ASC`,
            [homeworkId, homework.class_id, teacher.school_id]
        );

        const totalStudents = students.length;
        const completedCount = students.filter(s => s.viewedAt).length;
        const pendingCount = totalStudents - completedCount;
        const completionRate = totalStudents > 0 ? ((completedCount / totalStudents) * 100).toFixed(1) : '0.0';

        if (format === 'excel') {
            const ExcelJS = require('exceljs');
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Report');

            worksheet.columns = [
                { header: 'Roll No', key: 'roll_no', width: 10 },
                { header: 'Student Name', key: 'student_name', width: 25 },
                { header: 'Status', key: 'status', width: 15 },
                { header: 'Submission Date', key: 'submitted_at', width: 20 },
                { header: 'Teacher Remark', key: 'remark', width: 30 }
            ];

            worksheet.spliceRows(1, 0,
                [`Homework Report: ${homework.title}`],
                [`Subject: ${homework.subjectName} | Class: ${homework.className}-${homework.section}`],
                [`Due Date: ${new Date(homework.due_date).toLocaleDateString()}`],
                [`Completion Rate: ${completionRate}% (Done: ${completedCount}, Pending: ${pendingCount})`],
                []
            );

            students.forEach(s => {
                const isCompleted = Boolean(s.viewedAt);
                worksheet.addRow({
                    roll_no: s.roll_no || 'N/A',
                    student_name: s.studentName,
                    status: isCompleted ? 'Seen' : 'Pending',
                    submitted_at: s.viewedAt ? new Date(s.viewedAt).toLocaleString() : 'N/A',
                    remark: s.teacherRemark || ''
                });
            });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="Homework_Report_${homeworkId}.xlsx"`);
            await workbook.xlsx.write(res);
            return res.end();
        } else if (format === 'pdf') {
            const PDFDocument = require('pdfkit');
            const doc = new PDFDocument({ margin: 50 });

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="Homework_Report_${homeworkId}.pdf"`);

            doc.pipe(res);
            doc.fillColor('#1E293B').fontSize(20).text('Homework Completion Report', { align: 'center' });
            doc.moveDown(0.5);
            doc.fontSize(12).fillColor('#475569').text(`Title: ${homework.title}`, { align: 'center' });
            doc.text(`Subject: ${homework.subjectName} | Class: ${homework.className}-${homework.section}`, { align: 'center' });
            doc.text(`Due Date: ${new Date(homework.due_date).toLocaleDateString()}`, { align: 'center' });
            doc.moveDown(1);
            doc.fillColor('#F1F5F9').rect(50, doc.y, 512, 60).fill();
            doc.fillColor('#1E293B').fontSize(11);
            doc.text(`Total Students: ${totalStudents}`, 70, doc.y + 15);
            doc.text(`Completed (Done): ${completedCount}`, 70, doc.y + 28);
            doc.text(`Pending: ${pendingCount}`, 250, doc.y - 23);
            doc.text(`Completion Rate: ${completionRate}%`, 250, doc.y - 12);
            doc.moveDown(3);

            let tableY = doc.y + 20;
            doc.fillColor('#1E293B').fontSize(11).text('Roll', 50, tableY, { bold: true });
            doc.text('Student Name', 100, tableY, { bold: true });
            doc.text('Status', 280, tableY, { bold: true });
            doc.text('Remarks', 380, tableY, { bold: true });
            doc.moveTo(50, tableY + 15).lineTo(562, tableY + 15).strokeColor('#CBD5E1').stroke();

            let rowY = tableY + 25;
            students.forEach(s => {
                const isCompleted = Boolean(s.viewedAt);
                doc.fontSize(10).fillColor('#334155');
                doc.text(s.roll_no || 'N/A', 50, rowY);
                doc.text(s.studentName, 100, rowY);
                if (isCompleted) {
                    doc.fillColor('#059669').text('Seen', 280, rowY);
                } else {
                    doc.fillColor('#DC2626').text('Pending', 280, rowY);
                };
                doc.fillColor('#334155').text(s.teacherRemark || '—', 380, rowY, { width: 180 });

                rowY += 25;
                if (rowY > 700) {
                    doc.addPage();
                    rowY = 50;
                };
            });
            doc.end();
            return;
        } else {
            return res.status(400).send('Invalid export format');
        };
    } catch (error) {
        console.error('Export Report Error:', error);
        return res.status(500).send('Server Error');
    };
};

exports.downloadSubmission = async (req, res) => {
    try {
        const teacher = await teacherPermissions.getTeacherByUserOrFail(req.user.id, req.user.school_id);
        if (!teacher) {
            req.flash('error', 'Teacher profile not found.');
            return res.redirect('/teacher/dashboard');
        };

        const { submissionId } = req.params;
        const [submissions] = await db.execute(
            `SELECT hs.*, h.teacher_id, h.class_id, h.subject_id, h.school_id,
                u.first_name AS first_name, u.last_name AS last_name
            FROM homework_submissions hs
            JOIN homeworks h ON hs.homework_id = h.id
            JOIN students s ON hs.student_id = s.id
            JOIN users u ON s.user_id = u.id
            WHERE hs.id = ?
                AND h.teacher_id = ?
                AND h.school_id = ?
                AND s.school_id = h.school_id`,
            [submissionId, teacher.id, teacher.school_id]
        );

        if (submissions.length === 0) {
            req.flash('error', 'Submission not found');
            return res.redirect('back');
        };

        const submission = submissions[0];
        if (!await teacherPermissions.canTeachSubject(teacher.id, teacher.school_id, submission.class_id, submission.subject_id)) {
            req.flash('error', 'You are not assigned to teach this class/subject.');
            return res.redirect('back');
        };

        if (!submission.file_path) {
            req.flash('error', 'No file uploaded for this submission');
            return res.redirect('back');
        };

        const path = require('path');
        const fs = require('fs');
        const absolutePath = path.join(__dirname, '../../../public', submission.file_path);

        if (!fs.existsSync(absolutePath)) {
            req.flash('error', 'File not found on the server');
            return res.redirect('back');
        };

        const ext = path.extname(absolutePath);
        const studentName = `${submission.first_name}_${submission.last_name}`.replace(/[^a-zA-Z0-9]/g, '_');
        const fileName = `Submission_${studentName}_HW_${submission.homework_id}${ext}`;
        res.download(absolutePath, fileName);
    } catch (error) {
        console.error('Download Submission Error:', error);
        req.flash('error', 'Failed to download submission file');
        res.redirect('back');
    };
};

exports.getHomeworkSubmissions = async (req, res) => {
    try {
        const teacher = await teacherPermissions.getTeacherByUserOrFail(req.user.id, req.user.school_id);
        if (!teacher) {
            return res.status(403).json({ success: false, message: 'Teacher profile not found.' });
        };

        const homeworkId = req.params.id;
        const homework = await getAuthorizedHomework(homeworkId, teacher);
        if (!homework) {
            return res.status(404).json({ success: false, message: 'Homework not found or unauthorized' });
        };

        const [submissions] = await db.execute(
            `SELECT 
                s.id as studentId,
                s.roll_no,
                CONCAT(u.first_name, ' ', COALESCE(u.last_name, '')) as studentName,
                hs.id as submissionId,
                hs.file_path as submittedFile,
                hs.note as studentNote,
                hs.submitted_at as submittedAt,
                hs.viewed_at as viewedAt,
                hs.status as submissionStatus,
                hs.teacher_remark as teacherRemark
            FROM students s
            JOIN users u ON s.user_id = u.id
            LEFT JOIN homework_submissions hs ON hs.student_id = s.id AND hs.homework_id = ?
            WHERE s.class_id = ?
                AND s.school_id = ?
                AND s.status = 'active'
                AND s.deleted_at IS NULL
            ORDER BY CAST(s.roll_no AS UNSIGNED) ASC, u.first_name ASC`,
            [homeworkId, homework.class_id, teacher.school_id]
        );
        res.json({ success: true, submissions });
    } catch (error) {
        console.error('Get Homework Submissions API Error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch homework submissions' });
    };
};