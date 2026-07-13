const { queryAsync } = require("../../config/database");
const { getAccessibleSchoolIds, canAccessSchool } = require("../../utils/schoolAccess");
const { getGroupAdminContext } = require("../../utils/groupAdminContext");
const { getSubscriptionState } = require("../../services/subscriptionService");

async function checkSubscriptionForBranch(req, res, schoolId, featureName = null) {
    if (!schoolId) return true;
    try {
        const state = await getSubscriptionState(schoolId);
        if (state && state.school && (state.school.status === 'suspended' || state.school.status === 'inactive')) {
            const message = "Your school account has been suspended or deactivated. Please contact support.";
            if (req.accepts("json") && !req.accepts("html")) {
                res.status(403).json({ success: false, message, code: "SCHOOL_SUSPENDED" });
            } else {
                req.flash("error", message);
                res.redirect("/groupadmin/dashboard");
            }
            return false;
        }

        if (featureName) {
            const hasFeatureFn = state && typeof state.hasFeature === "function";
            const allowed = hasFeatureFn ? state.hasFeature(featureName) : false;
            if (!allowed) {
                const FEATURE_NAMES = {
                    dashboard: "Dashboard",
                    students: "Students",
                    teachers: "Teachers",
                    classes: "Classes",
                    subjects: "Subjects",
                    attendance: "Attendance",
                    library: "Library",
                    transport: "Transport",
                    exams: "Exams",
                    fees: "Fees",
                    reports: "Reports",
                    certificates: "Certificates",
                    homework: "Homework",
                    timetable: "Timetable",
                    hostel: "Hostel",
                    parent_portal: "Parent Portal",
                    student_portal: "Student Portal",
                    salary: "Salary",
                    payroll: "Payroll",
                    analytics: "Analytics",
                    settings: "Settings"
                };
                const readableName = FEATURE_NAMES[featureName] || featureName;
                const message = `${readableName} is not included in this branch's current plan.`;
                
                if (req.accepts("json") && !req.accepts("html")) {
                    res.status(403).json({ success: false, message, code: "FEATURE_LOCKED" });
                } else {
                    req.flash("error", message);
                    res.redirect("/groupadmin/dashboard");
                };
                return false;
            };
        };
    } catch (err) {
        console.error("Subscription check error:", err);
    };
    return true;
}

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

const dashboardController = {
    getDashboard: async (req, res) => {
        try {
            const { schoolIds, groupContext, branches, activeBranchId, filterIds } = await getBaseContext(req);

            if (schoolIds.length === 0) {
                return res.render("groupAdmin/dashboard", {
                    title: "Dashboard - Group Admin",
                    branches: [],
                    stats: { total_branches: 0, total_students: 0, total_teachers: 0, today_attendance_pct: 0, monthly_fees: 0, pending_fees: 0, active_buses: 0, library_books: 0 },
                    user: req.user,
                    currentPath: "/groupadmin/dashboard",
                    groupContext,
                    activeBranchId: null,
                    branchesList: []
                });
            };

            const placeholders = filterIds.map(() => "?").join(",");
            const branchesList = await queryAsync(`
                SELECT
                    s.id, s.school_name, s.branch_name, s.area, s.branch_code, s.status, s.plan,
                    COUNT(DISTINCT st.id) AS student_count,
                    COUNT(DISTINCT CASE WHEN tu.status = 'active' AND tu.deleted_at IS NULL THEN t.id END) AS teacher_count,
                    GROUP_CONCAT(DISTINCT m.name ORDER BY m.name SEPARATOR ', ') AS mediums
                FROM schools s
                LEFT JOIN students st ON st.school_id = s.id AND st.status = 'active'
                LEFT JOIN teachers t ON t.school_id = s.id
                LEFT JOIN users tu ON tu.id = t.user_id
                LEFT JOIN school_mediums sm ON sm.school_id = s.id
                LEFT JOIN mediums m ON m.id = sm.medium_id
                WHERE s.id IN (${placeholders})
                GROUP BY s.id
                ORDER BY s.school_name ASC, s.branch_name ASC
            `, filterIds);

            const [studentRow] = await queryAsync(
                `SELECT COUNT(*) AS count FROM students WHERE school_id IN (${placeholders}) AND status = 'active'`,
                filterIds
            );
            const [teacherRow] = await queryAsync(
                `SELECT COUNT(*) AS count
                FROM teachers t
                JOIN users u ON u.id = t.user_id
                WHERE t.school_id IN (${placeholders})
                    AND u.status = 'active'
                    AND u.deleted_at IS NULL`,
                filterIds
            );
            const [attRow] = await queryAsync(
                `SELECT COUNT(*) AS total, SUM(CASE WHEN status IN ('present', 'late') THEN 1 ELSE 0 END) AS present FROM attendance WHERE school_id IN (${placeholders}) AND date = CURDATE()`,
                filterIds
            );
            const [feesRow] = await queryAsync(
                `SELECT SUM(amount) AS collected FROM fee_payments WHERE school_id IN (${placeholders}) AND status IN ('completed', 'paid') AND MONTH(payment_date) = MONTH(CURDATE()) AND YEAR(payment_date) = YEAR(CURDATE())`,
                filterIds
            );
            const [pendingRow] = await queryAsync(
                `SELECT SUM(total_amount - paid_amount) AS pending FROM student_fees WHERE school_id IN (${placeholders}) AND status IN ('pending', 'partial')`,
                filterIds
            );
            const [busRow] = await queryAsync(
                `SELECT COUNT(*) AS count FROM vehicles WHERE school_id IN (${placeholders}) AND status = 'active'`,
                filterIds
            );
            const [bookRow] = await queryAsync(
                `SELECT SUM(total_copies) AS count FROM library_books WHERE school_id IN (${placeholders}) AND status = 'active'`,
                filterIds
            );
            const [ticketRow] = await queryAsync(
                `SELECT COUNT(*) AS count FROM support_tickets WHERE school_id IN (${placeholders}) AND status IN ('open', 'in_progress')`,
                filterIds
            );

            const totalAtt = Number(attRow?.total || 0);
            const presentAtt = Number(attRow?.present || 0);

            const stats = {
                total_branches: branches.length,
                total_students: studentRow?.count || 0,
                total_teachers: teacherRow?.count || 0,
                today_attendance_pct: totalAtt > 0 ? ((presentAtt / totalAtt) * 100).toFixed(1) : 0,
                monthly_fees: feesRow?.collected || 0.00,
                pending_fees: pendingRow?.pending || 0.00,
                active_buses: busRow?.count || 0,
                library_books: bookRow?.count || 0,
                open_tickets: ticketRow?.count || 0
            };

            res.render("groupAdmin/dashboard", {
                title: "Dashboard - Group Admin",
                branches,
                stats,
                user: req.user,
                currentPath: "/groupadmin/dashboard",
                groupContext,
                activeBranchId,
                branchesList
            });
        } catch (error) {
            console.error("Group Admin Dashboard Error:", error);
            req.flash("error", "Failed to load dashboard.");
            res.redirect("/");
        };
    },

    getBranchesPage: async (req, res) => {
        try {
            const { schoolIds, groupContext, branches, activeBranchId, filterIds } = await getBaseContext(req);

            if (schoolIds.length === 0) {
                return res.render("groupAdmin/branches", {
                    title: "Branches - Group Admin",
                    branches: [],
                    branchesList: [],
                    stats: { total_branches: 0, total_students: 0, total_teachers: 0, pending_fees: 0 },
                    user: req.user,
                    currentPath: "/groupadmin/branches",
                    groupContext,
                    activeBranchId: null
                });
            };

            const placeholders = filterIds.map(() => "?").join(",");
            const branchesList = await queryAsync(`
                SELECT
                    s.id,
                    s.school_name,
                    s.branch_name,
                    s.branch_code,
                    s.area,
                    s.status,
                    s.plan,
                    (
                        SELECT COUNT(*)
                        FROM students st
                        WHERE st.school_id = s.id
                            AND st.status = 'active'
                    ) AS student_count,
                    (
                        SELECT COUNT(*)
                        FROM teachers t
                        JOIN users tu ON tu.id = t.user_id
                        WHERE t.school_id = s.id
                            AND tu.status = 'active'
                            AND tu.deleted_at IS NULL
                    ) AS teacher_count,
                    (
                        SELECT COUNT(*)
                        FROM vehicles v
                        WHERE v.school_id = s.id
                            AND v.status = 'active'
                    ) AS active_buses,
                    (
                        SELECT COALESCE(SUM(lb.total_copies), 0)
                        FROM library_books lb
                        WHERE lb.school_id = s.id
                            AND lb.status = 'active'
                    ) AS library_books,
                    (
                        SELECT COALESCE(SUM(sf.total_amount - sf.paid_amount), 0)
                        FROM student_fees sf
                        WHERE sf.school_id = s.id
                            AND sf.status IN ('pending', 'partial')
                    ) AS pending_fees
                FROM schools s
                WHERE s.id IN (${placeholders})
                ORDER BY s.school_name ASC, s.branch_name ASC
            `, filterIds);

            const stats = branchesList.reduce((acc, branch) => {
                acc.total_students += Number(branch.student_count || 0);
                acc.total_teachers += Number(branch.teacher_count || 0);
                acc.pending_fees += Number(branch.pending_fees || 0);
                return acc;
            }, {
                total_branches: branchesList.length,
                total_students: 0,
                total_teachers: 0,
                pending_fees: 0
            });

            return res.render("groupAdmin/branches", {
                title: "Branches - Group Admin",
                branches,
                branchesList,
                stats,
                user: req.user,
                currentPath: "/groupadmin/branches",
                groupContext,
                activeBranchId
            });
        } catch (error) {
            console.error("Branches Page Error:", error);
            req.flash("error", "Failed to load branches page.");
            return res.redirect("/groupadmin/dashboard");
        };
    },

    getBranchOverview: async (req, res) => {
        try {
            const schoolId = parseInt(req.params.schoolId, 10);
            const hasAccess = await canAccessSchool(req.user, schoolId);
            if (!hasAccess) {
                return res.status(403).render("errors/403", {
                    title: "Access Denied",
                    user: req.user,
                });
            };

            if (!(await checkSubscriptionForBranch(req, res, schoolId, "dashboard"))) return;

            const [school] = await queryAsync(`
                SELECT s.*, sg.group_name
                FROM schools s
                LEFT JOIN school_groups sg ON sg.id = s.school_group_id
                WHERE s.id = ? LIMIT 1
            `, [schoolId]);

            if (!school) {
                req.flash("error", "Branch not found.");
                return res.redirect("/groupadmin/dashboard");
            };

            const mediums = await queryAsync(
                `SELECT m.name FROM school_mediums sm
                JOIN mediums m ON m.id = sm.medium_id
                WHERE sm.school_id = ?`,
                [schoolId]
            );

            const [studentCount] = await queryAsync(
                "SELECT COUNT(*) AS total FROM students WHERE school_id = ? AND status = 'active'",
                [schoolId]
            );

            const [teacherCount] = await queryAsync(
                `SELECT COUNT(*) AS total FROM teachers t
                JOIN users u ON u.id = t.user_id
                WHERE t.school_id = ? AND u.status = 'active' AND u.deleted_at IS NULL`,
                [schoolId]
            );

            const [feeStats] = await queryAsync(
                `SELECT
                    COUNT(*) AS total_fees,
                    SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid_fees,
                    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_fees,
                    SUM(total_amount) AS total_amount,
                    SUM(paid_amount) AS paid_amount
                FROM student_fees WHERE school_id = ?`,
                [schoolId]
            );

            const [transportStats] = await queryAsync(
                "SELECT COUNT(*) AS total_vehicles FROM vehicles WHERE school_id = ? AND status = 'active'",
                [schoolId]
            );

            const [routesCount] = await queryAsync(
                "SELECT COUNT(*) AS total FROM routes WHERE school_id = ? AND status = 'active'",
                [schoolId]
            );

            const [driversCount] = await queryAsync(
                `SELECT COUNT(*) AS total FROM drivers t
                JOIN users u ON u.id = t.user_id
                WHERE u.school_id = ? AND u.status = 'active'`,
                [schoolId]
            );

            const [libraryStats] = await queryAsync(
                `SELECT COUNT(*) AS total_books, SUM(total_copies - available_copies) AS issued_books 
                 FROM library_books WHERE school_id = ? AND status = 'active'`,
                [schoolId]
            );

            const [overdueCount] = await queryAsync(
                "SELECT COUNT(*) AS total FROM library_issues WHERE school_id = ? AND status = 'overdue'",
                [schoolId]
            );

            const [finesStats] = await queryAsync(
                "SELECT SUM(amount - paid_amount) AS total FROM library_fines WHERE school_id = ? AND status IN ('pending', 'partial')",
                [schoolId]
            );

            const [classesCount] = await queryAsync(
                "SELECT COUNT(*) AS total FROM classes WHERE school_id = ?",
                [schoolId]
            );

            const [subjectsCount] = await queryAsync(
                "SELECT COUNT(*) AS total FROM subjects WHERE school_id = ? AND status = 'active'",
                [schoolId]
            );

            const [todayAtt] = await queryAsync(
                `SELECT COUNT(*) AS total, SUM(CASE WHEN status IN ('present', 'late') THEN 1 ELSE 0 END) AS present 
                 FROM attendance WHERE school_id = ? AND date = CURDATE()`,
                [schoolId]
            );

            res.render("groupAdmin/branchOverview", {
                title: `${school.school_name} Overview`,
                school,
                mediums,
                studentCount: studentCount?.total || 0,
                teacherCount: teacherCount?.total || 0,
                classesCount: classesCount?.total || 0,
                subjectsCount: subjectsCount?.total || 0,
                todayAtt: todayAtt || { total: 0, present: 0 },
                feeStats: feeStats || { total_amount: 0, paid_amount: 0 },
                transportStats: {
                    total_vehicles: transportStats?.total_vehicles || 0,
                    total_routes: routesCount?.total || 0,
                    total_drivers: driversCount?.total || 0
                },
                libraryStats: {
                    total_books: libraryStats?.total_books || 0,
                    issued_books: libraryStats?.issued_books || 0,
                    overdue_books: overdueCount?.total || 0,
                    pending_fines: finesStats?.total || 0.00
                },
                user: req.user,
                currentPath: "/groupadmin/dashboard",
            });
        } catch (error) {
            console.error("Branch Overview Error:", error);
            req.flash("error", "Failed to load branch overview.");
            res.redirect("/groupadmin/dashboard");
        };
    },

    getStudentsPage: async (req, res) => {
        try {
            const { schoolIds, groupContext, branches, activeBranchId, filterIds } = await getBaseContext(req);
            const requestedSchoolId = (req.query.branchId ? parseInt(req.query.branchId, 10) : null) || (schoolIds.length === 1 ? schoolIds[0] : null);
            if (requestedSchoolId && !(await checkSubscriptionForBranch(req, res, requestedSchoolId, "students"))) return;
            if (schoolIds.length === 0) {
                return res.render("groupAdmin/students", { title: "Students - Group Admin", students: [], branches: [], groupContext, activeBranchId: null, user: req.user, currentPath: "/groupadmin/students" });
            };

            const placeholders = filterIds.map(() => "?").join(",");
            const students = await queryAsync(`
                SELECT s.id, s.roll_no, s.admission_no, s.standard,
                    u.first_name, u.last_name, u.email, u.phone, u.status,
                    sc.school_name, sc.branch_name
                FROM students s
                JOIN users u ON s.user_id = u.id
                JOIN schools sc ON sc.id = s.school_id
                WHERE s.school_id IN (${placeholders}) AND s.deleted_at IS NULL
                ORDER BY sc.school_name ASC, s.id DESC
                LIMIT 100
            `, filterIds);

            res.render("groupAdmin/students", {
                title: "Students - Group Admin",
                students,
                branches,
                groupContext,
                activeBranchId,
                user: req.user,
                currentPath: "/groupadmin/students"
            });
        } catch (error) {
            console.error("Students Page Error:", error);
            req.flash("error", "Failed to load students page.");
            res.redirect("/groupadmin/dashboard");
        };
    },

    getTeachersPage: async (req, res) => {
        try {
            const { schoolIds, groupContext, branches, activeBranchId, filterIds } = await getBaseContext(req);
            const requestedSchoolId = (req.query.branchId ? parseInt(req.query.branchId, 10) : null) || (schoolIds.length === 1 ? schoolIds[0] : null);
            if (requestedSchoolId && !(await checkSubscriptionForBranch(req, res, requestedSchoolId, "teachers"))) return;
            if (schoolIds.length === 0) {
                return res.render("groupAdmin/teachers", { title: "Teachers - Group Admin", teachers: [], branches: [], groupContext, activeBranchId: null, user: req.user, currentPath: "/groupadmin/teachers" });
            };

            const placeholders = filterIds.map(() => "?").join(",");
            const teachers = await queryAsync(`
                SELECT t.id, COALESCE(NULLIF(t.subject, ''), NULLIF(t.qualification, ''), 'Teacher') AS designation,
                    u.first_name, u.last_name, u.email, u.phone, u.status,
                    sc.school_name, sc.branch_name
                FROM teachers t
                JOIN users u ON t.user_id = u.id
                JOIN schools sc ON sc.id = t.school_id
                WHERE t.school_id IN (${placeholders}) AND u.deleted_at IS NULL
                ORDER BY sc.school_name ASC, t.id DESC
                LIMIT 100
            `, filterIds);

            res.render("groupAdmin/teachers", {
                title: "Teachers - Group Admin",
                teachers,
                branches,
                groupContext,
                activeBranchId,
                user: req.user,
                currentPath: "/groupadmin/teachers"
            });
        } catch (error) {
            console.error("Teachers Page Error:", error);
            req.flash("error", "Failed to load teachers page.");
            res.redirect("/groupadmin/dashboard");
        };
    },

    getAttendancePage: async (req, res) => {
        try {
            const { schoolIds, groupContext, branches, activeBranchId, filterIds } = await getBaseContext(req);
            const requestedSchoolId = (req.query.branchId ? parseInt(req.query.branchId, 10) : null) || (schoolIds.length === 1 ? schoolIds[0] : null);
            if (requestedSchoolId && !(await checkSubscriptionForBranch(req, res, requestedSchoolId, "attendance"))) return;
            if (schoolIds.length === 0) {
                return res.render("groupAdmin/attendance", { title: "Attendance - Group Admin", attendance: [], branches: [], groupContext, activeBranchId: null, user: req.user, currentPath: "/groupadmin/attendance" });
            };

            const placeholders = filterIds.map(() => "?").join(",");
            const attendance = await queryAsync(`
                SELECT a.id, a.date, a.status AS att_status,
                    u.first_name, u.last_name, s.roll_no,
                    sc.school_name, sc.branch_name
                FROM attendance a
                JOIN students s ON a.student_id = s.id
                JOIN users u ON s.user_id = u.id
                JOIN schools sc ON sc.id = a.school_id
                WHERE a.school_id IN (${placeholders})
                ORDER BY a.date DESC, sc.school_name ASC
                LIMIT 100
            `, filterIds);

            res.render("groupAdmin/attendance", {
                title: "Attendance - Group Admin",
                attendance,
                branches,
                groupContext,
                activeBranchId,
                user: req.user,
                currentPath: "/groupadmin/attendance"
            });
        } catch (error) {
            console.error("Attendance Page Error:", error);
            req.flash("error", "Failed to load attendance page.");
            res.redirect("/groupadmin/dashboard");
        };
    },

    getFeesPage: async (req, res) => {
        try {
            const { schoolIds, groupContext, branches, activeBranchId, filterIds } = await getBaseContext(req);
            const requestedSchoolId = (req.query.branchId ? parseInt(req.query.branchId, 10) : null) || (schoolIds.length === 1 ? schoolIds[0] : null);
            if (requestedSchoolId && !(await checkSubscriptionForBranch(req, res, requestedSchoolId, "fees"))) return;
            if (schoolIds.length === 0) {
                return res.render("groupAdmin/fees", { title: "Fees - Group Admin", fees: [], branches: [], groupContext, activeBranchId: null, user: req.user, currentPath: "/groupadmin/fees" });
            };

            const placeholders = filterIds.map(() => "?").join(",");
            const fees = await queryAsync(`
                SELECT sf.id, sf.fee_month, sf.total_amount, sf.paid_amount, sf.status AS fee_status,
                    u.first_name, u.last_name,
                    sc.school_name, sc.branch_name
                FROM student_fees sf
                JOIN students s ON sf.student_id = s.id
                JOIN users u ON s.user_id = u.id
                JOIN schools sc ON sc.id = sf.school_id
                WHERE sf.school_id IN (${placeholders})
                ORDER BY sf.due_date DESC, sc.school_name ASC
                LIMIT 100
            `, filterIds);

            res.render("groupAdmin/fees", {
                title: "Fees - Group Admin",
                fees,
                branches,
                groupContext,
                activeBranchId,
                user: req.user,
                currentPath: "/groupadmin/fees"
            });
        } catch (error) {
            console.error("Fees Page Error:", error);
            req.flash("error", "Failed to load fees page.");
            res.redirect("/groupadmin/dashboard");
        }
    },

    getTransportPage: async (req, res) => {
        try {
            const { schoolIds, groupContext, branches, activeBranchId, filterIds } = await getBaseContext(req);
            const requestedSchoolId = (req.query.branchId ? parseInt(req.query.branchId, 10) : null) || (schoolIds.length === 1 ? schoolIds[0] : null);
            if (requestedSchoolId && !(await checkSubscriptionForBranch(req, res, requestedSchoolId, "transport"))) return;
            if (schoolIds.length === 0) {
                return res.render("groupAdmin/transport", { title: "Transport - Group Admin", vehicles: [], branches: [], groupContext, activeBranchId: null, user: req.user, currentPath: "/groupadmin/transport" });
            }

            const placeholders = filterIds.map(() => "?").join(",");
            const vehicles = await queryAsync(`
                SELECT v.id, v.vehicle_number, v.model, v.type, v.capacity, v.status AS vehicle_status,
                    sc.school_name, sc.branch_name
                FROM vehicles v
                JOIN schools sc ON sc.id = v.school_id
                WHERE v.school_id IN (${placeholders})
                ORDER BY sc.school_name ASC, v.id DESC
                LIMIT 100
            `, filterIds);

            res.render("groupAdmin/transport", {
                title: "Transport - Group Admin",
                vehicles,
                branches,
                groupContext,
                activeBranchId,
                user: req.user,
                currentPath: "/groupadmin/transport"
            });
        } catch (error) {
            console.error("Transport Page Error:", error);
            req.flash("error", "Failed to load transport page.");
            res.redirect("/groupadmin/dashboard");
        };
    },

    getLibraryPage: async (req, res) => {
        try {
            const { schoolIds, groupContext, branches, activeBranchId, filterIds } = await getBaseContext(req);
            const requestedSchoolId = (req.query.branchId ? parseInt(req.query.branchId, 10) : null) || (schoolIds.length === 1 ? schoolIds[0] : null);
            if (requestedSchoolId && !(await checkSubscriptionForBranch(req, res, requestedSchoolId, "library"))) return;
            if (schoolIds.length === 0) {
                return res.render("groupAdmin/library", { title: "Library - Group Admin", books: [], branches: [], groupContext, activeBranchId: null, user: req.user, currentPath: "/groupadmin/library" });
            }

            const placeholders = filterIds.map(() => "?").join(",");
            const books = await queryAsync(`
                SELECT b.id, b.title, b.author, b.available_copies, b.total_copies, b.status AS book_status,
                    sc.school_name, sc.branch_name
                FROM library_books b
                JOIN schools sc ON sc.id = b.school_id
                WHERE b.school_id IN (${placeholders})
                ORDER BY sc.school_name ASC, b.id DESC
                LIMIT 100
            `, filterIds);

            res.render("groupAdmin/library", {
                title: "Library - Group Admin",
                books,
                branches,
                groupContext,
                activeBranchId,
                user: req.user,
                currentPath: "/groupadmin/library"
            });
        } catch (error) {
            console.error("Library Page Error:", error);
            req.flash("error", "Failed to load library page.");
            res.redirect("/groupadmin/dashboard");
        };
    },

    getReportsPage: async (req, res) => {
        try {
            const { schoolIds, groupContext, branches, activeBranchId, filterIds } = await getBaseContext(req);
            const requestedSchoolId = (req.query.branchId ? parseInt(req.query.branchId, 10) : null) || (schoolIds.length === 1 ? schoolIds[0] : null);
            if (requestedSchoolId && !(await checkSubscriptionForBranch(req, res, requestedSchoolId, "reports"))) return;
            if (schoolIds.length === 0) {
                return res.render("groupAdmin/reports", { title: "Reports - Group Admin", stats: {}, branches: [], groupContext, activeBranchId: null, user: req.user, currentPath: "/groupadmin/reports" });
            };

            const placeholders = filterIds.map(() => "?").join(",");
            const [strength] = await queryAsync(`SELECT COUNT(*) AS total FROM students WHERE school_id IN (${placeholders}) AND status = 'active'`, filterIds);
            const [attendance] = await queryAsync(`SELECT COUNT(*) AS total, SUM(CASE WHEN status IN ('present', 'late') THEN 1 ELSE 0 END) AS present FROM attendance WHERE school_id IN (${placeholders}) AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`, filterIds);
            const [fees] = await queryAsync(`SELECT SUM(amount) AS collected FROM fee_payments WHERE school_id IN (${placeholders}) AND status IN ('completed', 'paid')`, filterIds);
            const [pending] = await queryAsync(`SELECT SUM(total_amount - paid_amount) AS pending FROM student_fees WHERE school_id IN (${placeholders}) AND status IN ('pending', 'partial')`, filterIds);
            const totalAtt = Number(attendance?.total || 0);
            const presentAtt = Number(attendance?.present || 0);

            const stats = {
                studentStrength: strength?.total || 0,
                attendancePct: totalAtt > 0 ? ((presentAtt / totalAtt) * 100).toFixed(1) : "0.0",
                feesCollected: fees?.collected || 0.00,
                feesPending: pending?.pending || 0.00
            };

            res.render("groupAdmin/reports", {
                title: "Reports - Group Admin",
                stats,
                branches,
                groupContext,
                activeBranchId,
                user: req.user,
                currentPath: "/groupadmin/reports"
            });
        } catch (error) {
            console.error("Reports Page Error:", error);
            req.flash("error", "Failed to load reports page.");
            res.redirect("/groupadmin/dashboard");
        };
    }
};

module.exports = dashboardController;