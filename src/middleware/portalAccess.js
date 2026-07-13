const db = require('../config/database');
const { getLinkedChildren } = require('../services/parentStudentService');

const DISABLED_MESSAGE = 'Your portal access is currently disabled. Please contact school admin.';

function rejectPortalAccess(req, res, status = 403) {
    if (req.accepts('json') && !req.accepts('html')) {
        return res.status(status).json({ success: false, message: DISABLED_MESSAGE });
    };
    req.flash('error', DISABLED_MESSAGE);
    return res.redirect('/login');
};

function getSessionUser(req) {
    return req.user || req.session?.user || {};
};

exports.requireStudentPortal = async (req, res, next) => {
    try {
        const user = getSessionUser(req);
        if (!user.id || !user.school_id) {
            return rejectPortalAccess(req, res, 401);
        };

        const [students] = await db.query(`
            SELECT id, student_portal_enabled
            FROM students
            WHERE user_id = ?
                AND school_id = ?
                AND deleted_at IS NULL
                AND status = 'active'
            LIMIT 1
        `, [user.id, user.school_id]);

        if (!students.length || Number(students[0].student_portal_enabled) !== 1) {
            return rejectPortalAccess(req, res);
        };

        req.portalStudentId = students[0].id;
        return next();
    } catch (error) {
        console.error('Student Portal Access Error:', error);
        req.flash('error', 'Unable to verify portal access. Please try again.');
        return res.redirect('/login');
    };
};

exports.requireParentPortal = async (req, res, next) => {
    try {
        const user = getSessionUser(req);
        if (!user.id || !user.school_id) {
            return rejectPortalAccess(req, res, 401);
        };

        const children = await getLinkedChildren({ parentUserId: user.id, schoolId: user.school_id });

        if (!children.length) {
            return rejectPortalAccess(req, res);
        };

        return next();
    } catch (error) {
        console.error('Parent Portal Access Error:', error);
        req.flash('error', 'Unable to verify portal access. Please try again.');
        return res.redirect('/login');
    };
};

exports.DISABLED_MESSAGE = DISABLED_MESSAGE;
