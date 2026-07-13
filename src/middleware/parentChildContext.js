const { getLinkedChildren, toPositiveInt } = require('../services/parentStudentService');

const createParentChildContext = (loadChildren = getLinkedChildren) => async function parentChildContext(req, res, next) {
    try {
        const parentUserId = toPositiveInt(req.user?.id);
        const schoolId = toPositiveInt(req.user?.school_id);
        if (!parentUserId || !schoolId) return res.status(401).json({ success: false, message: 'Parent session is invalid.' });

        const children = await loadChildren({ parentUserId, schoolId });
        const explicitRaw = req.params?.studentId ?? req.body?.studentId ?? req.body?.student_id ?? req.query?.studentId ?? req.query?.student_id;
        const explicitId = explicitRaw === undefined ? null : toPositiveInt(explicitRaw);
        if (explicitRaw !== undefined && (!explicitId || !children.some((child) => Number(child.id) === explicitId))) {
            return res.status(403).json({ success: false, message: 'The selected student is not linked to this parent account.' });
        }

        const sessionId = toPositiveInt(req.session?.selectedStudentId);
        const activeChild = children.find((child) => Number(child.id) === (explicitId || sessionId)) || children[0] || null;
        if (activeChild && req.session) req.session.selectedStudentId = activeChild.id;
        req.parentChildren = children;
        req.activeChild = activeChild;
        next();
    } catch (error) {
        next(error);
    }
};

module.exports = createParentChildContext();
module.exports.createParentChildContext = createParentChildContext;
