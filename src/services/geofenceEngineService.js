const { queryAsync } = require('../config/database');
const { haversineDistanceKm } = require('../utils/geoUtils');
const config = require('../config/transportConfig');
const { getIO } = require('../config/socket');
let NotificationService = null;
try {
    NotificationService = require('./notificationService');
} catch (_) {};

let schemaInitialized = false;
async function ensureGeofenceSchema() {
    if (schemaInitialized) return;
    try {
        await queryAsync(`
            CREATE TABLE IF NOT EXISTS transport_trip_stop_arrivals (
                id INT AUTO_INCREMENT PRIMARY KEY,
                school_id INT NOT NULL,
                trip_id INT NOT NULL,
                route_stop_id INT NOT NULL,
                driver_id INT NULL,
                vehicle_id INT NULL,
                status VARCHAR(20) DEFAULT 'reached',
                distance_meters DECIMAL(10, 2) DEFAULT 0,
                delay_minutes INT DEFAULT 0,
                arrived_at DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uq_trip_stop (trip_id, route_stop_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        schemaInitialized = true;
    } catch (err) {
        console.error('[Geofence Schema Init Error]:', err.message);
    };
};

async function evaluateTripGeofence({ schoolId, tripId, routeId = null, driverId = null, vehicleId = null, busLat, busLng, speedKmh = 0 }) {
    try {
        await ensureGeofenceSchema();
        const maxSpeed = config.GEOFENCE_MAX_SPEED_KMH || 120;
        if (!Number.isFinite(busLat) || !Number.isFinite(busLng) || speedKmh > maxSpeed) {
            return [];
        };

        let activeRouteId = routeId;
        if (!activeRouteId && tripId) {
            const [trip] = await queryAsync(
                `SELECT route_id, driver_id, vehicle_id FROM transport_trips WHERE id = ? AND school_id = ? LIMIT 1`,
                [tripId, schoolId]
            );
            activeRouteId = trip?.route_id || null;
            if (!driverId) driverId = trip?.driver_id || null;
            if (!vehicleId) vehicleId = trip?.vehicle_id || null;
        };

        if (!activeRouteId) return [];
        const stops = await queryAsync(
            `SELECT id, stop_name, stop_order, latitude, longitude, pickup_time, drop_time,
                ? AS geofence_radius
            FROM transport_route_stops
            WHERE school_id = ? AND route_id = ? AND status != 'deleted'
            ORDER BY stop_order ASC, id ASC`,
            [config.DEFAULT_GEOFENCE_RADIUS_METERS || 100, schoolId, activeRouteId]
        );

        if (!stops || stops.length === 0) return [];
        const existingArrivals = await queryAsync(
            `SELECT route_stop_id, status, arrived_at FROM transport_trip_stop_arrivals WHERE trip_id = ?`,
            [tripId]
        );

        const arrivalsMap = new Map();
        existingArrivals.forEach(a => arrivalsMap.set(a.route_stop_id, a));
        const newArrivalEvents = [];
        const now = new Date();

        for (let i = 0; i < stops.length; i++) {
            const stop = stops[i];
            const stopLat = Number(stop.latitude);
            const stopLng = Number(stop.longitude);
            if (!Number.isFinite(stopLat) || !Number.isFinite(stopLng)) continue;

            const distKm = haversineDistanceKm(busLat, busLng, stopLat, stopLng);
            const distMeters = Math.round(distKm * 1000);
            const radiusMeters = Number(stop.geofence_radius || config.DEFAULT_GEOFENCE_RADIUS_METERS || 100);

            if (distMeters <= radiusMeters && !arrivalsMap.has(stop.id)) {
                let delayMinutes = 0;
                const scheduledTimeStr = stop.pickup_time || stop.drop_time || null;
                if (scheduledTimeStr) {
                    try {
                        const [schedH, schedM] = scheduledTimeStr.split(':').map(Number);
                        const schedDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), schedH, schedM, 0);
                        const diffMin = Math.round((now.getTime() - schedDate.getTime()) / 60000);
                        if (diffMin > 0) delayMinutes = diffMin;
                    } catch (_) {};
                };

                await queryAsync(
                    `INSERT IGNORE INTO transport_trip_stop_arrivals
                    (school_id, trip_id, route_stop_id, driver_id, vehicle_id, status, distance_meters, delay_minutes, arrived_at)
                    VALUES (?, ?, ?, ?, ?, 'reached', ?, ?, ?)`,
                    [schoolId, tripId, stop.id, driverId, vehicleId, distMeters, delayMinutes, now]
                );

                arrivalsMap.set(stop.id, { route_stop_id: stop.id, status: 'reached', arrived_at: now });
                for (let j = 0; j < i; j++) {
                    const prevStop = stops[j];
                    if (!arrivalsMap.has(prevStop.id)) {
                        await queryAsync(
                            `INSERT IGNORE INTO transport_trip_stop_arrivals
                            (school_id, trip_id, route_stop_id, driver_id, vehicle_id, status, distance_meters, delay_minutes, arrived_at)
                            VALUES (?, ?, ?, ?, ?, 'skipped', 0, 0, ?)`,
                            [schoolId, tripId, prevStop.id, driverId, vehicleId, now]
                        );
                        arrivalsMap.set(prevStop.id, { route_stop_id: prevStop.id, status: 'skipped', arrived_at: now });
                    };
                };

                const arrivalEvent = {
                    trip_id: tripId,
                    stop_id: stop.id,
                    stop_name: stop.stop_name,
                    stop_order: stop.stop_order,
                    arrived_at: now.toISOString(),
                    status: 'reached',
                    delay_minutes: delayMinutes
                };

                newArrivalEvents.push(arrivalEvent);
                try {
                    const parentUsers = await queryAsync(
                        `SELECT DISTINCT u.id AS parentUserId, CONCAT(su.first_name, ' ', COALESCE(su.last_name, '')) AS studentName
                        FROM student_transport_allocations sta
                        JOIN students s ON s.id = sta.student_id AND s.school_id = sta.school_id
                        JOIN users su ON su.id = s.user_id
                        JOIN student_family sf ON sf.student_id = s.id AND sf.school_id = s.school_id
                        JOIN users u ON u.id = sf.parent_user_id
                        WHERE sta.school_id = ? AND sta.status = 'active'
                            AND (sta.pickup_stop_id = ? OR sta.drop_stop_id = ?)
                            AND u.status = 'active'`,
                        [schoolId, stop.id, stop.id]
                    );

                    if (parentUsers && parentUsers.length > 0 && NotificationService) {
                        for (const p of parentUsers) {
                            NotificationService.createAndSend({
                                recipient_id: p.parentUserId,
                                recipient_role: 'parent',
                                school_id: schoolId,
                                title: 'Bus Arrived at Stop',
                                message: `Bus has arrived at ${stop.stop_name} for ${p.studentName || 'your child'}.`,
                                type: 'info',
                                category: 'transport',
                                reference_type: 'transport_trip',
                                reference_id: tripId,
                                action_url: '/parent/transport'
                            }).catch(e => console.error('[Geofence Parent Notify Error]:', e.message));
                        };
                    };
                } catch (notifyErr) {
                    console.error('[Geofence Parent Query Error]:', notifyErr.message);
                };

                try {
                    let io = null;
                    try { io = getIO(); } catch (_) {};
                    if (io) {
                        io.to(`trip:${tripId}`).emit('stop_reached', arrivalEvent);
                        io.to(`school:${schoolId}:trips`).emit('stop_reached', arrivalEvent);
                    };
                } catch (socketErr) {
                    console.warn('[Geofence Socket Error]:', socketErr.message);
                };
            };
        };
        return newArrivalEvents;
    } catch (err) {
        console.error('[Geofence Engine Error]:', err.message);
        return [];
    };
};

module.exports = { ensureGeofenceSchema, evaluateTripGeofence };