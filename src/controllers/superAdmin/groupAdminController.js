const { queryAsync, withTransaction } = require("../../config/database");
const bcrypt = require("bcryptjs");

const normalizeText = (value) => String(value || "").trim();
const normalizeEmail = (value) => normalizeText(value).toLowerCase();
const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const normalizeBranchIds = (branchIds) => {
  const selectedBranches = Array.isArray(branchIds)
    ? branchIds.map(Number).filter(Boolean)
    : branchIds ? [Number(branchIds)] : [];

  return [...new Set(selectedBranches)];
};

const normalizeStatus = (status) => status === "inactive" ? "inactive" : "active";

const validateAssignedBranches = async (branchIds, schoolGroupId) => {
  if (!schoolGroupId) {
    return { ok: false, message: "School Group is required." };
  }
  if (branchIds.length === 0) {
    return { ok: false, message: "Please select at least one branch." };
  }

  const matchingSchools = await queryAsync(
    "SELECT id FROM schools WHERE id IN (?) AND school_group_id = ?",
    [branchIds, schoolGroupId]
  );
  if (matchingSchools.length !== branchIds.length) {
    return { ok: false, message: "One or more selected branches do not belong to the selected school group." };
  }

  return { ok: true };
};

const groupAdminController = {
  list: async (req, res) => {
    try {
      const admins = await queryAsync(`
        SELECT
          u.id, u.first_name, u.last_name, u.email, u.phone, u.status, u.created_at,
          sg.group_name,
          COUNT(DISTINCT gas.school_id) AS branch_count
        FROM users u
        LEFT JOIN group_admins ga ON ga.user_id = u.id
        LEFT JOIN school_groups sg ON sg.id = ga.school_group_id
        LEFT JOIN group_admin_schools gas ON gas.group_admin_id = ga.id AND gas.status = 'active'
        WHERE u.role = 'group_admin' AND u.deleted_at IS NULL
        GROUP BY u.id
        ORDER BY u.created_at DESC
      `);
      res.render("superAdmin/groupAdmins/list", {
        title: "Group Admins - SchoolSync",
        admins,
        user: req.user,
        currentPath: req.path,
      });
    } catch (error) {
      console.error("Group Admin List Error:", error);
      req.flash("error", "Failed to load group admins.");
      res.redirect("/superadmin/dashboard");
    }
  },

  addForm: async (req, res) => {
    try {
      const groups = await queryAsync(
        "SELECT id, group_name FROM school_groups WHERE status = 'active' ORDER BY group_name ASC"
      );
      const branches = await queryAsync(
        `SELECT s.id, s.school_name, s.branch_name, s.area, sg.id AS group_id, sg.group_name
         FROM schools s
         LEFT JOIN school_groups sg ON sg.id = s.school_group_id
         WHERE s.status = 'active'
         ORDER BY sg.group_name ASC, s.school_name ASC`
      );
      res.render("superAdmin/groupAdmins/form", {
        title: "Add Group Admin - SchoolSync",
        admin: null,
        groups,
        branches,
        selectedBranches: [],
        selectedGroupId: null,
        user: req.user,
        currentPath: req.path,
      });
    } catch (error) {
      console.error("Group Admin Add Form Error:", error);
      req.flash("error", "Failed to load form.");
      res.redirect("/superadmin/group-admins");
    }
  },

  create: async (req, res) => {
    try {
      const { first_name, last_name, email, phone, password, branch_ids, status, school_group_id } = req.body;
      const selectedBranches = normalizeBranchIds(branch_ids);
      const cleanFirstName = normalizeText(first_name);
      const cleanLastName = normalizeText(last_name) || null;
      const cleanEmail = normalizeEmail(email);
      const cleanPhone = normalizeText(phone) || null;
      const cleanPassword = String(password || "");
      const cleanStatus = normalizeStatus(status);

      if (!cleanFirstName || !cleanEmail || !cleanPassword) {
        req.flash("error", "First name, email, and password are required.");
        return res.redirect("/superadmin/group-admins/add");
      }
      if (!isValidEmail(cleanEmail)) {
        req.flash("error", "Please enter a valid email address.");
        return res.redirect("/superadmin/group-admins/add");
      }

      const existingUser = await queryAsync(
        "SELECT id FROM users WHERE LOWER(TRIM(email)) = ? AND deleted_at IS NULL LIMIT 1",
        [cleanEmail]
      );
      if (existingUser.length > 0) {
        req.flash("error", "An account with this email already exists.");
        return res.redirect("/superadmin/group-admins/add");
      }

      const branchValidation = await validateAssignedBranches(selectedBranches, school_group_id);
      if (!branchValidation.ok) {
        req.flash("error", branchValidation.message);
        return res.redirect("/superadmin/group-admins/add");
      }

      const hashedPassword = await bcrypt.hash(cleanPassword, 10);

      await withTransaction(async ({ execute }) => {
        const result = await execute(
          `INSERT INTO users (school_id, first_name, last_name, email, phone, password, role, status)
           VALUES (NULL, ?, ?, ?, ?, ?, 'group_admin', ?)`,
          [
            cleanFirstName,
            cleanLastName,
            cleanEmail,
            cleanPhone,
            hashedPassword,
            cleanStatus,
          ]
        );
        const newUserId = result.insertId;

        const gaResult = await execute(
          `INSERT INTO group_admins (user_id, school_group_id, designation, status)
           VALUES (?, ?, 'Owner', ?)`,
          [newUserId, school_group_id, cleanStatus]
        );
        const groupAdminId = gaResult.insertId;

        for (const schoolId of selectedBranches) {
          await execute(
            `INSERT INTO group_admin_schools (group_admin_id, school_id, access_type, status)
             VALUES (?, ?, 'view', 'active')`,
            [groupAdminId, schoolId]
          );
        }
      });

      req.flash("success", "Group admin created successfully.");
      res.redirect("/superadmin/group-admins");
    } catch (error) {
      console.error("Group Admin Create Error:", error);
      if (error.code === "ER_DUP_ENTRY") {
        req.flash("error", "An account with this email already exists.");
      } else {
        req.flash("error", "Failed to create group admin.");
      }
      res.redirect("/superadmin/group-admins/add");
    }
  },

  editForm: async (req, res) => {
    try {
      const [admin] = await queryAsync(
        `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.status, ga.id AS group_admin_id
         FROM users u
         LEFT JOIN group_admins ga ON ga.user_id = u.id
         WHERE u.id = ? AND u.role = 'group_admin' AND u.deleted_at IS NULL
         LIMIT 1`,
        [req.params.id]
      );
      if (!admin) {
        req.flash("error", "Group admin not found.");
        return res.redirect("/superadmin/group-admins");
      }
      const groups = await queryAsync(
        "SELECT id, group_name FROM school_groups WHERE status = 'active' ORDER BY group_name ASC"
      );
      const branches = await queryAsync(
        `SELECT s.id, s.school_name, s.branch_name, s.area, sg.id AS group_id, sg.group_name
         FROM schools s
         LEFT JOIN school_groups sg ON sg.id = s.school_group_id
         WHERE s.status = 'active'
         ORDER BY sg.group_name ASC, s.school_name ASC`
      );
      const accessRows = await queryAsync(
        `SELECT gas.school_id
         FROM group_admin_schools gas
         JOIN group_admins ga ON ga.id = gas.group_admin_id
         WHERE ga.user_id = ? AND gas.status = 'active'`,
        [admin.id]
      );
      const selectedBranches = accessRows.map((r) => r.school_id);

      const [groupAdminRec] = await queryAsync(
        "SELECT school_group_id FROM group_admins WHERE user_id = ? LIMIT 1",
        [admin.id]
      );
      const selectedGroupId = groupAdminRec?.school_group_id || null;

      res.render("superAdmin/groupAdmins/form", {
        title: "Edit Group Admin - SchoolSync",
        admin,
        groups,
        branches,
        selectedBranches,
        selectedGroupId,
        user: req.user,
        currentPath: req.path,
      });
    } catch (error) {
      console.error("Group Admin Edit Form Error:", error);
      req.flash("error", "Failed to load form.");
      res.redirect("/superadmin/group-admins");
    }
  },

  update: async (req, res) => {
    try {
      const { first_name, last_name, email, phone, password, branch_ids, status, school_group_id } = req.body;
      const selectedBranches = normalizeBranchIds(branch_ids);
      const cleanFirstName = normalizeText(first_name);
      const cleanLastName = normalizeText(last_name) || null;
      const cleanEmail = normalizeEmail(email);
      const cleanPhone = normalizeText(phone) || null;
      const cleanStatus = normalizeStatus(status);

      if (!cleanFirstName || !cleanEmail) {
        req.flash("error", "First name and email are required.");
        return res.redirect(`/superadmin/group-admins/${req.params.id}/edit`);
      }
      if (!isValidEmail(cleanEmail)) {
        req.flash("error", "Please enter a valid email address.");
        return res.redirect(`/superadmin/group-admins/${req.params.id}/edit`);
      }

      const existingUser = await queryAsync(
        "SELECT id FROM users WHERE LOWER(TRIM(email)) = ? AND id <> ? AND deleted_at IS NULL LIMIT 1",
        [cleanEmail, req.params.id]
      );
      if (existingUser.length > 0) {
        req.flash("error", "An account with this email already exists.");
        return res.redirect(`/superadmin/group-admins/${req.params.id}/edit`);
      }

      const branchValidation = await validateAssignedBranches(selectedBranches, school_group_id);
      if (!branchValidation.ok) {
        req.flash("error", branchValidation.message);
        return res.redirect(`/superadmin/group-admins/${req.params.id}/edit`);
      }

      await withTransaction(async ({ execute, query }) => {
        if (password && password.trim()) {
          const hashedPassword = await bcrypt.hash(password.trim(), 10);
          await execute(
            `UPDATE users SET school_id = NULL, first_name = ?, last_name = ?, email = ?, phone = ?, password = ?, status = ? WHERE id = ? AND role = 'group_admin'`,
            [
              cleanFirstName,
              cleanLastName,
              cleanEmail,
              cleanPhone,
              hashedPassword,
              cleanStatus,
              req.params.id,
            ]
          );
        } else {
          await execute(
            `UPDATE users SET school_id = NULL, first_name = ?, last_name = ?, email = ?, phone = ?, status = ? WHERE id = ? AND role = 'group_admin'`,
            [
              cleanFirstName,
              cleanLastName,
              cleanEmail,
              cleanPhone,
              cleanStatus,
              req.params.id,
            ]
          );
        }

        const [existingGa] = await query(
          "SELECT id FROM group_admins WHERE user_id = ? LIMIT 1",
          [req.params.id]
        );
        let groupAdminId;
        if (existingGa) {
          groupAdminId = existingGa.id;
          await execute(
            "UPDATE group_admins SET school_group_id = ?, status = ? WHERE id = ?",
            [school_group_id, cleanStatus, groupAdminId]
          );
        } else {
          const gaResult = await execute(
            "INSERT INTO group_admins (user_id, school_group_id, designation, status) VALUES (?, ?, ?, ?)",
            [req.params.id, school_group_id, "Owner", cleanStatus]
          );
          groupAdminId = gaResult.insertId;
        }

        await query(
          "DELETE FROM group_admin_schools WHERE group_admin_id = ?",
          [groupAdminId]
        );

        for (const schoolId of selectedBranches) {
          await execute(
            `INSERT INTO group_admin_schools (group_admin_id, school_id, access_type, status)
             VALUES (?, ?, 'view', 'active')`,
            [groupAdminId, schoolId]
          );
        }
      });

      req.flash("success", "Group admin updated successfully.");
      res.redirect("/superadmin/group-admins");
    } catch (error) {
      console.error("Group Admin Update Error:", error);
      req.flash("error", error.code === "ER_DUP_ENTRY" ? "An account with this email already exists." : "Failed to update group admin.");
      res.redirect(`/superadmin/group-admins/${req.params.id}/edit`);
    }
  },

  toggleStatus: async (req, res) => {
    try {
      const [admin] = await queryAsync(
        "SELECT id, status FROM users WHERE id = ? AND role = 'group_admin' LIMIT 1",
        [req.params.id]
      );
      if (!admin) {
        req.flash("error", "Group admin not found.");
        return res.redirect("/superadmin/group-admins");
      }
      const newStatus = admin.status === "active" ? "inactive" : "active";
      await withTransaction(async ({ execute }) => {
        await execute(
          "UPDATE users SET status = ? WHERE id = ?",
          [newStatus, req.params.id]
        );
        await execute(
          "UPDATE group_admins SET status = ? WHERE user_id = ?",
          [newStatus, req.params.id]
        );
      });
      req.flash("success", `Group admin ${newStatus === "active" ? "activated" : "deactivated"}.`);
      res.redirect("/superadmin/group-admins");
    } catch (error) {
      console.error("Group Admin Status Error:", error);
      req.flash("error", "Failed to update status.");
      res.redirect("/superadmin/group-admins");
    }
  },
};

module.exports = groupAdminController;
