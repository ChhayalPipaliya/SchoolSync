const { queryAsync, executeAsync, withTransaction } = require("../../config/database");
const { signAuthToken, AUTH_COOKIE_NAME, getAuthCookieOptions } = require("../../utils/auth");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const PortalService = require("../../services/portalService");
const { invalidatePlanCache, invalidateSubscriptionCache } = require("../../utils/planCache");

async function getPlanKey(planId) {
    if (!planId) return 'basic';
    const [plan] = await queryAsync("SELECT plan_key FROM plans WHERE id = ?", [planId]);
    return plan ? plan.plan_key : 'basic';
}

function normalizeBillingCycle(cycle) {
    return ["monthly", "yearly"].includes(cycle) ? cycle : "monthly";
}

function getPlanPrice(plan, cycle) {
    return parseFloat(cycle === "yearly" ? plan.yearly_price : plan.monthly_price) || 0;
}

function addCycleToDate(date, cycle) {
    const next = new Date(date);
    const originalDay = date.getDate();
    next.setDate(1);
    if (cycle === "yearly") next.setFullYear(next.getFullYear() + 1);
    else next.setMonth(next.getMonth() + 1);
    const maxDays = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(originalDay, maxDays));
    return next;
}

const SCHOOL_WAY_OPTIONS = ['morning', 'evening', 'full_day'];
function normalizeSchoolWay(value) {
    const selected = Array.isArray(value) ? value.find(v => SCHOOL_WAY_OPTIONS.includes(v)) : value;
    return SCHOOL_WAY_OPTIONS.includes(selected) ? selected : 'full_day';
}

const schoolController = {
    list: async (req, res) => {
        try {
            const { status, plan, search, page = 1 } = req.query;
            const limit = 20;
            const offset = (page - 1) * limit;

            let whereClause = "WHERE 1=1";
            let params = [];

            if (status) {
                whereClause += " AND s.status = ?";
                params.push(status);
            };
            if (plan) {
                whereClause += " AND s.plan = ?";
                params.push(plan);
            };
            if (search) {
                whereClause += ` AND (s.school_name LIKE ? OR s.school_email LIKE ? OR s.subdomain LIKE ? OR s.city LIKE ?)`;
                const searchTerm = `%${search}%`;
                params.push(searchTerm, searchTerm, searchTerm, searchTerm);
            };

            const schools = await queryAsync(`
                SELECT 
                    s.*,
                    p.name as plan_name,
                    (SELECT COUNT(*) FROM students WHERE school_id = s.id AND status = 'active') as student_count,
                    (SELECT COUNT(*) FROM teachers t 
                        JOIN users u ON t.user_id = u.id 
                        WHERE u.school_id = s.id AND u.status = 'active') as teacher_count,
                    (SELECT COALESCE(SUM(total_amount), 0) 
                        FROM subscription_payments 
                        WHERE school_id = s.id AND status = 'completed') as total_paid
                FROM schools s
                LEFT JOIN plans p ON s.plan_id = p.id
                ${whereClause}
                ORDER BY s.created_at DESC
                LIMIT ? OFFSET ?
            `, [...params, limit, offset]);

            const [totalResult] = await queryAsync(`
                SELECT COUNT(*) as total FROM schools s ${whereClause}
            `, params);

            const [stats] = await queryAsync(`
                SELECT 
                    COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
                    COUNT(CASE WHEN status = 'trial' THEN 1 END) as trial,
                    COUNT(CASE WHEN status = 'inactive' THEN 1 END) as inactive,
                    COUNT(CASE WHEN status = 'expired' THEN 1 END) as expired,
                    COUNT(*) as total_schools,
                    COALESCE(SUM(
                        (SELECT SUM(total_amount) FROM subscription_payments 
                        WHERE school_id = s.id AND status = 'completed')
                    ), 0) as total_revenue
                FROM schools s
            `);

            const plans = await queryAsync("SELECT plan_key, name FROM plans WHERE is_active = TRUE");
            const totalPages = Math.ceil(totalResult.total / limit);

            res.render("superAdmin/schools/list", {
                title: "Schools Management - SchoolSync",
                schools,
                plans,
                stats,
                filters: { status, plan, search },
                pagination: {
                    page: parseInt(page),
                    totalPages,
                    total: totalResult.total,
                    hasNext: parseInt(page) < totalPages,
                    hasPrev: parseInt(page) > 1
                },
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            console.error("School List Error:", error);
            req.flash("error", "Failed to load schools list");
            res.redirect("/superadmin/dashboard");
        }
    },

    addForm: async (req, res) => {
        try {
            const plans = await queryAsync("SELECT id, name, plan_key, monthly_price, yearly_price, monthly_price as price, trial_days, color_code FROM plans WHERE is_active = TRUE AND status = 'active' ORDER BY monthly_price ASC");
            const groups = await queryAsync(
                "SELECT id, group_name FROM school_groups WHERE status = 'active' ORDER BY group_name ASC"
            );
            res.render("superAdmin/schools/add", {
                title: "Add New School - SchoolSync",
                plans,
                groups,
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            console.error("Add Form Error:", error);
            req.flash("error", "Failed to load add form");
            res.redirect("/superadmin/schools");
        };
    },

    create: async (req, res) => {
        const connection = await require("../../config/database").pool.promise().getConnection();
        try {
            await connection.beginTransaction();

            const { school_name, subdomain, school_email, school_phone, password, admin_first_name, admin_last_name, admin_email, admin_phone, establishment_year, website, school_type, medium, board, gender_type, school_way, school_address, city, state, pincode, school_principal_name, school_principal_email, school_principal_phone, udise_code, affiliation_board, affiliation_number, school_registration_number, pan_number, gst_number, plan_id, status, trial_ends_at, school_group_id, branch_name: school_branch_name, area, branch_code, billing_cycle, account_holder_name, bank_name, account_number, ifsc_code, bank_branch_name, subscription_start_mode, payment_status, payment_method, amount_paid, payment_reference, payment_note, latitude, longitude } = req.body;
            const hasGroup = school_group_id && String(school_group_id).trim() !== "" && String(school_group_id).trim() !== "0";
            const final_group_id = hasGroup ? Number.parseInt(school_group_id, 10) : null;
            const final_branch_name = hasGroup ? (school_branch_name?.trim() || null) : null;
            const final_branch_code = hasGroup ? (branch_code?.trim() || null) : null;
            const final_area = hasGroup ? (area?.trim() || null) : null;

            if (hasGroup) {
                if (!final_branch_name) {
                    throw new Error("Branch Name is required when a School Group is selected.");
                };
                if (!final_branch_code) {
                    throw new Error("Branch Code is required when a School Group is selected.");
                };
            };

            const selectedPlanId = Number.parseInt(plan_id, 10) || null;
            const [planRows] = selectedPlanId
                ? await connection.execute(
                    "SELECT * FROM plans WHERE id = ? AND is_active = 1 AND status = 'active' LIMIT 1",
                    [selectedPlanId]
                )
                : await connection.execute(
                    "SELECT * FROM plans WHERE is_active = 1 AND status = 'active' ORDER BY monthly_price ASC, id ASC LIMIT 1"
                );
            const plan = planRows[0];
            if (!plan) {
                throw new Error("Please create at least one active subscription plan before adding a school.");
            };

            const selectedCycle = normalizeBillingCycle(billing_cycle);
            const startMode = subscription_start_mode || "trial";
            const startDate = new Date();
            const schoolEndDate = new Date(startDate);
            schoolEndDate.setDate(schoolEndDate.getDate() + 7);
            let trialPlan = null;
            if (startMode === "trial") {
                const [trialPlanRows] = await connection.execute(
                    `SELECT * FROM plans
                     WHERE is_active = 1
                        AND status = 'active'
                        AND (
                            LOWER(COALESCE(plan_key, '')) = 'trial'
                            OR LOWER(COALESCE(slug, '')) = 'trial'
                            OR LOWER(COALESCE(name, '')) = 'trial'
                        )    
                     LIMIT 1`
                );
                trialPlan = trialPlanRows[0] || plan;
            };

            let statusVal = "trial";
            let subStatusVal = "trial";
            let currentPlanIdVal = null;
            let planNameVal = null;
            let trialStartedAtVal = null;
            let trialEndsAtVal = null;
            let subStartedAtVal = null;
            let subEndsAtVal = null;
            let subStartVal = null;
            let subEndVal = null;
            const isTrialUsedVal = 1;

            if (startMode === "trial") {
                statusVal = "trial";
                subStatusVal = "trial";
                currentPlanIdVal = trialPlan.id;
                planNameVal = trialPlan.plan_key || "trial";
                trialStartedAtVal = startDate;
                trialEndsAtVal = schoolEndDate;
                subStartedAtVal = null;
                subEndsAtVal = null;
                subStartVal = null;
                subEndVal = schoolEndDate;
            } else {
                const payStatus = payment_status || "paid";
                currentPlanIdVal = plan.id;
                planNameVal = plan.plan_key;
                trialStartedAtVal = null;
                trialEndsAtVal = null;
                subEndsAtVal = addCycleToDate(startDate, selectedCycle);

                if (payStatus === "paid") {
                    statusVal = "active";
                    subStatusVal = "active";
                    subStartedAtVal = startDate;
                    subStartVal = startDate;
                    subEndVal = subEndsAtVal;
                } else {
                    statusVal = "expired";
                    subStatusVal = "expired";
                    subStartedAtVal = null;
                    subEndsAtVal = null;
                    subStartVal = null;
                    subEndVal = null;
                };
            };

            const plainPassword = password && password.trim() ? password.trim() : "School@123";
            const hashedPassword = await bcrypt.hash(plainPassword, 10);
            let logoPath = null;
            if (req.files?.logo?.[0]) {
                logoPath = '/uploads/schoolAdmin/' + req.files.logo[0].filename;
            };

            const formatJsonArray = (value) => {
                if (Array.isArray(value)) return JSON.stringify(value.filter(Boolean));
                if (typeof value === "string" && value.trim()) {
                    const trimmed = value.trim();
                    if (trimmed.startsWith("[") && trimmed.endsWith("]")) return trimmed;
                    return JSON.stringify(trimmed.split(",").map(v => v.trim()).filter(Boolean));
                };
                return JSON.stringify([]);
            };

            const selectedSchoolType = formatJsonArray(school_type);
            const selectedMediums = formatJsonArray(medium);
            const selectedSchoolWay = normalizeSchoolWay(school_way);
            if (JSON.parse(selectedSchoolType).length === 0 || JSON.parse(selectedMediums).length === 0) {
                throw new Error("Please select school type and at least one medium.");
            };

            let latVal = null;
            let lngVal = null;

            if (latitude !== undefined && latitude !== null && String(latitude).trim() !== "") {
                const parsedLat = parseFloat(latitude);
                if (isNaN(parsedLat) || parsedLat < -90 || parsedLat > 90) {
                    throw new Error("Latitude must be a valid number between -90 and 90.");
                };
                latVal = parsedLat;
            };

            if (longitude !== undefined && longitude !== null && String(longitude).trim() !== "") {
                const parsedLng = parseFloat(longitude);
                if (isNaN(parsedLng) || parsedLng < -180 || parsedLng > 180) {
                    throw new Error("Longitude must be a valid number between -180 and 180.");
                };
                lngVal = parsedLng;
            };

            const [result] = await connection.execute(
                `INSERT INTO schools 
                (school_name, subdomain, school_email, school_phone, password, website, establishment_year,
                    school_type, medium, board, gender_type, school_way, school_address, city, state, pincode, latitude, longitude, logo,
                    school_principal_name, school_principal_email, school_principal_phone,
                    udise_code, affiliation_board, affiliation_number, school_registration_number,
                    pan_number, gst_number, plan_id, current_plan_id, plan, status, subscription_status,
                    trial_started_at, trial_ends_at, subscription_started_at, subscription_ends_at,
                    subscription_start, subscription_end, trial_used, is_trial_used,
                    school_group_id, branch_name, area, branch_code)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [ school_name?.trim(), subdomain?.trim().toLowerCase(), school_email?.trim() || null, school_phone?.trim() || null, 
                    hashedPassword, website?.trim() || null, establishment_year || null, selectedSchoolType, selectedMediums, board || null, gender_type || 'co-ed', selectedSchoolWay,
                    school_address?.trim() || null, city?.trim() || null, state?.trim() || null, pincode?.trim() || null, latVal, lngVal, logoPath,
                    school_principal_name?.trim() || null, school_principal_email?.trim() || null, school_principal_phone?.trim() || null,
                    udise_code?.trim() || null, affiliation_board?.trim() || null, affiliation_number?.trim() || null,  school_registration_number?.trim() || null,
                    pan_number ? pan_number.trim().toUpperCase().substring(0, 20) : null, gst_number ? gst_number.trim().toUpperCase().substring(0, 20) : null,
                    currentPlanIdVal, currentPlanIdVal, planNameVal, statusVal, subStatusVal, trialStartedAtVal, trialEndsAtVal, subStartedAtVal, subEndsAtVal,
                    subStartVal, subEndVal, isTrialUsedVal, isTrialUsedVal, final_group_id, final_branch_name, final_area, final_branch_code
                ]
            );

            const schoolId = result.insertId;
            await PortalService.initializeSchoolClassesAndMediums(schoolId, selectedSchoolType, selectedMediums, connection);

            if (account_holder_name && bank_name && account_number && ifsc_code) {
                await connection.execute(
                    `INSERT INTO school_bank_details 
                    (school_id, account_holder_name, bank_name, account_number, ifsc_code, branch_name)
                    VALUES (?, ?, ?, ?, ?, ?)`,
                    [schoolId, account_holder_name, bank_name, account_number, ifsc_code, bank_branch_name || null]
                );
            };

            const docTypes = ['registration_certificate', 'affiliation_certificate', 'udise', 'address_proof', 'other_document'];
            for (const doc of docTypes) {
                if (req.files?.[doc]?.[0]) {
                    const docType = doc === 'other_document' ? 'other' : doc;
                    await connection.execute(
                        `INSERT INTO school_documents (school_id, document_type, file_path) 
                         VALUES (?, ?, ?)`,
                        [schoolId, docType, '/uploads/schools/documents/' + req.files[doc][0].filename]
                    );
                };
            };

            const adminEmail = (admin_email || school_principal_email || school_email || "").trim().toLowerCase();
            if (!adminEmail) {
                throw new Error("School admin email is required.");
            };
            const principalParts = String(school_principal_name || "").trim().split(/\s+/).filter(Boolean);
            const first_name = (admin_first_name || principalParts[0] || "Admin").trim();
            const last_name = (admin_last_name || principalParts.slice(1).join(" ") || "User").trim();

            await connection.execute(
                `INSERT INTO users (school_id, first_name, last_name, email, phone, password, role, status, is_email_verified)
                VALUES (?, ?, ?, ?, ?, ?, 'school_admin', 'active', TRUE)`,
                [schoolId, first_name, last_name, adminEmail, (admin_phone || school_principal_phone || school_phone || "").trim() || null, hashedPassword]
            );

            if (startMode === "trial") {
                await connection.execute(
                    `INSERT INTO subscriptions
                    (school_id, plan_id, plan, price, start_date, end_date, status, payment_status, billing_cycle, trial_start_date, trial_end_date, auto_renew, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, 'trial', 'pending', ?, ?, ?, 0, NOW(), NOW())`,
                    [ schoolId, trialPlan.id, trialPlan.plan_key || "trial", 0, startDate, schoolEndDate, "monthly", startDate, schoolEndDate ]
                );
            } else {
                const payStatus = payment_status || "paid";
                const subStatus = payStatus === "paid" ? "active" : "expired";
                const planAmount = getPlanPrice(plan, selectedCycle);
                const amountPaidVal = parseFloat(amount_paid) || planAmount;
                const paymentRefVal = payment_reference || null;
                const paymentNoteVal = payment_note || null;
                const paymentMethodVal = payment_method || "cash";

                const [subRes] = await connection.execute(
                    `INSERT INTO subscriptions
                    (school_id, plan_id, plan, price, start_date, end_date, status, payment_status, billing_cycle, trial_start_date, trial_end_date, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                    [ schoolId, plan.id, plan.plan_key, getPlanPrice(plan, selectedCycle), payStatus === "paid" ? startDate : null, payStatus === "paid" ? subEndsAtVal : null, subStatus, payStatus === "paid" ? "paid" : "pending", selectedCycle, null, null ]
                );

                const newSubId = subRes.insertId;
                const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
                const receiptSuffix = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
                const receiptNumber = `RCP-SUB-${schoolId}-${todayStr}-${receiptSuffix}`;

                await connection.execute(
                    `INSERT INTO subscription_payments 
                    (school_id, subscription_id, plan_id, amount, tax_amount, discount_amount, total_amount, payment_method, transaction_id, receipt_no, status, paid_at, notes, collected_by, created_at, updated_at)
                    VALUES (?, ?, ?, ?, 0.00, 0.00, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                    [ schoolId, newSubId, plan.id, amountPaidVal, amountPaidVal, paymentMethodVal, paymentRefVal, receiptNumber, payStatus === "paid" ? "completed" : "pending", payStatus === "paid" ? startDate : null, paymentNoteVal, req.user?.id || null ]
                );

                await connection.execute(
                    `INSERT INTO subscription_history 
                    (school_id, old_plan_id, old_plan_name, new_plan_id, new_plan_name, change_type, billing_cycle, amount_paid, payment_ref, created_at)
                    VALUES (?, NULL, NULL, ?, ?, 'purchase', ?, ?, ?, NOW())`,
                    [ schoolId, plan.id, plan.name, selectedCycle, amountPaidVal, paymentRefVal ]
                );
            };

            await connection.commit();
            await Promise.all([
                invalidatePlanCache(schoolId),
                invalidateSubscriptionCache(schoolId)
            ]);

            const adminLoginPassword = plainPassword;
            req.flash("success", `School "${school_name}" created successfully! Login Email: ${adminEmail} | Password: ${adminLoginPassword}`);
            res.redirect("/superadmin/schools");
        } catch (error) {
            await connection.rollback();
            console.error("Create School Error:", error);
            req.flash("error", error.message || "Failed to create school");
            res.redirect("/superadmin/schools/add");
        } finally {
            connection.release();
        };
    },

    detail: async (req, res) => {
        try {
            const schoolId = req.params.id;
            const [school] = await queryAsync(`
                SELECT s.*, p.name as plan_name, p.monthly_price as plan_price, p.features
                FROM schools s
                LEFT JOIN plans p ON s.plan_id = p.id
                WHERE s.id = ?
            `, [schoolId]);

            if (!school) {
                req.flash("error", "School not found");
                return res.redirect("/superadmin/schools");
            };

            const stats = await queryAsync(`
                SELECT 
                    (SELECT COUNT(*) FROM students WHERE school_id = ? AND status = 'active') as students,
                    (SELECT COUNT(*) FROM teachers t JOIN users u ON t.user_id = u.id WHERE u.school_id = ? AND u.status = 'active') as teachers,
                    (SELECT COUNT(*) FROM classes WHERE school_id = ?) as classes,
                    (SELECT COUNT(*) FROM users WHERE school_id = ? AND role = 'school_admin' AND status = 'active') as admins,
                    (SELECT COALESCE(SUM(total_amount), 0) FROM subscription_payments WHERE school_id = ? AND status = 'completed') as total_revenue,
                    (SELECT COUNT(*) FROM support_tickets WHERE school_id = ?) as tickets
            `, [schoolId, schoolId, schoolId, schoolId, schoolId, schoolId]);

            const payments = await queryAsync(`
                SELECT sp.*, p.name AS plan_name
                FROM subscription_payments sp
                LEFT JOIN plans p ON sp.plan_id = p.id
                WHERE sp.school_id = ?
                ORDER BY sp.created_at DESC
                LIMIT 5
            `, [schoolId]);

            const subscriptions = await queryAsync(`
                SELECT s.*,
                    COALESCE(s.plan, p.name) AS plan_display,
                    p.name AS plan_name,
                    p.plan_key,
                    p.monthly_price,
                    p.yearly_price
                FROM subscriptions s
                LEFT JOIN plans p ON s.plan_id = p.id
                WHERE s.school_id = ?
                ORDER BY s.created_at DESC
            `, [schoolId]);

            const bankDetails = await queryAsync(`
                SELECT * FROM school_bank_details 
                WHERE school_id = ? 
                ORDER BY is_primary DESC
            `, [schoolId]);

            const documents = await queryAsync(`
                SELECT * FROM school_documents 
                WHERE school_id = ?
            `, [schoolId]);

            res.render("superAdmin/schools/detail", {
                title: `${school.school_name} - SchoolSync`,
                school,
                stats: stats[0],
                payments,
                subscriptions,
                bankDetails,
                documents,
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            console.error("School Detail Error:", error);
            req.flash("error", "Failed to load school details");
            res.redirect("/superadmin/schools");
        };
    },

    editForm: async (req, res) => {
        try {
            const schoolId = req.params.id;
            const [school] = await queryAsync("SELECT * FROM schools WHERE id = ?", [schoolId]);
            if (!school) {
                req.flash("error", "School not found");
                return res.redirect("/superadmin/schools");
            };

            const bankDetails = await queryAsync("SELECT * FROM school_bank_details WHERE school_id = ? ORDER BY is_primary DESC LIMIT 1", [schoolId]);
            const documents = await queryAsync("SELECT * FROM school_documents WHERE school_id = ?", [schoolId]);
            const plans = await queryAsync("SELECT id, name, plan_key, monthly_price as price FROM plans WHERE is_active = TRUE");
            const groups = await queryAsync(
                "SELECT id, group_name FROM school_groups WHERE status = 'active' ORDER BY group_name ASC"
            );

            res.render("superAdmin/schools/edit", {
                title: "Edit School - SchoolSync",
                school,
                bankDetail: bankDetails[0] || null,
                documents,
                plans,
                groups,
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            req.flash("error", "Failed to load edit form");
            res.redirect("/superadmin/schools");
        };
    },

    update: async (req, res) => {
        const connection = await require("../../config/database").pool.promise().getConnection();
        try {
            await connection.beginTransaction();
            const schoolId = req.params.id;
            const { school_name, subdomain, school_email, school_phone, password, establishment_year, website, school_type, medium, board, gender_type, school_way, status, school_address, city, state, pincode, school_principal_name, school_principal_email, school_principal_phone, udise_code, affiliation_board, affiliation_number, school_registration_number, pan_number, gst_number, school_group_id, branch_name: school_branch_name, area, branch_code, plan_id, trial_ends_at, subscription_end, account_holder_name, bank_name, account_number, ifsc_code, bank_branch_name, latitude, longitude } = req.body;
            const hasGroup = school_group_id && String(school_group_id).trim() !== "" && String(school_group_id).trim() !== "0";
            const final_group_id = hasGroup ? Number.parseInt(school_group_id, 10) : null;
            const final_branch_name = hasGroup ? (school_branch_name?.trim() || null) : null;
            const final_branch_code = hasGroup ? (branch_code?.trim() || null) : null;
            const final_area = hasGroup ? (area?.trim() || null) : null;

            if (hasGroup) {
                if (!final_branch_name) {
                    throw new Error("Branch Name is required when a School Group is selected.");
                };
                if (!final_branch_code) {
                    throw new Error("Branch Code is required when a School Group is selected.");
                };
            };

            let logoPath = null;
            if (req.files && req.files['logo'] && req.files['logo'][0]) {
                logoPath = '/uploads/schools/documents/' + req.files['logo'][0].filename;
            };

            const formatJsonArray = (val) => {
                if (!val) return null;
                if (Array.isArray(val)) {
                    return JSON.stringify(val);
                };
                if (typeof val === 'string') {
                    if (val.startsWith('[') && val.endsWith(']')) {
                        return val;
                    };
                    return JSON.stringify([val]);
                };
                return JSON.stringify([val]);
            };

            const formattedSchoolType = formatJsonArray(school_type);
            const formattedMedium = formatJsonArray(medium);
            const selectedSchoolWayForUpdate = normalizeSchoolWay(school_way);

            let latVal = null;
            let lngVal = null;
            if (latitude !== undefined && latitude !== null && String(latitude).trim() !== "") {
                const parsedLat = parseFloat(latitude);
                if (isNaN(parsedLat) || parsedLat < -90 || parsedLat > 90) {
                    throw new Error("Latitude must be a valid number between -90 and 90.");
                };
                latVal = parsedLat;
            };

            if (longitude !== undefined && longitude !== null && String(longitude).trim() !== "") {
                const parsedLng = parseFloat(longitude);
                if (isNaN(parsedLng) || parsedLng < -180 || parsedLng > 180) {
                    throw new Error("Longitude must be a valid number between -180 and 180.");
                };
                lngVal = parsedLng;
            };

            let updateSql = `UPDATE schools SET
                school_name = ?, subdomain = ?, school_email = ?, school_phone = ?,
                establishment_year = ?, website = ?, school_type = ?, medium = ?, board = ?, gender_type = ?, school_way = ?, status = ?,
                school_address = ?, city = ?, state = ?, pincode = ?, latitude = ?, longitude = ?,
                school_principal_name = ?, school_principal_email = ?, school_principal_phone = ?,
                udise_code = ?, affiliation_board = ?, affiliation_number = ?, school_registration_number = ?,
                pan_number = ?, gst_number = ?,
                school_group_id = ?, branch_name = ?, area = ?, branch_code = ?,
                plan_id = ?, plan = ?, trial_ends_at = ?, subscription_end = ?`;
            
            let updateParams = [
                school_name?.trim(), subdomain?.trim().toLowerCase(), school_email?.trim() || null, school_phone?.trim() || null,
                establishment_year || null, website?.trim() || null, formattedSchoolType, formattedMedium, board || null, gender_type || 'co-ed', selectedSchoolWayForUpdate, status,
                school_address?.trim() || null, city?.trim() || null, state?.trim() || null, pincode?.trim() || null, latVal, lngVal,
                school_principal_name?.trim() || null, school_principal_email?.trim() || null, school_principal_phone?.trim() || null,
                udise_code?.trim() || null, affiliation_board?.trim() || null, affiliation_number?.trim() || null, school_registration_number?.trim() || null,
                pan_number ? pan_number.trim().toUpperCase().substring(0, 20) : null,
                gst_number ? gst_number.trim().toUpperCase().substring(0, 20) : null, final_group_id, final_branch_name, final_area, final_branch_code,
                plan_id || null, plan_id ? await getPlanKey(plan_id) : 'basic', trial_ends_at || null, subscription_end || null
            ];

            if (logoPath) {
                updateSql += `, logo = ?`;
                updateParams.push(logoPath);
            };

            if (password && password.trim() !== "") {
                const hashedPassword = await bcrypt.hash(password, 10);
                updateSql += `, password = ?`;
                updateParams.push(hashedPassword);

                await connection.execute(
                    `UPDATE users SET password = ? WHERE school_id = ? AND role = 'school_admin'`,
                    [hashedPassword, schoolId]
                );
            };

            updateSql += ` WHERE id = ?`;
            updateParams.push(schoolId);

            await connection.execute(updateSql, updateParams);
            await connection.execute(
                `UPDATE users SET email = ? WHERE school_id = ? AND role = 'school_admin'`,
                [(school_email?.trim() || "").toLowerCase() || null, schoolId]
            );

            if (account_holder_name && bank_name && account_number && ifsc_code) {
                const [existingBank] = await connection.execute("SELECT id FROM school_bank_details WHERE school_id = ? LIMIT 1", [schoolId]);
                if (existingBank.length > 0) {
                    await connection.execute(
                        `UPDATE school_bank_details SET account_holder_name = ?, bank_name = ?, account_number = ?, ifsc_code = ?, branch_name = ? WHERE school_id = ?`,
                        [account_holder_name, bank_name, account_number, ifsc_code, bank_branch_name || null, schoolId]
                    );
                } else {
                    await connection.execute(
                        `INSERT INTO school_bank_details (school_id, account_holder_name, bank_name, account_number, ifsc_code, branch_name) VALUES (?, ?, ?, ?, ?, ?)`,
                        [schoolId, account_holder_name, bank_name, account_number, ifsc_code, bank_branch_name || null]
                    );
                };
            };

            const docTypes = ['registration_certificate', 'affiliation_certificate', 'udise', 'address_proof', 'other_document'];
            for (const doc of docTypes) {
                if (req.files && req.files[doc] && req.files[doc][0]) {
                    const dbDocType = doc === 'other_document' ? 'other' : doc;
                    const [existingDoc] = await connection.execute("SELECT id FROM school_documents WHERE school_id = ? AND document_type = ?", [schoolId, dbDocType]);
                    if (existingDoc.length > 0) {
                        await connection.execute("UPDATE school_documents SET file_path = ? WHERE id = ?", ['/uploads/schools/documents/' + req.files[doc][0].filename, existingDoc[0].id]);
                    } else {
                        await connection.execute("INSERT INTO school_documents (school_id, document_type, file_path) VALUES (?, ?, ?)", [schoolId, dbDocType, '/uploads/schools/documents/' + req.files[doc][0].filename]);
                    };
                };
            };

            await connection.commit();
            await Promise.all([
                invalidatePlanCache(schoolId),
                invalidateSubscriptionCache(schoolId)
            ]);
            req.flash("success", "School updated successfully");
            res.redirect(`/superadmin/schools/${schoolId}`);
        } catch (error) {
            await connection.rollback();
            console.error("Update School Error:", error);
            req.flash("error", "Failed to update school");
            res.redirect(`/superadmin/schools/${req.params.id}/edit`);
        } finally {
            connection.release();
        };
    },

    delete: async (req, res) => {
        try {
            const schoolId = req.params.id;
            await executeAsync("DELETE FROM schools WHERE id = ?", [schoolId]);
            req.flash("success", "School deleted successfully");
            res.redirect("/superadmin/schools");
        } catch (error) {
            console.error("Delete School Error:", error);
            req.flash("error", "Failed to delete school");
            res.redirect("/superadmin/schools");
        };
    },

    toggleStatus: async (req, res) => {
        try {
            const schoolId = req.params.id;
            const { status } = req.body;

            await executeAsync(
                "UPDATE schools SET status = ? WHERE id = ?",
                [status, schoolId]
            );

            req.flash("success", `School status changed to ${status}`);
            res.redirect(`/superadmin/schools/${schoolId}`);
        } catch (error) {
            req.flash("error", "Failed to toggle status");
            res.redirect("/superadmin/schools");
        };
    },

    impersonate: async (req, res) => {
        try {
            const schoolId = req.params.id;

            const [admin] = await queryAsync(`
                SELECT u.*, u.first_name, u.last_name FROM users u
                WHERE u.school_id = ? AND u.role = 'school_admin' AND u.status = 'active'
                LIMIT 1
            `, [schoolId]);

            if (!admin) {
                req.flash("error", "No active school admin found for this school");
                return res.redirect(`/superadmin/schools/${schoolId}`);
            };

            await executeAsync(
                `INSERT INTO admin_impersonation_logs
                (super_admin_id, target_school_id, target_user_id, ip_address, user_agent, action, session_token)
                VALUES (?, ?, ?, ?, ?, 'login', ?)`,
                [req.user.id, schoolId, admin.id, req.ip, req.headers['user-agent'] || null, req.sessionID || null]
            );

            if (req.session) {
                req.session.impersonation = {
                    superAdminUser: req.user,
                    schoolId,
                    targetUserId: admin.id,
                    startedAt: new Date().toISOString()
                };
            };

            const token = signAuthToken(admin);
            res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions(false));
            req.flash("success", `Impersonating as ${admin.name || [admin.first_name, admin.last_name].filter(Boolean).join(' ')}`);
            return res.redirect("/schooladmin/dashboard");
        } catch (error) {
            console.error("Impersonate Error:", error);
            req.flash("error", "Impersonation failed");
            res.redirect("/superadmin/schools");
        };
    },

    stopImpersonation: async (req, res) => {
        try {
            const impersonation = req.session?.impersonation;
            if (!impersonation?.superAdminUser) {
                req.flash("info", "No active impersonation session found.");
                return res.redirect("/login");
            };

            await executeAsync(
                `UPDATE admin_impersonation_logs
                SET ended_at = CURRENT_TIMESTAMP, action = 'logout'
                WHERE super_admin_id = ? AND target_school_id = ? AND target_user_id = ? AND ended_at IS NULL
                ORDER BY started_at DESC
                LIMIT 1`,
                [impersonation.superAdminUser.id, impersonation.schoolId, impersonation.targetUserId]
            );

            const token = signAuthToken(impersonation.superAdminUser);
            res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions(false));
            req.session.user = impersonation.superAdminUser;
            delete req.session.impersonation;

            req.flash("success", "Impersonation stopped. You are back in Super Admin.");
            return res.redirect("/superadmin/dashboard");
        } catch (error) {
            console.error("Stop Impersonation Error:", error);
            req.flash("error", "Failed to stop impersonation. Please sign in again.");
            return res.redirect("/login");
        };
    },

    gdprExport: async (req, res) => {
        try {
            const schoolId = req.params.id;
            const [school] = await queryAsync("SELECT * FROM schools WHERE id = ?", [schoolId]);
            if (!school) {
                req.flash("error", "School not found");
                return res.redirect("/superadmin/schools");
            };

            const [ users, students, teachers, subscriptions, payments, tickets ] = await Promise.all([
                queryAsync("SELECT id, first_name, last_name, email, role, status FROM users WHERE school_id = ?", [schoolId]),
                queryAsync("SELECT id, admission_no, status FROM students WHERE school_id = ?", [schoolId]),
                queryAsync("SELECT id, employee_id, specialization FROM teachers WHERE school_id = ?", [schoolId]),
                queryAsync("SELECT id, plan, price, start_date, end_date, status FROM subscriptions WHERE school_id = ?", [schoolId]),
                queryAsync("SELECT id, amount, total_amount, status, paid_at FROM subscription_payments WHERE school_id = ?", [schoolId]),
                queryAsync("SELECT id, ticket_no, subject, category, priority, status FROM support_tickets WHERE school_id = ?", [schoolId])
            ]);

            const gdprDump = {
                export_meta: {
                    exported_at: new Date().toISOString(),
                    regulatory_compliance: "GDPR Art 20 - Right to Data Portability",
                    school_id: schoolId
                },
                school_profile: school,
                tenant_users: users,
                tenant_students: students,
                tenant_teachers: teachers,
                active_subscriptions: subscriptions,
                payment_ledgers: payments,
                helpdesk_queries: tickets
            };

            res.setHeader("Content-disposition", `attachment; filename=GDPR_Export_School_${schoolId}.json`);
            res.setHeader("Content-type", "application/json");
            res.send(JSON.stringify(gdprDump, null, 4));
        } catch (error) {
            console.error("GDPR Export Error:", error);
            req.flash("error", "Failed to compile GDPR data portability dump");
            res.redirect(`/superadmin/schools/${req.params.id}`);
        };
    },

    purgeSchool: async (req, res) => {
        try {
            const schoolId = req.params.id;
            const [school] = await queryAsync("SELECT school_name FROM schools WHERE id = ?", [schoolId]);
            if (!school) {
                req.flash("error", "School not found");
                return res.redirect("/superadmin/schools");
            };

            await withTransaction(async (tx) => {
                await tx.execute("DELETE FROM announcement_schools WHERE school_id = ?", [schoolId]);
                await tx.execute("DELETE FROM invoices WHERE school_id = ?", [schoolId]);
                await tx.execute("DELETE FROM subscription_payments WHERE school_id = ?", [schoolId]);
                await tx.execute("DELETE FROM subscriptions WHERE school_id = ?", [schoolId]);
                await tx.execute("DELETE FROM support_tickets WHERE school_id = ?", [schoolId]);
                await tx.execute("DELETE FROM school_documents WHERE school_id = ?", [schoolId]);
                await tx.execute("DELETE FROM school_bank_details WHERE school_id = ?", [schoolId]);
                await tx.execute("DELETE FROM school_activity_logs WHERE school_id = ?", [schoolId]);
                await tx.execute("DELETE FROM logs WHERE school_id = ?", [schoolId]);
                await tx.execute("DELETE FROM api_metrics WHERE school_id = ?", [schoolId]);
                await tx.execute("DELETE FROM users WHERE school_id = ?", [schoolId]);
                await tx.execute("DELETE FROM schools WHERE id = ?", [schoolId]);
            });

            req.flash("success", `School "${school.school_name}" and all associated files/records permanently deleted (GDPR Right to be Forgotten).`);
            res.redirect("/superadmin/schools");
        } catch (error) {
            console.error("Purge School Error:", error);
            req.flash("error", "Failed to purge school records: " + error.message);
            res.redirect(`/superadmin/schools/${req.params.id}`);
        };
    },

    bulkStatus: async (req, res) => {
        try {
            const { school_ids, status } = req.body;
            const ids = Array.isArray(school_ids) ? school_ids : (school_ids ? [school_ids] : []);
            if (ids.length > 0) {
                await executeAsync("UPDATE schools SET status = ? WHERE id IN (?)", [status, ids]);
                req.flash("success", `Successfully updated status to "${status}" for ${ids.length} school(s).`);
            } else {
                req.flash("error", "No schools selected.");
            };
            res.redirect("/superadmin/schools");
        } catch (error) {
            console.error("Bulk Status Error:", error);
            req.flash("error", "Bulk status update operation failed");
            res.redirect("/superadmin/schools");
        };
    },

    bulkPlan: async (req, res) => {
        try {
            const { school_ids, plan_id } = req.body;
            const ids = Array.isArray(school_ids) ? school_ids : (school_ids ? [school_ids] : []);
            
            if (ids.length > 0 && plan_id) {
                const planKey = await getPlanKey(plan_id);
                await executeAsync("UPDATE schools SET plan_id = ?, plan = ? WHERE id IN (?)", [plan_id, planKey, ids]);
                await Promise.all(ids.flatMap(id => [
                    invalidatePlanCache(id),
                    invalidateSubscriptionCache(id)
                ]));
                req.flash("success", `Successfully shifted ${ids.length} school(s) to Plan "${planKey}".`);
            } else {
                req.flash("error", "No schools or subscription plans selected.");
            };

            res.redirect("/superadmin/schools");
        } catch (error) {
            console.error("Bulk Plan Error:", error);
            req.flash("error", "Bulk subscription modification failed");
            res.redirect("/superadmin/schools");
        };
    },

    bulkEmail: async (req, res) => {
        try {
            const { school_ids, subject, body } = req.body;
            const ids = Array.isArray(school_ids) ? school_ids : (school_ids ? [school_ids] : []);
            
            if (ids.length > 0 && subject && body) {
                const schools = await queryAsync("SELECT school_email, school_name FROM schools WHERE id IN (?)", [ids]);
                const nodemailer = require("nodemailer");
                const transporter = nodemailer.createTransport({
                    service: "gmail",
                    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
                });

                let sentCount = 0;
                for (const s of schools) {
                    if (s.school_email) {
                        await transporter.sendMail({
                            from: process.env.EMAIL_USER,
                            to: s.school_email,
                            subject: subject,
                            html: `
                                <div style="font-family:sans-serif;color:#334155;max-width:600px;margin:auto;border:1px solid #E2E8F0;border-radius:8px;padding:25px;">
                                    <h3>Dear Administrator of ${s.school_name},</h3>
                                    <p style="font-size:14px;line-height:1.6;color:#475569;">${body}</p>
                                    <br/>
                                    <p>Warm Regards,<br/><strong>SchoolSync Administration Desk</strong></p>
                                </div>
                            `
                        }).catch(err => console.error(`Bulk email single delivery fail to ${s.school_email}:`, err.message));
                        sentCount++;
                    };
                };
                req.flash("success", `Bulk administrative email broadcast completed for ${sentCount} school(s).`);
            } else {
                req.flash("error", "No schools or empty email details provided.");
            };
            res.redirect("/superadmin/schools");
        } catch (error) {
            console.error("Bulk Email Error:", error);
            req.flash("error", "Bulk email broadcast failed");
            res.redirect("/superadmin/schools");
        };
    }
};

module.exports = schoolController;
