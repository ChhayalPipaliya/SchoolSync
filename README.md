# SchoolSync 🎓

SchoolSync is a comprehensive, **multi-tenant**, **role-based** School Management System (SMS) built with **Node.js**, **Express**, **EJS**, and **MySQL**. It provides fully isolated dashboards and portals for every role in the school ecosystem — enabling seamless management of students, teachers, parents, transport, library, exams, salaries, events, and finances — all within a single unified platform.

---

## Quick Start

Use these steps for a clean local setup or demo machine:

```bash
npm install
cp .env.example .env
```

Create the MySQL database configured in `.env`, then run the migration runner:

```bash
mysql -u <user> -p -e "CREATE DATABASE IF NOT EXISTS schoolsync_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
npm run fix:academic-core
npm run seed
npm run start:dev
```

Important setup notes:

- `.env` is intentionally ignored. Keep real database, mail, Redis, JWT, Razorpay, Twilio, and OAuth secrets out of source control.
- `src/public/uploads/` is ignored. Create it on the server and make it writable by the Node process.
- `node_modules/`, logs, macOS metadata, and generated uploads should not be included in a shareable ZIP.
- If Redis is not configured, SchoolSync falls back to in-memory session/OTP stores for development only.
- `src/config/runMigration.js` first runs `src/config/migration.sql` when present, then runs every `.sql` file in `/migrations` in filename order. Completed SQL migrations are tracked in the `migrations` table so the command is safe to repeat.
- `npm run seed` creates or updates the default super admin from `.env` (`SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`, `SUPER_ADMIN_FIRST_NAME`, `SUPER_ADMIN_LAST_NAME`).

---

## Safe ZIP / Deployment Package

To package the application cleanly and securely for sharing or production deployment, please follow these guidelines:
- **Never share `.env`**: Environment configurations contain sensitive database credentials, API keys (Razorpay, Twilio, OAuth), and secrets. Keep `.env` out of all shared archives.
- **Never include `node_modules`**: Dependencies should be installed fresh on the destination environment. Including them increases ZIP size and can introduce platform-specific compatibility issues.
- **Use `npm install` after extracting**: Once the clean package is extracted on the target server, run `npm install` to download dependencies.
- **Use `npm run zip:clean` to create a safe ZIP**: Run this command to generate a clean, timestamped archive (e.g., `SchoolSync-clean-YYYYMMDD-HHMMSS.zip`) containing only source code, migrations, configs, and assets, automatically excluding all cache, uploads, logs, and secret files.
- **Keep `.env.example` for setup reference**: Use the placeholder values in `.env.example` as a template for setting up `.env` on new environments.

---

## 🌟 Role Portals & Key Features

SchoolSync supports **8 distinct roles**, each with a dedicated portal, route namespace, layout, and CSS theme.

---

### 1. 👑 Super Admin Portal (`/superadmin`)

The platform owner's control panel for managing all tenants.

| Feature                     | Description                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Dashboard**               | Real-time platform stats, revenue charts, school growth graphs, and system alerts                                     |
| **School Directory**        | Onboard new schools, approve/reject school registration requests, toggle status, GDPR export, purge                   |
| **School Types**            | Define school categories (CBSE, GSEB, ICSE) and configure portal access rule mappings per type                        |
| **Subscription Management** | Manage pricing plans (Basic, Standard, Premium), assign/renew/cancel subscriptions, proration preview                 |
| **Billing & Invoices**      | Generate invoices (PDF), run billing sweeps, view revenue reports                                                     |
| **Payments**                | View all Razorpay payment transactions across schools; initiate refunds                                               |
| **User Management**         | View/manage platform users; toggle user status; reset passwords                                                       |
| **Announcements**           | Broadcast system-wide announcements with templates; target all or specific schools                                    |
| **Support Desk**            | Manage school-raised support tickets; assign, reply, resolve, close, merge tickets. Knowledge base article management |
| **Audit & System Logs**     | View audit trails, impersonation logs, slow query logs, email queue. Manage platform settings                         |
| **Analytics**               | Platform-wide charts: revenue trends, school analytics, support trends                                                |
| **School Impersonation**    | Log in as any school admin for support debugging (with audit trail)                                                   |

---

### 2. 🏫 School Admin Portal (`/schooladmin`)

The primary management portal for each school's administrator.

| Feature                        | Description                                                                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard**                  | Interactive analytics: active students, teachers, daily attendance, collected fees, and quick actions                                                                                           |
| **Student Management**         | Add/edit/view/delete students with full document uploads (photo, Aadhaar, birth certificate, etc.). Generate student ID cards. Assign to classes                                                |
| **Teacher Management**         | Register teachers with photo and document uploads, assign to subjects/classes, generate teacher ID cards. View free teachers                                                                    |
| **Class & Section Management** | Create/edit classes with section, stream, medium, and academic year. Auto-generate class sets                                                                                                   |
| **Subject Management**         | Create subjects; assign subjects to classes with teacher linkage                                                                                                                                |
| **Timetable Builder**          | Define period slots; assign subject-teacher pairs to class timetable slots                                                                                                                      |
| **Attendance**                 | Mark and view daily attendance for students, teachers, drivers, and librarians. Monthly reports and defaulter lists                                                                             |
| **Examination System**         | Create exams; bulk/individual mark entry; publish results; generate student report cards; manage grade schemes; export results                                                                  |
| **Fee Management**             | Build fee structures; assign fees to classes; record payments; pending fee tracker; PDF receipt generation; Razorpay online payment + QR code; bulk fee generation; send fee reminders by email |
| **Salary Management**          | Configure salary structures per teacher; generate monthly salaries; track payment history; mark salaries as paid                                                                                |
| **Homework Monitoring**        | View all class homework created by teachers; track submission statistics                                                                                                                        |
| **Leave Management**           | Review, approve, or reject leave requests from teachers, librarians, and drivers. Calendar view                                                                                                 |
| **Notice Board**               | Publish notices with file attachments; target specific audiences                                                                                                                                |
| **Academic Calendar**          | Interactive event calendar — create/edit/delete events (Holiday, Exam, Meeting, Event)                                                                                                          |
| **Portal Overrides**           | Dynamically enable/disable student and parent portals per class. Credentials auto-sent via email                                                                                                |
| **Driver & Transport**         | Register drivers and vehicles; define routes and stops; assign students to routes; view live GPS fleet tracking dashboard; manage service records and maintenance alerts; transport fee plans   |
| **Librarian Management**       | Register librarians; manage their profiles                                                                                                                                                      |
| **Admissions**                 | QR-code-based online admission form; review, approve, or reject student and teacher applications                                                                                                |
| **Analytics**                  | Charts: attendance trends, fee collection, exam performance, student demographics                                                                                                               |
| **Reports**                    | Admission reports, attendance reports, fee reports, exam reports, finance reports                                                                                                               |
| **Settings**                   | School profile settings (name, logo), bank account details, school document uploads                                                                                                             |
| **Medium Settings**            | Configure instructional mediums (English, Gujarati, Hindi) for classes                                                                                                                          |
| **Events Gallery**             | Create event albums with photo/video uploads; manage per-media download permissions and watermark overlays                                                                                      |
| **Internal Chat**              | Real-time messaging with teachers, librarians, and drivers (WebSocket-based)                                                                                                                    |
| **Virtual Meetings**           | Schedule, create, edit, cancel meetings; join via Jitsi; view automated participant attendance reports                                                                                          |
| **Subscription**               | View active plan, request renewal; Razorpay-powered online payment for plan upgrades                                                                                                            |
| **Bulk Import/Export**         | Import students, teachers, etc. via CSV/Excel. Export entity data to CSV/Excel/PDF                                                                                                              |

---

### 3. 👩‍🏫 Teacher Portal (`/teacher`)

| Feature                   | Description                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard**             | Summary of class assignments, pending homework, today's schedule                                                              |
| **Profile**               | Update personal details, add experience, upload documents, download profile PDF                                               |
| **Attendance Management** | Mark and update daily student attendance; monthly attendance reports                                                          |
| **Homework Hub**          | Create homework tasks with file attachments; view submissions; grade/check submissions; export reports; close or delete tasks |
| **Marks Entry**           | Enter student marks for assigned exams; view exam results and performance analysis                                            |
| **Student Directory**     | View enrolled students in assigned classes; view individual student progress                                                  |
| **Timetable**             | View personal teaching timetable                                                                                              |
| **Notice Board**          | View school notices; create and delete own notices                                                                            |
| **Academic Calendar**     | View school calendar; suggest new events                                                                                      |
| **Leave Management**      | Apply for leave; view leave history                                                                                           |
| **Internal Chat**         | Real-time messaging with school admins, librarians, and drivers                                                               |
| **Virtual Meetings**      | Join scheduled virtual classroom meetings; view meeting details                                                               |

---

### 4. 👨‍🎓 Student Portal (`/student`)

> Access is gated by `portal_overrides` — admin can enable/disable per class.

| Feature               | Description                                                                    |
| --------------------- | ------------------------------------------------------------------------------ |
| **Dashboard**         | Academic summary, upcoming fees, recent notices, quick links                   |
| **Profile**           | View and update personal profile                                               |
| **Attendance**        | View personal daily/monthly attendance records                                 |
| **Fees**              | View pending/paid fee invoices; pay online via Razorpay (credit card, UPI, QR) |
| **Results & Marks**   | View exam results and subject-wise marks                                       |
| **Exam Schedule**     | View upcoming exam timetable                                                   |
| **Timetable**         | View class timetable                                                           |
| **Homework**          | View assigned homework; submit homework with file attachment                   |
| **Library**           | View currently issued books and due dates                                      |
| **Notices**           | View school notices                                                            |
| **Leave Management**  | Apply for leave; view leave history                                            |
| **Academic Calendar** | View school academic events                                                    |
| **Live Bus Tracker**  | Track assigned school bus on real-time Leaflet map                             |
| **Virtual Meetings**  | Join scheduled virtual video meetings                                          |

---

### 5. 🚌 Driver Portal (`/driver`)

| Feature                  | Description                                                        |
| ------------------------ | ------------------------------------------------------------------ |
| **Dashboard**            | Overview of today's active trips, assigned students                |
| **Students**             | View students on assigned route                                    |
| **Live Trip Management** | Start/end trips; mark student pickup/drop events in real time      |
| **Route Map**            | View designated driving route on a Leaflet road map (OSRM-powered) |
| **Live Tracking**        | Broadcast GPS location in real time via Socket.io                  |
| **Notices**              | View school notices                                                |
| **Profile**              | Update personal profile                                            |
| **Vehicle Checklist**    | Submit daily vehicle condition checklist                           |
| **Attendance**           | View personal attendance records                                   |
| **Leave Management**     | Apply for leave                                                    |
| **Support**              | View support page                                                  |
| **Internal Chat**        | Real-time messaging with school admins and teachers                |
| **Virtual Meetings**     | Join driver-coordinator meetings                                   |

---

### 6. 📚 Librarian Portal (`/librarian`)

| Feature              | Description                                                           |
| -------------------- | --------------------------------------------------------------------- |
| **Dashboard**        | Library stats — total books, active issues, pending returns           |
| **Book Catalog**     | Add/edit/delete books with cover image, ISBN, category, rack location |
| **Categories**       | Manage book categories                                                |
| **Racks**            | Manage physical rack configuration                                    |
| **Issue Management** | Issue books to members; process returns; renew issues                 |
| **Members**          | View and search library members (students and teachers)               |
| **Fines**            | View overdue fines; mark fines as paid                                |
| **Reports**          | Library activity reports                                              |
| **Profile**          | Update personal profile                                               |
| **Notices**          | View school notices                                                   |
| **Leave Management** | Apply for leave                                                       |
| **Internal Chat**    | Real-time messaging with school admins and teachers                   |
| **Virtual Meetings** | Join staff meetings                                                   |

---

### 7. 👨‍👩‍👧‍👦 Parent Portal (`/parent`)

> Access is gated by `portal_overrides` — admin can enable/disable per class. Parents log in with credentials auto-generated and emailed to them.

| Feature                    | Description                                                           |
| -------------------------- | --------------------------------------------------------------------- |
| **Dashboard**              | Academic performance summary, upcoming fees, announcements            |
| **Attendance Tracker**     | View real-time daily/monthly attendance logs for enrolled children    |
| **Fee Center**             | Check fee invoice details and payment histories                       |
| **Homework Hub**           | Monitor homework assignments and submission status                    |
| **Results & Report Cards** | View term-wise exam results and subject-wise performance              |
| **Notices**                | View school notices                                                   |
| **Live Bus Tracker**       | Monitor the exact GPS location of the school transit bus in real time |
| **Virtual Meetings**       | Join scheduled parent-teacher meetings online                         |

---

## 🗄️ Database Architecture

SchoolSync uses **MySQL** as its primary relational database. Database access is handled through a **MySQL2 async connection pool** configured in [`database.js`](src/config/database.js). Create the database, then run `npm run fix:academic-core` to apply the idempotent schema migrations and compatibility columns.

### Table Groups

| Group                       | Tables                                                                                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Core Auth & Users**       | `users`, `roles`, `permissions`, `permission_role`                                                                                                                                             |
| **Schools & Tenants**       | `schools`, `school_types`, `school_type_mappings`, `school_mediums`, `school_documents`, `school_bank_details`, `mediums`, `portal_rules`, `portal_overrides`, `settings`, `platform_settings` |
| **Subscriptions & Billing** | `plans`, `subscriptions`, `subscription_history`, `subscription_payments`, `subscription_plan_features`, `invoices`                                                                            |
| **Students**                | `students`, `student_family`, `student_documents`, `student_fees`, `student_address_transport`                                                                                                 |
| **Teachers**                | `teachers`, `teacher_class_assign`, `teacher_documents`, `teacher_experience`, `teacher_attendance`, `teacher_medical`                                                                         |
| **Classes & Subjects**      | `classes`, `subjects`, `class_subjects`, `timetables`, `period_slots`                                                                                                                          |
| **Attendance**              | `attendance`, `driver_attendance`, `librarian_attendance`                                                                                                                                      |
| **Exams & Marks**           | `exams`, `marks`, `grade_schemes`                                                                                                                                                              |
| **Fees & Payments**         | `fees`, `fee_structures`, `fee_payments`, `salary_structures`, `monthly_salaries`, `salary_payments`                                                                                           |
| **Homework**                | `homeworks`, `homework_submissions`                                                                                                                                                            |
| **Notices**                 | `notices`                                                                                                                                                                                      |
| **Leaves**                  | `leaves`                                                                                                                                                                                       |
| **Library**                 | `librarians`, `library_books`, `library_categories`, `library_racks`, `library_issues`, `library_fines`, `library_members`, `library_activity_logs`, `library_settings`                        |
| **Transport**               | `drivers`, `driver_vehicle_assign`, `driver_trips`, `vehicles`, `routes`, `vehicle_checklists`, `vehicle_maintenance_alerts`, `trip_student_events`                                            |
| **Meetings**                | `meetings`, `meeting_classes`, `meeting_attendance`                                                                                                                                            |
| **Events Gallery**          | `events`, `event_media`, `media_access_logs`                                                                                                                                                   |
| **Chat**                    | `chat_messages`                                                                                                                                                                                |
| **Notifications**           | `notifications`, `notification_preferences`                                                                                                                                                    |
| **Announcements**           | `announcements`, `announcement_schools`, `announcement_templates`                                                                                                                              |
| **Calendar**                | `academic_events`                                                                                                                                                                              |
| **Admissions**              | `admission_requests`, `qr_tokens`                                                                                                                                                              |
| **Bulk Ops**                | `import_logs`, `export_logs`                                                                                                                                                                   |
| **Support**                 | `support_tickets`, `ticket_replies`, `knowledge_base`                                                                                                                                          |
| **System & Audit**          | `logs`, `audit_logs` → `school_activity_logs`, `admin_impersonation_logs`, `super_admin_login_activities`, `api_metrics`, `slow_queries`, `system_alerts`, `email_queue`, `migrations`         |

Full schema DDL and column details are documented in [`database.sql`](database.sql).

---

## 🛠️ Technology Stack

| Layer                  | Technology                                                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Backend Runtime**    | Node.js v18+                                                                                                                                             |
| **Web Framework**      | Express.js v4                                                                                                                                            |
| **Templating Engine**  | EJS with `express-ejs-layouts`                                                                                                                           |
| **Styling**            | Custom CSS (`common.css`, `schooladmin.css`, `teacher.css`, `student.css`, `parent.css`, `driver.css`, `librarian.css`, `superadmin.css`) + TailwindCSS  |
| **Database**           | MySQL (pool-based async via `mysql2`)                                                                                                                    |
| **Session & Cache**    | Redis via `connect-redis` and `ioredis`; subscription status cached in Redis                                                                             |
| **Authentication**     | JWT (stored in httpOnly cookies), `bcryptjs` password hashing, Passport.js (Local + Google OAuth2)                                                       |
| **Real-time**          | Socket.io v4 with Redis Adapter (`@socket.io/redis-adapter`) — powers live chat, GPS tracking, meeting heartbeats, and notification delivery             |
| **Maps & Routing**     | Leaflet.js, OpenStreetMap tiles, OSRM (Open Source Routing Machine) for road-route rendering                                                             |
| **Video Conferencing** | Jitsi Meet Iframe API (self-hosted or Jitsi public cloud)                                                                                                |
| **File Uploads**       | Multer (role-specific upload handlers: `studentUpload`, `teacherUpload`, `driverUpload`, `schoolUpload`, `libraryUpload`, `noticeUpload`, `eventUpload`) |
| **Image Processing**   | `sharp` — used for image optimization and watermarking                                                                                                   |
| **PDF Generation**     | `pdfkit` — fee receipts, report cards, teacher profile exports                                                                                           |
| **Excel / CSV**        | `exceljs`, `fast-csv`, `csv-parser`, `xlsx` — bulk import/export                                                                                         |
| **QR Code**            | `qrcode` — admission QR codes                                                                                                                            |
| **Payment Gateway**    | Razorpay — fee payments, subscription purchases                                                                                                          |
| **Email**              | `nodemailer` with async email queue (DB-backed)                                                                                                          |
| **SMS / WhatsApp**     | Msg91 API (primary) / Twilio (fallback) — used by NotificationService                                                                                    |
| **Task Scheduler**     | `node-cron` — email queue processor, subscription renewal checks, meeting status auto-update, performance monitoring                                     |
| **Security**           | Helmet (custom CSP), rate limiting (`express-rate-limit`), input sanitization (prototype pollution prevention), tenant isolation middleware              |
| **Logging**            | Winston logger, audit logger                                                                                                                             |
| **Charts**             | Chart.js v4                                                                                                                                              |
| **Testing**            | Jest + Supertest                                                                                                                                         |

---

## 📂 Project Structure

```
SchoolSync/
├── app.js                         # Application entry point, middleware stack, server init
├── package.json                   # NPM dependencies & scripts
├── seed.js                        # Database seeder script
├── database.sql                   # Full MySQL schema documentation
├── folderStructure.txt            # Complete directory listing
└── src/
    ├── config/
    │   ├── constants.js           # App-wide constants (OTP timing, JWT expiry, file limits)
    │   ├── database.js            # MySQL connection pool + queryAsync helper
    │   ├── jitsi.js               # Jitsi Meet configuration
    │   ├── passport.js            # Passport Local + Google OAuth2 strategies
    │   ├── rbacSeeder.js          # Role/Permission seeder run at startup
    │   ├── redis.js               # Redis client initialization + session store factory
    │   ├── runMigration.js        # Migration runner utility
    │   └── socket.js              # Socket.io server + real-time handlers (chat, GPS, notifications)
    ├── controllers/
    │   ├── driver/                # Driver-specific controllers
    │   ├── librarian/             # Librarian-specific controllers
    │   ├── parent/                # Parent portal controller
    │   ├── schoolAdmin/           # School admin feature controllers (30+ files)
    │   ├── student/               # Student portal controllers
    │   ├── superAdmin/            # Super admin feature controllers
    │   ├── teacher/               # Teacher portal controllers
    │   ├── authController.js      # Login, register, OTP, password reset, logout
    │   ├── chatController.js      # Internal chat (get page, history, send message)
    │   ├── eventController.js     # School events gallery (CRUD + media upload)
    │   ├── leaveController.js     # Cross-role leave management
    │   ├── mediaController.js     # Protected media streaming and download
    │   ├── meetingController.js   # Jitsi meeting lifecycle management
    │   ├── notificationController.js # Notification read/unread management
    ├── middleware/
    │   ├── apiMetrics.js          # API response time tracking → api_metrics table
    │   ├── auth.js                # JWT verification, role guards (isAdmin, isTeacher, etc.)
    │   ├── errorHandler.js        # 404 and global error handler
    │   ├── eventUpload.js         # Multer config for event gallery media
    │   ├── libraryAccess.js       # Granular library operation permissions
    │   ├── meetingAuth.js         # Meeting join authorization middleware
    │   ├── planAccess.js          # Feature-gating based on subscription plan (Basic/Standard/Premium)
    │   ├── portalAccess.js        # Student and parent portal access verification
    │   ├── quotaCheck.js          # Enforce student/teacher/class quotas per plan
    │   ├── rateLimit.js           # Rate limiters (login, OTP, registration, upload)
    │   ├── sanitize.js            # Body sanitization + prototype pollution prevention
    │   ├── securityHeaders.js     # Helmet with custom CSP policy
    │   ├── send_otp.js            # OTP dispatch helper
    │   ├── socketAuth.js          # JWT-based Socket.io connection authentication
    │   ├── subscriptionGuard.js   # Subscription status check (active/trial/expired/suspended) with Redis caching
    │   ├── tenantIsolation.js     # Enforce school_id scoping per request
    │   ├── upload.js              # Role-specific Multer upload configurations
    │   └── validate.js            # Input validation rules (express-validator)
    ├── models/
    │   ├── admissionModel.js
    │   ├── exportLogModel.js
    │   ├── importLogModel.js
    │   ├── libraryModel.js
    │   ├── notificationModel.js
    │   ├── notificationPreferenceModel.js
    │   ├── schoolModel.js
    │   ├── teacherModel.js
    │   └── userModel.js
    ├── public/
    │   ├── css/                   # Role-specific CSS themes
    │   ├── js/                    # Role-specific JS bundles + shared utilities
    │   ├── images/                # Static images and PWA icons
    │   └── uploads/               # Uploaded files (students, teachers, drivers, notices, etc.)
    ├── routes/
    │   ├── admissionRoutes.js     # Public online admission form (no auth)
    │   ├── authRoutes.js          # Login, logout, OTP, Google OAuth, school registration
    │   ├── bulkRoutes.js          # Bulk import/export API endpoints
    │   ├── driverRoutes.js        # Driver portal routes
    │   ├── eventRoutes.js         # Public events gallery + protected media streaming
    │   ├── index.js               # Route index / central registrar
    │   ├── librarianRoutes.js     # Librarian portal routes
    │   ├── meetingRoutes.js       # Virtual meeting routes (all roles)
    │   ├── notificationRoutes.js  # Notification API endpoints
    │   ├── parentRoutes.js        # Parent portal routes
    │   ├── razorpayRoutes.js      # Razorpay webhook and payment verification
    │   ├── schoolAdminRoutes.js   # School admin portal routes (365 lines / 50+ endpoints)
    │   ├── studentRoutes.js       # Student portal routes
    │   ├── superAdminRoutes.js    # Super admin portal routes
    │   ├── teacherAdmissionRouter.js # Teacher online onboarding form
    │   └── teacherRoutes.js       # Teacher portal routes
    ├── services/
    │   ├── billingService.js      # Invoice generation, billing sweep logic
    │   ├── emailQueueService.js   # Async email queue processor (cron-driven)
    │   ├── libraryService.js      # Library business logic helpers
    │   ├── meetingCron.js         # Auto-update meeting statuses (runs every minute)
    │   ├── notificationService.js # Unified notification delivery (Socket.io + Email + SMS + WhatsApp)
    │   ├── performanceMonitorCron.js # Performance diagnostics cron
    │   ├── portalService.js       # Portal access rule helpers
    │   └── subscriptionCron.js    # Subscription expiry checks and renewals
    ├── utils/
    │   ├── exporters/             # CSV, Excel, and PDF exporter utilities
    │   ├── validators/            # Import validators
    │   ├── auditLogger.js         # Audit trail writer
    │   ├── auth.js                # JWT signing, cookie helpers, dashboard path resolver
    │   ├── csvParser.js
    │   ├── errorFormatter.js
    │   ├── errors.js
    │   ├── fileSecurity.js        # Secure file access helpers
    │   ├── normalize.js
    │   ├── notificationTemplates.js
    │   ├── otpStore.js            # In-memory OTP store
    │   ├── pdfHelper.js
    │   ├── planCache.js           # Plan feature lookup cache
    │   ├── sanitizers.js
    │   ├── schoolScope.js
    │   ├── validation.js
    │   └── validators.js
    └── views/
        ├── admin/                 # Teacher application list view (admin)
        ├── admission/             # Online student/teacher admission forms
        ├── auth/                  # Login, Register, Forgot Password
        ├── driver/                # Driver portal EJS views
        ├── errors/                # 403, 404, 500 error pages
        ├── landing/               # Public landing page with partials
        ├── librarian/             # Librarian portal EJS views
        ├── parent/                # Parent portal EJS views
        ├── partials/              # Shared EJS partials (sidebar, header, footer, notification bell, etc.)
        ├── school/                # School registration pages
        ├── schoolAdmin/           # School admin portal EJS views (50+ templates)
        ├── student/               # Student portal EJS views
        ├── superAdmin/            # Super admin portal EJS views
        └── teacher/               # Teacher portal EJS views
```

---

## 🔐 Security Architecture

| Layer                   | Implementation                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Authentication**      | Decoupled cookie-based JWT (`httpOnly`, `sameSite: lax`, `secure` in production). Supports "Remember Me" (7-day token)               |
| **Authorization**       | Role-based guards per route (`isAdmin`, `isSchoolAdmin`, `isTeacher`, `isStudent`, `isDriver`, `isLibrary`, `isParent`)              |
| **Tenant Isolation**    | `tenantIsolation` middleware injects and enforces `school_id` on every authenticated request                                         |
| **Subscription Guard**  | `subscriptionGuard` checks school's active/trial/expired/suspended status on every protected request; Redis-cached for 60 seconds    |
| **Feature Gating**      | `requirePlanFeature()` middleware blocks access to premium features (library, transport, exams, salary, analytics) based on plan key |
| **Portal Access**       | `requireStudentPortal` / `requireParentPortal` verify dynamic per-class portal enable/disable overrides at runtime                   |
| **Rate Limiting**       | Separate rate limiters for login, OTP, registration, password reset, and file uploads                                                |
| **Security Headers**    | Helmet with custom CSP policy (blocks inline scripts, restricts media and frame sources)                                             |
| **Sanitization**        | `sanitize.js` middleware prevents prototype pollution and XSS across all request inputs                                              |
| **File Uploads**        | `multer` with strict file type and size checks per upload context; `fileSecurity.js` for protected media serving                     |
| **Google OAuth2**       | Passport.js Google strategy (only active when `GOOGLE_CLIENT_ID` is configured)                                                      |
| **Impersonation Audit** | Super admin impersonation actions logged to `admin_impersonation_logs` with IP and user agent                                        |

---

## 📡 Real-time Architecture (Socket.io)

Socket.io is initialized via Redis Adapter for horizontal scalability. On connection, users are automatically joined to:

- `user:<id>` — private room for notifications and chat messages
- `role:<role>:school:<school_id>` — school-scoped role room
- `superadmin:global` — super admin global room

### Socket Events

| Event                          | Direction       | Description                                        |
| ------------------------------ | --------------- | -------------------------------------------------- |
| `send_chat_message`            | Client → Server | Send an internal chat message                      |
| `chat_message`                 | Server → Client | Deliver a new chat message                         |
| `chat_unread_count_update`     | Server → Client | Push updated unread message badge count            |
| `chat_unread_notification`     | Server → Client | Alert recipient of a new chat message              |
| `messages_read`                | Server → Client | Acknowledge that messages were marked read         |
| `update_location`              | Client → Server | Driver broadcasts GPS coordinates                  |
| `location_updated`             | Server → Client | Broadcast location to trip room members            |
| `school_trip_location_updated` | Server → Client | Broadcast location to school admin fleet dashboard |
| `join_trip`                    | Client → Server | Join a specific trip's tracking room               |
| `join_school_trips`            | Client → Server | School admin joins all school trips room           |
| `new_notification`             | Server → Client | Push a new in-app notification                     |
| `unread_count_update`          | Server → Client | Update notification bell badge count               |
| `api/meetings/:id/heartbeat`   | Client → Server | Meeting participant heartbeat (via REST API)       |

---

## ⏱️ Background Cron Jobs

| Job                              | Schedule     | Description                                                                   |
| -------------------------------- | ------------ | ----------------------------------------------------------------------------- |
| **Email Queue Processor**        | Every minute | Dequeues and dispatches pending emails from `email_queue` table               |
| **Subscription Renewal Checker** | Daily        | Marks expired subscriptions; sends renewal reminder emails                    |
| **Meeting Status Auto-Update**   | Every minute | Updates `meetings` table status (upcoming → active → completed) based on time |
| **Performance Monitor**          | Periodic     | Logs slow queries and system health diagnostics                               |

---

## 🔔 Notification Service

`NotificationService` is a unified delivery engine that supports:

- **In-app push** via Socket.io (delivered in real time if user is online)
- **Email** via `nodemailer` (queued to `email_queue` table if user is offline)
- **SMS** via Msg91 API (primary) or Twilio (fallback) — activated when `sms_notifications` preference is enabled
- **WhatsApp** via Twilio WhatsApp API — activated when `TWILIO_WHATSAPP_FROM` is configured

User notification preferences (per-category: academic, fee, transport, library, general, system) are stored in `notification_preferences` and respected before every delivery.

---

## 🚀 Installation & Local Setup

### Prerequisites

- **Node.js** v18 or higher
- **MySQL** Server 8.0+
- **Redis** Server 6+

### Step 1: Clone and Install Dependencies

```bash
git clone <repository-url>
cd SchoolSync
npm install
```

### Step 2: Configure Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Update the copied `.env` with your local database, session/JWT secrets, and optional mail, Redis, Razorpay, Twilio, Google OAuth, and Jitsi settings.

### Step 3: Create and Migrate the Database

```bash
mysql -u <user> -p -e "CREATE DATABASE IF NOT EXISTS schoolsync_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
npm run fix:academic-core
```

### Step 4: Seed the Database (Optional)

```bash
npm run seed
```

### Step 5: Run the Application

```bash
# Development (with auto-reload via nodemon)
npm run start:dev

# Production
npm start
```

The application will be accessible at: **`http://localhost:4000`**

### Step 5: Run Tests (Optional)

```bash
npm test                # Run all tests
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report
```

---

## 🧩 Subscription Plans & Feature Gating

SchoolSync enforces feature access at the route level using the `requirePlanFeature()` middleware. Access is determined by the school's active plan:

| Feature    | Basic | Standard | Premium |
| ---------- | ----- | -------- | ------- |
| Attendance | ✅    | ✅       | ✅      |
| Fees       | ✅    | ✅       | ✅      |
| Homework   | ✅    | ✅       | ✅      |
| Exams      | ✅    | ✅       | ✅      |
| Library    | ❌    | ✅       | ✅      |
| Transport  | ❌    | ✅       | ✅      |
| Salary     | ❌    | ✅       | ✅      |
| Analytics  | ❌    | ❌       | ✅      |

Plan features are cached per school using `planCache.js` to avoid repeated database lookups.

---

## 🌐 Route Namespaces

| Namespace                        | Portal                                          |
| -------------------------------- | ----------------------------------------------- |
| `/`                              | Landing page, auth, school registration         |
| `/superadmin`                    | Super Admin portal                              |
| `/schooladmin` or `/schooladmin` | School Admin portal                             |
| `/teacher`                       | Teacher portal                                  |
| `/student`                       | Student portal                                  |
| `/driver`                        | Driver portal                                   |
| `/librarian`                     | Librarian portal                                |
| `/parent`                        | Parent portal                                   |
| `/admission`                     | Public online admission forms                   |
| `/events`                        | School events gallery (all authenticated roles) |
| `/media`                         | Protected media streaming and download          |
| `/api/notifications`             | Notification API                                |
| `/api/fees/razorpay`             | Razorpay payment API                            |
| `/api/import`                    | Bulk import API                                 |
| `/api/export`                    | Bulk export API                                 |

---

## 🔒 Security Practices Summary

- **JWT in httpOnly Cookies**: Prevents JavaScript access to auth tokens; eliminates XSS-based token theft.
- **Role Middleware on Every Route**: Each route explicitly lists its required role guard; no implicit access.
- **Tenant Isolation**: Every DB query dynamically scoped by `school_id` — schools cannot access each other's data.
- **Subscription Guard**: Cached subscription status blocks expired schools from accessing any route.
- **Feature Guard**: Premium features blocked at route level before any controller code runs.
- **Portal Override**: Student/Parent portal access checked live against `portal_overrides` table per class.
- **Prototype Pollution Prevention**: `sanitize.js` strips `__proto__`, `constructor`, `prototype` from all inputs.
- **Audit Trail**: All critical admin actions (impersonation, school status changes, etc.) written to audit logs.
