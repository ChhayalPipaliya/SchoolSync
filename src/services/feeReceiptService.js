const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const db = require('../config/database');

const PAYMENT_METHODS = {
    CASH: 'cash',
    ONLINE: 'online',
    NET_BANKING: 'net_banking',
    RAZORPAY: 'razorpay',
    UPI: 'upi',
    CARD: 'card',
    CHEQUE: 'cheque',
    BANK_TRANSFER: 'bank_transfer',
    SCHOOL_UPI_QR: 'school_upi_qr'
};

const PAYMENT_METHOD_LABELS = {
    cash: 'Cash',
    online: 'Online (Gateway)',
    net_banking: 'Net Banking',
    razorpay: 'Razorpay',
    upi: 'UPI',
    card: 'Credit / Debit Card',
    cheque: 'Cheque',
    bank_transfer: 'Bank Transfer (NEFT/RTGS/IMPS)',
    school_upi_qr: 'School UPI QR'
};

function normalizePaymentMethod(rawMethod) {
    if (!rawMethod) return PAYMENT_METHODS.CASH;
    const clean = String(rawMethod).trim().toLowerCase().replace(/[\s-]+/g, '_');
    
    if (clean === 'cash' || clean === 'cash_payment') return PAYMENT_METHODS.CASH;
    if (clean === 'online' || clean === 'gateway') return PAYMENT_METHODS.ONLINE;
    if (clean === 'netbanking' || clean === 'net_banking' || clean === 'net_bank') return PAYMENT_METHODS.NET_BANKING;
    if (clean === 'razorpay' || clean === 'razor_pay') return PAYMENT_METHODS.RAZORPAY;
    if (clean === 'upi' || clean === 'vpa') return PAYMENT_METHODS.UPI;
    if (clean === 'card' || clean === 'credit_card' || clean === 'debit_card') return PAYMENT_METHODS.CARD;
    if (clean === 'cheque' || clean === 'check') return PAYMENT_METHODS.CHEQUE;
    if (clean === 'bank_transfer' || clean === 'bank' || clean === 'neft' || clean === 'rtgs' || clean === 'imps') return PAYMENT_METHODS.BANK_TRANSFER;
    if (clean === 'school_upi_qr' || clean === 'qr' || clean === 'school_qr') return PAYMENT_METHODS.SCHOOL_UPI_QR;

    return clean;
};

function formatPaymentMethod(method) {
    const normalized = normalizePaymentMethod(method);
    return PAYMENT_METHOD_LABELS[normalized] || String(method).toUpperCase();
};

function formatCurrency(amount) {
    const val = Number(amount) || 0;
    return `Rs. ${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

function buildReceiptNumber(payment, now = new Date()) {
    const year = now.getFullYear();
    const schoolId = payment.school_id;
    const paymentId = payment.id || payment.insertId;
    return `RCP-${schoolId}-${year}-${String(paymentId).padStart(8, '0')}`;
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

async function getReceiptData({ paymentId, schoolId, userId = null, role = 'school_admin', childrenIds = [] }) {
    const parsedId = parseInt(paymentId, 10);
    if (!paymentId || isNaN(parsedId) || parsedId <= 0) {
        const err = new Error('Invalid receipt payment ID');
        err.statusCode = 400;
        throw err;
    };

    if (!schoolId) {
        const err = new Error('School context is required');
        err.statusCode = 400;
        throw err;
    };

    let authClause = '';
    const params = [parsedId, schoolId];
    if (role === 'student') {
        if (!userId) {
            const err = new Error('Student user authentication required');
            err.statusCode = 401;
            throw err;
        };
        const [[studentRec]] = await db.query(
            'SELECT id FROM students WHERE user_id = ? AND school_id = ? AND deleted_at IS NULL',
            [userId, schoolId]
        );
        if (!studentRec) {
            const err = new Error('Student profile not found');
            err.statusCode = 404;
            throw err;
        };
        authClause = 'AND fp.student_id = ?';
        params.push(studentRec.id);
    } else if (role === 'parent') {
        if (!childrenIds || !childrenIds.length) {
            const err = new Error('No linked students found for parent');
            err.statusCode = 403;
            throw err;
        };
        authClause = 'AND fp.student_id IN (?)';
        params.push(childrenIds);
    };

    const [[payment]] = await db.query(
        `SELECT fp.*,
            s.id AS student_id, s.admission_no, s.roll_no, s.class_id,
            u.first_name AS student_first_name, u.last_name AS student_last_name, u.email AS student_email,
            c.class_name, c.section,
            fam.father_name, fam.father_phone, fam.mother_name, fam.mother_phone,
            sch.school_name, sch.school_address, sch.school_phone, sch.school_email, sch.website AS school_website, sch.logo AS school_logo,
            rec_u.first_name AS receiver_first_name, rec_u.last_name AS receiver_last_name
        FROM fee_payments fp
        JOIN students s ON fp.student_id = s.id
        JOIN users u ON s.user_id = u.id
        LEFT JOIN classes c ON s.class_id = c.id
        LEFT JOIN student_family fam ON fam.student_id = s.id
        JOIN schools sch ON fp.school_id = sch.id
        LEFT JOIN users rec_u ON fp.initiated_by_user_id = rec_u.id
        WHERE fp.id = ? AND fp.school_id = ? ${authClause}`,
        params
    );

    if (!payment) {
        const err = new Error('Receipt record not found or access denied');
        err.statusCode = 404;
        throw err;
    };

    if (!['completed', 'paid'].includes(payment.status)) {
        const err = new Error(`Cannot generate receipt for unpaid payment status: "${payment.status}"`);
        err.statusCode = 400;
        throw err;
    };

    let [feeItems] = await db.query(
        `SELECT sf.id AS student_fee_id, sf.fee_month, sf.due_date, sf.total_amount, sf.paid_amount, sf.status AS fee_status,
            fpa.amount AS allocated_amount,
            COALESCE(fs.fee_name, 'School Fee') AS fee_name, fs.frequency, fs.fee_type
        FROM fee_payment_allocations fpa
        JOIN student_fees sf ON sf.id = fpa.student_fee_id AND sf.school_id = fpa.school_id
        LEFT JOIN fee_structures fs ON sf.fee_structure_id = fs.id
        WHERE fpa.payment_id = ? AND fpa.school_id = ?
        ORDER BY sf.due_date ASC, COALESCE(fs.fee_name, 'School Fee') ASC`,
        [payment.id, schoolId]
    );

    const paymentAmount = Number(payment.amount || 0);
    const discountAmount = Number(payment.discount || 0);
    const grossPaymentTotal = paymentAmount + discountAmount;

    if (!feeItems.length) {
        let [fallbackFees] = await db.query(
            `SELECT sf.id AS student_fee_id, sf.fee_month, sf.due_date, sf.total_amount, sf.paid_amount, sf.status AS fee_status,
                COALESCE(fs.fee_name, 'School Fee') AS fee_name, fs.frequency, fs.fee_type
            FROM student_fees sf
            LEFT JOIN fee_structures fs ON sf.fee_structure_id = fs.id
            WHERE sf.payment_id = ? AND sf.school_id = ?
            ORDER BY sf.due_date ASC, COALESCE(fs.fee_name, 'School Fee') ASC`,
            [payment.id, schoolId]
        );

        if (fallbackFees.length === 1) {
            feeItems = fallbackFees.map(f => ({
                ...f,
                allocated_amount: grossPaymentTotal
            }));
        } else if (fallbackFees.length > 1) {
            let runningSum = 0;
            feeItems = fallbackFees.map((f, i) => {
                let alloc = Number(f.paid_amount || f.total_amount);
                if (runningSum + alloc > grossPaymentTotal) {
                    alloc = Math.max(0, grossPaymentTotal - runningSum);
                }
                runningSum += alloc;
                return { ...f, allocated_amount: alloc };
            });
        }
    }

    const [addressRows] = await db.query(
        'SELECT * FROM student_address_transport WHERE student_id = ?',
        [payment.student_id]
    );
    const addr = addressRows[0] || {};
    const addrParts = [
        addr.current_address || addr.permanent_address,
        addr.current_city || addr.permanent_city,
        addr.current_state || addr.permanent_state,
        addr.current_pincode || addr.permanent_pincode
    ].filter(Boolean);
    const studentAddress = addrParts.join(', ') || addr.current_address || addr.permanent_address || '';

    let totalDemanded = 0;
    let totalAllocatedInThisTrx = 0;
    feeItems.forEach(item => {
        totalDemanded += Number(item.total_amount || 0);
        totalAllocatedInThisTrx += Number(item.allocated_amount || 0);
    });

    if (totalAllocatedInThisTrx <= 0) {
        totalAllocatedInThisTrx = grossPaymentTotal;
    }

    const [[balanceRow]] = await db.query(
        `SELECT COALESCE(SUM(GREATEST(0, total_amount - (COALESCE(paid_amount, 0) + COALESCE(waiver_amount, 0)))), 0) AS remaining_balance
         FROM student_fees
         WHERE student_id = ? AND school_id = ? AND status IN ('pending', 'partial')`,
        [payment.student_id, schoolId]
    );
    const overallBalance = Math.max(0, Number(balanceRow?.remaining_balance || 0));

    const receiptNumber = payment.receipt_no || payment.receipt_number || buildReceiptNumber(payment);

    return {
        payment: {
            id: payment.id,
            receiptNumber,
            receiptNo: receiptNumber,
            paymentDate: payment.payment_date || payment.created_at,
            paidAt: payment.paid_at || payment.created_at,
            paymentMethod: payment.payment_method,
            paymentMethodLabel: formatPaymentMethod(payment.payment_method),
            amount: paymentAmount,
            discount: discountAmount,
            totalAllocated: totalAllocatedInThisTrx,
            status: payment.status,
            transactionId: payment.transaction_id,
            paymentReference: payment.payment_reference,
            razorpayOrderId: payment.razorpay_order_id,
            razorpayPaymentId: payment.razorpay_payment_id,
            receiverName: payment.receiver_first_name ? `${payment.receiver_first_name} ${payment.receiver_last_name || ''}`.trim() : 'Admin'
        },
        school: {
            id: payment.school_id,
            name: payment.school_name || 'SchoolSync Academy',
            address: payment.school_address || '',
            phone: payment.school_phone || '',
            email: payment.school_email || '',
            website: payment.school_website || '',
            logoPath: resolveSchoolLogo(payment.school_logo)
        },
        student: {
            id: payment.student_id,
            name: `${payment.student_first_name} ${payment.student_last_name}`.trim(),
            admissionNo: payment.admission_no || `ADM-${payment.student_id}`,
            rollNo: payment.roll_no || '—',
            className: payment.class_name || '—',
            section: payment.section || '',
            fatherName: payment.father_name || '—',
            fatherPhone: payment.father_phone || '',
            motherName: payment.mother_name || '',
            motherPhone: payment.mother_phone || '',
            address: studentAddress
        },
        feeItems: feeItems.map(item => ({
            id: item.student_fee_id,
            name: item.fee_name,
            month: item.fee_month,
            dueDate: item.due_date,
            frequency: item.frequency,
            totalAmount: Number(item.total_amount),
            paidAmount: Number(item.paid_amount),
            allocatedAmount: Number(item.allocated_amount),
            status: item.fee_status
        })),
        summary: {
            totalDemanded,
            discount: discountAmount,
            amountPaid: paymentAmount,
            totalAllocated: totalAllocatedInThisTrx,
            overallBalance
        }
    };
};

async function generateReceiptPdf(receiptData) {
    const { payment, school, student, feeItems, summary } = receiptData;

    const doc = new PDFDocument({
        size: 'A4',
        margin: 36,
        info: {
            Title: `Fee Receipt - ${payment.receiptNumber}`,
            Author: school.name,
            Subject: `Official Fee Payment Receipt for ${student.name}`,
            Keywords: 'Fee Receipt, SchoolSync, Payment'
        }
    });

    const primaryColor = '#0F766E';
    const secondaryColor = '#0D9488';
    const darkText = '#1E293B';
    const lightText = '#64748B';
    const borderCol = '#E2E8F0';
    const bgLight = '#F8FAFC';

    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = 36;
    const contentWidth = pageWidth - (margin * 2);

    let y = margin;

    const badgeWidth = 145;
    const badgeX = pageWidth - margin - badgeWidth - 12;
    const headerBoxHeight = 88;

    doc.rect(margin, y, contentWidth, headerBoxHeight).fill(bgLight);
    doc.rect(margin, y, 6, headerBoxHeight).fill(primaryColor);
    doc.rect(margin, y, contentWidth, headerBoxHeight).stroke(borderCol);

    let headerTextX = margin + 18;
    if (school.logoPath) {
        try {
            doc.image(school.logoPath, margin + 14, y + 14, { width: 55, height: 55 });
            headerTextX = margin + 80;
        } catch (e) {
            console.error('Logo loading error in receipt PDF:', e.message);
        };
    };

    const textWidth = badgeX - headerTextX - 16;
    const schoolName = (school.name || 'SchoolSync Academy').toUpperCase();
    const nameFontSize = schoolName.length > 40 ? 11 : (schoolName.length > 25 ? 12.5 : 14);

    doc.fillColor(primaryColor)
        .font('Helvetica-Bold')
        .fontSize(nameFontSize);

    const nameHeight = doc.heightOfString(schoolName, { width: textWidth, lineGap: 1 });
    doc.text(schoolName, headerTextX, y + 12, { width: textWidth, lineGap: 1 });

    let currentHeaderY = y + 12 + nameHeight + 4;

    doc.fillColor(lightText)
        .font('Helvetica')
        .fontSize(8);

    const addressText = school.address || 'Education Campus';
    const addressHeight = doc.heightOfString(addressText, { width: textWidth });
    doc.text(addressText, headerTextX, currentHeaderY, { width: textWidth, ellipsis: true });

    currentHeaderY += addressHeight + 3;

    const contactParts = [];
    if (school.phone) contactParts.push(`Phone: ${school.phone}`);
    if (school.email) contactParts.push(`Email: ${school.email}`);
    if (school.website) contactParts.push(`Web: ${school.website}`);
    if (contactParts.length) {
        doc.fontSize(7.5).text(contactParts.join('  |  '), headerTextX, currentHeaderY, { width: textWidth, ellipsis: true });
    };

    doc.roundedRect(badgeX, y + 12, badgeWidth, 64, 4).fill('#FFFFFF');
    doc.roundedRect(badgeX, y + 12, badgeWidth, 64, 4).stroke(borderCol);

    doc.fillColor(secondaryColor)
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .text('OFFICIAL FEE RECEIPT', badgeX, y + 19, { width: badgeWidth, align: 'center' });

    doc.fillColor(darkText)
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .text(payment.receiptNumber, badgeX, y + 33, { width: badgeWidth, align: 'center' });

    const formattedDate = new Date(payment.paymentDate).toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric'
    });
    doc.fillColor(lightText)
        .font('Helvetica')
        .fontSize(8)
        .text(`Date: ${formattedDate}`, badgeX, y + 49, { width: badgeWidth, align: 'center' });

    y += headerBoxHeight + 14;

    const boxHeight = 70;
    const colWidth = (contentWidth - 12) / 2;

    doc.roundedRect(margin, y, colWidth, boxHeight, 4).fill(bgLight);
    doc.roundedRect(margin, y, colWidth, boxHeight, 4).stroke(borderCol);
    doc.roundedRect(margin + colWidth + 12, y, colWidth, boxHeight, 4).fill(bgLight);
    doc.roundedRect(margin + colWidth + 12, y, colWidth, boxHeight, 4).stroke(borderCol);

    doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(8.5).text('STUDENT INFORMATION', margin + 10, y + 8);
    let sY = y + 22;
    const renderRow = (lbl, val, x, currY) => {
        doc.fillColor(lightText).font('Helvetica-Bold').fontSize(7.5).text(lbl, x, currY, { width: 75 });
        doc.fillColor(darkText).font('Helvetica').fontSize(7.5).text(val || '—', x + 80, currY, { width: colWidth - 90, ellipsis: true });
    };

    renderRow('Student Name:', student.name, margin + 10, sY);
    renderRow('Class & Sec:', `${student.className} ${student.section ? `(${student.section})` : ''}`, margin + 10, sY + 14);
    renderRow('Admission / Roll:', `${student.admissionNo}  |  Roll: ${student.rollNo}`, margin + 10, sY + 28);

    const rightColX = margin + colWidth + 22;
    doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(8.5).text('PAYMENT & GUARDIAN', rightColX, y + 8);
    let pY = y + 22;
    renderRow('Father / Phone:', `${student.fatherName}${student.fatherPhone ? ` (${student.fatherPhone})` : ''}`, rightColX, pY);
    renderRow('Payment Method:', payment.paymentMethodLabel, rightColX, pY + 14);
    renderRow('Payment Status:', 'PAID (VERIFIED)', rightColX, pY + 28);

    y += boxHeight + 14;

    doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(10).text('FEE BREAKDOWN & ALLOCATIONS', margin, y);
    y += 15;

    const tableTop = y;
    const colX = {
        sr: margin + 8,
        name: margin + 30,
        period: margin + 220,
        demand: margin + 310,
        paid: margin + 410
    };

    doc.rect(margin, tableTop, contentWidth, 20).fill(primaryColor);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8);
    doc.text('#', colX.sr, tableTop + 6, { width: 18 });
    doc.text('Fee Name / Particulars', colX.name, tableTop + 6, { width: 180 });
    doc.text('Academic Year', colX.period, tableTop + 6, { width: 80 });
    doc.text('Annual Demanded', colX.demand, tableTop + 6, { width: 90, align: 'right' });
    doc.text('Paid In This Trx', colX.paid, tableTop + 6, { width: 100, align: 'right' });

    y = tableTop + 20;
    doc.font('Helvetica').fontSize(8);

    feeItems.forEach((item, idx) => {
        const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
        doc.rect(margin, y, contentWidth, 18).fill(rowBg);
        doc.rect(margin, y, contentWidth, 18).stroke('#F1F5F9');

        doc.fillColor(darkText);
        doc.text(String(idx + 1), colX.sr, y + 5, { width: 18 });
        doc.text(item.name, colX.name, y + 5, { width: 180, ellipsis: true });
        doc.text(item.month || item.academic_year || item.frequency || 'Annual', colX.period, y + 5, { width: 80 });
        doc.text(formatCurrency(item.totalAmount), colX.demand, y + 5, { width: 90, align: 'right' });
        doc.fillColor(primaryColor).font('Helvetica-Bold');
        doc.text(formatCurrency(item.allocatedAmount), colX.paid, y + 5, { width: 100, align: 'right' });
        doc.font('Helvetica');

        y += 18;
    });

    doc.rect(margin, y, contentWidth, 1).fill(borderCol);
    y += 10;

    const summaryBoxWidth = 240;
    const summaryX = pageWidth - margin - summaryBoxWidth;
    const summaryY = y;

    const metadataWidth = contentWidth - summaryBoxWidth - 14;
    const metadataX = margin;

    doc.roundedRect(metadataX, summaryY, metadataWidth, 90, 4).fill(bgLight);
    doc.roundedRect(metadataX, summaryY, metadataWidth, 90, 4).stroke(borderCol);

    doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(8).text('TRANSACTION DETAILS & REFERENCES', metadataX + 10, summaryY + 8);

    let mY = summaryY + 22;
    const renderMeta = (label, val) => {
        if (!val) return;
        doc.fillColor(lightText).font('Helvetica-Bold').fontSize(7.5).text(label, metadataX + 10, mY, { width: 85 });
        doc.fillColor(darkText).font('Helvetica').fontSize(7.5).text(val, metadataX + 100, mY, { width: metadataWidth - 110, ellipsis: true });
        mY += 13;
    };

    renderMeta('Method:', payment.paymentMethodLabel);
    if (payment.transactionId) renderMeta('Transaction ID:', payment.transactionId);
    if (payment.paymentReference) renderMeta('Reference / UTR:', payment.paymentReference);
    if (payment.razorpayOrderId) renderMeta('Razorpay Order:', payment.razorpayOrderId);
    if (payment.razorpayPaymentId) renderMeta('Razorpay Payment:', payment.razorpayPaymentId);
    if (student.address) renderMeta('Student Address:', student.address);

    doc.roundedRect(summaryX, summaryY, summaryBoxWidth, 90, 4).fill(bgLight);
    doc.roundedRect(summaryX, summaryY, summaryBoxWidth, 90, 4).stroke(borderCol);

    let sumLineY = summaryY + 10;
    const renderSummaryLine = (label, val, isBold = false, color = darkText, fontSize = 8) => {
        doc.fillColor(lightText).font(isBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).text(label, summaryX + 10, sumLineY);
        doc.fillColor(color).font(isBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).text(val, summaryX + 10, sumLineY, { width: summaryBoxWidth - 20, align: 'right' });
        sumLineY += 15;
    };

    renderSummaryLine('Allocated Subtotal:', formatCurrency(payment.totalAllocated));
    if (payment.discount > 0) {
        renderSummaryLine('Discount Applied:', `-${formatCurrency(payment.discount)}`, false, '#16A34A');
    }
    renderSummaryLine('TOTAL AMOUNT PAID:', formatCurrency(payment.amount), true, primaryColor, 9.5);
    doc.rect(summaryX + 10, sumLineY - 2, summaryBoxWidth - 20, 0.5).fill(borderCol);
    sumLineY += 4;
    renderSummaryLine('Overall Balance Remaining:', formatCurrency(summary.overallBalance), false, '#DC2626', 7.5);

    y = summaryY + 105;

    const footerY = pageHeight - margin - 65;
    doc.rect(margin, footerY, contentWidth, 0.5).fill(borderCol);

    doc.fillColor(darkText)
        .font('Times-Italic')
        .fontSize(8.5)
        .text('Authorized Signatory / Accounts Office', margin + 10, footerY + 30);

    doc.fillColor(lightText)
        .font('Helvetica')
        .fontSize(7)
        .text('Generated By: ' + (payment.receiverName || 'System') + ' on ' + new Date().toLocaleString('en-IN'), margin + 10, footerY + 45);

    doc.fillColor(lightText)
        .font('Helvetica')
        .fontSize(7)
        .text('This is a computer-generated official payment receipt. No physical signature is required.', margin, footerY + 30, { width: contentWidth, align: 'right' });

    doc.fillColor(primaryColor)
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .text('Powered by SchoolSync ERP', margin, footerY + 45, { width: contentWidth, align: 'right' });

    doc.end();
    return doc;
};

module.exports = { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, normalizePaymentMethod, formatPaymentMethod, buildReceiptNumber, getReceiptData, generateReceiptPdf};