# SchoolSync 🎓

**SchoolSync** is a modern, feature-rich, multi-role School Management System built with **Node.js**, **Express**, **EJS**, and **MySQL**. It provides a comprehensive solution for managing educational institutions of any size, offering real-time communication, attendance automation, fee collections, subscription management, AI assistance, transport tracking, live GPS, library operations, video meetings, and academic performance monitoring.

---

## 🌟 Key Features

### 👤 Multi-Role Dashboard & Portals
SchoolSync provides tailored interfaces and strict access control for **8 distinct user roles**:

| Role | Responsibilities |
|------|-----------------|
| **Super Admin** | Platform oversight, school onboarding, subscription plan configuration, global analytics, audit logs, announcements |
| **Group Admin** | Multi-branch overview, aggregate financial & academic reports across school groups |
| **School Admin** | Complete school management — student/teacher admissions, fee collection, roll number assignment, class promotion, timetable, notices, salary, transport, and settings |
| **Teacher** | Attendance marking, exam marks entry, homework creation, leave requests, student progress tracking, PTM scheduling |
| **Student** | Homework submissions, exam timetable & marksheet download, library book borrowing, notices, attendance history, certificates |
| **Parent** | Real-time child attendance monitoring, online fee payment, teacher communication, live bus tracking, PTM booking |
| **Driver** | Assigned route navigation, bus student rosters, GPS status updates, trip management |
| **Librarian** | Book catalog management, issue & return workflows, overdue fine collection, library cron jobs |

---

### 🚀 Core Functionalities

#### 📚 Academic Management
- **Automated Roll Number Assignment** — Class-wise bulk roll number generation with numeric validation and duplicate check within classes
- **Student Promotion Engine** — Bulk student promotion/repeat to next academic year with automated roll number reset
- **Exam & Marks Management** — Exam scheduling, marks entry, marksheet generation & PDF export
- **Timetable Management** — Automated timetable creation, conflict detection, and teacher assignment
- **Homework System** — Creation, submission tracking, and feedback workflows
- **Certificates** — Auto-generation of Transfer Certificates, Bonafide Certificates, and custom templates
- **Academic Calendar** — Event scheduling, holiday management, and role-specific calendar views

#### 🧑‍🏫 Staff & HR
- **Teacher Admission & Profile Management** — Full-lifecycle teacher onboarding with document uploads
- **Salary Management** — Automated salary generation cron with pay slip generation (PDF)
- **Leave Management** — Staff leave request, approval workflows with status tracking
- **Teacher Permission & Assignment** — Granular permission control and class/subject assignment

#### 💰 Fee & Finance
- **Custom Fee Structures** — Class-wise and student-wise fee configuration
- **Razorpay Payment Gateway** — Secure online fee collection with webhook verification
- **Invoice & Receipts** — PDF fee receipt generation and bulk export
- **Automated Defaulter Lists** — Fee reminder cron jobs and overdue notifications
- **Revenue Analytics** — School-wise revenue dashboards and export reports

#### 📡 Attendance
- **Real-Time Attendance Tracking** — Student & teacher daily attendance with analytics
- **Attendance Reminder Cron** — Automated reminders to teachers for missing attendance
- **Attendance Defaulter Cron** — Automated identification and notification of attendance defaulters
- **Parent Notification** — Instant push/notification to parents on student absence

#### 💬 Communication
- **Real-Time Role-Based Chat** — Socket.IO powered direct and group messaging for all school members
- **Notice Board** — School-wide and class-specific notice publishing
- **Notifications System** — In-app notification center with read/unread tracking
- **Meeting System (Video Conferencing)** — Jitsi-integrated video meetings with scheduling, invites & cron cleanup
- **SOS Alerts** — Emergency SOS feature for students/parents with geo-location
- **Birthday Notifications** — Automated birthday wishes to students & staff

#### 🚌 Transport & GPS
- **Live Bus Tracking** — Real-time GPS tracking via Socket.IO with ETA computation
- **Route & Stop Management** — Dynamic route creation with multiple stop assignments
- **Geofence Engine** — Automated geofence entry/exit alerts for school zones
- **Transport Authorization** — Parent-controlled authorization for student transport
- **Trip Auto-Close** — Automated trip closure cron when route is completed
- **Transport Expiry Alerts** — Cron-based expiry notification for transport subscriptions

#### 📖 Library
- **Book Catalog Management** — Full CRUD with QR code/barcode generation (`qrcode` package)
- **Issue & Return Tracking** — Issue workflows with due-date management
- **Overdue Fine Management** — Auto-calculate and collect library fines
- **Library Cron** — Daily automated fine computation and overdue alerts

#### 🤖 AI & Analytics
- **AI Assistant** — Google Gemini API (`@google/genai`) powered assistant for admin queries and insights
- **Dashboard Analytics** — Role-specific KPIs, charts, and statistical summaries
- **Bulk Export** — Excel/PDF export for students, teachers, fees, attendance, and more
- **Bulk Import** — CSV/Excel based bulk data import with validation

#### 🔒 Subscription & Billing
- **Subscription Plans** — Basic, Standard, Premium plans with feature-gating via `planAccess` middleware
- **7-Day Demo Trial** — Full-access trial mode for new schools
- **Subscription Cron** — Automated plan expiry detection, grace period, and suspension
- **Billing Service** — Complete billing lifecycle — invoice generation, payment tracking, and renewal

#### 🏫 School & Portal Management
- **School Onboarding** — Full school registration with settings, logo, and configuration
- **Multi-School Support** — Group admin with cross-school aggregated reporting
- **Portal Access** — Configurable student/parent portal with access control
- **School Events & Media Gallery** — Gallery albums with cover media uploads, download permission control, and category filters
- **Audit Logs** — Full audit trail for critical admin actions (Super Admin)
- **Support Tickets** — Built-in helpdesk system for school admins

---

## 🛠️ Technology Stack

### Backend
| Technology | Purpose |
|-----------|---------|
| **Node.js** | Runtime environment |
| **Express.js 4.x** | Web framework & REST API |
| **EJS + express-ejs-layouts** | Server-side templating |
| **MySQL 8.x (`mysql2`)** | Relational database with connection pool |
| **Socket.IO 4.x** | Real-time bidirectional communication |
| **Redis (`@socket.io/redis-adapter`)** | Socket.IO horizontal scaling adapter |
| **node-cron** | Scheduled background jobs |

### Authentication & Security
| Technology | Purpose |
|-----------|---------|
| **Passport.js + Google OAuth 2.0** | Social login |
| **JWT (`jsonwebtoken`)** | API token authentication |
| **bcryptjs** | Password hashing |
| **express-session + connect-redis** | Session management with Redis store |
| **CSRF protection** | Cross-site request forgery prevention |
| **Rate Limiting** | API abuse prevention |
| **Tenant Isolation** | Multi-school data isolation middleware |
| **Security Headers** | Helmet-style security headers |

### Integrations & Libraries
| Package | Purpose |
|---------|---------|
| **Razorpay** | Payment gateway (fees & subscriptions) |
| **@google/genai + @google/generative-ai** | Google Gemini AI assistant |
| **Nodemailer** | Email notifications |
| **PDFKit** | PDF generation (receipts, certificates, reports) |
| **ExcelJS + xlsx** | Spreadsheet import/export |
| **fast-csv + csv-parser** | CSV bulk data processing |
| **Multer** | File uploads (images, documents) |
| **Sharp** | Image optimization & resizing |
| **QRCode** | QR code generation for library books |
| **UUID** | Unique ID generation |
| **express-validator** | Input validation & sanitization |
| **connect-flash** | Flash messages |

---

## 📋 Prerequisites

Before running SchoolSync, ensure you have the following installed:

- **Node.js**: v18.x or higher
- **npm**: v9.x or higher
- **MySQL**: v8.0 or higher
- **Redis** *(Optional — required for Socket.IO Redis adapter & session store)*: v6.x or higher

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

### 3. Environment Configuration
Create a `.env` file in the root directory by copying `.env.example`:
```bash
cp .env.example .env
```

Update `.env` with your credentials:
```env
NODE_ENV=development
PORT=4000
APP_URL=http://localhost:4000
BASE_URL=http://localhost:4000

# Database
DB_HOST=localhost
DB_PORT=3306
DB_SOCKET_PATH=          # Optional: Unix socket path for MySQL
DB_USER=your_mysql_user
DB_PASSWORD=your_mysql_password
DB_NAME=schoolsync_db

# Security
JWT_SECRET=replace-with-a-long-random-jwt-secret
SESSION_SECRET=replace-with-a-long-random-session-secret

# Super Admin
SUPER_ADMIN_EMAIL=admin@schoolsync.com
SUPER_ADMIN_PASSWORD=Admin@123
SUPER_ADMIN_FIRST_NAME=Super
SUPER_ADMIN_LAST_NAME=Admin
SEED_DEMO_PASSWORD=replace-with-a-strong-demo-only-password

# Socket.IO CORS
SOCKET_CORS_ORIGIN=http://localhost:4000

# Google OAuth (Optional)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:4000/auth/google/callback

# Video Meetings
JITSI_DOMAIN=meet.jit.si

# Google Gemini AI (Optional)
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
```

### 4. Database Setup
Create the MySQL database:
```sql
CREATE DATABASE schoolsync_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

---

## 🏃 Running the Application

### Development Mode (with Nodemon auto-reload)
```bash
npm run start:dev
```

### Production Mode
```bash
npm start
```

Once running, open your browser at: **[http://localhost:4000](http://localhost:4000)**

---

## 📂 Project Structure

```
SchoolSync/
├── app.js                        # Application entry point & Express/Socket.IO server setup
├── package.json                  # Project dependencies and npm scripts
├── .env.example                  # Environment variables template
│
├── src/
│   ├── config/                   # Database connection pool & Passport.js configurations
│   │
│   ├── controllers/              # Route controllers organized by role
│   │   ├── superAdmin/           # Platform management (schools, plans, billing, audit, announcements) — 15 controllers
│   │   ├── groupAdmin/           # Multi-branch aggregated management
│   │   ├── schoolAdmin/          # Full school operations — 32 controllers
│   │   │   ├── admissionController.js
│   │   │   ├── attendanceController.js
│   │   │   ├── bulkExportController.js
│   │   │   ├── bulkImportController.js
│   │   │   ├── certificateController.js
│   │   │   ├── classController.js
│   │   │   ├── examController.js
│   │   │   ├── feeController.js
│   │   │   ├── salaryController.js
│   │   │   ├── timetableController.js
│   │   │   ├── transportController.js
│   │   │   └── ... (and more)
│   │   ├── teacher/              # Teacher portal — 10 controllers
│   │   ├── student/              # Student portal — 13 controllers
│   │   ├── parent/               # Parent portal — 4 controllers
│   │   ├── driver/               # Driver portal (GPS, routes, trips)
│   │   ├── librarian/            # Library portal (catalog, issue/return, fines)
│   │   ├── authController.js     # Login, registration, OTP, OAuth2
│   │   ├── chatController.js     # Real-time chat (Socket.IO)
│   │   ├── aiController.js       # Gemini AI assistant
│   │   ├── eventController.js    # School events & media gallery
│   │   ├── gpsController.js      # Live bus GPS tracking
│   │   ├── meetingController.js  # Video conferencing (Jitsi)
│   │   ├── notificationController.js
│   │   ├── sosController.js      # SOS emergency alerts
│   │   ├── searchController.js   # Global search
│   │   ├── mediaController.js    # Media uploads & management
│   │   └── leaveController.js    # Leave management
│   │
│   ├── middleware/               # Express middleware — 21 files
│   │   ├── auth.js               # Role-based authentication guards
│   │   ├── subscriptionGuard.js  # Subscription & plan feature gating
│   │   ├── planAccess.js         # Subscription plan feature checks
│   │   ├── tenantIsolation.js    # Multi-school data isolation
│   │   ├── rateLimit.js          # API rate limiting
│   │   ├── csrf.js               # CSRF token protection
│   │   ├── securityHeaders.js    # HTTP security headers
│   │   ├── validate.js           # Input validation rules
│   │   ├── upload.js             # Multer file upload configs
│   │   ├── quotaCheck.js         # Plan quota enforcement
│   │   └── ... (and more)
│   │
│   ├── models/                   # Data access layer & raw MySQL queries
│   │
│   ├── routes/                   # Express route definitions — 22 route files
│   │   ├── schoolAdminRoutes.js  # 200+ school admin endpoints
│   │   ├── superAdminRoutes.js
│   │   ├── teacherRoutes.js
│   │   ├── studentRoutes.js
│   │   ├── parentRoutes.js
│   │   ├── driverRoutes.js
│   │   ├── librarianRoutes.js
│   │   ├── razorpayRoutes.js     # Payment & webhook routes
│   │   ├── uploadRoutes.js       # File upload endpoints
│   │   └── ... (and more)
│   │
│   ├── services/                 # Core business logic — 38 service files
│   │   ├── attendanceEngineService.js    # Attendance computation engine
│   │   ├── billingService.js             # Billing lifecycle management
│   │   ├── subscriptionService.js        # Subscription state machine
│   │   ├── subscriptionPaymentService.js # Payment processing
│   │   ├── timetableService.js           # Timetable generation engine
│   │   ├── studentPromotionService.js    # Bulk promotion engine
│   │   ├── feePaymentService.js          # Fee payment processing
│   │   ├── libraryService.js             # Library operations
│   │   ├── notificationService.js        # Push/in-app notifications
│   │   ├── aiService.js                  # Gemini AI wrapper
│   │   ├── gpsTrackingService.js         # Real-time GPS engine
│   │   ├── etaEngineService.js           # Bus ETA computation
│   │   ├── geofenceEngineService.js      # Geofence detection
│   │   ├── tripAutoCloseService.js       # Auto trip closure
│   │   ├── emailQueueService.js          # Async email queue
│   │   ├── birthdayService.js            # Birthday notification scheduler
│   │   │   --- Cron Jobs ---
│   │   ├── attendanceDefaulterCron.js    # Daily defaulter detection
│   │   ├── attendanceReminderCron.js     # Teacher attendance reminders
│   │   ├── feeReminderCron.js            # Fee payment reminders
│   │   ├── libraryCron.js                # Library fine computation
│   │   ├── salaryGenerationCron.js       # Monthly salary generation
│   │   ├── subscriptionCron.js           # Plan expiry & grace period
│   │   ├── transportExpiryCron.js        # Transport subscription expiry
│   │   └── meetingCron.js                # Cleanup for ended meetings
│   │
│   ├── utils/                    # Helper utilities — 26 files
│   │   ├── pdfHelper.js          # PDF generation helpers
│   │   ├── notificationTemplates.js  # Notification message templates
│   │   ├── auditLogger.js        # Audit trail logging
│   │   ├── sanitizers.js         # Input sanitization
│   │   ├── exporters/            # Role-specific export formatters
│   │   └── validators/           # Custom validation rule sets
│   │
│   └── views/                    # EJS templates grouped by role & feature
│
└── storage/                      # Uploaded media files, PDFs, and temporary storage
```

---

## 🔄 Background Cron Jobs

SchoolSync runs the following automated background tasks via `node-cron`:

| Cron Job | Description |
|----------|-------------|
| Attendance Defaulter | Detects students with low attendance and notifies parents |
| Attendance Reminder | Reminds teachers who have not marked attendance |
| Fee Reminder | Sends due/overdue fee reminders to parents |
| Library Fines | Computes and applies overdue library fines |
| Salary Generation | Auto-generates teacher salary records monthly |
| Subscription Check | Detects expiring/expired subscriptions, applies grace period |
| Transport Expiry | Alerts for expiring transport subscriptions |
| Meeting Cleanup | Closes meetings that have ended |
| Trip Auto-Close | Auto-closes completed bus trips |
| Birthday Notifications | Sends birthday wishes to students & staff |
| Performance Monitor | Tracks system performance metrics |

---

## 🔐 Security Architecture

- **Multi-tenant Isolation** — Every DB query is scoped to `school_id` via `tenantIsolation` middleware
- **Role-Based Access Control (RBAC)** — 8 roles with strict middleware guards on every route
- **Subscription Gating** — Feature access is controlled by the school's active subscription plan
- **CSRF Protection** — Token-based CSRF for all state-changing form submissions
- **Rate Limiting** — Per-route and global API rate limiting to prevent abuse
- **Input Validation & Sanitization** — `express-validator` with custom sanitization on all inputs
- **Secure File Uploads** — Multer with file type validation, size limits, and `sharp` for image processing
- **Security Headers** — Helmet-style HTTP security headers on all responses
- **Audit Logging** — Super Admin audit trail for all critical platform operations

---

## 📦 Available npm Scripts

```bash
npm start          # Start server in production mode (node app.js)
npm run start:dev  # Start server in development mode with Nodemon auto-reload
```

---

## 📜 License

This project is licensed under the [ISC License](LICENSE).
