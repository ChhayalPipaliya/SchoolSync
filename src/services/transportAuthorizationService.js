const VALID_TRIP_TYPES = new Set(['pickup', 'drop']);
const VALID_TRIP_STUDENT_STATUSES = new Set(['pending', 'picked', 'dropped', 'absent', 'missed', 'no_show']);
const TERMINAL_TRIP_STUDENT_STATUSES = new Set(['dropped', 'absent', 'missed', 'no_show']);
const unresolvedTripStudentStatuses = (statuses = []) => statuses.filter((status) => !TERMINAL_TRIP_STUDENT_STATUSES.has(String(status || '').toLowerCase()));

const toPositiveInt = (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const validateTripStudentTransition = ({ tripType, currentStatus, nextStatus }) => {
    const normalizedTripType = String(tripType || '').trim().toLowerCase();
    const current = String(currentStatus || 'pending').trim().toLowerCase();
    const next = String(nextStatus || '').trim().toLowerCase();

    if (!VALID_TRIP_TYPES.has(normalizedTripType)) {
        return { allowed: false, message: 'Trip type is invalid.' };
    };
    if (!VALID_TRIP_STUDENT_STATUSES.has(current) || !VALID_TRIP_STUDENT_STATUSES.has(next)) {
        return { allowed: false, message: 'Student transport status is invalid.' };
    };
    if (current === next) {
        return { allowed: false, message: `Student is already marked as ${current}.` };
    };
    if (['dropped', 'absent', 'missed', 'no_show'].includes(current)) {
        return { allowed: false, message: `Student status ${current} is final for this trip.` };
    };

    if (normalizedTripType === 'pickup') {
        if (current !== 'pending' || !['picked', 'absent', 'missed'].includes(next)) {
            return { allowed: false, message: `Cannot change a pickup trip student from ${current} to ${next}.` };
        };
        return { allowed: true };
    };

    if (next === 'dropped' && ['pending', 'picked'].includes(current)) {
        return { allowed: true };
    };
    if (current === 'pending' && ['absent', 'missed'].includes(next)) {
        return { allowed: true };
    };
    return { allowed: false, message: `Cannot change a drop trip student from ${current} to ${next}.` };
};

const createTransportAuthorizationService = ({ query }) => {
    if (typeof query !== 'function') {
        throw new TypeError('A query function is required.');
    };

    const canJoinTripRoom = async ({ user, tripId }) => {
        const userId = toPositiveInt(user?.id);
        const schoolId = toPositiveInt(user?.school_id);
        const normalizedTripId = toPositiveInt(tripId);
        if (!userId || !schoolId || !normalizedTripId) return false;

        let sql;
        let params;
        switch (user.role) {
            case 'school_admin':
                sql = `SELECT tt.id
                FROM transport_trips tt
                WHERE tt.id = ?
                    AND tt.school_id = ?
                    AND tt.status = 'running'
                LIMIT 1`;
                params = [normalizedTripId, schoolId];
                break;
            case 'driver':
                sql = `SELECT tt.id
                FROM transport_trips tt
                JOIN drivers d
                    ON d.id = tt.driver_id
                    AND d.school_id = tt.school_id
                    AND d.user_id = ?
                    AND d.status = 'active'
                    AND d.deleted_at IS NULL
                WHERE tt.id = ?
                    AND tt.school_id = ?
                    AND tt.status = 'running'
                LIMIT 1`;
                params = [userId, normalizedTripId, schoolId];
                break;
            case 'student':
                sql = `SELECT tt.id
                FROM transport_trips tt
                JOIN transport_trip_students tts
                    ON tts.trip_id = tt.id
                    AND tts.school_id = tt.school_id
                JOIN students s
                    ON s.id = tts.student_id
                    AND s.school_id = tt.school_id
                    AND s.user_id = ?
                    AND s.deleted_at IS NULL
                WHERE tt.id = ?
                    AND tt.school_id = ?
                    AND tt.status = 'running'
                LIMIT 1`;
                params = [userId, normalizedTripId, schoolId];
                break;
            case 'parent':
                sql = `SELECT tt.id
                FROM transport_trips tt
                JOIN transport_trip_students tts
                    ON tts.trip_id = tt.id
                    AND tts.school_id = tt.school_id
                JOIN students s
                    ON s.id = tts.student_id
                    AND s.school_id = tt.school_id
                    AND s.deleted_at IS NULL
                JOIN student_family sf
                    ON sf.student_id = s.id
                    AND sf.school_id = tt.school_id
                    AND sf.parent_user_id = ?
                WHERE tt.id = ?
                    AND tt.school_id = ?
                    AND tt.status = 'running'
                    AND s.parent_portal_enabled = 1
                LIMIT 1`;
                params = [userId, normalizedTripId, schoolId];
                break;
            default:
                return false;
        };

        const rows = await query(sql, params);
        return Array.isArray(rows) && rows.length > 0;
    };
    return { canJoinTripRoom };
};

module.exports = { createTransportAuthorizationService, toPositiveInt, validateTripStudentTransition, unresolvedTripStudentStatuses};