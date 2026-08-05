const { queryAsync } = require("../../config/database");
const { getAccessibleSchoolIds } = require("../../utils/schoolAccess");
const { getGroupAdminContext } = require("../../utils/groupAdminContext");

let schemaInitialized = false;
async function ensureAlertsSchema() {
    if (schemaInitialized) return;
    try {
        await queryAsync(`
            CREATE TABLE IF NOT EXISTS transport_alerts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                school_id INT NOT NULL,
                driver_id INT NOT NULL,
                user_id INT NULL,
                trip_id INT NULL,
                alert_type ENUM('accident', 'breakdown', 'medical', 'hazard', 'general') DEFAULT 'general',
                latitude DECIMAL(10, 8) NULL,
                longitude DECIMAL(11, 8) NULL,
                status ENUM('active', 'acknowledged', 'resolved') DEFAULT 'active',
                pin VARCHAR(10) NOT NULL,
                notes TEXT NULL,
                acknowledged_at DATETIME NULL,
                resolved_at DATETIME NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                KEY idx_school_driver (school_id, driver_id),
                KEY idx_status (status),
                KEY idx_trip (trip_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        schemaInitialized = true;
    } catch (err) {
        console.error('[SOS Schema Init Error]:', err.message);
    };
};

async function getBaseContext(req) {
    const rawSchoolIds = await getAccessibleSchoolIds(req.user) || [];
    const groupContext = await getGroupAdminContext(req.user.id);
    
    let branches = [];
    if (rawSchoolIds.length > 0) {
        const placeholders = rawSchoolIds.map(() => "?").join(",");
        branches = await queryAsync(`
            SELECT id, school_name, branch_name, area, status 
            FROM schools 
            WHERE id IN (${placeholders}) 
            ORDER BY school_name ASC, branch_name ASC
        `, rawSchoolIds);
    };
    
    const activeBranches = branches.filter(b => b.status !== 'suspended' && b.status !== 'inactive');
    const schoolIds = activeBranches.map(b => b.id);
    const selectedBranchId = req.query.branchId ? parseInt(req.query.branchId, 10) : null;
    const activeBranchId = (selectedBranchId && schoolIds.includes(selectedBranchId)) ? selectedBranchId : null;
    
    return {
        schoolIds,
        groupContext,
        branches: activeBranches,
        activeBranchId,
        filterIds: activeBranchId ? [activeBranchId] : schoolIds
    };
};

const alertsController = {
    getAlertsPage: async (req, res) => {
        try {
            await ensureAlertsSchema();
            const { schoolIds, groupContext, branches, activeBranchId, filterIds } = await getBaseContext(req);

            const page = Math.max(1, parseInt(req.query.page, 10) || 1);
            const limit = 25;
            const offset = (page - 1) * limit;

            if (schoolIds.length === 0) {
                return res.render("groupAdmin/alerts", {
                    title: "Safety Alerts - Group Admin",
                    alerts: [],
                    branches: [],
                    groupContext,
                    activeBranchId: null,
                    user: req.user,
                    currentPath: "/groupadmin/alerts",
                    currentPage: 1,
                    totalPages: 0,
                    limit,
                    total: 0,
                    req
                });
            };

            const placeholders = filterIds.map(() => "?").join(",");
            const [countRow] = await queryAsync(`
                SELECT COUNT(*) AS total
                FROM transport_alerts ta
                JOIN schools sc ON sc.id = ta.school_id
                LEFT JOIN drivers d ON d.id = ta.driver_id
                LEFT JOIN users u ON u.id = d.user_id
                WHERE ta.school_id IN (${placeholders})
            `, filterIds);
            const total = countRow?.total || 0;
            const totalPages = Math.ceil(total / limit);

            const alerts = await queryAsync(`
                SELECT ta.*,
                    sc.school_name, sc.branch_name,
                    u.first_name AS driver_first_name, u.last_name AS driver_last_name
                FROM transport_alerts ta
                JOIN schools sc ON sc.id = ta.school_id
                LEFT JOIN drivers d ON d.id = ta.driver_id
                LEFT JOIN users u ON u.id = d.user_id
                WHERE ta.school_id IN (${placeholders})
                ORDER BY ta.created_at DESC
                LIMIT ? OFFSET ?
            `, [...filterIds, limit, offset]);

            res.render("groupAdmin/alerts", {
                title: "Safety Alerts - Group Admin",
                alerts,
                branches,
                groupContext,
                activeBranchId,
                user: req.user,
                currentPath: "/groupadmin/alerts",
                currentPage: page,
                totalPages,
                limit,
                total,
                req
            });
        } catch (error) {
            console.error("Safety Alerts Page Error:", error);
            req.flash("error", "Failed to load safety alerts page.");
            res.redirect("/groupadmin/dashboard");
        };
    }
};

module.exports = alertsController;