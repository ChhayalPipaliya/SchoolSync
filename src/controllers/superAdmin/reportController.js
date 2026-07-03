const { queryAsync } = require("../../config/database");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");

const reportController = {
    index: async (req, res) => {
        try {
            const revenueByMonth = await queryAsync(`
                SELECT 
                    DATE_FORMAT(paid_at, '%Y-%m') as month,
                    COALESCE(SUM(total_amount), 0) as revenue
                FROM subscription_payments
                WHERE status = 'completed'
                  AND paid_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
                GROUP BY DATE_FORMAT(paid_at, '%Y-%m')
                ORDER BY month
            `);

            const schoolsByPlan = await queryAsync(`
                SELECT 
                    plan,
                    COUNT(*) as count
                FROM schools
                GROUP BY plan
            `);

            const usersByRole = await queryAsync(`
                SELECT 
                    role,
                    COUNT(*) as count
                FROM users
                WHERE deleted_at IS NULL
                GROUP BY role
            `);

            const libraryStats = await queryAsync(`
                SELECT 
                    s.id,
                    s.school_name,
                    (SELECT COUNT(*) FROM library_books WHERE school_id = s.id) as total_books,
                    (SELECT COALESCE(SUM(total_copies), 0) FROM library_books WHERE school_id = s.id) as total_copies,
                    (SELECT COALESCE(SUM(available_copies), 0) FROM library_books WHERE school_id = s.id) as available_copies,
                    (SELECT COUNT(*) FROM library_issues WHERE school_id = s.id AND status IN ('issued', 'renewed')) as issued_books,
                    (SELECT COUNT(*) FROM library_issues WHERE school_id = s.id AND status = 'overdue') as overdue_books,
                    (SELECT COALESCE(SUM(paid_amount), 0) FROM library_fines WHERE school_id = s.id AND status = 'paid') as fine_collection
                FROM schools s
                ORDER BY s.school_name
            `);

            res.render("superAdmin/reports/index", {
                title: "Reports & Analytics - SchoolSync",
                revenueByMonth,
                schoolsByPlan,
                usersByRole,
                libraryStats,
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            console.error("Reports Dashboard Error:", error);
            req.flash("error", "Failed to load reports dashboard");
            res.redirect("/superadmin/dashboard");
        }
    },

    revenue: async (req, res) => {
        try {
            const { year = new Date().getFullYear() } = req.query;

            const monthlyRevenue = await queryAsync(`
                SELECT 
                    MONTH(paid_at) as month,
                    COALESCE(SUM(total_amount), 0) as amount,
                    COUNT(*) as transactions
                FROM subscription_payments
                WHERE status = 'completed' AND YEAR(paid_at) = ?
                GROUP BY MONTH(paid_at)
                ORDER BY month
            `, [year]);

            const planRevenue = await queryAsync(`
                SELECT 
                    p.name,
                    COALESCE(SUM(sp.total_amount), 0) as amount,
                    COUNT(*) as transactions
                FROM subscription_payments sp
                JOIN plans p ON sp.plan_id = p.id
                WHERE sp.status = 'completed' AND YEAR(sp.paid_at) = ?
                GROUP BY p.id
            `, [year]);

            res.render("superAdmin/reports/revenue", {
                title: "Revenue Report - SchoolSync",
                year,
                monthlyRevenue,
                planRevenue,
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            req.flash("error", "Failed to load revenue report");
            res.redirect("/superadmin/dashboard");
        }
    },

    schoolsGrowth: async (req, res) => {
        try {
            const monthlyGrowth = await queryAsync(`
                SELECT 
                    DATE_FORMAT(created_at, '%Y-%m') as month,
                    COUNT(*) as new_schools,
                    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_count
                FROM schools
                WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)
                GROUP BY DATE_FORMAT(created_at, '%Y-%m')
                ORDER BY month
            `);

            const planDistribution = await queryAsync(`
                SELECT 
                    p.name,
                    COUNT(s.id) as count,
                    ROUND(COUNT(s.id) * 100.0 / (SELECT COUNT(*) FROM schools), 2) as percentage
                FROM plans p
                LEFT JOIN schools s ON s.plan_id = p.id
                GROUP BY p.id
            `);

            res.render("superAdmin/reports/schools", {
                title: "Schools Report - SchoolSync",
                monthlyGrowth,
                planDistribution,
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            req.flash("error", "Failed to load schools report");
            res.redirect("/superadmin/dashboard");
        }
    },

    exportExcel: async (req, res) => {
        try {
            const { report = 'revenue', from, to } = req.query;

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Report');

            if (report === 'revenue') {
                const data = await queryAsync(`
                    SELECT sp.*, s.school_name, p.name as plan_name
                    FROM subscription_payments sp
                    JOIN schools s ON sp.school_id = s.id
                    JOIN plans p ON sp.plan_id = p.id
                    WHERE sp.status = 'completed'
                    ${from ? 'AND sp.paid_at >= ?' : ''}
                    ${to ? 'AND sp.paid_at <= ?' : ''}
                    ORDER BY sp.paid_at DESC
                `, [from, to].filter(Boolean));

                worksheet.columns = [
                    { header: 'Receipt No', key: 'receipt_no' },
                    { header: 'School', key: 'school_name' },
                    { header: 'Plan', key: 'plan_name' },
                    { header: 'Amount', key: 'total_amount' },
                    { header: 'Date', key: 'paid_at' },
                    { header: 'Method', key: 'payment_method' }
                ];

                worksheet.addRows(data);
            }

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=${report}_report.xlsx`);

            await workbook.xlsx.write(res);
            res.end();
        } catch (error) {
            req.flash("error", "Export failed");
            res.redirect("/superadmin/reports/revenue");
        }
    }
};

module.exports = reportController;