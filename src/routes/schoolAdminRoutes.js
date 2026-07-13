const express = require('express');
const router = express.Router();
const { isSchoolAdmin, verifyToken } = require('../middleware/auth');
const { studentUpload, teacherUpload, driverUpload, schoolUpload, libraryUpload, noticeUpload, settingsUpload} = require("../middleware/upload");
const { requirePlanFeature } = require('../middleware/planAccess');
const { checkStudentQuota, checkTeacherQuota, checkClassQuota } = require('../middleware/quotaCheck');
const { validateStudentAdd, validateTeacherAdd } = require('../middleware/validate');

const dashboardCtrl = require('../controllers/schoolAdmin/dashboardController');
const studentController = require('../controllers/schoolAdmin/studentController');
const teacherController = require('../controllers/schoolAdmin/teacherController');
const teacherAssignCtrl = require('../controllers/schoolAdmin/teacherAssignController');
const classCtrl = require('../controllers/schoolAdmin/classController');
const subjectCtrl = require('../controllers/schoolAdmin/subjectController');
const attendanceCtrl = require('../controllers/schoolAdmin/attendanceController');
const feeCtrl = require('../controllers/schoolAdmin/feeController');
const examCtrl = require('../controllers/schoolAdmin/examController');
const transportCtrl = require('../controllers/schoolAdmin/transportController');
const driverController = require('../controllers/schoolAdmin/driverController');
const noticeCtrl = require('../controllers/schoolAdmin/noticeController');
const reportCtrl = require('../controllers/schoolAdmin/reportController');
const settingCtrl = require('../controllers/schoolAdmin/settingController');
const librarianController = require('../controllers/schoolAdmin/librarianController');
const timetableController = require('../controllers/schoolAdmin/timetableController');
const subscriptionCtrl = require('../controllers/schoolAdmin/subscriptionController');
const admissionCtrl = require('../controllers/schoolAdmin/admissionController');
const analyticsCtrl = require('../controllers/schoolAdmin/analyticsController');
const schoolAdminRazorpayCtrl = require('../controllers/schoolAdmin/razorpayController');
const salaryCtrl = require('../controllers/schoolAdmin/salaryController');
const homeworkCtrl = require('../controllers/schoolAdmin/homeworkController');
const leaveCtrl = require('../controllers/schoolAdmin/leaveController');
const calendarCtrl = require('../controllers/schoolAdmin/calendarController');
const portalCtrl = require('../controllers/schoolAdmin/portalController');
const promotionCtrl = require('../controllers/schoolAdmin/promotionController');
const eventCtrl = require('../controllers/eventController');
const { eventUpload } = require('../middleware/eventUpload');
const mediumCtrl = require('../controllers/schoolAdmin/mediumController');
const chatController = require('../controllers/chatController');
const certCtrl = require('../controllers/schoolAdmin/certificateController');
const certFeature = requirePlanFeature('certificates');

router.get('/dashboard', verifyToken, isSchoolAdmin, dashboardCtrl.getDashboard);

router.get('/students', verifyToken, isSchoolAdmin, studentController.listStudents);
router.get('/students/unassigned', verifyToken, isSchoolAdmin, studentController.listUnassigned);
router.post('/students/:id/assign-class', verifyToken, isSchoolAdmin, studentController.assignClass);
router.get('/students/add', verifyToken, isSchoolAdmin, checkStudentQuota, studentController.showAddForm);
router.post('/students/add', verifyToken, isSchoolAdmin, checkStudentQuota, 
    studentUpload.fields([
        { name: 'student_image', maxCount: 1 },
        { name: 'father_image', maxCount: 1 },
        { name: 'mother_image', maxCount: 1 },
        { name: 'birth_certificate', maxCount: 1 },
        { name: 'aadhaar_card', maxCount: 1 },
        { name: 'leaving_certificate', maxCount: 1 },
        { name: 'previous_marksheet', maxCount: 1 }
    ]), 
    validateStudentAdd, 
    studentController.createStudent
);
router.get('/students/:id/view', verifyToken, isSchoolAdmin, studentController.viewStudent);
router.get('/students/:id/edit', verifyToken, isSchoolAdmin, studentController.showEditForm);
router.post('/students/:id/edit', verifyToken, isSchoolAdmin, studentUpload.any(), validateStudentAdd, studentController.updateStudent);
router.post('/students/:id/delete', verifyToken, isSchoolAdmin, studentController.deleteStudent);
router.get('/students/:id/id-card', verifyToken, isSchoolAdmin, studentController.generateIdCard);
router.post('/students/delete-document/:docId', verifyToken, isSchoolAdmin, studentController.deleteDocument);

router.get("/teachers", verifyToken, isSchoolAdmin, teacherController.listTeachers);
router.get("/teachers/add", verifyToken, isSchoolAdmin, checkTeacherQuota, teacherController.addpage);
router.post("/teachers/add", verifyToken, isSchoolAdmin, checkTeacherQuota, teacherUpload.fields([
    { name: "photo", maxCount: 1 },
    { name: "documents", maxCount: 10 },
    { name: "aadhaar_card", maxCount: 1 },
    { name: "qualification_certificate", maxCount: 1 },
    { name: "experience_certificate", maxCount: 1 },
    { name: "joining_letter", maxCount: 1 },
    { name: "resume", maxCount: 1 },
    { name: "pan_card", maxCount: 1 },
    { name: "other_document", maxCount: 1 }
]), validateTeacherAdd, teacherController.addTeacher);

router.get("/teachers/assignments", verifyToken, isSchoolAdmin, teacherAssignCtrl.listAssignments);
router.get("/teachers/assign", verifyToken, isSchoolAdmin, teacherAssignCtrl.assignForm);
router.post("/teachers/assign", verifyToken, isSchoolAdmin, teacherAssignCtrl.createAssignment);
router.post("/teachers/assignments/:id/edit", verifyToken, isSchoolAdmin, teacherAssignCtrl.updateAssignment);
router.post("/teachers/assignments/:id/delete", verifyToken, isSchoolAdmin, teacherAssignCtrl.deleteAssignment);
router.get("/teachers/by-class/:classId", verifyToken, isSchoolAdmin, teacherAssignCtrl.byClass);
router.get("/teachers/free", verifyToken, isSchoolAdmin, teacherAssignCtrl.freeTeachers);

router.get("/teachers/:id", verifyToken, isSchoolAdmin, teacherController.viewTeacher);
router.get("/teachers/:id/id-card", verifyToken, isSchoolAdmin, teacherController.generateIdCard);
router.get("/teachers/:id/edit", verifyToken, isSchoolAdmin, teacherController.editpage);
router.post("/teachers/:id/edit", verifyToken, isSchoolAdmin, teacherUpload.fields([
    { name: "photo", maxCount: 1 },
    { name: "documents", maxCount: 10 },
    { name: "aadhaar_card", maxCount: 1 },
    { name: "qualification_certificate", maxCount: 1 },
    { name: "experience_certificate", maxCount: 1 },
    { name: "joining_letter", maxCount: 1 },
    { name: "resume", maxCount: 1 },
    { name: "pan_card", maxCount: 1 },
    { name: "other_document", maxCount: 1 }
]), teacherController.updateTeacher);
router.put("/teachers/:id", verifyToken, isSchoolAdmin, teacherUpload.fields([
    { name: "photo", maxCount: 1 },
    { name: "documents", maxCount: 10 },
    { name: "aadhaar_card", maxCount: 1 },
    { name: "qualification_certificate", maxCount: 1 },
    { name: "experience_certificate", maxCount: 1 },
    { name: "joining_letter", maxCount: 1 },
    { name: "resume", maxCount: 1 },
    { name: "pan_card", maxCount: 1 },
    { name: "other_document", maxCount: 1 }
]), teacherController.updateTeacher);
router.post("/teachers/:id/delete", verifyToken, isSchoolAdmin, teacherController.deleteTeacher);
router.delete("/teachers/:id", verifyToken, isSchoolAdmin, teacherController.deleteTeacher);
router.post("/teachers/delete-document/:docId", verifyToken, isSchoolAdmin, teacherController.deleteDocument);
router.get("/teachers/:id/assign", verifyToken, isSchoolAdmin, teacherController.getAssignClasses);
router.post("/teachers/:id/assign", verifyToken, isSchoolAdmin, teacherController.postAssignClasses);
router.get("/teachers/:teacherId/classes", verifyToken, isSchoolAdmin, teacherAssignCtrl.teacherClasses);

router.get('/classes', verifyToken, isSchoolAdmin, classCtrl.listClasses);
router.post('/classes/add', verifyToken, isSchoolAdmin, checkClassQuota, classCtrl.addClass);
router.get('/classes/auto-generate', verifyToken, isSchoolAdmin, classCtrl.showAutoGenerateForm);
router.post('/classes/auto-generate', verifyToken, isSchoolAdmin, checkClassQuota, classCtrl.autoGenerateClasses);
router.post('/classes/delete-all', verifyToken, isSchoolAdmin, classCtrl.deleteAllClasses);
router.get('/sections/by-class/:classId', verifyToken, isSchoolAdmin, classCtrl.getSectionsByClass);
router.get('/classes/:classId/students', verifyToken, isSchoolAdmin, classCtrl.getSectionStudents);
router.get('/classes/:id/edit', verifyToken, isSchoolAdmin, classCtrl.editClassForm);
router.post('/classes/:id/edit', verifyToken, isSchoolAdmin, classCtrl.editClass);
router.post('/classes/:id/delete', verifyToken, isSchoolAdmin, classCtrl.deleteClass);

router.get('/promotions', verifyToken, isSchoolAdmin, promotionCtrl.index);
router.post('/promotions/preview', verifyToken, isSchoolAdmin, promotionCtrl.preview);
router.post('/promotions/confirm', verifyToken, isSchoolAdmin, promotionCtrl.confirm);
router.get('/promotions/history', verifyToken, isSchoolAdmin, promotionCtrl.history);
router.get('/promotions/:batchId', verifyToken, isSchoolAdmin, promotionCtrl.show);

router.get('/subjects', verifyToken, isSchoolAdmin, subjectCtrl.listSubjects);
router.post('/subjects/add', verifyToken, isSchoolAdmin, subjectCtrl.addSubject);
router.post('/subjects/:id/edit', verifyToken, isSchoolAdmin, subjectCtrl.editSubject);
router.post('/subjects/:id/delete', verifyToken, isSchoolAdmin, subjectCtrl.deleteSubject);
router.post('/subjects/assign', verifyToken, isSchoolAdmin, subjectCtrl.assignSubjectToClass);

router.get('/attendance', verifyToken, isSchoolAdmin, requirePlanFeature('attendance'), attendanceCtrl.getAttendanceIndex);
router.get('/attendance/mark', verifyToken, isSchoolAdmin, requirePlanFeature('attendance'), attendanceCtrl.getMarkAttendance);
router.post('/attendance/mark', verifyToken, isSchoolAdmin, requirePlanFeature('attendance'), attendanceCtrl.postMarkAttendance);
router.get('/attendance/report', verifyToken, isSchoolAdmin, requirePlanFeature('attendance'), attendanceCtrl.getAttendanceReport);
router.get('/attendance/calendar', verifyToken, isSchoolAdmin, requirePlanFeature('attendance'), attendanceCtrl.getCalendarView);
router.get('/attendance/defaulters', verifyToken, isSchoolAdmin, requirePlanFeature('attendance'), attendanceCtrl.getDefaulters);
router.get('/attendance/monthly', verifyToken, isSchoolAdmin, requirePlanFeature('attendance'), attendanceCtrl.monthlyReport);

router.get('/attendance/teachers/mark', verifyToken, isSchoolAdmin, requirePlanFeature('attendance'), attendanceCtrl.getMarkTeacherAttendance);
router.post('/attendance/teachers/mark', verifyToken, isSchoolAdmin, requirePlanFeature('attendance'), attendanceCtrl.postMarkTeacherAttendance);
router.get('/attendance/teachers/monthly', verifyToken, isSchoolAdmin, requirePlanFeature('attendance'), attendanceCtrl.teacherMonthlyAttendance);
router.get('/attendance/teachers', verifyToken, isSchoolAdmin, requirePlanFeature('attendance'), (req, res) => res.redirect('/schooladmin/attendance/teachers/mark'));
router.post('/attendance/teachers', verifyToken, isSchoolAdmin, requirePlanFeature('attendance'), attendanceCtrl.postMarkTeacherAttendance);

router.get('/attendance/drivers/mark', verifyToken, isSchoolAdmin, requirePlanFeature('attendance'), attendanceCtrl.getMarkDriverAttendance);
router.post('/attendance/drivers/mark', verifyToken, isSchoolAdmin, requirePlanFeature('attendance'), attendanceCtrl.postMarkDriverAttendance);
router.get('/attendance/drivers/monthly', verifyToken, isSchoolAdmin, requirePlanFeature('attendance'), attendanceCtrl.driverMonthlyAttendance);

router.get('/attendance/librarians/mark', verifyToken, isSchoolAdmin, requirePlanFeature('attendance'), attendanceCtrl.getMarkLibrarianAttendance);
router.post('/attendance/librarians/mark', verifyToken, isSchoolAdmin, requirePlanFeature('attendance'), attendanceCtrl.postMarkLibrarianAttendance);
router.get('/attendance/librarians/monthly', verifyToken, isSchoolAdmin, requirePlanFeature('attendance'), attendanceCtrl.librarianMonthlyAttendance);
router.get('/attendance/librarians', verifyToken, isSchoolAdmin, requirePlanFeature('attendance'), (req, res) => res.redirect('/schooladmin/attendance/librarians/mark'));
router.post('/attendance/librarians', verifyToken, isSchoolAdmin, requirePlanFeature('attendance'), attendanceCtrl.postMarkLibrarianAttendance);

router.get('/timetable/period-slots', verifyToken, isSchoolAdmin, timetableController.listPeriodSlots);
router.get('/timetable/period-slots/add', verifyToken, isSchoolAdmin, timetableController.addPeriodSlotForm);
router.post('/timetable/period-slots', verifyToken, isSchoolAdmin, timetableController.createPeriodSlot);
router.get('/timetable/period-slots/edit/:id', verifyToken, isSchoolAdmin, timetableController.editPeriodSlotForm);
router.post('/timetable/period-slots/edit/:id', verifyToken, isSchoolAdmin, timetableController.updatePeriodSlot);
router.post('/timetable/period-slots/delete/:id', verifyToken, isSchoolAdmin, timetableController.deletePeriodSlot);
router.get('/timetable/classes/:classId/subjects', verifyToken, isSchoolAdmin, timetableController.getClassSubjectsJson);
router.get('/timetable/classes/:classId/subjects/:subjectId/teachers', verifyToken, isSchoolAdmin, timetableController.getClassSubjectTeachersJson);
router.get('/timetable', verifyToken, isSchoolAdmin, timetableController.viewTimetable);
router.post('/timetable/save', verifyToken, isSchoolAdmin, timetableController.saveTimetableEntry);
router.post('/timetable/delete/:id', verifyToken, isSchoolAdmin, timetableController.deleteTimetableEntry);

router.get('/fees', verifyToken, isSchoolAdmin, requirePlanFeature('fees'), feeCtrl.listFees);
router.get('/fees/structure', verifyToken, isSchoolAdmin, requirePlanFeature('fees'), feeCtrl.getFeeStructure);
router.get('/fees/structures', verifyToken, isSchoolAdmin, requirePlanFeature('fees'), (req, res) => res.redirect('/schooladmin/fees/structure'));
router.post('/fees/structure', verifyToken, isSchoolAdmin, requirePlanFeature('fees'), feeCtrl.saveFeeStructure);
router.get('/fees/add', verifyToken, isSchoolAdmin, requirePlanFeature('fees'), feeCtrl.showAddForm);
router.post('/fees/add', verifyToken, isSchoolAdmin, requirePlanFeature('fees'), feeCtrl.createFee);
router.get('/fees/dashboard', verifyToken, isSchoolAdmin, requirePlanFeature('fees'), feeCtrl.getDashboard);
router.post('/fees/:id/waiver', verifyToken, isSchoolAdmin, requirePlanFeature('fees'), feeCtrl.applyFeeWaiver);
router.post('/fees/calculate-late-fees', verifyToken, isSchoolAdmin, requirePlanFeature('fees'), feeCtrl.calculateLateFees);
router.get('/fees/export', verifyToken, isSchoolAdmin, requirePlanFeature('fees'), feeCtrl.exportFeeReport);
router.get('/fees/:id/edit', verifyToken, isSchoolAdmin, requirePlanFeature('fees'), feeCtrl.showEditForm);
router.post('/fees/:id/edit', verifyToken, isSchoolAdmin, requirePlanFeature('fees'), feeCtrl.updateFee);
router.get('/fees/generate', verifyToken, isSchoolAdmin, requirePlanFeature('fees'), feeCtrl.showGenerateForm);
router.post('/fees/generate', verifyToken, isSchoolAdmin, requirePlanFeature('fees'), feeCtrl.generateFee);
router.get('/fees/bulk-generate', verifyToken, isSchoolAdmin, requirePlanFeature('fees'), feeCtrl.showBulkGenerateForm);
router.post('/fees/bulk-generate', verifyToken, isSchoolAdmin, requirePlanFeature('fees'), feeCtrl.bulkGenerateFee);
router.get('/fees/collect', verifyToken, isSchoolAdmin, requirePlanFeature('fees'), feeCtrl.getCollectFee);
router.post('/fees/collect', verifyToken, isSchoolAdmin, requirePlanFeature('fees'), feeCtrl.postCollectFee);
router.get('/fees/pending', verifyToken, isSchoolAdmin, requirePlanFeature('fees'), feeCtrl.getPendingFees);
router.get('/fees/receipt/:paymentId', verifyToken, isSchoolAdmin, requirePlanFeature('fees'), feeCtrl.downloadReceipt);
router.get('/fees/payment/:paymentId/receipt', verifyToken, isSchoolAdmin, requirePlanFeature('fees'), feeCtrl.downloadReceipt);
router.get('/fees/history', verifyToken, isSchoolAdmin, requirePlanFeature('fees'), feeCtrl.getFeeHistory);
router.get('/fees/student/:studentId/history', verifyToken, isSchoolAdmin, requirePlanFeature('fees'), feeCtrl.getFeeHistory);
router.post('/fees/reminder', verifyToken, isSchoolAdmin, requirePlanFeature('fees'), feeCtrl.sendFeeReminder);
router.post('/fees/razorpay/order', verifyToken, isSchoolAdmin, requirePlanFeature('fees'), schoolAdminRazorpayCtrl.createOrder);
router.post('/fees/razorpay/qr/:paymentId', verifyToken, isSchoolAdmin, requirePlanFeature('fees'), schoolAdminRazorpayCtrl.generateQRCode);

router.get('/analytics', verifyToken, isSchoolAdmin, requirePlanFeature('analytics'), analyticsCtrl.getAnalyticsPage);
router.get('/api/analytics/attendance', verifyToken, isSchoolAdmin, requirePlanFeature('analytics'), analyticsCtrl.getAttendanceAnalytics);
router.get('/api/analytics/fees', verifyToken, isSchoolAdmin, requirePlanFeature('analytics'), analyticsCtrl.getFeeAnalytics);
router.get('/api/analytics/exams', verifyToken, isSchoolAdmin, requirePlanFeature('analytics'), analyticsCtrl.getAcademicAnalytics);
router.get('/api/analytics/students', verifyToken, isSchoolAdmin, requirePlanFeature('analytics'), analyticsCtrl.getStudentAnalytics);

router.get('/exams', verifyToken, isSchoolAdmin, requirePlanFeature('exams'), examCtrl.listExams);
router.post('/exams/add', verifyToken, isSchoolAdmin, requirePlanFeature('exams'), examCtrl.addExam);
router.post('/exams/:id/edit', verifyToken, isSchoolAdmin, requirePlanFeature('exams'), examCtrl.editExam);
router.post('/exams/:id/delete', verifyToken, isSchoolAdmin, requirePlanFeature('exams'), examCtrl.deleteExam);
router.post('/exams/:id/publish', verifyToken, isSchoolAdmin, requirePlanFeature('exams'), examCtrl.togglePublish);
router.get('/exams/:id/marks', verifyToken, isSchoolAdmin, requirePlanFeature('exams'), examCtrl.getMarksEntry);
router.post('/exams/:id/marks', verifyToken, isSchoolAdmin, requirePlanFeature('exams'), examCtrl.postMarksEntry);
router.get('/exams/:id/bulk-entry', verifyToken, isSchoolAdmin, requirePlanFeature('exams'), examCtrl.getBulkEntry);
router.post('/exams/bulk-entry', verifyToken, isSchoolAdmin, requirePlanFeature('exams'), examCtrl.postBulkEntry);
router.get('/exams/:id/results', verifyToken, isSchoolAdmin, requirePlanFeature('exams'), examCtrl.getResultOverview);
router.get('/exams/:id/reportcard', verifyToken, isSchoolAdmin, requirePlanFeature('exams'), examCtrl.generateReportCard);
router.get('/exams/:id/export', verifyToken, isSchoolAdmin, requirePlanFeature('exams'), examCtrl.exportResults);
router.get('/exams/grade-schemes', verifyToken, isSchoolAdmin, requirePlanFeature('exams'), examCtrl.getGradeSchemes);
router.post('/exams/grade-schemes/add', verifyToken, isSchoolAdmin, requirePlanFeature('exams'), examCtrl.addGradeScheme);
router.post('/exams/grade-schemes/:id/delete', verifyToken, isSchoolAdmin, requirePlanFeature('exams'), examCtrl.deleteGradeScheme);

router.get('/marks', verifyToken, isSchoolAdmin, requirePlanFeature('exams'), (req, res) => res.redirect('/schooladmin/exams'));
router.get('/marks/entry', verifyToken, isSchoolAdmin, requirePlanFeature('exams'), (req, res) => res.redirect('/schooladmin/exams'));
router.get('/marks/report', verifyToken, isSchoolAdmin, requirePlanFeature('exams'), (req, res) => res.redirect('/schooladmin/exams'));

router.get('/drivers', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), (req, res) => res.redirect('/schooladmin/transport/drivers'));
router.get('/drivers/add', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), driverController.showAddForm);
router.post('/drivers/add', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), driverUpload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'license_document', maxCount: 1 },
    { name: 'aadhaar_card', maxCount: 1 },
    { name: 'address_proof', maxCount: 1 },
    { name: 'medical_certificate', maxCount: 1 },
    { name: 'police_verification', maxCount: 1 },
    { name: 'other_document', maxCount: 1 }
]), driverController.createDriver);
router.get('/drivers/vehicles', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), (req, res) => res.redirect('/schooladmin/transport/vehicles'));
router.post('/drivers/vehicles/add', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), (req, res) => {
    req.flash('error', 'Legacy route disabled. Use Transport management instead.');
    res.redirect('/schooladmin/transport/vehicles');
});
router.post('/drivers/vehicles/:id/delete', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), (req, res) => {
    req.flash('error', 'Legacy route disabled. Use Transport management instead.');
    res.redirect('/schooladmin/transport/vehicles');
});
router.get('/drivers/routes', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), (req, res) => res.redirect('/schooladmin/transport/routes'));
router.post('/drivers/routes/add', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), (req, res) => {
    req.flash('error', 'Legacy route disabled. Use Transport management instead.');
    res.redirect('/schooladmin/transport/routes');
});
router.post('/drivers/routes/:id/delete', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), (req, res) => {
    req.flash('error', 'Legacy route disabled. Use Transport management instead.');
    res.redirect('/schooladmin/transport/routes');
});
router.get('/drivers/:id', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), driverController.viewDriver);
router.get('/drivers/:id/edit', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), driverController.showEditForm);
router.post('/drivers/:id/edit', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), driverUpload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'license_document', maxCount: 1 },
    { name: 'aadhaar_card', maxCount: 1 },
    { name: 'address_proof', maxCount: 1 },
    { name: 'medical_certificate', maxCount: 1 },
    { name: 'police_verification', maxCount: 1 },
    { name: 'other_document', maxCount: 1 }
]), driverController.updateDriver);
router.post('/drivers/:id/delete', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), driverController.deleteDriver);

router.get('/transport/dashboard', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.dashboard);
router.get('/transport/drivers', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), (req, res, next) => {
  res.locals.currentPath = '/schooladmin/transport/drivers';
  next();
}, driverController.listDrivers);
router.get('/transport/routes/:routeId/stops', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.listRouteStops);
router.post('/transport/routes/:routeId/stops', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.createRouteStop);
router.post('/transport/routes/:routeId/stops/defaults', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.createDefaultRouteStops);
router.post('/transport/stops/:id/update', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.updateRouteStop);
router.post('/transport/stops/:id/delete', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.deleteRouteStop);
router.get('/transport/routes/:routeId/stops/json', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.routeStopsJson);
router.get('/transport/allocations', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.listAllocations);
router.get('/transport/allocations/new', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.newAllocationForm);
router.post('/transport/allocations/bulk-stops', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.bulkAssignAllocationStops);
router.post('/transport/allocations', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.createAllocation);
router.post('/transport/allocations/:id/update', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.updateAllocation);
router.post('/transport/allocations/:id/deactivate', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.deactivateAllocation);
router.get('/transport/maintenance', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.maintenance);
router.post('/transport/maintenance/add', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.createMaintenance);
router.post('/transport/maintenance', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.createMaintenance);
router.post('/transport/maintenance/:id/update', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.updateMaintenance);
router.post('/transport/maintenance/:id/delete', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.deleteMaintenance);
router.get('/transport/fee-plans', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.feePlans);
router.post('/transport/fee-plans/add', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.createFeePlan);
router.post('/transport/fee-plans', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.createFeePlan);
router.post('/transport/fee-plans/:id/update', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.updateFeePlan);
router.post('/transport/fee-plans/:id/delete', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.deleteFeePlan);
router.post('/transport/fee-plans/generate-invoice', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.generateTransportFeeInvoice);
router.get('/transport/alerts', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.alerts);
router.post('/transport/alerts/:id/resolve', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.resolveAlert);
router.post('/transport/alerts/:id/dismiss', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.dismissAlert);
router.get('/transport/reports', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.reports);
router.get('/transport/export', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.renderExportCenter);
router.get('/transport/reports/export', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.exportTransportReport);
router.get('/transport/vehicles', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.listVehicles);
router.get('/transport/vehicles/add', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.addVehicleForm);
router.post('/transport/vehicles/add', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.createVehicle);
router.get('/transport/vehicles/edit/:id', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.editVehicleForm);
router.post('/transport/vehicles/edit/:id', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.updateVehicle);
router.post('/transport/vehicles/delete/:id', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.deleteVehicle);
router.get('/transport/routes', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.listRoutes);
router.get('/transport/routes/add', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.addRouteForm);
router.post('/transport/routes/add', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.createRoute);
router.get('/transport/routes/edit/:id', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.editRouteForm);
router.post('/transport/routes/edit/:id', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.updateRoute);
router.post('/transport/routes/delete/:id', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.deleteRoute);

router.all(/^\/transport\/assignments(\/.*)?$/, verifyToken, isSchoolAdmin, requirePlanFeature('transport'), (req, res) => {
    req.flash('error', 'Driver assignment page has been merged into Routes/Vehicles in the simplified transport panel.');
    return res.redirect('/schooladmin/transport/routes');
});

router.get('/transport/students', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), (req, res) => res.redirect('/schooladmin/transport/allocations'));
router.post('/transport/students/assign/:studentId', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.assignStudentRoute);
router.get('/transport/route-students/:routeId', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.routeStudents);
router.get('/transport/tracking', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.viewTracking);
router.get('/transport/tracking/trip/:tripId/students', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.getTrackingTripStudents);
router.post('/transport/fee-invoice/generate', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.generateTransportFeeInvoice);
router.get('/transport/vehicle-expiry', verifyToken, isSchoolAdmin, requirePlanFeature('transport'), transportCtrl.getVehicleExpiryAlerts);

router.get('/librarians', verifyToken, isSchoolAdmin, requirePlanFeature('library'), librarianController.listLibrarians);
router.get('/librarians/add', verifyToken, isSchoolAdmin, requirePlanFeature('library'), librarianController.showAddForm);
router.post('/librarians/add', verifyToken, isSchoolAdmin, requirePlanFeature('library'), librarianController.createLibrarian);
router.get('/librarians/:id/edit', verifyToken, isSchoolAdmin, requirePlanFeature('library'), librarianController.showEditForm);
router.post('/librarians/:id/edit', verifyToken, isSchoolAdmin, requirePlanFeature('library'), librarianController.updateLibrarian);
router.post('/librarians/:id/delete', verifyToken, isSchoolAdmin, requirePlanFeature('library'), librarianController.deleteLibrarian);
router.get('/library', verifyToken, isSchoolAdmin, requirePlanFeature('library'), (req, res) => res.redirect('/schooladmin/librarians'));

router.get('/notices', verifyToken, isSchoolAdmin, noticeCtrl.listNotices);
router.get('/notices/add', verifyToken, isSchoolAdmin, noticeCtrl.getAddNotice);
router.post('/notices', verifyToken, isSchoolAdmin, noticeUpload.single('attachment'), noticeCtrl.postAddNotice);
router.get('/notices/:id/edit', verifyToken, isSchoolAdmin, noticeCtrl.getEditNotice);
router.post('/notices/:id/edit', verifyToken, isSchoolAdmin, noticeUpload.single('attachment'), noticeCtrl.postEditNotice);
router.post('/notices/:id/delete', verifyToken, isSchoolAdmin, noticeCtrl.deleteNotice);

router.get('/reports', verifyToken, isSchoolAdmin, (req, res) => res.redirect('/schooladmin/reports/admission'));
router.get('/reports/admission', verifyToken, isSchoolAdmin, reportCtrl.admissionReport);
router.get('/reports/attendance', verifyToken, isSchoolAdmin, reportCtrl.attendanceReport);
router.get('/reports/fee', verifyToken, isSchoolAdmin, reportCtrl.feeReport);
router.get('/reports/exam', verifyToken, isSchoolAdmin, reportCtrl.examReport);
router.get('/reports/finance', verifyToken, isSchoolAdmin, reportCtrl.financeReport);

router.get('/settings', verifyToken, isSchoolAdmin, settingCtrl.getSettings);
router.post('/settings', verifyToken, isSchoolAdmin, settingsUpload.single('logo'), settingCtrl.postSettings);
router.get('/settings/bank', verifyToken, isSchoolAdmin, settingCtrl.getBankDetails);
router.post('/settings/bank', verifyToken, isSchoolAdmin, settingCtrl.postBankDetails);
router.get('/settings/documents', verifyToken, isSchoolAdmin, settingCtrl.getDocuments);
router.post('/settings/documents', verifyToken, isSchoolAdmin, settingsUpload.fields([{ name: 'documents', maxCount: 5 }]), settingCtrl.postDocuments);
router.get('/settings/chat-permissions', verifyToken, isSchoolAdmin, settingCtrl.getChatPermissions);
router.post('/settings/chat-permissions', verifyToken, isSchoolAdmin, settingCtrl.postChatPermissions);

router.get('/chat/permissions', verifyToken, isSchoolAdmin, settingCtrl.getChatPermissions);
router.post('/chat/permissions', verifyToken, isSchoolAdmin, settingCtrl.postChatPermissions);

router.get('/salary', verifyToken, isSchoolAdmin, requirePlanFeature('salary'), (req, res) => {
    res.render('schoolAdmin/salary/index', {
        title: 'Salary Management',
        user: req.user || req.session.user,
        currentPath: '/schooladmin/salary'
    });
});

router.get('/salary/structures', verifyToken, isSchoolAdmin, requirePlanFeature('salary'), salaryCtrl.listStructures);
router.get('/salary/structures/add', verifyToken, isSchoolAdmin, requirePlanFeature('salary'), salaryCtrl.addStructureForm);
router.post('/salary/structures/add', verifyToken, isSchoolAdmin, requirePlanFeature('salary'), salaryCtrl.createStructure);
router.get('/salary/structures/edit/:id', verifyToken, isSchoolAdmin, requirePlanFeature('salary'), salaryCtrl.editStructureForm);
router.post('/salary/structures/edit/:id', verifyToken, isSchoolAdmin, requirePlanFeature('salary'), salaryCtrl.updateStructure);
router.post('/salary/structures/delete/:id', verifyToken, isSchoolAdmin, requirePlanFeature('salary'), salaryCtrl.deleteStructure);
router.get('/salary/generate', verifyToken, isSchoolAdmin, requirePlanFeature('salary'), salaryCtrl.generateSalariesForm);
router.post('/salary/generate', verifyToken, isSchoolAdmin, requirePlanFeature('salary'), salaryCtrl.generateSalaries);
router.get('/salary/monthly', verifyToken, isSchoolAdmin, requirePlanFeature('salary'), salaryCtrl.listMonthlySalaries);
router.get('/salary/pay/:id', verifyToken, isSchoolAdmin, requirePlanFeature('salary'), salaryCtrl.paySalaryForm);
router.post('/salary/pay/:id', verifyToken, isSchoolAdmin, requirePlanFeature('salary'), salaryCtrl.paySalary);
router.get('/salary/history', verifyToken, isSchoolAdmin, requirePlanFeature('salary'), salaryCtrl.salaryHistory);
router.get('/salary/payslip/:id', verifyToken, isSchoolAdmin, requirePlanFeature('salary'), salaryCtrl.downloadPaySlip);
router.post('/salary/bulk-pay', verifyToken, isSchoolAdmin, requirePlanFeature('salary'), salaryCtrl.bulkPaySalaries);
router.get('/api/salary/stats', verifyToken, isSchoolAdmin, requirePlanFeature('salary'), salaryCtrl.getSalaryStats);

router.get('/homework', verifyToken, isSchoolAdmin, requirePlanFeature('homework'), homeworkCtrl.listHomeworks);
router.post('/homework/toggle-status/:id', verifyToken, isSchoolAdmin, requirePlanFeature('homework'), homeworkCtrl.toggleHomeworkStatus);
router.get('/homework/stats', verifyToken, isSchoolAdmin, requirePlanFeature('homework'), homeworkCtrl.homeworkStats);
router.get('/homework/:id', verifyToken, isSchoolAdmin, requirePlanFeature('homework'), homeworkCtrl.homeworkDetail);

router.get('/leaves', verifyToken, isSchoolAdmin, leaveCtrl.listLeaves);
router.post('/leaves/approve/:id', verifyToken, isSchoolAdmin, leaveCtrl.approveLeave);
router.post('/leaves/reject/:id', verifyToken, isSchoolAdmin, leaveCtrl.rejectLeave);
router.get('/leaves/calendar', verifyToken, isSchoolAdmin, leaveCtrl.calendarView);

router.get('/subscription', verifyToken, isSchoolAdmin, subscriptionCtrl.index);
router.get('/subscription/proration-preview/:newPlanId', verifyToken, isSchoolAdmin, subscriptionCtrl.prorationPreview);
router.post('/subscription/renew-request', verifyToken, isSchoolAdmin, subscriptionCtrl.renewRequest);
router.post('/subscription/checkout', verifyToken, isSchoolAdmin, subscriptionCtrl.createCheckoutSession);
router.post('/subscription/verify', verifyToken, isSchoolAdmin, subscriptionCtrl.verifySubscriptionPayment);
router.post('/subscription/create-order', verifyToken, isSchoolAdmin, subscriptionCtrl.createCheckoutSession);
router.post('/subscription/verify-payment', verifyToken, isSchoolAdmin, subscriptionCtrl.verifySubscriptionPayment);
router.post('/subscription/payment-failed', verifyToken, isSchoolAdmin, subscriptionCtrl.paymentFailed);
router.post('/subscription/payment-callback', verifyToken, isSchoolAdmin, subscriptionCtrl.verifySubscriptionPayment);
router.post('/subscription/payment-success', verifyToken, isSchoolAdmin, subscriptionCtrl.verifySubscriptionPayment);

router.get('/admissions', verifyToken, isSchoolAdmin, admissionCtrl.listAdmissions);
router.get('/admissions/qr', verifyToken, isSchoolAdmin, admissionCtrl.showQRPage);
router.post('/admissions/qr/generate', verifyToken, isSchoolAdmin, admissionCtrl.generateQR);
router.get('/admissions/:id', verifyToken, isSchoolAdmin, admissionCtrl.viewAdmission);
router.post('/admissions/:id/approve', verifyToken, isSchoolAdmin, admissionCtrl.approveAdmission);
router.post('/admissions/:id/reject', verifyToken, isSchoolAdmin, admissionCtrl.rejectAdmission);

router.get('/academic-calendar', verifyToken, isSchoolAdmin, calendarCtrl.showCalendar);
router.get('/api/academic-events', verifyToken, isSchoolAdmin, calendarCtrl.getEvents);
router.post('/api/academic-events', verifyToken, isSchoolAdmin, calendarCtrl.createEvent);
router.put('/api/academic-events/:id', verifyToken, isSchoolAdmin, calendarCtrl.updateEvent);
router.delete('/api/academic-events/:id', verifyToken, isSchoolAdmin, calendarCtrl.deleteEvent);
router.get('/portal/overrides', verifyToken, isSchoolAdmin, portalCtrl.getOverrides);
router.post('/portal/overrides', verifyToken, isSchoolAdmin, portalCtrl.createOverride);
router.post('/portal/overrides/delete', verifyToken, isSchoolAdmin, portalCtrl.deleteOverride);

router.get('/chat', verifyToken, isSchoolAdmin, chatController.getChatPage);
router.get('/chat/history/:receiverId', verifyToken, isSchoolAdmin, chatController.getChatHistory);
router.post('/chat/send', verifyToken, isSchoolAdmin, chatController.sendMessage);
router.delete('/chat/message/:messageId', verifyToken, isSchoolAdmin, chatController.deleteMessage);
router.get('/chat/search', verifyToken, isSchoolAdmin, chatController.searchMessages);
router.get('/api/chat/unread-count', verifyToken, isSchoolAdmin, chatController.getUnreadCount);
router.post('/chat/mark-all-read', verifyToken, isSchoolAdmin, chatController.markAllRead);

router.get('/settings/mediums', verifyToken, isSchoolAdmin, mediumCtrl.getMediums);
router.post('/settings/mediums', verifyToken, isSchoolAdmin, mediumCtrl.postMediums);

router.get('/events', verifyToken, isSchoolAdmin, eventCtrl.listEvents);
router.get('/events/add', verifyToken, isSchoolAdmin, eventCtrl.showAddForm);
router.post('/events', verifyToken, isSchoolAdmin, eventUpload.array('media', 10), eventCtrl.createEvent);
router.get('/events/edit/:id', verifyToken, isSchoolAdmin, eventCtrl.showEditForm);
router.post('/events/edit/:id', verifyToken, isSchoolAdmin, eventCtrl.updateEvent);
router.put('/events/:id', verifyToken, isSchoolAdmin, eventCtrl.updateEvent);
router.post('/events/:id/media', verifyToken, isSchoolAdmin, eventUpload.array('media', 10), eventCtrl.uploadMedia);
router.delete('/events/:id', verifyToken, isSchoolAdmin, eventCtrl.deleteEvent);
router.post('/events/:id/delete', verifyToken, isSchoolAdmin, eventCtrl.deleteEvent);
router.delete('/media/:mediaId', verifyToken, isSchoolAdmin, eventCtrl.deleteMedia);
router.post('/media/delete/:mediaId', verifyToken, isSchoolAdmin, eventCtrl.deleteMedia);
router.get('/events/:id', verifyToken, isSchoolAdmin, eventCtrl.viewEventAdmin);

router.get('/certificates', verifyToken, isSchoolAdmin, certFeature, certCtrl.dashboard);
router.get('/certificates/templates', verifyToken, isSchoolAdmin, certFeature, certCtrl.templatesList);
router.get('/certificates/templates/add', verifyToken, isSchoolAdmin, certFeature, certCtrl.addTemplateForm);
router.post('/certificates/templates', verifyToken, isSchoolAdmin, certFeature, certCtrl.createTemplate);
router.get('/certificates/templates/:id/edit', verifyToken, isSchoolAdmin, certFeature, certCtrl.editTemplateForm);
router.post('/certificates/templates/:id', verifyToken, isSchoolAdmin, certFeature, certCtrl.updateTemplate);
router.post('/certificates/templates/:id/delete', verifyToken, isSchoolAdmin, certFeature, certCtrl.deleteTemplate);
router.get('/certificates/generate', verifyToken, isSchoolAdmin, certFeature, certCtrl.generateForm);
router.post('/certificates/generate', verifyToken, isSchoolAdmin, certFeature, certCtrl.generateCertificate);
router.get('/certificates/issued', verifyToken, isSchoolAdmin, certFeature, certCtrl.issuedList);
router.get('/certificates/api/students', verifyToken, isSchoolAdmin, certFeature, certCtrl.apiSearchStudents);
router.get('/certificates/api/teachers', verifyToken, isSchoolAdmin, certFeature, certCtrl.apiSearchTeachers);
router.get('/certificates/:id/download', verifyToken, isSchoolAdmin, certFeature, certCtrl.downloadPDF);
router.post('/certificates/:id/cancel',  verifyToken, isSchoolAdmin, certFeature, certCtrl.cancelCertificate);

module.exports = router;