const { queryAsync } = require("../../config/database");

const resolveDriverSchoolId = async (user) => {
    if (user.school_id) return user.school_id;

    const rows = await queryAsync(
        "SELECT school_id FROM drivers WHERE user_id = ? ORDER BY id DESC LIMIT 1",
        [user.id]
    );
    return rows[0]?.school_id || null;
};

const getDriverProfile = async (schoolId, userId) => {
    const rows = await queryAsync(`
        SELECT d.*,
            v.id AS vehicle_id, 
            v.vehicle_number AS vehicleNumber, 
            v.model AS vehicleModel, 
            v.capacity,
            r.id AS route_id, 
            r.route_name AS routeName, 
            r.start_point AS startPoint, 
            r.end_point AS endPoint, 
            COALESCE(r.school_shift, 'full_day') AS routeShift
        FROM drivers d
        JOIN users u ON u.email = d.email
        LEFT JOIN routes r ON r.driver_id = d.id AND r.school_id = d.school_id AND r.status = 'active'
        LEFT JOIN driver_vehicle_assign dva ON dva.driver_id = d.id AND dva.is_active = 1
        LEFT JOIN vehicles v ON v.id = COALESCE(dva.vehicle_id, r.vehicle_id) AND v.school_id = d.school_id
        WHERE d.school_id = ? AND u.id = ?
        LIMIT 1
    `, [schoolId, userId]);

    return rows[0] || null;
};

const getActiveTrip = async (schoolId, driverId) => {
    const rows = await queryAsync(`
        SELECT id, school_id, driver_id, route_id, vehicle_id, trip_date, 
            start_at, end_at, 'in_progress' AS status, trip_type, 
            COALESCE(trip_shift, 'full_day') AS trip_shift, created_at
        FROM transport_trips
        WHERE school_id = ? 
            AND driver_id = ? 
            AND trip_date = CURDATE() 
            AND status = 'running'
        ORDER BY id DESC 
        LIMIT 1
    `, [schoolId, driverId]);

    if (rows[0]) return rows[0];
    const legacyRows = await queryAsync(`
        SELECT * FROM driver_trips
        WHERE school_id = ? 
            AND driver_id = ? 
            AND trip_date = CURDATE() 
            AND status = 'in_progress'
        ORDER BY id DESC 
        LIMIT 1
    `, [schoolId, driverId]);

    return legacyRows[0] || null;
};

const noDriver = (driver, req, res) => {
    if (!driver) {
        req.flash("error", "Driver profile not found.");
        res.redirect("/driver/dashboard");
        return true;
    };
    return false;
};

const makeInitials = (driver) => ((driver?.first_name?.charAt(0) || "") + (driver?.last_name?.charAt(0) || "")).toUpperCase();
exports.myRoute = async (req, res) => {
    try {
        const schoolId = await resolveDriverSchoolId(req.user);
        const driver = await getDriverProfile(schoolId, req.user.id);

        if (noDriver(driver, req, res)) return;
        const activeTrip = await getActiveTrip(schoolId, driver.id);

        const routeStops = driver.route_id ? await queryAsync(`
            SELECT id, stop_name AS stopName, stop_address AS stopAddress,
                pickup_time AS pickupTime, drop_time AS dropTime, stop_order AS stopOrder
            FROM transport_route_stops
            WHERE school_id = ? AND route_id = ? AND status = 'active'
            ORDER BY stop_order ASC
        `, [schoolId, driver.route_id]) : [];

        const students = driver.route_id ? await queryAsync(`
            SELECT sta.id AS allocationId, sta.pickup_stop_id AS pickupStopId, sta.drop_stop_id AS dropStopId,
                s.id, u.first_name, u.last_name, s.roll_no,
                c.class_name AS className, c.section,
                COALESCE(sf.father_phone, sf.mother_phone, sf.guardian_phone, sat.emergency_contact, u.phone, '—') AS parentPhone,
                tts.status AS tripStatus
            FROM student_transport_allocations sta
            JOIN students s ON sta.student_id = s.id AND s.school_id = sta.school_id
            JOIN users u ON s.user_id = u.id
            LEFT JOIN classes c ON s.class_id = c.id
            LEFT JOIN student_family sf ON sf.student_id = s.id
            LEFT JOIN student_address_transport sat ON s.id = sat.student_id AND sat.transport_required = 1
            LEFT JOIN transport_trip_students tts ON tts.student_id = s.id AND tts.trip_id = ?
            WHERE sta.school_id = ? AND sta.route_id = ? AND sta.status = 'active' AND s.deleted_at IS NULL
            ORDER BY u.first_name, u.last_name
        `, [activeTrip?.id || null, schoolId, driver.route_id]) : [];

        return res.render("driver/route", {
            user: req.user,
            driver,
            activeTrip,
            routeStops: routeStops || [],
            students: students || [],
            driverInitials: makeInitials(driver)
        });

    } catch (err) {
        console.error("[Driver My Route]", err);
        req.flash("error", "Unable to load route.");
        return res.redirect("/driver/dashboard");
    };
};
