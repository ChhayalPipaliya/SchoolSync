const db = require('../../config/database');
const teacherPermissions = require('../../services/teacherPermissionService');

const todayLocal = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const normalizeStudentAttendanceStatus = (status) => {
    if (['present', 'absent', 'late'].includes(status)) return status;
    return 'absent';
};

exports.getMarkAttendance = async (req, res) => {
    try {
        const teacher = await teacherPermissions.getTeacherByUserOrFail(req.user.id, req.user.school_id);
        if (!teacher) {
            req.flash('error', 'Teacher profile not found. Please contact administration.');
            return res.redirect('/teacher/dashboard');
        }
        
        const classId = req.query.classId || req.query.class_id;
        const date = req.query.date || todayLocal();

        let students = [];
        let attendanceData = [];
        
        if (classId && date) {
            if (!await teacherPermissions.checkTeacherClassAccess(teacher.id, teacher.school_id, classId)) {
                req.flash('error', 'You are not assigned to this class.');
                return res.redirect('/teacher/attendance');
            }

            const [studentRows] = await db.execute(
                `SELECT s.id, s.roll_no, s.user_id, CONCAT_WS(' ', u.first_name, u.last_name) AS name
                 FROM students s 
                 JOIN users u ON s.user_id = u.id 
                 WHERE s.class_id = ? AND s.school_id = ? AND s.deleted_at IS NULL
                 ORDER BY CAST(s.roll_no AS UNSIGNED) ASC, s.roll_no ASC`,
                [classId, teacher.school_id]
            );
            students = studentRows;

            const [attRows] = await db.execute(
                `SELECT student_id, status, remark FROM attendance
                 WHERE class_id = ? AND date = ? AND school_id = ?`,
                [classId, date, teacher.school_id]
            );
            attendanceData = attRows;
        }

        const classes = await teacherPermissions.getAssignedClassesForTeacher(teacher.id, teacher.school_id);

        res.render('teacher/attendance', {
            title: 'Mark Attendance',
            user: req.user,
            classes,
            students,
            attendanceData,
            selectedClass: classId,
            selectedDate: date,
            layout: 'teacher/layout'
        });
    } catch (error) {
        console.error('Attendance Error:', error);
        req.flash('error', 'Failed to load attendance');
        res.redirect('/teacher/dashboard');
    }
};

exports.postMarkAttendance = async (req, res) => {
    try {
        const teacher = await teacherPermissions.getTeacherByUserOrFail(req.user.id, req.user.school_id);
        if (!teacher) {
            req.flash('error', 'Teacher profile not found. Please contact administration.');
            return res.redirect('/teacher/dashboard');
        }

        const { class_id, date, attendance } = req.body;
        if (!class_id || !date) {
            req.flash('error', 'Class and date are required.');
            return res.redirect('/teacher/attendance');
        }

        if (!await teacherPermissions.checkTeacherClassAccess(teacher.id, teacher.school_id, class_id)) {
            req.flash('error', 'You are not assigned to this class.');
            return res.redirect('/teacher/attendance');
        }

        const conn = await db.getConnection();
        await conn.beginTransaction();

        const absentStudentIds = [];

        try {
            for (const [key, data] of Object.entries(attendance || {})) {
                const studentId = Number(String(key).replace('student_', ''));
                const status = normalizeStudentAttendanceStatus(data.status);
                const remark = data.remark || null;

                const [studentRows] = await conn.execute(
                    'SELECT id FROM students WHERE id = ? AND school_id = ? AND class_id = ? AND deleted_at IS NULL LIMIT 1',
                    [studentId, teacher.school_id, class_id]
                );
                if (!studentRows.length) continue;

                await conn.execute(
                    `INSERT INTO attendance (school_id, class_id, student_id, marked_by, date, status, remark, source)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 'teacher')
                     ON DUPLICATE KEY UPDATE class_id = VALUES(class_id), marked_by = VALUES(marked_by), status = VALUES(status), remark = VALUES(remark), source = VALUES(source)`,
                    [teacher.school_id, class_id, studentId, req.user.id, date, status, remark]
                );

                if (status === 'absent') {
                    absentStudentIds.push(studentId);
                }
            }
            await conn.commit();
            req.flash('success', 'Attendance marked successfully');
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }

        if (absentStudentIds.length > 0) {
            const NotificationService = require('../../services/notificationService');
            const templates = require('../../utils/notificationTemplates');
            const NotificationModel = require('../../models/notificationModel');

            for (const sId of absentStudentIds) {
                db.query(`
                    SELECT s.user_id, sf.father_email, sf.mother_email 
                    FROM students s
                    LEFT JOIN student_family sf ON s.id = sf.student_id
                    WHERE s.id = ?
                `, [sId]).then(([rows]) => {
                    if (rows && rows.length > 0) {
                        const row = rows[0];
                        NotificationService.createAndSend({
                            recipient_id: row.user_id,
                            recipient_role: "student",
                            school_id: teacher.school_id,
                            created_by: req.user.id,
                            ...templates.studentAbsent(date)
                        }).catch(err => console.error("Student absent notification error:", err));

                        const parentEmails = [row.father_email, row.mother_email].filter(Boolean);
                        for (const pEmail of parentEmails) {
                            NotificationModel.enqueueEmail(
                                pEmail,
                                `[SchoolSync] Student Absent Notification`,
                                `<div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #edf2f7; border-radius: 8px;">
                                    <h2 style="color: #e53e3e;">Absent Alert</h2>
                                    <p>Dear Parent,</p>
                                    <p>Please note that your child was marked <b>ABSENT</b> on <b>${new Date(date).toLocaleDateString('en-IN')}</b>.</p>
                                    <p style="font-size: 12px; color: #a0aec0; margin-top: 20px;">SchoolSync Administration</p>
                                 </div>`
                            ).catch(err => console.error("Parent email queue error:", err));
                        }
                    }
                }).catch(err => console.error("Query student parent emails failed:", err));
            }
        }

        res.redirect(`/teacher/attendance?classId=${class_id}&date=${date}`);
    } catch (error) {
        console.error('Mark Attendance Error:', error);
        req.flash('error', 'Failed to mark attendance');
        res.redirect('/teacher/attendance');
    }
};

exports.teacherMonthlyReport = async (req, res) => {
  try {
    const { class_id, month } = req.query;
    const teacher = await teacherPermissions.getTeacherByUserOrFail(req.user.id, req.user.school_id);
    if (!teacher) {
        req.flash('error', 'Teacher profile not found. Please contact administration.');
        return res.redirect('/teacher/dashboard');
    }
    const targetMonth = month || new Date().toISOString().slice(0, 7); 
    const [y, m] = targetMonth.split('-');

    const classes = await teacherPermissions.getAssignedClassesForTeacher(teacher.id, teacher.school_id);

    let cls = null;
    let students = [];
    let attendanceMap = {};
    let days = [];

    const selectedClassId = class_id || (classes.length > 0 ? classes[0].id : null);

    if (selectedClassId) {
      cls = classes.find(c => String(c.id) === String(selectedClassId));
      
      if (cls) {
        const totalDays = new Date(y, m, 0).getDate();
        for (let d = 1; d <= totalDays; d++) {
          const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const dateObj = new Date(parseInt(y), parseInt(m) - 1, d);
          const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
          const isHoliday = dayName === 'Sun';
          days.push({ date: dateStr, day: d, dayName, isHoliday });
        }

        const [studentRows] = await db.execute(
          `SELECT s.id, u.first_name as first_name, u.last_name as last_name, s.roll_no as roll_no 
           FROM students s 
           JOIN users u ON s.user_id = u.id 
           WHERE s.class_id = ? AND s.school_id = ? 
           ORDER BY CAST(s.roll_no AS UNSIGNED) ASC, s.roll_no ASC`,
          [selectedClassId, teacher.school_id]
        );
        students = studentRows;

        const studentIds = students.map(s => s.id);
        if (studentIds.length > 0) {
          const [records] = await db.query(
            `SELECT student_id, DATE_FORMAT(date, '%Y-%m-%d') as dateStr, status 
             FROM attendance 
             WHERE student_id IN (?) AND DATE_FORMAT(date, '%Y-%m') = ? AND school_id = ?`,
            [studentIds, targetMonth, teacher.school_id]
          );

          for (const r of records) {
            if (!attendanceMap[r.student_id]) {
              attendanceMap[r.student_id] = {};
            }
            attendanceMap[r.student_id][r.dateStr] = r.status;
          }
        }
      } else {
        req.flash('error', 'You are not assigned to this class.');
        return res.redirect('/teacher/attendance/monthly');
      }
    }

    res.render('teacher/attendanceMonthly', {
      title: 'Monthly Attendance Report',
      user: req.user,
      classes,
      cls,
      class_id: selectedClassId,
      month: targetMonth,
      students,
      attendanceMap,
      days,
      layout: 'teacher/layout'
    });
  } catch (error) {
    console.error('Monthly Attendance Error:', error);
    req.flash('error', 'Failed to load monthly attendance');
    res.redirect('/teacher/dashboard');
  }
};
