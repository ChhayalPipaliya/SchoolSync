const fs = require('fs');
const fastCsv = require('fast-csv');

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

function exportToCSV(data, headers, filePath) {
    return new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(filePath);
        const csvStream = fastCsv.format({ headers: true });
        
        csvStream.pipe(ws);
        
        data.forEach(row => {
            const mappedRow = {};
            headers.forEach(h => {
                mappedRow[h.label] = formatExportValue(row[h.key]);
            });
            csvStream.write(mappedRow);
        });
        
        csvStream.end();
        
        ws.on('finish', () => resolve());
        ws.on('error', (err) => reject(err));
    });
}

module.exports = { exportToCSV, formatExportValue };
