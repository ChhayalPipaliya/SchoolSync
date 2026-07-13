const express = require('express');
const router = express.Router();
const { verifyToken, isParent } = require('../middleware/auth');
const { requireParentPortal } = require('../middleware/portalAccess');
const parentController = require('../controllers/parent/parentController');
const razorpayController = require('../controllers/parent/razorpayController');
const parentChildContext = require('../middleware/parentChildContext');
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
router.get('/results', parentController.getResults);

module.exports = router;
