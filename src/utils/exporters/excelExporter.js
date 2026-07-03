const xlsx = require('xlsx');

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

    return value;
}

function mapRows(data, headers) {
    return data.map(row => {
        const mappedRow = {};
        headers.forEach(h => {
            mappedRow[h.label] = formatExportValue(row[h.key]);
        });
        return mappedRow;
    });
}

function applyColumnWidths(worksheet, headers, mappedData) {
    worksheet['!cols'] = headers.map(header => {
        const labelWidth = String(header.label || '').length;
        const dataWidth = mappedData.reduce((max, row) => {
            return Math.max(max, String(row[header.label] || '').length);
        }, labelWidth);
        return { wch: Math.min(Math.max(dataWidth + 2, 12), 34) };
    });
}

function exportToExcel(data, headers, filePath, sheetName = 'Sheet1') {
    const mappedData = mapRows(data, headers);
    const worksheet = xlsx.utils.json_to_sheet(mappedData);
    applyColumnWidths(worksheet, headers, mappedData);

    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
    xlsx.writeFile(workbook, filePath);
}

function exportToExcelMultiSheet(sheets, filePath) {
    const workbook = xlsx.utils.book_new();
    sheets.forEach(sheet => {
        const mappedData = mapRows(sheet.data, sheet.headers);
        const worksheet = xlsx.utils.json_to_sheet(mappedData);
        applyColumnWidths(worksheet, sheet.headers, mappedData);
        xlsx.utils.book_append_sheet(workbook, worksheet, sheet.name);
    });
    xlsx.writeFile(workbook, filePath);
}

module.exports = {
    exportToExcel,
    exportToExcelMultiSheet,
    formatExportValue
};
