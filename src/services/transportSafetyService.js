const { queryAsync } = require('../config/database');
const { getIO } = require('../config/socket');
const config = require('../config/transportConfig');
let NotificationService = null;
try {
    NotificationService = require('./notificationService');
} catch (_) {}

let schemaInitialized = false;
async function ensureSafetySchema() {
    if (schemaInitialized) return;
    try {
        await queryAsync(`
            CREATE TABLE IF NOT EXISTS transport_alerts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                school_id INT NOT NULL,
                driver_id INT NULL,
                user_id INT NULL,
                trip_id INT NULL,
                vehicle_id INT NULL,
                alert_type VARCHAR(50) DEFAULT 'general',
                severity ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
                latitude DECIMAL(10, 8) NULL,
                longitude DECIMAL(11, 8) NULL,
                speed DECIMAL(5, 2) DEFAULT NULL,
                status ENUM('active', 'acknowledged', 'resolved', 'dismissed') DEFAULT 'active',
                pin VARCHAR(10) NULL,
                notes TEXT NULL,
                acknowledged_at DATETIME NULL,
                resolved_at DATETIME NULL,
                resolved_by INT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                KEY idx_school_status (school_id, status),
                KEY idx_trip (trip_id),
                KEY idx_driver (driver_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        try {
            await queryAsync(`ALTER TABLE transport_alerts MODIFY COLUMN alert_type VARCHAR(50) DEFAULT 'general'`);
        } catch (_) {}

        try {
            const cols = await queryAsync(`SHOW COLUMNS FROM transport_alerts LIKE 'severity'`);
            if (!cols || cols.length === 0) {
                await queryAsync(`ALTER TABLE transport_alerts ADD COLUMN severity ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium'`);
            }
        } catch (_) {}

        try {
            const cols = await queryAsync(`SHOW COLUMNS FROM transport_alerts LIKE 'speed'`);
            if (!cols || cols.length === 0) {
                await queryAsync(`ALTER TABLE transport_alerts ADD COLUMN speed DECIMAL(5, 2) NULL`);
            }
        } catch (_) {}

        await queryAsync(`
            CREATE TABLE IF NOT EXISTS transport_trip_checklists (
                id INT AUTO_INCREMENT PRIMARY KEY,
                school_id INT NOT NULL,
                trip_id INT NULL,
                driver_id INT NOT NULL,
                vehicle_id INT NOT NULL,
                checklist_date DATE NOT NULL,
                brakes_ok TINYINT(1) DEFAULT 1,
                tires_ok TINYINT(1) DEFAULT 1,
                fuel_ok TINYINT(1) DEFAULT 1,
                lights_ok TINYINT(1) DEFAULT 1,
                first_aid_ok TINYINT(1) DEFAULT 1,
                emergency_door_ok TINYINT(1) DEFAULT 1,
                cleanliness_ok TINYINT(1) DEFAULT 1,
                status ENUM('passed', 'flagged') DEFAULT 'passed',
                odometer_reading INT NULL,
                remarks TEXT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                KEY idx_school_date (school_id, checklist_date),
                KEY idx_trip (trip_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        schemaInitialized = true;
    } catch (err) {
        console.error('[TransportSafetyService Schema Error]:', err.message);
    };
};

const speedAlertCache = new Map();
async function recordOverspeedAlert({ schoolId, driverId, tripId, vehicleId = null, speed, latitude, longitude, vehicleNumber = '', routeName = '' }) {
    await ensureSafetySchema();
    const maxSpeed = config.OVERSPEED_LIMIT_KMH || 50;
    if (speed <= maxSpeed) return null;

    const cacheKey = `speed_${tripId || driverId}`;
    const now = Date.now();
    if (speedAlertCache.has(cacheKey) && (now - speedAlertCache.get(cacheKey)) < 120000) {
        return null;
    };
    speedAlertCache.set(cacheKey, now);

    try {
        const notes = `Overspeeding detected: ${Math.round(speed)} km/h (Limit: ${maxSpeed} km/h) on route ${routeName || 'N/A'}`;
        const res = await queryAsync(
            `INSERT INTO transport_alerts 
             (school_id, driver_id, trip_id, vehicle_id, alert_type, severity, speed, latitude, longitude, status, notes)
             VALUES (?, ?, ?, ?, 'overspeed', 'high', ?, ?, ?, 'active', ?)`,
            [schoolId, driverId, tripId || null, vehicleId || null, speed, latitude, longitude, notes]
        );

        const alertId = res.insertId;
        const io = getIO();
        if (io) {
            const payload = {
                alert_id: alertId,
                school_id: schoolId,
                trip_id: tripId,
                alert_type: 'overspeed',
                severity: 'high',
                speed: Math.round(speed),
                max_speed: maxSpeed,
                vehicle_number: vehicleNumber,
                route_name: routeName,
                latitude,
                longitude,
                notes,
                created_at: new Date().toISOString()
            };
            io.to(`school:${schoolId}:trips`).emit('transport_safety_alert', payload);
        };
        return alertId;
    } catch (err) {
        console.error('[Record Overspeed Alert Error]:', err.message);
        return null;
    };
};

const deviationAlertCache = new Map();
async function recordRouteDeviationAlert({ schoolId, driverId, tripId, vehicleId = null, deviationMeters, latitude, longitude, vehicleNumber = '', routeName = '' }) {
    await ensureSafetySchema();
    const threshold = config.ROUTE_DEVIATION_THRESHOLD_METERS || 600;
    if (deviationMeters < threshold) return null;

    const cacheKey = `dev_${tripId || driverId}`;
    const now = Date.now();
    if (deviationAlertCache.has(cacheKey) && (now - deviationAlertCache.get(cacheKey)) < 300000) {
        return null;
    };
    deviationAlertCache.set(cacheKey, now);

    try {
        const notes = `Route deviation detected: Bus is ${Math.round(deviationMeters)}m away from scheduled stops corridor`;
        const res = await queryAsync(
            `INSERT INTO transport_alerts 
             (school_id, driver_id, trip_id, vehicle_id, alert_type, severity, latitude, longitude, status, notes)
             VALUES (?, ?, ?, ?, 'route_deviation', 'medium', ?, ?, 'active', ?)`,
            [schoolId, driverId, tripId || null, vehicleId || null, latitude, longitude, notes]
        );

        const alertId = res.insertId;
        const io = getIO();
        if (io) {
            const payload = {
                alert_id: alertId,
                school_id: schoolId,
                trip_id: tripId,
                alert_type: 'route_deviation',
                severity: 'medium',
                deviation_meters: Math.round(deviationMeters),
                vehicle_number: vehicleNumber,
                route_name: routeName,
                latitude,
                longitude,
                notes,
                created_at: new Date().toISOString()
            };
            io.to(`school:${schoolId}:trips`).emit('transport_safety_alert', payload);
        };
        return alertId;
    } catch (err) {
        console.error('[Record Deviation Alert Error]:', err.message);
        return null;
    };
};

async function logPreTripChecklist({ schoolId, tripId = null, driverId, vehicleId, checklist, remarks = '', odometer = null }) {
    await ensureSafetySchema();
    const {
        brakes_ok = true,
        tires_ok = true,
        fuel_ok = true,
        lights_ok = true,
        first_aid_ok = true,
        emergency_door_ok = true,
        cleanliness_ok = true
    } = checklist;

    const isAllOk = brakes_ok && tires_ok && fuel_ok && lights_ok && first_aid_ok && emergency_door_ok && cleanliness_ok;
    const status = isAllOk ? 'passed' : 'flagged';

    const res = await queryAsync(
        `INSERT INTO transport_trip_checklists
        (school_id, trip_id, driver_id, vehicle_id, checklist_date, brakes_ok, tires_ok, fuel_ok, lights_ok, first_aid_ok, emergency_door_ok, cleanliness_ok, status, odometer_reading, remarks)
        VALUES (?, ?, ?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [schoolId, tripId, driverId, vehicleId, brakes_ok ? 1 : 0, tires_ok ? 1 : 0, fuel_ok ? 1 : 0, lights_ok ? 1 : 0, first_aid_ok ? 1 : 0, emergency_door_ok ? 1 : 0, cleanliness_ok ? 1 : 0, status, odometer || null, remarks || null]
    );

    if (!isAllOk) {
        const flagNotes = `Pre-trip checklist flagged by driver: ${remarks || 'One or more safety items failed check'}`;
        await queryAsync(
            `INSERT INTO transport_alerts (school_id, driver_id, trip_id, vehicle_id, alert_type, severity, status, notes)
            VALUES (?, ?, ?, ?, 'checklist_failure', 'high', 'active', ?)`,
            [schoolId, driverId, tripId, vehicleId, flagNotes]
        );
    };
    return { id: res.insertId, status, passed: isAllOk };
};

module.exports = { ensureSafetySchema, recordOverspeedAlert, recordRouteDeviationAlert, logPreTripChecklist };
