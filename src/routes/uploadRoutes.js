const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const { verifyToken } = require("../middleware/auth");
const { queryAsync } = require("../config/database");
const { canAccessProtectedUpload, isProtectedUploadPath, normalizeUploadSubPath} = require("../services/uploadAuthorizationService");
const uploadsRoot = path.resolve(__dirname, "../../storage/uploads");
const hasSchoolWideUploadAccess = (user) => ["school_admin", "super_admin"].includes(user?.role);

const resolveUploadPath = (subPath) => {
    const normalizedSubPath = normalizeUploadSubPath(subPath);
    if (!normalizedSubPath) return null;

    const absolutePath = path.resolve(uploadsRoot, normalizedSubPath);
    const relativeToRoot = path.relative(uploadsRoot, absolutePath);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
        return null;
    };

    return { absolutePath, normalizedSubPath };
};

const userCanAccessKnownUpload = async (req, subPath) => {
    const user = req.user || req.session?.user;
    if (!user) return false;

    if (isProtectedUploadPath(subPath)) {
        return canAccessProtectedUpload({ user, subPath });
    };

    const uploadUrl = `/uploads/${subPath}`;
    const storagePath = `storage/uploads/${subPath}`;
    const folder = subPath.split(/[\\/]/)[0].toLowerCase();
    const filename = path.basename(subPath);

    if (user.role === "super_admin") {
        return true;
    };

    const schoolId = user.school_id;
    if (!schoolId) return false;

    if (folder === "imports" || folder === "error-reports") {
        const rows = await queryAsync(
            "SELECT id FROM import_logs WHERE school_id = ? AND (file_path = ? OR error_report_path = ?) LIMIT 1",
            [schoolId, uploadUrl, uploadUrl]
        );
        return rows.length > 0;
    };

    if (folder === "schools" || folder === "schooladmin") {
        const schoolRows = await queryAsync(
            "SELECT id FROM schools WHERE id = ? AND logo IN (?, ?, ?) LIMIT 1",
            [schoolId, storagePath, uploadUrl, filename]
        );
        if (schoolRows.length > 0) return true;

        const documentRows = await queryAsync(
            "SELECT id FROM school_documents WHERE school_id = ? AND file_path IN (?, ?, ?) LIMIT 1",
            [schoolId, storagePath, uploadUrl, filename]
        );
        return documentRows.length > 0;
    };

    if (folder === "students") {
        const ownerSql = hasSchoolWideUploadAccess(user)
            ? ""
            : user.role === "student"
                ? "AND s.user_id = ?"
                : user.role === "parent"
                    ? "AND sf.parent_user_id = ?"
                    : "AND 1 = 0";
        const ownerParams = hasSchoolWideUploadAccess(user)
            ? []
            : user.role === "student"
                ? [user.id]
                : user.role === "parent"
                    ? [user.id]
                    : [];
        const rows = await queryAsync(
            `SELECT sd.id
            FROM student_documents sd
            JOIN students s ON s.id = sd.student_id
            LEFT JOIN student_family sf ON sf.student_id = s.id AND sf.school_id = s.school_id
            WHERE s.school_id = ? AND (sd.file_url = ? OR sd.file_path IN (?, ?, ?))
                ${ownerSql}
            LIMIT 1`,
            [schoolId, uploadUrl, storagePath, uploadUrl, filename, ...ownerParams]
        );
        if (rows.length > 0) return true;

        const userImgRows = await queryAsync(
            `SELECT u.id
            FROM users u
            JOIN students s ON s.user_id = u.id
            LEFT JOIN student_family sf ON sf.student_id = s.id AND sf.school_id = s.school_id
            WHERE s.school_id = ? AND u.image IN (?, ?, ?)
                ${ownerSql}
            LIMIT 1`,
            [schoolId, storagePath, uploadUrl, filename, ...ownerParams]
        );
        return userImgRows.length > 0;
    };

    if (folder === "teachers") {
        const ownerSql = hasSchoolWideUploadAccess(user) ? "" : user.role === "teacher" ? "AND t.user_id = ?" : "AND 1 = 0";
        const ownerParams = hasSchoolWideUploadAccess(user) ? [] : user.role === "teacher" ? [user.id] : [];
        const rows = await queryAsync(
            `SELECT td.id
            FROM teacher_documents td
            JOIN teachers t ON t.id = td.teacher_id
            WHERE t.school_id = ? AND td.file_path IN (?, ?, ?)
                ${ownerSql}
            LIMIT 1`,
            [schoolId, storagePath, uploadUrl, filename, ...ownerParams]
        );
        if (rows.length > 0) return true;

        const userImgRows = await queryAsync(
            `SELECT u.id
            FROM users u
            JOIN teachers t ON t.user_id = u.id
            WHERE t.school_id = ? AND u.image IN (?, ?, ?)
                ${ownerSql}
            LIMIT 1`,
            [schoolId, storagePath, uploadUrl, filename, ...ownerParams]
        );
        return userImgRows.length > 0;
    };

    if (folder === "drivers") {
        const ownerSql = hasSchoolWideUploadAccess(user) ? "" : user.role === "driver" ? "AND d.user_id = ?" : "AND 1 = 0";
        const ownerParams = hasSchoolWideUploadAccess(user) ? [] : user.role === "driver" ? [user.id] : [];
        const rows = await queryAsync(
            `SELECT dd.id
            FROM driver_documents dd
            JOIN drivers d ON d.id = dd.driver_id
            WHERE d.school_id = ? AND (dd.file_url = ? OR dd.file_path IN (?, ?, ?))
                ${ownerSql}
            LIMIT 1`,
            [schoolId, uploadUrl, storagePath, uploadUrl, filename, ...ownerParams]
        );
        if (rows.length > 0) return true;

        const userImgRows = await queryAsync(
            `SELECT u.id
            FROM users u
            JOIN drivers d ON d.user_id = u.id
            WHERE d.school_id = ? AND u.image IN (?, ?, ?)
                ${ownerSql}
            LIMIT 1`,
            [schoolId, storagePath, uploadUrl, filename, ...ownerParams]
        );
        return userImgRows.length > 0;
    };

    if (folder === "librarians") {
        const ownerSql = hasSchoolWideUploadAccess(user) ? "" : user.role === "librarian" ? "AND l.user_id = ?" : "AND 1 = 0";
        const ownerParams = hasSchoolWideUploadAccess(user) ? [] : user.role === "librarian" ? [user.id] : [];
        const rows = await queryAsync(
            `SELECT l.id
            FROM librarians l
            JOIN users u ON u.id = l.user_id
            WHERE l.school_id = ? AND u.image IN (?, ?, ?)
                ${ownerSql}
            LIMIT 1`,
            [schoolId, storagePath, uploadUrl, filename, ...ownerParams]
        );
        return rows.length > 0;
    };

    if (folder === "notices") {
        const rows = await queryAsync(
            "SELECT id FROM notices WHERE school_id = ? AND attachment = ? LIMIT 1",
            [schoolId, filename]
        );
        return rows.length > 0;
    };

    if (folder === "homeworks") {
        const rows = await queryAsync(
            "SELECT id FROM homeworks WHERE school_id = ? AND file_path IN (?, ?, ?) LIMIT 1",
            [schoolId, storagePath, uploadUrl, filename]
        );
        return rows.length > 0;
    };

    if (folder === "library") {
        const rows = await queryAsync(
            "SELECT id FROM library_books WHERE school_id = ? AND cover_image IN (?, ?, ?) LIMIT 1",
            [schoolId, storagePath, uploadUrl, filename]
        );
        return rows.length > 0;
    };

    if (folder === "others") {
        const rows = await queryAsync(
            "SELECT id FROM school_documents WHERE school_id = ? AND file_path IN (?, ?, ?) LIMIT 1",
            [schoolId, storagePath, uploadUrl, filename]
        );
        return rows.length > 0;
    };

    const mediaRows = await queryAsync(
        `SELECT em.id
        FROM event_media em
        JOIN events e ON e.id = em.event_id
        WHERE e.school_id = ? AND em.file_path IN (?, ?, ?)
        LIMIT 1`,
        [schoolId, storagePath, uploadUrl, `src/public/${uploadUrl.replace(/^\//, "")}`]
    );
    if (mediaRows.length > 0) return true;

    return false;
};

const serveUpload = async (req, res) => {
    const subPath = req.params[0];
    if (!subPath) return res.status(404).send("Not found");

    const resolvedUpload = resolveUploadPath(subPath);
    if (!resolvedUpload) {
        return res.status(400).send("Invalid file path");
    };

    const allowed = await userCanAccessKnownUpload(req, resolvedUpload.normalizedSubPath);
    if (!allowed) {
        return res.status(403).send("Forbidden");
    };

    if (fs.existsSync(resolvedUpload.absolutePath) && fs.statSync(resolvedUpload.absolutePath).isFile()) {
        res.setHeader("Cache-Control", "private, no-store");
        return res.sendFile(resolvedUpload.absolutePath);
    };

    return res.status(404).send("File not found");
};

router.get("/uploads/*", (req, res) => {
    const subPath = req.params[0];
    if (!subPath) return res.status(404).send("Not found");

    return verifyToken(req, res, () => {
        serveUpload(req, res).catch((err) => {
            console.error("[UploadRoutes] Failed to serve upload:", err);
            res.status(500).send("Failed to serve file");
        });
    });
});

module.exports = router;
