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

router.use('/', bulkRoutes);

router.use('/razorpay', razorpayRoutes);

router.use('/admission', admissionRoutes);

router.use('/notifications', notificationRoutes);

router.use('/', teacherAdmissionRoutes);

const eventRoutes = require('./eventRoutes');
router.use('/', eventRoutes);

module.exports = router;