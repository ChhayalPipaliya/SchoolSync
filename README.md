# SchoolSync 🎓

**SchoolSync** is a modern, feature-rich, multi-role School Management System built with **Node.js**, **Express**, **EJS**, and **MySQL**. It provides a comprehensive solution for managing educational institutions of any size, offering real-time communication, attendance automation, fee collections, subscription management, AI assistance, transport tracking, library operations, and academic performance monitoring.

---

## 🌟 Key Features

### 👤 Multi-Role Dashboard & Portals
SchoolSync provides tailored interfaces and strict access control for 8 distinct user roles:
1. **Super Admin**: Platform oversight, school onboarding, subscription plan configuration, global analytics.
2. **Group Admin**: Multi-branch overview, aggregate financial & academic reports across school groups.
3. **School Admin**: Complete school management, student/teacher admissions, fee collection, roll number assignment, class promotion, timetable, notices, and settings.
4. **Teacher**: Attendance marking, exam marks entry, homework creation, leave requests, student progress tracking.
5. **Student**: Homework submissions, exam timetable & marksheet download, library book borrowing, notices, attendance history.
6. **Parent**: Real-time child attendance monitoring, online fee payment, teacher communication, live bus tracking.
7. **Driver**: Assigned route navigation, bus student rosters, status updates.
8. **Librarian**: Book catalog management, issue & return workflows, overdue fine collection.

---

### 🚀 Core Functionalities

- **Automated Roll Number Assignment**: Class-wise bulk roll number generation with numeric validation and duplicate check within classes.
- **Student Promotion Engine**: Bulk student promotion/repeat to next academic year with automated roll number reset.
- **Attendance Tracking**: Real-time student & teacher attendance tracking with automated analytics and missing attendance reminders.
- **Fee Management & Razorpay Payments**: Custom fee structures, online fee collection, invoice receipts, and automated defaulter lists.
- **Subscription Engine**: Subscription management with Basic, Standard, Premium plans, and 7-day full access demo trial mode.
- **Real-Time Role-Based Chat**: Integrated Socket.IO chat system supporting direct and group messaging among school members.
- **School Events & Media Gallery**: Gallery albums with cover media uploads, downloads permission control, and category filters.
- **AI Assistant**: Integrated Google Gemini API (`@google/genai`) for automated administrative support, insights, and queries.
- **Transport & Live Bus Tracking**: Vehicle roster management, driver assignment, route stops tracking.
- **Library Management**: Book cataloging, barcode/QR generation, issue & return tracking, and fine management.

---

## 🛠️ Technology Stack

- **Backend**: Node.js, Express.js
- **View Engine**: EJS, Express EJS Layouts
- **Database**: MySQL 8.x (`mysql2` connection pool)
- **Real-Time Communication**: Socket.io (with Redis adapter support)
- **Authentication**: Passport.js (Google OAuth 2.0), JWT, `bcryptjs`, Express Session
- **Payment Gateway**: Razorpay API
- **AI Integration**: Google Generative AI (`@google/genai` & `@google/generative-ai`)
- **Document & File Exports**: PDFKit (PDF generation), ExcelJS / XLSX (Spreadsheet exports), Sharp (Image optimization)

---

## 📋 Prerequisites

Before running SchoolSync, ensure you have the following installed:
- **Node.js**: v18.x or higher
- **npm**: v9.x or higher
- **MySQL**: v8.0 or higher
- **Redis** *(Optional for Socket.io adapter)*: v6.x or higher

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

Update `.env` with your database credentials and API keys:
```env
NODE_ENV=development
PORT=4000
APP_URL=http://localhost:4000
BASE_URL=http://localhost:4000

# Database Configuration
DB_HOST=localhost
DB_PORT=3306
DB_USER=your_mysql_user
DB_PASSWORD=your_mysql_password
DB_NAME=schoolsync_db

# Security Secrets
JWT_SECRET=your_jwt_secret_key
SESSION_SECRET=your_session_secret_key

# Super Admin Credentials
SUPER_ADMIN_EMAIL=admin@schoolsync.com
SUPER_ADMIN_PASSWORD=Admin@123
SUPER_ADMIN_FIRST_NAME=Super
SUPER_ADMIN_LAST_NAME=Admin

# Google OAuth (Optional)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:4000/auth/google/callback

# Google Gemini AI Key (Optional)
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
```

### 4. Database Setup
Create the MySQL database and import the initial schema:
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

Once running, access the web application in your browser at:
[http://localhost:4000](http://localhost:4000)

---

## 📂 Project Structure

```
SchoolSync/
├── app.js                   # Application entry point & Express server setup
├── package.json             # Project dependencies and npm scripts
├── .env.example             # Environment variables template
├── src/
│   ├── config/              # Database & Passport configurations
│   ├── controllers/         # Route controllers for all 8 user roles
│   ├── middleware/          # Authentication & Subscription check middlewares
│   ├── models/              # Data access layer & database queries
│   ├── public/              # Static assets (CSS, JS, images, fonts)
│   ├── routes/              # Express route definitions
│   ├── services/            # Core business logic (Promotion, Subscription, Attendance, Chat)
│   ├── utils/               # Helper utilities and formatting functions
│   └── views/               # EJS view templates grouped by role & feature
└── storage/                 # Uploaded media files, PDFs, and temporary storage
```

---

## 📜 License

This project is licensed under the [ISC License](LICENSE).
