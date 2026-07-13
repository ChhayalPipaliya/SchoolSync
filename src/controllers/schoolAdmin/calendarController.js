const { queryAsync, executeAsync } = require("../../config/database");

const calendarController = {
    showCalendar: async (req, res) => {
        try {
            res.render("schoolAdmin/calendar", {
                title: "Academic Calendar - SchoolSync",
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            console.error("Calendar Show Error:", error);
            req.flash("error", "Failed to load calendar");
            res.redirect("/schooladmin/dashboard");
        };
    },

    getEvents: async (req, res) => {
        try {
            const schoolId = req.user.school_id;
            const { start, end } = req.query;

            let sql = `
                SELECT id, title, description, start_date AS start, end_date AS \`end\`,
                    event_type, color, target_audience, created_by, status
                FROM academic_events
                WHERE school_id = ?
            `;
            const params = [schoolId];

            if (start) { sql += ` AND end_date >= ?`; params.push(start); }
            if (end) { sql += ` AND start_date <= ?`; params.push(end); }

            sql += ` ORDER BY start_date ASC`;
            const events = await queryAsync(sql, params);
            const formatted = events.map(e => ({
                id: e.id,
                title: e.status === 'pending' ? `[SUGGESTED] ${e.title}` : e.title,
                start: e.start,
                end: e.end || e.start,
                color: e.status === 'pending' ? '#94A3B8' : (e.color || eventTypeColor(e.event_type)),
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
            console.error("Get Events Error:", error);
            res.status(500).json({ success: false, message: "Failed to fetch events" });
        };
    },

    createEvent: async (req, res) => {
        try {
            const schoolId = req.user.school_id;
            const { title, description, start_date, end_date, event_type, color, target_audience } = req.body;

            if (!title || !start_date) {
                return res.status(400).json({ success: false, message: "Title and start date are required" });
            };

            const result = await executeAsync(
                `INSERT INTO academic_events (school_id, title, description, start_date, end_date, event_type, color, target_audience, created_by, status, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?, 'approved', NOW(), NOW())`,
                [ schoolId, title, description || null, start_date, end_date || null, event_type || 'Event', color || eventTypeColor(event_type || 'Event'), target_audience || 'All', req.user.id || null ]
            );
            res.json({ success: true, id: result.insertId, message: "Event created successfully" });
        } catch (error) {
            console.error("Create Event Error:", error);
            res.status(500).json({ success: false, message: "Failed to create event" });
        };
    },

    updateEvent: async (req, res) => {
        try {
            const schoolId = req.user.school_id;
            const eventId = req.params.id;
            const { title, description, start_date, end_date, event_type, color, target_audience, status } = req.body;
            const existing = await queryAsync(
                `SELECT id FROM academic_events WHERE id = ? AND school_id = ? LIMIT 1`,
                [eventId, schoolId]
            );

            if (!existing.length) {
                return res.status(404).json({ success: false, message: "Event not found" });
            };

            await executeAsync(
                `UPDATE academic_events
                SET title=?, description=?, start_date=?, end_date=?, event_type=?, color=?, target_audience=?, status=?, updated_at=NOW()
                WHERE id=? AND school_id=?`,
                [ title, description || null, start_date, end_date || null, event_type || 'Event', color || eventTypeColor(event_type || 'Event'), target_audience || 'All', status || 'approved', eventId, schoolId ]
            );
            res.json({ success: true, message: "Event updated successfully" });
        } catch (error) {
            console.error("Update Event Error:", error);
            res.status(500).json({ success: false, message: "Failed to update event" });
        };
    },

    deleteEvent: async (req, res) => {
        try {
            const schoolId = req.user.school_id;
            const eventId = req.params.id;
            const result = await executeAsync(
                `DELETE FROM academic_events WHERE id = ? AND school_id = ?`,
                [eventId, schoolId]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: "Event not found" });
            };

            res.json({ success: true, message: "Event deleted successfully" });
        } catch (error) {
            console.error("Delete Event Error:", error);
            res.status(500).json({ success: false, message: "Failed to delete event" });
        };
    }
};

function eventTypeColor(type) {
    const colors = {
        Holiday: '#EF4444',
        Exam: '#F59E0B',
        Event: '#3B82F6',
        Meeting: '#8B5CF6'
    };
    return colors[type] || '#3B82F6';
}

module.exports = calendarController;