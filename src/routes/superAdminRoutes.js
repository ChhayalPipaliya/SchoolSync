const express = require("express");
const router = express.Router();
const { verifyToken, isAdmin } = require("../middleware/auth");
const dashboardController = require("../controllers/superAdmin/dashboardController");
const schoolController = require("../controllers/superAdmin/schoolController");
const schoolGroupController = require("../controllers/superAdmin/schoolGroupController");
const groupAdminController = require("../controllers/superAdmin/groupAdminController");
const subscriptionController = require("../controllers/superAdmin/subscriptionController");
const paymentController = require("../controllers/superAdmin/paymentController");
const userController = require("../controllers/superAdmin/userController");
const planController = require("../controllers/superAdmin/planController");
const reportController = require("../controllers/superAdmin/reportController");
const announcementController = require("../controllers/superAdmin/announcementController");
const supportTicketController = require("../controllers/superAdmin/supportTicketController");
const auditLogController = require("../controllers/superAdmin/auditLogController");
const billingController = require("../controllers/superAdmin/billingController");
const analyticsController = require("../controllers/superAdmin/analyticsController");
const schoolTypeController = require('../controllers/superAdmin/schoolTypeController');
const { schoolUpload } = require("../middleware/upload");

router.get("/dashboard", verifyToken, isAdmin, dashboardController.getDashboard);
router.get("/api/stats", verifyToken, isAdmin, dashboardController.getStatsAPI);
router.get("/api/revenue-chart", verifyToken, isAdmin, dashboardController.getRevenueChart);
router.get("/api/schools-growth", verifyToken, isAdmin, dashboardController.getSchoolsGrowth);
router.post("/alerts/:id/resolve", verifyToken, isAdmin, dashboardController.resolveAlert);

router.get("/analytics", verifyToken, isAdmin, analyticsController.getAnalyticsPage);
router.get("/api/analytics/revenue", verifyToken, isAdmin, analyticsController.getRevenueAnalytics);
router.get("/api/analytics/schools", verifyToken, isAdmin, analyticsController.getSchoolAnalytics);
router.get("/api/analytics/platform", verifyToken, isAdmin, analyticsController.getPlatformAnalytics);
router.get("/api/analytics/support", verifyToken, isAdmin, analyticsController.getSupportAnalytics);


router.get("/schools", verifyToken, isAdmin, schoolController.list);
router.get("/schools/add", verifyToken, isAdmin, schoolController.addForm);

const schoolFields = schoolUpload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'registration_certificate', maxCount: 1 },
    { name: 'affiliation_certificate', maxCount: 1 },
    { name: 'udise', maxCount: 1 },
    { name: 'address_proof', maxCount: 1 },
    { name: 'other_document', maxCount: 1 }
]);

router.post("/schools", verifyToken, isAdmin, schoolFields, schoolController.create);
router.post("/schools/bulk-status", verifyToken, isAdmin, schoolController.bulkStatus);
router.post("/schools/bulk-plan", verifyToken, isAdmin, schoolController.bulkPlan);
router.post("/schools/bulk-email", verifyToken, isAdmin, schoolController.bulkEmail);
router.get("/schools/:id", verifyToken, isAdmin, schoolController.detail);
router.get("/schools/:id/edit", verifyToken, isAdmin, schoolController.editForm);
router.get("/schools/:id/gdpr-export", verifyToken, isAdmin, schoolController.gdprExport);
router.delete("/schools/:id/purge", verifyToken, isAdmin, schoolController.purgeSchool);
router.put("/schools/:id", verifyToken, isAdmin, schoolFields, schoolController.update);
router.delete("/schools/:id", verifyToken, isAdmin, schoolController.delete);
router.post("/schools/:id/toggle", verifyToken, isAdmin, schoolController.toggleStatus);
router.post("/schools/:id/impersonate", verifyToken, isAdmin, schoolController.impersonate);
router.post("/impersonation/stop", verifyToken, schoolController.stopImpersonation);

router.get("/school-groups", verifyToken, isAdmin, schoolGroupController.list);
router.get("/school-groups/add", verifyToken, isAdmin, schoolGroupController.addForm);
router.post("/school-groups", verifyToken, isAdmin, schoolGroupController.create);
router.get("/school-groups/:id/edit", verifyToken, isAdmin, schoolGroupController.editForm);
router.post("/school-groups/:id", verifyToken, isAdmin, schoolGroupController.update);
router.post("/school-groups/:id/status", verifyToken, isAdmin, schoolGroupController.toggleStatus);
router.delete("/school-groups/:id", verifyToken, isAdmin, schoolGroupController.delete);

router.get("/group-admins", verifyToken, isAdmin, groupAdminController.list);
router.get("/group-admins/add", verifyToken, isAdmin, groupAdminController.addForm);
router.post("/group-admins", verifyToken, isAdmin, groupAdminController.create);
router.get("/group-admins/:id/edit", verifyToken, isAdmin, groupAdminController.editForm);
router.post("/group-admins/:id", verifyToken, isAdmin, groupAdminController.update);
router.post("/group-admins/:id/status", verifyToken, isAdmin, groupAdminController.toggleStatus);
router.delete("/group-admins/:id", verifyToken, isAdmin, groupAdminController.delete);

router.get("/subscriptions", verifyToken, isAdmin, subscriptionController.list);
router.get("/subscriptions/expiring", verifyToken, isAdmin, subscriptionController.expiring);
router.get("/subscriptions/assign", verifyToken, isAdmin, subscriptionController.assignForm);
router.post("/subscriptions/assign", verifyToken, isAdmin, subscriptionController.assign);
router.get("/subscriptions/:id", verifyToken, isAdmin, subscriptionController.detail);
router.post("/subscriptions/:id/renew", verifyToken, isAdmin, subscriptionController.renew);
router.post("/subscriptions/:id/cancel", verifyToken, isAdmin, subscriptionController.cancel);
router.post("/subscriptions/:id/change-plan", verifyToken, isAdmin, subscriptionController.changePlan);
router.post("/subscriptions/:id/generate-invoice", verifyToken, isAdmin, subscriptionController.generateInvoice);

router.get("/billing/invoices", verifyToken, isAdmin, billingController.listInvoices);
router.get("/billing/invoices/:id/pdf", verifyToken, isAdmin, billingController.downloadPDF);
router.post("/billing/sweep", verifyToken, isAdmin, billingController.triggerSweep);
router.get("/billing/reports", verifyToken, isAdmin, billingController.revenueReports);
router.get("/api/billing/proration", verifyToken, isAdmin, billingController.getProrationPreview);

router.get("/payments", verifyToken, isAdmin, paymentController.list);
router.get("/payments/:id", verifyToken, isAdmin, paymentController.detail);
router.post("/payments/:id/refund", verifyToken, isAdmin, paymentController.refund);

router.get("/users", verifyToken, isAdmin, userController.list);
router.get("/users/:id", verifyToken, isAdmin, userController.detail);
router.put("/users/:id/role", verifyToken, isAdmin, userController.updateRole);
router.post("/users/:id/status", verifyToken, isAdmin, userController.toggleStatus);
router.post("/users/:id/reset-password", verifyToken, isAdmin, userController.resetPassword);

router.get("/plans", verifyToken, isAdmin, planController.list);
router.get("/plans/add", verifyToken, isAdmin, planController.addForm);
router.post("/plans/add", verifyToken, isAdmin, planController.create);
router.get("/plans/edit/:id", verifyToken, isAdmin, planController.editForm);
router.post("/plans/edit/:id", verifyToken, isAdmin, planController.update);
router.post("/plans/:id/toggle", verifyToken, isAdmin, planController.toggleActive);
router.delete("/plans/:id", verifyToken, isAdmin, planController.delete);

router.get("/reports", verifyToken, isAdmin, reportController.index);
router.get("/reports/revenue", verifyToken, isAdmin, reportController.revenue);
router.get("/reports/schools", verifyToken, isAdmin, reportController.schoolsGrowth);
router.get("/reports/export", verifyToken, isAdmin, reportController.exportExcel);

router.get("/announcements", verifyToken, isAdmin, announcementController.list);
router.get("/announcements/templates", verifyToken, isAdmin, announcementController.listTemplates);
router.post("/announcements/templates", verifyToken, isAdmin, announcementController.createTemplate);
router.delete("/announcements/templates/:id", verifyToken, isAdmin, announcementController.deleteTemplate);
router.get("/announcements/add", verifyToken, isAdmin, announcementController.addForm);
router.post("/announcements", verifyToken, isAdmin, announcementController.create);
router.get("/announcements/:id/edit", verifyToken, isAdmin, announcementController.editForm);
router.put("/announcements/:id", verifyToken, isAdmin, announcementController.update);
router.delete("/announcements/:id", verifyToken, isAdmin, announcementController.delete);
router.post("/announcements/:id/publish", verifyToken, isAdmin, announcementController.publish);

router.get("/support", verifyToken, isAdmin, supportTicketController.list);
router.get("/support/kb", verifyToken, isAdmin, supportTicketController.listArticles);
router.post("/support/kb", verifyToken, isAdmin, supportTicketController.createArticle);
router.put("/support/kb/:id", verifyToken, isAdmin, supportTicketController.updateArticle);
router.delete("/support/kb/:id", verifyToken, isAdmin, supportTicketController.deleteArticle);

router.get("/support/:id", verifyToken, isAdmin, supportTicketController.detail);
router.post("/support/:id/assign", verifyToken, isAdmin, supportTicketController.assign);
router.post("/support/:id/reply", verifyToken, isAdmin, supportTicketController.reply);
router.post("/support/:id/resolve", verifyToken, isAdmin, supportTicketController.resolve);
router.post("/support/:id/close", verifyToken, isAdmin, supportTicketController.close);
router.post("/support/:id/merge", verifyToken, isAdmin, supportTicketController.merge);

router.get("/settings", verifyToken, isAdmin, auditLogController.index);
router.get("/settings/performance", verifyToken, isAdmin, auditLogController.performanceMetrics);
router.get("/settings/audit-logs", verifyToken, isAdmin, auditLogController.auditLogs);
router.get("/settings/platform", verifyToken, isAdmin, auditLogController.platformSettings);
router.put("/settings/platform", verifyToken, isAdmin, auditLogController.updateSettings);
router.get("/settings/impersonation", verifyToken, isAdmin, auditLogController.impersonationLogs);
router.post("/settings/purge-logs", verifyToken, isAdmin, auditLogController.purgeExpiredLogs);

router.get("/settings/emails", verifyToken, isAdmin, auditLogController.emailQueue);
router.post("/settings/emails/retry", verifyToken, isAdmin, auditLogController.retryEmails);
router.post("/settings/emails/clear", verifyToken, isAdmin, auditLogController.purgeEmails);

router.get('/school-types', verifyToken, isAdmin, schoolTypeController.listSchoolTypes);
router.post('/school-types', verifyToken, isAdmin, schoolTypeController.createSchoolType);
router.get('/school-types/:id', verifyToken, isAdmin, schoolTypeController.detailSchoolType);
router.post('/school-types/:id/toggle', verifyToken, isAdmin, schoolTypeController.toggleSchoolType);
router.post('/school-types/:id/mappings', verifyToken, isAdmin, schoolTypeController.addMapping);

module.exports = router;