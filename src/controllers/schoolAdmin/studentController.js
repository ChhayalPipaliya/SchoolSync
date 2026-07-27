const db = require('../../config/database');
const { validationResult } = require('express-validator');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const { logSchoolActivity } = require('../../utils/auditLogger');
const portalService = require('../../services/portalService');

const getSchoolId = (req) => req.user?.school_id || req.session.user?.school_id;

function normalizeStandard(value) {
    return String(value || '').trim().replace(/^std\.?\s*/i, '').replace(/^class\s*/i, '').toLowerCase();
};

function trimStandard(value) {
    return String(value || '').trim();
};

function toStudentGender(value) {
    const gender = String(value || '').trim().toLowerCase();
    if (gender === 'male') return 'Male';
    if (gender === 'female') return 'Female';
    return null;
};

const studentDocumentFields = [ 'student_image', 'father_image', 'mother_image', 'birth_certificate', 'aadhaar_card', 'leaving_certificate', 'previous_marksheet'];
const imageUploadFields = new Set(['student_image', 'father_image', 'mother_image']);
const allowedImageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const allowedDocumentExtensions = new Set(['.pdf', '.jpg', '.jpeg', '.png']);

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

function validateStudentFileUploads(files) {
    const errors = [];
    flattenUploadedFiles(files).forEach(file => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const allowed = imageUploadFields.has(file.fieldname) ? allowedImageExtensions : allowedDocumentExtensions;
        if (!studentDocumentFields.includes(file.fieldname) || !allowed.has(ext)) {
            errors.push(`${file.originalname} is not an allowed file type for ${file.fieldname.replace(/_/g, ' ')}.`);
        };
    });
    return errors;
};

function validateStudentAddBody(body) {
    const errors = [];
    const phone10 = value => !value || /^[6-9]\d{9}$/.test(String(value).trim());
    const aadhaar12 = value => !value || String(value).replace(/\D/g, '').length === 12;
    const validEmail = value => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());

    if (!String(body.first_name || '').trim()) errors.push('First name is required.');
    if (!String(body.last_name || '').trim()) errors.push('Last name is required.');
    if (!phone10(body.phone)) errors.push('Phone must be a valid 10-digit mobile number.');
    if (!String(body.phone || '').trim()) errors.push('Phone is required.');
    if (!String(body.password || '').trim()) errors.push('Password is required for direct student add.');
    if (!body.dob) errors.push('Date of birth is required.');
    if (!body.gender) errors.push('Gender is required.');
    if (!String(body.standard || '').trim()) errors.push('Standard is required.');
    if (!aadhaar12(body.aadhaar_no)) errors.push('Aadhaar No must be exactly 12 digits.');
    if (!aadhaar12(body.guardian_aadhaar)) errors.push('Guardian Aadhaar must be exactly 12 digits.');
    if (!phone10(body.father_phone)) errors.push("Father's phone must be a valid 10-digit mobile number.");
    if (!phone10(body.mother_phone)) errors.push("Mother's phone must be a valid 10-digit mobile number.");
    if (!phone10(body.guardian_phone)) errors.push("Guardian phone must be a valid 10-digit mobile number.");
    if (!validEmail(body.email)) errors.push('Student email must be valid if provided.');
    if (!validEmail(body.father_email)) errors.push("Father's email must be valid if provided.");
    if (!validEmail(body.mother_email)) errors.push("Mother's email must be valid if provided.");
    if (body.hostel_required === '1' || body.hostel_required === 'on') {
        if (!String(body.hostel_name || '').trim()) errors.push('Hostel name is required when hostel is required.');
        if (!String(body.hostel_room_no || '').trim()) errors.push('Hostel room no is required when hostel is required.');
        if (!String(body.hostel_phone_number || '').trim()) errors.push('Hostel phone is required when hostel is required.');
    };
    return errors;
};

exports.listStudents = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { search, class_id, status, page = 1 } = req.query;
        const limit = 15;
        const offset = (page - 1) * limit;
        let whereClause = 'WHERE s.school_id = ? AND s.deleted_at IS NULL';
        const params = [schoolId];

        if (search) {
            whereClause += ` AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR s.admission_no LIKE ? OR s.roll_no LIKE ?)`;
            const like = `%${search}%`;
            params.push(like, like, like, like, like);
        };

        if (class_id) {
            whereClause += ' AND s.class_id = ?';
            params.push(class_id);
        };

        if (status) {
            whereClause += ' AND s.status = ?';
            params.push(status);
        };

        const [students] = await db.query(`
            SELECT s.*, u.first_name as first_name, u.last_name as last_name, u.email, u.phone, u.image,
                CONCAT_WS(' - ', CONCAT('Class ', c.class_name), c.section, c.medium, NULLIF(c.stream, '')) as className,
                c.section, sf.father_name, sf.father_phone
            FROM students s
            JOIN users u ON s.user_id = u.id AND u.school_id = s.school_id
            LEFT JOIN classes c ON s.class_id = c.id AND c.school_id = s.school_id
            LEFT JOIN student_family sf ON s.id = sf.student_id
            ${whereClause}
            ORDER BY s.admission_no ASC
            LIMIT ? OFFSET ?
        `, [...params, limit, offset]);

        const [countResult] = await db.query(`
            SELECT COUNT(*) as total FROM students s
            JOIN users u ON s.user_id = u.id
            ${whereClause}
        `, params);
        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        const [classes] = await db.query(
            `SELECT id, CONCAT_WS(' - ', CONCAT('Class ', class_name), section, medium, NULLIF(stream, '')) as name
             FROM classes WHERE school_id = ? ORDER BY class_name, section`,
            [schoolId]
        );

        const [[{ unassignedCount }]] = await db.query(
            `SELECT COUNT(*) as unassignedCount FROM students WHERE school_id = ? AND class_id IS NULL AND status IN ('active','unassigned') AND deleted_at IS NULL`,
            [schoolId]
        );

        res.render('schoolAdmin/students/index', {
            title: 'Students',
            students,
            classes,
            search,
            class_id,
            status,
            currentPage: parseInt(page),
            totalPages,
            total,
            unassignedCount,
            user: req.user || req.session.user
        });
    } catch (error) {
        console.error('List Students Error:', error);
        req.flash('error', 'Failed to load students');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.showAddForm = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const [[school]] = await db.query(
            'SELECT school_type FROM schools WHERE id = ? LIMIT 1',
            [schoolId]
        );
        
        const schoolType = school?.school_type || 'complete';
        res.render('schoolAdmin/students/add', {
            title: 'Add Student',
            schoolType,
            user: req.user || req.session.user,
            old: {}
        });
    } catch (error) {
        console.error('Show Add Form Error:', error);
        req.flash('error', 'Failed to load form');
        res.redirect('/schooladmin/students');
    };
};

exports.createStudent = async (req, res) => {
    const connection = await db.getConnection();
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            req.flash('errors', errors.array());
            return res.redirect('/schooladmin/students/add');
        };

        const schoolId = getSchoolId(req);
        if (!schoolId) {
            req.flash('error', 'School ID not found');
            return res.redirect('/schooladmin/students/add');
        };

        const requestErrors = [
            ...validateStudentAddBody(req.body),
            ...validateStudentFileUploads(req.files)
        ];
        if (requestErrors.length > 0) {
            cleanupUploadedFiles(req.files);
            req.flash('error', requestErrors[0]);
            return res.redirect('/schooladmin/students/add');
        };

        const { first_name, last_name, email, phone, password, dob, gender, blood_group, aadhaar_no, religion, category, medical_notes, standard, father_name, father_phone, father_email, father_occupation, mother_name, mother_phone, mother_email, mother_occupation, guardian_name, guardian_relation, guardian_phone, guardian_occupation, guardian_aadhaar, permanent_address, permanent_city, permanent_state, permanent_pincode, current_address_same, current_address, current_city, current_state, current_pincode, transport_required, transport_mode, transport_route, transport_vehicle_no, hostel_required, hostel_name, hostel_room_no, hostel_phone_number } = req.body;
        await connection.beginTransaction();

        const [lastStudents] = await connection.query(
            "SELECT admission_no FROM students WHERE school_id = ? AND admission_no LIKE 'ADM%' ORDER BY id DESC LIMIT 1",
            [schoolId]
        );
        let nextNum = 40026;
        if (lastStudents.length > 0) {
            const lastNumParsed = parseInt(lastStudents[0].admission_no.replace('ADM', ''), 10);
            if (!isNaN(lastNumParsed)) nextNum = lastNumParsed + 1;
        };
        
        const generatedAdmissionDate = new Date().toISOString().split('T')[0];
        const generatedAdmissionNo = 'ADM' + String(nextNum).padStart(6, '0');
        const name = (first_name + ' ' + (last_name || '')).trim();
        const hashedPassword = await bcrypt.hash(password, 10);
        const standardValue = trimStandard(standard);
        const classNameForPortal = standardValue;
        const studentStatus = 'unassigned';
        const portalAccess = await portalService.getPortalAccess(schoolId, classNameForPortal, connection);
        const studentPortalEnabled = studentStatus === 'active' && portalAccess.studentPortal ? 1 : 0;
        const parentPortalEnabled = studentStatus === 'active' && portalAccess.parentPortal ? 1 : 0;
        const studentUserStatus = studentPortalEnabled ? 'active' : 'inactive';
        const studentEmail = email ? email.trim().toLowerCase() : null;

        const [userResult] = await connection.query(`
            INSERT INTO users (school_id, first_name, last_name, email, phone, password, role, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'student', ?, NOW())
        `, [schoolId, first_name, last_name, studentEmail, phone || null, hashedPassword, studentUserStatus]);
        
        const userId = userResult.insertId;
        const [studentResult] = await connection.query(`
            INSERT INTO students (
                school_id, user_id, class_id, standard, admission_no, roll_no, dob, gender,
                blood_group, aadhaar_no, religion, category, medical_notes,
                admission_date, status, student_portal_enabled, parent_portal_enabled, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `, [ schoolId, userId, null, standardValue, generatedAdmissionNo, null, dob || null, toStudentGender(gender), blood_group || null, aadhaar_no || null, religion || null, category || null, medical_notes || null, generatedAdmissionDate, studentStatus, studentPortalEnabled, parentPortalEnabled ]);
        const studentId = studentResult.insertId;

        await connection.query(`
            INSERT INTO student_family (
                student_id, father_name, father_phone, father_email, father_occupation,
                mother_name, mother_phone, mother_email, mother_occupation,
                guardian_name, guardian_relation, guardian_phone, guardian_occupation, guardian_aadhaar, school_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [ studentId, father_name || null, father_phone || null, father_email || null, father_occupation || null, mother_name || null, mother_phone || null, mother_email || null, mother_occupation || null, guardian_name || null, guardian_relation || null, guardian_phone || null, guardian_occupation || null, guardian_aadhaar || null, schoolId ]);

        const isCurrentSame = current_address_same === '1' || current_address_same === 'on' ? 1 : 0;
        await connection.query(`
            INSERT INTO student_address_transport (
                student_id, permanent_address, permanent_city, permanent_state, permanent_pincode,
                current_address_same, current_address, current_city, current_state, current_pincode,
                emergency_contact, transport_required, transport_mode, transport_route, transport_vehicle_no,
                hostel_required, hostel_name, hostel_room_no, hostel_phone_number
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            studentId, permanent_address || null, permanent_city || null, permanent_state || null, permanent_pincode || null,
            isCurrentSame,
            isCurrentSame ? permanent_address : (current_address || null),
            isCurrentSame ? permanent_city : (current_city || null),
            isCurrentSame ? permanent_state : (current_state || null),
            isCurrentSame ? permanent_pincode : (current_pincode || null),
            father_phone || mother_phone || guardian_phone || null,
            transport_required === '1' || transport_required === 'on' ? 1 : 0,
            transport_required === '1' || transport_required === 'on' ? (transport_mode || null) : null,
            transport_required === '1' || transport_required === 'on' ? (transport_route || null) : null,
            transport_required === '1' || transport_required === 'on' ? (transport_vehicle_no || null) : null,
            hostel_required === '1' || hostel_required === 'on' ? 1 : 0,
            hostel_required === '1' || hostel_required === 'on' ? (hostel_name || null) : null,
            hostel_required === '1' || hostel_required === 'on' ? (hostel_room_no || null) : null,
            hostel_required === '1' || hostel_required === 'on' ? (hostel_phone_number || null) : null
        ]);

        const uploadedFiles = flattenUploadedFiles(req.files);
        if (uploadedFiles.length > 0) {
            const docInserts = uploadedFiles.map(file => {
                let docType = 'medical';
                if (file.fieldname === 'student_image') docType = 'student_image';
                else if (file.fieldname === 'father_image') docType = 'father_image';
                else if (file.fieldname === 'mother_image') docType = 'mother_image';
                else if (file.fieldname === 'birth_certificate') docType = 'birth_certificate';
                else if (file.fieldname === 'aadhaar_card') docType = 'aadhaar_card';
                else if (file.fieldname === 'leaving_certificate') docType = 'leaving_certificate';
                else if (file.fieldname === 'previous_marksheet') docType = 'previous_marksheet';

                const fileUrl = `/uploads/students/${file.filename}`;
                return connection.query(`
                    INSERT INTO student_documents (student_id, document_type, document_name, file_url, file_path, uploaded_at)
                    VALUES (?, ?, ?, ?, ?, NOW())
                `, [studentId, docType, file.originalname, fileUrl, file.path]);
            });

            await Promise.all(docInserts);
            const studentImgFile = uploadedFiles.find(f => f.fieldname === 'student_image');
            if (studentImgFile) {
                await connection.query(
                    'UPDATE users SET image = ? WHERE id = ?',
                    [`/uploads/students/${studentImgFile.filename}`, userId]
                );
            };
        };

        if (classNameForPortal) {
            const { recomputePortalAccessForClass } = require('./portalController');
            await recomputePortalAccessForClass(schoolId, classNameForPortal, connection);
        };

        await connection.commit();
        await logSchoolActivity(req, {
            action: 'create_student',
            entityType: 'student',
            entityId: studentId,
            description: `Registered student ${name} with Admission No ${generatedAdmissionNo}`
        });

        req.flash('success', `Student ${name} added successfully (Admission No: ${generatedAdmissionNo})`);
        return res.redirect('/schooladmin/students');
    } catch (error) {
        await connection.rollback();
        console.error('Create Student Error:', error);
        cleanupUploadedFiles(req.files);

        req.flash('error', error.code === 'ER_DUP_ENTRY'
            ? 'Admission number already exists or email already registered'
            : 'Failed to add student: ' + error.message
        );
        return res.redirect('/schooladmin/students/add');
    } finally {
        connection.release();
    };
};

exports.showEditForm = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;
        const [students] = await db.query(`
            SELECT s.*, u.first_name as first_name, u.last_name as last_name, u.email, u.phone, u.image, u.status as user_status
            FROM students s
            JOIN users u ON s.user_id = u.id
            WHERE s.id = ? AND s.school_id = ? AND s.deleted_at IS NULL
        `, [id, schoolId]);

        if (!students.length) {
            req.flash('error', 'Student not found');
            return res.redirect('/schooladmin/students');
        };

        const student = students[0];
        student.first_name = student.first_name;
        student.last_name = student.last_name;
        student.roll_number = student.roll_no;
        student.admission_number = student.admission_no;
        student.aadhaar_number = student.aadhaar_no;
        student.photo = student.image;

        const [familyRows] = await db.query(
            'SELECT * FROM student_family WHERE student_id = ?',
            [id]
        );
        const family = familyRows[0] || {};
        student.father_name = family.father_name || '';
        student.father_phone = family.father_phone || '';
        student.father_email = family.father_email || '';
        student.father_occupation = family.father_occupation || '';
        student.mother_name = family.mother_name || '';
        student.mother_phone = family.mother_phone || '';
        student.mother_email = family.mother_email || '';
        student.mother_occupation = family.mother_occupation || '';
        student.guardian_name = family.guardian_name || '';
        student.guardian_relation = family.guardian_relation || '';
        student.guardian_phone = family.guardian_phone || '';
        student.guardian_occupation = family.guardian_occupation || '';
        student.guardian_aadhaar = family.guardian_aadhaar || '';

        const [addressRows] = await db.query(
            'SELECT * FROM student_address_transport WHERE student_id = ?',
            [id]
        );
        const addr = addressRows[0] || {};
        student.address = addr.permanent_address || '';
        student.city = addr.permanent_city || '';
        student.state = addr.permanent_state || '';
        student.pincode = addr.permanent_pincode || '';
        student.permanent_address = addr.permanent_address || '';
        student.permanent_city = addr.permanent_city || '';
        student.permanent_state = addr.permanent_state || '';
        student.permanent_pincode = addr.permanent_pincode || '';
        student.current_address_same = addr.current_address_same || 0;
        student.current_address = addr.current_address || '';
        student.current_city = addr.current_city || '';
        student.current_state = addr.current_state || '';
        student.current_pincode = addr.current_pincode || '';
        student.emergency_contact = addr.emergency_contact || '';
        student.transport_required = addr.transport_required || 0;
        student.transport_mode = addr.transport_mode || '';
        student.transport_route = addr.transport_route || '';
        student.transport_vehicle_no = addr.transport_vehicle_no || '';
        student.hostel_required = addr.hostel_required || 0;
        student.hostel_name = addr.hostel_name || '';
        student.hostel_room_no = addr.hostel_room_no || '';
        student.hostel_phone_number = addr.hostel_phone_number || '';

        const [documents] = await db.query(
            'SELECT * FROM student_documents WHERE student_id = ? ORDER BY uploaded_at DESC',
            [id]
        );
        student.documents = documents;
        
        const [[school]] = await db.query(
            'SELECT school_type FROM schools WHERE id = ? LIMIT 1',
            [schoolId]
        );
        const schoolType = school?.school_type || 'complete';
        
        const [classes] = await db.query(
            `SELECT MIN(id) as id, class_name, medium, stream,
                CONCAT_WS(' - ', CONCAT('Class ', class_name), medium, NULLIF(stream, '')) as display_name
            FROM classes
            WHERE school_id = ?
            GROUP BY class_name, medium, stream, academic_year
            ORDER BY class_name, medium, stream`,
            [schoolId]
        );

        let currentBaseClassId = null;
        let activeSections = [];
        if (student.class_id) {
            const [[studentClass]] = await db.query(
                'SELECT class_name, medium, stream, academic_year FROM classes WHERE id = ?',
                [student.class_id]
            );
            if (studentClass) {
                const [[baseClass]] = await db.query(
                    `SELECT id FROM classes
                    WHERE school_id = ? AND class_name = ? AND medium = ? AND stream <=> ? AND academic_year = ?
                    ORDER BY section ASC LIMIT 1`,
                    [schoolId, studentClass.class_name, studentClass.medium, studentClass.stream, studentClass.academic_year]
                );
                if (baseClass) {
                    currentBaseClassId = baseClass.id;
                    [activeSections] = await db.query(
                        `SELECT c.id, c.section AS name
                        FROM classes c
                        LEFT JOIN sections sec
                            ON sec.school_id = c.school_id
                            AND sec.class_id = c.id
                            AND sec.section_name = c.section
                        WHERE c.school_id = ?
                            AND c.class_name = ?
                            AND c.medium = ?
                            AND c.stream <=> ?
                            AND c.academic_year = ?
                            AND COALESCE(sec.status, 'active') = 'active'
                        ORDER BY c.section ASC`,
                        [schoolId, studentClass.class_name, studentClass.medium, studentClass.stream, studentClass.academic_year]
                    );
                };
            };
        };

        res.render('schoolAdmin/students/edit', {
            title: 'Edit Student',
            student,
            classes,
            currentBaseClassId,
            activeSections,
            schoolType,
            user: req.user || req.session.user
        });
    } catch (error) {
        console.error('Edit Form Error:', error);
        req.flash('error', 'Failed to load student data');
        res.redirect('/schooladmin/students');
    };
};

exports.updateStudent = async (req, res) => {
    const connection = await db.getConnection();
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            req.flash('errors', errors.array());
            return res.redirect(`/schooladmin/students/${req.params.id}/edit`);
        };

        const schoolId = getSchoolId(req);
        const { id } = req.params;
        const { first_name, last_name, email, phone, password, admission_no, roll_no, dob, gender, blood_group, aadhaar_no, religion, category, medical_notes, admission_date, class_id, status, father_name, father_phone, father_email, father_occupation, mother_name, mother_phone, mother_email, mother_occupation, guardian_name, guardian_relation, guardian_phone, guardian_occupation, guardian_aadhaar, permanent_address, permanent_city, permanent_state, permanent_pincode, current_address_same, current_address, current_city, current_state, current_pincode, emergency_contact, transport_required, transport_mode, transport_route, transport_vehicle_no, hostel_required, hostel_name, hostel_room_no, hostel_phone_number } = req.body;

        await connection.beginTransaction();
        const [students] = await connection.query(
            'SELECT user_id, class_id, standard FROM students WHERE id = ? AND school_id = ? AND deleted_at IS NULL',
            [id, schoolId]
        );
        if (!students.length) {
            await connection.rollback();
            req.flash('error', 'Student not found');
            return res.redirect('/schooladmin/students');
        };
        const userId = students[0].user_id;

        let oldClassName = null;
        if (students[0].class_id) {
            const [oldClass] = await connection.query('SELECT class_name FROM classes WHERE id = ? AND school_id = ?', [students[0].class_id, schoolId]);
            if (oldClass.length > 0) oldClassName = oldClass[0].class_name;
        } else if (students[0].standard) {
            oldClassName = students[0].standard;
        };

        const nextStatus = status || 'active';
        if (nextStatus === 'active' && !class_id) {
            await connection.rollback();
            req.flash('error', 'Class and section are required when student status is Active.');
            return res.redirect(`/schooladmin/students/${id}/edit`);
        };

        let userUpdateQuery = 'UPDATE users SET first_name = ?, last_name = ?, email = ?, phone = ?';
        const userParams = [first_name, last_name, email, phone];
        if (password && password.trim()) {
            const hashedPassword = await bcrypt.hash(password, 10);
            userUpdateQuery += ', password = ?';
            userParams.push(hashedPassword);
        };
        userUpdateQuery += ' WHERE id = ?';
        userParams.push(userId);
        await connection.query(userUpdateQuery, userParams);

        const studentClassId = nextStatus === 'unassigned' ? null : (class_id ? Number(class_id) : null);
        let standardValue = null;
        if (studentClassId) {
            const [[cls]] = await connection.query('SELECT class_name FROM classes WHERE id = ? AND school_id = ?', [studentClassId, schoolId]);
            if (cls) {
                standardValue = cls.class_name;
            } else {
                await connection.rollback();
                req.flash('error', 'Invalid class/section selected.');
                return res.redirect(`/schooladmin/students/${id}/edit`);
            };
        } else if (nextStatus === 'unassigned') {
            standardValue = students[0].standard || null;
        };

        await connection.query(`
            UPDATE students SET
                class_id = ?, standard = ?, admission_no = ?, roll_no = ?, dob = ?, gender = ?,
                blood_group = ?, aadhaar_no = ?, religion = ?, category = ?,
                medical_notes = ?, admission_date = ?, status = ?, 
                updated_at = NOW()
            WHERE id = ?
        `, [ studentClassId, standardValue, admission_no, roll_no || null, dob || null, gender ? gender.toLowerCase() : null, blood_group || null, aadhaar_no || null, religion || null, category || null, medical_notes || null, admission_date || null, nextStatus, id ]);

        const [familyExists] = await connection.query(
            'SELECT id FROM student_family WHERE student_id = ?', [id]
        );
        if (familyExists.length) {
            await connection.query(`
                UPDATE student_family SET
                    father_name = ?, father_phone = ?, father_email = ?, father_occupation = ?,
                    mother_name = ?, mother_phone = ?, mother_email = ?, mother_occupation = ?,
                    guardian_name = ?, guardian_relation = ?, guardian_phone = ?, guardian_occupation = ?, guardian_aadhaar = ?,
                    school_id = ?
                WHERE student_id = ?
            `, [ father_name || null, father_phone || null, father_email || null, father_occupation || null, mother_name || null, mother_phone || null, mother_email || null, mother_occupation || null, guardian_name || null, guardian_relation || null, guardian_phone || null, guardian_occupation || null, guardian_aadhaar || null, schoolId, id ]);
        } else {
            await connection.query(`
                INSERT INTO student_family (
                    student_id, father_name, father_phone, father_email, father_occupation,
                    mother_name, mother_phone, mother_email, mother_occupation,
                    guardian_name, guardian_relation, guardian_phone, guardian_occupation, guardian_aadhaar, school_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [ id, father_name || null, father_phone || null, father_email || null, father_occupation || null, mother_name || null, mother_phone || null, mother_email || null, mother_occupation || null, guardian_name || null, guardian_relation || null, guardian_phone || null, guardian_occupation || null, guardian_aadhaar || null, schoolId ]);
        };

        const isCurrentSame = current_address_same === '1' || current_address_same === 'on' ? 1 : 0;
        const [addrExists] = await connection.query(
            'SELECT id FROM student_address_transport WHERE student_id = ?', [id]
        );
        const transportEnabled = transport_required === '1' || transport_required === 'on' ? 1 : 0;
        if (addrExists.length) {
            await connection.query(`
                UPDATE student_address_transport SET
                    permanent_address = ?, permanent_city = ?, permanent_state = ?, permanent_pincode = ?,
                    current_address_same = ?, current_address = ?, current_city = ?, current_state = ?, current_pincode = ?,
                    emergency_contact = ?, transport_required = ?, transport_mode = ?, transport_route = ?, transport_vehicle_no = ?,
                    hostel_required = ?, hostel_name = ?, hostel_room_no = ?, hostel_phone_number = ?
                WHERE student_id = ?
            `, [ permanent_address || null, permanent_city || null, permanent_state || null, permanent_pincode || null, isCurrentSame, isCurrentSame ? permanent_address : (current_address || null), isCurrentSame ? permanent_city : (current_city || null), isCurrentSame ? permanent_state : (current_state || null), isCurrentSame ? permanent_pincode : (current_pincode || null), emergency_contact || null, transportEnabled, transportEnabled ? (transport_mode || null) : null, transportEnabled ? (transport_route || null) : null, transportEnabled ? (transport_vehicle_no || null) : null, hostel_required === '1' || hostel_required === 'on' ? 1 : 0, hostel_name || null, hostel_room_no || null, hostel_phone_number || null, id ]);
        } else {
            await connection.query(`
                INSERT INTO student_address_transport (
                    student_id, permanent_address, permanent_city, permanent_state, permanent_pincode,
                    current_address_same, current_address, current_city, current_state, current_pincode,
                    emergency_contact, transport_required, transport_mode, transport_route, transport_vehicle_no,
                    hostel_required, hostel_name, hostel_room_no, hostel_phone_number
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [ id, permanent_address || null, permanent_city || null, permanent_state || null, permanent_pincode || null, isCurrentSame, isCurrentSame ? permanent_address : (current_address || null), isCurrentSame ? permanent_city : (current_city || null), isCurrentSame ? permanent_state : (current_state || null), isCurrentSame ? permanent_pincode : (current_pincode || null), emergency_contact || null, transportEnabled, transportEnabled ? (transport_mode || null) : null, transportEnabled ? (transport_route || null) : null, transportEnabled ? (transport_vehicle_no || null) : null, hostel_required === '1' || hostel_required === 'on' ? 1 : 0, hostel_name || null, hostel_room_no || null, hostel_phone_number || null ]);
        };

        if (!transportEnabled) {
            await connection.query(`
                UPDATE student_transport_allocations
                SET status = 'inactive',
                    allocation_end_date = COALESCE(allocation_end_date, CURDATE()),
                    updated_by = ?
                WHERE school_id = ? AND student_id = ? AND status = 'active'
            `, [(req.user?.id || req.session.user?.id) || null, schoolId, id]);
        };

        if (req.files && req.files.length > 0) {
            const docInserts = req.files.map(file => {
                let docType = 'medical';
                if (file.fieldname === 'student_image') docType = 'student_image';
                else if (file.fieldname === 'father_image') docType = 'father_image';
                else if (file.fieldname === 'mother_image') docType = 'mother_image';
                else if (file.fieldname === 'birth_certificate') docType = 'birth_certificate';
                else if (file.fieldname === 'aadhaar_card') docType = 'aadhaar_card';
                else if (file.fieldname === 'leaving_certificate') docType = 'leaving_certificate';
                else if (file.fieldname === 'previous_marksheet') docType = 'previous_marksheet';

                return connection.query(`
                    INSERT INTO student_documents (student_id, document_type, document_name, file_url, file_path, uploaded_at)
                    VALUES (?, ?, ?, ?, ?, NOW())
                `, [id, docType, file.originalname, `/uploads/students/${file.filename}`, file.path]);
            });
            await Promise.all(docInserts);

            const studentImgFile = req.files.find(f => f.fieldname === 'student_image');
            if (studentImgFile) {
                await connection.query('UPDATE users SET image = ? WHERE id = ?', [`/uploads/students/${studentImgFile.filename}`, userId]);
            };
        };

        let newClassName = null;
        if (studentClassId) {
            const [newClass] = await connection.query('SELECT class_name FROM classes WHERE id = ? AND school_id = ?', [studentClassId, schoolId]);
            if (newClass.length > 0) newClassName = newClass[0].class_name;
        } else if (nextStatus !== 'unassigned') {
            newClassName = oldClassName;
        };

        const { recomputePortalAccessForClass } = require('./portalController');
        if (oldClassName) {
            await recomputePortalAccessForClass(schoolId, oldClassName, connection);
        };
        if (newClassName && newClassName !== oldClassName) {
            await recomputePortalAccessForClass(schoolId, newClassName, connection);
        };

        await connection.commit();
        await logSchoolActivity(req, {
            action: 'update_student',
            entityType: 'student',
            entityId: req.params.id,
            description: `Updated profile details for student with ID ${req.params.id}`
        });

        req.flash('success', 'Student updated successfully');
        res.redirect('/schooladmin/students');
    } catch (error) {
        await connection.rollback();
        console.error('Update Student Error:', error);

        if (req.files) {
            req.files.forEach(file => {
                if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
            });
        };

        req.flash('error', error.code === 'ER_DUP_ENTRY' ? 'Admission number or email already exists' : 'Failed to update student');
        res.redirect(`/schooladmin/students/${req.params.id}/edit`);
    } finally {
        connection.release();
    };
};

exports.viewStudent = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;
        const [students] = await db.query(`
            SELECT s.*, u.first_name as first_name, u.last_name as last_name, u.email, u.phone, u.image, u.status as user_status
            FROM students s
            JOIN users u ON s.user_id = u.id
            WHERE s.id = ? AND s.school_id = ? AND s.deleted_at IS NULL
        `, [id, schoolId]);

        if (!students.length) {
            req.flash('error', 'Student not found');
            return res.redirect('/schooladmin/students');
        }

        const student = students[0];
        student.first_name = student.first_name;
        student.last_name = student.last_name;
        student.roll_number = student.roll_no;
        student.admission_number = student.admission_no;
        student.aadhaar_number = student.aadhaar_no;
        student.photo = student.image;

        if (student.class_id) {
            const [classes] = await db.query(
                'SELECT * FROM classes WHERE id = ?', [student.class_id]
            );
            student.class = classes[0] || null;
            if (student.class) {
                student.class_name = student.class.class_name;
                student.section_name = student.class.section;
            };
        };

        const [familyRows] = await db.query(
            'SELECT * FROM student_family WHERE student_id = ?', [id]
        );
        const family = familyRows[0] || {};
        student.father_name = family.father_name || '';
        student.father_phone = family.father_phone || '';
        student.mother_name = family.mother_name || '';
        student.mother_phone = family.mother_phone || '';
        student.family = family;

        const [addressRows] = await db.query(
            'SELECT * FROM student_address_transport WHERE student_id = ?', [id]
        );
        const addr = addressRows[0] || {};
        student.address = addr.permanent_address || '';
        student.city = addr.permanent_city || '';
        student.state = addr.permanent_state || '';
        student.pincode = addr.permanent_pincode || '';

        const [documents] = await db.query(
            'SELECT * FROM student_documents WHERE student_id = ? ORDER BY uploaded_at DESC', [id]
        );
        student.documents = documents;
        student.documentsByType = {};
        documents.forEach(doc => {
            if (!student.documentsByType[doc.document_type]) {
                student.documentsByType[doc.document_type] = [];
            };
            student.documentsByType[doc.document_type].push(doc);
        });

        const [attendanceStats] = await db.query(`
            SELECT 
                COUNT(*) as total_days,
                SUM(CASE WHEN status IN ('present', 'late') THEN 1 ELSE 0 END) as present_days
            FROM attendance 
            WHERE student_id = ? AND school_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        `, [id, schoolId]);

        student.attendance = attendanceStats[0] || { total_days: 0, present_days: 0 };
        const [fees] = await db.query(`
            SELECT id, amount as total_amount, status, due_date, 'School Fee' as fee_name
            FROM fees
            WHERE student_id = ?
        `, [id]);

        res.render('schoolAdmin/students/view', {
            title: `Student: ${student.first_name} ${student.last_name || ''}`,
            student,
            fees,
            attendance: student.attendance,
            user: req.user || req.session.user
        });
    } catch (error) {
        console.error('View Student Error:', error);
        req.flash('error', 'Failed to load student profile');
        res.redirect('/schooladmin/students');
    };
};

exports.deleteStudent = async (req, res) => {
    const connection = await db.getConnection();
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;

        await connection.beginTransaction();
        const [studentRows] = await connection.query(
            'SELECT user_id, class_id, standard FROM students WHERE id = ? AND school_id = ? AND deleted_at IS NULL',
            [id, schoolId]
        );

        if (studentRows.length > 0) {
            const student = studentRows[0];
            let className = null;
            if (student.class_id) {
                const [classRows] = await connection.query('SELECT class_name FROM classes WHERE id = ?', [student.class_id]);
                if (classRows.length > 0) className = classRows[0].class_name;
            } else if (student.standard) {
                className = student.standard;
            };

            await connection.query(`
                UPDATE students 
                SET deleted_at = NOW(), status = 'left'
                WHERE id = ? AND school_id = ?
            `, [id, schoolId]);

            await connection.query(`
                UPDATE users SET status = 'inactive' WHERE id = ?
            `, [student.user_id]);

            if (className) {
                const { recomputePortalAccessForClass } = require('./portalController');
                await recomputePortalAccessForClass(schoolId, className, connection);
            };
        };

        await connection.commit();
        await logSchoolActivity(req, {
            action: 'delete_student',
            entityType: 'student',
            entityId: id,
            description: `Soft-deleted student account with ID ${id}`
        });

        req.flash('success', 'Student removed successfully');
        res.redirect('/schooladmin/students');
    } catch (error) {
        await connection.rollback();
        console.error('Delete Student Error:', error);
        req.flash('error', 'Failed to delete student');
        res.redirect('/schooladmin/students');
    } finally {
        connection.release();
    };
};

const getStudentAndSchoolDetails = async (id, schoolId) => {
    const [students] = await db.query(`
        SELECT s.*, u.first_name as first_name, u.last_name as last_name, u.image, c.class_name as class_name, c.section as section_name
        FROM students s
        JOIN users u ON s.user_id = u.id
        LEFT JOIN classes c ON s.class_id = c.id
        WHERE s.id = ? AND s.school_id = ? AND s.deleted_at IS NULL
    `, [id, schoolId]);

    if (!students.length) return null;

    const student = students[0];
    student.roll_number = student.roll_no;
    student.admission_number = student.admission_no;
    student.photo = student.image;

    const [familyRows] = await db.query(
        'SELECT * FROM student_family WHERE student_id = ?',
        [id]
    );
    const family = familyRows[0] || {};
    student.father_name = family.father_name || '';
    student.father_phone = family.father_phone || '';
    student.mother_name = family.mother_name || '';
    student.mother_phone = family.mother_phone || '';

    const [addressRows] = await db.query(
        'SELECT permanent_address FROM student_address_transport WHERE student_id = ?',
        [id]
    );
    const addr = addressRows[0] || {};
    student.permanent_address = addr.permanent_address || '';
    
    const [schools] = await db.query('SELECT * FROM schools WHERE id = ?', [schoolId]);
    const school = schools[0] || {};

    return { student, school };
};

const generateStudentIdCardPdf = async (student, school) => {
    const qrText = `VERIFY:ADM-${student.admission_number || student.id}:NAME-${student.first_name} ${student.last_name}:SCHOOL-${school.school_name || ''}`;
    const { generateIdCardPdf } = require('../../utils/pdfHelper');
    return await generateIdCardPdf({
        type: 'student',
        name: `${student.first_name} ${student.last_name}`,
        idNo: student.admission_number || student.id.toString(),
        frontDetail1: `${student.class_name || ''} - ${student.section_name || ''}`.trim() || 'N/A',
        frontDetail2: student.roll_number ? student.roll_number.toString() : 'N/A',
        frontDetail3: student.academic_year || '2026-2027',
        photo: student.photo,
        school,
        qrText,
        backDetail1: student.father_name || 'N/A',
        backDetail2: student.father_phone || student.mother_phone || 'N/A'
    });
};

exports.previewIdCard = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;

        const details = await getStudentAndSchoolDetails(id, schoolId);
        if (!details) {
            return res.status(404).send('Student not found or unauthorized');
        }

        const pdfDoc = await generateStudentIdCardPdf(details.student, details.school);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="student-id-card-${id}.pdf"`);
        pdfDoc.pipe(res);
        pdfDoc.end();
    } catch (err) {
        console.error('Student ID Card Preview Error:', err);
        res.status(500).send('Failed to generate ID card preview');
    }
};

exports.downloadIdCard = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;

        const details = await getStudentAndSchoolDetails(id, schoolId);
        if (!details) {
            req.flash('error', 'Student not found or unauthorized');
            return res.redirect('/schooladmin/students');
        }

        const pdfDoc = await generateStudentIdCardPdf(details.student, details.school);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="student-id-card-${id}.pdf"`);
        pdfDoc.pipe(res);
        pdfDoc.end();
    } catch (err) {
        console.error('Student ID Card Download Error:', err);
        req.flash('error', 'Failed to download ID card');
        res.redirect(`/schooladmin/students/${req.params.id}/view`);
    }
};

exports.generateIdCard = async (req, res) => {
    res.redirect(`/schooladmin/students/${req.params.id}/id-card/preview`);
};

exports.deleteDocument = async (req, res) => {
    try {
        const { docId } = req.params;
        const schoolId = getSchoolId(req);
        const [docs] = await db.query(`
            SELECT d.* FROM student_documents d
            JOIN students s ON d.student_id = s.id
            WHERE d.id = ? AND s.school_id = ?
        `, [docId, schoolId]);

        if (!docs.length) {
            req.flash('error', 'Document not found');
            return res.redirect('back');
        };

        const doc = docs[0];
        if (doc.file_path && fs.existsSync(doc.file_path)) {
            fs.unlinkSync(doc.file_path);
        };

        await db.query('DELETE FROM student_documents WHERE id = ?', [docId]);
        req.flash('success', 'Document deleted successfully');
        res.redirect(`/schooladmin/students/${doc.student_id}/edit`);
    } catch (error) {
        console.error('Delete Document Error:', error);
        req.flash('error', 'Failed to delete document');
        res.redirect('back');
    };
};

exports.listUnassigned = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { search, standard: stdFilter } = req.query;
        let whereClause = `WHERE s.school_id = ? AND s.class_id IS NULL AND s.status IN ('active','unassigned') AND s.deleted_at IS NULL`;
        const params = [schoolId];

        if (search) {
            whereClause += ` AND (u.first_name LIKE ? OR u.last_name LIKE ? OR s.admission_no LIKE ?)`;
            const like = `%${search}%`;
            params.push(like, like, like);
        };
        if (stdFilter) {
            whereClause += ` AND s.standard = ?`;
            params.push(stdFilter);
        };

        const [students] = await db.query(`
            SELECT s.id, s.admission_no, s.standard, s.dob, s.gender, s.admission_date, s.created_at,
                u.first_name as first_name, u.last_name as last_name, u.email, u.image,
                sf.father_name, sf.father_phone
            FROM students s
            JOIN users u ON s.user_id = u.id
            LEFT JOIN student_family sf ON s.id = sf.student_id
            ${whereClause}
            ORDER BY s.standard ASC, s.created_at ASC
        `, params);

        const [classes] = await db.query(
            `SELECT id, class_name, section,
                CONCAT_WS(' - ', CONCAT('Class ', class_name), section, medium, NULLIF(stream, '')) as display_name
            FROM classes WHERE school_id = ? ORDER BY class_name, section`,
            [schoolId]
        );

        const [standards] = await db.query(
            `SELECT DISTINCT standard FROM students WHERE school_id = ? AND class_id IS NULL AND deleted_at IS NULL AND standard IS NOT NULL ORDER BY standard`,
            [schoolId]
        );

        res.render('schoolAdmin/students/unassigned', {
            title: 'Unassigned Students',
            students,
            classes,
            standards,
            search: search || '',
            stdFilter: stdFilter || '',
            user: req.user || req.session.user,
            unassignedCount: students.length
        });
    } catch (error) {
        console.error('List Unassigned Error:', error);
        req.flash('error', 'Failed to load unassigned students');
        res.redirect('/schooladmin/students');
    };
};

exports.assignClass = async (req, res) => {
    const connection = await db.getConnection();
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;
        const { class_id, roll_no } = req.body;

        if (!class_id) {
            req.flash('error', 'Please select a class.');
            return res.redirect('/schooladmin/students/unassigned');
        };

        const [students] = await db.query(
            'SELECT id, standard FROM students WHERE id = ? AND school_id = ? AND deleted_at IS NULL',
            [id, schoolId]
        );
        if (!students.length) {
            req.flash('error', 'Student not found.');
            return res.redirect('/schooladmin/students/unassigned');
        };

        const [classes] = await db.query(
            `SELECT id, class_name, section, max_students,
                CONCAT_WS(' - ', CONCAT('Class ', class_name), section, medium, NULLIF(stream, '')) as display_name
            FROM classes WHERE id = ? AND school_id = ?`,
            [class_id, schoolId]
        );
        if (!classes.length) {
            req.flash('error', 'Invalid class selected.');
            return res.redirect('/schooladmin/students/unassigned');
        };
        const cls = classes[0];
        const studentStandard = normalizeStandard(students[0].standard);
        const selectedStandard = normalizeStandard(cls.class_name);
        if (studentStandard && selectedStandard && studentStandard !== selectedStandard) {
            req.flash('error', `Standard mismatch: this student applied for Class ${students[0].standard}, so they cannot be assigned to Class ${cls.class_name}.`);
            return res.redirect('/schooladmin/students/unassigned');
        };

        if (roll_no && roll_no.trim()) {
            const [rollCheck] = await db.query(
                'SELECT id FROM students WHERE class_id = ? AND roll_no = ? AND id != ? AND deleted_at IS NULL',
                [class_id, roll_no.trim(), id]
            );
            if (rollCheck.length) {
                req.flash('error', `Roll No "${roll_no}" is already assigned to another student in this class.`);
                return res.redirect('/schooladmin/students/unassigned');
            };
        };

        await connection.beginTransaction();
        await connection.query(
            "UPDATE students SET class_id = ?, roll_no = ?, status = 'active', updated_at = NOW() WHERE id = ? AND school_id = ?",
            [class_id, roll_no ? roll_no.trim() : null, id, schoolId]
        );

        await connection.query(
            `UPDATE classes SET current_students = (
                SELECT COUNT(*) FROM students WHERE class_id = ? AND deleted_at IS NULL AND status = 'active'
            ) WHERE id = ?`,
            [class_id, class_id]
        );

        await connection.commit();
        const classNameText = cls.display_name || `${cls.class_name} - ${cls.section || ''}`;
        req.flash('success', `Student assigned to ${classNameText} successfully!`);
        res.redirect('/schooladmin/students/unassigned');
    } catch (error) {
        await connection.rollback();
        console.error('Assign Class Error:', error);
        req.flash('error', 'Failed to assign class: ' + error.message);
        res.redirect('/schooladmin/students/unassigned');
    } finally {
        connection.release();
    };
};