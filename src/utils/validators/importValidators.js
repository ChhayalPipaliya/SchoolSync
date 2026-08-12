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

function buildClassCode(className, section, medium, stream = '') {
    const streamKey = String(stream || '').trim().toLowerCase();
    return `${normalizeClassName(className)}_${normalizeSection(section)}_${normalizeMedium(medium)}_${streamKey}`;
};

function buildRollKey(classId, rollNo) {
    return `${Number(classId)}_${String(rollNo || '').trim().toLowerCase()}`;
};

function resolveClassId(cache, classValue, sectionValue, mediumValue = 'English', streamValue = '') {
    if (classValue && cache.classIds.has(Number(classValue))) {
        return Number(classValue);
    };

    if (!classValue || !sectionValue) {
        return null;
    };

    for (const key of getClassLookupKeys(classValue)) {
        if (streamValue) {
            const classIdWithStream = cache.classesByCode.get(buildClassCode(key, sectionValue, mediumValue, streamValue));
            if (classIdWithStream) return classIdWithStream;
        }
        const classId = cache.classesByCode.get(buildClassCode(key, sectionValue, mediumValue, ''));
        if (classId) return classId;
    };
    return null;
};

async function loadValidationCache(schoolId) {
    const cache = {
        schoolId,
        usersByEmail: new Map(),
        classesByCode: new Map(),
        classesById: new Map(),
        classIds: new Set(),
        rollNumbers: new Map(),
        exams: new Set(),
        subjects: new Set(),
        subjectsByName: new Map(),
        students: new Set(),
        studentsByAdmissionNo: new Map(),
        teachersByEmail: new Map(),
        teachersById: new Map(),
        categories: new Set(),
        racks: new Set(),
        periodSlots: new Map()
    };

    const users = await db.queryAsync("SELECT id, email, role, school_id FROM users WHERE deleted_at IS NULL");
    users.forEach(u => {
        if (!u.email) return;
        const email = u.email.toLowerCase().trim();
        if (!cache.usersByEmail.has(email)) {
            cache.usersByEmail.set(email, []);
        };
        cache.usersByEmail.get(email).push(u);
    });

    const classes = await db.queryAsync("SELECT id, class_name, section, medium, stream FROM classes WHERE school_id = ?", [schoolId]);
    classes.forEach(c => {
        cache.classIds.add(Number(c.id));
        cache.classesById.set(Number(c.id), c);
        for (const key of getClassLookupKeys(c.class_name)) {
            if (c.stream) {
                cache.classesByCode.set(buildClassCode(key, c.section, c.medium || 'English', c.stream), Number(c.id));
            }
            cache.classesByCode.set(buildClassCode(key, c.section, c.medium || 'English', ''), Number(c.id));
        };
    });

    const students = await db.queryAsync(
        `SELECT s.id, s.class_id, s.roll_no, s.admission_no, u.email
        FROM students s
        JOIN users u ON s.user_id = u.id
        WHERE s.school_id = ? AND s.deleted_at IS NULL AND u.deleted_at IS NULL`,
        [schoolId]
    );
    students.forEach(s => {
        cache.students.add(Number(s.id));
        if (s.admission_no) {
            cache.studentsByAdmissionNo.set(String(s.admission_no).toLowerCase().trim(), s);
        }
        if (s.class_id && s.roll_no) {
            cache.rollNumbers.set(buildRollKey(s.class_id, s.roll_no), String(s.email || '').toLowerCase().trim());
        };
    });

    const teachers = await db.queryAsync(
        `SELECT t.id as teacher_id, t.user_id, u.email, CONCAT_WS(' ', u.first_name, u.last_name) as name
        FROM teachers t
        JOIN users u ON t.user_id = u.id
        WHERE t.school_id = ? AND u.deleted_at IS NULL`,
        [schoolId]
    );
    teachers.forEach(t => {
        cache.teachersById.set(Number(t.teacher_id), t);
        if (t.email) {
            cache.teachersByEmail.set(String(t.email).toLowerCase().trim(), t);
        }
    });

    const exams = await db.queryAsync("SELECT id FROM exams WHERE school_id = ?", [schoolId]);
    exams.forEach(e => cache.exams.add(Number(e.id)));

    const subjects = await db.queryAsync("SELECT id, subject_name, code, subject_code FROM subjects WHERE school_id = ?", [schoolId]);
    subjects.forEach(s => {
        cache.subjects.add(Number(s.id));
        if (s.subject_name) {
            cache.subjectsByName.set(String(s.subject_name).toLowerCase().trim(), s);
        }
        if (s.code) {
            cache.subjectsByName.set(String(s.code).toLowerCase().trim(), s);
        }
        if (s.subject_code) {
            cache.subjectsByName.set(String(s.subject_code).toLowerCase().trim(), s);
        }
    });

    const categories = await db.queryAsync("SELECT id FROM library_categories WHERE school_id = ?", [schoolId]);
    categories.forEach(c => cache.categories.add(Number(c.id)));

    const racks = await db.queryAsync("SELECT id FROM library_racks WHERE school_id = ?", [schoolId]);
    racks.forEach(r => cache.racks.add(Number(r.id)));

    const slots = await db.queryAsync("SELECT id, period_number, label FROM period_slots WHERE school_id = ?", [schoolId]).catch(() => []);
    slots.forEach(slot => {
        cache.periodSlots.set(Number(slot.period_number), slot);
        if (slot.label) {
            cache.periodSlots.set(String(slot.label).toLowerCase().trim(), slot);
        }
    });

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
        case 'parents': {
            const name = row.parent_name || row.name || '';
            const studentAdmNo = row.student_admission_no || row.student_id || '';
            const email = row.email || row.parent_email || '';
            const mobile = row.mobile || row.phone || row.parent_phone || '';
            const relation = row.relationship || row.relation || 'Father';

            if (!name.trim()) addError('parent_name', 'Parent Name is required');

            if (!studentAdmNo.toString().trim()) {
                addError('student_admission_no', 'Student Admission No or ID is required');
            } else {
                const normAdm = String(studentAdmNo).toLowerCase().trim();
                const student = cache.studentsByAdmissionNo.get(normAdm) || (cache.students.has(Number(studentAdmNo)) ? { id: Number(studentAdmNo) } : null);
                if (!student) {
                    addError('student_admission_no', 'Student not found in this school', studentAdmNo);
                };
            };

            if (email && !isValidEmail(email)) {
                addError('email', 'Invalid email format', email);
            };

            if (mobile) {
                const cleanMobile = String(mobile).replace(/\D/g, '');
                if (cleanMobile.length < 10) {
                    addError('mobile', 'Mobile number must contain at least 10 digits', mobile);
                };
            };

            const normRelation = relation.trim().toLowerCase();
            if (normRelation && !['father', 'mother', 'guardian'].includes(normRelation)) {
                addError('relationship', 'Relationship must be Father, Mother, or Guardian', relation);
            };
            break;
        };
        case 'classes_sections': {
            const className = row.class_name || row.standard || '';
            const section = row.section || '';
            const medium = row.medium || 'English';
            const stream = row.stream || '';
            const capacity = row.capacity || row.max_students || '';

            if (!className.trim()) addError('class_name', 'Class Name is required');
            if (!section.trim()) addError('section', 'Section is required');

            if (capacity) {
                const capVal = parseInt(capacity, 10);
                if (isNaN(capVal) || capVal < 1) {
                    addError('capacity', 'Capacity must be a positive integer', capacity);
                };
            };
            break;
        };
        case 'subjects': {
            const subjectName = row.subject_name || row.name || '';
            const subjectType = row.subject_type || 'Theory';
            const className = row.class_name || '';
            const section = row.section || '';
            const medium = row.medium || 'English';
            const maxMarks = row.max_marks || '';
            const passMarks = row.pass_marks || '';

            if (!subjectName.trim()) addError('subject_name', 'Subject Name is required');

            if (subjectType) {
                const normType = subjectType.trim().toLowerCase();
                if (!['theory', 'practical', 'both'].includes(normType)) {
                    addError('subject_type', 'Invalid subject type (allowed: Theory, Practical, Both)', subjectType);
                };
            };

            if (maxMarks !== '') {
                const maxVal = parseFloat(maxMarks);
                if (isNaN(maxVal) || maxVal <= 0) {
                    addError('max_marks', 'Max Marks must be a positive number', maxMarks);
                };
            };

            if (passMarks !== '') {
                const passVal = parseFloat(passMarks);
                if (isNaN(passVal) || passVal < 0) {
                    addError('pass_marks', 'Pass Marks must be a non-negative number', passMarks);
                } else if (maxMarks !== '' && passVal > parseFloat(maxMarks)) {
                    addError('pass_marks', 'Pass Marks cannot exceed Max Marks', passMarks);
                };
            };

            if (className && section) {
                const classId = resolveClassId(cache, className, section, medium);
                if (!classId) {
                    addError('class_name', `Class "${className}" section "${section}" not found in this school`, `${className} (${section})`);
                };
            };
            break;
        };
        case 'student_class_allocation': {
            const studentAdmNo = row.student_admission_no || row.student_id || '';
            const className = row.class_name || row.standard || '';
            const section = row.section || '';
            const medium = row.medium || 'English';
            const stream = row.stream || '';
            const rollNo = row.roll_no || '';

            if (!studentAdmNo.toString().trim()) {
                addError('student_admission_no', 'Student Admission No or ID is required');
            } else {
                const normAdm = String(studentAdmNo).toLowerCase().trim();
                const student = cache.studentsByAdmissionNo.get(normAdm) || (cache.students.has(Number(studentAdmNo)) ? { id: Number(studentAdmNo) } : null);
                if (!student) {
                    addError('student_admission_no', 'Student not found in this school', studentAdmNo);
                };
            };

            if (!className.trim()) addError('class_name', 'Class Name is required');
            if (!section.trim()) addError('section', 'Section is required');

            if (className && section) {
                const classId = resolveClassId(cache, className, section, medium, stream);
                if (!classId) {
                    addError('class_name', `Target class "${className}" section "${section}" not found in this school`, `${className} (${section})`);
                } else if (rollNo) {
                    const rollKey = buildRollKey(classId, rollNo);
                    const fileRoll = fileContext.rollNumbers.get(rollKey);
                    if (fileRoll && fileRoll !== String(studentAdmNo).toLowerCase().trim()) {
                        addError('roll_no', 'Roll number duplicated in target class in this import', rollNo);
                    } else {
                        fileContext.rollNumbers.set(rollKey, String(studentAdmNo).toLowerCase().trim());
                    };
                };
            };
            break;
        };
        case 'teacher_subject_assignment': {
            const teacherEmail = row.teacher_email || row.teacher_id || row.email || '';
            const subjectName = row.subject_name || row.subject_code || '';
            const className = row.class_name || row.standard || '';
            const section = row.section || '';
            const medium = row.medium || 'English';
            const stream = row.stream || '';

            if (!teacherEmail.toString().trim()) {
                addError('teacher_email', 'Teacher Email or ID is required');
            } else {
                const normEmail = String(teacherEmail).toLowerCase().trim();
                const teacher = cache.teachersByEmail.get(normEmail) || cache.teachersById.get(Number(teacherEmail));
                if (!teacher) {
                    addError('teacher_email', 'Teacher not found in this school', teacherEmail);
                };
            };

            if (!subjectName.trim()) {
                addError('subject_name', 'Subject Name or Code is required');
            } else {
                const normSubject = subjectName.trim().toLowerCase();
                const subject = cache.subjectsByName.get(normSubject) || (cache.subjects.has(Number(subjectName)) ? { id: Number(subjectName) } : null);
                if (!subject) {
                    addError('subject_name', 'Subject not found in this school', subjectName);
                };
            };

            if (!className.trim()) addError('class_name', 'Class Name is required');
            if (!section.trim()) addError('section', 'Section is required');

            if (className && section) {
                const classId = resolveClassId(cache, className, section, medium, stream);
                if (!classId) {
                    addError('class_name', `Class "${className}" section "${section}" not found in this school`, `${className} (${section})`);
                };
            };
            break;
        };
        case 'timetable': {
            const className = row.class_name || row.standard || '';
            const section = row.section || '';
            const medium = row.medium || 'English';
            const stream = row.stream || '';
            const day = row.day || row.day_of_week || '';
            const periodNum = row.period_number || row.period_slot_id || '';
            const subjectName = row.subject_name || row.subject_id || '';
            const teacherEmail = row.teacher_email || row.teacher_id || '';
            const room = row.room || row.room_number || '';
            const startTime = row.start_time || '';
            const endTime = row.end_time || '';

            if (!className.trim()) addError('class_name', 'Class Name is required');
            if (!section.trim()) addError('section', 'Section is required');

            let classId = null;
            if (className && section) {
                classId = resolveClassId(cache, className, section, medium, stream);
                if (!classId) {
                    addError('class_name', `Class "${className}" section "${section}" not found in this school`, `${className} (${section})`);
                };
            };

            if (!day.trim()) {
                addError('day', 'Day of week is required');
            } else {
                const allowedDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
                if (!allowedDays.includes(day.trim().toLowerCase())) {
                    addError('day', 'Day must be a valid day of week (e.g. Monday, Tuesday)', day);
                };
            };

            if (!periodNum.toString().trim()) {
                addError('period_number', 'Period Number or Slot is required');
            };

            if (!subjectName.trim()) {
                addError('subject_name', 'Subject Name is required');
            } else {
                const normSub = subjectName.trim().toLowerCase();
                const subject = cache.subjectsByName.get(normSub) || (cache.subjects.has(Number(subjectName)) ? { id: Number(subjectName) } : null);
                if (!subject) {
                    addError('subject_name', 'Subject not found in this school', subjectName);
                };
            };

            let teacher = null;
            if (!teacherEmail.toString().trim()) {
                addError('teacher_email', 'Teacher Email or ID is required');
            } else {
                const normT = String(teacherEmail).toLowerCase().trim();
                teacher = cache.teachersByEmail.get(normT) || cache.teachersById.get(Number(teacherEmail));
                if (!teacher) {
                    addError('teacher_email', 'Teacher not found in this school', teacherEmail);
                };
            };

            const normDay = day.trim().toLowerCase();
            const normPeriod = String(periodNum).trim();

            if (!fileContext.timetableTeacherSlots) fileContext.timetableTeacherSlots = new Set();
            if (!fileContext.timetableClassSlots) fileContext.timetableClassSlots = new Set();
            if (!fileContext.timetableRoomSlots) fileContext.timetableRoomSlots = new Set();

            if (teacher && normDay && normPeriod) {
                const teacherKey = `${teacher.teacher_id}_${normDay}_${normPeriod}`;
                if (fileContext.timetableTeacherSlots.has(teacherKey)) {
                    addError('teacher_email', `Teacher is already scheduled for another class on ${day} period ${periodNum}`, teacherEmail);
                } else {
                    fileContext.timetableTeacherSlots.add(teacherKey);
                };
            };

            if (classId && normDay && normPeriod) {
                const classKey = `${classId}_${normDay}_${normPeriod}`;
                if (fileContext.timetableClassSlots.has(classKey)) {
                    addError('class_name', `Class is already scheduled for another subject on ${day} period ${periodNum}`, className);
                } else {
                    fileContext.timetableClassSlots.add(classKey);
                };
            };

            if (room && normDay && normPeriod) {
                const roomKey = `${room.trim().toLowerCase()}_${normDay}_${normPeriod}`;
                if (fileContext.timetableRoomSlots.has(roomKey)) {
                    addError('room', `Room "${room}" is already assigned on ${day} period ${periodNum}`, room);
                } else {
                    fileContext.timetableRoomSlots.add(roomKey);
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