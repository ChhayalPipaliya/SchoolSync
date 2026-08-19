const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

function formatPaymentMethod(method) {
    if (!method) return '—';
    const clean = String(method).trim().toLowerCase().replace(/[\s-]+/g, '_');
    const map = {
        cash: 'Cash',
        online: 'Online Gateway',
        net_banking: 'Net Banking',
        razorpay: 'Razorpay',
        upi: 'UPI',
        card: 'Card',
        cheque: 'Cheque',
        bank_transfer: 'Bank Transfer (NEFT/RTGS/IMPS)',
        school_upi_qr: 'School UPI QR'
    };
    return map[clean] || String(method).toUpperCase();
};

function formatCurrency(amount) {
    const val = Number(amount) || 0;
    return `Rs. ${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

function formatMonthYear(monthStr) {
    if (!monthStr) return '—';
    const parts = String(monthStr).split('-');
    if (parts.length === 2) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const d = new Date(year, month, 1);
        if (!isNaN(d.getTime())) {
            return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
        };
    };
    return monthStr;
};

function numberToIndianWords(num) {
    const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    const n = Math.floor(Math.abs(Number(num) || 0));
    if (n === 0) return 'Rupees Zero Only';

    function inWords(val) {
        let str = '';
        if (val >= 10000000) {
            str += inWords(Math.floor(val / 10000000)) + ' Crore ';
            val %= 10000000;
        };
        if (val >= 100000) {
            str += inWords(Math.floor(val / 100000)) + ' Lakh ';
            val %= 100000;
        };
        if (val >= 1000) {
            str += inWords(Math.floor(val / 1000)) + ' Thousand ';
            val %= 1000;
        };
        if (val >= 100) {
            str += inWords(Math.floor(val / 100)) + ' Hundred ';
            val %= 100;
        };
        if (val > 0) {
            if (str !== '') str += 'and ';
            if (val < 20) {
                str += a[val] + ' ';
            } else {
                str += b[Math.floor(val / 10)] + ' ';
                if (val % 10 > 0) str += a[val % 10] + ' ';
            };
        };
        return str.trim();
    };
    return `Rupees ${inWords(n)} Only`;
};

function resolveSchoolLogo(logo) {
    if (!logo) return null;
    let cleanLogo = logo;
    if (typeof cleanLogo === 'string' && (cleanLogo.startsWith('[') || cleanLogo.startsWith('{'))) {
        try {
            const parsed = JSON.parse(cleanLogo);
            if (Array.isArray(parsed) && parsed.length > 0) cleanLogo = parsed[0];
            else if (typeof parsed === 'string') cleanLogo = parsed;
        } catch (e) {}
    };
    if (typeof cleanLogo !== 'string') return null;
    cleanLogo = cleanLogo.trim().replace(/^[\/\\]+/, '');

    const candidates = [
        path.join(process.cwd(), cleanLogo),
        path.join(process.cwd(), 'public', cleanLogo),
        path.join(process.cwd(), 'src', 'public', cleanLogo),
        path.join(process.cwd(), 'storage', 'uploads', cleanLogo),
        path.join(process.cwd(), 'storage', cleanLogo),
        path.join(process.cwd(), 'src', 'public', 'uploads', 'schools', cleanLogo),
        path.join(process.cwd(), 'src', 'public', 'uploads', cleanLogo)
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        };
    };
    return null;
};

function generatePaySlipPdf({ salary, payments = [] }) {
    const totalAmount = parseFloat(salary.total_amount || salary.base_salary || 0);
    const totalPaid = parseFloat(salary.paid_amount || 0);
    const balanceDue = Math.max(totalAmount - totalPaid, 0);
    const status = (salary.status || 'pending').toLowerCase();

    const employeeName = `${salary.first_name || ''} ${salary.last_name || ''}`.trim() || 'Staff Member';
    const roleName = (salary.role || 'employee').replace(/_/g, ' ').toUpperCase();
    const formattedMonth = formatMonthYear(salary.salary_month);
    const schoolName = (salary.school_name || 'SchoolSync Academy').toUpperCase();
    const slipNumber = `SLP-${(salary.salary_month || '').replace('-', '')}-${String(salary.id || 1).padStart(6, '0')}`;
    const generatedDate = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const logoPath = resolveSchoolLogo(salary.school_logo || salary.logo);

    const doc = new PDFDocument({
        size: 'A4',
        margin: 36,
        info: {
            Title: `Payslip - ${employeeName} - ${salary.salary_month}`,
            Author: salary.school_name || 'SchoolSync',
            Subject: `Salary Slip for ${employeeName} (${salary.salary_month})`,
            Keywords: 'Payslip, Salary, SchoolSync, School ERP'
        }
    });

    const primaryColor = '#0F766E';
    const secondaryColor = '#0D9488';
    const darkText = '#1E293B';
    const lightText = '#64748B';
    const borderCol = '#E2E8F0';
    const bgLight = '#F8FAFC';
    const bgMuted = '#F1F5F9';

    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = 36;
    const contentWidth = pageWidth - (margin * 2);

    let y = margin;

    const headerBoxHeight = 88;
    const badgeWidth = 150;
    const badgeX = pageWidth - margin - badgeWidth - 12;

    doc.rect(margin, y, contentWidth, headerBoxHeight).fill(bgLight);
    doc.rect(margin, y, 6, headerBoxHeight).fill(primaryColor);
    doc.rect(margin, y, contentWidth, headerBoxHeight).stroke(borderCol);

    let headerTextX = margin + 18;
    if (logoPath) {
        try {
            doc.image(logoPath, margin + 14, y + 14, { width: 55, height: 55 });
            headerTextX = margin + 80;
        } catch (e) {
            console.error('Logo loading error in payslip PDF:', e.message);
        };
    };

    const maxTextWidth = badgeX - headerTextX - 16;
    const nameFontSize = schoolName.length > 40 ? 11 : (schoolName.length > 25 ? 12.5 : 14);

    doc.fillColor(primaryColor)
        .font('Helvetica-Bold')
        .fontSize(nameFontSize);

    const nameHeight = doc.heightOfString(schoolName, { width: maxTextWidth, lineGap: 1 });
    doc.text(schoolName, headerTextX, y + 12, { width: maxTextWidth, lineGap: 1 });

    let currentHeaderY = y + 12 + nameHeight + 3;

    doc.fillColor(lightText)
        .font('Helvetica')
        .fontSize(8);

    const addressText = salary.school_address || 'Education Campus';
    const addressHeight = doc.heightOfString(addressText, { width: maxTextWidth });
    doc.text(addressText, headerTextX, currentHeaderY, { width: maxTextWidth, ellipsis: true });

    currentHeaderY += addressHeight + 2;

    const contactParts = [];
    if (salary.school_phone) contactParts.push(`Phone: ${salary.school_phone}`);
    if (salary.school_email) contactParts.push(`Email: ${salary.school_email}`);
    const schoolWeb = salary.school_website || salary.website;
    if (schoolWeb) contactParts.push(`Web: ${schoolWeb}`);
    if (contactParts.length) {
        doc.fontSize(7.5).text(contactParts.join('  |  '), headerTextX, currentHeaderY, { width: maxTextWidth, ellipsis: true });
    };

    doc.roundedRect(badgeX, y + 12, badgeWidth, 64, 4).fill('#FFFFFF');
    doc.roundedRect(badgeX, y + 12, badgeWidth, 64, 4).stroke(borderCol);

    doc.fillColor(secondaryColor)
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .text('CONFIDENTIAL SALARY SLIP', badgeX, y + 18, { width: badgeWidth, align: 'center' });

    doc.fillColor(darkText)
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(formattedMonth, badgeX, y + 31, { width: badgeWidth, align: 'center' });

    doc.fillColor(lightText)
        .font('Helvetica')
        .fontSize(7.5)
        .text(`Slip No: ${slipNumber}`, badgeX, y + 46, { width: badgeWidth, align: 'center' })
        .text(`Generated: ${generatedDate}`, badgeX, y + 57, { width: badgeWidth, align: 'center' });

    y += headerBoxHeight + 12;

    const empBoxHeight = 74;
    const colWidth = (contentWidth - 12) / 2;

    doc.roundedRect(margin, y, colWidth, empBoxHeight, 4).fill(bgLight);
    doc.roundedRect(margin, y, colWidth, empBoxHeight, 4).stroke(borderCol);

    const rightColX = margin + colWidth + 12;
    doc.roundedRect(rightColX, y, colWidth, empBoxHeight, 4).fill(bgLight);
    doc.roundedRect(rightColX, y, colWidth, empBoxHeight, 4).stroke(borderCol);

    doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(8.5).text('EMPLOYEE DETAILS', margin + 10, y + 8);
    doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(8.5).text('SALARY & STATUS OVERVIEW', rightColX + 10, y + 8);

    const renderField = (lbl, val, x, rowY) => {
        doc.fillColor(lightText).font('Helvetica-Bold').fontSize(7.5).text(lbl, x, rowY, { width: 80 });
        doc.fillColor(darkText).font('Helvetica').fontSize(7.5).text(val || '—', x + 85, rowY, { width: colWidth - 95, ellipsis: true });
    };

    let leftRowY = y + 23;
    renderField('Employee Name:', employeeName, margin + 10, leftRowY);
    renderField('Designation / Role:', roleName, margin + 10, leftRowY + 14);
    renderField('Email Address:', salary.email || '—', margin + 10, leftRowY + 28);
    renderField('Contact Phone:', salary.phone || '—', margin + 10, leftRowY + 42);

    let rightRowY = y + 23;
    renderField('Pay Period:', formattedMonth, rightColX + 10, rightRowY);
    renderField('Month Key:', salary.salary_month || '—', rightColX + 10, rightRowY + 14);
    renderField('Base Package:', formatCurrency(salary.base_salary || totalAmount), rightColX + 10, rightRowY + 28);

    doc.fillColor(lightText).font('Helvetica-Bold').fontSize(7.5).text('Payment Status:', rightColX + 10, rightRowY + 42, { width: 80 });

    let statusBg = '#DCFCE7';
    let statusTextColor = '#15803D';
    let statusText = 'PAID';

    if (status === 'partial') {
        statusBg = '#FEF3C7';
        statusTextColor = '#B45309';
        statusText = 'PARTIALLY PAID';
    } else if (status === 'pending' || status === 'unpaid') {
        statusBg = '#FFE4E6';
        statusTextColor = '#BE123C';
        statusText = 'PENDING';
    };

    const pillX = rightColX + 95;
    const pillY = rightRowY + 40;
    doc.roundedRect(pillX, pillY, 78, 12, 3).fill(statusBg);
    doc.fillColor(statusTextColor).font('Helvetica-Bold').fontSize(7).text(statusText, pillX, pillY + 2.5, { width: 78, align: 'center' });

    y += empBoxHeight + 14;

    doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(9.5).text('SALARY BREAKDOWN', margin, y);
    y += 14;

    const tableColWidth = (contentWidth - 12) / 2;
    const earningsX = margin;
    const deductionsX = margin + tableColWidth + 12;

    doc.rect(earningsX, y, tableColWidth, 18).fill(primaryColor);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8);
    doc.text('EARNINGS / ALLOWANCES', earningsX + 8, y + 5, { width: tableColWidth - 85 });
    doc.text('AMOUNT', earningsX + tableColWidth - 75, y + 5, { width: 67, align: 'right' });

    doc.rect(deductionsX, y, tableColWidth, 18).fill('#475569');
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8);
    doc.text('DEDUCTIONS & TAXES', deductionsX + 8, y + 5, { width: tableColWidth - 85 });
    doc.text('AMOUNT', deductionsX + tableColWidth - 75, y + 5, { width: 67, align: 'right' });

    y += 18;

    const rows = [
        { earnLabel: 'Basic / Monthly Pay', earnVal: formatCurrency(totalAmount), dedLabel: 'Provident Fund (PF)', dedVal: formatCurrency(0) },
        { earnLabel: 'Special / Role Allowance', earnVal: formatCurrency(0), dedLabel: 'Professional Tax / TDS', dedVal: formatCurrency(0) },
        { earnLabel: 'Other Earnings / Bonus', earnVal: formatCurrency(0), dedLabel: 'Other Deductions / Loss of Pay', dedVal: formatCurrency(0) }
    ];

    rows.forEach((row, idx) => {
        const rowBg = idx % 2 === 0 ? '#FFFFFF' : bgLight;
        
        doc.rect(earningsX, y, tableColWidth, 16).fill(rowBg);
        doc.rect(earningsX, y, tableColWidth, 16).stroke(borderCol);
        doc.fillColor(darkText).font('Helvetica').fontSize(7.5);
        doc.text(row.earnLabel, earningsX + 8, y + 4.5, { width: tableColWidth - 85 });
        doc.text(row.earnVal, earningsX + tableColWidth - 75, y + 4.5, { width: 67, align: 'right' });

        doc.rect(deductionsX, y, tableColWidth, 16).fill(rowBg);
        doc.rect(deductionsX, y, tableColWidth, 16).stroke(borderCol);
        doc.fillColor(darkText).font('Helvetica').fontSize(7.5);
        doc.text(row.dedLabel, deductionsX + 8, y + 4.5, { width: tableColWidth - 85 });
        doc.text(row.dedVal, deductionsX + tableColWidth - 75, y + 4.5, { width: 67, align: 'right' });

        y += 16;
    });

    doc.rect(earningsX, y, tableColWidth, 18).fill(bgMuted);
    doc.rect(earningsX, y, tableColWidth, 18).stroke(borderCol);
    doc.fillColor(darkText).font('Helvetica-Bold').fontSize(8);
    doc.text('Gross Earnings (A)', earningsX + 8, y + 4.5, { width: tableColWidth - 85 });
    doc.fillColor(primaryColor).text(formatCurrency(totalAmount), earningsX + tableColWidth - 75, y + 4.5, { width: 67, align: 'right' });

    doc.rect(deductionsX, y, tableColWidth, 18).fill(bgMuted);
    doc.rect(deductionsX, y, tableColWidth, 18).stroke(borderCol);
    doc.fillColor(darkText).font('Helvetica-Bold').fontSize(8);
    doc.text('Total Deductions (B)', deductionsX + 8, y + 4.5, { width: tableColWidth - 85 });
    doc.text(formatCurrency(0), deductionsX + tableColWidth - 75, y + 4.5, { width: 67, align: 'right' });

    y += 18 + 12;

    const summaryBoxHeight = 56;
    doc.roundedRect(margin, y, contentWidth, summaryBoxHeight, 4).fill(bgLight);
    doc.roundedRect(margin, y, contentWidth, summaryBoxHeight, 4).stroke(borderCol);

    doc.fillColor(lightText).font('Helvetica-Bold').fontSize(8).text('NET PAYABLE SALARY (A - B):', margin + 12, y + 8);
    doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(14).text(formatCurrency(totalAmount), margin + 12, y + 20);

    const words = numberToIndianWords(totalAmount);
    doc.fillColor(lightText).font('Helvetica-Oblique').fontSize(7.5).text(`Amount in Words: ${words}`, margin + 12, y + 38, { width: contentWidth - 170 });

    const summaryRightX = margin + contentWidth - 150;
    doc.fillColor(lightText).font('Helvetica').fontSize(7.5).text('Total Paid:', summaryRightX, y + 10, { width: 60 });
    doc.fillColor('#16A34A').font('Helvetica-Bold').fontSize(8).text(formatCurrency(totalPaid), summaryRightX + 60, y + 10, { width: 80, align: 'right' });

    doc.fillColor(lightText).font('Helvetica').fontSize(7.5).text('Balance Due:', summaryRightX, y + 26, { width: 60 });
    doc.fillColor(balanceDue > 0 ? '#DC2626' : '#1E293B').font('Helvetica-Bold').fontSize(8).text(formatCurrency(balanceDue), summaryRightX + 60, y + 26, { width: 80, align: 'right' });

    y += summaryBoxHeight + 14;

    doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(9.5).text('PAYMENT DISBURSEMENT RECORD', margin, y);
    y += 13;

    const histCol = {
        sr: margin + 8,
        date: margin + 30,
        mode: margin + 130,
        ref: margin + 280,
        amt: margin + contentWidth - 100
    };

    doc.rect(margin, y, contentWidth, 18).fill(primaryColor);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7.5);
    doc.text('#', histCol.sr, y + 5, { width: 18 });
    doc.text('Payment Date', histCol.date, y + 5, { width: 95 });
    doc.text('Payment Mode', histCol.mode, y + 5, { width: 140 });
    doc.text('Receipt / Ref No.', histCol.ref, y + 5, { width: 140 });
    doc.text('Amount Paid', histCol.amt, y + 5, { width: 92, align: 'right' });

    y += 18;

    if (payments.length === 0) {
        doc.rect(margin, y, contentWidth, 22).fill('#FFFFFF');
        doc.rect(margin, y, contentWidth, 22).stroke(borderCol);
        doc.fillColor(lightText).font('Helvetica-Oblique').fontSize(8).text('No payment records found for this salary cycle.', margin, y + 7, { width: contentWidth, align: 'center' });
        y += 22;
    } else {
        payments.forEach((p, idx) => {
            const rowBg = idx % 2 === 0 ? '#FFFFFF' : bgLight;
            const pDate = p.payment_date ? new Date(p.payment_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
            const pMode = formatPaymentMethod(p.payment_method);
            const pRef = p.receipt_no || p.transaction_id || p.reference_no || '—';
            const pAmt = formatCurrency(p.amount);

            doc.rect(margin, y, contentWidth, 17).fill(rowBg);
            doc.rect(margin, y, contentWidth, 17).stroke(borderCol);

            doc.fillColor(darkText).font('Helvetica').fontSize(7.5);
            doc.text(String(idx + 1), histCol.sr, y + 4.5, { width: 18 });
            doc.text(pDate, histCol.date, y + 4.5, { width: 95 });
            doc.text(pMode, histCol.mode, y + 4.5, { width: 140, ellipsis: true });
            doc.text(pRef, histCol.ref, y + 4.5, { width: 140, ellipsis: true });
            doc.fillColor('#16A34A').font('Helvetica-Bold');
            doc.text(pAmt, histCol.amt, y + 4.5, { width: 92, align: 'right' });

            y += 17;
        });
    }

    y += 12;

    const sigY = pageHeight - margin - 65;
    doc.strokeColor(borderCol).lineWidth(0.8).moveTo(margin + 20, sigY).lineTo(margin + 170, sigY).stroke();
    doc.fillColor(darkText).font('Helvetica-Bold').fontSize(7.5).text('Employee Signature', margin + 20, sigY + 5, { width: 150, align: 'center' });
    doc.fillColor(lightText).font('Helvetica').fontSize(6.5).text('Date: ____________', margin + 20, sigY + 16, { width: 150, align: 'center' });

    const authX = pageWidth - margin - 190;
    doc.strokeColor(borderCol).lineWidth(0.8).moveTo(authX + 20, sigY).lineTo(authX + 170, sigY).stroke();
    doc.fillColor(darkText).font('Helvetica-Bold').fontSize(7.5).text(salary.school_principal_name || 'Principal / Authorized Officer', authX + 20, sigY + 5, { width: 150, align: 'center' });
    doc.fillColor(lightText).font('Helvetica').fontSize(6.5).text('Authorized Signatory', authX + 20, sigY + 16, { width: 150, align: 'center' });

    const footerY = pageHeight - margin - 16;
    doc.strokeColor(borderCol).lineWidth(0.5).moveTo(margin, footerY - 5).lineTo(pageWidth - margin, footerY - 5).stroke();
    doc.fillColor(lightText).font('Helvetica').fontSize(7)
        .text('This is a computer-generated salary slip and does not require a physical signature unless requested.', margin, footerY, { width: contentWidth, align: 'center' });

    doc.end();
    return doc;
}

module.exports = { generatePaySlipPdf, formatCurrency, numberToIndianWords, formatMonthYear };