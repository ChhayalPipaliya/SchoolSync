const express = require('express');
const router = express.Router();
const { verifyToken, isStudent } = require('../middleware/auth');
const { requireStudentPortal } = require('../middleware/portalAccess');
const studentPortalAccess = [verifyToken, isStudent, requireStudentPortal];
const dashboardController = require('../controllers/student/dashboardController');
const profileController = require('../controllers/student/profileController');
const attendanceController = require('../controllers/student/attendanceController');
const feeController = require('../controllers/student/feeController');
const feeCtrl = require('../controllers/schoolAdmin/feeController');
const examController = require('../controllers/student/examController');
const studentRazorpayCtrl = require('../controllers/student/razorpayController');
const timetableController = require('../controllers/student/timetableController');
const homeworkController = require('../controllers/student/homeworkController');
const libraryController = require('../controllers/student/libraryController');
const noticesController = require('../controllers/student/noticesController');
const leaveController = require('../controllers/leaveController');
const calendarCtrl = require('../controllers/student/calendarController');
const transportCtrl = require('../controllers/student/transportController');
const certificateController = require('../controllers/student/certificateController');


router.use((req, res, next) => {
    res.locals.layout = 'student/layout';
    const originalRender = res.render;
    res.render = function (view, options, fn) {
        if (typeof options === 'function') {
            fn = options;
            options = { layout: 'student/layout' };
        } else if (typeof options === 'object') {
            options.layout = options.layout !== undefined ? options.layout : 'student/layout';
        } else {
            options = { layout: 'student/layout' };
        }
        originalRender.call(this, view, options, fn);
    };
    next();
});

router.get('/dashboard', studentPortalAccess, dashboardController.dashboard);

router.get('/profile', studentPortalAccess, profileController.viewProfile);
router.post('/profile', studentPortalAccess, profileController.updateProfile);

router.get('/attendance', studentPortalAccess, attendanceController.myAttendance);

router.get('/fees', studentPortalAccess, feeCtrl.getStudentFeeView);
router.post('/fees/razorpay/order', studentPortalAccess, studentRazorpayCtrl.createOrder);
router.post('/fees/razorpay/qr/:paymentId', studentPortalAccess, studentRazorpayCtrl.generateQRCode);

router.get('/results', studentPortalAccess, examController.myResults);
router.get('/exams/schedule', studentPortalAccess, examController.myExamSchedule);
router.get('/examSchedule', studentPortalAccess, examController.myExamSchedule);
router.get('/marks', studentPortalAccess, examController.myMarks);

router.get('/timetable', studentPortalAccess, timetableController.myTimetable);

router.get('/homework', studentPortalAccess, homeworkController.myHomework);
router.post('/homework/seen', studentPortalAccess, homeworkController.markHomeworkSeen);
router.post('/homework/submit', studentPortalAccess, homeworkController.submitHomework);

router.get('/library', studentPortalAccess, libraryController.myBooks);

router.get('/notices', studentPortalAccess, noticesController.myNotices);

router.get('/leaves', studentPortalAccess, leaveController.getLeaves);
router.post('/leaves/apply', studentPortalAccess, leaveController.applyLeave);

router.get('/academic-calendar', studentPortalAccess, calendarCtrl.showCalendar);
router.get('/api/academic-events', studentPortalAccess, calendarCtrl.getEvents);

router.get('/transport', studentPortalAccess, transportCtrl.trackBus);
router.get('/transport/location/latest', studentPortalAccess, (req, res) => {
    const gpsController = require('../controllers/gpsController');
    return gpsController.getStudentBusLocation(req, res);
});

router.get('/certificates', studentPortalAccess, certificateController.myCertificates);
router.get('/certificates/:id/download', studentPortalAccess, certificateController.downloadMyCertificate);

module.exports = router;