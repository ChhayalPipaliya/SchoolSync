const PDFDocument = require('pdfkit');
const fs = require('fs');

function formatExportValue(value) {
    if (value === undefined || value === null) return '';
    if (value instanceof Date && !isNaN(value)) {
        return value.toISOString().slice(0, 10);
    }

    const str = String(value);
    if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
        return str.slice(0, 10);
    }
    if (/^[A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{2}\s+\d{4}/.test(str)) {
        const parsed = new Date(str);
        if (!isNaN(parsed)) return parsed.toISOString().slice(0, 10);
    }

    return str;
}

function getColumnWeights(headers) {
    return headers.map(header => {
        const key = String(header.key || '').toLowerCase();
        const label = String(header.label || '').toLowerCase();
        if (key.includes('email') || label.includes('email')) return 1.7;
        if (key.includes('name') || label.includes('name')) return 1.45;
        if (key.includes('remark') || key.includes('detail') || label.includes('remark')) return 1.6;
        if (key.includes('date') || label.includes('date')) return 1.05;
        if (key.includes('status') || label.includes('status')) return 0.95;
        if (key.includes('roll') || key.includes('class') || key.includes('section')) return 0.85;
        return 1;
    });
}

function getColumnWidths(headers, totalWidth) {
    const weights = getColumnWeights(headers);
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    return weights.map(weight => (totalWidth * weight) / totalWeight);
}

function drawPageHeader(doc, title, schoolName, layout) {
    doc.fontSize(18).font('Helvetica-Bold').text(schoolName, layout.left, 28, {
        width: layout.width,
        ellipsis: true
    });
    doc.fontSize(9).font('Helvetica').text('Bulk Generated Report System', layout.left, 52);
    doc.text(`Generated on: ${new Date().toISOString().slice(0, 10)}`, layout.left, 65);
    doc.moveTo(layout.left, 82).lineTo(layout.right, 82).strokeColor('#94A3B8').stroke();
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#111827').text(title, layout.left, 96, {
        width: layout.width,
        ellipsis: true
    });
}

function drawTableHeader(doc, headers, colWidths, y, layout) {
    let x = layout.left;
    doc.rect(layout.left, y - 4, layout.width, 22).fill('#F1F5F9');
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(7.5);
    headers.forEach((header, index) => {
        doc.text(header.label, x + 3, y, {
            width: colWidths[index] - 6,
            height: 14,
            ellipsis: true
        });
        x += colWidths[index];
    });
    doc.moveTo(layout.left, y + 18).lineTo(layout.right, y + 18).strokeColor('#CBD5E1').stroke();
    return y + 26;
}

function calculateRowHeight(doc, row, headers, colWidths) {
    doc.font('Helvetica').fontSize(7);
    const heights = headers.map((header, index) => {
        const text = String(formatExportValue(row[header.key]));
        return doc.heightOfString(text, {
            width: colWidths[index] - 6,
            lineGap: 1
        });
    });
    return Math.min(Math.max(...heights, 12) + 8, 42);
}

function drawRow(doc, row, headers, colWidths, y, layout, isSummary) {
    let x = layout.left;
    if (isSummary) {
        doc.rect(layout.left, y - 2, layout.width, calculateRowHeight(doc, row, headers, colWidths)).fill('#F8FAFC');
        doc.font('Helvetica-Bold');
    } else {
        doc.font('Helvetica');
    }

    doc.fillColor('#111827').fontSize(7);
    headers.forEach((header, index) => {
        doc.text(String(formatExportValue(row[header.key])), x + 3, y + 3, {
            width: colWidths[index] - 6,
            height: 36,
            lineGap: 1,
            ellipsis: true
        });
        x += colWidths[index];
    });
}

function exportToPDF(data, headers, filePath, title, schoolName = 'SchoolSync') {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'A4',
            layout: 'landscape',
            margin: 28
        });
        const ws = fs.createWriteStream(filePath);
        const layout = {
            left: doc.page.margins.left,
            right: doc.page.width - doc.page.margins.right,
            width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
            bottom: doc.page.height - doc.page.margins.bottom
        };
        const colWidths = getColumnWidths(headers, layout.width);

        const startPage = () => {
            drawPageHeader(doc, title, schoolName, layout);
            return drawTableHeader(doc, headers, colWidths, 124, layout);
        };

        doc.pipe(ws);
        let y = startPage();

        data.forEach(row => {
            const rowHeight = calculateRowHeight(doc, row, headers, colWidths);
            if (y + rowHeight > layout.bottom) {
                doc.addPage();
                y = startPage();
            }

            const firstValue = String(row[headers[0].key] || '').toLowerCase();
            const isSummary = firstValue.includes('total') || firstValue.includes('average');
            drawRow(doc, row, headers, colWidths, y, layout, isSummary);
            y += rowHeight;
            doc.moveTo(layout.left, y - 1).lineTo(layout.right, y - 1).strokeColor('#E2E8F0').stroke();
        });

        doc.end();

        ws.on('finish', () => resolve());
        ws.on('error', (err) => reject(err));
    });
}

module.exports = { exportToPDF, formatExportValue };
