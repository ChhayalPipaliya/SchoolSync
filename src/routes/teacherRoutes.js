const express = require('express');
const router = express.Router();
const { isTeacher, verifyToken } = require('../middleware/auth');
const { subscriptionGuard } = require('../middleware/subscriptionGuard');
const { teacherUpload } = require('../middleware/upload');
const dashboardCtrl = require('../controllers/teacher/dashboardController');
const profileCtrl = require('../controllers/teacher/profileController');
const attendanceCtrl = require('../controllers/teacher/attendanceController');
const homeworkCtrl = require('../controllers/teacher/homeworkController');
const marksCtrl = require('../controllers/teacher/marksController');
const studentCtrl = require('../controllers/teacher/studentController');
const timetableCtrl = require('../controllers/teacher/timetableController');
const noticesCtrl = require('../controllers/teacher/noticesController');
const calendarCtrl = require('../controllers/teacher/calendarController');
const chatController = require('../controllers/chatController');
const leaveController = require('../controllers/leaveController');
const ptmCtrl = require('../controllers/teacher/ptmController');
const paySlipController = require('../controllers/paySlipController');

router.use((req, res, next) => {
    res.locals.layout = "teacher/layout";
    const originalRender = res.render;
    res.render = function(view, options, fn) {
        if (typeof options === 'function') {
            fn = options;
            options = { layout: 'teacher/layout' };
        } else if (typeof options === 'object') {
            options.layout = options.layout !== undefined ? options.layout : 'teacher/layout';
        } else {
            options = { layout: 'teacher/layout' };
        }
        originalRender.call(this, view, options, fn);
    };
    next();
});

router.get('/dashboard', verifyToken, isTeacher, dashboardCtrl.getDashboard);

router.get('/profile', verifyToken, isTeacher, profileCtrl.getProfile);
router.get('/profile/stats', verifyToken, isTeacher, profileCtrl.getProfileStats);
router.get('/profile/download', verifyToken, isTeacher, profileCtrl.downloadProfile);
router.post('/profile/update', verifyToken, isTeacher, profileCtrl.updateProfile);
router.post('/profile/experience/add', verifyToken, isTeacher, profileCtrl.addExperience);
router.post('/profile/experience/delete/:id', verifyToken, isTeacher, profileCtrl.deleteExperience);
router.post('/profile/document/upload', verifyToken, isTeacher, teacherUpload.single('document'), profileCtrl.uploadDocument);
router.post('/profile/document/delete/:id', verifyToken, isTeacher, profileCtrl.deleteDocument);

router.get('/attendance', verifyToken, isTeacher, subscriptionGuard, attendanceCtrl.getMarkAttendance);
router.post('/attendance/mark', verifyToken, isTeacher, subscriptionGuard, attendanceCtrl.postMarkAttendance);
router.get('/attendance/monthly', verifyToken, isTeacher, subscriptionGuard, attendanceCtrl.teacherMonthlyReport);

router.get('/homework', verifyToken, isTeacher, homeworkCtrl.getHomework);
router.post('/homework', verifyToken, isTeacher, teacherUpload.single('attachment'), homeworkCtrl.createHomework);

router.get('/homework/:id', verifyToken, isTeacher, homeworkCtrl.getHomeworkDetails);
router.get('/homework/:id/submissions', verifyToken, isTeacher, homeworkCtrl.getHomeworkSubmissions);
router.post('/homework/:id/check', verifyToken, isTeacher, homeworkCtrl.postCheckHomework);
router.get('/homework/:id/export/:format', verifyToken, isTeacher, homeworkCtrl.exportHomeworkReport);
router.post('/homework/:id/close', verifyToken, isTeacher, homeworkCtrl.closeHomework);
router.post('/homework/:id/delete', verifyToken, isTeacher, homeworkCtrl.deleteHomework);
router.post('/homework/delete/:id', verifyToken, isTeacher, homeworkCtrl.deleteHomework);
router.get('/homework/submission/:submissionId/download', verifyToken, isTeacher, homeworkCtrl.downloadSubmission);

router.get('/marks', verifyToken, isTeacher, marksCtrl.getEnterMarks);
router.post('/marks/enter', verifyToken, isTeacher, marksCtrl.postEnterMarks);
router.get('/exams', verifyToken, isTeacher, marksCtrl.getMyExams);
router.get('/exams/create', verifyToken, isTeacher, marksCtrl.getCreateExam);
router.post('/exams/create', verifyToken, isTeacher, marksCtrl.postCreateExam);
router.get('/marks/analysis', verifyToken, isTeacher, marksCtrl.getResultAnalysis);

router.get('/students', verifyToken, isTeacher, studentCtrl.getMyStudents);
router.get('/students/:id/progress', verifyToken, isTeacher, studentCtrl.getStudentProgress);

router.get('/timetable', verifyToken, isTeacher, timetableCtrl.myTimetable);

router.get('/notices', verifyToken, isTeacher, noticesCtrl.getNotices);
router.post('/notices', verifyToken, isTeacher, teacherUpload.single('attachment'), noticesCtrl.createNotice);
router.post('/notices/:id/delete', verifyToken, isTeacher, noticesCtrl.deleteNotice);

router.get('/academic-calendar', verifyToken, isTeacher, calendarCtrl.showCalendar);
router.get('/api/academic-events', verifyToken, isTeacher, calendarCtrl.getEvents);
router.post('/api/academic-events', verifyToken, isTeacher, calendarCtrl.suggestEvent);
router.delete('/api/academic-events/:id', verifyToken, isTeacher, calendarCtrl.deleteSuggestedEvent);

router.get('/leaves', verifyToken, isTeacher, leaveController.getLeaves);
router.post('/leaves/apply', verifyToken, isTeacher, leaveController.applyLeave);

router.get('/chat', verifyToken, isTeacher, chatController.getChatPage);
router.get('/chat/history/:receiverId', verifyToken, isTeacher, chatController.getChatHistory);
router.post('/chat/send', verifyToken, isTeacher, chatController.sendMessage);
router.delete('/chat/message/:messageId', verifyToken, isTeacher, chatController.deleteMessage);
router.get('/chat/search', verifyToken, isTeacher, chatController.searchMessages);
router.get('/api/chat/unread-count', verifyToken, isTeacher, chatController.getUnreadCount);
router.post('/chat/mark-all-read', verifyToken, isTeacher, chatController.markAllRead);

router.get('/ptm', verifyToken, isTeacher, ptmCtrl.getPTMPage);
router.post('/ptm/slots/generate', verifyToken, isTeacher, ptmCtrl.generateSlots);
router.post('/ptm/slots/delete/:id', verifyToken, isTeacher, ptmCtrl.deleteSlot);
router.post('/ptm/bookings/cancel/:id', verifyToken, isTeacher, ptmCtrl.cancelBooking);

router.get('/payslips', verifyToken, isTeacher, paySlipController.myPayslips);
router.get('/payslips/:id/download', verifyToken, isTeacher, paySlipController.downloadMyPayslip);

module.exports = router;