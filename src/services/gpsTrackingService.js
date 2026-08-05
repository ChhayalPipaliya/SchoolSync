const { queryAsync } = require('../config/database');
const { getIO } = require('../config/socket');
const config = require('../config/transportConfig');

let schemaInitialized = false;
let scannerTimer = null;

async function ensureGpsSchema() {
    if (schemaInitialized) return;
    try {
        const ttCols = await queryAsync(`SHOW COLUMNS FROM transport_trips`);
        const ttNames = ttCols.map(c => c.Field);
        if (!ttNames.includes('latitude')) {
            await queryAsync(`ALTER TABLE transport_trips ADD COLUMN latitude DECIMAL(10, 8) NULL`);
        };
        if (!ttNames.includes('longitude')) {
            await queryAsync(`ALTER TABLE transport_trips ADD COLUMN longitude DECIMAL(11, 8) NULL`);
        };
        if (!ttNames.includes('last_location_at')) {
            await queryAsync(`ALTER TABLE transport_trips ADD COLUMN last_location_at DATETIME NULL`);
        };
        if (!ttNames.includes('gps_status')) {
            await queryAsync(`ALTER TABLE transport_trips ADD COLUMN gps_status VARCHAR(20) DEFAULT 'online'`);
        };

        schemaInitialized = true;
    } catch (err) {
        console.error('[GPS Service Schema Init Error]:', err.message);
    };
};

async function recordGpsUpdate({ tripId, schoolId, driverId, latitude, longitude, speed = 0, heading = null, driverName = '', vehicleNumber = '', routeName = '' }) {
    await ensureGpsSchema();

    const [existingTrip] = await queryAsync(
        `SELECT id, gps_status, last_location_at FROM transport_trips WHERE id = ? LIMIT 1`,
        [tripId]
    );

    const now = new Date();
    await queryAsync(
        `UPDATE transport_trips
        SET latitude = ?, longitude = ?, last_location_at = ?, gps_status = 'online'
        WHERE id = ?`,
        [latitude, longitude, now, tripId]
    );

    const wasLost = existingTrip && existingTrip.gps_status === 'lost';
    if (wasLost) {
        try {
            const io = getIO();
            if (io) {
                const payload = {
                    trip_id: tripId,
                    gps_status: 'online',
                    latitude,
                    longitude,
                    last_location_at: now.toISOString(),
                    driverName,
                    vehicleNumber,
                    routeName
                };
                io.to(`trip:${tripId}`).emit('gps_status_changed', payload);
                io.to(`school:${schoolId}:trips`).emit('gps_status_changed', payload);
            };
        } catch (socketErr) {
            console.warn('[GPS Status Socket Emit Warning]:', socketErr.message);
        };
    };
};

async function checkGpsTimeouts() {
    try {
        await ensureGpsSchema();
        const timeoutSec = config.GPS_TIMEOUT_SECONDS || 60;

        const staleTrips = await queryAsync(
            `SELECT tt.id AS trip_id, tt.school_id, tt.driver_id, tt.latitude, tt.longitude, tt.last_location_at,
                r.route_name AS routeName, v.vehicle_number AS vehicleNumber
            FROM transport_trips tt
            LEFT JOIN routes r ON r.id = tt.route_id
            LEFT JOIN vehicles v ON v.id = tt.vehicle_id
            WHERE tt.status IN ('running', 'in_progress')
                AND (tt.gps_status IS NULL OR tt.gps_status != 'lost')
                AND (
                    tt.last_location_at IS NULL
                    OR tt.last_location_at < NOW() - INTERVAL ? SECOND
                )`,
            [timeoutSec]
        );

        if (!staleTrips || staleTrips.length === 0) return;

        const staleTripIds = staleTrips.map(t => t.trip_id);
        const placeholders = staleTripIds.map(() => '?').join(',');
        await queryAsync(
            `UPDATE transport_trips SET gps_status = 'lost' WHERE id IN (${placeholders})`,
            staleTripIds
        );

        let io = null;
        try {
            io = getIO();
        } catch (_) {};

        for (const trip of staleTrips) {
            // console.log(`[GPS Timeout] Trip #${trip.trip_id} marked as GPS LOST (last location: ${trip.last_location_at})`);
            if (io) {
                const payload = {
                    trip_id: trip.trip_id,
                    gps_status: 'lost',
                    latitude: trip.latitude ? parseFloat(trip.latitude) : null,
                    longitude: trip.longitude ? parseFloat(trip.longitude) : null,
                    last_location_at: trip.last_location_at ? new Date(trip.last_location_at).toISOString() : null,
                    vehicleNumber: trip.vehicleNumber || 'N/A',
                    routeName: trip.routeName || 'Active Route'
                };
                io.to(`trip:${trip.trip_id}`).emit('gps_status_changed', payload);
                io.to(`school:${trip.school_id}:trips`).emit('gps_status_changed', payload);
            };
        };
    } catch (err) {
        console.error('[GPS Timeout Scanner Error]:', err.message);
    };
};

function startTimeoutScanner() {
    if (scannerTimer) return;
    const intervalMs = config.GPS_CHECK_INTERVAL_MS || 15000;
    scannerTimer = setInterval(checkGpsTimeouts, intervalMs);
    // console.log(`[GPS Service] Background GPS Lost Scanner started (Interval: ${intervalMs}ms, Timeout: ${config.GPS_TIMEOUT_SECONDS}s)`);
};

module.exports = { ensureGpsSchema, recordGpsUpdate, checkGpsTimeouts, startTimeoutScanner};