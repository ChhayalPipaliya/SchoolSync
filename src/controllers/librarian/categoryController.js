const { queryAsync } = require("../../config/database");
const { normalizeText, normalizeNullableText } = require("../../utils/validation");
const libraryModel = require("../../models/libraryModel");
const norm = (v) => normalizeNullableText(v);

exports.index = async (req, res) => {
    try {
        const categories = await libraryModel.listCategories(req.user.school_id);
        return res.render("librarian/categories/list", { user: req.user, categories });
    } catch (err) {
        req.flash("error", "Unable to load categories.");
        return res.redirect("/librarian/dashboard");
    };
};

exports.save = async (req, res) => {
    try {
        const b = req.body;
        const id = b.id || null;
        const name = normalizeText(b.name);
        if (!name) {
            req.flash("error", "Category name is required.");
            return res.redirect("/librarian/categories");
        };

        if (id) {
            await queryAsync(`
                UPDATE library_categories
                SET name=?, type=?, class_name=?, description=?, status=?, updated_by=?
                WHERE id=? AND school_id=?
            `, [name, b.type || "general", norm(b.class_name), norm(b.description), b.status || "active", req.user.id, id, req.user.school_id]);
            
            await libraryModel.logActivity(queryAsync, {
                schoolId: req.user.school_id,
                actorId: req.user.id,
                action: "edit_category",
                entityType: "library_category",
                entityId: id,
                metadata: { name, status: b.status || "active" },
                req
            });
        } else {
            const result = await queryAsync(`
                INSERT INTO library_categories
                (school_id, name, type, class_name, description, status, created_by, updated_by)
                VALUES (?,?,?,?,?,?,?,?)
            `, [req.user.school_id, name, b.type || "general", norm(b.class_name), norm(b.description), b.status || "active", req.user.id, req.user.id]);
            
            await libraryModel.logActivity(queryAsync, {
                schoolId: req.user.school_id,
                actorId: req.user.id,
                action: "add_category",
                entityType: "library_category",
                entityId: result.insertId,
                metadata: { name, type: b.type || "general" },
                req
            });
        };
        req.flash("success", "Category saved.");
    } catch (err) {
        console.error("Save Category Error:", err);
        req.flash("error", "Unable to save category. Check for duplicate names.");
    };
    return res.redirect("/librarian/categories");
};

exports.delete = async (req, res) => {
    try {
        await queryAsync("DELETE FROM library_categories WHERE id=? AND school_id=?", [req.params.id, req.user.school_id]);
        await libraryModel.logActivity(queryAsync, {
            schoolId: req.user.school_id,
            actorId: req.user.id,
            action: "delete_category",
            entityType: "library_category",
            entityId: req.params.id,
            metadata: { category_id: req.params.id },
            req
        });
        req.flash("success", "Category deleted.");
    } catch (err) {
        req.flash("error", "Category is in use. Mark it inactive instead.");
    };
    return res.redirect("/librarian/categories");
};
