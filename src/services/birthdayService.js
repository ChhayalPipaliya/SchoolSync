const cron = require('node-cron');
const db = require('../config/database');
const NotificationService = require('./notificationService');
const { ensureBirthdayNotificationSchema } = require('../config/schemaMigrations');

const hasColumnCache = new Map();
async function checkColumn(tableName, colName) {
    const key = `${tableName}:${colName}`;
    if (hasColumnCache.has(key)) return hasColumnCache.get(key);
    try {
        const [cols] = await db.query(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [colName]);
        const exists = Boolean(cols && cols.length > 0);
        hasColumnCache.set(key, exists);
        return exists;
    } catch (_) {
        hasColumnCache.set(key, false);
        return false;
    };
};

function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
};

function formatDateISO(date) {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

function parseDateComponents(dateInput) {
    const d = dateInput ? new Date(dateInput) : new Date();
    if (isNaN(d.getTime())) {
        const fallback = new Date();
        return {
            date: fallback,
            year: fallback.getFullYear(),
            month: fallback.getMonth() + 1,
            day: fallback.getDate(),
            dateStr: formatDateISO(fallback)
        };
    };
    return {
        date: d,
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        day: d.getDate(),
        dateStr: formatDateISO(d)
    };
};

function buildBirthdaySqlCondition(columnName, targetDateObj) {
    const { year, month, day } = parseDateComponents(targetDateObj);
    const targetIsLeap = isLeapYear(year);

    if (month === 2 && day === 28 && !targetIsLeap) {
        return {
            sql: `(${columnName} IS NOT NULL AND MONTH(${columnName}) = 2 AND DAY(${columnName}) IN (28, 29))`,
            params: []
        };
    };

    return {
        sql: `(${columnName} IS NOT NULL AND MONTH(${columnName}) = ? AND DAY(${columnName}) = ?)`,
        params: [month, day]
    };
};

function isDateBirthdayMatch(dobInput, targetDateObj) {
    if (!dobInput) return false;
    const dob = new Date(dobInput);
    if (isNaN(dob.getTime())) return false;

    const { year: targetYear, month: targetMonth, day: targetDay, dateStr: targetDateStr } = parseDateComponents(targetDateObj);
    const dobDateStr = formatDateISO(dob);

    if (dobDateStr > targetDateStr) return false;
    const dobMonth = dob.getMonth() + 1;
    const dobDay = dob.getDate();
    const targetIsLeap = isLeapYear(targetYear);

    if (dobMonth === 2 && dobDay === 29) {
        if (targetIsLeap) {
            return targetMonth === 2 && targetDay === 29;
        } else {
            return targetMonth === 2 && targetDay === 28;
        };
    };
    return dobMonth === targetMonth && dobDay === targetDay;
};

async function getTodaysBirthdays(schoolId = null, targetDate = new Date()) {
    try {
        await ensureBirthdayNotificationSchema();

        const [hasStudentDob, hasTeacherDob, hasDriverDob, hasLibDob] = await Promise.all([
            checkColumn('students', 'dob'),
            checkColumn('teachers', 'dob'),
            checkColumn('drivers', 'dob'),
            checkColumn('librarians', 'dob')
        ]);

        const studentDobCol = hasStudentDob ? 's.dob' : 's.date_of_birth';
        const teacherDobCol = hasTeacherDob ? 't.dob' : 't.date_of_birth';
        const driverDobCol = hasDriverDob ? 'd.dob' : 'd.date_of_birth';
        const libDobCol = hasLibDob ? 'l.dob' : 'l.date_of_birth';

        const studentCond = buildBirthdaySqlCondition(studentDobCol, targetDate);
        const teacherCond = buildBirthdaySqlCondition(teacherDobCol, targetDate);
        const driverCond = buildBirthdaySqlCondition(driverDobCol, targetDate);
        const libCond = buildBirthdaySqlCondition(libDobCol, targetDate);

        const schoolFilter = schoolId ? 'AND s.school_id = ?' : '';
        const teacherSchoolFilter = schoolId ? 'AND t.school_id = ?' : '';
        const driverSchoolFilter = schoolId ? 'AND d.school_id = ?' : '';
        const libSchoolFilter = schoolId ? 'AND l.school_id = ?' : '';

        const studentParams = [...studentCond.params];
        if (schoolId) studentParams.push(schoolId);
        const studentPromise = db.query(
            `SELECT 
                s.id AS person_id,
                s.user_id,
                s.school_id,
                ${studentDobCol} AS dob,
                'student' AS role,
                u.first_name,
                u.last_name,
                u.email,
                u.phone,
                u.status AS user_status,
                TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS name,
                c.class_name AS className,
                c.section,
                COALESCE(sch.school_name, 'SchoolSync') AS school_name
            FROM students s
            JOIN users u ON u.id = s.user_id AND u.school_id = s.school_id
            JOIN schools sch ON sch.id = s.school_id
            LEFT JOIN classes c ON c.id = s.class_id
            WHERE s.deleted_at IS NULL 
                AND u.deleted_at IS NULL
                AND ${studentCond.sql}
                ${schoolFilter}
            ORDER BY u.first_name ASC`,
            studentParams
        ).then(([rows]) => rows).catch((err) => {
            console.error('[BirthdayService] Student query error:', err.message);
            return [];
        });

        const teacherParams = [...teacherCond.params];
        if (schoolId) teacherParams.push(schoolId);
        const teacherPromise = db.query(
            `SELECT 
                t.id AS person_id,
                t.user_id,
                t.school_id,
                ${teacherDobCol} AS dob,
                'teacher' AS role,
                u.first_name,
                u.last_name,
                u.email,
                u.phone,
                u.status AS user_status,
                TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS name,
                COALESCE(sch.school_name, 'SchoolSync') AS school_name
            FROM teachers t
            JOIN users u ON u.id = t.user_id AND u.school_id = t.school_id
            JOIN schools sch ON sch.id = t.school_id
            WHERE t.deleted_at IS NULL 
                AND u.deleted_at IS NULL
                AND ${teacherCond.sql}
                ${teacherSchoolFilter}
            ORDER BY u.first_name ASC`,
            teacherParams
        ).then(([rows]) => rows).catch((err) => {
            console.error('[BirthdayService] Teacher query error:', err.message);
            return [];
        });

        const driverParams = [...driverCond.params];
        if (schoolId) driverParams.push(schoolId);
        const driverPromise = db.query(
            `SELECT 
                d.id AS person_id,
                d.user_id,
                d.school_id,
                ${driverDobCol} AS dob,
                'driver' AS role,
                COALESCE(u.first_name, d.first_name, '') AS first_name,
                COALESCE(u.last_name, d.last_name, '') AS last_name,
                COALESCE(u.email, d.email) AS email,
                COALESCE(u.phone, d.phone) AS phone,
                u.status AS user_status,
                TRIM(CONCAT(COALESCE(u.first_name, d.first_name, ''), ' ', COALESCE(u.last_name, d.last_name, ''))) AS name,
                COALESCE(sch.school_name, 'SchoolSync') AS school_name
            FROM drivers d
            JOIN users u ON u.id = d.user_id AND u.school_id = d.school_id
            JOIN schools sch ON sch.id = d.school_id
            WHERE d.deleted_at IS NULL 
                AND u.deleted_at IS NULL
                AND d.user_id IS NOT NULL
                AND ${driverCond.sql}
                ${driverSchoolFilter}
            ORDER BY COALESCE(u.first_name, d.first_name) ASC`,
            driverParams
        ).then(([rows]) => rows).catch((err) => {
            console.error('[BirthdayService] Driver query error:', err.message);
            return [];
        });

        const libParams = [...libCond.params];
        if (schoolId) libParams.push(schoolId);
        const libPromise = db.query(
            `SELECT 
                l.id AS person_id,
                l.user_id,
                l.school_id,
                ${libDobCol} AS dob,
                'librarian' AS role,
                u.first_name,
                u.last_name,
                u.email,
                u.phone,
                u.status AS user_status,
                TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS name,
                COALESCE(sch.school_name, 'SchoolSync') AS school_name
            FROM librarians l
            JOIN users u ON u.id = l.user_id AND u.school_id = l.school_id
            JOIN schools sch ON sch.id = l.school_id
            WHERE u.deleted_at IS NULL
                AND l.user_id IS NOT NULL
                AND ${libCond.sql}
                ${libSchoolFilter}
            ORDER BY u.first_name ASC`,
            libParams
        ).then(([rows]) => rows).catch((err) => {
            console.error('[BirthdayService] Librarian query error:', err.message);
            return [];
        });

        const [students, teachers, drivers, librarians] = await Promise.all([
            studentPromise,
            teacherPromise,
            driverPromise,
            libPromise
        ]);

        return { students, teachers, drivers, librarians };
    } catch (err) {
        console.error('[BirthdayService getTodaysBirthdays Error]', err);
        return { students: [], teachers: [], librarians: [], drivers: [] };
    };
};

function buildPersonalBirthdayMessage(firstName, schoolName) {
    const cleanName = (firstName || '').trim();
    const greetingName = cleanName ? cleanName : 'there';
    const cleanSchool = (schoolName || 'SchoolSync').trim();

    return {
        title: '🎂 Happy Birthday!',
        message: `Happy Birthday, ${greetingName}! 🎉 Wishing you a wonderful day filled with happiness and success. — ${cleanSchool}`
    };
};

async function runDailyBirthdayJob(options = {}) {
    const targetDate = options.targetDate ? new Date(options.targetDate) : new Date();
    const { dateStr } = parseDateComponents(targetDate);
    const schoolId = options.schoolId || null;

    const startTime = Date.now();
    let totalFound = 0;
    let createdCount = 0;
    let duplicateCount = 0;
    let invalidCount = 0;
    const errors = [];
    const results = [];

    try {
        await ensureBirthdayNotificationSchema();

        const { students, teachers, drivers, librarians } = await getTodaysBirthdays(schoolId, targetDate);
        const candidates = [...students, ...teachers, ...drivers, ...librarians];
        totalFound = candidates.length;

        for (const person of candidates) {
            try {
                const recipientId = Number(person.user_id);
                if (!recipientId || recipientId <= 0) {
                    invalidCount++;
                    console.warn(`[BirthdayJob] Invalid or missing user_id for ${person.role}#${person.person_id}, skipping.`);
                    continue;
                };

                if (!person.dob || !isDateBirthdayMatch(person.dob, targetDate)) {
                    invalidCount++;
                    console.warn(`[BirthdayJob] Invalid or non-matching DOB for user #${recipientId}, skipping.`);
                    continue;
                };

                const idempotencyKey = `birthday:${person.school_id}:${recipientId}:${dateStr}`;
                const { title, message } = buildPersonalBirthdayMessage(person.first_name, person.school_name);
                const notifResult = await NotificationService.createAndSend({
                    recipient_id: recipientId,
                    recipient_role: person.role,
                    school_id: person.school_id,
                    title,
                    message,
                    type: 'birthday',
                    category: 'birthday',
                    reference_type: 'birthday',
                    reference_id: null,
                    idempotency_key: idempotencyKey,
                    action_url: null
                });

                if (notifResult) {
                    if (notifResult.duplicate) {
                        duplicateCount++;
                    } else {
                        createdCount++;
                    }
                    results.push({
                        userId: recipientId,
                        role: person.role,
                        schoolId: person.school_id,
                        name: person.name,
                        duplicate: Boolean(notifResult.duplicate),
                        notificationId: notifResult.id
                    });
                };
            } catch (pErr) {
                console.error(`[BirthdayJob] Error processing birthday for person ${person.role}#${person.person_id}:`, pErr.message);
                errors.push({ personId: person.person_id, role: person.role, error: pErr.message });
            };
        };

        const duration = Date.now() - startTime;
        console.log(
            `[BirthdayJob] Birthday job completed in ${duration}ms. ` +
            `Created: ${createdCount}, Skipped duplicates: ${duplicateCount}, Skipped invalid: ${invalidCount}`
        );

        return {
            success: true,
            date: dateStr,
            totalFound,
            created: createdCount,
            duplicatesSkipped: duplicateCount,
            invalidSkipped: invalidCount,
            results,
            errors
        };
    } catch (jobErr) {
        console.error('[BirthdayJob] Fatal error during birthday job execution:', jobErr);
        return {
            success: false,
            date: dateStr,
            totalFound,
            created: createdCount,
            duplicatesSkipped: duplicateCount,
            invalidSkipped: invalidCount,
            results,
            errors: [...errors, { error: jobErr.message }]
        };
    };
};

async function checkAndNotifyUserBirthday(user, targetDate = new Date()) {
    if (!user || !user.id) return null;
    const userId = Number(user.id);
    const role = user.role || '';
    const schoolId = user.school_id || null;

    try {
        await ensureBirthdayNotificationSchema();
        const { dateStr } = parseDateComponents(targetDate);

        let dob = null;
        let firstName = user.first_name || '';
        let lastName = user.last_name || '';
        let schoolName = 'SchoolSync';

        if (schoolId) {
            const [[sch]] = await db.query('SELECT school_name FROM schools WHERE id = ? LIMIT 1', [schoolId]).catch(() => [[null]]);
            if (sch && sch.school_name) schoolName = sch.school_name;
        };

        let tableName = 'users';
        let idCol = 'id';
        if (role === 'student') { tableName = 'students'; idCol = 'user_id'; }
        else if (role === 'teacher') { tableName = 'teachers'; idCol = 'user_id'; }
        else if (role === 'driver') { tableName = 'drivers'; idCol = 'user_id'; }
        else if (role === 'librarian') { tableName = 'librarians'; idCol = 'user_id'; }

        let dobCol = (await checkColumn(tableName, 'dob')) ? 'dob' : ((await checkColumn(tableName, 'date_of_birth')) ? 'date_of_birth' : null);
        if (dobCol) {
            const [[matchRow]] = await db.query(
                `SELECT ${dobCol} AS dob FROM ${tableName} WHERE ${idCol} = ? AND ${dobCol} IS NOT NULL LIMIT 1`,
                [userId]
            ).catch(() => [[null]]);
            if (matchRow) {
                dob = matchRow.dob;
            };
        };

        if (!dob) return null;
        if (!isDateBirthdayMatch(dob, targetDate)) return null;

        const fullName = `${firstName} ${lastName}`.trim() || user.name || 'User';
        const idempotencyKey = `birthday:${schoolId}:${userId}:${dateStr}`;
        const { title, message } = buildPersonalBirthdayMessage(firstName, schoolName);

        try {
            await NotificationService.createAndSend({
                recipient_id: userId,
                recipient_role: role,
                school_id: schoolId,
                title,
                message,
                type: 'birthday',
                category: 'birthday',
                reference_type: 'birthday',
                reference_id: null,
                idempotency_key: idempotencyKey,
                action_url: null
            });
        } catch (nErr) {
            console.warn('[BirthdayService Notification Error]', nErr.message);
        };
        return { name: fullName, schoolName };
    } catch (err) {
        console.error('[BirthdayService checkAndNotifyUserBirthday Error]', err);
        return null;
    };
};

function initBirthdayCron() {
    cron.schedule('0 6 * * *', () => {
        runDailyBirthdayJob().catch(err => {
            console.error('[BirthdayCron] Unhandled error during scheduled execution:', err);
        });
    });
};

module.exports = { isLeapYear, isDateBirthdayMatch, formatDateISO, parseDateComponents, buildPersonalBirthdayMessage, getTodaysBirthdays, runDailyBirthdayJob, checkAndNotifyUserBirthday, initBirthdayCron};