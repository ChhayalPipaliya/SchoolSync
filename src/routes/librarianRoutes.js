const express = require("express");
const router = express.Router();
const dashboardCtrl = require("../controllers/librarian/dashboardController");
const bookCtrl = require("../controllers/librarian/bookController");
const categoryCtrl = require("../controllers/librarian/categoryController");
const rackCtrl = require("../controllers/librarian/rackController");
const issueCtrl = require("../controllers/librarian/issueController");
const fineCtrl = require("../controllers/librarian/fineController");
const reportCtrl = require("../controllers/librarian/reportController");
const chatController = require('../controllers/chatController');
const leaveController = require('../controllers/leaveController');
const { libraryUpload } = require("../middleware/upload");
const calendarCtrl = require('../controllers/student/calendarController');

const { verifyToken, isLibrarian } = require("../middleware/auth");
const { canViewLibraryReports, canManageLibraryBooks, canManageLibraryIssues, canManageLibraryFines } = require("../middleware/libraryAccess");
const { validateBookAdd, validateBookIssue, validateLibraryCategory, validateLibraryRack } = require("../middleware/validate");

const libUpload = libraryUpload;
const libFields = [{ name: "cover_image", maxCount: 1 }];

router.use((req, res, next) => {
    res.locals.layout = "librarian/layout";
    const originalRender = res.render;
    res.render = function(view, options, fn) {
        if (typeof options === 'function') {
            fn = options;
            options = { layout: 'librarian/layout' };
        } else if (typeof options === 'object') {
            options.layout = options.layout !== undefined ? options.layout : 'librarian/layout';
        } else {
            options = { layout: 'librarian/layout' };
        };
        originalRender.call(this, view, options, fn);
    };
    next();
});

router.get("/dashboard", verifyToken, isLibrarian, dashboardCtrl.dashboard);

router.get("/books", verifyToken, isLibrarian, canManageLibraryBooks, bookCtrl.index);
router.get("/books/add", verifyToken, isLibrarian, canManageLibraryBooks, bookCtrl.addPage);
router.post("/books/add", verifyToken, isLibrarian, canManageLibraryBooks, libUpload.fields(libFields), validateBookAdd, bookCtrl.add);
router.get("/books/:id/edit", verifyToken, isLibrarian, canManageLibraryBooks, bookCtrl.editPage);
router.post("/books/:id/edit", verifyToken, isLibrarian, canManageLibraryBooks, libUpload.fields(libFields), validateBookAdd, bookCtrl.edit);
router.post("/books/:id/delete", verifyToken, isLibrarian, canManageLibraryBooks, bookCtrl.delete);

router.get("/categories", verifyToken, isLibrarian, canManageLibraryBooks, categoryCtrl.index);
router.post("/categories", verifyToken, isLibrarian, canManageLibraryBooks, validateLibraryCategory, categoryCtrl.save);
router.post("/categories/:id/delete", verifyToken, isLibrarian, canManageLibraryBooks, categoryCtrl.delete);

router.get("/racks", verifyToken, isLibrarian, canManageLibraryBooks, rackCtrl.index);
router.post("/racks", verifyToken, isLibrarian, canManageLibraryBooks, validateLibraryRack, rackCtrl.save);
router.post("/racks/:id/delete", verifyToken, isLibrarian, canManageLibraryBooks, rackCtrl.delete);

router.get("/issues", verifyToken, isLibrarian, canManageLibraryIssues, issueCtrl.index);
router.get("/issues/new", verifyToken, isLibrarian, canManageLibraryIssues, issueCtrl.issuePage);
router.post("/issues/new", verifyToken, isLibrarian, canManageLibraryIssues, validateBookIssue, issueCtrl.issueBook);
router.post("/issues/:id/renew", verifyToken, isLibrarian, canManageLibraryIssues, issueCtrl.renew);
router.get("/issues/:id/return", verifyToken, isLibrarian, canManageLibraryIssues, issueCtrl.returnPage);
router.post("/issues/:id/return", verifyToken, isLibrarian, canManageLibraryIssues, issueCtrl.returnBook);

router.get("/fines", verifyToken, isLibrarian, canManageLibraryFines, fineCtrl.index);
router.post("/fines/:id/pay", verifyToken, isLibrarian, canManageLibraryFines, fineCtrl.pay);
router.post("/fines/:id/waive", verifyToken, isLibrarian, canManageLibraryFines, fineCtrl.waive);

router.get("/reports", verifyToken, isLibrarian, canViewLibraryReports, reportCtrl.index);

router.get("/api/books", verifyToken, isLibrarian, canManageLibraryBooks, bookCtrl.searchBooks);

router.get("/profile", verifyToken, isLibrarian, dashboardCtrl.profilePage);
router.post("/profile/update", verifyToken, isLibrarian, dashboardCtrl.updateProfile);
router.get("/notices", verifyToken, isLibrarian, dashboardCtrl.noticesPage);

router.get('/leaves', verifyToken, isLibrarian, leaveController.getLeaves);
router.post('/leaves/apply', verifyToken, isLibrarian, leaveController.applyLeave);

router.get('/chat', verifyToken, isLibrarian, chatController.getChatPage);
router.get('/chat/history/:receiverId', verifyToken, isLibrarian, chatController.getChatHistory);
router.post('/chat/send', verifyToken, isLibrarian, chatController.sendMessage);
router.delete('/chat/message/:messageId', verifyToken, isLibrarian, chatController.deleteMessage);
router.get('/chat/search', verifyToken, isLibrarian, chatController.searchMessages);
router.get('/api/chat/unread-count', verifyToken, isLibrarian, chatController.getUnreadCount);
router.post('/chat/mark-all-read', verifyToken, isLibrarian, chatController.markAllRead);

router.get("/academic-calendar", verifyToken, isLibrarian, calendarCtrl.showCalendar);
router.get("/api/academic-events", verifyToken, isLibrarian, calendarCtrl.getEvents);

module.exports = router;