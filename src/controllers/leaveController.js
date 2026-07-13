const db = require('../config/database');
const NotificationService = require('../services/notificationService');

const ALLOWED_LEAVE_TYPES = new Set(['sick', 'casual', 'emergency', 'other']);
const ALLOWED_LEAVE_ROLES = new Set(['teacher', 'student', 'driver', 'librarian']);

function toDateOnly(value) {
    if (!value) return '';
    if (value instanceof Date) {
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    };
    return String(value).slice(0, 10);
};

function formatDateStr(d) {
    const dateStr = toDateOnly(d);
    if (!dateStr) return '';
    const [y, m, day] = dateStr.split('-');
    return `${day}/${m}/${y}`;
};

function todayLocal() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

function calcDays(from, to) {
    const d1 = new Date(`${toDateOnly(from)}T00:00:00`);
    const d2 = new Date(`${toDateOnly(to)}T00:00:00`);
    if (isNaN(d1) || isNaN(d2)) return 0;
    const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
    return diff > 0 ? diff : 0;
};

const resolveUserSchoolId = async (user) => {
    if (user.school_id) return user.school_id;

    if (user.role === 'driver') {
        const [rows] = await db.query(
            "SELECT school_id FROM drivers WHERE user_id = ? ORDER BY id DESC LIMIT 1",
            [user.id]
        );
        return rows[0]?.school_id || null;
    };

    if (user.role === 'teacher') {
        const [rows] = await db.query(
            "SELECT school_id FROM teachers WHERE user_id = ? ORDER BY id DESC LIMIT 1",
            [user.id]
        );
        return rows[0]?.school_id || null;
    };

    if (user.role === 'student') {
        const [rows] = await db.query(
            "SELECT school_id FROM students WHERE user_id = ? ORDER BY id DESC LIMIT 1",
            [user.id]
        );
        return rows[0]?.school_id || null;
    };

    if (user.role === 'librarian') {
        const [rows] = await db.query(
            "SELECT school_id FROM librarians WHERE user_id = ? ORDER BY id DESC LIMIT 1",
            [user.id]
        );
        return rows[0]?.school_id || null;
    };

    return null;
};

exports.getLeaves = async (req, res) => {
    try {
        const schoolId = await resolveUserSchoolId(req.user);
        const userId = req.user.id;
        const role = req.user.role;

        const sql = `
            SELECT l.*,
                ab.first_name AS approver_first_name, ab.last_name AS approver_last_name
            FROM leaves l
            LEFT JOIN users ab ON l.approved_by = ab.id
            WHERE l.user_id = ? AND l.school_id = ?
            ORDER BY l.created_at DESC
        `;
        const [leaves] = await db.query(sql, [userId, schoolId]);

        leaves.forEach(l => {
            l.days = calcDays(l.from_date, l.to_date);
        });

        const [[stats]] = await db.query(
            `SELECT
            COUNT(*) AS total,
                SUM(status = 'pending') AS pending,
                SUM(status = 'approved') AS approved,
                SUM(status = 'rejected') AS rejected
            FROM leaves WHERE user_id = ? AND school_id = ?`,
            [userId, schoolId]
        );

        res.render(`${role}/leaves`, {
            title: 'My Leave Applications',
            leaves,
            stats: stats || { total: 0, pending: 0, approved: 0, rejected: 0 },
            layout: `${role}/layout`,
            user: req.user,
            currentPath: `/${role}/leaves`
        });
    } catch (err) {
        console.error('[Leave Controller getLeaves]', err);
        req.flash('error', 'Failed to load leave history');
        res.redirect(`/${req.user.role}/dashboard`);
    };
};

exports.applyLeave = async (req, res) => {
    try {
        const schoolId = await resolveUserSchoolId(req.user);
        const userId = req.user.id;
        const role = req.user.role;
        const { leave_type, from_date, to_date, reason } = req.body;
        const leaveType = ALLOWED_LEAVE_TYPES.has(leave_type) ? leave_type : 'casual';
        const fromDate = toDateOnly(from_date);
        const toDate = toDateOnly(to_date);
        const cleanReason = String(reason || '').trim();

        if (!ALLOWED_LEAVE_ROLES.has(role)) {
            req.flash('error', 'This role cannot apply for leave.');
            return res.redirect(`/${role}/dashboard`);
        };

        if (!fromDate || !toDate || !cleanReason) {
            req.flash('error', 'Please fill all required fields.');
            return res.redirect(`/${role}/leaves`);
        };

        const days = calcDays(fromDate, toDate);
        if (days <= 0) {
            req.flash('error', 'To date must be the same as or after from date.');
            return res.redirect(`/${role}/leaves`);
        };

        const limitDate = new Date();
        limitDate.setDate(limitDate.getDate() - 30);
        const limitDateStr = `${limitDate.getFullYear()}-${String(limitDate.getMonth() + 1).padStart(2, '0')}-${String(limitDate.getDate()).padStart(2, '0')}`;
        if (fromDate < limitDateStr) {
            req.flash('error', 'Leave cannot be applied for dates older than 30 days.');
            return res.redirect(`/${role}/leaves`);
        };

        const [[overlap]] = await db.query(
            `SELECT id FROM leaves
	        WHERE school_id = ? AND user_id = ? AND status IN ('pending', 'approved')
	            AND from_date <= ? AND to_date >= ?
	        LIMIT 1`,
            [schoolId, userId, toDate, fromDate]
        );
        if (overlap) {
            req.flash('error', 'A pending or approved leave already exists for the selected dates.');
            return res.redirect(`/${role}/leaves`);
        };

        const sql = `
	      INSERT INTO leaves (school_id, user_id, user_role, leave_type, from_date, to_date, reason, status)
	      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
	    `;
        await db.query(sql, [schoolId, userId, role, leaveType, fromDate, toDate, cleanReason]);

        try {
            const [[userNameRow]] = await db.query("SELECT first_name AS first_name, last_name AS last_name FROM users WHERE id = ?", [userId]);
            const fullName = `${userNameRow?.first_name || ''} ${userNameRow?.last_name || ''}`.trim();

            await NotificationService.notifyAdmins(schoolId, {
                title: 'New Leave Application',
                message: `${fullName} (${role}) has applied for ${days} day(s) leave from ${formatDateStr(fromDate)} to ${formatDateStr(toDate)}`,
                type: 'info',
                category: 'general',
                action_url: '/schooladmin/leaves'
            });
        } catch (notifErr) {
            console.error('Failed to notify admins about leave:', notifErr.message);
        };

        req.flash('success', 'Leave application submitted successfully.');
        res.redirect(`/${role}/leaves`);
    } catch (err) {
        console.error('Leave Controller applyLeave', err);
        req.flash('error', 'Failed to submit leave application.');
        res.redirect(`/${req.user.role}/leaves`);
    };
};