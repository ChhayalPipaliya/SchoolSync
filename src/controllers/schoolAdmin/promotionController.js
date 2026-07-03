const promotionService = require("../../services/studentPromotionService");

const getSchoolId = (req) => req.user?.school_id || req.session?.user?.school_id || null;
const getUserId = (req) => req.user?.id || req.session?.user?.id || null;

const parseId = (value) => {
    const id = Number.parseInt(value, 10);
    return Number.isInteger(id) && id > 0 ? id : null;
};

const ensureYearsValid = (fromAcademicYearId, toAcademicYearId) => {
    if (!fromAcademicYearId || !toAcademicYearId) {
        return "From Academic Year and To Academic Year are required.";
    };
    if (fromAcademicYearId === toAcademicYearId) {
        return "From and To academic year cannot be same.";
    };
    return null;
};

const buildOverrides = (body = {}) => {
    const itemIds = Array.isArray(body.item_id) ? body.item_id : (body.item_id ? [body.item_id] : []);
    const actions = Array.isArray(body.promotion_action) ? body.promotion_action : (body.promotion_action ? [body.promotion_action] : []);
    const classIds = Array.isArray(body.to_class_id) ? body.to_class_id : (body.to_class_id ? [body.to_class_id] : []);
    const reasons = Array.isArray(body.reason) ? body.reason : (body.reason ? [body.reason] : []);

    return itemIds.reduce((acc, itemId, index) => {
        const id = parseId(itemId);
        if (!id) return acc;
        acc[id] = {
            action: String(actions[index] || "").trim(),
            to_class_id: classIds[index] || null,
            reason: reasons[index] || null
        };
        return acc;
    }, {});
};

exports.index = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const academicYears = await promotionService.getAcademicYears(schoolId);
        const selectedYearId = parseId(req.query.fromAcademicYearId) || academicYears[0]?.id || null;
        const classes = selectedYearId ? await promotionService.getClassesForYear(schoolId, selectedYearId) : [];
        const history = await promotionService.getPromotionHistory(schoolId);

        res.render("schoolAdmin/promotions/index", {
            title: "Student Promotion",
            academicYears,
            classes,
            history,
            selectedYearId,
            formatClassLabel: promotionService.formatClassLabel,
            user: req.user || req.session.user,
            currentPath: "/schooladmin/promotions"
        });
    } catch (error) {
        console.error("Promotion index error:", error);
        req.flash("error", "Failed to load student promotion page.");
        res.redirect("/schooladmin/dashboard");
    };
};

exports.preview = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const fromAcademicYearId = parseId(req.body.from_academic_year_id);
        const toAcademicYearId = parseId(req.body.to_academic_year_id);
        const validationError = ensureYearsValid(fromAcademicYearId, toAcademicYearId);
        if (validationError) {
            req.flash("error", validationError);
            return res.redirect("/schooladmin/promotions");
        };

        const academicYears = await promotionService.getAcademicYears(schoolId);
        const fromYear = academicYears.find((year) => Number(year.id) === fromAcademicYearId);
        const toYear = academicYears.find((year) => Number(year.id) === toAcademicYearId);
        if (!fromYear || !toYear) {
            req.flash("error", "Selected academic year does not exist for your school.");
            return res.redirect("/schooladmin/promotions");
        };

        const filters = {
            fromClassId: req.body.from_class_id,
            medium: req.body.medium
        };

        const { batch, preview } = await promotionService.createPromotionBatch({
            schoolId,
            fromAcademicYearId,
            toAcademicYearId,
            filters,
            createdBy: getUserId(req)
        });

        const batchDetail = await promotionService.getPromotionBatch(schoolId, batch.id);
        const itemByStudent = new Map((batchDetail?.items || []).map((item) => [Number(item.student_id), item]));
        const rows = preview.rows.map((row) => ({
            ...row,
            item_id: itemByStudent.get(Number(row.student_id))?.id || null
        }));
        const targetClasses = preview.targetClasses;

        res.render("schoolAdmin/promotions/preview", {
            title: "Promotion Preview",
            batch,
            fromYear,
            toYear,
            rows,
            targetClasses,
            formatClassLabel: promotionService.formatClassLabel,
            user: req.user || req.session.user,
            currentPath: "/schooladmin/promotions"
        });
    } catch (error) {
        console.error("Promotion preview error:", error);
        req.flash("error", error.message || "Failed to generate promotion preview.");
        res.redirect("/schooladmin/promotions");
    };
};

exports.confirm = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const batchId = parseId(req.body.batch_id);
        if (!batchId) {
            req.flash("error", "Promotion batch is required.");
            return res.redirect("/schooladmin/promotions");
        };

        const summary = await promotionService.confirmPromotionBatch(
            batchId,
            schoolId,
            getUserId(req),
            buildOverrides(req.body)
        );

        req.flash(
            "success",
            `Promotion completed. Promoted: ${summary.promoted}, Repeated: ${summary.repeated}, Skipped: ${summary.skipped}, Graduated: ${summary.graduated}, Duplicate skipped: ${summary.duplicateSkipped}.`
        );
        res.redirect(`/schooladmin/promotions/${batchId}`);
    } catch (error) {
        console.error("Promotion confirm error:", error);
        req.flash("error", error.message || "Failed to confirm promotion.");
        res.redirect("/schooladmin/promotions");
    };
};

exports.history = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const history = await promotionService.getPromotionHistory(schoolId);
        res.render("schoolAdmin/promotions/history", {
            title: "Promotion History",
            history,
            formatClassLabel: promotionService.formatClassLabel,
            user: req.user || req.session.user,
            currentPath: "/schooladmin/promotions/history"
        });
    } catch (error) {
        console.error("Promotion history error:", error);
        req.flash("error", "Failed to load promotion history.");
        res.redirect("/schooladmin/promotions");
    };
};

exports.show = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const batchId = parseId(req.params.batchId);
        const detail = await promotionService.getPromotionBatch(schoolId, batchId);
        if (!detail) {
            req.flash("error", "Promotion batch not found.");
            return res.redirect("/schooladmin/promotions/history");
        }

        res.render("schoolAdmin/promotions/show", {
            title: "Promotion Batch",
            batch: detail.batch,
            items: detail.items,
            formatClassLabel: promotionService.formatClassLabel,
            user: req.user || req.session.user,
            currentPath: "/schooladmin/promotions/history"
        });
    } catch (error) {
        console.error("Promotion show error:", error);
        req.flash("error", "Failed to load promotion batch.");
        res.redirect("/schooladmin/promotions/history");
    };
};