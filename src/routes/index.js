const express = require('express');
const router = express.Router();

const authRoutes = require('./authRoutes');
const superAdminRoutes = require('./superAdminRoutes');
const schoolAdminRoutes = require('./schoolAdminRoutes');
const studentRoutes = require('./studentRoutes');
const teacherRoutes = require('./teacherRoutes');
const driverRoutes = require('./driverRoutes');
const librarianRoutes = require('./librarianRoutes');
const bulkRoutes = require('./bulkRoutes');
const razorpayRoutes = require('./razorpayRoutes');
const admissionRoutes = require('./admissionRoutes');
const notificationRoutes = require('./notificationRoutes');
const teacherAdmissionRoutes = require('./teacherAdmissionRouter');

router.use('/', authRoutes);
router.use('/superadmin', superAdminRoutes);
router.use('/schooladmin', schoolAdminRoutes);
router.use('/student', studentRoutes);
router.use('/teacher', teacherRoutes);
router.use('/driver', driverRoutes);
router.use('/librarian', librarianRoutes);

// Bulk import/export
// bulkRoutes internally uses full paths (/schooladmin/imports, /api/import/:entityType, etc.)
// Mount at '/' to avoid double prefix
router.use('/', bulkRoutes);

// Razorpay payment routes (webhook, verify, payment-status)
// Mounted at /razorpay → /razorpay/verify, /razorpay/webhook, /razorpay/payment-status/:orderId
router.use('/razorpay', razorpayRoutes);

// Public student admission form (QR-based, no auth)
// /admission/student → admissionCtrl.showStudentForm / submitStudentForm
router.use('/admission', admissionRoutes);

// Notification routes (requires verifyToken internally)
// /notifications, /notifications/unread-count, /notifications/:id/read, etc.
router.use('/notifications', notificationRoutes);

// Teacher admission router
// internally uses full paths (/admission/teacher, /admin/teachers/applications, /schooladmin/admissions/teachers/qr/generate)
// Mount at '/' to avoid double prefix
router.use('/', teacherAdmissionRoutes);

const eventRoutes = require('./eventRoutes');
router.use('/', eventRoutes);

module.exports = router;