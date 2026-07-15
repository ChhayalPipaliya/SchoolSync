const db = require('../../config/database');
const ExcelJS = require('exceljs');
const TRANSPORT_BASE_PATH = '/schooladmin/transport';

function toPositiveInt(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

async function getRouteForSchool(routeId, schoolId) {
    const hasZone = await hasColumn('routes', 'zone');
    const selectZone = hasZone ? ', COALESCE(r.zone, \'\') AS zone' : '';
    const [[route]] = await db.query(
        `SELECT r.id, r.school_id, r.driver_id, r.vehicle_id, r.status,
            r.route_name AS routeName, r.start_point AS startPoint, r.end_point AS endPoint,
            COALESCE(r.school_shift, 'full_day') AS schoolShift,
            CONCAT(d.first_name, ' ', d.last_name) AS driverName,
            v.vehicle_number AS vehicleNumber, v.capacity AS vehicleCapacity,
            (SELECT COUNT(*)
                FROM student_transport_allocations sta
                JOIN students s ON sta.student_id = s.id AND s.school_id = sta.school_id
                WHERE sta.route_id = r.id AND sta.status = 'active' AND sta.school_id = r.school_id) AS assignedStudents${selectZone}
        FROM routes r
        LEFT JOIN drivers d ON r.driver_id = d.id AND d.school_id = r.school_id
        LEFT JOIN vehicles v ON r.vehicle_id = v.id AND v.school_id = r.school_id
        WHERE r.id = ? AND r.school_id = ?
        LIMIT 1`,
        [routeId, schoolId]
    );
    return route || null;
};

async function getDistinctRouteZones(schoolId) {
    if (!await hasColumn('routes', 'zone')) return [];

    const [rows] = await db.query(
        `SELECT DISTINCT zone
        FROM routes
        WHERE school_id = ? AND zone IS NOT NULL AND zone <> ''
        ORDER BY zone ASC`,
        [schoolId]
    );
    return rows.map((row) => row.zone);
};

async function getSchoolDefaultShift(schoolId) {
    if (!await hasColumn('schools', 'school_way')) return 'full_day';

    const [[school]] = await db.query(
        "SELECT COALESCE(school_way, 'full_day') AS schoolWay FROM schools WHERE id = ? LIMIT 1",
        [schoolId]
    );

    const firstWay = String(school?.schoolWay || 'full_day').split(',')[0].trim();
    return normalizeStatus(firstWay, ['morning', 'evening', 'full_day'], 'full_day');
};

async function getStopForSchool(stopId, schoolId) {
    const [[stop]] = await db.query(
        `SELECT id, school_id, route_id, stop_name AS stopName, stop_address AS stopAddress,
            pickup_time AS pickupTime, drop_time AS dropTime, latitude, longitude,
            stop_order AS stopOrder, estimated_students AS estimatedStudents, status
        FROM transport_route_stops
        WHERE id = ? AND school_id = ?
        LIMIT 1`,
        [stopId, schoolId]
    );
    return stop || null;
};

async function getStudentForSchool(studentId, schoolId) {
    const [[student]] = await db.query(
        `SELECT s.id, u.first_name AS first_name, u.last_name AS last_name, c.class_name, c.section
        FROM students s
        JOIN users u ON s.user_id = u.id
        LEFT JOIN classes c ON s.class_id = c.id
        JOIN student_address_transport sat ON sat.student_id = s.id AND sat.transport_required = 1
        WHERE s.id = ? AND s.school_id = ? AND s.deleted_at IS NULL
        LIMIT 1`,
        [studentId, schoolId]
    );
    return student || null;
};

async function getDriverForSchool(driverId, schoolId) {
    if (!driverId) return null;
    const [[driver]] = await db.query(
        `SELECT id FROM drivers
        WHERE id = ? AND school_id = ? AND status = 'active' AND deleted_at IS NULL
        LIMIT 1`,
        [driverId, schoolId]
    );
    return driver || null;
};

async function getVehicleForSchool(vehicleId, schoolId) {
    if (!vehicleId) return null;
    const [[vehicle]] = await db.query(
        `SELECT id FROM vehicles
        WHERE id = ? AND school_id = ? AND status = 'active'
        LIMIT 1`,
        [vehicleId, schoolId]
    );
    return vehicle || null;
};

async function calculateRouteCapacity(routeId, schoolId) {
    const [[capacity]] = await db.query(
        `SELECT COALESCE(v.capacity, 0) AS vehicle_capacity,
            COUNT(sta.student_id) AS active_students
        FROM routes r
        LEFT JOIN vehicles v ON r.vehicle_id = v.id AND v.school_id = r.school_id
        LEFT JOIN student_transport_allocations sta
            ON sta.route_id = r.id
            AND sta.school_id = r.school_id
            AND sta.status = 'active'
        LEFT JOIN students s ON sta.student_id = s.id AND s.school_id = sta.school_id
        WHERE r.id = ? AND r.school_id = ?
        GROUP BY r.id, v.capacity`,
        [routeId, schoolId]
    );

    const vehicleCapacity = Number(capacity?.vehicle_capacity || 0);
    const activeStudents = Number(capacity?.active_students || 0);
    const availableSeats = Math.max(vehicleCapacity - activeStudents, 0);

    return { vehicleCapacity, activeStudents, availableSeats, isOverloaded: vehicleCapacity > 0 && activeStudents > vehicleCapacity};
};

async function getRouteSeatUsage(route, schoolId, options = {}) {
    const routeId = Number(route?.id || 0);
    const routeName = String(route?.routeName || '').trim();
    const excludeAllocationId = options.excludeAllocationId || null;
    const excludeStudentId = options.excludeStudentId || null;

    if (!routeId || !routeName) return 0;
    const [[usage]] = await db.query(
        `SELECT COUNT(DISTINCT assigned.student_id) AS activeStudents
        FROM (
            SELECT sta.student_id
            FROM student_transport_allocations sta
            WHERE sta.school_id = ?
                AND sta.route_id = ?
                AND sta.status = 'active'
                AND (? IS NULL OR sta.id <> ?)
                AND (? IS NULL OR sta.student_id <> ?)
            UNION
            SELECT sat.student_id
            FROM student_address_transport sat
            JOIN students s ON s.id = sat.student_id AND s.school_id = ?
            WHERE sat.transport_route = ?
                AND (? IS NULL OR sat.student_id <> ?)
        ) assigned`,
        [ schoolId, routeId, excludeAllocationId, excludeAllocationId, excludeStudentId, excludeStudentId, schoolId, routeName, excludeStudentId, excludeStudentId ]
    );

    return Number(usage?.activeStudents || 0);
};

async function ensureRouteHasAvailableSeat(route, schoolId, options = {}) {
    const vehicleCapacity = Number(route?.vehicleCapacity || route?.capacity || 0);
    if (vehicleCapacity <= 0) {
        return { error: 'Please assign an active vehicle with seating capacity to this route first.' };
    };

    const activeStudents = await getRouteSeatUsage(route, schoolId, options);
    if (activeStudents >= vehicleCapacity) {
        return {
            error: `Vehicle capacity is full for ${route.routeName}. Seats: ${activeStudents}/${vehicleCapacity}.`
        };
    };

    return { ok: true, activeStudents, vehicleCapacity };
};

async function getCapacityWarnings(schoolId) {
    const [warnings] = await db.query(
        `SELECT r.id AS route_id, r.route_name AS routeName,
            v.vehicle_number AS vehicleNumber,
            COALESCE(v.capacity, 0) AS vehicleCapacity,
            COUNT(sta.student_id) AS activeStudents
        FROM routes r
        JOIN vehicles v ON r.vehicle_id = v.id AND v.school_id = r.school_id
        LEFT JOIN student_transport_allocations sta
            ON sta.route_id = r.id
            AND sta.school_id = r.school_id
            AND sta.status = 'active'
        LEFT JOIN students s ON sta.student_id = s.id AND s.school_id = sta.school_id
        LEFT JOIN student_address_transport sat ON sat.student_id = s.id AND sat.transport_required = 1
        WHERE r.school_id = ? AND r.status = 'active'
        GROUP BY r.id, r.route_name, v.vehicle_number, v.capacity
        HAVING activeStudents > vehicleCapacity
        ORDER BY activeStudents - vehicleCapacity DESC`,
        [schoolId]
    );
    return warnings;
};

function normalizeStatus(value, allowedStatuses, fallback) {
    return allowedStatuses.includes(value) ? value : fallback;
};

function normalizeTime(value) {
    return value && /^\d{2}:\d{2}$/.test(value) ? value : null;
};

function normalizeDecimal(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
};

function normalizeDate(value) {
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
};

function normalizeMoney(value) {
    const parsed = Number.parseFloat(value || 0);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

function csvEscape(value) {
    const str = String(value ?? '');
    return `"${str.replace(/"/g, '""')}"`;
};

async function getVehiclesForSchool(schoolId) {
    const [vehicles] = await db.query(
        `SELECT id, vehicle_number AS vehicleNumber, model, capacity, status,
            insurance_expiry AS insuranceExpiry, puc_expiry AS pucExpiry,
            permit_expiry AS permitExpiry, fitness_expiry AS fitnessExpiry
        FROM vehicles
        WHERE school_id = ?
        ORDER BY vehicle_number ASC`,
        [schoolId]
    );
    return vehicles;
};

async function getRoutesForSchool(schoolId) {
    const [routes] = await db.query(
        `SELECT id, route_name AS routeName, status
        FROM routes
        WHERE school_id = ?
        ORDER BY route_name ASC`,
        [schoolId]
    );
    return routes;
};

async function getDriversForSchool(schoolId) {
    const [drivers] = await db.query(
        `SELECT id, first_name AS first_name, last_name AS last_name
        FROM drivers
        WHERE school_id = ? AND deleted_at IS NULL
        ORDER BY first_name ASC, last_name ASC`,
        [schoolId]
    );
    return drivers;
};

async function getTableColumnSet(tableName, columnNames) {
    const [columns] = await db.query(
        `SELECT COLUMN_NAME AS columnName
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ?
            AND COLUMN_NAME IN (?)`,
        [tableName, columnNames]
    );
    return new Set(columns.map(column => column.columnName));
};

async function hasColumn(tableName, columnName) {
    const set = await getTableColumnSet(tableName, [columnName]);
    return set.has(columnName);
};

exports.listVehicles = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const search = (req.query.search || '').trim();
        const status = req.query.status || '';
        const ownership = req.query.ownership || '';
        const fuelType = req.query.fuelType || '';
        const whereClauses = ['v.school_id = ?'];
        const params = [schoolId];

        if (search) {
            const searchTerm = `%${search}%`;
            whereClauses.push(
                `(v.vehicle_number LIKE ? OR v.registration_number LIKE ? OR v.model LIKE ? OR v.fuel_type LIKE ? OR d.first_name LIKE ? OR d.last_name LIKE ?)`
            );
            params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
        };

        if (status) {
            whereClauses.push('v.status = ?');
            params.push(status);
        };

        if (ownership) {
            whereClauses.push('v.ownership_type = ?');
            params.push(ownership);
        };

        if (fuelType) {
            whereClauses.push('v.fuel_type = ?');
            params.push(fuelType);
        };

        const [vehicles] = await db.query(
            `SELECT v.id, v.school_id,
                v.vehicle_number AS busNumber,
                v.registration_number AS vehicleNumber,
                v.model,
                v.type,
                v.capacity,
                v.status,
                v.ownership_type AS ownershipType,
                v.fuel_type AS fuelType,
                v.gps_device_id AS gpsDeviceId,
                v.insurance_expiry AS insuranceExpiry,
                v.permit_expiry AS permitExpiry,
                v.puc_expiry AS pucExpiry,
                v.fitness_expiry AS fitnessExpiry,
                v.last_service_date AS lastServiceDate,
                v.next_service_date AS nextServiceDate,
                v.vehicle_photo AS vehiclePhoto,
                CONCAT(d.first_name, ' ', d.last_name) AS driverName
            FROM vehicles v
            LEFT JOIN driver_vehicle_assign dva ON dva.vehicle_id = v.id AND dva.school_id = v.school_id AND dva.is_active = 1
            LEFT JOIN drivers d ON d.id = dva.driver_id AND d.school_id = v.school_id
            WHERE ${whereClauses.join(' AND ')}
            ORDER BY v.vehicle_number ASC`,
            params
        );

        const drivers = await getDriversForSchool(schoolId);
        res.render('schoolAdmin/transport/vehicles', {
            title: 'Fleet Management',
            vehicles,
            drivers,
            filters: { search, status, ownership, fuelType },
            ownershipOptions: ['school_owned', 'contract', 'leased', 'shared'],
            fuelTypes: ['diesel', 'petrol', 'electric', 'cng', 'hybrid'],
            currentPath: '/schooladmin/transport/vehicles'
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load vehicles');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.addVehicleForm = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const drivers = await getDriversForSchool(schoolId);

        res.render('schoolAdmin/transport/addVehicle', {
            title: 'Add Vehicle',
            vehicle: null,
            drivers,
            ownershipOptions: ['school_owned', 'contract', 'leased', 'shared'],
            fuelTypes: ['diesel', 'petrol', 'electric', 'cng', 'hybrid'],
            currentPath: '/schooladmin/transport/vehicles'
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load vehicle form');
        res.redirect('/schooladmin/transport/vehicles');
    };
};

async function assignVehicleDriver(driverId, vehicleId, schoolId) {
    if (!driverId || !vehicleId) return;
    if (!await getDriverForSchool(driverId, schoolId)) return;

    await db.withTransaction(async (tx) => {
        await tx.query(
            'UPDATE driver_vehicle_assign SET is_active = 0 WHERE school_id = ? AND (driver_id = ? OR vehicle_id = ?) AND is_active = 1',
            [schoolId, driverId, vehicleId]
        );

        await tx.query(
            'INSERT INTO driver_vehicle_assign (school_id, driver_id, vehicle_id, assigned_date, is_active) VALUES (?, ?, ?, CURDATE(), 1)',
            [schoolId, driverId, vehicleId]
        );
    });
};

exports.createVehicle = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { busNumber, vehicleNumber, model, type, capacity, fuelType, ownershipType, driver_id, gpsDeviceId, insuranceExpiry, permitExpiry, fitnessExpiry, pucExpiry, lastServiceDate, nextServiceDate, vehiclePhoto, status } = req.body;
        const parsedCapacity = parseInt(capacity, 10);
        const driverId = toPositiveInt(driver_id);

        if (!busNumber || !type || !parsedCapacity || parsedCapacity <= 0) {
            req.flash('error', 'Please enter valid vehicle details');
            return res.redirect('/schooladmin/transport/vehicles/add');
        };

        if (driverId && !await getDriverForSchool(driverId, schoolId)) {
            req.flash('error', 'Selected driver is invalid for this school');
            return res.redirect('/schooladmin/transport/vehicles/add');
        };

        const [result] = await db.query(
            `INSERT INTO vehicles (
                school_id, vehicle_number, registration_number, model, type, capacity, status,
                fuel_type, ownership_type, gps_device_id,
                insurance_expiry, permit_expiry, fitness_expiry, puc_expiry,
                last_service_date, next_service_date, vehicle_photo
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [ schoolId, busNumber.toUpperCase(), vehicleNumber ? vehicleNumber.toUpperCase() : null, model || null, type, parsedCapacity, status || 'active', fuelType || null, ownershipType || null,                gpsDeviceId || null, normalizeDate(insuranceExpiry), normalizeDate(permitExpiry), normalizeDate(fitnessExpiry), normalizeDate(pucExpiry), normalizeDate(lastServiceDate), normalizeDate(nextServiceDate),  vehiclePhoto || null]
        );

        if (driverId) {
            await assignVehicleDriver(driverId, result.insertId, schoolId);
        };

        req.flash('success', 'Vehicle added successfully');
        res.redirect('/schooladmin/transport/vehicles');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to add vehicle');
        res.redirect('/schooladmin/transport/vehicles/add');
    };
};

exports.editVehicleForm = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { id } = req.params;

        const [[vehicle]] = await db.query(
            `SELECT v.id, v.school_id,
                v.vehicle_number AS busNumber,
                v.registration_number AS vehicleNumber,
                v.model,
                v.type,
                v.capacity,
                v.status,
                v.ownership_type AS ownershipType,
                v.fuel_type AS fuelType,
                v.gps_device_id AS gpsDeviceId,
                v.insurance_expiry AS insuranceExpiry,
                v.permit_expiry AS permitExpiry,
                v.puc_expiry AS pucExpiry,
                v.fitness_expiry AS fitnessExpiry,
                v.last_service_date AS lastServiceDate,
                v.next_service_date AS nextServiceDate,
                v.vehicle_photo AS vehiclePhoto
            FROM vehicles v
            WHERE v.id = ? AND v.school_id = ?`,
            [id, schoolId]
        );

        if (!vehicle) {
            req.flash('error', 'Vehicle not found');
            return res.redirect('/schooladmin/transport/vehicles');
        };

        const [[assignment]] = await db.query(
            'SELECT driver_id FROM driver_vehicle_assign WHERE school_id = ? AND vehicle_id = ? AND is_active = 1 LIMIT 1',
            [schoolId, id]
        );

        vehicle.driverId = assignment ? assignment.driver_id : null;
        const drivers = await getDriversForSchool(schoolId);
        res.render('schoolAdmin/transport/addVehicle', {
            title: 'Edit Vehicle',
            vehicle,
            drivers,
            ownershipOptions: ['school_owned', 'contract', 'leased', 'shared'],
            fuelTypes: ['diesel', 'petrol', 'electric', 'cng', 'hybrid'],
            currentPath: '/schooladmin/transport/vehicles'
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load edit form');
        res.redirect('/schooladmin/transport/vehicles');
    };
};

exports.updateVehicle = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { id } = req.params;
        const { busNumber, vehicleNumber, model, type, capacity, status, fuelType, ownershipType, driver_id, gpsDeviceId, insuranceExpiry, permitExpiry, fitnessExpiry, pucExpiry, lastServiceDate, nextServiceDate, vehiclePhoto } = req.body;
        const parsedCapacity = parseInt(capacity, 10);
        const driverId = toPositiveInt(driver_id);

        if (!busNumber || !type || !parsedCapacity || parsedCapacity <= 0 || !status) {
            req.flash('error', 'Please enter valid vehicle details');
            return res.redirect(`/schooladmin/transport/vehicles/edit/${id}`);
        };

        if (driverId && !await getDriverForSchool(driverId, schoolId)) {
            req.flash('error', 'Selected driver is invalid for this school');
            return res.redirect(`/schooladmin/transport/vehicles/edit/${id}`);
        };

        await db.query(
            `UPDATE vehicles SET
                vehicle_number = ?,
                registration_number = ?,
                model = ?,
                type = ?,
                capacity = ?,
                status = ?,
                fuel_type = ?,
                ownership_type = ?,
                gps_device_id = ?,
                insurance_expiry = ?,
                permit_expiry = ?,
                fitness_expiry = ?,
                puc_expiry = ?,
                last_service_date = ?,
                next_service_date = ?,
                vehicle_photo = ?
            WHERE id = ? AND school_id = ?`,
            [ busNumber.toUpperCase(), vehicleNumber ? vehicleNumber.toUpperCase() : null, model || null, type, parsedCapacity, status, fuelType || null, ownershipType || null, gpsDeviceId || null, normalizeDate(insuranceExpiry), normalizeDate(permitExpiry), normalizeDate(fitnessExpiry), normalizeDate(pucExpiry), normalizeDate(lastServiceDate), normalizeDate(nextServiceDate), vehiclePhoto || null, id, schoolId ]
        );

        if (driverId) {
            await assignVehicleDriver(driverId, id, schoolId);
        } else {
            await db.query('UPDATE driver_vehicle_assign SET is_active = 0 WHERE school_id = ? AND vehicle_id = ? AND is_active = 1', [schoolId, id]);
        };

        req.flash('success', 'Vehicle updated successfully');
        res.redirect('/schooladmin/transport/vehicles');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to update vehicle');
        res.redirect(`/schooladmin/transport/vehicles/edit/${id}`);
    };
};

exports.deleteVehicle = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { id } = req.params;
        const [[routeAssigned]] = await db.query(
            'SELECT id FROM routes WHERE vehicle_id = ? AND school_id = ? LIMIT 1',
            [id, schoolId]
        );

        if (routeAssigned) {
            req.flash('error', 'Cannot delete vehicle because it is assigned to an active route');
            return res.redirect('/schooladmin/transport/vehicles');
        };

        const [[assignmentAssigned]] = await db.query(
            'SELECT id FROM driver_vehicle_assign WHERE school_id = ? AND vehicle_id = ? AND is_active = 1 LIMIT 1',
            [schoolId, id]
        );
        if (assignmentAssigned) {
            req.flash('error', 'Cannot delete vehicle because it has an active driver assignment');
            return res.redirect('/schooladmin/transport/vehicles');
        };

        await db.query(
            'DELETE FROM vehicles WHERE id = ? AND school_id = ?',
            [id, schoolId]
        );

        req.flash('success', 'Vehicle deleted successfully');
        res.redirect('/schooladmin/transport/vehicles');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to delete vehicle');
        res.redirect('/schooladmin/transport/vehicles');
    };
};

exports.listRoutes = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const search = (req.query.search || '').trim();
        const status = req.query.status || '';
        const shift = req.query.shift || '';
        const zone = req.query.zone || '';
        const selectedRouteId = toPositiveInt(req.query.selectedRouteId);
        const hasZone = await hasColumn('routes', 'zone');
        const whereClauses = ['r.school_id = ?'];
        const params = [schoolId];

        if (search) {
            const term = `%${search}%`;
            const zoneSearch = hasZone ? ' OR r.zone LIKE ?' : '';
            whereClauses.push(
                `(r.route_name LIKE ? OR r.start_point LIKE ? OR r.end_point LIKE ? OR d.first_name LIKE ? OR d.last_name LIKE ? OR v.vehicle_number LIKE ?${zoneSearch})`
            );
            params.push(term, term, term, term, term, term);
            if (hasZone) params.push(term);
        };

        if (status) {
            whereClauses.push('r.status = ?');
            params.push(status);
        };

        if (shift) {
            whereClauses.push('r.school_shift = ?');
            params.push(shift);
        };

        if (hasZone && zone) {
            whereClauses.push('r.zone = ?');
            params.push(zone);
        };

        const zoneSelect = hasZone ? ', COALESCE(r.zone, \'\') AS zone' : '';
        const zoneGroup = hasZone ? ', r.zone' : '';
        const [routes] = await db.query(
            `SELECT r.id, r.school_id, r.driver_id, r.vehicle_id, r.status,
                r.route_name AS routeName,
                r.start_point AS startPoint,
                r.end_point AS endPoint,
                COALESCE(r.school_shift, 'full_day') AS schoolShift${zoneSelect},
                d.first_name AS driverFirst,
                d.last_name AS driverLast,
                v.vehicle_number AS vehicleNumber,
                COUNT(DISTINCT trs.id) AS stopsCount,
                COUNT(DISTINCT sta.student_id) AS studentCount,
                MIN(trs.pickup_time) AS startTime,
                MAX(trs.drop_time) AS endTime
            FROM routes r
            LEFT JOIN drivers d ON r.driver_id = d.id
            LEFT JOIN vehicles v ON r.vehicle_id = v.id
            LEFT JOIN transport_route_stops trs ON trs.route_id = r.id AND trs.school_id = r.school_id AND trs.status = 'active'
            LEFT JOIN student_transport_allocations sta ON sta.route_id = r.id AND sta.school_id = r.school_id AND sta.status = 'active'
            LEFT JOIN students s ON sta.student_id = s.id AND s.school_id = sta.school_id
            WHERE ${whereClauses.join(' AND ')}
            GROUP BY r.id, r.route_name, r.start_point, r.end_point, r.school_shift${zoneGroup}, r.status, r.driver_id, r.vehicle_id, d.first_name, d.last_name, v.vehicle_number
            ORDER BY r.route_name ASC`,
            params
        );

        const zoneOptions = hasZone ? await getDistinctRouteZones(schoolId) : [];
        const [[routeTotals]] = await db.query(
            `SELECT COUNT(*) AS totalRoutes,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS activeRoutes
            FROM routes
            WHERE school_id = ?`,
            [schoolId]
        );

        const [[studentTotals]] = await db.query(
            `SELECT COUNT(DISTINCT student_id) AS studentsAssigned
            FROM student_transport_allocations
            WHERE school_id = ? AND status = 'active'`,
            [schoolId]
        );

        const [[stopTotals]] = await db.query(
            `SELECT COUNT(*) AS totalStops
            FROM transport_route_stops
            WHERE school_id = ? AND status = 'active'`,
            [schoolId]
        );

        const selectedRoute = selectedRouteId ? await getRouteForSchool(selectedRouteId, schoolId) : null;
        res.render('schoolAdmin/transport/routes', {
            title: 'Routes Management',
            routes,
            selectedRoute: selectedRoute || (routes[0] || null),
            selectedRouteId: selectedRoute ? selectedRoute.id : (routes[0] ? routes[0].id : null),
            routeSummary: {
                totalRoutes: Number(routeTotals?.totalRoutes || 0),
                activeRoutes: Number(routeTotals?.activeRoutes || 0),
                studentsAssigned: Number(studentTotals?.studentsAssigned || 0),
                totalStops: Number(stopTotals?.totalStops || 0)
            },
            filters: { search, status, shift, zone },
            shiftOptions: ['morning', 'evening', 'full_day'],
            statusOptions: ['active', 'inactive'],
            zoneOptions,
            hasZone,
            currentPath: '/schooladmin/transport/routes'
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load routes');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.addRouteForm = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const hasZone = await hasColumn('routes', 'zone');
        const schoolDefaultShift = await getSchoolDefaultShift(schoolId);

        const [drivers] = await db.query(
            'SELECT id, first_name AS first_name, last_name AS last_name FROM drivers WHERE school_id = ? AND status = "active" AND deleted_at IS NULL ORDER BY first_name, last_name',
            [schoolId]
        );

        const [vehicles] = await db.query(
            'SELECT id, vehicle_number AS vehicleNumber FROM vehicles WHERE school_id = ? AND status = "active" ORDER BY vehicle_number ASC',
            [schoolId]
        );

        res.render('schoolAdmin/transport/addRoute', {
            title: 'Add Route',
            route: null,
            drivers,
            vehicles,
            schoolDefaultShift,
            zoneEnabled: hasZone,
            currentPath: '/schooladmin/transport/routes'
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load add route form');
        res.redirect('/schooladmin/transport/routes');
    };
};

exports.createRoute = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { routeName, startPoint, endPoint, driver_id, vehicle_id, school_shift, zone } = req.body;
        const driverId = toPositiveInt(driver_id);
        const vehicleId = toPositiveInt(vehicle_id);
        const schoolDefaultShift = await getSchoolDefaultShift(schoolId);
        const schoolShift = normalizeStatus(school_shift, ['morning', 'evening', 'full_day'], schoolDefaultShift);
        const hasZone = await hasColumn('routes', 'zone');

        if (!routeName || !startPoint || !endPoint) {
            req.flash('error', 'Please enter valid route details');
            return res.redirect('/schooladmin/transport/routes/add');
        };

        if (driverId && !await getDriverForSchool(driverId, schoolId)) {
            req.flash('error', 'Selected driver is invalid for this school');
            return res.redirect('/schooladmin/transport/routes/add');
        };

        if (vehicleId && !await getVehicleForSchool(vehicleId, schoolId)) {
            req.flash('error', 'Selected vehicle is invalid for this school');
            return res.redirect('/schooladmin/transport/routes/add');
        };

        if (hasZone) {
            await db.query(
                'INSERT INTO routes (school_id, route_name, start_point, end_point, driver_id, vehicle_id, status, school_shift, zone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [ schoolId, routeName, startPoint, endPoint, driverId, vehicleId, 'active', schoolShift, zone || null]
            );
        } else {
            await db.query(
                'INSERT INTO routes (school_id, route_name, start_point, end_point, driver_id, vehicle_id, status, school_shift) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [ schoolId, routeName, startPoint, endPoint, driverId, vehicleId, 'active', schoolShift ]
            );
        };

        req.flash('success', 'Route added successfully');
        res.redirect('/schooladmin/transport/routes');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to add route');
        res.redirect('/schooladmin/transport/routes/add');
    };
};

exports.editRouteForm = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { id } = req.params;
        const hasZone = await hasColumn('routes', 'zone');
        const schoolDefaultShift = await getSchoolDefaultShift(schoolId);
        const selectZone = hasZone ? ', zone' : '';
        const [[route]] = await db.query(
            `SELECT id, school_id, driver_id, vehicle_id, status, COALESCE(school_shift, 'full_day') AS schoolShift, route_name AS routeName, start_point AS startPoint, end_point AS endPoint${selectZone} FROM routes WHERE id = ? AND school_id = ?`,
            [id, schoolId]
        );

        if (!route) {
            req.flash('error', 'Route not found');
            return res.redirect('/schooladmin/transport/routes');
        };

        route.schoolShift = normalizeStatus(route.schoolShift, ['morning', 'evening', 'full_day'], schoolDefaultShift);
        const [drivers] = await db.query(
            'SELECT id, first_name AS first_name, last_name AS last_name FROM drivers WHERE school_id = ? AND status = "active" AND deleted_at IS NULL ORDER BY first_name, last_name',
            [schoolId]
        );

        const [vehicles] = await db.query(
            'SELECT id, vehicle_number AS vehicleNumber FROM vehicles WHERE school_id = ? AND status = "active" ORDER BY vehicle_number ASC',
            [schoolId]
        );

        res.render('schoolAdmin/transport/addRoute', {
            title: 'Edit Route',
            route,
            drivers,
            vehicles,
            schoolDefaultShift,
            zoneEnabled: hasZone,
            currentPath: '/schooladmin/transport/routes'
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load edit form');
        res.redirect('/schooladmin/transport/routes');
    };
};

exports.updateRoute = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { id } = req.params;
        const { routeName, startPoint, endPoint, driver_id, vehicle_id, status, school_shift, zone } = req.body;
        const driverId = toPositiveInt(driver_id);
        const vehicleId = toPositiveInt(vehicle_id);
        const schoolDefaultShift = await getSchoolDefaultShift(schoolId);
        const schoolShift = normalizeStatus(school_shift, ['morning', 'evening', 'full_day'], schoolDefaultShift);
        const hasZone = await hasColumn('routes', 'zone');

        if (!routeName || !startPoint || !endPoint || !status) {
            req.flash('error', 'Please enter valid route details');
            return res.redirect(`/schooladmin/transport/routes/edit/${id}`);
        };

        if (driverId && !await getDriverForSchool(driverId, schoolId)) {
            req.flash('error', 'Selected driver is invalid for this school');
            return res.redirect(`/schooladmin/transport/routes/edit/${id}`);
        };

        if (vehicleId && !await getVehicleForSchool(vehicleId, schoolId)) {
            req.flash('error', 'Selected vehicle is invalid for this school');
            return res.redirect(`/schooladmin/transport/routes/edit/${id}`);
        };

        if (hasZone) {
            await db.query(
                'UPDATE routes SET route_name = ?, start_point = ?, end_point = ?, driver_id = ?, vehicle_id = ?, status = ?, school_shift = ?, zone = ? WHERE id = ? AND school_id = ?',
                [ routeName, startPoint, endPoint, driverId, vehicleId, status, schoolShift, zone || null, id, schoolId ]
            );
        } else {
            await db.query(
                'UPDATE routes SET route_name = ?, start_point = ?, end_point = ?, driver_id = ?, vehicle_id = ?, status = ?, school_shift = ? WHERE id = ? AND school_id = ?',
                [ routeName, startPoint, endPoint, driverId, vehicleId, status, schoolShift, id, schoolId ]
            );
        };

        req.flash('success', 'Route updated successfully');
        res.redirect('/schooladmin/transport/routes');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to update route');
        res.redirect(`/schooladmin/transport/routes/edit/${id}`);
    };
};

exports.deleteRoute = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { id } = req.params;

        const [[allocationCheck]] = await db.query(
            `SELECT COUNT(*) AS cnt FROM student_transport_allocations
             WHERE route_id = ? AND school_id = ? AND status = 'active'`,
            [id, schoolId]
        );
        if (Number(allocationCheck.cnt) > 0) {
            req.flash('error', `Cannot delete route — ${allocationCheck.cnt} active student allocation(s) exist. Deactivate them first.`);
            return res.redirect('/schooladmin/transport/routes');
        };

        const [[tripCheck]] = await db.query(
            `SELECT id FROM transport_trips
             WHERE route_id = ? AND school_id = ? AND status = 'running' LIMIT 1`,
            [id, schoolId]
        );
        if (tripCheck) {
            req.flash('error', 'Cannot delete route — a trip is currently running on this route.');
            return res.redirect('/schooladmin/transport/routes');
        };

        await db.query('DELETE FROM routes WHERE id = ? AND school_id = ?', [id, schoolId]);
        req.flash('success', 'Route deleted successfully');
        res.redirect('/schooladmin/transport/routes');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to delete route');
        res.redirect('/schooladmin/transport/routes');
    };
};

exports.listAssignments = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;

        const [assignments] = await db.query(
            `SELECT dva.id, dva.driver_id, dva.vehicle_id, dva.assigned_date AS assignedDate, dva.is_active AS isActive, dva.created_at AS createdAt, 
                d.first_name AS driverFirst, d.last_name AS driverLast,
                v.vehicle_number AS vehicleNumber, v.model AS vehicleModel
            FROM driver_vehicle_assign dva
            JOIN drivers d ON dva.driver_id = d.id
            JOIN vehicles v ON dva.vehicle_id = v.id
            WHERE dva.school_id = ? AND d.school_id = ? AND d.deleted_at IS NULL
            ORDER BY dva.is_active DESC, dva.assigned_date DESC, dva.created_at DESC`,
            [schoolId, schoolId]
        );

        const [drivers] = await db.query(
            'SELECT id, first_name AS first_name, last_name AS last_name FROM drivers WHERE school_id = ? AND status = "active" AND deleted_at IS NULL ORDER BY first_name, last_name',
            [schoolId]
        );

        const [vehicles] = await db.query(
            'SELECT id, vehicle_number AS vehicleNumber FROM vehicles WHERE school_id = ? AND status = "active" ORDER BY vehicle_number ASC',
            [schoolId]
        );

        res.render('schoolAdmin/transport/assignments', {
            title: 'Driver Assignments',
            assignments,
            drivers,
            vehicles,
            currentPath: '/schooladmin/transport/assignments'
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load driver assignments');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.createAssignment = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { driver_id, vehicle_id, assignedDate } = req.body;
        const driverId = toPositiveInt(driver_id);
        const vehicleId = toPositiveInt(vehicle_id);

        if (!driverId || !vehicleId) {
            req.flash('error', 'Please select a driver and a vehicle');
            return res.redirect('/schooladmin/transport/assignments');
        };

        if (!await getDriverForSchool(driverId, schoolId) || !await getVehicleForSchool(vehicleId, schoolId)) {
            req.flash('error', 'Selected driver or vehicle is invalid for this school');
            return res.redirect('/schooladmin/transport/assignments');
        };

        const date = assignedDate || new Date().toISOString().slice(0, 10);
        await db.withTransaction(async (tx) => {
            await tx.query(
                'UPDATE driver_vehicle_assign SET is_active = 0 WHERE school_id = ? AND (driver_id = ? OR vehicle_id = ?) AND is_active = 1',
                [schoolId, driverId, vehicleId]
            );

            await tx.query(
                'INSERT INTO driver_vehicle_assign (school_id, driver_id, vehicle_id, assigned_date, is_active) VALUES (?, ?, ?, ?, 1)',
                [schoolId, driverId, vehicleId, date]
            );
        });

        req.flash('success', 'Driver assignment created successfully');
        res.redirect('/schooladmin/transport/assignments');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to assign driver to vehicle');
        res.redirect('/schooladmin/transport/assignments');
    };
};

exports.deactivateAssignment = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { id } = req.params;

        await db.query(
            `UPDATE driver_vehicle_assign dva
            JOIN drivers d ON dva.driver_id = d.id
            SET dva.is_active = 0
            WHERE dva.id = ? AND dva.school_id = ? AND d.school_id = ?`,
            [id, schoolId, schoolId]
        );

        req.flash('success', 'Assignment deactivated successfully');
        res.redirect('/schooladmin/transport/assignments');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to deactivate assignment');
        res.redirect('/schooladmin/transport/assignments');
    };
};

exports.listStudents = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;

        const [students] = await db.query(
            `SELECT s.id AS student_id, u.first_name AS first_name, u.last_name AS last_name, c.class_name, c.section,
                sat.transport_route, sat.transport_vehicle_no, sat.current_address
            FROM students s
            JOIN users u ON s.user_id = u.id
            JOIN classes c ON s.class_id = c.id
            LEFT JOIN student_address_transport sat ON s.id = sat.student_id
            WHERE s.school_id = ? AND s.deleted_at IS NULL AND sat.transport_required = 1
            ORDER BY c.class_name, c.section, u.first_name, u.last_name`,
            [schoolId]
        );

        const [routes] = await db.query(
            `SELECT r.id, r.route_name AS routeName, v.vehicle_number AS vehicleNumber
            FROM routes r
            LEFT JOIN vehicles v ON r.vehicle_id = v.id
            WHERE r.school_id = ? AND r.status = "active"
            ORDER BY r.route_name ASC`,
            [schoolId]
        );

        res.render('schoolAdmin/transport/students', {
            title: 'Student Transport Allocations',
            students,
            routes,
            currentPath: '/schooladmin/transport/students'
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load student transport records');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.assignStudentRoute = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const studentId = toPositiveInt(req.params.studentId);
        const { routeName } = req.body;

        const student = studentId ? await getStudentForSchool(studentId, schoolId) : null;
        if (!student) {
            req.flash('error', 'Student not found');
            return res.redirect('/schooladmin/transport/students');
        };

        let vehicleNo = null;
        if (routeName) {
            const [[route]] = await db.query(
                `SELECT r.id, r.route_name AS routeName, v.vehicle_number AS vehicleNumber, v.capacity AS vehicleCapacity
                FROM routes r 
                LEFT JOIN vehicles v ON r.vehicle_id = v.id 
                WHERE r.route_name = ? AND r.school_id = ? AND r.status = 'active' LIMIT 1`,
                [routeName, schoolId]
            );
            if (!route) {
                req.flash('error', 'Selected route is invalid or inactive');
                return res.redirect('/schooladmin/transport/students');
            };

            const capacityCheck = await ensureRouteHasAvailableSeat(route, schoolId, { excludeStudentId: studentId });
            if (capacityCheck.error) {
                req.flash('error', capacityCheck.error);
                return res.redirect('/schooladmin/transport/students');
            };
            vehicleNo = route?.vehicleNumber || null;
        };

        await db.query(
            `UPDATE student_address_transport sat
            JOIN students s ON sat.student_id = s.id
            SET sat.transport_route = ?, sat.transport_vehicle_no = ?
            WHERE sat.student_id = ? AND s.school_id = ?`,
            [routeName || null, vehicleNo, studentId, schoolId]
        );

        req.flash('success', 'Student transport details updated successfully');
        res.redirect('/schooladmin/transport/students');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to update student transport route');
        res.redirect('/schooladmin/transport/students');
    };
};

exports.routeStudents = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { routeId } = req.params;
        const [[route]] = await db.query(
            `SELECT r.id, r.school_id, r.driver_id, r.vehicle_id, r.status,
                r.route_name AS routeName, r.start_point AS startPoint, r.end_point AS endPoint,
                v.vehicle_number AS vehicleNumber 
            FROM routes r
            LEFT JOIN vehicles v ON r.vehicle_id = v.id
            WHERE r.id = ? AND r.school_id = ? LIMIT 1`,
            [routeId, schoolId]
        );

        if (!route) {
            req.flash('error', 'Route not found');
            return res.redirect('/schooladmin/transport/routes');
        };

        const [students] = await db.query(
            `SELECT s.id AS student_id, u.first_name AS first_name, u.last_name AS last_name, c.class_name, c.section,
                sat.current_address, sat.emergency_contact
            FROM students s
            JOIN users u ON s.user_id = u.id
            JOIN classes c ON s.class_id = c.id
            JOIN student_address_transport sat ON s.id = sat.student_id
            WHERE s.school_id = ? AND s.deleted_at IS NULL AND sat.transport_route = ?
            ORDER BY u.first_name, u.last_name`,
            [schoolId, route.routeName]
        );

        res.render('schoolAdmin/transport/routeStudents', {
            title: 'Route Passenger List',
            route,
            students,
            currentPath: '/schooladmin/transport/routes'
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load route directory');
        res.redirect('/schooladmin/transport/routes');
    };
};

exports.viewTracking = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;

        const [activeTrips] = await db.query(
            `SELECT tt.id AS trip_id, tt.route_id AS routeId, tt.vehicle_id AS vehicleId,
                tt.trip_type AS tripType, COALESCE(tt.trip_shift, 'full_day') AS tripShift,
                r.route_name AS routeName, v.vehicle_number AS vehicleNumber, v.model AS vehicleModel,
                u.first_name AS driver_first_name, u.last_name AS driver_last_name, u.phone AS driver_phone,
                s.latitude AS school_latitude, s.longitude AS school_longitude
            FROM transport_trips tt
            JOIN routes r ON tt.route_id = r.id AND r.school_id = tt.school_id
            JOIN schools s ON tt.school_id = s.id
            LEFT JOIN drivers d ON tt.driver_id = d.id AND d.school_id = tt.school_id
            LEFT JOIN users u ON d.user_id = u.id
            LEFT JOIN vehicles v ON tt.vehicle_id = v.id AND v.school_id = tt.school_id
            WHERE tt.school_id = ? AND tt.status = 'running' AND tt.trip_date = CURDATE()`,
            [schoolId]
        );

        const [[vehicleStats]] = await db.query(
            `SELECT COUNT(*) as total_vehicles,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_vehicles
            FROM vehicles WHERE school_id = ?`,
            [schoolId]
        );

        res.render('schoolAdmin/transport/tracking', {
            title: 'Live Bus Tracking Dashboard',
            activeTrips,
            stats: {
                totalBuses: vehicleStats?.total_vehicles || 0,
                runningBuses: activeTrips.length,
                activeBuses: vehicleStats?.active_vehicles || 0
            },
            currentPath: '/schooladmin/transport/tracking'
        });
    } catch (err) {
        console.error('[Admin Transport viewTracking Error]', err);
        req.flash('error', 'Failed to load live tracking dashboard');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.getTrackingTripStudents = async (req, res) => {
    try {
        const schoolId = req.session.user?.school_id;
        const tripId = toPositiveInt(req.params.tripId);

        if (!schoolId || !tripId) {
            return res.status(400).json({ success: false, message: 'Invalid request' });
        };

        const [[trip]] = await db.query(
            `SELECT id, route_id, vehicle_id, driver_id, trip_type, trip_shift, status
            FROM transport_trips
            WHERE id = ? AND school_id = ? AND status = 'running' AND trip_date = CURDATE()
            LIMIT 1`,
            [tripId, schoolId]
        );

        if (!trip) {
            return res.status(404).json({ success: false, message: 'Trip not found' });
        };

        const [students] = await db.query(
            `SELECT sta.id AS allocation_id, s.id AS student_id,
                u.first_name, u.last_name,
                c.class_name, c.section,
                ps.stop_name AS pickup_stop,
                ds.stop_name AS drop_stop,
                COALESCE(tts.status, 'pending') AS boarding_status,
                tts.picked_at AS boarded_at,
                sta.pickup_latitude AS pickupLatitude, sta.pickup_longitude AS pickupLongitude,
                sta.drop_latitude AS dropLatitude, sta.drop_longitude AS dropLongitude,
                ps.latitude AS pickupStopLatitude, ps.longitude AS pickupStopLongitude,
                ds.latitude AS dropStopLatitude, ds.longitude AS dropStopLongitude
            FROM transport_trips tt
            JOIN student_transport_allocations sta
                ON sta.route_id = tt.route_id
                AND sta.school_id = tt.school_id
                AND sta.status = 'active'
            JOIN students s ON s.id = sta.student_id AND s.school_id = sta.school_id
            JOIN users u ON s.user_id = u.id
            LEFT JOIN classes c ON s.class_id = c.id
            LEFT JOIN transport_route_stops ps ON sta.pickup_stop_id = ps.id AND ps.school_id = sta.school_id
            LEFT JOIN transport_route_stops ds ON sta.drop_stop_id = ds.id AND ds.school_id = sta.school_id
            LEFT JOIN transport_trip_students tts
                ON tts.trip_id = tt.id AND tts.student_id = s.id
            WHERE tt.id = ? AND tt.school_id = ?
            ORDER BY c.class_name ASC, u.first_name ASC, u.last_name ASC`,
            [tripId, schoolId]
        );

        res.json({ success: true, students });
    } catch (err) {
        console.error('[TransportController getTrackingTripStudents]', err);
        res.status(500).json({ success: false, message: 'Failed to load student roster' });
    };
};

exports.dashboard = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const [vehicleStatsRows] = await db.query(
            `SELECT COUNT(*) AS totalVehicles,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS activeVehicles,
                SUM(CASE WHEN status = 'maintenance' THEN 1 ELSE 0 END) AS maintenanceVehicles,
                SUM(CASE WHEN ownership_type = 'school_owned' THEN 1 ELSE 0 END) AS schoolOwnedVehicles,
                SUM(CASE WHEN ownership_type = 'contract' THEN 1 ELSE 0 END) AS contractVehicles
            FROM vehicles
            WHERE school_id = ?`,
            [schoolId]
        );

        const vehicleStats = vehicleStatsRows[0] || {};
        const [routeStatsRows] = await db.query(
            `SELECT COUNT(*) AS totalRoutes,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS activeRoutes
            FROM routes
            WHERE school_id = ?`,
            [schoolId]
        );

        const routeStats = routeStatsRows[0] || {};
        const [driverStatsRows] = await db.query(
            `SELECT COUNT(DISTINCT CASE WHEN t.status = 'running' THEN t.driver_id END) AS driversOnDuty,
                COUNT(*) AS totalDrivers
            FROM drivers d
            LEFT JOIN transport_trips t ON t.driver_id = d.id AND t.school_id = d.school_id AND t.status = 'running' AND t.trip_date = CURDATE()
            WHERE d.school_id = ? AND d.status = 'active' AND d.deleted_at IS NULL`,
            [schoolId]
        );

        const driverStats = driverStatsRows[0] || {};
        const [studentStatsRows] = await db.query(
            `SELECT COUNT(DISTINCT student_id) AS studentsUsingTransport
            FROM student_transport_allocations
            WHERE school_id = ? AND status = 'active'`,
            [schoolId]
        );

        const studentStats = studentStatsRows[0] || {};
        const [tripStatsRows] = await db.query(
            `SELECT SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS runningTripsToday,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completedTripsToday,
                SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) AS scheduledTripsToday,
                SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelledTripsToday,
                COUNT(*) AS totalTripsToday
            FROM transport_trips
            WHERE school_id = ? AND trip_date = CURDATE()`,
            [schoolId]
        );

        const tripStats = tripStatsRows[0] || {};
        const [alertStatsRows] = await db.query(
            `SELECT COUNT(*) AS activeAlerts
            FROM transport_alerts
            WHERE school_id = ? AND status = 'open'`,
            [schoolId]
        );

        const alertStats = alertStatsRows[0] || {};
        const capacityWarnings = await getCapacityWarnings(schoolId);
        const [routePerformance] = await db.query(
            `SELECT r.id, r.route_name AS routeName,
                v.vehicle_number AS vehicleNumber,
                COALESCE(COUNT(DISTINCT sta.student_id), 0) AS assignedStudents,
                COALESCE(COUNT(DISTINCT trs.id), 0) AS stopCount
            FROM routes r
            LEFT JOIN vehicles v ON r.vehicle_id = v.id AND v.school_id = r.school_id
            LEFT JOIN transport_route_stops trs ON trs.route_id = r.id AND trs.school_id = r.school_id AND trs.status = 'active'
            LEFT JOIN student_transport_allocations sta ON sta.route_id = r.id AND sta.school_id = r.school_id AND sta.status = 'active'
            LEFT JOIN students s ON sta.student_id = s.id AND s.school_id = sta.school_id
            WHERE r.school_id = ?
            GROUP BY r.id, r.route_name, v.vehicle_number
            ORDER BY assignedStudents DESC, stopCount DESC
            LIMIT 5`,
            [schoolId]
        );

        const [maintenanceReminders] = await db.query(
            `SELECT v.id, v.vehicle_number AS busNumber, v.model, v.fuel_type AS fuelType,
                v.insurance_expiry AS insuranceExpiry,
                v.permit_expiry AS permitExpiry,
                v.fitness_expiry AS fitnessExpiry,
                v.puc_expiry AS pucExpiry,
                v.last_service_date AS lastServiceDate,
                v.next_service_date AS nextServiceDate,
            CASE
                WHEN v.status = 'maintenance' THEN 'Maintenance'
                WHEN DATEDIFF(v.insurance_expiry, CURDATE()) BETWEEN 0 AND 30 THEN 'Insurance Expiry'
                WHEN DATEDIFF(v.permit_expiry, CURDATE()) BETWEEN 0 AND 30 THEN 'Permit Expiry'
                WHEN DATEDIFF(v.fitness_expiry, CURDATE()) BETWEEN 0 AND 30 THEN 'Fitness Expiry'
                WHEN DATEDIFF(v.puc_expiry, CURDATE()) BETWEEN 0 AND 30 THEN 'PUC Expiry'
                WHEN DATEDIFF(v.next_service_date, CURDATE()) BETWEEN 0 AND 30 THEN 'Service Due'
                ELSE 'OK'
            END AS reminderType
            FROM vehicles v
            WHERE v.school_id = ?
            ORDER BY v.status = 'maintenance' DESC,
                LEAST(
                    IFNULL(DATEDIFF(v.insurance_expiry, CURDATE()), 999),
                    IFNULL(DATEDIFF(v.permit_expiry, CURDATE()), 999),
                    IFNULL(DATEDIFF(v.fitness_expiry, CURDATE()), 999),
                    IFNULL(DATEDIFF(v.puc_expiry, CURDATE()), 999),
                    IFNULL(DATEDIFF(v.next_service_date, CURDATE()), 999)
                ) ASC
            LIMIT 5`,
            [schoolId]
        );

        const [recentActivity] = await db.query(
            `SELECT a.id, a.title, a.alert_type AS type, a.message, a.created_at AS createdAt,
                r.route_name AS routeName,
                v.vehicle_number AS vehicleNumber
            FROM transport_alerts a
            LEFT JOIN routes r ON a.route_id = r.id AND r.school_id = a.school_id
            LEFT JOIN vehicles v ON a.vehicle_id = v.id AND v.school_id = a.school_id
            WHERE a.school_id = ?
            ORDER BY a.created_at DESC
            LIMIT 6`,
            [schoolId]
        );

        const [activeTrips] = await db.query(
            `SELECT tt.id, tt.route_id, tt.vehicle_id, tt.status,
                r.route_name AS routeName,
                v.vehicle_number AS vehicleNumber,
                d.first_name AS driverFirst,
                d.last_name AS driverLast
            FROM transport_trips tt
            LEFT JOIN routes r ON r.id = tt.route_id AND r.school_id = tt.school_id
            LEFT JOIN vehicles v ON v.id = tt.vehicle_id AND v.school_id = tt.school_id
            LEFT JOIN drivers dr ON dr.id = tt.driver_id AND dr.school_id = tt.school_id
            LEFT JOIN users d ON dr.user_id = d.id
            WHERE tt.school_id = ? AND tt.trip_date = CURDATE() AND tt.status = 'running'`,
            [schoolId]
        );

        res.render('schoolAdmin/transport/dashboard', {
            title: 'Transport Pro Dashboard',
            stats: {
                totalVehicles: Number(vehicleStats.totalVehicles || 0),
                activeVehicles: Number(vehicleStats.activeVehicles || 0),
                totalRoutes: Number(routeStats.totalRoutes || 0),
                activeRoutes: Number(routeStats.activeRoutes || 0),
                totalDrivers: Number(driverStats.totalDrivers || 0),
                driversOnDuty: Number(driverStats.driversOnDuty || 0),
                studentsUsingTransport: Number(studentStats.studentsUsingTransport || 0),
                runningTripsToday: Number(tripStats.runningTripsToday || 0),
                completedTripsToday: Number(tripStats.completedTripsToday || 0),
                todaysTrips: Number(tripStats.totalTripsToday || 0),
                alerts: Number(alertStats.activeAlerts || 0),
                capacityWarnings: capacityWarnings.length
            },
            tripStatusOverview: {
                running: Number(tripStats.runningTripsToday || 0),
                completed: Number(tripStats.completedTripsToday || 0),
                scheduled: Number(tripStats.scheduledTripsToday || 0),
                cancelled: Number(tripStats.cancelledTripsToday || 0)
            },
            routePerformance,
            maintenanceReminders,
            recentActivity,
            fleetStatus: {
                active: Number(vehicleStats.activeVehicles || 0),
                maintenance: Number(vehicleStats.maintenanceVehicles || 0),
                schoolOwned: Number(vehicleStats.schoolOwnedVehicles || 0),
                contract: Number(vehicleStats.contractVehicles || 0)
            },
            liveMapOverview: {
                activeTrips: activeTrips.map(trip => ({
                    id: trip.id,
                    routeName: trip.routeName,
                    vehicleNumber: trip.vehicleNumber,
                    driverName: trip.driverFirst ? `${trip.driverFirst} ${trip.driverLast}` : 'Unassigned'
                }))
            },
            capacityWarnings,
            currentPath: `${TRANSPORT_BASE_PATH}/dashboard`
        });
    } catch (err) {
        console.error('[Transport Pro dashboard Error]', err);
        req.flash('error', 'Failed to load Transport Pro dashboard');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.listRouteStops = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const routeId = toPositiveInt(req.params.routeId);
        const route = routeId ? await getRouteForSchool(routeId, schoolId) : null;

        if (!route) {
            req.flash('error', 'Route not found');
            return res.redirect(`${TRANSPORT_BASE_PATH}/routes`);
        };

        const [stops] = await db.query(
            `SELECT id, route_id, stop_name AS stopName, stop_address AS stopAddress,
                pickup_time AS pickupTime, drop_time AS dropTime, latitude, longitude,
                stop_order AS stopOrder, estimated_students AS estimatedStudents, status
            FROM transport_route_stops
            WHERE school_id = ? AND route_id = ?
            ORDER BY stop_order ASC, id ASC`,
            [schoolId, routeId]
        );


        const capacity = await calculateRouteCapacity(routeId, schoolId);
        res.render('schoolAdmin/transport/route-stops', {
            title: 'Route Stops',
            route,
            stops,
            capacity,
            currentPath: `${TRANSPORT_BASE_PATH}/routes`
        });
    } catch (err) {
        console.error('[Transport Pro listRouteStops Error]', err);
        req.flash('error', 'Failed to load route stops');
        res.redirect(`${TRANSPORT_BASE_PATH}/routes`);
    };
};

exports.createRouteStop = async (req, res) => {
    const schoolId = req.session.user.school_id;
    const routeId = toPositiveInt(req.params.routeId);

    try {
        const route = routeId ? await getRouteForSchool(routeId, schoolId) : null;
        if (!route) {
            req.flash('error', 'Route not found');
            return res.redirect(`${TRANSPORT_BASE_PATH}/routes`);
        };

        const { stopName, stopAddress, pickupTime, dropTime, latitude, longitude, stopOrder, estimatedStudents, status } = req.body;
        if (!stopName || !stopName.trim()) {
            req.flash('error', 'Stop name is required');
            return res.redirect(`${TRANSPORT_BASE_PATH}/routes/${routeId}/stops`);
        };

        await db.query(
            `INSERT INTO transport_route_stops
            (school_id, route_id, stop_name, stop_address, pickup_time, drop_time, latitude, longitude,
            stop_order, estimated_students, status, created_by, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [ schoolId, routeId, stopName.trim(), stopAddress || null, normalizeTime(pickupTime), normalizeTime(dropTime), normalizeDecimal(latitude), normalizeDecimal(longitude), toPositiveInt(stopOrder) || 1, Math.max(toPositiveInt(estimatedStudents) || 0, 0), normalizeStatus(status, ['active', 'inactive'], 'active'), req.session.user.id || null, req.session.user.id || null ]
        );
        req.flash('success', 'Route stop added successfully');
        res.redirect(`${TRANSPORT_BASE_PATH}/routes/${routeId}/stops`);
    } catch (err) {
        console.error('[Transport Pro createRouteStop Error]', err);
        req.flash('error', 'Failed to add route stop');
        res.redirect(routeId ? `${TRANSPORT_BASE_PATH}/routes/${routeId}/stops` : `${TRANSPORT_BASE_PATH}/routes`);
    };
};

exports.createDefaultRouteStops = async (req, res) => {
    const schoolId = req.session.user.school_id;
    const routeId = toPositiveInt(req.params.routeId);

    try {
        const route = routeId ? await getRouteForSchool(routeId, schoolId) : null;
        if (!route) {
            req.flash('error', 'Route not found');
            return res.redirect(`${TRANSPORT_BASE_PATH}/routes`);
        };

        const names = Array.isArray(req.body.stopName) ? req.body.stopName : [req.body.stopName];
        const pickupTimes = Array.isArray(req.body.pickupTime) ? req.body.pickupTime : [req.body.pickupTime];
        const dropTimes = Array.isArray(req.body.dropTime) ? req.body.dropTime : [req.body.dropTime];

        let created = 0;
        for (let index = 0; index < names.length; index += 1) {
            const stopName = String(names[index] || '').trim();
            if (!stopName) continue;

            const [[existing]] = await db.query(
                `SELECT id FROM transport_route_stops
                WHERE school_id = ? AND route_id = ? AND stop_name = ? AND stop_order = ?
                LIMIT 1`,
                [schoolId, routeId, stopName, index + 1]
            );
            
            if (existing) continue;
            await db.query(
                `INSERT INTO transport_route_stops
                (school_id, route_id, stop_name, stop_address, pickup_time, drop_time, stop_order, estimated_students, status, created_by, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?)`,
                [ schoolId, routeId, stopName, index === 0 ? route.startPoint : index === names.length - 1 ? route.endPoint : null, normalizeTime(pickupTimes[index]), normalizeTime(dropTimes[index]), index + 1, req.session.user.id || null, req.session.user.id || null ]
            );
            created += 1;
        };
        req.flash(created ? 'success' : 'error', created ? `${created} default stops added` : 'No new default stops were added');
        res.redirect(`${TRANSPORT_BASE_PATH}/routes/${routeId}/stops`);
    } catch (err) {
        console.error('[Transport Pro createDefaultRouteStops Error]', err);
        req.flash('error', 'Failed to add default stops');
        res.redirect(routeId ? `${TRANSPORT_BASE_PATH}/routes/${routeId}/stops` : `${TRANSPORT_BASE_PATH}/routes`);
    };
};

exports.updateRouteStop = async (req, res) => {
    const schoolId = req.session.user.school_id;
    const stopId = toPositiveInt(req.params.id);

    try {
        const stop = stopId ? await getStopForSchool(stopId, schoolId) : null;
        if (!stop) {
            req.flash('error', 'Stop not found');
            return res.redirect(`${TRANSPORT_BASE_PATH}/routes`);
        };

        const { stopName, stopAddress, pickupTime, dropTime, latitude, longitude, stopOrder, estimatedStudents, status } = req.body;
        if (!stopName || !stopName.trim()) {
            req.flash('error', 'Stop name is required');
            return res.redirect(`${TRANSPORT_BASE_PATH}/routes/${stop.route_id}/stops`);
        };

        await db.query(
            `UPDATE transport_route_stops
            SET stop_name = ?, stop_address = ?, pickup_time = ?, drop_time = ?,
                latitude = ?, longitude = ?, stop_order = ?, estimated_students = ?,
                status = ?, updated_by = ?
            WHERE id = ? AND school_id = ?`,
            [ stopName.trim(), stopAddress || null, normalizeTime(pickupTime), normalizeTime(dropTime), normalizeDecimal(latitude), normalizeDecimal(longitude), toPositiveInt(stopOrder) || 1, Math.max(toPositiveInt(estimatedStudents) || 0, 0), normalizeStatus(status, ['active', 'inactive'], 'active'), req.session.user.id || null, stopId, schoolId ]
        );

        req.flash('success', 'Route stop updated successfully');
        res.redirect(`${TRANSPORT_BASE_PATH}/routes/${stop.route_id}/stops`);
    } catch (err) {
        console.error('[Transport Pro updateRouteStop Error]', err);
        req.flash('error', 'Failed to update route stop');
        res.redirect(`${TRANSPORT_BASE_PATH}/routes`);
    };
};

exports.deleteRouteStop = async (req, res) => {
    const schoolId = req.session.user.school_id;
    const stopId = toPositiveInt(req.params.id);

    try {
        const stop = stopId ? await getStopForSchool(stopId, schoolId) : null;
        if (!stop) {
            req.flash('error', 'Stop not found');
            return res.redirect(`${TRANSPORT_BASE_PATH}/routes`);
        }

        await db.query(
            `UPDATE transport_route_stops
            SET status = 'inactive', updated_by = ?
            WHERE id = ? AND school_id = ?`,
            [req.session.user.id || null, stopId, schoolId]
        );

        req.flash('success', 'Route stop deactivated successfully');
        res.redirect(`${TRANSPORT_BASE_PATH}/routes/${stop.route_id}/stops`);
    } catch (err) {
        console.error('[Transport Pro deleteRouteStop Error]', err);
        req.flash('error', 'Failed to deactivate route stop');
        res.redirect(`${TRANSPORT_BASE_PATH}/routes`);
    };
};

exports.routeStopsJson = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const routeId = toPositiveInt(req.params.routeId);
        const route = routeId ? await getRouteForSchool(routeId, schoolId) : null;

        if (!route) {
            return res.status(404).json({ success: false, message: 'Route not found', stops: [] });
        };

        const [stops] = await db.query(
            `SELECT id, stop_name AS stopName, stop_address AS stopAddress,
                latitude, longitude,
                pickup_time AS pickupTime, drop_time AS dropTime,
                stop_order AS stopOrder, status
            FROM transport_route_stops
            WHERE school_id = ? AND route_id = ? AND status = 'active'
            ORDER BY stop_order ASC, id ASC`,
            [schoolId, routeId]
        );

        res.json({ success: true, route, stops });
    } catch (err) {
        console.error('[Transport Pro routeStopsJson Error]', err);
        res.status(500).json({ success: false, message: 'Failed to load stops', stops: [] });
    };
};

exports.listAllocations = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const [allocations] = await db.query(
            `SELECT sta.id, sta.student_id AS studentId, sta.route_id AS routeId,
                sta.pickup_stop_id AS pickupStopId, sta.drop_stop_id AS dropStopId,
                sta.pickup_address AS pickupAddress, sta.pickup_latitude AS pickupLatitude,
                sta.pickup_longitude AS pickupLongitude, sta.drop_address AS dropAddress,
                sta.drop_latitude AS dropLatitude, sta.drop_longitude AS dropLongitude,
                sta.fee_plan_id AS feePlanId,
                sta.allocation_start_date AS allocationStartDate,
                sta.allocation_end_date AS allocationEndDate,
                sta.pickup_required AS pickupRequired, sta.drop_required AS dropRequired,
                sta.status, sta.notes,
                u.first_name AS first_name, u.last_name AS last_name,
                c.class_name, c.section,
                r.route_name AS routeName,
                ps.stop_name AS pickupStopName,
                ds.stop_name AS dropStopName
            FROM student_transport_allocations sta
            JOIN students s ON sta.student_id = s.id AND s.school_id = sta.school_id
            LEFT JOIN student_address_transport sat ON sat.student_id = s.id
            JOIN users u ON s.user_id = u.id
            LEFT JOIN classes c ON s.class_id = c.id
            JOIN routes r ON sta.route_id = r.id AND r.school_id = sta.school_id
            LEFT JOIN transport_route_stops ps ON sta.pickup_stop_id = ps.id AND ps.school_id = sta.school_id
            LEFT JOIN transport_route_stops ds ON sta.drop_stop_id = ds.id AND ds.school_id = sta.school_id
            WHERE sta.school_id = ?
                AND (sta.status <> 'active' OR COALESCE(sat.transport_required, 0) = 1)
            ORDER BY sta.status = 'active' DESC, r.route_name ASC, u.first_name ASC, u.last_name ASC`,
            [schoolId]
        );

        const capacityWarnings = await getCapacityWarnings(schoolId);
        const [routes] = await db.query(
            `SELECT r.id, r.route_name AS routeName,
                COALESCE(v.vehicle_number, '') AS vehicleNumber,
                COALESCE(v.capacity, 0) AS vehicleCapacity
            FROM routes r
            LEFT JOIN vehicles v ON r.vehicle_id = v.id AND v.school_id = r.school_id
            WHERE r.school_id = ? AND r.status = 'active'
            ORDER BY r.route_name ASC`,
            [schoolId]
        );
        const [stops] = await db.query(
            `SELECT id, route_id AS routeId, stop_name AS stopName, stop_order AS stopOrder
            FROM transport_route_stops
            WHERE school_id = ? AND status = 'active'
            ORDER BY route_id ASC, stop_order ASC, id ASC`,
            [schoolId]
        );

        const allocationSummary = {
            totalAllocations: allocations.length,
            activeAllocations: allocations.filter(a => a.status === 'active').length,
            pausedAllocations: allocations.filter(a => a.status === 'paused').length,
            inactiveAllocations: allocations.filter(a => a.status === 'inactive').length,
            incompleteAssignments: allocations.filter(a => !a.pickupStopId || !a.dropStopId).length
        };

        const routeAllocationMap = routes.reduce((acc, route) => {
            acc[route.id] = {
                routeId: route.id,
                routeName: route.routeName,
                vehicleNumber: route.vehicleNumber,
                vehicleCapacity: route.vehicleCapacity,
                allocations: 0,
                activeAllocations: 0,
                incompleteAssignments: 0
            };
            return acc;
        }, {});

        allocations.forEach((allocation) => {
            const routeSummary = routeAllocationMap[allocation.routeId];
            if (routeSummary) {
                routeSummary.allocations += 1;
                if (allocation.status === 'active') {
                    routeSummary.activeAllocations += 1;
                };
                if (!allocation.pickupStopId || !allocation.dropStopId) {
                    routeSummary.incompleteAssignments += 1;
                };
            };
        });

        const routeSummaries = Object.values(routeAllocationMap);
        res.render('schoolAdmin/transport/allocations', {
            title: 'Student Transport Allocations',
            allocations,
            allocationSummary,
            routeSummaries,
            capacityWarnings,
            routes,
            stops,
            currentPath: `${TRANSPORT_BASE_PATH}/allocations`
        });
    } catch (err) {
        console.error('[Transport Pro listAllocations Error]', err);
        req.flash('error', 'Failed to load transport allocations');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.bulkAssignAllocationStops = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const routeId = toPositiveInt(req.body.routeId);
        const pickupStopId = toPositiveInt(req.body.pickupStopId);
        const dropStopId = toPositiveInt(req.body.dropStopId);
        const allocationIds = (Array.isArray(req.body.allocationIds) ? req.body.allocationIds : [req.body.allocationIds]) .map(toPositiveInt) .filter(Boolean);
        const route = routeId ? await getRouteForSchool(routeId, schoolId) : null;
        if (!route || !allocationIds.length) {
            req.flash('error', 'Select a valid route and at least one student');
            return res.redirect(`${TRANSPORT_BASE_PATH}/allocations`);
        };

        if (pickupStopId) {
            const stop = await getStopForSchool(pickupStopId, schoolId);
            if (!stop || Number(stop.route_id) !== routeId) {
                req.flash('error', 'Pickup stop does not belong to selected route');
                return res.redirect(`${TRANSPORT_BASE_PATH}/allocations`);
            };
        };

        if (dropStopId) {
            const stop = await getStopForSchool(dropStopId, schoolId);
            if (!stop || Number(stop.route_id) !== routeId) {
                req.flash('error', 'Drop stop does not belong to selected route');
                return res.redirect(`${TRANSPORT_BASE_PATH}/allocations`);
            };
        };

        if (!pickupStopId && !dropStopId) {
            req.flash('error', 'Select pickup or drop stop');
            return res.redirect(`${TRANSPORT_BASE_PATH}/allocations`);
        };

        const [ownedAllocations] = await db.query(
            `SELECT id
            FROM student_transport_allocations
            WHERE school_id = ? AND route_id = ? AND status = 'active' AND id IN (?)`,
            [schoolId, routeId, allocationIds]
        );
        
        const ownedIds = ownedAllocations.map(row => row.id);
        if (!ownedIds.length) {
            req.flash('error', 'No selected active allocations matched this route');
            return res.redirect(`${TRANSPORT_BASE_PATH}/allocations`);
        };

        await db.query(
            `UPDATE student_transport_allocations
            SET pickup_stop_id = COALESCE(?, pickup_stop_id),
                drop_stop_id = COALESCE(?, drop_stop_id),
                stop_id = COALESCE(?, pickup_stop_id, drop_stop_id, stop_id),
                updated_by = ?
            WHERE school_id = ? AND route_id = ? AND id IN (?)`,
            [ pickupStopId || null, dropStopId || null, pickupStopId || dropStopId || null, req.session.user.id || null, schoolId, routeId, ownedIds ]
        );

        req.flash('success', `${ownedIds.length} student allocation(s) updated`);
        res.redirect(`${TRANSPORT_BASE_PATH}/allocations`);
    } catch (err) {
        console.error('[Transport Pro bulkAssignAllocationStops Error]', err);
        req.flash('error', 'Failed to bulk assign stops');
        res.redirect(`${TRANSPORT_BASE_PATH}/allocations`);
    };
};

exports.newAllocationForm = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const routeId = toPositiveInt(req.query.route_id);

        const [students] = await db.query(
            `SELECT s.id, u.first_name AS first_name, u.last_name AS last_name, c.class_name, c.section
            FROM students s
            JOIN users u ON s.user_id = u.id
            LEFT JOIN classes c ON s.class_id = c.id
            LEFT JOIN student_address_transport sat ON sat.student_id = s.id AND sat.transport_required = 1
            WHERE s.school_id = ? AND s.deleted_at IS NULL
            ORDER BY c.class_name, c.section, u.first_name, u.last_name`,
            [schoolId]
        );

        const [routes] = await db.query(
            `SELECT r.id, r.route_name AS routeName, r.status,
                v.vehicle_number AS vehicleNumber, v.capacity AS capacity
            FROM routes r
            LEFT JOIN vehicles v ON r.vehicle_id = v.id AND v.school_id = r.school_id
            WHERE r.school_id = ? AND r.status = 'active'
            ORDER BY r.route_name ASC`,
            [schoolId]
        );

        const [feePlans] = await db.query(
            `SELECT id, plan_name AS planName, route_id AS routeId, stop_id AS stopId,
                fee_amount AS feeAmount, billing_cycle AS billingCycle
            FROM transport_fee_plans
            WHERE school_id = ? AND status = 'active'
            ORDER BY plan_name ASC`,
            [schoolId]
        );

        const [stops] = routeId
            ? await db.query(
                `SELECT id, route_id AS routeId, stop_name AS stopName
                FROM transport_route_stops
                WHERE school_id = ? AND route_id = ? AND status = 'active'
                ORDER BY stop_order ASC, id ASC`,
                [schoolId, routeId]
            )
            : await db.query(
                `SELECT id, route_id AS routeId, stop_name AS stopName
                FROM transport_route_stops
                WHERE school_id = ? AND status = 'active'
                ORDER BY route_id ASC, stop_order ASC, id ASC`,
                [schoolId]
            );

        res.render('schoolAdmin/transport/allocation-form', {
            title: 'New Transport Allocation',
            allocation: null,
            students,
            routes,
            stops,
            feePlans,
            selectedRouteId: routeId,
            currentPath: `${TRANSPORT_BASE_PATH}/allocations`
        });
    } catch (err) {
        console.error('[Transport Pro newAllocationForm Error]', err);
        req.flash('error', 'Failed to load allocation form');
        res.redirect(`${TRANSPORT_BASE_PATH}/allocations`);
    };
};

async function validateAllocationPayload(body, schoolId) {
    const studentId = toPositiveInt(body.studentId);
    const routeId = toPositiveInt(body.routeId);
    const pickupStopId = toPositiveInt(body.pickupStopId);
    const dropStopId = toPositiveInt(body.dropStopId);
    const feePlanId = toPositiveInt(body.feePlanId);
    const pickupLatitude = normalizeDecimal(body.pickupLatitude);
    const pickupLongitude = normalizeDecimal(body.pickupLongitude);
    const dropLatitude = normalizeDecimal(body.dropLatitude);
    const dropLongitude = normalizeDecimal(body.dropLongitude);

    const student = studentId ? await getStudentForSchool(studentId, schoolId) : null;
    if (!student) return { error: 'Please select a valid student' };

    const route = routeId ? await getRouteForSchool(routeId, schoolId) : null;
    if (!route) return { error: 'Please select a valid route' };

    if (pickupStopId) {
        const pickupStop = await getStopForSchool(pickupStopId, schoolId);
        if (!pickupStop || Number(pickupStop.route_id) !== routeId) {
            return { error: 'Pickup stop does not belong to selected route' };
        };
    };

    if (dropStopId) {
        const dropStop = await getStopForSchool(dropStopId, schoolId);
        if (!dropStop || Number(dropStop.route_id) !== routeId) {
            return { error: 'Drop stop does not belong to selected route' };
        };
    };

    if (feePlanId) {
        const [[feePlan]] = await db.query(
            `SELECT id FROM transport_fee_plans WHERE id = ? AND school_id = ? AND status = 'active' LIMIT 1`,
            [feePlanId, schoolId]
        );
        if (!feePlan) return { error: 'Selected fee plan is invalid' };
    };

    return {
        route,
        payload: {
            studentId,
            routeId,
            stopId: pickupStopId || dropStopId || null,
            pickupStopId: pickupStopId || null,
            dropStopId: dropStopId || null,
            pickupAddress: body.pickupAddress?.trim() || null,
            pickupLatitude,
            pickupLongitude,
            dropAddress: body.dropAddress?.trim() || null,
            dropLatitude,
            dropLongitude,
            feePlanId: feePlanId || null,
            allocationStartDate: body.allocationStartDate || new Date().toISOString().slice(0, 10),
            allocationEndDate: body.allocationEndDate || null,
            pickupRequired: body.pickupRequired ? 1 : 0,
            dropRequired: body.dropRequired ? 1 : 0,
            status: normalizeStatus(body.status, ['active', 'inactive', 'paused'], 'active'),
            notes: body.notes || null
        }
    };
};

exports.createAllocation = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const validation = await validateAllocationPayload(req.body, schoolId);

        if (validation.error) {
            req.flash('error', validation.error);
            return res.redirect(`${TRANSPORT_BASE_PATH}/allocations/new`);
        }

        const data = validation.payload;
        const [[dupCheck]] = await db.query(
            `SELECT id FROM student_transport_allocations
             WHERE school_id = ? AND student_id = ? AND route_id = ? AND status = 'active' LIMIT 1`,
            [schoolId, data.studentId, data.routeId]
        );
        if (dupCheck) {
            req.flash('error', 'This student already has an active allocation on this route.');
            return res.redirect(`${TRANSPORT_BASE_PATH}/allocations/new`);
        };

        if (data.status === 'active') {
            const capacityCheck = await ensureRouteHasAvailableSeat(validation.route, schoolId, {
                excludeStudentId: data.studentId
            });
            if (capacityCheck.error) {
                req.flash('error', capacityCheck.error);
                return res.redirect(`${TRANSPORT_BASE_PATH}/allocations/new`);
            };
        };

        await db.query(
            `INSERT INTO student_transport_allocations
            (school_id, student_id, route_id, stop_id, pickup_stop_id, drop_stop_id,
                pickup_address, pickup_latitude, pickup_longitude, drop_address, drop_latitude, drop_longitude, fee_plan_id,
                allocation_start_date, allocation_end_date, pickup_required, drop_required, status,
                notes, created_by, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [ schoolId, data.studentId, data.routeId, data.stopId, data.pickupStopId, data.dropStopId, data.pickupAddress, data.pickupLatitude, data.pickupLongitude, data.dropAddress, data.dropLatitude, data.dropLongitude, data.feePlanId, data.allocationStartDate, data.allocationEndDate, data.pickupRequired, data.dropRequired, data.status, data.notes, req.session.user.id || null, req.session.user.id || null ]
        );

        req.flash('success', 'Student transport allocation created successfully');
        res.redirect(`${TRANSPORT_BASE_PATH}/allocations`);
    } catch (err) {
        console.error('[Transport Pro createAllocation Error]', err);
        req.flash('error', 'Failed to create transport allocation');
        res.redirect(`${TRANSPORT_BASE_PATH}/allocations/new`);
    };
};

exports.updateAllocation = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const allocationId = toPositiveInt(req.params.id);
        const [[allocation]] = await db.query(
            `SELECT id FROM student_transport_allocations WHERE id = ? AND school_id = ? LIMIT 1`,
            [allocationId, schoolId]
        );

        if (!allocation) {
            req.flash('error', 'Allocation not found');
            return res.redirect(`${TRANSPORT_BASE_PATH}/allocations`);
        };

        const validation = await validateAllocationPayload(req.body, schoolId);
        if (validation.error) {
            req.flash('error', validation.error);
            return res.redirect(`${TRANSPORT_BASE_PATH}/allocations`);
        };

        const data = validation.payload;
        if (data.status === 'active') {
            const capacityCheck = await ensureRouteHasAvailableSeat(validation.route, schoolId, {
                excludeAllocationId: allocationId,
                excludeStudentId: data.studentId
            });
            if (capacityCheck.error) {
                req.flash('error', capacityCheck.error);
                return res.redirect(`${TRANSPORT_BASE_PATH}/allocations`);
            };
        };

        await db.query(
            `UPDATE student_transport_allocations
            SET student_id = ?, route_id = ?, stop_id = ?, pickup_stop_id = ?, drop_stop_id = ?,
                pickup_address = ?, pickup_latitude = ?, pickup_longitude = ?,
                drop_address = ?, drop_latitude = ?, drop_longitude = ?,
                fee_plan_id = ?, allocation_start_date = ?, allocation_end_date = ?,
                pickup_required = ?, drop_required = ?, status = ?, notes = ?, updated_by = ?
            WHERE id = ? AND school_id = ?`,
            [ data.studentId, data.routeId, data.stopId, data.pickupStopId, data.dropStopId, data.pickupAddress, data.pickupLatitude, data.pickupLongitude, data.dropAddress, data.dropLatitude, data.dropLongitude, data.feePlanId, data.allocationStartDate, data.allocationEndDate, data.pickupRequired, data.dropRequired, data.status, data.notes, req.session.user.id || null, allocationId, schoolId ]
        );

        req.flash('success', 'Transport allocation updated successfully');
        res.redirect(`${TRANSPORT_BASE_PATH}/allocations`);
    } catch (err) {
        console.error('[Transport Pro updateAllocation Error]', err);
        req.flash('error', 'Failed to update allocation');
        res.redirect(`${TRANSPORT_BASE_PATH}/allocations`);
    };
};

exports.deactivateAllocation = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const allocationId = toPositiveInt(req.params.id);

        await db.query(
            `UPDATE student_transport_allocations
            SET status = 'inactive', allocation_end_date = COALESCE(allocation_end_date, CURDATE()), updated_by = ?
            WHERE id = ? AND school_id = ?`,
            [req.session.user.id || null, allocationId, schoolId]
        );

        req.flash('success', 'Transport allocation deactivated');
        res.redirect(`${TRANSPORT_BASE_PATH}/allocations`);
    } catch (err) {
        console.error('[Transport Pro deactivateAllocation Error]', err);
        req.flash('error', 'Failed to deactivate allocation');
        res.redirect(`${TRANSPORT_BASE_PATH}/allocations`);
    };
};

exports.maintenance = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const vehicles = await getVehiclesForSchool(schoolId);
        const [records] = await db.query(
            `SELECT vsr.*, v.vehicle_number AS vehicleNumber, v.model AS vehicleModel
            FROM vehicle_service_records vsr
            JOIN vehicles v ON vsr.vehicle_id = v.id AND v.school_id = vsr.school_id
            WHERE vsr.school_id = ?
            ORDER BY vsr.service_date DESC, vsr.id DESC`,
            [schoolId]
        );
        const [upcoming] = await db.query(
            `SELECT vsr.id, vsr.next_service_date AS nextServiceDate, vsr.service_type AS serviceType,
                v.vehicle_number AS vehicleNumber
            FROM vehicle_service_records vsr
            JOIN vehicles v ON vsr.vehicle_id = v.id AND v.school_id = vsr.school_id
            WHERE vsr.school_id = ? AND vsr.next_service_date IS NOT NULL
                AND vsr.next_service_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
            ORDER BY vsr.next_service_date ASC
            LIMIT 8`,
            [schoolId]
        );

        res.render('schoolAdmin/transport/maintenance', {
            title: 'Transport Maintenance',
            vehicles,
            records,
            upcoming,
            currentPath: `${TRANSPORT_BASE_PATH}/maintenance`
        });
    } catch (err) {
        console.error('[Transport maintenance]', err);
        req.flash('error', 'Failed to load maintenance records');
        res.redirect(`${TRANSPORT_BASE_PATH}/dashboard`);
    };
};

exports.createMaintenance = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const vehicleId = toPositiveInt(req.body.vehicleId);
        const vehicles = await getVehiclesForSchool(schoolId);
        if (!vehicles.some(v => Number(v.id) === vehicleId)) {
            req.flash('error', 'Select a valid vehicle');
            return res.redirect(`${TRANSPORT_BASE_PATH}/maintenance`);
        };

        const notes = [
            req.body.status ? `Status: ${req.body.status}` : null,
            req.body.invoiceNumber ? `Invoice: ${req.body.invoiceNumber}` : null,
            req.body.notes || null
        ].filter(Boolean).join('\n');

        await db.query(
            `INSERT INTO vehicle_service_records
            (school_id, vehicle_id, service_date, service_type, odometer_reading, vendor_name, amount, next_service_date, notes, created_by, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [ schoolId, vehicleId, normalizeDate(req.body.serviceDate) || new Date().toISOString().slice(0, 10), req.body.serviceType || null, toPositiveInt(req.body.odometerReading), req.body.vendorName || null, normalizeMoney(req.body.amount), normalizeDate(req.body.nextServiceDate), notes || null, req.session.user.id || null, req.session.user.id || null ]
        );

        req.flash('success', 'Service record added');
        res.redirect(`${TRANSPORT_BASE_PATH}/maintenance`);
    } catch (err) {
        console.error('[Transport createMaintenance]', err);
        req.flash('error', 'Failed to add service record');
        res.redirect(`${TRANSPORT_BASE_PATH}/maintenance`);
    };
};

exports.updateMaintenance = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const id = toPositiveInt(req.params.id);
        const vehicleId = toPositiveInt(req.body.vehicleId);
        const vehicles = await getVehiclesForSchool(schoolId);
        if (!id || !vehicles.some(v => Number(v.id) === vehicleId)) {
            req.flash('error', 'Invalid maintenance update');
            return res.redirect(`${TRANSPORT_BASE_PATH}/maintenance`);
        };
        const notes = [
            req.body.status ? `Status: ${req.body.status}` : null,
            req.body.invoiceNumber ? `Invoice: ${req.body.invoiceNumber}` : null,
            req.body.notes || null
        ].filter(Boolean).join('\n');

        await db.query(
            `UPDATE vehicle_service_records
            SET vehicle_id = ?, service_date = ?, service_type = ?, odometer_reading = ?,
                vendor_name = ?, amount = ?, next_service_date = ?, notes = ?, updated_by = ?
            WHERE id = ? AND school_id = ?`,
            [ vehicleId, normalizeDate(req.body.serviceDate) || new Date().toISOString().slice(0, 10), req.body.serviceType || null, toPositiveInt(req.body.odometerReading), req.body.vendorName || null, normalizeMoney(req.body.amount), normalizeDate(req.body.nextServiceDate), notes || null, req.session.user.id || null, id, schoolId ]
        );
        req.flash('success', 'Service record updated');
        res.redirect(`${TRANSPORT_BASE_PATH}/maintenance`);
    } catch (err) {
        console.error('[Transport updateMaintenance]', err);
        req.flash('error', 'Failed to update service record');
        res.redirect(`${TRANSPORT_BASE_PATH}/maintenance`);
    };
};

exports.deleteMaintenance = async (req, res) => {
    try {
        await db.query('DELETE FROM vehicle_service_records WHERE id = ? AND school_id = ?', [
            toPositiveInt(req.params.id),
            req.session.user.school_id
        ]);
        req.flash('success', 'Service record removed');
        res.redirect(`${TRANSPORT_BASE_PATH}/maintenance`);
    } catch (err) {
        console.error('[Transport deleteMaintenance]', err);
        req.flash('error', 'Failed to remove service record');
        res.redirect(`${TRANSPORT_BASE_PATH}/maintenance`);
    };
};

exports.feePlans = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const routes = await getRoutesForSchool(schoolId);
        const feePlanColumns = await getTableColumnSet('transport_fee_plans', ['late_fee', 'due_day']);
        const hasLateFee = feePlanColumns.has('late_fee');
        const hasDueDay = feePlanColumns.has('due_day');
        const [stops] = await db.query(
            `SELECT id, route_id AS routeId, stop_name AS stopName, stop_order AS stopOrder
            FROM transport_route_stops
            WHERE school_id = ? AND status = 'active'
            ORDER BY route_id ASC, stop_order ASC, id ASC`,
            [schoolId]
        );
        const [plans] = await db.query(
            `SELECT tfp.id, tfp.plan_name AS planName, tfp.route_id AS routeId, tfp.stop_id AS stopId,
                tfp.fee_amount AS feeAmount, tfp.billing_cycle AS billingCycle,
                ${hasLateFee ? 'tfp.late_fee' : '0'} AS lateFee,
                ${hasDueDay ? 'tfp.due_day' : 'NULL'} AS dueDay,
                tfp.effective_from AS effectiveFrom, tfp.effective_to AS effectiveTo, tfp.status,
                r.route_name AS routeName, trs.stop_name AS stopName
            FROM transport_fee_plans tfp
            LEFT JOIN routes r ON tfp.route_id = r.id AND r.school_id = tfp.school_id
            LEFT JOIN transport_route_stops trs ON tfp.stop_id = trs.id AND trs.school_id = tfp.school_id
            WHERE tfp.school_id = ?
            ORDER BY tfp.status = 'active' DESC, r.route_name ASC, tfp.plan_name ASC`,
            [schoolId]
        );

        res.render('schoolAdmin/transport/fee-plans', {
            title: 'Transport Fee Plans',
            routes,
            stops,
            plans,
            supportsAdvancedFeeFields: hasLateFee && hasDueDay,
            currentPath: `${TRANSPORT_BASE_PATH}/fee-plans`
        });
    } catch (err) {
        console.error('[Transport feePlans]', err);
        req.flash('error', 'Failed to load fee plans');
        res.redirect(`${TRANSPORT_BASE_PATH}/dashboard`);
    };
};

async function validateFeePlanPayload(body, schoolId) {
    const routeId = toPositiveInt(body.routeId);
    const stopId = toPositiveInt(body.stopId);

    if (routeId) {
        const route = await getRouteForSchool(routeId, schoolId);
        if (!route) return { error: 'Selected route is invalid' };
    };

    if (stopId) {
        const stop = await getStopForSchool(stopId, schoolId);
        if (!stop) return { error: 'Selected stop is invalid' };
        if (routeId && Number(stop.route_id) !== routeId) return { error: 'Selected stop does not belong to selected route' };
    };

    const billingCycle = normalizeStatus(
        body.billingCycle,
        ['monthly', 'quarterly', 'half_yearly', 'yearly'],
        'monthly'
    );

    return {
        payload: {
            planName: String(body.planName || '').trim(),
            routeId: routeId || null,
            stopId: stopId || null,
            feeAmount: normalizeMoney(body.feeAmount),
            lateFee: normalizeMoney(body.lateFee),
            dueDay: toPositiveInt(body.dueDay),
            billingCycle,
            effectiveFrom: normalizeDate(body.effectiveFrom) || new Date().toISOString().slice(0, 10),
            effectiveTo: normalizeDate(body.effectiveTo),
            status: normalizeStatus(body.status, ['active', 'inactive'], 'active')
        }
    };
};

exports.createFeePlan = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const validation = await validateFeePlanPayload(req.body, schoolId);
        if (validation.error || !validation.payload.planName) {
            req.flash('error', validation.error || 'Plan name is required');
            return res.redirect(`${TRANSPORT_BASE_PATH}/fee-plans`);
        };

        const data = validation.payload;
        const feePlanColumns = await getTableColumnSet('transport_fee_plans', ['late_fee', 'due_day']);
        const extraColumns = [];
        const extraValues = [];
        if (feePlanColumns.has('late_fee')) {
            extraColumns.push('late_fee');
            extraValues.push(data.lateFee);
        };
        if (feePlanColumns.has('due_day')) {
            extraColumns.push('due_day');
            extraValues.push(data.dueDay);
        };
        await db.query(
            `INSERT INTO transport_fee_plans
            (school_id, plan_name, route_id, stop_id, fee_amount${extraColumns.length ? `, ${extraColumns.join(', ')}` : ''}, billing_cycle, effective_from, effective_to, status, created_by, updated_by)
            VALUES (?, ?, ?, ?, ?${extraColumns.map(() => ', ?').join('')}, ?, ?, ?, ?, ?, ?)`,
            [ schoolId, data.planName, data.routeId, data.stopId, data.feeAmount, ...extraValues, data.billingCycle, data.effectiveFrom, data.effectiveTo, data.status, req.session.user.id || null, req.session.user.id || null ]
        );

        req.flash('success', 'Fee plan added');
        res.redirect(`${TRANSPORT_BASE_PATH}/fee-plans`);
    } catch (err) {
        console.error('[Transport createFeePlan]', err);
        req.flash('error', 'Failed to add fee plan');
        res.redirect(`${TRANSPORT_BASE_PATH}/fee-plans`);
    };
};

exports.updateFeePlan = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const id = toPositiveInt(req.params.id);
        const [[existing]] = await db.query(
            `SELECT id FROM transport_fee_plans WHERE id = ? AND school_id = ? LIMIT 1`,
            [id, schoolId]
        );
        if (!existing) {
            req.flash('error', 'Fee plan not found');
            return res.redirect(`${TRANSPORT_BASE_PATH}/fee-plans`);
        };

        const validation = await validateFeePlanPayload(req.body, schoolId);
        if (validation.error || !validation.payload.planName) {
            req.flash('error', validation.error || 'Plan name is required');
            return res.redirect(`${TRANSPORT_BASE_PATH}/fee-plans`);
        };

        const data = validation.payload;
        const feePlanColumns = await getTableColumnSet('transport_fee_plans', ['late_fee', 'due_day']);
        const extraAssignments = [];
        const extraValues = [];
        if (feePlanColumns.has('late_fee')) {
            extraAssignments.push('late_fee = ?');
            extraValues.push(data.lateFee);
        };
        if (feePlanColumns.has('due_day')) {
            extraAssignments.push('due_day = ?');
            extraValues.push(data.dueDay);
        };
        await db.query(
            `UPDATE transport_fee_plans
            SET plan_name = ?, route_id = ?, stop_id = ?, fee_amount = ?,
                ${extraAssignments.length ? `${extraAssignments.join(', ')},` : ''}
                billing_cycle = ?,
                effective_from = ?, effective_to = ?, status = ?, updated_by = ?
            WHERE id = ? AND school_id = ?`,
            [ data.planName, data.routeId, data.stopId, data.feeAmount, ...extraValues, data.billingCycle, data.effectiveFrom, data.effectiveTo, data.status, req.session.user.id || null, id, schoolId]
        );

        req.flash('success', 'Fee plan updated');
        res.redirect(`${TRANSPORT_BASE_PATH}/fee-plans`);
    } catch (err) {
        console.error('[Transport updateFeePlan]', err);
        req.flash('error', 'Failed to update fee plan');
        res.redirect(`${TRANSPORT_BASE_PATH}/fee-plans`);
    };
};

exports.deleteFeePlan = async (req, res) => {
    try {
        await db.query(
            `UPDATE transport_fee_plans SET status = 'inactive', updated_by = ? WHERE id = ? AND school_id = ?`,
            [req.session.user.id || null, toPositiveInt(req.params.id), req.session.user.school_id]
        );
        req.flash('success', 'Fee plan deactivated');
        res.redirect(`${TRANSPORT_BASE_PATH}/fee-plans`);
    } catch (err) {
        console.error('[Transport deleteFeePlan]', err);
        req.flash('error', 'Failed to deactivate fee plan');
        res.redirect(`${TRANSPORT_BASE_PATH}/fee-plans`);
    };
};

exports.alerts = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const [alerts] = await db.query(
            `SELECT ta.*, r.route_name AS routeName, v.vehicle_number AS vehicleNumber,
                CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) AS studentName
            FROM transport_alerts ta
            LEFT JOIN routes r ON ta.route_id = r.id AND r.school_id = ta.school_id
            LEFT JOIN vehicles v ON ta.vehicle_id = v.id AND v.school_id = ta.school_id
            LEFT JOIN students s ON ta.student_id = s.id AND s.school_id = ta.school_id
            LEFT JOIN users u ON s.user_id = u.id
            WHERE ta.school_id = ?
            ORDER BY FIELD(ta.status, 'open', 'resolved', 'dismissed'), ta.created_at DESC`,
            [schoolId]
        );
        const [[summary]] = await db.query(
            `SELECT
                SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS openCount,
                SUM(CASE WHEN alert_type = 'vehicle_issue' THEN 1 ELSE 0 END) AS vehicleIssues,
                SUM(CASE WHEN alert_type = 'document_expiry' THEN 1 ELSE 0 END) AS documentExpiry,
                SUM(CASE WHEN alert_type = 'maintenance_due' THEN 1 ELSE 0 END) AS maintenanceDue
            FROM transport_alerts
            WHERE school_id = ?`,
            [schoolId]
        );

        res.render('schoolAdmin/transport/alerts', {
            title: 'Transport Alerts',
            alerts,
            summary: summary || {},
            currentPath: `${TRANSPORT_BASE_PATH}/alerts`
        });
    } catch (err) {
        console.error('[Transport alerts]', err);
        req.flash('error', 'Failed to load transport alerts');
        res.redirect(`${TRANSPORT_BASE_PATH}/dashboard`);
    };
};

exports.resolveAlert = async (req, res) => {
    try {
        await db.query(
            `UPDATE transport_alerts
            SET status = 'resolved', resolved_at = COALESCE(resolved_at, NOW()), updated_by = ?
            WHERE id = ? AND school_id = ?`,
            [req.session.user.id || null, toPositiveInt(req.params.id), req.session.user.school_id]
        );
        req.flash('success', 'Alert resolved');
        res.redirect(`${TRANSPORT_BASE_PATH}/alerts`);
    } catch (err) {
        console.error('[Transport resolveAlert]', err);
        req.flash('error', 'Failed to resolve alert');
        res.redirect(`${TRANSPORT_BASE_PATH}/alerts`);
    };
};

exports.dismissAlert = async (req, res) => {
    try {
        await db.query(
            `UPDATE transport_alerts
            SET status = 'dismissed', dismissed_at = COALESCE(dismissed_at, NOW()), updated_by = ?
            WHERE id = ? AND school_id = ?`,
            [req.session.user.id || null, toPositiveInt(req.params.id), req.session.user.school_id]
        );
        req.flash('success', 'Alert dismissed');
        res.redirect(`${TRANSPORT_BASE_PATH}/alerts`);
    } catch (err) {
        console.error('[Transport dismissAlert]', err);
        req.flash('error', 'Failed to dismiss alert');
        res.redirect(`${TRANSPORT_BASE_PATH}/alerts`);
    };
};

exports.reports = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const filters = {
            dateFrom: normalizeDate(req.query.date_from) || new Date().toISOString().slice(0, 10),
            dateTo: normalizeDate(req.query.date_to) || new Date().toISOString().slice(0, 10),
            routeId: toPositiveInt(req.query.route_id),
            vehicleId: toPositiveInt(req.query.vehicle_id),
            driverId: toPositiveInt(req.query.driver_id),
            studentId: toPositiveInt(req.query.student_id),
            tripType: normalizeStatus(req.query.trip_type, ['pickup', 'drop'], '')
        };

        const tripWhere = ['tt.school_id = ?', 'tt.trip_date BETWEEN ? AND ?'];
        const tripParams = [schoolId, filters.dateFrom, filters.dateTo];
        if (filters.routeId) { 
            tripWhere.push('tt.route_id = ?'); 
            tripParams.push(filters.routeId); 
        };
        if (filters.vehicleId) { 
            tripWhere.push('tt.vehicle_id = ?'); 
            tripParams.push(filters.vehicleId); 
        };
        if (filters.driverId) { 
            tripWhere.push('tt.driver_id = ?'); 
            tripParams.push(filters.driverId); 
        };
        if (filters.tripType) { 
            tripWhere.push('tt.trip_type = ?'); 
            tripParams.push(filters.tripType); 
        };
        
        const tripWhereSql = tripWhere.join(' AND ');
        const [dailyTrips] = await db.query(
            `SELECT tt.trip_date AS tripDate, tt.trip_type AS tripType, tt.status, COUNT(*) AS totalTrips
            FROM transport_trips tt
            WHERE ${tripWhereSql}
            GROUP BY tt.trip_date, tt.trip_type, tt.status
            ORDER BY tt.trip_date DESC, tt.trip_type ASC`,
            tripParams
        );

        const studentWhere = [...tripWhere];
        const studentParams = [...tripParams];
        if (filters.studentId) { studentWhere.push('tts.student_id = ?'); studentParams.push(filters.studentId); }
        const [studentRows] = await db.query(
            `SELECT tt.trip_date AS tripDate, tt.trip_type AS tripType, r.route_name AS routeName,
                v.vehicle_number AS vehicleNumber, tts.status AS studentStatus,
                tts.marked_at AS markedAt, u.first_name AS first_name, u.last_name AS last_name
            FROM transport_trip_students tts
            JOIN transport_trips tt ON tts.trip_id = tt.id AND tt.school_id = tts.school_id
            JOIN students s ON tts.student_id = s.id AND s.school_id = tts.school_id
            JOIN users u ON s.user_id = u.id
            LEFT JOIN routes r ON tt.route_id = r.id AND r.school_id = tt.school_id
            LEFT JOIN vehicles v ON tt.vehicle_id = v.id AND v.school_id = tt.school_id
            WHERE ${studentWhere.join(' AND ')}
            ORDER BY tt.trip_date DESC, u.first_name ASC, u.last_name ASC
            LIMIT 300`,
            studentParams
        );

        if (req.query.export === 'csv') {
            const rows = [
                ['Date', 'Trip Type', 'Route', 'Vehicle', 'Student', 'Status', 'Marked At'].map(csvEscape).join(','),
                ...studentRows.map(row => [
                    row.tripDate,
                    row.tripType,
                    row.routeName,
                    row.vehicleNumber,
                    `${row.first_name || ''} ${row.last_name || ''}`.trim(),
                    row.studentStatus,
                    row.markedAt || ''
                ].map(csvEscape).join(','))
            ];
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="transport-student-report.csv"');
            return res.send(rows.join('\n'));
        };

        const [routeOccupancy] = await db.query(
            `SELECT r.id, r.route_name AS routeName, v.vehicle_number AS vehicleNumber,
                COALESCE(v.capacity, 0) AS capacity,
                COUNT(sta.student_id) AS assignedStudents
            FROM routes r
            LEFT JOIN vehicles v ON r.vehicle_id = v.id AND v.school_id = r.school_id
            LEFT JOIN student_transport_allocations sta
                ON sta.route_id = r.id AND sta.school_id = r.school_id AND sta.status = 'active'
            LEFT JOIN students s ON sta.student_id = s.id AND s.school_id = sta.school_id
            WHERE r.school_id = ?
            GROUP BY r.id, r.route_name, v.vehicle_number, v.capacity
            ORDER BY r.route_name ASC`,
            [schoolId]
        );

        const [maintenanceCost] = await db.query(
            `SELECT v.vehicle_number AS vehicleNumber, SUM(vsr.amount) AS totalAmount, COUNT(vsr.id) AS records
            FROM vehicle_service_records vsr
            JOIN vehicles v ON vsr.vehicle_id = v.id AND v.school_id = vsr.school_id
            WHERE vsr.school_id = ? AND vsr.service_date BETWEEN ? AND ?
            GROUP BY v.id, v.vehicle_number
            ORDER BY totalAmount DESC`,
            [schoolId, filters.dateFrom, filters.dateTo]
        );

        const [driverPerformance] = await db.query(
            `SELECT d.id, d.first_name AS first_name, d.last_name AS last_name,
                COUNT(tt.id) AS trips,
                SUM(CASE WHEN tt.status = 'completed' THEN 1 ELSE 0 END) AS completedTrips,
                SUM(CASE WHEN tt.status = 'running' THEN 1 ELSE 0 END) AS runningTrips
            FROM transport_trips tt
            JOIN drivers d ON tt.driver_id = d.id AND d.school_id = tt.school_id
            WHERE ${tripWhereSql}
            GROUP BY d.id, d.first_name, d.last_name
            ORDER BY completedTrips DESC, trips DESC`,
            tripParams
        );

        const [missedAbsent] = await db.query(
            `SELECT tts.status AS studentStatus, COUNT(*) AS total
            FROM transport_trip_students tts
            JOIN transport_trips tt ON tts.trip_id = tt.id AND tt.school_id = tts.school_id
            JOIN students s ON tts.student_id = s.id AND s.school_id = tts.school_id
            WHERE ${tripWhereSql} AND tts.status IN ('missed', 'absent')
            GROUP BY tts.status`,
            tripParams
        );

        const [students] = await db.query(
            `SELECT s.id, u.first_name AS first_name, u.last_name AS last_name
            FROM students s JOIN users u ON s.user_id = u.id
            LEFT JOIN student_address_transport sat ON sat.student_id = s.id AND sat.transport_required = 1
            WHERE s.school_id = ? AND s.deleted_at IS NULL
            ORDER BY u.first_name ASC, u.last_name ASC
            LIMIT 500`,
            [schoolId]
        );

        const [routes] = await db.query(
            `SELECT id, route_name, route_name AS routeName FROM routes
            WHERE school_id = ? AND status = 'active'
            ORDER BY route_name ASC`,
            [schoolId]
        );

        const [feePlans] = await db.query(
            `SELECT id, plan_name, amount FROM transport_fee_plans
            WHERE school_id = ?
            ORDER BY plan_name ASC`,
            [schoolId]
        );

        res.render('schoolAdmin/transport/reports', {
            title: 'Transport Reports',
            filters,
            routes,
            feePlans,
            vehicles: await getVehiclesForSchool(schoolId),
            drivers: await getDriversForSchool(schoolId),
            students,
            dailyTrips,
            studentRows,
            routeOccupancy,
            maintenanceCost,
            driverPerformance,
            missedAbsent,
            currentPath: `${TRANSPORT_BASE_PATH}/reports`
        });
    } catch (err) {
        console.error('[Transport reports]', err);
        req.flash('error', 'Failed to load transport reports');
        res.redirect(`${TRANSPORT_BASE_PATH}/dashboard`);
    };
};

exports.generateTransportFeeInvoice = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) {
            req.flash('error', 'Session expired');
            return res.redirect('/login');
        };

        const routeId = toPositiveInt(req.body.route_id);
        const feePlanId = toPositiveInt(req.body.fee_plan_id);
        const month = (req.body.month || '').trim();

        if (!routeId || !feePlanId || !/^\d{4}-\d{2}$/.test(month)) {
            req.flash('error', 'Please select a valid route, fee plan and month');
            return res.redirect(`${TRANSPORT_BASE_PATH}/fee-plans`);
        };

        const [[feePlan]] = await db.query(
            `SELECT id, amount, plan_name FROM transport_fee_plans
            WHERE id = ? AND school_id = ?`,
            [feePlanId, schoolId]
        );

        if (!feePlan) {
            req.flash('error', 'Fee plan not found');
            return res.redirect(`${TRANSPORT_BASE_PATH}/fee-plans`);
        };

        const [students] = await db.query(
            `SELECT sta.student_id
            FROM student_transport_allocations sta
            JOIN students s ON sta.student_id = s.id AND s.school_id = sta.school_id
            WHERE sta.route_id = ? AND sta.school_id = ? AND sta.status = 'active'`,
            [routeId, schoolId]
        );

        if (students.length === 0) {
            req.flash('error', 'No active students found on this route');
            return res.redirect(`${TRANSPORT_BASE_PATH}/fee-plans`);
        };

        const dueDate = `${month}-10`;
        let inserted = 0;
        let skipped = 0;

        for (const { student_id } of students) {
            const [[existing]] = await db.query(
                `SELECT id FROM student_fees
                WHERE student_id = ? AND school_id = ? AND fee_month = ?
                    AND fee_structure_id IS NULL`,
                [student_id, schoolId, month]
            );

            if (existing) {
                skipped++;
                continue;
            };

            await db.query(
                `INSERT INTO student_fees
                (school_id, student_id, fee_structure_id, fee_month,
                    due_date, total_amount, paid_amount, status, created_at)
                VALUES (?, ?, NULL, ?, ?, ?, 0, 'pending', NOW())`,
                [schoolId, student_id, month, dueDate, feePlan.amount]
            );
            inserted++;
        };

        req.flash('success',
            `Transport fee invoices generated for ${inserted} student(s). ${skipped > 0 ? `${skipped} already existed.` : ''}`
        );
        res.redirect(`${TRANSPORT_BASE_PATH}/fee-plans`);
    } catch (err) {
        console.error('[TransportController generateTransportFeeInvoice]', err);
        req.flash('error', 'Failed to generate transport fee invoices');
        res.redirect(`${TRANSPORT_BASE_PATH}/fee-plans`);
    };
};

exports.renderExportCenter = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) {
            req.flash('error', 'Session expired');
            return res.redirect('/login');
        };

        const [[counts]] = await db.query(
            `SELECT
            (SELECT COUNT(*) FROM routes WHERE school_id = ?) AS activeRoutes,
            (SELECT COUNT(*) FROM vehicles WHERE school_id = ? AND status = 'active') AS activeVehicles,
            (SELECT COUNT(*)
                FROM student_transport_allocations sta
                JOIN students s ON sta.student_id = s.id AND s.school_id = sta.school_id
                WHERE sta.school_id = ? AND sta.status = 'active') AS activeAllocations`,
            [schoolId, schoolId, schoolId]
        );

        res.render('schoolAdmin/transport/export', {
            title: 'Transport Export Center',
            currentPath: `${TRANSPORT_BASE_PATH}/export`,
            active: 'export',
            user: req.user || req.session.user,
            stats: counts || { activeRoutes: 0, activeVehicles: 0, activeAllocations: 0 }
        });
    } catch (err) {
        console.error('[TransportController renderExportCenter]', err);
        req.flash('error', 'Failed to load export center');
        res.redirect(`${TRANSPORT_BASE_PATH}/dashboard`);
    };
};

exports.exportTransportReport = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) {
            req.flash('error', 'Session expired');
            return res.redirect('/login');
        };

        const [routes] = await db.query(
            `SELECT r.id, r.route_name, r.start_point, r.end_point, r.status,
                v.vehicle_number, v.capacity,
                CONCAT(u.first_name, ' ', u.last_name) AS driver_name,
                COUNT(sta.student_id) AS allocated_students
            FROM routes r
            LEFT JOIN vehicles v ON r.vehicle_id = v.id AND v.school_id = r.school_id
            LEFT JOIN drivers d ON r.driver_id = d.id AND d.school_id = r.school_id
            LEFT JOIN users u ON d.user_id = u.id
            LEFT JOIN student_transport_allocations sta
                ON sta.route_id = r.id AND sta.school_id = r.school_id AND sta.status = 'active'
            LEFT JOIN students s ON sta.student_id = s.id AND s.school_id = sta.school_id
            WHERE r.school_id = ?
            GROUP BY r.id, r.route_name, r.start_point, r.end_point, r.status, v.vehicle_number, v.capacity, u.first_name, u.last_name
            ORDER BY r.route_name ASC`,
            [schoolId]
        );

        const [allocations] = await db.query(
            ` SELECT u.first_name, u.last_name,
                c.class_name, c.section,
                r.route_name,
                trs.stop_name,
                sta.status, sta.created_at
            FROM student_transport_allocations sta
            JOIN students s ON sta.student_id = s.id
            JOIN users u ON s.user_id = u.id
            LEFT JOIN classes c ON s.class_id = c.id
            LEFT JOIN routes r ON sta.route_id = r.id
            LEFT JOIN transport_route_stops trs ON sta.stop_id = trs.id
            WHERE sta.school_id = ?
            ORDER BY r.route_name, u.first_name ASC`,
            [schoolId]
        );

        const wb = new ExcelJS.Workbook();
        wb.creator = 'SchoolSync';
        wb.created = new Date();

        const ws1 = wb.addWorksheet('Routes');
        ws1.columns = [
            { header: 'Route Name', key: 'route', width: 22 },
            { header: 'From', key: 'from', width: 18 },
            { header: 'To', key: 'to', width: 18 },
            { header: 'Vehicle', key: 'vehicle', width: 15 },
            { header: 'Capacity', key: 'capacity', width: 10 },
            { header: 'Driver', key: 'driver', width: 20 },
            { header: 'Students', key: 'students', width: 10 },
            { header: 'Status', key: 'status', width: 12 },
        ];

        ws1.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        ws1.getRow(1).fill = {
            type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' }
        };

        routes.forEach(r => {
            ws1.addRow({
                route: r.route_name,
                from: r.start_point || '—',
                to: r.end_point || '—',
                vehicle: r.vehicle_number || '—',
                capacity: r.capacity || '—',
                driver: r.driver_name || '—',
                students: r.allocated_students,
                status: r.status || '—'
            });
        });

        const ws2 = wb.addWorksheet('Student Allocations');
        ws2.columns = [
            { header: 'Student Name', key: 'name', width: 25 },
            { header: 'Class', key: 'class', width: 15 },
            { header: 'Route', key: 'route', width: 22 },
            { header: 'Stop', key: 'stop', width: 20 },
            { header: 'Status', key: 'status', width: 12 },
            { header: 'Allocated On', key: 'date', width: 15 },
        ];

        ws2.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        ws2.getRow(1).fill = {
            type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' }
        };

        allocations.forEach(a => {
            ws2.addRow({
                name: `${a.first_name} ${a.last_name}`,
                class: `${a.class_name || ''} ${a.section || ''}`.trim(),
                route: a.route_name || '—',
                stop: a.stop_name || '—',
                status: a.status || '—',
                date: a.created_at ? new Date(a.created_at).toLocaleDateString('en-IN') : '—'
            });
        });

        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="transport-report-${new Date().toISOString().slice(0, 10)}.xlsx"`
        );
        await wb.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error('[TransportController exportTransportReport]', err);
        req.flash('error', 'Failed to export transport report');
        res.redirect(`${TRANSPORT_BASE_PATH}/reports`);
    };
};

exports.getVehicleExpiryAlerts = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) {
            req.flash('error', 'Session expired');
            return res.redirect('/login');
        };

        const [vehicles] = await db.query(
            `SELECT id, vehicle_number, type AS vehicle_type,
                insurance_expiry, puc_expiry, permit_expiry, fitness_expiry,
                DATEDIFF(insurance_expiry, CURDATE()) AS insurance_days,
                DATEDIFF(puc_expiry, CURDATE())       AS puc_days,
                DATEDIFF(permit_expiry, CURDATE())    AS permit_days,
                DATEDIFF(fitness_expiry, CURDATE())   AS fitness_days
            FROM vehicles
            WHERE school_id = ? AND status = 'active'
                AND (
                    DATEDIFF(insurance_expiry, CURDATE()) < 30 OR
                    DATEDIFF(puc_expiry, CURDATE()) < 30 OR
                    DATEDIFF(permit_expiry, CURDATE()) < 30 OR
                    DATEDIFF(fitness_expiry, CURDATE()) < 30
                )
            ORDER BY LEAST(
                COALESCE(DATEDIFF(insurance_expiry, CURDATE()), 999),
                COALESCE(DATEDIFF(puc_expiry, CURDATE()), 999),
                COALESCE(DATEDIFF(permit_expiry, CURDATE()), 999),
                COALESCE(DATEDIFF(fitness_expiry, CURDATE()), 999)
            ) ASC`,
            [schoolId]
        );

        res.render('schoolAdmin/transport/vehicle-expiry', {
            title: 'Vehicle Document Expiry',
            alerts: vehicles,
            user: req.user || req.session.user,
            currentPath: `${TRANSPORT_BASE_PATH}/vehicle-expiry`
        });
    } catch (err) {
        console.error('[TransportController getVehicleExpiryAlerts]', err);
        req.flash('error', 'Failed to load vehicle expiry alerts');
        res.redirect(TRANSPORT_BASE_PATH);
    };
};

exports.startTrip = async (req, res) => {
    try {
        const schoolId = req.user?.school_id;
        const userId = req.user?.id;
        if (!schoolId || !userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        };

        const tripType = req.body.trip_type;
        if (!['pickup', 'drop'].includes(tripType)) {
            return res.status(400).json({ success: false, message: 'Invalid trip type' });
        };

        const [[driver]] = await db.query(
            `SELECT d.id, COALESCE(dva.vehicle_id, r.vehicle_id) AS vehicle_id
            FROM drivers d
            LEFT JOIN routes r ON r.driver_id = d.id AND r.school_id = d.school_id AND r.status = 'active'
            LEFT JOIN driver_vehicle_assign dva ON dva.driver_id = d.id AND dva.school_id = d.school_id AND dva.is_active = 1
            WHERE d.user_id = ? AND d.school_id = ? AND d.status = 'active'
                AND d.deleted_at IS NULL
            LIMIT 1`,
            [userId, schoolId]
        );

        if (!driver) {
            return res.status(403).json({ success: false, message: 'Driver record not found' });
        };

        const [[route]] = await db.query(
            `SELECT id FROM routes
            WHERE driver_id = ? AND school_id = ? AND status = 'active'
            LIMIT 1`,
            [driver.id, schoolId]
        );

        if (!route) {
            return res.status(404).json({ success: false, message: 'No active route assigned' });
        };

        const [[activeTrip]] = await db.query(
            `SELECT id FROM transport_trips
            WHERE driver_id = ? AND school_id = ? AND status = 'running'
                AND DATE(COALESCE(started_at, start_at)) = CURDATE()
            LIMIT 1`,
            [driver.id, schoolId]
        );

        if (activeTrip) {
            return res.status(400).json({
                success: false,
                message: 'A trip is already running for today. End it before starting a new one.'
            });
        };

        const [result] = await db.query(
            `INSERT INTO transport_trips
            (school_id, route_id, driver_id, vehicle_id, trip_type, status, start_at, started_at)
            VALUES (?, ?, ?, ?, ?, 'running', NOW(), NOW())`,
            [schoolId, route.id, driver.id, driver.vehicle_id, tripType]
        );
        res.json({ success: true, trip_id: result.insertId, message: 'Trip started' });
    } catch (err) {
        console.error('[TransportController startTrip]', err);
        res.status(500).json({ success: false, message: 'Failed to start trip' });
    };
};

exports.endTrip = async (req, res) => {
    try {
        const schoolId = req.user?.school_id;
        const userId = req.user?.id;
        if (!schoolId || !userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        };

        const tripId = toPositiveInt(req.body.trip_id);
        if (!tripId) {
            return res.status(400).json({ success: false, message: 'Invalid trip ID' });
        };

        const [[driver]] = await db.query(
            `SELECT id FROM drivers WHERE user_id = ? AND school_id = ? LIMIT 1`,
            [userId, schoolId]
        );

        if (!driver) {
            return res.status(403).json({ success: false, message: 'Driver not found' });
        };

        const [[trip]] = await db.query(
            `SELECT id, status FROM transport_trips
            WHERE id = ? AND driver_id = ? AND school_id = ?`,
            [tripId, driver.id, schoolId]
        );

        if (!trip) {
            return res.status(404).json({ success: false, message: 'Trip not found' });
        };

        if (trip.status !== 'running') {
            return res.status(400).json({ success: false, message: 'Trip is not running' });
        };

        await db.query(
            `UPDATE transport_trips
            SET status = 'completed', end_at = NOW(), ended_at = NOW()
            WHERE id = ? AND school_id = ?`,
            [tripId, schoolId]
        );
        res.json({ success: true, message: 'Trip ended successfully' });
    } catch (err) {
        console.error('[TransportController endTrip]', err);
        res.status(500).json({ success: false, message: 'Failed to end trip' });
    };
};

exports.markStudentBoarded = async (req, res) => {
    try {
        const schoolId = req.user?.school_id;
        const userId = req.user?.id;
        if (!schoolId || !userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        };

        const tripId = toPositiveInt(req.params.tripId);
        const studentId = toPositiveInt(req.params.studentId);

        if (!tripId || !studentId) {
            return res.status(400).json({ success: false, message: 'Invalid trip or student ID' });
        };

        const [[driver]] = await db.query(
            `SELECT id FROM drivers WHERE user_id = ? AND school_id = ? LIMIT 1`,
            [userId, schoolId]
        );

        if (!driver) {
            return res.status(403).json({ success: false, message: 'Driver not found' });
        };

        const [[trip]] = await db.query(
            `SELECT id FROM transport_trips
            WHERE id = ? AND driver_id = ? AND school_id = ? AND status = 'running'`,
            [tripId, driver.id, schoolId]
        );

        if (!trip) {
            return res.status(404).json({
                success: false,
                message: 'Running trip not found. Start a trip first.'
            });
        };

        const [[allocation]] = await db.query(
            `SELECT sta.id FROM student_transport_allocations sta
            JOIN transport_trips tt ON tt.route_id = sta.route_id
            WHERE tt.id = ? AND sta.student_id = ? AND sta.school_id = ? AND sta.status = 'active'`,
            [tripId, studentId, schoolId]
        );

        if (!allocation) {
            return res.status(403).json({
                success: false,
                message: 'Student is not allocated to this route'
            });
        };

        await db.query(
            `INSERT INTO transport_trip_students
                (trip_id, student_id, school_id, status, picked_at)
            VALUES (?, ?, ?, 'picked', NOW())
            ON DUPLICATE KEY UPDATE status = 'picked', picked_at = NOW()`,
            [tripId, studentId, schoolId]
        );

        res.json({ success: true, message: 'Student marked as boarded' });
    } catch (err) {
        console.error('[TransportController markStudentBoarded]', err);
        res.status(500).json({ success: false, message: 'Failed to mark student' });
    };
};

exports.getDriverRoute = async (req, res) => {
    try {
        const schoolId = req.user?.school_id;
        const userId = req.user?.id;
        if (!schoolId || !userId) {
            req.flash('error', 'Session expired');
            return res.redirect('/login');
        };

        const [[driver]] = await db.query(
            `SELECT d.id, COALESCE(dva.vehicle_id, r.vehicle_id) AS vehicle_id,
                r.id AS route_id, r.route_name,
                r.start_point, r.end_point,
                v.vehicle_number, v.type AS vehicle_type
            FROM drivers d
            LEFT JOIN routes r ON r.driver_id = d.id AND r.school_id = d.school_id AND r.status = 'active'
            LEFT JOIN driver_vehicle_assign dva ON dva.driver_id = d.id AND dva.school_id = d.school_id AND dva.is_active = 1
            LEFT JOIN vehicles v ON COALESCE(dva.vehicle_id, r.vehicle_id) = v.id AND v.school_id = d.school_id
            WHERE d.user_id = ? AND d.school_id = ?
            LIMIT 1`,
            [userId, schoolId]
        );

        const [students] = driver?.route_id ? await db.query(
            `SELECT s.id, u.first_name, u.last_name,
                c.class_name, c.section,
                trs.stop_name, trs.stop_order
            FROM student_transport_allocations sta
            JOIN students s ON sta.student_id = s.id
            JOIN users u ON s.user_id = u.id
            LEFT JOIN classes c ON s.class_id = c.id
            LEFT JOIN transport_route_stops trs ON sta.pickup_stop_id = trs.id
            WHERE sta.route_id = ? AND sta.school_id = ? AND sta.status = 'active'
            ORDER BY trs.stop_order ASC, u.first_name ASC`,
            [driver.route_id, schoolId]
        ) : [[]];

        const [[activeTrip]] = driver?.id ? await db.query(
            `SELECT id, trip_type, started_at
            FROM transport_trips
            WHERE driver_id = ? AND school_id = ? AND status = 'running'
                AND DATE(COALESCE(started_at, start_at)) = CURDATE()
            LIMIT 1`,
            [driver.id, schoolId]
        ) : [[null]];

        let boardedStudentIds = new Set();
        if (activeTrip) {
            const [boarded] = await db.query(
                `SELECT student_id FROM transport_trip_students WHERE trip_id = ? AND school_id = ?`,
                [activeTrip.id, schoolId]
            );
            boardedStudentIds = new Set(boarded.map(b => b.student_id));
        }

        res.render('driver/transport/my-route', {
            title: 'My Route',
            driver: driver || null,
            students,
            activeTrip: activeTrip || null,
            boardedStudentIds: [...boardedStudentIds],
            user: req.user,
            layout: false
        });
    } catch (err) {
        console.error('[TransportController getDriverRoute]', err);
        req.flash('error', 'Failed to load route');
        res.redirect('/driver/dashboard');
    };
};