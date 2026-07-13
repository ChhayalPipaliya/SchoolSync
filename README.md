# SchoolSync

SchoolSync is a multi-tenant, role-based school management system built with Node.js, Express, EJS, MySQL, Redis, and Socket.io. It provides separate portals for platform owners, school groups, schools, teachers, students, parents, drivers, and librarians while keeping school data isolated by tenant.

## Current Status

This project is an Express/EJS monolith with MySQL-backed modules for academics, fees, transport, library, admissions, notifications, meetings, subscriptions, and reporting.

Important notes:

- Runtime uploads are stored under `storage/uploads/`.
- `/uploads/*` is not public static storage. Files are served by authenticated routes in `src/routes/uploadRoutes.js`.
- `.env` is intentionally not committed. Use `.env.example` as the setup template.
- Redis is optional for local development. When Redis is missing, the app falls back where possible, but production should use Redis for sessions and real-time scaling.
- On a fresh database, `npm run migrate` bootstraps the schema from `database.sql` when the `users` table does not exist, then applies incremental SQL files from `migrations/`.
- `npm run zip:clean` creates a shareable archive while excluding `.env`, `.git`, `node_modules`, uploads, logs, backup SQL files, `.DS_Store`, and `__MACOSX`.
- `npm test` runs the Node.js smoke tests in `src/tests/smoke.test.js`.

## Requirements

- Node.js 18 or newer
- MySQL 8.0 or newer
- Redis 6 or newer for production/session scaling
- npm

## Quick Start

Install dependencies:

```bash
npm install
```

Create the environment file:

```bash
cp .env.example .env
```

Update `.env` with your local database credentials and secrets.

Create the MySQL database:

```bash
mysql -u <user> -p -e "CREATE DATABASE IF NOT EXISTS schoolsync_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

Run migrations and seed the default super admin:

```bash
npm run migrate
npm run seed
```

Start the development server:

```bash
npm run start:dev
```

The app runs on `http://localhost:4000` by default.

## Environment Variables

The main environment values are documented in `.env.example`.

Required for a normal local setup:

```env
NODE_ENV=development
PORT=4000
APP_URL=http://localhost:4000
BASE_URL=http://localhost:4000

DB_HOST=localhost
DB_PORT=3306
DB_USER=your_mysql_user
DB_PASSWORD=your_mysql_password
DB_NAME=schoolsync_db

JWT_SECRET=replace-with-a-long-random-jwt-secret
SESSION_SECRET=replace-with-a-long-random-session-secret

SUPER_ADMIN_EMAIL=admin@schoolsync.com
SUPER_ADMIN_PASSWORD=Admin@123
SUPER_ADMIN_FIRST_NAME=Super
SUPER_ADMIN_LAST_NAME=Admin
```

Optional integrations:

- `REDIS_URL`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD`, `REDIS_DB`
- `EMAIL_USER`, `EMAIL_PASS`
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`
- `MSG91_AUTH_KEY`, `MSG91_SENDER_ID`, `MSG91_TEMPLATE_ID`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_WHATSAPP_FROM`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`
- `JITSI_DOMAIN`

## Available Scripts

| Command | Purpose |
| --- | --- |
| `npm start` | Start the app with `node app.js`. |
| `npm run start:dev` | Start the app with `nodemon app.js`. |
| `npm run migrate` | Run `src/config/runMigration.js`. |
| `npm run fix:academic-core` | Alias for the same migration runner. |
| `npm run seed` | Seed/update platform roles and the default super admin. |
| `npm test` | Run smoke tests with Node's built-in test runner. |
| `npm run zip:clean` | Build a clean ZIP without secrets, git metadata, dependencies, uploads, logs, or macOS metadata. |

## Portals and Routes

| Portal | Route | Purpose |
| --- | --- | --- |
| Public landing/auth | `/`, `/login`, `/auth/*` | Public pages, login, OTP, password reset, Google OAuth. |
| Super admin | `/superadmin` | Platform owner dashboard, schools, subscriptions, billing, reports, support, users. |
| Group admin | `/groupadmin` | Multi-branch overview, meetings, chat, fees, students, teachers, transport, reports. |
| School admin | `/schooladmin` | Main tenant admin portal for academic and operational management. |
| Teacher | `/teacher` | Attendance, homework, marks, timetable, notices, meetings, chat. |
| Student | `/student` | Profile, attendance, homework, marks, fees, library, transport, meetings. |
| Parent | `/parent` | Child dashboard, fees, attendance, homework, results, transport, meetings. |
| Driver | `/driver` | Routes, trips, GPS tracking, attendance, vehicle checklist, notices, chat. |
| Librarian | `/librarian` | Books, categories, racks, issues, returns, fines, reports, meetings. |
| Admissions | `/admission` | Public admission forms and QR-based admissions. |
| Notifications API | `/api/notifications` | In-app notification operations. |
| Razorpay fee API | `/api/fees/razorpay` | Fee payment creation/verification. |
| Webhooks | `/webhooks` | External payment or integration callbacks. |
| Protected uploads | `/uploads/*` | Authenticated file serving from `storage/uploads`. |

## Major Features

- Multi-tenant schools with school-level isolation.
- Role-based portals for super admin, group admin, school admin, teacher, student, parent, driver, and librarian.
- Student, teacher, driver, librarian, class, subject, timetable, and medium management.
- Attendance for students, teachers, drivers, and librarians.
- Exams, marks entry, grade schemes, results, and report cards.
- Fee structures, fee collection, online payments, receipts, salary structures, and monthly salaries.
- Transport routes, stops, vehicles, route allocation, live GPS tracking, trip events, and maintenance alerts.
- Library books, categories, racks, issues, renewals, returns, fines, and reports.
- Online student and teacher admissions.
- Notices, academic calendar, events gallery, protected media, and certificates.
- Internal chat and real-time notifications with Socket.io.
- Jitsi-based virtual meetings with attendance heartbeat tracking.
- Subscription plans, billing, invoices, renewals, Razorpay payments, and support tickets.
- Bulk import/export using CSV, Excel, and PDF utilities.

## Security Notes

- Authentication uses JWT stored in HTTP-only cookies.
- Express sessions use `SESSION_SECRET`; production startup requires a real secret.
- CSRF protection is enabled globally for unsafe authenticated HTTP methods, including `/api/*`. The shared head partial loads `/js/csrf.js`, which injects `_csrf` into forms and `X-CSRF-Token` into same-origin fetch/XHR requests.
- Tenant isolation and subscription guards protect school-scoped routes.
- Rate limiters are applied to API, login, OTP, registration, password reset, and upload flows.
- Upload handlers validate MIME type, extension, and file size.
- Protected document uploads require school-admin access or matching user ownership. Student documents also allow linked parents.
- `storage/uploads/` must not be exposed directly through Nginx, Apache, or a static file server.
- Real `.env` files, SQL backups, logs, generated uploads, and `node_modules/` should not be included in deployment archives.
- The current EJS frontend still contains inline scripts, so the CSP currently allows `'unsafe-inline'` for compatibility. Removing it requires moving those inline scripts to external JS files or adding nonce-based rendering.

## Database

SchoolSync uses MySQL through the `mysql2` async connection pool in `src/config/database.js`.

Schema documentation is in `database.sql`. The migration runner in `src/config/runMigration.js`:

1. Ensures the `migrations` table exists.
2. Runs `database.sql` when the database is fresh and `users` does not exist.
3. Runs `src/config/migration.sql` if present.
4. Runs every SQL file in `migrations/` in filename order if the folder exists.
5. Records completed and failed migrations in the `migrations` table.
6. Ignores selected duplicate-object errors so repeated migration runs are safer.

## Project Structure

```text
SchoolSync/
|-- app.js
|-- database.sql
|-- package.json
|-- seed.js
|-- storage/
|   `-- uploads/
`-- src/
    |-- config/
    |-- controllers/
    |   |-- driver/
    |   |-- groupAdmin/
    |   |-- librarian/
    |   |-- parent/
    |   |-- schoolAdmin/
    |   |-- student/
    |   |-- superAdmin/
    |   `-- teacher/
    |-- middleware/
    |-- models/
    |-- public/
    |   |-- css/
    |   |-- images/
    |   `-- js/
    |-- routes/
    |-- services/
    |-- utils/
    `-- views/
        |-- admission/
        |-- auth/
        |-- driver/
        |-- groupAdmin/
        |-- landing/
        |-- librarian/
        |-- parent/
        |-- schoolAdmin/
        |-- student/
        |-- superAdmin/
        `-- teacher/
```

## Development Workflow

For normal local work:

```bash
npm install
cp .env.example .env
npm run migrate
npm run seed
npm run start:dev
```

Before sharing or deploying:

- Verify `.env` is not included.
- Verify `node_modules/` is not included.
- Verify `storage/uploads/` is not included unless you intentionally need runtime data.
- Run migrations on the target database.
- Configure production Redis, mail, Razorpay, OAuth, SMS/WhatsApp, and Jitsi values as needed.

## Troubleshooting

If the server starts but database pages fail, check the DB values in `.env` and run:

```bash
npm run migrate
```

If uploads return `403 Forbidden`, confirm the signed-in user belongs to the same school as the file record and that the database stores the file path in the expected `/uploads/...` format.

If CSRF errors appear after leaving a form open, refresh the page and submit again with the current token.

If Redis is unavailable in development, the app can still start, but production should be configured with Redis for stable sessions, Socket.io scaling, and caching.
