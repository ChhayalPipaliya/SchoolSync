const db = require('../../config/database');
const portalService = require('../../services/portalService');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const { logSchoolActivity } = require('../../utils/auditLogger');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

async function sendEmail(to, subject, html) {
    try {
        await transporter.sendMail({
            from: `"SchoolSync Portal" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            html,
        });
    } catch (err) {
        console.error('[Email-Error] Failed to send credentials email:', err.message);
    };
};

async function sendParentCredentialsEmail(email, name, password, student) {
    const loginUrl = process.env.BASE_URL;
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
                    <p style="font-size:15px;color:#555;">An account has been created for you to access the SchoolSync Parent Portal. You can log in to view the attendance, homework, notices, and fees details of your child: <b>${student.student_first_name} ${student.student_last_name}</b>.</p>
                    <div style="background:#f0fff4;border:2px solid #38ef7d;border-radius:10px;padding:20px 25px;margin:20px 0;">
                        <p style="margin:0 0 10px;font-size:15px;font-weight:700;color:#11998e;">🔑 Your Login Credentials</p>
                        <table style="width:100%;border-collapse:collapse;font-size:14px;color:#444;">
                            <tr>
                                <td style="padding:5px 0;"><b>Login URL:</b></td>
                                <td style="padding:5px 0;"><a href="${loginUrl}/login">${loginUrl}/login</a></td>
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
    await sendEmail(email, `🔑 Parent Portal Credentials – SchoolSync`, html);
};

async function shouldParentBeActive(schoolId, parentEmail, conn) {
    const sql = `
        SELECT s.id, c.class_name
        FROM students s
        JOIN classes c ON s.class_id = c.id
        JOIN student_family sf ON s.id = sf.student_id
        WHERE s.school_id = ? AND s.deleted_at IS NULL AND s.status = 'active'
            AND (sf.father_email = ? OR sf.mother_email = ? OR sf.guardian_email = ?)
    `;
    const children = await conn.query(sql, [schoolId, parentEmail, parentEmail, parentEmail]);
    for (const child of children) {
        const access = await portalService.getPortalAccess(schoolId, child.class_name, conn);
        if (access.parentPortal) {
            return true;
        };
    };

    const sqlUnassigned = `
        SELECT s.id, s.standard
        FROM students s
        JOIN student_family sf ON s.id = sf.student_id
        WHERE s.school_id = ? AND s.class_id IS NULL AND s.deleted_at IS NULL AND s.status = 'active'
            AND (sf.father_email = ? OR sf.mother_email = ? OR sf.guardian_email = ?)
    `;
    const unassignedKids = await conn.query(sqlUnassigned, [schoolId, parentEmail, parentEmail, parentEmail]);
    for (const kid of unassignedKids) {
        if (kid.standard) {
            const access = await portalService.getPortalAccess(schoolId, kid.standard, conn);
            if (access.parentPortal) {
                return true;
            };
        };
    };
    return false;
};

async function recomputePortalAccessForClass(schoolId, className, conn) {
    const resolved = await portalService.getPortalAccess(schoolId, className, conn);
    const classAliases = portalService.getClassNameAliases(className);
    const sql = `
        SELECT s.id, s.user_id, s.status AS student_status, sf.father_name, sf.father_email, sf.father_phone,
            sf.mother_name, sf.mother_email, sf.mother_phone,
            sf.guardian_name, sf.guardian_email, sf.guardian_phone,
            u.email AS student_email, u.first_name AS student_first_name, u.last_name AS student_last_name
        FROM students s
        JOIN users u ON s.user_id = u.id
        LEFT JOIN classes c ON s.class_id = c.id
        LEFT JOIN student_family sf ON s.id = sf.student_id
        WHERE s.school_id = ? 
            AND (c.class_name IN (?) OR (s.class_id IS NULL AND s.standard IN (?)))
            AND s.deleted_at IS NULL
    `;
    
    const students = await conn.query(sql, [schoolId, classAliases, classAliases]);
    const parentMap = new Map();
    for (const student of students) {
        const isActiveStudent = student.student_status === 'active';
        const studentPortalVal = (isActiveStudent && resolved.studentPortal) ? 1 : 0;
        const parentPortalVal = (isActiveStudent && resolved.parentPortal) ? 1 : 0;

        await conn.query(
            `UPDATE students 
                SET student_portal_enabled = ?, parent_portal_enabled = ?
                WHERE id = ? AND school_id = ?`,
            [studentPortalVal, parentPortalVal, student.id, schoolId]
        );

        const studentUserStatus = (isActiveStudent && resolved.studentPortal) ? 'active' : 'inactive';
        await conn.query(
            "UPDATE users SET status = ? WHERE id = ?",
            [studentUserStatus, student.user_id]
        );

        const parentEmails = [];
        if (student.father_email) parentEmails.push({ email: student.father_email.trim().toLowerCase(), name: student.father_name, phone: student.father_phone });
        if (student.mother_email) parentEmails.push({ email: student.mother_email.trim().toLowerCase(), name: student.mother_name, phone: student.mother_phone });
        if (student.guardian_email) parentEmails.push({ email: student.guardian_email.trim().toLowerCase(), name: student.guardian_name, phone: student.guardian_phone });

        for (const p of parentEmails) {
            if (p.email && !parentMap.has(p.email)) {
                parentMap.set(p.email, {
                    email: p.email,
                    name: p.name,
                    phone: p.phone,
                    student: student
                });
            };
        };
    };

    for (const [parentEmail, p] of parentMap.entries()) {
        const existing = await conn.query(
            "SELECT id, role, status FROM users WHERE email = ? AND school_id = ? LIMIT 1",
            [parentEmail, schoolId]
        );

        const shouldBeActive = await shouldParentBeActive(schoolId, parentEmail, conn);
        if (existing.length > 0 && existing[0].role === 'parent') {
            const nextStatus = shouldBeActive ? 'active' : 'inactive';
            await conn.query(
                "UPDATE users SET status = ? WHERE id = ?",
                [nextStatus, existing[0].id]
            );
            await updateStudentFamilyParentLink(p.student.id, schoolId, existing[0].id, p, conn);
        } else if (existing.length === 0 && shouldBeActive) {
            const tempPassword = 'Parent@' + Math.random().toString(36).slice(-6).toUpperCase();
            const hashedPassword = await bcrypt.hash(tempPassword, 10);
            const parentName = p.name || 'Parent';
            const nameParts = parentName.trim().split(' ');
            const first_name = nameParts[0] || 'Parent';
            const last_name = nameParts.slice(1).join(' ') || 'User';

            const userResult = await conn.query(
                `INSERT INTO users (school_id, first_name, last_name, email, phone, password, role, status, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, 'parent', 'active', NOW())`,
                [schoolId, first_name, last_name, parentEmail, p.phone || null, hashedPassword]
            );
            const parentUserId = userResult.insertId;
            await updateStudentFamilyParentLink(p.student.id, schoolId, parentUserId, p, conn);

            await sendParentCredentialsEmail(parentEmail, first_name, tempPassword, p.student);
        };
    };
};

exports.getOverrides = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session?.user?.school_id || null;
        if (!schoolId) {
            req.flash('error', 'Unauthorized access.');
            return res.redirect('/login');
        };

        const [schoolRows] = await db.query(
            "SELECT school_type FROM schools WHERE id = ? LIMIT 1",
            [schoolId]
        );

        if (schoolRows.length === 0) {
            req.flash('error', 'School not found.');
            return res.redirect('/schooladmin/dashboard');
        };

        const schoolTypes = portalService.parseSchoolTypes(schoolRows[0].school_type);
        let defaultRules = [];
        if (schoolTypes.length > 0) {
            [defaultRules] = await db.query(
                `SELECT pr.class_name, pr.parent_portal, pr.student_portal 
                    FROM portal_rules pr
                    JOIN school_types st ON pr.school_type_id = st.id
                    WHERE st.code IN (?)`,
                [schoolTypes]
            );
        };

        const [distinctClasses] = await db.query(
            "SELECT DISTINCT class_name FROM classes WHERE school_id = ? ORDER BY class_name",
            [schoolId]
        );

        const [overrides] = await db.query(
            "SELECT class_name, parent_portal, student_portal, reason FROM portal_overrides WHERE school_id = ?",
            [schoolId]
        );

        const classesList = distinctClasses.map(c => {
            const aliases = portalService.getClassNameAliases(c.class_name);
            const override = overrides.find(o => aliases.includes(o.class_name));
            const matchingRules = defaultRules.filter(r => aliases.includes(r.class_name));
            const fallbackDefault = portalService.getDefaultPortalAccessByClass(c.class_name);
            const defaultParent = matchingRules.length > 0 ? !!matchingRules[0].parent_portal : fallbackDefault.parentPortal;
            const defaultStudent = true;

            return {
                class_name: c.class_name,
                defaultParent,
                defaultStudent,
                parent_portal: override ? !!override.parent_portal : defaultParent,
                student_portal: override ? !!override.student_portal : defaultStudent,
                isOverridden: !!override,
                reason: override ? override.reason : ''
            };
        });

        res.render('schoolAdmin/portal/overrides', {
            title: 'Portal Access Rules',
            classesList,
            user: req.user,
            currentPath: '/schooladmin/portal/overrides',
        });
    } catch (err) {
        console.error('[PortalController.getOverrides] Error:', err);
        req.flash('error', 'Failed to load portal overrides dashboard.');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.createOverride = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session?.user?.school_id || null;
        if (!schoolId) {
            return res.status(401).json({ success: false, message: 'Unauthorized.' });
        };

        const { class_name, parent_portal, student_portal, reason } = req.body;
        if (!class_name) {
            req.flash('error', 'Class name is required.');
            return res.redirect('/schooladmin/portal/overrides');
        };

        const parentVal = (parent_portal === '1' || parent_portal === 'on' || parent_portal === true) ? 1 : 0;
        const studentVal = (student_portal === '1' || student_portal === 'on' || student_portal === true) ? 1 : 0;

        await db.withTransaction(async (helpers) => {
            const classAliases = portalService.getClassNameAliases(class_name);
            const canonicalClassName = portalService.normalizeClassName(class_name) || class_name;
            const existing = await helpers.query(
                "SELECT id, parent_portal, student_portal, reason FROM portal_overrides WHERE school_id = ? AND class_name IN (?) LIMIT 1",
                [schoolId, classAliases]
            );

            let overrideId;
            let oldValues = null;
            if (existing.length > 0) {
                overrideId = existing[0].id;
                oldValues = {
                    parent_portal: existing[0].parent_portal,
                    student_portal: existing[0].student_portal,
                    reason: existing[0].reason
                };

                await helpers.execute(
                    `UPDATE portal_overrides 
                     SET parent_portal = ?, student_portal = ?, reason = ?
                     WHERE id = ?`,
                    [parentVal, studentVal, reason || null, overrideId]
                );
            } else {
                const insertResult = await helpers.execute(
                    `INSERT INTO portal_overrides (school_id, class_name, parent_portal, student_portal, reason)
                     VALUES (?, ?, ?, ?, ?)`,
                    [schoolId, canonicalClassName, parentVal, studentVal, reason || null]
                );
                overrideId = insertResult.insertId;
            };

            await recomputePortalAccessForClass(schoolId, class_name, helpers);
            await logSchoolActivity(req, {
                action: existing.length > 0 ? 'update_portal_override' : 'create_portal_override',
                entityType: 'portal_override',
                entityId: overrideId,
                oldValues,
                newValues: { parent_portal: parentVal, student_portal: studentVal, reason },
                description: `${existing.length > 0 ? 'Updated' : 'Created'} portal override for class ${class_name} (Parent: ${parentVal ? 'ON' : 'OFF'}, Student: ${studentVal ? 'ON' : 'OFF'})`
            });
        });

        req.flash('success', `Portal rules override applied successfully for ${class_name}. Users credentials have been updated.`);
        res.redirect('/schooladmin/portal/overrides');
    } catch (err) {
        console.error('[PortalController.createOverride] Error:', err);
        req.flash('error', 'Failed to save portal override.');
        res.redirect('/schooladmin/portal/overrides');
    };
};

exports.deleteOverride = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session?.user?.school_id || null;
        if (!schoolId) {
            return res.status(401).json({ success: false, message: 'Unauthorized.' });
        };

        const { class_name } = req.body;
        if (!class_name) {
            req.flash('error', 'Class name is required.');
            return res.redirect('/schooladmin/portal/overrides');
        };

        await db.withTransaction(async (helpers) => {
            const classAliases = portalService.getClassNameAliases(class_name);
            const existing = await helpers.query(
                "SELECT id, parent_portal, student_portal, reason FROM portal_overrides WHERE school_id = ? AND class_name IN (?) LIMIT 1",
                [schoolId, classAliases]
            );

            if (existing.length > 0) {
                await helpers.execute(
                    "DELETE FROM portal_overrides WHERE id = ?",
                    [existing[0].id]
                );

                await recomputePortalAccessForClass(schoolId, class_name, helpers);
                await logSchoolActivity(req, {
                    action: 'delete_portal_override',
                    entityType: 'portal_override',
                    entityId: existing[0].id,
                    oldValues: {
                        parent_portal: existing[0].parent_portal,
                        student_portal: existing[0].student_portal,
                        reason: existing[0].reason
                    },
                    newValues: null,
                    description: `Deleted portal override for class ${class_name}, reverting to defaults.`
                });
            };
        });

        req.flash('success', `Portal override removed for ${class_name}. Defaults have been restored.`);
        res.redirect('/schooladmin/portal/overrides');
    } catch (err) {
        console.error('[PortalController.deleteOverride] Error:', err);
        req.flash('error', 'Failed to remove portal override.');
        res.redirect('/schooladmin/portal/overrides');
    };
};

exports.recomputePortalAccessForClass = recomputePortalAccessForClass;

async function updateStudentFamilyParentLink(studentId, schoolId, parentUserId, parentInfo, conn) {
    const [rows] = await conn.query(
        "SELECT id FROM student_family WHERE student_id = ? LIMIT 1",
        [studentId]
    );

    if (rows.length > 0) {
        await conn.query(
            `UPDATE student_family 
             SET school_id = ?, parent_user_id = ? 
             WHERE student_id = ?`,
            [schoolId, parentUserId, studentId]
        );
    } else {
        const fatherName = parentInfo.student.father_email === parentInfo.email ? parentInfo.name : parentInfo.student.father_name;
        const fatherPhone = parentInfo.student.father_email === parentInfo.email ? parentInfo.phone : parentInfo.student.father_phone;
        const fatherEmail = parentInfo.student.father_email === parentInfo.email ? parentInfo.email : parentInfo.student.father_email;
        const motherName = parentInfo.student.mother_email === parentInfo.email ? parentInfo.name : parentInfo.student.mother_name;
        const motherPhone = parentInfo.student.mother_email === parentInfo.email ? parentInfo.phone : parentInfo.student.mother_phone;
        const motherEmail = parentInfo.student.mother_email === parentInfo.email ? parentInfo.email : parentInfo.student.mother_email;
        const guardianName = parentInfo.student.guardian_email === parentInfo.email ? parentInfo.name : parentInfo.student.guardian_name;
        const guardianPhone = parentInfo.student.guardian_email === parentInfo.email ? parentInfo.phone : parentInfo.student.guardian_phone;
        const guardianEmail = parentInfo.student.guardian_email === parentInfo.email ? parentInfo.email : parentInfo.student.guardian_email;

        await conn.query(
            `INSERT INTO student_family 
            (student_id, father_name, father_phone, father_email, mother_name, mother_phone, mother_email, guardian_name, guardian_phone, guardian_email, school_id, parent_user_id) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [ studentId,  fatherName || null, fatherPhone || null, fatherEmail || null, motherName || null, motherPhone || null, motherEmail || null, guardianName || null, guardianPhone || null, guardianEmail || null, schoolId, parentUserId ]
        );
    };
};