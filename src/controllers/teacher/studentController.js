const db = require('../../config/database');
const teacherPermissions = require('../../services/teacherPermissionService');

exports.getMyStudents = async (req, res) => {
    try {
        const teacher = await teacherPermissions.getTeacherByUserOrFail(req.user.id, req.user.school_id);
        
        const [students] = await db.execute(
            `SELECT DISTINCT s.id, s.roll_no, s.user_id,
                    CONCAT_WS(' ', u.first_name, u.last_name) AS name,
                    u.email, u.phone, u.image as avatar,
                    c.class_name, c.section as section_name
             FROM students s 
             JOIN users u ON s.user_id = u.id AND u.school_id = s.school_id
             JOIN classes c ON s.class_id = c.id AND c.school_id = s.school_id
             JOIN teacher_class_assign ct
                  ON s.class_id = ct.class_id
                 AND ct.school_id = s.school_id
                 AND COALESCE(ct.status, 'active') = 'active'
             WHERE ct.teacher_id = ?
               AND s.school_id = ?
               AND s.deleted_at IS NULL
             ORDER BY c.class_name, s.roll_no`,
            [teacher.id, teacher.school_id]
        );

        res.render('teacher/students', {
            title: 'My Students',
            user: req.user,
            students,
            layout: 'teacher/layout'
        });
    } catch (error) {
        req.flash('error', 'Failed to load students');
        res.redirect('/teacher/dashboard');
    }
};

exports.getStudentProgress = async (req, res) => {
    try {
        const studentId = req.params.id;
        const teacher = await teacherPermissions.getTeacherByUserOrFail(req.user.id, req.user.school_id);
        
        if (!teacher) {
            req.flash('error', 'Access denied: Teacher profile not found');
            return res.redirect('/teacher/dashboard');
        }

        const [studentCheck] = await db.execute(
            `SELECT class_id, school_id FROM students WHERE id = ? AND deleted_at IS NULL`,
            [studentId]
        );

        if (studentCheck.length === 0) {
            req.flash('error', 'Student not found');
            return res.redirect('/teacher/students');
        }

        const student = studentCheck[0];

        if (student.school_id !== teacher.school_id) {
            req.flash('error', 'Access denied: Different school');
            return res.redirect('/teacher/students');
        }

        if (!await teacherPermissions.checkTeacherClassAccess(teacher.id, teacher.school_id, student.class_id)) {
            req.flash('error', 'You are not assigned to this class.');
            return res.redirect('/teacher/students');
        }

        const [
            [studentInfoRows],
            [attendanceStatsRows],
            [attendanceTrendRows],
            [marksRows],
            [subjectWiseAvgRows],
            [examWiseAvgRows],
            [homeworkCountRows],
            [classmatesAvgRows]
        ] = await Promise.all([

            db.execute(
                `SELECT s.id, s.roll_no, s.admission_no, s.gender, s.status, s.class_id, s.school_id,
                        CONCAT_WS(' ', u.first_name, u.last_name) AS name,
                        u.email, u.phone, u.image as avatar,
                        c.class_name, c.section as section_name
                 FROM students s
                 JOIN users u ON s.user_id = u.id AND u.school_id = s.school_id
                 JOIN classes c ON s.class_id = c.id AND c.school_id = s.school_id
                 WHERE s.id = ? AND s.school_id = ?`,
                [studentId, teacher.school_id]
            ),

            db.execute(
                `SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present,
                    SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent,
                    SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late
                 FROM attendance
                 WHERE student_id = ? AND school_id = ?`,
                [studentId, teacher.school_id]
            ),

            db.execute(
                `SELECT date, status
                 FROM attendance
                 WHERE student_id = ? AND school_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                 ORDER BY date ASC`,
                [studentId, teacher.school_id]
            ),

            db.execute(
                `SELECT 
                    m.obtained_marks,
                    m.total_marks,
                    m.grade,
                    m.grade_point,
                    m.status as pass_fail,
                    e.name as exam_name,
                    e.exam_type,
                    s.subject_name,
                    s.code as subject_code
                 FROM marks m
                 JOIN exams e ON m.exam_id = e.id
                 JOIN subjects s ON m.subject_id = s.id
                 WHERE m.student_id = ? AND m.school_id = ?
                 ORDER BY e.start_date DESC, s.subject_name ASC`,
                [studentId, teacher.school_id]
            ),

            db.execute(
                `SELECT 
                    s.id as subject_id,
                    s.subject_name,
                    s.code as subject_code,
                    AVG((m.obtained_marks / m.total_marks) * 100) as avg_percentage
                 FROM marks m
                 JOIN subjects s ON m.subject_id = s.id
                 WHERE m.student_id = ? AND m.school_id = ?
                 GROUP BY s.id, s.subject_name, s.code`,
                [studentId, teacher.school_id]
            ),

            db.execute(
                `SELECT 
                    e.id as exam_id,
                    e.name as exam_name,
                    e.exam_type,
                    AVG((m.obtained_marks / m.total_marks) * 100) as exam_percentage
                 FROM marks m
                 JOIN exams e ON m.exam_id = e.id
                 WHERE m.student_id = ? AND m.school_id = ?
                 GROUP BY e.id, e.name, e.exam_type, e.start_date
                 ORDER BY e.start_date ASC`,
                [studentId, teacher.school_id]
            ),

            db.execute(
                `SELECT COUNT(*) as count 
                 FROM homeworks 
                 WHERE class_id = ? AND school_id = ? AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')`,
                [student.class_id, teacher.school_id]
            ),

            db.execute(
                `SELECT 
                     s.id as student_id,
                     COALESCE(AVG((m.obtained_marks / m.total_marks) * 100), 0) as overall_avg
                 FROM students s
                 LEFT JOIN marks m ON s.id = m.student_id AND m.school_id = s.school_id
                 WHERE s.class_id = ? AND s.school_id = ? AND s.status = 'active'
                 GROUP BY s.id`,
                [student.class_id, teacher.school_id]
            )
        ]);

        const studentInfo = studentInfoRows[0];
        if (!studentInfo) {
            req.flash('error', 'Student not found');
            return res.redirect('/teacher/students');
        }

        const totalAttendance = attendanceStatsRows[0].total || 0;
        const presentCount = attendanceStatsRows[0].present || 0;
        const absentCount = attendanceStatsRows[0].absent || 0;
        const lateCount = attendanceStatsRows[0].late || 0;
        const attendancePercentage = totalAttendance > 0 ? ((presentCount + lateCount) / totalAttendance) * 100 : 0;

        const sortedClassmates = [...classmatesAvgRows].sort((a, b) => b.overall_avg - a.overall_avg);
        const studentIndex = sortedClassmates.findIndex(c => c.student_id === parseInt(studentId));
        const rank = studentIndex !== -1 ? studentIndex + 1 : sortedClassmates.length;
        const totalClassmates = sortedClassmates.length;
        const classmatesAvg = classmatesAvgRows.length > 0
            ? classmatesAvgRows.reduce((sum, row) => sum + parseFloat(row.overall_avg), 0) / classmatesAvgRows.length
            : 0;
        const studentAvg = sortedClassmates.find(c => c.student_id === parseInt(studentId))?.overall_avg || 0;

        const last30Days = [];
        for (let i = 29; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const dateStr = `${yyyy}-${mm}-${dd}`;
            last30Days.push({
                date: dateStr,
                displayDate: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
                status: 'no data'
            });
        }

        attendanceTrendRows.forEach(row => {
            const d = new Date(row.date);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const rowDateStr = `${yyyy}-${mm}-${dd}`;
            
            const dayObj = last30Days.find(day => day.date === rowDateStr);
            if (dayObj) {
                dayObj.status = row.status;
            }
        });

        const examNames = [...new Set(marksRows.map(m => m.exam_name))].reverse();
        const subjectNames = [...new Set(marksRows.map(m => m.subject_name))];

        const datasets = subjectNames.map((subject, idx) => {
            const colors = ['#4F46E5','#059669','#D97706','#DC2626','#0284C7','#DB2777','#EA580C','#7C3AED'];
            const color = colors[idx % colors.length];
            const data = examNames.map(examName => {
                const match = marksRows.find(m => m.subject_name === subject && m.exam_name === examName);
                return match ? parseFloat(((match.obtained_marks / match.total_marks) * 100).toFixed(1)) : null;
            });
            return {
                label: subject,
                data: data,
                borderColor: color,
                backgroundColor: color,
                fill: false,
                tension: 0.4,
                pointRadius: 4
            };
        });

        const radarLabels = subjectWiseAvgRows.map(row => row.subject_name);
        const radarData = subjectWiseAvgRows.map(row => parseFloat(parseFloat(row.avg_percentage).toFixed(1)));
        const barLabels = examWiseAvgRows.map(row => row.exam_name);
        const barData = examWiseAvgRows.map(row => parseFloat(parseFloat(row.exam_percentage).toFixed(1)));

        res.render('teacher/studentProgress', {
            title: 'Student Progress',
            user: req.user,
            studentInfo,
            attendance: {
                total: totalAttendance,
                present: presentCount,
                absent: absentCount,
                late: lateCount,
                percentage: attendancePercentage
            },
            last30Days,
            marks: marksRows,
            studentAvgFormatted: parseFloat(studentAvg).toFixed(1),
            rank,
            totalClassmates,
            classmatesAvg: parseFloat(classmatesAvg).toFixed(1),
            homeworkCount: homeworkCountRows[0].count || 0,
            examNames,
            datasets,
            radarLabels,
            radarData,
            barLabels,
            barData,
            currentPath: '/teacher/students',
            layout: false 
        });
    } catch (error) {
        console.error('getStudentProgress error:', error);
        req.flash('error', 'Failed to load student progress');
        res.redirect('/teacher/students');
    }
};
