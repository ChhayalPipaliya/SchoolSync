const { queryAsync, withTransaction } = require("../../config/database");
const { unresolvedTripStudentStatuses } = require("../../services/transportAuthorizationService");
const { resolveUserSchoolId } = require("../../utils/resolveUserSchoolId");

const toPositiveInt = (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const parseCoordinate = (value) => {
    if (value === undefined || value === null || value === "" || value === "—") return null;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const normalizeTripShift = (value) => ['morning', 'evening', 'full_day'].includes(value) ? value : 'full_day';
const isAllowedStudentTransition = (tripType, currentStatus, nextStatus) => {
    const current = currentStatus || 'pending';
    if (tripType === 'pickup') {
        return current === 'pending' && ['picked', 'absent', 'missed'].includes(nextStatus);
    };
    if (tripType === 'drop') {
        return (current === 'pending' && ['dropped', 'absent', 'missed'].includes(nextStatus))
            || (current === 'picked' && nextStatus === 'dropped');
    };
    return false;
};
const tripShiftLabel = (value) => {
    const shift = normalizeTripShift(value);
    if (shift === 'morning') return 'Morning School';
    if (shift === 'evening') return 'Evening School';
    return 'Full Day School';
};

const tripDisplayLabel = (tripType, tripShift) => {
    const shift = normalizeTripShift(tripShift);
    if (shift === 'morning') return tripType === 'drop' ? 'Morning Drop' : 'Morning Pickup';
    if (shift === 'evening') return tripType === 'drop' ? 'Evening Drop' : 'Evening Pickup';
    return tripType === 'drop' ? 'Evening Drop' : 'Morning Pickup';
};

const getDriverProfile = async (schoolId, userId) => {
    const rows = await queryAsync(`
        SELECT d.*,
            v.id AS vehicle_id, v.vehicle_number AS vehicleNumber, v.model AS vehicleModel, v.capacity,
            v.fuel_type AS fuelType, v.last_service_date AS lastService,
            r.id AS route_id, r.route_name AS routeName, r.start_point AS startPoint, r.end_point AS endPoint, COALESCE(r.school_shift, 'full_day') AS routeShift
        FROM drivers d
        JOIN users u ON u.id = d.user_id AND u.school_id = d.school_id
        LEFT JOIN driver_vehicle_assign dva ON dva.driver_id = d.id AND dva.is_active = 1
        LEFT JOIN routes r ON r.driver_id = d.id AND r.school_id = d.school_id AND r.status = 'active'
        LEFT JOIN vehicles v ON v.id = COALESCE(dva.vehicle_id, r.vehicle_id) AND v.school_id = d.school_id
        WHERE d.school_id = ? AND u.id = ?
        LIMIT 1
    `, [schoolId, userId]);
    return rows[0] || null;
};

const getActiveTrip = async (schoolId, driverId) => {
    const rows = await queryAsync(`
        SELECT tt.id, tt.school_id, tt.driver_id, tt.route_id, tt.vehicle_id, tt.trip_date,
            tt.start_at, tt.end_at, 'in_progress' AS status, tt.trip_type, COALESCE(tt.trip_shift, 'full_day') AS trip_shift,
            r.route_name AS routeName, v.vehicle_number AS vehicleNumber
        FROM transport_trips tt
        LEFT JOIN routes r ON tt.route_id = r.id AND r.school_id = tt.school_id
        LEFT JOIN vehicles v ON tt.vehicle_id = v.id AND v.school_id = tt.school_id
        WHERE tt.school_id = ? AND tt.driver_id = ? AND tt.trip_date = CURDATE() AND tt.status = 'running'
        ORDER BY tt.id DESC LIMIT 1
    `, [schoolId, driverId]);
    if (rows[0]) return rows[0];

    const legacyRows = await queryAsync(`
        SELECT * FROM driver_trips
        WHERE school_id=? AND driver_id=? AND trip_date=CURDATE() AND status='in_progress'
        ORDER BY id DESC LIMIT 1
    `, [schoolId, driverId]);
    return legacyRows[0] || null;
};

const getActiveTransportTrip = async (schoolId, driverId) => {
    const rows = await queryAsync(`
        SELECT tt.*, r.route_name AS routeName, v.vehicle_number AS vehicleNumber
        FROM transport_trips tt
        LEFT JOIN routes r ON tt.route_id = r.id AND r.school_id = tt.school_id
        LEFT JOIN vehicles v ON tt.vehicle_id = v.id AND v.school_id = tt.school_id
        WHERE tt.school_id = ? AND tt.driver_id = ? AND tt.trip_date = CURDATE() AND tt.status = 'running'
        ORDER BY tt.id DESC
        LIMIT 1
    `, [schoolId, driverId]);
    return rows[0] || null;
};

const getTodayTransportTripByType = async (schoolId, driverId, tripType) => {
    const rows = await queryAsync(`
        SELECT id, status, start_at AS startAt, end_at AS endAt, COALESCE(trip_shift, 'full_day') AS tripShift
        FROM transport_trips
        WHERE school_id = ? AND driver_id = ? AND trip_date = CURDATE() AND trip_type = ?
        ORDER BY id DESC
        LIMIT 1
    `, [schoolId, driverId, tripType]);
    return rows[0] || null;
};

const getStudents = async (schoolId, routeName) => {
    return queryAsync(`
        SELECT NULL AS allocationId, NULL AS pickupStopId, NULL AS dropStopId,
            s.id, u.first_name AS first_name, u.last_name AS last_name, s.roll_no,
            c.class_name AS className, c.section,
            sat.transport_route AS stopName, NULL AS stopId,
            sat.transport_route AS pickupStopName, COALESCE(sat.current_address, sat.permanent_address, '—') AS pickupStopAddress, '—' AS pickupTime,
            sat.transport_route AS dropStopName, COALESCE(sat.current_address, sat.permanent_address, '—') AS dropStopAddress, '—' AS dropTime,
            COALESCE(sf.father_phone, sf.mother_phone, sf.guardian_phone, sat.emergency_contact, u.phone, '—') AS parentPhone
        FROM students s
        JOIN users u ON s.user_id = u.id
        LEFT JOIN classes c ON s.class_id = c.id
        LEFT JOIN student_family sf ON sf.student_id = s.id
        LEFT JOIN student_address_transport sat ON s.id = sat.student_id
        WHERE s.school_id = ? AND sat.transport_required = 1 AND sat.transport_route = ? AND s.deleted_at IS NULL
        ORDER BY u.first_name ASC
        LIMIT 200
    `, [schoolId, routeName]);
};

const getAdvancedStudents = async (schoolId, routeId) => {
    const rows = await queryAsync(`
        SELECT sta.id AS allocationId, sta.pickup_stop_id AS pickupStopId, sta.drop_stop_id AS dropStopId,
            sta.pickup_address AS pickupAddress, sta.pickup_latitude AS pickupLatitude,
            sta.pickup_longitude AS pickupLongitude, sta.drop_address AS dropAddress,
            sta.drop_latitude AS dropLatitude, sta.drop_longitude AS dropLongitude,
            s.id, u.first_name AS first_name, u.last_name AS last_name, s.roll_no,
            c.class_name AS className, c.section,
            COALESCE(ps.stop_name, ds.stop_name) AS stopName,
            COALESCE(sta.pickup_stop_id, sta.drop_stop_id) AS stopId,
            ps.stop_name AS pickupStopName, COALESCE(sta.pickup_address, ps.stop_address, '—') AS pickupStopAddress, COALESCE(ps.pickup_time, '—') AS pickupTime,
            ps.latitude AS pickupStopLatitude, ps.longitude AS pickupStopLongitude,
            ds.stop_name AS dropStopName, COALESCE(sta.drop_address, ds.stop_address, '—') AS dropStopAddress, COALESCE(ds.drop_time, '—') AS dropTime,
            ds.latitude AS dropStopLatitude, ds.longitude AS dropStopLongitude,
            COALESCE(sf.father_phone, sf.mother_phone, sf.guardian_phone, sat.emergency_contact, u.phone, '—') AS parentPhone
        FROM student_transport_allocations sta
        JOIN students s ON sta.student_id = s.id AND s.school_id = sta.school_id
        JOIN users u ON s.user_id = u.id
        LEFT JOIN classes c ON s.class_id = c.id
        LEFT JOIN student_family sf ON sf.student_id = s.id
        LEFT JOIN student_address_transport sat ON s.id = sat.student_id AND sat.transport_required = 1
        LEFT JOIN transport_route_stops ps ON sta.pickup_stop_id = ps.id AND ps.school_id = sta.school_id
        LEFT JOIN transport_route_stops ds ON sta.drop_stop_id = ds.id AND ds.school_id = sta.school_id
        WHERE sta.school_id = ? AND sta.route_id = ? AND sta.status = 'active' AND s.deleted_at IS NULL
        ORDER BY COALESCE(ps.stop_order, ds.stop_order, 999), ps.pickup_time, u.first_name, u.last_name
        LIMIT 300
    `, [schoolId, routeId]);
    return rows;
};

const getRouteStops = async (schoolId, routeId) => {
    return queryAsync(`
        SELECT id, stop_name AS stopName, pickup_time AS pickupTime, drop_time AS dropTime,
            stop_order AS stopOrder, latitude, longitude
        FROM transport_route_stops
        WHERE school_id = ? AND route_id = ? AND status = 'active'
        ORDER BY stop_order ASC, id ASC
    `, [schoolId, routeId]);
};

const hasCoords = (lat, lng) => {
    if (lat === null || lat === undefined || lat === '' || lat === 0 || lat === '0' || Number(lat) === 0) return false;
    if (lng === null || lng === undefined || lng === '' || lng === 0 || lng === '0' || Number(lng) === 0) return false;
    const nLat = Number(lat);
    const nLng = Number(lng);
    return Number.isFinite(nLat) && Number.isFinite(nLng) && nLat !== 0 && nLng !== 0;
};

const buildStudentMapMarkers = (students, tripType = 'pickup') => {
    const isDrop = tripType === 'drop';
    return (students || []).map((student) => {
        const allocationLat = isDrop ? student.dropLatitude : student.pickupLatitude;
        const allocationLng = isDrop ? student.dropLongitude : student.pickupLongitude;
        const stopLat = isDrop ? student.dropStopLatitude : student.pickupStopLatitude;
        const stopLng = isDrop ? student.dropStopLongitude : student.pickupStopLongitude;
        const fallbackLat = hasCoords(allocationLat, allocationLng) ? allocationLat : stopLat;
        const fallbackLng = hasCoords(allocationLat, allocationLng) ? allocationLng : stopLng;
        const source = hasCoords(allocationLat, allocationLng) ? 'allocation' : (hasCoords(stopLat, stopLng) ? 'stop' : null);

        return {
            studentId: student.id,
            name: `${student.first_name || ''} ${student.last_name || ''}`.trim(),
            stopName: (isDrop ? student.dropStopName : student.pickupStopName) || student.stopName || '',
            address: (isDrop ? student.dropStopAddress : student.pickupStopAddress) || '',
            latitude: source ? Number(fallbackLat) : null,
            longitude: source ? Number(fallbackLng) : null,
            source
        };
    }).filter(marker => marker.source);
};

const getChecklistStatus = async (schoolId, vehicleId, driverId) => {
    const rows = await queryAsync(
        "SELECT id FROM vehicle_checklists WHERE school_id = ? AND vehicle_id = ? AND driver_id = ? AND check_date = CURDATE() LIMIT 1",
        [schoolId, vehicleId, driverId]
    );
    return rows.length > 0;
};

const createTransportAlert = async (schoolId, alertType, title, message, extras = {}) => {
    try {
        const allowed = ['trip_started', 'trip_completed', 'student_picked', 'student_dropped', 'delay', 'route_change', 'vehicle_issue', 'document_expiry', 'maintenance_due', 'general'];
        const safeType = allowed.includes(alertType) ? alertType : 'general';
        await queryAsync(
            `INSERT INTO transport_alerts
            (school_id, alert_type, student_id, route_id, trip_id, vehicle_id, title, message, status, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
            [schoolId, safeType, extras.studentId || null, extras.routeId || null, extras.tripId || null, extras.vehicleId || null, title, message, extras.createdBy || null]
        );
    } catch (err) {
        console.error('[Transport Alert Fallback]', err.message);
    }
};

const notifyParentsTransportStatus = async (schoolId, studentId, status, tripId, createdBy) => {
    try {
        const studentRows = await queryAsync(
            `SELECT s.id, u.first_name, u.last_name
            FROM students s
            JOIN users u ON s.user_id = u.id
            WHERE s.id = ? AND s.school_id = ? AND s.deleted_at IS NULL
            LIMIT 1`,
            [studentId, schoolId]
        );
        const student = studentRows[0];
        if (!student) return;

        const parents = await queryAsync(
            `SELECT DISTINCT u.id AS parentUserId
            FROM student_family sf
            JOIN users u ON sf.parent_user_id = u.id
            WHERE sf.student_id = ?
                AND sf.school_id = ?
                AND sf.parent_user_id IS NOT NULL
                AND u.status = 'active'
            LIMIT 5`,
            [studentId, schoolId]
        ).catch(() => []);

        const statusMessages = {
            picked: `Your child ${student.first_name} ${student.last_name} has been picked up.`,
            dropped: `Your child ${student.first_name} ${student.last_name} has been dropped.`,
            absent: `Your child ${student.first_name} ${student.last_name} was marked absent for transport.`,
            missed: `Your child ${student.first_name} ${student.last_name} was marked missed for transport.`,
            no_show: `Your child ${student.first_name} ${student.last_name} was not marked during the transport trip.`
        };
        const message = statusMessages[status] || `Transport status updated for ${student.first_name} ${student.last_name}.`;
        const title = 'Transport update';

        let NotificationService = null;
        try {
            NotificationService = require('../../services/notificationService');
        } catch (_) {}

        if (!parents.length || !NotificationService) {
            console.log('[Transport Parent Notification]', { schoolId, studentId, status, message });
            return;
        };

        for (const parent of parents) {
            await NotificationService.createAndSend({
                recipient_id: parent.parentUserId,
                recipient_role: 'parent',
                school_id: schoolId,
                title,
                message,
                type: 'info',
                category: 'transport',
                reference_type: 'transport_trip',
                reference_id: tripId,
                created_by: createdBy || null,
                action_url: '/parent/transport'
            }).catch((err) => console.error('[Transport Parent Notification]', err.message));
        };
    } catch (err) {
        console.error('[Transport Parent Notification]', err.message);
    };
};

const getEventMap = async (tripId) => {
    if (!tripId) return {};
    const rows = await queryAsync(`
        SELECT student_id, status, remarks
        FROM transport_trip_students
        WHERE trip_id = ?
    `, [tripId]);
    const map = {};
    rows.forEach(r => {
        map[r.student_id] = {
            status: r.status,
            remarks: r.remarks,
            pickedUp: r.status === 'picked' || r.status === 'dropped',
            dropped: r.status === 'dropped',
            absent: r.status === 'absent'
        };
    });
    return map;
};

const getRecentTrips = async (schoolId, driverId) => {
    return queryAsync(`
        SELECT id, school_id, driver_id, route_id, vehicle_id, trip_date, start_at, end_at,
            CASE WHEN status = 'running' THEN 'in_progress' ELSE status END AS status,
            trip_type, created_at
        FROM transport_trips
        WHERE school_id=? AND driver_id=?
        ORDER BY id DESC LIMIT 10
    `, [schoolId, driverId]);
};

const noDriver = (driver, req, res) => {
    if (!driver) {
        req.flash("error", "Driver profile not found.");
        res.redirect("/driver/dashboard");
        return true;
    }
    return false;
};

const makeInitials = (driver) => ((driver?.first_name?.charAt(0) || "") + (driver?.last_name?.charAt(0) || "")).toUpperCase();

exports.dashboard = async (req, res) => {
    try {
        const schoolId = await resolveUserSchoolId(req.user);
        const driver = await getDriverProfile(schoolId, req.user.id);
    
        if (!driver) {
            req.flash("error", "Driver not linked with this user.");
            return res.redirect("/login");
        }

        const activeTrip = await getActiveTrip(schoolId, driver.id);
        const activeTransportTrip = await getActiveTransportTrip(schoolId, driver.id).catch(() => null);
        let students = driver.route_id ? await getAdvancedStudents(schoolId, driver.route_id).catch(() => []) : [];
        const eventMap = await getEventMap(activeTrip?.id).catch(() => ({}));
        const recentTrips = await getRecentTrips(schoolId, driver.id).catch(() => []);
        const routeStops = driver.route_id ? await getRouteStops(schoolId, driver.route_id).catch(() => []) : [];
        const checklistDone = driver.vehicle_id ? await getChecklistStatus(schoolId, driver.vehicle_id, driver.id).catch(() => false) : false;
        const pickupTripStatus = await getTodayTransportTripByType(schoolId, driver.id, 'pickup').catch(() => null);
        const dropTripStatus = await getTodayTransportTripByType(schoolId, driver.id, 'drop').catch(() => null);
        
        const [recentActivity] = activeTransportTrip?.id ? await Promise.all([queryAsync(`
            SELECT tts.status, tts.picked_at AS pickedAt, tts.dropped_at AS droppedAt, tts.updated_at AS updatedAt,
                u.first_name AS first_name, u.last_name AS last_name
            FROM transport_trip_students tts
            JOIN students s ON tts.student_id = s.id AND s.school_id = tts.school_id
            JOIN users u ON s.user_id = u.id
            WHERE tts.school_id = ? AND tts.trip_id = ? AND tts.status <> 'pending'
            ORDER BY tts.updated_at DESC
            LIMIT 8
        `, [schoolId, activeTransportTrip.id]).catch(() => [])]) : [[]];
    
        const todayRows = await queryAsync(
            "SELECT COUNT(*) AS cnt FROM transport_trips WHERE school_id=? AND driver_id=? AND trip_date=CURDATE() AND status='completed'",
            [schoolId, driver.id]
        ).catch(() => [{ cnt: 0 }]);

        let pickedUpCount = 0, droppedCount = 0;
        Object.values(eventMap || {}).forEach(ev => {
            if (ev.pickedUp) pickedUpCount++;
            if (ev.dropped) droppedCount++;
        });

        const studentMapMarkers = buildStudentMapMarkers(students, activeTrip?.trip_type || 'pickup');

        return res.render("driver/dashboard", { user: req.user, driver, activeTrip: activeTrip || null, activeTransportTrip, students, eventMap, recentTrips, recentActivity, routeStops, studentMapMarkers, nextStop: routeStops[0] || null, checklistDone, pickupTripStatus, dropTripStatus, todayCompletedTrips: todayRows[0]?.cnt || 0, totalStudents: students?.length || 0, pickedUpCount, droppedCount, todayLabel: new Date().toDateString(), driverInitials: makeInitials(driver)});
    } catch (err) {
        console.error("DASHBOARD ERROR:", err);
        const isJson = req.xhr || req.headers.accept?.includes('json') || req.headers['content-type']?.includes('json');
        if (isJson) {
            return res.status(500).json({ success: false, message: "Internal server error." });
        }
        return res.status(500).render("errors/500", { 
            title: "500 - Internal Server Error", 
            message: "An unexpected error occurred. Please try again later.", 
            errorCode: "500" 
        });
    };
};

exports.studentsList = async (req, res) => {
    try {
        const schoolId = await resolveUserSchoolId(req.user);
        const driver = await getDriverProfile(schoolId, req.user.id);
        if (!driver) return res.send("Driver not found");

        const activeTrip = await getActiveTrip(schoolId, driver.id).catch(() => null);
        let students = driver.route_id ? await getAdvancedStudents(schoolId, driver.route_id).catch(() => []) : [];
        const eventMap = await getEventMap(activeTrip?.id).catch(() => ({}));

        return res.render("driver/students", { user: req.user, driver, activeTrip, students: students || [], eventMap: eventMap || {}, driverInitials: makeInitials(driver)});
    } catch (err) {
        console.error("STUDENTS ERROR:", err);
        const isJson = req.xhr || req.headers.accept?.includes('json') || req.headers['content-type']?.includes('json');
        if (isJson) {
            return res.status(500).json({ success: false, message: "Internal server error." });
        }
        return res.status(500).render("errors/500", { 
            title: "500 - Internal Server Error", 
            message: "An unexpected error occurred. Please try again later.", 
            errorCode: "500" 
        });
    };
};

exports.startTrip = async (req, res) => {
    try {
        const schoolId = await resolveUserSchoolId(req.user);
        const driver = await getDriverProfile(schoolId, req.user.id);
        
        if (!driver) {
            return res.status(404).json({ success: false, message: "Driver profile not found." });
        };

        if (!driver.vehicle_id) {
            return res.status(400).json({ success: false, message: "No vehicle assigned to this driver. Please contact administration." });
        };

        if (!driver.route_id) {
            return res.status(400).json({ success: false, message: "No route assigned to this driver. Please contact administration." });
        };

        const checklist = await queryAsync(
            "SELECT id FROM vehicle_checklists WHERE school_id = ? AND vehicle_id = ? AND driver_id = ? AND check_date = CURDATE() LIMIT 1",
            [schoolId, driver.vehicle_id, driver.id]
        );

        if (checklist.length === 0) {
            return res.status(400).json({ success: false, message: "Please submit today's vehicle checklist before starting the trip." });
        };

        let tripType = req.body.trip_type;
        if (typeof tripType !== 'string') tripType = 'pickup';
        tripType = tripType.trim().toLowerCase();

        const tripShift = normalizeTripShift(req.body.trip_shift || driver.routeShift || 'full_day');
        if (!['pickup', 'drop'].includes(tripType)) {
            return res.status(400).json({ success: false, message: "Invalid trip type specified." });
        };

        let transportTripId;
        await withTransaction(async ({ query }) => {
            const lockedDrivers = await query(
                `SELECT d.id
                FROM drivers d
                JOIN routes r ON r.id = ? AND r.school_id = d.school_id AND r.driver_id = d.id AND r.status = 'active'
                JOIN vehicles v ON v.id = ? AND v.school_id = d.school_id AND v.status = 'active'
                WHERE d.id = ? AND d.school_id = ? AND d.user_id = ? AND d.status = 'active'
                LIMIT 1
                FOR UPDATE`,
                [driver.route_id, driver.vehicle_id, driver.id, schoolId, req.user.id]
            );
            if (!lockedDrivers.length) {
                throw new Error("Driver, route, or vehicle assignment is no longer active.");
            };

            const runningTrips = await query(
                `SELECT id
                FROM transport_trips
                WHERE school_id = ? AND status = 'running' AND (driver_id = ? OR vehicle_id = ?)
                LIMIT 1
                FOR UPDATE`,
                [schoolId, driver.id, driver.vehicle_id]
            );
            const legacyTrips = runningTrips.length ? [] : await query(
                `SELECT id FROM driver_trips
                WHERE school_id = ? AND driver_id = ? AND status = 'in_progress'
                LIMIT 1
                FOR UPDATE`,
                [schoolId, driver.id]
            );
            if (runningTrips.length || legacyTrips.length) {
                throw new Error("A trip is already in progress for this driver or vehicle.");
            };

            const assignedStudents = await query(
                `SELECT sta.student_id AS studentId,
                    MIN(sta.id) AS allocationId,
                    MIN(sta.pickup_stop_id) AS pickupStopId,
                    MIN(sta.drop_stop_id) AS dropStopId
                FROM student_transport_allocations sta
                JOIN students s ON sta.student_id = s.id AND s.school_id = sta.school_id
                WHERE sta.school_id = ? AND sta.route_id = ? AND sta.status = 'active' AND s.deleted_at IS NULL
                GROUP BY sta.student_id`,
                [schoolId, driver.route_id]
            );
            const capacity = Number(driver.capacity);
            if (!Number.isInteger(capacity) || capacity <= 0) {
                throw new Error("Vehicle capacity is not configured.");
            };
            if (assignedStudents.length > capacity) {
                throw new Error(`Vehicle capacity exceeded: ${assignedStudents.length} students are assigned to ${capacity} seats.`);
            };

            const newTrip = await query(
                `INSERT INTO transport_trips
                    (school_id, route_id, vehicle_id, driver_id, trip_type, trip_shift, trip_date, start_at, started_at, status, created_by, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, CURDATE(), NOW(), NOW(), 'running', ?, ?)`,
                [schoolId, driver.route_id, driver.vehicle_id, driver.id, tripType, tripShift, req.user.id || null, req.user.id || null]
            );
            
            transportTripId = newTrip.insertId;
            for (const student of assignedStudents) {
                await query(
                    `INSERT INTO transport_trip_students
                    (school_id, trip_id, student_id, allocation_id, pickup_stop_id, drop_stop_id, status, created_by, updated_by)
                    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
                    [schoolId, transportTripId, student.studentId, student.allocationId || null, student.pickupStopId || null, student.dropStopId || null, req.user.id || null, req.user.id || null]
                );
            };
        });

        await createTransportAlert(
            schoolId,
            'trip_started',
            `${tripDisplayLabel(tripType, tripShift)} trip started`,
            `${driver.first_name || 'Driver'} ${driver.last_name || ''} started ${tripDisplayLabel(tripType, tripShift)} (${tripShiftLabel(tripShift)}) on ${driver.routeName || 'assigned route'}.`,
            { routeId: driver.route_id, tripId: transportTripId, vehicleId: driver.vehicle_id, createdBy: req.user.id || null }
        );

        return res.json({ success: true, message: `${tripDisplayLabel(tripType, tripShift)} started. Safe driving!`, tripId: transportTripId, transportTripId });
    } catch (err) {
        console.error("[Driver Start Trip]", err);
        return res.status(500).json({ success: false, message: "Unable to start trip: " + err.message });
    };
};

exports.endTrip = async (req, res) => {
    const isJson = req.xhr || req.headers.accept?.includes('json') || req.headers['content-type']?.includes('json');
    try {
        const schoolId = await resolveUserSchoolId(req.user);
        const driver = await getDriverProfile(schoolId, req.user.id);
        
        if (!driver) {
            if (isJson) return res.status(404).json({ success: false, message: "Driver profile not found." });
            req.flash("error", "Driver profile not found.");
            return res.redirect("/driver/dashboard");
        };

        let tripId = Number(req.params.tripId || req.body.tripId || 0);
        if (!tripId) {
            const activeTrip = await getActiveTransportTrip(schoolId, driver.id);
            tripId = activeTrip?.id || 0;
        };
        console.log(`[Driver End Trip] Attempting end trip: tripId=${tripId}, driverId=${driver.id}, schoolId=${schoolId}`);

        if (!tripId) {
            if (isJson) return res.status(400).json({ success: false, message: "No running trip found." });
            req.flash("error", "No running trip found.");
            return res.redirect("/driver/dashboard");
        };

        let transportTrip;
        let counts;
        let unresolvedStudents = [];
        await withTransaction(async ({ query }) => {
            const lockedTrips = await query(
                `SELECT id, trip_type, route_id, vehicle_id
                FROM transport_trips
                WHERE school_id = ? AND driver_id = ? AND id = ? AND status = 'running'
                LIMIT 1 FOR UPDATE`,
                [schoolId, driver.id, tripId]
            );
            transportTrip = lockedTrips[0];
            if (!transportTrip) return;

            // Completion is deliberately strict: no pending/picked student is
            // silently converted or discarded. Lock rows in the same
            // transaction so a concurrent status update cannot race completion.
            unresolvedStudents = await query(
                `SELECT id, student_id, status
                FROM transport_trip_students
                WHERE trip_id = ?
                    AND status NOT IN ('dropped', 'absent', 'missed', 'no_show')
                ORDER BY id FOR UPDATE`,
                [tripId]
            );
            if (unresolvedStudents.length) return;

            await query(
                `UPDATE transport_trips
                SET status = 'completed', end_at = NOW(), ended_at = NOW()
                WHERE id = ? AND school_id = ? AND driver_id = ? AND status = 'running'`,
                [transportTrip.id, schoolId, driver.id]
            );
            const countRows = await query(
                `SELECT
                    SUM(status = 'picked') AS picked,
                    SUM(status = 'dropped') AS dropped,
                    SUM(status = 'absent') AS absent,
                    SUM(status = 'missed') AS missed,
                    SUM(status = 'no_show') AS no_show
                FROM transport_trip_students
                WHERE school_id = ? AND trip_id = ?`,
                [schoolId, transportTrip.id]
            );
            counts = countRows[0];
            await query(
                `UPDATE transport_trips
                SET picked_count = ?, dropped_count = ?, absent_count = ?, missed_count = ?, no_show_count = ?, updated_by = ?
                WHERE id = ? AND school_id = ? AND driver_id = ?`,
                [Number(counts?.picked || 0), Number(counts?.dropped || 0), Number(counts?.absent || 0), Number(counts?.missed || 0), Number(counts?.no_show || 0), req.user.id || null, transportTrip.id, schoolId, driver.id]
            );
        });

        if (!transportTrip) {
            console.warn(`[Driver End Trip] Trip ${tripId} not found or not running for driver ${driver.id}`);
            if (isJson) return res.status(404).json({ success: false, message: "Trip not found or already ended." });
            req.flash("error", "Trip not found or already ended.");
            return res.redirect("/driver/dashboard");
        };

        if (unresolvedStudents.length) {
            const studentIds = unresolvedStudents.map((row) => row.student_id);
            const message = `Trip cannot be completed while ${unresolvedStudents.length} student(s) require a terminal status.`;
            if (isJson) return res.status(409).json({ success: false, message, unresolved_count: unresolvedStudents.length, unresolved_student_ids: studentIds, unresolved_students: unresolvedStudents });
            req.flash("error", message);
            return res.redirect("/driver/dashboard");
        };


        const summary = {
            picked: Number(counts?.picked || 0),
            dropped: Number(counts?.dropped || 0),
            absent: Number(counts?.absent || 0),
            missed: Number(counts?.missed || 0),
            no_show: Number(counts?.no_show || 0)
        };
        console.log(`[Driver End Trip] Summary:`, summary);

        createTransportAlert(
            schoolId,
            'trip_completed',
            'Transport trip completed',
            `Trip completed. Picked: ${summary.picked}, Dropped: ${summary.dropped}, Absent: ${summary.absent}, No-show: ${summary.no_show}.`,
            { routeId: driver.route_id, tripId: transportTrip.id, vehicleId: driver.vehicle_id, createdBy: req.user.id || null }
        );

        if (isJson) {
            return res.json({ success: true, message: "Trip ended successfully.", summary });
        };
        req.flash("success", "Trip completed successfully.");
        return res.redirect("/driver/dashboard");
    } catch (err) {
        console.error("[Driver End Trip] ERROR:", err.message, err.stack);
        if (isJson) return res.status(500).json({ success: false, message: "Unable to end trip. Server error: " + err.message });
        req.flash("error", "Unable to end trip. Please try again.");
        return res.redirect("/driver/dashboard");
    };
};


exports.markStudentEvent = async (req, res) => {
    const isJson = req.xhr || req.headers.accept?.includes('json') || req.headers['content-type']?.includes('json');
    try {
        const schoolId = await resolveUserSchoolId(req.user);
        const userId = req.user.id;
        const tripId = Number(req.params.tripId);
        const studentId = Number(req.params.studentId);
        const eventType = String(req.body.event_type || "").trim();
        const latitude = req.body.latitude ? parseFloat(req.body.latitude) : null;
        const longitude = req.body.longitude ? parseFloat(req.body.longitude) : null;
        const note = String(req.body.note || req.body.remarks || "").trim() || null;

        if (!tripId || !studentId || !["pickup", "drop", "absent"].includes(eventType)) {
            if (isJson) return res.status(400).json({ success: false, message: "Invalid request." });
            req.flash("error", "Invalid request.");
            return res.redirect("/driver/dashboard");
        };

        const driver = await getDriverProfile(schoolId, userId);
        if (!driver) {
            if (isJson) return res.status(404).json({ success: false, message: "Driver profile not found." });
            req.flash("error", "Driver profile not found.");
            return res.redirect("/driver/dashboard");
        };

        await withTransaction(async ({ query }) => {
            const advancedTrip = await query(
                `SELECT id, trip_type FROM transport_trips
                WHERE id = ? AND school_id = ? AND driver_id = ? AND status = 'running'
                LIMIT 1`,
                [tripId, schoolId, driver.id]
            );

            let legacyTrip = [];
            if (!advancedTrip.length) {
                legacyTrip = await query(
                    "SELECT id FROM driver_trips WHERE id=? AND school_id=? AND driver_id=? AND status='in_progress' LIMIT 1",
                    [tripId, schoolId, driver.id]
                );
                if (!legacyTrip.length) throw new Error("Trip is not active.");
            };

            const student = await query(
                "SELECT id, class_id FROM students WHERE id=? AND school_id=? LIMIT 1",
                [studentId, schoolId]
            );
            if (!student.length) throw new Error("Student not found.");

            if (legacyTrip.length) {
                const allocations = await query(
                    `SELECT id FROM student_transport_allocations
                    WHERE school_id = ? AND student_id = ? AND route_id = ? AND status = 'active'
                    LIMIT 1`,
                    [schoolId, studentId, driver.route_id]
                );
                if (!allocations.length) throw new Error("Student is not allocated to this driver's route.");
            };

            if (advancedTrip.length) {
                const status = eventType === 'pickup' ? 'picked' : (eventType === 'drop' ? 'dropped' : 'absent');
                const tripStudents = await query(
                    `SELECT status FROM transport_trip_students
                    WHERE school_id = ? AND trip_id = ? AND student_id = ?
                    LIMIT 1 FOR UPDATE`,
                    [schoolId, advancedTrip[0].id, studentId]
                );
                if (!tripStudents.length) throw new Error("Student is not assigned to this trip.");
                if (!isAllowedStudentTransition(advancedTrip[0].trip_type, tripStudents[0].status, status)) {
                    throw new Error(`Invalid transition from ${tripStudents[0].status} to ${status} for a ${advancedTrip[0].trip_type} trip.`);
                };
                const timeColumn = eventType === 'pickup' ? 'picked_at' : (eventType === 'drop' ? 'dropped_at' : null);
                const latColumn = eventType === 'pickup' ? 'pickup_latitude' : (eventType === 'drop' ? 'drop_latitude' : null);
                const lngColumn = eventType === 'pickup' ? 'pickup_longitude' : (eventType === 'drop' ? 'drop_longitude' : null);

                let timeFieldUpdate = timeColumn ? `, ${timeColumn} = NOW()` : '';
                let latLngUpdate = latColumn ? `, ${latColumn} = ?, ${lngColumn} = ?` : '';
                let params = [status, note, userId];
                if (latColumn) {
                    params.push(latitude, longitude);
                };
                params.push(schoolId, advancedTrip[0].id, studentId);

                await query(
                    `UPDATE transport_trip_students
                    SET status = ?, remarks = COALESCE(?, remarks), updated_by = ?${timeFieldUpdate}${latLngUpdate}
                    WHERE school_id = ? AND trip_id = ? AND student_id = ?`,
                    params
                );

                await createTransportAlert(
                    schoolId,
                    eventType === 'pickup' ? 'student_picked' : (eventType === 'drop' ? 'student_dropped' : 'general'),
                    eventType === 'pickup' ? 'Student picked' : (eventType === 'drop' ? 'Student dropped' : 'Student absent'),
                    `Student #${studentId} marked ${status} by driver on ${driver.routeName || 'route'}.`,
                    { routeId: driver.route_id, tripId: advancedTrip[0].id, vehicleId: driver.vehicle_id, studentId, createdBy: userId }
                );
            } else {
                await query(
                    `INSERT INTO trip_student_events (trip_id, school_id, driver_id, student_id, event_type, latitude, longitude, event_time) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, NOW()) 
                    ON DUPLICATE KEY UPDATE latitude = VALUES(latitude), longitude = VALUES(longitude), event_time = VALUES(event_time), updatedAt = CURRENT_TIMESTAMP`,
                    [tripId, schoolId, driver.id, studentId, eventType, latitude, longitude]
                );
            };

            if (eventType === "pickup" && student[0].class_id) {
                await query(
                    `INSERT INTO attendance (school_id, student_id, class_id, date, status, marked_by, source) 
                    VALUES (?, ?, ?, CURDATE(), 'present', ?, 'transport') 
                    ON DUPLICATE KEY UPDATE status = VALUES(status), marked_by = VALUES(marked_by), source = VALUES(source)`,
                    [schoolId, studentId, student[0].class_id, userId]
                );
            };
        });

        if (isJson) {
            return res.json({ success: true, message: eventType === "pickup" ? "Student marked as boarded." : (eventType === "drop" ? "Student marked as dropped off." : "Student marked as absent.") });
        };

        req.flash("success", eventType === "pickup" ? "Student picked up." : (eventType === "drop" ? "Student dropped." : "Student marked absent."));
        return res.redirect(req.get("Referer") || "/driver/dashboard");
    } catch (err) {
        console.error("[Mark Student Event]", err);
        if (isJson) {
            return res.status(500).json({ success: false, message: "Unable to mark event." });
        };
        req.flash("error", err.message || "Unable to mark event.");
        return res.redirect(req.get("Referer") || "/driver/dashboard");
    };
};

const getOwnedTransportTrip = async (schoolId, driver, tripId) => {
    const rows = await queryAsync(
        `SELECT tt.*, r.route_name AS routeName, v.vehicle_number AS vehicleNumber
        FROM transport_trips tt
        LEFT JOIN routes r ON tt.route_id = r.id AND r.school_id = tt.school_id
        LEFT JOIN vehicles v ON tt.vehicle_id = v.id AND v.school_id = tt.school_id
        WHERE tt.id = ? AND tt.school_id = ? AND tt.driver_id = ?
        LIMIT 1`,
        [tripId, schoolId, driver.id]
    );
    return rows[0] || null;
};

exports.tripStudents = async (req, res) => {
    try {
        const schoolId = await resolveUserSchoolId(req.user);
        const driver = await getDriverProfile(schoolId, req.user.id);
        const tripId = toPositiveInt(req.params.tripId);
        
        if (!driver || !tripId) {
            req.flash("error", "Trip not found.");
            return res.redirect("/driver/dashboard");
        };

        const trip = await getOwnedTransportTrip(schoolId, driver, tripId);
        if (!trip) {
            req.flash("error", "Trip not found.");
            return res.redirect("/driver/dashboard");
        };

        const stops = await getRouteStops(schoolId, trip.route_id).catch(() => []);
        const students = await queryAsync(
            `SELECT tts.id, tts.student_id AS studentId, tts.pickup_stop_id AS pickupStopId,
                tts.drop_stop_id AS dropStopId, tts.status, tts.remarks,
                tts.picked_at AS pickedAt, tts.dropped_at AS droppedAt,
                u.first_name AS first_name, u.last_name AS last_name, s.roll_no,
                c.class_name AS className, c.section
            FROM transport_trip_students tts
            JOIN students s ON tts.student_id = s.id AND s.school_id = tts.school_id
            JOIN users u ON s.user_id = u.id
            LEFT JOIN classes c ON s.class_id = c.id
            WHERE tts.school_id = ? AND tts.trip_id = ?
            ORDER BY u.first_name, u.last_name`,
            [schoolId, tripId]
        );

        const summary = students.reduce((acc, row) => {
            acc[row.status] = (acc[row.status] || 0) + 1;
            return acc;
        }, { pending: 0, picked: 0, dropped: 0, missed: 0, absent: 0 });

        return res.render("driver/trip-students", {
            user: req.user,
            driver,
            trip,
            stops,
            students,
            summary,
            progressPercent: students.length ? Math.round(((students.length - (summary.pending || 0)) / students.length) * 100) : 0,
            driverInitials: makeInitials(driver)
        });
    } catch (err) {
        console.error("[Driver Trip Students]", err);
        req.flash("error", "Unable to load trip students.");
        return res.redirect("/driver/dashboard");
    };
};

exports.markTransportTripStudent = async (req, res) => {
    const isJson = req.xhr || req.headers.accept?.includes('json') || req.headers['content-type']?.includes('json');
    try {
        const schoolId = await resolveUserSchoolId(req.user);
        const driver = await getDriverProfile(schoolId, req.user.id);
        const tripId = toPositiveInt(req.params.tripId);
        const studentId = toPositiveInt(req.params.studentId);
        const status = String(req.body.status || "").trim();
        const note = String(req.body.note || "").trim() || null;
        const latitude = parseCoordinate(req.body.latitude);
        const longitude = parseCoordinate(req.body.longitude);

        if (!driver || !tripId || !studentId || !['picked', 'dropped', 'missed', 'absent'].includes(status)) {
            if (isJson) return res.status(400).json({ success: false, message: "Invalid marking request." });
            req.flash("error", "Invalid marking request.");
            return res.redirect("/driver/dashboard");
        };

        const trip = await getOwnedTransportTrip(schoolId, driver, tripId);
        if (!trip || trip.status !== 'running') {
            if (isJson) return res.status(404).json({ success: false, message: "Running trip not found." });
            req.flash("error", "Running trip not found.");
            return res.redirect("/driver/dashboard");
        };

        const [existingTts] = await queryAsync(
            `SELECT status FROM transport_trip_students
            WHERE school_id = ? AND trip_id = ? AND student_id = ? LIMIT 1`,
            [schoolId, tripId, studentId]
        );
        if (!existingTts) {
            if (isJson) return res.status(404).json({ success: false, message: "Student is not assigned to this trip." });
            req.flash("error", "Student is not assigned to this trip.");
            return res.redirect(`/driver/transport/trips/${tripId}/students`);
        };
        if (!isAllowedStudentTransition(trip.trip_type, existingTts.status, status)) {
            if (isJson) return res.status(400).json({ success: false, message: `Invalid ${existingTts.status} to ${status} transition for this ${trip.trip_type} trip.` });
            req.flash("error", `Cannot mark this student ${status} during a ${trip.trip_type} trip.`);
            return res.redirect(`/driver/transport/trips/${tripId}/students`);
        };

        const timeSql = status === 'picked' ? ', picked_at = NOW(), pickup_latitude = ?, pickup_longitude = ?' : status === 'dropped' ? ', dropped_at = NOW(), drop_latitude = ?, drop_longitude = ?' : ', updated_at = CURRENT_TIMESTAMP, pickup_latitude = COALESCE(?, pickup_latitude), pickup_longitude = COALESCE(?, pickup_longitude)';
        const result = await queryAsync(
            `UPDATE transport_trip_students
            SET status = ?${timeSql}, marked_at = NOW(), remarks = COALESCE(?, remarks), updated_by = ?
            WHERE school_id = ? AND trip_id = ? AND student_id = ?`,
            [status, latitude, longitude, note, req.user.id || null, schoolId, tripId, studentId]
        );

        if (!result.affectedRows) {
            if (isJson) return res.status(404).json({ success: false, message: "Student is not assigned to this trip." });
            req.flash("error", "Student is not assigned to this trip.");
            return res.redirect(`/driver/transport/trips/${tripId}/students`);
        };

        if (status === 'missed') {
            await createTransportAlert(schoolId, 'general', 'Student missed transport', `Student #${studentId} was marked missed. ${note || ''}`, { routeId: trip.route_id,tripId, vehicleId: trip.vehicle_id, studentId, createdBy: req.user.id || null});
        };

        await notifyParentsTransportStatus(schoolId, studentId, status, tripId, req.user.id || null);

        if (isJson) return res.json({ success: true, message: `Student marked ${status}.` });
        req.flash("success", `Student marked ${status}.`);
        return res.redirect(`/driver/transport/trips/${tripId}/students`);
    } catch (err) {
        console.error("[Mark Transport Trip Student]", err);
        if (isJson) return res.status(500).json({ success: false, message: "Unable to mark student." });
        req.flash("error", "Unable to mark student.");
        return res.redirect(req.get("Referer") || "/driver/dashboard");
    };
};

exports.markStopStudents = async (req, res) => {
    const isJson = req.xhr || req.headers.accept?.includes('json') || req.headers['content-type']?.includes('json');
    try {
        const schoolId = await resolveUserSchoolId(req.user);
        const driver = await getDriverProfile(schoolId, req.user.id);
        const tripId = toPositiveInt(req.params.tripId);
        const rawStopId = Number.parseInt(req.body.stopId, 10);
        const stopId = Number.isInteger(rawStopId) && rawStopId >= 0 ? rawStopId : null;
        const status = String(req.body.status || "").trim();

        if (!driver || !tripId || stopId === null || !['picked', 'dropped', 'missed', 'absent'].includes(status)) {
            if (isJson) return res.status(400).json({ success: false, message: "Invalid stop marking request." });
            req.flash("error", "Invalid stop marking request.");
            return res.redirect("/driver/dashboard");
        };

        const trip = await getOwnedTransportTrip(schoolId, driver, tripId);
        if (!trip || trip.status !== 'running') {
            if (isJson) return res.status(404).json({ success: false, message: "Running trip not found." });
            req.flash("error", "Running trip not found.");
            return res.redirect("/driver/dashboard");
        };
        if (!isAllowedStudentTransition(trip.trip_type, 'pending', status)) {
            if (isJson) return res.status(400).json({ success: false, message: `Cannot mark students ${status} during a ${trip.trip_type} trip.` });
            req.flash("error", `Cannot mark students ${status} during a ${trip.trip_type} trip.`);
            return res.redirect(`/driver/transport/trips/${tripId}/students`);
        };

        const stopColumn = trip.trip_type === 'drop' ? 'drop_stop_id' : 'pickup_stop_id';
        const timeSql = status === 'picked' ? ', picked_at = NOW()' : status === 'dropped' ? ', dropped_at = NOW()' : '';
        let affectedStudents = [];

        if (stopId === 0) { 
            affectedStudents = await queryAsync(
                `SELECT student_id
                FROM transport_trip_students
                WHERE school_id = ? AND trip_id = ? AND ${stopColumn} IS NULL AND status = 'pending'`,
                [schoolId, tripId]
            );

            await queryAsync(
                `UPDATE transport_trip_students
                SET status = ?${timeSql}, marked_at = NOW(), updated_by = ?
                WHERE school_id = ? AND trip_id = ? AND ${stopColumn} IS NULL AND status = 'pending'`,
                [status, req.user.id || null, schoolId, tripId]
            );
        } else {
            const stop = await queryAsync(
                `SELECT id FROM transport_route_stops
                WHERE id = ? AND school_id = ? AND route_id = ? AND status = 'active'
                LIMIT 1`,
                [stopId, schoolId, trip.route_id]
            );
            
            if (!stop.length) {
                if (isJson) return res.status(404).json({ success: false, message: "Stop does not belong to this route." });
                req.flash("error", "Stop does not belong to this route.");
                return res.redirect(`/driver/transport/trips/${tripId}/students`);
            };

            affectedStudents = await queryAsync(
                `SELECT student_id
                FROM transport_trip_students
                WHERE school_id = ? AND trip_id = ? AND ${stopColumn} = ? AND status = 'pending'`,
                [schoolId, tripId, stopId]
            );

            await queryAsync(
                `UPDATE transport_trip_students
                SET status = ?${timeSql}, marked_at = NOW(), updated_by = ?
                WHERE school_id = ? AND trip_id = ? AND ${stopColumn} = ? AND status = 'pending'`,
                [status, req.user.id || null, schoolId, tripId, stopId]
            );
        };

        for (const row of affectedStudents) {
            await notifyParentsTransportStatus(schoolId, row.student_id, status, tripId, req.user.id || null);
        };

        req.flash("success", "Stop students updated.");
        if (isJson) return res.json({ success: true, message: "Stop students updated.", affectedCount: affectedStudents.length });
        return res.redirect(`/driver/transport/trips/${tripId}/students`);
    } catch (err) {
        console.error("[Mark Stop Students]", err);
        if (isJson) return res.status(500).json({ success: false, message: "Unable to update stop students." });
        req.flash("error", "Unable to update stop students.");
        return res.redirect(req.get("Referer") || "/driver/dashboard");
    };
};

exports.reportIssueForm = async (req, res) => {
    try {
        const schoolId = await resolveUserSchoolId(req.user);
        const driver = await getDriverProfile(schoolId, req.user.id);
        const activeTransportTrip = driver ? await getActiveTransportTrip(schoolId, driver.id).catch(() => null) : null;
        
        return res.render("driver/report-issue", { user: req.user, driver, activeTransportTrip, driverInitials: makeInitials(driver)});
    } catch (err) {
        console.error("[Driver Issue Form]", err);
        req.flash("error", "Unable to load issue form.");
        return res.redirect("/driver/dashboard");
    };
};

exports.reportIssue = async (req, res) => {
    try {
        const schoolId = await resolveUserSchoolId(req.user);
        const driver = await getDriverProfile(schoolId, req.user.id);
        
        if (!driver) {
            req.flash("error", "Driver profile not found.");
            return res.redirect("/driver/dashboard");
        };

        const issueType = String(req.body.alertType || "other").trim();
        const severity = String(req.body.severity || "normal").trim();
        const title = String(req.body.title || "").trim();
        const details = String(req.body.message || "").trim();
        const relatedType = String(req.body.relatedType || "").trim();
        const relatedId = toPositiveInt(req.body.relatedId);
        const activeTransportTrip = await getActiveTransportTrip(schoolId, driver.id).catch(() => null);

        if (!title || !details) {
            req.flash("error", "Title and details are required.");
            return res.redirect("/driver/transport/report-issue");
        };

        const alertTypeMap = {
            vehicle: 'vehicle_issue',
            route: 'route_change',
            student: 'general',
            delay: 'delay',
            driver: 'general',
            other: 'general'
        };

        await createTransportAlert(
            schoolId,
            alertTypeMap[issueType] || 'general',
            title,
            `Severity: ${severity}\nIssue Type: ${issueType}\nRelated: ${relatedType || 'none'} ${relatedId || ''}\n\n${details}`,
            {
                routeId: driver.route_id || null,
                tripId: activeTransportTrip?.id || null,
                vehicleId: driver.vehicle_id || null,
                createdBy: req.user.id || null
            }
        );

        req.flash("success", "Issue reported to transport admin.");
        return res.redirect("/driver/dashboard");
    } catch (err) {
        console.error("[Driver Report Issue]", err);
        req.flash("error", "Unable to report issue.");
        return res.redirect("/driver/transport/report-issue");
    };
};

exports.notices = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const sql = `
            SELECT 
                n.title, 
                n.content AS message, 
                n.target_type,
                n.notice_type,
                n.priority,
                n.created_at,
                u.first_name AS first_name, 
                u.last_name AS last_name, 
                u.role AS sender_role
            FROM notices n
            LEFT JOIN users u ON n.created_by = u.id
            WHERE n.school_id = ?
                AND n.is_active = TRUE
                AND (n.target_type = 'all' OR n.target_type = 'drivers')
                AND (n.expiry_date IS NULL OR n.expiry_date > NOW())
            ORDER BY n.created_at DESC
        `;

        const rows = await queryAsync(sql, [schoolId]);
        res.render('driver/notices', {  notices: rows,  user: req.user, page: 'notices' });
    } catch (error) {
        console.error('[Driver Notices] Error:', error);
        return res.status(500).json({ success: false, message: 'Failed to fetch notices' });
    };
};

const markStudentStatus = async (req, res, targetStatus) => {
    const isJson = req.xhr || req.headers.accept?.includes('json') || req.headers['content-type']?.includes('json');
    try {
        const schoolId = await resolveUserSchoolId(req.user);
        const userId = req.user.id;
        const studentId = Number(req.params.studentId);
        const latitude = req.body.latitude ? parseFloat(req.body.latitude) : null;
        const longitude = req.body.longitude ? parseFloat(req.body.longitude) : null;
        const note = String(req.body.note || req.body.remarks || "").trim() || null;

        if (!studentId || !['picked', 'dropped', 'absent'].includes(targetStatus)) {
            if (isJson) return res.status(400).json({ success: false, message: "Invalid request." });
            req.flash("error", "Invalid request.");
            return res.redirect("/driver/dashboard");
        };

        const driver = await getDriverProfile(schoolId, userId);
        if (!driver) {
            if (isJson) return res.status(404).json({ success: false, message: "Driver profile not found." });
            req.flash("error", "Driver profile not found.");
            return res.redirect("/driver/dashboard");
        };

        const activeTrip = await getActiveTransportTrip(schoolId, driver.id);
        if (!activeTrip) {
            if (isJson) return res.status(400).json({ success: false, message: "No active running trip found." });
            req.flash("error", "No active running trip found. Start a trip first.");
            return res.redirect("/driver/dashboard");
        };

        if (!activeTrip.id || !studentId) {
            return res.status(400).json({ success: false, message: "Active trip or student not found." });
        };

        if (targetStatus === 'picked' && activeTrip.trip_type !== 'pickup') {
            if (isJson) return res.status(400).json({ success: false, message: "Cannot board students during a drop trip." });
            req.flash("error", "Cannot board students during a drop trip.");
            return res.redirect("/driver/dashboard");
        };
        if (targetStatus === 'dropped' && activeTrip.trip_type !== 'drop') {
            if (isJson) return res.status(400).json({ success: false, message: "Cannot drop students during a pickup trip." });
            req.flash("error", "Cannot drop students during a pickup trip.");
            return res.redirect("/driver/dashboard");
        };

        const [currentRecord] = await queryAsync(
            `SELECT status FROM transport_trip_students
            WHERE school_id = ? AND trip_id = ? AND student_id = ? LIMIT 1`,
            [schoolId, activeTrip.id, studentId]
        );
        if (!currentRecord) {
            if (isJson) return res.status(404).json({ success: false, message: "Student is not assigned to this trip." });
            req.flash("error", "Student is not assigned to this trip.");
            return res.redirect("/driver/dashboard");
        };
        if (!isAllowedStudentTransition(activeTrip.trip_type, currentRecord.status, targetStatus)) {
            if (isJson) return res.status(400).json({ success: false, message: `Invalid ${currentRecord.status} to ${targetStatus} transition for this ${activeTrip.trip_type} trip.` });
            req.flash("error", `Cannot mark this student ${targetStatus} during a ${activeTrip.trip_type} trip.`);
            return res.redirect("/driver/dashboard");
        };

        const [allocation] = await queryAsync(
            `SELECT id FROM student_transport_allocations
            WHERE school_id = ? AND student_id = ? AND route_id = ? AND status = 'active'`,
            [schoolId, studentId, activeTrip.route_id]
        );
        if (!allocation) {
            if (isJson) return res.status(403).json({ success: false, message: "Student is not allocated to this route." });
            req.flash("error", "Student is not allocated to this route.");
            return res.redirect("/driver/dashboard");
        };

        const updateFields = [
            "status = ?",
            "marked_at = NOW()",
            "remarks = COALESCE(?, remarks)",
            "updated_by = ?"
        ];

        const updateParams = [
            targetStatus,
            note,
            userId
        ];

        if (targetStatus === "picked") {
            updateFields.push("picked_at = NOW()");
            if (latitude !== null && longitude !== null) {
                updateFields.push("pickup_latitude = ?", "pickup_longitude = ?");
                updateParams.push(latitude, longitude);
            };
        };

        if (targetStatus === "dropped") {
            updateFields.push("dropped_at = NOW()");
            if (latitude !== null && longitude !== null) {
                updateFields.push("drop_latitude = ?", "drop_longitude = ?");
                updateParams.push(latitude, longitude);
            };
        };

        updateParams.push(
            schoolId,
            activeTrip.id,
            studentId
        );

        const updateResult = await queryAsync(
            `UPDATE transport_trip_students
            SET ${updateFields.join(", ")}
            WHERE school_id = ?
                AND trip_id = ?
                AND student_id = ?`,
            updateParams
        );

        if (!updateResult.affectedRows) {
            if (isJson) return res.status(404).json({ success: false, message: "Student trip record not found." });
            req.flash("error", "Student trip record not found.");
            return res.redirect("/driver/dashboard");
        };

        await createTransportAlert(
            schoolId,
            targetStatus === 'picked' ? 'student_picked' : (targetStatus === 'dropped' ? 'student_dropped' : 'general'),
            targetStatus === 'picked' ? 'Student picked' : (targetStatus === 'dropped' ? 'Student dropped' : 'Student absent'),
            `Student #${studentId} marked ${targetStatus} by driver on ${driver.routeName || 'route'}.`,
            { routeId: driver.route_id, tripId: activeTrip.id, vehicleId: driver.vehicle_id, studentId, createdBy: userId }
        );

        await notifyParentsTransportStatus(schoolId, studentId, targetStatus, activeTrip.id, userId);

        if (targetStatus === 'picked') {
            const student = await queryAsync(
                "SELECT class_id FROM students WHERE id=? AND school_id=? LIMIT 1",
                [studentId, schoolId]
            );
            if (student[0]?.class_id) {
                await queryAsync(
                    `INSERT INTO attendance (school_id, student_id, class_id, date, status, marked_by, source)
                     VALUES (?, ?, ?, CURDATE(), 'present', ?, 'transport')
                     ON DUPLICATE KEY UPDATE status = VALUES(status), marked_by = VALUES(marked_by), source = VALUES(source)`,
                    [schoolId, studentId, student[0].class_id, userId]
                );
            };
        };

        const [updatedRecord] = await queryAsync(
            "SELECT status FROM transport_trip_students WHERE school_id = ? AND trip_id = ? AND student_id = ? LIMIT 1",
            [schoolId, activeTrip.id, studentId]
        );
        const finalStatus = updatedRecord?.status || targetStatus;

        if (isJson) {
            return res.json({
                success: true,
                message: `Student marked as ${finalStatus === 'picked' ? 'picked' : finalStatus === 'dropped' ? 'dropped' : 'absent'}.`,
                status: finalStatus
            });
        };

        const labels = { picked: "boarded", dropped: "dropped off", absent: "absent" };
        req.flash("success", `Student marked as ${labels[finalStatus] || finalStatus}.`);
        return res.redirect(req.get("Referer") || "/driver/dashboard");
    } catch (err) {
        console.error(`[Mark Student ${targetStatus}]`, err);
        if (isJson) return res.status(500).json({ success: false, message: "Failed to mark student status." });
        req.flash("error", err.message || "Failed to mark student status.");
        return res.redirect("/driver/dashboard");
    };
};

exports.boardStudent = (req, res) => markStudentStatus(req, res, 'picked');
exports.dropStudent = (req, res) => markStudentStatus(req, res, 'dropped');
exports.absentStudent = (req, res) => markStudentStatus(req, res, 'absent');

exports.triggerSOS = async (req, res) => {
    try {
        const schoolId = await resolveUserSchoolId(req.user);
        const driver = await getDriverProfile(schoolId, req.user.id);

        if (!driver) {
            return res.status(403).json({ success: false, message: 'Driver profile not found.' });
        };

        const lat = req.body.lat ? parseFloat(req.body.lat) : null;
        const lng = req.body.lng ? parseFloat(req.body.lng) : null;
        const activeTrip = await getActiveTransportTrip(schoolId, driver.id).catch(() => null);

        const locationText = (lat && lng)
            ? `GPS: ${lat.toFixed(5)}, ${lng.toFixed(5)} — https://maps.google.com/?q=${lat},${lng}`
            : 'GPS location not available';

        const sosTitle = `🚨 SOS EMERGENCY — ${driver.first_name} ${driver.last_name}`;
        const sosMessage = [
            `Driver: ${driver.first_name} ${driver.last_name}`,
            `Vehicle: ${driver.vehicleNumber || 'Unknown'}`,
            `Route: ${driver.routeName || 'Unknown'}`,
            `${locationText}`,
            activeTrip ? `Active trip ID: ${activeTrip.id} (${activeTrip.trip_type})` : 'No active trip'
        ].join('\n');

        await createTransportAlert(
            schoolId,
            'vehicle_issue',
            sosTitle,
            sosMessage,
            {
                routeId: driver.route_id || null,
                tripId: activeTrip?.id || null,
                vehicleId: driver.vehicle_id || null,
                createdBy: req.user.id
            }
        );

        try {
            const { getIO } = require('../../config/socket');
            const io = getIO();
            io.to(`school:${schoolId}`).emit('transport_sos', {
                driverName: `${driver.first_name} ${driver.last_name}`,
                vehicleNumber: driver.vehicleNumber || '',
                routeName: driver.routeName || '',
                lat,
                lng,
                tripId: activeTrip?.id || null,
                timestamp: new Date().toISOString()
            });
        } catch (socketErr) {
            console.error('[SOS Socket emit error]', socketErr.message);
        };

        try {
            const NotificationService = require('../../services/notificationService');

            const [admins] = await require('../../config/database').query(
                `SELECT u.id FROM users u
                 JOIN schools s ON u.school_id = s.id
                 WHERE u.school_id = ? AND u.role = 'school_admin' AND u.status = 'active'
                 LIMIT 10`,
                [schoolId]
            );

            for (const admin of admins) {
                await NotificationService.createAndSend({
                    recipient_id: admin.id,
                    recipient_role: 'school_admin',
                    school_id: schoolId,
                    title: sosTitle,
                    message: `Driver ${driver.first_name} ${driver.last_name} sent an emergency SOS alert. ${locationText}`,
                    type: 'alert',
                    category: 'transport',
                    reference_type: 'transport_alert',
                    reference_id: null,
                    created_by: req.user.id,
                    action_url: '/schooladmin/transport/alerts'
                }).catch(e => console.error('[SOS notify admin]', e.message));
            };
        } catch (notifErr) {
            console.error('[SOS notification error]', notifErr.message);
        };

        return res.json({ success: true, message: 'SOS alert sent to school administration.' });
    } catch (err) {
        console.error('[triggerSOS]', err);
        return res.status(500).json({ success: false, message: 'Failed to send SOS alert.' });
    };
};

exports.notifyParentOnBoard = async (req, res) => {
    try {
        const schoolId = await resolveUserSchoolId(req.user);
        const tripId = Number(req.params.tripId);
        const studentId = Number(req.params.studentId);
        const eventType = String(req.body.event_type || 'pickup').trim();

        if (!tripId || !studentId) {
            return res.status(400).json({ success: false, message: 'Invalid trip or student.' });
        }

        const driver = await getDriverProfile(schoolId, req.user.id);
        const trip = driver ? await getOwnedTransportTrip(schoolId, driver, tripId) : null;
        if (!trip || trip.status !== 'running') {
            return res.status(403).json({ success: false, message: 'Running trip is not assigned to this driver.' });
        };

        const [studentRows] = await require('../../config/database').query(
            `SELECT s.id, u.first_name, u.last_name,
                    c.class_name, c.section,
                    ps.stop_name AS pickupStopName,
                    ds.stop_name AS dropStopName
             FROM students s
             JOIN users u ON s.user_id = u.id
             LEFT JOIN classes c ON s.class_id = c.id
             JOIN transport_trip_students tts ON tts.student_id = s.id AND tts.trip_id = ? AND tts.school_id = s.school_id
             LEFT JOIN student_transport_allocations sta ON sta.student_id = s.id AND sta.school_id = s.school_id AND sta.status = 'active'
             LEFT JOIN transport_route_stops ps ON sta.pickup_stop_id = ps.id AND ps.school_id = s.school_id
             LEFT JOIN transport_route_stops ds ON sta.drop_stop_id = ds.id AND ds.school_id = s.school_id
             WHERE s.id = ? AND s.school_id = ? AND s.deleted_at IS NULL
             LIMIT 1`,
            [tripId, studentId, schoolId]
        );

        const student = studentRows[0];
        if (!student) {
            return res.status(404).json({ success: false, message: 'Student not found.' });
        }

        const [parentRows] = await require('../../config/database').query(
            `SELECT DISTINCT u.id AS parent_user_id
             FROM student_family sf
             JOIN users u ON sf.parent_user_id = u.id
             WHERE sf.student_id = ?
                AND sf.school_id = ?
                AND sf.parent_user_id IS NOT NULL
                AND u.status = 'active'
             LIMIT 5`,
            [studentId, schoolId]
        );

        if (!parentRows.length) {
            return res.json({ success: true, message: 'No parent linked — notification skipped.' });
        }

        const NotificationService = require('../../services/notificationService');
        const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

        const isPickup = eventType === 'pickup';
        const stopName = isPickup ? student.pickupStopName : student.dropStopName;
        const title = isPickup
            ? `${student.first_name} has boarded the bus`
            : `${student.first_name} has been dropped off`;
        const message = isPickup
            ? `${student.first_name} ${student.last_name} boarded the school bus at ${stopName || 'their stop'} at ${now}.`
            : `${student.first_name} ${student.last_name} was dropped off at ${stopName || 'their stop'} at ${now}.`;

        for (const parent of parentRows) {
            await NotificationService.createAndSend({
                recipient_id: parent.parent_user_id,
                recipient_role: 'parent',
                school_id: schoolId,
                title,
                message,
                type: 'info',
                category: 'transport',
                reference_type: 'transport_trip',
                reference_id: tripId,
                created_by: req.user.id,
                action_url: '/parent/transport'
            }).catch(e => console.error('[notifyParentOnBoard]', e.message));
        }

        return res.json({ success: true, message: 'Parent notified.' });
    } catch (err) {
        console.error('[notifyParentOnBoard]', err);
        return res.status(500).json({ success: false, message: 'Failed to notify parent.' });
    }
};

const calculateDistanceKm = (lat1, lng1, lat2, lng2) => {
    if (!Number.isFinite(lat1) || !Number.isFinite(lng1) || !Number.isFinite(lat2) || !Number.isFinite(lng2)) {
        return null;
    }
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

exports.updateLocationREST = async (req, res) => {
    try {
        const schoolId = await resolveUserSchoolId(req.user);
        const lat = parseFloat(req.body.latitude);
        const lng = parseFloat(req.body.longitude);
        const speed = parseFloat(req.body.speed) || 0;
        const heading = req.body.heading !== undefined && req.body.heading !== null ? parseFloat(req.body.heading) : null;
        const accuracy = req.body.accuracy !== undefined && req.body.accuracy !== null ? parseFloat(req.body.accuracy) : null;

        if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            return res.status(400).json({ success: false, message: 'Invalid coordinates.' });
        }

        const driver = await getDriverProfile(schoolId, req.user.id);
        if (!driver) return res.status(403).json({ success: false, message: 'Driver not found.' });

        const activeTrip = await getActiveTransportTrip(schoolId, driver.id).catch(() => null);
        if (!activeTrip) return res.json({ success: false, message: 'No running trip.' });

        if (activeTrip.driver_id !== driver.id || activeTrip.school_id !== schoolId) {
            return res.status(403).json({ success: false, message: 'Access denied: trip ownership validation failed.' });
        }

        const db = require('../../config/database');
        await db.query(
            `INSERT INTO transport_trip_locations
             (school_id, trip_id, vehicle_id, driver_id, latitude, longitude, speed, heading, accuracy, recorded_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [schoolId, activeTrip.id, driver.vehicle_id || null, driver.id, lat, lng, speed, Number.isFinite(heading) ? heading : null, Number.isFinite(accuracy) ? accuracy : null]
        );

        try {
            const students = await getAdvancedStudents(schoolId, activeTrip.route_id).catch(() => []);
            const eventMap = await getEventMap(activeTrip.id).catch(() => ({}));
            
            for (const student of students) {
                const statusState = eventMap[student.id];
                const status = statusState ? statusState.status : 'pending';

                if (status === 'pending' || status === 'waiting') {
                    const isDropTrip = activeTrip.trip_type === 'drop';
                    const stopLat = isDropTrip ? student.dropStopLatitude : student.pickupStopLatitude;
                    const stopLng = isDropTrip ? student.dropStopLongitude : student.pickupStopLongitude;

                    const studentLat = Number.isFinite(Number(stopLat)) ? Number(stopLat) : null;
                    const studentLng = Number.isFinite(Number(stopLng)) ? Number(stopLng) : null;

                    if (studentLat !== null && studentLng !== null) {
                        const dist = calculateDistanceKm(lat, lng, studentLat, studentLng);
                        if (dist !== null && dist <= 5.0) {
                            const [notifiedRows] = await db.query(
                                "SELECT id FROM transport_proximity_notifications WHERE trip_id = ? AND student_id = ? AND notification_type = 'proximity_5km' AND threshold_km = 5.0 LIMIT 1",
                                [activeTrip.id, student.id]
                            );
                            
                            if (notifiedRows.length === 0) {
                                await db.query(
                                    `INSERT IGNORE INTO transport_proximity_notifications 
                                     (school_id, trip_id, student_id, notification_type, threshold_km, distance_km)
                                     VALUES (?, ?, ?, ?, ?, ?)`,
                                    [schoolId, activeTrip.id, student.id, 'proximity_5km', 5.0, dist]
                                );

                                const [parentsRows] = await db.query(
                                    `SELECT DISTINCT u.id AS parentUserId
                                     FROM student_family sf
                                     JOIN users u ON sf.parent_user_id = u.id
                                     WHERE sf.student_id = ? AND sf.school_id = ? AND sf.parent_user_id IS NOT NULL AND u.status = 'active'`,
                                     [student.id, schoolId]
                                );

                                let NotificationService = null;
                                try {
                                    NotificationService = require('../../services/notificationService');
                                } catch (_) {}

                                const title = 'Bus Proximity Alert';
                                const message = `Bus is near ${student.first_name} ${student.last_name}'s pickup point. It is within 5 km.`;

                                console.log('[Proximity Alert]', { student_id: student.id, distance: dist, message });

                                if (parentsRows.length > 0 && NotificationService) {
                                    for (const p of parentsRows) {
                                        await NotificationService.createAndSend({
                                            recipient_id: p.parentUserId,
                                            recipient_role: 'parent',
                                            school_id: schoolId,
                                            title,
                                            message,
                                            type: 'info',
                                            category: 'transport',
                                            reference_type: 'transport_trip',
                                            reference_id: activeTrip.id
                                        }).catch(e => console.error('[Proximity Notification Error]', e.message));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch (proxErr) {
            console.error('[Proximity check error]', proxErr);
        }

        // Also broadcast via socket if available
        try {
            const { getIO } = require('../../config/socket');
            getIO().to(`trip:${activeTrip.id}`).emit('location_updated', {
                trip_id: activeTrip.id, latitude: lat, longitude: lng, speed,
                routeName: driver.routeName || '',
                vehicleNumber: driver.vehicleNumber || '',
                timestamp: new Date().toISOString()
            });
            getIO().to(`school:${schoolId}:trips`).emit('school_trip_location_updated', {
                trip_id: activeTrip.id, latitude: lat, longitude: lng, speed,
                routeName: driver.routeName || '', vehicleNumber: driver.vehicleNumber || '',
                timestamp: new Date().toISOString()
            });
        } catch (_) { /* socket not available */ }

        return res.json({ success: true });
    } catch (err) {
        console.error('[updateLocationREST]', err);
        return res.status(500).json({ success: false });
    }
};

exports.liveTrip = async (req, res) => {
    try {
        const schoolId = await resolveUserSchoolId(req.user);
        const driver = await getDriverProfile(schoolId, req.user.id);
    
        if (!driver) {
            const isJson = req.xhr || req.headers.accept?.includes('json') || req.headers['content-type']?.includes('json');
            if (isJson) return res.status(404).json({ success: false, message: "Driver not linked with this user." });
            req.flash("error", "Driver not linked with this user.");
            return res.redirect("/login");
        }

        const schoolLocRows = await queryAsync(
            "SELECT latitude, longitude FROM schools WHERE id = ? LIMIT 1",
            [schoolId]
        ).catch(() => []);
        const schoolLocation = schoolLocRows[0] || null;

        const activeTrip = await getActiveTrip(schoolId, driver.id);
        const activeTransportTrip = await getActiveTransportTrip(schoolId, driver.id).catch(() => null);

        const routeStops = driver.route_id ? await queryAsync(`
            SELECT id, stop_name, stop_order AS sequence_number, latitude, longitude, pickup_time, drop_time
            FROM transport_route_stops
            WHERE school_id = ? AND route_id = ? AND status = 'active'
            ORDER BY stop_order ASC
        `, [schoolId, driver.route_id]).catch(() => []) : [];

        const isDropTrip = activeTrip && activeTrip.trip_type === 'drop';
        let students = [];
        if (activeTrip && activeTrip.id) {
            students = await queryAsync(`
                SELECT tts.id AS tripStudentId, tts.student_id AS id, tts.status, tts.remarks,
                    tts.picked_at, tts.dropped_at, tts.marked_at, tts.pickup_stop_id AS pickupStopId,
                    tts.drop_stop_id AS dropStopId, u.first_name, u.last_name, s.roll_no,
                    c.class_name AS className, c.section,
                    ps.stop_name AS pickupStopName, ps.latitude AS pickupStopLatitude, ps.longitude AS pickupStopLongitude, ps.pickup_time AS pickupTime,
                    ds.stop_name AS dropStopName, ds.latitude AS dropStopLatitude, ds.longitude AS dropStopLongitude, ds.drop_time AS dropTime,
                    COALESCE(sf.father_phone, sf.mother_phone, sf.guardian_phone, u.phone, '—') AS parentPhone
                FROM transport_trip_students tts
                JOIN students s ON tts.student_id = s.id AND s.school_id = tts.school_id
                JOIN users u ON s.user_id = u.id
                LEFT JOIN classes c ON s.class_id = c.id
                LEFT JOIN student_family sf ON sf.student_id = s.id
                LEFT JOIN transport_route_stops ps ON tts.pickup_stop_id = ps.id AND ps.school_id = tts.school_id
                LEFT JOIN transport_route_stops ds ON tts.drop_stop_id = ds.id AND ds.school_id = tts.school_id
                WHERE tts.school_id = ? AND tts.trip_id = ? AND s.deleted_at IS NULL
                ORDER BY u.first_name ASC, u.last_name ASC
            `, [schoolId, activeTrip.id]).catch(() => []);
        } else if (driver.route_id) {
            students = await queryAsync(`
                SELECT NULL AS tripStudentId, s.id, 'pending' AS status, NULL AS remarks,
                    NULL AS picked_at, NULL AS dropped_at, NULL AS marked_at, sta.pickup_stop_id AS pickupStopId,
                    sta.drop_stop_id AS dropStopId, u.first_name, u.last_name, s.roll_no,
                    c.class_name AS className, c.section,
                    ps.stop_name AS pickupStopName, ps.latitude AS pickupStopLatitude, ps.longitude AS pickupStopLongitude, ps.pickup_time AS pickupTime,
                    ds.stop_name AS dropStopName, ds.latitude AS dropStopLatitude, ds.longitude AS dropStopLongitude, ds.drop_time AS dropTime,
                    COALESCE(sf.father_phone, sf.mother_phone, sf.guardian_phone, u.phone, '—') AS parentPhone
                FROM student_transport_allocations sta
                JOIN students s ON sta.student_id = s.id AND s.school_id = sta.school_id
                JOIN users u ON s.user_id = u.id
                LEFT JOIN classes c ON s.class_id = c.id
                LEFT JOIN student_family sf ON sf.student_id = s.id
                LEFT JOIN transport_route_stops ps ON sta.pickup_stop_id = ps.id AND ps.school_id = sta.school_id
                LEFT JOIN transport_route_stops ds ON sta.drop_stop_id = ds.id AND ds.school_id = sta.school_id
                WHERE sta.school_id = ? AND sta.route_id = ? AND sta.status = 'active' AND s.deleted_at IS NULL
                ORDER BY u.first_name ASC, u.last_name ASC
            `, [schoolId, driver.route_id]).catch(() => []);
        }

        const eventMap = {};
        let pickedUpCount = 0, droppedCount = 0;
        students.forEach(s => {
            eventMap[s.id] = {
                status: s.status || 'pending',
                remarks: s.remarks || '',
                pickedUp: s.status === 'picked',
                dropped: s.status === 'dropped'
            };
            if (s.status === 'picked') pickedUpCount++;
            if (s.status === 'dropped') droppedCount++;
        });

        const checklistDone = driver.vehicle_id ? await getChecklistStatus(schoolId, driver.vehicle_id, driver.id).catch(() => false) : false;
        const pickupTripStatus = await getTodayTransportTripByType(schoolId, driver.id, 'pickup').catch(() => null);
        const dropTripStatus = await getTodayTransportTripByType(schoolId, driver.id, 'drop').catch(() => null);

        const latestLocationRows = activeTrip ? await queryAsync(
            "SELECT latitude, longitude, speed, heading, accuracy FROM transport_trip_locations WHERE trip_id = ? ORDER BY id DESC LIMIT 1",
            [activeTrip.id]
        ).catch(() => []) : [];
        let latestDriverLocation = latestLocationRows[0] || null;

        if (!latestDriverLocation && driver && driver.id) {
            const fallbackLocationRows = await queryAsync(
                "SELECT latitude, longitude, speed, heading, accuracy FROM transport_trip_locations WHERE driver_id = ? ORDER BY id DESC LIMIT 1",
                [driver.id]
            ).catch(() => []);
            if (fallbackLocationRows.length > 0) {
                latestDriverLocation = fallbackLocationRows[0];
            }
        }

        const stopGroups = {};
        routeStops.forEach(stop => {
            stopGroups[stop.id] = {
                stop,
                students: []
            };
        });

        students.forEach(student => {
            const stopId = isDropTrip ? student.dropStopId : student.pickupStopId;
            if (stopId && stopGroups[stopId]) {
                stopGroups[stopId].students.push(student);
            } else {
                if (!stopGroups['unassigned']) {
                    stopGroups['unassigned'] = {
                        stop: { id: 'unassigned', stop_name: isDropTrip ? 'Unassigned Drop Stop' : 'Unassigned Pickup Stop', latitude: null, longitude: null, stop_order: 999 },
                        students: []
                    };
                }
                stopGroups['unassigned'].students.push(student);
            }
        });

        const isJson = req.xhr || req.headers.accept?.includes('json') || req.headers['content-type']?.includes('json');
        if (isJson) {
            return res.json({
                success: true,
                activeTrip: activeTrip || null,
                vehicle: {
                    id: driver.vehicle_id,
                    vehicle_number: driver.vehicleNumber,
                    model: driver.vehicleModel,
                    capacity: driver.capacity
                },
                route: {
                    id: driver.route_id,
                    route_name: driver.routeName,
                    start_point: driver.startPoint,
                    end_point: driver.endPoint
                },
                routeStops,
                students,
                stopGroups,
                latestDriverLocation: latestDriverLocation || null
            });
        }

        res.render("driver/live-trip", {
            user: req.user,
            driver,
            activeTrip: activeTrip || null,
            activeTransportTrip,
            students: students || [],
            eventMap: eventMap || {},
            routeStops,
            studentMarkers: [],
            latestDriverLocation,
            tripStudents: students || [],
            nextStop: routeStops[0] || null,
            checklistDone,
            pickupTripStatus,
            dropTripStatus,
            totalStudents: students?.length || 0,
            pickedUpCount,
            droppedCount,
            driverInitials: makeInitials(driver),
            schoolLocation,
            stopGroups
        });
    } catch (err) {
        console.error("LIVE TRIP ERROR:", err);
        const isJson = req.xhr || req.headers.accept?.includes('json') || req.headers['content-type']?.includes('json');
        if (isJson) {
            return res.status(500).json({ success: false, message: "Internal server error." });
        }
        return res.status(500).render("errors/500", { 
            title: "500 - Internal Server Error", 
            message: "An unexpected error occurred. Please try again later.", 
            errorCode: "500" 
        });
    }
};

exports.markStudentStatusNoTripId = async (req, res) => {
    try {
        const schoolId = await resolveUserSchoolId(req.user);
        const driver = await getDriverProfile(schoolId, req.user.id);
        if (!driver) {
            return res.status(404).json({ success: false, message: 'Driver not found.' });
        };

        const activeTrip = await getActiveTransportTrip(schoolId, driver.id);
        if (!activeTrip) {
            return res.status(400).json({ success: false, message: 'No running trip found.' });
        };
        
        req.params.tripId = activeTrip.id;
        
        if (req.body.status === 'boarded') {
            req.body.status = 'picked';
        };
        
        return exports.markTransportTripStudent(req, res);
    } catch (err) {
        console.error('[markStudentStatusNoTripId Error]', err);
        return res.status(500).json({ success: false, message: "Failed to update student status." });
    };
};

exports._test = Object.freeze({ isAllowedStudentTransition, unresolvedTripStudentStatuses });