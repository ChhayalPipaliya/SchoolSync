const { queryAsync, withTransaction } = require('../config/database');
const { getIO } = require('../config/socket');
const { resolveUserSchoolId } = require('../utils/resolveUserSchoolId');

let schemaInitialized = false;
async function ensureGpsSchema() {
    if (schemaInitialized) return;
    try {
        await queryAsync(`
            CREATE TABLE IF NOT EXISTS driver_locations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                trip_id INT NOT NULL,
                driver_id INT NOT NULL,
                school_id INT NOT NULL,
                latitude DECIMAL(10, 8) NOT NULL,
                longitude DECIMAL(11, 8) NOT NULL,
                speed DECIMAL(5, 2) DEFAULT 0,
                heading DECIMAL(5, 2) DEFAULT NULL,
                recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                KEY idx_trip (trip_id),
                KEY idx_school_driver (school_id, driver_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        const columns = await queryAsync(`SHOW COLUMNS FROM driver_trips`);
        const colNames = columns.map(c => c.Field);
        if (!colNames.includes('latitude')) {
            await queryAsync(`ALTER TABLE driver_trips ADD COLUMN latitude DECIMAL(10, 8) NULL`);
        };
        if (!colNames.includes('longitude')) {
            await queryAsync(`ALTER TABLE driver_trips ADD COLUMN longitude DECIMAL(11, 8) NULL`);
        };
        if (!colNames.includes('last_location_at')) {
            await queryAsync(`ALTER TABLE driver_trips ADD COLUMN last_location_at DATETIME NULL`);
        };

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
        } catch (_) {};

        schemaInitialized = true;
    } catch (err) {
        console.error('[GPS Schema Init Error]:', err.message);
    };
};

exports.updateLocation = async (req, res) => {
    try {
        await ensureGpsSchema();
        const schoolId = await resolveUserSchoolId(req.user);
        const userId = req.user?.id;

        if (!schoolId || !userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized or missing school ID' });
        };

        const { latitude, longitude, speed = 0, heading = null, trip_id } = req.body;
        const lat = Number(latitude);
        const lng = Number(longitude);

        if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
            return res.status(400).json({ success: false, message: 'Invalid latitude value' });
        };
        if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
            return res.status(400).json({ success: false, message: 'Invalid longitude value' });
        };

        const [driver] = await queryAsync(
            `SELECT id FROM drivers WHERE user_id = ? AND school_id = ? AND deleted_at IS NULL LIMIT 1`,
            [userId, schoolId]
        );

        if (!driver) {
            return res.status(404).json({ success: false, message: 'Driver profile not found' });
        };

        const driverId = driver.id;
        let activeTrip = null;
        if (trip_id) {
            const [trip] = await queryAsync(
                `SELECT id, status, route_id, vehicle_id FROM driver_trips 
                WHERE id = ? AND school_id = ? AND driver_id = ? AND status IN ('in_progress', 'running') LIMIT 1`,
                [trip_id, schoolId, driverId]
            );
            activeTrip = trip;

            if (!activeTrip) {
                const [tTrip] = await queryAsync(
                    `SELECT id, status, route_id, vehicle_id FROM transport_trips 
                    WHERE id = ? AND school_id = ? AND driver_id = ? AND status IN ('in_progress', 'running') LIMIT 1`,
                    [trip_id, schoolId, driverId]
                );
                activeTrip = tTrip;
            };
        };

        if (!activeTrip) {
            const [trip] = await queryAsync(
                `SELECT id, status, route_id, vehicle_id FROM driver_trips 
                WHERE school_id = ? AND driver_id = ? AND status IN ('in_progress', 'running') 
                ORDER BY id DESC LIMIT 1`,
                [schoolId, driverId]
            );
            activeTrip = trip;
        };

        if (!activeTrip) {
            const [tTrip] = await queryAsync(
                `SELECT id, status, route_id, vehicle_id FROM transport_trips 
                WHERE school_id = ? AND driver_id = ? AND status IN ('in_progress', 'running') 
                ORDER BY id DESC LIMIT 1`,
                [schoolId, driverId]
            );
            activeTrip = tTrip;
        };

        if (!activeTrip) {
            return res.status(400).json({ 
                success: false, 
                message: 'No active trip in progress for GPS tracking (કોઈ સક્રિય ટ્રીપ મળેલ નથી)' 
            });
        };

        const now = new Date();
        await queryAsync(
            `UPDATE driver_trips SET latitude = ?, longitude = ?, last_location_at = ? WHERE id = ?`,
            [lat, lng, now, activeTrip.id]
        );

        await queryAsync(
            `UPDATE transport_trips SET latitude = ?, longitude = ?, last_location_at = ? WHERE id = ?`,
            [lat, lng, now, activeTrip.id]
        ).catch(() => {});

        await queryAsync(
            `INSERT INTO driver_locations (trip_id, driver_id, school_id, latitude, longitude, speed, heading, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [activeTrip.id, driverId, schoolId, lat, lng, speed, heading, now]
        );

        await queryAsync(
            `INSERT INTO transport_trip_locations (school_id, trip_id, vehicle_id, driver_id, latitude, longitude, speed, heading, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [schoolId, activeTrip.id, activeTrip.vehicle_id || null, driverId, lat, lng, speed, heading]
        ).catch(() => {});

        const [details] = await queryAsync(`
            SELECT d.id AS driver_id, u.first_name, u.last_name, u.phone,
                r.route_name, v.vehicle_number
            FROM drivers d
            JOIN users u ON d.user_id = u.id
            LEFT JOIN routes r ON r.id = ?
            LEFT JOIN vehicles v ON v.id = ?
            WHERE d.id = ? LIMIT 1
        `, [activeTrip.route_id || 0, activeTrip.vehicle_id || 0, driverId]);

        const driverName = details ? `${details.first_name || ''} ${details.last_name || ''}`.trim() : 'Driver';
        const routeName = details?.route_name || 'Active Route';
        const vehicleNumber = details?.vehicle_number || 'N/A';

        const locationPayload = {
            trip_id: activeTrip.id,
            driver_id: driverId,
            driverName,
            phone: details?.phone || '',
            routeName,
            vehicleNumber,
            latitude: lat,
            longitude: lng,
            speed,
            heading,
            last_location_at: now.toISOString(),
            timestamp: now.toISOString()
        };

        try {
            const io = getIO();
            if (io) {
                io.to(`school:${schoolId}:trips`).emit('school_trip_location_updated', locationPayload);
                io.to(`school:${schoolId}:trips`).emit('bus_location_update', locationPayload);
                io.to(`trip:${activeTrip.id}`).emit('location_updated', locationPayload);
            };
        } catch (socketErr) {
            console.error('[GPS Socket Emit Warning]:', socketErr.message);
        };

        return res.json({
            success: true,
            message: 'Location updated successfully (લોકેશન અપડેટ થયું)',
            data: locationPayload
        });
    } catch (err) {
        console.error('[GPS updateLocation Error]:', err);
        return res.status(500).json({ success: false, message: 'Internal server error while updating location' });
    };
};

exports.getLiveBuses = async (req, res) => {
    try {
        await ensureGpsSchema();
        const schoolId = await resolveUserSchoolId(req.user);

        if (!schoolId) {
            return res.status(401).json({ success: false, message: 'Unauthorized or missing school ID' });
        };

        const activeBuses = await queryAsync(`
            SELECT 
                tt.id AS trip_id,
                tt.driver_id,
                tt.route_id,
                tt.vehicle_id,
                tt.latitude,
                tt.longitude,
                tt.last_location_at,
                tt.status,
                CONCAT(u.first_name, ' ', COALESCE(u.last_name, '')) AS driver_name,
                u.phone AS driver_phone,
                u.image AS driver_image,
                v.vehicle_number,
                v.model AS vehicle_model,
                r.route_name,
                r.start_point,
                r.end_point
            FROM (
                SELECT id, school_id, driver_id, route_id, vehicle_id, latitude, longitude, last_location_at, status
                FROM driver_trips
                WHERE school_id = ? AND status IN ('in_progress', 'running') AND latitude IS NOT NULL
                UNION
                SELECT id, school_id, driver_id, route_id, vehicle_id, latitude, longitude, last_location_at, status
                FROM transport_trips
                WHERE school_id = ? AND status IN ('in_progress', 'running') AND latitude IS NOT NULL
            ) tt
            JOIN drivers d ON d.id = tt.driver_id
            JOIN users u ON u.id = d.user_id
            LEFT JOIN vehicles v ON v.id = tt.vehicle_id
            LEFT JOIN routes r ON r.id = tt.route_id
            ORDER BY tt.last_location_at DESC
        `, [schoolId, schoolId]);

        return res.json({
            success: true,
            count: activeBuses.length,
            buses: activeBuses.map(b => ({
                trip_id: b.trip_id,
                driver_id: b.driver_id,
                driver_name: b.driver_name,
                driver_phone: b.driver_phone,
                driver_image: b.driver_image,
                vehicle_number: b.vehicle_number || 'N/A',
                vehicle_model: b.vehicle_model || '',
                route_name: b.route_name || 'Unassigned Route',
                start_point: b.start_point || '',
                end_point: b.end_point || '',
                latitude: parseFloat(b.latitude),
                longitude: parseFloat(b.longitude),
                last_location_at: b.last_location_at,
                status: b.status
            }))
        });
    } catch (err) {
        console.error('[GPS getLiveBuses Error]:', err);
        return res.status(500).json({ success: false, message: 'Internal server error while fetching live buses' });
    };
};

exports.getTripRoute = async (req, res) => {
    try {
        await ensureGpsSchema();
        const schoolId = await resolveUserSchoolId(req.user);
        const tripId = req.params.tripId;
        const allowedRoles = ['school_admin', 'parent', 'student', 'driver'];

        if (!schoolId || !tripId) {
            return res.status(400).json({ success: false, message: 'Missing school ID or trip ID' });
        };
        if (!allowedRoles.includes(req.user?.role)) {
            return res.status(403).json({ success: false, message: 'Not authorized to view this route' });
        };

        const points = await queryAsync(`
            SELECT latitude, longitude, speed, heading, recorded_at
            FROM (
                SELECT latitude, longitude, speed, heading, recorded_at
                FROM driver_locations
                WHERE trip_id = ? AND school_id = ?
                UNION
                SELECT latitude, longitude, speed, heading, recorded_at
                FROM transport_trip_locations
                WHERE trip_id = ? AND school_id = ?
            ) combined
            ORDER BY recorded_at ASC
        `, [tripId, schoolId, tripId, schoolId]);

        return res.json({
            success: true,
            trip_id: tripId,
            count: points.length,
            route: points.map(p => ({
                latitude: parseFloat(p.latitude),
                longitude: parseFloat(p.longitude),
                speed: parseFloat(p.speed || 0),
                heading: p.heading ? parseFloat(p.heading) : null,
                recorded_at: p.recorded_at
            }))
        });
    } catch (err) {
        console.error('[GPS getTripRoute Error]:', err);
        return res.status(500).json({ success: false, message: 'Internal server error while fetching trip route' });
    };
};

exports.getSchoolAdminLiveMap = async (req, res) => {
    try {
        await ensureGpsSchema();
        const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || 'YOUR_GOOGLE_MAPS_API_KEY';
        
        return res.render('schoolAdmin/drivers/liveMap', {
            title: 'Live Bus Tracking | GPS Fleet Monitor',
            user: req.user || req.session?.user,
            googleMapsApiKey,
            currentPath: '/schooladmin/drivers/live-map',
            layout: 'schoolAdmin/layout'
        });
    } catch (err) {
        console.error('[GPS getSchoolAdminLiveMap Error]:', err);
        req.flash('error', 'Failed to load live map interface');
        return res.redirect('/schooladmin/dashboard');
    };
};

exports.getParentBusLocation = async (req, res) => {
    try {
        await ensureGpsSchema();
        const schoolId = await resolveUserSchoolId(req.user);
        const user = req.user || req.session?.user;

        if (!schoolId || !user) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        };
        if (!['student', 'parent'].includes(user.role)) {
            return res.status(403).json({ success: false, message: 'Not authorized to view bus location' });
        };

        let studentId = null;
        if (user.role === 'student') {
            const [st] = await queryAsync(`SELECT id FROM students WHERE user_id = ? AND school_id = ? LIMIT 1`, [user.id, schoolId]);
            studentId = st?.id;
        } else if (user.role === 'parent') {
            const selectedStudentId = req.query.studentId || req.session?.selectedStudentId;
            if (selectedStudentId) {
                studentId = selectedStudentId;
            } else {
                const [st] = await queryAsync(`
                    SELECT s.id FROM students s
                    JOIN student_family sf ON sf.student_id = s.id
                    WHERE sf.parent_user_id = ? AND s.school_id = ? LIMIT 1
                `, [user.id, schoolId]);
                studentId = st?.id;
            };
        };

        if (!studentId) {
            return res.status(404).json({ success: false, message: 'No student record found' });
        };

        const [activeTrip] = await queryAsync(`
            SELECT 
                tt.id AS trip_id, tt.latitude, tt.longitude, tt.last_location_at, tt.status,
                CONCAT(u.first_name, ' ', COALESCE(u.last_name, '')) AS driver_name, u.phone AS driver_phone,
                v.vehicle_number, r.route_name
            FROM transport_trip_students tts
            JOIN transport_trips tt ON tt.id = tts.trip_id AND tt.school_id = tts.school_id AND tt.status = 'running'
            JOIN drivers d ON d.id = tt.driver_id
            JOIN users u ON u.id = d.user_id
            LEFT JOIN vehicles v ON v.id = tt.vehicle_id
            LEFT JOIN routes r ON r.id = tt.route_id
            WHERE tts.student_id = ? AND tts.school_id = ?
            ORDER BY tt.id DESC LIMIT 1
        `, [studentId, schoolId]);

        if (!activeTrip || !activeTrip.latitude) {
            return res.json({ success: true, active: false, message: 'Bus is not currently running for this student' });
        };

        return res.json({
            success: true,
            active: true,
            bus: {
                trip_id: activeTrip.trip_id,
                driver_name: activeTrip.driver_name,
                driver_phone: activeTrip.driver_phone,
                vehicle_number: activeTrip.vehicle_number || 'N/A',
                route_name: activeTrip.route_name || 'School Bus Route',
                latitude: parseFloat(activeTrip.latitude),
                longitude: parseFloat(activeTrip.longitude),
                last_location_at: activeTrip.last_location_at
            }
        });
    } catch (err) {
        console.error('[GPS getParentBusLocation Error]:', err);
        return res.status(500).json({ success: false, message: 'Failed to fetch student bus location' });
    };
};