const db = require('../../config/database');

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
        }

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

        const totalDays = attendance.length;
        const presentDays = attendance.filter(a => a.status === 'present').length;
        const absentDays = attendance.filter(a => a.status === 'absent').length;
        const lateDays = attendance.filter(a => a.status === 'late').length;
        const attendedDays = presentDays + lateDays;
        const [monthlySummary] = await db.query(`
            SELECT 
                MONTH(date) as month,
                YEAR(date) as year,
                COUNT(*) as total,
                SUM(CASE WHEN status IN ('present', 'late') THEN 1 ELSE 0 END) as present
            FROM attendance 
            WHERE student_id = ? 
            AND school_id = ?
            AND date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
            GROUP BY YEAR(date), MONTH(date)
            ORDER BY year DESC, month DESC
        `, [studentId, schoolId]);

        const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();
        const calendarDays = [];
        for (let i = 1; i <= daysInMonth; i++) {
            const dateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
            const dayAttendance = attendance.find(a => a.day === i);
            const dayDate = new Date(selectedYear, selectedMonth - 1, i);
            const isSunday = dayDate.getDay() === 0;

            calendarDays.push({
                day: i,
                date: dateStr,
                status: dayAttendance?.status || (isSunday ? 'holiday' : 'not_marked'),
                remark: '',
                isSunday
            });
        }

        res.render('student/attendance', {
            title: 'My Attendance',
            calendarDays,
            selectedMonth,
            selectedYear,
            stats: {
                totalDays,
                presentDays,
                absentDays,
                lateDays,
                halfDays: 0,
                percentage: totalDays > 0 ? Math.round((attendedDays / totalDays) * 100) : 0
            },
            monthlySummary,
            user: req.session.user
        });
    } catch (error) {
        console.error('Attendance Error:', error);
        req.flash('error', 'Failed to load attendance');
        res.redirect('/student/dashboard');
    }
};
