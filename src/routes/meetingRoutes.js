const express = require('express');
const router = express.Router();
const { verifyToken, tenantIsolation, isSchoolAdmin, isTeacher, isStudent, isParent, isDriver, isLibrarian } = require('../middleware/auth');
const { subscriptionGuard } = require('../middleware/subscriptionGuard');
const { listSchoolAdminMeetings, renderCreateForm, createMeeting, renderEditForm, updateMeeting, cancelMeeting, renderSchoolAdminDetails, listParticipantMeetings,
  renderParticipantDetails, joinMeeting, heartbeat, leave, renderAttendanceReport, saveMeetingNotes, saveRecordingLink, exportAttendancePDF, confirmAttendance,
  getMeetingStats} = require('../controllers/meetingController');
const { authorizeMeeting, authorizeMeetingView, authorizeMeetingTracking } = require('../middleware/meetingAuth');

const setDynamicLayout = (req, res, next) => {
    const path = req.path.toLowerCase();
    if (path.startsWith('/schooladmin')) {
        res.locals.layout = false;
    } else if (path.startsWith('/teacher')) {
        res.locals.layout = 'teacher/layout';
    } else if (path.startsWith('/student')) {
        res.locals.layout = 'student/layout';
    } else if (path.startsWith('/parent')) {
        res.locals.layout = 'parent/layout';
    } else if (path.startsWith('/driver')) {
        res.locals.layout = 'driver/layout';
    } else if (path.startsWith('/librarian')) {
        res.locals.layout = 'librarian/layout';
    } else {
        res.locals.layout = false;
    }
    next();
};

router.use(verifyToken);
router.use(tenantIsolation);
router.use(subscriptionGuard);
router.use(setDynamicLayout);

router.get('/schooladmin/meetings', isSchoolAdmin, listSchoolAdminMeetings);
router.get('/schooladmin/meetings/create', isSchoolAdmin, renderCreateForm);
router.post('/schooladmin/meetings', isSchoolAdmin, createMeeting);
router.get('/schooladmin/meetings/:id', isSchoolAdmin, authorizeMeetingView, renderSchoolAdminDetails);
router.get('/schooladmin/meetings/:id/edit', isSchoolAdmin, renderEditForm);
router.post('/schooladmin/meetings/:id/edit', isSchoolAdmin, updateMeeting);
router.post('/schooladmin/meetings/:id/cancel', isSchoolAdmin, cancelMeeting);
router.get('/schooladmin/meetings/:id/join', isSchoolAdmin, authorizeMeeting, joinMeeting);
router.get('/schooladmin/meetings/:id/attendance-report', isSchoolAdmin, authorizeMeetingView, renderAttendanceReport);

// Meeting Notes (JSON)
router.post(
  '/schooladmin/meetings/:id/notes',
  isSchoolAdmin,
  saveMeetingNotes
);

// Recording Link (JSON)
router.post(
  '/schooladmin/meetings/:id/recording',
  isSchoolAdmin,
  saveRecordingLink
);

// Attendance PDF Export
router.get(
  '/schooladmin/meetings/:id/attendance-report/pdf',
  isSchoolAdmin,
  exportAttendancePDF
);

// Meeting Stats API
router.get(
  '/schooladmin/api/meetings/stats',
  isSchoolAdmin,
  getMeetingStats
);

// Confirm Attendance (all participant roles)
// This route is hit by teacher, student, driver, librarian, parent
// verifyToken is already applied globally in this router via router.use(verifyToken)
router.post(
  '/api/meetings/:id/confirm-attendance',
  authorizeMeetingTracking,
  confirmAttendance
);

// ── Participant Panel Routes ────────────────────────────────────────────────
// Teacher
router.get('/teacher/meetings', isTeacher, listParticipantMeetings);
router.get('/teacher/meetings/:id', isTeacher, authorizeMeetingView, renderParticipantDetails);
router.get('/teacher/meetings/:id/join', isTeacher, authorizeMeeting, joinMeeting);

// Student
router.get('/student/meetings', isStudent, listParticipantMeetings);
router.get('/student/meetings/:id', isStudent, authorizeMeetingView, renderParticipantDetails);
router.get('/student/meetings/:id/join', isStudent, authorizeMeeting, joinMeeting);

// Parent
router.get('/parent/meetings', isParent, listParticipantMeetings);
router.get('/parent/meetings/:id', isParent, authorizeMeetingView, renderParticipantDetails);
router.get('/parent/meetings/:id/join', isParent, authorizeMeeting, joinMeeting);

// Driver
router.get('/driver/meetings', isDriver, listParticipantMeetings);
router.get('/driver/meetings/:id', isDriver, authorizeMeetingView, renderParticipantDetails);
router.get('/driver/meetings/:id/join', isDriver, authorizeMeeting, joinMeeting);

// Librarian
router.get('/librarian/meetings', isLibrarian, listParticipantMeetings);
router.get('/librarian/meetings/:id', isLibrarian, authorizeMeetingView, renderParticipantDetails);
router.get('/librarian/meetings/:id/join', isLibrarian, authorizeMeeting, joinMeeting);

// ── Action Redirect & Heartbeat Tracker APIs ────────────────────────────────
router.get('/meetings/:id/join', authorizeMeeting, joinMeeting);
router.post('/api/meetings/:id/heartbeat', authorizeMeetingTracking, heartbeat);
router.post('/api/meetings/:id/leave', authorizeMeetingTracking, leave);

module.exports = router;
