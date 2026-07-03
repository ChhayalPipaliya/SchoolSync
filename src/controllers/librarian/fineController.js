const { queryAsync } = require("../../config/database");
const { normalizeNullableText } = require("../../utils/validation");
const libraryModel = require("../../models/libraryModel");
const norm = (v) => normalizeNullableText(v);
const money = (v) => Number(Number(v || 0).toFixed(2));
const receiptNo = (schoolId, fineId) => `LF-${schoolId}-${fineId}-${Date.now()}`;

exports.index = async (req, res) => {
    try {
        const fines = await queryAsync(`
            SELECT lf.*, lb.title, u.first_name AS first_name, u.last_name AS last_name, u.role
            FROM library_fines lf
            JOIN library_issues li ON li.id = lf.issue_id
            JOIN library_books lb ON lb.id = li.book_id
            JOIN users u ON u.id = lf.user_id
            WHERE lf.school_id=?
            ORDER BY lf.created_at DESC
        `, [req.user.school_id]);
        return res.render("librarian/fines/list", { user: req.user, fines });
    } catch (err) {
        req.flash("error", "Unable to load fines.");
        return res.redirect("/librarian/dashboard");
    };
};

exports.pay = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const fineId = req.params.id;
        const rows = await queryAsync(
            `SELECT id, amount, paid_amount, status
             FROM library_fines
             WHERE id=? AND school_id=?
             LIMIT 1`,
            [fineId, schoolId]
        );
        
        const fine = rows[0];
        if (!fine) {
            req.flash("error", "Fine record not found.");
            return res.redirect("/librarian/fines");
        };

        if (!["pending", "partial"].includes(fine.status)) {
            req.flash("error", "Only pending or partial fines can be paid.");
            return res.redirect("/librarian/fines");
        };

        const amount = money(fine.amount);
        const alreadyPaid = money(fine.paid_amount);
        const pending = money(amount - alreadyPaid);
        const requested = req.body.amount === undefined || req.body.amount === "" ? pending : money(req.body.amount);

        if (requested <= 0) {
            req.flash("error", "Payment amount must be greater than zero.");
            return res.redirect("/librarian/fines");
        };

        if (requested > pending) {
            req.flash("error", `Payment cannot exceed pending amount ₹${pending.toFixed(2)}.`);
            return res.redirect("/librarian/fines");
        };

        const newPaid = money(alreadyPaid + requested);
        const nextStatus = newPaid >= amount ? "paid" : newPaid > 0 ? "partial" : "pending";
        const paymentDate = norm(req.body.payment_date) || new Date().toISOString().slice(0, 10);
        const paymentMode = norm(req.body.payment_mode) || "cash";
        const finalReceipt = norm(req.body.receipt_no) || receiptNo(schoolId, fineId);

        await queryAsync(`
            UPDATE library_fines
            SET paid_amount=?, payment_date=?, payment_mode=?, receipt_no=?, status=?,
                updated_by=?
            WHERE id=? AND school_id=?
        `, [newPaid, paymentDate, paymentMode, finalReceipt, nextStatus, req.user.id, fineId, schoolId]);
        
        await libraryModel.logActivity(queryAsync, {
            schoolId,
            actorId: req.user.id,
            action: "pay_fine",
            entityType: "library_fine",
            entityId: fineId,
            metadata: {
                amount: requested,
                paid_amount: newPaid,
                payment_mode: paymentMode,
                receipt_no: finalReceipt,
                status: nextStatus
            },
            req
        });

        req.flash("success", nextStatus === "paid" ? "Fine marked as paid." : "Fine payment recorded.");
    } catch (err) {
        console.error("Fine Pay Error:", err);
        req.flash("error", "Unable to update fine.");
    };
    return res.redirect("/librarian/fines");
};

exports.waive = async (req, res) => {
    try {
        const schoolId = req.user.school_id;
        const fineId = req.params.id;
        const remarks = norm(req.body.remarks);

        if (!remarks || remarks.length < 3) {
            req.flash("error", "Waive remarks are required.");
            return res.redirect("/librarian/fines");
        };

        const rows = await queryAsync(
            `SELECT id, status
             FROM library_fines
             WHERE id=? AND school_id=?
             LIMIT 1`,
            [fineId, schoolId]
        );
        
        const fine = rows[0];
        if (!fine) {
            req.flash("error", "Fine record not found.");
            return res.redirect("/librarian/fines");
        };

        if (!["pending", "partial"].includes(fine.status)) {
            req.flash("error", "Only pending or partial fines can be waived.");
            return res.redirect("/librarian/fines");
        };

        await queryAsync(
            `UPDATE library_fines
             SET status='waived', remarks=?, updated_by=?
             WHERE id=? AND school_id=?`,
            [remarks, req.user.id, fineId, schoolId]
        );

        await libraryModel.logActivity(queryAsync, {
            schoolId,
            actorId: req.user.id,
            action: "waive_fine",
            entityType: "library_fine",
            entityId: fineId,
            metadata: { remarks },
            req
        });

        req.flash("success", "Fine waived successfully.");
    } catch (err) {
        console.error("Fine Waive Error:", err);
        req.flash("error", "Unable to waive fine.");
    };
    return res.redirect("/librarian/fines");
};