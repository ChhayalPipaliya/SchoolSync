const db = require('../../config/database');

function normalizeClassName(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    return raw
        .replace(/^standard\s+/, 'std ')
        .replace(/^class\s+/, 'std ')
        .replace(/^grade\s+/, 'std ')
        .replace(/\s+/g, ' ');
};

function getClassLookupKeys(value) {
    const normalized = normalizeClassName(value);
    const keys = new Set([normalized]);
    const match = normalized.match(/^(?:std\s*)?(\d+)$/);
    if (match) {
        keys.add(match[1]);
        keys.add(`std ${match[1]}`);
    };
    return [...keys].filter(Boolean);
};

function normalizeMedium(value) {
    return String(value || 'English').trim().toLowerCase();
};

function normalizeSection(value) {
    return String(value || '').trim().toLowerCase();
};

function buildClassCode(className, section, medium) {
    return `${normalizeClassName(className)}_${normalizeSection(section)}_${normalizeMedium(medium)}`;
};

function buildRollKey(classId, rollNo) {
    return `${Number(classId)}_${String(rollNo || '').trim().toLowerCase()}`;
};

function resolveClassId(cache, classValue, sectionValue, mediumValue = 'English') {
    if (classValue && cache.classIds.has(Number(classValue))) {
        return Number(classValue);
    };

    if (!classValue || !sectionValue) {
        return null;
    };

    for (const key of getClassLookupKeys(classValue)) {
        const classId = cache.classesByCode.get(buildClassCode(key, sectionValue, mediumValue));
        if (classId) return classId;
    };
    return null;
};

async function loadValidationCache(schoolId) {
    const cache = { schoolId, usersByEmail: new Map(), classesByCode: new Map(), classesById: new Map(), classIds: new Set(), rollNumbers: new Map(), exams: new Set(), subjects: new Set(), students: new Set(), categories: new Set(), racks: new Set()};

    const users = await db.queryAsync("SELECT id, email, role, school_id FROM users WHERE deleted_at IS NULL");
    users.forEach(u => {
        if (!u.email) return;
        const email = u.email.toLowerCase().trim();
        if (!cache.usersByEmail.has(email)) {
            cache.usersByEmail.set(email, []);
        };
        cache.usersByEmail.get(email).push(u);
    });

    const classes = await db.queryAsync("SELECT id, class_name, section, medium FROM classes WHERE school_id = ?", [schoolId]);
    classes.forEach(c => {
        cache.classIds.add(Number(c.id));
        cache.classesById.set(Number(c.id), c);
        for (const key of getClassLookupKeys(c.class_name)) {
            cache.classesByCode.set(buildClassCode(key, c.section, c.medium || 'English'), Number(c.id));
        };
    });

    const students = await db.queryAsync(
        `SELECT s.id, s.class_id, s.roll_no, u.email
        FROM students s
        JOIN users u ON s.user_id = u.id
        WHERE s.school_id = ? AND s.deleted_at IS NULL AND u.deleted_at IS NULL`,
        [schoolId]
    );
    students.forEach(s => {
        cache.students.add(Number(s.id));
        if (s.class_id && s.roll_no) {
            cache.rollNumbers.set(buildRollKey(s.class_id, s.roll_no), String(s.email || '').toLowerCase().trim());
        };
    });

    const exams = await db.queryAsync("SELECT id FROM exams WHERE school_id = ?", [schoolId]);
    exams.forEach(e => cache.exams.add(Number(e.id)));

    const subjects = await db.queryAsync("SELECT id FROM subjects WHERE school_id = ?", [schoolId]);
    subjects.forEach(s => cache.subjects.add(Number(s.id)));

    const categories = await db.queryAsync("SELECT id FROM library_categories WHERE school_id = ?", [schoolId]);
    categories.forEach(c => cache.categories.add(Number(c.id)));

    const racks = await db.queryAsync("SELECT id FROM library_racks WHERE school_id = ?", [schoolId]);
    racks.forEach(r => cache.racks.add(Number(r.id)));
    return cache;
};

const isValidDate = (dateStr) => {
    if (!dateStr) return false;
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateStr)) return false;
    const d = new Date(`${dateStr}T00:00:00Z`);
    return d instanceof Date && !isNaN(d) && d.toISOString().startsWith(dateStr);
};

const isValidEmail = (emailStr) => {
    if (!emailStr) return false;
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(emailStr);
};

function validateImportEmail(entityType, email, cache, fileContext, addError) {
    const normEmail = String(email || '').toLowerCase().trim();
    const expectedRole = entityType === 'students' ? 'student' : 'teacher';
    const existingUsers = cache.usersByEmail.get(normEmail) || [];
    const sameSchoolUser = existingUsers.find(user => Number(user.school_id) === Number(cache.schoolId));
    const otherSchoolUser = existingUsers.find(user => Number(user.school_id) !== Number(cache.schoolId));

    if (sameSchoolUser && sameSchoolUser.role !== expectedRole) {
        addError('email', `Email already exists in this school as ${sameSchoolUser.role}`, email);
        return false;
    };

    if (!sameSchoolUser && otherSchoolUser) {
        addError('email', 'Email already exists in another school', email);
        return false;
    };

    const fileRole = fileContext.emails.get(normEmail);
    if (fileRole) {
        addError('email', 'Email is duplicated in this import file', email);
        return false;
    };

    fileContext.emails.set(normEmail, expectedRole);
    return true;
};

function validateRow(entityType, row, rowIndex, cache, fileContext) {
    const errors = [];

    const addError = (field, message, value) => {
        errors.push({
            row_number: rowIndex,
            field,
            message,
            value: value !== undefined ? value : (row[field] || '')
        });
    };

    switch (entityType) {
        case 'students': {
            const name = row.name || '';
            const email = row.email || '';
            const rollNo = row.roll_no || '';
            const classValue = row.class_id || '';
            const sectionValue = row.section_id || row.section || row.section_name || '';
            const medium = row.medium || 'English';
            const dob = row.date_of_birth || row.dob || '';
            const gender = row.gender || '';
            const admissionDate = row.admission_date || '';

            if (!name.trim()) addError('name', 'Name is required');
            if (!email.trim()) {
                addError('email', 'Email is required');
            } else if (!isValidEmail(email)) {
                addError('email', 'Invalid email format', email);
            } else {
                validateImportEmail(entityType, email, cache, fileContext, addError);
            };

            const finalClassId = resolveClassId(cache, classValue, sectionValue, medium);
            if (!classValue) {
                addError('class_id', 'Class is required');
            } else if (!finalClassId) {
                addError('class_id', `Class "${classValue}" with section "${sectionValue || '-'}" and medium "${medium}" not found`, `${classValue} (${sectionValue || '-'}) [${medium}]`);
            };

            if (finalClassId && rollNo) {
                const rollKey = buildRollKey(finalClassId, rollNo);
                const normEmail = email.toLowerCase().trim();
                const existingRollEmail = cache.rollNumbers.get(rollKey);
                const fileRollEmail = fileContext.rollNumbers.get(rollKey);
                if ((existingRollEmail && existingRollEmail !== normEmail) || (fileRollEmail && fileRollEmail !== normEmail)) {
                    addError('roll_no', 'Roll number already exists in this class', rollNo);
                } else {
                    fileContext.rollNumbers.set(rollKey, normEmail);
                };
            };

            if (dob && !isValidDate(dob)) {
                addError('date_of_birth', 'Invalid date format (must be YYYY-MM-DD)', dob);
            };

            if (gender) {
                const normGender = gender.trim().toLowerCase();
                if (normGender !== 'male' && normGender !== 'female') {
                    addError('gender', 'Gender must be Male or Female', gender);
                };
            };

            if (admissionDate && !isValidDate(admissionDate)) {
                addError('admission_date', 'Invalid date format (must be YYYY-MM-DD)', admissionDate);
            };
            break;
        };
        case 'teachers': {
            const name = row.name || '';
            const email = row.email || '';
            const joiningDate = row.joining_date || '';
            const salary = row.salary || '';
            const gender = row.gender || '';
            const dob = row.date_of_birth || row.dob || '';

            if (!name.trim()) addError('name', 'Name is required');
            if (!email.trim()) {
                addError('email', 'Email is required');
            } else if (!isValidEmail(email)) {
                addError('email', 'Invalid email format', email);
            } else {
                validateImportEmail(entityType, email, cache, fileContext, addError);
            };

            if (joiningDate && !isValidDate(joiningDate)) {
                addError('joining_date', 'Invalid date format (must be YYYY-MM-DD)', joiningDate);
            };

            if (dob && !isValidDate(dob)) {
                addError('date_of_birth', 'Invalid date format (must be YYYY-MM-DD)', dob);
            };

            if (salary) {
                const parsedSalary = parseFloat(salary);
                if (isNaN(parsedSalary) || parsedSalary < 0) {
                    addError('salary', 'Salary must be a positive number', salary);
                };
            };

            if (gender) {
                const normGender = gender.trim().toLowerCase();
                if (normGender !== 'male' && normGender !== 'female') {
                    addError('gender', 'Gender must be Male or Female', gender);
                };
            };
            break;
        };
        case 'books': {
            const title = row.title || '';
            const categoryId = row.category_id || '';
            const rackId = row.rack_id || '';
            const quantity = row.quantity || '';
            const publishedYear = row.published_year || '';

            if (!title.trim()) addError('title', 'Title is required');
            if (categoryId && !cache.categories.has(Number(categoryId))) {
                addError('category_id', 'Library Category ID not found', categoryId);
            };

            if (rackId && !cache.racks.has(Number(rackId))) {
                addError('rack_id', 'Library Rack ID not found', rackId);
            };

            if (quantity) {
                const qVal = parseInt(quantity, 10);
                if (isNaN(qVal) || qVal < 1) {
                    addError('quantity', 'Quantity must be a positive integer', quantity);
                };
            };

            if (publishedYear) {
                const yearVal = parseInt(publishedYear, 10);
                const currentYear = new Date().getFullYear();
                if (isNaN(yearVal) || yearVal < 1000 || yearVal > currentYear) {
                    addError('published_year', `Published year must be between 1000 and ${currentYear}`, publishedYear);
                };
            };
            break;
        };
        case 'fees': {
            const classId = row.class_id || '';
            const feeType = row.fee_type || '';
            const amount = row.amount || '';
            const dueDate = row.due_date || '';

            if (!classId) {
                addError('class_id', 'Class ID is required');
            } else if (!cache.classIds.has(Number(classId))) {
                addError('class_id', 'Class ID not found', classId);
            };

            if (!feeType.trim()) {
                addError('fee_type', 'Fee Type is required');
            } else {
                const allowedTypes = ['tuition', 'admission', 'exam', 'transport', 'library', 'sports', 'other'];
                const normType = feeType.trim().toLowerCase();
                if (!allowedTypes.includes(normType)) {
                    addError('fee_type', 'Invalid fee type (allowed: Tuition, Admission, Exam, Transport, Library, Sports, Other)', feeType);
                };
            };

            if (!amount) {
                addError('amount', 'Amount is required');
            } else {
                const amtVal = parseFloat(amount);
                if (isNaN(amtVal) || amtVal <= 0) {
                    addError('amount', 'Amount must be a positive number', amount);
                };
            };

            if (dueDate && !isValidDate(dueDate)) {
                addError('due_date', 'Invalid date format (must be YYYY-MM-DD)', dueDate);
            };
            break;
        };
        case 'marks': {
            const examId = row.exam_id || '';
            const studentId = row.student_id || '';
            const subjectId = row.subject_id || '';
            const marksObtained = row.marks_obtained || '';

            if (!examId) {
                addError('exam_id', 'Exam ID is required');
            } else if (!cache.exams.has(Number(examId))) {
                addError('exam_id', 'Exam ID not found', examId);
            };

            if (!studentId) {
                addError('student_id', 'Student ID is required');
            } else if (!cache.students.has(Number(studentId))) {
                addError('student_id', 'Student ID not found', studentId);
            };

            if (!subjectId) {
                addError('subject_id', 'Subject ID is required');
            } else if (!cache.subjects.has(Number(subjectId))) {
                addError('subject_id', 'Subject ID not found', subjectId);
            };

            if (marksObtained === '') {
                addError('marks_obtained', 'Marks obtained is required');
            } else {
                const marksVal = parseFloat(marksObtained);
                if (isNaN(marksVal) || marksVal < 0) {
                    addError('marks_obtained', 'Marks obtained must be a positive number', marksObtained);
                };
            };
            break;
        };
        default:
            addError('entity_type', 'Unsupported import entity type', entityType);
            break;
    };
    return errors;
};

module.exports = { loadValidationCache, validateRow, resolveClassId, isValidDate, isValidEmail};