const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const db = require('../../config/database');

const CERTIFICATE_TYPES = [
    { value: 'bonafide', label: 'Bonafide Certificate' },
    { value: 'leaving', label: 'Leaving Certificate / Transfer Certificate' },
    { value: 'character', label: 'Character Certificate' },
    { value: 'study', label: 'Study Certificate' },
    { value: 'fee_paid', label: 'Fee Paid Certificate' },
    { value: 'no_due', label: 'No Due Certificate' },
    { value: 'participation', label: 'Participation Certificate' },
    { value: 'achievement', label: 'Achievement Certificate' },
    { value: 'custom', label: 'Custom Certificate' },
];

const TEMPLATE_VARIABLES = [
    { key: '{{school_name}}', desc: 'School Name' },
    { key: '{{school_address}}', desc: 'School Address' },
    { key: '{{student_name}}', desc: 'Student Full Name' },
    { key: '{{admission_number}}', desc: 'Admission Number' },
    { key: '{{roll_number}}', desc: 'Roll Number' },
    { key: '{{class_name}}', desc: 'Class Name' },
    { key: '{{section}}', desc: 'Section' },
    { key: '{{father_name}}', desc: "Father's Name" },
    { key: '{{mother_name}}', desc: "Mother's Name" },
    { key: '{{guardian_name}}', desc: "Guardian's Name" },
    { key: '{{parent_name}}', desc: 'Parent / Guardian Name' },
    { key: '{{date_of_birth}}', desc: 'Date of Birth' },
    { key: '{{academic_year}}', desc: 'Academic Year' },
    { key: '{{issue_date}}', desc: 'Issue Date' },
    { key: '{{purpose}}', desc: 'Purpose' },
    { key: '{{principal_name}}', desc: 'Principal Name' },
    { key: '{{certificate_no}}', desc: 'Certificate Number' },
    { key: '{{teacher_name}}', desc: 'Teacher Name (staff)' },
    { key: '{{employee_code}}', desc: 'Employee Code (staff)' },
    { key: '{{designation}}', desc: 'Designation (staff)' },
    { key: '{{joining_date}}', desc: 'Joining Date (staff)' },
];

async function generateCertNo(schoolId) {
    const year = new Date().getFullYear();
    const prefix = `CERT-${schoolId}-${year}-`;

    const rows = await db.queryAsync(
        `SELECT certificate_no FROM issued_certificates
        WHERE school_id = ? AND certificate_no LIKE ?
        ORDER BY id DESC LIMIT 1`,
        [schoolId, `${prefix}%`]
    );

    let seq = 1;
    if (rows.length) {
        const last = rows[0].certificate_no;
        const parts = last.split('-');
        const lastNum = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(lastNum)) seq = lastNum + 1;
    };

    return `${prefix}${String(seq).padStart(4, '0')}`;
};

function renderTemplate(template, vars) {
    let result = (template || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (const [key, value] of Object.entries(vars)) {
        result = result.split(`{{${key}}}`).join(value || '');
    };
    return result;
};

function sanitizeBody(text) {
    if (!text) return '';
    return text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .map(l => l.trimEnd())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function fmtDate(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d)) return String(value).slice(0, 10);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};


function certUploadDir() {
    return path.resolve(__dirname, '../../../storage/uploads/certificates');
};

let teacherColumnsCache = null;
async function getTeacherColumns() {
    if (teacherColumnsCache) return teacherColumnsCache;

    try {
        const [columns] = await db.query('SHOW COLUMNS FROM teachers');
        teacherColumnsCache = new Set(columns.map(col => col.Field));
    } catch (err) {
        console.error('[CertCtrl] getTeacherColumns:', err);
        teacherColumnsCache = new Set([
            'id', 'school_id', 'user_id', 'subject', 'qualification', 'experience',
            'gender', 'dob', 'marital_status', 'father_name', 'mother_name',
            'current_address', 'permanent_address', 'emergency_contact',
            'joining_date', 'deleted_at', 'created_at', 'updated_at',
        ]);
    };
    return teacherColumnsCache;
};

async function buildStudentVars(schoolId, studentId, extraVars = {}) {
    const [students] = await db.query(
        `SELECT st.*, u.first_name, u.last_name, u.email, u.phone,
            c.class_name, c.section, c.academic_year,
            sf.father_name AS family_father_name,
            sf.mother_name AS family_mother_name,
            sf.guardian_name AS family_guardian_name,
            s.school_name, s.school_address, s.school_principal_name
        FROM students st
        JOIN users u ON u.id = st.user_id
        LEFT JOIN classes c ON c.id = st.class_id
        LEFT JOIN student_family sf
            ON sf.student_id = st.id
            AND (sf.school_id = st.school_id OR sf.school_id IS NULL)
        JOIN schools s ON s.id = st.school_id
        WHERE st.id = ? AND st.school_id = ?
        LIMIT 1`,
        [studentId, schoolId]
    );

    if (!students.length) return null;
    const st = students[0];
    const fatherName = st.family_father_name || '';
    const motherName = st.family_mother_name || '';
    const guardianName = st.family_guardian_name || '';
    const parentName = fatherName || motherName || guardianName;

    return {
        school_name: st.school_name || '',
        school_address: st.school_address || '',
        student_name: `${st.first_name || ''} ${st.last_name || ''}`.trim(),
        admission_number: st.admission_no || st.admission_number || '',
        roll_number: st.roll_no || '',
        class_name: st.class_name || '',
        section: st.section || '',
        father_name: fatherName,
        mother_name: motherName,
        guardian_name: guardianName,
        parent_name: parentName,
        date_of_birth: fmtDate(st.dob || st.date_of_birth),
        academic_year: st.academic_year || '',
        issue_date: extraVars.issue_date || fmtDate(new Date()),
        purpose: extraVars.purpose || '',
        principal_name: st.school_principal_name || 'Principal',
        certificate_no: extraVars.certificate_no || '',
    };
};

async function buildTeacherVars(schoolId, teacherId, extraVars = {}) {
    const [teachers] = await db.query(
        `SELECT t.*, u.first_name, u.last_name, u.email,
            s.school_name, s.school_address, s.school_principal_name
        FROM teachers t
        JOIN users u ON u.id = t.user_id
        JOIN schools s ON s.id = t.school_id
        WHERE t.id = ? AND t.school_id = ?
        LIMIT 1`,
        [teacherId, schoolId]
    );

    if (!teachers.length) return null;
    const t = teachers[0];

    return {
        school_name: t.school_name || '',
        school_address: t.school_address || '',
        teacher_name: `${t.first_name || ''} ${t.last_name || ''}`.trim(),
        employee_code: t.employee_code || t.staff_id || '',
        designation: t.designation || 'Teacher',
        joining_date: fmtDate(t.joining_date || t.created_at),
        issue_date: extraVars.issue_date || fmtDate(new Date()),
        purpose: extraVars.purpose || '',
        principal_name: t.school_principal_name || 'Principal',
        certificate_no: extraVars.certificate_no || '',
        student_name: '',
        admission_number: '',
        roll_number: '',
        class_name: '',
        section: '',
        father_name: '',
        mother_name: '',
        guardian_name: '',
        parent_name: '',
        date_of_birth: '',
        academic_year: '',
    };
};

async function streamCertificatePdf(res, { school, template, certNo, issueDate, recipientName, bodyContent, savePath }) {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });

    if (savePath) {
        fs.mkdirSync(path.dirname(savePath), { recursive: true });
        doc.pipe(fs.createWriteStream(savePath));
    };

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="certificate-${certNo}.pdf"`);
    doc.pipe(res);

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const mg = 36;
    const inner = mg + 10;
    const cw = pageW - inner * 2;

    const C = { navy: '#1E3A5F', blue: '#1E40AF', blueLight: '#3B82F6', bluePale: '#BFDBFE', slate: '#475569', slateLight: '#94A3B8', dark: '#1E293B', bg: '#F0F6FF', white: '#FFFFFF', };

    doc.rect(0, 0, pageW, pageH).fill(C.bg);
    doc.rect(0, 0, pageW, 8).fill(C.blue);
    doc.rect(0, pageH - 8, pageW, 8).fill(C.blue);
    doc.rect(mg, mg, pageW - mg * 2, pageH - mg * 2)
        .lineWidth(3).strokeColor(C.blue).stroke();
    doc.rect(mg + 6, mg + 6, pageW - (mg + 6) * 2, pageH - (mg + 6) * 2)
        .lineWidth(0.8).strokeColor(C.bluePale).stroke();
    [
        [mg + 3, mg + 3], [pageW - mg - 3, mg + 3],
        [mg + 3, pageH - mg - 3], [pageW - mg - 3, pageH - mg - 3],
    ].forEach(([cx, cy]) => {
        doc.circle(cx, cy, 4).fill(C.blue);
        doc.circle(cx, cy, 2).fill(C.white);
    });

    const wmText = (school.school_name || 'SchoolSync').toUpperCase();
    doc.save();
    doc.translate(pageW / 2, pageH / 2);
    doc.rotate(-45);
    doc.fillColor(C.blue).fillOpacity(0.04);
    doc.font('Helvetica-Bold').fontSize(54)
        .text(wmText, 0, 0, { align: 'center', width: pageW - 80 });
    doc.restore();
    doc.fillOpacity(1);

    const headerBandH = 90;
    const headerBandY = mg + 7;

    doc.rect(mg + 7, headerBandY, pageW - (mg + 7) * 2, headerBandH).fill(C.navy);

    let logoRendered = false;
    if (template.logo_enabled && school.logo) {
        const logoPath = path.join(__dirname, '../../public', school.logo);
        if (fs.existsSync(logoPath)) {
            try {
                const logoSize = 64;
                doc.image(logoPath, pageW / 2 - logoSize / 2, headerBandY + (headerBandH - logoSize) / 2,
                    { width: logoSize, height: logoSize, fit: [logoSize, logoSize] });
                logoRendered = true;
            } catch (_) { /* skip on error */ }
        };
    };

    let y = headerBandY + headerBandH + 10;
    if (!logoRendered) {
        const snY = headerBandY + 16;
        doc.fillColor(C.white).font('Helvetica-Bold').fontSize(19)
            .text(school.school_name || 'School Name', inner, snY, { align: 'center', width: cw });
        if (school.school_address) {
            doc.fillColor(C.bluePale).font('Helvetica').fontSize(9)
                .text(school.school_address, inner, snY + 26, { align: 'center', width: cw });
        };
        if (template.header_text) {
            doc.fillColor(C.bluePale).font('Helvetica').fontSize(8)
                .text(template.header_text, inner, snY + 42, { align: 'center', width: cw });
        };
    } else {
        doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(18)
            .text(school.school_name || 'School Name', inner, y, { align: 'center', width: cw });
        y += 22;
        if (school.school_address) {
            doc.fillColor(C.slate).font('Helvetica').fontSize(9)
                .text(school.school_address, inner, y, { align: 'center', width: cw });
            y += 14;
        };
        if (template.header_text) {
            doc.fillColor(C.blue).font('Helvetica').fontSize(9)
                .text(template.header_text, inner, y, { align: 'center', width: cw });
            y += 13;
        };
        y += 6;
    };

    const divX1 = mg + 20;
    const divX2 = pageW - mg - 20;
    doc.strokeColor(C.blue).lineWidth(2).moveTo(divX1, y).lineTo(divX2, y).stroke();
    y += 3;
    doc.strokeColor(C.bluePale).lineWidth(0.8).moveTo(divX1, y).lineTo(divX2, y).stroke();
    y += 14;

    const titleText = (template.title || 'CERTIFICATE').toUpperCase();
    doc.font('Helvetica-Bold').fontSize(13);
    const titleW = doc.widthOfString(titleText) + 48;
    const titleH = 28;
    const titleX = (pageW - titleW) / 2;
    doc.rect(titleX, y, titleW, titleH).fill(C.blue);
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(13)
        .text(titleText, titleX, y + 7, { align: 'center', width: titleW });
    y += titleH + 14;

    doc.strokeColor(C.bluePale).lineWidth(0.6)
        .moveTo(divX1 + 40, y).lineTo(divX2 - 40, y).stroke();
    y += 13;

    const metaY = y;
    doc.fillColor(C.slate).font('Helvetica').fontSize(9);
    doc.text('Certificate No:', inner, metaY);
    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(9)
        .text(certNo, inner, metaY + 11);
    doc.fillColor(C.slate).font('Helvetica').fontSize(9)
        .text('Issue Date:', inner, metaY, { align: 'right', width: cw });
    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(9)
        .text(fmtDate(issueDate), inner, metaY + 11, { align: 'right', width: cw });
    y += 36;

    doc.strokeColor(C.bluePale).lineWidth(0.5)
        .moveTo(inner, y).lineTo(inner + cw, y).stroke();
    y += 14;

    const cleanBody = sanitizeBody(bodyContent);
    const paragraphs = cleanBody.split(/\n\n+/);
    const bodyX = inner + 8;
    const bodyW = cw - 16;

    doc.fillColor(C.dark).font('Helvetica').fontSize(11.5);
    paragraphs.forEach((para, idx) => {
        para.split('\n').forEach(line => {
            if (line.trim() === '') { y += 6; return; }
            doc.text(line, bodyX, y, { align: 'justify', width: bodyW, lineGap: 3, continued: false });
            y = doc.y;
        });
        if (idx < paragraphs.length - 1) y += 10;
    });
    y += 24;

    const sigBlockW = 160;
    const sigLineLen = 140;
    const footerY = pageH - mg - 7 - 40;
    const sigBlockY = Math.min(y + 10, footerY - 55);
    const sigLineX = pageW - inner - sigBlockW + (sigBlockW - sigLineLen) / 2;

    const stX = sigLineX + sigLineLen / 2;
    const stY = sigBlockY - 28;
    doc.circle(stX, stY, 22).lineWidth(1).strokeColor(C.blueLight).stroke();
    doc.circle(stX, stY, 18).lineWidth(0.5).strokeColor(C.bluePale).stroke();
    doc.fillColor(C.blue).font('Helvetica-Bold').fontSize(5.5)
        .text('OFFICIAL', stX - 13, stY - 5, { width: 26, align: 'center' })
        .text('SEAL', stX - 13, stY + 1, { width: 26, align: 'center' });
    doc.strokeColor(C.slate).lineWidth(0.8)
        .moveTo(sigLineX, sigBlockY).lineTo(sigLineX + sigLineLen, sigBlockY).stroke();
    const signatorName = template.signature_name || school.school_principal_name || 'Principal';
    const signatorDesig = template.signature_designation || 'Authorized Signatory';
    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(10)
        .text(signatorName, sigLineX, sigBlockY + 5, { width: sigLineLen, align: 'center' });
    doc.fillColor(C.slate).font('Helvetica').fontSize(8.5)
        .text(signatorDesig, sigLineX, sigBlockY + 18, { width: sigLineLen, align: 'center' });
    doc.strokeColor(C.blue).lineWidth(1.5)
        .moveTo(divX1, footerY).lineTo(divX2, footerY).stroke();
    doc.strokeColor(C.bluePale).lineWidth(0.5)
        .moveTo(divX1, footerY + 3).lineTo(divX2, footerY + 3).stroke();

    const footerText = template.footer_text
        || `This certificate is issued by ${school.school_name || 'the school'} and is valid as of the issue date.`;
    doc.fillColor(C.slateLight).font('Helvetica').fontSize(7.5)
        .text(footerText, inner, footerY + 9, { align: 'center', width: cw });

    doc.end();
};

exports.dashboard = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const [statsRows] = await db.query(
            `SELECT
                COUNT(*) AS total_issued,
                SUM(MONTH(issue_date) = MONTH(CURDATE()) AND YEAR(issue_date) = YEAR(CURDATE())) AS this_month,
                SUM(status = 'cancelled') AS cancelled
            FROM issued_certificates
            WHERE school_id = ?`,
            [schoolId]
        );

        const [[templateCount]] = await db.query(
            `SELECT COUNT(*) AS count FROM certificate_templates WHERE school_id = ? AND status = 'active'`,
            [schoolId]
        );

        const [recent] = await db.query(
            `SELECT ic.*, ct.title AS template_title
            FROM issued_certificates ic
            LEFT JOIN certificate_templates ct ON ct.id = ic.template_id
            WHERE ic.school_id = ?
            ORDER BY ic.created_at DESC
            LIMIT 10`,
            [schoolId]
        );

        const stats = statsRows[0] || { total_issued: 0, this_month: 0, cancelled: 0 };
        res.render('schoolAdmin/certificates/dashboard', {
            title: 'Certificates',
            currentPath: '/schooladmin/certificates',
            stats,
            activeTemplates: templateCount?.count || 0,
            recent,
        });
    } catch (err) {
        console.error('[CertCtrl] dashboard:', err);
        req.flash('error', 'Failed to load certificates dashboard.');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.templatesList = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const [templates] = await db.query(
            `SELECT * FROM certificate_templates WHERE school_id = ? ORDER BY created_at DESC`,
            [schoolId]
        );

        res.render('schoolAdmin/certificates/templates', {
            title: 'Certificate Templates',
            currentPath: '/schooladmin/certificates',
            templates,
            CERTIFICATE_TYPES,
        });
    } catch (err) {
        console.error('[CertCtrl] templatesList:', err);
        req.flash('error', 'Failed to load templates.');
        res.redirect('/schooladmin/certificates');
    }
};

exports.addTemplateForm = async (req, res) => {
    res.render('schoolAdmin/certificates/template-form', {
        title: 'New Certificate Template',
        currentPath: '/schooladmin/certificates',
        template: null,
        CERTIFICATE_TYPES,
        TEMPLATE_VARIABLES,
    });
};

exports.createTemplate = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const { title, certificate_type, body_template, header_text, footer_text, logo_enabled, signature_name, signature_designation, status } = req.body;

        if (!title || !certificate_type || !body_template) {
            req.flash('error', 'Title, type, and body are required.');
            return res.redirect('/schooladmin/certificates/templates/add');
        };

        await db.query(
            `INSERT INTO certificate_templates
            (school_id, title, certificate_type, body_template, header_text, footer_text,
            logo_enabled, signature_name, signature_designation, status, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [ schoolId, title.trim(), certificate_type, body_template, header_text || null, footer_text || null, logo_enabled === '1' ? 1 : 0, signature_name || null, signature_designation || null, status || 'active', req.user.id]
        );
        req.flash('success', 'Template created successfully.');
        res.redirect('/schooladmin/certificates/templates');
    } catch (err) {
        console.error('[CertCtrl] createTemplate:', err);
        req.flash('error', 'Failed to create template.');
        res.redirect('/schooladmin/certificates/templates/add');
    };
};

exports.editTemplateForm = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const [[template]] = await db.query(
            `SELECT * FROM certificate_templates WHERE id = ? AND school_id = ?`,
            [req.params.id, schoolId]
        );

        if (!template) {
            req.flash('error', 'Template not found.');
            return res.redirect('/schooladmin/certificates/templates');
        }

        res.render('schoolAdmin/certificates/template-form', {
            title: 'Edit Certificate Template',
            currentPath: '/schooladmin/certificates',
            template,
            CERTIFICATE_TYPES,
            TEMPLATE_VARIABLES,
        });
    } catch (err) {
        console.error('[CertCtrl] editTemplateForm:', err);
        req.flash('error', 'Failed to load template.');
        res.redirect('/schooladmin/certificates/templates');
    };
};

exports.updateTemplate = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const { title, certificate_type, body_template, header_text, footer_text, logo_enabled, signature_name, signature_designation, status } = req.body;

        await db.query(
            `UPDATE certificate_templates
            SET title = ?, certificate_type = ?, body_template = ?, header_text = ?,
                footer_text = ?, logo_enabled = ?, signature_name = ?,
                signature_designation = ?, status = ?
            WHERE id = ? AND school_id = ?`,
            [title?.trim(), certificate_type, body_template, header_text || null, footer_text || null, logo_enabled === '1' ? 1 : 0, signature_name || null, signature_designation || null, status || 'active', req.params.id, schoolId]
        );

        req.flash('success', 'Template updated.');
        res.redirect('/schooladmin/certificates/templates');
    } catch (err) {
        console.error('[CertCtrl] updateTemplate:', err);
        req.flash('error', 'Failed to update template.');
        res.redirect(`/schooladmin/certificates/templates/${req.params.id}/edit`);
    };
};

exports.deleteTemplate = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        await db.query(
            `UPDATE certificate_templates SET status = 'inactive' WHERE id = ? AND school_id = ?`,
            [req.params.id, schoolId]
        );
        req.flash('success', 'Template deactivated.');
        res.redirect('/schooladmin/certificates/templates');
    } catch (err) {
        console.error('[CertCtrl] deleteTemplate:', err);
        req.flash('error', 'Failed to delete template.');
        res.redirect('/schooladmin/certificates/templates');
    };
};

exports.generateForm = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const [templates] = await db.query(
            `SELECT id, title, certificate_type FROM certificate_templates
            WHERE school_id = ? AND status = 'active'
            ORDER BY title ASC`,
            [schoolId]
        );

        const [classes] = await db.query(
            `SELECT id, class_name, section FROM classes WHERE school_id = ? ORDER BY class_name, section`,
            [schoolId]
        );

        res.render('schoolAdmin/certificates/generate', {
            title: 'Generate Certificate',
            currentPath: '/schooladmin/certificates',
            templates,
            classes,
            CERTIFICATE_TYPES,
            TEMPLATE_VARIABLES,
        });
    } catch (err) {
        console.error('[CertCtrl] generateForm:', err);
        req.flash('error', 'Failed to load generate form.');
        res.redirect('/schooladmin/certificates');
    };
};

exports.generateCertificate = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const { template_id, certificate_type, recipient_type, student_id, teacher_id, issue_date, purpose } = req.body;

        const [[template]] = await db.query(
            `SELECT * FROM certificate_templates WHERE id = ? AND school_id = ? AND status = 'active'`,
            [template_id, schoolId]
        );

        if (!template) {
            req.flash('error', 'Template not found or inactive.');
            return res.redirect('/schooladmin/certificates/generate');
        };

        const [[school]] = await db.query(
            `SELECT school_name, school_address, school_principal_name, logo FROM schools WHERE id = ?`,
            [schoolId]
        );

        const certNo = await generateCertNo(schoolId);
        const finalIssueDate = issue_date || new Date().toISOString().slice(0, 10);

        let vars = null;
        let recipientName = '';
        let classId = null;

        if (recipient_type === 'student' && student_id) {
            const [[check]] = await db.query(
                `SELECT id FROM students WHERE id = ? AND school_id = ? AND deleted_at IS NULL`,
                [student_id, schoolId]
            );
            if (!check) {
                req.flash('error', 'Student not found in your school.');
                return res.redirect('/schooladmin/certificates/generate');
            };

            vars = await buildStudentVars(schoolId, student_id, {
                issue_date: fmtDate(finalIssueDate),
                purpose: purpose || '',
                certificate_no: certNo,
            });
            if (!vars) {
                req.flash('error', 'Student data not found.');
                return res.redirect('/schooladmin/certificates/generate');
            };
            recipientName = vars.student_name;

            const [[st]] = await db.query(`SELECT class_id FROM students WHERE id = ?`, [student_id]);
            classId = st?.class_id || null;

        } else if ((recipient_type === 'teacher' || recipient_type === 'staff') && teacher_id) {
            const [[check]] = await db.query(
                `SELECT id FROM teachers WHERE id = ? AND school_id = ?`,
                [teacher_id, schoolId]
            );
            if (!check) {
                req.flash('error', 'Teacher not found in your school.');
                return res.redirect('/schooladmin/certificates/generate');
            };

            vars = await buildTeacherVars(schoolId, teacher_id, {
                issue_date: fmtDate(finalIssueDate),
                purpose: purpose || '',
                certificate_no: certNo,
            });
            if (!vars) {
                req.flash('error', 'Teacher data not found.');
                return res.redirect('/schooladmin/certificates/generate');
            };
            recipientName = vars.teacher_name;
        } else {
            req.flash('error', 'Please select a valid recipient.');
            return res.redirect('/schooladmin/certificates/generate');
        };

        const bodyContent = renderTemplate(template.body_template, vars);
        const uploadDir = certUploadDir();
        fs.mkdirSync(uploadDir, { recursive: true });
        const pdfFilename = `${certNo}.pdf`;
        const pdfPath = path.join(uploadDir, pdfFilename);
        const pdfRelativePath = `/uploads/certificates/${pdfFilename}`;

        const [result] = await db.query(
            `INSERT INTO issued_certificates
            (school_id, template_id, certificate_no, certificate_type, recipient_type,
                student_id, teacher_id, recipient_name, class_id, issue_date, purpose,
            content_snapshot, pdf_path, issued_by, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued')`,
            [schoolId, template.id, certNo, certificate_type || template.certificate_type, recipient_type, student_id ? parseInt(student_id) : null, teacher_id ? parseInt(teacher_id) : null, recipientName, classId, finalIssueDate, purpose || null, bodyContent, pdfRelativePath, req.user.id,]
        );

        await streamCertificatePdf(res, {
            school: school || {},
            template,
            certNo,
            issueDate: finalIssueDate,
            recipientName,
            bodyContent,
            savePath: pdfPath,
        });

    } catch (err) {
        console.error('[CertCtrl] generateCertificate:', err);
        if (!res.headersSent) {
            req.flash('error', 'Failed to generate certificate.');
            res.redirect('/schooladmin/certificates/generate');
        };
    };
};

exports.issuedList = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const { cert_type, class_id, from_date, to_date, search } = req.query;

        let sql = `
            SELECT ic.*, ct.title AS template_title,
                c.class_name, c.section
            FROM issued_certificates ic
            LEFT JOIN certificate_templates ct ON ct.id = ic.template_id
            LEFT JOIN classes c ON c.id = ic.class_id
            WHERE ic.school_id = ?
        `;
        const params = [schoolId];

        if (cert_type) { sql += ` AND ic.certificate_type = ?`; params.push(cert_type); }
        if (class_id) { sql += ` AND ic.class_id = ?`; params.push(class_id); }
        if (from_date) { sql += ` AND ic.issue_date >= ?`; params.push(from_date); }
        if (to_date) { sql += ` AND ic.issue_date <= ?`; params.push(to_date); }
        if (search) {
            sql += ` AND (ic.recipient_name LIKE ? OR ic.certificate_no LIKE ?)`;
            const like = `%${search}%`;
            params.push(like, like);
        };

        sql += ` ORDER BY ic.created_at DESC LIMIT 200`;
        const [certificates] = await db.query(sql, params);
        const [classes] = await db.query(
            `SELECT id, class_name, section FROM classes WHERE school_id = ? ORDER BY class_name`,
            [schoolId]
        );

        res.render('schoolAdmin/certificates/issued', {
            title: 'Issued Certificates',
            currentPath: '/schooladmin/certificates',
            certificates,
            classes,
            CERTIFICATE_TYPES,
            filters: { cert_type, class_id, from_date, to_date, search },
        });
    } catch (err) {
        console.error('[CertCtrl] issuedList:', err);
        req.flash('error', 'Failed to load issued certificates.');
        res.redirect('/schooladmin/certificates');
    };
};

exports.downloadPDF = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const [[cert]] = await db.query(
            `SELECT ic.*, ct.* FROM issued_certificates ic
        LEFT JOIN certificate_templates ct ON ct.id = ic.template_id
        WHERE ic.id = ? AND ic.school_id = ?`,
            [req.params.id, schoolId]
        );

        if (!cert) {
            req.flash('error', 'Certificate not found.');
            return res.redirect('/schooladmin/certificates/issued');
        };

        if (cert.status === 'cancelled') {
            req.flash('error', 'This certificate has been cancelled and cannot be downloaded.');
            return res.redirect('/schooladmin/certificates/issued');
        };

        if (cert.pdf_path) {
            let absPath = path.join(__dirname, '../../../storage', cert.pdf_path);
            if (!fs.existsSync(absPath)) {
                absPath = path.join(__dirname, '../../public', cert.pdf_path);
            };
            if (fs.existsSync(absPath)) {
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename="certificate-${cert.certificate_no}.pdf"`);
                return fs.createReadStream(absPath).pipe(res);
            };
        };

        const [[school]] = await db.query(
            `SELECT school_name, school_address, school_principal_name, logo FROM schools WHERE id = ?`,
            [schoolId]
        );

        await streamCertificatePdf(res, {
            school: school || {},
            template: { title: cert.title || cert.certificate_type, logo_enabled: cert.logo_enabled ?? 1, header_text: cert.header_text || null,
                footer_text: cert.footer_text || null, signature_name: cert.signature_name || null, signature_designation: cert.signature_designation || null,
            },
            certNo: cert.certificate_no,
            issueDate: cert.issue_date,
            recipientName: cert.recipient_name,
            bodyContent: cert.content_snapshot,
            savePath: null,
        });
    } catch (err) {
        console.error('[CertCtrl] downloadPDF:', err);
        if (!res.headersSent) {
            req.flash('error', 'Failed to download certificate.');
            res.redirect('/schooladmin/certificates/issued');
        };
    };
};

exports.cancelCertificate = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        await db.query(
            `UPDATE issued_certificates SET status = 'cancelled' WHERE id = ? AND school_id = ?`,
            [req.params.id, schoolId]
        );
        req.flash('success', 'Certificate cancelled.');
        res.redirect('/schooladmin/certificates/issued');
    } catch (err) {
        console.error('[CertCtrl] cancelCertificate:', err);
        req.flash('error', 'Failed to cancel certificate.');
        res.redirect('/schooladmin/certificates/issued');
    };
};

exports.apiSearchStudents = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const q = `%${String(req.query.q || '').trim()}%`;
        const [rows] = await db.query(
            `SELECT st.id, u.first_name, u.last_name, st.admission_no, st.roll_no,
                c.class_name, c.section
            FROM students st
            JOIN users u ON u.id = st.user_id
            LEFT JOIN classes c ON c.id = st.class_id
            WHERE st.school_id = ? AND st.deleted_at IS NULL
                AND (u.first_name LIKE ? OR u.last_name LIKE ? OR st.admission_no LIKE ? OR st.roll_no LIKE ?)
            LIMIT 20`,
            [schoolId, q, q, q, q]
        );

        res.json({
            success: true,
            results: rows.map(r => ({
                id: r.id,
                text: `${r.first_name} ${r.last_name}`.trim(),
                detail: [r.class_name, r.section, r.admission_no].filter(Boolean).join(' / '),
            }))
        });
    } catch (err) {
        res.json({ success: false, results: [] });
    };
};

exports.apiSearchTeachers = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const q = `%${String(req.query.q || '').trim()}%`;

        const teacherColumns = await getTeacherColumns();
        const hasTeacherColumn = (column) => teacherColumns.has(column);
        const selectTeacherColumn = (column, alias) => (
            hasTeacherColumn(column) ? `t.\`${column}\` AS ${alias}` : `NULL AS ${alias}`
        );

        const searchConditions = ['u.first_name LIKE ?', 'u.last_name LIKE ?'];
        const params = [schoolId, q, q];
        ['employee_code', 'staff_id', 'subject', 'qualification'].forEach(column => {
            if (hasTeacherColumn(column)) {
                searchConditions.push(`t.\`${column}\` LIKE ?`);
                params.push(q);
            }
        });

        const [rows] = await db.query(
            `SELECT t.id, u.first_name, u.last_name,
                ${selectTeacherColumn('employee_code', 'employee_code')},
                ${selectTeacherColumn('staff_id', 'staff_id')},
                ${selectTeacherColumn('designation', 'designation')},
                ${selectTeacherColumn('subject', 'subject')},
                ${selectTeacherColumn('qualification', 'qualification')}
            FROM teachers t
            JOIN users u ON u.id = t.user_id
            WHERE t.school_id = ?
                AND (${searchConditions.join(' OR ')})
            ORDER BY u.first_name ASC, u.last_name ASC
            LIMIT 20`,
            params
        );

        res.json({
            success: true,
            results: rows.map(r => ({
                id: r.id,
                text: `${r.first_name} ${r.last_name}`.trim(),
                detail: [r.designation || r.subject || 'Teacher', r.employee_code || r.staff_id, r.qualification].filter(Boolean).join(' / '),
            }))
        });
    } catch (err) {
        res.json({ success: false, results: [] });
    };
};