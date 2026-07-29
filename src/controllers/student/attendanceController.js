const db = require('../../config/database');
const { calculateStudentAttendanceStats, formatDateISO } = require('../../services/attendanceEngineService');

exports.myAttendance = async (req, res) => {
    try {
        const userId = req.user?.id || req.session.user?.id;
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        const { month, year } = req.query;
        const currentDate = new Date();
        const selectedMonth = month ? parseInt(month) : currentDate.getMonth() + 1;
        const selectedYear = year ? parseInt(year) : currentDate.getFullYear();

        const [students] = await db.query(
            'SELECT id FROM students WHERE user_id = ? AND school_id = ? AND deleted_at IS NULL LIMIT 1',
            [userId, schoolId]
        );

        if (!students.length) {
            req.flash('error', 'Student record not found');
            return res.redirect('/student/dashboard');
        };

        const studentId = students[0].id;
        const [attendance] = await db.query(`
            SELECT 
                date,
                status,
                DAY(date) as day
            FROM attendance 
            WHERE student_id = ? 
            AND school_id = ?
            AND MONTH(date) = ? 
            AND YEAR(date) = ?
            ORDER BY date ASC
        `, [studentId, schoolId, selectedMonth, selectedYear]);

        const startDateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
        const lastDayOfMonth = new Date(selectedYear, selectedMonth, 0).getDate();
        const endDateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(lastDayOfMonth).padStart(2, '0')}`;

        const attStats = await calculateStudentAttendanceStats(schoolId, studentId, startDateStr, endDateStr);

        const [approvedLeaves] = await db.query(`
            SELECT from_date, to_date
            FROM leaves
            WHERE user_id = (SELECT user_id FROM students WHERE id = ? LIMIT 1)
            AND school_id = ?
            AND status = 'approved'
            AND from_date <= LAST_DAY(?)
            AND to_date >= ?
        `, [studentId, schoolId, startDateStr, startDateStr]);

        const leaveDaySet = new Set();
        for (const leave of approvedLeaves) {
            const start = new Date(`${String(leave.from_date).slice(0, 10)}T00:00:00`);
            const end = new Date(`${String(leave.to_date).slice(0, 10)}T00:00:00`);
            const cur = new Date(start);
            while (cur <= end) {
                leaveDaySet.add(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`);
                cur.setDate(cur.getDate() + 1);
            };
        };

        const daysInMonth = lastDayOfMonth;
        const calendarDays = [];
        for (let i = 1; i <= daysInMonth; i++) {
            const dateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
            const dayAttendance = attendance.find(a => a.day === i);
            const dayDate = new Date(selectedYear, selectedMonth - 1, i);
            const isSunday = dayDate.getDay() === 0;

            calendarDays.push({
                day: i,
                date: dateStr,
                status: dayAttendance?.status || (isSunday ? 'holiday' : (leaveDaySet.has(dateStr) ? 'leave' : 'not_marked')),
                remark: '',
                isSunday
            });
        };

        res.render('student/attendance', {
            title: 'My Attendance',
            calendarDays,
            selectedMonth,
            selectedYear,
            stats: {
                totalDays: attStats.totalWorkingDays,
                presentDays: attStats.presentDays,
                absentDays: attStats.absentDays,
                lateDays: attStats.lateDays,
                halfDays: attStats.halfDays,
                leaveDays: attStats.leaveDays,
                pendingDays: attStats.pendingDays,
                percentage: attStats.percentage
            },
            monthlySummary: [],
            user: req.user || req.session.user
        });
    } catch (error) {
        console.error('Attendance Error:', error);
        req.flash('error', 'Failed to load attendance');
        res.redirect('/student/dashboard');
    };
};