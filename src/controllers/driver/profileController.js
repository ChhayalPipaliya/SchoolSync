const { queryAsync } = require("../../config/database");
const bcryptjs = require("bcryptjs");
const { isStrongPassword } = require("../../utils/validation");
const { resolveUserSchoolId } = require("../../utils/resolveUserSchoolId");

const getDriverProfile = async (schoolId, userId) => {
    const rows = await queryAsync(`
        SELECT d.*,
            v.id AS vehicle_id, v.vehicle_number AS vehicleNumber, v.model AS vehicleModel, v.capacity,
            v.type AS vehicleType, v.fuel_type AS fuelType, v.insurance_expiry AS insuranceExpiry,
            v.puc_expiry AS pucExpiry, v.fitness_expiry AS fitnessExpiry, v.permit_expiry AS permitExpiry,
            v.gps_device_id AS gpsDeviceId, v.registration_number AS registrationNumber,
            r.id AS route_id, r.route_name AS routeName, r.start_point AS startPoint, r.end_point AS endPoint,
            r.school_shift AS schoolShift
        FROM drivers d
        JOIN users u ON u.id = d.user_id AND u.school_id = d.school_id
        LEFT JOIN driver_vehicle_assign dva ON dva.driver_id = d.id AND dva.is_active = 1
        LEFT JOIN vehicles v ON v.id = dva.vehicle_id
        LEFT JOIN routes r ON r.driver_id = d.id AND r.status = 'active'
        WHERE d.school_id = ? AND u.id = ?
        LIMIT 1
    `, [schoolId, userId]);
    return rows[0] || null;
};

const getActiveTrip = async (schoolId, driverId) => {
    const rows = await queryAsync(`
        SELECT id, school_id, driver_id, route_id, vehicle_id, trip_date, start_at, end_at,
            'in_progress' AS status, trip_type, created_at
        FROM transport_trips
        WHERE school_id=? AND driver_id=? AND trip_date=CURDATE() AND status='running'
        ORDER BY id DESC LIMIT 1
    `, [schoolId, driverId]);
    return rows[0] || null;
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
exports.profilePage = async (req, res) => {
    try {
        const schoolId = await resolveUserSchoolId(req.user);
        const driver = await getDriverProfile(schoolId, req.user.id);
        if (noDriver(driver, req, res)) return;

        driver.licenseExpiry = driver.license_expiry;
        const activeTrip = await getActiveTrip(schoolId, driver.id);
        const licExpiry = driver.licenseExpiry ? new Date(driver.licenseExpiry) : null;
        const isExpired = licExpiry && licExpiry < new Date();

        let stopsCount = 0;
        if (driver.route_id) {
            const stopRows = await queryAsync(
                `SELECT COUNT(*) AS count FROM transport_route_stops WHERE route_id = ? AND status = 'active'`,
                [driver.route_id]
            );
            stopsCount = stopRows[0]?.count || 0;
        }

        const documents = await queryAsync(
            `SELECT * FROM driver_documents WHERE driver_id = ? ORDER BY id DESC`,
            [driver.id]
        );

        const recentTrips = await queryAsync(
            `SELECT id, trip_date, start_at, end_at, status, trip_type, created_at 
             FROM transport_trips 
             WHERE driver_id = ? 
             ORDER BY id DESC LIMIT 5`,
            [driver.id]
        );

        const recentAttendance = await queryAsync(
            `SELECT id, date, status, created_at 
             FROM driver_attendance 
             WHERE driver_id = ? 
             ORDER BY id DESC LIMIT 5`,
            [driver.id]
        );

        return res.render("driver/profile", {
            user: req.user,
            driver,
            activeTrip,
            licExpiry,
            isExpired,
            stopsCount,
            documents: documents || [],
            recentTrips: recentTrips || [],
            recentAttendance: recentAttendance || [],
            driverInitials: makeInitials(driver)
        });
    } catch (err) {
        console.error("[Driver Profile]", err);
        req.flash("error", "Unable to load profile.");
        return res.redirect("/driver/dashboard");
    };
};

exports.updateProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const { currentPassword, newPassword, confirmPassword } = req.body;

        if (!currentPassword || !newPassword || !confirmPassword) {
            if (req.accepts("json") && req.accepts("html")) {
                return res.status(400).json({ success: false, message: "Please fill all password fields." });
            };

            req.flash("error", "Please fill all password fields.");
            return res.redirect("/driver/profile");
        };

        if (newPassword !== confirmPassword) {
            if (req.accepts("json") && !req.accepts("html")) {
                return res.status(400).json({ success: false, message: "Passwords do not match." });
            };

            req.flash("error", "Passwords do not match.");
            return res.redirect("/driver/profile");
        };

        if (!isStrongPassword(newPassword)) {
            if (req.accepts("json") && !req.accepts("html")) {
                return res.status(400).json({ success: false, message: "Password must be at least 8 characters and include letters and numbers." });
            };

            req.flash("error", "Password must be at least 8 characters and include letters and numbers.");
            return res.redirect("/driver/profile");
        };

        const users = await queryAsync("SELECT password FROM users WHERE id = ?", [userId]);
        const userRow = users[0];
        if (!userRow) {
            if (req.accepts("json") && !req.accepts("html")) {
                return res.status(404).json({ success: false, message: "User not found." });
            };
      
            req.flash("error", "User not found.");
            return res.redirect("/driver/profile");
        };   

        const isPasswordValid = await bcryptjs.compare(currentPassword, userRow.password);
        if (!isPasswordValid) {
            if (req.accepts("json") && !req.accepts("html")) {
                return res.status(400).json({ success: false, message: "Incorrect current password." });
            };

            req.flash("error", "Incorrect current password.");
            return res.redirect("/driver/profile");
        };

        const hashed = await bcryptjs.hash(newPassword, 10);
        await queryAsync("UPDATE users SET password = ? WHERE id = ?", [hashed, userId]);

        if (req.accepts("json") && !req.accepts("html")) {
            return res.json({ success: true, message: "Password updated successfully." });
        };

        req.flash("success", "Password updated successfully.");
        return res.redirect("/driver/profile");
    } catch (err) {
        console.error("[Driver updateProfile]", err);
        if (req.accepts("json") && !req.accepts("html")) {
            return res.status(500).json({ success: false, message: "Failed to update password." });
        };   
            
        req.flash("error", "Failed to update password.");
        return res.redirect("/driver/profile");
    };
};
