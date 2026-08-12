const express = require('express');
const router = express.Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const { requirePlanFeature } = require('../middleware/planAccess');
const { uploadLimiter } = require('../middleware/rateLimit');
const bulkImportController = require('../controllers/schoolAdmin/bulkImportController');
const bulkExportController = require('../controllers/schoolAdmin/bulkExportController');
const templateController = require('../controllers/schoolAdmin/templateController');

router.get('/schooladmin/imports', verifyToken, requireRole(['school_admin', 'super_admin']), requirePlanFeature('bulk_import'), bulkImportController.renderImportDashboard);
router.get('/schooladmin/exports', verifyToken, requireRole(['school_admin', 'super_admin', 'teacher']), requirePlanFeature('bulk_export'), bulkExportController.renderExportDashboard);

router.post('/api/import/:entityType', verifyToken, requireRole(['school_admin', 'super_admin']), requirePlanFeature('bulk_import'), uploadLimiter, bulkImportController.importEntity);
router.get('/api/import/status/:jobId', verifyToken, requireRole(['school_admin', 'super_admin']), requirePlanFeature('bulk_import'), bulkImportController.getJobStatus);
router.get('/api/import/logs', verifyToken, requireRole(['school_admin', 'super_admin']), requirePlanFeature('bulk_import'), bulkImportController.getLogs);
router.get('/api/templates/:entityType', verifyToken, requireRole(['school_admin', 'super_admin']), requirePlanFeature('bulk_import'), templateController.downloadTemplate);

router.post('/api/export/:entityType', verifyToken, requireRole(['school_admin', 'super_admin', 'teacher']), requirePlanFeature('bulk_export'), bulkExportController.exportEntity);
router.get('/api/export/download/:fileName', verifyToken, requireRole(['school_admin', 'super_admin', 'teacher']), requirePlanFeature('bulk_export'), bulkExportController.downloadFile);
router.get('/api/export/logs', verifyToken, requireRole(['school_admin', 'super_admin', 'teacher']), requirePlanFeature('bulk_export'), bulkExportController.getLogs);

module.exports = router;