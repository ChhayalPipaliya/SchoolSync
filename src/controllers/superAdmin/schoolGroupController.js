const { queryAsync, executeAsync } = require("../../config/database");

const schoolGroupController = {
  list: async (req, res) => {
    try {
      const groups = await queryAsync(`
        SELECT
          sg.*,
          COUNT(s.id) AS branch_count
        FROM school_groups sg
        LEFT JOIN schools s ON s.school_group_id = sg.id
        GROUP BY sg.id
        ORDER BY sg.created_at DESC
      `);
      res.render("superAdmin/schoolGroups/list", {
        title: "School Groups - SchoolSync",
        groups,
        user: req.user,
        currentPath: req.path,
      });
    } catch (error) {
      console.error("School Group List Error:", error);
      req.flash("error", "Failed to load school groups.");
      res.redirect("/superadmin/dashboard");
    }
  },

  addForm: async (req, res) => {
    res.render("superAdmin/schoolGroups/form", {
      title: "Add School Group - SchoolSync",
      group: null,
      user: req.user,
      currentPath: req.path,
    });
  },

  create: async (req, res) => {
    try {
      const { group_name, owner_name, email, phone, city, address, status } = req.body;
      if (!group_name || !group_name.trim()) {
        req.flash("error", "Group name is required.");
        return res.redirect("/superadmin/school-groups/add");
      }
      await executeAsync(
        `INSERT INTO school_groups (group_name, owner_name, email, phone, city, address, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          group_name.trim(),
          owner_name || null,
          email || null,
          phone || null,
          city || null,
          address || null,
          status || "active",
          req.user.id,
        ]
      );
      req.flash("success", "School group created successfully.");
      res.redirect("/superadmin/school-groups");
    } catch (error) {
      console.error("School Group Create Error:", error);
      if (error.code === "ER_DUP_ENTRY") {
        req.flash("error", "A school group with this name already exists.");
      } else {
        req.flash("error", "Failed to create school group.");
      }
      res.redirect("/superadmin/school-groups/add");
    }
  },

  editForm: async (req, res) => {
    try {
      const [group] = await queryAsync(
        "SELECT * FROM school_groups WHERE id = ? LIMIT 1",
        [req.params.id]
      );
      if (!group) {
        req.flash("error", "School group not found.");
        return res.redirect("/superadmin/school-groups");
      }
      res.render("superAdmin/schoolGroups/form", {
        title: "Edit School Group - SchoolSync",
        group,
        user: req.user,
        currentPath: req.path,
      });
    } catch (error) {
      console.error("School Group Edit Form Error:", error);
      req.flash("error", "Failed to load school group.");
      res.redirect("/superadmin/school-groups");
    }
  },

  update: async (req, res) => {
    try {
      const { group_name, owner_name, email, phone, city, address, status } = req.body;
      if (!group_name || !group_name.trim()) {
        req.flash("error", "Group name is required.");
        return res.redirect(`/superadmin/school-groups/${req.params.id}/edit`);
      }
      await executeAsync(
        `UPDATE school_groups
         SET group_name = ?, owner_name = ?, email = ?, phone = ?, city = ?,
             address = ?, status = ?, updated_by = ?
         WHERE id = ?`,
        [
          group_name.trim(),
          owner_name || null,
          email || null,
          phone || null,
          city || null,
          address || null,
          status || "active",
          req.user.id,
          req.params.id,
        ]
      );
      req.flash("success", "School group updated successfully.");
      res.redirect("/superadmin/school-groups");
    } catch (error) {
      console.error("School Group Update Error:", error);
      if (error.code === "ER_DUP_ENTRY") {
        req.flash("error", "A school group with this name already exists.");
      } else {
        req.flash("error", "Failed to update school group.");
      }
      res.redirect(`/superadmin/school-groups/${req.params.id}/edit`);
    }
  },

  toggleStatus: async (req, res) => {
    try {
      const [group] = await queryAsync(
        "SELECT id, status FROM school_groups WHERE id = ? LIMIT 1",
        [req.params.id]
      );
      if (!group) {
        req.flash("error", "School group not found.");
        return res.redirect("/superadmin/school-groups");
      }
      const newStatus = group.status === "active" ? "inactive" : "active";
      await executeAsync(
        "UPDATE school_groups SET status = ?, updated_by = ? WHERE id = ?",
        [newStatus, req.user.id, req.params.id]
      );
      req.flash("success", `School group ${newStatus === "active" ? "activated" : "deactivated"}.`);
      res.redirect("/superadmin/school-groups");
    } catch (error) {
      console.error("School Group Status Toggle Error:", error);
      req.flash("error", "Failed to update status.");
      res.redirect("/superadmin/school-groups");
    }
  },
};

module.exports = schoolGroupController;
