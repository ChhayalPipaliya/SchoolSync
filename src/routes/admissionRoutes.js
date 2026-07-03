const express = require('express');
const router = express.Router();
const admissionCtrl = require('../controllers/schoolAdmin/admissionController');
const { studentUpload } = require('../middleware/upload');
const { makeAdmissionLimiter } = require('../middleware/rateLimit');

// Limiter runs BEFORE the multer upload middleware so file writes to disk
// are also throttled, not just the DB insert at the end of the chain.
router.get('/student', admissionCtrl.showStudentForm);
router.post('/student',
    // multer must run first — req.body (token/school_id hidden fields) is only
    // populated after multipart parsing. Per-file size is already capped
    // (MAX_FILE_SIZE_MB in upload.js), so the limiter here still bounds total
    // request/DB-write volume even though it can't pre-empt the file parse itself.
    studentUpload.fields([
        { name: 'student_image', maxCount: 1 },
        { name: 'father_image', maxCount: 1 },
        { name: 'mother_image', maxCount: 1 },
        { name: 'birth_certificate', maxCount: 1 },
        { name: 'aadhaar_card', maxCount: 1 },
        { name: 'leaving_certificate', maxCount: 1 },
        { name: 'previous_marksheet', maxCount: 1 }
    ]),
    // token/school_id live in the POST body (hidden fields from the QR link), not
    // the query string — redirectTo must rebuild the querystring or showStudentForm
    // will treat the redirect as an invalid/expired link instead of showing the form.
    makeAdmissionLimiter((req) => `/admission/student?token=${encodeURIComponent(req.body.token || '')}&school=${encodeURIComponent(req.body.school_id || '')}`),
    admissionCtrl.submitStudentForm
);

module.exports = router;
