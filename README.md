<div align="center">

# 🏫 SchoolSync

**Multi-tenant, role-based school management system**

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express.js-5.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![MySQL](https://img.shields.io/badge/MySQL-8.0-4479A1?logo=mysql&logoColor=white)](https://mysql.com/)
[![Redis](https://img.shields.io/badge/Redis-6+-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![Socket.io](https://img.shields.io/badge/Socket.io-4.x-010101?logo=socket.io&logoColor=white)](https://socket.io/)
[![License](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

<p align="center">
  <a href="#-key-features">Features</a> •
  <a href="#-tech-stack">Tech Stack</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-environment-variables">Environment</a> •
  <a href="#-available-scripts">Scripts</a> •
  <a href="#-portals-and-routes">Portals</a> •
  <a href="#-project-structure">Structure</a> •
  <a href="#-security">Security</a> •
  <a href="#-database--migrations">Database</a> •
  <a href="#-troubleshooting">Troubleshooting</a>
</p>

</div>

---

## ✨ Key Features

| Feature | Description |
|---------|-------------|
| 👥 **Multi-Role System** | Dedicated portals for Super Admin, Group Admin, School Admin, Teacher, Student, Parent, Driver, and Librarian |
| 🏢 **Multi-Tenant Architecture** | School-level data isolation with subscription guards and tenant-aware routing |
| 📚 **Academic Management** | Students, teachers, classes, subjects, timetables, mediums, attendance, exams, marks, and report cards |
| 💰 **Fee Management** | Fee structures, collection, online payments via Razorpay, receipts, salary structures, and monthly salaries |
| 🚌 **Transport & GPS** | Routes, stops, vehicles, route allocation, live GPS tracking, trip events, and maintenance alerts |
| 📖 **Library System** | Books, categories, racks, issues, renewals, returns, fines, and reports |
| 📝 **Admissions** | Online student/teacher admission forms with QR-based admissions |
| 💬 **Real-time Communication** | Internal chat and notifications powered by Socket.io |
| 📹 **Virtual Meetings** | Jitsi-based meetings with attendance heartbeat tracking |
| 📊 **Reporting** | Bulk import/export using CSV, Excel, and PDF utilities |
| 🔔 **Notifications** | In-app, SMS (MSG91), and WhatsApp (Twilio) notifications |
| 🎫 **Subscriptions** | Plans, billing, invoices, renewals, and support tickets |

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| **Backend** | Node.js 18+, Express.js 5.x |
| **Template Engine** | EJS |
| **Styling** | Tailwind CSS |
| **Database** | MySQL 8.0 (mysql2) |
| **Cache / Sessions** | Redis 6+ (connect-redis) |
| **Real-time** | Socket.io |
| **Authentication** | Passport.js, JWT (HTTP-only cookies), bcrypt, Google OAuth 2.0 |
| **Payments** | Razorpay |
| **Meetings** | Jitsi |
| **SMS** | MSG91 |
| **WhatsApp** | Twilio |
| **Email** | Nodemailer |

---

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or newer
- [MySQL](https://mysql.com/) 8.0 or newer
- [Redis](https://redis.io/) 6 or newer *(optional for local dev, required for production)*
- [npm](https://www.npmjs.com/)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/ChhayalPipaliya/SchoolSync.git
cd SchoolSync

# 2. Install dependencies
npm install

# 3. Create environment file
cp .env.example .env
# Edit .env with your local database credentials and secrets

# 4. Create the MySQL database
mysql -u <user> -p -e "CREATE DATABASE IF NOT EXISTS schoolsync_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 5. Run migrations and seed the default super admin
npm run migrate
npm run seed

# 6. Start the development server
npm run start:dev
```

The app runs on **`http://localhost:4000`** by default.

---

## 🔐 Environment Variables

Create a `.env` file in the root directory. Use `.env.example` as the template.

### Required for local setup:

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

### Optional integrations:

| Service | Variables |
|---------|-----------|
| **Redis** | `REDIS_URL`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD`, `REDIS_DB` |
| **Email (SMTP)** | `EMAIL_USER`, `EMAIL_PASS` |
| **Razorpay** | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |
| **SMS (MSG91)** | `MSG91_AUTH_KEY`, `MSG91_SENDER_ID`, `MSG91_TEMPLATE_ID` |
| **WhatsApp (Twilio)** | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_WHATSAPP_FROM` |
| **Google OAuth** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` |
| **Jitsi** | `JITSI_DOMAIN` |

> ⚠️ **Never commit your `.env` file.** It is already listed in `.gitignore`.

---

## 📜 Available Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start the app with `node app.js` |
| `npm run start:dev` | Start the app with `nodemon app.js` (hot-reload) |
| `npm run migrate` | Run the database migration runner (`src/config/runMigration.js`) |
| `npm run fix:academic-core` | Alias for the migration runner |
| `npm run seed` | Seed/update platform roles and the default super admin |
| `npm test` | Run smoke tests with Node.js built-in test runner |
| `npm run zip:clean` | Build a clean ZIP excluding secrets, git, node_modules, uploads, and logs |

---

## 🚪 Portals and Routes

| Portal | Base Route | Purpose |
|--------|------------|---------|
| **Public / Auth** | `/`, `/login`, `/auth/*` | Landing page, login, OTP, password reset, Google OAuth |
| **Super Admin** | `/superadmin` | Platform owner dashboard, schools, subscriptions, billing, reports, support, users |
| **Group Admin** | `/groupadmin` | Multi-branch overview, meetings, chat, fees, students, teachers, transport, reports |
| **School Admin** | `/schooladmin` | Main tenant admin portal for academic and operational management |
| **Teacher** | `/teacher` | Attendance, homework, marks, timetable, notices, meetings, chat |
| **Student** | `/student` | Profile, attendance, homework, marks, fees, library, transport, meetings |
| **Parent** | `/parent` | Child dashboard, fees, attendance, homework, results, transport, meetings |
| **Driver** | `/driver` | Routes, trips, GPS tracking, attendance, vehicle checklist, notices, chat |
| **Librarian** | `/librarian` | Books, categories, racks, issues, returns, fines, reports, meetings |
| **Admissions** | `/admission` | Public admission forms and QR-based admissions |
| **Notifications API** | `/api/notifications` | In-app notification operations |
| **Razorpay API** | `/api/fees/razorpay` | Fee payment creation and verification |
| **Webhooks** | `/webhooks` | External payment and integration callbacks |
| **Protected Uploads** | `/uploads/*` | Authenticated file serving from `storage/uploads/` |

---

## 🏗️ Project Structure

```text
SchoolSync/
├── app.js                          # Main application entry point
├── database.sql                    # Full database schema
├── package.json                    # Dependencies and scripts
├── seed.js                         # Role and super admin seeder
├── .env.example                    # Environment variable template
├── storage/
│   └── uploads/                    # Runtime uploads (NOT public static)
└── src/
    ├── config/                     # DB, Passport, Redis, migrations
    ├── controllers/                # Route handlers by role
    │   ├── driver/
    │   ├── groupAdmin/
    │   ├── librarian/
    │   ├── parent/
    │   ├── schoolAdmin/
    │   ├── student/
    │   ├── superAdmin/
    │   └── teacher/
    ├── middleware/                 # Auth, CSRF, rate limiting, sanitization, error handling
    ├── models/                     # Data access layer and queries
    ├── public/                     # Static assets (CSS, images, JS)
    │   ├── css/
    │   ├── images/
    │   └── js/
    ├── routes/                     # Route definitions
    ├── services/                   # Reusable business logic
    ├── utils/                      # Helper functions and utilities
    └── views/                      # EJS templates by portal
        ├── admission/
        ├── auth/
        ├── driver/
        ├── groupAdmin/
        ├── landing/
        ├── librarian/
        ├── parent/
        ├── schoolAdmin/
        ├── student/
        ├── superAdmin/
        └── teacher/
```

---

## 🔒 Security

- **Authentication:** JWT stored in HTTP-only cookies. Express sessions use `SESSION_SECRET`.
- **CSRF Protection:** Enabled globally for unsafe HTTP methods, including `/api/*`. The shared head partial loads `/js/csrf.js`, which injects `_csrf` into forms and `X-CSRF-Token` into same-origin fetch/XHR requests.
- **Tenant Isolation:** Subscription guards protect all school-scoped routes.
- **Rate Limiting:** Applied to API, login, OTP, registration, password reset, and upload endpoints.
- **Upload Security:** MIME type, extension, and file size validation. Protected document uploads require school-admin access or matching user ownership. Student documents also allow linked parents.
- **File Serving:** `storage/uploads/` must **NOT** be exposed directly through Nginx, Apache, or any static file server. Files are served by authenticated routes in `src/routes/uploadRoutes.js`.
- **Deployment:** Never include `.env`, SQL backups, logs, generated uploads, or `node_modules/` in deployment archives. Use `npm run zip:clean` for safe sharing.
- **CSP:** The current EJS frontend contains inline scripts, so the CSP allows `'unsafe-inline'`. Removing it requires moving inline scripts to external JS files or adding nonce-based rendering.

---

## 🗄️ Database & Migrations

SchoolSync uses MySQL through the `mysql2` async connection pool in `src/config/database.js`.

The migration runner in `src/config/runMigration.js`:

1. Ensures the `migrations` tracking table exists.
2. Runs `database.sql` when the database is fresh (no `users` table).
3. Runs `src/config/migration.sql` if present.
4. Runs every SQL file in `migrations/` in filename order.
5. Records completed and failed migrations.
6. Ignores selected duplicate-object errors for safer repeated runs.

On a fresh database:

```bash
npm run migrate   # Bootstrap schema + run incremental migrations
npm run seed      # Create default super admin and platform roles
```

---

## 🧪 Testing

```bash
npm test
```

Runs the Node.js smoke tests in `src/tests/smoke.test.js` using the built-in test runner.

---

## 🛠️ Development Workflow

```bash
npm install
cp .env.example .env
npm run migrate
npm run seed
npm run start:dev
```

### Before sharing or deploying:

- ✅ Verify `.env` is **not** included in the archive.
- ✅ Verify `node_modules/` is **not** included.
- ✅ Verify `storage/uploads/` is **not** included unless runtime data is intentionally needed.
- ✅ Run migrations on the target database.
- ✅ Configure production Redis, mail, Razorpay, OAuth, SMS/WhatsApp, and Jitsi values.

---

## 🆘 Troubleshooting

| Problem | Solution |
|---------|----------|
| **Database pages fail after start** | Check DB values in `.env` and run `npm run migrate` |
| **Uploads return 403 Forbidden** | Confirm the signed-in user belongs to the same school as the file record. Ensure the database stores the file path in `/uploads/...` format. |
| **CSRF errors on form submit** | Refresh the page and submit again with the current token. Tokens expire if the form was left open too long. |
| **Redis unavailable in dev** | The app can still start. Production should use Redis for stable sessions, Socket.io scaling, and caching. |

---

## 📄 License

This project is licensed under the [ISC License](LICENSE).

---

<div align="center">

**Made with ❤️ by [Chhayal Pipaliya](https://github.com/ChhayalPipaliya)**

</div>
