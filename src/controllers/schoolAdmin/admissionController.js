const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const AdmissionModel = require('../../models/admissionModel');
const db = require('../../config/database');
const PortalService = require('../../services/portalService');
const NotificationModel = require('../../models/notificationModel');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

async function sendAdmissionEmail(to, subject, html) {
    try {
        await transporter.sendMail({
            from: `"SchoolSync Admissions" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            html,
        });
    } catch (err) {
        console.error('Admission email error:', err.message);
    }
}

async function sendParentCredentialsEmailAtAdmission(email, name, password, studentName) {
    const loginUrl = process.env.BASE_URL || 'http://localhost:4000';
    const html = `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;background:#f4f7f9;padding:40px 20px;">
        <table align="center" style="max-width:520px;width:100%;background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.08);overflow:hidden;">
            <tr>
                <td style="background:linear-gradient(135deg,#667eea,#764ba2);padding:30px;text-align:center;">
                    <h1 style="color:#fff;margin:0;font-size:22px;">Welcome to Parent Portal!</h1>
                </td>
            </tr>
            <tr>
                <td style="padding:30px 35px;">
                    <p style="font-size:15px;color:#444;">Dear <b>${name}</b>,</p>
                    <p style="font-size:15px;color:#555;">An account has been created for you to access the SchoolSync Parent Portal. You can log in to view the attendance, homework, notices, and fees details of your child: <b>${studentName}</b>.</p>
                    <div style="background:#f0fff4;border:2px solid #38ef7d;border-radius:10px;padding:20px 25px;margin:20px 0;">
                        <p style="margin:0 0 10px;font-size:15px;font-weight:700;color:#11998e;">🔑 Your Login Credentials</p>
                        <table style="width:100%;border-collapse:collapse;font-size:14px;color:#444;">
                            <tr>
                                <td style="padding:5px 0;"><b>Login URL:</b></td><td style="padding:5px 0;"><a href="${loginUrl}/login">${loginUrl}/login</a></td>
                            </tr>
                            <tr>
                                <td style="padding:5px 0;"><b>Email:</b></td><td style="padding:5px 0;">${email}</td>
                            </tr>
                            <tr>
                                <td style="padding:5px 0;"><b>Temp Password:</b></td>
                                <td style="padding:5px 0;font-family:monospace;background:#e8f5e9;padding:2px 8px;border-radius:4px;">${password}</td>
                            </tr>
                        </table>
                        <p style="margin:10px 0 0;font-size:12px;color:#888;">Please change your password after your first login.</p>
                    </div>
                    <p style="font-size:13px;color:#888;">If you have any questions, please contact the school administration.</p>
                </td>
            </tr>
            <tr>
                <td style="background:#f8f9fa;padding:15px;text-align:center;">
                    <p style="font-size:12px;color:#aaa;margin:0;">This is an automated email from SchoolSync. Please do not reply.</p>
                </td>
            </tr>
        </table>
    </div>`;
    
    try {
        await transporter.sendMail({
            from: `"SchoolSync Admissions" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: `🔑 Parent Portal Credentials – SchoolSync`,
            html,
        });
    } catch (err) {
        console.error('Parent credentials email error:', err.message);
    };
};

const { queryAsync } = require('../../config/database');
async function getSchoolAdminEmail(schoolId) {
    const rows = await queryAsync(
        `SELECT school_email FROM schools WHERE id = ? LIMIT 1`,
        [schoolId]
    );
    return rows[0]?.school_email || null;
};

function normalizeStandard(value) {
    return String(value || '').trim().replace(/^std\.?\s*/i, '').replace(/^class\s*/i, '').toLowerCase();
};

function trimStandard(value) {
    return String(value || '').trim();
};

function trimOrNull(value) {
    const trimmed = String(value || '').trim();
    return trimmed || null;
};

const studentDocumentFields = [
    'student_image', 'father_image', 'mother_image',
    'birth_certificate', 'aadhaar_card', 'leaving_certificate', 'previous_marksheet'
];
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
            try { fs.unlinkSync(file.path); } catch (e) {}
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

function validateStudentAdmissionBody(body) {
    const errors = [];
    const phone10 = value => !value || /^[6-9]\d{9}$/.test(String(value).trim());
    const aadhaar12 = value => !value || String(value).replace(/\D/g, '').length === 12;
    const validEmail = value => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());

    if (!String(body.first_name || '').trim()) errors.push('First name is required.');
    if (!String(body.last_name || '').trim()) errors.push('Last name is required.');
    if (!String(body.email || '').trim()) errors.push('Email is required.');
    if (!String(body.phone || '').trim()) errors.push('Phone is required.');
    if (!phone10(body.phone)) errors.push('Phone must be a valid 10-digit mobile number.');
    if (!(body.dob || body.date_of_birth)) errors.push('Date of birth is required.');
    if (!body.gender) errors.push('Gender is required.');
    if (!String(body.standard || body.class_applied || '').trim()) errors.push('Standard is required.');
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
    }

    return errors;
};

async function getNextAdmissionNo(connection, schoolId) {
    const [lastStudents] = await connection.query(
        "SELECT admission_no FROM students WHERE school_id = ? AND admission_no LIKE 'ADM%' ORDER BY id DESC LIMIT 1",
        [schoolId]
    );

    let nextNum = 40001;
    if (lastStudents.length > 0) {
        const lastNum = parseInt(String(lastStudents[0].admission_no || '').replace('ADM', ''), 10);
        if (!isNaN(lastNum)) nextNum = lastNum + 1;
    };

    return 'ADM' + String(nextNum).padStart(6, '0');
};

async function validateFinalAcademicAssignment(connection, schoolId, body) {
    const errors = [];
    const classId = Number.parseInt(body.class_id, 10);
    const admissionNo = trimOrNull(body.admission_no);
    const rollNo = trimOrNull(body.roll_no);

    if (!classId) errors.push('Class and section assignment is required.');
    if (!admissionNo) errors.push('Admission No / GR No is required.');
    if (rollNo && !/^\d+$/.test(rollNo)) errors.push('Roll No must be numeric.');

    let selectedClass = null;
    if (classId) {
        const [classRows] = await connection.query(
            `SELECT id, class_name, section, medium, academic_year, max_students,
                    CONCAT_WS(' - ', CONCAT('Class ', class_name), section, medium, NULLIF(stream, '')) AS display_name
             FROM classes
             WHERE id = ? AND school_id = ?
             LIMIT 1`,
            [classId, schoolId]
        );
        selectedClass = classRows[0] || null;
        if (!selectedClass) {
            errors.push('Selected class/section does not belong to this school.');
        } else {
            if (!selectedClass.section) errors.push('Section is required for final assignment.');
            if (!selectedClass.academic_year) errors.push('Academic year is required for final assignment.');
            if (!selectedClass.medium) errors.push('Medium is required for final assignment.');
        };
    };

    if (admissionNo) {
        const [existingAdmissionNo] = await connection.query(
            `SELECT id FROM students
             WHERE school_id = ? AND admission_no = ? AND deleted_at IS NULL
             LIMIT 1`,
            [schoolId, admissionNo]
        );
        if (existingAdmissionNo.length) {
            errors.push('Admission No / GR No already exists in this school.');
        };
    };

    if (selectedClass && rollNo) {
        const [existingRollNo] = await connection.query(
            `SELECT id FROM students
             WHERE school_id = ? AND class_id = ? AND roll_no = ? AND deleted_at IS NULL
             LIMIT 1`,
            [schoolId, selectedClass.id, rollNo]
        );
        if (existingRollNo.length) {
            errors.push(`Roll No ${rollNo} is already assigned in ${selectedClass.display_name}.`);
        };
    };

    return { errors, selectedClass, admissionNo, rollNo };
};

function toStudentGender(value) {
    const gender = String(value || '').trim().toLowerCase();
    if (gender === 'male') return 'Male';
    if (gender === 'female') return 'Female';
    return null;
};

async function notifySchoolAdmins(schoolId, { title, message, referenceType, referenceId, actionUrl }) {
    try {
        const admins = await queryAsync(
            `SELECT id FROM users WHERE school_id = ? AND role = 'school_admin' AND status = 'active' AND deleted_at IS NULL`,
            [schoolId]
        );
        await Promise.all(admins.map(admin => NotificationModel.create({
            recipient_id: admin.id,
            recipient_role: 'school_admin',
            school_id: schoolId,
            title,
            message,
            type: 'info',
            category: 'academic',
            reference_type: referenceType,
            reference_id: referenceId,
            action_url: actionUrl
        })));
    } catch (err) {
        console.error('Admission admin notification error:', err.message);
    };
};

exports.showQRPage = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const tokens = await AdmissionModel.listQRTokens(schoolId);
        const counts = await AdmissionModel.countByStatus(schoolId);
        const studentToken = await AdmissionModel.getActiveToken(schoolId, 'student');
        const teacherToken = await AdmissionModel.getActiveToken(schoolId, 'teacher');
        const driverToken = await AdmissionModel.getActiveToken(schoolId, 'driver');
        const baseUrl = `${req.protocol}://${req.get('host')}`;

        let studentQrDataUrl = null;
        let studentGeneratedLink = null;
        if (studentToken) {
            studentGeneratedLink = `${baseUrl}/admission/student?token=${studentToken.token}&school=${schoolId}`;
            studentQrDataUrl = await QRCode.toDataURL(studentGeneratedLink, {
                width: 300,
                margin: 2,
                color: { dark: '#1a1a2e', light: '#ffffff' },
            });
        };

        let teacherQrDataUrl = null;
        let teacherGeneratedLink = null;
        if (teacherToken) {
            teacherGeneratedLink = `${baseUrl}/admission/teacher?token=${teacherToken.token}&school=${schoolId}`;
            teacherQrDataUrl = await QRCode.toDataURL(teacherGeneratedLink, {
                width: 300,
                margin: 2,
                color: { dark: '#1a1a2e', light: '#ffffff' },
            });
        };

        let driverQrDataUrl = null;
        let driverGeneratedLink = null;
        if (driverToken) {
            driverGeneratedLink = `${baseUrl}/admission/driver?token=${driverToken.token}&school=${schoolId}`;
            driverQrDataUrl = await QRCode.toDataURL(driverGeneratedLink, {
                width: 300,
                margin: 2,
                color: { dark: '#1a1a2e', light: '#ffffff' },
            });
        };

        res.render('schoolAdmin/admissions/qr', {
            title: 'Admission QR Codes',
            tokens,
            counts,
            studentQrDataUrl,
            studentGeneratedLink,
            teacherQrDataUrl,
            teacherGeneratedLink,
            driverQrDataUrl,
            driverGeneratedLink,
            success: req.flash('success'),
            error: req.flash('error'),
        });
    } catch (err) {
        console.error('showQRPage error:', err);
        req.flash('error', 'Failed to load QR page.');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.generateQR = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const role = 'student';
        const token = uuidv4();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const expiresAtMysql = expiresAt.toISOString().slice(0, 19).replace('T', ' ');

        await AdmissionModel.createQRToken(schoolId, role, token, expiresAtMysql);

        req.flash('success', 'Student Admission QR Code generated successfully! Valid for 7 days.');
        res.redirect('/schooladmin/admissions/qr');
    } catch (err) {
        console.error('generateQR error:', err);
        req.flash('error', 'Failed to generate QR code.');
        res.redirect('/schooladmin/admissions/qr');
    };
};

exports.showStudentForm = async (req, res) => {
    try {
        const { token, school: schoolId } = req.query;

        if (!token || !schoolId) {
            return res.render('admission/error', {
                layout: false,
                title: 'Invalid Link',
                message: 'This admission link is invalid or incomplete.',
            });
        };

        const qrToken = await AdmissionModel.getQRToken(token);
        if (!qrToken || qrToken.school_id != schoolId) {
            return res.render('admission/error', {
                layout: false,
                title: 'Link Expired or Invalid',
                message: 'This admission link has expired or already been used. Please contact the school for a new link.',
            });
        };

        const flashError = req.flash('error');
        res.render('admission/student-form', {
            layout: false,
            title: 'Student Admission Form',
            school: qrToken,
            token,
            schoolId,
            errors: flashError && flashError.length > 0 ? flashError : [],
            old: {},
        });
    } catch (err) {
        console.error('showStudentForm error:', err);
        res.render('admission/error', {
            layout: false,
            title: 'Server Error',
            message: 'Something went wrong. Please try again later.',
        });
    };
};

exports.submitStudentForm = async (req, res) => {
    try {
        const { token, school_id } = req.body;
        const qrToken = await AdmissionModel.getQRToken(token);
        if (!qrToken || qrToken.school_id != school_id) {
            return res.render('admission/error', {
                layout: false,
                title: 'Invalid Submission',
                message: 'This admission link has expired. Please request a new QR code from your school.',
            });
        };

        const errors = [];
        const { first_name, last_name, email, phone, dob, date_of_birth, gender, blood_group, aadhaar_no, religion, category, medical_notes, father_name, father_phone, father_email, father_occupation, mother_name, mother_phone, mother_email, mother_occupation, guardian_name, guardian_phone, guardian_relation, guardian_occupation, guardian_aadhaar, permanent_address, permanent_city, permanent_state, permanent_pincode, current_address_same, current_address, current_city, current_state, current_pincode, transport_required, transport_mode, transport_route, transport_vehicle_no, hostel_required, hostel_name, hostel_room_no, hostel_phone_number, standard, class_applied } = req.body;
        const forbiddenAcademicFields = ['section_id', 'sectionId', 'roll_no', 'rollNo', 'admission_no', 'admissionNo', 'academic_year', 'academicYear'];
        const hasForbiddenAcademicField = forbiddenAcademicFields.some(field => req.body[field]);
        const submittedDob = dob || date_of_birth;
        const appliedStandard = trimStandard(standard || class_applied);
        errors.push(...validateStudentAdmissionBody(req.body));
        errors.push(...validateStudentFileUploads(req.files));
        if (hasForbiddenAcademicField) errors.push('Section, roll number, admission number, and academic year are assigned by the school admin.');

        if (errors.length > 0) {
            cleanupUploadedFiles(req.files);
            return res.render('admission/student-form', {
                layout: false,
                title: 'Student Admission Form',
                school: qrToken,
                token,
                schoolId: school_id,
                errors,
                old: req.body,
            });
        };

        const full_name = (first_name + ' ' + (last_name || '')).trim();

        const extraData = {
            first_name: first_name ? first_name.trim() : '',
            last_name: last_name ? last_name.trim() : '',
            aadhaar_no: aadhaar_no ? aadhaar_no.trim() : null,
            religion: religion ? religion.trim() : null,
            category: category || null,
            medical_notes: medical_notes ? medical_notes.trim() : null,
            father_name: father_name ? father_name.trim() : null,
            father_phone: father_phone ? father_phone.trim() : null,
            father_email: father_email ? father_email.trim() : null,
            father_occupation: father_occupation ? father_occupation.trim() : null,
            mother_name: mother_name ? mother_name.trim() : null,
            mother_phone: mother_phone ? mother_phone.trim() : null,
            mother_email: mother_email ? mother_email.trim() : null,
            mother_occupation: mother_occupation ? mother_occupation.trim() : null,
            guardian_occupation: guardian_occupation ? guardian_occupation.trim() : null,
            guardian_aadhaar: guardian_aadhaar ? guardian_aadhaar.trim() : null,
            permanent_address: permanent_address ? permanent_address.trim() : null,
            permanent_city: permanent_city ? permanent_city.trim() : null,
            permanent_state: permanent_state ? permanent_state.trim() : null,
            permanent_pincode: permanent_pincode ? permanent_pincode.trim() : null,
            current_address_same: current_address_same === '1' || current_address_same === 'on' ? 1 : 0,
            current_address: current_address ? current_address.trim() : null,
            current_city: current_city ? current_city.trim() : null,
            current_state: current_state ? current_state.trim() : null,
            current_pincode: current_pincode ? current_pincode.trim() : null,
            transport_required: transport_required === '1' || transport_required === 'on' ? 1 : 0,
            transport_mode: transport_mode || null,
            transport_route: transport_route ? transport_route.trim() : null,
            transport_vehicle_no: transport_vehicle_no ? transport_vehicle_no.trim() : null,
            hostel_required: hostel_required === '1' || hostel_required === 'on' ? 1 : 0,
            hostel_name: hostel_name ? hostel_name.trim() : null,
            hostel_room_no: hostel_room_no ? hostel_room_no.trim() : null,
            hostel_phone_number: hostel_phone_number ? hostel_phone_number.trim() : null,
            applied_standard: appliedStandard,
            files: {}
        };

        if (req.files) {
            const fileFields = [
                'student_image', 'father_image', 'mother_image', 
                'birth_certificate', 'aadhaar_card', 'leaving_certificate', 'previous_marksheet'
            ];
            fileFields.forEach(field => {
                if (req.files[field] && req.files[field][0]) {
                    const file = req.files[field][0];
                    extraData.files[field] = {
                        filename: file.filename,
                        originalname: file.originalname,
                        path: file.path,
                        mimetype: file.mimetype,
                        size: file.size
                    };
                };
            });
        };

        const createdRequest = await AdmissionModel.createAdmissionRequest({
            school_id: qrToken.school_id,
            role: 'student',
            token,
            full_name: full_name,
            email: email.trim().toLowerCase(),
            phone: phone.trim(),
            date_of_birth: submittedDob || null,
            gender: gender || null,
            address: permanent_address ? permanent_address.trim() : null,
            class_applied: appliedStandard,
            applied_standard: appliedStandard,
            applied_class_id: null,
            guardian_name: guardian_name ? guardian_name.trim() : null,
            guardian_phone: guardian_phone ? guardian_phone.trim() : null,
            guardian_relation: guardian_relation ? guardian_relation.trim() : null,
            blood_group: blood_group ? blood_group.trim() : null,
            previous_school: null,
            extra_data: extraData
        });

        await AdmissionModel.markTokenUsed(token);
        await notifySchoolAdmins(qrToken.school_id, {
            title: 'Student admission request submitted',
            message: `${full_name} submitted a student admission request for Class ${appliedStandard || 'not selected'}.`,
            referenceType: 'admission_request',
            referenceId: createdRequest.insertId,
            actionUrl: '/schooladmin/admissions'
        });

        await sendAdmissionEmail(
            email,
            `Admission Request Received – ${qrToken.school_name}`,
            admissionReceivedHtml(full_name, qrToken.school_name)
        );

        const adminEmail = await getSchoolAdminEmail(qrToken.school_id);
        if (adminEmail) {
            const reviewUrl = `${process.env.BASE_URL || 'http://localhost:4000'}/schooladmin/admissions`;
            await sendAdmissionEmail(
                adminEmail,
                `New Admission Request from ${full_name}`,
                adminNotificationHtml({
                    name: full_name,
                    email,
                    phone,
                    schoolName: qrToken.school_name,
                    classApplied: appliedStandard,
                    submittedAt: new Date(),
                    reviewUrl
                })
            );
        };

        res.render('admission/success', {
            layout: false,
            title: 'Application Submitted',
            schoolName: qrToken.school_name,
            applicantName: full_name,
            applicantEmail: email,
        });
    } catch (err) {
        console.error('submitStudentForm error:', err);
        res.render('admission/error', {
            layout: false,
            title: 'Submission Failed',
            message: 'We could not save your application. Please try again or contact the school directly.',
        });
    };
};

exports.listAdmissions = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const status = req.query.status || null;
        const admissions = await AdmissionModel.listAdmissionRequests(schoolId, status);
        const counts = await AdmissionModel.countByStatus(schoolId);

        res.render('schoolAdmin/admissions/list', {      
            title: 'Admission Requests',
            admissions,
            counts,
            currentStatus: status,
            success: req.flash('success'),
            error: req.flash('error'),
        });
    } catch (err) {
        console.error('listAdmissions error:', err);
        req.flash('error', 'Failed to load admissions.');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.viewAdmission = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const admission = await AdmissionModel.getAdmissionRequest(req.params.id, schoolId);

        if (!admission) {
            req.flash('error', 'Admission request not found.');
            return res.redirect('/schooladmin/admissions');
        };

        const classes = await queryAsync(
            `SELECT MIN(id) AS id, class_name, medium, stream, academic_year,
                CONCAT_WS(' - ', CONCAT('Class ', class_name), medium, NULLIF(stream, '')) AS display_name
            FROM classes
            WHERE school_id = ?
            GROUP BY class_name, medium, stream, academic_year
            ORDER BY class_name, medium, stream`,
            [req.user.school_id]
        );
        const suggestedAdmissionNo = await getNextAdmissionNo(db, schoolId);

        res.render('schoolAdmin/admissions/view', {
            title: 'Admission Detail',
            admission,
            classes,
            suggestedAdmissionNo,
            success: req.flash('success'),
            error: req.flash('error'),
        });
    } catch (err) {
        console.error('viewAdmission error:', err);
        req.flash('error', 'Failed to load admission detail.');
        res.redirect('/schooladmin/admissions');
    };
};

exports.approveAdmission = async (req, res) => {
    const connection = await db.getConnection();
    try {
        const schoolId = req.user.school_id;
        const { admin_note } = req.body;
        const admission = await AdmissionModel.getAdmissionRequest(req.params.id, schoolId);

        if (!admission) {
            req.flash('error', 'Admission request not found.');
            return res.redirect('/schooladmin/admissions');
        };

        if (admission.status !== 'pending') {
            req.flash('error', 'This admission request has already been processed.');
            return res.redirect('/schooladmin/admissions');
        };

        const assignment = await validateFinalAcademicAssignment(connection, schoolId, req.body);
        if (assignment.errors.length > 0) {
            req.flash('error', assignment.errors[0]);
            return res.redirect(`/schooladmin/admissions/${req.params.id}`);
        };
        const appliedStandard = normalizeStandard(admission.applied_standard || admission.class_applied);
        const selectedStandard = normalizeStandard(assignment.selectedClass.class_name);
        if (appliedStandard && selectedStandard && appliedStandard !== selectedStandard) {
            req.flash('error', `Standard mismatch: applicant applied for Class ${admission.applied_standard || admission.class_applied}, so assign a matching class.`);
            return res.redirect(`/schooladmin/admissions/${req.params.id}`);
        };

        const [existingUsers] = await db.query(
            'SELECT id FROM users WHERE email = ? AND school_id = ? AND deleted_at IS NULL LIMIT 1',
            [admission.email, schoolId]
        );

        if (existingUsers.length > 0) {
            req.flash('error', 'A user with this email already exists. Admission was not approved.');
            return res.redirect('/schooladmin/admissions');
        };

        if (existingUsers.length === 0) {
            await connection.beginTransaction();
            const nameParts = (admission.full_name || '').trim().split(' ');
            const first_name = nameParts[0] || admission.full_name;
            const last_name  = nameParts.slice(1).join(' ') || '';
            const assignedClass = assignment.selectedClass;
            const standard = trimStandard(admission.applied_standard || admission.class_applied || assignedClass.class_name);
            const classNameForPortal = assignedClass.class_name || standard || admission.applied_standard || admission.class_applied || 'Std 1';
            const portalSettings = await PortalService.getPortalAccess(schoolId, classNameForPortal, connection);
            const tempPassword = 'Student@' + Math.random().toString(36).slice(-6).toUpperCase();
            const hashedPassword = await bcrypt.hash(tempPassword, 10);
            const [userResult] = await connection.query(`
                INSERT INTO users (school_id, first_name, last_name, email, phone, password, role, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 'student', ?, NOW())
            `, [schoolId, first_name, last_name, admission.email, admission.phone || null, hashedPassword, portalSettings.studentPortal ? 'active' : 'inactive']);
            const userId = userResult.insertId;
            const admissionNo = assignment.admissionNo;

            let extra = admission.extra_data;
            if (typeof extra === 'string') {
                try { extra = JSON.parse(extra); } catch (e) { extra = {}; }
            }
            extra = extra || {};

            const [studentResult] = await connection.query(`
                INSERT INTO students (
                    school_id, user_id, class_id, standard, admission_no, dob, gender,
                    blood_group, aadhaar_no, religion, category, medical_notes,
                    admission_date, status, student_portal_enabled, parent_portal_enabled, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), 'active', ?, ?, NOW())
            `, [ schoolId, userId, assignedClass.id, standard, admissionNo, admission.date_of_birth || null, toStudentGender(admission.gender), admission.blood_group || null, extra.aadhaar_no || null, extra.religion || null, extra.category || null, extra.medical_notes || null, portalSettings.studentPortal ? 1 : 0, portalSettings.parentPortal ? 1 : 0]);
            const studentId = studentResult.insertId;

            if (assignment.rollNo) {
                await connection.query(
                    'UPDATE students SET roll_no = ? WHERE id = ? AND school_id = ?',
                    [assignment.rollNo, studentId, schoolId]
                );
            }

            await connection.query(`
                INSERT INTO student_family (
                    student_id, father_name, father_phone, father_email, father_occupation,
                    mother_name, mother_phone, mother_email, mother_occupation,
                    guardian_name, guardian_relation, guardian_phone, guardian_email, guardian_occupation, guardian_aadhaar, school_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [ studentId,  extra.father_name || null, extra.father_phone || null, extra.father_email || null, extra.father_occupation || null, extra.mother_name || null, extra.mother_phone || null, extra.mother_email || null, extra.mother_occupation || null, admission.guardian_name || extra.guardian_name || null, admission.guardian_relation || extra.guardian_relation || null,  admission.guardian_phone || extra.guardian_phone || null, extra.guardian_email || null, extra.guardian_occupation || null, extra.guardian_aadhaar || null, schoolId ]);

            const isCurrentSame = extra.current_address_same === 1 || extra.current_address_same === '1' ? 1 : 0;
            await connection.query(`
                INSERT INTO student_address_transport (
                    student_id, permanent_address, permanent_city, permanent_state, permanent_pincode,
                    current_address_same, current_address, current_city, current_state, current_pincode,
                    emergency_contact, transport_required, transport_mode, transport_route, transport_vehicle_no,
                    hostel_required, hostel_name, hostel_room_no, hostel_phone_number
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [ studentId, extra.permanent_address || admission.address || null, extra.permanent_city || null, extra.permanent_state || null, extra.permanent_pincode || null, isCurrentSame, isCurrentSame ? (extra.permanent_address || admission.address || null) : (extra.current_address || null), isCurrentSame ? (extra.permanent_city || null) : (extra.current_city || null), isCurrentSame ? (extra.permanent_state || null) : (extra.current_state || null), isCurrentSame ? (extra.permanent_pincode || null) : (extra.current_pincode || null), extra.father_phone || extra.mother_phone || admission.guardian_phone || null, extra.transport_required === 1 || extra.transport_required === '1' ? 1 : 0, extra.transport_mode || null, extra.transport_route || null, extra.transport_vehicle_no || null, extra.hostel_required === 1 || extra.hostel_required === '1' ? 1 : 0, extra.hostel_name || null, extra.hostel_room_no || null, extra.hostel_phone_number || null ]);

            if (extra.files && Object.keys(extra.files).length > 0) {
                const docInserts = Object.keys(extra.files).map(field => {
                    const file = extra.files[field];
                    let docType = 'medical';
                    if (field === 'student_image') docType = 'student_image';
                    else if (field === 'father_image') docType = 'father_image';
                    else if (field === 'mother_image') docType = 'mother_image';
                    else if (field === 'birth_certificate') docType = 'birth_certificate';
                    else if (field === 'aadhaar_card') docType = 'aadhaar_card';
                    else if (field === 'leaving_certificate') docType = 'leaving_certificate';
                    else if (field === 'previous_marksheet') docType = 'previous_marksheet';

                    const fileUrl = `/uploads/students/${file.filename}`;
                    return connection.query(`
                        INSERT INTO student_documents (student_id, document_type, document_name, file_url, file_path, uploaded_at)
                        VALUES (?, ?, ?, ?, ?, NOW())
                    `, [studentId, docType, file.originalname, fileUrl, file.path]);
                });
                
                await Promise.all(docInserts);
                if (extra.files.student_image) {
                    await connection.query(
                        'UPDATE users SET image = ? WHERE id = ?',
                        [`/uploads/students/${extra.files.student_image.filename}`, userId]
                    );
                };
            };

            if (portalSettings.parentPortal) {
                const parentEmails = [];
                if (extra.father_email) parentEmails.push({ email: extra.father_email.trim().toLowerCase(), name: extra.father_name, phone: extra.father_phone });
                if (extra.mother_email) parentEmails.push({ email: extra.mother_email.trim().toLowerCase(), name: extra.mother_name, phone: extra.mother_phone });
                if (extra.guardian_email) parentEmails.push({ email: extra.guardian_email.trim().toLowerCase(), name: extra.guardian_name, phone: extra.guardian_phone });

                const uniqueParents = [];
                const seenEmails = new Set();
                for (const p of parentEmails) {
                    if (p.email && !seenEmails.has(p.email)) {
                        seenEmails.add(p.email);
                        uniqueParents.push(p);
                    }
                }

                for (const p of uniqueParents) {
                    const [existingParent] = await connection.query(
                        'SELECT id, role FROM users WHERE email = ? AND school_id = ? LIMIT 1',
                        [p.email, schoolId]
                    );

                    if (existingParent.length === 0) {
                        const tempParentPassword = 'Parent@' + Math.random().toString(36).slice(-6).toUpperCase();
                        const hashedParentPassword = await bcrypt.hash(tempParentPassword, 10);
                        const parentName = p.name || 'Parent';
                        const namePartsParent = parentName.trim().split(' ');
                        const parentfirst_name = namePartsParent[0] || 'Parent';
                        const parentlast_name  = namePartsParent.slice(1).join(' ') || 'User';

                        await connection.query(`
                            INSERT INTO users (school_id, first_name, last_name, email, phone, password, role, status, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, 'parent', 'active', NOW())
                        `, [schoolId, parentfirst_name, parentlast_name, p.email, p.phone || null, hashedParentPassword]);

                        await sendParentCredentialsEmailAtAdmission(p.email, parentfirst_name, tempParentPassword, first_name + ' ' + last_name);
                    } else if (existingParent[0].role === 'parent') {
                        await connection.query(
                            "UPDATE users SET status = 'active' WHERE id = ?",
                            [existingParent[0].id]
                        );
                    };
                };
            };

            await connection.query(
                `UPDATE admission_requests SET status = 'approved', admin_note = ?, reviewed_at = NOW()
                WHERE id = ? AND school_id = ? AND status = 'pending'`,
                [admin_note || null, req.params.id, schoolId]
            );

            await connection.query(
                `UPDATE classes SET current_students = (
                    SELECT COUNT(*) FROM students WHERE class_id = ? AND deleted_at IS NULL AND status = 'active'
                ) WHERE id = ? AND school_id = ?`,
                [assignedClass.id, assignedClass.id, schoolId]
            );

            await connection.commit();
            await sendAdmissionEmail(
                admission.email,
                `Admission Approved – ${admission.school_name}`,
                admissionStatusHtml(
                    admission.full_name, admission.school_name, 'approved', admin_note,
                    portalSettings.studentPortal ? { email: admission.email, password: tempPassword, admissionNo } : null
                )
            );
        };

        req.flash('success', `Admission approved for ${admission.full_name}. Student profile created and login credentials sent via email.`);
        res.redirect('/schooladmin/admissions');
    } catch (err) {
        await connection.rollback();
        console.error('approveAdmission error:', err);
        req.flash('error', 'Failed to approve admission.');
        res.redirect('/schooladmin/admissions');
    } finally {
        connection.release();
    };
};

exports.rejectAdmission = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const { admin_note } = req.body;
        const admission = await AdmissionModel.getAdmissionRequest(req.params.id, schoolId);

        if (!admission) {
            req.flash('error', 'Admission request not found.');
            return res.redirect('/schooladmin/admissions');
        };

        await AdmissionModel.updateStatus(req.params.id, schoolId, 'rejected', admin_note);
        await sendAdmissionEmail(
            admission.email,
            `Admission Update – ${admission.school_name}`,
            admissionStatusHtml(admission.full_name, admission.school_name, 'rejected', admin_note)
        );

        req.flash('success', `Admission rejected for ${admission.full_name}.`);
        res.redirect('/schooladmin/admissions');
    } catch (err) {
        console.error('rejectAdmission error:', err);
        req.flash('error', 'Failed to reject admission.');
        res.redirect('/schooladmin/admissions');
    };
};

function admissionReceivedHtml(name, schoolName) {
    return `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;background:#f4f7f9;padding:40px 20px;">
        <table align="center" style="max-width:520px;width:100%;background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.08);overflow:hidden;">
            <tr>
                <td style="background:linear-gradient(135deg,#667eea,#764ba2);padding:30px;text-align:center;">
                    <h1 style="color:#fff;margin:0;font-size:22px;">Application Received!</h1>
                </td>
            </tr>
            <tr>
                <td style="padding:30px 35px;">
                    <p style="font-size:15px;color:#444;">Dear <b>${name}</b>,</p>
                    <p style="font-size:15px;color:#555;">Your admission request to <b>${schoolName}</b> has been successfully submitted. The school administration will review your application and contact you soon.</p>
                    <div style="background:#f0f4ff;border-left:4px solid #667eea;padding:15px 20px;border-radius:6px;margin:20px 0;">
                        <p style="margin:0;font-size:13px;color:#555;">📋 <b>Status:</b> Under Review<br>📧 You will receive an email once a decision is made.</p>
                    </div>
                    <p style="font-size:13px;color:#888;">If you have any questions, please contact the school directly.</p>
                </td>
            </tr>
            <tr>
                <td style="background:#f8f9fa;padding:15px;text-align:center;">
                    <p style="font-size:12px;color:#aaa;margin:0;">This is an automated email from SchoolSync. Please do not reply.</p>
                </td>
            </tr>
        </table>
    </div>`;
};

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

function formatEmailDate(value) {
    return new Date(value).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

function adminNotificationHtml({ name, email, phone, schoolName, classApplied, submittedAt, reviewUrl }) {
    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safePhone = escapeHtml(phone || 'Not provided');
    const safeSchoolName = escapeHtml(schoolName);
    const safeClassApplied = escapeHtml(classApplied || 'Not selected');
    const safeSubmittedAt = escapeHtml(formatEmailDate(submittedAt || new Date()));
    const safeReviewUrl = escapeHtml(reviewUrl || '#');

    return `
    <div style="margin:0;padding:0;background:#eef2f7;font-family:Arial,'Helvetica Neue',sans-serif;color:#0f172a;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#eef2f7;padding:0;margin:0;">
            <tr>
                <td align="center" style="padding:34px 14px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;max-width:640px;background:#ffffff;border:1px solid #dbe4ef;border-radius:18px;overflow:hidden;box-shadow:0 18px 45px rgba(15,23,42,0.10);">
                        <tr>
                            <td style="background:#0f766e;padding:30px 32px;color:#ffffff;">
                                <p style="margin:0 0 10px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:#ccfbf1;">SchoolSync Admissions</p>
                                <h1 style="margin:0;font-size:26px;line-height:1.25;font-weight:800;">New student admission request</h1>
                                <p style="margin:10px 0 0;font-size:15px;line-height:1.6;color:#e6fffb;">${safeName} submitted an admission form for ${safeSchoolName} through the QR admission link.</p>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding:28px 32px 12px;">
                                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0 10px;">
                                    <tr>
                                        <td style="padding:16px 18px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
                                            <p style="margin:0 0 4px;font-size:12px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Applicant</p>
                                            <p style="margin:0;font-size:18px;color:#0f172a;font-weight:800;">${safeName}</p>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding:16px 18px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
                                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                                                <tr>
                                                    <td style="padding:0 0 12px;font-size:13px;color:#64748b;width:38%;">Email</td>
                                                    <td style="padding:0 0 12px;font-size:14px;color:#0f172a;font-weight:700;word-break:break-all;">${safeEmail}</td>
                                                </tr>
                                                <tr>
                                                    <td style="padding:0 0 12px;font-size:13px;color:#64748b;">Phone</td>
                                                    <td style="padding:0 0 12px;font-size:14px;color:#0f172a;font-weight:700;">${safePhone}</td>
                                                </tr>
                                                <tr>
                                                    <td style="padding:0 0 12px;font-size:13px;color:#64748b;">Applying for standard</td>
                                                    <td style="padding:0 0 12px;font-size:14px;color:#0f172a;font-weight:700;">${safeClassApplied}</td>
                                                </tr>
                                                <tr>
                                                    <td style="padding:0;font-size:13px;color:#64748b;">Submitted</td>
                                                    <td style="padding:0;font-size:14px;color:#0f172a;font-weight:700;">${safeSubmittedAt}</td>
                                                </tr>
                                            </table>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding:8px 32px 30px;">
                                <div style="background:#ecfdf5;border:1px solid #bbf7d0;border-radius:14px;padding:16px 18px;margin-bottom:22px;">
                                    <p style="margin:0;font-size:14px;line-height:1.6;color:#166534;"><strong>Next step:</strong> Review the application details, assign the final class and section, then approve or reject from the admin dashboard.</p>
                                </div>
                                <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                                    <tr>
                                        <td style="background:#0f766e;border-radius:10px;">
                                            <a href="${safeReviewUrl}" style="display:inline-block;padding:13px 22px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:800;">Review admission request</a>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                        <tr>
                            <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 32px;text-align:center;">
                                <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">This automated alert was sent because a QR admission form was submitted for ${safeSchoolName}.</p>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </div>`;
};

function admissionStatusHtml(name, schoolName, status, note, credentials = null) {
    const isApproved = status === 'approved';
    const emoji = isApproved ? '🎉' : '📋';
    const statusText = isApproved ? 'Approved' : 'Not Selected';
    const credentialsBlock = credentials ? `
    <div style="background:#f0fff4;border:2px solid #38ef7d;border-radius:10px;padding:20px 25px;margin:20px 0;">
        <p style="margin:0 0 10px;font-size:15px;font-weight:700;color:#11998e;">🔑 Your Login Credentials</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;color:#444;">
            <tr>
                <td style="padding:5px 0;"><b>Admission No:</b></td><td style="padding:5px 0;">${credentials.admissionNo}</td>
            </tr>
            <tr>
                <td style="padding:5px 0;"><b>Email:</b></td><td style="padding:5px 0;">${credentials.email}</td>
            </tr>
            <tr>
                <td style="padding:5px 0;"><b>Temp Password:</b></td>
                <td style="padding:5px 0;font-family:monospace;background:#e8f5e9;padding:2px 8px;border-radius:4px;">${credentials.password}</td>
            </tr>
        </table>
        <p style="margin:10px 0 0;font-size:12px;color:#888;">Please change your password after your first login.</p>
    </div>` : '';
    return `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;background:#f4f7f9;padding:40px 20px;">
        <table align="center" style="max-width:520px;width:100%;background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.08);overflow:hidden;">
            <tr>
                <td style="background:${isApproved ? 'linear-gradient(135deg,#11998e,#38ef7d)' : 'linear-gradient(135deg,#ee0979,#ff6a00)'};padding:30px;text-align:center;">
                    <h1 style="color:#fff;margin:0;font-size:22px;">${emoji} Admission ${statusText}</h1>
                </td>
            </tr>
            <tr>
                <td style="padding:30px 35px;">
                    <p style="font-size:15px;color:#444;">Dear <b>${name}</b>,</p>
                    <p style="font-size:15px;color:#555;">
                        ${isApproved ? `Congratulations! Your admission to <b>${schoolName}</b> has been <b style="color:#11998e;">approved</b>. Your student account has been created.` : `Thank you for applying to <b>${schoolName}</b>. After careful consideration, we regret to inform you that your application has not been selected at this time.` }
                    </p>
                    ${credentialsBlock}
                    ${note ? `<div style="background:#f0f4ff;border-left:4px solid #667eea;padding:15px 20px;border-radius:6px;margin:20px 0;"><p style="margin:0;font-size:14px;color:#555;"><b>Admin Note:</b> ${note}</p></div>` : ''}
                    <p style="font-size:13px;color:#888;">For any queries, please contact the school administration directly.</p>
                </td>
            </tr>
        </table>
    </div>`;
};
