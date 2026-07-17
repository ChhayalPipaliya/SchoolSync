const db = require('../config/database');

const LOWER_CLASS_NAMES = new Set(['nursery', 'lkg', 'ukg', '1', '2', '3', '4', '5']);
const STREAMS = ['Science', 'Commerce', 'Arts'];

function normalizeClassName(className) {
    const raw = String(className || '').trim();
    if (!raw) return '';

    const lower = raw.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
    if (lower === 'nursery') return 'Nursery';
    if (lower === 'lkg') return 'LKG';
    if (lower === 'ukg') return 'UKG';

    const numeric = lower
        .replace(/^standard\s+/, '')
        .replace(/^std\s+/, '')
        .replace(/^class\s+/, '')
        .trim();

    return /^(1[0-2]|[1-9])$/.test(numeric) ? numeric : raw;
};

function normalizeStreamValue(stream) {
    const value = String(stream || '').trim().toLowerCase();
    return STREAMS.find(item => item.toLowerCase() === value) || null;
};

function extractStreamFromClassName(className) {
    const value = String(className || '').toLowerCase();
    if (/\bscience\b/.test(value)) return 'Science';
    if (/\bcommerce\b/.test(value)) return 'Commerce';
    if (/\barts?\b/.test(value)) return 'Arts';
    return null;
};

function normalizeCanonicalClassInput(className, explicitStream = null) {
    const raw = String(className || '').trim();
    const extractedStream = extractStreamFromClassName(raw);
    const cleaned = raw
        .replace(/\b(science|commerce|arts?)\b/ig, ' ')
        .replace(/\b(english|gujarati|gujrati|hindi)\b/ig, ' ')
        .replace(/[-_/]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    let normalized = normalizeClassName(cleaned).replace(/^standard\s*/i, '').trim();
    const lower = normalized.toLowerCase();
    const wordMap = {
        first: '1',
        second: '2',
        third: '3',
        fourth: '4',
        fifth: '5',
        sixth: '6',
        seventh: '7',
        eighth: '8',
        ninth: '9',
        tenth: '10',
        eleventh: '11',
        twelfth: '12',
        nursery: 'Nursery',
        lkg: 'LKG',
        ukg: 'UKG'
    };
    normalized = wordMap[lower] || normalized;
    const numeric = normalized.match(/\b(1[0-2]|[1-9])\b/);
    if (numeric) normalized = numeric[1];

    const stream = ['11', '12'].includes(normalized)
        ? (normalizeStreamValue(explicitStream) || extractedStream)
        : null;
    return { className: normalized, stream };
};

function canonicalClassKey(row = {}) {
    const canonical = normalizeCanonicalClassInput(row.class_name || row.name, row.stream);
    return [
        row.school_id || '',
        String(row.academic_year || ''),
        canonical.className.toLowerCase(),
        String(row.medium || '').trim().toLowerCase(),
        canonical.stream || 'General'
    ].join('||');
};

async function findCanonicalClassRows(connection, schoolId, target) {
    const [rows] = await connection.query(
        `SELECT id, school_id, class_name, section, medium, stream, academic_year
        FROM classes
        WHERE school_id = ?`,
        [schoolId]
    );
    const key = canonicalClassKey({
        school_id: schoolId,
        class_name: target.class_name,
        medium: target.medium,
        stream: target.stream,
        academic_year: target.academic_year
    });
    return rows.filter(row => canonicalClassKey(row) === key);
};

function getClassNameAliases(className) {
    const normalized = normalizeClassName(className);
    return [...new Set([String(className || '').trim(), normalized].filter(Boolean))];
};

function getDefaultPortalAccessByClass(className) {
    const normalized = normalizeClassName(className);
    return {
        parentPortal: LOWER_CLASS_NAMES.has(String(normalized).toLowerCase()),
        studentPortal: true,
        isOverridden: false
    };
};

function parseSchoolTypes(rawSchoolType) {
    let values = [];
    if (Array.isArray(rawSchoolType)) {
        values = rawSchoolType;
    } else if (typeof rawSchoolType === 'string') {
        try {
            const parsed = JSON.parse(rawSchoolType);
            values = Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
            values = rawSchoolType.split(',').map(s => s.trim()).filter(Boolean);
        };
    };

    const map = {
        'pre-primary': ['pre_primary'],
        'pre primary': ['pre_primary'],
        pre_primary: ['pre_primary'],
        primary: ['primary'],
        secondary: ['secondary'],
        'higher secondary': ['higher_secondary'],
        higher_secondary: ['higher_secondary'],
        'kg to 12': ['kg_to_12', 'pre_primary', 'primary', 'secondary', 'higher_secondary'],
        kg_to_12: ['kg_to_12', 'pre_primary', 'primary', 'secondary', 'higher_secondary'],
        'pre-primary + primary': ['pre_primary_primary', 'pre_primary', 'primary'],
        'pre primary + primary': ['pre_primary_primary', 'pre_primary', 'primary'],
        pre_primary_primary: ['pre_primary_primary', 'pre_primary', 'primary'],
        'secondary + higher secondary': ['secondary_higher_secondary', 'secondary', 'higher_secondary'],
        secondary_higher_secondary: ['secondary_higher_secondary', 'secondary', 'higher_secondary']
    };

    return [...new Set(values.flatMap(value => {
        const key = String(value || '').trim().toLowerCase().replace(/\s*&\s*/g, ' + ');
        return map[key] || [String(value || '').trim()];
    }).filter(Boolean))];
};

async function executeQuery(queryExecutor, sql, params) {
    const res = await queryExecutor.query(sql, params);
    return (Array.isArray(res) && res.length === 2 && Array.isArray(res[1])) ? res[0] : res;
};

async function getPortalAccess(schoolId, className, conn) {
    const queryExecutor = conn || db;
    const classAliases = getClassNameAliases(className);
    if (classAliases.length === 0) {
        return getDefaultPortalAccessByClass(className);
    };
    try {
        const override = await executeQuery(
            queryExecutor,
            "SELECT parent_portal, student_portal FROM portal_overrides WHERE school_id = ? AND class_name IN (?) LIMIT 1",
            [schoolId, classAliases]
        );

        if (override && override.length > 0) {
            return {
                parentPortal: !!override[0].parent_portal,
                studentPortal: !!override[0].student_portal,
                isOverridden: true
            };
        };

        const school = await executeQuery(
            queryExecutor,
            "SELECT school_type FROM schools WHERE id = ? LIMIT 1",
            [schoolId]
        );

        if (!school || school.length === 0) {
            return getDefaultPortalAccessByClass(className);
        };

        const schoolTypes = parseSchoolTypes(school[0].school_type);
        if (schoolTypes.length === 0) {
            return getDefaultPortalAccessByClass(className);
        };

        const rules = await executeQuery(
            queryExecutor,
            `SELECT pr.parent_portal, pr.student_portal 
            FROM portal_rules pr
            JOIN school_types st ON pr.school_type_id = st.id
            WHERE st.code IN (?) AND pr.class_name IN (?)
            LIMIT 1`,
            [schoolTypes, classAliases]
        );

        if (rules && rules.length > 0) {
            return {
                parentPortal: !!rules[0].parent_portal,
                studentPortal: true,
                isOverridden: false
            };
        };

        return getDefaultPortalAccessByClass(className);
    } catch (err) {
        console.error("[PortalService-Error] Failed to resolve portal access:", err.message);
        return getDefaultPortalAccessByClass(className);
    };
};

async function initializeSchoolClassesAndMediums(schoolId, schoolTypes, mediums, connection) {
    try {
        const summary = {
            created_classes: 0,
            skipped_classes: 0,
            created_sections: 0,
            skipped_sections: 0
        };
        let parsedTypes = [];
        if (Array.isArray(schoolTypes)) {
            parsedTypes = parseSchoolTypes(schoolTypes);
        } else if (typeof schoolTypes === 'string') {
            parsedTypes = parseSchoolTypes(schoolTypes);
        };

        let parsedMediums = [];
        if (Array.isArray(mediums)) {
            parsedMediums = mediums;
        } else if (typeof mediums === 'string') {
            try {
                const parsed = JSON.parse(mediums);
                parsedMediums = Array.isArray(parsed) ? parsed : [parsed];
            } catch (e) {
                parsedMediums = mediums.split(',').map(m => m.trim().toUpperCase()).filter(Boolean);
            };
        };

        if (parsedTypes.length === 0 || parsedMediums.length === 0) {
            console.log("[PortalService-Init] No school types or mediums provided. Skipping class generation.");
            return;
        };

        for (const medName of parsedMediums) {
            const [medRows] = await connection.query(
                "SELECT id FROM mediums WHERE name = ? LIMIT 1",
                [medName]
            );
            if (medRows && medRows.length > 0) {
                await connection.query(
                    "INSERT IGNORE INTO school_mediums (school_id, medium_id) VALUES (?, ?)",
                    [schoolId, medRows[0].id]
                );
            };
        };

        console.log(`[PortalService-Init] Mediums mapped for school ID ${schoolId}. Skipping automatic class/section creation.`);
        return summary;
    } catch (err) {
        console.error("[PortalService-Init-Error] Failed to initialize school classes/mediums:", err.message);
        throw err;
    };
};

module.exports = { getPortalAccess, normalizeClassName, getClassNameAliases, getDefaultPortalAccessByClass, parseSchoolTypes, initializeSchoolClassesAndMediums };