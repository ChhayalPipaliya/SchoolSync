const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const db = require('../../config/database');

function fmtDate(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d)) return String(value).slice(0, 10);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
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
};

function streamCertificatePdf(res, { school, template, certNo, issueDate, recipientName, bodyContent }) {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="certificate-${certNo}.pdf"`);
    doc.pipe(res);

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const mg = 36;
    const inner = mg + 10;
    const cw = pageW - inner * 2;

    const C = { navy: '#1E3A5F', blue: '#1E40AF', blueLight: '#3B82F6', bluePale: '#BFDBFE', slate: '#475569', slateLight: '#94A3B8', dark: '#1E293B', bg: '#F0F6FF', white: '#FFFFFF' };

    doc.rect(0, 0, pageW, pageH).fill(C.bg);
    doc.rect(0, 0, pageW, 8).fill(C.blue);
    doc.rect(0, pageH - 8, pageW, 8).fill(C.blue);
    doc.rect(mg, mg, pageW - mg * 2, pageH - mg * 2).lineWidth(3).strokeColor(C.blue).stroke();
    doc.rect(mg + 6, mg + 6, pageW - (mg + 6) * 2, pageH - (mg + 6) * 2).lineWidth(0.8).strokeColor(C.bluePale).stroke();

    const wmText = (school.school_name || 'SchoolSync').toUpperCase();
    doc.save();
    doc.translate(pageW / 2, pageH / 2);
    doc.rotate(-45);
    doc.fillColor(C.blue).fillOpacity(0.04);
    doc.font('Helvetica-Bold').fontSize(54).text(wmText, 0, 0, { align: 'center', width: pageW - 80 });
    doc.restore();
    doc.fillOpacity(1);

    const headerBandH = 90;
    const headerBandY = mg + 7;
    doc.rect(mg + 7, headerBandY, pageW - (mg + 7) * 2, headerBandH).fill(C.navy);

    let y = headerBandY + headerBandH + 10;
    const snY = headerBandY + 16;
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(19).text(school.school_name || 'School Name', inner, snY, { align: 'center', width: cw });
    if (school.school_address) {
        doc.fillColor(C.bluePale).font('Helvetica').fontSize(9).text(school.school_address, inner, snY + 26, { align: 'center', width: cw });
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
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(13).text(titleText, titleX, y + 7, { align: 'center', width: titleW });
    y += titleH + 14;

    const metaY = y;
    doc.fillColor(C.slate).font('Helvetica').fontSize(9).text('Certificate No:', inner, metaY);
    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(9).text(certNo, inner, metaY + 11);
    doc.fillColor(C.slate).font('Helvetica').fontSize(9).text('Issue Date:', inner, metaY, { align: 'right', width: cw });
    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(9).text(fmtDate(issueDate), inner, metaY + 11, { align: 'right', width: cw });
    y += 36;

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

    const footerY = pageH - mg - 7 - 40;
    const sigLineX = pageW - inner - 160 + 10;
    const sigBlockY = footerY - 55;
    const signatorName = template.signature_name || school.school_principal_name || 'Principal';
    const signatorDesig = template.signature_designation || 'Authorized Signatory';
    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(10).text(signatorName, sigLineX, sigBlockY + 5, { width: 140, align: 'center' });
    doc.fillColor(C.slate).font('Helvetica').fontSize(8.5).text(signatorDesig, sigLineX, sigBlockY + 18, { width: 140, align: 'center' });

    doc.end();
};

exports.myCertificates = async (req, res) => {
    try {
        const schoolId = req.user?.school_id;
        const userId = req.user?.id;

        const [[student]] = await db.query(
            `SELECT id FROM students WHERE user_id = ? AND school_id = ? AND deleted_at IS NULL LIMIT 1`,
            [userId, schoolId]
        );

        if (!student) {
            return res.render('student/certificates', {
                title: 'My Certificates',
                certificates: [],
                user: req.user,
                currentPath: '/student/certificates'
            });
        };

        const [certificates] = await db.query(
            `SELECT id, certificate_no, certificate_type, issue_date, status
             FROM issued_certificates
             WHERE school_id = ? AND student_id = ?
             ORDER BY issue_date DESC`,
            [schoolId, student.id]
        );

        res.render('student/certificates', {
            title: 'My Certificates',
            certificates,
            user: req.user,
            currentPath: '/student/certificates'
        });
    } catch (err) {
        console.error('[Student Certificate Controller myCertificates]', err);
        req.flash('error', 'Failed to load certificates.');
        res.redirect('/student/dashboard');
    };
};

exports.downloadMyCertificate = async (req, res) => {
    try {
        const schoolId = req.user?.school_id;
        const userId = req.user?.id;
        const certId = req.params.id;

        const [[student]] = await db.query(
            `SELECT id FROM students WHERE user_id = ? AND school_id = ? AND deleted_at IS NULL LIMIT 1`,
            [userId, schoolId]
        );

        if (!student) {
            return res.status(404).render('errors/404', { title: 'Not Found', message: 'Student profile not found' });
        };

        const [[cert]] = await db.query(
            `SELECT ic.*, ct.title, ct.logo_enabled, ct.header_text, ct.footer_text, ct.signature_name, ct.signature_designation
             FROM issued_certificates ic
             LEFT JOIN certificate_templates ct ON ct.id = ic.template_id
             WHERE ic.id = ? AND ic.school_id = ? AND ic.student_id = ? LIMIT 1`,
            [certId, schoolId, student.id]
        );

        if (!cert || cert.status === 'cancelled') {
            return res.status(404).render('errors/404', { title: 'Not Found', message: 'Certificate not found or cancelled' });
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

        streamCertificatePdf(res, {
            school: school || {},
            template: {
                title: cert.title || cert.certificate_type,
                logo_enabled: cert.logo_enabled ?? 1,
                header_text: cert.header_text || null,
                footer_text: cert.footer_text || null,
                signature_name: cert.signature_name || null,
                signature_designation: cert.signature_designation || null,
            },
            certNo: cert.certificate_no,
            issueDate: cert.issue_date,
            recipientName: cert.recipient_name,
            bodyContent: cert.content_snapshot || 'This certificate has been officially issued.'
        });

    } catch (err) {
        console.error('[Student Certificate Controller downloadMyCertificate]', err);
        if (!res.headersSent) {
            return res.status(500).render('errors/500', { title: 'Download Error', message: 'Failed to download certificate' });
        };
    };
};