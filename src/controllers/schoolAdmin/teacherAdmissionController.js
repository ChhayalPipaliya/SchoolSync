const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const db = require('../../config/database');
const AdmissionModel = require('../../models/admissionModel');
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
        console.error('Teacher Onboarding email error:', err.message);
    };
};

async function getSchoolAdminEmail(schoolId) {
    const rows = await db.queryAsync(
        `SELECT school_email FROM schools WHERE id = ? LIMIT 1`,
        [schoolId]
    );
    return rows[0]?.school_email || null;
};

async function notifySchoolAdmins(schoolId, { title, message, referenceType, referenceId, actionUrl }) {
    try {
        const admins = await db.queryAsync(
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
        console.error('Teacher onboarding notification error:', err.message);
    };
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

function teacherAdminNotificationHtml({ name, email, phone, schoolName, qualification, subjects, experience, submittedAt, reviewUrl }) {
    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safePhone = escapeHtml(phone || 'Not provided');
    const safeSchoolName = escapeHtml(schoolName);
    const safeQualification = escapeHtml(qualification || 'Not provided');
    const safeSubjects = escapeHtml(subjects || 'Not provided');
    const safeExperience = escapeHtml(`${Number(experience || 0)} year(s)`);
    const safeSubmittedAt = escapeHtml(formatEmailDate(submittedAt || new Date()));
    const safeReviewUrl = escapeHtml(reviewUrl || '#');

    return `
    <div style="margin:0;padding:0;background:#eef2f7;font-family:Arial,'Helvetica Neue',sans-serif;color:#0f172a;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#eef2f7;padding:0;margin:0;">
            <tr>
                <td align="center" style="padding:34px 14px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;max-width:640px;background:#ffffff;border:1px solid #dbe4ef;border-radius:18px;overflow:hidden;box-shadow:0 18px 45px rgba(15,23,42,0.10);">
                        <tr>
                            <td style="background:#4338ca;padding:30px 32px;color:#ffffff;">
                                <p style="margin:0 0 10px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:#e0e7ff;">SchoolSync Onboarding</p>
                                <h1 style="margin:0;font-size:26px;line-height:1.25;font-weight:800;">New teacher application</h1>
                                <p style="margin:10px 0 0;font-size:15px;line-height:1.6;color:#eef2ff;">${safeName} submitted a teacher onboarding form for ${safeSchoolName} through the QR onboarding link.</p>
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
                                                    <td style="padding:0 0 12px;font-size:13px;color:#64748b;">Qualification</td>
                                                    <td style="padding:0 0 12px;font-size:14px;color:#0f172a;font-weight:700;">${safeQualification}</td>
                                                </tr>
                                                <tr>
                                                    <td style="padding:0 0 12px;font-size:13px;color:#64748b;">Subjects</td>
                                                    <td style="padding:0 0 12px;font-size:14px;color:#0f172a;font-weight:700;">${safeSubjects}</td>
                                                </tr>
                                                <tr>
                                                    <td style="padding:0 0 12px;font-size:13px;color:#64748b;">Experience</td>
                                                    <td style="padding:0 0 12px;font-size:14px;color:#0f172a;font-weight:700;">${safeExperience}</td>
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
                                <div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:14px;padding:16px 18px;margin-bottom:22px;">
                                    <p style="margin:0;font-size:14px;line-height:1.6;color:#3730a3;"><strong>Next step:</strong> Verify qualification, documents, and subject fit, then approve or reject this teacher application from the admin dashboard.</p>
                                </div>
                                <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                                    <tr>
                                        <td style="background:#4338ca;border-radius:10px;">
                                            <a href="${safeReviewUrl}" style="display:inline-block;padding:13px 22px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:800;">Review teacher application</a>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                        <tr>
                            <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 32px;text-align:center;">
                                <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">This automated alert was sent because a QR teacher onboarding form was submitted for ${safeSchoolName}.</p>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </div>`;
};

function getEndOfAcademicYear() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    let targetYear = currentYear;
    if (currentMonth >= 5) {
        targetYear = currentYear + 1;
    };

    const endOfAcademicYear = new Date(targetYear, 4, 31, 23, 59, 59);
    return endOfAcademicYear;
};

exports.showTeacherForm = async (req, res) => {
    try {
        const { token, school: schoolId } = req.query;

        if (!token || !schoolId) {
            return res.render('admission/error', {
                layout: false,
                title: 'Invalid Link',
                message: 'This onboarding link is invalid or incomplete.',
            });
        };

        const qrToken = await AdmissionModel.getQRToken(token);
        if (!qrToken || qrToken.school_id != schoolId || qrToken.role !== 'teacher') {
            return res.render('admission/error', {
                layout: false,
                title: 'Link Expired or Invalid',
                message: 'This onboarding link has expired, is invalid, or has already been used.',
            });
        };

        const flashError = req.flash('error');
        res.render('admission/teacher-form', {
            layout: false,
            title: 'Teacher Onboarding Form',
            school: qrToken,
            token,
            schoolId,
            errors: flashError && flashError.length > 0 ? flashError : [],
            old: {},
        });
    } catch (err) {
        console.error('showTeacherForm error:', err);
        res.render('admission/error', {
            layout: false,
            title: 'Server Error',
            message: 'Something went wrong. Please try again later.',
        });
    };
};

exports.submitTeacherForm = async (req, res) => {
    try {
        const { token, school_id } = req.body;
        const qrToken = await AdmissionModel.getQRToken(token);
        if (!qrToken || qrToken.school_id != school_id || qrToken.role !== 'teacher') {
            return res.render('admission/error', {
                layout: false,
                title: 'Invalid Submission',
                message: 'This onboarding link has expired. Please contact the school for a new link.',
            });
        };

        const errors = [];
        const { first_name, last_name, email, phone, date_of_birth, subjects, qualification, experience, previous_school, current_address, permanent_address, address, marital_status, father_name, mother_name, emergency_contact, joining_date, salary, prev_joining_date, total_experience, medical_issues, height, weight, blood_group } = req.body;
        if (!first_name || first_name.trim().length < 2) errors.push('First name is required (min 2 characters).');
        if (!last_name || last_name.trim().length < 1) errors.push('Last name is required.');
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('A valid email address is required.');
        if (!phone || !/^[6-9]\d{9}$/.test(phone)) errors.push('A valid 10-digit Indian mobile number is required.');
        if (!date_of_birth) errors.push('Date of birth is required.');
        if (!subjects || subjects.trim().length === 0) errors.push('Subjects you can teach are required.');
        if (!qualification || qualification.trim().length === 0) errors.push('Qualification is required.');
        if (!experience || isNaN(experience) || Number(experience) < 0) errors.push('Valid years of experience is required.');

        const resAddress = current_address || address;
        if (!resAddress || resAddress.trim().length === 0) errors.push('Current address is required.');
        if (errors.length > 0) {
            if (req.files) {
                Object.keys(req.files).forEach(fieldName => {
                    req.files[fieldName].forEach(file => {
                        if (fs.existsSync(file.path)) {
                            try { fs.unlinkSync(file.path); } catch (e) { }
                        };
                    });
                });
            };
            return res.render('admission/teacher-form', {
                layout: false,
                title: 'Teacher Onboarding Form',
                school: qrToken,
                token,
                schoolId: school_id,
                errors,
                old: req.body,
            });
        };

        const emailCheck = email.trim().toLowerCase();
        const isDuplicate = await AdmissionModel.checkDuplicateTeacher(school_id, emailCheck);
        if (isDuplicate) {
            if (req.files) {
                Object.keys(req.files).forEach(fieldName => {
                    req.files[fieldName].forEach(file => {
                        if (fs.existsSync(file.path)) {
                            try { fs.unlinkSync(file.path); } catch (e) { }
                        };
                    });
                });
            };
            return res.render('admission/teacher-form', {
                layout: false,
                title: 'Teacher Onboarding Form',
                school: qrToken,
                token,
                schoolId: school_id,
                errors: ['Application with this email already submitted'],
                old: req.body,
            });
        };

        const full_name = (first_name.trim() + ' ' + (last_name ? last_name.trim() : '')).trim();
        const extraData = {
            first_name: first_name ? first_name.trim() : '',
            last_name: last_name ? last_name.trim() : '',
            subjects: subjects.trim(),
            qualification: qualification.trim(),
            experience: Number(experience),
            joining_date: joining_date || null,
            salary: salary ? Number(salary) : null,
            marital_status: marital_status || 'single',
            emergency_contact: emergency_contact ? emergency_contact.trim() : null,
            father_name: father_name ? father_name.trim() : null,
            mother_name: mother_name ? mother_name.trim() : null,
            previous_school: previous_school ? previous_school.trim() : null,
            prev_joining_date: prev_joining_date || null,
            total_experience: total_experience ? Number(total_experience) : null,
            medical_issues: medical_issues ? medical_issues.trim() : null,
            height: height ? parseFloat(height) : null,
            weight: weight ? parseFloat(weight) : null,
            blood_group: blood_group || null,
            current_address: resAddress.trim(),
            permanent_address: permanent_address ? permanent_address.trim() : resAddress.trim(),
            dob: date_of_birth,
            files: {
                photo: null,
                documents: []
            }
        };

        if (req.files) {
            if (req.files.photo && req.files.photo[0]) {
                const file = req.files.photo[0];
                extraData.files.photo = {
                    filename: file.filename,
                    originalname: file.originalname,
                    path: file.path,
                    mimetype: file.mimetype,
                    size: file.size
                };
            };
            if (req.files.documents) {
                const docTypes = Array.isArray(req.body.document_types) ? req.body.document_types : (req.body.document_types ? [req.body.document_types] : []);
                const docNames = Array.isArray(req.body.document_names) ? req.body.document_names : (req.body.document_names ? [req.body.document_names] : []);

                for (let i = 0; i < req.files.documents.length; i++) {
                    const file = req.files.documents[i];
                    extraData.files.documents.push({
                        filename: file.filename,
                        originalname: file.originalname,
                        path: file.path,
                        mimetype: file.mimetype,
                        size: file.size,
                        docType: docTypes[i] || 'other',
                        docName: docNames[i] || file.originalname || 'Document'
                    });
                };
            };
        };

        const createdRequest = await AdmissionModel.createTeacherAdmissionRequest({
            school_id,
            token,
            full_name: full_name,
            email: emailCheck,
            phone: phone.trim(),
            date_of_birth,
            address: resAddress.trim(),
            previous_school: previous_school ? previous_school.trim() : null,
            extra_data: extraData
        });

        await AdmissionModel.markTokenUsed(token);
        await notifySchoolAdmins(school_id, {
            title: 'Teacher onboarding request submitted',
            message: `${full_name} submitted a teacher onboarding request.`,
            referenceType: 'admission_request',
            referenceId: createdRequest.insertId,
            actionUrl: '/admin/teachers/applications'
        });

        await sendAdmissionEmail(
            emailCheck,
            'Application Received - SchoolSync',
            `<div style="font-family:'Helvetica Neue',Arial,sans-serif;background:#f4f7f9;padding:40px 20px;">
                <table align="center" style="max-width:520px;width:100%;background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.08);overflow:hidden;">
                    <tr>
                        <td style="background:linear-gradient(135deg,#11998e,#38ef7d);padding:30px;text-align:center;">
                            <h1 style="color:#fff;margin:0;font-size:22px;">Onboarding Application Received!</h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:30px 35px;">
                            <p style="font-size:15px;color:#444;">Dear <b>${full_name}</b>,</p>
                            <p style="font-size:15px;color:#555;">Your onboarding application to join <b>${qrToken.school_name}</b> as a teacher has been successfully received.</p>
                            <div style="background:#f0fdf4;border-left:4px solid #11998e;padding:15px 20px;border-radius:6px;margin:20px 0;">
                                <p style="margin:0;font-size:13px;color:#555;">📋 <b>Status:</b> Under Review<br>📧 We will notify you via email once the school administration reviews and approves your onboarding request.</p>
                            </div>
                            <p style="font-size:13px;color:#888;">If you have any questions, please contact the school administration directly.</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="background:#f8f9fa;padding:15px;text-align:center;">
                            <p style="font-size:12px;color:#aaa;margin:0;">This is an automated email from SchoolSync. Please do not reply.</p>
                        </td>
                    </tr>
                </table>
            </div>`
        );

        const adminEmail = await getSchoolAdminEmail(school_id);
        if (adminEmail) {
            const reviewUrl = `${process.env.BASE_URL || 'http://localhost:4000'}/admin/teachers/applications`;
            await sendAdmissionEmail(
                adminEmail,
                `New Teacher Onboarding Application from ${full_name}`,
                teacherAdminNotificationHtml({
                    name: full_name,
                    email: emailCheck,
                    phone,
                    schoolName: qrToken.school_name,
                    qualification: qualification.trim(),
                    subjects: subjects.trim(),
                    experience,
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
            applicantEmail: emailCheck,
        });
    } catch (err) {
        console.error('submitTeacherForm error:', err);
        res.render('admission/error', {
            layout: false,
            title: 'Submission Failed',
            message: 'We could not save your application. Please try again or contact the school directly.',
        });
    };
};

exports.generateTeacherQR = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const role = 'teacher';
        const token = uuidv4();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const expiresAtMysql = expiresAt.toISOString().slice(0, 19).replace('T', ' ');

        await AdmissionModel.createQRToken(schoolId, role, token, expiresAtMysql);

        req.flash('success', 'Teacher Onboarding QR Code generated successfully! Valid for 1 month.');
        res.redirect('/schooladmin/admissions/qr');
    } catch (err) {
        console.error('generateTeacherQR error:', err);
        req.flash('error', 'Failed to generate teacher onboarding QR code.');
        res.redirect('/schooladmin/admissions/qr');
    };
};

exports.generateDriverQR = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const token = uuidv4();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const expiresAtMysql = expiresAt.toISOString().slice(0, 19).replace('T', ' ');

        await AdmissionModel.createQRToken(schoolId, 'driver', token, expiresAtMysql);

        req.flash('success', 'Driver Onboarding QR Code generated successfully! Valid for 1 month.');
        res.redirect('/schooladmin/admissions/qr');
    } catch (err) {
        console.error('generateDriverQR error:', err);
        req.flash('error', 'Failed to generate driver onboarding QR code.');
        res.redirect('/schooladmin/admissions/qr');
    };
};

exports.showDriverForm = async (req, res) => {
    try {
        const { token, school: schoolId } = req.query;
        if (!token || !schoolId) {
            return res.render('admission/error', { layout: false, title: 'Invalid Link', message: 'This onboarding link is invalid or incomplete.' });
        };

        const qrToken = await AdmissionModel.getQRToken(token);
        if (!qrToken || qrToken.school_id != schoolId || qrToken.role !== 'driver') {
            return res.render('admission/error', { layout: false, title: 'Link Expired or Invalid', message: 'This driver onboarding link has expired or is invalid.' });
        };

        const flashError = req.flash('error');
        res.render('admission/driver-form', {
            layout: false,
            title: 'Driver Onboarding Form',
            school: qrToken,
            token,
            schoolId,
            errors: flashError && flashError.length > 0 ? flashError : [],
            old: {}
        });
    } catch (err) {
        console.error('showDriverForm error:', err);
        res.render('admission/error', { layout: false, title: 'Server Error', message: 'Something went wrong. Please try again later.' });
    };
};

exports.submitDriverForm = async (req, res) => {
    try {
        const { token, school_id } = req.body;
        const qrToken = await AdmissionModel.getQRToken(token);
        if (!qrToken || qrToken.school_id != school_id || qrToken.role !== 'driver') {
            return res.render('admission/error', { layout: false, title: 'Invalid Submission', message: 'This onboarding link has expired. Please contact the school for a new link.' });
        };

        const { first_name, last_name, email, phone, date_of_birth, gender, blood_group, address, city, state, pincode, emergency_contact, aadhaar_number, license_number, license_expiry, license_type, driving_experience, previous_employer, reference_name, reference_phone } = req.body;
        const errors = [];
        if (!first_name || first_name.trim().length < 2) errors.push('First name is required.');
        if (!last_name || last_name.trim().length < 1) errors.push('Last name is required.');
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('A valid email address is required.');
        if (!phone || !/^[6-9]\d{9}$/.test(phone)) errors.push('A valid 10-digit Indian mobile number is required.');
        if (!license_number || !license_number.trim()) errors.push('License number is required.');
        if (!license_expiry) errors.push('License expiry date is required.');

        const emailCheck = email ? email.trim().toLowerCase() : '';
        if (!errors.length && await AdmissionModel.checkDuplicateApplication(school_id, emailCheck, 'driver')) {
            errors.push('Application with this email already submitted.');
        };

        if (errors.length > 0) {
            if (req.files) Object.values(req.files).flat().forEach(file => { 
                if (fs.existsSync(file.path)) { 
                    try { 
                        fs.unlinkSync(file.path); 
                    } catch (e) { } } });
            return res.render('admission/driver-form', { layout: false, title: 'Driver Onboarding Form', school: qrToken, token, schoolId: school_id, errors, old: req.body });
        };

        const files = {};
        ['photo', 'license_document', 'aadhaar_document'].forEach(field => {
            if (req.files?.[field]?.[0]) {
                const file = req.files[field][0];
                files[field] = { filename: file.filename, originalname: file.originalname, path: file.path, mimetype: file.mimetype, size: file.size };
            };
        });

        const fullName = `${first_name.trim()} ${last_name.trim()}`.trim();
        const fullAddress = [address, city, state, pincode].filter(Boolean).join(', ');
        const extraData = { first_name: first_name.trim(), last_name: last_name.trim(), city: city || null, state: state || null, pincode: pincode || null, emergency_contact: emergency_contact || null, aadhaar_number: aadhaar_number || null, license_number: license_number.trim(), license_expiry, license_type: license_type || null, driving_experience: driving_experience || null, previous_employer: previous_employer || null, reference_name: reference_name || null, reference_phone: reference_phone || null, files };

        const createdRequest = await AdmissionModel.createDriverAdmissionRequest({
            school_id,
            token,
            full_name: fullName,
            email: emailCheck,
            phone: phone.trim(),
            date_of_birth: date_of_birth || null,
            gender: gender || null,
            address: fullAddress || null,
            blood_group: blood_group || null,
            extra_data: extraData
        });

        await AdmissionModel.markTokenUsed(token);
        await notifySchoolAdmins(school_id, {
            title: 'Driver onboarding request submitted',
            message: `${fullName} submitted a driver onboarding request.`,
            referenceType: 'admission_request',
            referenceId: createdRequest.insertId,
            actionUrl: '/admin/drivers/applications'
        });

        await sendAdmissionEmail(emailCheck, 'Driver Application Received - SchoolSync', `<p>Dear ${escapeHtml(fullName)}, your driver onboarding application for ${escapeHtml(qrToken.school_name)} has been received and is pending review.</p>`);
        res.render('admission/success', { layout: false, title: 'Application Submitted', schoolName: qrToken.school_name, applicantName: fullName, applicantEmail: emailCheck });
    } catch (err) {
        console.error('submitDriverForm error:', err);
        res.render('admission/error', { layout: false, title: 'Submission Failed', message: 'We could not save your application. Please try again or contact the school directly.' });
    };
};

exports.listTeacherApplications = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const status = req.query.status || 'pending';
        const applications = await AdmissionModel.listTeacherApplications(schoolId, status);
        const counts = await AdmissionModel.countByStatus(schoolId);

        res.render('admin/teacher-applications-list', {
            title: 'Teacher Onboarding Requests',
            applications,
            counts,
            currentStatus: status,
            success: req.flash('success'),
            error: req.flash('error'),
        });
    } catch (err) {
        console.error('listTeacherApplications error:', err);
        req.flash('error', 'Failed to load teacher onboarding requests.');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.listDriverApplications = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const status = req.query.status || 'pending';
        const applications = await AdmissionModel.listDriverApplications(schoolId, status);
        const counts = await AdmissionModel.countByStatus(schoolId);

        res.render('admin/driver-applications-list', {
            title: 'Driver Onboarding Requests',
            applications,
            counts,
            currentStatus: status,
            success: req.flash('success'),
            error: req.flash('error')
        });
    } catch (err) {
        console.error('listDriverApplications error:', err);
        req.flash('error', 'Failed to load driver onboarding requests.');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.approveDriverApplication = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const { admin_note } = req.body;
        const admission = await AdmissionModel.getDriverApplication(req.params.id, schoolId);

        if (!admission) {
            req.flash('error', 'Driver application request not found.');
            return res.redirect('/admin/drivers/applications');
        };
        if (admission.status !== 'pending') {
            req.flash('error', 'This application has already been processed.');
            return res.redirect('/admin/drivers/applications');
        };

        let extra = admission.extra_data;
        if (typeof extra === 'string') {
            try { extra = JSON.parse(extra); } catch (e) { extra = {}; }
        };
        extra = extra || {};

        const nameParts = admission.full_name.trim().split(/\s+/);
        const first_name = extra.first_name || nameParts[0] || admission.full_name;
        const last_name = extra.last_name || nameParts.slice(1).join(' ') || '';
        const tempPassword = `Driver@${Math.random().toString(36).slice(-6).toUpperCase()}`;
        const hashedPassword = await bcrypt.hash(tempPassword, 10);
        const photo = extra.files?.photo ? `/uploads/drivers/${extra.files.photo.filename}` : null;

        await db.withTransaction(async (tx) => {
            const existingUsers = await tx.query(
                'SELECT id FROM users WHERE email = ? AND school_id = ? AND deleted_at IS NULL LIMIT 1',
                [admission.email, schoolId]
            );
            if (existingUsers.length > 0) throw new Error('DUPLICATE_USER_EMAIL');

            const userResult = await tx.execute(
                `INSERT INTO users (school_id, first_name, last_name, email, phone, password, role, status, is_default_password, image)
                VALUES (?, ?, ?, ?, ?, ?, 'driver', 'active', 1, ?)`,
                [schoolId, first_name, last_name, admission.email, admission.phone || null, hashedPassword, photo]
            );

            await tx.execute(
                `INSERT INTO drivers (school_id, user_id, first_name, last_name, email, phone, address, license_number, license_expiry, aadhar_number, emergency_contact, status, image)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
                [ schoolId, userResult.insertId, first_name, last_name, admission.email, admission.phone || '', admission.address || null, extra.license_number, extra.license_expiry, extra.aadhaar_number || null, extra.emergency_contact || null, photo ]
            );

            await tx.execute(
                `UPDATE admission_requests SET status = 'approved', admin_note = ?, reviewed_at = NOW()
                WHERE id = ? AND school_id = ? AND status = 'pending'`,
                [admin_note || null, req.params.id, schoolId]
            );
        });

        await sendAdmissionEmail(admission.email, 'Driver Application Approved - SchoolSync', `<p>Dear ${escapeHtml(admission.full_name)}, your driver account has been approved.</p><p><b>Email:</b> ${escapeHtml(admission.email)}<br><b>Password:</b> ${escapeHtml(tempPassword)}</p>`);
        req.flash('success', `Driver application approved and credentials emailed to ${admission.email}.`);
        res.redirect('/admin/drivers/applications');
    } catch (err) {
        console.error('approveDriverApplication error:', err);
        req.flash('error', err.message === 'DUPLICATE_USER_EMAIL' ? 'A user with this email already exists.' : 'Failed to approve driver application.');
        res.redirect('/admin/drivers/applications');
    };
};

exports.rejectDriverApplication = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const { reason } = req.body;
        const admission = await AdmissionModel.getDriverApplication(req.params.id, schoolId);

        if (!admission) {
            req.flash('error', 'Driver application request not found.');
            return res.redirect('/admin/drivers/applications');
        }
        if (admission.status !== 'pending') {
            req.flash('error', 'This application has already been processed.');
            return res.redirect('/admin/drivers/applications');
        }

        await AdmissionModel.updateStatus(req.params.id, schoolId, 'rejected', reason);
        await sendAdmissionEmail(admission.email, 'Driver Application Update - SchoolSync', `<p>Dear ${escapeHtml(admission.full_name)}, your driver application was not approved.${reason ? '<br><b>Reason:</b> ' + escapeHtml(reason) : ''}</p>`);
        req.flash('success', `Driver application for ${admission.full_name} has been rejected.`);
        res.redirect('/admin/drivers/applications');
    } catch (err) {
        console.error('rejectDriverApplication error:', err);
        req.flash('error', 'Failed to reject driver application.');
        res.redirect('/admin/drivers/applications');
    };
};

exports.approveTeacherApplication = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const { admin_note } = req.body;
        const admission = await AdmissionModel.getTeacherApplication(req.params.id, schoolId);

        if (!admission) {
            req.flash('error', 'Teacher application request not found.');
            return res.redirect('/admin/teachers/applications');
        };

        if (admission.status !== 'pending') {
            req.flash('error', 'This application has already been processed.');
            return res.redirect('/admin/teachers/applications');
        };

        let extra = admission.extra_data;
        if (typeof extra === 'string') {
            extra = JSON.parse(extra);
        };
        extra = extra || {};

        const subjects = extra.subjects || null;
        const qualification = extra.qualification || null;
        const experience = extra.experience || 0;
        const dob = extra.dob || admission.date_of_birth || null;
        const address = admission.address;
        const nameParts = admission.full_name.trim().split(/\s+/);
        const first_name = nameParts[0];
        const last_name = nameParts.slice(1).join(' ') || '';
        const year = new Date().getFullYear();
        let teacherId = '';

        await db.withTransaction(async (tx) => {
            const existingUsers = await tx.query(
                'SELECT id FROM users WHERE email = ? AND school_id = ? AND deleted_at IS NULL LIMIT 1',
                [admission.email, schoolId]
            );
            if (existingUsers.length > 0) {
                throw new Error('DUPLICATE_USER_EMAIL');
            };

            const countRows = await tx.query(
                `SELECT COUNT(*) AS count FROM users WHERE school_id = ? AND role = 'teacher'`,
                [schoolId]
            );
            const nextSeq = countRows[0].count + 1;
            const paddedId = String(nextSeq).padStart(4, '0');
            teacherId = `TCH-${schoolId}-${year}-${paddedId}`;
            const hashedPassword = await bcrypt.hash(teacherId, 10);
            const photo = extra.files?.photo ? `/uploads/teachers/${extra.files.photo.filename}` : null;

            const userResult = await tx.execute(
                `INSERT INTO users (school_id, first_name, last_name, email, phone, password, role, status, is_default_password, image)
                VALUES (?, ?, ?, ?, ?, ?, 'teacher', 'active', 1, ?)`,
                [schoolId, first_name, last_name, admission.email, admission.phone || null, hashedPassword, photo]
            );

            const userId = userResult.insertId;
            const teacherResult = await tx.execute(
                `INSERT INTO teachers (
                    school_id, user_id, subject, qualification, experience, gender, dob,
                    marital_status, father_name, mother_name,
                    current_address, permanent_address, joining_date
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [ schoolId, userId, subjects, qualification, experience, admission.gender || extra.gender || null, dob, extra.marital_status || null, extra.father_name || null, extra.mother_name || null, extra.current_address || address || null, extra.permanent_address || address || null, extra.joining_date || new Date().toISOString().split('T')[0] ]
            );

            const tId = teacherResult.insertId;
            await tx.execute(
                `INSERT INTO teacher_medical (teacher_id, medical_issues, height, weight, blood_group)
                VALUES (?, ?, ?, ?, ?)`,
                [ tId, extra.medical_issues || null, extra.height || null, extra.weight || null, extra.blood_group || null ]
            );

            if (extra.previous_school || extra.total_experience || extra.prev_joining_date) {
                await tx.execute(
                    `INSERT INTO teacher_experience (teacher_id, previous_school, total_experience, joining_date)
                    VALUES (?, ?, ?, ?)`,
                    [ tId, extra.previous_school || null, extra.total_experience || null, extra.prev_joining_date || null ]
                );
            };

            if (extra.files?.documents && extra.files.documents.length > 0) {
                for (let i = 0; i < extra.files.documents.length; i++) {
                    const file = extra.files.documents[i];
                    await tx.execute(
                        'INSERT INTO teacher_documents (teacher_id, document_name, document_type, file_path) VALUES (?, ?, ?, ?)',
                        [tId, file.docName, file.docType, file.filename]
                    );
                };
            };

            await tx.execute(
                `UPDATE admission_requests SET status = 'approved', admin_note = ?, reviewed_at = NOW()
                 WHERE id = ? AND school_id = ?`,
                [admin_note || null, req.params.id, schoolId]
            );
        });

        await sendAdmissionEmail(
            admission.email,
            'Application Approved - SchoolSync',
            `<div style="font-family:'Helvetica Neue',Arial,sans-serif;background:#f4f7f9;padding:40px 20px;">
                <table align="center" style="max-width:520px;width:100%;background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.08);overflow:hidden;">
                    <tr>
                        <td style="background:linear-gradient(135deg,#11998e,#38ef7d);padding:30px;text-align:center;">
                            <h1 style="color:#fff;margin:0;font-size:22px;">🎉 Welcome to SchoolSync!</h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:30px 35px;">
                            <p style="font-size:15px;color:#444;">Dear <b>${admission.full_name}</b>,</p>
                            <p style="font-size:15px;color:#555;">We are pleased to inform you that your teacher application has been <b>approved</b>! Your user account has been successfully created.</p>
                            <div style="background:#f0f4ff;border-left:4px solid #667eea;padding:18px;border-radius:8px;margin:20px 0;">
                                <p style="margin:0 0 10px 0;font-size:14px;color:#1a202c;font-weight:700;">🔑 Your Login Credentials:</p>
                                <p style="margin:0 0 6px 0;font-size:13px;color:#4a5568;"><b>Email:</b> ${admission.email}</p>
                                <p style="margin:0 0 6px 0;font-size:13px;color:#4a5568;"><b>Password:</b> ${teacherId}</p>
                                <p style="margin:0;font-size:11px;color:#718096;font-style:italic;">Note: Please change your password after logging in for the first time.</p>
                            </div>
                            <p style="font-size:13px;color:#888;">If you have any questions or need onboarding assistance, please reach out to the school admin.</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="background:#f8f9fa;padding:15px;text-align:center;">
                            <p style="font-size:12px;color:#aaa;margin:0;">This is an automated email from SchoolSync. Please do not reply.</p>
                        </td>
                    </tr>
                </table>
            </div>`
        );

        req.flash('success', `Teacher application approved. Login credentials generated and emailed to ${admission.email}.`);
        res.redirect('/admin/teachers/applications');
    } catch (err) {
        console.error('approveTeacherApplication error:', err);
        if (err.message === 'DUPLICATE_USER_EMAIL') {
            req.flash('error', 'A user with this email already exists.');
            return res.redirect('/admin/teachers/applications');
        };
        req.flash('error', 'Failed to approve teacher application.');
        res.redirect('/admin/teachers/applications');
    };
};

exports.rejectTeacherApplication = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const { reason } = req.body;
        const admission = await AdmissionModel.getTeacherApplication(req.params.id, schoolId);

        if (!admission) {
            req.flash('error', 'Teacher application request not found.');
            return res.redirect('/admin/teachers/applications');
        };

        if (admission.status !== 'pending') {
            req.flash('error', 'This application has already been processed.');
            return res.redirect('/admin/teachers/applications');
        };

        await AdmissionModel.updateStatus(req.params.id, schoolId, 'rejected', reason);
        await sendAdmissionEmail(
            admission.email,
            'Application Update - SchoolSync',
            `<div style="font-family:'Helvetica Neue',Arial,sans-serif;background:#f4f7f9;padding:40px 20px;">
                <table align="center" style="max-width:520px;width:100%;background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.08);overflow:hidden;">
                    <tr>
                        <td style="background:linear-gradient(135deg,#ee0979,#ff6a00);padding:30px;text-align:center;">
                            <h1 style="color:#fff;margin:0;font-size:22px;">Application Update</h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:30px 35px;">
                            <p style="font-size:15px;color:#444;">Dear <b>${admission.full_name}</b>,</p>
                            <p style="font-size:15px;color:#555;">We regret to inform you that your teacher application has not been approved at this time.</p>
                            ${reason ? `
                                <div style="background:#fff5f5;border-left:4px solid #ee0979;padding:15px 20px;border-radius:6px;margin:20px 0;">
                                    <p style="margin:0;font-size:13px;color:#742a2a;"><b>Reason for decision:</b><br>${reason}</p>
                                </div>
                            ` : ''}
                            <p style="font-size:13px;color:#888;">Thank you for your interest in joining our school. We wish you the best in your future endeavors.</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="background:#f8f9fa;padding:15px;text-align:center;">
                            <p style="font-size:12px;color:#aaa;margin:0;">This is an automated email from SchoolSync. Please do not reply.</p>
                        </td>
                    </tr>
                </table>
            </div>`
        );

        req.flash('success', `Teacher application for ${admission.full_name} has been rejected.`);
        res.redirect('/admin/teachers/applications');
    } catch (err) {
        console.error('rejectTeacherApplication error:', err);
        req.flash('error', 'Failed to reject teacher application.');
        res.redirect('/admin/teachers/applications');
    };
};