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
        else if (req.path && req.path.includes("school")) folder += "schoolAdmin/";
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

const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExtensions = mimeToExtensions[file.mimetype];
    if (allowedExtensions && allowedExtensions.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error("Only images, PDFs, Word, and Excel files with valid extensions are allowed!"), false);
    };
};

const wrapMulterInstance = (multerInstance) => {
    const { verifyMultipartCsrf } = require("./csrf");
    return {
        single: (fieldname) => [uploadLimiter, multerInstance.single(fieldname), verifyMultipartCsrf],
        array: (fieldname, maxCount) => [uploadLimiter, multerInstance.array(fieldname, maxCount), verifyMultipartCsrf],
        fields: (fields) => [uploadLimiter, multerInstance.fields(fields), verifyMultipartCsrf],
        any: () => [uploadLimiter, multerInstance.any(), verifyMultipartCsrf],
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

module.exports = { upload, studentUpload, teacherUpload, driverUpload, schoolUpload, libraryUpload, noticeUpload, settingsUpload, homeworkUpload, receiptUpload, getStoredImagePath};