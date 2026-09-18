const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { uploadLimiter } = require("./rateLimit");
const { MAX_FILE_SIZE_MB, MAX_FILE_SIZE_NOTICE_MB } = require("../config/constants");

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        let folder = "uploads/";

        if (req.path && req.path.includes("student")) folder += "students/";
        else if (req.path && req.path.includes("teacher")) folder += "teachers/";
        else if (req.path && req.path.includes("driver")) folder += "drivers/";
        else if (req.path && req.path.includes("librarian")) folder += "librarians/";
        else if (req.path && (req.path.includes("school") || req.path.includes("settings") || req.path.includes("upi-qr"))) folder += "schoolAdmin/";
        else if (req.path && (req.path.includes("library") || req.path.includes("book"))) folder += "library/";
        else if (req.path && req.path.includes("notice")) folder += "notices/";
        else if (req.path && req.path.includes("homework")) folder += "homeworks/";
        else if (req.path && req.path.includes("receipt")) folder += "receipts/";
        else folder += "others/";

        const fullPath = path.join(__dirname, '../../storage', folder);

        if (!fs.existsSync(fullPath)) {
            fs.mkdirSync(fullPath, { recursive: true });
        };

        cb(null, fullPath);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
    }
});

const mimeToExtensions = {
    "image/jpeg": [".jpg", ".jpeg"],
    "image/png": [".png"],
    "image/jpg": [".jpg", ".jpeg"],
    "image/webp": [".webp"],
    "image/gif": [".gif"],
    "application/pdf": [".pdf"],
    "application/msword": [".doc"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
    "application/vnd.ms-excel": [".xls"],
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"]
};

const { fileUploadGuard, isFileUploadEnabled } = require("./fileUploadGuard");

const fileFilter = (req, file, cb) => {
    if (!isFileUploadEnabled()) {
        const err = new Error("File uploads are currently disabled.");
        err.status = 403;
        err.statusCode = 403;
        err.code = "FILE_UPLOADS_DISABLED";
        return cb(err, false);
    };
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExtensions = mimeToExtensions[file.mimetype];
    if (allowedExtensions && allowedExtensions.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error("Only images, PDFs, Word, and Excel files with valid extensions are allowed!"), false);
    };
};

const ensureNoFilesIfUploadDisabled = (req, res, next) => {
    if (!isFileUploadEnabled()) {
        const hasFiles = Boolean(
            req.file ||
            (req.files && (Array.isArray(req.files) ? req.files.length > 0 : Object.keys(req.files).length > 0))
        );
        if (hasFiles) {
            const isJson = Boolean(
                req.xhr ||
                req.headers["x-requested-with"] === "XMLHttpRequest" ||
                (req.headers.accept && req.headers.accept.includes("application/json")) ||
                (req.path && (req.path.startsWith("/api/") || req.path.includes("/api/"))) ||
                !(req.headers.accept && req.headers.accept.includes("text/html"))
            );
            if (isJson) {
                return res.status(403).json({
                    success: false,
                    message: "File uploads are currently disabled."
                });
            }
            if (req.flash) {
                req.flash("error", "File uploads are currently disabled.");
            }
            if (req.get("Referrer")) {
                return res.redirect("back");
            }
            return res.status(403).render("errors/403", {
                message: "File uploads are currently disabled."
            });
        }
    }
    next();
};

const wrapMulterInstance = (multerInstance) => {
    const { verifyMultipartCsrf } = require("./csrf");
    return {
        single: (fieldname) => [fileUploadGuard, uploadLimiter, multerInstance.single(fieldname), ensureNoFilesIfUploadDisabled, verifyMultipartCsrf],
        array: (fieldname, maxCount) => [fileUploadGuard, uploadLimiter, multerInstance.array(fieldname, maxCount), ensureNoFilesIfUploadDisabled, verifyMultipartCsrf],
        fields: (fields) => [fileUploadGuard, uploadLimiter, multerInstance.fields(fields), ensureNoFilesIfUploadDisabled, verifyMultipartCsrf],
        any: () => [fileUploadGuard, uploadLimiter, multerInstance.any(), ensureNoFilesIfUploadDisabled, verifyMultipartCsrf],
        none: () => [uploadLimiter, multerInstance.none(), verifyMultipartCsrf]
    };
};

const uploadRaw = multer({ storage, fileFilter, limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 } });
const studentUploadRaw = multer({ storage, fileFilter, limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 } });
const teacherUploadRaw = multer({ storage, fileFilter, limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 } });
const driverUploadRaw = multer({ storage, fileFilter, limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 } });
const schoolUploadRaw = multer({ storage, fileFilter, limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 } });
const libraryUploadRaw = multer({ storage, fileFilter, limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 } });
const noticeUploadRaw = multer({ storage, fileFilter, limits: { fileSize: MAX_FILE_SIZE_NOTICE_MB * 1024 * 1024 } });
const settingsUploadRaw = multer({ storage, fileFilter, limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 } });
const homeworkUploadRaw = multer({ storage, fileFilter, limits: { fileSize: MAX_FILE_SIZE_NOTICE_MB * 1024 * 1024 } });
const receiptUploadRaw = multer({ storage, fileFilter, limits: { fileSize: 2 * 1024 * 1024 } });

const upload = wrapMulterInstance(uploadRaw);
const studentUpload = wrapMulterInstance(studentUploadRaw);
const teacherUpload = wrapMulterInstance(teacherUploadRaw);
const driverUpload = wrapMulterInstance(driverUploadRaw);
const schoolUpload = wrapMulterInstance(schoolUploadRaw);
const libraryUpload = wrapMulterInstance(libraryUploadRaw);
const noticeUpload = wrapMulterInstance(noticeUploadRaw);
const settingsUpload = wrapMulterInstance(settingsUploadRaw);
const homeworkUpload = wrapMulterInstance(homeworkUploadRaw);
const receiptUpload = wrapMulterInstance(receiptUploadRaw);

const getStoredImagePath = (file) => {
    if (!file || !file.path) return null;
    const storageDir = path.join(__dirname, '../../storage');
    const relative = path.relative(storageDir, file.path).split(path.sep).join('/');
    return `/${relative}`;
};

module.exports = { upload, studentUpload, teacherUpload, driverUpload, schoolUpload, libraryUpload, noticeUpload, settingsUpload, homeworkUpload, receiptUpload, getStoredImagePath, fileUploadGuard, isFileUploadEnabled };