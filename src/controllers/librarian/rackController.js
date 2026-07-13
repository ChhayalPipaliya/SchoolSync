const { queryAsync } = require("../../config/database");
const { normalizeText, normalizeNullableText, normalizeInteger } = require("../../utils/validation");
const libraryModel = require("../../models/libraryModel");
const norm = (v) => normalizeNullableText(v);

exports.index = async (req, res) => {
    try {
        const racks = await libraryModel.listRacks(req.user.school_id);
        return res.render("librarian/racks/list", { user: req.user, racks });
    } catch (err) {
        req.flash("error", "Unable to load racks.");
        return res.redirect("/librarian/dashboard");
    };
};

exports.save = async (req, res) => {
    try {
        const b = req.body;
        const id = b.id || null;
        const rackNumber = normalizeText(b.rack_number);
        if (!rackNumber) {
            req.flash("error", "Rack number is required.");
            return res.redirect("/librarian/racks");
        };

        if (id) {
            await queryAsync(`
                UPDATE library_racks
                SET rack_number=?, shelf_number=?, location=?, capacity=?, status=?, updated_by=?
                WHERE id=? AND school_id=?
            `, [rackNumber, norm(b.shelf_number), norm(b.location), normalizeInteger(b.capacity), b.status || "active", req.user.id, id, req.user.school_id]);
            
            await libraryModel.logActivity(queryAsync, {
                schoolId: req.user.school_id,
                actorId: req.user.id,
                action: "edit_rack",
                entityType: "library_rack",
                entityId: id,
                metadata: { rack_number: rackNumber, status: b.status || "active" },
                req
            });
        } else {
            const result = await queryAsync(`
                INSERT INTO library_racks
                (school_id, rack_number, shelf_number, location, capacity, status, created_by, updated_by)
                VALUES (?,?,?,?,?,?,?,?)
            `, [req.user.school_id, rackNumber, norm(b.shelf_number), norm(b.location), normalizeInteger(b.capacity), b.status || "active", req.user.id, req.user.id]);
            
            await libraryModel.logActivity(queryAsync, {
                schoolId: req.user.school_id,
                actorId: req.user.id,
                action: "add_rack",
                entityType: "library_rack",
                entityId: result.insertId,
                metadata: { rack_number: rackNumber },
                req
            });
        };
        req.flash("success", "Rack saved.");
    } catch (err) {
        console.error("Save Rack Error:", err);
        req.flash("error", "Unable to save rack. Check for duplicates.");
    };
    return res.redirect("/librarian/racks");
};

exports.delete = async (req, res) => {
    try {
        await queryAsync("DELETE FROM library_racks WHERE id=? AND school_id=?", [req.params.id, req.user.school_id]);
        await libraryModel.logActivity(queryAsync, {
            schoolId: req.user.school_id,
            actorId: req.user.id,
            action: "delete_rack",
            entityType: "library_rack",
            entityId: req.params.id,
            metadata: { rack_id: req.params.id },
            req
        });
        req.flash("success", "Rack deleted.");
    } catch (err) {
        req.flash("error", "Rack is in use. Mark it inactive instead.");
    };
    return res.redirect("/librarian/racks");
};