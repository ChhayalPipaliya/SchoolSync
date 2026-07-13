const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');

async function generateIdCardPdf({ type, name, idNo, frontDetail1, frontDetail2, frontDetail3, photo, school, qrText, backDetail1, backDetail2 }) {
    const width = 242.64;
    const height = 153.0;

    const doc = new PDFDocument({
        size: [width, height],
        margins: { top: 0, bottom: 0, left: 0, right: 0 }
    });

    const isStudent = type === 'student';
    const primaryColor = isStudent ? '#6366F1' : '#10B981';
    const darkText = '#0F172A';
    const lightText = '#64748B';

    doc.rect(0, 0, width, height).fill('#FFFFFF');
    doc.rect(0, 0, 8, height).fill(primaryColor);
    doc.fillColor(primaryColor)
        .font('Helvetica-Bold')
        .fontSize(7)
        .text(school.school_name ? school.school_name.toUpperCase() : 'SCHOOLSYNC ACADEMY', 16, 10, { width: 215, ellipsis: true });
    doc.fillColor(lightText)
        .font('Helvetica')
        .fontSize(4.5)
        .text(school.school_address || 'Education Campus, State', 16, 18, { width: 215, ellipsis: true });
    doc.strokeColor('#E2E8F0')
        .lineWidth(0.5)
        .moveTo(16, 24)
        .lineTo(230, 24)
        .stroke();

    const photoX = 16;
    const photoY = 30;
    const photoSize = 42;

    let hasImage = false;
    if (photo) {
        try {
            const fullPath = path.join(__dirname, '../public', photo);
            if (fs.existsSync(fullPath)) {
                doc.image(fullPath, photoX, photoY, { width: photoSize, height: photoSize });
                hasImage = true;
            };
        } catch (e) {
            console.error('PDF Photo loading error:', e.message);
        };
    };

    if (!hasImage) {
        doc.rect(photoX, photoY, photoSize, photoSize).fill('#F1F5F9');
        doc.fillColor(primaryColor)
            .font('Helvetica-Bold')
            .fontSize(16)
            .text(name.charAt(0), photoX + 15, photoY + 13);
    };

    const detailsX = 64;
    let currentY = 30;

    doc.fillColor(darkText)
        .font('Helvetica-Bold')
        .fontSize(8)
        .text(name, detailsX, currentY, { width: 160, ellipsis: true });
    currentY += 11;
    doc.fillColor(primaryColor)
        .font('Helvetica-Bold')
        .fontSize(5)
        .text(isStudent ? 'STUDENT CARD' : 'STAFF ID CARD', detailsX, currentY);
    currentY += 7;

    const renderDetail = (label, val) => {
        if (!val) return;
        doc.fillColor(lightText).font('Helvetica-Bold').fontSize(4.5).text(label + ': ', detailsX, currentY, { continued: true });
        doc.fillColor(darkText).font('Helvetica').fontSize(4.5).text(val);
        currentY += 6.5;
    };

    renderDetail(isStudent ? 'ADM NO' : 'STAFF ID', idNo);
    renderDetail(isStudent ? 'CLASS' : 'ROLE', frontDetail1);
    renderDetail(isStudent ? 'ROLL NO' : 'EMAIL', frontDetail2);
    renderDetail('ACAD YEAR', frontDetail3);

    doc.rect(width - 36, height - 14, 28, 8, { cornerRadius: 4 }).fill('rgba(16, 185, 129, 0.12)');
    doc.fillColor('#10B981').font('Helvetica-Bold').fontSize(4).text('ACTIVE', width - 32, height - 11.5);
    doc.addPage();
    doc.rect(0, 0, width, height).fill('#FFFFFF');
    doc.rect(0, 0, 8, height).fill(primaryColor);
    doc.fillColor(darkText)
        .font('Helvetica-Bold')
        .fontSize(6)
        .text('TERMS & CONDITIONS / EMERGENCY CONTACT', 16, 10);

    let qrBuffer;
    try {
        qrBuffer = await QRCode.toBuffer(qrText || `VERIFY:ID-${idNo}`, { margin: 1, width: 42 });
    } catch (qrErr) {
        console.error('QR Buffer error:', qrErr);
    };

    if (qrBuffer) {
        doc.image(qrBuffer, width - 52, 20, { width: 40, height: 40 });
    };

    let backY = 22;
    const renderBackDetail = (label, val) => {
        if (!val) return;
        doc.fillColor(lightText).font('Helvetica-Bold').fontSize(4.5).text(label + ': ', 16, backY, { continued: true });
        doc.fillColor(darkText).font('Helvetica').fontSize(4.5).text(val);
        backY += 7;
    };

    if (isStudent) {
        renderBackDetail('FATHER', backDetail1);
        renderBackDetail('PARENT PHONE', backDetail2);
    } else {
        renderBackDetail('PHONE', backDetail1);
        renderBackDetail('EMERGENCY', backDetail2);
    };

    doc.fillColor(lightText).font('Helvetica-Bold').fontSize(4.5).text('SCHOOL ADDRESS:', 16, backY);
    doc.fillColor(darkText).font('Helvetica').fontSize(4.5).text(school.school_address || 'Education Campus, State', 16, backY + 5, { width: 145 });
    doc.strokeColor('#E2E8F0')
        .lineWidth(0.5)
        .moveTo(16, height - 24)
        .lineTo(width - 16, height - 24)
        .stroke();
    doc.fillColor(darkText)
        .font('Times-Italic')
        .fontSize(7)
        .text(school.school_principal_name || 'Principal', 16, height - 18);
    doc.fillColor(lightText)
        .font('Helvetica')
        .fontSize(4)
        .text('AUTHORIZED SIGNATURE', 16, height - 10);
    doc.fillColor(primaryColor)
        .font('Helvetica-Bold')
        .fontSize(5)
        .text(school.website || 'www.schoolsync.com', width - 85, height - 18, { align: 'right', width: 70 });
    doc.fillColor(lightText)
        .font('Helvetica')
        .fontSize(4)
        .text('OFFICIAL WEBSITE', width - 85, height - 10, { align: 'right', width: 70 });
    return doc;
};

module.exports = { generateIdCardPdf };