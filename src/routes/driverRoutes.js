const express = require("express");
const router = express.Router();
const dashboardCtrl = require("../controllers/driver/dashboardController");
const profileCtrl = require("../controllers/driver/profileController");
const routeCtrl = require("../controllers/driver/routeController");
const attendanceCtrl = require("../controllers/driver/attendanceController");
const vehicleCtrl = require("../controllers/driver/vehicleController");
const leaveController = require('../controllers/leaveController');
const chatController = require('../controllers/chatController');
const { sosLimiter } = require('../middleware/rateLimit');

const { verifyToken, isDriver } = require("../middleware/auth");

router.use((req, res, next) => {
    res.locals.layout = "driver/layout";
    const originalRender = res.render;
    res.render = function (view, options, fn) {
        if (typeof options === 'function') {
            fn = options;
            options = { layout: 'driver/layout' };
        } else if (typeof options === 'object') {
            options.layout = options.layout !== undefined ? options.layout : 'driver/layout';
        } else {
            options = { layout: 'driver/layout' };
        };
        originalRender.call(this, view, options, fn);
    };
    next();
});

router.get("/dashboard", verifyToken, isDriver, dashboardCtrl.dashboard);
router.get("/live-trip", verifyToken, isDriver, (req, res, next) => {
    res.locals.currentPath = "/driver/live-trip";
    next();
}, dashboardCtrl.liveTrip);
router.get("/transport/live-trip", verifyToken, isDriver, (req, res, next) => {
    res.locals.currentPath = "/driver/live-trip";
    next();
}, dashboardCtrl.liveTrip);

router.post("/transport/trip/start", verifyToken, isDriver, dashboardCtrl.startTrip);
router.post("/transport/trip/end", verifyToken, isDriver, dashboardCtrl.endTrip);
router.post("/transport/student/:studentId/status", verifyToken, isDriver, dashboardCtrl.markStudentStatusNoTripId);

router.get("/students", verifyToken, isDriver, dashboardCtrl.studentsList);
router.get("/notices", verifyToken, isDriver, dashboardCtrl.notices);

router.get("/my_route", verifyToken, isDriver, routeCtrl.myRoute);

router.get("/attendance", verifyToken, isDriver, attendanceCtrl.attendancePage);

router.get("/profile", verifyToken, isDriver, profileCtrl.profilePage);
router.post("/profile/update", verifyToken, isDriver, profileCtrl.updateProfile);

router.get("/vehicle", verifyToken, isDriver, vehicleCtrl.vehicleChecklist);
router.post("/vehicle/checklist", verifyToken, isDriver, vehicleCtrl.saveChecklist);

router.post("/trips/start", verifyToken, isDriver, dashboardCtrl.startTrip);
router.post("/trips/end", verifyToken, isDriver, (req, res) => {
    if (!req.params.tripId && req.body.trip_id) req.params.tripId = req.body.trip_id;
    return dashboardCtrl.endTrip(req, res);
});
router.post("/trips/:tripId/end", verifyToken, isDriver, dashboardCtrl.endTrip);
router.post("/trips/:tripId/students/:studentId/mark", verifyToken, isDriver, dashboardCtrl.markStudentEvent);
router.post("/trips/:tripId/students/:studentId/status", verifyToken, isDriver, dashboardCtrl.markTransportTripStudent);
router.post("/students/:studentId/board", verifyToken, isDriver, dashboardCtrl.boardStudent);
router.post("/students/:studentId/drop", verifyToken, isDriver, dashboardCtrl.dropStudent);
router.post("/students/:studentId/absent", verifyToken, isDriver, dashboardCtrl.absentStudent);

router.get("/transport/trips/:tripId/students", verifyToken, isDriver, dashboardCtrl.tripStudents);
router.post("/transport/trips/:tripId/students/:studentId/mark", verifyToken, isDriver, dashboardCtrl.markTransportTripStudent);
router.post("/transport/trips/:tripId/stops/mark", verifyToken, isDriver, dashboardCtrl.markStopStudents);
router.get("/transport/report-issue", verifyToken, isDriver, dashboardCtrl.reportIssueForm);
router.post("/transport/report-issue", verifyToken, isDriver, dashboardCtrl.reportIssue);

router.get('/transport/my-route', verifyToken, isDriver, (req, res) => res.redirect('/driver/my_route'));

router.get('/leaves', verifyToken, isDriver, leaveController.getLeaves);
router.post('/leaves/apply', verifyToken, isDriver, leaveController.applyLeave);

router.get("/support", verifyToken, isDriver, (req, res) => res.render("driver/support", { user: req.user }));

router.get('/chat', verifyToken, isDriver, chatController.getChatPage);
router.get('/chat/history/:receiverId', verifyToken, isDriver, chatController.getChatHistory);
router.post('/chat/send', verifyToken, isDriver, chatController.sendMessage);
router.delete('/chat/message/:messageId', verifyToken, isDriver, chatController.deleteMessage);
router.get('/chat/search', verifyToken, isDriver, chatController.searchMessages);
router.get('/api/chat/unread-count', verifyToken, isDriver, chatController.getUnreadCount);
router.post('/chat/mark-all-read', verifyToken, isDriver, chatController.markAllRead);

router.post('/sos', verifyToken, isDriver, sosLimiter, dashboardCtrl.triggerSOS);

router.post('/transport/trips/:tripId/students/:studentId/notify-parent', verifyToken, isDriver, dashboardCtrl.notifyParentOnBoard);

router.post('/transport/location', verifyToken, isDriver, dashboardCtrl.updateLocationREST);
router.post('/transport/trip/location', verifyToken, isDriver, dashboardCtrl.updateLocationREST);

module.exports = router;
