const express = require("express");
const router = express.Router();
const { verifyToken, isGroupAdmin } = require("../middleware/auth");
const { ensureGroupSchoolAccess } = require("../utils/groupAdminContext");
const dashboardController = require("../controllers/groupAdmin/dashboardController");
const chatController = require("../controllers/groupAdmin/chatController");
const meetingController = require("../controllers/groupAdmin/meetingController");

// Overview and dashboard routes
router.get("/dashboard", verifyToken, isGroupAdmin, dashboardController.getDashboard);
router.get("/branches", verifyToken, isGroupAdmin, dashboardController.getBranchesPage);
router.get("/branch/:schoolId/overview", verifyToken, isGroupAdmin, ensureGroupSchoolAccess, dashboardController.getBranchOverview);
router.get("/branches/:schoolId/overview", verifyToken, isGroupAdmin, ensureGroupSchoolAccess, dashboardController.getBranchOverview);

// Read-only dashboard pages (No write routes allowed)
router.get("/students", verifyToken, isGroupAdmin, dashboardController.getStudentsPage);
router.get("/teachers", verifyToken, isGroupAdmin, dashboardController.getTeachersPage);
router.get("/attendance", verifyToken, isGroupAdmin, dashboardController.getAttendancePage);
router.get("/fees", verifyToken, isGroupAdmin, dashboardController.getFeesPage);
router.get("/transport", verifyToken, isGroupAdmin, dashboardController.getTransportPage);
router.get("/library", verifyToken, isGroupAdmin, dashboardController.getLibraryPage);
router.get("/reports", verifyToken, isGroupAdmin, dashboardController.getReportsPage);

// Chat routes
router.get("/chat", verifyToken, isGroupAdmin, chatController.getChatInboxPage);
router.get("/chat/unread", verifyToken, isGroupAdmin, chatController.getUnreadCount);
router.post("/chat/read", verifyToken, isGroupAdmin, chatController.markAllRead);
router.get("/chat/history/:schoolId/:adminId", verifyToken, isGroupAdmin, chatController.getChatHistory);
router.post("/chat/send", verifyToken, isGroupAdmin, chatController.sendMessage);
router.get("/chat/search", verifyToken, isGroupAdmin, chatController.searchMessages);
router.delete("/chat/message/:messageId", verifyToken, isGroupAdmin, chatController.deleteMessage);
router.get("/chat/broadcast", verifyToken, isGroupAdmin, chatController.renderBroadcastForm);
router.post("/chat/broadcast", verifyToken, isGroupAdmin, chatController.sendBroadcast);

// Meeting routes
router.get("/meetings", verifyToken, isGroupAdmin, meetingController.listMeetings);
router.get("/meetings/create", verifyToken, isGroupAdmin, meetingController.renderCreateForm);
router.post("/meetings", verifyToken, isGroupAdmin, meetingController.createMeeting);
router.get("/meetings/:id", verifyToken, isGroupAdmin, meetingController.getMeetingDetails);
router.get("/meetings/:id/join", verifyToken, isGroupAdmin, meetingController.joinMeeting);
router.get("/meetings/:id/edit", verifyToken, isGroupAdmin, meetingController.renderEditForm);
router.post("/meetings/:id/edit", verifyToken, isGroupAdmin, meetingController.updateMeeting);
router.post("/meetings/:id/cancel", verifyToken, isGroupAdmin, meetingController.cancelMeeting);
router.get("/meetings/:id/attendance-report", verifyToken, isGroupAdmin, meetingController.renderAttendanceReport);

module.exports = router;
