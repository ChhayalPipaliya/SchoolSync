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
            v.id AS vehicle_id, v.vehicle_number AS vehicleNumber, v.model AS vehicleModel, v.type, v.capacity, v.status AS vehicleStatus,
            v.registration_number, v.insurance_expiry, v.last_service_date, v.fuel_type, v.color
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

const makeInitials = (driver) => ((driver?.first_name?.charAt(0) || "") + (driver?.last_name?.charAt(0) || "")).toUpperCase();
exports.vehicleChecklist = async (req, res) => {
    try {
        const schoolId = await resolveDriverSchoolId(req.user);
        const driver = await getDriverProfile(schoolId, req.user.id);
    
        if (!driver) {
            req.flash("error", "Driver profile not found.");
            return res.redirect("/driver/dashboard");
        };

        let checklistsHistory = [];
        let maintenanceHistory = [];

        if (driver.vehicle_id) {
            checklistsHistory = await queryAsync(
                "SELECT * FROM vehicle_checklists WHERE school_id = ? AND vehicle_id = ? ORDER BY check_date DESC, id DESC LIMIT 10",
                [schoolId, driver.vehicle_id]
            );
      
            maintenanceHistory = await queryAsync(
                `SELECT id, alert_type, title, message AS description, status, created_at
                FROM transport_alerts
                WHERE school_id = ? AND vehicle_id = ? AND alert_type IN ('vehicle_issue', 'maintenance_due')
                ORDER BY id DESC LIMIT 5`,
                [schoolId, driver.vehicle_id]
            );
            
            if (!maintenanceHistory.length) {
                maintenanceHistory = await queryAsync(
                    "SELECT * FROM vehicle_maintenance_alerts WHERE school_id = ? AND vehicle_id = ? ORDER BY id DESC LIMIT 5",
                    [schoolId, driver.vehicle_id]
                );
            };
        };

        return res.render("driver/vehicle", {
            user: req.user,
            driver,
            checklistsHistory,
            maintenanceHistory,
            driverInitials: makeInitials(driver)
        });
    } catch (err) {
        console.error("[Vehicle Checklist]", err);
        req.flash("error", "Unable to load vehicle information.");
        return res.redirect("/driver/dashboard");
    };
};

exports.saveChecklist = async (req, res) => {
    try {
        const schoolId = await resolveDriverSchoolId(req.user);
        const driver = await getDriverProfile(schoolId, req.user.id);
    
        if (!driver) {
            req.flash("error", "Driver profile not found.");
            return res.redirect("/driver/dashboard");
        };

        if (!driver.vehicle_id) {
            req.flash("error", "No assigned vehicle to submit a checklist for.");
            return res.redirect("/driver/dashboard");
        };

        const checks = req.body.checks || {};
        const points = ['tires', 'brakes', 'lights', 'fuel', 'seats', 'firstaid', 'fire', 'clean', 'steering', 'mirrors', 'engine_oil', 'coolant'];
        const checklistData = {};
        let allPassed = 1;
        const failedItems = [];

        for (const point of points) {
            const passed = !!checks[point];
            checklistData[point] = passed ? 'pass' : 'fail';
            if (!passed) {
                allPassed = 0;
                failedItems.push(point);
            };
        };

        const odometer = req.body.odometer_reading ? parseInt(req.body.odometer_reading) : null;
        const notes = req.body.notes || null;
        const existing = await queryAsync(
            "SELECT id FROM vehicle_checklists WHERE school_id = ? AND vehicle_id = ? AND check_date = CURDATE() LIMIT 1",
            [schoolId, driver.vehicle_id]
        );

        if (existing.length > 0) {
            await queryAsync(
                `UPDATE vehicle_checklists 
                SET checklist_data = ?, notes = ?, odometer_reading = ?, all_passed = ?
                WHERE id = ?`,
                [JSON.stringify(checklistData), notes, odometer, allPassed, existing[0].id]
            );
        } else {
            await queryAsync(
                `INSERT INTO vehicle_checklists (school_id, vehicle_id, driver_id, check_date, checklist_data, notes, odometer_reading, all_passed)
                VALUES (?, ?, ?, CURDATE(), ?, ?, ?, ?)`,
                [schoolId, driver.vehicle_id, driver.id, JSON.stringify(checklistData), notes, odometer, allPassed]
            );
        };

        if (allPassed === 0) {
            const alertDescription = `Failed checklist points: ${failedItems.join(', ')}. Driver notes: ${notes || 'None'}`;
            await queryAsync(
                `INSERT INTO transport_alerts
                (school_id, alert_type, target_role, vehicle_id, title, message, status, created_by)
                VALUES (?, 'vehicle_issue', 'school_admin', ?, 'Vehicle checklist failure', ?, 'open', ?)`,
                [schoolId, driver.vehicle_id, alertDescription, req.user.id || null]
            );
        };

        req.flash("success", allPassed ? "Daily vehicle checklist submitted successfully." : "Checklist submitted with failures. A maintenance alert has been created.");
        return res.redirect("/driver/vehicle");
    } catch (err) {
        console.error("[Save Checklist]", err);
        req.flash("error", "Failed to save daily checklist: " + err.message);
        return res.redirect("/driver/vehicle");
    };
};
