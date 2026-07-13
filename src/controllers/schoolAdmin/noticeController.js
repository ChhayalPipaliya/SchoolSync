const db = require('../../config/database');

const notifyNoticeRecipients = async ({ schoolId, target, targetId, details, createdBy }) => {
    const NotificationService = require('../../services/notificationService');
    const sendToUsers = async (rows, role) => {
        await Promise.all((rows || []).map(row => NotificationService.createAndSend({
            recipient_id: row.user_id || row.id,
            recipient_role: role || row.role,
            school_id: schoolId,
            created_by: createdBy,
            ...details
        }).catch(err => console.error(`${role || row.role} notice notification failed:`, err.message))));
    };

    if (target === 'all' || target === 'students') {
        if (targetId && !Number.isNaN(parseInt(targetId, 10))) {
            const [students] = await db.query(
                "SELECT user_id FROM students WHERE class_id = ? AND school_id = ? AND deleted_at IS NULL",
                [targetId, schoolId]
            );
            await sendToUsers(students, 'student');
        } else {
            const [students] = await db.query("SELECT user_id FROM students WHERE school_id = ? AND deleted_at IS NULL", [schoolId]);
            await sendToUsers(students, 'student');
        };
    };

    if (target === 'all' || target === 'teachers') {
        const [teachers] = await db.query("SELECT user_id FROM teachers WHERE school_id = ?", [schoolId]);
        await sendToUsers(teachers, 'teacher');
    };

    if (target === 'all' || target === 'drivers') {
        const [drivers] = await db.query("SELECT user_id FROM drivers WHERE school_id = ? AND deleted_at IS NULL", [schoolId]);
        await sendToUsers(drivers, 'driver');
    };

    if (target === 'all' || target === 'librarians') {
        const [librarians] = await db.query("SELECT user_id FROM librarians WHERE school_id = ? AND status = 'active'", [schoolId]);
        await sendToUsers(librarians, 'librarian');
    };

    if (target === 'parents') {
        const [parents] = await db.query("SELECT id, role FROM users WHERE school_id = ? AND role = 'parent' AND status = 'active'", [schoolId]);
        await sendToUsers(parents);
    };
};

exports.listNotices = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const [notices] = await db.query(
            `SELECT n.*, CONCAT(u.first_name, ' ', COALESCE(u.last_name, '')) as created_by_name,
                c.class_name as target_class_name, c.section as target_class_section
            FROM notices n
            LEFT JOIN users u ON n.created_by = u.id
            LEFT JOIN classes c ON n.target_type = 'specific_class' AND n.target_class_id = c.id
            WHERE n.school_id = ?
            ORDER BY n.created_at DESC`,
            [schoolId]
        );

        res.render('schoolAdmin/notices/list', { title: 'Notices', notices });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load notices');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.getAddNotice = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const [classes] = await db.query('SELECT * FROM classes WHERE school_id = ?', [schoolId]);

        res.render('schoolAdmin/notices/form', { title: 'Add Notice', classes, notice: null });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Something went wrong');
        res.redirect('/schooladmin/notices');
    };
};

exports.postAddNotice = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { title, content, target_type, target_id, target_class_id, priority, publish_date, expiry_date } = req.body;
        const attachment = req.file?.filename || null;
        const finalTargetClassId = target_class_id || target_id || null;

        const [result] = await db.query(
            `INSERT INTO notices (school_id, title, content, target_type, target_class_id, priority, attachment, publish_date, expiry_date, created_by, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published')`,
            [schoolId, title, content, target_type || 'all', finalTargetClassId, priority || 'normal', attachment, publish_date || new Date(), expiry_date || null, req.session.user.id]
        );

        const templates = require('../../utils/notificationTemplates');
        const target = target_type || 'all';
        notifyNoticeRecipients({
            schoolId,
            target,
            targetId: target_id,
            details: templates.noticePublished(title, priority),
            createdBy: req.session.user.id
        }).catch(err => console.error("Notice notification broadcast failed:", err.message));

        req.flash('success', 'Notice published successfully');
        res.redirect('/schooladmin/notices');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to publish notice');
        res.redirect('/schooladmin/notices/add');
    };
};

exports.getEditNotice = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { id } = req.params;
        const [[notice]] = await db.query(
            'SELECT * FROM notices WHERE id = ? AND school_id = ?',
            [id, schoolId]
        );

        if (!notice) {
            req.flash('error', 'Notice not found');
            return res.redirect('/schooladmin/notices');
        };

        const [classes] = await db.query('SELECT * FROM classes WHERE school_id = ?', [schoolId]);
        res.render('schoolAdmin/notices/form', { title: 'Edit Notice', notice, classes });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load notice');
        res.redirect('/schooladmin/notices');
    };
};

exports.postEditNotice = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { id } = req.params;
        const { title, content, target_type, target_id, target_class_id, priority, status, expiry_date } = req.body;
        const attachment = req.file?.filename || null;
        const finalTargetClassId = target_class_id || target_id || null;
        let sql = 'UPDATE notices SET title = ?, content = ?, target_type = ?, target_class_id = ?, priority = ?, status = ?, expiry_date = ?';
        const params = [title, content, target_type, finalTargetClassId, priority, status, expiry_date || null];

        if (attachment) {
            sql += ', attachment = ?';
            params.push(attachment);
        };

        sql += ' WHERE id = ? AND school_id = ?';
        params.push(id, schoolId);
        await db.query(sql, params);

        req.flash('success', 'Notice updated successfully');
        res.redirect('/schooladmin/notices');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to update notice');
        res.redirect(`/schooladmin/notices/${id}/edit`);
    };
};

exports.deleteNotice = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { id } = req.params;
        await db.query('DELETE FROM notices WHERE id = ? AND school_id = ?', [id, schoolId]);

        req.flash('success', 'Notice deleted successfully');
        res.redirect('/schooladmin/notices');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to delete notice');
        res.redirect('/schooladmin/notices');
    };
};