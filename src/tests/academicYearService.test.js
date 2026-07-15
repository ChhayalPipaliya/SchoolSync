const test = require('node:test');
const assert = require('node:assert/strict');
const {
    getDefaultAcademicYearCode,
    getActiveAcademicYearForSchool,
    ensureActiveAcademicYearForSchool
} = require('../services/academicYearService');

function createAcademicYearStore({ years = [], classYear = null } = {}) {
    const state = {
        years: years.map(year => ({ ...year })),
        insertCount: 0
    };

    const query = async (sql, params) => {
        if (sql.includes('INTO academic_years')) {
            const [schoolId, code] = params;
            let year = state.years.find(item =>
                Number(item.school_id) === Number(schoolId) && item.code === code
            );
            if (!year) {
                year = {
                    id: state.years.length + 1,
                    school_id: schoolId,
                    code,
                    status: 'active',
                    is_current: 1
                };
                state.years.push(year);
            }
            state.insertCount += 1;
            return { insertId: year.id };
        }

        if (sql.includes('FROM classes')) {
            return classYear ? [{ code: classYear, usage_count: 1 }] : [];
        }

        if (sql.includes('FROM academic_years')) {
            const schoolId = params[0];
            const scopedYears = state.years.filter(item =>
                Number(item.school_id) === Number(schoolId)
            );
            if (sql.includes("status = 'active'")) {
                return scopedYears
                    .filter(item => item.status === 'active')
                    .sort((left, right) =>
                        Number(right.is_current) - Number(left.is_current) || right.id - left.id
                    );
            }
            return scopedYears;
        }

        throw new Error(`Unexpected query in test: ${sql}`);
    };

    return { state, query };
}

test('getDefaultAcademicYearCode uses the April academic-year boundary', () => {
    assert.equal(getDefaultAcademicYearCode(new Date(2026, 2, 31)), '2025-2026');
    assert.equal(getDefaultAcademicYearCode(new Date(2026, 3, 1)), '2026-2027');
});

test('ensureActiveAcademicYearForSchool provisions a missing year idempotently', async () => {
    const store = createAcademicYearStore();
    const options = {
        query: store.query,
        referenceDate: new Date(2026, 6, 15)
    };

    const first = await ensureActiveAcademicYearForSchool(10000, options);
    const second = await ensureActiveAcademicYearForSchool(10000, options);

    assert.equal(first.code, '2026-2027');
    assert.equal(first.status, 'active');
    assert.equal(Number(first.is_current), 1);
    assert.deepEqual(second, first);
    assert.equal(store.state.insertCount, 1);
    assert.equal(store.state.years.length, 1);
});

test('missing-year provisioning prefers the school class academic year', async () => {
    const store = createAcademicYearStore({ classYear: '2024-2025' });

    const result = await ensureActiveAcademicYearForSchool(50, {
        query: store.query,
        referenceDate: new Date(2026, 6, 15)
    });

    assert.equal(result.code, '2024-2025');
});

test('ensureActiveAcademicYearForSchool preserves existing school configuration', async () => {
    const existingYear = {
        id: 7,
        school_id: 25,
        code: '2025-2026',
        status: 'inactive',
        is_current: 0
    };
    const store = createAcademicYearStore({ years: [existingYear] });

    const result = await ensureActiveAcademicYearForSchool(25, { query: store.query });

    assert.equal(result, null);
    assert.equal(store.state.insertCount, 0);
    assert.deepEqual(store.state.years, [existingYear]);
});

test('active academic-year lookup prefers current, ignores inactive, and stays school-scoped', async () => {
    const store = createAcademicYearStore({
        years: [
            { id: 1, school_id: 1, code: '2025-2026', status: 'active', is_current: 0 },
            { id: 2, school_id: 1, code: '2024-2025', status: 'inactive', is_current: 1 },
            { id: 3, school_id: 2, code: '2026-2027', status: 'active', is_current: 1 }
        ]
    });

    assert.equal(
        (await getActiveAcademicYearForSchool(1, { query: store.query })).code,
        '2025-2026'
    );
    assert.equal(
        (await getActiveAcademicYearForSchool(2, { query: store.query })).code,
        '2026-2027'
    );
});
