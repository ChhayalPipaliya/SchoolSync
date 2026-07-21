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
        const [[teacher]] = await db.query(
            'SELECT id FROM teachers WHERE user_id = ? AND school_id = ? LIMIT 1',
            [req.user.id, schoolId]
        );

        if (!teacher) {
            req.flash('error', 'Teacher profile not found.');
            return res.redirect('/teacher/dashboard');
        }

        const [slots] = await db.query(
            `SELECT s.*, b.id AS booking_id, b.notes, b.student_id, b.parent_user_id,
                CONCAT(pu.first_name, ' ', pu.last_name) AS parent_name, pu.phone AS parent_phone,
                CONCAT(st.first_name, ' ', st.last_name) AS student_name,
                c.class_name, c.section
            FROM ptm_slots s
            LEFT JOIN ptm_bookings b ON s.id = b.slot_id AND b.status = 'active'
            LEFT JOIN users pu ON b.parent_user_id = pu.id
            LEFT JOIN students st ON b.student_id = st.id
            LEFT JOIN classes c ON st.class_id = c.id
            WHERE s.teacher_id = ? AND s.school_id = ? AND s.date >= CURDATE()
            ORDER BY s.date ASC, s.start_time ASC`,
            [teacher.id, schoolId]
        );

        const formattedSlots = slots.map(slot => ({
            ...slot,
            formatted_start_time: formatTimeToAMPM(slot.start_time),
            formatted_end_time: formatTimeToAMPM(slot.end_time),
            formatted_date: new Date(slot.date).toLocaleDateString('en-IN', {
                weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
            })
        }));

        res.render('teacher/ptm/index', {
            title: 'PTM Scheduler',
            slots: formattedSlots,
            user: req.user,
            currentPath: '/teacher/ptm'
        });
    } catch (err) {
        console.error('[Teacher PTM Controller getPTMPage Error]:', err);
        req.flash('error', 'Failed to load PTM Scheduler.');
        res.redirect('/teacher/dashboard');
    }
};

exports.generateSlots = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const { date, startTime, endTime, duration } = req.body;

        const [[teacher]] = await db.query(
            'SELECT id FROM teachers WHERE user_id = ? AND school_id = ? LIMIT 1',
            [req.user.id, schoolId]
        );

        if (!teacher) {
            req.flash('error', 'Teacher profile not found.');
            return res.redirect('/teacher/dashboard');
        }

        if (!date || !startTime || !endTime || !duration) {
            req.flash('error', 'All fields are required to generate slots.');
            return res.redirect('/teacher/ptm');
        }

        const slotDuration = parseInt(duration, 10);
        if (isNaN(slotDuration) || slotDuration <= 0) {
            req.flash('error', 'Invalid slot duration.');
            return res.redirect('/teacher/ptm');
        }

        const [startH, startM] = startTime.split(':').map(Number);
        const [endH, endM] = endTime.split(':').map(Number);
        
        let currentMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        if (currentMinutes >= endMinutes) {
            req.flash('error', 'Start time must be before end time.');
            return res.redirect('/teacher/ptm');
        }

        let createdCount = 0;
        let skippedCount = 0;

        while (currentMinutes + slotDuration <= endMinutes) {
            const startHour = Math.floor(currentMinutes / 60);
            const startMin = currentMinutes % 60;
            const endHour = Math.floor((currentMinutes + slotDuration) / 60);
            const endMin = (currentMinutes + slotDuration) % 60;

            const slotStartStr = `${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}:00`;
            const slotEndStr = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00`;

            const [overlaps] = await db.query(
                `SELECT id FROM ptm_slots 
                WHERE teacher_id = ? AND school_id = ? AND date = ? 
                    AND (? < end_time AND ? > start_time) 
                LIMIT 1`,
                [teacher.id, schoolId, date, slotStartStr, slotEndStr]
            );

            if (overlaps.length > 0) {
                skippedCount++;
            } else {
                await db.query(
                    `INSERT INTO ptm_slots (school_id, teacher_id, date, start_time, end_time, status)
                    VALUES (?, ?, ?, ?, ?, 'available')`,
                    [schoolId, teacher.id, date, slotStartStr, slotEndStr]
                );
                createdCount++;
            }
            currentMinutes += slotDuration;
        }

        if (createdCount > 0) {
            req.flash('success', `Successfully generated ${createdCount} slots. ${skippedCount > 0 ? `Skipped ${skippedCount} overlapping slots.` : ''}`);
        } else {
            req.flash('error', `Failed to generate slots. All generated slots overlapped with existing ones.`);
        }

        res.redirect('/teacher/ptm');
    } catch (err) {
        console.error('[Teacher PTM Controller generateSlots Error]:', err);
        req.flash('error', 'An error occurred while generating slots.');
        res.redirect('/teacher/ptm');
    }
};

exports.deleteSlot = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const { id } = req.params;

        const [[teacher]] = await db.query(
            'SELECT id FROM teachers WHERE user_id = ? AND school_id = ? LIMIT 1',
            [req.user.id, schoolId]
        );

        if (!teacher) {
            req.flash('error', 'Unauthorized access.');
            return res.redirect('/teacher/ptm');
        }

        const [[slot]] = await db.query(
            'SELECT * FROM ptm_slots WHERE id = ? AND teacher_id = ? AND school_id = ? LIMIT 1',
            [id, teacher.id, schoolId]
        );

        if (!slot) {
            req.flash('error', 'Slot not found.');
            return res.redirect('/teacher/ptm');
        }

        const [[booking]] = await db.query(
            'SELECT * FROM ptm_bookings WHERE slot_id = ? AND status = "active" LIMIT 1',
            [slot.id]
        );

        if (booking) {
            await db.query(
                'UPDATE ptm_bookings SET status = "cancelled" WHERE id = ?',
                [booking.id]
            );

            try {
                const NotificationService = require('../../services/notificationService');
                await NotificationService.createAndSend({
                    recipient_id: booking.parent_user_id,
                    recipient_role: 'parent',
                    school_id: schoolId,
                    title: 'PTM Slot Cancelled',
                    message: `The PTM slot on ${new Date(slot.date).toLocaleDateString()} at ${formatTimeToAMPM(slot.start_time)} has been cancelled by the teacher.`,
                    type: 'warning',
                    category: 'general'
                });
            } catch (notifyErr) {
                console.error('[PTM Slot Cancel Notification Failed]:', notifyErr.message);
            }
        }

        await db.query(
            'DELETE FROM ptm_slots WHERE id = ? AND school_id = ?',
            [slot.id, schoolId]
        );

        req.flash('success', 'PTM Slot deleted successfully.');
        res.redirect('/teacher/ptm');
    } catch (err) {
        console.error('[Teacher PTM Controller deleteSlot Error]:', err);
        req.flash('error', 'Failed to delete PTM slot.');
        res.redirect('/teacher/ptm');
    }
};

exports.cancelBooking = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const { id } = req.params;

        const [[teacher]] = await db.query(
            'SELECT id FROM teachers WHERE user_id = ? AND school_id = ? LIMIT 1',
            [req.user.id, schoolId]
        );

        if (!teacher) {
            req.flash('error', 'Unauthorized access.');
            return res.redirect('/teacher/ptm');
        }

        const [[booking]] = await db.query(
            `SELECT b.*, s.date, s.start_time, s.end_time 
             FROM ptm_bookings b
             JOIN ptm_slots s ON b.slot_id = s.id
             WHERE b.id = ? AND s.teacher_id = ? AND b.school_id = ? LIMIT 1`,
            [id, teacher.id, schoolId]
        );

        if (!booking) {
            req.flash('error', 'PTM Booking not found.');
            return res.redirect('/teacher/ptm');
        }

        await db.query('UPDATE ptm_bookings SET status = "cancelled" WHERE id = ?', [booking.id]);
        await db.query('UPDATE ptm_slots SET status = "available" WHERE id = ?', [booking.slot_id]);

        try {
            const NotificationService = require('../../services/notificationService');
            await NotificationService.createAndSend({
                recipient_id: booking.parent_user_id,
                recipient_role: 'parent',
                school_id: schoolId,
                title: 'PTM Booking Cancelled',
                message: `Your PTM booking with the teacher on ${new Date(booking.date).toLocaleDateString()} at ${formatTimeToAMPM(booking.start_time)} has been cancelled.`,
                type: 'warning',
                category: 'general'
            });
        } catch (notifyErr) {
            console.error('[PTM Booking Cancel Notification Failed]:', notifyErr.message);
        }

        req.flash('success', 'PTM Booking cancelled and slot released.');
        res.redirect('/teacher/ptm');
    } catch (err) {
        console.error('[Teacher PTM Controller cancelBooking Error]:', err);
        req.flash('error', 'Failed to cancel booking.');
        res.redirect('/teacher/ptm');
    }
};