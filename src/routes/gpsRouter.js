const express = require('express');
const router = express.Router();
const gpsController = require('../controllers/gpsController');
const { verifyToken, isDriver, isSchoolAdmin, isStudent, isParent } = require('../middleware/auth');

router.post('/api/gps/location', verifyToken, isDriver, gpsController.updateLocation);
router.post('/api/gps/hardware', gpsController.updateHardwareLocation);
router.get('/api/gps/live-buses', verifyToken, isSchoolAdmin, gpsController.getLiveBuses);
router.get('/api/gps/trip/:tripId/route', verifyToken, gpsController.getTripRoute);
router.get('/api/gps/my-bus', verifyToken, gpsController.getParentBusLocation);

router.get('/api/gps/student/my-bus', verifyToken, isStudent, gpsController.getStudentBusLocation);

router.get('/api/gps/parent/child-bus', verifyToken, isParent, gpsController.getParentChildBusLocation);

router.get('/schooladmin/drivers/live-map', verifyToken, isSchoolAdmin, gpsController.getSchoolAdminLiveMap);

module.exports = router;