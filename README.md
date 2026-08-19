# SchoolSync 🎓

**SchoolSync** is a modern, feature-rich, multi-role School Management System built with **Node.js**, **Express**, **EJS**, **MySQL**, and **Socket.IO**. It provides a comprehensive solution for managing educational institutions of any size, offering real-time communication, attendance automation, fee collections, subscription management, AI assistance, transport tracking, live GPS, library operations, video meetings, and academic performance monitoring.

---

## 🌟 Key Features

### 👤 Multi-Role Portals (8 Distinct Roles)
SchoolSync provides tailored interfaces and strict access control for **8 distinct user roles**:

| Role | Responsibilities & Capabilities |
|------|---------------------------------|
| **Super Admin** | Platform oversight, school onboarding, subscription plan configuration, global analytics, audit logs, announcements, support tickets |
| **Group Admin** | Multi-branch overview, aggregate financial & academic reporting across affiliated schools |
| **School Admin** | Complete school operations — admissions, fee structures & collection, roll numbers, student promotions, timetables, notices, salary, transport, library, and settings |
| **Teacher** | Attendance marking, exam marks entry, homework creation & review, leave requests, student progress tracking, PTM / video meetings |
| **Student** | Homework submissions, exam timetable & marksheet download, library book borrowing, notices, attendance history, certificates |
| **Parent** | Real-time child attendance monitoring, online fee payment, teacher communication, live bus tracking, PTM booking |
| **Driver** | Assigned route navigation, bus student rosters, GPS status updates (browser & IoT), trip management |
| **Librarian** | Book catalog management, QR code generation, issue & return workflows, overdue fine collection |

---

### 🚀 Core Functionalities

#### 📚 Academic Management
- **Automated Roll Number Assignment** — Class-wise bulk roll number generation with numeric validation and duplicate checks.
- **Student Promotion Engine** — Bulk student promotion or repetition to the next academic year with roll number resets.
- **Exam & Marks Management** — Exam scheduling, marks entry, marksheet generation, and PDF export.
- **Timetable Management** — Automated timetable creation with conflict detection and teacher assignment.
- **Homework System** — Homework creation, student submission uploads, and teacher feedback workflows.
- **Certificates** — Auto-generation of Transfer Certificates, Bonafide Certificates, and custom templates with PDFKit.
- **Academic Calendar** — Event scheduling, holiday management, and role-specific calendar views.

#### 🧑‍🏫 Staff & HR
- **Teacher Admission & Profile Management** — Full-lifecycle teacher onboarding with secure document uploads.
- **Salary Management** — Automated monthly salary generation cron with pay slip generation in PDF.
- **Leave Management** — Staff leave requests and approval workflows with status tracking.
- **Teacher Permissions & Assignment** — Granular permission controls and class/subject allocation.

#### 💰 Fee & Finance
- **Custom Fee Structures** — Class-wise and student-wise fee configurations with installment support.
- **Razorpay Payment Gateway** — Secure online fee collection with signature verification and webhook handling.
- **Invoice & Receipts** — Automated PDF fee receipt generation and bulk export.
- **Automated Defaulter Lists** — Fee reminder cron jobs and overdue notification dispatch.
- **Revenue Analytics** — School-wise revenue dashboards, collection statistics, and exportable reports.

#### 📡 Attendance Management
- **Real-Time Attendance Tracking** — Daily student and teacher attendance with statistics and calendar views.
- **Attendance Reminder Cron** — Automated reminders sent to teachers who have not submitted attendance (morning and afternoon schedules).
- **Attendance Defaulter Cron** — Automated weekly identification and parent alerts for low-attendance students.
- **Parent Notifications** — Instant notifications to parents when a student is marked absent.

#### 💬 Communication & Collaboration
- **Real-Time Role-Based Chat** — Socket.IO powered direct and group messaging with permission controls.
- **Notice Board** — School-wide and class-specific notice publishing with file attachments.
- **Notification System** — In-app notification center with read/unread tracking and push dispatch.
- **Video Conferencing (Meetings)** — Jitsi Meet integration (`meet.jit.si` or custom domain) with scheduling, invitations, and auto-close cleanup.
- **SOS Emergency Alerts** — Emergency SOS feature for students and parents with geolocation coordinates.
- **Birthday Notifications** — Automated birthday greeting checks on dashboard access for students and staff.

#### 🚌 Transport & GPS Tracking
- **Live Bus Tracking** — Real-time GPS tracking via Socket.IO with ETA computation and geofence triggers.
- **Driver GPS Sharing** — Web-based driver GPS broadcasting with CSRF protection.
- **Hardware IoT GPS Endpoint** — Dedicated `/api/gps/hardware` endpoint for vehicle-mounted GPS trackers with API key and device authentication.
- **Route & Stop Management** — Dynamic route creation with multiple stop assignments and pickup lists.
- **Trip Auto-Close** — Automated trip closure cron when route completion or inactivity thresholds are met.
- **Transport Expiry Alerts** — Cron-based expiry notifications for student transport subscriptions.

#### 📖 Library Operations
- **Book Catalog Management** — Full CRUD catalog with QR code generation (`qrcode` package).
- **Issue & Return Tracking** — Circulation workflow with due-date calculation and return confirmations.
- **Overdue Fine Management** — Automated fine calculation and fine collection receipts.
- **Library Cron** — Daily automated fine computation and overdue notification alerts.

#### 🤖 AI & Analytics
- **AI Assistant** — Google Gemini AI API (`@google/genai` and `@google/generative-ai`) assistant for admin queries, academic insights, and administrative workflows.
- **Dashboard Analytics** — Role-specific KPIs, charts, and statistical summaries.
- **Bulk Data Import** — CSV and Excel data import for students, teachers, and marks with validation caching (`fast-csv`, `xlsx`).
- **Bulk Data Export** — Excel and PDF exports (`exceljs`, `pdfkit`) with automated midnight cleanup for expired export files.

#### 🔒 Subscription & Billing (SaaS)
- **Subscription Plans** — Basic, Standard, and Premium tiers with feature gating via `planAccess` middleware.
- **7-Day Demo Trial** — Full-featured trial onboarding for new school signups.
- **Subscription Cron** — Automated plan expiry detection, grace period management, warnings, and suspension.
- **Billing Service** — Automated invoice generation (PDF), payment tracking, and plan renewals.

#### 🏫 School & Platform Administration
- **School Onboarding** — Multi-school registration with customized branding, logos, and settings.
- **Multi-School Group Admin** — Group admin dashboard with cross-school aggregated reporting.
- **School Events & Media Gallery** — Gallery albums with cover media uploads, category filters, and permission checks.
- **Audit Logs** — Comprehensive audit trail for critical platform operations (Super Admin).
- **Support Tickets** — Built-in helpdesk ticketing system for school admins and super admins.

---

## 🛠️ Technology Stack

### Backend & Database
| Technology | Purpose |
|------------|---------|
| **Node.js** (v18+) | Server runtime environment |
| **Express.js 4.x** | Web application framework & REST APIs |
| **EJS + express-ejs-layouts** | Server-side templating engine |
| **MySQL 8.x (`mysql2`)** | Primary relational database with connection pooling |
| **Socket.IO 4.x** | Real-time bidirectional communication (Chat & GPS tracking) |
| **Redis** (Optional) | Session store (`connect-redis`), Socket.IO adapter, and validation caching |
| **node-cron** | Automated scheduled background jobs |

### Authentication & Security
| Technology | Purpose |
|------------|---------|
| **JWT (`jsonwebtoken`) & Cookies** | Secure token-based session & API authentication |
| **Passport.js + Google OAuth 2.0** | Social login integration |
| **bcryptjs** | Password hashing |
| **CSRF Protection** | Token-based CSRF protection with multipart support |
| **Tenant Isolation Middleware** | Scoped `school_id` database queries and route guards |
| **Rate Limiting** | API abuse prevention on sensitive routes |
| **Protected Uploads Route** | Authenticated and tenant-isolated file serving (`/uploads/*`) |
| **Security Headers** | Helmet-style HTTP security headers |

### Integrations & Libraries
| Package | Purpose |
|---------|---------|
| **Razorpay** | Online payment gateway for fees & subscriptions |
| **@google/genai & @google/generative-ai** | Google Gemini AI assistant integration |
| **Nodemailer** | SMTP email queue and notification delivery |
| **PDFKit** | PDF document generation (receipts, certificates, invoices, pay slips) |
| **ExcelJS & xlsx** | Spreadsheet import and export processing |
| **fast-csv** | CSV streaming parser with validation |
| **Multer** | Multipart file upload management to secure storage |
| **Sharp** | Image processing and thumbnail optimization |
| **QRCode** | QR code generation for library books and ID cards |
| **express-validator** | Input validation and sanitization |

---

## 🔄 Background Cron Jobs

SchoolSync includes 12 automated background jobs scheduled via `node-cron`:

| Cron Job | Schedule | Description |
|----------|----------|-------------|
| **Email Queue Worker** | `*/5 * * * *` | Processes queued email notifications in batches |
| **Email Cleanup** | `0 0 * * *` | Removes expired email log entries daily |
| **Meeting Status Updater** | `* * * * *` | Auto-updates scheduled Jitsi meetings that have concluded |
| **Performance Monitor** | `*/15 * * * *` | Records system health and performance snapshots |
| **Subscription Checks** | Daily (03:30, 04:15, 04:30, 05:30) | Detects expiring plans, applies grace periods, and enforces suspensions |
| **Library Fines** | `0 7 * * *` | Computes daily overdue book fines and creates notifications |
| **Attendance Reminders** | `30 9 * * 1-6`, `0 11 * * 1-6`, `0 13 * * 1-6` | Reminds teachers who have pending attendance submissions |
| **Fee Reminders** | `0 8 * * *` | Sends upcoming/overdue fee reminders to parents |
| **Salary Generation** | `0 6 1 * *` | Generates monthly staff payroll and salary entries on the 1st of each month |
| **Attendance Defaulters** | `0 8 * * 1` | Identifies low-attendance students every Monday and alerts parents |
| **Transport Expiry** | `0 7 * * *` | Alerts for expiring student transport subscriptions |
| **Bulk Export Cleanup** | `0 0 * * *` | Purges generated export files older than 24 hours |

---

## 🔐 Security Architecture

- **Tenant Isolation**: Every database query is scoped by `school_id`. Cross-tenant data access is blocked by `tenantIsolation` middleware and authorized upload services.
- **Protected File Storage**: User-uploaded documents, certificates, invoices, receipts, and images are stored outside the public directory in `storage/uploads/` and served exclusively through authenticated, tenant-authorized routes (`/uploads/*`).
- **Role-Based Access Control (RBAC)**: Strict middleware guards across all 8 user roles.
- **CSRF Defense**: Double-submit CSRF validation for browser forms, location sharing, and multipart file uploads.
- **Hardware GPS Authentication**: Machine-to-machine IoT endpoint authenticated via `X-API-Key` / `GPS_HARDWARE_API_KEY` and registered vehicle device ID.
- **Rate Limiting**: Configured rate limits on authentication, file uploads, AI queries, and API endpoints.
- **Input Sanitization**: Strict validation and sanitization using `express-validator` to protect against injection attacks.

---

## 📋 Prerequisites

Ensure you have the following installed on your system:

- **Node.js**: v18.x or higher
- **npm**: v9.x or higher
- **MySQL**: v8.0 or higher
- **Redis** *(Optional)*: v6.x or higher (used for session storage, Socket.IO multi-instance scaling, and caching)

---

## ⚙️ Installation & Setup

### 1. Clone the Repository
```bash
git clone https://github.com/ChhayalPipaliya/SchoolSync.git
cd SchoolSync
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Create a `.env` file in the root directory by copying `.env.example`:
```bash
cp .env.example .env
```

Configure your environment settings in `.env`:
```env
NODE_ENV=development
PORT=4000
APP_URL=http://localhost:4000
BASE_URL=http://localhost:4000

# MySQL Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=your_mysql_user
DB_PASSWORD=your_mysql_password
DB_NAME=schoolsync_db

# Security
JWT_SECRET=your-random-jwt-secret-key
SESSION_SECRET=your-random-session-secret-key

# Super Admin Seed
SUPER_ADMIN_EMAIL=admin@schoolsync.com
SUPER_ADMIN_PASSWORD=Admin@123
SUPER_ADMIN_FIRST_NAME=Super
SUPER_ADMIN_LAST_NAME=Admin
SEED_DEMO_PASSWORD=your-demo-seed-password

# Socket.IO
SOCKET_CORS_ORIGIN=http://localhost:4000

# Redis (Optional)
REDIS_HOST=localhost
REDIS_PORT=6379

# Google OAuth 2.0 (Optional)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:4000/auth/google/callback

# Video Meetings
JITSI_DOMAIN=meet.jit.si

# Google Gemini AI (Optional)
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash

# Razorpay Payments (Optional)
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=

# Email / SMTP (Optional)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password

# Hardware GPS Device Integration (Optional)
GPS_HARDWARE_API_KEY=
```

### 4. Database Setup
Create the MySQL database:
```sql
CREATE DATABASE schoolsync_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

---

## 🏃 Running the Application

### Development Mode (with auto-reload)
```bash
npm run start:dev
```

### Production Mode
```bash
npm start
```

Access the application in your browser at: **[http://localhost:4000](http://localhost:4000)**

---

## 📂 Project Structure

```
SchoolSync/
├── app.js                        # Server entry point, middleware pipeline & Socket.IO initialization
├── package.json                  # Dependencies, scripts, and project metadata
├── .env.example                  # Environment configuration template
│
├── src/
│   ├── config/                   # MySQL connection pool, Redis, Socket.IO, and Passport OAuth
│   ├── controllers/              # Route controllers organized by role:
│   │   ├── superAdmin/           # Platform oversight, school onboarding, plans, audit logs
│   │   ├── groupAdmin/           # Multi-branch aggregate analytics & reporting
│   │   ├── schoolAdmin/          # Admissions, fees, classes, exams, timetable, salary, transport
│   │   ├── teacher/              # Attendance, marks, homework, leave requests
│   │   ├── student/              # Marksheets, homework, notices, library borrowing
│   │   ├── parent/               # Fee payments, attendance tracking, live bus tracking
│   │   ├── driver/               # Route rosters, trip controls, GPS broadcasting
│   │   └── librarian/            # Book catalog, QR generation, issue/return, fines
│   │
│   ├── middleware/               # Auth guards, tenant isolation, CSRF, rate limiters, upload guards
│   ├── models/                   # Database query models and data access layers
│   ├── routes/                   # Role-specific Express routers and API endpoints
│   ├── services/                 # Business logic, engines (attendance, promotion, billing, GPS), and crons
│   ├── utils/                    # PDF generators, Excel exporters, audit loggers, validators
│   ├── views/                    # EJS templates and layouts
│   └── public/                   # Static web assets (CSS, client JS, images, illustrations)
│
└── storage/                      # Secure file storage (uploads, receipts, certificates, exports)
```

---

## 📦 Available npm Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `npm start` | `node app.js` | Starts the application in production mode |
| `npm run start:dev` | `nodemon app.js` | Starts the application with nodemon live reload |

---

## 📜 License

This project is licensed under the [ISC License](LICENSE).
