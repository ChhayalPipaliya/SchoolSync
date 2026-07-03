const { queryAsync } = require("../config/database");

/**
 * Returns group info and owner name for the Group Admin.
 */
async function getGroupAdminContext(userId) {
  const rows = await queryAsync(
    `SELECT sg.id AS group_id, sg.group_name, sg.owner_name, ga.id AS group_admin_id
     FROM group_admins ga
     JOIN school_groups sg ON sg.id = ga.school_group_id
     WHERE ga.user_id = ? AND ga.status = 'active' AND sg.status = 'active'
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

/**
 * Returns list of school IDs assigned to this Group Admin.
 */
async function getAssignedSchoolIds(userId) {
  const rows = await queryAsync(
    `SELECT gas.school_id 
     FROM group_admin_schools gas
     JOIN group_admins ga ON ga.id = gas.group_admin_id
     WHERE ga.user_id = ? AND ga.status = 'active' AND gas.status = 'active'`,
    [userId]
  );
  return rows.map(r => r.school_id);
}

/**
 * Express middleware to ensure the Group Admin has access to the requested schoolId.
 */
async function ensureGroupSchoolAccess(req, res, next) {
  try {
    const schoolId = parseInt(req.params.schoolId || req.query.schoolId || req.body.schoolId, 10);
    if (!schoolId) {
      req.flash("error", "School ID is required.");
      return res.redirect("/groupadmin/dashboard");
    }

    const assignedIds = await getAssignedSchoolIds(req.user.id);
    if (!assignedIds.includes(schoolId)) {
      if (req.accepts("json") && !req.accepts("html")) {
        return res.status(403).json({ success: false, message: "Access Denied: You do not have access to this branch." });
      }
      return res.status(403).render("errors/403", {
        title: "Access Denied",
        user: req.user,
      });
    }
    next();
  } catch (error) {
    console.error("ensureGroupSchoolAccess error:", error);
    req.flash("error", "An error occurred checking access permissions.");
    res.redirect("/groupadmin/dashboard");
  }
}

module.exports = {
  getGroupAdminContext,
  getAssignedSchoolIds,
  ensureGroupSchoolAccess,
};
