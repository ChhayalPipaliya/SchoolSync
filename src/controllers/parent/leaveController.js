const db = require('../../config/database');
const NotificationService = require('../../services/notificationService');

const ALLOWED_LEAVE_TYPES = new Set(['sick', 'casual', 'emergency', 'other']);

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

function calcDays(from, to) {
    const d1 = new Date(`${toDateOnly(from)}T00:00:00`);
    const d2 = new Date(`${toDateOnly(to)}T00:00:00`);
    if (isNaN(d1) || isNaN(d2)) return 0;
    const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
    return diff > 0 ? diff : 0;
};

exports.getLeaves = async (req, res) => {
    try {
        const schoolId = req.user?.school_id;
        const children = req.parentChildren || [];
        const activeChild = req.activeChild;

        if (!activeChild) {
            return res.redirect('/parent/dashboard');
        };

        const sql = `
            SELECT l.*,
                ab.first_name AS approver_first_name, ab.last_name AS approver_last_name
            FROM leaves l
            LEFT JOIN users ab ON l.approved_by = ab.id
            WHERE l.user_id = ? AND l.school_id = ?
            ORDER BY l.created_at DESC
        `;
        const [leaves] = await db.query(sql, [activeChild.user_id, schoolId]);

        leaves.forEach(l => {
            l.days = calcDays(l.from_date, l.to_date);
        });

        res.render('parent/leaves', {
            title: 'Student Leave Applications',
            leaves,
            children,
            activeChild,
            user: req.user,
            currentPath: '/parent/leaves'
        });
    } catch (err) {
        console.error('[Parent Leave Controller getLeaves]', err);
        req.flash('error', 'Failed to load leave history.');
        res.redirect('/parent/dashboard');
    };
};

exports.applyLeave = async (req, res) => {
    try {
        const schoolId = req.user?.school_id;
        const activeChild = req.activeChild;

        if (!activeChild || !activeChild.user_id) {
            req.flash('error', 'No active student selected.');
            return res.redirect('/parent/dashboard');
        };

        const { leave_type, from_date, to_date, reason } = req.body;
        const leaveType = ALLOWED_LEAVE_TYPES.has(leave_type) ? leave_type : 'casual';
        const fromDate = toDateOnly(from_date);
        const toDate = toDateOnly(to_date);
        const cleanReason = String(reason || '').trim();

        if (!fromDate || !toDate || !cleanReason) {
            req.flash('error', 'Please fill all required fields.');
            return res.redirect('/parent/leaves');
        };

        const days = calcDays(fromDate, toDate);
        if (days <= 0) {
            req.flash('error', 'To date must be the same as or after from date.');
            return res.redirect('/parent/leaves');
        };

        const limitDate = new Date();
        limitDate.setDate(limitDate.getDate() - 30);
        const limitDateStr = `${limitDate.getFullYear()}-${String(limitDate.getMonth() + 1).padStart(2, '0')}-${String(limitDate.getDate()).padStart(2, '0')}`;
        if (fromDate < limitDateStr) {
            req.flash('error', 'Leave cannot be applied for dates older than 30 days.');
            return res.redirect('/parent/leaves');
        };

        const [[overlap]] = await db.query(
            `SELECT id FROM leaves
            WHERE school_id = ? AND user_id = ? AND status IN ('pending', 'approved')
                AND from_date <= ? AND to_date >= ?
            LIMIT 1`,
            [schoolId, activeChild.user_id, toDate, fromDate]
        );
        if (overlap) {
            req.flash('error', 'A pending or approved leave already exists for the selected dates.');
            return res.redirect('/parent/leaves');
        };

        const sql = `
            INSERT INTO leaves (school_id, user_id, user_role, leave_type, from_date, to_date, reason, status)
            VALUES (?, ?, 'student', ?, ?, ?, ?, 'pending')
        `;
        await db.query(sql, [schoolId, activeChild.user_id, leaveType, fromDate, toDate, cleanReason]);

        try {
            const childName = `${activeChild.first_name || ''} ${activeChild.last_name || ''}`.trim() || 'Student';
            const parentName = `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || 'Parent';

            await NotificationService.notifyAdmins(schoolId, {
                title: 'New Student Leave Application',
                message: `Leave application for student ${childName} submitted by parent ${parentName} for ${days} day(s) (${formatDateStr(fromDate)} to ${formatDateStr(toDate)}).`,
                type: 'info',
                category: 'general',
                action_url: '/schooladmin/leaves'
            });
        } catch (notifErr) {
            console.error('Failed to notify admins about parent-submitted leave:', notifErr.message);
        };

        req.flash('success', 'Leave application submitted successfully for your child.');
        res.redirect('/parent/leaves');
    } catch (err) {
        console.error('[Parent Leave Controller applyLeave]', err);
        req.flash('error', 'Failed to submit leave application.');
        res.redirect('/parent/leaves');
    };
};