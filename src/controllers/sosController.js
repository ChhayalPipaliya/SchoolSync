const { queryAsync, withTransaction } = require('../config/database');
const { getIO } = require('../config/socket');
const { resolveUserSchoolId } = require('../utils/resolveUserSchoolId');

let schemaInitialized = false;
async function ensureAlertsSchema() {
    if (schemaInitialized) return;
    try {
        await queryAsync(`
            CREATE TABLE IF NOT EXISTS transport_alerts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                school_id INT NOT NULL,
                driver_id INT NOT NULL,
                user_id INT NULL,
                trip_id INT NULL,
                alert_type ENUM('accident', 'breakdown', 'medical', 'hazard', 'general') DEFAULT 'general',
                latitude DECIMAL(10, 8) NULL,
                longitude DECIMAL(11, 8) NULL,
                status ENUM('active', 'acknowledged', 'resolved') DEFAULT 'active',
                pin VARCHAR(10) DEFAULT '1234',
                notes TEXT NULL,
                acknowledged_at DATETIME NULL,
                resolved_at DATETIME NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                KEY idx_school_driver (school_id, driver_id),
                KEY idx_status (status),
                KEY idx_trip (trip_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await queryAsync(`
            CREATE TABLE IF NOT EXISTS transport_alert_messages (
                id INT AUTO_INCREMENT PRIMARY KEY,
                alert_id INT NOT NULL,
                sender_id INT NOT NULL,
                sender_role VARCHAR(50) NOT NULL,
                message TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                KEY idx_alert (alert_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        schemaInitialized = true;
    } catch (err) {
        console.error('[SOS Schema Init Error]:', err.message);
    }
}

exports.triggerSOS = async (req, res) => {
    try {
        await ensureAlertsSchema();
        const schoolId = await resolveUserSchoolId(req.user);
        const userId = req.user?.id;

        if (!schoolId || !userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { alert_type = 'general', latitude, longitude, trip_id, notes } = req.body;
        const lat = Number(latitude) || null;
        const lng = Number(longitude) || null;

        const driverRows = await queryAsync(
            `SELECT d.id, d.vehicle_id, v.vehicle_number, r.route_name
             FROM drivers d
             LEFT JOIN vehicles v ON d.vehicle_id = v.id
             LEFT JOIN routes r ON d.route_id = r.id
             WHERE d.user_id = ? AND d.school_id = ? LIMIT 1`,
            [userId, schoolId]
        );

        if (!driverRows.length) {
            return res.status(404).json({ success: false, message: 'Driver profile not found' });
        }

        const driver = driverRows[0];
        const driverId = driver.id;

        const result = await queryAsync(
            `INSERT INTO transport_alerts (school_id, driver_id, user_id, trip_id, alert_type, latitude, longitude, status, pin, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'active', '1234', ?)`,
            [schoolId, driverId, userId, trip_id || null, alert_type, lat, lng, notes || null]
        );

        const alertId = result.insertId;

        try {
            const io = getIO();
            if (io) {
                const sosPayload = {
                    alert_id: alertId,
                    school_id: schoolId,
                    driver_id: driverId,
                    driver_name: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
                    driver_phone: req.user.phone || 'N/A',
                    vehicle_number: driver.vehicle_number || 'N/A',
                    route_name: driver.route_name || 'N/A',
                    alert_type,
                    latitude: lat,
                    longitude: lng,
                    status: 'active',
                    timestamp: new Date().toISOString()
                };

                io.to(`school_${schoolId}`).emit('sos_alert', sosPayload);
                io.emit('sos_global_alert', sosPayload);
            }
        } catch (sockErr) {
            console.warn('[SOS Socket Emit Warning]:', sockErr.message);
        }

        await queryAsync(
            `INSERT INTO driver_notifications (driver_id, user_id, school_id, type, priority, title, message, link)
             VALUES (?, ?, ?, 'sos_ack', 'high', '🚨 SOS EMERGENCY ACTIVATED', 'Emergency dispatch notified. Live location tracking active.', ?)`,
            [driverId, userId, schoolId, `/driver/sos/active/${alertId}`]
        ).catch(() => {});

        return res.json({
            success: true,
            message: '🚨 SOS Emergency Alert Activated! Help is on the way.',
            alertId,
            redirectUrl: `/driver/sos/active/${alertId}`
        });

    } catch (err) {
        console.error('Trigger SOS Error:', err);
        return res.status(500).json({ success: false, message: 'Server error activating SOS' });
    }
};

exports.getActiveSOSPage = async (req, res) => {
    try {
        await ensureAlertsSchema();
        const schoolId = await resolveUserSchoolId(req.user);
        const userId = req.user?.id;

        const alertId = req.params.alertId;
        let alertRows = [];

        if (alertId) {
            alertRows = await queryAsync(
                `SELECT ta.*, u.first_name, u.last_name, u.phone AS driver_phone,
                        v.vehicle_number, r.route_name, s.phone AS school_phone
                 FROM transport_alerts ta
                 JOIN drivers d ON ta.driver_id = d.id
                 JOIN users u ON d.user_id = u.id
                 LEFT JOIN vehicles v ON d.vehicle_id = v.id
                 LEFT JOIN routes r ON d.route_id = r.id
                 LEFT JOIN schools s ON ta.school_id = s.id
                 WHERE ta.id = ? AND ta.school_id = ? LIMIT 1`,
                [alertId, schoolId]
            );
        } else {
            alertRows = await queryAsync(
                `SELECT ta.*, u.first_name, u.last_name, u.phone AS driver_phone,
                        v.vehicle_number, r.route_name, s.phone AS school_phone
                 FROM transport_alerts ta
                 JOIN drivers d ON ta.driver_id = d.id
                 JOIN users u ON d.user_id = u.id
                 LEFT JOIN vehicles v ON d.vehicle_id = v.id
                 LEFT JOIN routes r ON d.route_id = r.id
                 LEFT JOIN schools s ON ta.school_id = s.id
                 WHERE ta.user_id = ? AND ta.status IN ('active', 'acknowledged')
                 ORDER BY ta.id DESC LIMIT 1`,
                [userId]
            );
        }

        if (!alertRows.length) {
            req.flash('info', 'No active SOS emergency running.');
            return res.redirect('/driver/dashboard');
        }

        const alert = alertRows[0];

        const messages = await queryAsync(
            `SELECT tam.*, u.first_name, u.last_name
             FROM transport_alert_messages tam
             JOIN users u ON tam.sender_id = u.id
             WHERE tam.alert_id = ?
             ORDER BY tam.id ASC`,
            [alert.id]
        ).catch(() => []);

        return res.render('driver/sosActive', {
            user: req.user,
            alert,
            messages: messages || [],
            schoolPhone: alert.school_phone || '108'
        });

    } catch (err) {
        console.error('Get Active SOS Page Error:', err);
        return res.status(500).render('errors/500', { title: 'SOS Error', message: 'Failed to load SOS active screen' });
    }
};

// 3. UPDATE SOS GPS LOCATION LIVE
exports.updateSOSLocation = async (req, res) => {
    try {
        await ensureAlertsSchema();
        const { alert_id, latitude, longitude } = req.body;
        const lat = Number(latitude);
        const lng = Number(longitude);

        if (!alert_id || !Number.isFinite(lat) || !Number.isFinite(lng)) {
            return res.status(400).json({ success: false, message: 'Invalid payload' });
        }

        await queryAsync(
            `UPDATE transport_alerts SET latitude = ?, longitude = ? WHERE id = ?`,
            [lat, lng, alert_id]
        );

        // Emit live location update
        try {
            const io = getIO();
            if (io) {
                io.emit(`sos_location_${alert_id}`, { alert_id, latitude: lat, longitude: lng });
            }
        } catch (_) {}

        return res.json({ success: true });
    } catch (err) {
        console.error('Update SOS Location Error:', err);
        return res.status(500).json({ success: false, message: 'Failed to update location' });
    }
};

// 4. CANCEL SOS ALERT (REQUIRES 4-DIGIT PIN)
exports.cancelSOS = async (req, res) => {
    try {
        await ensureAlertsSchema();
        const { alert_id, pin } = req.body;

        if (!alert_id || !pin) {
            return res.status(400).json({ success: false, message: 'Alert ID and 4-digit PIN are required' });
        }

        const [alert] = await queryAsync(
            `SELECT id, pin, school_id FROM transport_alerts WHERE id = ? LIMIT 1`,
            [alert_id]
        );

        if (!alert) {
            return res.status(404).json({ success: false, message: 'SOS alert not found' });
        }

        // Validate PIN (Default '1234' or driver PIN)
        if (String(pin).trim() !== String(alert.pin || '1234').trim() && String(pin).trim() !== '1234') {
            return res.status(400).json({ success: false, message: 'Incorrect PIN! Unable to cancel emergency.' });
        }

        await queryAsync(
            `UPDATE transport_alerts SET status = 'resolved', resolved_at = NOW() WHERE id = ?`,
            [alert_id]
        );

        // Notify Admin via Socket
        try {
            const io = getIO();
            if (io) {
                io.to(`school_${alert.school_id}`).emit('sos_cancelled', { alert_id });
            }
        } catch (_) {}

        return res.json({ success: true, message: 'SOS alert cancelled successfully' });

    } catch (err) {
        console.error('Cancel SOS Error:', err);
        return res.status(500).json({ success: false, message: 'Failed to cancel SOS alert' });
    }
};

// 5. SEND CHAT MESSAGE IN SOS
exports.sendSOSMessage = async (req, res) => {
    try {
        await ensureAlertsSchema();
        const { alert_id, message } = req.body;
        const userId = req.user?.id;
        const role = req.user?.role || 'driver';

        if (!alert_id || !message) {
            return res.status(400).json({ success: false, message: 'Message cannot be empty' });
        }

        const result = await queryAsync(
            `INSERT INTO transport_alert_messages (alert_id, sender_id, sender_role, message)
             VALUES (?, ?, ?, ?)`,
            [alert_id, userId, role, message.trim()]
        );

        const msgPayload = {
            id: result.insertId,
            alert_id,
            sender_id: userId,
            sender_name: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
            sender_role: role,
            message: message.trim(),
            created_at: new Date().toISOString()
        };

        try {
            const io = getIO();
            if (io) {
                io.emit(`sos_chat_${alert_id}`, msgPayload);
            }
        } catch (_) {}

        return res.json({ success: true, messageData: msgPayload });

    } catch (err) {
        console.error('Send SOS Message Error:', err);
        return res.status(500).json({ success: false, message: 'Failed to send message' });
    }
};

// 6. ADMIN ACKNOWLEDGE / RESOLVE SOS
exports.adminAcknowledgeSOS = async (req, res) => {
    try {
        await ensureAlertsSchema();
        const { alert_id } = req.body;
        if (!alert_id) return res.status(400).json({ success: false, message: 'Alert ID required' });

        await queryAsync(
            `UPDATE transport_alerts SET status = 'acknowledged', acknowledged_at = NOW() WHERE id = ?`,
            [alert_id]
        );

        try {
            const io = getIO();
            if (io) io.emit(`sos_status_${alert_id}`, { status: 'acknowledged' });
        } catch (_) {}

        return res.json({ success: true, message: 'Alert acknowledged' });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to acknowledge alert' });
    }
};
