#!/usr/bin/env node

/**
 * SchoolSync minimal seed
 * Seeds ONLY:
 *   1) Super Admin user
 *   2) Subscription plans + plan features
 *
 * No schools, students, teachers, drivers, librarians, parents, classes,
 * attendance, fees, or transport demo data are inserted here.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  socketPath: process.env.DB_SOCKET_PATH || undefined,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'schoolsync_db',
  multipleStatements: false
};

const SUPER_ADMIN = {
  firstName: process.env.SUPER_ADMIN_FIRST_NAME || 'Super',
  lastName: process.env.SUPER_ADMIN_LAST_NAME || 'Admin',
  email: (process.env.SUPER_ADMIN_EMAIL || 'superadmin@schoolsync.com').trim().toLowerCase(),
  phone: process.env.SUPER_ADMIN_PHONE || '9999999999',
  password: process.env.SUPER_ADMIN_PASSWORD || 'Super@123'
};

const plans = [
  {
    name: 'Basic',
    planKey: 'basic',
    slug: 'basic',
    description: 'Starter plan for small schools with essential school management features.',
    monthlyPrice: 999,
    yearlyPrice: 9999,
    studentLimit: 300,
    teacherLimit: 25,
    staffLimit: 35,
    maxClasses: 20,
    trialDays: 7,
    colorCode: '#3B82F6',
    icon: 'fa-school',
    displayOrder: 1,
    isPopular: 0,
    features: [
      'School dashboard',
      'Student management',
      'Teacher management',
      'Class and subject management',
      'Attendance management',
      'Notice board',
      'Fee structure management',
      'Basic reports'
    ]
  },
  {
    name: 'Standard',
    planKey: 'standard',
    slug: 'standard',
    description: 'Growth plan with academics, fees, library, chat, and reporting features.',
    monthlyPrice: 2499,
    yearlyPrice: 24999,
    studentLimit: 800,
    teacherLimit: 60,
    staffLimit: 80,
    maxClasses: 50,
    trialDays: 7,
    colorCode: '#10B981',
    icon: 'fa-layer-group',
    displayOrder: 2,
    isPopular: 1,
    features: [
      'Everything in Basic',
      'Marks and exams',
      'Homework management',
      'Library management',
      'Role-based chat permissions',
      'PDF receipts and reports',
      'Email notifications',
      'Analytics dashboard'
    ]
  },
  {
    name: 'Premium',
    planKey: 'premium',
    slug: 'premium',
    description: 'Advanced plan for complete school operations with transport and premium modules.',
    monthlyPrice: 4999,
    yearlyPrice: 49999,
    studentLimit: 2000,
    teacherLimit: 150,
    staffLimit: 200,
    maxClasses: 120,
    trialDays: 7,
    colorCode: '#8B5CF6',
    icon: 'fa-crown',
    displayOrder: 3,
    isPopular: 0,
    features: [
      'Everything in Standard',
      'Transport management',
      'Driver panel',
      'Parent live bus tracking',
      'Meeting management',
      'Advanced subscription controls',
      'Priority support',
      'Advanced analytics'
    ]
  }
];

async function tableExists(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );
  return Number(rows[0].count) > 0;
}

async function assertRequiredTables(connection) {
  const requiredTables = ['users', 'plans', 'subscription_plan_features'];
  const missing = [];

  for (const tableName of requiredTables) {
    if (!(await tableExists(connection, tableName))) {
      missing.push(tableName);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required table(s): ${missing.join(', ')}. Import database.sql first.`);
  }
}

async function seedSuperAdmin(connection) {
  const passwordHash = await bcrypt.hash(SUPER_ADMIN.password, 10);

  await connection.execute(
    `INSERT INTO users
      (school_id, first_name, last_name, email, phone, password, role, status, is_email_verified, is_default_password, must_change_password)
     VALUES
      (NULL, ?, ?, ?, ?, ?, 'super_admin', 'active', 1, 0, 0)
     ON DUPLICATE KEY UPDATE
      school_id = NULL,
      first_name = VALUES(first_name),
      last_name = VALUES(last_name),
      phone = VALUES(phone),
      password = VALUES(password),
      role = 'super_admin',
      status = 'active',
      is_email_verified = 1,
      is_default_password = 0,
      must_change_password = 0,
      deleted_at = NULL,
      updated_at = CURRENT_TIMESTAMP`,
    [
      SUPER_ADMIN.firstName,
      SUPER_ADMIN.lastName,
      SUPER_ADMIN.email,
      SUPER_ADMIN.phone,
      passwordHash
    ]
  );
}

async function seedPlans(connection) {
  for (const plan of plans) {
    const featuresJson = JSON.stringify(plan.features);

    await connection.execute(
      `INSERT INTO plans
        (name, plan_key, price, monthly_price, yearly_price, student_limit, teacher_limit, staff_limit,
         max_students, max_teachers, max_classes, features, trial_days, color_code, icon, display_order,
         slug, description, is_popular, is_active, status)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active')
       ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        price = VALUES(price),
        monthly_price = VALUES(monthly_price),
        yearly_price = VALUES(yearly_price),
        student_limit = VALUES(student_limit),
        teacher_limit = VALUES(teacher_limit),
        staff_limit = VALUES(staff_limit),
        max_students = VALUES(max_students),
        max_teachers = VALUES(max_teachers),
        max_classes = VALUES(max_classes),
        features = VALUES(features),
        trial_days = VALUES(trial_days),
        color_code = VALUES(color_code),
        icon = VALUES(icon),
        display_order = VALUES(display_order),
        slug = VALUES(slug),
        description = VALUES(description),
        is_popular = VALUES(is_popular),
        is_active = 1,
        status = 'active',
        updated_at = CURRENT_TIMESTAMP`,
      [
        plan.name,
        plan.planKey,
        plan.monthlyPrice,
        plan.monthlyPrice,
        plan.yearlyPrice,
        plan.studentLimit,
        plan.teacherLimit,
        plan.staffLimit,
        plan.studentLimit,
        plan.teacherLimit,
        plan.maxClasses,
        featuresJson,
        plan.trialDays,
        plan.colorCode,
        plan.icon,
        plan.displayOrder,
        plan.slug,
        plan.description,
        plan.isPopular
      ]
    );

    const [planRows] = await connection.execute(
      'SELECT id FROM plans WHERE plan_key = ? LIMIT 1',
      [plan.planKey]
    );

    const planId = planRows[0].id;
    await connection.execute('DELETE FROM subscription_plan_features WHERE plan_id = ?', [planId]);

    for (const feature of plan.features) {
      await connection.execute(
        `INSERT INTO subscription_plan_features (plan_id, feature_name)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE feature_name = VALUES(feature_name)`,
        [planId, feature]
      );
    }
  }
}

async function main() {
  const connection = await mysql.createConnection(dbConfig);

  try {
    await assertRequiredTables(connection);
    await connection.beginTransaction();

    await seedSuperAdmin(connection);
    await seedPlans(connection);

    await connection.commit();

    console.log('✅ Minimal seed completed successfully.');
    console.log(`Super Admin Email: ${SUPER_ADMIN.email}`);
    console.log(`Super Admin Password: ${SUPER_ADMIN.password}`);
    console.log('Seeded Plans: Basic, Standard, Premium');
  } catch (error) {
    try {
      await connection.rollback();
    } catch (_) {}
    console.error('❌ Minimal seed failed:', error.message || error);
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

main();
