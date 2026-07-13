const { queryAsync } = require("../../config/database");

const resolveDriverSchoolId = async (user) => {
    if (user.school_id) return user.school_id;
    const rows = await queryAsync(
        "SELECT school_id FROM drivers WHERE user_id = ? ORDER BY id DESC LIMIT 1",
        [user.id]
    );
    return rows[0]?.school_id || null;
};

const makeInitials = (driver) => ((driver?.first_name?.charAt(0) || "") + (driver?.last_name?.charAt(0) || "")).toUpperCase();
const thisMonth = () => new Date().toISOString().slice(0, 7);

const getDaysInMonth = (yearMonth) => {
    const [y, m] = yearMonth.split("-").map(Number);
    const total = new Date(y, m, 0).getDate();
    const days = [];
    for (let d = 1; d <= total; d++) {
        const dateStr = `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
        const dateObj = new Date(dateStr);
        const dayName = dateObj.toLocaleDateString("en-US", { weekday: "short" });
        const isHoliday = dayName === "Sun";
        days.push({ date: dateStr, day: d, dayName, isHoliday });
    };
    return days;
};

exports.attendancePage = async (req, res) => {
    try {
        const userId = req.user.id;
        const schoolId = await resolveDriverSchoolId(req.user);
        const month = req.query.month || thisMonth();
        const [y, m] = month.split("-");
        const dr = await queryAsync(
            "SELECT * FROM drivers WHERE user_id=? AND school_id=? LIMIT 1",
            [userId, schoolId]
        );

        if (!dr.length) {
            req.flash("error", "Driver not found.");
            return res.redirect("/driver/dashboard");
        };
        
        const driver = dr[0];
        const [records, ov] = await Promise.all([
            queryAsync(
                "SELECT DATE_FORMAT(date,'%Y-%m-%d') AS date, status FROM driver_attendance WHERE driver_id=? AND school_id=? AND YEAR(date)=? AND MONTH(date)=? ORDER BY date ASC",
                [driver.id, schoolId, y, m]
            ),
            queryAsync(
                "SELECT COUNT(*) AS total, SUM(status='present') AS present, SUM(status='absent') AS absent, SUM(status='late') AS late, SUM(status='half-day') AS half_day, SUM(status='leave') AS leave_days FROM driver_attendance WHERE driver_id=? AND school_id=?",
                [driver.id, schoolId]
            )
        ]);

        const attendanceMap = {};
        for (const r of records) attendanceMap[r.date] = r.status;
        const monthStats = {
            total: records.length,
            present: records.filter(r => r.status === "present").length,
            absent: records.filter(r => r.status === "absent").length,
            late: records.filter(r => r.status === "late").length,
            half_day: records.filter(r => r.status === "half-day").length,
            leave_days: records.filter(r => r.status === "leave").length
        };
    
        monthStats.percentage = monthStats.total ? Math.round(((monthStats.present + monthStats.late + (monthStats.half_day * 0.5)) / monthStats.total) * 100) : 0;
        const overall = ov[0] || { total: 0, present: 0, absent: 0, late: 0 };
        overall.percentage = Number(overall.total) ? Math.round(((Number(overall.present || 0) + Number(overall.late || 0) + (Number(overall.half_day || 0) * 0.5)) / Number(overall.total)) * 100) : 0;

        return res.render("driver/attendance", {
            user: req.user,
            driver,
            attendanceMap,
            days: getDaysInMonth(month),
            month,
            monthStats,
            overall,
            driverInitials: makeInitials(driver)
        });
    } catch (err) {
        console.error(err);
        req.flash("error", "Failed to load attendance.");
        return res.redirect("/driver/dashboard");
    };
};