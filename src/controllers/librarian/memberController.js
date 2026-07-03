const { queryAsync } = require("../../config/database");
const libraryModel = require("../../models/libraryModel");

exports.index = async (req, res) => {
    try {
        const members = await libraryModel.listMembers(req.user.school_id, {
            type: req.query.type,
            search: req.query.search
        });

        return res.render("librarian/members/list", {
            user: req.user,
            members,
            type: req.query.type || "",
            search: req.query.search || ""
        });
    } catch (err) {
        req.flash("error", "Unable to load library members.");
        return res.redirect("/librarian/dashboard");
    };
};

exports.searchMembers = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) return res.json([]);
        const members = await queryAsync(`
            SELECT id, first_name AS first_name, last_name AS last_name, email, role
            FROM users
            WHERE school_id=? AND role IN ('student','teacher') AND status='active'
            AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)
            LIMIT 10`,
            [req.user.school_id, `%${q}%`, `%${q}%`, `%${q}%`]
        );
        return res.json(members);
    } catch (err) {
        return res.json([]);
    };
};
