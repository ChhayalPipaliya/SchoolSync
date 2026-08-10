const { queryAsync, executeAsync } = require("./database");

const seedRBAC = async () => {
    try {
        const roles = await queryAsync("SELECT COUNT(*) as count FROM roles");
        if (roles[0].count > 0) {
            return;
        }

        const rolesToSeed = [
            { name: "Super Admin", key: "super_admin" },
            { name: "Group Admin", key: "group_admin" },
            { name: "School Admin", key: "school_admin" },
            { name: "Teacher", key: "teacher" },
            { name: "Student", key: "student" },
            { name: "Driver", key: "driver" },
            { name: "Librarian", key: "librarian" },
            { name: "Parent", key: "parent" }
        ];

        for (const r of rolesToSeed) {
            await executeAsync(
                "INSERT INTO roles (uuid, name, role_key, status) VALUES (UUID(), ?, ?, 1)",
                [r.name, r.key]
            );
        };

        const permissionsToSeed = [
            { name: "View Library Reports", key: "view_library_reports" },
            { name: "Manage Library Books", key: "manage_library_books" },
            { name: "Manage Library Issues", key: "manage_library_issues" },
            { name: "Manage Library Fines", key: "manage_library_fines" },
            { name: "Manage Library Settings", key: "manage_library_settings" }
        ];

        for (const p of permissionsToSeed) {
            await executeAsync(
                "INSERT INTO permissions (uuid, name, permission_key, status) VALUES (UUID(), ?, ?, 1)",
                [p.name, p.key]
            );
        };

        const dbRoles = await queryAsync("SELECT id, role_key FROM roles");
        const dbPerms = await queryAsync("SELECT id, permission_key FROM permissions");
        const roleMap = dbRoles.reduce((acc, r) => ({ ...acc, [r.role_key]: r.id }), {});
        const permMap = dbPerms.reduce((acc, p) => ({ ...acc, [p.permission_key]: p.id }), {});

        const mappings = [
            { role: "school_admin", perm: "view_library_reports" },
            { role: "school_admin", perm: "manage_library_books" },
            { role: "school_admin", perm: "manage_library_issues" },
            { role: "school_admin", perm: "manage_library_fines" },
            { role: "school_admin", perm: "manage_library_settings" },
            { role: "librarian", perm: "view_library_reports" },
            { role: "librarian", perm: "manage_library_books" },
            { role: "librarian", perm: "manage_library_issues" },
            { role: "librarian", perm: "manage_library_fines" }
        ];

        for (const m of mappings) {
            const roleId = roleMap[m.role];
            const permId = permMap[m.perm];
            if (roleId && permId) {
                await executeMappingInsert(roleId, permId);
            }
        };

    } catch (err) {
        console.error("[RBAC-Error] Seeding failed:", err.message);
    };
};

const executeMappingInsert = async (roleId, permId) => {
    try {
        await executeAsync(
            "INSERT INTO permission_role (uuid, role_id, permission_id, status) VALUES (UUID(), ?, ?, 1)",
            [roleId, permId]
        );
    } catch (err) {
        console.error("[RBAC-Error] Mapping insertion failed:", err.message);
    };
};

module.exports = { seedRBAC };