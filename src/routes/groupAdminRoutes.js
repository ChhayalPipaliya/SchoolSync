const express = require("express");
const router = express.Router();
const { verifyToken, isGroupAdmin } = require("../middleware/auth");
const { ensureGroupSchoolAccess } = require("../utils/groupAdminContext");
const { requireBranchPlanFeature } = require("../middleware/planAccess");
const dashboardController = require("../controllers/groupAdmin/dashboardController");
const chatController = require("../controllers/groupAdmin/chatController");
const meetingController = require("../controllers/groupAdmin/meetingController");
const calendarController = require("../controllers/groupAdmin/calendarController");

router.get("/dashboard", verifyToken, isGroupAdmin, requireBranchPlanFeature("dashboard"), dashboardController.getDashboard);
router.get("/branches", verifyToken, isGroupAdmin, requireBranchPlanFeature("dashboard"), dashboardController.getBranchesPage);
router.get("/branch/:schoolId/overview", verifyToken, isGroupAdmin, ensureGroupSchoolAccess, requireBranchPlanFeature("dashboard"), dashboardController.getBranchOverview);
router.get("/branches/:schoolId/overview", verifyToken, isGroupAdmin, ensureGroupSchoolAccess, requireBranchPlanFeature("dashboard"), dashboardController.getBranchOverview);

router.get("/students", verifyToken, isGroupAdmin, requireBranchPlanFeature("students"), dashboardController.getStudentsPage);
router.get("/teachers", verifyToken, isGroupAdmin, requireBranchPlanFeature("teachers"), dashboardController.getTeachersPage);
router.get("/attendance", verifyToken, isGroupAdmin, requireBranchPlanFeature("attendance"), dashboardController.getAttendancePage);
router.get("/fees", verifyToken, isGroupAdmin, requireBranchPlanFeature("fees"), dashboardController.getFeesPage);
router.get("/transport", verifyToken, isGroupAdmin, requireBranchPlanFeature("transport"), dashboardController.getTransportPage);
router.get("/library", verifyToken, isGroupAdmin, requireBranchPlanFeature("library"), dashboardController.getLibraryPage);
router.get("/reports", verifyToken, isGroupAdmin, requireBranchPlanFeature("reports"), dashboardController.getReportsPage);

router.get("/academic-calendar", verifyToken, isGroupAdmin, requireBranchPlanFeature("events"), calendarController.showCalendar);
router.get("/api/academic-events", verifyToken, isGroupAdmin, requireBranchPlanFeature("events"), calendarController.getEvents);
router.post("/api/academic-events", verifyToken, isGroupAdmin, requireBranchPlanFeature("events"), calendarController.createEvent);
router.put("/api/academic-events/:id", verifyToken, isGroupAdmin, requireBranchPlanFeature("events"), calendarController.updateEvent);
router.delete("/api/academic-events/:id", verifyToken, isGroupAdmin, requireBranchPlanFeature("events"), calendarController.deleteEvent);

router.get("/chat", verifyToken, isGroupAdmin, requireBranchPlanFeature("messaging"), chatController.getChatInboxPage);
router.get("/chat/unread", verifyToken, isGroupAdmin, requireBranchPlanFeature("messaging"), chatController.getUnreadCount);
router.post("/chat/read", verifyToken, isGroupAdmin, requireBranchPlanFeature("messaging"), chatController.markAllRead);
router.get("/chat/history/:schoolId/:adminId", verifyToken, isGroupAdmin, ensureGroupSchoolAccess, requireBranchPlanFeature("messaging"), chatController.getChatHistory);
router.post("/chat/send", verifyToken, isGroupAdmin, requireBranchPlanFeature("messaging"), chatController.sendMessage);
router.get("/chat/search", verifyToken, isGroupAdmin, requireBranchPlanFeature("messaging"), chatController.searchMessages);
router.delete("/chat/message/:messageId", verifyToken, isGroupAdmin, requireBranchPlanFeature("messaging"), chatController.deleteMessage);
router.get("/chat/broadcast", verifyToken, isGroupAdmin, requireBranchPlanFeature("messaging"), chatController.renderBroadcastForm);
router.post("/chat/broadcast", verifyToken, isGroupAdmin, requireBranchPlanFeature("messaging"), chatController.sendBroadcast);

router.get("/meetings", verifyToken, isGroupAdmin, requireBranchPlanFeature("meetings"), meetingController.listMeetings);
router.get("/meetings/create", verifyToken, isGroupAdmin, requireBranchPlanFeature("meetings"), meetingController.renderCreateForm);
router.post("/meetings", verifyToken, isGroupAdmin, requireBranchPlanFeature("meetings"), meetingController.createMeeting);
router.get("/meetings/:id", verifyToken, isGroupAdmin, requireBranchPlanFeature("meetings"), meetingController.getMeetingDetails);
router.get("/meetings/:id/join", verifyToken, isGroupAdmin, requireBranchPlanFeature("meetings"), meetingController.joinMeeting);
router.get("/meetings/:id/edit", verifyToken, isGroupAdmin, requireBranchPlanFeature("meetings"), meetingController.renderEditForm);
router.post("/meetings/:id/edit", verifyToken, isGroupAdmin, requireBranchPlanFeature("meetings"), meetingController.updateMeeting);
router.post("/meetings/:id/cancel", verifyToken, isGroupAdmin, requireBranchPlanFeature("meetings"), meetingController.cancelMeeting);
router.get("/meetings/:id/attendance-report", verifyToken, isGroupAdmin, requireBranchPlanFeature("meetings"), meetingController.renderAttendanceReport);

module.exports = router;