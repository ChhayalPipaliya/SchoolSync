const express = require('express');
const router = express.Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/rateLimit');
const bulkImportController = require('../controllers/schoolAdmin/bulkImportController');
const bulkExportController = require('../controllers/schoolAdmin/bulkExportController');
const templateController = require('../controllers/schoolAdmin/templateController');

router.get('/schooladmin/imports', verifyToken, requireRole(['school_admin', 'super_admin']), bulkImportController.renderImportDashboard);
router.get('/schooladmin/exports', verifyToken, requireRole(['school_admin', 'super_admin', 'teacher']), bulkExportController.renderExportDashboard);

router.post('/api/import/:entityType', verifyToken, requireRole(['school_admin', 'super_admin']), uploadLimiter, bulkImportController.importEntity);
router.get('/api/import/status/:jobId', verifyToken, requireRole(['school_admin', 'super_admin']), bulkImportController.getJobStatus);
router.get('/api/import/logs', verifyToken, requireRole(['school_admin', 'super_admin']), bulkImportController.getLogs);
router.get('/api/templates/:entityType', verifyToken, requireRole(['school_admin', 'super_admin']), templateController.downloadTemplate);

router.post('/api/export/:entityType', verifyToken, requireRole(['school_admin', 'super_admin', 'teacher']), bulkExportController.exportEntity);
router.get('/api/export/download/:fileName', verifyToken, requireRole(['school_admin', 'super_admin', 'teacher']), bulkExportController.downloadFile);
router.get('/api/export/logs', verifyToken, requireRole(['school_admin', 'super_admin', 'teacher']), bulkExportController.getLogs);

module.exports = router;
