const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");
const { verifyToken } = require("../middleware/auth");

router.use(verifyToken);

router.get("/", notificationController.getNotifications);
router.get("/unread-count", notificationController.getUnreadCount);
router.patch("/read-all", notificationController.markAllRead);
router.patch("/:id/read", notificationController.markRead);
router.delete("/:id", notificationController.deleteNotification);

router.get("/preferences", notificationController.getPreferences);
router.put("/preferences", notificationController.updatePreferences);

router.post("/test", notificationController.sendTestNotification);

module.exports = router;
