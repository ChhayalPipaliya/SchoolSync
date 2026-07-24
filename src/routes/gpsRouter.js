const express = require('express');
const router = express.Router();
const gpsController = require('../controllers/gpsController');
const { verifyToken, isDriver, isSchoolAdmin } = require('../middleware/auth');

router.post('/api/gps/location', verifyToken, isDriver, gpsController.updateLocation);
router.get('/api/gps/live-buses', verifyToken, isSchoolAdmin, gpsController.getLiveBuses);
router.get('/api/gps/trip/:tripId/route', verifyToken, gpsController.getTripRoute);
router.get('/api/gps/my-bus', verifyToken, gpsController.getParentBusLocation);
router.get('/schooladmin/drivers/live-map', verifyToken, isSchoolAdmin, gpsController.getSchoolAdminLiveMap);

module.exports = router;