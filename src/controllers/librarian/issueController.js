const { queryAsync } = require("../../config/database");
const { normalizeNullableText } = require("../../utils/validation");
const libraryModel = require("../../models/libraryModel");
const libraryService = require("../../services/libraryService");
const norm = (v) => normalizeNullableText(v);

exports.index = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
      
        await libraryService.updateOverdueStatus(schoolId);
        const { status, search, book_id, member_id } = req.query;
        const [stats] = await queryAsync(`
            SELECT 
                COUNT(*) AS total,
                SUM(CASE WHEN status IN ('issued', 'renewed', 'overdue') THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) AS overdue,
                SUM(CASE WHEN status = 'returned' THEN 1 ELSE 0 END) AS returned,
                SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) AS lost
            FROM library_issues
            WHERE school_id = ?
        `, [schoolId]);

        const summaryStats = {
            total: stats?.total || 0,
            active: stats?.active || 0,
            overdue: stats?.overdue || 0,
            returned: stats?.returned || 0,
            lost: stats?.lost || 0
        };

        let sql = `SELECT li.*, lb.title AS book_title, lb.author, lb.isbn, lb.cover_image,
        u.first_name AS first_name, u.last_name AS last_name, u.role AS user_role, lm.library_id AS member_code,
        DATEDIFF(CURDATE(), li.due_date) AS days_overdue
        FROM library_issues li
        JOIN library_books lb ON lb.id = li.book_id
        JOIN users u ON u.id = li.user_id
        LEFT JOIN library_members lm ON lm.id = li.member_id
        WHERE li.school_id=?`;
        const args = [schoolId];

        if (status) { sql += " AND li.status=?"; args.push(status); }
        if (book_id) { sql += " AND li.book_id=?"; args.push(book_id); }
        if (member_id) { sql += " AND li.member_id=?"; args.push(member_id); }
    
        if (search) {csql += " AND (lb.title LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR lm.library_id LIKE ?)";
            const s = `%${search}%`; args.push(s,s,s,s);
        };

        sql += " ORDER BY li.created_at DESC";
        const issues = await queryAsync(sql, args);
        return res.render("librarian/issue/list", {
            user: req.user,
            issues,
            status: status || "",
            search: search || "",
            book_id: book_id || "",
            member_id: member_id || "",
            stats: summaryStats
        });
    } catch (err) {
        console.error("Issues Index Error:", err);
        req.flash("error","Unable to load issues.");
        return res.redirect("/librarian/dashboard");
    };
};

exports.issuePage = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const [books, members, settings] = await Promise.all([
            queryAsync("SELECT * FROM library_books WHERE school_id=? AND available_copies>0 AND status='active' ORDER BY title ASC", [schoolId]),
            queryAsync(`SELECT id, first_name AS first_name, last_name AS last_name, email, role FROM users
                WHERE school_id=? AND role IN ('student','teacher') AND status='active'
                ORDER BY role ASC, first_name ASC`, [schoolId]),
            libraryModel.getSettings(schoolId)
        ]);
        
        return res.render("librarian/issue/issue", {
            user: req.user,
            books,
            members,
            settings
        });
    } catch (err) {
        req.flash("error","Unable to load issue form.");
        return res.redirect("/librarian/issues");
    };
};

exports.issueBook = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const { book_id, user_id, due_days, remarks } = req.body;

        if (!book_id || !user_id) {
            req.flash("error","Book and Member are required.");
            return res.redirect("/librarian/issues/new");
        };

        const result = await libraryService.issueBook({
            schoolId,
            bookId: book_id,
            userId: user_id,
            dueDays: due_days,
            remarks: norm(remarks),
            actorId: req.user.id,
            req
        });

        req.flash("success", `"${result.book.title}" issued successfully! Due: ${result.dueDate}`);
        return res.redirect("/librarian/issues");
    } catch (err) {
        console.error("Issue Book Error:", err);
        req.flash("error", err.message || "Unable to issue book.");
        return res.redirect("/librarian/issues/new");
    };
};

exports.returnPage = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const issue = await queryAsync(`
            SELECT li.*, lb.title, lb.author,
                u.first_name AS first_name, u.last_name AS last_name, u.email,
                DATEDIFF(CURDATE(), li.due_date) AS days_overdue
            FROM library_issues li
            JOIN library_books lb ON lb.id = li.book_id
            JOIN users u ON u.id = li.user_id
            WHERE li.id=? AND li.school_id=? LIMIT 1`,
            [req.params.id, schoolId]
        );

        if (!issue.length || issue[0].status === "returned") {
            req.flash("error","Issue record not found or already returned.");
            return res.redirect("/librarian/issues");
        };

        const { overdueDays, fine } = libraryService.calculateLateFine(issue[0].due_date, null, issue[0].fine_per_day);
        const [fineRow] = await queryAsync(`
            SELECT SUM(amount - COALESCE(paid_amount, 0)) AS unpaid_fines
            FROM library_fines
            WHERE user_id = ? AND school_id = ? AND status IN ('pending','partial')
        `, [issue[0].user_id, schoolId]);
        const unpaidFines = parseFloat(fineRow?.unpaid_fines || 0);

        return res.render("librarian/issue/return", {
            user: req.user,
            issue: issue[0],
            overdueDays,
            calculatedFine: fine,
            unpaidFines
        });
    } catch (err) {
        console.error("Return Page Error:", err);
        req.flash("error","Unable to load return form.");
        return res.redirect("/librarian/issues");
    };
};

exports.returnBook = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const { id } = req.params;
        const { fine_amount, fine_paid, remarks, status } = req.body;

        if (status === "lost") {
            const lost = await libraryService.markLost({
                schoolId,
                issueId: id,
                actorId: req.user.id,
                remarks: norm(remarks),
                req
            });
            req.flash("success", `Book marked lost. Charge: ₹${Number(lost.totalFine).toFixed(2)}`);
            return res.redirect("/librarian/issues");
        };

        const returned = await libraryService.returnBook({
            schoolId,
            issueId: id,
            fineAmount: fine_amount,
            finePaid: fine_paid === "1" || fine_paid === "true" || fine_paid === true,
            remarks: norm(remarks),
            actorId: req.user.id,
            req
        });

        req.flash("success", "Book returned successfully!" + (returned.fine > 0 ? ` Fine: ₹${returned.fine}` : ""));
        return res.redirect("/librarian/issues");
    } catch (err) {
        console.error("Return Book Error:", err);
        req.flash("error", err.message || "Unable to process return.");
        return res.redirect(`/librarian/issues/${req.params.id}/return`);
    };
};

exports.renew = async (req, res) => {
    try {
        const result = await libraryService.renewIssue({
            schoolId: req.user.school_id,
            issueId: req.params.id,
            actorId: req.user.id,
            req
        });
        
        req.flash("success", `Book renewed. New due date: ${result.dueDate}`);
    } catch (err) {
        req.flash("error", err.message || "Unable to renew book.");
    };
    return res.redirect("/librarian/issues");
};