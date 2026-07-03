const fs = require('fs');
const { Readable } = require('stream');
const csvParser = require('csv-parser');
const xlsx = require('xlsx');

function sanitizeValue(val) {
    if (val === undefined || val === null) return '';
    const valStr = String(val).replace(/^\uFEFF/, '').trim();
    if (valStr.startsWith('=') || valStr.startsWith('+') || valStr.startsWith('-') || valStr.startsWith('@')) {
        return "'" + valStr;
    }
    return valStr;
}

function normalizeHeader(key) {
    return String(key || '')
        .replace(/^\uFEFF/, '')
        .trim()
        .toLowerCase()
        .replace(/[\s-\/]+/g, '_');
}

function normalizeKeys(row) {
    const normalized = {};
    for (const key of Object.keys(row)) {
        const normalizedKey = normalizeHeader(key);
        if (!normalizedKey) continue;
        normalized[normalizedKey] = sanitizeValue(row[key]);
    }
    return normalized;
}

function isBlankRow(row) {
    return Object.values(row).every(value => sanitizeValue(value) === '');
}

function cleanCsvContent(content) {
    return String(content || '')
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .filter(line => {
            const trimmed = line.replace(/^\uFEFF/, '').trim();
            return trimmed !== '' && !trimmed.startsWith('#');
        })
        .join('\n');
}

async function parseFile(filePath) {
    const ext = filePath.split('.').pop().toLowerCase();
    
    if (ext === 'csv') {
        return new Promise((resolve, reject) => {
            const results = [];
            const cleanContent = cleanCsvContent(fs.readFileSync(filePath, 'utf8'));
            if (!cleanContent.trim()) {
                return resolve(results);
            }

            Readable.from([cleanContent])
                .pipe(csvParser({
                    mapHeaders: ({ header }) => normalizeHeader(header)
                }))
                .on('data', (data) => {
                    const row = normalizeKeys(data);
                    if (!isBlankRow(row)) {
                        results.push(row);
                    }
                })
                .on('end', () => {
                    resolve(results);
                })
                .on('error', (err) => {
                    reject(err);
                });
        });
    } else if (ext === 'xlsx') {
        try {
            const workbook = xlsx.readFile(filePath);
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const rawData = xlsx.utils.sheet_to_json(worksheet, { defval: '' });
            return rawData
                .map(row => normalizeKeys(row))
                .filter(row => !isBlankRow(row));
        } catch (err) {
            throw new Error(`Failed to parse Excel file: ${err.message}`);
        }
    } else {
        throw new Error('Unsupported file format. Only CSV and XLSX are allowed.');
    }
}

module.exports = {
    parseFile,
    sanitizeValue,
    normalizeHeader
};
