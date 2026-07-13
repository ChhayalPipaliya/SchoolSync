const express = require('express');
const router = express.Router();
const admissionCtrl = require('../controllers/schoolAdmin/admissionController');
const { studentUpload } = require('../middleware/upload');
const { makeAdmissionLimiter } = require('../middleware/rateLimit');

router.get('/student', admissionCtrl.showStudentForm);
router.post('/student',
    studentUpload.fields([
        { name: 'student_image', maxCount: 1 },
        { name: 'father_image', maxCount: 1 },
        { name: 'mother_image', maxCount: 1 },
        { name: 'birth_certificate', maxCount: 1 },
        { name: 'aadhaar_card', maxCount: 1 },
        { name: 'leaving_certificate', maxCount: 1 },
        { name: 'previous_marksheet', maxCount: 1 }
    ]),
    makeAdmissionLimiter((req) => `/admission/student?token=${encodeURIComponent(req.body.token || '')}&school=${encodeURIComponent(req.body.school_id || '')}`),
    admissionCtrl.submitStudentForm
);

module.exports = router;