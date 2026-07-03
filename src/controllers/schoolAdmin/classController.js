const db = require('../../config/database');
const { classOrderSql, formatClassLabel, normalizeClassName, sortClasses } = require('../../utils/academicLabels');
const { logSchoolActivity } = require('../../utils/auditLogger');
const { getSubscriptionState, isUnlimitedLimit } = require('../../services/subscriptionService');

const CLASS_RANGES = {
    pre_primary: ['Nursery', 'LKG', 'UKG'],
    primary: ['1', '2', '3', '4', '5'],
    upper_primary: ['6', '7', '8'],
    secondary: ['6', '7', '8', '9', '10'],
    higher_secondary: ['11', '12'],
    kg_to_12: ['Nursery', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
};
CLASS_RANGES.complete = CLASS_RANGES.kg_to_12;

const VALID_SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F'];
const VALID_STREAMS = ['Science', 'Commerce', 'Arts', 'General'];
const HIGHER_SEC = ['11', '12'];
const SCHOOL_TYPE_ALIASES = {
    'pre-primary': 'pre_primary',
    'pre primary': 'pre_primary',
    pre_primary: 'pre_primary',
    primary: 'primary',
    'upper-primary': 'upper_primary',
    'upper primary': 'upper_primary',
    upper_primary: 'upper_primary',
    secondary: 'secondary',
    'higher-secondary': 'higher_secondary',
    'higher secondary': 'higher_secondary',
    higher_secondary: 'higher_secondary',
    'kg to 12': 'kg_to_12',
    'kg-12': 'kg_to_12',
    'kg_to_12': 'kg_to_12',
    complete: 'kg_to_12',
    'complete school': 'kg_to_12',
};
const MEDIUM_ALIASES = {
    english: 'English',
    gujarati: 'Gujarati',
    gujrati: 'Gujarati',
    hindi: 'Hindi',
};

function getSchoolId(req) {
    return req.user?.school_id || req.session?.user?.school_id || null;
};

function parseSchoolTypes(rawType) {
    if (Array.isArray(rawType)) {
        return rawType.flatMap(parseSchoolTypes);
    };

    if (rawType === null || rawType === undefined) {
        return [];
    };

    const value = String(rawType).trim();
    if (!value) {
        return [];
    };

    try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
            return parsed.flatMap(parseSchoolTypes);
        }
        return parseSchoolTypes(parsed);
    } catch (e) {
        return value.split(',').map(type => type.trim()).filter(Boolean);
    };
};

function normalizeSchoolType(type) {
    const key = String(type || '').trim().toLowerCase().replace(/\s+/g, ' ');
    return SCHOOL_TYPE_ALIASES[key] || key.replace(/[-\s]+/g, '_');
};

function uniqueClasses(classNames) {
    const seen = new Set();
    return classNames
        .map(normalizeClassName)
        .filter(Boolean)
        .filter(className => {
            const key = className.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
};

async function getAllowedClassesForSchool(schoolId) {
    const [[school]] = await db.query(
        'SELECT school_type FROM schools WHERE id = ? LIMIT 1',
        [schoolId]
    );

    const rawTypes = parseSchoolTypes(school?.school_type);
    const normalizedTypes = rawTypes.map(normalizeSchoolType).filter(Boolean);
    const typeCodes = normalizedTypes.length ? normalizedTypes : ['kg_to_12'];
    const typeNames = rawTypes.length ? rawTypes : typeCodes;

    try {
        const [mappedClasses] = await db.query(
            `SELECT DISTINCT stm.class_name
       FROM school_type_mappings stm
       JOIN school_types st ON stm.school_type_id = st.id
       WHERE st.code IN (?) OR st.name IN (?)`,
            [typeCodes, typeNames]
        );

        const classesFromMappings = uniqueClasses(mappedClasses.map(row => row.class_name));
        if (classesFromMappings.length > 0) {
            return {
                schoolType: typeCodes.join(','),
                schoolTypes: typeCodes,
                displayTypes: typeNames,
                allowedClasses: classesFromMappings
            };
        }
    } catch (err) {
        console.warn('getAllowedClassesForSchool mapping lookup skipped:', err.message);
    };

    const allowedClasses = uniqueClasses(typeCodes.flatMap(type => CLASS_RANGES[type] || []));
    return {
        schoolType: typeCodes.join(','),
        schoolTypes: typeCodes,
        displayTypes: typeNames,
        allowedClasses: allowedClasses.length ? allowedClasses : CLASS_RANGES.kg_to_12
    };
};

function filterAllowedClasses(classList, allowedClasses) {
    const allowedMap = new Map(
        allowedClasses.map(className => [normalizeClassName(className).toLowerCase(), normalizeClassName(className)])
    );

    return uniqueClasses(classList) .map(className => allowedMap.get(normalizeClassName(className).toLowerCase())) .filter(Boolean);
};

function normalizeMediumName(medium) {
    const key = String(medium || '').trim().toLowerCase();
    return MEDIUM_ALIASES[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : '');
};

function uniqueMediums(mediums) {
    const seen = new Set();
    return mediums
        .map(normalizeMediumName)
        .filter(Boolean)
        .filter(medium => {
            const key = medium.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
};

function parseSchoolMediumText(rawMedium) {
    if (Array.isArray(rawMedium)) {
        return uniqueMediums(rawMedium.flatMap(parseSchoolMediumText));
    };

    if (rawMedium === null || rawMedium === undefined) {
        return [];
    };

    const value = String(rawMedium).trim();
    if (!value) {
        return [];
    };

    try {
        const parsed = JSON.parse(value);
        return parseSchoolMediumText(parsed);
    } catch (e) {
        if (value.toLowerCase() === 'both') {
            return ['English', 'Gujarati'];
        }
        return uniqueMediums(value.split(',').map(medium => medium.trim()));
    };
};

function filterAllowedMediums(requestedMediums, allowedMediums) {
    const allowedMap = new Map(
        allowedMediums.map(medium => [normalizeMediumName(medium).toLowerCase(), normalizeMediumName(medium)])
    );

    return uniqueMediums(requestedMediums)
        .map(medium => allowedMap.get(medium.toLowerCase()))
        .filter(Boolean);
};

function normalizeStreams(streams) {
    const selectedStreams = Array.isArray(streams) ? streams : (streams ? [streams] : []);
    const uniqueStreams = [...new Set(selectedStreams.filter(stream => VALID_STREAMS.includes(stream)))];
    return uniqueStreams.filter(stream => stream !== 'General');
};

function normalizeSectionList(sections) {
    return String(sections || 'A')
        .split(',')
        .map(section => section.trim().toUpperCase())
        .filter(section => VALID_SECTIONS.includes(section));
};

function normalizeStreamValue(stream) {
    const value = String(stream || '').trim().toLowerCase();
    if (!value || value === 'general' || value === 'none') return null;
    return VALID_STREAMS.find(item => item.toLowerCase() === value) || null;
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
    const clean = raw
        .replace(/\b(science|commerce|arts?)\b/ig, ' ')
        .replace(/\b(english|gujarati|gujrati|hindi)\b/ig, ' ')
        .replace(/[-_/]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const wordMap = { first: '1', second: '2', third: '3', fourth: '4', fifth: '5', sixth: '6', seventh: '7', eighth: '8', ninth: '9', tenth: '10', eleventh: '11',  twelfth: '12', nursery: 'Nursery', lkg: 'LKG', ukg: 'UKG', 'jr kg': 'LKG', 'jr. kg': 'LKG', 'sr kg': 'UKG', 'sr. kg': 'UKG' };
    let normalized = normalizeClassName(clean)
        .replace(/^standard\s*/i, '')
        .trim();
    const lower = normalized.toLowerCase();
    normalized = wordMap[lower] || normalized;

    const numeric = normalized.match(/\b(1[0-2]|[1-9])\b/);
    if (numeric) normalized = numeric[1];

    const stream = HIGHER_SEC.includes(normalized)
        ? (normalizeStreamValue(explicitStream) || extractedStream)
        : null;

    return { className: normalized, stream };
};

function getClassCanonicalKey(row = {}) {
    const canonical = normalizeCanonicalClassInput(row.class_name || row.name, row.stream);
    return [
        row.school_id || '',
        String(row.academic_year || ''),
        canonical.className.toLowerCase(),
        normalizeMediumName(row.medium).toLowerCase(),
        canonical.stream || 'General'
    ].join('||');
};

async function findCanonicalClassRows(executor, schoolId, target, excludeIds = []) {
    const [rows] = await executor.query(
        `SELECT id, school_id, class_name, section, medium, stream, academic_year, max_students
        FROM classes
        WHERE school_id = ?`,
        [schoolId]
    );
    const targetCanonical = normalizeCanonicalClassInput(target.class_name, target.stream);
    const targetMedium = normalizeMediumName(target.medium).toLowerCase();
    const targetYear = target.academic_year;
    const strictAcademicYear = target.strictAcademicYear === true;
    const excluded = new Set(excludeIds.map(id => Number(id)));

    return rows.filter(row => {
        if (excluded.has(Number(row.id))) return false;
        const rowCanonical = normalizeCanonicalClassInput(row.class_name, row.stream);
        const sameYear = strictAcademicYear
            ? String(row.academic_year || '') === String(targetYear || '')
            : targetYear === undefined || targetYear === null || String(row.academic_year || '') === String(targetYear || '');
        return sameYear
            && rowCanonical.className.toLowerCase() === targetCanonical.className.toLowerCase()
            && normalizeMediumName(row.medium).toLowerCase() === targetMedium
            && (rowCanonical.stream || 'General') === (targetCanonical.stream || 'General');
    });
};

function pickCanonicalBaseClass(rows = []) {
    return [...rows].sort((a, b) => {
        const aCanon = normalizeCanonicalClassInput(a.class_name, a.stream);
        const bCanon = normalizeCanonicalClassInput(b.class_name, b.stream);
        const aScore = (a.section === 'A' ? 0 : 5) + (String(a.class_name) === aCanon.className ? 0 : 1) + (a.stream === aCanon.stream || (!a.stream && !aCanon.stream) ? 0 : 1);
        const bScore = (b.section === 'A' ? 0 : 5) + (String(b.class_name) === bCanon.className ? 0 : 1) + (b.stream === bCanon.stream || (!b.stream && !bCanon.stream) ? 0 : 1);
        return aScore - bScore || Number(a.id) - Number(b.id);
    })[0] || null;
};

function normalizeCapacity(value) {
    const capacity = Number.parseInt(value, 10);
    return Number.isInteger(capacity) && capacity > 0 ? capacity : 40;
};

async function ensureSectionRecord(executor, { schoolId, classId, sectionName, capacity = 40, userId = null }) {
    const [result] = await executor.query(
        `INSERT IGNORE INTO sections
        (school_id, class_id, section_name, capacity, status, created_by, updated_by)
        VALUES (?, ?, ?, ?, 'active', ?, ?)`,
        [schoolId, classId, sectionName, normalizeCapacity(capacity), userId, userId]
    );
    return Number(result.affectedRows || 0) > 0;
};

async function getClassScope(executor, schoolId, classId) {
    const [[baseClass]] = await executor.query(
        `SELECT id, class_name, medium, stream, academic_year
        FROM classes
        WHERE id = ? AND school_id = ?
        LIMIT 1`,
        [classId, schoolId]
    );
    return baseClass || null;
};

async function ensureClassSection(executor, { schoolId, baseClass, sectionName, capacity = 40, userId = null }) {
    const section = String(sectionName || '').trim().toUpperCase();
    if (!VALID_SECTIONS.includes(section)) {
        return { createdClass: false, createdSection: false, skipped: true };
    };

    const [[existing]] = await executor.query(
        `SELECT id
        FROM classes
        WHERE school_id = ? AND class_name = ? AND section = ? AND medium = ? AND stream <=> ? AND academic_year <=> ?
        LIMIT 1`,
        [schoolId, baseClass.class_name, section, baseClass.medium, baseClass.stream, baseClass.academic_year]
    );

    let classId = existing?.id || null;
    let createdClass = false;
    if (!classId) {
        const [insertResult] = await executor.query(
            `INSERT INTO classes (school_id, class_name, section, stream, medium, academic_year, max_students)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [schoolId, baseClass.class_name, section, baseClass.stream, baseClass.medium, baseClass.academic_year, normalizeCapacity(capacity)]
        );
        classId = insertResult.insertId;
        createdClass = true;
    };

    const createdSection = await ensureSectionRecord(executor, {
        schoolId,
        classId,
        sectionName: section,
        capacity,
        userId
    });
    return { classId, createdClass, createdSection, skipped: !createdClass && !createdSection };
}

async function getSchoolMediumsForSchool(schoolId) {
    try {
        const [schoolMediumRows] = await db.query(
            `SELECT m.name
            FROM school_mediums sm
            JOIN mediums m ON sm.medium_id = m.id
            WHERE sm.school_id = ?
            ORDER BY sm.id ASC`,
            [schoolId]
        );

        const schoolMediums = uniqueMediums(schoolMediumRows.map(row => row.name));
        if (schoolMediums.length > 0) return schoolMediums;
    } catch (err) {
        console.warn('getSchoolMediumsForSchool join lookup skipped:', err.message);
    };

    try {
        const [schoolMediumRows] = await db.query(
            `SELECT medium_name AS name
            FROM school_mediums
            WHERE school_id = ?
            ORDER BY is_primary DESC, id ASC`,
            [schoolId]
        );

        const schoolMediums = uniqueMediums(schoolMediumRows.map(row => row.name));
        if (schoolMediums.length > 0) return schoolMediums;
    } catch (err) {
        console.warn('getSchoolMediumsForSchool direct lookup skipped:', err.message);
    };

    const [[school]] = await db.query(
        'SELECT medium FROM schools WHERE id = ? LIMIT 1',
        [schoolId]
    );
    const schoolMediums = parseSchoolMediumText(school?.medium);
    return schoolMediums.length ? schoolMediums : ['English'];
};

async function getClassQuotaState(req, schoolId) {
    const subscriptionState = req.subscriptionState || await getSubscriptionState(schoolId);
    if (subscriptionState.isFullDemoAccess) {
        return { limited: false, limit: null, current: 0, remaining: Number.POSITIVE_INFINITY };
    };

    const planData = subscriptionState.currentPlan;
    if (!planData || isUnlimitedLimit(planData.max_classes)) {
        return { limited: false, limit: null, current: 0, remaining: Number.POSITIVE_INFINITY };
    };

    const limit = Number(planData.max_classes);
    const [[usage]] = await db.query(
        'SELECT COUNT(*) AS count FROM classes WHERE school_id = ?',
        [schoolId]
    );
    const current = Number(usage?.count || 0);

    return {
        limited: true,
        limit,
        current,
        remaining: Math.max(limit - current, 0)
    };
};

exports.listClasses = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);

        const [rawClasses] = await db.query(
            `SELECT c.id, c.school_id, c.class_name AS name, c.class_name, c.section, c.stream, c.medium, c.academic_year,
                COUNT(s.id) AS student_count
            FROM classes c
            LEFT JOIN sections sec
                ON sec.school_id = c.school_id
                AND sec.class_id = c.id
                AND sec.section_name = c.section
            LEFT JOIN students s ON s.class_id = c.id AND s.school_id = c.school_id AND s.deleted_at IS NULL
            WHERE c.school_id = ? AND COALESCE(sec.status, 'active') = 'active'
            GROUP BY c.id
            ORDER BY ${classOrderSql('c')}, c.section ASC, c.medium ASC, c.stream ASC`,
            [schoolId]
        );

        const classGroups = new Map();
        rawClasses.forEach((row) => {
            const canonical = normalizeCanonicalClassInput(row.class_name, row.stream);
            const medium = normalizeMediumName(row.medium);
            const key = getClassCanonicalKey({
                ...row,
                class_name: canonical.className,
                medium,
                stream: canonical.stream
            });
            if (!classGroups.has(key)) {
                classGroups.set(key, {
                    canonical,
                    medium,
                    academic_year: row.academic_year,
                    sections: new Map()
                });
            };
            const group = classGroups.get(key);
            const section = String(row.section || 'A').trim().toUpperCase();
            const existing = group.sections.get(section);
            if (!existing) {
                group.sections.set(section, {
                    ...row,
                    name: canonical.className,
                    class_name: canonical.className,
                    medium,
                    stream: canonical.stream,
                    student_count: Number(row.student_count || 0),
                    duplicate_ids: []
                });
            } else {
                existing.student_count += Number(row.student_count || 0);
                existing.duplicate_ids.push(row.id);
            };
        });
        const classes = sortClasses(
            Array.from(classGroups.values()).flatMap(group =>
                Array.from(group.sections.values()).map(cls => ({
                    ...cls,
                    label: formatClassLabel(cls)
                }))
            )
        );

        const [[school]] = await db.query(
            'SELECT school_type, medium, gender_type FROM schools WHERE id = ? LIMIT 1',
            [schoolId]
        );
        
        const schoolMediums = await getSchoolMediumsForSchool(schoolId);
        res.render('schoolAdmin/classes/index', {
            title: 'Classes & Sections',
            classes,
            school: school || {},
            schoolMediums,
            primaryMedium: schoolMediums[0] || 'English'
        });
    } catch (err) {
        console.error('listClasses Error:', err);
        req.flash('error', 'Failed to load classes');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.getSectionStudents = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { classId } = req.params;
        const [[cls]] = await db.query(
            'SELECT id, class_name AS name, class_name, section, stream, medium FROM classes WHERE id = ? AND school_id = ?',
            [classId, schoolId]
        );

        if (!cls) {
            return res.status(404).json({ success: false, message: 'Section not found' });
        }

        const [students] = await db.query(
            `SELECT s.id, s.admission_no, s.roll_no, s.gender, s.status,
                u.first_name AS first_name, u.last_name AS last_name, u.image
            FROM students s
            JOIN users u ON s.user_id = u.id
            WHERE s.class_id = ? AND s.school_id = ? AND s.deleted_at IS NULL
            ORDER BY s.roll_no ASC, u.first_name ASC`,
            [classId, schoolId]
        );

        return res.json({
            success: true,
            section: cls,
            students,
            count: students.length
        });
    } catch (err) {
        console.error('getSectionStudents Error:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    };
};

exports.addClass = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { medium } = req.body;
        const canonicalInput = normalizeCanonicalClassInput(req.body.class_name || req.body.name, req.body.stream);
        const class_name = canonicalInput.className;
        if (!class_name) {
            req.flash('error', 'Class name is required');
            return res.redirect('/schooladmin/classes');
        };

        const schoolMediums = await getSchoolMediumsForSchool(schoolId);
        const selectedMedium = filterAllowedMediums([medium], schoolMediums)[0] || schoolMediums[0] || 'English';

        let sectionsArray = normalizeSectionList(req.body.sections);
        if (sectionsArray.length === 0) {
            sectionsArray = ['A'];
        };

        const selectedStream = canonicalInput.stream;
        if (HIGHER_SEC.includes(class_name) && !selectedStream) {
            req.flash('error', 'Please select a valid stream for Class 11 or 12');
            return res.redirect('/schooladmin/classes');
        };

        const duplicateRows = await findCanonicalClassRows(db, schoolId, {
            class_name,
            medium: selectedMedium,
            stream: selectedStream,
            academic_year: null
        });

        if (duplicateRows.length > 0) {
            req.flash('error', 'This class already exists for this medium and stream.');
            return res.redirect('/schooladmin/classes');
        };

        for (const sec of sectionsArray) {
            const [insertResult] = await db.query(
                'INSERT INTO classes (school_id, class_name, section, stream, medium) VALUES (?, ?, ?, ?, ?)',
                [schoolId, class_name, sec, selectedStream, selectedMedium]
            );

            await ensureSectionRecord(db, {
                schoolId,
                classId: insertResult.insertId,
                sectionName: sec,
                capacity: 40,
                userId: req.user?.id || req.session?.user?.id || null
            });
        };

        req.flash('success', 'Class and sections added successfully');
        res.redirect('/schooladmin/classes');
    } catch (err) {
        console.error('addClass Error:', err);
        req.flash('error', 'Failed to add class');
        res.redirect('/schooladmin/classes');
    };
};

exports.editClassForm = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;
        const [[cls]] = await db.query(
            'SELECT id, school_id, class_name, section, medium, stream, academic_year FROM classes WHERE id = ? AND school_id = ? LIMIT 1',
            [id, schoolId]
        );

        if (!cls) {
            req.flash('error', 'Class section not found');
            return res.redirect('/schooladmin/classes');
        };

        const schoolMediums = await getSchoolMediumsForSchool(schoolId);
        const groupRows = await findCanonicalClassRows(db, schoolId, { ...cls, strictAcademicYear: true });
        const sectionList = [...new Set(groupRows.map(row => row.section).filter(Boolean))] .sort() .join(', ');
        const canonical = normalizeCanonicalClassInput(cls.class_name, cls.stream);
        res.render('schoolAdmin/classes/edit', {
            title: 'Edit Class Section',
            cls: {
                ...cls,
                class_name: canonical.className,
                stream: canonical.stream,
                sections: sectionList || cls.section || 'A',
                label: formatClassLabel(cls)
            },
            schoolMediums,
            validSections: VALID_SECTIONS,
            validStreams: VALID_STREAMS.filter(stream => stream !== 'General'),
            currentPath: '/schooladmin/classes'
        });
    } catch (err) {
        console.error('editClassForm Error:', err);
        req.flash('error', 'Failed to load class edit form');
        res.redirect('/schooladmin/classes');
    };
};

exports.editClass = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;
        const canonicalInput = normalizeCanonicalClassInput(req.body.class_name || req.body.name, req.body.stream);
        const className = canonicalInput.className;
        const sections = normalizeSectionList(req.body.sections || req.body.section);
        const medium = normalizeMediumName(req.body.medium);
        const stream = canonicalInput.stream;

        if (!className || sections.length === 0 || !medium) {
            req.flash('error', 'Class name, sections, and medium are required');
            return res.redirect(`/schooladmin/classes/${id}/edit`);
        };
        if (HIGHER_SEC.includes(className) && !stream) {
            req.flash('error', 'Please select a valid stream for Class 11 or 12');
            return res.redirect(`/schooladmin/classes/${id}/edit`);
        };

        const [[currentClass]] = await db.query(
            'SELECT id, school_id, class_name, section, medium, stream, academic_year FROM classes WHERE id = ? AND school_id = ? LIMIT 1',
            [id, schoolId]
        );

        if (!currentClass) {
            req.flash('error', 'Class not found');
            return res.redirect('/schooladmin/classes');
        };

        const currentRows = await findCanonicalClassRows(db, schoolId, { ...currentClass, strictAcademicYear: true });
        const currentIds = currentRows.map(row => row.id);
        const duplicateRows = await findCanonicalClassRows(db, schoolId, {
            class_name: className,
            medium,
            stream,
            academic_year: currentClass.academic_year
        }, currentIds);
        if (duplicateRows.length > 0) {
            req.flash('error', 'This class already exists for this medium and stream.');
            return res.redirect(`/schooladmin/classes/${id}/edit`);
        };

        const userId = req.user?.id || req.session?.user?.id || null;
        const requestedSections = [...new Set(sections)];
        await db.withTransaction(async ({ connection }) => {
            const rowsBySection = new Map();
            currentRows.forEach(row => {
                const sectionName = String(row.section || '').trim().toUpperCase();
                if (!rowsBySection.has(sectionName)) rowsBySection.set(sectionName, []);
                rowsBySection.get(sectionName).push(row);
            });

            for (const sectionName of requestedSections) {
                const matchingRows = rowsBySection.get(sectionName) || [];
                let targetRow = matchingRows[0];
                if (targetRow) {
                    await connection.query(
                        `UPDATE classes
                        SET class_name = ?, section = ?, medium = ?, stream = ?
                        WHERE id = ? AND school_id = ?`,
                        [className, sectionName, medium, stream, targetRow.id, schoolId]
                    );
                } else {
                    const [insertResult] = await connection.query(
                        `INSERT INTO classes (school_id, class_name, section, stream, medium, academic_year)
                        VALUES (?, ?, ?, ?, ?, ?)`,
                        [schoolId, className, sectionName, stream, medium, currentClass.academic_year]
                    );
                    targetRow = { id: insertResult.insertId };
                };

                await ensureSectionRecord(connection, {
                    schoolId,
                    classId: targetRow.id,
                    sectionName,
                    capacity: 40,
                    userId
                });

                for (const duplicateRow of matchingRows.slice(1)) {
                    await connection.query(
                        `UPDATE students SET class_id = ? WHERE class_id = ? AND school_id = ?`,
                        [targetRow.id, duplicateRow.id, schoolId]
                    );
                    await connection.query('DELETE FROM sections WHERE school_id = ? AND class_id = ?', [schoolId, duplicateRow.id]);
                    await connection.query('DELETE FROM classes WHERE id = ? AND school_id = ?', [duplicateRow.id, schoolId]);
                };
            };

            for (const row of currentRows) {
                const sectionName = String(row.section || '').trim().toUpperCase();
                if (requestedSections.includes(sectionName)) continue;

                const [[studentCount]] = await connection.query(
                    'SELECT COUNT(*) AS count FROM students WHERE class_id = ? AND school_id = ? AND deleted_at IS NULL',
                    [row.id, schoolId]
                );

                if (Number(studentCount.count || 0) > 0) {
                    await connection.query(
                        `INSERT INTO sections (school_id, class_id, section_name, capacity, status, updated_by)
                        VALUES (?, ?, ?, 40, 'inactive', ?)
                        ON DUPLICATE KEY UPDATE status = 'inactive', updated_by = VALUES(updated_by), updated_at = NOW()`,
                        [schoolId, row.id, sectionName, userId]
                    );
                    await connection.query(
                        `UPDATE classes SET class_name = ?, medium = ?, stream = ? WHERE id = ? AND school_id = ?`,
                        [className, medium, stream, row.id, schoolId]
                    );
                } else {
                    await connection.query('DELETE FROM sections WHERE school_id = ? AND class_id = ?', [schoolId, row.id]);
                    await connection.query('DELETE FROM classes WHERE id = ? AND school_id = ?', [row.id, schoolId]);
                };
            };
        });

        req.flash('success', 'Class and sections updated successfully');
        res.redirect('/schooladmin/classes');
    } catch (err) {
        console.error('editClass Error:', err);
        req.flash('error', 'Failed to update class');
        res.redirect('/schooladmin/classes');
    };
};

exports.deleteClass = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;
        const [[currentClass]] = await db.query(
            'SELECT id, class_name, section, medium, stream FROM classes WHERE id = ? AND school_id = ? LIMIT 1',
            [id, schoolId]
        );

        if (!currentClass) {
            req.flash('error', 'Class not found');
            return res.redirect('/schooladmin/classes');
        };

        const [[studentCount]] = await db.query(
            `SELECT COUNT(*) as count
            FROM students
            WHERE class_id = ? AND school_id = ? AND deleted_at IS NULL AND status = 'active'`,
            [id, schoolId]
        );

        if (Number(studentCount.count) > 0) {
            req.flash('error', `Cannot delete ${formatClassLabel(currentClass)} because active students are assigned to it.`);
            return res.redirect('/schooladmin/classes');
        };

        await db.query('DELETE FROM classes WHERE id = ? AND school_id = ?', [id, schoolId]);
        await logSchoolActivity(req, {
            action: 'delete_class',
            entityType: 'class',
            entityId: id,
            oldValues: currentClass,
            description: `${formatClassLabel(currentClass)} deleted`
        });
        
        req.flash('success', `${formatClassLabel(currentClass)} deleted successfully`);
        res.redirect('/schooladmin/classes');
    } catch (err) {
        console.error('deleteClass Error:', err);
        req.flash('error', 'Failed to delete class');
        res.redirect('/schooladmin/classes');
    };
};

exports.deleteAllClasses = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const [[classCount]] = await db.query(
            'SELECT COUNT(*) as count FROM classes WHERE school_id = ?',
            [schoolId]
        );

        if (Number(classCount.count) === 0) {
            req.flash('error', 'No classes found to delete.');
            return res.redirect('/schooladmin/classes');
        };

        const [[studentCount]] = await db.query(
            `SELECT COUNT(*) as count
            FROM students s
            JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
            WHERE c.school_id = ? AND s.deleted_at IS NULL AND s.status = 'active'`,
            [schoolId]
        );

        if (Number(studentCount.count) > 0) {
            req.flash('error', `Cannot delete all classes because ${studentCount.count} active student(s) are assigned to them.`);
            return res.redirect('/schooladmin/classes');
        };

        const [result] = await db.query('DELETE FROM classes WHERE school_id = ?', [schoolId]);
        await logSchoolActivity(req, {
            action: 'delete_all_classes',
            entityType: 'class',
            entityId: null,
            oldValues: { classCount: Number(classCount.count) },
            description: `${result.affectedRows || 0} class section(s) deleted`
        });

        req.flash('success', `${result.affectedRows || 0} class section(s) deleted successfully`);
        res.redirect('/schooladmin/classes');
    } catch (err) {
        console.error('deleteAllClasses Error:', err);
        req.flash('error', 'Failed to delete all classes');
        res.redirect('/schooladmin/classes');
    };
};

exports.getSectionsByClass = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const classId = Number.parseInt(req.params.classId, 10);
        const baseClass = await getClassScope(db, schoolId, classId);
        if (!baseClass) {
            return res.status(404).json({ success: false, message: 'Class not found' });
        };

        const allMode = req.query.all === 'true';
        const statusFilter = allMode ? '' : `AND COALESCE(sec.status, 'active') = 'active'`;
        const canonicalRows = await findCanonicalClassRows(db, schoolId, { ...baseClass, strictAcademicYear: true });
        const classIds = canonicalRows.map(row => row.id);
        if (classIds.length === 0) {
            return res.json({ success: true, sections: [], baseClass });
        };

        const [sections] = await db.query(
            `SELECT c.id, c.section AS name, COALESCE(sec.capacity, c.max_students, 40) AS capacity,
                COALESCE(sec.status, 'active') AS status,
                (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.school_id = c.school_id AND s.deleted_at IS NULL) AS student_count
            FROM classes c
            LEFT JOIN sections sec
                ON sec.school_id = c.school_id
                AND sec.class_id = c.id
                AND sec.section_name = c.section
            WHERE c.school_id = ?
                AND c.id IN (?)
                ${statusFilter}
            ORDER BY c.section ASC`,
            [schoolId, classIds]
        );

        return res.json({ success: true, sections, baseClass });
    } catch (err) {
        console.error('getSectionsByClass Error:', err);
        return res.status(500).json({ success: false, message: 'Failed to load sections' });
    };
};

exports.showAutoGenerateForm = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const schoolClassConfig = await getAllowedClassesForSchool(schoolId);
        const schoolMediums = await getSchoolMediumsForSchool(schoolId);
        const schoolType = schoolClassConfig.schoolType || 'kg_to_12';
        const suggestedClasses = schoolClassConfig.allowedClasses;

        res.render('schoolAdmin/classes/autoGenerate', {
            title: 'Auto Generate Classes',
            schoolType,
            schoolTypes: schoolClassConfig.schoolTypes,
            displayTypes: schoolClassConfig.displayTypes,
            suggestedClasses,
            schoolMediums,
            primaryMedium: schoolMediums[0] || 'English',
            classRanges: CLASS_RANGES,
            validSections: VALID_SECTIONS,
            defaultSections: ['A', 'B', 'C'],
            currentPath: req.path,
            user: req.user,
        });
    } catch (err) {
        console.error('showAutoGenerateForm Error:', err);
        req.flash('error', 'Failed to load auto-generate form');
        res.redirect('/schooladmin/classes');
    };
};

exports.autoGenerateClasses = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        let { class_range, streams, stream, custom_classes, mediums } = req.body;
        const schoolClassConfig = await getAllowedClassesForSchool(schoolId);
        const allowedClasses = schoolClassConfig.allowedClasses;
        const schoolMediums = await getSchoolMediumsForSchool(schoolId);
        const sections = ['A'];

        if (!mediums) mediums = [];
        if (!Array.isArray(mediums)) mediums = [mediums];
        mediums = filterAllowedMediums(mediums, schoolMediums);
        if (mediums.length === 0) mediums = schoolMediums.length ? schoolMediums : ['English'];

        if (mediums.length === 0) {
            req.flash('error', 'Please configure at least one school medium first.');
            return res.redirect('/schooladmin/classes');
        };

        let classList = [];

        if (class_range === 'custom') {
            if (!custom_classes || !custom_classes.trim()) {
                req.flash('error', 'Please enter class names for the custom range.');
                return res.redirect('/schooladmin/classes');
            };
            classList = custom_classes
                .split(/[\n,]+/)
                .map(c => c.trim())
                .filter(Boolean);
        } else if (class_range === 'school_type_default') {
            classList = allowedClasses;
        } else {
            classList = CLASS_RANGES[class_range] || [];
        };

        const requestedCount = uniqueClasses(classList).length;
        classList = filterAllowedClasses(classList, allowedClasses);
        if (classList.length === 0) {
            req.flash('error', 'No allowed classes found for your school type. Please use classes mapped to your school type only.');
            return res.redirect('/schooladmin/classes');
        };

        let selectedStreams = normalizeStreams(streams);
        if (selectedStreams.length === 0 && VALID_STREAMS.includes(stream) && stream !== 'General') {
            selectedStreams = [stream];
        };
        if (selectedStreams.length === 0) selectedStreams = [];

        const summary = {
            created_classes: 0,
            skipped_classes: 0,
            created_sections: 0,
            skipped_sections: 0,
            quota_skipped_classes: 0
        };

        const classQuota = await getClassQuotaState(req, schoolId);
        if (classQuota.limited && classQuota.remaining <= 0) {
            req.flash('error', `Your current plan allows ${classQuota.limit} classes. You already have ${classQuota.current} classes. Please upgrade your plan to add more classes.`);
            return res.redirect('/schooladmin/classes');
        };

        const canCreateMoreClasses = () => !classQuota.limited || summary.created_classes < classQuota.remaining;

        for (const rawClassName of classList) {
            const baseCanonical = normalizeCanonicalClassInput(rawClassName, null);
            const className = baseCanonical.className;
            const classStreams = HIGHER_SEC.includes(className) ? (baseCanonical.stream ? [baseCanonical.stream] : selectedStreams) : [null];

            if (HIGHER_SEC.includes(className) && classStreams.length === 0) {
                summary.skipped_classes += sections.length * mediums.length;
                summary.skipped_sections += sections.length * mediums.length;
                continue;
            };

            for (const section of sections) {
                for (const medium of mediums) {
                    for (const classStream of classStreams) {
                        const existingRows = await findCanonicalClassRows(db, schoolId, {
                            class_name: className,
                            medium,
                            stream: classStream,
                            academic_year: null
                        });
                        if (existingRows.length > 0) {
                            summary.skipped_classes++;
                            const baseClass = pickCanonicalBaseClass(existingRows);
                            const result = await ensureClassSection(db, {
                                schoolId,
                                baseClass: {
                                    ...baseClass,
                                    class_name: className,
                                    medium,
                                    stream: classStream
                                },
                                sectionName: section,
                                capacity: 40,
                                userId: req.user?.id || req.session?.user?.id || null
                            });
                            if (result.createdClass) summary.created_classes++;
                            if (result.createdSection) summary.created_sections++;
                            else summary.skipped_sections++;
                        } else {
                            if (!canCreateMoreClasses()) {
                                summary.quota_skipped_classes++;
                                summary.skipped_classes++;
                                summary.skipped_sections++;
                                continue;
                            };

                            const [insertResult] = await db.query(
                                'INSERT INTO classes (school_id, class_name, section, stream, medium) VALUES (?, ?, ?, ?, ?)',
                                [schoolId, className, section, classStream, medium]
                            );
                            summary.created_classes++;
                            const createdSection = await ensureSectionRecord(db, {
                                schoolId,
                                classId: insertResult.insertId,
                                sectionName: section,
                                capacity: 40,
                                userId: req.user?.id || req.session?.user?.id || null
                            });
                            if (createdSection) summary.created_sections++;
                            else summary.skipped_sections++;
                        };
                    };
                };
            };
        };

        const blocked = Math.max(requestedCount - classList.length, 0);
        const message = `Classes created: ${summary.created_classes}, skipped: ${summary.skipped_classes}. Sections created: ${summary.created_sections}, skipped: ${summary.skipped_sections}.`;
        req.flash('success', blocked > 0 ? `${message} ${blocked} classes were ignored because they are not allowed for this school type.` : message);
        res.redirect('/schooladmin/classes');
    } catch (err) {
        console.error('autoGenerateClasses Error:', err);
        req.flash('error', 'Failed to generate classes. Please try again.');
        res.redirect('/schooladmin/classes');
    };
};
