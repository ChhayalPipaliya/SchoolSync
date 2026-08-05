const { queryAsync } = require("../../config/database");
const { getAccessibleSchoolIds } = require("../../utils/schoolAccess");
const { getGroupAdminContext } = require("../../utils/groupAdminContext");

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

const academicController = {
    getAcademicPage: async (req, res) => {
        try {
            const context = await getBaseContext(req);
            const { groupContext, branches, activeBranchId, filterIds } = context;
            const page = Math.max(1, parseInt(req.query.page, 10) || 1);
            const limit = 25;
            const offset = (page - 1) * limit;

            if (filterIds.length === 0) {
                return res.render("groupAdmin/academic", {
                    title: "Academic Performance - Group Admin | SchoolSync",
                    exams: [],
                    branchSummaries: [],
                    overallStats: {
                        publishedExamCount: 0,
                        avgPassPercent: '0.0',
                        avgMarks: '0.0'
                    },
                    branches: [],
                    groupContext,
                    activeBranchId: null,
                    user: req.user,
                    currentPath: "/groupadmin/academics",
                    currentPage: 1,
                    totalPages: 0,
                    limit,
                    total: 0,
                    req
                });
            };

            const placeholders = filterIds.map(() => "?").join(",");

            const countSql = `
                SELECT COUNT(DISTINCT e.id) AS total
                FROM exams e
                WHERE e.school_id IN (${placeholders}) AND e.is_published = 1
            `;
            const [countRow] = await queryAsync(countSql, filterIds);
            const total = countRow?.total || 0;
            const totalPages = Math.ceil(total / limit);

            const mainSql = `
                SELECT e.school_id, sc.school_name, sc.branch_name, e.id AS exam_id, e.name AS exam_name,
                    e.start_date,
                    COUNT(DISTINCT m.student_id) AS total_marked,
                    SUM(CASE WHEN m.status = 'pass' THEN 1 ELSE 0 END) AS total_pass,
                    SUM(CASE WHEN m.status = 'fail' THEN 1 ELSE 0 END) AS total_fail,
                    AVG(m.obtained_marks) AS avg_marks
                FROM exams e
                JOIN schools sc ON sc.id = e.school_id
                LEFT JOIN marks m ON m.exam_id = e.id AND m.school_id = e.school_id
                WHERE e.school_id IN (${placeholders}) AND e.is_published = 1
                GROUP BY e.id
                ORDER BY e.start_date DESC
                LIMIT ? OFFSET ?
            `;
            const rawExams = await queryAsync(mainSql, [...filterIds, limit, offset]);

            const exams = rawExams.map(e => {
                const totalGraded = Number(e.total_pass || 0) + Number(e.total_fail || 0);
                const passPercent = totalGraded > 0 ? ((Number(e.total_pass || 0) / totalGraded) * 100) : 0;
                return {
                    ...e,
                    total_marked: Number(e.total_marked || 0),
                    total_pass: Number(e.total_pass || 0),
                    total_fail: Number(e.total_fail || 0),
                    pass_percent: passPercent.toFixed(1),
                    avg_marks: (e.avg_marks !== null && e.avg_marks !== undefined) ? Number(e.avg_marks).toFixed(1) : 'N/A'
                };
            });

            const branchSummarySql = `
                SELECT sc.id AS school_id, sc.school_name, sc.branch_name,
                    COUNT(DISTINCT e.id) AS published_exams_count,
                    SUM(CASE WHEN m.status = 'pass' THEN 1 ELSE 0 END) AS total_pass,
                    SUM(CASE WHEN m.status = 'fail' THEN 1 ELSE 0 END) AS total_fail,
                    AVG(m.obtained_marks) AS avg_marks
                FROM schools sc
                LEFT JOIN exams e ON e.school_id = sc.id AND e.is_published = 1
                LEFT JOIN marks m ON m.exam_id = e.id AND m.school_id = e.school_id
                WHERE sc.id IN (${placeholders})
                GROUP BY sc.id
                ORDER BY sc.school_name ASC, sc.branch_name ASC
            `;
            const rawBranchSummaries = await queryAsync(branchSummarySql, filterIds);

            let overallPassSum = 0;
            let overallPassCount = 0;
            let overallMarksSum = 0;
            let overallMarksCount = 0;
            let totalPublishedExams = 0;

            const branchSummaries = rawBranchSummaries.map(bs => {
                const totalGraded = Number(bs.total_pass || 0) + Number(bs.total_fail || 0);
                const passPercent = totalGraded > 0 ? ((Number(bs.total_pass || 0) / totalGraded) * 100) : 0;
                const examCount = Number(bs.published_exams_count || 0);
                totalPublishedExams += examCount;
                if (totalGraded > 0) {
                    overallPassSum += passPercent;
                    overallPassCount++;
                };
                if (bs.avg_marks !== null && bs.avg_marks !== undefined) {
                    overallMarksSum += Number(bs.avg_marks);
                    overallMarksCount++;
                };
                return {
                    school_id: bs.school_id,
                    school_name: bs.school_name,
                    branch_name: bs.branch_name,
                    published_exams_count: examCount,
                    avg_pass_percent: passPercent.toFixed(1),
                    avg_marks: (bs.avg_marks !== null && bs.avg_marks !== undefined) ? Number(bs.avg_marks).toFixed(1) : 'N/A'
                };
            });

            const overallStats = {
                publishedExamCount: totalPublishedExams,
                avgPassPercent: overallPassCount > 0 ? (overallPassSum / overallPassCount).toFixed(1) : '0.0',
                avgMarks: overallMarksCount > 0 ? (overallMarksSum / overallMarksCount).toFixed(1) : '0.0'
            };

            res.render("groupAdmin/academic", {
                title: "Academic Performance - Group Admin | SchoolSync",
                exams,
                branchSummaries,
                overallStats,
                branches,
                groupContext,
                activeBranchId,
                user: req.user,
                currentPath: "/groupadmin/academics",
                currentPage: page,
                totalPages,
                limit,
                total,
                req
            });
        } catch (error) {
            console.error("Group Admin Academic Page Error:", error);
            req.flash("error", "Failed to load academic performance page.");
            res.redirect("/groupadmin/dashboard");
        };
    }
};

module.exports = academicController;