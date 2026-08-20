const { queryAsync, executeAsync } = require("./database");

let birthdaySchemaInitialized = false;

async function ensureBirthdayNotificationSchema() {
    if (birthdaySchemaInitialized) return;
    try {
        const notifCols = await queryAsync(`SHOW COLUMNS FROM notifications LIKE 'idempotency_key'`);
        if (!notifCols || notifCols.length === 0) {
            await executeAsync(`
                ALTER TABLE notifications 
                ADD COLUMN idempotency_key VARCHAR(191) NULL DEFAULT NULL AFTER action_url
            `);
        };

        const notifIndexes = await queryAsync(`SHOW INDEX FROM notifications WHERE Key_name = 'uniq_idempotency_key'`);
        if (!notifIndexes || notifIndexes.length === 0) {
            try {
                await executeAsync(`
                    ALTER TABLE notifications 
                    ADD UNIQUE KEY uniq_idempotency_key (idempotency_key)
                `);
            } catch (idxErr) {
                console.warn("[Migration] Could not create uniq_idempotency_key index:", idxErr.message);
            };
        };

        const driverCols = await queryAsync(`SHOW COLUMNS FROM drivers LIKE 'dob'`);
        if (!driverCols || driverCols.length === 0) {
            const hasDateOfBirth = (await queryAsync(`SHOW COLUMNS FROM drivers LIKE 'date_of_birth'`))?.length > 0;
            if (!hasDateOfBirth) {
                await executeAsync(`
                    ALTER TABLE drivers 
                    ADD COLUMN dob DATE NULL DEFAULT NULL AFTER aadhar_number
                `);
            };
        };

        const libCols = await queryAsync(`SHOW COLUMNS FROM librarians LIKE 'dob'`);
        if (!libCols || libCols.length === 0) {
            const hasDateOfBirth = (await queryAsync(`SHOW COLUMNS FROM librarians LIKE 'date_of_birth'`))?.length > 0;
            if (!hasDateOfBirth) {
                await executeAsync(`
                    ALTER TABLE librarians 
                    ADD COLUMN dob DATE NULL DEFAULT NULL AFTER joining_date
                `);
            };
        };

        birthdaySchemaInitialized = true;
    } catch (err) {
        console.error("[Migration Error] ensureBirthdayNotificationSchema:", err.message);
    };
};

module.exports = { ensureBirthdayNotificationSchema };