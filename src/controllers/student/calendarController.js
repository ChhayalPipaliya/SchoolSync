const { queryAsync } = require("../../config/database");

const calendarController = {
    showCalendar: async (req, res) => {
        try {
            res.render("student/calendar", {
                title: "Academic Calendar - SchoolSync",
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            console.error("Student Calendar Show Error:", error);
            req.flash("error", "Failed to load calendar");
            res.redirect("/student/dashboard");
        };
    },

    getEvents: async (req, res) => {
        try {
            const schoolId = req.user.school_id;
            const { start, end } = req.query;

            let sql = `
                SELECT id, title, description, start_date AS start, end_date AS \`end\`,
                    event_type, color, target_audience
                FROM academic_events
                WHERE school_id = ?
                    AND target_audience IN ('All', 'Students')
            `;
            const params = [schoolId];
            if (start) { sql += ` AND end_date >= ?`; params.push(start); }
            if (end) { sql += ` AND start_date <= ?`; params.push(end); }

            sql += ` ORDER BY start_date ASC`;
            const events = await queryAsync(sql, params);
            const formatted = events.map(e => ({
                id: e.id,
                title: e.title,
                start: e.start,
                end: e.end || e.start,
                color: e.color,
                extendedProps: {
                    description: e.description,
                    event_type: e.event_type,
                    target_audience: e.target_audience
                }
            }));
            res.json({ success: true, events: formatted });
        } catch (error) {
            console.error("Student Get Events Error:", error);
            res.status(500).json({ success: false, message: "Failed to fetch events" });
        };
    }
};

module.exports = calendarController;