const db = require('../../config/database');

exports.myBooks = async (req, res) => {
    try {
        const userId = req.session?.user?.id || req.user?.id;
        const schoolId = req.user?.school_id || req.session?.user?.school_id;
        if (!userId || !schoolId) {
            req.flash('error', 'Please log in first');
            return res.redirect('/auth/login');
        }

        const [currentBooks] = await db.query(`
            SELECT
                li.id,
                li.book_id,
                li.issue_date   AS issued_at,
                li.due_date,
                li.return_date,
                li.status,
                li.fine_amount,
                li.fine_paid,
                li.remarks,
                b.title,
                b.author,
                b.isbn,
                b.cover_image,
                c.name          AS category_name,
                DATEDIFF(li.due_date, CURDATE())    AS days_remaining,
                CASE
                    WHEN li.due_date < CURDATE() THEN DATEDIFF(CURDATE(), li.due_date)
                    ELSE 0
                END                                 AS days_overdue
            FROM library_issues li
            JOIN library_books b    ON li.book_id    = b.id AND b.school_id = li.school_id
            LEFT JOIN library_categories c ON b.category_id = c.id AND c.school_id = li.school_id
            WHERE li.user_id = ?
              AND li.school_id = ?
              AND li.status IN ('issued', 'overdue', 'renewed')
            ORDER BY li.due_date ASC
        `, [userId, schoolId]);

        const [history] = await db.query(`
            SELECT
                li.id,
                li.book_id,
                li.issue_date   AS issued_at,
                li.due_date,
                li.return_date  AS returned_at,
                li.status,
                b.title,
                b.author,
                b.isbn,
                b.cover_image,
                c.name          AS category_name
            FROM library_issues li
            JOIN library_books b    ON li.book_id    = b.id AND b.school_id = li.school_id
            LEFT JOIN library_categories c ON b.category_id = c.id AND c.school_id = li.school_id
            WHERE li.user_id = ?
              AND li.school_id = ?
              AND li.status = 'returned'
            ORDER BY li.return_date DESC
            LIMIT 20
        `, [userId, schoolId]);

        const [fines] = await db.query(`
            SELECT
                f.*,
                b.title AS book_title
            FROM library_fines f
            JOIN library_issues li ON f.issue_id = li.id AND li.school_id = f.school_id
            JOIN library_books  b  ON li.book_id  = b.id AND b.school_id = f.school_id
            WHERE f.user_id = ?
              AND f.school_id = ?
            ORDER BY f.created_at DESC
        `, [userId, schoolId]);

        const totalIssued  = currentBooks.length;
        const overdueBooks = currentBooks.filter(b => b.days_overdue > 0);
        const totalFines   = fines.reduce((sum, f) => sum + parseFloat(f.amount || 0), 0);
        const paidFines    = fines.reduce((sum, f) => sum + parseFloat(f.paid_amount || 0), 0);
        const pendingFines = fines
            .filter(f => ['pending', 'partial'].includes(f.status))
            .reduce((sum, f) => sum + Math.max(0, parseFloat(f.amount || 0) - parseFloat(f.paid_amount || 0)), 0);

        res.render('student/library', {
            title: 'My Library',
            currentBooks,
            history,
            fines,
            stats: {
                totalIssued,
                overdueCount: overdueBooks.length,
                totalFines,
                paidFines,
                pendingFines
            },
            user: req.session?.user || req.user
        });

    } catch (error) {
        console.error('Library Error:', error);
        req.flash('error', 'Failed to load library data');
        res.redirect('/student/dashboard');
    }
};
