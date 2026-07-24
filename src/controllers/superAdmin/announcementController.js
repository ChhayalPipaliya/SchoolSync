const { queryAsync, executeAsync } = require("../../config/database");

const announcementController = {
    list: async (req, res) => {
        try {
            const announcements = await queryAsync(`
                SELECT 
                    a.*,
                    p.name as target_plan_name,
                    (SELECT COUNT(*) FROM announcement_schools WHERE announcement_id = a.id) as school_count,
                    (SELECT COUNT(*) FROM announcement_schools WHERE announcement_id = a.id AND is_read = TRUE) as read_count
                FROM announcements a
                LEFT JOIN plans p ON a.target_plan_id = p.id
                ORDER BY a.is_pinned DESC, a.created_at DESC
            `);

            res.render("superAdmin/announcements/list", {
                title: "Announcements CMS - SchoolSync",
                announcements,
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            console.error("List Announcements Error:", error);
            req.flash("error", "Failed to load announcements");
            res.redirect("/superadmin/dashboard");
        };
    },

    addForm: async (req, res) => {
        try {
            const plans = await queryAsync("SELECT id, name FROM plans WHERE is_active = TRUE");
            const schools = await queryAsync("SELECT id, school_name FROM schools WHERE status = 'active'");

            res.render("superAdmin/announcements/form", {
                title: "Add Announcement - SchoolSync",
                announcement: null,
                plans,
                schools,
                selectedSchools: [],
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            req.flash("error", "Failed to load form");
            res.redirect("/superadmin/announcements");
        };
    },

    create: async (req, res) => {
        try {
            const { title, content, notice_type, priority, target_type, target_plan_id, target_schools, published_at, expires_at, is_pinned, scheduled_at } = req.body;
            const result = await executeAsync(
                `INSERT INTO announcements 
                (title, content, notice_type, priority, target_type, target_plan_id, is_active, published_at, expires_at, is_pinned, scheduled_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [ title, content, notice_type || 'info', priority || 'normal', target_type || 'all', target_plan_id || null, 1, published_at || new Date(), expires_at || null, is_pinned ? 1 : 0, scheduled_at || null ]
            );

            if (target_type === 'specific_schools') {
                const rawSchools = target_schools || req.body['target_schools[]'];
                const schoolsArray = rawSchools ? (Array.isArray(rawSchools) ? rawSchools : [rawSchools]) : [];
                for (const schoolId of schoolsArray) {
                    await executeAsync(
                        "INSERT INTO announcement_schools (announcement_id, school_id) VALUES (?, ?)",
                        [result.insertId, schoolId]
                    );
                };
            };

            if (target_type === 'plan_based' && target_plan_id) {
                const schools = await queryAsync(
                    "SELECT id FROM schools WHERE plan_id = ? AND status = 'active'",
                    [target_plan_id]
                );
                for (const school of schools) {
                    await executeAsync(
                        "INSERT INTO announcement_schools (announcement_id, school_id) VALUES (?, ?)",
                        [result.insertId, school.id]
                    );
                };
            };

            req.flash("success", "Announcement broadcast scheduled and published successfully.");
            res.redirect("/superadmin/announcements");
        } catch (error) {
            console.error("Create Announcement Error:", error);
            req.flash("error", "Failed to create announcement");
            res.redirect("/superadmin/announcements/add");
        };
    },

    editForm: async (req, res) => {
        try {
            const [announcement] = await queryAsync(
                "SELECT * FROM announcements WHERE id = ?",
                [req.params.id]
            );

            if (!announcement) {
                req.flash("error", "Announcement not found");
                return res.redirect("/superadmin/announcements");
            };

            const plans = await queryAsync("SELECT id, name FROM plans WHERE is_active = TRUE");
            const schools = await queryAsync("SELECT id, school_name FROM schools WHERE status = 'active'");
            const selectedSchools = await queryAsync(
                "SELECT school_id FROM announcement_schools WHERE announcement_id = ?",
                [req.params.id]
            );

            res.render("superAdmin/announcements/form", {
                title: "Edit Announcement - SchoolSync",
                announcement,
                plans,
                schools,
                selectedSchools: selectedSchools.map(s => s.school_id),
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            console.error("Edit Form Error:", error);
            req.flash("error", "Failed to load announcement");
            res.redirect("/superadmin/announcements");
        };
    },

    update: async (req, res) => {
        try {
            const announcementId = req.params.id;
            const { title, content, notice_type, priority, target_type, target_plan_id, target_schools, is_active, expires_at, is_pinned, scheduled_at } = req.body;

            await executeAsync(
                `UPDATE announcements SET
                    title = ?, content = ?, notice_type = ?, priority = ?,
                    target_type = ?, target_plan_id = ?, is_active = ?,
                    expires_at = ?, is_pinned = ?, scheduled_at = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?`,
                [ title, content, notice_type, priority, target_type, target_plan_id || null, is_active ? 1 : 0, expires_at || null, is_pinned ? 1 : 0, scheduled_at || null, announcementId ]
            );

            await executeAsync("DELETE FROM announcement_schools WHERE announcement_id = ?", [announcementId]);
            if (target_type === 'specific_schools') {
                const rawSchools = target_schools || req.body['target_schools[]'];
                const schoolsArray = rawSchools ? (Array.isArray(rawSchools) ? rawSchools : [rawSchools]) : [];
                for (const schoolId of schoolsArray) {
                    await executeAsync(
                        "INSERT INTO announcement_schools (announcement_id, school_id) VALUES (?, ?)",
                        [announcementId, schoolId]
                    );
                };
            };

            if (target_type === 'plan_based' && target_plan_id) {
                const schools = await queryAsync(
                    "SELECT id FROM schools WHERE plan_id = ? AND status = 'active'",
                    [target_plan_id]
                );
                for (const school of schools) {
                    await executeAsync(
                        "INSERT INTO announcement_schools (announcement_id, school_id) VALUES (?, ?)",
                        [announcementId, school.id]
                    );
                };
            };

            req.flash("success", "Announcement updated successfully");
            res.redirect("/superadmin/announcements");
        } catch (error) {
            console.error("Update Announcement Error:", error);
            req.flash("error", "Failed to update announcement");
            res.redirect(`/superadmin/announcements/${req.params.id}/edit`);
        };
    },

    delete: async (req, res) => {
        try {
            await executeAsync("DELETE FROM announcements WHERE id = ?", [req.params.id]);
            req.flash("success", "Announcement deleted successfully");
            res.redirect("/superadmin/announcements");
        } catch (error) {
            req.flash("error", "Failed to delete");
            res.redirect("/superadmin/announcements");
        };
    },

    publish: async (req, res) => {
        try {
            await executeAsync(
                "UPDATE announcements SET published_at = CURRENT_TIMESTAMP, is_active = TRUE WHERE id = ?",
                [req.params.id]
            );
            req.flash("success", "Announcement published immediately");
            res.redirect("/superadmin/announcements");
        } catch (error) {
            req.flash("error", "Publish failed");
            res.redirect("/superadmin/announcements");
        };
    },

    listTemplates: async (req, res) => {
        try {
            const templates = await queryAsync("SELECT * FROM announcement_templates ORDER BY name");
            res.json({ success: true, data: templates });
        } catch (error) {
            console.error("listTemplates error:", error);
            res.status(500).json({ success: false, message: "Failed to fetch templates" });
        };
    },

    createTemplate: async (req, res) => {
        try {
            const { name, title, content } = req.body;
            await executeAsync(
                "INSERT INTO announcement_templates (name, title, content) VALUES (?, ?, ?)",
                [name, title, content]
            );
            res.json({ success: true, message: "Template saved successfully" });
        } catch (error) {
            console.error("createTemplate error:", error);
            res.status(500).json({ success: false, message: "Failed to save template" });
        };
    },

    deleteTemplate: async (req, res) => {
        try {
            await executeAsync("DELETE FROM announcement_templates WHERE id = ?", [req.params.id]);
            res.json({ success: true, message: "Template deleted" });
        } catch (error) {
            console.error("deleteTemplate error:", error);
            res.status(500).json({ success: false, message: "Failed to delete template" });
        };
    }
};

module.exports = announcementController;