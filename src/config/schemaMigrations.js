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
    }
}

let languageSchemaInitialized = false;

async function ensureLanguagePreferenceSchema() {
    if (languageSchemaInitialized) return;
    try {
        const userCols = await queryAsync(`SHOW COLUMNS FROM users LIKE 'preferred_language'`);
        if (!userCols || userCols.length === 0) {
            await executeAsync(`
                ALTER TABLE users 
                ADD COLUMN preferred_language VARCHAR(10) NOT NULL DEFAULT 'en' AFTER role
            `);
            console.log("[Migration] Added preferred_language column to users table.");
        }
        languageSchemaInitialized = true;
    } catch (err) {
        console.error("[Migration Error] ensureLanguagePreferenceSchema:", err.message);
    }
}

let versionSchemaInitialized = false;

async function ensureVersionRolloutSchema() {
    if (versionSchemaInitialized) return;
    try {
        const schoolCols = await queryAsync(`SHOW COLUMNS FROM schools LIKE 'app_version'`);
        if (!schoolCols || schoolCols.length === 0) {
            await executeAsync(`
                ALTER TABLE schools 
                ADD COLUMN app_version VARCHAR(20) NOT NULL DEFAULT '1.0.0' AFTER status
            `);
            console.log("[Migration] Added app_version column to schools table.");
        }

        await executeAsync(`
            UPDATE schools 
            SET app_version = '1.0.0' 
            WHERE app_version IS NULL OR app_version = ''
        `);

        await executeAsync(`
            CREATE TABLE IF NOT EXISTS app_versions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                version VARCHAR(20) NOT NULL UNIQUE,
                release_title VARCHAR(150) NOT NULL,
                release_notes TEXT,
                status ENUM('draft', 'beta', 'active', 'deprecated') NOT NULL DEFAULT 'active',
                is_default TINYINT(1) NOT NULL DEFAULT 0,
                min_supported_version VARCHAR(20) DEFAULT NULL,
                release_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_version_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await executeAsync(`
            CREATE TABLE IF NOT EXISTS app_features (
                id INT AUTO_INCREMENT PRIMARY KEY,
                feature_key VARCHAR(100) NOT NULL UNIQUE,
                name VARCHAR(150) NOT NULL,
                description TEXT,
                min_version VARCHAR(20) NOT NULL DEFAULT '1.1.0',
                is_globally_enabled TINYINT(1) NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_min_version (min_version)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await executeAsync(`
            CREATE TABLE IF NOT EXISTS school_feature_flags (
                id INT AUTO_INCREMENT PRIMARY KEY,
                school_id INT NOT NULL,
                feature_key VARCHAR(100) NOT NULL,
                is_enabled TINYINT(1) NOT NULL DEFAULT 1,
                updated_by_user_id INT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_school_feature (school_id, feature_key),
                INDEX idx_school_id (school_id),
                CONSTRAINT fk_sff_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await executeAsync(`
            CREATE TABLE IF NOT EXISTS school_version_history (
                id INT AUTO_INCREMENT PRIMARY KEY,
                school_id INT NOT NULL,
                old_version VARCHAR(20) NULL,
                new_version VARCHAR(20) NOT NULL,
                action ENUM('upgrade', 'downgrade', 'rollback', 'initial') NOT NULL,
                changed_by_user_id INT NULL,
                changed_by_name VARCHAR(150) NULL,
                reason VARCHAR(255) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_svh_school (school_id),
                INDEX idx_svh_created_at (created_at),
                CONSTRAINT fk_svh_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await executeAsync(`
            INSERT IGNORE INTO app_versions (version, release_title, release_notes, status, is_default, release_date)
            VALUES 
            ('1.0.0', 'SchoolSync 1.0.0 (Baseline Stable)', 'Stable baseline release deployed across standard production schools.', 'active', 1, '2026-07-01 00:00:00'),
            ('1.1.0', 'SchoolSync 1.1.0 (Canary Rollout)', 'Feature release introducing enhanced attendance, advanced visual reports v2, and smart admissions qr suite.', 'beta', 0, '2026-09-08 00:00:00'),
            ('1.2.0', 'SchoolSync 1.2.0 (Next Generation)', 'Upcoming major release featuring real-time collaborative schedule engine and multi-campus sync.', 'draft', 0, '2026-12-01 00:00:00')
        `);

        await executeAsync(`
            INSERT IGNORE INTO app_features (feature_key, name, description, min_version, is_globally_enabled)
            VALUES 
            ('new_attendance_module', 'Enhanced Attendance Module', 'High-speed biometric/RFID sync, quick absent callout alerts, and automated defaulter tracking.', '1.1.0', 0),
            ('advanced_reporting_v2', 'Advanced Visual Reports V2', 'Interactive student performance analytics, revenue forecasting heatmaps, and customizable PDF exports.', '1.1.0', 0),
            ('qr_admissions_v2', 'Smart Admissions QR Suite', 'Indefinite QR validation, in-app document viewer, and instant parent credential SMS/Email dispatcher.', '1.1.0', 0)
        `);

        versionSchemaInitialized = true;
    } catch (err) {
        console.error("[Migration Error] ensureVersionRolloutSchema:", err.message);
    }
}

module.exports = {  ensureBirthdayNotificationSchema,  ensureLanguagePreferenceSchema, ensureVersionRolloutSchema };