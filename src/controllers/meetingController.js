const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const db = require('../config/database');
const NotificationService = require('../services/notificationService');
const jitsiConfig = require('../config/jitsi');

const ALLOWED_TARGET_TYPES = new Set(['all', 'teachers', 'students', 'parents', 'staff', 'drivers', 'librarians', 'specific_class', 'multiple_classes']);

const TARGET_ALIASES = {
    teacher: 'teachers',
    student: 'students',
    parent: 'parents',
    driver: 'drivers',
    librarian: 'librarians',
    classes: 'multiple_classes',
    class: 'specific_class'
};

const STATUS_ALIASES = {
    upcoming: 'scheduled',
    ongoing: 'live',
    ended: 'completed'
};

const ALLOWED_MEETING_STATUSES = new Set(['scheduled', 'live', 'completed', 'cancelled']);

function getSchoolId(req) {
    return req.user?.school_id || req.session?.user?.school_id || null;
};

function getViewFolder(role) {
    if (role === 'school_admin') return 'schoolAdmin';
    if (role === 'super_admin') return 'superAdmin';
    return role;
};

function getLayoutForRole(role) {
    if (role === 'school_admin') return 'schoolAdmin/layout';
    if (role === 'super_admin') return 'superAdmin/layout';
    if (role === 'group_admin') return 'groupAdmin/layout';
    if (['teacher', 'driver', 'student', 'parent', 'librarian'].includes(role)) return `${role}/layout`;
    return null;
};

function normalizeTargetType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return TARGET_ALIASES[normalized] || normalized;
};

function normalizeMeetingStatus(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return STATUS_ALIASES[normalized] || normalized;
};

function isCompletedStatus(status) {
    return normalizeMeetingStatus(status) === 'completed';
};

function normalizeIdList(value) {
    const rawList = Array.isArray(value) ? value : (value ? [value] : []);
    const ids = rawList
        .map((id) => Number.parseInt(id, 10))
        .filter((id) => Number.isInteger(id) && id > 0);
    return [...new Set(ids)];
};

async function validateMeetingPayload(req, existingMeeting = null) {
    const schoolId = getSchoolId(req);
    const errors = [];
    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    const scheduledAtRaw = String(req.body.scheduled_at || '').trim();
    const durationMinutes = Number.parseInt(req.body.duration_minutes, 10);
    const targetType = normalizeTargetType(req.body.target_type);
    const selectedClassIds = normalizeIdList(req.body.class_ids);
    const targetClassIds = normalizeIdList(req.body.target_class_id);
    const targetClassId = targetClassIds[0] || null;

    if (!title) {
        errors.push('Meeting title is required.');
    };

    const scheduledAt = scheduledAtRaw ? new Date(scheduledAtRaw) : null;
    if (!scheduledAtRaw || !scheduledAt || Number.isNaN(scheduledAt.getTime())) {
        errors.push('Meeting date and time is required.');
    } else if (scheduledAt.getTime() <= Date.now()) {
        errors.push('Meeting cannot be scheduled in the past.');
    };

    if (!Number.isInteger(durationMinutes)) {
        errors.push('Duration is required.');
    } else if (durationMinutes < 5 || durationMinutes > 300) {
        errors.push('Duration must be between 5 and 300 minutes.');
    };

    if (!ALLOWED_TARGET_TYPES.has(targetType)) {
        errors.push('Please select a valid target audience.');
    };

    let finalTargetClassId = null;
    let finalClassIds = [];
    if (targetType === 'specific_class') {
        if (!targetClassId) {
            errors.push('Please select a class for this meeting.');
        } else {
            finalClassIds = [targetClassId];
            finalTargetClassId = targetClassId;
        };
    } else if (targetType === 'multiple_classes') {
        if (selectedClassIds.length === 0) {
            errors.push('Please select at least one class for this meeting.');
        } else {
            finalClassIds = selectedClassIds;
        };
    };

    if (finalClassIds.length > 0) {
        const rows = await db.queryAsync(
            'SELECT id FROM classes WHERE school_id = ? AND id IN (?)',
            [schoolId, finalClassIds]
        );
        const validClassIds = new Set(rows.map((row) => Number(row.id)));
        const invalidClassIds = finalClassIds.filter((id) => !validClassIds.has(id));
        if (invalidClassIds.length > 0 || rows.length !== finalClassIds.length) {
            errors.push('One or more selected classes do not belong to your school.');
        };
    };

    if (existingMeeting && existingMeeting.status && normalizeMeetingStatus(existingMeeting.status) !== 'scheduled') {
        errors.push('Only scheduled meetings can be edited.');
    };

    return {
        valid: errors.length === 0,
        errors,
        values: {
            schoolId,
            title,
            description: description || null,
            scheduledAt: scheduledAtRaw,
            durationMinutes,
            targetType,
            finalTargetClassId,
            finalClassIds: targetType === 'multiple_classes' ? finalClassIds : []
        }
    };
};

function flashValidationErrors(req, errors) {
    req.flash('error', errors.join(' '));
};

async function getEligibleUsers(schoolId, targetType, targetClassId, meetingId) {
    let sql = '';
    let params = [];

    switch (targetType) {
        case 'all':
            sql = "SELECT id, role FROM users WHERE school_id = ? AND status = 'active'";
            params = [schoolId];
            break;
        case 'teachers':
            sql = "SELECT id, role FROM users WHERE school_id = ? AND role = 'teacher' AND status = 'active'";
            params = [schoolId];
            break;
        case 'students':
            sql = "SELECT id, role FROM users WHERE school_id = ? AND role = 'student' AND status = 'active'";
            params = [schoolId];
            break;
        case 'parents':
            sql = "SELECT id, role FROM users WHERE school_id = ? AND role = 'parent' AND status = 'active'";
            params = [schoolId];
            break;
        case 'staff':
            sql = "SELECT id, role FROM users WHERE school_id = ? AND role IN ('teacher', 'driver', 'librarian') AND status = 'active'";
            params = [schoolId];
            break;
        case 'drivers':
            sql = "SELECT id, role FROM users WHERE school_id = ? AND role = 'driver' AND status = 'active'";
            params = [schoolId];
            break;
        case 'librarians':
            sql = "SELECT id, role FROM users WHERE school_id = ? AND role = 'librarian' AND status = 'active'";
            params = [schoolId];
            break;
        case 'specific_class':
            sql = `
                SELECT u.id, u.role FROM users u 
                JOIN students s ON s.user_id = u.id 
                WHERE s.class_id = ? AND s.school_id = ? AND s.deleted_at IS NULL AND u.status = 'active'
                UNION DISTINCT
                SELECT DISTINCT u.id, u.role FROM users u 
                JOIN student_family sf ON u.id = sf.parent_user_id
                JOIN students s ON sf.student_id = s.id AND sf.school_id = s.school_id
                WHERE s.class_id = ? AND s.school_id = ? AND s.deleted_at IS NULL AND u.role = 'parent' AND u.status = 'active'
                UNION DISTINCT
                SELECT DISTINCT u.id, u.role FROM users u 
                JOIN teachers t ON t.user_id = u.id 
                JOIN teacher_class_assign tca ON tca.teacher_id = t.id 
                WHERE tca.class_id = ? AND tca.school_id = ? AND u.status = 'active'
            `;
            params = [targetClassId, schoolId, targetClassId, schoolId, targetClassId, schoolId];
            break;
        case 'multiple_classes':
            sql = `
                SELECT u.id, u.role FROM users u 
                JOIN students s ON s.user_id = u.id 
                JOIN meeting_classes mc ON s.class_id = mc.class_id
                WHERE mc.meeting_id = ? AND s.school_id = ? AND s.deleted_at IS NULL AND u.status = 'active'
                UNION DISTINCT
                SELECT DISTINCT u.id, u.role FROM users u 
                JOIN student_family sf ON u.id = sf.parent_user_id
                JOIN students s ON sf.student_id = s.id AND sf.school_id = s.school_id
                JOIN meeting_classes mc ON s.class_id = mc.class_id
                WHERE mc.meeting_id = ? AND s.school_id = ? AND s.deleted_at IS NULL AND u.role = 'parent' AND u.status = 'active'
                UNION DISTINCT
                SELECT DISTINCT u.id, u.role FROM users u 
                JOIN teachers t ON t.user_id = u.id 
                JOIN teacher_class_assign tca ON tca.teacher_id = t.id 
                JOIN meeting_classes mc ON tca.class_id = mc.class_id
                WHERE mc.meeting_id = ? AND tca.school_id = ? AND u.status = 'active'
            `;
            params = [meetingId, schoolId, meetingId, schoolId, meetingId, schoolId];
            break;
        default:
            return [];
    };
    return await db.queryAsync(sql, params);
};

exports.listSchoolAdminMeetings = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { status, search } = req.query;

        let sql = `
            SELECT m.*, 
                CONCAT(u.first_name, ' ', COALESCE(u.last_name, '')) as creator_name,
                CONCAT_WS(' - ', CONCAT('Class ', c.class_name), c.section, c.medium, NULLIF(c.stream, '')) as class_name
            FROM meetings m
            LEFT JOIN users u ON m.created_by = u.id
            LEFT JOIN classes c ON m.target_class_id = c.id AND c.school_id = m.school_id
            WHERE m.school_id = ?
        `;
        const params = [schoolId];

        const normalizedStatus = normalizeMeetingStatus(status);
        if (status && status !== 'all' && ALLOWED_MEETING_STATUSES.has(normalizedStatus)) {
            sql += " AND m.status = ?";
            params.push(normalizedStatus);
        };

        if (search) {
            sql += " AND m.title LIKE ?";
            params.push(`%${search}%`);
        };

        sql += " ORDER BY m.scheduled_at DESC";
        const meetings = await db.queryAsync(sql, params);
        meetings.forEach((meeting) => {
            meeting.status = normalizeMeetingStatus(meeting.status);
            meeting.target_type = normalizeTargetType(meeting.target_type);
        });

        res.render('schoolAdmin/meetings/list', {
            title: 'Manage Video Meetings',
            meetings,
            filters: { status: ALLOWED_MEETING_STATUSES.has(normalizedStatus) ? normalizedStatus : 'all', search: search || '' },
            user: req.user,
            layout: 'schoolAdmin/layout',
            currentPath: '/schooladmin/meetings'
        });
    } catch (err) {
        console.error('listSchoolAdminMeetings Error:', err);
        req.flash('error', 'Failed to load meetings list.');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.renderCreateForm = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const classes = await db.queryAsync(
            `SELECT id, class_name, section,
                CONCAT_WS(' - ', CONCAT('Class ', class_name), section, medium, NULLIF(stream, '')) AS display_name
            FROM classes
            WHERE school_id = ?
            ORDER BY class_name ASC, section ASC`,
            [schoolId]
        );

        res.render('schoolAdmin/meetings/create', {
            title: 'Schedule Meeting',
            classes,
            user: req.user,
            layout: 'schoolAdmin/layout',
            currentPath: '/schooladmin/meetings/create'
        });
    } catch (err) {
        console.error('renderCreateForm Error:', err);
        req.flash('error', 'Failed to load schedule meeting page.');
        res.redirect('/schooladmin/meetings');
    };
};

exports.createMeeting = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const validation = await validateMeetingPayload(req);

        if (!validation.valid) {
            flashValidationErrors(req, validation.errors);
            return res.redirect('/schooladmin/meetings/create');
        };

        const { title, description, scheduledAt, durationMinutes, targetType, finalTargetClassId, finalClassIds } = validation.values;
        const randomHex = crypto.randomBytes(8).toString('hex');
        const roomName = `schoolsync-${schoolId}-${randomHex}`;
        const result = await db.withTransaction(async (helpers) => {
            const insertMeetingSql = `
                INSERT INTO meetings 
                (school_id, created_by, creator_role, title, description, room_name, scheduled_at, duration_minutes, target_type, target_class_id, status)
                VALUES (?, ?, 'school_admin', ?, ?, ?, ?, ?, ?, ?, 'scheduled')
            `;
            const meetingResult = await helpers.execute(insertMeetingSql, [
                schoolId,
                req.user.id,
                title,
                description,
                roomName,
                scheduledAt,
                durationMinutes,
                targetType,
                finalTargetClassId
            ]);
            const meetingId = meetingResult.insertId;

            if (targetType === 'multiple_classes') {
                for (const classId of finalClassIds) {
                    await helpers.execute(
                        'INSERT INTO meeting_classes (meeting_id, class_id) VALUES (?, ?)',
                        [meetingId, classId]
                    );
                };
            };
            return meetingId;
        });

        getEligibleUsers(schoolId, targetType, finalTargetClassId, result)
            .then(async (recipients) => {
                for (const recipient of recipients) {
                    await NotificationService.createAndSend({
                        recipient_id: recipient.id,
                        recipient_role: recipient.role,
                        school_id: schoolId,
                        title: 'New Video Meeting Scheduled',
                        message: `You are invited to a video meeting: "${title}" scheduled on ${new Date(scheduledAt).toLocaleString('en-IN')}`,
                        type: 'info',
                        category: 'general',
                        reference_type: 'meeting',
                        reference_id: result,
                        created_by: req.user.id,
                        action_url: `/meetings/${result}/join`
                    });
                };
            })
            .catch(err => console.error('Notification queue error:', err));

        req.flash('success', 'Meeting scheduled and notifications sent successfully.');
        res.redirect('/schooladmin/meetings');
    } catch (err) {
        console.error('createMeeting Error:', err);
        req.flash('error', 'Failed to schedule meeting. Please try again.');
        res.redirect('/schooladmin/meetings/create');
    };
};

exports.renderEditForm = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;

        const [meeting] = await db.queryAsync(
            'SELECT * FROM meetings WHERE id = ? AND school_id = ?',
            [id, schoolId]
        );

        if (!meeting) {
            req.flash('error', 'Meeting not found.');
            return res.redirect('/schooladmin/meetings');
        };

        meeting.status = normalizeMeetingStatus(meeting.status);
        if (meeting.status !== 'scheduled') {
            req.flash('error', 'Only scheduled meetings can be edited.');
            return res.redirect(`/schooladmin/meetings/${id}`);
        };

        const classes = await db.queryAsync(
            `SELECT id, class_name, section,
                CONCAT_WS(' - ', CONCAT('Class ', class_name), section, medium, NULLIF(stream, '')) AS display_name
            FROM classes
            WHERE school_id = ?
            ORDER BY class_name ASC, section ASC`,
            [schoolId]
        );

        let selectedClassIds = [];
        meeting.target_type = normalizeTargetType(meeting.target_type);

        if (meeting.target_type === 'multiple_classes') {
            const rows = await db.queryAsync(
                'SELECT class_id FROM meeting_classes WHERE meeting_id = ?',
                [id]
            );
            selectedClassIds = rows.map(r => r.class_id);
        };

        res.render('schoolAdmin/meetings/edit', {
            title: 'Edit Meeting',
            meeting,
            classes,
            selectedClassIds,
            user: req.user,
            layout: 'schoolAdmin/layout',
            currentPath: '/schooladmin/meetings'
        });
    } catch (err) {
        console.error('renderEditForm Error:', err);
        req.flash('error', 'Failed to load edit meeting page.');
        res.redirect('/schooladmin/meetings');
    };
};

exports.updateMeeting = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;

        const [meeting] = await db.queryAsync(
            'SELECT * FROM meetings WHERE id = ? AND school_id = ?',
            [id, schoolId]
        );

        if (!meeting) {
            req.flash('error', 'Meeting not found.');
            return res.redirect('/schooladmin/meetings');
        };

        meeting.status = normalizeMeetingStatus(meeting.status);
        if (meeting.status !== 'scheduled') {
            req.flash('error', 'Only scheduled meetings can be edited.');
            return res.redirect(`/schooladmin/meetings/${id}`);
        };

        const validation = await validateMeetingPayload(req, meeting);
        if (!validation.valid) {
            flashValidationErrors(req, validation.errors);
            return res.redirect(`/schooladmin/meetings/${id}/edit`);
        };

        const { title, description, scheduledAt, durationMinutes, targetType, finalTargetClassId, finalClassIds } = validation.values;
        await db.withTransaction(async (helpers) => {
            const updateSql = `
                UPDATE meetings 
                SET title = ?, description = ?, scheduled_at = ?, duration_minutes = ?, target_type = ?, target_class_id = ?, updated_at = NOW()
                WHERE id = ? AND school_id = ?
            `;
            await helpers.execute(updateSql, [
                title,
                description,
                scheduledAt,
                durationMinutes,
                targetType,
                finalTargetClassId,
                id,
                schoolId
            ]);

            await helpers.execute(
                `DELETE mc FROM meeting_classes mc
                JOIN meetings m ON m.id = mc.meeting_id
                WHERE mc.meeting_id = ? AND m.school_id = ?`,
                [id, schoolId]
            );
            if (targetType === 'multiple_classes') {
                for (const classId of finalClassIds) {
                    await helpers.execute(
                        'INSERT INTO meeting_classes (meeting_id, class_id) VALUES (?, ?)',
                        [id, classId]
                    );
                };
            };
        });

        req.flash('success', 'Meeting updated successfully.');
        res.redirect(`/schooladmin/meetings/${id}`);
    } catch (err) {
        console.error('updateMeeting Error:', err);
        req.flash('error', 'Failed to update meeting.');
        res.redirect(`/schooladmin/meetings/${req.params.id}/edit`);
    };
};

exports.cancelMeeting = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;
        const { cancel_reason } = req.body;

        const [meeting] = await db.queryAsync(
            'SELECT * FROM meetings WHERE id = ? AND school_id = ?',
            [id, schoolId]
        );

        if (!meeting) {
            req.flash('error', 'Meeting not found.');
            return res.redirect('/schooladmin/meetings');
        };

        meeting.status = normalizeMeetingStatus(meeting.status);
        if (meeting.status === 'cancelled' || isCompletedStatus(meeting.status)) {
            req.flash('error', 'Meeting has already been cancelled or completed.');
            return res.redirect(`/schooladmin/meetings/${id}`);
        };

        await db.executeAsync(
            `UPDATE meetings 
            SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = ?, cancel_reason = ?, updated_at = NOW()
            WHERE id = ? AND school_id = ?`,
            [req.user.id, cancel_reason || 'No reason specified', id, schoolId]
        );

        getEligibleUsers(schoolId, meeting.target_type, meeting.target_class_id, id)
            .then(async (recipients) => {
                for (const recipient of recipients) {
                    await NotificationService.createAndSend({
                        recipient_id: recipient.id,
                        recipient_role: recipient.role,
                        school_id: schoolId,
                        title: 'Video Meeting Cancelled',
                        message: `The meeting "${meeting.title}" scheduled on ${new Date(meeting.scheduled_at).toLocaleString('en-IN')} has been cancelled. Reason: ${cancel_reason || 'No reason specified'}`,
                        type: 'warning',
                        category: 'general',
                        reference_type: 'meeting',
                        reference_id: id,
                        created_by: req.user.id,
                        action_url: null
                    });
                };
            })
            .catch(err => console.error('Cancellation notification error:', err));
        req.flash('success', 'Meeting cancelled successfully.');
        res.redirect(`/schooladmin/meetings/${id}`);
    } catch (err) {
        console.error('cancelMeeting Error:', err);
        req.flash('error', 'Failed to cancel meeting.');
        res.redirect(`/schooladmin/meetings/${req.params.id}`);
    };
};

exports.renderSchoolAdminDetails = async (req, res) => {
    try {
        const meetingId = req.params.id;
        const schoolId = req.user?.school_id || req.session?.user?.school_id;
        const [[meeting]] = await db.query(
            `SELECT m.*,
                m.notes,
                m.recording_url,
                u.first_name AS creator_first_name,
                u.last_name AS creator_last_name
            FROM meetings m
            LEFT JOIN users u ON m.created_by = u.id
            WHERE m.id = ? AND m.school_id = ?`,
            [meetingId, schoolId]
        );

        if (!meeting) {
            req.flash('error', 'Failed to load meeting details.');
            return res.redirect('/schooladmin/meetings');
        };

        meeting.status = normalizeMeetingStatus(meeting.status);
        meeting.target_type = normalizeTargetType(meeting.target_type);

        const creatorName = meeting.creator_first_name ? `${meeting.creator_first_name} ${meeting.creator_last_name || ''}`.trim() : 'Unknown';
        let targetDisplay = meeting.target_type.replace('_', ' ');
        if (meeting.target_type === 'specific_class') {
            const [cls] = await db.queryAsync(
                `SELECT CONCAT_WS(' - ', CONCAT('Class ', class_name), section, medium, NULLIF(stream, '')) AS display_name
                FROM classes WHERE id = ? AND school_id = ?`,
                [meeting.target_class_id, meeting.school_id]
            );
            targetDisplay = `Class ${cls?.display_name || ''}`;
        } else if (meeting.target_type === 'multiple_classes') {
            const classes = await db.queryAsync(
                `SELECT CONCAT_WS(' - ', CONCAT('Class ', c.class_name), c.section, c.medium, NULLIF(c.stream, '')) AS display_name
                FROM classes c
                JOIN meeting_classes mc ON c.id = mc.class_id
                WHERE mc.meeting_id = ? AND c.school_id = ?`,
                [meeting.id, meeting.school_id]
            );
            targetDisplay = `Classes: ${classes.map(c => c.display_name).join(', ')}`;
        };

        res.render('schoolAdmin/meetings/details', {
            title: 'Meeting Details',
            meeting,
            creatorName,
            targetDisplay,
            user: req.user,
            canEdit: true,
            layout: 'schoolAdmin/layout',
            currentPath: '/schooladmin/meetings'
        });
    } catch (err) {
        console.error('renderSchoolAdminDetails Error:', err);
        req.flash('error', 'Failed to load meeting details.');
        res.redirect('/schooladmin/meetings');
    };
};

exports.listParticipantMeetings = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const role = req.user.role;
        const userId = req.user.id;

        const sql = `
            SELECT m.*, 
                CONCAT(u.first_name, ' ', COALESCE(u.last_name, '')) as creator_name,
               CONCAT_WS(' - ', CONCAT('Class ', c.class_name), c.section, c.medium, NULLIF(c.stream, '')) as class_name
            FROM meetings m
            LEFT JOIN users u ON m.created_by = u.id
            LEFT JOIN classes c ON m.target_class_id = c.id AND c.school_id = m.school_id
            WHERE m.school_id = ? 
                AND m.status != 'cancelled'
                AND (
                    m.target_type = 'all'
                    OR (m.target_type = 'teachers' AND ? = 'teacher')
                    OR (m.target_type = 'students' AND ? = 'student')
                    OR (m.target_type = 'parents' AND ? = 'parent')
                    OR (m.target_type = 'staff' AND ? IN ('teacher', 'driver', 'librarian'))
                    OR (m.target_type = 'drivers' AND ? = 'driver')
                    OR (m.target_type = 'librarians' AND ? = 'librarian')
                    OR (m.target_type = 'specific_class' AND (
                        (? = 'student' AND m.target_class_id IN (SELECT class_id FROM students WHERE user_id = ? AND school_id = m.school_id AND deleted_at IS NULL))
                        OR (? = 'parent' AND m.target_class_id IN (SELECT s.class_id FROM students s JOIN student_family sf ON s.id = sf.student_id AND sf.school_id = s.school_id WHERE sf.parent_user_id = ? AND s.school_id = m.school_id AND s.deleted_at IS NULL))
                        OR (? = 'teacher' AND m.target_class_id IN (SELECT tca.class_id FROM teacher_class_assign tca JOIN teachers t ON tca.teacher_id = t.id WHERE t.user_id = ? AND tca.school_id = m.school_id))
                    ))
                    OR (m.target_type = 'multiple_classes' AND (
                        (? = 'student' AND m.id IN (SELECT mc.meeting_id FROM meeting_classes mc JOIN students s ON mc.class_id = s.class_id WHERE s.user_id = ? AND s.school_id = m.school_id AND s.deleted_at IS NULL))
                        OR (? = 'parent' AND m.id IN (SELECT mc.meeting_id FROM meeting_classes mc JOIN students s ON mc.class_id = s.class_id JOIN student_family sf ON s.id = sf.student_id AND sf.school_id = s.school_id WHERE sf.parent_user_id = ? AND s.school_id = m.school_id AND s.deleted_at IS NULL))
                        OR (? = 'teacher' AND m.id IN (SELECT mc.meeting_id FROM meeting_classes mc JOIN teacher_class_assign tca ON mc.class_id = tca.class_id JOIN teachers t ON tca.teacher_id = t.id WHERE t.user_id = ? AND tca.school_id = m.school_id))
                    ))
                )
            ORDER BY m.scheduled_at DESC
        `;

        const params = [schoolId, role, role, role, role, role, role, role, userId, role, userId, role, userId, role, userId, role, userId, role, userId];
        const meetings = await db.queryAsync(sql, params);
        meetings.forEach((meeting) => {
            meeting.status = normalizeMeetingStatus(meeting.status);
            meeting.target_type = normalizeTargetType(meeting.target_type);
        });

        const viewPrefix = getViewFolder(role);
        res.render(`${viewPrefix}/meetings/my-meetings`, {
            title: 'My Video Meetings',
            meetings,
            user: req.user,
            layout: getLayoutForRole(role),
            currentPath: `/${role}/meetings`
        });
    } catch (err) {
        console.error('listParticipantMeetings Error:', err);
        req.flash('error', 'Failed to load your meetings list.');
        res.redirect('/login');
    };
};

exports.renderParticipantDetails = async (req, res) => {
    try {
        const meeting = req.meeting;
        meeting.status = normalizeMeetingStatus(meeting.status);
        meeting.target_type = normalizeTargetType(meeting.target_type);
        const role = req.user.role;

        const [creator] = await db.queryAsync(
            "SELECT CONCAT(first_name, ' ', COALESCE(last_name, '')) as name FROM users WHERE id = ?",
            [meeting.created_by]
        );

        let targetDisplay = meeting.target_type.replace('_', ' ');
        if (meeting.target_type === 'specific_class') {
            const [cls] = await db.queryAsync(
                `SELECT CONCAT_WS(' - ', CONCAT('Class ', class_name), section, medium, NULLIF(stream, '')) AS display_name
                FROM classes WHERE id = ? AND school_id = ?`,
                [meeting.target_class_id, meeting.school_id]
            );
            targetDisplay = `Class ${cls?.display_name || ''}`;
        } else if (meeting.target_type === 'multiple_classes') {
            const classes = await db.queryAsync(
                `SELECT CONCAT_WS(' - ', CONCAT('Class ', c.class_name), c.section, c.medium, NULLIF(c.stream, '')) AS display_name
                FROM classes c
                JOIN meeting_classes mc ON c.id = mc.class_id
                WHERE mc.meeting_id = ? AND c.school_id = ?`,
                [meeting.id, meeting.school_id]
            );
            targetDisplay = `Classes: ${classes.map(c => c.display_name).join(', ')}`;
        };

        const [attendance] = await db.queryAsync(
            'SELECT joined_at, left_at, duration_minutes FROM meeting_attendance WHERE meeting_id = ? AND user_id = ? ORDER BY joined_at DESC LIMIT 1',
            [meeting.id, req.user.id]
        );

        const viewPrefix = getViewFolder(role);
        res.render(`${viewPrefix}/meetings/details`, {
            title: 'Meeting Details',
            meeting,
            creatorName: creator?.name || 'Unknown',
            targetDisplay,
            attendance,
            user: req.user,
            layout: getLayoutForRole(role),
            currentPath: `/${role}/meetings`
        });
    } catch (err) {
        console.error('renderParticipantDetails Error:', err);
        req.flash('error', 'Failed to load meeting details.');
        res.redirect(req.get('Referrer') || '/');
    };
};

exports.joinMeeting = async (req, res) => {
    try {
        const meeting = req.meeting;
        const schoolId = meeting.school_id || getSchoolId(req);
        const userId = req.user.id;
        const role = req.user.role;

        if (!schoolId || !userId) {
            req.flash('error', 'Unauthorized meeting access.');
            return res.redirect(req.get('Referrer') || '/');
        };

        const activeAttendance = await db.executeAsync(
            `UPDATE meeting_attendance
            SET role = ?,
                last_seen_at = NOW(),
                duration_minutes = GREATEST(0, TIMESTAMPDIFF(MINUTE, joined_at, NOW()))
            WHERE school_id = ? AND meeting_id = ? AND user_id = ? AND left_at IS NULL`,
            [role, schoolId, meeting.id, userId]
        );

        if (!activeAttendance.affectedRows) {
            await db.executeAsync(
                `INSERT INTO meeting_attendance
                    (school_id, meeting_id, user_id, role, joined_at, last_seen_at, left_at, duration_minutes, confirmed, confirmed_at)
                VALUES (?, ?, ?, ?, NOW(), NOW(), NULL, 0, 0, NULL)
                ON DUPLICATE KEY UPDATE
                    role = VALUES(role),
                    last_seen_at = NOW(),
                    left_at = NULL,
                    duration_minutes = GREATEST(0, TIMESTAMPDIFF(MINUTE, joined_at, NOW()))`,
                [schoolId, meeting.id, userId, role]
            );
        };

        const viewPrefix = getViewFolder(role);
        res.render(`${viewPrefix}/meetings/join`, {
            title: `Meeting: ${meeting.title}`,
            meeting,
            jitsiDomain: jitsiConfig.domain,
            user: req.user,
            layout: false
        });
    } catch (err) {
        console.error('joinMeeting Error:', err);
        req.flash('error', 'Failed to initialize Jitsi room.');
        res.redirect(req.get('Referrer') || '/');
    };
};

exports.heartbeat = async (req, res) => {
    try {
        const meetingId = req.params.id;
        const schoolId = req.meeting?.school_id || getSchoolId(req);
        const userId = req.user.id;

        await db.executeAsync(
            `UPDATE meeting_attendance
            SET last_seen_at = NOW(),
                duration_minutes = GREATEST(0, TIMESTAMPDIFF(MINUTE, joined_at, NOW()))
            WHERE school_id = ? AND meeting_id = ? AND user_id = ? AND left_at IS NULL`,
            [schoolId, meetingId, userId]
        );

        return res.json({ success: true });
    } catch (err) {
        console.error('Heartbeat Error:', err);
        return res.status(500).json({ success: false, message: 'Server error during heartbeat.' });
    };
};

exports.leave = async (req, res) => {
    try {
        const meetingId = req.params.id;
        const schoolId = req.meeting?.school_id || getSchoolId(req);
        const userId = req.user.id;

        await db.executeAsync(
            `UPDATE meeting_attendance
            SET left_at = NOW(),
                last_seen_at = NOW(),
                duration_minutes = GREATEST(0, TIMESTAMPDIFF(MINUTE, joined_at, NOW()))
            WHERE school_id = ? AND meeting_id = ? AND user_id = ? AND left_at IS NULL`,
            [schoolId, meetingId, userId]
        );
        return res.json({ success: true });
    } catch (err) {
        console.error('Leave Tracking Error:', err);
        return res.status(500).json({ success: false, message: 'Server error during leave tracking.' });
    };
};

exports.renderAttendanceReport = async (req, res) => {
    try {
        const meeting = req.meeting;
        meeting.status = normalizeMeetingStatus(meeting.status);
        meeting.target_type = normalizeTargetType(meeting.target_type);
        const schoolId = getSchoolId(req);

        const attendees = await db.queryAsync(
            `SELECT ma.*, CONCAT_WS(' ', u.first_name, u.last_name) AS name, u.email 
            FROM meeting_attendance ma 
            JOIN users u ON ma.user_id = u.id 
            WHERE ma.meeting_id = ? AND u.school_id = ?
            ORDER BY ma.joined_at DESC`,
            [meeting.id, schoolId]
        );

        let totalInvited = 0;
        const classId = meeting.target_class_id;

        switch (meeting.target_type) {
            case 'all':
                const allRows = await db.queryAsync("SELECT COUNT(*) as count FROM users WHERE school_id = ? AND status = 'active'", [schoolId]);
                totalInvited = allRows[0]?.count || 0;
                break;
            case 'teachers':
                const teacherRows = await db.queryAsync("SELECT COUNT(*) as count FROM users WHERE school_id = ? AND role = 'teacher' AND status = 'active'", [schoolId]);
                totalInvited = teacherRows[0]?.count || 0;
                break;
            case 'students':
                const studentRows = await db.queryAsync("SELECT COUNT(*) as count FROM users WHERE school_id = ? AND role = 'student' AND status = 'active'", [schoolId]);
                totalInvited = studentRows[0]?.count || 0;
                break;
            case 'parents':
                const parentRows = await db.queryAsync("SELECT COUNT(*) as count FROM users WHERE school_id = ? AND role = 'parent' AND status = 'active'", [schoolId]);
                totalInvited = parentRows[0]?.count || 0;
                break;
            case 'staff':
                const staffRows = await db.queryAsync("SELECT COUNT(*) as count FROM users WHERE school_id = ? AND role IN ('teacher', 'driver', 'librarian') AND status = 'active'", [schoolId]);
                totalInvited = staffRows[0]?.count || 0;
                break;
            case 'drivers':
                const driverRows = await db.queryAsync("SELECT COUNT(*) as count FROM users WHERE school_id = ? AND role = 'driver' AND status = 'active'", [schoolId]);
                totalInvited = driverRows[0]?.count || 0;
                break;
            case 'librarians':
                const libRows = await db.queryAsync("SELECT COUNT(*) as count FROM users WHERE school_id = ? AND role = 'librarian' AND status = 'active'", [schoolId]);
                totalInvited = libRows[0]?.count || 0;
                break;
            case 'specific_class':
                const sc1 = (await db.queryAsync('SELECT COUNT(*) as count FROM students WHERE class_id = ? AND school_id = ? AND deleted_at IS NULL', [classId, schoolId]))[0]?.count || 0;
                const sc2 = (await db.queryAsync(`
                    SELECT COUNT(DISTINCT u.id) as count FROM users u 
                    JOIN student_family sf ON u.id = sf.parent_user_id
                    JOIN students s ON sf.student_id = s.id AND sf.school_id = s.school_id
                    WHERE s.class_id = ? AND s.school_id = ? AND s.deleted_at IS NULL AND u.role = 'parent' AND u.status = 'active'`, [classId, schoolId]))[0]?.count || 0;
                const sc3 = (await db.queryAsync(`
                    SELECT COUNT(DISTINCT t.user_id) as count FROM teacher_class_assign tca 
                    JOIN teachers t ON tca.teacher_id = t.id 
                    WHERE tca.class_id = ? AND tca.school_id = ?`, [classId, schoolId]))[0]?.count || 0;
                totalInvited = sc1 + sc2 + sc3;
                break;
            case 'multiple_classes':
                const mc1 = (await db.queryAsync('SELECT COUNT(*) as count FROM students WHERE class_id IN (SELECT class_id FROM meeting_classes WHERE meeting_id = ?) AND school_id = ? AND deleted_at IS NULL', [meeting.id, schoolId]))[0]?.count || 0;
                const mc2 = (await db.queryAsync(`
                    SELECT COUNT(DISTINCT u.id) as count FROM users u 
                    JOIN student_family sf ON u.id = sf.parent_user_id
                    JOIN students s ON sf.student_id = s.id AND sf.school_id = s.school_id
                    WHERE s.class_id IN (SELECT class_id FROM meeting_classes WHERE meeting_id = ?) AND s.school_id = ? AND s.deleted_at IS NULL AND u.role = 'parent' AND u.status = 'active'`, [meeting.id, schoolId]))[0]?.count || 0;
                const mc3 = (await db.queryAsync(`
                    SELECT COUNT(DISTINCT t.user_id) as count FROM teacher_class_assign tca 
                    JOIN teachers t ON tca.teacher_id = t.id 
                    WHERE tca.class_id IN (SELECT class_id FROM meeting_classes WHERE meeting_id = ?) AND tca.school_id = ?`, [meeting.id, schoolId]))[0]?.count || 0;
                totalInvited = mc1 + mc2 + mc3;
                break;
        };

        const totalJoined = attendees.length;
        const attendancePercent = totalInvited > 0 ? Math.round((totalJoined / totalInvited) * 100) : 0;
        let totalDuration = 0;
        attendees.forEach(a => totalDuration += a.duration_minutes || 0);
        const avgDuration = totalJoined > 0 ? Math.round(totalDuration / totalJoined) : 0;

        res.render('schoolAdmin/meetings/attendance-report', {
            title: 'Attendance Report',
            meeting,
            attendees,
            stats: {
                totalInvited,
                totalJoined,
                attendancePercent,
                avgDuration
            },
            user: req.user,
            currentPath: '/schooladmin/meetings'
        });
    } catch (err) {
        console.error('renderAttendanceReport Error:', err);
        req.flash('error', 'Failed to load attendance report.');
        res.redirect(`/schooladmin/meetings/${req.meeting.id}`);
    };
};

exports.autoUpdateMeetingStatuses = async () => {
    try {
        const liveResult = await db.executeAsync(
            `UPDATE meetings
            SET status = 'live', started_at = NOW(), updated_at = NOW()
            WHERE status IN ('scheduled', 'upcoming')
                AND scheduled_at <= NOW()
                AND NOW() <= DATE_ADD(scheduled_at, INTERVAL duration_minutes MINUTE)`
        );

        const endingMeetings = await db.queryAsync(
            `SELECT id FROM meetings
            WHERE status IN ('live', 'ongoing')
                AND NOW() > DATE_ADD(scheduled_at, INTERVAL (duration_minutes + 15) MINUTE)`
        );

        if (endingMeetings && endingMeetings.length > 0) {
            const meetingIds = endingMeetings.map((m) => m.id);
            const meetingIdPlaceholders = meetingIds.map(() => '?').join(', ');

            await db.executeAsync(
                `UPDATE meeting_attendance
                SET left_at = last_seen_at,
                    duration_minutes = GREATEST(0, TIMESTAMPDIFF(MINUTE, joined_at, last_seen_at))
                WHERE meeting_id IN (${meetingIdPlaceholders}) AND left_at IS NULL`,
                meetingIds
            );

            const endedResult = await db.executeAsync(
                `UPDATE meetings
                SET status = 'completed', ended_at = NOW(), updated_at = NOW()
                WHERE id IN (${meetingIdPlaceholders})`,
                meetingIds
            );
        };

        const missedResult = await db.executeAsync(
            `UPDATE meetings
            SET status = 'completed', ended_at = NOW(), updated_at = NOW()
            WHERE status IN ('scheduled', 'upcoming')
                AND started_at IS NULL
                AND NOW() > DATE_ADD(scheduled_at, INTERVAL (duration_minutes + 15) MINUTE)`
        );
    } catch (err) {
        console.error('autoUpdateMeetingStatuses Error:', err);
    };
};

exports.saveMeetingNotes = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        if (!schoolId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const meetingId = parseInt(req.params.id, 10);
        const notes = String(req.body.notes || '').trim();

        if (notes.length > 5000) {
            return res.status(400).json({ success: false, message: 'Notes cannot exceed 5000 characters' });
        };

        const [[meeting]] = await db.query(
            'SELECT id FROM meetings WHERE id = ? AND school_id = ?',
            [meetingId, schoolId]
        );

        if (!meeting) {
            return res.status(404).json({ success: false, message: 'Meeting not found' });
        };

        await db.query(
            'UPDATE meetings SET notes = ?, updated_at = NOW() WHERE id = ? AND school_id = ?',
            [notes || null, meetingId, schoolId]
        );

        res.json({ success: true, message: 'Notes saved successfully' });
    } catch (err) {
        console.error('[MeetingController saveMeetingNotes]', err);
        res.status(500).json({ success: false, message: 'Failed to save notes' });
    };
};

exports.saveRecordingLink = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        if (!schoolId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const meetingId = parseInt(req.params.id, 10);
        const recordingUrl = String(req.body.recording_url || '').trim();

        if (recordingUrl && !recordingUrl.startsWith('http://') && !recordingUrl.startsWith('https://')) {
            return res.status(400).json({ success: false, message: 'Recording URL must start with http:// or https://' });
        };

        const [[meeting]] = await db.query(
            'SELECT id FROM meetings WHERE id = ? AND school_id = ?',
            [meetingId, schoolId]
        );

        if (!meeting) {
            return res.status(404).json({ success: false, message: 'Meeting not found' });
        };

        await db.query(
            'UPDATE meetings SET recording_url = ?, updated_at = NOW() WHERE id = ? AND school_id = ?',
            [recordingUrl || null, meetingId, schoolId]
        );

        res.json({ success: true, message: 'Recording link saved' });
    } catch (err) {
        console.error('[MeetingController saveRecordingLink]', err);
        res.status(500).json({ success: false, message: 'Failed to save recording link' });
    };
};

exports.exportAttendancePDF = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        if (!schoolId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const meetingId = parseInt(req.params.id, 10);
        const [[meeting]] = await db.query(
            `SELECT m.*, sch.school_name
            FROM meetings m
            JOIN schools sch ON m.school_id = sch.id
            WHERE m.id = ? AND m.school_id = ?`,
            [meetingId, schoolId]
        );

        if (!meeting) {
            req.flash('error', 'Meeting not found');
            return res.redirect('/schooladmin/meetings');
        };

        const [attendees] = await db.query(
            `SELECT ma.joined_at, ma.left_at, ma.confirmed,
                TIMESTAMPDIFF(MINUTE, ma.joined_at,
                COALESCE(ma.left_at, NOW())) AS duration_minutes,
                    u.first_name, u.last_name, u.role
            FROM meeting_attendance ma
            JOIN users u ON ma.user_id = u.id
            WHERE ma.meeting_id = ? AND ma.school_id = ?
            ORDER BY u.role ASC, u.first_name ASC`,
            [meetingId, schoolId]
        );

        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition',
            `attachment; filename="attendance-meeting-${meetingId}.pdf"`);
        doc.pipe(res);

        doc.fontSize(18).font('Helvetica-Bold')
            .text(meeting.school_name || 'School', 50, 45);
        doc.fontSize(10).font('Helvetica').fillColor('#666')
            .text('MEETING ATTENDANCE REPORT', 50, 70);
        doc.moveTo(50, 88).lineTo(545, 88).stroke('#e2e8f0');

        doc.fillColor('#000').fontSize(11).font('Helvetica-Bold')
            .text('Meeting Details', 50, 103);
        doc.fontSize(10).font('Helvetica')
            .text(`Title: ${meeting.title}`, 50, 122)
            .text(`Scheduled: ${new Date(meeting.scheduled_at).toLocaleString('en-IN')}`, 50, 139)
            .text(`Status: ${(meeting.status || '').toUpperCase()}`, 50, 156)
            .text(`Total Attendees: ${attendees.length}`, 300, 122);

        doc.moveTo(50, 178).lineTo(545, 178).stroke('#e2e8f0');

        const cols = { name: 50, role: 210, joined: 310, left: 390, duration: 465, confirmed: 515 };
        let y = 193;

        doc.fontSize(9).font('Helvetica-Bold').fillColor('#000')
            .text('Name', cols.name, y)
            .text('Role', cols.role, y)
            .text('Joined', cols.joined, y)
            .text('Left', cols.left, y)
            .text('Mins', cols.duration, y)
            .text('✓', cols.confirmed, y);

        y += 14;
        doc.moveTo(50, y).lineTo(545, y).stroke('#e2e8f0');
        y += 8;

        doc.font('Helvetica').fontSize(8);

        for (const a of attendees) {
            if (y > 730) { doc.addPage(); y = 50; }

            const joinedStr = a.joined_at
                ? new Date(a.joined_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                : '—';
            const leftStr = a.left_at
                ? new Date(a.left_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                : '—';

            doc.fillColor('#000')
                .text(`${a.first_name} ${a.last_name}`, cols.name, y, { width: 155 })
                .text((a.role || '').replace(/_/g, ' '), cols.role, y, { width: 95 })
                .text(joinedStr, cols.joined, y, { width: 75 })
                .text(leftStr, cols.left, y, { width: 70 })
                .text(a.duration_minutes != null ? String(a.duration_minutes) : '—', cols.duration, y, { width: 45 })
                .text(a.confirmed ? '✓' : '—', cols.confirmed, y, { width: 30 });

            y += 17;
        };

        if (attendees.length === 0) {
            doc.fillColor('#999').text('No attendance records found for this meeting.', 50, y);
        };

        doc.fontSize(8).fillColor('#999')
            .text('Generated by SchoolSync', 50, 780, { align: 'center', width: 495 });

        doc.end();
    } catch (err) {
        console.error('[MeetingController exportAttendancePDF]', err);
        req.flash('error', 'Failed to export attendance');
        res.redirect('/schooladmin/meetings');
    };
};

exports.confirmAttendance = async (req, res) => {
    try {
        const schoolId = req.meeting?.school_id || getSchoolId(req);
        const userId = req.user?.id;
        const userRole = req.user?.role || req.session?.user?.role;
        if (!schoolId || !userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        };

        const meetingId = parseInt(req.params.id, 10);
        const [[meeting]] = await db.query(
            `SELECT id, status FROM meetings WHERE id = ? AND school_id = ?`,
            [meetingId, schoolId]
        );

        if (!meeting) {
            return res.status(404).json({ success: false, message: 'Meeting not found' });
        };

        const normalizedStatus = normalizeMeetingStatus(meeting.status);
        if (normalizedStatus !== 'live') {
            return res.status(400).json({ success: false, message: 'Meeting is not currently live' });
        };

        await db.query(
            `INSERT INTO meeting_attendance
            (school_id, meeting_id, user_id, role, joined_at, last_seen_at, left_at, duration_minutes, confirmed, confirmed_at)
            VALUES (?, ?, ?, ?, NOW(), NOW(), NULL, 0, 1, NOW())
            ON DUPLICATE KEY UPDATE
                role = VALUES(role),
                last_seen_at = NOW(),
                left_at = NULL,
                duration_minutes = GREATEST(0, TIMESTAMPDIFF(MINUTE, joined_at, NOW())),
                confirmed = 1,
                confirmed_at = NOW()`,
            [schoolId, meetingId, userId, userRole || 'participant']
        );

        res.json({ success: true, message: 'Attendance confirmed' });
    } catch (err) {
        console.error('[MeetingController confirmAttendance]', err);
        res.status(500).json({ success: false, message: 'Failed to confirm attendance' });
    };
};

exports.getMeetingStats = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        if (!schoolId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        };

        const [statusCounts] = await db.query(
            `SELECT status, COUNT(*) AS count
            FROM meetings
            WHERE school_id = ?
                AND MONTH(scheduled_at) = MONTH(NOW())
                AND YEAR(scheduled_at) = YEAR(NOW())
            GROUP BY status`,
            [schoolId]
        );

        const stats = { scheduled: 0, live: 0, completed: 0, cancelled: 0 };
        statusCounts.forEach(r => {
            if (stats.hasOwnProperty(r.status)) {
                stats[r.status] = r.count;
            };
        });

        const [[liveNow]] = await db.query(
            `SELECT COUNT(*) AS count FROM meetings
            WHERE school_id = ? AND status = 'live'`,
            [schoolId]
        );

        res.json({
            success: true,
            stats: { ...stats, liveNow: liveNow.count }
        });
    } catch (err) {
        console.error('[MeetingController getMeetingStats]', err);
        res.status(500).json({ success: false, message: 'Failed to load meeting stats' });
    };
};
