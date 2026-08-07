const { queryAsync } = require("../../config/database");
const libraryService = require("../../services/libraryService");
const bcryptjs = require("bcryptjs");
const { isStrongPassword } = require("../../utils/validation");

exports.dashboard = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        await libraryService.updateOverdueStatus(schoolId);

        const [stats, recentIssues, overdueBooks, popularBooks, categories, notices, rawActivities] = await Promise.all([
            queryAsync(`SELECT
                (SELECT COUNT(*) FROM library_books WHERE school_id=?) AS totalBooks,
                (SELECT COALESCE(SUM(total_copies),0) FROM library_books WHERE school_id=?) AS totalCopies,
                (SELECT COALESCE(SUM(available_copies),0) FROM library_books WHERE school_id=?) AS availableCopies,
                (SELECT COUNT(*) FROM library_issues WHERE school_id=? AND status IN ('issued','renewed')) AS currentlyIssued,
                (SELECT COUNT(*) FROM library_issues WHERE school_id=? AND status='overdue') AS overdueCount,
                (SELECT COUNT(*) FROM library_issues WHERE school_id=? AND status='returned' AND DATE(return_date)=CURDATE()) AS returnedToday,
                (SELECT COUNT(*) FROM library_issues WHERE school_id=? AND DATE(issue_date)=CURDATE()) AS issuedToday,
                (SELECT COALESCE(SUM(paid_amount),0) FROM library_fines WHERE school_id=? AND status='paid') AS fineCollection,
                (SELECT COUNT(*) FROM library_members WHERE school_id=? AND status='active') AS totalMembers
            `, [schoolId,schoolId,schoolId,schoolId,schoolId,schoolId,schoolId,schoolId,schoolId]),

            queryAsync(`
                SELECT li.*, lb.title AS bookTitle, lb.author,
                CONCAT(u.first_name, ' ', COALESCE(u.last_name, '')) AS memberName, u.role AS user_role
                FROM library_issues li
                JOIN library_books lb ON lb.id = li.book_id
                JOIN users u ON u.id = li.user_id
                WHERE li.school_id=? AND li.status IN ('issued','overdue','renewed')
                ORDER BY li.created_at DESC LIMIT 8
            `, [schoolId]),

            queryAsync(`
                SELECT li.*, lb.title AS bookTitle, lb.author,
                CONCAT(u.first_name, ' ', COALESCE(u.last_name, '')) AS memberName, u.role AS user_role,
                DATEDIFF(CURDATE(), li.due_date) AS daysOverdue,
                COALESCE((SELECT SUM(amount) FROM library_fines WHERE issue_id = li.id AND school_id = li.school_id), 0) AS fine_record_amount,
                COALESCE(li.fine_per_day, (SELECT fine_per_day FROM library_settings WHERE school_id = li.school_id LIMIT 1), 0) AS effective_fine_per_day
                FROM library_issues li
                JOIN library_books lb ON lb.id = li.book_id
                JOIN users u ON u.id = li.user_id
                WHERE li.school_id=? AND li.status='overdue'
                ORDER BY li.due_date ASC LIMIT 5
            `, [schoolId]),

            queryAsync(`
                SELECT lb.title, lb.author, COUNT(li.id) AS issue_count
                FROM library_books lb
                LEFT JOIN library_issues li ON li.book_id = lb.id
                WHERE lb.school_id=?
                GROUP BY lb.id ORDER BY issue_count DESC, lb.title ASC LIMIT 5
            `, [schoolId]),

            queryAsync(`
                SELECT lc.name, COUNT(lb.id) AS count
                FROM library_categories lc
                LEFT JOIN library_books lb ON lb.category_id = lc.id
                WHERE lc.school_id=? AND lc.status='active'
                GROUP BY lc.id
                ORDER BY lc.name ASC
            `, [schoolId]),

            queryAsync(`
                SELECT n.*, CONCAT(u.first_name, ' ', COALESCE(u.last_name, '')) AS authorName
                FROM notices n
                LEFT JOIN users u ON n.created_by = u.id
                WHERE n.school_id = ? AND n.status = 'published'
                    AND (n.target_type IN ('all', 'teachers', 'librarians'))
                    AND (n.expiry_date IS NULL OR n.expiry_date >= CURDATE())
                ORDER BY n.created_at DESC LIMIT 4
            `, [schoolId]).catch(() => []),

            queryAsync(`
                SELECT lal.*, CONCAT(u.first_name, ' ', COALESCE(u.last_name, '')) AS actorName
                FROM library_activity_logs lal
                LEFT JOIN users u ON u.id = lal.actor_id
                WHERE lal.school_id=?
                ORDER BY lal.created_at DESC
                LIMIT 6
            `, [schoolId]).catch(() => [])
        ]);

        let activities = (rawActivities || []).map(act => {
            let actionText = act.action || 'Library activity recorded';
            if (act.metadata) {
                try {
                    const meta = typeof act.metadata === 'string' ? JSON.parse(act.metadata) : act.metadata;
                    if (meta.bookTitle || meta.title) {
                        actionText += `: ${meta.bookTitle || meta.title}`;
                    }
                } catch (e) {}
            }
            return {
                text: actionText,
                time: act.created_at ? new Date(act.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '',
                date: act.created_at ? new Date(act.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '',
                actor: act.actorName || 'System'
            };
        });

        if (activities.length === 0) {
            const recentIssueLogs = await queryAsync(`
                SELECT li.status, li.created_at, li.updated_at, lb.title AS bookTitle,
                       CONCAT(u.first_name, ' ', COALESCE(u.last_name, '')) AS memberName
                FROM library_issues li
                JOIN library_books lb ON lb.id = li.book_id
                JOIN users u ON u.id = li.user_id
                WHERE li.school_id=?
                ORDER BY li.updated_at DESC, li.created_at DESC
                LIMIT 6
            `, [schoolId]).catch(() => []);

            activities = recentIssueLogs.map(item => {
                let actionLabel = 'Library Transaction';
                if (item.status === 'issued') actionLabel = `Book "${item.bookTitle}" issued to ${item.memberName}`;
                else if (item.status === 'returned') actionLabel = `Book "${item.bookTitle}" returned by ${item.memberName}`;
                else if (item.status === 'renewed') actionLabel = `Book "${item.bookTitle}" renewed for ${item.memberName}`;
                else if (item.status === 'overdue') actionLabel = `Book "${item.bookTitle}" overdue for ${item.memberName}`;

                const timestamp = item.updated_at || item.created_at;
                return {
                    text: actionLabel,
                    time: timestamp ? new Date(timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '',
                    date: timestamp ? new Date(timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '',
                    actor: 'Library Desk'
                };
            });
        }

        const processedOverdueBooks = (overdueBooks || []).map(ov => {
            let fine = Number(ov.fine_amount || 0);
            if (fine === 0) {
                if (Number(ov.fine_record_amount) > 0) {
                    fine = Number(ov.fine_record_amount);
                } else if (ov.daysOverdue > 0) {
                    fine = ov.daysOverdue * Number(ov.effective_fine_per_day || 0);
                }
            }
            return {
                ...ov,
                calculatedFine: fine
            };
        });

        return res.render("librarian/dashboard", {
            user: req.user,
            stats: stats[0] || {},
            recentIssues, overdueBooks: processedOverdueBooks, popularBooks, categories, notices, activities
        });
    } catch (err) {
        console.error("Librarian Dashboard Error:", err);
        req.flash("error", "Unable to load library dashboard.");
        return res.redirect("/");
    };
};

exports.profilePage = async (req, res) => {
    try {
        const userId = req.user.id;
        const schoolId = req.user.school_id;
        const [librarian] = await queryAsync(
            `SELECT l.*, u.first_name AS first_name, u.last_name AS last_name, u.email, u.phone, u.image, u.created_at as account_created
             FROM librarians l
             JOIN users u ON l.user_id = u.id
             WHERE l.user_id = ? AND l.school_id = ?`,
            [userId, schoolId]
        );

        if (!librarian) {
            req.flash("error", "Librarian profile not found.");
            return res.redirect("/librarian/dashboard");
        };

        return res.render("librarian/profile", {
            title: "Librarian Profile",
            librarian,
            user: req.user
        });
    } catch (err) {
        console.error("Librarian Profile Error:", err);
        req.flash("error", "Unable to load profile.");
        return res.redirect("/librarian/dashboard");
    };
};

exports.updateProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const { currentPassword, newPassword, confirmPassword } = req.body;

        if (!currentPassword || !newPassword || !confirmPassword) {
            req.flash("error", "Please fill all password fields.");
            return res.redirect("/librarian/profile");
        };

        if (newPassword !== confirmPassword) {
            req.flash("error", "Passwords do not match.");
            return res.redirect("/librarian/profile");
        };

        if (!isStrongPassword(newPassword)) {
            req.flash("error", "Password must be at least 8 characters and include letters and numbers.");
            return res.redirect("/librarian/profile");
        };

        const users = await queryAsync("SELECT password FROM users WHERE id = ?", [userId]);
        const userRow = users[0];
        if (!userRow) {
            req.flash("error", "User not found.");
            return res.redirect("/librarian/profile");
        };

        const isPasswordValid = await bcryptjs.compare(currentPassword, userRow.password);
        if (!isPasswordValid) {
            req.flash("error", "Incorrect current password.");
            return res.redirect("/librarian/profile");
        };

        const hashed = await bcryptjs.hash(newPassword, 10);
        await queryAsync("UPDATE users SET password = ? WHERE id = ?", [hashed, userId]);

        req.flash("success", "Password updated successfully.");
        return res.redirect("/librarian/profile");
    } catch (err) {
        console.error("Librarian Profile Update Error:", err);
        req.flash("error", "Failed to update password.");
        return res.redirect("/librarian/profile");
    };
};

exports.noticesPage = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const notices = await queryAsync(
            `SELECT n.*, u.first_name AS first_name, u.last_name AS last_name 
            FROM notices n
            LEFT JOIN users u ON n.created_by = u.id
            WHERE n.school_id = ? AND n.status = 'published'
                AND (n.target_type = 'all' OR n.target_type = 'teachers' OR n.target_type = 'librarians')
                AND (n.expiry_date IS NULL OR n.expiry_date >= CURDATE())
            ORDER BY n.created_at DESC`,
            [schoolId]
        );

        return res.render("librarian/notices", {
            title: "School Notices",
            notices,
            user: req.user
        });
    } catch (err) {
        console.error("Librarian Notices Error:", err);
        req.flash("error", "Unable to load notices.");
        return res.redirect("/librarian/dashboard");
    };
};