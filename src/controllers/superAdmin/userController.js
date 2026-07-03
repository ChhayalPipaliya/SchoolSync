const { queryAsync, executeAsync } = require("../../config/database");
const bcrypt = require("bcryptjs");

const userController = {
    list: async (req, res) => {
        try {
            const { role, school_id, status, search, page = 1 } = req.query;
            const limit = 20;
            const offset = (page - 1) * limit;

            let whereClause = "WHERE u.deleted_at IS NULL";
            let params = [];

            if (role) { whereClause += " AND u.role = ?"; params.push(role); }
            if (school_id) { whereClause += " AND u.school_id = ?"; params.push(school_id); }
            if (status) { whereClause += " AND u.status = ?"; params.push(status); }
            if (search) {
                whereClause += ` AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)`;
                const term = `%${search}%`;
                params.push(term, term, term);
            }

            const users = await queryAsync(`
                SELECT 
                    u.*,
                    u.first_name, u.last_name,
                    s.school_name, s.subdomain
                FROM users u
                LEFT JOIN schools s ON u.school_id = s.id
                ${whereClause}
                ORDER BY u.created_at DESC
                LIMIT ? OFFSET ?
            `, [...params, limit, offset]);

            const [totalResult] = await queryAsync(`
                SELECT COUNT(*) as total FROM users u ${whereClause}
            `, params);

            const schools = await queryAsync("SELECT id, school_name FROM schools");

            res.render("superAdmin/users/list", {
                title: "Users - SchoolSync",
                users,
                schools,
                filters: { role, school_id, status, search },
                pagination: {
                    page: parseInt(page),
                    totalPages: Math.ceil(totalResult.total / limit),
                    total: totalResult.total
                },
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            req.flash("error", "Failed to load users");
            res.redirect("/superadmin/dashboard");
        }
    },

    detail: async (req, res) => {
        try {
            const userId = req.params.id;

            const [userData] = await queryAsync(`
                SELECT u.*, u.first_name, u.last_name, s.school_name
                FROM users u
                LEFT JOIN schools s ON u.school_id = s.id
                WHERE u.id = ?
            `, [userId]);

            if (!userData) {
                req.flash("error", "User not found");
                return res.redirect("/superadmin/users");
            }

            let extraData = {};
            if (userData.role === 'student') {
                const [student] = await queryAsync(`
                    SELECT s.*, c.class_name as class_name, c.section
                    FROM students s
                    LEFT JOIN classes c ON s.class_id = c.id AND c.school_id = s.school_id
                    WHERE s.user_id = ?
                `, [userId]);
                extraData.student = student;
            } else if (userData.role === 'teacher') {
                const [teacher] = await queryAsync(`
                    SELECT t.* FROM teachers t WHERE t.user_id = ?
                `, [userId]);
                extraData.teacher = teacher;
            }

            const logs = await queryAsync(`
                SELECT * FROM logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 10
            `, [userId]);

            res.render("superAdmin/users/detail", {
                title: `${userData.first_name} ${userData.last_name} - SchoolSync`,
                userData,
                extraData,
                logs,
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            req.flash("error", "Failed to load user");
            res.redirect("/superadmin/users");
        }
    },

    updateRole: async (req, res) => {
        try {
            const userId = req.params.id;
            const { role } = req.body;

            await executeAsync("UPDATE users SET role = ? WHERE id = ?", [role, userId]);

            req.flash("success", "Role updated successfully");
            res.redirect(`/superadmin/users/${userId}`);
        } catch (error) {
            req.flash("error", "Failed to update role");
            res.redirect(`/superadmin/users/${req.params.id}`);
        }
    },

    toggleStatus: async (req, res) => {
        try {
            const userId = req.params.id;
            const { status } = req.body;

            await executeAsync(
                "UPDATE users SET status = ? WHERE id = ?",
                [status, userId]
            );

            req.flash("success", `User status changed to ${status}`);
            res.redirect(`/superadmin/users/${userId}`);
        } catch (error) {
            req.flash("error", "Failed to toggle status");
            res.redirect("/superadmin/users");
        }
    },

    resetPassword: async (req, res) => {
        try {
            const userId = req.params.id;
            const { password } = req.body;
            const hashed = await bcrypt.hash(password, 10);

            await executeAsync(
                "UPDATE users SET password = ? WHERE id = ?",
                [hashed, userId]
            );

            req.flash("success", "Password reset successfully");
            res.redirect(`/superadmin/users/${userId}`);
        } catch (error) {
            req.flash("error", "Failed to reset password");
            res.redirect(`/superadmin/users/${req.params.id}`);
        }
    }
};

module.exports = userController;
