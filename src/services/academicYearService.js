const ACADEMIC_YEAR_START_MONTH_INDEX = 3;

const defaultQuery = (sql, params) => {
    const { queryAsync } = require('../config/database');
    return queryAsync(sql, params);
};

function getDefaultAcademicYearCode(referenceDate = new Date()) {
    const date = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
    if (Number.isNaN(date.getTime())) {
        throw new TypeError('A valid reference date is required.');
    };

    const calendarYear = date.getFullYear();
    const startYear = date.getMonth() >= ACADEMIC_YEAR_START_MONTH_INDEX
        ? calendarYear
        : calendarYear - 1;
    return `${startYear}-${startYear + 1}`;
};

async function getActiveAcademicYearForSchool(schoolId, { query = defaultQuery } = {}) {
    if (!schoolId) return null;

    const rows = await query(
        `SELECT id, school_id, code, status, is_current
        FROM academic_years
        WHERE school_id = ?
            AND status = 'active'
        ORDER BY is_current DESC, id DESC
        LIMIT 1`,
        [schoolId]
    );
    return rows[0] || null;
};

async function ensureActiveAcademicYearForSchool(
    schoolId,
    { query = defaultQuery, referenceDate = new Date() } = {}
) {
    if (!schoolId) return null;

    const activeYear = await getActiveAcademicYearForSchool(schoolId, { query });
    if (activeYear) return activeYear;

    const existingYears = await query(
        `SELECT id
        FROM academic_years
        WHERE school_id = ?
        LIMIT 1`,
        [schoolId]
    );
    if (existingYears.length > 0) return null;

    const classYears = await query(
        `SELECT TRIM(academic_year) AS code, COUNT(*) AS usage_count
        FROM classes
        WHERE school_id = ?
            AND NULLIF(TRIM(academic_year), '') IS NOT NULL
        GROUP BY TRIM(academic_year)
        ORDER BY usage_count DESC, code DESC
        LIMIT 1`,
        [schoolId]
    );
    const code = classYears[0]?.code || getDefaultAcademicYearCode(referenceDate);

    await query(
        `INSERT IGNORE INTO academic_years (school_id, code, status, is_current)
        VALUES (?, ?, 'active', 1)`,
        [schoolId, code]
    );

    return getActiveAcademicYearForSchool(schoolId, { query });
};

module.exports = { getDefaultAcademicYearCode, getActiveAcademicYearForSchool, ensureActiveAcademicYearForSchool};