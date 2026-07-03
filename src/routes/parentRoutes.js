const express = require('express');
const router = express.Router();
const { verifyToken, isParent } = require('../middleware/auth');
const { requireParentPortal } = require('../middleware/portalAccess');
const parentController = require('../controllers/parent/parentController');
const razorpayController = require('../controllers/parent/razorpayController');

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
        }
        originalRender.call(this, view, options, fn);
    };
    next();
});

// Portal Core Routes
const parentPortalAccess = [verifyToken, isParent, requireParentPortal];

router.get('/dashboard', parentPortalAccess, parentController.getDashboard);
router.get('/attendance', parentPortalAccess, parentController.getAttendance);
router.get('/fees', parentPortalAccess, parentController.getFees);
router.post('/fees/razorpay/order', parentPortalAccess, razorpayController.createOrder);
router.post('/fees/razorpay/qr/:paymentId', parentPortalAccess, razorpayController.generateQRCode);
router.get('/homework', parentPortalAccess, parentController.getHomework);
router.get('/notices', parentPortalAccess, parentController.getNotices);
router.get('/transport', parentPortalAccess, parentController.getTransport);
router.get('/results', parentPortalAccess, parentController.getResults);

module.exports = router;
