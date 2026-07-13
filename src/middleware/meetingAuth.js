const db = require('../config/database');

async function getMeetingById(id, schoolId) {
    const rows = await db.queryAsync(
        'SELECT * FROM meetings WHERE id = ? AND school_id = ?',
        [id, schoolId]
    );
    return rows[0] || null;
};

const TARGET_ALIASES = {
    teacher: 'teachers',
    student: 'students',
    parent: 'parents',
    driver: 'drivers',
    librarian: 'librarians',
    class: 'specific_class',
    classes: 'multiple_classes',
    ongoing: 'live',
    upcoming: 'scheduled',
    ended: 'completed'
};

const normalizeTargetType = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return TARGET_ALIASES[normalized] || normalized;
};

const normalizeStatus = (status) => {
    const normalized = String(status || '').trim().toLowerCase();
    return TARGET_ALIASES[normalized] || normalized;
};

const isCompletedStatus = (status) => normalizeStatus(status) === 'completed';
async function checkAudienceEligibility(meeting, user) {
    const { role, id: userId } = user;
    const { target_class_id, id: meetingId, school_id } = meeting;
    const target_type = normalizeTargetType(meeting.target_type);

    if (meeting.created_by === userId) {
        return true;
    };

    if (role === 'school_admin') {
        return true;
    };

    if (role === 'group_admin') {
        const { canAccessSchool } = require('../utils/schoolAccess');
        return await canAccessSchool(user, school_id);
    };

    switch (target_type) {
        case 'school_admin':
            return role === 'school_admin';
        case 'all':
            return true;
        case 'teachers':
            return role === 'teacher';
        case 'students':
            return role === 'student';
        case 'parents':
            return role === 'parent';
        case 'staff':
            return ['teacher', 'driver', 'librarian'].includes(role);
        case 'drivers':
            return role === 'driver';
        case 'librarians':
            return role === 'librarian';

        case 'specific_class':
            if (role === 'student') {
                const rows = await db.queryAsync(
                    'SELECT id FROM students WHERE user_id = ? AND class_id = ? AND school_id = ? AND deleted_at IS NULL',
                    [userId, target_class_id, school_id]
                );
                return rows.length > 0;
            };
            if (role === 'parent') {
                const rows = await db.queryAsync(
                    `SELECT s.id FROM students s 
                    JOIN student_family sf ON s.id = sf.student_id AND sf.school_id = s.school_id
                    WHERE sf.parent_user_id = ?
                        AND s.class_id = ? AND s.school_id = ? AND s.deleted_at IS NULL`,
                    [userId, target_class_id, school_id]
                );
                return rows.length > 0;
            };
            if (role === 'teacher') {
                const rows = await db.queryAsync(
                    `SELECT tca.id FROM teacher_class_assign tca 
                    JOIN teachers t ON tca.teacher_id = t.id 
                    WHERE t.user_id = ? AND tca.class_id = ? AND tca.school_id = ?`,
                    [userId, target_class_id, school_id]
                );
                return rows.length > 0;
            };
            return false;
        case 'multiple_classes':
            if (role === 'student') {
                const rows = await db.queryAsync(
                    `SELECT s.id FROM students s 
                    JOIN meeting_classes mc ON s.class_id = mc.class_id 
                    WHERE s.user_id = ? AND mc.meeting_id = ? AND s.school_id = ? AND s.deleted_at IS NULL`,
                    [userId, meetingId, school_id]
                );
                return rows.length > 0;
            };
            if (role === 'parent') {
                const rows = await db.queryAsync(
                    `SELECT s.id FROM students s 
                    JOIN student_family sf ON s.id = sf.student_id AND sf.school_id = s.school_id
                    JOIN meeting_classes mc ON s.class_id = mc.class_id 
                    WHERE sf.parent_user_id = ?
                        AND mc.meeting_id = ? AND s.school_id = ? AND s.deleted_at IS NULL`,
                    [userId, meetingId, school_id]
                );
                return rows.length > 0;
            };
            if (role === 'teacher') {
                const rows = await db.queryAsync(
                    `SELECT tca.id FROM teacher_class_assign tca 
                    JOIN teachers t ON tca.teacher_id = t.id 
                    JOIN meeting_classes mc ON tca.class_id = mc.class_id 
                    WHERE t.user_id = ? AND mc.meeting_id = ? AND tca.school_id = ?`,
                    [userId, meetingId, school_id]
                );
                return rows.length > 0;
            };
            return false;
        default:
            return false;
    };
};

const rejectRequest = (req, res, message, redirectUrl = 'back') => {
    const isApiRequest = req.path.startsWith('/api') || (req.accepts('json') && !req.accepts('html'));
    if (isApiRequest) {
        return res.status(403).json({ success: false, message });
    };
    req.flash('error', message);
    const targetUrl = redirectUrl === 'back' ? (req.get('Referrer') || '/') : redirectUrl;
    return res.redirect(targetUrl);
};

const authorizeMeeting = async (req, res, next) => {
    try {
        const meetingId = req.params.id;
        const schoolId = req.user?.school_id || req.session?.user?.school_id;

        if (!meetingId) {
            return rejectRequest(req, res, 'Meeting ID is required.');
        };

        const meeting = await getMeetingById(meetingId, schoolId);
        if (!meeting) {
            return rejectRequest(req, res, 'Meeting not found.');
        };

        const status = normalizeStatus(meeting.status);
        if (status === 'cancelled') {
            return rejectRequest(req, res, `This meeting has been cancelled. Reason: ${meeting.cancel_reason || 'N/A'}`);
        };
        if (isCompletedStatus(status)) {
            return rejectRequest(req, res, 'This meeting has already completed.');
        };

        const scheduledTime = new Date(meeting.scheduled_at).getTime();
        const durationMs = meeting.duration_minutes * 60 * 1000;
        const now = Date.now();
        const joinStart = scheduledTime - 15 * 60 * 1000;
        const joinEnd = scheduledTime + durationMs + 15 * 60 * 1000;

        if (now < joinStart) {
            const formattedTime = new Date(meeting.scheduled_at).toLocaleString('en-IN');
            return rejectRequest(req, res, `Meeting starts at ${formattedTime}. You can join starting 15 minutes before the start time.`);
        };
        if (now > joinEnd) {
            return rejectRequest(req, res, 'The join window for this meeting has expired.');
        };

        const isEligible = await checkAudienceEligibility(meeting, req.user);
        if (!isEligible) {
            return rejectRequest(req, res, 'You are not authorized to join this meeting.');
        };

        req.meeting = meeting;
        return next();
    } catch (err) {
        console.error('authorizeMeeting Error:', err);
        return rejectRequest(req, res, 'Internal server error while authorizing meeting.');
    };
};

const authorizeMeetingView = async (req, res, next) => {
    try {
        const meetingId = req.params.id;
        const schoolId = req.user?.school_id || req.session?.user?.school_id;

        if (!meetingId) {
            return rejectRequest(req, res, 'Meeting ID is required.');
        };

        const meeting = await getMeetingById(meetingId, schoolId);
        if (!meeting) {
            return rejectRequest(req, res, 'Meeting not found.');
        };

        const isEligible = await checkAudienceEligibility(meeting, req.user);
        if (!isEligible) {
            return rejectRequest(req, res, 'You are not authorized to view this meeting.');
        };

        req.meeting = meeting;
        return next();
    } catch (err) {
        console.error('authorizeMeetingView Error:', err);
        return rejectRequest(req, res, 'Internal server error while authorizing meeting view.');
    };
};

const authorizeMeetingTracking = async (req, res, next) => {
    try {
        const meetingId = req.params.id;
        const schoolId = req.user?.school_id || req.session?.user?.school_id;

        if (!meetingId) {
            return rejectRequest(req, res, 'Meeting ID is required.');
        };

        const meeting = await getMeetingById(meetingId, schoolId);
        if (!meeting) {
            return rejectRequest(req, res, 'Meeting not found.');
        };

        const isEligible = await checkAudienceEligibility(meeting, req.user);
        if (!isEligible) {
            return rejectRequest(req, res, 'You are not authorized to update this meeting attendance.');
        };

        req.meeting = meeting;
        return next();
    } catch (err) {
        console.error('authorizeMeetingTracking Error:', err);
        return rejectRequest(req, res, 'Internal server error while authorizing meeting attendance.');
    };
};

module.exports = { authorizeMeeting, authorizeMeetingView, authorizeMeetingTracking};
