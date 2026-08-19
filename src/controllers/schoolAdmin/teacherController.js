const db = require('../../config/database');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { logSchoolActivity } = require('../../utils/auditLogger');

const teacherFixedDocumentFields = {
    aadhaar_card: 'Aadhaar Card',
    qualification_certificate: 'Qualification Certificate',
    experience_certificate: 'Experience Certificate',
    joining_letter: 'Joining Letter',
    resume: 'Resume',
    pan_card: 'PAN Card',
    other_document: 'Other Document'
};

function getUploadedFile(files, fieldName) {
    return files?.[fieldName]?.[0] || null;
};

function flattenUploadedFiles(files) {
    if (!files) return [];
    if (Array.isArray(files)) return files;
    return Object.values(files).flat();
};

function cleanupUploadedFiles(files) {
    flattenUploadedFiles(files).forEach(file => {
        if (file?.path && fs.existsSync(file.path)) {
            try { fs.unlinkSync(file.path); } catch (e) { }
        };
    });
};

async function saveTeacherDocuments(tx, teacherId, files, body = {}) {
    for (const [fieldName, label] of Object.entries(teacherFixedDocumentFields)) {
        const file = getUploadedFile(files, fieldName);
        if (!file) continue;

        await tx.query(
            'INSERT INTO teacher_documents (teacher_id, document_name, document_type, file_path) VALUES (?, ?, ?, ?)',
            [teacherId, file.originalname || label, fieldName, file.filename]
        );
    };

    if (files?.documents) {
        const docTypes = Array.isArray(body.document_types) ? body.document_types : (body.document_types ? [body.document_types] : []);
        const docNames = Array.isArray(body.document_names) ? body.document_names : (body.document_names ? [body.document_names] : []);

        for (let i = 0; i < files.documents.length; i++) {
            const file = files.documents[i];
            const docType = docTypes[i] || 'other';
            const docName = docNames[i] || file.originalname || 'Document';

            await tx.query(
                'INSERT INTO teacher_documents (teacher_id, document_name, document_type, file_path) VALUES (?, ?, ?, ?)',
                [teacherId, docName, docType, file.filename]
            );
        };
    };
};

exports.listTeachers = async (req, res) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const { search, status } = req.query;

        let sql = `
            SELECT t.*, u.first_name as first_name, u.last_name as last_name, u.email, u.phone, u.image,
                (SELECT GROUP_CONCAT(CONCAT_WS(' - ', CONCAT('Class ', c.class_name), NULLIF(c.stream, ''), c.section) SEPARATOR ', ')
                FROM teacher_class_assign tca
                JOIN classes c ON tca.class_id = c.id
                WHERE tca.teacher_id = t.id) as classes
            FROM teachers t 
            LEFT JOIN users u ON t.user_id = u.id 
            WHERE t.school_id = ? AND u.deleted_at IS NULL
        `;
        const params = [schoolId];

        if (search) {
            sql += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)';
            const like = `%${search}%`;
            params.push(like, like, like);
        };
        if (status) {
            sql += ' AND u.status = ?';
            params.push(status);
        };

        sql += ' ORDER BY t.created_at DESC';
        const [teachers] = await db.query(sql, params);
        res.render('schoolAdmin/teachers/index', { title: 'Teachers', teachers, filters: req.query });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load teachers');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.addpage = async (req, res) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const [subjects] = await db.query('SELECT * FROM subjects WHERE school_id = ?', [schoolId]);
        const [classes] = await db.query('SELECT * FROM classes WHERE school_id = ?', [schoolId]);

        res.render('schoolAdmin/teachers/add', { title: 'Add Teacher', subjects, classes });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Something went wrong');
        res.redirect('/schooladmin/teachers');
    };
};

exports.addTeacher = async (req, res) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const { first_name, last_name, email, phone, password, gender, dob, qualification, experience_years, joining_date, address, marital_status, father_name, mother_name, current_address, permanent_address, medical_issues, height, weight, blood_group, previous_school, total_experience, prev_joining_date, salary } = req.body;
        const [existing] = await db.query(
            'SELECT id FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1',
            [email]
        );

        if (existing.length > 0) {
            req.flash('error', 'Email is already registered');
            return res.redirect('/schooladmin/teachers/add');
        };

        const hashedPassword = await bcrypt.hash(password, 10);
        const photoFile = getUploadedFile(req.files, 'photo');
        const photo = photoFile ? `/uploads/teachers/${photoFile.filename}` : null;

        let teacherId;
        await db.withTransaction(async (tx) => {
            const userResult = await tx.query(
                `INSERT INTO users (school_id, first_name, last_name, email, phone, password, role, status, image)
                VALUES (?, ?, ?, ?, ?, ?, 'teacher', 'active', ?)`,
                [schoolId, first_name, last_name, email, phone || null, hashedPassword, photo]
            );

            const teacherResult = await tx.query(
                `INSERT INTO teachers (
                    school_id, user_id, subject, qualification, experience, gender, dob,
                    marital_status, father_name, mother_name,
                    current_address, permanent_address, joining_date
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [schoolId, userResult.insertId, null, qualification || null, experience_years || 0, gender || null, dob || null, marital_status || null, father_name || null, mother_name || null, current_address || address || null, permanent_address || address || null, joining_date || new Date().toISOString().split('T')[0]]
            );

            teacherId = teacherResult.insertId;

            if (salary && parseFloat(salary) > 0) {
                await tx.query(
                    `INSERT INTO salary_structures (school_id, user_id, role, amount) VALUES (?, ?, 'teacher', ?)`,
                    [schoolId, userResult.insertId, parseFloat(salary)]
                );
            };

            await tx.query(
                `INSERT INTO teacher_medical (teacher_id, medical_issues, height, weight, blood_group)
                VALUES (?, ?, ?, ?, ?)`,
                [teacherId, medical_issues || null, height ? parseFloat(height) : null, weight ? parseFloat(weight) : null, blood_group || null]
            );

            if (previous_school || total_experience || prev_joining_date) {
                await tx.query(
                    `INSERT INTO teacher_experience (teacher_id, previous_school, total_experience, joining_date)
                    VALUES (?, ?, ?, ?)`,
                    [teacherId, previous_school || null, total_experience ? parseFloat(total_experience) : null, prev_joining_date || null]
                );
            };
            await saveTeacherDocuments(tx, teacherId, req.files, req.body);
        });

        await logSchoolActivity(req, {
            action: 'create_teacher',
            entityType: 'teacher',
            entityId: teacherId,
            description: `Added teacher profile for ${first_name} ${last_name} (${email})`
        });

        req.flash('success', 'Teacher added successfully');
        res.redirect('/schooladmin/teachers');
    } catch (err) {
        console.error(err);
        cleanupUploadedFiles(req.files);
        req.flash('error', 'Failed to add teacher: ' + err.message);
        res.redirect('add');
    };
};

exports.viewTeacher = async (req, res) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const { id } = req.params;
        const [[teacher]] = await db.query(
            `SELECT t.*, u.first_name as first_name, u.last_name as last_name, u.email, u.phone, u.image, u.status, u.last_login,
                ss.amount as salary
            FROM teachers t 
            LEFT JOIN users u ON t.user_id = u.id 
            LEFT JOIN salary_structures ss ON ss.user_id = t.user_id AND ss.school_id = t.school_id
            WHERE t.id = ? AND t.school_id = ? AND u.deleted_at IS NULL`,
            [id, schoolId]
        );

        if (!teacher) {
            req.flash('error', 'Teacher not found');
            return res.redirect('/schooladmin/teachers');
        };

        teacher.first_name = teacher.first_name;
        teacher.last_name = teacher.last_name;
        teacher.photo = teacher.image;
        teacher.experience_years = teacher.experience;
        teacher.address = teacher.current_address || teacher.permanent_address || '';

        const [[medical]] = await db.query(
            'SELECT * FROM teacher_medical WHERE teacher_id = ?', [id]
        );

        const [[experience]] = await db.query(
            'SELECT * FROM teacher_experience WHERE teacher_id = ?', [id]
        );

        const [documents] = await db.query(
            'SELECT * FROM teacher_documents WHERE teacher_id = ? ORDER BY uploaded_at DESC', [id]
        );

        const [rawAssignments] = await db.query(
            `SELECT csa.*, c.class_name as class_name, c.section as section, c.stream, c.medium, s.subject_name as subject_name 
            FROM teacher_class_assign csa 
            JOIN classes c ON csa.class_id = c.id 
            LEFT JOIN subjects s ON csa.subject_id = s.id 
            WHERE csa.teacher_id = ?`,
            [id]
        );
        const { formatClassLabel } = require('../../utils/academicLabels');
        const assignments = rawAssignments.map(a => ({
            ...a,
            class_name: formatClassLabel(a)
        }));

        const [rawTimetable] = await db.query(
            `SELECT tt.*, 
                c.class_name AS class_name, c.section AS section, c.stream, c.medium,
                s.subject_name AS subject_name, 
                ps.start_time, 
                ps.end_time, 
                tt.day_of_week
            FROM timetables tt
            JOIN classes c ON tt.class_id = c.id AND c.school_id = tt.school_id
            JOIN subjects s ON tt.subject_id = s.id AND s.school_id = tt.school_id
            JOIN period_slots ps ON tt.period_slot_id = ps.id AND ps.school_id = tt.school_id
            LEFT JOIN timetable_versions tv ON tt.version_id = tv.id AND tv.school_id = tt.school_id
            WHERE tt.teacher_id = ? 
              AND tt.school_id = ? 
              AND (tv.status = 'published' OR tv.id IS NULL OR tv.id = (
                  SELECT id FROM timetable_versions 
                  WHERE school_id = ? 
                  ORDER BY (status = 'published') DESC, version_number DESC 
                  LIMIT 1
              ))
            ORDER BY FIELD(tt.day_of_week, 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'), ps.start_time;`,
            [id, schoolId, schoolId]
        );
        const timetable = rawTimetable.map(t => ({
            ...t,
            class_name: formatClassLabel(t)
        }));

        res.render('schoolAdmin/teachers/view', {
            title: `${teacher.first_name} ${teacher.last_name}`,
            teacher,
            documents,
            assignments,
            timetable,
            medical: medical || {},
            experience: experience || {}
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load teacher');
        res.redirect('/schooladmin/teachers');
    };
};

exports.editpage = async (req, res) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const { id } = req.params;
        const [[teacher]] = await db.query(
            `SELECT t.*, u.first_name as first_name, u.last_name as last_name, u.email, u.phone, u.image,
                ss.amount as salary
            FROM teachers t 
            LEFT JOIN users u ON t.user_id = u.id 
            LEFT JOIN salary_structures ss ON ss.user_id = t.user_id AND ss.school_id = t.school_id
            WHERE t.id = ? AND t.school_id = ?`,
            [id, schoolId]
        );

        if (!teacher) {
            req.flash('error', 'Teacher not found');
            return res.redirect('/schooladmin/teachers');
        };

        teacher.first_name = teacher.first_name;
        teacher.last_name = teacher.last_name;
        teacher.experience_years = teacher.experience;
        teacher.address = teacher.current_address || teacher.permanent_address || '';
        teacher.photo = teacher.image;

        const [[medical]] = await db.query(
            'SELECT * FROM teacher_medical WHERE teacher_id = ?', [id]
        );

        const [[experience]] = await db.query(
            'SELECT * FROM teacher_experience WHERE teacher_id = ?', [id]
        );

        const [documents] = await db.query(
            'SELECT * FROM teacher_documents WHERE teacher_id = ? ORDER BY uploaded_at DESC', [id]
        );

        res.render('schoolAdmin/teachers/edit', {
            title: 'Edit Teacher',
            teacher,
            medical: medical || {},
            experience: experience || {},
            documents: documents || []
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load teacher');
        res.redirect('/schooladmin/teachers');
    };
};

exports.updateTeacher = async (req, res) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const { id } = req.params;
        const { first_name, last_name, email, phone, gender, dob, qualification, experience_years, joining_date, address, status, marital_status, father_name, mother_name, current_address, permanent_address, medical_issues, height, weight, blood_group, previous_school, total_experience, prev_joining_date, salary } = req.body;

        const [[teacher]] = await db.query(
            'SELECT t.user_id, u.email FROM teachers t JOIN users u ON t.user_id = u.id WHERE t.id = ? AND t.school_id = ? LIMIT 1',
            [id, schoolId]
        );

        if (!teacher) {
            req.flash('error', 'Teacher not found');
            return res.redirect('/schooladmin/teachers');
        };

        const [existing] = await db.query(
            'SELECT id FROM users WHERE email = ? AND email != ? AND deleted_at IS NULL LIMIT 1',
            [email, teacher.email]
        );

        if (existing.length > 0) {
            cleanupUploadedFiles(req.files);
            req.flash('error', 'Email is already registered by another account');
            return res.redirect(`/schooladmin/teachers/${id}/edit`);
        };

        const photoFile = getUploadedFile(req.files, 'photo');
        const photo = photoFile ? `/uploads/teachers/${photoFile.filename}` : null;

        await db.withTransaction(async (tx) => {
            let userUpdateQuery = 'UPDATE users SET first_name = ?, last_name = ?, email = ?, phone = ?, status = ?';
            const userParams = [first_name, last_name, email, phone, status];
            if (photo) {
                userUpdateQuery += ', image = ?';
                userParams.push(photo);
            };
            userUpdateQuery += ' WHERE id = ?';
            userParams.push(teacher.user_id);
            await tx.query(userUpdateQuery, userParams);

            let sql = `
                UPDATE teachers SET 
                    gender = ?, dob = ?, qualification = ?, experience = ?, 
                    joining_date = ?, current_address = ?, permanent_address = ?,
                    marital_status = ?, father_name = ?, mother_name = ?
                WHERE id = ? AND school_id = ?
            `;
            const params = [gender, dob || null, qualification || null, experience_years || 0, joining_date || null, current_address || address || null, permanent_address || address || null, marital_status || null, father_name || null, mother_name || null, id, schoolId];

            await tx.query(sql, params);

            if (salary !== undefined && salary !== null && String(salary).trim() !== '') {
                const parsedSalary = parseFloat(salary);
                if (parsedSalary > 0) {
                    const [[existingStruct]] = await tx.query(
                        'SELECT id FROM salary_structures WHERE school_id = ? AND user_id = ? LIMIT 1',
                        [schoolId, teacher.user_id]
                    );
                    if (existingStruct) {
                        await tx.query(
                            'UPDATE salary_structures SET amount = ?, role = "teacher" WHERE id = ? AND school_id = ?',
                            [parsedSalary, existingStruct.id, schoolId]
                        );
                    } else {
                        await tx.query(
                            'INSERT INTO salary_structures (school_id, user_id, role, amount) VALUES (?, ?, "teacher", ?)',
                            [schoolId, teacher.user_id, parsedSalary]
                        );
                    };
                };
            };

            const [medExists] = await tx.query('SELECT id FROM teacher_medical WHERE teacher_id = ? LIMIT 1', [id]);
            if (medExists) {
                await tx.query(
                    `UPDATE teacher_medical SET medical_issues = ?, height = ?, weight = ?, blood_group = ? WHERE teacher_id = ?`,
                    [medical_issues || null, height ? parseFloat(height) : null, weight ? parseFloat(weight) : null, blood_group || null, id]
                );
            } else {
                await tx.query(
                    `INSERT INTO teacher_medical (teacher_id, medical_issues, height, weight, blood_group) VALUES (?, ?, ?, ?, ?)`,
                    [id, medical_issues || null, height ? parseFloat(height) : null, weight ? parseFloat(weight) : null, blood_group || null]
                );
            };

            const [expExists] = await tx.query('SELECT id FROM teacher_experience WHERE teacher_id = ? LIMIT 1', [id]);
            if (expExists) {
                await tx.query(
                    `UPDATE teacher_experience SET previous_school = ?, total_experience = ?, joining_date = ? WHERE teacher_id = ?`,
                    [previous_school || null, total_experience ? parseFloat(total_experience) : null, prev_joining_date || null, id]
                );
            } else if (previous_school || total_experience || prev_joining_date) {
                await tx.query(
                    `INSERT INTO teacher_experience (teacher_id, previous_school, total_experience, joining_date) VALUES (?, ?, ?, ?)`,
                    [id, previous_school || null, total_experience ? parseFloat(total_experience) : null, prev_joining_date || null]
                );
            };
            await saveTeacherDocuments(tx, id, req.files, req.body);
        });

        await logSchoolActivity(req, {
            action: 'update_teacher',
            entityType: 'teacher',
            entityId: id,
            description: `Updated teacher profile details for ${first_name} ${last_name}`
        });

        req.flash('success', 'Teacher updated successfully');
        res.redirect(`/schooladmin/teachers/${id}`);
    } catch (err) {
        console.error(err);
        cleanupUploadedFiles(req.files);
        req.flash('error', 'Failed to update teacher: ' + err.message);
        res.redirect(`/schooladmin/teachers/${id}/edit`);
    };
};

exports.deleteTeacher = async (req, res) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const { id } = req.params;

        await db.query(
            'UPDATE users SET deleted_at = NOW(), status = "inactive" WHERE id = (SELECT user_id FROM teachers WHERE id = ? AND school_id = ?)',
            [id, schoolId]
        );

        await logSchoolActivity(req, {
            action: 'delete_teacher',
            entityType: 'teacher',
            entityId: id,
            description: `Soft-deleted teacher account with ID ${id}`
        });

        req.flash('success', 'Teacher deleted successfully');
        res.redirect('/schooladmin/teachers');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to delete teacher');
        res.redirect('/schooladmin/teachers');
    };
};

exports.getAssignClasses = async (req, res) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const { id } = req.params;

        const [[teacher]] = await db.query(
            'SELECT t.*, u.first_name as first_name, u.last_name as last_name FROM teachers t JOIN users u ON t.user_id = u.id WHERE t.id = ? AND t.school_id = ? AND u.deleted_at IS NULL',
            [id, schoolId]
        );

        teacher.first_name = teacher.first_name;
        teacher.last_name = teacher.last_name;

        const [classes] = await db.query('SELECT id, class_name, section FROM classes WHERE school_id = ? ORDER BY class_name, section', [schoolId]);
        const [subjects] = await db.query('SELECT id, subject_name FROM subjects WHERE school_id = ? ORDER BY subject_name', [schoolId]);
        const [assignments] = await db.query(
            `SELECT csa.*, c.class_name as class_name, c.section as section, s.subject_name as subject_name 
            FROM teacher_class_assign csa 
            JOIN classes c ON csa.class_id = c.id AND c.school_id = csa.school_id
            LEFT JOIN subjects s ON csa.subject_id = s.id AND s.school_id = csa.school_id
            WHERE csa.teacher_id = ? AND csa.school_id = ?`, [id, schoolId]
        );

        res.render('schoolAdmin/teachers/assign', {
            title: 'Assign Classes',
            teacher,
            teachers: [teacher],
            classes,
            subjects,
            assignments,
            editAssignment: null
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load assignments');
        res.redirect('/schooladmin/teachers');
    };
};

exports.postAssignClasses = async (req, res) => {
    try {
        const { id } = req.params;
        const { class_id, subject_id, is_primary } = req.body;
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const subjectVal = subject_id && subject_id !== '' ? subject_id : null;
        const markAttendanceClass = is_primary === 'on' ? 1 : 0;

        const [[teacher]] = await db.query(
            'SELECT id FROM teachers WHERE id = ? AND school_id = ? LIMIT 1',
            [id, schoolId]
        );
        if (!teacher) {
            req.flash('error', 'Invalid teacher selected');
            return res.redirect('/schooladmin/teachers');
        };

        const [[classRow]] = await db.query(
            'SELECT id, medium, academic_year FROM classes WHERE id = ? AND school_id = ? LIMIT 1',
            [class_id, schoolId]
        );
        if (!classRow) {
            req.flash('error', 'Invalid class selected');
            return res.redirect(`/schooladmin/teachers/${id}/assign`);
        };

        if (subjectVal) {
            const [[subject]] = await db.query(
                "SELECT id FROM subjects WHERE id = ? AND school_id = ? AND status = 'active' LIMIT 1",
                [subjectVal, schoolId]
            );
            if (!subject) {
                req.flash('error', 'Invalid subject selected');
                return res.redirect(`/schooladmin/teachers/${id}/assign`);
            };
        };

        const [[existing]] = await db.query(
            `SELECT id FROM teacher_class_assign
            WHERE school_id = ?
                AND teacher_id = ?
                AND class_id = ?
                AND (subject_id = ? OR (subject_id IS NULL AND ? IS NULL))
            LIMIT 1`,
            [schoolId, id, class_id, subjectVal, subjectVal]
        );

        if (existing) {
            req.flash('error', 'Already assigned to this class and subject');
            return res.redirect(`/schooladmin/teachers/${id}/assign`);
        }

        if (markAttendanceClass) {
            await db.query(
                `UPDATE teacher_class_assign
                 SET is_primary = 0, is_class_teacher = 0, can_mark_attendance = 0
                 WHERE school_id = ? AND teacher_id = ?`,
                [schoolId, id]
            );
            await db.query(
                `UPDATE teacher_class_assign
                 SET is_primary = 0, is_class_teacher = 0, can_mark_attendance = 0
                 WHERE school_id = ? AND class_id = ? AND teacher_id != ?`,
                [schoolId, class_id, id]
            );
        }

        await db.query(
            `INSERT INTO teacher_class_assign
            (school_id, teacher_id, class_id, subject_id, medium, academic_year, status, assigned_by, is_primary, is_class_teacher, can_mark_attendance)
            VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
            [schoolId, id, class_id, subjectVal, classRow.medium || null, classRow.academic_year || null, (req.user?.id || req.session.user?.id), markAttendanceClass, markAttendanceClass, markAttendanceClass]
        );

        req.flash('success', 'Class/Subject assigned successfully');
        res.redirect(`/schooladmin/teachers/${id}/assign`);
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to assign');
        res.redirect(`/schooladmin/teachers/${id}/assign`);
    };
};

const getTeacherAndSchoolDetails = async (teacherId, schoolId) => {
    const [[teacher]] = await db.query(
        `SELECT t.*, u.first_name as first_name, u.last_name as last_name, u.email, u.phone, u.image, u.status 
        FROM teachers t 
        LEFT JOIN users u ON t.user_id = u.id 
        WHERE t.id = ? AND t.school_id = ? AND u.deleted_at IS NULL`,
        [teacherId, schoolId]
    );

    if (!teacher) {
        return null;
    }

    teacher.photo = teacher.image;
    teacher.experience_years = teacher.experience;
    teacher.address = teacher.current_address || teacher.permanent_address || '';

    const [assignments] = await db.query(
        `SELECT c.class_name, c.section, s.subject_name 
        FROM teacher_class_assign tca 
        JOIN classes c ON tca.class_id = c.id 
        LEFT JOIN subjects s ON tca.subject_id = s.id 
        WHERE tca.teacher_id = ?`,
        [teacherId]
    );
    teacher.assignments = assignments;

    const [schools] = await db.query('SELECT * FROM schools WHERE id = ?', [schoolId]);
    const school = schools[0] || {};

    teacher.school_name = school.school_name;
    teacher.school_address = school.school_address;
    teacher.school_phone = school.school_phone;
    teacher.school_email = school.school_email;
    teacher.website = school.website;
    teacher.logo = school.logo;
    teacher.school_principal_name = school.school_principal_name;

    return { teacher, school };
};

const generateTeacherIdCardPdf = async (teacher, school) => {
    const qrText = `VERIFY:TEACHER-ID-${teacher.id}:NAME-${teacher.first_name} ${teacher.last_name}:SCHOOL-${school.school_name || ''}`;
    try {
        teacher.qr_code = await QRCode.toDataURL(qrText, {
            width: 180,
            margin: 1,
            color: { dark: '#0f172a', light: '#ffffff' }
        });
    } catch (qrErr) {
        console.error('Teacher ID preview QR error:', qrErr.message);
        teacher.qr_code = null;
    }

    const { generateIdCardPdf } = require('../../utils/pdfHelper');
    return await generateIdCardPdf({
        type: 'teacher',
        name: `${teacher.first_name} ${teacher.last_name}`,
        idNo: `T-${teacher.id}`,
        frontDetail1: teacher.designation || 'Teacher',
        frontDetail2: teacher.email || 'N/A',
        frontDetail3: '2026-2027',
        photo: teacher.photo,
        school,
        qrText,
        backDetail1: teacher.phone || 'N/A',
        backDetail2: teacher.emergency_contact || 'N/A'
    });
};

exports.previewIdCard = async (req, res) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const { id } = req.params;

        const details = await getTeacherAndSchoolDetails(id, schoolId);
        if (!details) {
            return res.status(404).send('Teacher not found or unauthorized');
        }

        const pdfDoc = await generateTeacherIdCardPdf(details.teacher, details.school);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="teacher-id-card-${id}.pdf"`);
        pdfDoc.pipe(res);
        pdfDoc.end();
    } catch (err) {
        console.error('Teacher ID Card Preview Error:', err);
        res.status(500).send('Failed to generate ID card preview');
    }
};

exports.downloadIdCard = async (req, res) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const { id } = req.params;

        const details = await getTeacherAndSchoolDetails(id, schoolId);
        if (!details) {
            req.flash('error', 'Teacher not found or unauthorized');
            return res.redirect('/schooladmin/teachers');
        }

        const pdfDoc = await generateTeacherIdCardPdf(details.teacher, details.school);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="teacher-id-card-${id}.pdf"`);
        pdfDoc.pipe(res);
        pdfDoc.end();
    } catch (err) {
        console.error('Teacher ID Card Download Error:', err);
        req.flash('error', 'Failed to download ID card');
        res.redirect(`/schooladmin/teachers/${req.params.id}`);
    }
};

exports.generateIdCard = async (req, res) => {
    res.redirect(`/schooladmin/teachers/${req.params.id}/id-card/preview`);
};

exports.deleteDocument = async (req, res) => {
    try {
        const { docId } = req.params;
        const schoolId = (req.user?.school_id || req.session.user?.school_id);

        const [docs] = await db.query(`
            SELECT d.* FROM teacher_documents d
            JOIN teachers t ON d.teacher_id = t.id
            WHERE d.id = ? AND t.school_id = ?
        `, [docId, schoolId]);

        if (!docs.length) {
            req.flash('error', 'Document not found');
            return res.redirect('back');
        };

        const doc = docs[0];
        let fullPath = path.resolve(__dirname, '../../../storage/uploads/teachers/', doc.file_path);
        if (!fs.existsSync(fullPath)) {
            fullPath = path.join(__dirname, '../../public/uploads/teachers/', doc.file_path);
        };

        if (fs.existsSync(fullPath)) {
            try {
                fs.unlinkSync(fullPath);
            } catch (err) {
                console.error('File deletion error:', err);
            };
        };

        await db.query('DELETE FROM teacher_documents WHERE id = ?', [docId]);
        req.flash('success', 'Document deleted successfully');
        res.redirect(`/schooladmin/teachers/${doc.teacher_id}/edit`);
    } catch (err) {
        console.error('Delete Document Error:', err);
        req.flash('error', 'Failed to delete document');
        res.redirect('back');
    };
};