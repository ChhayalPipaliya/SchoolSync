const express = require('express');
const router = express.Router();
const { verifyToken, isParent } = require('../middleware/auth');
const { requireParentPortal } = require('../middleware/portalAccess');
const parentController = require('../controllers/parent/parentController');
const razorpayController = require('../controllers/parent/razorpayController');
const ptmController = require('../controllers/parent/ptmController');
const parentChildContext = require('../middleware/parentChildContext');
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
router.get('/attendance', parentController.getAttendance);
router.get('/fees', parentController.getFees);
router.get('/fees/receipts/:paymentId', parentController.getReceipt);
router.post('/fees/razorpay/order', razorpayController.createOrder);
router.post('/fees/razorpay/qr/:paymentId', razorpayController.generateQRCode);
router.get('/homework', parentController.getHomework);
router.get('/timetable', parentController.getTimetable);
router.get('/library', parentController.getLibrary);
router.get('/certificates', parentController.getCertificates);
router.get('/notices', parentController.getNotices);
router.get('/transport', parentController.getTransport);
router.get('/transport/live', parentController.getTransport);
router.get('/transport/location/latest', parentController.getLatestLocation);

router.get('/child-bus/location', (req, res) => {
    const gpsController = require('../controllers/gpsController');
    return gpsController.getParentChildBusLocation(req, res);
});

router.get('/my-child-bus', async (req, res) => {
    try {
        const db = require('../config/database');
        const { getStudentTransportViewModel } = require('../utils/transportProViewModel');
        const { getLinkedChildren } = require('../services/parentStudentService');

        const schoolId = req.user.school_id;
        const children = await getLinkedChildren({ parentUserId: req.user.id, schoolId });
        let selectedId = req.query.studentId || req.session?.selectedStudentId;
        const activeChild = children.find(c => c.id == selectedId) || children[0];

        if (!activeChild) {
            req.flash('error', 'No linked child found');
            return res.redirect('/parent/dashboard');
        }
        req.session.selectedStudentId = activeChild.id;

        let activeTrip = null;
        const [trips] = await db.query(
            `SELECT tt.id AS trip_id, tt.status AS trip_status, r.route_name AS routeName,
                u.first_name AS driver_first_name, u.last_name AS driver_last_name, u.phone AS driver_phone,
                v.vehicle_number AS vehicleNumber, v.model AS vehicleModel
            FROM students s
            JOIN student_transport_allocations sta ON sta.student_id = s.id AND sta.school_id = s.school_id AND sta.status = 'active'
            JOIN transport_trips tt ON tt.route_id = sta.route_id AND tt.school_id = sta.school_id AND tt.status = 'running'
            JOIN routes r ON tt.route_id = r.id AND r.school_id = tt.school_id
            LEFT JOIN drivers d ON tt.driver_id = d.id AND d.school_id = tt.school_id
            LEFT JOIN users u ON d.user_id = u.id
            LEFT JOIN vehicles v ON tt.vehicle_id = v.id AND v.school_id = tt.school_id
            WHERE s.id = ? AND s.school_id = ?
            ORDER BY tt.id DESC LIMIT 1`,
            [activeChild.id, schoolId]
        );
        activeTrip = trips[0] || null;

        const transportInfo = await getStudentTransportViewModel(schoolId, activeChild.id);

        return res.render('parent/myChildBus', {
            title: "My Child's Bus — Live Tracking",
            children,
            activeChild,
            activeTrip,
            activeStudentId: activeChild.id,
            transportInfo,
            user: req.user,
            layout: 'parent/layout',
            currentPath: '/parent/my-child-bus'
        });
    } catch (err) {
        console.error('[Parent myChildBus Error]:', err);
        req.flash('error', 'Failed to load child bus tracker');
        return res.redirect('/parent/transport');
    }
});


router.get('/results', parentController.getResults);

router.get('/ptm', ptmController.getPTMPage);
router.get('/ptm/api/teachers', ptmController.getTeachers);
router.get('/ptm/api/slots', ptmController.getAvailableSlots);

router.get('/academic-calendar', calendarCtrl.showCalendar);
router.get('/api/academic-events', calendarCtrl.getEvents);

router.post('/ptm/book', ptmController.bookSlot);
router.post('/ptm/bookings/cancel/:id', ptmController.cancelBooking);

module.exports = router;