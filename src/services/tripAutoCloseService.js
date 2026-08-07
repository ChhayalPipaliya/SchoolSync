const { queryAsync } = require('../config/database');
const { getIO } = require('../config/socket');
const config = require('../config/transportConfig');
const { logSchoolActivity } = require('../utils/auditLogger');

let schemaInitialized = false;
async function ensureTripSchema() {
    if (schemaInitialized) return;
    try {
        const ttCols = await queryAsync(`SHOW COLUMNS FROM transport_trips`);
        const ttNames = ttCols.map(c => c.Field);

        if (!ttNames.includes('auto_close_reason')) {
            await queryAsync(`ALTER TABLE transport_trips ADD COLUMN auto_close_reason VARCHAR(50) NULL`);
        };

        schemaInitialized = true;
    } catch (err) {
        console.error('[Trip AutoClose Schema Init Error]:', err.message);
    };
};

async function closeTrip({ tripId, reason, actorId = null, actorRole = 'system' }) {
    await ensureTripSchema();

    const [trip] = await queryAsync(
        `SELECT tt.id, tt.school_id, tt.driver_id, tt.vehicle_id, tt.route_id, tt.status, d.user_id AS driver_user_id
        FROM transport_trips tt
        LEFT JOIN drivers d ON d.id = tt.driver_id
        WHERE tt.id = ? AND tt.status IN ('running', 'in_progress')
        LIMIT 1`,
        [tripId]
    );

    if (!trip) return false;
    const now = new Date();
    await queryAsync(
        `UPDATE transport_trips
        SET status = 'completed', end_time = ?, auto_close_reason = ?
        WHERE id = ? AND status IN ('running', 'in_progress')`,
        [now, reason, tripId]
    );

    console.log(`[TripAutoClose] Trip #${tripId} successfully closed. Reason: ${reason}`);
    try {
        const mockReq = {
            user: { school_id: trip.school_id, id: actorId, role: actorRole },
            ip: '127.0.0.1',
            headers: {}
        };
        await logSchoolActivity(mockReq, {
            action: 'TRIP_AUTO_CLOSE',
            entityType: 'transport_trip',
            entityId: tripId,
            newValues: { status: 'completed', auto_close_reason: reason, closed_at: now.toISOString() },
            description: `Transport trip #${tripId} automatically closed by SYSTEM (${reason})`
        });
    } catch (auditErr) {
        console.warn('[TripAutoClose Audit Error]:', auditErr.message);
    };

    try {
        let io = null;
        try { io = getIO(); } catch (_) {};

        if (io) {
            const payload = {
                trip_id: tripId,
                status: 'completed',
                auto_close_reason: reason,
                closed_at: now.toISOString(),
                closed_by: 'SYSTEM'
            };

            io.to(`trip:${tripId}`).emit('trip_completed', payload);
            io.to(`trip:${tripId}`).emit('trip_status_changed', payload);
            io.to(`school:${trip.school_id}:trips`).emit('trip_completed', payload);
            io.to(`school:${trip.school_id}:trips`).emit('trip_status_changed', payload);

            if (trip.driver_user_id) {
                io.to(`user:${trip.driver_user_id}`).emit('trip_completed', payload);
            };
        };
    } catch (socketErr) {
        console.warn('[TripAutoClose Socket Error]:', socketErr.message);
    };
    return true;
};

async function scanAndAutoCloseTrips() {
    try {
        await ensureTripSchema();
        const reasons = config.AUTO_CLOSE_REASONS;
        let closedCount = 0;

        const midnightTrips = await queryAsync(
            `SELECT id FROM transport_trips
            WHERE status IN ('running', 'in_progress') AND trip_date < CURDATE()`
        );
        
        for (const t of midnightTrips) {
            const closed = await closeTrip({ tripId: t.id, reason: reasons.MIDNIGHT_AUTO_CLOSE });
            if (closed) closedCount++;
        };

        const inactivityMinutes = config.GPS_INACTIVITY_AUTO_CLOSE_MINUTES || 120;
        const inactiveGpsTrips = await queryAsync(
            `SELECT id FROM transport_trips
            WHERE status IN ('running', 'in_progress')
                AND last_location_at IS NOT NULL
                AND last_location_at < NOW() - INTERVAL ? MINUTE`,
            [inactivityMinutes]
        );
        for (const t of inactiveGpsTrips) {
            const closed = await closeTrip({ tripId: t.id, reason: reasons.NO_GPS_ACTIVITY });
            if (closed) closedCount++;
        };

        const activeTrips = await queryAsync(
            `SELECT id, trip_type FROM transport_trips WHERE status IN ('running', 'in_progress')`
        );

        for (const t of activeTrips) {
            const isDrop = t.trip_type === 'drop';
            const inTransitCondition = isDrop
                ? "status IN ('pending', 'waiting', 'picked')"
                : "status IN ('pending', 'waiting')";

            const [counts] = await queryAsync(
                `SELECT 
                    COUNT(*) AS total_assigned,
                    SUM(CASE WHEN ${inTransitCondition} THEN 1 ELSE 0 END) AS remaining_in_transit
                FROM transport_trip_students
                WHERE trip_id = ?`,
                [t.id]
            );

            const totalAssigned = Number(counts?.total_assigned || 0);
            const remainingInTransit = Number(counts?.remaining_in_transit || 0);
            if (totalAssigned > 0 && remainingInTransit === 0) {
                const closed = await closeTrip({ tripId: t.id, reason: reasons.ALL_STUDENTS_DROPPED });
                if (closed) closedCount++;
            };
        };
    } catch (err) {
        console.error('[TripAutoClose Scan Error]:', err.message);
    };
};

module.exports = { ensureTripSchema, closeTrip, scanAndAutoCloseTrips };