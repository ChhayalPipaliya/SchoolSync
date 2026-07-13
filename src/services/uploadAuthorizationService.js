const path = require("path");

const PROTECTED_UPLOAD_FOLDERS = new Set(["certificates", "invoices", "receipts"]);

const toPositiveInt = (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const normalizeUploadSubPath = (subPath) => {
    if (typeof subPath !== "string" || !subPath || subPath.includes("\0") || subPath.includes("\\")) {
        return null;
    };

    const withoutLeadingSlashes = subPath.replace(/^\/+/, "");
    const normalized = path.posix.normalize(withoutLeadingSlashes);
    if (
        !normalized ||
        normalized === "." ||
        normalized === ".." ||
        normalized.startsWith("../") ||
        path.posix.isAbsolute(normalized)
    ) {
        return null;
    };

    return normalized;
};

const buildUploadReference = (subPath) => {
    const normalizedSubPath = normalizeUploadSubPath(subPath);
    if (!normalizedSubPath) return null;

    return {
        folder: normalizedSubPath.split("/")[0].toLowerCase(),
        filename: path.posix.basename(normalizedSubPath),
        normalizedSubPath,
        storagePath: `storage/uploads/${normalizedSubPath}`,
        uploadUrl: `/uploads/${normalizedSubPath}`
    };
};

const isProtectedUploadPath = (subPath) => {
    const reference = buildUploadReference(subPath);
    return Boolean(reference && PROTECTED_UPLOAD_FOLDERS.has(reference.folder));
};

const createUploadAuthorizationService = ({ query } = {}) => {
    if (typeof query !== "function") {
        throw new TypeError("A database query function is required.");
    };

    const hasRows = async (sql, params) => {
        const rows = await query(sql, params);
        return Array.isArray(rows) && rows.length > 0;
    };

    const canAccessCertificate = async ({ role, userId, schoolId, reference }) => {
        const baseParams = [schoolId, reference.uploadUrl, reference.storagePath];

        if (role === "school_admin") {
            return hasRows(
                `SELECT ic.id
                FROM issued_certificates ic
                WHERE ic.school_id = ?
                    AND ic.pdf_path IN (?, ?)
                    AND ic.status = 'issued'
                LIMIT 1`,
                baseParams
            );
        };

        if (!userId) return false;

        if (role === "student") {
            return hasRows(
                `SELECT ic.id
                FROM issued_certificates ic
                JOIN students s
                    ON s.id = ic.student_id
                    AND s.school_id = ic.school_id
                    AND s.user_id = ?
                    AND s.student_portal_enabled = 1
                    AND s.status = 'active'
                    AND s.deleted_at IS NULL
                WHERE ic.school_id = ?
                    AND ic.pdf_path IN (?, ?)
                    AND ic.recipient_type = 'student'
                    AND ic.status = 'issued'
                LIMIT 1`,
                [userId, ...baseParams]
            );
        };

        if (role === "parent") {
            return hasRows(
                `SELECT ic.id
                FROM issued_certificates ic
                JOIN students s
                    ON s.id = ic.student_id
                    AND s.school_id = ic.school_id
                    AND s.parent_portal_enabled = 1
                    AND s.status = 'active'
                    AND s.deleted_at IS NULL
                JOIN student_family sf
                    ON sf.student_id = s.id
                    AND sf.school_id = s.school_id
                    AND sf.parent_user_id = ?
                WHERE ic.school_id = ?
                    AND ic.pdf_path IN (?, ?)
                    AND ic.recipient_type = 'student'
                    AND ic.status = 'issued'
                LIMIT 1`,
                [userId, ...baseParams]
            );
        };

        if (role === "teacher") {
            return hasRows(
                `SELECT ic.id
                FROM issued_certificates ic
                JOIN teachers t
                    ON t.id = ic.teacher_id
                    AND t.school_id = ic.school_id
                    AND t.user_id = ?
                    AND t.deleted_at IS NULL
                WHERE ic.school_id = ?
                    AND ic.pdf_path IN (?, ?)
                    AND ic.recipient_type IN ('teacher', 'staff')
                    AND ic.status = 'issued'
                LIMIT 1`,
                [userId, ...baseParams]
            );
        };

        return false;
    };

    const canAccessInvoice = async ({ role, schoolId, reference }) => {
        if (role !== "school_admin") return false;

        return hasRows(
            `SELECT i.id
            FROM invoices i
            WHERE i.school_id = ?
                AND i.pdf_path IN (?, ?)
            LIMIT 1`,
            [schoolId, reference.uploadUrl, reference.storagePath]
        );
    };

    const canAccessFeeReceipt = async ({ role, userId, schoolId, reference }) => {
        const receiptParams = [schoolId, reference.filename, reference.filename];

        if (role === "school_admin") {
            return hasRows(
                `SELECT fp.id
                FROM fee_payments fp
                WHERE fp.school_id = ?
                    AND (fp.receipt_no = ? OR fp.receipt_number = ?)
                    AND fp.status IN ('completed', 'paid')
                LIMIT 1`,
                receiptParams
            );
        };

        if (!userId || !["student", "parent"].includes(role)) return false;

        const ownershipSql = role === "student"
            ? `(
                EXISTS (
                    SELECT 1 FROM students own_student
                    WHERE own_student.id = fp.student_id AND own_student.school_id = fp.school_id
                        AND own_student.user_id = ?
                        AND own_student.student_portal_enabled = 1
                        AND own_student.status = 'active'
                        AND own_student.deleted_at IS NULL
                )
                OR EXISTS (
                    SELECT 1 FROM fee_payment_allocations fpa
                    JOIN student_fees allocated_fee ON allocated_fee.id = fpa.student_fee_id AND allocated_fee.school_id = fpa.school_id
                    JOIN students allocated_student ON allocated_student.id = allocated_fee.student_id AND allocated_student.school_id = allocated_fee.school_id
                    WHERE fpa.payment_id = fp.id AND fpa.school_id = fp.school_id
                        AND allocated_student.user_id = ?
                        AND allocated_student.student_portal_enabled = 1
                        AND allocated_student.status = 'active'
                        AND allocated_student.deleted_at IS NULL
                )
                OR EXISTS (
                    SELECT 1 FROM student_fees legacy_fee
                    JOIN students legacy_student ON legacy_student.id = legacy_fee.student_id AND legacy_student.school_id = legacy_fee.school_id
                    WHERE legacy_fee.payment_id = fp.id AND legacy_fee.school_id = fp.school_id
                        AND legacy_student.user_id = ?
                        AND legacy_student.student_portal_enabled = 1
                        AND legacy_student.status = 'active'
                        AND legacy_student.deleted_at IS NULL
                )
            )`
            : `(
                EXISTS (
                    SELECT 1 FROM student_family own_family
                    JOIN students own_student
                        ON own_student.id = own_family.student_id
                        AND own_student.school_id = own_family.school_id
                    WHERE own_family.student_id = fp.student_id AND own_family.school_id = fp.school_id
                        AND own_family.parent_user_id = ?
                        AND own_student.parent_portal_enabled = 1
                        AND own_student.status = 'active'
                        AND own_student.deleted_at IS NULL
                )
                OR EXISTS (
                    SELECT 1 FROM fee_payment_allocations fpa
                    JOIN student_fees allocated_fee ON allocated_fee.id = fpa.student_fee_id AND allocated_fee.school_id = fpa.school_id
                    JOIN students allocated_student
                        ON allocated_student.id = allocated_fee.student_id
                        AND allocated_student.school_id = allocated_fee.school_id
                    JOIN student_family allocated_family ON allocated_family.student_id = allocated_fee.student_id AND allocated_family.school_id = allocated_fee.school_id
                    WHERE fpa.payment_id = fp.id AND fpa.school_id = fp.school_id
                        AND allocated_family.parent_user_id = ?
                        AND allocated_student.parent_portal_enabled = 1
                        AND allocated_student.status = 'active'
                        AND allocated_student.deleted_at IS NULL
                )
                OR EXISTS (
                    SELECT 1 FROM student_fees legacy_fee
                    JOIN students legacy_student
                        ON legacy_student.id = legacy_fee.student_id
                        AND legacy_student.school_id = legacy_fee.school_id
                    JOIN student_family legacy_family ON legacy_family.student_id = legacy_fee.student_id AND legacy_family.school_id = legacy_fee.school_id
                    WHERE legacy_fee.payment_id = fp.id AND legacy_fee.school_id = fp.school_id
                        AND legacy_family.parent_user_id = ?
                        AND legacy_student.parent_portal_enabled = 1
                        AND legacy_student.status = 'active'
                        AND legacy_student.deleted_at IS NULL
                )
            )`;

        return hasRows(
            `SELECT fp.id
            FROM fee_payments fp
            WHERE fp.school_id = ?
                AND (fp.receipt_no = ? OR fp.receipt_number = ?)
                AND fp.status IN ('completed', 'paid')
                AND ${ownershipSql}
            LIMIT 1`,
            [...receiptParams, userId, userId, userId]
        );
    };

    const canAccessReceipt = async ({ role, userId, schoolId, reference }) => {
        const isSubscriptionReceipt = await hasRows(
            `SELECT sp.id
            FROM subscription_payments sp
            WHERE sp.school_id = ?
                AND sp.receipt_url IN (?, ?)
                AND sp.status = 'completed'
            LIMIT 1`,
            [schoolId, reference.uploadUrl, reference.storagePath]
        );
        if (isSubscriptionReceipt) return role === "school_admin";

        return canAccessFeeReceipt({ role, userId, schoolId, reference });
    };

    const canAccessProtectedUpload = async ({ user, subPath }) => {
        const reference = buildUploadReference(subPath);
        if (!reference || !PROTECTED_UPLOAD_FOLDERS.has(reference.folder) || !user) return false;

        if (user.role === "super_admin") return true;

        const schoolId = toPositiveInt(user.school_id);
        if (!schoolId) return false;

        const userId = toPositiveInt(user.id);
        if (reference.folder === "certificates") {
            return canAccessCertificate({ role: user.role, userId, schoolId, reference });
        };
        if (reference.folder === "invoices") {
            return canAccessInvoice({ role: user.role, schoolId, reference });
        };
        return canAccessReceipt({ role: user.role, userId, schoolId, reference });
    };

    return { canAccessProtectedUpload };
};

let defaultService;
const getDefaultService = () => {
    if (!defaultService) {
        const { queryAsync } = require("../config/database");
        defaultService = createUploadAuthorizationService({ query: queryAsync });
    };
    return defaultService;
};

module.exports = {
    PROTECTED_UPLOAD_FOLDERS,
    buildUploadReference,
    createUploadAuthorizationService,
    isProtectedUploadPath,
    normalizeUploadSubPath,
    canAccessProtectedUpload: (...args) => getDefaultService().canAccessProtectedUpload(...args)
};
