const { normalizeText } = require("../utils/validation");
const { queryAsync } = require("../config/database");

const wantsJson = (req) => req.accepts("json") && !req.accepts("html");

const deny = (req, res, message = "You do not have permission to access this library area.") => {
    if (wantsJson(req)) {
        return res.status(403).json({ success: false, message });
    };

    req.flash("error", message);
    if (req.user?.role === "librarian") {
        return res.redirect("/librarian/dashboard");
    };
    return res.redirect("/schooladmin/library");
};

const checkRolePermission = async (roleKey, permissionKey) => {
    if (roleKey === "super_admin") return true;
    try {
        const [result] = await queryAsync(`
            SELECT COUNT(*) as has_permission
            FROM permission_role pr
            JOIN roles r ON pr.role_id = r.id
            JOIN permissions p ON pr.permission_id = p.id
            WHERE r.role_key = ? AND p.permission_key = ? 
                AND pr.status = 1 AND r.status = 1 AND p.status = 1
                AND pr.deleted_at IS NULL AND r.deleted_at IS NULL AND p.deleted_at IS NULL
        `, [roleKey, permissionKey]);
        return result && result.has_permission > 0;
    } catch (err) {
        console.error("[RBAC-Middleware-Query-Error]", err);
        return false;
    };
};

const canViewLibraryReports = async (req, res, next) => {
    const role = req.user?.role;
    if (await checkRolePermission(role, "view_library_reports")) {
        return next();
    };
    return deny(req, res, "You do not have permission to view library reports.");
};

const canManageLibraryOperations = async (req, res, next) => {
    const role = req.user?.role;
    if (await checkRolePermission(role, "manage_library_books")) {
        return next();
    };

    return deny(req, res, "Only a Librarian can manage books, issue books, returns, fines, racks, and categories.");
};

const canManageLibraryBooks = async (req, res, next) => {
    const role = req.user?.role;
    if (await checkRolePermission(role, "manage_library_books")) {
        return next();
    };

    return deny(req, res, "You do not have permission to manage library books, categories, or racks.");
};

const canManageLibraryIssues = async (req, res, next) => {
    const role = req.user?.role;
    if (await checkRolePermission(role, "manage_library_issues")) {
        return next();
    };

    return deny(req, res, "You do not have permission to manage library members, book issues, or renewals.");
};

const canManageLibraryFines = async (req, res, next) => {
    const role = req.user?.role;
    if (await checkRolePermission(role, "manage_library_fines")) {
        return next();
    };

    return deny(req, res, "You do not have permission to manage library fines.");
};

const canManageLibrarySettings = async (req, res, next) => {
    const role = req.user?.role;
    if (await checkRolePermission(role, "manage_library_settings")) {
        return next();
    };

    return deny(req, res, "Only the School Admin can manage librarian accounts and library settings.");
};

module.exports = { canManageLibraryOperations, canManageLibrarySettings, canViewLibraryReports, canManageLibraryBooks, canManageLibraryIssues, canManageLibraryFines, isLibrarianRole: (role) => ["librarian", "library"].includes(normalizeText(role))};