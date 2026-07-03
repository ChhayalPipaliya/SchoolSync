const db = require('../../config/database');
const bcrypt = require('bcryptjs');
const fs = require('fs');

const driverDocumentFields = {
    license_document: 'License Document',
    aadhaar_card: 'Aadhaar Card',
    address_proof: 'Address Proof',
    medical_certificate: 'Medical Certificate',
    police_verification: 'Police Verification',
    other_document: 'Other Document'
};

function getUploadedFile(files, fieldName) {
    return files?.[fieldName]?.[0] || null;
};

function flattenUploadedFiles(files) {
    if (!files) return [];
    if (Array.isArray(files)) return files;
    return Object.values(files).flat();
};

function cleanupUploadedFiles(files) {
    flattenUploadedFiles(files).forEach(file => {
        if (file?.path && fs.existsSync(file.path)) {
            try { fs.unlinkSync(file.path); } catch (e) { }
        };
    });
};

async function saveDriverDocuments(tx, driverId, files) {
    for (const [fieldName, label] of Object.entries(driverDocumentFields)) {
        const file = getUploadedFile(files, fieldName);
        if (!file) continue;

        await tx.query(
            `INSERT INTO driver_documents (driver_id, document_name, document_type, file_path, file_url, uploaded_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
            [driverId, file.originalname || label, fieldName, file.path, `/uploads/drivers/${file.filename}`]
        );
    };
};

exports.listDrivers = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const [[totalStats]] = await db.query(
            'SELECT COUNT(*) as count FROM drivers WHERE school_id = ? AND deleted_at IS NULL',
            [schoolId]
        );
        const [[activeStats]] = await db.query(
            'SELECT COUNT(*) as count FROM drivers WHERE school_id = ? AND status = "active" AND deleted_at IS NULL',
            [schoolId]
        );
        const [[inactiveStats]] = await db.query(
            'SELECT COUNT(*) as count FROM drivers WHERE school_id = ? AND status = "inactive" AND deleted_at IS NULL',
            [schoolId]
        );
        const [[suspendedStats]] = await db.query(
            'SELECT COUNT(*) as count FROM drivers WHERE school_id = ? AND status = "suspended" AND deleted_at IS NULL',
            [schoolId]
        );

        const stats = {
            total: totalStats?.count || 0,
            active: activeStats?.count || 0,
            inactive: inactiveStats?.count || 0,
            suspended: suspendedStats?.count || 0
        };

        const [drivers] = await db.query(
            `SELECT d.*, d.first_name as first_name, d.last_name as last_name, v.vehicle_number as vehicleNumber, v.model AS vehicleModel, r.route_name as routeName
            FROM drivers d
            LEFT JOIN driver_vehicle_assign dva ON dva.driver_id = d.id AND dva.school_id = d.school_id AND dva.is_active = 1
            LEFT JOIN vehicles v ON v.id = dva.vehicle_id
            LEFT JOIN routes r ON r.driver_id = d.id AND r.status = 'active'
            WHERE d.school_id = ? AND d.deleted_at IS NULL
            ORDER BY d.created_at DESC`,
            [schoolId]
        );

        res.render('schoolAdmin/drivers/index', { title: 'Drivers', stats, drivers });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load drivers');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.showAddForm = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const [vehicles] = await db.query(
            'SELECT *, vehicle_number as vehicleNumber FROM vehicles WHERE school_id = ? ORDER BY vehicle_number ASC',
            [schoolId]
        );

        res.render('schoolAdmin/drivers/driver_form', {
            title: 'Add Driver',
            formData: {},
            vehicles
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load add driver form');
        res.redirect('/schooladmin/drivers');
    };
};

exports.createDriver = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { first_name, last_name, phone, email, password, address, aadharNumber, licenseNumber, licenseExpiry, vehicle_id } = req.body;
        const status = req.body.status || 'active';
        const userStatus = status === 'active' ? 'active' : 'inactive';
        const imageFile = getUploadedFile(req.files, 'image');
        const photo = imageFile ? `/uploads/drivers/${imageFile.filename}` : null;

        const [existing] = await db.query(
            'SELECT id FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1',
            [email]
        );

        if (existing.length > 0) {
            req.flash('error', 'Email is already registered');
            return res.redirect('/schooladmin/drivers/add');
        };

        const hashedPassword = await bcrypt.hash(password, 10);
        await db.withTransaction(async (tx) => {
            const userResult = await tx.query(
                `INSERT INTO users (school_id, first_name, last_name, email, phone, password, role, status, profile_image)
                VALUES (?, ?, ?, ?, ?, ?, 'driver', ?, ?)`,
                [schoolId, first_name, last_name, email, phone, hashedPassword, userStatus, photo]
            );

            const driverResult = await tx.query(
                `INSERT INTO drivers (school_id, user_id, first_name, last_name, email, phone, address, license_number, license_expiry, aadhar_number, status, image)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [schoolId, userResult.insertId, first_name, last_name, email, phone, address || null, licenseNumber, licenseExpiry, aadharNumber || null, status, photo]
            );

            const driverId = driverResult.insertId;
            if (vehicle_id) {
                await tx.query(
                    `UPDATE driver_vehicle_assign SET is_active = 0 WHERE school_id = ? AND (driver_id = ? OR vehicle_id = ?) AND is_active = 1`,
                    [schoolId, driverId, vehicle_id]
                );

                await tx.query(
                    `INSERT INTO driver_vehicle_assign (school_id, driver_id, vehicle_id, assigned_date, is_active) VALUES (?, ?, ?, CURDATE(), 1)`,
                    [schoolId, driverId, vehicle_id]
                );
            };
            await saveDriverDocuments(tx, driverId, req.files);
        });

        req.flash('success', 'Driver created successfully');
        res.redirect('/schooladmin/drivers');
    } catch (err) {
        console.error(err);
        cleanupUploadedFiles(req.files);
        req.flash('error', 'Failed to create driver');
        res.redirect('/schooladmin/drivers/add');
    };
};

exports.viewDriver = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { id } = req.params;

        const [[driver]] = await db.query(
            `SELECT d.*, d.first_name as first_name, d.last_name as last_name,
                v.vehicle_number as vehicleNumber, v.model AS vehicleModel, v.capacity, dva.assigned_date as assignedDate,
                r.route_name as routeName, r.start_point as startPoint, r.end_point as endPoint
            FROM drivers d
            LEFT JOIN driver_vehicle_assign dva ON dva.driver_id = d.id AND dva.school_id = d.school_id AND dva.is_active = 1
            LEFT JOIN vehicles v ON v.id = dva.vehicle_id
            LEFT JOIN routes r ON r.driver_id = d.id AND r.status = 'active'
            WHERE d.id = ? AND d.school_id = ? AND d.deleted_at IS NULL
            LIMIT 1`,
            [id, schoolId]
        );

        if (!driver) {
            req.flash('error', 'Driver not found');
            return res.redirect('/schooladmin/drivers');
        };

        const [documents] = await db.query(
            'SELECT * FROM driver_documents WHERE driver_id = ? ORDER BY uploaded_at DESC',
            [id]
        );

        res.render('schoolAdmin/drivers/driver_view', {
            title: 'Driver Profile',
            driver,
            documents
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load driver details');
        res.redirect('/schooladmin/drivers');
    };
};

exports.showEditForm = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { id } = req.params;

        const [[driver]] = await db.query(
            `SELECT d.*, d.first_name as first_name, d.last_name as last_name, dva.vehicle_id AS assignedVehicleId
            FROM drivers d
            LEFT JOIN driver_vehicle_assign dva ON dva.driver_id = d.id AND dva.school_id = d.school_id AND dva.is_active = 1
            WHERE d.id = ? AND d.school_id = ? AND d.deleted_at IS NULL
            LIMIT 1`,
            [id, schoolId]
        );

        if (!driver) {
            req.flash('error', 'Driver not found');
            return res.redirect('/schooladmin/drivers');
        };

        const [vehicles] = await db.query(
            'SELECT *, vehicle_number as vehicleNumber FROM vehicles WHERE school_id = ? ORDER BY vehicle_number ASC',
            [schoolId]
        );

        res.render('schoolAdmin/drivers/driver_form', {
            title: 'Edit Driver',
            driver,
            formData: driver,
            vehicles
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load edit form');
        res.redirect('/schooladmin/drivers');
    };
};

exports.updateDriver = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { id } = req.params;
        const { first_name, last_name, phone, email, password, address, aadharNumber, licenseNumber, licenseExpiry, vehicle_id } = req.body;
        const status = req.body.status || 'active';
        const userStatus = status === 'active' ? 'active' : 'inactive';

        const [[driver]] = await db.query(
            'SELECT * FROM drivers WHERE id = ? AND school_id = ? AND deleted_at IS NULL LIMIT 1',
            [id, schoolId]
        );

        if (!driver) {
            req.flash('error', 'Driver not found');
            return res.redirect('/schooladmin/drivers');
        };

        const [existing] = await db.query(
            'SELECT id FROM users WHERE email = ? AND email != ? AND deleted_at IS NULL LIMIT 1',
            [email, driver.email]
        );

        if (existing.length > 0) {
            req.flash('error', 'Email is already registered by another account');
            return res.redirect(`/schooladmin/drivers/${id}/edit`);
        };

        const imageFile = getUploadedFile(req.files, 'image');
        const photo = imageFile ? `/uploads/drivers/${imageFile.filename}` : null;

        await db.withTransaction(async (tx) => {
            let userSql = 'UPDATE users SET first_name = ?, last_name = ?, email = ?, phone = ?, status = ?';
            const userParams = [first_name, last_name, email, phone, userStatus];

            if (photo) {
                userSql += ', profile_image = ?';
                userParams.push(photo);
            };

            if (password && password.trim().length > 0) {
                const hashedPassword = await bcrypt.hash(password, 10);
                userSql += ', password = ?';
                userParams.push(hashedPassword);
            };

            userSql += ' WHERE email = ? AND role = "driver" AND school_id = ?';
            userParams.push(driver.email, schoolId);
            await tx.query(userSql, userParams);

            let driverSql = `
                UPDATE drivers 
                SET first_name = ?, last_name = ?, email = ?, phone = ?, address = ?, 
                license_number = ?, license_expiry = ?, aadhar_number = ?, status = ?
            `;
            
            const driverParams = [first_name, last_name, email, phone, address || null, licenseNumber, licenseExpiry, aadharNumber || null, status];
            if (photo) {
                driverSql += ', image = ?';
                driverParams.push(photo);
            }

            driverSql += ' WHERE id = ? AND school_id = ?';
            driverParams.push(id, schoolId);
            await tx.query(driverSql, driverParams);

            const [[currentAssign]] = await tx.query(
                'SELECT vehicle_id FROM driver_vehicle_assign WHERE school_id = ? AND driver_id = ? AND is_active = 1 LIMIT 1',
                [schoolId, id]
            );

            const currentVehicleId = currentAssign?.vehicle_id;
            if (String(vehicle_id || '') !== String(currentVehicleId || '')) {
                await tx.query(
                    'UPDATE driver_vehicle_assign SET is_active = 0 WHERE school_id = ? AND driver_id = ? AND is_active = 1',
                    [schoolId, id]
                );

                if (vehicle_id) {
                    await tx.query(
                        'UPDATE driver_vehicle_assign SET is_active = 0 WHERE school_id = ? AND vehicle_id = ? AND is_active = 1',
                        [schoolId, vehicle_id]
                    );

                    await tx.query(
                        'INSERT INTO driver_vehicle_assign (school_id, driver_id, vehicle_id, assigned_date, is_active) VALUES (?, ?, ?, CURDATE(), 1)',
                        [schoolId, id, vehicle_id]
                    );
                };
            };

            await saveDriverDocuments(tx, id, req.files);
        });

        req.flash('success', 'Driver updated successfully');
        res.redirect(`/schooladmin/drivers/${id}`);
    } catch (err) {
        console.error(err);
        cleanupUploadedFiles(req.files);
        req.flash('error', 'Failed to update driver');
        res.redirect(`/schooladmin/drivers/${id}/edit`);
    };
};

exports.deleteDriver = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { id } = req.params;

        const [[driver]] = await db.query(
            'SELECT email FROM drivers WHERE id = ? AND school_id = ? AND deleted_at IS NULL LIMIT 1',
            [id, schoolId]
        );

        if (!driver) {
            req.flash('error', 'Driver not found');
            return res.redirect('/schooladmin/drivers');
        };

        await db.withTransaction(async (tx) => {
            await tx.query(
                'UPDATE drivers SET deleted_at = NOW(), status = "inactive" WHERE id = ? AND school_id = ?',
                [id, schoolId]
            );

            await tx.query(
                'UPDATE users SET deleted_at = NOW(), status = "inactive" WHERE email = ? AND role = "driver" AND school_id = ?',
                [driver.email, schoolId]
            );

            await tx.query(
                'UPDATE driver_vehicle_assign SET is_active = 0 WHERE school_id = ? AND driver_id = ? AND is_active = 1',
                [schoolId, id]
            );

            await tx.query(
                'UPDATE routes SET driver_id = NULL WHERE school_id = ? AND driver_id = ?',
                [schoolId, id]
            );
        });

        req.flash('success', 'Driver deleted successfully');
        res.redirect('/schooladmin/drivers');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to delete driver');
        res.redirect('/schooladmin/drivers');
    };
};

exports.listRoutes = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;

        const [routes] = await db.query(
            `SELECT r.*, r.route_name as routeName, d.first_name AS driverFirst, d.last_name AS driverLast, v.vehicle_number as vehicleNumber, v.capacity
            FROM routes r
            LEFT JOIN drivers d ON r.driver_id = d.id
            LEFT JOIN vehicles v ON r.vehicle_id = v.id
            WHERE r.school_id = ?
            ORDER BY r.route_name ASC`,
            [schoolId]
        );

        const [drivers] = await db.query(
            'SELECT *, first_name as first_name, last_name as last_name FROM drivers WHERE school_id = ? AND deleted_at IS NULL ORDER BY first_name, last_name',
            [schoolId]
        );

        const [vehicles] = await db.query(
            'SELECT *, vehicle_number as vehicleNumber FROM vehicles WHERE school_id = ? ORDER BY vehicle_number ASC',
            [schoolId]
        );

        res.render('schoolAdmin/drivers/routes', { title: 'Routes', routes, drivers, vehicles });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load routes');
        res.redirect('/schooladmin/dashboard');
    }
};

exports.addRoute = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { routeName, startPoint, endPoint, driver_id, vehicle_id } = req.body;

        await db.query(
            `INSERT INTO routes (school_id, route_name, start_point, end_point, driver_id, vehicle_id, status)
            VALUES (?, ?, ?, ?, ?, ?, 'active')`,
            [schoolId, routeName, startPoint, endPoint, driver_id || null, vehicle_id || null]
        );

        req.flash('success', 'Route added successfully');
        res.redirect('/schooladmin/drivers/routes');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to add route');
        res.redirect('/schooladmin/drivers/routes');
    };
};

exports.deleteRoute = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { id } = req.params;

        await db.query(
            'DELETE FROM routes WHERE id = ? AND school_id = ?',
            [id, schoolId]
        );

        req.flash('success', 'Route deleted successfully');
        res.redirect('/schooladmin/drivers/routes');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to delete route');
        res.redirect('/schooladmin/drivers/routes');
    };
};

exports.listVehicles = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;

        const [vehicles] = await db.query(
            `SELECT v.*, v.vehicle_number as vehicleNumber, d.first_name AS driverFirst, d.last_name AS driverLast, d.image AS driverImage
            FROM vehicles v
            LEFT JOIN driver_vehicle_assign dva ON dva.vehicle_id = v.id AND dva.school_id = v.school_id AND dva.is_active = 1
            LEFT JOIN drivers d ON dva.driver_id = d.id
            WHERE v.school_id = ?
            ORDER BY v.vehicle_number ASC`,
            [schoolId]
        );

        res.render('schoolAdmin/drivers/vehicles', { title: 'Vehicles', vehicles });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load vehicles');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.addVehicle = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { vehicleNumber, model, type, capacity, status } = req.body;

        await db.query(
            `INSERT INTO vehicles (school_id, vehicle_number, model, type, capacity, status)
            VALUES (?, ?, ?, ?, ?, ?)`,
            [schoolId, vehicleNumber.toUpperCase(), model || null, type, capacity, status || 'active']
        );

        req.flash('success', 'Vehicle added successfully');
        res.redirect('/schooladmin/drivers/vehicles');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to add vehicle');
        res.redirect('/schooladmin/drivers/vehicles');
    };
};

exports.deleteVehicle = async (req, res) => {
    try {
        const schoolId = req.session.user.school_id;
        const { id } = req.params;

        await db.withTransaction(async (tx) => {
            await tx.query(
                'DELETE FROM vehicles WHERE id = ? AND school_id = ?',
                [id, schoolId]
            );

            await tx.query(
                'UPDATE driver_vehicle_assign SET is_active = 0 WHERE school_id = ? AND vehicle_id = ? AND is_active = 1',
                [schoolId, id]
            );

            await tx.query(
                'UPDATE routes SET vehicle_id = NULL WHERE school_id = ? AND vehicle_id = ?',
                [schoolId, id]
            );
        });

        req.flash('success', 'Vehicle deleted successfully');
        res.redirect('/schooladmin/drivers/vehicles');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to delete vehicle');
        res.redirect('/schooladmin/drivers/vehicles');
    };
};
