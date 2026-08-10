const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const db = require('../../config/database');
const exportLogModel = require('../../models/exportLogModel');
const csvExporter = require('../../utils/exporters/csvExporter');
const excelExporter = require('../../utils/exporters/excelExporter');
const pdfExporter = require('../../utils/exporters/pdfExporter');

const exportsDir = path.resolve(__dirname, '../../../storage/exports');
if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
}

cron.schedule('0 0 * * *', () => {
    try {
        if (fs.existsSync(exportsDir)) {
            const files = fs.readdirSync(exportsDir);
            const now = Date.now();
            const maxAge = 7 * 24 * 60 * 60 * 1000;
            files.forEach(file => {
                const filePath = path.join(exportsDir, file);
                const stat = fs.statSync(filePath);
                if (now - stat.mtimeMs > maxAge) {
                    fs.unlinkSync(filePath);
                };
            });
        };
    } catch (e) {
        console.error("[Bulk Export Cleanup Error]:", e);
    };
});

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

async function sendEmailNotification(toEmail, entityType, downloadUrl) {
    try {
        const html = `
            <h3>SchoolSync Export Complete</h3>
            <p>Your requested bulk export for <strong>${entityType}</strong> is ready for download.</p>
            <p><a href="${downloadUrl}" style="padding: 10px 20px; background-color: #3b82f6; color: white; text-decoration: none; border-radius: 5px;">Download Report</a></p>
            <p>Note: This download link will expire in 7 days.</p>
        `;
        await transporter.sendMail({
            from: `"SchoolSync Reports" <${process.env.EMAIL_USER}>`,
            to: toEmail,
            subject: `SchoolSync Export Ready: ${entityType}`,
            html
        });
    } catch (err) {
        console.error("Failed to send export notification email:", err);
    };
};

exports.renderExportDashboard = async (req, res, next) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const logs = await exportLogModel.getLogsBySchool(schoolId);

        const classes = await db.queryAsync(
            'SELECT id, class_name, section FROM classes WHERE school_id = ? ORDER BY class_name, section',
            [schoolId]
        );

        const exams = await db.queryAsync(
            'SELECT id, name FROM exams WHERE school_id = ? ORDER BY name ASC',
            [schoolId]
        );

        const categories = await db.queryAsync(
            'SELECT id, name FROM library_categories WHERE school_id = ? ORDER BY name ASC',
            [schoolId]
        );

        res.render('schoolAdmin/exports/dashboard', {
            title: 'Bulk Exports',
            logs,
            classes,
            exams,
            categories,
            user: req.user || req.session.user
        });
    } catch (err) {
        next(err);
    };
};

exports.getLogs = async (req, res, next) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const logs = await exportLogModel.getLogsBySchool(schoolId);
        return res.status(200).json({ success: true, logs });
    } catch (err) {
        next(err);
    };
};

exports.exportEntity = async (req, res, next) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const userId = (req.user?.id || req.session.user?.id);
        const userRole = (req.user?.role || req.session.user?.role);
        const userEmail = (req.user?.email || req.session.user?.email);
        const { entityType } = req.params;
        const format = String(req.query.format || 'csv').toLowerCase();
        const allowedFormats = new Set(['csv', 'xlsx', 'pdf']);
        if (!allowedFormats.has(format)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid export format. Supported formats: csv, xlsx, pdf.'
            });
        };

        const schools = await db.queryAsync('SELECT school_name FROM schools WHERE id = ?', [schoolId]);
        const schoolName = schools[0]?.school_name || 'SchoolSync';

        let teacherClassIds = [];
        const classScopedExports = new Set(['students', 'attendance', 'fees', 'marks', 'defaulters']);
        if (userRole === 'teacher' && classScopedExports.has(entityType)) {
            const teacherRows = await db.queryAsync('SELECT id FROM teachers WHERE user_id = ? AND school_id = ? LIMIT 1', [userId, schoolId]);
            const teacher = teacherRows[0];
            if (teacher) {
                const assignments = await db.queryAsync('SELECT class_id FROM teacher_class_assign WHERE teacher_id = ?', [teacher.id]);
                teacherClassIds = assignments.map(a => a.class_id);
            }
            if (teacherClassIds.length === 0) {
                return res.status(403).json({ success: false, message: 'You have no assigned classes to export data from.' });
            };
        };

        const { data, headers, title } = await fetchExportData(entityType, req.query, schoolId, userRole, teacherClassIds);
        if (data.length === 0) {
            return res.status(400).json({ success: false, message: 'No records match the selected filters.' });
        };

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${entityType}_export_${timestamp}.${format}`;
        const filePath = path.join(exportsDir, filename);
        const relativeFilePath = `/exports/${filename}`;
        const logId = await exportLogModel.createLog({
            school_id: schoolId,
            exported_by: userId,
            entity_type: entityType,
            filters_applied: req.query,
            file_name: filename,
            file_path: relativeFilePath,
            record_count: data.length,
            status: 'processing'
        });

        const downloadUrl = `${req.protocol}://${req.get('host')}/api/export/download/${filename}`;
        if (data.length > 1000) {
            processExportAsync(logId, schoolId, data, headers, filePath, format, title, schoolName, userEmail, entityType, downloadUrl);
            return res.status(202).json({
                success: true,
                message: 'Export is large and is being generated in the background. An email notification will be sent.',
                download_url: downloadUrl
            });
        } else {
            await generateFile(data, headers, filePath, format, title, schoolName);
            const stats = fs.statSync(filePath);
            await exportLogModel.updateLog(logId, schoolId, {
                file_size: stats.size,
                status: 'completed'
            });
            return res.status(200).json({
                success: true,
                download_url: downloadUrl
            });
        };
    } catch (err) {
        next(err);
    };
};

exports.downloadFile = async (req, res, next) => {
    try {
        const { fileName } = req.params;
        const filePath = path.join(exportsDir, fileName);
        if (!fs.existsSync(filePath)) {
            req.flash('error', 'File not found or has expired');
            return res.redirect('/schooladmin/exports');
        };

        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const rows = await db.queryAsync("SELECT id FROM export_logs WHERE file_name = ? AND school_id = ?", [fileName, schoolId]);
        if (rows.length > 0) {
            await exportLogModel.updateLog(rows[0].id, schoolId, {
                downloaded_at: new Date()
            });
        };

        return res.download(filePath);
    } catch (err) {
        next(err);
    };
};

async function processExportAsync(logId, schoolId, data, headers, filePath, format, title, schoolName, userEmail, entityType, downloadUrl) {
    try {
        await generateFile(data, headers, filePath, format, title, schoolName);
        const stats = fs.statSync(filePath);
        await exportLogModel.updateLog(logId, schoolId, {
            file_size: stats.size,
            status: 'completed'
        });
        await sendEmailNotification(userEmail, entityType, downloadUrl);
    } catch (err) {
        console.error(`[Background Export Job ${logId} Failed]:`, err);
        await exportLogModel.updateLog(logId, schoolId, { status: 'failed' });
    };
};

async function generateFile(data, headers, filePath, format, title, schoolName) {
    if (format === 'csv') {
        await csvExporter.exportToCSV(data, headers, filePath);
    } else if (format === 'xlsx') {
        excelExporter.exportToExcel(data, headers, filePath, 'Report');
    } else if (format === 'pdf') {
        await pdfExporter.exportToPDF(data, headers, filePath, title, schoolName);
    } else {
        const error = new Error('Invalid export format. Supported formats: csv, xlsx, pdf.');
        error.statusCode = 400;
        throw error;
    };
};

async function fetchExportData(entityType, filters, schoolId, userRole, teacherClassIds) {
    let data = [];
    let headers = [];
    let title = "";

    switch (entityType) {
        case 'students': {
            title = "Students List";
            headers = [
                { label: 'Admission No', key: 'admission_no' },
                { label: 'Roll No', key: 'roll_no' },
                { label: 'First Name', key: 'first_name' },
                { label: 'Last Name', key: 'last_name' },
                { label: 'Email', key: 'email' },
                { label: 'Class', key: 'class_name' },
                { label: 'Section', key: 'section' },
                { label: 'Date of Birth', key: 'dob' },
                { label: 'Gender', key: 'gender' },
                { label: 'Status', key: 'status' }
            ];

            let sql = `
                SELECT s.*, u.first_name AS first_name, u.last_name AS last_name, u.email, c.class_name, c.section, s.status
                FROM students s
                JOIN users u ON s.user_id = u.id
                LEFT JOIN classes c ON s.class_id = c.id
                WHERE s.school_id = ? AND s.deleted_at IS NULL
            `;
            const params = [schoolId];

            if (userRole === 'teacher') {
                sql += " AND s.class_id IN (?)";
                params.push(teacherClassIds);
            };

            if (filters.class_id) {
                sql += " AND s.class_id = ?";
                params.push(filters.class_id);
            };

            if (filters.status) {
                sql += " AND s.status = ?";
                params.push(filters.status);
            };

            data = await db.queryAsync(sql, params);
            break;
        };

        case 'teachers': {
            title = "Teachers List";
            headers = [
                { label: 'First Name', key: 'first_name' },
                { label: 'Last Name', key: 'last_name' },
                { label: 'Email', key: 'email' },
                { label: 'Phone', key: 'phone' },
                { label: 'Qualification', key: 'qualification' },
                { label: 'Subject', key: 'subject' },
                { label: 'Joining Date', key: 'joining_date' },
                { label: 'Status', key: 'status' }
            ];

            let sql = `
                SELECT t.*, u.first_name AS first_name, u.last_name AS last_name, u.email, u.phone, u.status
                FROM teachers t
                JOIN users u ON t.user_id = u.id
                WHERE t.school_id = ? AND u.deleted_at IS NULL
            `;
            const params = [schoolId];

            if (filters.subject) {
                sql += " AND t.subject LIKE ?";
                params.push(`%${filters.subject}%`);
            };
            if (filters.status) {
                sql += " AND u.status = ?";
                params.push(filters.status);
            };

            data = await db.queryAsync(sql, params);
            break;
        };

        case 'attendance': {
            title = "Attendance Report";
            headers = [
                { label: 'Roll No', key: 'roll_no' },
                { label: 'Student Name', key: 'student_name' },
                { label: 'Class', key: 'class_name' },
                { label: 'Section', key: 'section' },
                { label: 'Present Count', key: 'present_count' },
                { label: 'Absent Count', key: 'absent_count' },
                { label: 'Late Count', key: 'late_count' },
                { label: 'Total Days', key: 'total_days' }
            ];

            let sql = `
                SELECT s.roll_no, CONCAT_WS(' ', u.first_name, u.last_name) as student_name, 
                    c.class_name, c.section,
                    SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) as present_count,
                    SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) as absent_count,
                    SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) as late_count,
                    COUNT(a.id) as total_days
                FROM students s
                JOIN users u ON s.user_id = u.id
                LEFT JOIN classes c ON s.class_id = c.id
                LEFT JOIN attendance a ON s.id = a.student_id
                WHERE s.school_id = ? AND s.deleted_at IS NULL
            `;
            const params = [schoolId];

            if (userRole === 'teacher') {
                sql += " AND s.class_id IN (?)";
                params.push(teacherClassIds);
            };

            if (filters.class_id) {
                sql += " AND s.class_id = ?";
                params.push(filters.class_id);
            };
            if (filters.date_from) {
                sql += " AND a.date >= ?";
                params.push(filters.date_from);
            };
            if (filters.date_to) {
                sql += " AND a.date <= ?";
                params.push(filters.date_to);
            };

            sql += " GROUP BY s.id, u.first_name, u.last_name, s.roll_no, c.class_name, c.section";
            data = await db.queryAsync(sql, params);
            break;
        };

        case 'fees': {
            title = "Fee Collection Report";
            headers = [
                { label: 'Student Name', key: 'student_name' },
                { label: 'Class', key: 'class_name' },
                { label: 'Section', key: 'section' },
                { label: 'Fee Type', key: 'fee_name' },
                { label: 'Total Amount', key: 'total_amount' },
                { label: 'Paid Amount', key: 'paid_amount' },
                { label: 'Status', key: 'status' },
                { label: 'Due Date', key: 'due_date' }
            ];

            let sql = `
                SELECT CONCAT_WS(' ', u.first_name, u.last_name) as student_name, 
                    c.class_name, c.section,
                    fs.fee_name, sf.total_amount, sf.paid_amount, sf.status, sf.due_date
                FROM student_fees sf
                JOIN students s ON sf.student_id = s.id
                JOIN users u ON s.user_id = u.id
                LEFT JOIN classes c ON s.class_id = c.id
                LEFT JOIN fee_structures fs ON sf.fee_structure_id = fs.id
                WHERE sf.school_id = ?
            `;
            const params = [schoolId];

            if (userRole === 'teacher') {
                sql += " AND s.class_id IN (?)";
                params.push(teacherClassIds);
            };

            if (filters.class_id) {
                sql += " AND s.class_id = ?";
                params.push(filters.class_id);
            };

            if (filters.status) {
                sql += " AND sf.status = ?";
                params.push(filters.status);
            };

            if (filters.date_from) {
                sql += " AND sf.due_date >= ?";
                params.push(filters.date_from);
            };

            if (filters.date_to) {
                sql += " AND sf.due_date <= ?";
                params.push(filters.date_to);
            };

            const raw = await db.queryAsync(sql, params);
            data = raw;
            if (data.length > 0) {
                const totalAmt = data.reduce((sum, r) => sum + parseFloat(r.total_amount || 0), 0);
                const paidAmt = data.reduce((sum, r) => sum + parseFloat(r.paid_amount || 0), 0);
                data.push({
                    student_name: 'TOTALS',
                    class_name: '',
                    section: '',
                    fee_name: '',
                    total_amount: totalAmt.toFixed(2),
                    paid_amount: paidAmt.toFixed(2),
                    status: '',
                    due_date: ''
                });
            };
            break;
        };

        case 'marks': {
            title = "Exam Results Report";
            headers = [
                { label: 'Student Name', key: 'student_name' },
                { label: 'Roll No', key: 'roll_no' },
                { label: 'Class', key: 'class_name' },
                { label: 'Section', key: 'section' },
                { label: 'Subject', key: 'subject_name' },
                { label: 'Marks Obtained', key: 'obtained_marks' },
                { label: 'Grade', key: 'grade' },
                { label: 'Remarks', key: 'remarks' }
            ];

            let sql = `
                SELECT CONCAT_WS(' ', u.first_name, u.last_name) as student_name, 
                       s.roll_no, c.class_name, c.section,
                       sub.subject_name, m.obtained_marks, m.grade, m.remarks
                FROM marks m
                JOIN students s ON m.student_id = s.id
                JOIN users u ON s.user_id = u.id
                LEFT JOIN classes c ON s.class_id = c.id
                JOIN subjects sub ON m.subject_id = sub.id
                WHERE m.school_id = ?
            `;
            const params = [schoolId];

            if (userRole === 'teacher') {
                sql += " AND s.class_id IN (?)";
                params.push(teacherClassIds);
            };

            if (filters.exam_id) {
                sql += " AND m.exam_id = ?";
                params.push(filters.exam_id);
            };

            if (filters.class_id) {
                sql += " AND s.class_id = ?";
                params.push(filters.class_id);
            };

            const raw = await db.queryAsync(sql, params);
            data = raw;

            if (data.length > 0) {
                const totalObtained = data.reduce((sum, r) => sum + parseFloat(r.obtained_marks || 0), 0);
                const avgObtained = totalObtained / data.length;
                data.push({
                    student_name: 'AVERAGE',
                    roll_no: '',
                    class_name: '',
                    section: '',
                    subject_name: '',
                    obtained_marks: avgObtained.toFixed(2),
                    grade: '',
                    remarks: ''
                });
            };
            break;
        };

        case 'books': {
            title = "Library Books Inventory";
            headers = [
                { label: 'Title', key: 'title' },
                { label: 'Author', key: 'author' },
                { label: 'ISBN', key: 'isbn' },
                { label: 'Category', key: 'category_name' },
                { label: 'Rack No', key: 'rack_number' },
                { label: 'Total Copies', key: 'total_copies' },
                { label: 'Available Copies', key: 'available_copies' },
                { label: 'Status', key: 'status' }
            ];

            let sql = `
                SELECT b.*, lc.name as category_name, lr.rack_number
                FROM library_books b
                LEFT JOIN library_categories lc ON b.category_id = lc.id
                LEFT JOIN library_racks lr ON b.rack_id = lr.id
                WHERE b.school_id = ?
            `;
            const params = [schoolId];

            if (filters.category_id) {
                sql += " AND b.category_id = ?";
                params.push(filters.category_id);
            };

            if (filters.status) {
                sql += " AND b.status = ?";
                params.push(filters.status);
            };
            data = await db.queryAsync(sql, params);
            break;
        };

        case 'defaulters': {
            title = "Defaulters List (Fees & Library)";
            headers = [
                { label: 'Defaulter Type', key: 'defaulter_type' },
                { label: 'Student Name', key: 'student_name' },
                { label: 'Roll No', key: 'roll_no' },
                { label: 'Class', key: 'class_name' },
                { label: 'Section', key: 'section' },
                { label: 'Details', key: 'details' },
                { label: 'Due Date', key: 'due_date' },
                { label: 'Amount/Fine', key: 'amount_fine' }
            ];

            let feeSql = `
                SELECT 'Fee Pending' as defaulter_type, CONCAT_WS(' ', u.first_name, u.last_name) as student_name,
                    s.roll_no, c.class_name, c.section, sf.fee_month as details, sf.due_date,
                    (sf.total_amount - sf.paid_amount) as amount_fine
                FROM student_fees sf
                JOIN students s ON sf.student_id = s.id
                JOIN users u ON s.user_id = u.id
                LEFT JOIN classes c ON s.class_id = c.id
                WHERE sf.school_id = ? AND sf.status != 'paid' AND sf.due_date < CURDATE() AND s.deleted_at IS NULL
            `;
            const feeParams = [schoolId];

            if (userRole === 'teacher') {
                feeSql += " AND s.class_id IN (?)";
                feeParams.push(teacherClassIds);
            }

            const feeDefaulters = await db.queryAsync(feeSql, feeParams);
            let libSql = `
                SELECT 'Book Overdue' as defaulter_type, CONCAT_WS(' ', u.first_name, u.last_name) as student_name,
                    s.roll_no, c.class_name, c.section, b.title as details, li.due_date,
                    li.fine_amount as amount_fine
                FROM library_issues li
                JOIN library_books b ON li.book_id = b.id
                JOIN library_members lm ON li.member_id = lm.id
                JOIN users u ON lm.user_id = u.id
                JOIN students s ON s.user_id = u.id
                LEFT JOIN classes c ON s.class_id = c.id
                WHERE li.school_id = ? AND li.status IN ('issued', 'overdue') AND li.due_date < CURDATE()
            `;
            
            const libParams = [schoolId];
            if (userRole === 'teacher') {
                libSql += " AND s.class_id IN (?)";
                libParams.push(teacherClassIds);
            };

            const libDefaulters = await db.queryAsync(libSql, libParams);
            data = [...feeDefaulters, ...libDefaulters];
            break;
        };
        default: throw new Error(`Unsupported export type: ${entityType}`);
    };
    return { data, headers, title };
};