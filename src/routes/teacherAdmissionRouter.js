const express = require('express');
const router = express.Router();
const { verifyToken, isSchoolAdmin } = require('../middleware/auth');
const teacherAdmissionCtrl = require('../controllers/schoolAdmin/teacherAdmissionController');
const { teacherUpload, driverUpload } = require('../middleware/upload');
const { makeAdmissionLimiter } = require('../middleware/rateLimit');

router.get('/admission/teacher', teacherAdmissionCtrl.showTeacherForm);
router.post('/admission/teacher/submit',
    teacherUpload.fields([
        { name: "photo", maxCount: 1 }, 
        { name: "documents", maxCount: 10 }
    ]),
    makeAdmissionLimiter((req) => `/admission/teacher?token=${encodeURIComponent(req.body.token || '')}&school=${encodeURIComponent(req.body.school_id || '')}`),
    teacherAdmissionCtrl.submitTeacherForm
);

router.get('/admin/teachers/applications', verifyToken, isSchoolAdmin, teacherAdmissionCtrl.listTeacherApplications);
router.post('/admin/teachers/applications/:id/approve', verifyToken, isSchoolAdmin, teacherAdmissionCtrl.approveTeacherApplication);
router.post('/admin/teachers/applications/:id/reject', verifyToken, isSchoolAdmin, teacherAdmissionCtrl.rejectTeacherApplication);

router.post('/schooladmin/admissions/teachers/qr/generate', verifyToken, isSchoolAdmin, teacherAdmissionCtrl.generateTeacherQR);

router.get('/admission/driver', teacherAdmissionCtrl.showDriverForm);
router.post('/admission/driver/submit',
    driverUpload.fields([
        { name: "photo", maxCount: 1 },
        { name: "license_document", maxCount: 1 },
        { name: "aadhaar_document", maxCount: 1 }
    ]),
    makeAdmissionLimiter((req) => `/admission/driver?token=${encodeURIComponent(req.body.token || '')}&school=${encodeURIComponent(req.body.school_id || '')}`),
    teacherAdmissionCtrl.submitDriverForm
);
router.get('/admin/drivers/applications', verifyToken, isSchoolAdmin, teacherAdmissionCtrl.listDriverApplications);
router.post('/admin/drivers/applications/:id/approve', verifyToken, isSchoolAdmin, teacherAdmissionCtrl.approveDriverApplication);
router.post('/admin/drivers/applications/:id/reject', verifyToken, isSchoolAdmin, teacherAdmissionCtrl.rejectDriverApplication);
router.post('/schooladmin/admissions/drivers/qr/generate', verifyToken, isSchoolAdmin, teacherAdmissionCtrl.generateDriverQR);

module.exports = router;