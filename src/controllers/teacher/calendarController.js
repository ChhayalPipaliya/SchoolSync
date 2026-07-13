const { queryAsync, executeAsync } = require("../../config/database");

const calendarController = {
    showCalendar: async (req, res) => {
        try {
            res.render("teacher/calendar", {
                title: "Academic Calendar - SchoolSync",
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            console.error("Teacher Calendar Show Error:", error);
            req.flash("error", "Failed to load calendar");
            res.redirect("/teacher/dashboard");
        }
    },

    getEvents: async (req, res) => {
        try {
            const schoolId = req.user.school_id;
            const { start, end } = req.query;

            let sql = `
                SELECT id, title, description, start_date AS start, end_date AS \`end\`,
                    event_type, color, target_audience, status, created_by
                FROM academic_events
                WHERE school_id = ?
                    AND (status = 'approved' OR (status = 'pending' AND created_by = ?))
                    AND target_audience IN ('All', 'Teachers')
            `;
            const params = [schoolId, req.user.id];

            if (start) { sql += ` AND end_date >= ?`; params.push(start); }
            if (end)   { sql += ` AND start_date <= ?`; params.push(end); }

            sql += ` ORDER BY start_date ASC`;
            const events = await queryAsync(sql, params);
            const formatted = events.map(e => ({
                id: e.id,
                title: e.status === 'pending' ? `[SUGGESTED] ${e.title}` : e.title,
                start: e.start,
                end: e.end || e.start,
                color: e.status === 'pending' ? '#94A3B8' : e.color,
                extendedProps: {
                    description: e.description,
                    event_type: e.event_type,
                    target_audience: e.target_audience,
                    status: e.status,
                    created_by: e.created_by
                }
            }));
            res.json({ success: true, events: formatted });
        } catch (error) {
            console.error("Teacher Get Events Error:", error);
            res.status(500).json({ success: false, message: "Failed to fetch events" });
        };
    },

    suggestEvent: async (req, res) => {
        try {
            const schoolId = req.user.school_id;
            const { title, description, start_date, end_date, event_type, target_audience } = req.body;

            if (!title || !start_date) {
                return res.status(400).json({ success: false, message: "Title and start date are required" });
            };

            const result = await executeAsync(
                `INSERT INTO academic_events (school_id, title, description, start_date, end_date, event_type, color, target_audience, created_by, status, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,'pending',NOW(),NOW())`,
                [ schoolId, title, description || null, start_date, end_date || null, event_type || 'Event', '#94A3B8', target_audience || 'All', req.user.id || null ]
            );

            res.json({ success: true, id: result.insertId, message: "Event suggestion submitted successfully!" });
        } catch (error) {
            console.error("Teacher Suggest Event Error:", error);
            res.status(500).json({ success: false, message: "Failed to submit event suggestion" });
        };
    },

    deleteSuggestedEvent: async (req, res) => {
        try {
            const schoolId = req.user.school_id;
            const eventId = req.params.id;

            const existing = await queryAsync(
                `SELECT id, status, created_by FROM academic_events WHERE id = ? AND school_id = ? LIMIT 1`,
                [eventId, schoolId]
            );

            if (!existing.length) {
                return res.status(404).json({ success: false, message: "Event suggestion not found" });
            };

            if (existing[0].status !== 'pending' || existing[0].created_by !== req.user.id) {
                return res.status(403).json({ success: false, message: "You can only delete your own pending suggestions" });
            };

            await executeAsync(
                `DELETE FROM academic_events WHERE id = ? AND school_id = ?`,
                [eventId, schoolId]
            );

            res.json({ success: true, message: "Event suggestion deleted successfully" });
        } catch (error) {
            console.error("Teacher Delete Suggested Event Error:", error);
            res.status(500).json({ success: false, message: "Failed to delete event suggestion" });
        };
    }
};

module.exports = calendarController;