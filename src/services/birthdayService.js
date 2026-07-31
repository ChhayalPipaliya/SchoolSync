const db = require('../config/database');
const NotificationService = require('./notificationService');

const hasColumnCache = new Map();
async function checkColumn(tableName, colName) {
    const key = `${tableName}:${colName}`;
    if (hasColumnCache.has(key)) return hasColumnCache.get(key);
    try {
        const [cols] = await db.query(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [colName]);
        const exists = cols && cols.length > 0;
        hasColumnCache.set(key, exists);
        return exists;
    } catch (_) {
        hasColumnCache.set(key, false);
        return false;
    };
};

async function getTodaysBirthdays(schoolId) {
    if (!schoolId) return { students: [], teachers: [], librarians: [], drivers: [] };
    try {
        const [hasStudentDob, hasStudentDateOfBirth] = await Promise.all([
            checkColumn('students', 'dob'),
            checkColumn('students', 'date_of_birth')
        ]);
        const studentDobCol = hasStudentDob ? 's.dob' : (hasStudentDateOfBirth ? 's.date_of_birth' : null);

        const [hasTeacherDob, hasTeacherDateOfBirth] = await Promise.all([
            checkColumn('teachers', 'dob'),
            checkColumn('teachers', 'date_of_birth')
        ]);
        const teacherDobCol = hasTeacherDob ? 't.dob' : (hasTeacherDateOfBirth ? 't.date_of_birth' : null);

        const [hasDriverDob, hasDriverDateOfBirth] = await Promise.all([
            checkColumn('drivers', 'dob'),
            checkColumn('drivers', 'date_of_birth')
        ]);
        const driverDobCol = hasDriverDob ? 'd.dob' : (hasDriverDateOfBirth ? 'd.date_of_birth' : null);

        const [hasLibrarianDob, hasLibrarianDateOfBirth] = await Promise.all([
            checkColumn('librarians', 'dob'),
            checkColumn('librarians', 'date_of_birth')
        ]);
        const librarianDobCol = hasLibrarianDob ? 'l.dob' : (hasLibrarianDateOfBirth ? 'l.date_of_birth' : null);

        const studentPromise = studentDobCol ? db.query(
            `SELECT s.id, 
                u.first_name, u.last_name, 'student' AS role,
                TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS name,
                c.class_name AS className, c.section
            FROM students s
            JOIN users u ON u.id = s.user_id AND u.school_id = s.school_id
            LEFT JOIN classes c ON c.id = s.class_id
            WHERE s.school_id = ? AND s.deleted_at IS NULL AND u.deleted_at IS NULL
                AND ${studentDobCol} IS NOT NULL 
                AND MONTH(${studentDobCol}) = MONTH(CURDATE()) 
                AND DAY(${studentDobCol}) = DAY(CURDATE())
            ORDER BY u.first_name ASC`,
            [schoolId]
        ).then(([rows]) => rows).catch(() => []) : Promise.resolve([]);

        const teacherPromise = teacherDobCol ? db.query(
            `SELECT t.id, 
                u.first_name, u.last_name, 'teacher' AS role,
                TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS name
            FROM teachers t
            JOIN users u ON u.id = t.user_id AND u.school_id = t.school_id
            WHERE t.school_id = ? AND t.deleted_at IS NULL AND u.deleted_at IS NULL
                AND ${teacherDobCol} IS NOT NULL 
                AND MONTH(${teacherDobCol}) = MONTH(CURDATE()) 
                AND DAY(${teacherDobCol}) = DAY(CURDATE())
            ORDER BY u.first_name ASC`,
            [schoolId]
        ).then(([rows]) => rows).catch(() => []) : Promise.resolve([]);

        const driverPromise = driverDobCol ? db.query(
            `SELECT d.id, 
                COALESCE(d.first_name, u.first_name, '') AS first_name,
                COALESCE(d.last_name, u.last_name, '') AS last_name,
                'driver' AS role,
                TRIM(CONCAT(COALESCE(d.first_name, u.first_name, ''), ' ', COALESCE(d.last_name, u.last_name, ''))) AS name
            FROM drivers d
            LEFT JOIN users u ON u.id = d.user_id AND u.school_id = d.school_id
            WHERE d.school_id = ? AND d.deleted_at IS NULL
                AND ${driverDobCol} IS NOT NULL 
                AND MONTH(${driverDobCol}) = MONTH(CURDATE()) 
                AND DAY(${driverDobCol}) = DAY(CURDATE())
            ORDER BY COALESCE(d.first_name, u.first_name) ASC`,
            [schoolId]
        ).then(([rows]) => rows).catch(() => []) : Promise.resolve([]);

        const librarianPromise = librarianDobCol ? db.query(
            `SELECT l.id, 
                u.first_name, u.last_name, 'librarian' AS role,
                TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS name
            FROM librarians l
            JOIN users u ON u.id = l.user_id AND u.school_id = l.school_id
            WHERE l.school_id = ? AND u.deleted_at IS NULL
                AND ${librarianDobCol} IS NOT NULL 
                AND MONTH(${librarianDobCol}) = MONTH(CURDATE()) 
                AND DAY(${librarianDobCol}) = DAY(CURDATE())
            ORDER BY u.first_name ASC`,
            [schoolId]
        ).then(([rows]) => rows).catch(() => []) : Promise.resolve([]);

        const [students, teachers, drivers, librarians] = await Promise.all([
            studentPromise,
            teacherPromise,
            driverPromise,
            librarianPromise
        ]);
        return { students, teachers, drivers, librarians };
    } catch (err) {
        console.error('[BirthdayService getTodaysBirthdays Error]', err);
        return { students: [], teachers: [], librarians: [], drivers: [] };
    };
};

async function checkAndNotifyUserBirthday(user) {
    if (!user || !user.id) return null;
    const userId = Number(user.id);
    const role = user.role || '';
    const schoolId = user.school_id || null;

    try {
        let dob = null;
        let fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.name || 'User';
        let schoolName = 'SchoolSync';
        let isTodayBirthday = false;

        if (schoolId) {
            const [[sch]] = await db.query('SELECT school_name FROM schools WHERE id = ? LIMIT 1', [schoolId]).catch(() => [[null]]);
            if (sch && sch.school_name) schoolName = sch.school_name;
        };

        let tableName = 'users';
        let idCol = 'id';
        if (role === 'student') { tableName = 'students'; idCol = 'user_id'; }
        else if (role === 'teacher') { tableName = 'teachers'; idCol = 'user_id'; }
        else if (role === 'driver') { tableName = 'drivers'; idCol = 'user_id'; }
        else if (role === 'librarian') { tableName = 'librarians'; idCol = 'user_id'; };

        let dobCol = (await checkColumn(tableName, 'dob')) ? 'dob' : ((await checkColumn(tableName, 'date_of_birth')) ? 'date_of_birth' : null);
        if (!dobCol && tableName !== 'users') {
            tableName = 'users';
            idCol = 'id';
            dobCol = (await checkColumn('users', 'dob')) ? 'dob' : ((await checkColumn('users', 'date_of_birth')) ? 'date_of_birth' : null);
        };

        if (dobCol) {
            const [[matchRow]] = await db.query(
                `SELECT ${dobCol} AS dob, (MONTH(${dobCol}) = MONTH(CURDATE()) AND DAY(${dobCol}) = DAY(CURDATE())) AS is_today
                FROM ${tableName}
                WHERE ${idCol} = ? AND ${dobCol} IS NOT NULL LIMIT 1`,
                [userId]
            ).catch(() => [[null]]);

            if (matchRow) {
                dob = matchRow.dob;
                if (matchRow.is_today === 1 || matchRow.is_today === true || Number(matchRow.is_today) === 1) {
                    isTodayBirthday = true;
                };
            };
        };

        if (!isTodayBirthday && dob) {
            const dobDate = new Date(dob);
            const now = new Date();
            if (!isNaN(dobDate.getTime())) {
                isTodayBirthday = (dobDate.getUTCMonth() === now.getUTCMonth() && dobDate.getUTCDate() === now.getUTCDate()) || (dobDate.getMonth() === now.getMonth() && dobDate.getDate() === now.getDate());
            };
        };

        if (!isTodayBirthday) return null;
        try {
            if (NotificationService && typeof NotificationService.createAndSend === 'function') {
                await NotificationService.createAndSend({
                    recipient_id: userId,
                    recipient_role: role,
                    school_id: schoolId,
                    title: "Happy Birthday 🎉",
                    message: "Wishing you a wonderful birthday. Have a fantastic year ahead.",
                    category: "system"
                });
            };
        } catch (nErr) {
            console.warn('[BirthdayService Notification Error]', nErr.message);
        };
        return { name: fullName, schoolName };
    } catch (err) {
        console.error('[BirthdayService checkAndNotifyUserBirthday Error]', err);
        return null;
    };
};

module.exports = { getTodaysBirthdays, checkAndNotifyUserBirthday};