const db = require('../config/database');
const { queryAsync, withTransaction } = require('../config/database');
const { getIO } = require('../config/socket');
let NotificationService = null;
try {
    NotificationService = require('./notificationService');
} catch (_) {}

async function setStudentBusAbsence({ schoolId, studentId, date = null, shift = null, reason = 'Parent notified absence' }) {
    const targetDate = date || new Date().toISOString().split('T')[0];

    const [trips] = await db.query(
        `SELECT tt.id AS trip_id, tts.id AS trip_student_id
        FROM transport_trips tt
        JOIN transport_trip_students tts ON tts.trip_id = tt.id AND tts.school_id = tt.school_id
        WHERE tt.school_id = ? AND tts.student_id = ? AND tt.trip_date = ? AND tt.status IN ('scheduled', 'running')`,
        [schoolId, studentId, targetDate]
    );

    if (trips && trips.length > 0) {
        for (const t of trips) {
            await db.query(
                `UPDATE transport_trip_students
                SET status = 'absent', remarks = ?, updated_at = NOW()
                WHERE id = ? AND school_id = ?`,
                [reason, t.trip_student_id, schoolId]
            );

            const io = getIO();
            if (io) {
                io.to(`trip:${t.trip_id}`).emit('student_status_updated', {
                    trip_id: t.trip_id,
                    student_id: studentId,
                    status: 'absent',
                    remarks: reason
                });
            };
        };
    };
    return { success: true, count: trips ? trips.length : 0 };
};

async function scanStudentBoarding({ schoolId, tripId, studentCode, driverId = null }) {
    const [[student]] = await db.query(
        `SELECT s.id, u.first_name, u.last_name, s.roll_no
        FROM students s
        JOIN users u ON s.user_id = u.id
        WHERE s.school_id = ? AND s.deleted_at IS NULL
            AND (s.id = ? OR s.roll_no = ? OR u.phone = ?)
        LIMIT 1`,
        [schoolId, studentCode, studentCode, studentCode]
    );

    if (!student) {
        return { success: false, message: 'Student not found with scanned code' };
    };

    const [[tripStudent]] = await db.query(
        `SELECT tts.id, tts.status, tts.pickup_stop_id, tts.drop_stop_id, tt.trip_type
        FROM transport_trip_students tts
        JOIN transport_trips tt ON tts.trip_id = tt.id
        WHERE tts.trip_id = ? AND tts.student_id = ? AND tts.school_id = ?
        LIMIT 1`,
        [tripId, student.id, schoolId]
    );

    if (!tripStudent) {
        return { success: false, message: `${student.first_name} is not assigned to this bus route trip.` };
    };

    const newStatus = tripStudent.trip_type === 'drop' ? 'dropped' : 'picked';
    const now = new Date();
    const updateField = newStatus === 'picked' ? 'picked_at = ?' : 'dropped_at = ?';

    await db.query(
        `UPDATE transport_trip_students
        SET status = ?, ${updateField}, updated_at = NOW()
        WHERE id = ? AND school_id = ?`,
        [newStatus, now, tripStudent.id, schoolId]
    );

    const io = getIO();
    if (io) {
        io.to(`trip:${tripId}`).emit('student_status_updated', {
            trip_id: tripId,
            student_id: student.id,
            student_name: `${student.first_name} ${student.last_name || ''}`.trim(),
            status: newStatus,
            timestamp: now.toISOString()
        });
        io.to(`school:${schoolId}:trips`).emit('student_status_updated', {
            trip_id: tripId,
            student_id: student.id,
            status: newStatus,
            timestamp: now.toISOString()
        });
    };

    try {
        const [[parent]] = await db.query(
            `SELECT u.id AS parentUserId
            FROM student_family sf
            JOIN users u ON sf.parent_user_id = u.id
            WHERE sf.student_id = ? AND sf.school_id = ? LIMIT 1`,
            [student.id, schoolId]
        );

        if (parent && NotificationService) {
            NotificationService.createAndSend({
                recipient_id: parent.parentUserId,
                recipient_role: 'parent',
                school_id: schoolId,
                title: newStatus === 'picked' ? 'Child Boarded Bus' : 'Child Dropped from Bus',
                message: `${student.first_name} has ${newStatus === 'picked' ? 'boarded' : 'safely deboarded'} the bus at ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
                type: 'info',
                category: 'transport',
                reference_type: 'transport_trip',
                reference_id: tripId,
                action_url: '/parent/transport'
            }).catch(e => console.error('[Scan Boarding Notify Parent Error]:', e.message));
        };
    } catch (_) {}

    return {
        success: true,
        status: newStatus,
        student: {
            id: student.id,
            name: `${student.first_name} ${student.last_name || ''}`.trim(),
            roll_no: student.roll_no
        },
        time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
};

module.exports = { setStudentBusAbsence, scanStudentBoarding };