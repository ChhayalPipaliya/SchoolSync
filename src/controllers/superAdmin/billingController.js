const fs = require("fs");
const path = require("path");
const { queryAsync, executeAsync, withTransaction } = require("../../config/database");
const billingService = require("../../services/billingService");

const billingController = {
    listInvoices: async (req, res) => {
        try {
            const { status, school_id, page = 1 } = req.query;
            const limit = 20;
            const offset = (page - 1) * limit;

            let whereClause = "WHERE 1=1";
            let params = [];

            if (status) {
                whereClause += " AND i.status = ?";
                params.push(status);
            };
            if (school_id) {
                whereClause += " AND i.school_id = ?";
                params.push(school_id);
            };

            const invoices = await queryAsync(`
                SELECT i.*, s.school_name, s.subdomain, p.name as plan_name
                FROM invoices i
                JOIN schools s ON i.school_id = s.id
                LEFT JOIN plans p ON s.plan_id = p.id
                ${whereClause}
                ORDER BY i.created_at DESC
                LIMIT ? OFFSET ?
            `, [...params, limit, offset]);

            const [totalResult] = await queryAsync(`
                SELECT COUNT(*) as total FROM invoices i ${whereClause}
            `, params);

            const schools = await queryAsync("SELECT id, school_name FROM schools ORDER BY school_name");
            res.render("superAdmin/billing/invoices", {
                title: "Invoices & Billing - SchoolSync",
                invoices,
                schools,
                filters: { status, school_id },
                pagination: {
                    page: parseInt(page),
                    totalPages: Math.ceil(totalResult.total / limit),
                    total: totalResult.total
                },
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            console.error("List Invoices Error:", error);
            req.flash("error", "Failed to load invoices");
            res.redirect("/superadmin/dashboard");
        };
    },

    downloadPDF: async (req, res) => {
        try {
            const invoiceId = req.params.id;
            const [invoice] = await queryAsync("SELECT * FROM invoices WHERE id = ?", [invoiceId]);
            
            if (!invoice) {
                req.flash("error", "Invoice not found");
                return res.redirect("/superadmin/billing/invoices");
            };

            const [school] = await queryAsync(`
                SELECT s.*, p.name as plan_name, p.monthly_price as plan_price
                FROM schools s
                JOIN plans p ON s.plan_id = p.id
                WHERE s.id = ?
            `, [invoice.school_id]);

            let pdfPath = invoice.pdf_path;
            let absolutePath = pdfPath ? path.join(__dirname, "../../../storage", pdfPath) : null;
            if (absolutePath && !fs.existsSync(absolutePath)) {
                absolutePath = path.join(__dirname, "../../public", pdfPath);
            };

            if (!absolutePath || !fs.existsSync(absolutePath)) {
                pdfPath = await billingService.generatePDFInvoice(invoice, school);
                await executeAsync("UPDATE invoices SET pdf_path = ? WHERE id = ?", [pdfPath, invoiceId]);
                absolutePath = path.join(__dirname, "../../../storage", pdfPath);
            };

            res.download(absolutePath, `Invoice_${invoice.invoice_no}.pdf`);
        } catch (error) {
            console.error("Download PDF Error:", error);
            req.flash("error", "Failed to download PDF invoice");
            res.redirect("/superadmin/billing/invoices");
        };
    },

    triggerSweep: async (req, res) => {
        try {
            await billingService.runDailyBillingSweep();
            await billingService.runOverduePaymentSweep();
            req.flash("success", "Billing cycle sweep executed successfully. E-Invoices generated and reminders dispatched.");
            res.redirect("/superadmin/billing/invoices");
        } catch (error) {
            console.error("Manual Sweep Error:", error);
            req.flash("error", "Failed to execute billing sweep");
            res.redirect("/superadmin/billing/invoices");
        };
    },

    revenueReports: async (req, res) => {
        try {
            const [mrrRow] = await queryAsync(`
                SELECT COALESCE(SUM(p.monthly_price), 0) as mrr
                FROM schools s
                JOIN plans p ON s.plan_id = p.id
                WHERE s.status = 'active'
            `);
            
            const mrr = parseFloat(mrrRow.mrr);
            const [activeBeginningRow] = await queryAsync(`
                SELECT COUNT(*) as count 
                FROM schools 
                WHERE created_at < DATE_SUB(CURDATE(), INTERVAL 1 MONTH)
            `);
            
            const activeBeginning = parseInt(activeBeginningRow.count) || 1; 
            const [churnedRow] = await queryAsync(`
                SELECT COUNT(*) as count
                FROM schools
                WHERE status IN ('expired', 'inactive')
                  AND updated_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
            `);
            
            const churned = parseInt(churnedRow.count);
            const churnRate = parseFloat(((churned / activeBeginning) * 100).toFixed(2));
            const growthRate = 0.05;
            const forecast = [];
            let currentForecastMRR = mrr;
            
            for (let monthNum = 1; monthNum <= 12; monthNum++) {
                currentForecastMRR = currentForecastMRR * (1 + growthRate);
                const forecastDate = new Date();
                forecastDate.setMonth(forecastDate.getMonth() + monthNum);
                
                forecast.push({
                    month: forecastDate.toLocaleDateString("en-IN", { month: "short", year: "numeric" }),
                    mrr: parseFloat(currentForecastMRR.toFixed(2)),
                    annualized: parseFloat((currentForecastMRR * 12).toFixed(2))
                });
            };

            const paymentHistory = await queryAsync(`
                SELECT 
                    DATE_FORMAT(paid_at, '%b %Y') as month,
                    SUM(total_amount) as amount,
                    COUNT(*) as count
                FROM subscription_payments
                WHERE status = 'completed'
                    AND paid_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
                GROUP BY DATE_FORMAT(paid_at, '%Y-%m'), DATE_FORMAT(paid_at, '%b %Y')
                ORDER BY DATE_FORMAT(paid_at, '%Y-%m')
            `);

            res.render("superAdmin/billing/reports", {
                title: "Financial Dashboard - SchoolSync",
                mrr,
                churnRate,
                forecast,
                paymentHistory,
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            console.error("Revenue Reports Error:", error);
            req.flash("error", "Failed to compile financial reports");
            res.redirect("/superadmin/dashboard");
        };
    },

    getProrationPreview: async (req, res) => {
        try {
            const { schoolId, planId } = req.query;
            if (!schoolId || !planId) {
                return res.status(400).json({ success: false, message: "Missing schoolId or planId" });
            };

            const preview = await billingService.calculateProration(schoolId, planId);
            res.json({ success: true, data: preview });
        } catch (error) {
            console.error("getProrationPreview error:", error);
            res.status(500).json({ success: false, message: "Failed to calculate proration preview" });
        };
    }
};

module.exports = billingController;