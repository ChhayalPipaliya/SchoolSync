const crypto = require("crypto");
const bcryptjs = require("bcryptjs");
const { queryAsync } = require("../config/database");
const sendOTP = require("../middleware/send_otp");
const { deleteOtpRecord, getOtpRecord, setOtpRecord } = require("../utils/otpStore");
const { AUTH_COOKIE_NAME, clearAuthCookie, getDashboardPath, getAuthCookieOptions, sanitizeUserForClient, signAuthToken } = require("../utils/auth");
const { isStrongPassword, isValidEmail, normalizeEmail, normalizeText } = require("../utils/validation");
const { getStoredImagePath } = require("../middleware/upload");
const academicYearService = require("../services/academicYearService");

const { OTP_COOLDOWN_MS, OTP_EXPIRY_MS } = require("../config/constants");
const ROLE_TABLE_MAP = {
    school_admin: { table: "users", column: "id" },
    teacher: { table: "teachers", column: "user_id" },
    student: { table: "students", column: "user_id" },
    librarian: { table: "librarians", column: "user_id" },
    driver: { table: "drivers", column: "user_id" },
    parent: { table: "student_family", column: "parent_user_id" },
    group_admin: { table: "group_admins", column: "user_id" }
};

const resolveUserSchoolId = async (user) => {
    if (user.school_id) return user.school_id;

    const config = ROLE_TABLE_MAP[user.role];
    if (!config) return null;

    if (user.role === "group_admin" || user.role === "super_admin") {
        return null;
    }

    let sql;
    let params = [user.id];

    if (config.join) {
        sql = `SELECT d.school_id FROM ${config.table} d JOIN ${config.join} u ON u.email = d.email WHERE u.id = ? ORDER BY d.id DESC LIMIT 1`;
    } else {
        sql = `SELECT school_id FROM ${config.table} WHERE ${config.column} = ? ORDER BY id DESC LIMIT 1`;
    };

    const rows = await queryAsync(sql, params);
    return rows[0]?.school_id || null;
};

const regenerateSession = (req) => new Promise((resolve, reject) => {
    if (!req.session || typeof req.session.regenerate !== "function") return resolve();
    req.session.regenerate((error) => error ? reject(error) : resolve());
});

exports.register = async (req, res) => {
    try {
        const first_name = normalizeText(req.body.first_name);
        const last_name = normalizeText(req.body.last_name);
        const email = normalizeEmail(req.body.email);
        const password = String(req.body.password || "");
        const images = Array.isArray(req.files) ? req.files.map((file) => getStoredImagePath(file)).filter(Boolean) : [];

        if (!first_name || !last_name) {
            return res.status(400).json({ success: false, message: "First name and last name are required." });
        };

        if (!isValidEmail(email)) {
            return res.status(400).json({ success: false, message: "Please enter a valid email address." });
        };

        if (!isStrongPassword(password)) {
            return res.status(400).json({ success: false, message: "Password must be at least 8 characters and include letters and numbers." });
        };

        const schools = await queryAsync("SELECT id FROM schools ORDER BY id ASC LIMIT 1");
        if (!schools.length) {
            return res.status(400).json({
                success: false,
                message: "No school is available yet. Please start a demo or ask Super Admin to create a school first."
            });
        }
        const schoolId = schools[0].id;

        const hashed = await bcryptjs.hash(password, 10);
        const result = await queryAsync(
            "INSERT INTO users (first_name, last_name, email, password, image, role, school_id) VALUES (?,?,?,?,?,?,?)",
            [first_name, last_name, email, hashed, JSON.stringify(images || []), "student", schoolId]
        );
        const userId = result.insertId;

        const admissionNo = "ADM-" + Date.now() + Math.floor(Math.random() * 1000);
        await queryAsync(
            "INSERT INTO students (school_id, user_id, admission_no, dob, admission_date, status) VALUES (?, ?, ?, '2010-01-01', CURDATE(), 'active')",
            [schoolId, userId, admissionNo]
        );

        return res.json({
            success: true,
            message: "Registration successful! Please login.",
            redirectTo: "/login"
        });
    } catch (error) {
        console.error("Register Error:", error);
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(400).json({ success: false, message: "Email already exists." });
        };
        return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
    };
};

exports.login = async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        const password = String(req.body.password || "");
        const rememberMe = Boolean(req.body.rememberMe);
        let schoolLogin = null;

        if (!isValidEmail(email) || !password) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid email and password.",
            });
        };

        let users = await queryAsync(
            "SELECT * FROM users WHERE LOWER(TRIM(email)) = ? AND deleted_at IS NULL LIMIT 1",
            [email]
        );

        if (users.length === 0) {
            const schoolRows = await queryAsync(
                `SELECT s.id AS matched_school_id, s.school_name, s.school_email, s.password AS school_password,
                    s.school_principal_name, s.school_phone,
                    u.*
                FROM schools s
                LEFT JOIN users u ON u.school_id = s.id
                    AND u.role = 'school_admin'
                    AND u.deleted_at IS NULL
                WHERE LOWER(TRIM(s.school_email)) = ?
                ORDER BY u.status = 'active' DESC, u.id ASC
                LIMIT 1`,
                [email]
            );

            if (schoolRows.length > 0) {
                const row = schoolRows[0];
                schoolLogin = {
                    school_id: row.matched_school_id,
                    school_name: row.school_name,
                    school_email: row.school_email,
                    school_password: row.school_password,
                    school_principal_name: row.school_principal_name,
                    school_phone: row.school_phone
                };

                if (row.id) {
                    users = [{
                        id: row.id,
                        school_id: row.school_id || row.matched_school_id,
                        first_name: row.first_name,
                        last_name: row.last_name,
                        email: row.email,
                        password: row.password,
                        image: row.image,
                        phone: row.phone,
                        role: row.role,
                        status: row.status,
                        deleted_at: row.deleted_at,
                        is_email_verified: row.is_email_verified,
                        last_login: row.last_login,
                        created_at: row.created_at,
                        updated_at: row.updated_at,
                        name: row.name,
                        must_change_password: row.must_change_password
                    }];
                };
            };
        };

        if (users.length === 0 && !schoolLogin) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password.",
            });
        };

        let user = users[0] || null;
        if (user?.status && user.status !== "active") {
            return res.status(403).json({
                success: false,
                message: "Your portal access is currently disabled. Please contact school admin.",
            });
        };
        if (user && (!user.password || user.password === "google_oauth")) {
            return res.status(400).json({
                success: false,
                message: "Use Google sign-in for this account.",
            });
        };
        let isPasswordValid = user?.password ? await bcryptjs.compare(password, user.password) : false;
        const isSchoolPasswordValid = !isPasswordValid && schoolLogin?.school_password ? await bcryptjs.compare(password, schoolLogin.school_password) : false;

        if (!user && isSchoolPasswordValid) {
            const principalParts = String(schoolLogin.school_principal_name || "").trim().split(/\s+/).filter(Boolean);
            const first_name = principalParts[0] || schoolLogin.school_name || "School";
            const last_name = principalParts.slice(1).join(" ") || "Admin";
            const result = await queryAsync(
                `INSERT INTO users (school_id, first_name, last_name, email, phone, password, role, status, is_email_verified, must_change_password)
                VALUES (?, ?, ?, ?, ?, ?, 'school_admin', 'active', TRUE, 1)`,
                [schoolLogin.school_id, first_name, last_name, normalizeEmail(schoolLogin.school_email), schoolLogin.school_phone || null, schoolLogin.school_password]
            );

            const createdUsers = await queryAsync("SELECT * FROM users WHERE id = ? LIMIT 1", [result.insertId]);
            user = createdUsers[0];
            isPasswordValid = true;
        } else if (user && isSchoolPasswordValid) {
            await queryAsync("UPDATE users SET must_change_password = 1 WHERE id = ?", [user.id]);
            user.must_change_password = 1;

            const ip = req.ip || req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || null;
            await queryAsync(
                `INSERT INTO logs (user_id, school_id, action, ip_address)
                 VALUES (?, ?, ?, ?)`,
                [user.id, user.school_id || schoolLogin?.school_id || null, 'login_via_school_shared_password', ip]
            );

            isPasswordValid = true;
        };

        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password.",
            });
        };

        const resolvedSchoolId = await resolveUserSchoolId(user);
        const authUser = {
            ...user,
            school_id: resolvedSchoolId || user.school_id || null,
        };

        await regenerateSession(req);
        const token = signAuthToken(authUser, { rememberMe });
        res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions(rememberMe));

        return res.json({
            success: true,
            redirectTo: getDashboardPath(authUser.role),
            role: authUser.role,
            user: sanitizeUserForClient(authUser),
        });
    } catch (error) {
        console.error("Login Error:", error);
        return res.status(500).json({
            success: false,
            message: "Something went wrong. Please try again.",
        });
    };
};

exports.logout = async (req, res) => {
    try {
        clearAuthCookie(res);
        if (req.session && typeof req.session.destroy === "function") {
            await new Promise((resolve, reject) => {
                req.session.destroy((error) => error ? reject(error) : resolve());
            });
        };
        if (req.method === "GET") {
            return res.redirect("/login");
        };
        return res.json({ success: true, message: "Logged out successfully" });
    } catch (error) {
        console.error("Logout Error:", error);
        if (req.method === "GET") {
            return res.redirect("/login");
        };
        return res.status(500).json({ success: false, message: "Logout failed" });
    };
};

exports.sendOtp = async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        if (!isValidEmail(email)) {
            return res.status(400).json({
                success: false,
                message: "Please enter a valid email address.",
            });
        };

        const users = await queryAsync(
            "SELECT id FROM users WHERE LOWER(TRIM(email)) = ? AND deleted_at IS NULL LIMIT 1",
            [email]
        );
        if (users.length === 0) {
            return res.json({
                success: true,
                message: "If that email is registered, an OTP has been sent.",
            });
        };

        const existing = await getOtpRecord(email);
        if (existing) {
            const cooldownRemaining = Math.max(0, (existing.sentAt + OTP_COOLDOWN_MS) - Date.now());
            if (cooldownRemaining > 0) {
                return res.status(429).json({
                    success: false,
                    message: `Wait ${Math.ceil(cooldownRemaining / 1000)}s before resending`,
                });
            };
        };

        const otp = crypto.randomInt(100000, 1000000);
        await setOtpRecord(
            email,
            {
                otp: String(otp),
                expireAt: Date.now() + OTP_EXPIRY_MS,
                sentAt: Date.now(),
            },
            OTP_EXPIRY_MS
        );

        const sent = await sendOTP(email, otp);
        if (!sent) {
            await deleteOtpRecord(email);
            return res.status(500).json({
                success: false,
                message: "Failed to send OTP. Please check email configuration."
            });
        };

        return res.json({
            success: true,
            message: "OTP sent to your email",
        });
    } catch (error) {
        console.error("Send OTP Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to send OTP. Try again.",
        });
    };
};

exports.resetPassword = async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        const otp = normalizeText(req.body.otp);
        const newPassword = String(req.body.newPassword || "");
        const confirmPassword = String(req.body.confirmPassword || "");

        if (!isValidEmail(email)) {
            req.flash("error", "Please enter a valid email address.");
            return res.redirect("/forgot-password");
        };

        if (newPassword !== confirmPassword) {
            req.flash("error", "Passwords do not match.");
            return res.redirect("/forgot-password");
        };

        if (!isStrongPassword(newPassword)) {
            req.flash("error", "Password must be at least 8 characters and include letters and numbers.");
            return res.redirect("/forgot-password");
        };

        const record = await getOtpRecord(email);
        if (!record) {
            req.flash("error", "OTP not sent or expired.");
            return res.redirect("/forgot-password");
        };

        if (Date.now() > record.expireAt) {
            req.flash("error", "OTP has expired.");
            return res.redirect("/forgot-password");
        };

        if (record.otp !== otp) {
            req.flash("error", "Invalid OTP.");
            return res.redirect("/forgot-password");
        };

        const hashed = await bcryptjs.hash(newPassword, 10);
        await queryAsync("UPDATE users SET password = ? WHERE LOWER(TRIM(email)) = ?", [hashed, email]);

        await deleteOtpRecord(email);
        req.flash("success", "Password reset successful! Please login.");
        return res.redirect("/login");
    } catch (error) {
        console.error("Reset Password Error:", error);
        req.flash("error", "Something went wrong. Try again.");
        return res.redirect("/forgot-password");
    };
};

exports.startDemo = async (req, res) => {
    const connection = await require("../config/database").pool.promise().getConnection();
    try {
        await connection.beginTransaction();
        // console.log('[startDemo] step: beginTransaction done');

        const { school_name, school_email: postedSchoolEmail, school_phone: postedSchoolPhone, subdomain: postedSubdomain, school_address: postedSchoolAddress, address: postedAddress, city: postedCity, state: postedState, pincode: postedPincode, school_type: postedSchoolType, medium: postedMedium, board: postedBoard, first_name, last_name, admin_email: postedAdminEmail, admin_phone: postedAdminPhone, email: legacyEmail, phone: legacyPhone, password, confirm_password, latitude, longitude } = req.body;
        const adminEmail = normalizeEmail(postedAdminEmail || legacyEmail);
        const adminPhone = String(postedAdminPhone || legacyPhone || "").trim();
        const schoolEmail = normalizeEmail(postedSchoolEmail || adminEmail);
        const schoolPhone = String(postedSchoolPhone || adminPhone).trim();
        const address = String(postedSchoolAddress || postedAddress || "To be completed").trim();
        const city = String(postedCity || "Not specified").trim();
        const state = String(postedState || "Not specified").trim();
        const pincode = String(postedPincode || "000000").trim();
        const school_type = postedSchoolType;
        const medium = postedMedium;
        const allowedBoards = new Set(["GSEB", "CBSE", "ICSE", "Other"]);
        const board = allowedBoards.has(String(postedBoard || "").trim())
            ? String(postedBoard).trim()
            : "Other";
        const latitudeValue = latitude || null;
        const longitudeValue = longitude || null;
        let parsedLatitude = null;
        let parsedLongitude = null;

        if (latitudeValue !== null && String(latitudeValue).trim() !== "") {
            parsedLatitude = parseFloat(latitudeValue);
            if (!Number.isFinite(parsedLatitude) || parsedLatitude < -90 || parsedLatitude > 90) {
                throw new Error("Latitude must be between -90 and 90.");
            };
        };

        if (longitudeValue !== null && String(longitudeValue).trim() !== "") {
            parsedLongitude = parseFloat(longitudeValue);
            if (!Number.isFinite(parsedLongitude) || parsedLongitude < -180 || parsedLongitude > 180) {
                throw new Error("Longitude must be between -180 and 180.");
            };
        };

        const requiredFields = { school_name, school_type, medium, first_name, last_name, admin_email: adminEmail, admin_phone: adminPhone, password, confirm_password };
        const missingFields = Object.entries(requiredFields)
            .filter(([, value]) => !value || (typeof value === "string" && !value.trim()))
            .map(([key]) => key);

        if (missingFields.length) {
            throw new Error(`Missing required fields: ${missingFields.join(", ")}`);
        };

        if (password !== confirm_password) {
            throw new Error("Passwords do not match.");
        };

        if (!isValidEmail(schoolEmail)) {
            throw new Error("Invalid school email.");
        };

        if (!isValidEmail(adminEmail)) {
            throw new Error("Invalid admin email.");
        };

        const [dupSchoolEmail] = await connection.execute(
            "SELECT id FROM schools WHERE LOWER(TRIM(school_email)) = ? LIMIT 1",
            [schoolEmail]
        );
        if (dupSchoolEmail.length > 0) {
            throw new Error("A school with this email is already registered.");
        };

        const slugify = (value) => String(value || "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 32);
        const baseSubdomain = slugify(postedSubdomain || school_name) || `school-${Date.now()}`;
        let sanitizedSubdomain = baseSubdomain;
        for (let attempt = 0; attempt < 6; attempt += 1) {
            const [dupSubdomain] = await connection.execute(
                "SELECT id FROM schools WHERE subdomain = ? LIMIT 1",
                [sanitizedSubdomain]
            );
            if (dupSubdomain.length === 0) break;
            sanitizedSubdomain = `${baseSubdomain}-${Math.floor(1000 + Math.random() * 9000)}`;
            if (attempt === 5) {
                throw new Error("Could not generate a unique school subdomain. Please try again.");
            };
        };

        const [dupUserEmail] = await connection.execute(
            "SELECT id FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1",
            [adminEmail]
        );
        if (dupUserEmail.length > 0) {
            throw new Error("An administrator account with this email already exists.");
        };

        let [planRows] = await connection.execute(
            `SELECT * FROM plans
            WHERE is_active = 1
                AND status = 'active'
                AND (LOWER(COALESCE(slug, '')) = 'trial' OR LOWER(COALESCE(plan_key, '')) = 'trial' OR LOWER(name) = 'trial')
            LIMIT 1`
        );

        if (planRows.length === 0) {
            await connection.execute(
                `INSERT INTO plans
                (name, plan_key, price, monthly_price, yearly_price, student_limit, teacher_limit, staff_limit,
                    max_students, max_teachers, max_classes, features, trial_days, color_code, icon, display_order,
                    slug, description, is_popular, is_active, status)
                VALUES
                ('Trial', 'trial', 0, 0, 0, NULL, NULL, NULL, NULL, NULL, NULL, ?, 7, '#64748B', 'fa-clock', 0,
                    'trial', 'Internal 7-day demo plan.', 0, 1, 'active')
                ON DUPLICATE KEY UPDATE
                    price = 0,
                    monthly_price = 0,
                    yearly_price = 0,
                    trial_days = 7,
                    is_active = 1,
                    status = 'active',
                    updated_at = CURRENT_TIMESTAMP`,
                [JSON.stringify(["7-day full access demo"])]
            );
            [planRows] = await connection.execute(
                "SELECT * FROM plans WHERE plan_key = 'trial' LIMIT 1"
            );
        };

        const plan = planRows[0];
        if (!plan) {
            throw new Error("Trial plan could not be created. Please seed plans first.");
        };

        const hashedPassword = await bcryptjs.hash(password, 10);
        const startDate = new Date();
        const endDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
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
        
        console.log('[startDemo] step: before schools insert');
        const [schoolResult] = await connection.execute(
            `INSERT INTO schools 
            (school_name, subdomain, school_email, school_phone, password, school_type, medium, board, 
                school_address, city, state, pincode, latitude, longitude, plan_id, current_plan_id, status, subscription_status,
                trial_started_at, trial_ends_at, subscription_started_at, subscription_ends_at,
                subscription_start, subscription_end, trial_used, is_trial_used)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [ school_name?.trim(), sanitizedSubdomain, schoolEmail?.trim(), schoolPhone?.trim(), hashedPassword, selectedSchoolType, selectedMediums, board, address, city?.trim(), state?.trim(), pincode?.trim(), parsedLatitude, parsedLongitude, plan.id, plan.id, 'trial', 'trial', startDate, endDate, null, null, null, endDate, 1, 1 ]
        );

        const schoolId = schoolResult.insertId;
        console.log('[startDemo] step: schools insert done, schoolId=', schoolId);

        await academicYearService.ensureActiveAcademicYearForSchool(schoolId, {
            query: async (sql, params) => {
                const [rows] = await connection.query(sql, params);
                return rows;
            }
        });

        const PortalService = require("../services/portalService");
        // console.log('[startDemo] step: before PortalService.initializeSchoolClassesAndMediums');
        await PortalService.initializeSchoolClassesAndMediums(schoolId, selectedSchoolType, selectedMediums, connection);
        // console.log('[startDemo] step: PortalService.initializeSchoolClassesAndMediums done');

        const [settingsRows] = await connection.execute(
            "SELECT id FROM settings WHERE school_id = ? LIMIT 1",
            [schoolId]
        );
        if (settingsRows.length === 0) {
            await connection.execute("INSERT INTO settings (school_id) VALUES (?)", [schoolId]);
        };

        await connection.execute(
            `INSERT INTO users (school_id, first_name, last_name, email, phone, password, role, status, is_email_verified)
            VALUES (?, ?, ?, ?, ?, ?, 'school_admin', 'active', TRUE)`,
            [schoolId, first_name?.trim(), last_name?.trim(), adminEmail, adminPhone, hashedPassword]
        );

        await connection.execute(
            `INSERT INTO subscriptions
            (school_id, plan_id, plan, price, start_date, end_date, status, payment_status, billing_cycle, trial_start_date, trial_end_date, auto_renew, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'trial', 'pending', ?, ?, ?, 0, NOW(), NOW())`,
            [ schoolId, plan.id, plan.plan_key || "trial", 0, startDate, endDate, "monthly", startDate, endDate ]
        );

        await connection.commit();
        req.flash("success", "Your 7-day demo has been created successfully. Please login with your admin email and password.");

        const { invalidatePlanCache, invalidateSubscriptionCache } = require("../utils/planCache");
        await Promise.all([
            invalidatePlanCache(schoolId),
            invalidateSubscriptionCache(schoolId)
        ]);

        return res.json({
            success: true,
            message: "Your 7-day demo has been created successfully. Please login with your admin email and password.",
            redirectTo: "/login"
        });
    } catch (error) {
        await connection.rollback();
        console.error("Start Demo Error details:", {
            message: error.message,
            code: error.code,
            sqlMessage: error.sqlMessage,
            sqlState: error.sqlState,
            stack: error.stack
        });
        return res.status(400).json({ success: false, message: error.message || "Registration failed." });
    } finally {
        connection.release();
    };
};

exports.adminDashboard = (req, res) => {
    try {
        return res.redirect("/superadmin/dashboard");
    } catch (error) {
        console.error("Admin Redirect Error:", error);
        return res.redirect("/");
    };
};

exports.changePasswordForm = async (req, res) => {
    try {
        return res.render("auth/changePassword", {
            title: "Change Password | SchoolSync",
            user: req.user,
            currentPath: req.path
        });
    } catch (error) {
        console.error("Change Password Form Render Error:", error);
        return res.status(500).send("Internal Server Error");
    };
};

exports.changePassword = async (req, res) => {
    try {
        const newPassword = String(req.body.newPassword || "");
        const confirmPassword = String(req.body.confirmPassword || "");

        if (!newPassword || !confirmPassword) {
            req.flash("error", "Please fill in all password fields.");
            return res.redirect("/change-password");
        };

        if (newPassword !== confirmPassword) {
            req.flash("error", "Passwords do not match.");
            return res.redirect("/change-password");
        };

        if (!isStrongPassword(newPassword)) {
            req.flash("error", "Password must be at least 8 characters long and include both letters and numbers.");
            return res.redirect("/change-password");
        };

        const hashed = await bcryptjs.hash(newPassword, 10);
        await queryAsync("UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?", [hashed, req.user.id]);

        req.flash("success", "Password updated successfully! Please continue.");
        return res.redirect(getDashboardPath(req.user.role));
    } catch (error) {
        console.error("Change Password Error:", error);
        req.flash("error", "Failed to update password. Please try again.");
        return res.redirect("/change-password");
    };
};
