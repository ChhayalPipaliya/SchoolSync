const path = require("path");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const dbConfig = {
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    socketPath: process.env.DB_SOCKET_PATH || undefined,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "schoolsync_db",
    multipleStatements: false
};

const PASSWORD = String(process.env.SEED_DEMO_PASSWORD || "").trim();
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || "admin@schoolsync.com";
const SUPER_ADMIN_PASSWORD = String(process.env.SUPER_ADMIN_PASSWORD || "").trim();
const SUPER_ADMIN_FIRST_NAME = process.env.SUPER_ADMIN_FIRST_NAME || "Super";
const SUPER_ADMIN_LAST_NAME = process.env.SUPER_ADMIN_LAST_NAME || "Admin";
const ACADEMIC_YEAR = "2026-27";
const DEMO_EMAIL_DOMAIN = "demo.schoolsync.local";
const TODAY_SQL = "CURDATE()";
const HAS_RESET_FLAG = process.argv.includes("--reset");
const HAS_RESET_CONFIRMATION = process.argv.includes("--yes");
const RESET = HAS_RESET_FLAG && HAS_RESET_CONFIRMATION;

const REQUIRED_TABLES = [
    "admission_requests", "attendance", "class_subjects", "classes", "driver_attendance",
    "driver_vehicle_assign", "drivers", "events", "exams", "fee_payments", "fee_structures",
    "fees", "group_admin_schools", "group_admins", "homeworks", "invoices",
    "issued_certificates", "librarian_attendance", "librarians", "library_books",
    "library_categories", "library_fines", "library_issues", "library_members", "library_racks",
    "library_settings", "marks", "meetings", "monthly_salaries", "notices", "notifications",
    "plans", "roles", "routes", "salary_structures", "school_chat_permissions",
    "school_groups", "schools", "student_address_transport", "student_family", "student_fees",
    "student_transport_allocations", "students", "subjects", "subscription_history",
    "subscription_payments", "subscription_plan_features", "subscriptions", "support_tickets",
    "system_alerts", "teacher_attendance", "teacher_class_assign", "teachers", "transport_alerts",
    "transport_route_stops", "transport_trip_locations", "transport_trip_students",
    "transport_trips", "users", "vehicles"
];

const SCHOOL_GROUP = {
    group_name: "Surat Global Education Group",
    group_code: "SGEG",
    owner_name: "Nilesh Mehta",
    email: `owner@${DEMO_EMAIL_DOMAIN}`,
    phone: "9876501001",
    address: "Ring Road, Nanpura, Surat",
    city: "Surat",
    state: "Gujarat",
    pincode: "395001",
    status: "active"
};

const PLAN_FEATURES = {
    trial: [
        "dashboard", "students", "teachers", "classes", "subjects", "attendance", "fees",
        "exams", "homework", "timetable", "library", "transport", "salary", "certificates",
        "reports", "parent_portal", "student_portal", "messaging", "settings", "analytics",
        "notices", "events", "admissions", "meetings", "leaves", "portal"
    ],
    basic: ["dashboard", "students", "teachers", "classes", "subjects", "attendance", "timetable", "fees", "settings", "notices", "portal"],
    standard: [
        "dashboard", "students", "teachers", "classes", "subjects", "attendance", "timetable", "fees", "settings", "notices", "portal",
        "exams", "homework", "reports", "library", "transport", "admissions", "parent_portal", "student_portal", "messaging", "events", "leaves"
    ],
    premium: [
        "dashboard", "students", "teachers", "classes", "subjects", "attendance", "fees",
        "exams", "homework", "timetable", "library", "transport", "salary", "certificates",
        "reports", "parent_portal", "student_portal", "messaging", "settings", "analytics",
        "notices", "events", "admissions", "meetings", "leaves", "portal"
    ]
};

const PLANS = [
    { name: "Trial", plan_key: "trial", slug: "trial", monthly_price: 0, yearly_price: 0, trial_days: 7, max_students: null, max_teachers: null, max_classes: null, is_popular: 0, features: PLAN_FEATURES.trial },
    { name: "Basic", plan_key: "basic", slug: "basic", monthly_price: 999, yearly_price: 9999, trial_days: 0, max_students: null, max_teachers: null, max_classes: null, is_popular: 0, features: PLAN_FEATURES.basic },
    { name: "Standard", plan_key: "standard", slug: "standard", monthly_price: 2499, yearly_price: 24999, trial_days: 0, max_students: null, max_teachers: null, max_classes: null, is_popular: 1, features: PLAN_FEATURES.standard },
    { name: "Premium", plan_key: "premium", slug: "premium", monthly_price: 4999, yearly_price: 49999, trial_days: 0, max_students: null, max_teachers: null, max_classes: null, is_popular: 0, features: PLAN_FEATURES.premium }
];

const SCHOOLS = [
    { key: "pre", school_name: "SGEG Pre-Primary School", branch_name: "Pre-Primary", branch_code: "SGEG-PRE", group: true, plan: "trial", classes: ["Nursery", "LKG", "UKG"], medium: "English", school_type: "Pre-Primary", admin: "pre.admin" },
    { key: "primary", school_name: "SGEG Primary School", branch_name: "Primary", branch_code: "SGEG-PRI", group: true, plan: "trial", classes: ["Std 1", "Std 2", "Std 3", "Std 4", "Std 5"], medium: "English", school_type: "Primary", admin: "primary.admin" },
    { key: "secondary", school_name: "SGEG Secondary School", branch_name: "Secondary", branch_code: "SGEG-SEC", group: true, plan: "basic", classes: ["Std 6", "Std 7", "Std 8", "Std 9", "Std 10"], medium: "English", school_type: "Secondary", admin: "secondary.admin" },
    { key: "higher", school_name: "Surat Higher Secondary School", branch_name: "Higher Secondary", branch_code: "SHSS", group: false, plan: "standard", classes: ["Std 11", "Std 12"], medium: "English", school_type: "Higher Secondary", admin: "higher.admin" },
    { key: "kg12", school_name: "Surat KG to 12 School", branch_name: "KG to 12", branch_code: "SK12", group: false, plan: "premium", classes: ["Nursery", "LKG", "UKG", "Std 1", "Std 2", "Std 3", "Std 4", "Std 5", "Std 6", "Std 7", "Std 8", "Std 9", "Std 10", "Std 11", "Std 12"], medium: "English", school_type: "KG to 12", admin: "kg12.admin" }
];

const FIRST_NAMES = ["Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Ayaan", "Krishna", "Ishaan", "Anaya", "Diya", "Myra", "Aadhya", "Kiara", "Sara", "Pari", "Riya", "Kavya", "Nisha"];
const LAST_NAMES = ["Patel", "Shah", "Mehta", "Desai", "Joshi", "Trivedi", "Rana", "Modi", "Vyas", "Bhatt", "Parikh", "Choksi", "Tailor", "Gajjar", "Panchal"];
const TEACHER_NAMES = ["Rupal Shah", "Bhavesh Patel", "Neha Desai", "Kiran Mehta", "Hetal Trivedi", "Amit Joshi", "Pooja Vyas", "Manish Rana", "Jignesh Parikh", "Falguni Bhatt", "Dhruv Modi", "Sejal Choksi", "Pratik Gajjar", "Mitali Tailor", "Ankit Panchal"];
const SUBJECT_SETS = {
    kg: ["English", "Math Readiness", "EVS", "Art & Craft", "Rhymes"],
    primary: ["English", "Gujarati", "Mathematics", "EVS", "Computer"],
    secondary: ["English", "Gujarati", "Mathematics", "Science", "Social Science", "Computer"],
    higher: ["English", "Accountancy", "Business Studies", "Economics", "Statistics", "Computer"]
};

let connection;
let columnsCache = new Map();
let tableCache = new Map();
let passwordHash;
let superAdminPasswordHash;

function slug(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function email(prefix) {
    return `${slug(prefix)}@${DEMO_EMAIL_DOMAIN}`;
}

function phone(seed) {
    return `9${String(870000000 + seed).slice(0, 9)}`;
}

function addDays(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
}

function addBillingCycle(date, billingCycle) {
    const endDate = new Date(date);
    if (billingCycle === "yearly") {
        endDate.setFullYear(endDate.getFullYear() + 1);
    } else {
        endDate.setMonth(endDate.getMonth() + 1);
    }
    return endDate;
}

function toSqlDate(date) {
    return new Date(date).toISOString().slice(0, 10);
}

function pastDate(days) {
    return addDays(-days);
}

function gradeFromMarks(marks) {
    if (marks >= 90) return "A+";
    if (marks >= 80) return "A";
    if (marks >= 70) return "B+";
    if (marks >= 60) return "B";
    if (marks >= 50) return "C";
    return "D";
}

function featureObject(features) {
    return PLAN_FEATURES.trial.reduce((obj, key) => {
        obj[key] = features.includes(key);
        return obj;
    }, {});
}

async function tableExists(table) {
    if (tableCache.has(table)) return tableCache.get(table);
    const [rows] = await connection.execute(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1",
        [dbConfig.database, table]
    );
    const exists = rows.length > 0;
    tableCache.set(table, exists);
    return exists;
}

function validateSeedConfiguration(options = {}) {
    const hasResetFlag = options.hasResetFlag ?? HAS_RESET_FLAG;
    const hasResetConfirmation = options.hasResetConfirmation ?? HAS_RESET_CONFIRMATION;
    const reset = hasResetFlag && hasResetConfirmation;
    const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "development";
    const demoPassword = options.demoPassword ?? PASSWORD;
    const superAdminPassword = options.superAdminPassword ?? SUPER_ADMIN_PASSWORD;

    if (hasResetFlag !== hasResetConfirmation) {
        throw new Error("Destructive reset requires both --reset and --yes.");
    }
    if (reset && String(nodeEnv).toLowerCase() === "production") {
        throw new Error("Refusing to reset demo data while NODE_ENV=production.");
    }
    if (!demoPassword) {
        throw new Error("SEED_DEMO_PASSWORD must be set before running the demo seed.");
    }
    if (!superAdminPassword) {
        throw new Error("SUPER_ADMIN_PASSWORD must be set before running the demo seed.");
    }
}

async function assertRequiredTables() {
    const [rows] = await connection.execute(
        `SELECT TABLE_NAME
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ?`,
        [dbConfig.database]
    );
    const existing = new Set(rows.map((row) => row.TABLE_NAME));
    const missing = REQUIRED_TABLES.filter((table) => !existing.has(table));
    if (missing.length) {
        throw new Error(`Missing required seed table(s): ${missing.join(", ")}. Run migrations first.`);
    }
}

async function columns(table) {
    if (columnsCache.has(table)) return columnsCache.get(table);
    if (!(await tableExists(table))) {
        columnsCache.set(table, new Set());
        return columnsCache.get(table);
    }
    const [rows] = await connection.execute(`SHOW COLUMNS FROM \`${table}\``);
    const cols = new Set(rows.map((row) => row.Field));
    columnsCache.set(table, cols);
    return cols;
}

async function insertRow(table, data) {
    if (!(await tableExists(table))) return null;
    const cols = await columns(table);
    const entries = Object.entries(data).filter(([key, value]) => cols.has(key) && value !== undefined);
    if (!entries.length) return null;
    const names = entries.map(([key]) => `\`${key}\``).join(", ");
    const placeholders = entries.map(() => "?").join(", ");
    const values = entries.map(([, value]) => value);
    const [result] = await connection.execute(`INSERT INTO \`${table}\` (${names}) VALUES (${placeholders})`, values);
    return result.insertId;
}

async function upsertBy(table, keys, data) {
    if (!(await tableExists(table))) return null;
    const where = keys.map((key) => `\`${key}\` <=> ?`).join(" AND ");
    const whereValues = keys.map((key) => data[key]);
    const [existing] = await connection.execute(`SELECT id FROM \`${table}\` WHERE ${where} LIMIT 1`, whereValues);
    if (existing.length) {
        const cols = await columns(table);
        const updates = Object.entries(data).filter(([key, value]) => !keys.includes(key) && cols.has(key) && value !== undefined);
        if (updates.length) {
            await connection.execute(
                `UPDATE \`${table}\` SET ${updates.map(([key]) => `\`${key}\` = ?`).join(", ")} WHERE id = ?`,
                [...updates.map(([, value]) => value), existing[0].id]
            );
        }
        return existing[0].id;
    }
    return insertRow(table, data);
}

async function getId(table, where) {
    const clauses = Object.keys(where).map((key) => `\`${key}\` <=> ?`).join(" AND ");
    const [rows] = await connection.execute(`SELECT id FROM \`${table}\` WHERE ${clauses} LIMIT 1`, Object.values(where));
    return rows[0]?.id || null;
}

async function safeDelete(table, whereSql, params = []) {
    if (!(await tableExists(table))) return;
    await connection.execute(`DELETE FROM \`${table}\` WHERE ${whereSql}`, params);
}

async function seedPlans() {
    for (const plan of PLANS) {
        const planId = await upsertBy("plans", ["plan_key"], {
            name: plan.name,
            plan_key: plan.plan_key,
            slug: plan.slug,
            price: plan.monthly_price,
            monthly_price: plan.monthly_price,
            yearly_price: plan.yearly_price,
            student_limit: plan.max_students,
            max_students: plan.max_students,
            teacher_limit: plan.max_teachers,
            max_teachers: plan.max_teachers,
            max_classes: plan.max_classes,
            trial_days: plan.trial_days,
            color_code: "#3B82F6",
            icon: "package",
            is_active: 1,
            is_popular: plan.is_popular,
            status: "active",
            description: `${plan.name} demo plan for SchoolSync.`,
            features: JSON.stringify(featureObject(plan.features)),
            updated_at: new Date()
        });
        await safeDelete("subscription_plan_features", "plan_id = ?", [planId]);
        for (const feature of plan.features) {
            await insertRow("subscription_plan_features", { plan_id: planId, feature_name: feature });
        }
    }
}

async function resetDemoData() {
    const schoolNames = SCHOOLS.map((school) => school.school_name);
    const [schools] = await connection.query(
        `SELECT id FROM schools WHERE school_name IN (${schoolNames.map(() => "?").join(",")}) OR branch_code IN (${SCHOOLS.map(() => "?").join(",")})`,
        [...schoolNames, ...SCHOOLS.map((school) => school.branch_code)]
    );
    const schoolIds = schools.map((row) => row.id);

    let foreignKeyChecksDisabled = false;
    try {
        await connection.execute("SET FOREIGN_KEY_CHECKS = 0");
        foreignKeyChecksDisabled = true;

        if (schoolIds.length) {
            const [tables] = await connection.query(
                "SELECT TABLE_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND COLUMN_NAME = 'school_id'",
                [dbConfig.database]
            );
            for (const row of tables) {
                const table = row.TABLE_NAME;
                if (table === "schools") continue;
                await safeDelete(table, `school_id IN (${schoolIds.map(() => "?").join(",")})`, schoolIds);
            }
            await safeDelete("schools", `id IN (${schoolIds.map(() => "?").join(",")})`, schoolIds);
        }

        await safeDelete("group_admin_schools", "group_admin_id IN (SELECT id FROM group_admins WHERE school_group_id IN (SELECT id FROM school_groups WHERE group_name = ?))", [SCHOOL_GROUP.group_name]);
        await safeDelete("group_admins", "school_group_id IN (SELECT id FROM school_groups WHERE group_name = ?)", [SCHOOL_GROUP.group_name]);
        await safeDelete("school_groups", "group_name = ?", [SCHOOL_GROUP.group_name]);
        await safeDelete("users", "email LIKE ?", [`%@${DEMO_EMAIL_DOMAIN}`]);
    } finally {
        if (foreignKeyChecksDisabled) {
            await connection.execute("SET FOREIGN_KEY_CHECKS = 1");
        }
    }
}

async function ensureUser({ school_id = null, first_name, last_name, email: userEmail, phone: userPhone, role, password = passwordHash }) {
    return upsertBy("users", ["email"], {
        school_id,
        first_name,
        last_name,
        email: userEmail,
        password,
        is_default_password: 1,
        phone: userPhone,
        role,
        status: "active",
        is_email_verified: 1,
        must_change_password: 0,
        deleted_at: null,
        updated_at: new Date()
    });
}

async function seedRolesAndSuperAdmin(credentials) {
    const roles = [
        ["Super Admin", "super_admin"], ["Group Admin", "group_admin"], ["School Admin", "school_admin"],
        ["Teacher", "teacher"], ["Student", "student"], ["Driver", "driver"], ["Librarian", "librarian"], ["Parent", "parent"]
    ];
    for (const [name, role_key] of roles) {
        await upsertBy("roles", ["role_key"], { uuid: cryptoRandom(), name, role_key, remarks: "Demo role", status: 1, updated_at: new Date() });
    }
    const id = await ensureUser({
        first_name: SUPER_ADMIN_FIRST_NAME,
        last_name: SUPER_ADMIN_LAST_NAME,
        email: SUPER_ADMIN_EMAIL,
        userPhone: "9876500001",
        role: "super_admin",
        password: superAdminPasswordHash
    });
    credentials.superAdmin = { email: SUPER_ADMIN_EMAIL, password: SUPER_ADMIN_PASSWORD, id };
    return id;
}

function cryptoRandom() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === "x" ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function subjectSetFor(className) {
    if (["Nursery", "LKG", "UKG"].includes(className)) return SUBJECT_SETS.kg;
    const std = Number(String(className).replace(/[^0-9]/g, ""));
    if (std >= 11) return SUBJECT_SETS.higher;
    if (std >= 6) return SUBJECT_SETS.secondary;
    return SUBJECT_SETS.primary;
}

async function seedSchoolGroup(superAdminId, credentials) {
    const groupId = await upsertBy("school_groups", ["group_name"], {
        group_name: SCHOOL_GROUP.group_name,
        owner_name: SCHOOL_GROUP.owner_name,
        email: SCHOOL_GROUP.email,
        phone: SCHOOL_GROUP.phone,
        city: SCHOOL_GROUP.city,
        address: `${SCHOOL_GROUP.address}, ${SCHOOL_GROUP.city}, ${SCHOOL_GROUP.state} ${SCHOOL_GROUP.pincode}`,
        status: SCHOOL_GROUP.status,
        created_by: superAdminId,
        updated_by: superAdminId
    });
    const userId = await ensureUser({
        first_name: "Nilesh",
        last_name: "Mehta",
        email: email("group.admin"),
        userPhone: SCHOOL_GROUP.phone,
        role: "group_admin"
    });
    await upsertBy("group_admins", ["user_id"], { user_id: userId, school_group_id: groupId, designation: "Group Director", status: "active" });
    credentials.groupAdmin = { email: email("group.admin"), password: PASSWORD, id: userId };
    return groupId;
}

async function seedSchool(school, groupId, superAdminId, credentials, totals) {
    const planId = await getId("plans", { plan_key: school.plan });
    const isTrial = school.plan === "trial";
    const billingCycle = "monthly";
    const startDate = new Date();
    const trialEndDate = addDays(7);
    const paidEndDate = toSqlDate(addBillingCycle(startDate, billingCycle));
    const subscriptionEndDate = isTrial ? trialEndDate : paidEndDate;
    const subscriptionStatus = isTrial ? "trial" : "active";
    const schoolId = await upsertBy("schools", ["school_name"], {
        school_group_id: school.group ? groupId : null,
        branch_name: school.branch_name,
        branch_code: school.branch_code,
        area: "Surat",
        school_name: school.school_name,
        subdomain: slug(school.school_name),
        school_email: email(`${school.key}.school`),
        school_phone: phone(1000 + totals.schools),
        password: passwordHash,
        website: `https://${slug(school.school_name)}.example.com`,
        establishment_year: 2014,
        school_type: school.school_type,
        medium: school.medium,
        board: "GSEB",
        gender_type: "co-ed",
        school_way: "full_day",
        school_address: `${school.branch_name} Campus, Surat, Gujarat`,
        city: "Surat",
        state: "Gujarat",
        pincode: "39500" + ((totals.schools % 5) + 1),
        school_principal_name: `${TEACHER_NAMES[totals.schools]}`,
        school_principal_email: email(`${school.key}.principal`),
        school_principal_phone: phone(1100 + totals.schools),
        udise_code: `2401${String(100000 + totals.schools).slice(1)}`,
        affiliation_board: "GSEB",
        affiliation_number: `AFF-SG-${String(1000 + totals.schools)}`,
        school_registration_number: `REG-SG-${String(2000 + totals.schools)}`,
        pan_number: `SGEGA${String(1000 + totals.schools)}F`,
        gst_number: `24SGEG${String(1000 + totals.schools)}1Z5`,
        plan: school.plan,
        plan_id: planId,
        current_plan_id: planId,
        status: isTrial ? "trial" : "active",
        subscription_status: subscriptionStatus,
        trial_started_at: isTrial ? new Date() : null,
        trial_ends_at: isTrial ? addDays(7) : null,
        subscription_started_at: isTrial ? null : startDate,
        subscription_ends_at: isTrial ? null : subscriptionEndDate,
        subscription_start: isTrial ? null : toSqlDate(startDate),
        subscription_end: subscriptionEndDate,
        slug: slug(school.school_name),
        trial_used: 1,
        is_trial_used: 1
    });
    totals.schools += 1;

    if (school.group) {
        const groupAdminId = await getId("group_admins", { school_group_id: groupId });
        if (groupAdminId) {
            await upsertBy("group_admin_schools", ["group_admin_id", "school_id"], { group_admin_id: groupAdminId, school_id: schoolId, access_type: "manage", status: "active" });
        }
    }

    const adminUserId = await ensureUser({
        school_id: schoolId,
        first_name: school.branch_name,
        last_name: "Admin",
        email: email(school.admin),
        userPhone: phone(1200 + schoolId),
        role: "school_admin"
    });
    credentials.schoolAdmins.push({ school: school.school_name, email: email(school.admin), password: PASSWORD, id: adminUserId });

    const subscriptionId = await upsertBy("subscriptions", ["school_id", "plan_id"], {
        school_id: schoolId,
        plan_id: planId,
        plan: school.plan,
        price: PLANS.find((p) => p.plan_key === school.plan).monthly_price,
        start_date: toSqlDate(startDate),
        end_date: subscriptionEndDate,
        status: isTrial ? "trial" : "active",
        payment_status: isTrial ? "pending" : "paid",
        auto_renew: isTrial ? 0 : 1,
        billing_cycle: billingCycle,
        trial_start_date: isTrial ? toSqlDate(startDate) : null,
        trial_end_date: isTrial ? subscriptionEndDate : null
    });

    await seedSubscriptionRevenue(school, schoolId, planId, subscriptionId);

    await seedClassesSubjectsTeachers(school, schoolId, adminUserId, credentials, totals);
    const context = await seedStudentsParents(school, schoolId, adminUserId, credentials, totals);
    await seedTransportIfEnabled(school, schoolId, adminUserId, context, credentials, totals);
    await seedFees(school, schoolId, context, adminUserId);
    await seedAttendance(schoolId, context, adminUserId);
    await seedLibrary(school, schoolId, adminUserId, context, credentials, totals);
    await seedAcademicsAndDashboards(school, schoolId, adminUserId, context);
    await seedChatPermissions(schoolId, adminUserId);
}

async function seedClassesSubjectsTeachers(school, schoolId, adminUserId, credentials, totals) {
    const classContexts = [];
    const teachers = [];
    for (let i = 0; i < school.classes.length; i++) {
        const teacherName = TEACHER_NAMES[(totals.teachers + i) % TEACHER_NAMES.length];
        const [first_name, ...lastParts] = teacherName.split(" ");
        const last_name = lastParts.join(" ") || "Teacher";
        const teacherUserId = await ensureUser({
            school_id: schoolId,
            first_name,
            last_name,
            email: email(`${school.key}.teacher.${i + 1}`),
            userPhone: phone(2000 + totals.teachers + i),
            role: "teacher"
        });
        const teacherId = await upsertBy("teachers", ["user_id"], {
            school_id: schoolId,
            user_id: teacherUserId,
            subject: subjectSetFor(school.classes[i])[0],
            qualification: i % 2 === 0 ? "B.Ed, M.A." : "B.Ed, B.Sc.",
            experience: 4 + (i % 8),
            gender: i % 2 === 0 ? "female" : "male",
            dob: `198${i % 9}-0${(i % 9) + 1}-15`,
            marital_status: "married",
            father_name: `${LAST_NAMES[i % LAST_NAMES.length]} Family`,
            mother_name: `${LAST_NAMES[(i + 1) % LAST_NAMES.length]} Ben`,
            current_address: `${20 + i}, Teacher Society, Surat`,
            permanent_address: `${20 + i}, Teacher Society, Surat`,
            emergency_contact: phone(2100 + totals.teachers + i),
            joining_date: "2022-06-10"
        });
        teachers.push({ id: teacherId, user_id: teacherUserId, name: teacherName });
        credentials.sampleTeacher ||= { school: school.school_name, email: email(`${school.key}.teacher.${i + 1}`), password: PASSWORD };
    }
    totals.teachers += school.classes.length;

    for (let i = 0; i < school.classes.length; i++) {
        const className = school.classes[i];
        const classId = await upsertBy("classes", ["school_id", "class_name", "section", "medium", "academic_year"], {
            school_id: schoolId,
            class_name: className,
            section: "A",
            stream: Number(String(className).replace(/[^0-9]/g, "")) >= 11 ? "Commerce" : "General",
            max_students: 30,
            current_students: 20,
            medium: school.medium,
            academic_year: ACADEMIC_YEAR
        });
        totals.classes += 1;
        const subjects = [];
        for (const subjectName of subjectSetFor(className)) {
            const subjectId = await upsertBy("subjects", ["school_id", "subject_name"], {
                school_id: schoolId,
                subject_name: subjectName,
                code: `${slug(subjectName).slice(0, 3).toUpperCase()}${i + 1}`,
                subject_code: `${slug(className).toUpperCase()}-${slug(subjectName).slice(0, 8).toUpperCase()}`,
                subject_type: ["Art & Craft", "Computer"].includes(subjectName) ? "practical" : "theory",
                max_marks: 100,
                pass_marks: 33,
                status: "active"
            });
            subjects.push({ id: subjectId, name: subjectName });
        }
        const teacher = teachers[i % teachers.length];
        for (let s = 0; s < subjects.length; s++) {
            await upsertBy("class_subjects", ["school_id", "class_id", "subject_id"], {
                school_id: schoolId,
                class_id: classId,
                subject_id: subjects[s].id,
                teacher_id: teacher.id,
                status: "active"
            });
            await upsertBy("teacher_class_assign", ["school_id", "teacher_id", "class_id", "subject_id_key", "medium_key", "academic_year_key"], {
                school_id: schoolId,
                teacher_id: teacher.id,
                class_id: classId,
                subject_id: subjects[s].id,
                subject_id_key: subjects[s].id,
                medium: school.medium,
                medium_key: school.medium,
                academic_year: ACADEMIC_YEAR,
                academic_year_key: ACADEMIC_YEAR,
                is_primary: s === 0 ? 1 : 0,
                is_class_teacher: s === 0 ? 1 : 0,
                can_mark_attendance: 1,
                status: "active",
                assigned_by: adminUserId
            });
        }
        classContexts.push({ id: classId, name: className, subjects, teacher });
    }
    return classContexts;
}

async function seedStudentsParents(school, schoolId, adminUserId, credentials, totals) {
    const [classes] = await connection.execute("SELECT id, class_name FROM classes WHERE school_id = ? ORDER BY id", [schoolId]);
    const students = [];
    for (const cls of classes) {
        for (let i = 1; i <= 20; i++) {
            const serial = totals.students + 1;
            const first = FIRST_NAMES[(serial + i) % FIRST_NAMES.length];
            const last = LAST_NAMES[(serial + cls.id) % LAST_NAMES.length];
            const gender = (serial + i) % 2 === 0 ? "Male" : "Female";
            const studentEmail = email(`${school.key}.student.${serial}`);
            const studentUserId = await ensureUser({
                school_id: schoolId,
                first_name: first,
                last_name: last,
                email: studentEmail,
                userPhone: phone(3000 + serial),
                role: "student"
            });
            const transportEnabled = school.plan !== "basic";
            const transportRequired = transportEnabled && i % 2 === 0;
            const admissionNo = `${school.branch_code}-${String(serial).padStart(4, "0")}`;
            const studentId = await upsertBy("students", ["school_id", "admission_no"], {
                school_id: schoolId,
                user_id: studentUserId,
                class_id: cls.id,
                standard: cls.class_name,
                admission_no: admissionNo,
                roll_no: String(i).padStart(2, "0"),
                dob: `${2010 - (Number(String(cls.class_name).replace(/[^0-9]/g, "")) || 4)}-${String((i % 9) + 1).padStart(2, "0")}-${String((i % 20) + 1).padStart(2, "0")}`,
                gender,
                blood_group: ["A+", "B+", "O+", "AB+"][i % 4],
                aadhaar_no: String(400000000000 + serial),
                religion: "Hindu",
                category: ["General", "OBC", "SC", "ST"][i % 4],
                medical_notes: i % 7 === 0 ? "Mild dust allergy" : "No known medical issues",
                admission_date: "2026-06-10",
                status: "active",
                student_portal_enabled: 1,
                parent_portal_enabled: 1
            });
            const parentEmail = email(`${school.key}.parent.${serial}`);
            const parentUserId = await ensureUser({
                school_id: schoolId,
                first_name: `${last}`,
                last_name: "Parent",
                email: parentEmail,
                userPhone: phone(4000 + serial),
                role: "parent"
            });
            await upsertBy("student_family", ["student_id"], {
                student_id: studentId,
                school_id: schoolId,
                parent_user_id: parentUserId,
                father_name: `${last} Kumar`,
                father_phone: phone(5000 + serial),
                father_email: parentEmail,
                father_occupation: ["Business", "Engineer", "Accountant", "Shop Owner"][i % 4],
                mother_name: `${FIRST_NAMES[(serial + 2) % FIRST_NAMES.length]}ben ${last}`,
                mother_phone: phone(5100 + serial),
                mother_email: email(`${school.key}.mother.${serial}`),
                mother_occupation: ["Teacher", "Homemaker", "Designer", "Doctor"][i % 4],
                guardian_name: `${last} Kumar`,
                guardian_relation: "Father",
                guardian_phone: phone(5000 + serial),
                guardian_email: parentEmail,
                guardian_occupation: "Business"
            });
            await upsertBy("student_address_transport", ["student_id"], {
                student_id: studentId,
                permanent_address: `${10 + i}, ${cls.class_name} Residency, Surat`,
                permanent_city: "Surat",
                permanent_state: "Gujarat",
                permanent_pincode: "395007",
                current_address_same: 1,
                current_address: `${10 + i}, ${cls.class_name} Residency, Surat`,
                current_city: "Surat",
                current_state: "Gujarat",
                current_pincode: "395007",
                emergency_contact: phone(5000 + serial),
                emergency_contact_name: `${last} Kumar`,
                hostel_required: i % 13 === 0 ? 1 : 0,
                hostel_name: i % 13 === 0 ? "SGEG Hostel" : null,
                hostel_room_no: i % 13 === 0 ? `H-${i}` : null,
                hostel_phone_number: i % 13 === 0 ? "02612600111" : null,
                transport_required: transportRequired ? 1 : 0,
                transport_mode: transportRequired ? "School Bus" : "Self",
                transport_route: transportRequired ? "Demo Route" : null,
                pickup_point: transportRequired ? "City Pickup Point" : null,
                drop_point: transportRequired ? "City Drop Point" : null
            });
            credentials.sampleStudent ||= { school: school.school_name, email: studentEmail, password: PASSWORD };
            credentials.sampleParent ||= { school: school.school_name, email: parentEmail, password: PASSWORD };
            students.push({ id: studentId, user_id: studentUserId, class_id: cls.id, class_name: cls.class_name, transportRequired });
            totals.students += 1;
            totals.parents += 1;
        }
    }
    return { students };
}

async function seedTransportIfEnabled(school, schoolId, adminUserId, context, credentials, totals) {
    if (school.plan === "basic") return;
    const drivers = [];
    for (let i = 1; i <= 3; i++) {
        const userId = await ensureUser({
            school_id: schoolId,
            first_name: ["Mahesh", "Ramesh", "Suresh"][i - 1],
            last_name: "Driver",
            email: email(`${school.key}.driver.${i}`),
            userPhone: phone(6000 + totals.drivers + i),
            role: "driver"
        });
        const driverId = await upsertBy("drivers", ["email"], {
            school_id: schoolId,
            user_id: userId,
            first_name: ["Mahesh", "Ramesh", "Suresh"][i - 1],
            last_name: "Driver",
            phone: phone(6000 + totals.drivers + i),
            emergency_contact: phone(6100 + totals.drivers + i),
            email: email(`${school.key}.driver.${i}`),
            address: `${i}, Transport Nagar, Surat`,
            license_number: `${school.branch_code}-DL-${String(i).padStart(3, "0")}`,
            license_expiry: addDays(900),
            aadhar_number: String(500000000000 + totals.drivers + i),
            status: "active"
        });
        drivers.push({ id: driverId, user_id: userId });
        credentials.sampleDriver ||= { school: school.school_name, email: email(`${school.key}.driver.${i}`), password: PASSWORD };
    }
    totals.drivers += 3;
    for (let i = 1; i <= 3; i++) {
        const vehicleId = await upsertBy("vehicles", ["vehicle_number"], {
            school_id: schoolId,
            vehicle_number: `GJ05SG${schoolId}${i}`,
            vehicle_no: `GJ05SG${schoolId}${i}`,
            bus_no: `BUS-${school.branch_code}-${i}`,
            registration_number: `GJ05SG${schoolId}${i}`,
            registration_no: `GJ05SG${schoolId}${i}`,
            model: i === 1 ? "Tata Starbus" : "Force Traveller",
            type: i === 1 ? "bus" : "van",
            capacity: i === 1 ? 42 : 28,
            status: "active",
            insurance_expiry: addDays(330),
            puc_expiry: addDays(180),
            permit_expiry: addDays(365),
            fitness_expiry: addDays(300),
            fuel_type: "Diesel",
            color: "Yellow",
            ownership_type: "Owned"
        });
        const routeId = await upsertBy("routes", ["school_id", "route_code"], {
            school_id: schoolId,
            route_name: `Route ${i} - Surat Zone ${i}`,
            route_code: `${school.branch_code}-R${i}`,
            start_point: "School Campus",
            end_point: ["Adajan", "Vesu", "Katargam"][i - 1],
            driver_id: drivers[i - 1].id,
            vehicle_id: vehicleId,
            status: "active",
            school_shift: "full_day",
            zone: ["West", "South", "North"][i - 1]
        });
        await upsertBy("driver_vehicle_assign", ["driver_id", "vehicle_id"], { school_id: schoolId, driver_id: drivers[i - 1].id, vehicle_id: vehicleId, assigned_date: "2026-06-01", is_active: 1 });
        const stopIds = [];
        for (let s = 1; s <= 3; s++) {
            const stopId = await upsertBy("transport_route_stops", ["school_id", "route_id", "stop_order"], {
                school_id: schoolId,
                route_id: routeId,
                stop_name: `Stop ${s} Zone ${i}`,
                stop_address: `${s * 3} Main Road, Surat`,
                pickup_time: `07:${String(10 + s * 5).padStart(2, "0")}:00`,
                drop_time: `14:${String(10 + s * 5).padStart(2, "0")}:00`,
                latitude: 21.1702 + (i * 0.01) + (s * 0.001),
                longitude: 72.8311 + (i * 0.01) + (s * 0.001),
                stop_order: s,
                estimated_students: 20,
                status: "active"
            });
            stopIds.push(stopId);
        }
        const allocatedStudents = context.students.filter((student, index) => student.transportRequired && index % 3 === (i - 1));
        for (const student of allocatedStudents) {
            await upsertBy("student_transport_allocations", ["school_id", "student_id"], {
                school_id: schoolId,
                student_id: student.id,
                route_id: routeId,
                stop_id: stopIds[student.id % stopIds.length],
                pickup_stop_id: stopIds[student.id % stopIds.length],
                drop_stop_id: stopIds[student.id % stopIds.length],
                status: "active",
                allocation_start_date: "2026-06-10",
                start_date: "2026-06-10",
                pickup_address: "Demo pickup address, Surat",
                drop_address: "Demo drop address, Surat"
            });
        }
        const tripId = await insertRow("transport_trips", {
            school_id: schoolId,
            route_id: routeId,
            vehicle_id: vehicleId,
            driver_id: drivers[i - 1].id,
            trip_date: new Date().toISOString().slice(0, 10),
            trip_type: "pickup",
            trip_shift: "morning",
            status: "completed",
            start_at: `${new Date().toISOString().slice(0, 10)} 07:05:00`,
            end_at: `${new Date().toISOString().slice(0, 10)} 08:05:00`,
            started_at: `${new Date().toISOString().slice(0, 10)} 07:05:00`,
            ended_at: `${new Date().toISOString().slice(0, 10)} 08:05:00`,
            total_students: allocatedStudents.length,
            picked_count: Math.max(0, allocatedStudents.length - 1),
            absent_count: allocatedStudents.length ? 1 : 0,
            created_by: adminUserId
        });
        for (const student of allocatedStudents.slice(0, 8)) {
            await insertRow("transport_trip_students", {
                school_id: schoolId,
                trip_id: tripId,
                student_id: student.id,
                route_id: routeId,
                stop_id: stopIds[student.id % stopIds.length],
                pickup_stop_id: stopIds[student.id % stopIds.length],
                drop_stop_id: stopIds[student.id % stopIds.length],
                student_status: "picked",
                status: "picked",
                picked_at: `${new Date().toISOString().slice(0, 10)} 07:30:00`,
                marked_at: `${new Date().toISOString().slice(0, 10)} 07:30:00`,
                created_by: adminUserId
            });
        }
        await insertRow("transport_trip_locations", { school_id: schoolId, trip_id: tripId, vehicle_id: vehicleId, driver_id: drivers[i - 1].id, latitude: 21.1702 + i * 0.01, longitude: 72.8311 + i * 0.01, speed: 32.5, heading: 90, accuracy: 8 });
        await insertRow("transport_alerts", { school_id: schoolId, alert_type: "delay", target_role: "school_admin", title: `Route ${i} delayed by 5 minutes`, message: "Traffic near Ring Road caused a minor pickup delay.", route_id: routeId, vehicle_id: vehicleId, driver_id: drivers[i - 1].id, trip_id: tripId, status: "open", severity: "medium", created_by: adminUserId });
    }
}

async function seedFees(school, schoolId, context, adminUserId) {
    const [classes] = await connection.execute("SELECT id, class_name FROM classes WHERE school_id = ?", [schoolId]);
    const baseFee = { trial: 1200, basic: 1600, standard: 2200, premium: 2800 }[school.plan];
    for (const cls of classes) {
        const structureId = await upsertBy("fee_structures", ["school_id", "class_id", "fee_name"], {
            school_id: schoolId,
            class_id: cls.id,
            fee_name: "Tuition Fee",
            amount: baseFee,
            fee_type: "tuition",
            due_date: addDays(15),
            frequency: "monthly"
        });
        for (const student of context.students.filter((s) => s.class_id === cls.id).slice(0, 8)) {
            const idx = student.id % 4;
            const status = ["paid", "pending", "partial", "pending"][idx];
            const paidAmount = status === "paid" ? baseFee : status === "partial" ? Math.round(baseFee / 2) : 0;
            const studentFeeId = await upsertBy("student_fees", ["school_id", "student_id", "fee_structure_id", "fee_month"], {
                school_id: schoolId,
                student_id: student.id,
                fee_structure_id: structureId,
                fee_month: "2026-07",
                due_date: idx === 3 ? pastDate(5) : addDays(15),
                total_amount: baseFee,
                paid_amount: paidAmount,
                status,
                paid_at: status === "paid" ? new Date() : null,
                late_fee_applied: idx === 3 ? 1 : 0
            });
            await upsertBy("fees", ["school_id", "student_id", "receipt_no"], {
                school_id: schoolId,
                student_id: student.id,
                amount: baseFee,
                due_date: idx === 3 ? pastDate(5) : addDays(15),
                paid_date: status === "paid" ? new Date().toISOString().slice(0, 10) : null,
                status: idx === 3 ? "overdue" : status === "partial" ? "pending" : status,
                payment_method: status === "paid" ? "UPI" : null,
                receipt_no: `RCPT-${schoolId}-${student.id}`,
                late_fee: idx === 3 ? 100 : 0
            });
            if (paidAmount > 0) {
                await insertRow("fee_payments", { school_id: schoolId, student_fee_id: studentFeeId, student_id: student.id, fee_structure_id: structureId, amount: paidAmount, payment_date: new Date().toISOString().slice(0, 10), payment_method: "UPI", receipt_no: `PAY-${schoolId}-${student.id}`, status: "paid", initiated_by_user_id: adminUserId, initiated_by_role: "school_admin", paid_at: new Date() });
            }
        }
    }
}

async function seedAttendance(schoolId, context, adminUserId) {
    const days = [];
    for (let i = 1; days.length < 10; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        if (![0].includes(d.getDay())) days.push(d.toISOString().slice(0, 10));
    }
    for (const day of days) {
        for (const student of context.students) {
            await upsertBy("attendance", ["school_id", "student_id", "date"], { school_id: schoolId, student_id: student.id, class_id: student.class_id, date: day, status: student.id % 17 === 0 ? "absent" : student.id % 13 === 0 ? "late" : "present", remark: "Demo attendance", marked_by: adminUserId, source: "seed" });
        }
        const [teachers] = await connection.execute("SELECT id FROM teachers WHERE school_id = ?", [schoolId]);
        for (const teacher of teachers) await upsertBy("teacher_attendance", ["school_id", "teacher_id", "date"], { school_id: schoolId, teacher_id: teacher.id, date: day, status: teacher.id % 11 === 0 ? "leave" : "present", marked_by: adminUserId });
        const [drivers] = await connection.execute("SELECT id FROM drivers WHERE school_id = ?", [schoolId]);
        for (const driver of drivers) await upsertBy("driver_attendance", ["school_id", "driver_id", "date"], { school_id: schoolId, driver_id: driver.id, date: day, status: driver.id % 5 === 0 ? "late" : "present", marked_by: adminUserId });
        const [librarians] = await connection.execute("SELECT id FROM librarians WHERE school_id = ?", [schoolId]);
        for (const librarian of librarians) await upsertBy("librarian_attendance", ["school_id", "librarian_id", "date"], { school_id: schoolId, librarian_id: librarian.id, date: day, status: "present", marked_by: adminUserId });
    }
}

async function seedLibrary(school, schoolId, adminUserId, context, credentials, totals) {
    const librarianUserId = await ensureUser({ school_id: schoolId, first_name: "Kavita", last_name: "Librarian", email: email(`${school.key}.librarian`), userPhone: phone(7000 + totals.librarians), role: "librarian" });
    const librarianId = await upsertBy("librarians", ["user_id"], { school_id: schoolId, user_id: librarianUserId, employee_code: `${school.branch_code}-LIB`, library_id: `LIB-${school.branch_code}`, joining_date: "2024-06-01", status: "active", created_by: adminUserId, updated_by: adminUserId });
    credentials.sampleLibrarian ||= { school: school.school_name, email: email(`${school.key}.librarian`), password: PASSWORD };
    totals.librarians += 1;
    await upsertBy("library_settings", ["school_id"], { school_id: schoolId, student_issue_limit: 3, teacher_issue_limit: 5, default_due_days: 14, renewal_days: 7, max_renewals: 2, fine_per_day: 2, created_by: adminUserId, updated_by: adminUserId });
    const categoryId = await upsertBy("library_categories", ["school_id", "name"], { school_id: schoolId, name: "General Knowledge", type: "general", description: "General reading and GK books", status: "active", created_by: adminUserId });
    const rackId = await upsertBy("library_racks", ["school_id", "rack_number"], { school_id: schoolId, rack_number: "A-1", shelf_number: "S-1", location: "Main Library", capacity: 120, status: "active", created_by: adminUserId });
    const bookIds = [];
    for (let i = 1; i <= 8; i++) {
        const bookId = await upsertBy("library_books", ["school_id", "barcode"], { school_id: schoolId, category_id: categoryId, rack_id: rackId, title: `SchoolSync Reader ${i}`, author: ["R. K. Narayan", "Sudha Murty", "Ruskin Bond"][i % 3], publisher: "Demo Publications", language: "English", edition: "2026", isbn: `978000${schoolId}${i}`, barcode: `${school.branch_code}-BK-${i}`, category: "General Knowledge", publish_year: 2024, total_copies: 5, available_copies: 4, rack_number: "A-1", shelf_number: "S-1", purchase_date: "2026-06-01", price: 250 + i * 25, status: "active", created_by: adminUserId });
        bookIds.push(bookId);
    }
    for (const student of context.students.slice(0, 6)) {
        const memberId = await upsertBy("library_members", ["user_id"], { school_id: schoolId, user_id: student.user_id, member_type: "student", library_id: `LM-${schoolId}-${student.id}`, issue_limit: 3, membership_date: "2026-06-15", status: "active", created_by: adminUserId });
        const issueId = await insertRow("library_issues", { school_id: schoolId, book_id: bookIds[student.id % bookIds.length], user_id: student.user_id, member_id: memberId, issue_date: pastDate(7), due_date: addDays(7), return_date: student.id % 2 === 0 ? new Date().toISOString().slice(0, 10) : null, fine_per_day: 2, fine_amount: student.id % 3 === 0 ? 10 : 0, fine_paid: 0, status: student.id % 2 === 0 ? "returned" : "issued", issued_by: librarianUserId, returned_by: student.id % 2 === 0 ? librarianUserId : null, created_by: librarianUserId });
        if (student.id % 3 === 0) await insertRow("library_fines", { school_id: schoolId, issue_id: issueId, user_id: student.user_id, fine_type: "late", amount: 10, paid_amount: 0, status: "pending", remarks: "Demo overdue fine", created_by: librarianUserId });
    }
}

async function seedAcademicsAndDashboards(school, schoolId, adminUserId, context) {
    const [classes] = await connection.execute("SELECT id, class_name FROM classes WHERE school_id = ?", [schoolId]);
    for (const cls of classes) {
        const [subjects] = await connection.execute("SELECT id FROM subjects WHERE school_id = ? AND id IN (SELECT subject_id FROM class_subjects WHERE class_id = ?) LIMIT 3", [schoolId, cls.id]);
        const examId = await upsertBy("exams", ["school_id", "class_id", "name"], { school_id: schoolId, class_id: cls.id, name: "Unit Test 1", exam_type: "unit_test", term: "first_term", max_marks: 100, pass_marks: 33, is_published: 1, academic_year: ACADEMIC_YEAR, description: "Demo unit test", start_date: addDays(10), end_date: addDays(12) });
        for (const subject of subjects) {
            const [assignment] = await connection.execute("SELECT teacher_id FROM class_subjects WHERE class_id = ? AND subject_id = ? LIMIT 1", [cls.id, subject.id]);
            const teacherId = assignment[0]?.teacher_id;
            await upsertBy("homeworks", ["school_id", "class_id", "subject_id", "title"], { school_id: schoolId, teacher_id: teacherId, class_id: cls.id, subject_id: subject.id, title: "Practice Worksheet", description: "Complete textbook exercise and upload notebook photo.", due_date: addDays(5), status: "active" });
            for (const student of context.students.filter((s) => s.class_id === cls.id).slice(0, 10)) {
                const obtained = 55 + (student.id % 41);
                await upsertBy("marks", ["school_id", "exam_id", "student_id", "subject_id"], { school_id: schoolId, teacher_id: teacherId, exam_id: examId, student_id: student.id, subject_id: subject.id, total_marks: 100, obtained_marks: obtained, grade: gradeFromMarks(obtained), grade_point: Math.min(10, obtained / 10).toFixed(1), entry_date: new Date().toISOString().slice(0, 10), status: obtained >= 33 ? "pass" : "fail", remarks: "Demo marks" });
            }
        }
    }
    await insertRow("notices", { school_id: schoolId, title: "Welcome to Academic Year 2026-27", content: "SchoolSync demo notice for all parents, students and staff.", target_type: "all", notice_type: "info", priority: "normal", is_active: 1, created_by: adminUserId, status: "published", publish_date: new Date().toISOString().slice(0, 10), expiry_date: addDays(30) });
    await insertRow("events", { school_id: schoolId, title: "Annual Orientation Day", description: "Orientation event for demo academic year.", event_date: addDays(20), event_type: "academic", venue: "School Auditorium", download_allowed: 1, watermark_enabled: 1, created_by: adminUserId });
    await insertRow("meetings", { school_id: schoolId, created_by: adminUserId, creator_role: "school_admin", title: "Parent Teacher Demo Meeting", description: "Demo online meeting.", room_name: `demo-${schoolId}-${Date.now()}`, scheduled_at: `${addDays(3)} 10:00:00`, duration_minutes: 45, target_type: "parents", status: "scheduled" });
    await insertRow("admission_requests", { school_id: schoolId, role: "student", token: cryptoRandom(), full_name: "Demo Admission Applicant", email: email(`${school.key}.admission`), phone: phone(8000 + schoolId), date_of_birth: "2016-05-12", gender: "male", address: "Adajan, Surat", class_applied: "Std 1", guardian_name: "Demo Guardian", guardian_phone: phone(8100 + schoolId), guardian_relation: "Father", blood_group: "B+", previous_school: "Little Star School", status: "pending" });
    await insertRow("issued_certificates", { school_id: schoolId, certificate_no: `CERT-${schoolId}-001`, certificate_type: "bonafide", recipient_type: "student", student_id: context.students[0]?.id, recipient_name: "Demo Student", class_id: context.students[0]?.class_id, issue_date: new Date().toISOString().slice(0, 10), purpose: "Demo verification", content_snapshot: "This is a demo certificate.", issued_by: adminUserId, status: "issued" });
    await insertRow("support_tickets", { school_id: schoolId, user_id: adminUserId, reporter_name: "School Admin", reporter_email: email(`${school.key}.support`), ticket_no: `TCK-${schoolId}-001`, subject: "Demo support ticket", description: "Sample ticket for Super Admin support dashboard.", category: "technical", priority: "normal", status: "open" });
    await insertRow("system_alerts", { alert_type: "demo", message: `${school.school_name} demo data is ready.`, status: "active" });
    await insertRow("notifications", { recipient_id: adminUserId, recipient_role: "school_admin", school_id: schoolId, title: "Demo data ready", message: "Your SchoolSync demo dataset has been seeded.", type: "info", category: "demo", created_by: adminUserId, is_read: 0 });
    const [staffUsers] = await connection.execute("SELECT id, role FROM users WHERE school_id = ? AND role IN ('teacher','driver','librarian')", [schoolId]);
    for (const user of staffUsers) {
        const amount = user.role === "teacher" ? 32000 : user.role === "driver" ? 21000 : 24000;
        await upsertBy("salary_structures", ["school_id", "user_id", "role"], { school_id: schoolId, user_id: user.id, role: user.role, amount });
        await upsertBy("monthly_salaries", ["school_id", "user_id", "salary_month"], { school_id: schoolId, user_id: user.id, salary_month: "2026-07", total_amount: amount, paid_amount: user.id % 2 === 0 ? amount : Math.round(amount / 2), status: user.id % 2 === 0 ? "paid" : "partial" });
    }
}

async function seedChatPermissions(schoolId, adminUserId) {
    const rules = [
        ["school_admin", "teacher"], ["school_admin", "driver"], ["school_admin", "librarian"], ["school_admin", "student"], ["school_admin", "parent"],
        ["teacher", "school_admin"], ["teacher", "teacher"],
        ["driver", "school_admin"], ["driver", "driver"],
        ["librarian", "school_admin"]
    ];
    for (const [sender_role, receiver_role] of rules) {
        await upsertBy("school_chat_permissions", ["school_id", "sender_role", "receiver_role"], { school_id: schoolId, sender_role, receiver_role, is_allowed: 1, is_locked: 0, updated_by: adminUserId });
    }
}

async function seedSubscriptionRevenue(school, schoolId, planId, subscriptionId) {
    if (school.plan === "trial") return;

    const plan = PLANS.find((item) => item.plan_key === school.plan);
    const amount = Number(plan?.monthly_price || 0);
    if (!amount) return;

    const paidAt = new Date();
    const paidDate = paidAt.toISOString().slice(0, 10);
    const code = school.branch_code;
    const receiptNo = `SUB-PAY-${code}-${paidDate.slice(0, 7)}`;
    const transactionId = `rzp_test_${code}_${paidDate.replace(/-/g, "")}`;
    const invoiceNo = `INV-${code}-${paidDate.slice(0, 7)}`;

    await upsertBy("subscription_payments", ["receipt_no"], {
        school_id: schoolId,
        subscription_id: subscriptionId,
        plan_id: planId,
        amount,
        tax_amount: 0,
        discount_amount: 0,
        total_amount: amount,
        payment_method: "razorpay",
        transaction_id: transactionId,
        receipt_no: receiptNo,
        status: "completed",
        paid_at: paidAt,
        notes: "Demo subscription payment seeded for Super Admin revenue dashboard.",
        created_at: paidAt,
        updated_at: paidAt,
        razorpay_order_id: `order_${transactionId}`,
        razorpay_payment_id: transactionId,
        billing_cycle: "monthly",
        currency: "INR",
        payment_status: "paid",
        payment_reference: transactionId,
        payment_note: "seed/demo/razorpay_test"
    });

    await upsertBy("invoices", ["invoice_no"], {
        school_id: schoolId,
        subscription_id: subscriptionId,
        invoice_no: invoiceNo,
        amount,
        tax_amount: 0,
        discount_amount: 0,
        total_amount: amount,
        status: "paid",
        billing_date: paidDate,
        due_date: paidDate,
        created_at: paidAt,
        updated_at: paidAt
    });

    await upsertBy("subscription_history", ["school_id", "new_plan_id", "change_type", "billing_cycle"], {
        school_id: schoolId,
        old_plan_id: null,
        old_plan_name: null,
        new_plan_id: planId,
        new_plan_name: plan.name,
        change_type: "purchase",
        billing_cycle: "monthly",
        amount_paid: amount,
        payment_ref: transactionId,
        created_at: paidAt
    });
}

async function printSummary(credentials) {
    const [[counts]] = await connection.query(`
        SELECT
            (SELECT COUNT(*) FROM schools WHERE school_name IN (${SCHOOLS.map(() => "?").join(",")})) AS schools,
            (SELECT COUNT(*) FROM schools WHERE school_group_id IS NOT NULL AND school_name IN (${SCHOOLS.map(() => "?").join(",")})) AS group_schools,
            (SELECT COUNT(*) FROM classes WHERE school_id IN (SELECT id FROM schools WHERE school_name IN (${SCHOOLS.map(() => "?").join(",")}))) AS classes,
            (SELECT COUNT(*) FROM students WHERE school_id IN (SELECT id FROM schools WHERE school_name IN (${SCHOOLS.map(() => "?").join(",")}))) AS students,
            (SELECT COUNT(*) FROM teachers WHERE school_id IN (SELECT id FROM schools WHERE school_name IN (${SCHOOLS.map(() => "?").join(",")}))) AS teachers,
            (SELECT COUNT(*) FROM users WHERE role = 'parent' AND email LIKE ?) AS parents,
            (SELECT COUNT(*) FROM drivers WHERE school_id IN (SELECT id FROM schools WHERE school_name IN (${SCHOOLS.map(() => "?").join(",")}))) AS drivers,
            (SELECT COUNT(*) FROM librarians WHERE school_id IN (SELECT id FROM schools WHERE school_name IN (${SCHOOLS.map(() => "?").join(",")}))) AS librarians,
            (SELECT COUNT(*) FROM subscriptions WHERE school_id IN (SELECT id FROM schools WHERE school_name IN (${SCHOOLS.map(() => "?").join(",")}))) AS subscriptions
    `, [...SCHOOLS.map(s => s.school_name), ...SCHOOLS.map(s => s.school_name), ...SCHOOLS.map(s => s.school_name), ...SCHOOLS.map(s => s.school_name), ...SCHOOLS.map(s => s.school_name), `%@${DEMO_EMAIL_DOMAIN}`, ...SCHOOLS.map(s => s.school_name), ...SCHOOLS.map(s => s.school_name), ...SCHOOLS.map(s => s.school_name)]);

    console.log("\n================ SchoolSync Demo Seed Complete ================");
    console.table(counts);
    console.log("\nDemo passwords were read from environment variables and are not printed.");
    console.log("\nDemo credentials:");
    console.log("Super Admin:", credentials.superAdmin.email);
    console.log("Group Admin:", credentials.groupAdmin.email);
    for (const admin of credentials.schoolAdmins) console.log(`School Admin (${admin.school}): ${admin.email}`);
    console.log("Sample Teacher:", credentials.sampleTeacher.email, `(${credentials.sampleTeacher.school})`);
    console.log("Sample Student:", credentials.sampleStudent.email, `(${credentials.sampleStudent.school})`);
    console.log("Sample Parent:", credentials.sampleParent.email, `(${credentials.sampleParent.school})`);
    console.log("Sample Driver:", credentials.sampleDriver.email, `(${credentials.sampleDriver.school})`);
    console.log("Sample Librarian:", credentials.sampleLibrarian.email, `(${credentials.sampleLibrarian.school})`);
    console.log("===============================================================\n");
}

async function main() {
    validateSeedConfiguration();
    connection = await mysql.createConnection(dbConfig);
    console.log("Database connected");
    await assertRequiredTables();
    passwordHash = await bcrypt.hash(PASSWORD, 10);
    superAdminPasswordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 10);
    const credentials = { schoolAdmins: [] };
    const totals = { schools: 0, classes: 0, students: 0, teachers: 0, parents: 0, drivers: 0, librarians: 0 };

    await connection.beginTransaction();
    try {
        if (RESET) {
            await resetDemoData();
            console.log("Existing SchoolSync demo data reset.");
        }

        await seedPlans();
        const superAdminId = await seedRolesAndSuperAdmin(credentials);
        const groupId = await seedSchoolGroup(superAdminId, credentials);
        for (const school of SCHOOLS) {
            console.log(`Seeding ${school.school_name}...`);
            await seedSchool(school, groupId, superAdminId, credentials, totals);
        }
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    }
    await printSummary(credentials);
}

if (require.main === module) {
    main()
        .catch((error) => {
            console.error("Seed failed:", error);
            process.exitCode = 1;
        })
        .finally(async () => {
            if (connection) await connection.end();
        });
};

module.exports = {
    PLAN_FEATURES,
    PLANS,
    REQUIRED_TABLES,
    validateSeedConfiguration
};
