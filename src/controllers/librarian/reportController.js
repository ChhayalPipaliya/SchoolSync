const { queryAsync } = require("../../config/database");
const libraryService = require("../../services/libraryService");

exports.index = async (req, res) => {
    try {
        await libraryService.updateOverdueStatus(req.user.school_id);
        const [monthly, mostIssued, activities] = await Promise.all([
        queryAsync(`
            SELECT DATE_FORMAT(issue_date, '%Y-%m') AS month, COUNT(*) AS issued,
            SUM(CASE WHEN status='returned' THEN 1 ELSE 0 END) AS returned
            FROM library_issues
            WHERE school_id=?
            GROUP BY DATE_FORMAT(issue_date, '%Y-%m')
            ORDER BY month DESC
            LIMIT 12
        `, [req.user.school_id]),
        queryAsync(`
            SELECT lb.title, lb.author, COUNT(li.id) AS issue_count
            FROM library_issues li
            JOIN library_books lb ON lb.id = li.book_id
            WHERE li.school_id=?
            GROUP BY lb.id
            ORDER BY issue_count DESC
            LIMIT 20
        `, [req.user.school_id]),
        queryAsync(`
            SELECT lal.*, u.first_name AS first_name, u.last_name AS last_name
            FROM library_activity_logs lal
            LEFT JOIN users u ON u.id = lal.actor_id
            WHERE lal.school_id=?
            ORDER BY lal.created_at DESC
            LIMIT 50
        `, [req.user.school_id])
        ]);
        return res.render("librarian/reports/index", { user: req.user, monthly, mostIssued, activities });
    } catch (err) {
        req.flash("error", "Unable to load reports.");
        return res.redirect("/librarian/dashboard");
    };
};