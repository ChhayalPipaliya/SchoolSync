const express = require("express");
const router = express.Router();
const dashboardCtrl = require("../controllers/librarian/dashboardController");
const bookCtrl = require("../controllers/librarian/bookController");
const categoryCtrl = require("../controllers/librarian/categoryController");
const rackCtrl = require("../controllers/librarian/rackController");
const issueCtrl = require("../controllers/librarian/issueController");
const memberCtrl = require("../controllers/librarian/memberController");
const fineCtrl = require("../controllers/librarian/fineController");
const reportCtrl = require("../controllers/librarian/reportController");
const chatController = require('../controllers/chatController');
const leaveController = require('../controllers/leaveController');
const { libraryUpload } = require("../middleware/upload");

const { verifyToken, isLibrary, isLibrarian } = require("../middleware/auth");
const { canManageLibraryOperations, canViewLibraryReports, canManageLibraryBooks, canManageLibraryIssues, canManageLibraryFines } = require("../middleware/libraryAccess");
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
        }
        originalRender.call(this, view, options, fn);
    };
    next();
});

router.get("/dashboard", verifyToken, isLibrary, dashboardCtrl.dashboard);

router.get("/books", verifyToken, isLibrary, canManageLibraryBooks, bookCtrl.index);
router.get("/books/add", verifyToken, isLibrary, canManageLibraryBooks, bookCtrl.addPage);
router.post("/books/add", verifyToken, isLibrary, canManageLibraryBooks, libUpload.fields(libFields), validateBookAdd, bookCtrl.add);
router.get("/books/:id/edit", verifyToken, isLibrary, canManageLibraryBooks, bookCtrl.editPage);
router.post("/books/:id/edit", verifyToken, isLibrary, canManageLibraryBooks, libUpload.fields(libFields), validateBookAdd, bookCtrl.edit);
router.post("/books/:id/delete", verifyToken, isLibrary, canManageLibraryBooks, bookCtrl.delete);

router.get("/categories", verifyToken, isLibrary, canManageLibraryBooks, categoryCtrl.index);
router.post("/categories", verifyToken, isLibrary, canManageLibraryBooks, validateLibraryCategory, categoryCtrl.save);
router.post("/categories/:id/delete", verifyToken, isLibrary, canManageLibraryBooks, categoryCtrl.delete);

router.get("/racks", verifyToken, isLibrary, canManageLibraryBooks, rackCtrl.index);
router.post("/racks", verifyToken, isLibrary, canManageLibraryBooks, validateLibraryRack, rackCtrl.save);
router.post("/racks/:id/delete", verifyToken, isLibrary, canManageLibraryBooks, rackCtrl.delete);

router.get("/members", verifyToken, isLibrary, canManageLibraryIssues, memberCtrl.index);

router.get("/issues", verifyToken, isLibrary, canManageLibraryIssues, issueCtrl.index);
router.get("/issues/new", verifyToken, isLibrary, canManageLibraryIssues, issueCtrl.issuePage);
router.post("/issues/new", verifyToken, isLibrary, canManageLibraryIssues, validateBookIssue, issueCtrl.issueBook);
router.post("/issues/:id/renew", verifyToken, isLibrary, canManageLibraryIssues, issueCtrl.renew);
router.get("/issues/:id/return", verifyToken, isLibrary, canManageLibraryIssues, issueCtrl.returnPage);
router.post("/issues/:id/return", verifyToken, isLibrary, canManageLibraryIssues, issueCtrl.returnBook);

router.get("/fines", verifyToken, isLibrary, canManageLibraryFines, fineCtrl.index);
router.post("/fines/:id/pay", verifyToken, isLibrary, canManageLibraryFines, fineCtrl.pay);
router.post("/fines/:id/waive", verifyToken, isLibrary, canManageLibraryFines, fineCtrl.waive);

router.get("/reports", verifyToken, isLibrary, canViewLibraryReports, reportCtrl.index);

router.get("/api/books", verifyToken, isLibrary, canManageLibraryBooks, bookCtrl.searchBooks);
router.get("/api/members", verifyToken, isLibrary, canManageLibraryIssues, memberCtrl.searchMembers);

router.get("/profile", verifyToken, isLibrary, dashboardCtrl.profilePage);
router.post("/profile/update", verifyToken, isLibrary, dashboardCtrl.updateProfile);
router.get("/notices", verifyToken, isLibrary, dashboardCtrl.noticesPage);

router.get('/leaves', verifyToken, isLibrarian, leaveController.getLeaves);
router.post('/leaves/apply', verifyToken, isLibrarian, leaveController.applyLeave);

router.get('/chat', verifyToken, isLibrary, chatController.getChatPage);
router.get('/chat/history/:receiverId', verifyToken, isLibrary, chatController.getChatHistory);
router.post('/chat/send', verifyToken, isLibrary, chatController.sendMessage);

// Delete message
router.delete('/chat/message/:messageId', verifyToken, isLibrarian, chatController.deleteMessage);

// Search messages
router.get('/chat/search', verifyToken, isLibrarian, chatController.searchMessages);

// Get unread count (API)
router.get('/api/chat/unread-count', verifyToken, isLibrarian, chatController.getUnreadCount);

// Mark all read from a sender
router.post('/chat/mark-all-read', verifyToken, isLibrarian, chatController.markAllRead);

module.exports = router;
