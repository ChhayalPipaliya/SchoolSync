const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const fastCsv = require('fast-csv');
const db = require('../../config/database');
const { getRedisClient } = require('../../config/redis');
const { parseFile } = require('../../utils/csvParser');
const { loadValidationCache, validateRow, resolveClassId } = require('../../utils/validators/importValidators');
const importLogModel = require('../../models/importLogModel');
const { FileValidationError } = require('../../utils/errors');
const { calculateGrade, isPassed } = require('../../utils/marksHelper');

const uploadDir = path.resolve(__dirname, '../../../storage/uploads/imports');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
};

const errorReportsDir = path.resolve(__dirname, '../../../storage/uploads/error-reports');
if (!fs.existsSync(errorReportsDir)) {
    fs.mkdirSync(errorReportsDir, { recursive: true });
};

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.csv' || ext === '.xlsx') {
        cb(null, true);
    } else {
        cb(new FileValidationError('Only .csv and .xlsx files are allowed!'), false);
    };
};

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: fileFilter
}).single('file');

const memoryProgressCache = new Map();
async function setJobProgress(jobId, data) {
    const redis = getRedisClient();
    if (redis) {
        await redis.set(`import_job:${jobId}`, JSON.stringify(data), { EX: 3600 });
    } else {
        memoryProgressCache.set(jobId, data);
    };
};

async function getJobProgress(jobId) {
    const redis = getRedisClient();
    if (redis) {
        const val = await redis.get(`import_job:${jobId}`);
        return val ? JSON.parse(val) : null;
    } else {
        return memoryProgressCache.get(jobId) || null;
    };
};

function writeErrorReport(errors) {
    return new Promise((resolve, reject) => {
        const reportFilename = `import_errors_${Date.now()}.csv`;
        const reportPath = path.join(errorReportsDir, reportFilename);
        const ws = fs.createWriteStream(reportPath);
        const csvStream = fastCsv.format({ headers: true });
        csvStream.pipe(ws);

        errors.forEach(err => {
            csvStream.write({
                'Row Number': err.row_number,
                'Field': err.field,
                'Error Message': err.message,
                'Submitted Value': err.value
            });
        });

        csvStream.end();
        ws.on('finish', () => {
            resolve(`/uploads/error-reports/${reportFilename}`);
        });
        ws.on('error', (err) => {
            reject(err);
        });
    });
};

async function checkRateLimit(userId, schoolId) {
    const rows = await db.queryAsync(
        `SELECT COUNT(*) as count 
        FROM import_logs 
        WHERE imported_by = ? AND school_id = ? 
            AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
        [userId, schoolId]
    );
    return rows[0].count < 5;
};

exports.renderImportDashboard = async (req, res, next) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const logs = await importLogModel.getLogsBySchool(schoolId);
        res.render('schoolAdmin/imports/dashboard', {
            title: 'Bulk Imports',
            logs,
            user: req.user || req.session.user
        });
    } catch (err) {
        next(err);
    };
};

exports.getLogs = async (req, res, next) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const logs = await importLogModel.getLogsBySchool(schoolId);
        return res.status(200).json({ success: true, logs });
    } catch (err) {
        next(err);
    };
};

exports.getJobStatus = async (req, res, next) => {
    try {
        const { jobId } = req.params;
        const progress = await getJobProgress(jobId);
        if (!progress) {
            return res.status(404).json({ success: false, message: 'Job status not found' });
        };
        return res.status(200).json({ success: true, ...progress });
    } catch (err) {
        next(err);
    };
};

exports.importEntity = (req, res, next) => {
    upload(req, res, async (err) => {
        if (err) {
            console.error('[Bulk Import Upload Error]:', err);
            return res.status(400).json({ success: false, message: 'File upload failed' });
        };

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Please upload a file' });
        };

        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const userId = (req.user?.id || req.session.user?.id);
        const userRole = (req.user?.role || req.session.user?.role);
        const { entityType } = req.params;
        const importMode = req.body.import_mode || req.query.import_mode;

        try {
            const withinLimit = await checkRateLimit(userId, schoolId);
            if (!withinLimit) {
                fs.unlinkSync(req.file.path);
                return res.status(429).json({
                    success: false,
                    message: 'Rate limit exceeded: You can only perform 5 imports per hour.'
                });
            };

            const rows = await parseFile(req.file.path);
            if (rows.length === 0) {
                fs.unlinkSync(req.file.path);
                return res.status(400).json({ success: false, message: 'Uploaded file is empty' });
            };

            const sampleRow = rows[0];
            const requiredHeadersMap = {
                students: ['name', 'email'],
                teachers: ['name', 'email'],
                books: ['title'],
                fees: ['class_id', 'fee_type', 'amount'],
                marks: ['exam_id', 'student_id', 'subject_id', 'marks_obtained']
            };

            const required = requiredHeadersMap[entityType];
            if (!required) {
                fs.unlinkSync(req.file.path);
                return res.status(400).json({ success: false, message: `Invalid entity type: ${entityType}` });
            };

            const missingHeaders = required.filter(h => sampleRow[h] === undefined);
            if (missingHeaders.length > 0) {
                fs.unlinkSync(req.file.path);
                return res.status(400).json({
                    success: false,
                    message: `Invalid template: missing required columns (${missingHeaders.join(', ')})`
                });
            };

            const jobId = 'job_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
            const relativeFilePath = `/uploads/imports/${req.file.filename}`;
            if (rows.length > 500) {
                processImportAsync(jobId, entityType, rows, schoolId, userId, userRole, req.file.filename, relativeFilePath, req.file.path, importMode);
                return res.status(202).json({
                    success: true,
                    message: 'Import file is large and has been queued for background processing.',
                    jobId,
                    total_rows: rows.length
                });
            } else {
                const result = await processImport(jobId, entityType, rows, schoolId, userId, userRole, req.file.filename, relativeFilePath, req.file.path, importMode);
                return res.status(result.success ? 200 : 400).json(result);
            };
        } catch (error) {
            if (fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            console.error('[Bulk Import Error]:', error);
            return res.status(error.statusCode || 500).json({
                success: false,
                message: 'Import failed due to server error'
            });
        };
    });
};

async function processImportAsync(jobId, entityType, rows, schoolId, userId, userRole, filename, relativeFilePath, fullFilePath, importMode) {
    try {
        await setJobProgress(jobId, { 
            status: 'processing', progress: 0, current_row: 0, total_rows: rows.length 
        });
        const result = await processImport(jobId, entityType, rows, schoolId, userId, userRole, filename, relativeFilePath, fullFilePath, importMode, async (current, total) => {
            const pct = Math.round((current / total) * 100);
            await setJobProgress(jobId, { status: 'processing', progress: pct, current_row: current, total_rows: total });
        });
        await setJobProgress(jobId, { status: result.success ? 'completed' : 'failed', progress: 100, current_row: rows.length, total_rows: rows.length, result });
    } catch (err) {
        console.error(`[Background Import Job ${jobId} Failed]:`, err);
        await setJobProgress(jobId, { 
            status: 'failed', progress: 100, message: 'Import job failed due to server error' 
        });
    };
};

async function processImport(jobId, entityType, rows, schoolId, userId, userRole, filename, relativeFilePath, fullFilePath, importMode, progressCallback = null) {
    const cache = await loadValidationCache(schoolId);
    const fileContext = {
        emails: new Map(),
        rollNumbers: new Map()
    };

    const errors = [];
    const validRows = [];

    for (let i = 0; i < rows.length; i++) {
        const rowErrors = validateRow(entityType, rows[i], i + 1, cache, fileContext);
        if (rowErrors.length > 0) {
            errors.push(...rowErrors);
        } else {
            validRows.push({ data: rows[i], index: i + 1 });
        };

        if (progressCallback && (i + 1) % 50 === 0) {
            await progressCallback(i + 1, rows.length);
        };
    };

    if (progressCallback) {
        await progressCallback(rows.length, rows.length);
    };

    let errorReportUrl = null;
    if (errors.length > 0) {
        errorReportUrl = await writeErrorReport(errors);
    };

    if (importMode === 'all_or_nothing' && errors.length > 0) {
        await importLogModel.createLog({
            school_id: schoolId,
            imported_by: userId,
            user_role: userRole,
            entity_type: entityType,
            file_name: filename,
            file_path: relativeFilePath,
            total_rows: rows.length,
            success_count: 0,
            failed_count: rows.length,
            error_report_path: errorReportUrl,
            status: 'failed'
        });

        if (fs.existsSync(fullFilePath)) fs.unlinkSync(fullFilePath);
        return {
            success: false,
            message: 'Import rejected: One or more rows failed validation. See error report.',
            error_code: 'ROW_VALIDATION_FAILED',
            details: errors[0],
            errors,
            error_report_url: errorReportUrl
        };
    };

    if (validRows.length === 0) {
        await importLogModel.createLog({
            school_id: schoolId,
            imported_by: userId,
            user_role: userRole,
            entity_type: entityType,
            file_name: filename,
            file_path: relativeFilePath,
            total_rows: rows.length,
            success_count: 0,
            failed_count: rows.length,
            error_report_path: errorReportUrl,
            status: 'failed'
        });
        if (fs.existsSync(fullFilePath)) fs.unlinkSync(fullFilePath);
        return {
            success: false,
            message: 'All rows in the spreadsheet failed validation.',
            errors,
            error_report_url: errorReportUrl
        };
    };

    let successCount = 0;
    try {
        await db.withTransaction(async (tx) => {
            const affectedClasses = new Set();
            for (const item of validRows) {
                const row = item.data;

                if (entityType === 'students') {
                    const finalClassId = resolveClassId(cache, row.class_id, row.section_id || row.section || row.section_name, row.medium || 'English');

                    let className = null;
                    if (finalClassId) {
                        const cls = await tx.query('SELECT class_name FROM classes WHERE id = ? LIMIT 1', [finalClassId]);
                        if (cls.length > 0) className = cls[0].class_name;
                    } else if (row.class_id) {
                        className = String(row.class_id).trim();
                    };
                    if (className) {
                        affectedClasses.add(className);
                    };

                    const nameParts = row.name.trim().split(/\s+/);
                    const first_name = nameParts[0];
                    const last_name = nameParts.slice(1).join(' ') || '';
                    const existingUserRows = await tx.query(
                        "SELECT id FROM users WHERE email = ? AND school_id = ? AND deleted_at IS NULL LIMIT 1",
                        [row.email, schoolId]
                    );
                    const existingUser = existingUserRows[0];

                    let studentId;
                    let uId;
                    if (existingUser) {
                        uId = existingUser.id;
                        await tx.query(
                            "UPDATE users SET first_name = ?, last_name = ? WHERE id = ?",
                            [first_name, last_name, uId]
                        );

                        const existingStudentRows = await tx.query(
                            "SELECT id FROM students WHERE user_id = ? AND school_id = ? AND deleted_at IS NULL LIMIT 1",
                            [uId, schoolId]
                        );
                        const existingStudent = existingStudentRows[0];

                        if (existingStudent) {
                            studentId = existingStudent.id;
                            await tx.query(
                                `UPDATE students SET class_id = ?, roll_no = ?, dob = ?, gender = ?, admission_date = ?
                                WHERE id = ?`,
                                [
                                    finalClassId,
                                    row.roll_no || null,
                                    row.date_of_birth || row.dob || null,
                                    row.gender || null,
                                    row.admission_date || new Date().toISOString().split('T')[0],
                                    studentId
                                ]
                            );
                        } else {
                            const studentResult = await tx.query(
                                `INSERT INTO students (school_id, user_id, class_id, admission_no, roll_no, dob, gender, admission_date, status)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
                                [
                                    schoolId, uId, finalClassId,
                                    'ADM' + Date.now() + Math.floor(Math.random() * 100),
                                    row.roll_no || null,
                                    row.date_of_birth || row.dob || null,
                                    row.gender || null,
                                    row.admission_date || new Date().toISOString().split('T')[0]
                                ]
                            );
                            studentId = studentResult.insertId;
                        };
                    } else {
                        const hashedPassword = await bcrypt.hash('SchoolSync@123', 10);
                        const userResult = await tx.query(
                            `INSERT INTO users (school_id, first_name, last_name, email, password, role, status, is_default_password)
                            VALUES (?, ?, ?, ?, ?, 'student', 'active', 1)`,
                            [schoolId, first_name, last_name, row.email, hashedPassword]
                        );
                        uId = userResult.insertId;

                        const lastStudents = await tx.query(
                            "SELECT admission_no FROM students WHERE admission_no LIKE 'ADM%' ORDER BY id DESC LIMIT 1"
                        );

                        let nextNum = 40026;
                        if (lastStudents.length > 0) {
                            const lastNumParsed = parseInt(lastStudents[0].admission_no.replace('ADM', ''), 10);
                            if (!isNaN(lastNumParsed)) nextNum = lastNumParsed + 1;
                        };
                        
                        const admissionNo = 'ADM' + String(nextNum).padStart(6, '0');
                        const studentResult = await tx.query(
                            `INSERT INTO students (school_id, user_id, class_id, admission_no, roll_no, dob, gender, admission_date, status)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
                            [
                                schoolId, uId, finalClassId, admissionNo,
                                row.roll_no || null,
                                row.date_of_birth || row.dob || null,
                                row.gender || null,
                                row.admission_date || new Date().toISOString().split('T')[0]
                            ]
                        );
                        studentId = studentResult.insertId;
                    };

                    const existingFamilyRows = await tx.query("SELECT id FROM student_family WHERE student_id = ? LIMIT 1", [studentId]);
                    const existingFamily = existingFamilyRows[0];
                    if (existingFamily) {
                        await tx.query(
                            "UPDATE student_family SET father_name = ?, father_phone = ? WHERE student_id = ?",
                            [row.parent_name || null, row.parent_phone || null, studentId]
                        );
                    } else {
                        await tx.query(
                            "INSERT INTO student_family (student_id, father_name, father_phone) VALUES (?, ?, ?)",
                            [studentId, row.parent_name || null, row.parent_phone || null]
                        );
                    };

                    const existingAddrRows = await tx.query("SELECT id FROM student_address_transport WHERE student_id = ? LIMIT 1", [studentId]);
                    const existingAddr = existingAddrRows[0];
                    if (existingAddr) {
                        await tx.query(
                            "UPDATE student_address_transport SET permanent_address = ?, current_address = ? WHERE student_id = ?",
                            [row.address || null, row.address || null, studentId]
                        );
                    } else {
                        await tx.query(
                            "INSERT INTO student_address_transport (student_id, permanent_address, current_address) VALUES (?, ?, ?)",
                            [studentId, row.address || null, row.address || null]
                        );
                    };
                }
                else if (entityType === 'teachers') {
                    const nameParts = row.name.trim().split(/\s+/);
                    const first_name = nameParts[0];
                    const last_name = nameParts.slice(1).join(' ') || '';

                    const existingUserRows = await tx.query(
                        "SELECT id FROM users WHERE email = ? AND school_id = ? AND deleted_at IS NULL LIMIT 1",
                        [row.email, schoolId]
                    );
                    const existingUser = existingUserRows[0];

                    let uId;
                    let teacherId;

                    if (existingUser) {
                        uId = existingUser.id;
                        await tx.query("UPDATE users SET first_name = ?, last_name = ?, phone = ? WHERE id = ?", [first_name, last_name, row.phone || null, uId]);

                        const existingTeacherRows = await tx.query("SELECT id FROM teachers WHERE user_id = ? AND school_id = ? LIMIT 1", [uId, schoolId]);
                        const existingTeacher = existingTeacherRows[0];
                        if (existingTeacher) {
                            teacherId = existingTeacher.id;
                            await tx.query(
                                `UPDATE teachers SET qualification = ?, joining_date = ?, subject = ? WHERE id = ?`,
                                [row.qualification || null, row.joining_date || null, row.subjects || null, teacherId]
                            );
                        } else {
                            const teacherResult = await tx.query(
                                `INSERT INTO teachers (school_id, user_id, subject, qualification, joining_date)
                                VALUES (?, ?, ?, ?, ?)`,
                                [schoolId, uId, row.subjects || null, row.qualification || null, row.joining_date || null]
                            );
                            teacherId = teacherResult.insertId;
                        }
                    } else {
                        const hashedPassword = await bcrypt.hash('SchoolSync@123', 10);
                        const userResult = await tx.query(
                            `INSERT INTO users (school_id, first_name, last_name, email, phone, password, role, status, is_default_password)
                            VALUES (?, ?, ?, ?, ?, ?, 'teacher', 'active', 1)`,
                            [schoolId, first_name, last_name, row.email, row.phone || null, hashedPassword]
                        );
                        uId = userResult.insertId;

                        const teacherResult = await tx.query(
                            `INSERT INTO teachers (school_id, user_id, subject, qualification, joining_date)
                            VALUES (?, ?, ?, ?, ?)`,
                            [schoolId, uId, row.subjects || null, row.qualification || null, row.joining_date || null]
                        );
                        teacherId = teacherResult.insertId;
                    }

                    if (row.salary) {
                        const salaryAmt = parseFloat(row.salary);
                        if (!isNaN(salaryAmt)) {
                            await tx.query(
                                `INSERT INTO salary_structures (school_id, user_id, role, amount)
                                VALUES (?, ?, 'teacher', ?)
                                ON DUPLICATE KEY UPDATE amount = VALUES(amount)`,
                                [schoolId, uId, salaryAmt]
                            );
                        }
                    };
                }
                else if (entityType === 'books') {
                    let existingBook = null;
                    if (row.isbn) {
                        const existingBookRows = await tx.query(
                            "SELECT id FROM library_books WHERE isbn = ? AND school_id = ? LIMIT 1",
                            [row.isbn, schoolId]
                        );
                        existingBook = existingBookRows[0];
                    }

                    const qty = parseInt(row.quantity || 1, 10);

                    if (existingBook) {
                        await tx.query(
                            `UPDATE library_books SET total_copies = total_copies + ?, available_copies = available_copies + ?, category_id = ?, rack_id = ?, publisher = ?, publish_year = ? 
                            WHERE id = ?`,
                            [qty, qty, row.category_id || null, row.rack_id || null, row.publisher || null, row.published_year || null, existingBook.id]
                        );
                    } else {
                        await tx.query(
                            `INSERT INTO library_books (school_id, category_id, rack_id, title, author, isbn, publisher, publish_year, total_copies, available_copies, status)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
                            [ schoolId, row.category_id || null, row.rack_id || null, row.title, row.author || null, row.isbn || null, row.publisher || null, row.published_year || null, qty, qty ]
                        );
                    };
                }
                else if (entityType === 'fees') {
                    const existingStructureRows = await tx.query(
                        "SELECT id FROM fee_structures WHERE school_id = ? AND class_id = ? AND fee_name = ? LIMIT 1",
                        [schoolId, Number(row.class_id), row.fee_type]
                    );
                    const existingStructure = existingStructureRows[0];

                    if (existingStructure) {
                        await tx.query(
                            `UPDATE fee_structures SET amount = ?, due_date = ?, fee_type = ? 
                            WHERE id = ?`,
                            [parseFloat(row.amount), row.due_date || null, row.fee_type, existingStructure.id]
                        );
                    } else {
                        await tx.query(
                            `INSERT INTO fee_structures (school_id, class_id, fee_name, amount, fee_type, due_date, frequency, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, 'monthly', NOW())`,
                            [schoolId, Number(row.class_id), row.fee_type, parseFloat(row.amount), row.fee_type, row.due_date || null]
                        );
                    };
                }
                else if (entityType === 'marks') {
                    const examRows = await tx.query(
                        "SELECT max_marks, pass_marks FROM exams WHERE id = ? AND school_id = ? LIMIT 1",
                        [Number(row.exam_id), schoolId]
                    );
                    const exam = examRows[0];
                    if (!exam) {
                        throw new Error(`Exam not found for exam_id ${row.exam_id}`);
                    }

                    const obtainedMarks = parseFloat(row.marks_obtained);
                    const gradeInfo = calculateGrade(obtainedMarks, exam.max_marks);
                    const status = isPassed(obtainedMarks, exam.pass_marks) ? 'pass' : 'fail';
                    const existingMarkRows = await tx.query(
                        "SELECT id FROM marks WHERE school_id = ? AND exam_id = ? AND student_id = ? AND subject_id = ? LIMIT 1",
                        [schoolId, Number(row.exam_id), Number(row.student_id), Number(row.subject_id)]
                    );
                    const existingMark = existingMarkRows[0];

                    if (existingMark) {
                        await tx.query(
                            `UPDATE marks SET obtained_marks = ?, grade = ?, grade_point = ?, status = ?, remarks = ? WHERE id = ?`,
                            [obtainedMarks, gradeInfo.grade, gradeInfo.gradePoint, status, row.remarks || null, existingMark.id]
                        );
                    } else {
                        await tx.query(
                            `INSERT INTO marks (school_id, exam_id, student_id, subject_id, total_marks, obtained_marks, grade, grade_point, status, remarks)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [ schoolId, Number(row.exam_id), Number(row.student_id), Number(row.subject_id), parseFloat(exam.max_marks), obtainedMarks, gradeInfo.grade, gradeInfo.gradePoint, status, row.remarks || null ]
                        );
                    };
                };
                successCount++;
            };
            if (entityType === 'students' && affectedClasses.size > 0) {
                const { recomputePortalAccessForClass } = require('./portalController');
                for (const className of affectedClasses) {
                    await recomputePortalAccessForClass(schoolId, className, tx);
                };
            };
        });

        const finalStatus = errors.length > 0 ? 'partial' : 'completed';
        await importLogModel.createLog({
            school_id: schoolId,
            imported_by: userId,
            user_role: userRole,
            entity_type: entityType,
            file_name: filename,
            file_path: relativeFilePath,
            total_rows: rows.length,
            success_count: successCount,
            failed_count: errors.length,
            error_report_path: errorReportUrl,
            status: finalStatus
        });

        if (fs.existsSync(fullFilePath)) fs.unlinkSync(fullFilePath);
        return {
            success: true,
            total_rows: rows.length,
            processed_rows: successCount + errors.length,
            success_count: successCount,
            failed_count: errors.length,
            errors,
            error_report_url: errorReportUrl
        };
    } catch (dbError) {
        console.error('[Bulk Import Database Error]:', dbError);
        await importLogModel.createLog({
            school_id: schoolId,
            imported_by: userId,
            user_role: userRole,
            entity_type: entityType,
            file_name: filename,
            file_path: relativeFilePath,
            total_rows: rows.length,
            success_count: 0,
            failed_count: rows.length,
            error_report_path: errorReportUrl,
            status: 'failed'
        });

        if (fs.existsSync(fullFilePath)) fs.unlinkSync(fullFilePath);
        return {
            success: false,
            message: 'Database transaction failed during bulk operations.',
            error_code: 'DATABASE_ERROR',
            errors,
            error_report_url: errorReportUrl
        };
    };
};