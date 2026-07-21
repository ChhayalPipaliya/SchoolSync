const db = require('../../config/database');

function formatTimeToAMPM(timeStr) {
    if (!timeStr) return '';
    const [hoursStr, minutesStr] = timeStr.split(':');
    let hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const minutesFormatted = minutes < 10 ? '0' + minutes : minutes;
    return `${hours}:${minutesFormatted} ${ampm}`;
}

exports.getPTMPage = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const children = req.parentChildren || [];
        const activeChild = req.activeChild;

        if (!activeChild) {
            req.flash('error', 'No linked child found.');
            return res.redirect('/parent/dashboard');
        }

        const [bookings] = await db.query(
            `SELECT b.*, s.date, s.start_time, s.end_time,
                CONCAT(tu.first_name, ' ', tu.last_name) AS teacher_name,
                t.subject AS subject_name,
                CONCAT(st.first_name, ' ', st.last_name) AS student_name
            FROM ptm_bookings b
            JOIN ptm_slots s ON b.slot_id = s.id
            JOIN teachers t ON s.teacher_id = t.id
            JOIN users tu ON t.user_id = tu.id
            JOIN students st ON b.student_id = st.id
            WHERE b.parent_user_id = ? AND b.school_id = ? AND b.status = 'active'
            ORDER BY s.date DESC, s.start_time DESC`,
            [req.user.id, schoolId]
        );

        const formattedBookings = bookings.map(b => ({
            ...b,
            formatted_start_time: formatTimeToAMPM(b.start_time),
            formatted_end_time: formatTimeToAMPM(b.end_time),
            formatted_date: new Date(b.date).toLocaleDateString('en-IN', {
                weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
            })
        }));

        res.render('parent/ptm/index', {
            title: 'PTM Bookings',
            bookings: formattedBookings,
            children,
            activeChild,
            user: req.user,
            currentPath: '/parent/ptm'
        });
    } catch (err) {
        console.error('[Parent PTM Controller getPTMPage Error]:', err);
        req.flash('error', 'Failed to load PTM portal.');
        res.redirect('/parent/dashboard');
    }
};

exports.getTeachers = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const { studentId } = req.query;

        if (!studentId) {
            return res.status(400).json({ success: false, message: 'studentId is required' });
        }

        const [[student]] = await db.query(
            'SELECT class_id FROM students WHERE id = ? AND school_id = ? LIMIT 1',
            [studentId, schoolId]
        );

        if (!student) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        let [teachers] = await db.query(
            `SELECT DISTINCT t.id AS teacher_id, CONCAT(u.first_name, ' ', u.last_name) AS name,
                sub.subject_name
            FROM teacher_class_assign tca
            JOIN teachers t ON tca.teacher_id = t.id
            JOIN users u ON t.user_id = u.id
            LEFT JOIN subjects sub ON tca.subject_id = sub.id AND sub.school_id = tca.school_id
            WHERE tca.class_id = ? AND tca.school_id = ? AND tca.status = 'active'`,
            [student.class_id, schoolId]
        );

        if (teachers.length === 0) {
            [teachers] = await db.query(
                `SELECT t.id AS teacher_id, CONCAT(u.first_name, ' ', u.last_name) AS name,
                    t.subject AS subject_name
                FROM teachers t
                JOIN users u ON t.user_id = u.id
                WHERE t.school_id = ? AND u.status = 'active'`,
                [schoolId]
            );
        }

        return res.json({ success: true, teachers });
    } catch (err) {
        console.error('[Parent PTM Controller getTeachers Error]:', err);
        return res.status(500).json({ success: false, message: 'Failed to fetch teachers' });
    }
};

exports.getAvailableSlots = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const { teacherId } = req.query;

        if (!teacherId) {
            return res.status(400).json({ success: false, message: 'teacherId is required' });
        }

        const [slots] = await db.query(
            `SELECT id, date, start_time, end_time 
             FROM ptm_slots 
             WHERE teacher_id = ? AND school_id = ? AND status = 'available' AND date >= CURDATE()
             ORDER BY date ASC, start_time ASC`,
            [teacherId, schoolId]
        );

        const groupedSlots = {};
        slots.forEach(slot => {
            const dateStr = new Date(slot.date).toLocaleDateString('en-IN', {
                weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
            });
            if (!groupedSlots[dateStr]) {
                groupedSlots[dateStr] = [];
            }
            groupedSlots[dateStr].push({
                id: slot.id,
                time: `${formatTimeToAMPM(slot.start_time)} - ${formatTimeToAMPM(slot.end_time)}`
            });
        });

        return res.json({ success: true, slots: groupedSlots });
    } catch (err) {
        console.error('[Parent PTM Controller getAvailableSlots Error]:', err);
        return res.status(500).json({ success: false, message: 'Failed to fetch available slots' });
    }
};

exports.bookSlot = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const { studentId, slotId, notes } = req.body;

        if (!studentId || !slotId) {
            req.flash('error', 'Student and Time Slot are required.');
            return res.redirect('/parent/ptm');
        }

        const [[student]] = await db.query(
            'SELECT CONCAT(first_name, " ", last_name) AS name FROM students WHERE id = ? AND school_id = ? LIMIT 1',
            [studentId, schoolId]
        );
        if (!student) {
            req.flash('error', 'Student profile not found.');
            return res.redirect('/parent/ptm');
        }

        const [[slot]] = await db.query(
            'SELECT * FROM ptm_slots WHERE id = ? AND school_id = ? AND status = "available" FOR UPDATE',
            [slotId, schoolId]
        );

        if (!slot) {
            req.flash('error', 'The selected time slot is no longer available. Please choose another slot.');
            return res.redirect('/parent/ptm');
        }

        const [[conflict]] = await db.query(
            `SELECT b.id FROM ptm_bookings b
            JOIN ptm_slots s ON b.slot_id = s.id
            WHERE b.parent_user_id = ? AND b.status = 'active' AND s.date = ? AND b.school_id = ? LIMIT 1`,
            [req.user.id, slot.date, schoolId]
        );

        if (conflict) {
            req.flash('error', 'You already have another PTM scheduled on this date.');
            return res.redirect('/parent/ptm');
        }

        await db.query('UPDATE ptm_slots SET status = "booked" WHERE id = ?', [slotId]);
        await db.query(
            `INSERT INTO ptm_bookings (school_id, slot_id, parent_user_id, student_id, notes, status)
            VALUES (?, ?, ?, ?, ?, 'active')`,
            [schoolId, slotId, req.user.id, studentId, notes || null]
        );

        const [[teacher]] = await db.query(
            'SELECT user_id FROM teachers WHERE id = ? LIMIT 1',
            [slot.teacher_id]
        );

        if (teacher) {
            try {
                const NotificationService = require('../../services/notificationService');
                await NotificationService.createAndSend({
                    recipient_id: teacher.user_id,
                    recipient_role: 'teacher',
                    school_id: schoolId,
                    title: 'New PTM Booking',
                    message: `A new PTM meeting slot has been booked by ${req.user.first_name} ${req.user.last_name} for student ${student.name} on ${new Date(slot.date).toLocaleDateString()} at ${formatTimeToAMPM(slot.start_time)}.`,
                    type: 'info',
                    category: 'general'
                });
            } catch (notifyErr) {
                console.error('[PTM Booking Notification Failed]:', notifyErr.message);
            }
        }

        req.flash('success', 'PTM booking completed successfully!');
        res.redirect('/parent/ptm');
    } catch (err) {
        console.error('[Parent PTM Controller bookSlot Error]:', err);
        req.flash('error', 'Failed to book slot.');
        res.redirect('/parent/ptm');
    }
};

exports.cancelBooking = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const { id } = req.params;

        const [[booking]] = await db.query(
            `SELECT b.*, s.date, s.start_time, s.end_time, s.teacher_id,
                CONCAT(st.first_name, " ", st.last_name) AS student_name
             FROM ptm_bookings b
             JOIN ptm_slots s ON b.slot_id = s.id
             JOIN students st ON b.student_id = st.id
             WHERE b.id = ? AND b.parent_user_id = ? AND b.school_id = ? LIMIT 1`,
            [id, req.user.id, schoolId]
        );

        if (!booking) {
            req.flash('error', 'Booking not found.');
            return res.redirect('/parent/ptm');
        }

        await db.query('UPDATE ptm_bookings SET status = "cancelled" WHERE id = ?', [booking.id]);
        await db.query('UPDATE ptm_slots SET status = "available" WHERE id = ?', [booking.slot_id]);

        const [[teacher]] = await db.query(
            'SELECT user_id FROM teachers WHERE id = ? LIMIT 1',
            [booking.teacher_id]
        );

        if (teacher) {
            try {
                const NotificationService = require('../../services/notificationService');
                await NotificationService.createAndSend({
                    recipient_id: teacher.user_id,
                    recipient_role: 'teacher',
                    school_id: schoolId,
                    title: 'PTM Booking Cancelled',
                    message: `The PTM slot booked by ${req.user.first_name} ${req.user.last_name} for student ${booking.student_name} on ${new Date(booking.date).toLocaleDateString()} at ${formatTimeToAMPM(booking.start_time)} has been cancelled by the parent.`,
                    type: 'warning',
                    category: 'general'
                });
            } catch (notifyErr) {
                console.error('[PTM Booking Cancel Notification Failed]:', notifyErr.message);
            }
        }

        req.flash('success', 'PTM booking cancelled successfully.');
        res.redirect('/parent/ptm');
    } catch (err) {
        console.error('[Parent PTM Controller cancelBooking Error]:', err);
        req.flash('error', 'Failed to cancel booking.');
        res.redirect('/parent/ptm');
    }
};