const mysql = require('mysql2/promise');
const bcryptjs = require('bcryptjs');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || ''
};

const dbName = process.env.DB_NAME || 'schoolsync_db';

const SUPPORTED_PLAN_FEATURES = [
    "dashboard", "students", "teachers", "classes", "subjects", "attendance", "fees",
    "exams", "homework", "timetable", "library", "transport", "salary", "certificates",
    "reports", "parent_portal", "student_portal", "messaging", "settings", "analytics",
    "notices", "events", "admissions", "meetings", "leaves", "portal"
];

const TIMETABLE_FEATURE_ALIASES = [
    "timetable", "time_table", "class_timetable", "weekly_timetable", "schedule", "weekly_schedule"
];

const plansToSeed = [
    {
        name: "Trial",
        plan_key: "trial",
        description: "7-day full access demo",
        monthly_price: 0,
        yearly_price: 0,
        max_students: 50,
        max_teachers: 10,
        max_classes: 10,
        trial_days: 7,
        is_active: 1,
        is_popular: 0,
        status: "active",
        color_code: "#3B82F6",
        icon: "demo",
        featuresList: SUPPORTED_PLAN_FEATURES
    },
    {
        name: "Basic",
        plan_key: "basic",
        description: "Starter plan for small schools",
        monthly_price: 999,
        yearly_price: 9999,
        max_students: 200,
        max_teachers: 20,
        max_classes: 20,
        trial_days: 0,
        is_active: 1,
        is_popular: 0,
        status: "active",
        color_code: "#10B981",
        icon: "book",
        featuresList: [
            "dashboard", "students", "teachers", "classes", "subjects", "attendance",
            "fees", "exams", "homework", "timetable", "notices", "events", "reports",
            "parent_portal", "student_portal", "settings", "leaves", "portal"
        ]
    },
    {
        name: "Standard",
        plan_key: "standard",
        description: "Best plan for growing schools",
        monthly_price: 2499,
        yearly_price: 24999,
        max_students: 800,
        max_teachers: 60,
        max_classes: 60,
        trial_days: 0,
        is_active: 1,
        is_popular: 1,
        status: "active",
        color_code: "#F59E0B",
        icon: "star",
        featuresList: [
            "dashboard", "students", "teachers", "classes", "subjects", "attendance",
            "fees", "exams", "homework", "timetable", "notices", "events", "reports",
            "parent_portal", "student_portal", "settings", "leaves", "portal",
            "library", "transport", "messaging", "certificates"
        ]
    },
    {
        name: "Premium",
        plan_key: "premium",
        description: "Advanced plan for full ERP usage",
        monthly_price: 4999,
        yearly_price: 49999,
        max_students: 2500,
        max_teachers: 200,
        max_classes: 120,
        trial_days: 0,
        is_active: 1,
        is_popular: 0,
        status: "active",
        color_code: "#EF4444",
        icon: "crown",
        featuresList: SUPPORTED_PLAN_FEATURES
    }
];

async function seedPlans(conn) {
    console.log("Seeding subscription plans...");
    for (const p of plansToSeed) {
        const featuresObj = {};
        const enabledKeys = new Set();
        
        for (const feat of SUPPORTED_PLAN_FEATURES) {
            const enabled = p.featuresList.includes(feat);
            featuresObj[feat] = enabled;
            if (enabled) {
                enabledKeys.add(feat);
            }
        }
        
        if (TIMETABLE_FEATURE_ALIASES.some(key => featuresObj[key])) {
            for (const key of TIMETABLE_FEATURE_ALIASES) {
                featuresObj[key] = true;
                enabledKeys.add(key);
            }
        }
        
        const [existing] = await conn.query(
            "SELECT id FROM plans WHERE plan_key = ?",
            [p.plan_key]
        );
        
        let planId;
        if (existing.length === 0) {
            const [result] = await conn.query(
                `INSERT INTO plans (name, plan_key, slug, description, monthly_price, yearly_price, price, student_limit, max_students, max_teachers, teacher_limit, max_classes, features, trial_days, color_code, icon, is_active, is_popular, status, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    p.name, p.plan_key, p.plan_key, p.description,
                    p.monthly_price, p.yearly_price, p.monthly_price,
                    p.max_students, p.max_students, p.max_teachers, p.max_teachers, p.max_classes,
                    JSON.stringify(featuresObj), p.trial_days, p.color_code, p.icon,
                    p.is_active, p.is_popular, p.status
                ]
            );
            planId = result.insertId;
            console.log(`Plan '${p.name}' created with ID: ${planId}`);
        } else {
            planId = existing[0].id;
            await conn.query(
                `UPDATE plans SET 
                    name = ?, slug = ?, description = ?, monthly_price = ?, yearly_price = ?, price = ?, 
                    student_limit = ?, max_students = ?, max_teachers = ?, teacher_limit = ?, max_classes = ?, 
                    features = ?, trial_days = ?, color_code = ?, icon = ?, is_active = ?, is_popular = ?, status = ?
                 WHERE id = ?`,
                [
                    p.name, p.plan_key, p.description,
                    p.monthly_price, p.yearly_price, p.monthly_price,
                    p.max_students, p.max_students, p.max_teachers, p.max_teachers, p.max_classes,
                    JSON.stringify(featuresObj), p.trial_days, p.color_code, p.icon,
                    p.is_active, p.is_popular, p.status, planId
                ]
            );
            console.log(`Plan '${p.name}' updated.`);
        }
        
        await conn.query("DELETE FROM subscription_plan_features WHERE plan_id = ?", [planId]);
        for (const feat of enabledKeys) {
            await conn.query(
                `INSERT INTO subscription_plan_features (plan_id, feature_name)
                 VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE feature_name = VALUES(feature_name)`,
                [planId, feat]
            );
        }
    }
    console.log("Subscription plans seeded successfully!");
}

async function seedMasterData(conn) {
    console.log("Seeding master mediums...");
    const mediums = [
        { code: 'guj', name: 'Gujarati', dbName: 'GUJARATI', sort: 1 },
        { code: 'eng', name: 'English', dbName: 'ENGLISH', sort: 2 },
        { code: 'hin', name: 'Hindi', dbName: 'HINDI', sort: 3 }
    ];
    for (const m of mediums) {
        await conn.query(
            `INSERT INTO mediums (medium_code, medium_name, name, sort_order, is_active)
             VALUES (?, ?, ?, ?, 1)
             ON DUPLICATE KEY UPDATE medium_name = VALUES(medium_name), name = VALUES(name)`,
            [m.code, m.name, m.dbName, m.sort]
        );
    }

    console.log("Seeding school types...");
    const schoolTypes = [
        { key: 'pre_primary', name: 'Pre-Primary', code: 'pre_primary', desc: 'Pre-Primary School', sort: 1 },
        { key: 'primary', name: 'Primary', code: 'primary', desc: 'Primary School', sort: 2 },
        { key: 'secondary', name: 'Secondary', code: 'secondary', desc: 'Secondary School', sort: 3 },
        { key: 'higher_secondary', name: 'Higher Secondary', code: 'higher_secondary', desc: 'Higher Secondary School', sort: 4 },
        { key: 'kg_to_12', name: 'KG to 12', code: 'kg_to_12', desc: 'Complete School (KG to 12)', sort: 5 }
    ];
    for (const t of schoolTypes) {
        await conn.query(
            `INSERT INTO school_types (type_key, type_name, name, code, description, sort_order, is_active)
             VALUES (?, ?, ?, ?, ?, ?, 1)
             ON DUPLICATE KEY UPDATE type_name = VALUES(type_name), name = VALUES(name), code = VALUES(code)`,
            [t.key, t.name, t.name, t.code, t.desc, t.sort]
        );
    }

    console.log("Seeding school type mappings...");
    const mappings = {
        pre_primary: ['Nursery', 'LKG', 'UKG'],
        primary: ['1', '2', '3', '4', '5'],
        secondary: ['6', '7', '8', '9', '10'],
        higher_secondary: ['11', '12'],
        kg_to_12: ['Nursery', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']
    };
    for (const [typeKey, classes] of Object.entries(mappings)) {
        const [[typeRow]] = await conn.query("SELECT id FROM school_types WHERE type_key = ? LIMIT 1", [typeKey]);
        if (typeRow) {
            for (let i = 0; i < classes.length; i++) {
                await conn.query(
                    `INSERT INTO school_type_mappings (school_type_id, class_name, class_code, sort_order)
                     VALUES (?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE class_code = VALUES(class_code), sort_order = VALUES(sort_order)`,
                    [typeRow.id, classes[i], classes[i].toLowerCase(), i + 1]
                );
            }
        }
    }
    console.log("Master data seeded successfully!");
}

async function resetDatabase() {
    console.log(`Connecting to MySQL at ${dbConfig.host}:${dbConfig.port} as ${dbConfig.user}...`);
    const connection = await mysql.createConnection({
        host: dbConfig.host,
        port: dbConfig.port,
        user: dbConfig.user,
        password: dbConfig.password
    });

    console.log(`Dropping database if exists: ${dbName}`);
    await connection.query(`DROP DATABASE IF EXISTS \`${dbName}\``);

    console.log(`Creating database: ${dbName}`);
    await connection.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    
    await connection.end();

    console.log(`Reconnecting to MySQL with database ${dbName}...`);
    const dbConnection = await mysql.createConnection({
        ...dbConfig,
        database: dbName
    });

    console.log("Importing database.sql schema statement by statement...");
    const { splitStatements } = require('./src/config/runMigration');
    const schemaSql = fs.readFileSync(path.join(__dirname, 'database.sql'), 'utf8');
    const statements = splitStatements(schemaSql);
    for (const statement of statements) {
        await dbConnection.query(statement);
    }
    console.log("database.sql schema imported successfully!");

    await dbConnection.end();

    console.log("Running migrations...");
    const { main: runMigrations } = require('./src/config/runMigration');
    await runMigrations();
    console.log("Migrations applied successfully!");

    console.log("Seeding RBAC roles...");
    const { seedRBAC } = require('./src/config/rbacSeeder');
    await seedRBAC();
    console.log("RBAC roles seeded successfully!");

    // Seed default subscription plans
    const conn = await mysql.createConnection({
        ...dbConfig,
        database: dbName
    });
    await seedPlans(conn);
    await seedMasterData(conn);

    console.log("Seeding Super Admin user...");
    const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@schoolsync.com';
    const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || 'Admin@123';
    const superAdminFirstName = process.env.SUPER_ADMIN_FIRST_NAME || 'Super';
    const superAdminLastName = process.env.SUPER_ADMIN_LAST_NAME || 'Admin';

    const hashedPassword = await bcryptjs.hash(superAdminPassword, 10);

    const [userRows] = await conn.query(
        "SELECT id FROM users WHERE role = 'super_admin' AND email = ?",
        [superAdminEmail]
    );

    if (userRows.length === 0) {
        await conn.query(
            `INSERT INTO users (first_name, last_name, email, password, role, status, is_email_verified) 
             VALUES (?, ?, ?, ?, 'super_admin', 'active', 1)`,
            [superAdminFirstName, superAdminLastName, superAdminEmail, hashedPassword]
        );
        console.log(`Super Admin user created successfully: ${superAdminEmail}`);
    } else {
        console.log("Super Admin user already exists.");
    }

    await conn.end();
    console.log("Database reset and seeding completed successfully!");
}

resetDatabase().catch(err => {
    console.error("Error resetting database:", err);
    process.exit(1);
});
