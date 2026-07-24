const { queryAsync, executeAsync } = require("../../config/database");

async function getGroupAdminSchools(userId) {
    const gaList = await queryAsync("SELECT id, school_group_id FROM group_admins WHERE user_id = ? LIMIT 1", [userId]);
    const ga = (gaList && gaList.length > 0) ? gaList[0] : null;
    if (!ga) return [];

    const schools = await queryAsync(
        `SELECT s.id, s.school_name, s.branch_name
        FROM group_admin_schools gas
        JOIN schools s ON s.id = gas.school_id
        WHERE gas.group_admin_id = ? AND gas.status = 'active'`,
        [ga.id]
    );
    return schools || [];
}

const groupCalendarController = {
    showCalendar: async (req, res) => {
        try {
            const schools = await getGroupAdminSchools(req.user.id);
            res.render("groupAdmin/calendar", {
                title: "Academic Calendar - Group Admin | SchoolSync",
                user: req.user,
                schools,
                currentPath: req.path
            });
        } catch (error) {
            console.error("Group Calendar Show Error:", error);
            req.flash("error", "Failed to load academic calendar");
            res.redirect("/groupadmin/dashboard");
        }
    },

    getEvents: async (req, res) => {
        try {
            const schools = await getGroupAdminSchools(req.user.id);
            if (!schools.length) {
                return res.json({ success: true, events: [] });
            }

            const schoolIds = schools.map(s => s.id);
            const { school_id, start, end } = req.query;

            let targetSchoolIds = schoolIds;
            if (school_id && school_id !== 'all') {
                const parsed = parseInt(school_id, 10);
                if (schoolIds.includes(parsed)) {
                    targetSchoolIds = [parsed];
                }
            }

            let sql = `
                SELECT ae.id, ae.school_id, s.school_name, ae.title, ae.description,
                       ae.start_date AS start, ae.end_date AS \`end\`,
                       ae.event_type, ae.color, ae.target_audience, ae.created_by, ae.status
                FROM academic_events ae
                LEFT JOIN schools s ON s.id = ae.school_id
                WHERE ae.school_id IN (?)
            `;
            const params = [targetSchoolIds];

            if (start) { sql += ` AND ae.end_date >= ?`; params.push(start); }
            if (end) { sql += ` AND ae.start_date <= ?`; params.push(end); }

            sql += ` ORDER BY ae.start_date ASC`;
            const events = await queryAsync(sql, params);

            const formatted = events.map(e => ({
                id: e.id,
                title: e.status === 'pending' ? `[SUGGESTED] ${e.title}` : `[${e.school_name || 'School'}] ${e.title}`,
                start: e.start,
                end: e.end || e.start,
                color: e.status === 'pending' ? '#94A3B8' : (e.color || eventTypeColor(e.event_type)),
                extendedProps: {
                    school_id: e.school_id,
                    school_name: e.school_name,
                    description: e.description,
                    event_type: e.event_type,
                    target_audience: e.target_audience,
                    status: e.status,
                    created_by: e.created_by
                }
            }));

            res.json({ success: true, events: formatted });
        } catch (error) {
            console.error("Group Admin Get Events Error:", error);
            res.status(500).json({ success: false, message: "Failed to fetch academic events" });
        }
    },

    createEvent: async (req, res) => {
        try {
            const schools = await getGroupAdminSchools(req.user.id);
            const schoolIds = schools.map(s => s.id);

            const { school_id, title, description, start_date, end_date, event_type, color, target_audience } = req.body;

            if (!title || !start_date) {
                return res.status(400).json({ success: false, message: "Title and start date are required" });
            }

            let targetIds = [];
            if (school_id === 'all') {
                targetIds = schoolIds;
            } else {
                const parsed = parseInt(school_id, 10);
                if (schoolIds.includes(parsed)) {
                    targetIds = [parsed];
                } else if (schoolIds.length > 0) {
                    targetIds = [schoolIds[0]];
                }
            }

            for (const sid of targetIds) {
                await executeAsync(
                    `INSERT INTO academic_events (school_id, title, description, start_date, end_date, event_type, color, target_audience, created_by, status, created_at, updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?, 'approved', NOW(), NOW())`,
                    [
                        sid, title, description || null, start_date, end_date || null,
                        event_type || 'Event', color || eventTypeColor(event_type || 'Event'),
                        target_audience || 'All', req.user.id || null
                    ]
                );
            }

            res.json({ success: true, message: `Event created successfully for ${targetIds.length} school(s)` });
        } catch (error) {
            console.error("Group Admin Create Event Error:", error);
            res.status(500).json({ success: false, message: "Failed to create event" });
        }
    },

    updateEvent: async (req, res) => {
        try {
            const schools = await getGroupAdminSchools(req.user.id);
            const schoolIds = schools.map(s => s.id);
            const eventId = req.params.id;

            const { title, description, start_date, end_date, event_type, color, target_audience, status } = req.body;

            const existing = await queryAsync(
                `SELECT id FROM academic_events WHERE id = ? AND school_id IN (?) LIMIT 1`,
                [eventId, schoolIds]
            );

            if (!existing.length) {
                return res.status(404).json({ success: false, message: "Event not found or permission denied" });
            }

            await executeAsync(
                `UPDATE academic_events
                SET title=?, description=?, start_date=?, end_date=?, event_type=?, color=?, target_audience=?, status=?, updated_at=NOW()
                WHERE id=?`,
                [title, description || null, start_date, end_date || null, event_type || 'Event', color || eventTypeColor(event_type || 'Event'), target_audience || 'All', status || 'approved', eventId]
            );

            res.json({ success: true, message: "Event updated successfully" });
        } catch (error) {
            console.error("Group Admin Update Event Error:", error);
            res.status(500).json({ success: false, message: "Failed to update event" });
        }
    },

    deleteEvent: async (req, res) => {
        try {
            const schools = await getGroupAdminSchools(req.user.id);
            const schoolIds = schools.map(s => s.id);
            const eventId = req.params.id;

            const result = await executeAsync(
                `DELETE FROM academic_events WHERE id = ? AND school_id IN (?)`,
                [eventId, schoolIds]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: "Event not found or permission denied" });
            }

            res.json({ success: true, message: "Event deleted successfully" });
        } catch (error) {
            console.error("Group Admin Delete Event Error:", error);
            res.status(500).json({ success: false, message: "Failed to delete event" });
        }
    }
};

function eventTypeColor(type) {
    const colors = {
        Holiday: '#EF4444',
        Exam: '#F59E0B',
        Event: '#3B82F6',
        Meeting: '#8B5CF6',
        Note: '#06B6D4'
    };
    return colors[type] || '#3B82F6';
}

module.exports = groupCalendarController;
