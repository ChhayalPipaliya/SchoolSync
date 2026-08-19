const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');

function resolvePhotoPath(rawPhoto) {
    if (!rawPhoto) return null;
    let photo = rawPhoto;
    if (typeof photo === 'string' && (photo.startsWith('[') || photo.startsWith('{'))) {
        try {
            const parsed = JSON.parse(photo);
            if (Array.isArray(parsed) && parsed.length > 0) photo = parsed[0];
            else if (typeof parsed === 'string') photo = parsed;
        } catch (e) {}
    }
    if (typeof photo !== 'string') return null;
    photo = photo.trim().replace(/^[\/\\]+/, '');

    const projectRoot = path.resolve(__dirname, '../../');
    const candidates = [
        path.resolve(projectRoot, 'storage', photo),
        path.resolve(projectRoot, 'storage/uploads', photo.replace(/^uploads[\/\\]+/, '')),
        path.resolve(projectRoot, 'storage/uploads/teachers', path.basename(photo)),
        path.resolve(projectRoot, 'storage/uploads/students', path.basename(photo)),
        path.resolve(projectRoot, 'storage/uploads/drivers', path.basename(photo)),
        path.resolve(projectRoot, 'src/public', photo),
        path.resolve(projectRoot, 'src/public/uploads', photo.replace(/^uploads[\/\\]+/, '')),
        path.resolve(projectRoot, 'public', photo),
        path.resolve(projectRoot, photo)
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }
    return null;
}

async function generateIdCardPdf({ type, name, idNo, frontDetail1, frontDetail2, frontDetail3, photo, school, qrText, backDetail1, backDetail2, address }) {
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
    const resolvedPhoto = resolvePhotoPath(photo);
    if (resolvedPhoto) {
        try {
            doc.image(resolvedPhoto, photoX, photoY, { width: photoSize, height: photoSize });
            hasImage = true;
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

    if (isStudent) {
        renderDetail('CLASS', frontDetail1);
        renderDetail('ROLL NO', frontDetail2);
    } else {
        renderDetail('STAFF ID', idNo);
        renderDetail('ROLE', frontDetail1);
        renderDetail('EMAIL', frontDetail2);
        renderDetail('ACAD YEAR', frontDetail3);
    };

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
        doc.fillColor(lightText).font('Helvetica-Bold').fontSize(4.5).text('STUDENT ADDRESS:', 16, backY);
        doc.fillColor(darkText).font('Helvetica').fontSize(4.5).text(address || '—', 16, backY + 5, { width: 145 });
    } else {
        renderBackDetail('PHONE', backDetail1);
        renderBackDetail('EMERGENCY', backDetail2);
        doc.fillColor(lightText).font('Helvetica-Bold').fontSize(4.5).text('SCHOOL ADDRESS:', 16, backY);
        doc.fillColor(darkText).font('Helvetica').fontSize(4.5).text(school?.school_address || 'Education Campus, State', 16, backY + 5, { width: 145 });
    };

    doc.strokeColor('#E2E8F0')
        .lineWidth(0.5)
        .moveTo(16, height - 24)
        .lineTo(width - 16, height - 24)
        .stroke();
    doc.fillColor(darkText)
        .font('Times-Italic')
        .fontSize(7)
        .text(school?.school_principal_name || 'Principal', 16, height - 18);
    doc.fillColor(lightText)
        .font('Helvetica')
        .fontSize(4)
        .text('AUTHORIZED SIGNATURE', 16, height - 10);
    doc.fillColor(primaryColor)
        .font('Helvetica-Bold')
        .fontSize(5)
        .text(school?.website || 'www.schoolsync.com', width - 85, height - 18, { align: 'right', width: 70 });
    doc.fillColor(lightText)
        .font('Helvetica')
        .fontSize(4)
        .text('OFFICIAL WEBSITE', width - 85, height - 10, { align: 'right', width: 70 });
    return doc;
};

async function generateIdCardPreviewPdf({ type, name, idNo, frontDetail1, frontDetail2, frontDetail3, photo, school, qrText, backDetail1, backDetail2, address }) {
    const cardW = 242.64;
    const cardH = 153.0;
    const margin = 8;
    const gap = 12;
    const totalW = margin * 2 + cardW * 2 + gap;
    const totalH = margin * 2 + cardH;

    const doc = new PDFDocument({
        size: [totalW, totalH],
        margins: { top: 0, bottom: 0, left: 0, right: 0 }
    });

    const isStudent = type === 'student';
    const primaryColor = isStudent ? '#6366F1' : '#10B981';
    const darkText = '#0F172A';
    const lightText = '#64748B';

    doc.rect(0, 0, totalW, totalH).fill('#F8FAFC');

    const fX = margin;
    const fY = margin;
    doc.roundedRect(fX, fY, cardW, cardH, 4).fill('#FFFFFF');
    doc.roundedRect(fX, fY, 8, cardH, 0).fill(primaryColor);
    doc.fillColor(primaryColor)
        .font('Helvetica-Bold')
        .fontSize(7)
        .text(school?.school_name ? school.school_name.toUpperCase() : 'SCHOOLSYNC ACADEMY', fX + 16, fY + 10, { width: 215, ellipsis: true });
    doc.fillColor(lightText)
        .font('Helvetica')
        .fontSize(4.5)
        .text(school?.school_address || 'Education Campus, State', fX + 16, fY + 18, { width: 215, ellipsis: true });
    doc.strokeColor('#E2E8F0')
        .lineWidth(0.5)
        .moveTo(fX + 16, fY + 24)
        .lineTo(fX + 230, fY + 24)
        .stroke();

    const photoX = fX + 16;
    const photoY = fY + 30;
    const photoSize = 42;

    let hasImage = false;
    const resolvedPhoto = resolvePhotoPath(photo);
    if (resolvedPhoto) {
        try {
            doc.image(resolvedPhoto, photoX, photoY, { width: photoSize, height: photoSize });
            hasImage = true;
        } catch (e) {
            console.error('PDF Photo loading error:', e.message);
        };
    };

    if (!hasImage) {
        doc.rect(photoX, photoY, photoSize, photoSize).fill('#F1F5F9');
        doc.fillColor(primaryColor)
            .font('Helvetica-Bold')
            .fontSize(16)
            .text(name ? name.charAt(0) : '?', photoX + 15, photoY + 13);
    };

    const detailsX = fX + 64;
    let currentY = fY + 30;

    doc.fillColor(darkText)
        .font('Helvetica-Bold')
        .fontSize(8)
        .text(name || 'Unknown', detailsX, currentY, { width: 160, ellipsis: true });
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

    if (isStudent) {
        renderDetail('CLASS', frontDetail1);
        renderDetail('ROLL NO', frontDetail2);
    } else {
        renderDetail('STAFF ID', idNo);
        renderDetail('ROLE', frontDetail1);
        renderDetail('EMAIL', frontDetail2);
        renderDetail('ACAD YEAR', frontDetail3);
    };

    doc.rect(fX + cardW - 36, fY + cardH - 14, 28, 8, { cornerRadius: 4 }).fill('rgba(16, 185, 129, 0.12)');
    doc.fillColor('#10B981').font('Helvetica-Bold').fontSize(4).text('ACTIVE', fX + cardW - 32, fY + cardH - 11.5);

    const bX = margin + cardW + gap;
    const bY = margin;
    doc.roundedRect(bX, bY, cardW, cardH, 4).fill('#FFFFFF');
    doc.roundedRect(bX, bY, 8, cardH, 0).fill(primaryColor);
    doc.fillColor(darkText)
        .font('Helvetica-Bold')
        .fontSize(6)
        .text('TERMS & CONDITIONS / EMERGENCY CONTACT', bX + 16, bY + 10);

    let qrBuffer;
    try {
        qrBuffer = await QRCode.toBuffer(qrText || `VERIFY:ID-${idNo}`, { margin: 1, width: 42 });
    } catch (qrErr) {
        console.error('QR Buffer error:', qrErr);
    };

    if (qrBuffer) {
        doc.image(qrBuffer, bX + cardW - 52, bY + 20, { width: 40, height: 40 });
    };

    let backY = bY + 22;
    const renderBackDetail = (label, val) => {
        if (!val) return;
        doc.fillColor(lightText).font('Helvetica-Bold').fontSize(4.5).text(label + ': ', bX + 16, backY, { continued: true });
        doc.fillColor(darkText).font('Helvetica').fontSize(4.5).text(val);
        backY += 7;
    };

    if (isStudent) {
        renderBackDetail('FATHER', backDetail1);
        renderBackDetail('PARENT PHONE', backDetail2);
        doc.fillColor(lightText).font('Helvetica-Bold').fontSize(4.5).text('STUDENT ADDRESS:', bX + 16, backY);
        doc.fillColor(darkText).font('Helvetica').fontSize(4.5).text(address || '—', bX + 16, backY + 5, { width: 145 });
    } else {
        renderBackDetail('PHONE', backDetail1);
        renderBackDetail('EMERGENCY', backDetail2);
        doc.fillColor(lightText).font('Helvetica-Bold').fontSize(4.5).text('SCHOOL ADDRESS:', bX + 16, backY);
        doc.fillColor(darkText).font('Helvetica').fontSize(4.5).text(school?.school_address || 'Education Campus, State', bX + 16, backY + 5, { width: 145 });
    };

    doc.strokeColor('#E2E8F0')
        .lineWidth(0.5)
        .moveTo(bX + 16, bY + cardH - 24)
        .lineTo(bX + cardW - 16, bY + cardH - 24)
        .stroke();
    doc.fillColor(darkText)
        .font('Times-Italic')
        .fontSize(7)
        .text(school?.school_principal_name || 'Principal', bX + 16, bY + cardH - 18);
    doc.fillColor(lightText)
        .font('Helvetica')
        .fontSize(4)
        .text('AUTHORIZED SIGNATURE', bX + 16, bY + cardH - 10);
    doc.fillColor(primaryColor)
        .font('Helvetica-Bold')
        .fontSize(5)
        .text(school?.website || 'www.schoolsync.com', bX + cardW - 85, bY + cardH - 18, { align: 'right', width: 70 });
    doc.fillColor(lightText)
        .font('Helvetica')
        .fontSize(4)
        .text('OFFICIAL WEBSITE', bX + cardW - 85, bY + cardH - 10, { align: 'right', width: 70 });

    return doc;
};

module.exports = { generateIdCardPdf, generateIdCardPreviewPdf };