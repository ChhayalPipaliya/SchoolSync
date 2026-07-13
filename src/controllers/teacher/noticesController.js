const db = require('../../config/database');
const teacherPermissions = require('../../services/teacherPermissionService');

exports.getNotices = async (req, res) => {
    try {
        const teacher = await teacherPermissions.getLoggedInTeacher(req);
        const teachingAssignments = await teacherPermissions.getTeachingAssignmentsForTeacher(teacher.id, teacher.school_id);
        const classMap = new Map();
        teachingAssignments.forEach((assignment) => {
            if (!classMap.has(assignment.class_id)) {
                classMap.set(assignment.class_id, {
                    id: assignment.class_id,
                    name: assignment.name,
                    class_name: assignment.class_name,
                    section: assignment.section_name || assignment.section
                });
            };
        });
        const classes = Array.from(classMap.values());

        const [notices] = await db.execute(
            `SELECT n.*, n.content AS message, n.created_by AS sender_id, 'teacher' AS sender_role, u.first_name AS first_name, u.last_name AS last_name
            FROM notices n
            JOIN users u ON n.created_by = u.id
            WHERE n.created_by = ?
            ORDER BY n.created_at DESC`,
            [req.user.id]
        );

        res.render('teacher/notices', {
            title: 'Notices',
            user: req.user,
            classes,
            notices,
            layout: 'teacher/layout'
        });
    } catch (error) {
        console.error('Notices Error:', error);
        req.flash('error', 'Failed to load notices');
        res.redirect('/teacher/dashboard');
    };
};

exports.createNotice = async (req, res) => {
    try {
        const { class_id, target_type, target_ids, title, message } = req.body;
        const teacher = await teacherPermissions.getLoggedInTeacher(req);

        let attachment = null;
        if (req.file) {
            attachment = req.file.filename;
        };

        if (target_type === 'class_students') {
            const teachingAssignments = await teacherPermissions.getTeachingAssignmentsForTeacher(teacher.id, teacher.school_id);
            if (!teachingAssignments.some((assignment) => String(assignment.class_id) === String(class_id))) {
                req.flash('error', 'You are not assigned to teach this class.');
                return res.redirect('/teacher/notices');
            };
        };

        const dbTargetType = target_type === 'class_students' ? 'specific_class' : 'students';
        await db.execute(
            `INSERT INTO notices (school_id, title, content, target_type, target_class_id, created_by, attachment, status, priority, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'published', 'normal', NOW())`,
            [req.user.school_id, title, message, dbTargetType, class_id || null, req.user.id, attachment]
        );

        req.flash('success', 'Notice published successfully');
        res.redirect('/teacher/notices');
    } catch (error) {
        console.error('Create Notice Error:', error);
        req.flash('error', 'Failed to publish notice');
        res.redirect('/teacher/notices');
    };
};

exports.deleteNotice = async (req, res) => {
    try {
        await db.execute(
            `DELETE FROM notices WHERE id = ? AND created_by = ?`,
            [req.params.id, req.user.id]
        );
        req.flash('success', 'Notice deleted');
        res.redirect('/teacher/notices');
    } catch (error) {
        console.error('Delete Notice Error:', error);
        req.flash('error', 'Failed to delete notice');
        res.redirect('/teacher/notices');
    };
};