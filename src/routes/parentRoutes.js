const express = require('express');
const router = express.Router();
const { verifyToken, isParent } = require('../middleware/auth');
const { requireParentPortal } = require('../middleware/portalAccess');
const parentController = require('../controllers/parent/parentController');
const razorpayController = require('../controllers/parent/razorpayController');
const ptmController = require('../controllers/parent/ptmController');
const leaveController = require('../controllers/parent/leaveController');
const parentChildContext = require('../middleware/parentChildContext');
const { subscriptionGuard } = require('../middleware/subscriptionGuard');
const calendarCtrl = require('../controllers/student/calendarController');
const parentPortalAccess = [verifyToken, isParent, requireParentPortal];

router.use((req, res, next) => {
    res.locals.layout = 'parent/layout';
    const originalRender = res.render;
    res.render = function(view, options, fn) {
        if (typeof options === 'function') {
            fn = options;
            options = { layout: 'parent/layout' };
        } else if (typeof options === 'object') {
            options.layout = options.layout !== undefined ? options.layout : 'parent/layout';
        } else {
            options = { layout: 'parent/layout' };
        };
        originalRender.call(this, view, options, fn);
    };
    next();
});

router.use(parentPortalAccess, parentChildContext);
router.get('/dashboard', parentController.getDashboard);
router.post('/children/switch', parentController.switchChild);
router.get('/profile', parentController.getProfile);
router.get('/attendance', subscriptionGuard, parentController.getAttendance);
router.get('/fees', parentController.getFees);
router.get('/fees/receipts/:paymentId', parentController.getReceipt);
router.get('/fees/payment/:paymentId/status', razorpayController.getPaymentStatus);
router.post('/fees/razorpay/order', razorpayController.createOrder);
router.post('/fees/razorpay/qr/:paymentId', razorpayController.generateQRCode);
router.post('/fees/school-qr/initiate', razorpayController.initiateSchoolQrPayment);
router.post('/fees/school-qr/submit', require('../middleware/upload').settingsUpload.single('proof_image'), razorpayController.submitSchoolQrPayment);
router.get('/homework', parentController.getHomework);
router.get('/timetable', parentController.getTimetable);
router.get('/library', parentController.getLibrary);
router.get('/certificates', parentController.getCertificates);
router.get('/leaves', leaveController.getLeaves);
router.post('/leaves/apply', leaveController.applyLeave);
router.get('/notices', parentController.getNotices);
router.get('/transport', parentController.getTransport);
router.get('/transport/live', parentController.getTransport);
router.get('/transport/location/latest', parentController.getLatestLocation);
router.post('/transport/absence', parentController.notifyBusAbsence);

router.get('/child-bus/location', (req, res) => {
    const gpsController = require('../controllers/gpsController');
    return gpsController.getParentChildBusLocation(req, res);
});

router.get('/results', parentController.getResults);

router.get('/ptm', ptmController.getPTMPage);
router.get('/ptm/api/teachers', ptmController.getTeachers);
router.get('/ptm/api/slots', ptmController.getAvailableSlots);

router.get('/academic-calendar', calendarCtrl.showCalendar);
router.get('/api/academic-events', calendarCtrl.getEvents);
router.post('/api/academic-events', calendarCtrl.suggestEvent);
router.delete('/api/academic-events/:id', calendarCtrl.deleteSuggestedEvent);

router.post('/ptm/book', ptmController.bookSlot);
router.post('/ptm/bookings/cancel/:id', ptmController.cancelBooking);

module.exports = router;