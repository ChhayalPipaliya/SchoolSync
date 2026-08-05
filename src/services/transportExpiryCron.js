const cron = require('node-cron');
const db = require('../config/database');
const { getSubscriptionState } = require('./subscriptionService');

const THRESHOLDS = [30, 15, 7, 1];

const DOC_CONFIGS = [
    { key: 'insurance', label: 'Insurance', expiryCol: 'insurance_expiry', daysCol: 'insurance_days' },
    { key: 'puc', label: 'PUC Certificate', expiryCol: 'puc_expiry', daysCol: 'puc_days' },
    { key: 'permit', label: 'Permit', expiryCol: 'permit_expiry', daysCol: 'permit_days' },
    { key: 'fitness', label: 'Fitness Certificate', expiryCol: 'fitness_expiry', daysCol: 'fitness_days' }
];

async function runTransportExpiryCheck() {
    console.log('[TransportExpiryCron] Starting transport document expiry check...');
    let alertsCreatedCount = 0;

    try {
        const [schools] = await db.query(
            `SELECT id, school_name FROM schools WHERE status = 'active' OR status IS NULL`
        );

        for (const school of schools) {
            try {
                const subState = await getSubscriptionState(school.id).catch(() => null);
                if (subState && typeof subState.hasFeature === 'function' && !subState.hasFeature('transport')) {
                    continue;
                }

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
                            DATEDIFF(insurance_expiry, CURDATE()) IN (30, 15, 7, 1) OR
                            DATEDIFF(puc_expiry, CURDATE())       IN (30, 15, 7, 1) OR
                            DATEDIFF(permit_expiry, CURDATE())    IN (30, 15, 7, 1) OR
                            DATEDIFF(fitness_expiry, CURDATE())   IN (30, 15, 7, 1)
                        )`,
                    [school.id]
                );

                for (const vehicle of vehicles) {
                    for (const doc of DOC_CONFIGS) {
                        const daysRemaining = vehicle[doc.daysCol] !== null && vehicle[doc.daysCol] !== undefined ? Number(vehicle[doc.daysCol]) : null;

                        if (daysRemaining !== null && THRESHOLDS.includes(daysRemaining)) {
                            const severity = daysRemaining <= 7 ? 'high' : 'medium';
                            const title = `${doc.label} Expiry Warning - ${vehicle.vehicle_number}`;
                            const expiryDateStr = vehicle[doc.expiryCol] ? new Date(vehicle[doc.expiryCol]).toLocaleDateString('en-IN') : 'N/A';
                            const message = `The ${doc.label.toLowerCase()} for vehicle ${vehicle.vehicle_number} is expiring in ${daysRemaining} day(s) (due: ${expiryDateStr}). Please renew it promptly.`;

                            const [existing] = await db.query(
                                `SELECT id FROM transport_alerts
                                 WHERE school_id = ? AND vehicle_id = ? AND alert_type = 'maintenance_due'
                                   AND title = ? AND DATE(created_at) = CURDATE()
                                 LIMIT 1`,
                                [school.id, vehicle.id, title]
                            );

                            if (!existing || existing.length === 0) {
                                await db.query(
                                    `INSERT INTO transport_alerts
                                     (school_id, alert_type, target_role, vehicle_id, title, message, severity, status)
                                     VALUES (?, 'maintenance_due', 'school_admin', ?, ?, ?, ?, 'open')`,
                                    [school.id, vehicle.id, title, message, severity]
                                );
                                alertsCreatedCount++;
                            }
                        }
                    }
                }
            } catch (schoolErr) {
                console.error(`[TransportExpiryCron] Error processing school ID ${school.id}:`, schoolErr.message || schoolErr);
            }
        }

        console.log(`[TransportExpiryCron] Check complete. Generated ${alertsCreatedCount} vehicle document expiry alert(s).`);
    } catch (err) {
        console.error('[TransportExpiryCron] Fatal error during transport document expiry check:', err);
    }
}

function initTransportExpiryCron() {
    cron.schedule('0 7 * * *', () => {
        runTransportExpiryCheck().catch(err => console.error('[TransportExpiryCron] Unhandled error:', err));
    });
}

module.exports = { runTransportExpiryCheck, initTransportExpiryCron };
