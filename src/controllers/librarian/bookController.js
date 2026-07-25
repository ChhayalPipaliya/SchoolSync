const { queryAsync } = require("../../config/database");
const { normalizeText, normalizeNullableText } = require("../../utils/validation");
const libraryModel = require("../../models/libraryModel");

const norm = (v) => normalizeNullableText(v);
const imgPath = (file) => file ? `/uploads/library/${file.filename}` : null;

const toMoney = (value, fallback = 0) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const toPositiveInt = (value, fallback = 1) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

exports.index = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = 24;
        const offset = (page - 1) * limit;
        const { search, category, status } = req.query;
        let where = " WHERE lb.school_id=?";
        const args = [schoolId];

        if (search) {
            where += " AND (lb.title LIKE ? OR lb.author LIKE ? OR lb.isbn LIKE ? OR lb.barcode LIKE ? OR lb.rack_number LIKE ?)";
            const s = `%${search}%`; args.push(s,s,s,s,s);
        };

        if (category) {
            if (!isNaN(parseInt(category))) {
                where += " AND lb.category_id = ?";
                args.push(parseInt(category));
            } else {
                where += " AND (lb.category=? OR lc.name=?)";
                args.push(category, category);
            };
        };
        
        if (status) { where += " AND lb.status=?"; args.push(status); }
        const books = await queryAsync(`
            SELECT lb.*, COALESCE(lc.name, lb.category) AS category_name, 
                lr.rack_number AS rack_label, lr.shelf_number AS shelf_label,
                (lb.total_copies - lb.available_copies) AS issued_copies
            FROM library_books lb
            LEFT JOIN library_categories lc ON lc.id = lb.category_id
            LEFT JOIN library_racks lr ON lr.id = lb.rack_id
            ${where}
            ORDER BY lb.title ASC
            LIMIT ? OFFSET ?
        `, [...args, limit, offset]);

        const totalRows = await queryAsync(`SELECT COUNT(*) AS total FROM library_books lb LEFT JOIN library_categories lc ON lc.id=lb.category_id ${where}`, args);
        const categories = await libraryModel.listActiveCategories(schoolId);
        return res.render("librarian/books/list", {
            user: req.user,
            books,
            categories,
            search: search||"",
            category: category||"",
            status: status || "",
            pagination: { 
                page, 
                limit, 
                total: totalRows[0]?.total || 0, 
                pages: Math.max(1, Math.ceil((totalRows[0]?.total || 0) / limit)) 
            }
        });
    } catch (err) {
        console.error("Books Index Error:", err);
        req.flash("error", "Unable to load books: " + err.message);
        return res.redirect("/librarian/dashboard");
    };
};

exports.addPage = async (req, res) => {
    const schoolId = req.user.school_id;
    const [categories, racks] = await Promise.all([
        libraryModel.listActiveCategories(schoolId),
        libraryModel.listActiveRacks(schoolId)
    ]);
    return res.render("librarian/books/add", { user: req.user, categories, racks });
};

exports.add = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const b = req.body;
        const title = normalizeText(b.title);
        const copies = toPositiveInt(b.total_copies, 1);
        const cover = imgPath(req.files?.cover_image?.[0]);

        if (!title) {
            req.flash("error", "Book title is required.");
            return res.redirect("/librarian/books/add");
        };

        const isbn = norm(b.isbn);
        if (isbn) {
            const existing = await queryAsync(
                "SELECT id FROM library_books WHERE school_id=? AND isbn=? LIMIT 1",
                [schoolId, isbn]
            );
            if (existing.length > 0) {
                req.flash("error", "A book with this ISBN already exists.");
                return res.redirect("/librarian/books/add");
            };
        };

        const result = await queryAsync(`
            INSERT INTO library_books
            (school_id, category_id, rack_id, title, author, isbn, barcode, qr_code,
            publisher, language, edition, publish_year, category, total_copies,
            available_copies, rack_number, shelf_number, purchase_date, price,
            cover_image, description, created_by, updated_by)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [ 
                schoolId, 
                b.category_id || null, 
                b.rack_id || null, 
                title,norm(b.author), 
                isbn, 
                norm(b.barcode), 
                norm(b.qr_code), 
                norm(b.publisher), 
                norm(b.language), 
                norm(b.edition), 
                b.publish_year || null, 
                norm(b.category) || "Other", 
                copies, 
                copies, 
                norm(b.rack_number), 
                norm(b.shelf_number), 
                b.purchase_date || null, 
                toMoney(b.price, 0), 
                cover, 
                norm(b.description), 
                req.user.id, 
                req.user.id
            ]
        );

        await libraryModel.logActivity(queryAsync, {
            schoolId,
            actorId: req.user.id,
            action: "add_book",
            entityType: "library_book",
            entityId: result.insertId,
            metadata: { title, isbn, author: norm(b.author) },
            req
        });

        req.flash("success", `"${title}" added to library!`);
        return res.redirect("/librarian/books");
    } catch (err) {
        console.error("Book Add Error:", err);
        req.flash("error", "Unable to add book: " + err.message);
        return res.redirect("/librarian/books/add");
    };
};

exports.editPage = async (req, res) => {
    try {
        const rows = await queryAsync(
            "SELECT * FROM library_books WHERE id=? AND school_id=? LIMIT 1",
            [req.params.id, req.user.school_id]
        );

        if (!rows.length) { req.flash("error","Book not found."); return res.redirect("/librarian/books"); }
        const [categories, racks] = await Promise.all([
            libraryModel.listActiveCategories(req.user.school_id),
            libraryModel.listActiveRacks(req.user.school_id)
        ]);
        return res.render("librarian/books/edit", { user: req.user, book: rows[0], categories, racks });
    } catch (err) {
        req.flash("error","Unable to load book."); return res.redirect("/librarian/books");
    };
};

exports.edit = async (req, res) => {
    try {
        const { id } = req.params;
        const schoolId = req.user.school_id;
        const b = req.body;
        const title = normalizeText(b.title);
        const totalCopies = toPositiveInt(b.total_copies, 1);
        const cover = imgPath(req.files?.cover_image?.[0]);

        if (!title) {
            req.flash("error", "Title is required.");
            return res.redirect(`/librarian/books/${id}/edit`);
        };

        const isbn = norm(b.isbn);
        if (isbn) {
            const existing = await queryAsync(
                "SELECT id FROM library_books WHERE school_id=? AND isbn=? AND id != ? LIMIT 1",
                [schoolId, isbn, id]
            );
            if (existing.length > 0) {
                req.flash("error", "A book with this ISBN already exists.");
                return res.redirect(`/librarian/books/${id}/edit`);
            };
        };

        const issuedRow = await queryAsync(
            "SELECT COUNT(*) AS issued FROM library_issues WHERE book_id=? AND status IN ('issued','overdue','renewed')",
            [id]
        );
        const issuedCount = issuedRow[0]?.issued || 0;
        const available = Math.max(0, totalCopies - issuedCount);
        const updates = [ b.category_id || null, b.rack_id || null, title, norm(b.author), isbn, norm(b.barcode), norm(b.qr_code), norm(b.publisher), norm(b.language), norm(b.edition), b.publish_year || null, norm(b.category) || "Other", totalCopies, available, norm(b.rack_number), norm(b.shelf_number), b.purchase_date || null, toMoney(b.price, 0), norm(b.description), b.status || "active", req.user.id ];
        
        let sql = `UPDATE library_books SET
            category_id=?,rack_id=?,title=?,author=?,isbn=?,barcode=?,qr_code=?,
            publisher=?,language=?,edition=?,publish_year=?,category=?,
            total_copies=?,available_copies=?,rack_number=?,shelf_number=?,
            purchase_date=?,price=?,description=?,status=?,updated_by=?`;
            if (cover) { sql += ",cover_image=?"; updates.push(cover); }
            sql += " WHERE id=? AND school_id=?";
        updates.push(id, schoolId);
        
        await queryAsync(sql, updates);
        await libraryModel.logActivity(queryAsync, {
            schoolId,
            actorId: req.user.id,
            action: "edit_book",
            entityType: "library_book",
            entityId: id,
            metadata: { title, status: b.status || "active" },
            req
        });

        req.flash("success", "Book updated!");
        return res.redirect("/librarian/books");
    } catch (err) {
        console.error("Book Edit Error:", err);
        req.flash("error","Unable to update book: " + err.message);
        return res.redirect(`/librarian/books/${req.params.id}/edit`);
    };
};

exports.delete = async (req, res) => {
    try {
        const issued = await queryAsync(
            "SELECT COUNT(*) AS c FROM library_issues WHERE book_id=? AND status IN ('issued','overdue','renewed')",
            [req.params.id]
        );

        if (issued[0].c > 0) {
            req.flash("error", `Cannot delete — ${issued[0].c} copy/copies currently issued. Return them first.`);
            return res.redirect("/librarian/books");
        };

        await queryAsync("DELETE FROM library_books WHERE id=? AND school_id=?", [req.params.id, req.user.school_id]);
        await libraryModel.logActivity(queryAsync, {
            schoolId: req.user.school_id,
            actorId: req.user.id,
            action: "delete_book",
            entityType: "library_book",
            entityId: req.params.id,
            metadata: { book_id: req.params.id },
            req
        });
        req.flash("success", "Book deleted!");
        return res.redirect("/librarian/books");
    } catch (err) {
        console.error("Book Delete Error:", err);
        req.flash("error","Unable to delete book: " + err.message); 
        return res.redirect("/librarian/books");
    };
};

exports.searchBooks = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) return res.json([]);
        const books = await queryAsync(`
            SELECT id, title, author, isbn, barcode, rack_number, shelf_number, available_copies
            FROM library_books
            WHERE school_id=?
            AND (title LIKE ? OR isbn LIKE ? OR barcode LIKE ? OR author LIKE ? OR rack_number LIKE ?)
            AND status='active'
            LIMIT 10`,
            [req.user.school_id, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`]
        );
        return res.json(books);
    } catch (err) {
        return res.json([]);
    };
};