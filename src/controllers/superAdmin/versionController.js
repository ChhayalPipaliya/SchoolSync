const VersionService = require("../../services/versionService");

const versionController = {
    renderVersionDashboard: async (req, res) => {
        try {
            const { status, version, search, page = 1 } = req.query;
            const data = await VersionService.getVersionDashboardData({
                status,
                version,
                search,
                page: parseInt(page, 10) || 1,
                limit: 20
            });

            res.render("superAdmin/schools/versions", {
                title: "School Version Rollout & Feature Flags - SchoolSync",
                schools: data.schools,
                pagination: data.pagination,
                stats: data.stats,
                availableReleases: data.availableReleases,
                features: data.features,
                filters: { status, version, search },
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            console.error("[versionController.renderVersionDashboard Error]", error);
            req.flash("error", "Failed to load version management dashboard: " + error.message);
            res.redirect("/superadmin/schools");
        };
    },

    getStatsAPI: async (req, res) => {
        try {
            const data = await VersionService.getVersionDashboardData();
            return res.json({ success: true, stats: data.stats, availableReleases: data.availableReleases });
        } catch (error) {
            console.error("[versionController.getStatsAPI Error]", error);
            return res.status(500).json({ success: false, message: error.message });
        };
    },

    getAvailableVersionsAPI: async (req, res) => {
        try {
            const releases = await VersionService.getAvailableVersions();
            return res.json({ success: true, releases });
        } catch (error) {
            console.error("[versionController.getAvailableVersionsAPI Error]", error);
            return res.status(500).json({ success: false, message: error.message });
        };
    },

    createReleaseAPI: async (req, res) => {
        try {
            const { version, release_title, release_notes, status, is_default } = req.body;
            if (!version || !release_title) {
                return res.status(400).json({ success: false, message: "Version (e.g. 1.1.0) and release title are required." });
            };

            const result = await VersionService.upsertRelease({
                version: String(version).trim(),
                release_title: String(release_title).trim(),
                release_notes: release_notes ? String(release_notes).trim() : "",
                status: status || "beta",
                is_default: Boolean(is_default)
            });

            return res.json({
                success: true,
                message: `Release ${version} registered successfully.`,
                result
            });
        } catch (error) {
            console.error("[versionController.createReleaseAPI Error]", error);
            return res.status(500).json({ success: false, message: error.message });
        };
    },

    getSchoolDetailsAPI: async (req, res) => {
        try {
            const schoolId = req.params.id;
            const currentVersion = await VersionService.getSchoolVersion(schoolId);
            const features = await VersionService.getSchoolFeaturesDetailed(schoolId);
            const releases = await VersionService.getAvailableVersions();

            return res.json({
                success: true,
                schoolId,
                currentVersion,
                features,
                availableReleases: releases
            });
        } catch (error) {
            console.error("[versionController.getSchoolDetailsAPI Error]", error);
            return res.status(500).json({ success: false, message: error.message });
        };
    },

    updateSchoolVersionAPI: async (req, res) => {
        try {
            const schoolId = req.params.id;
            const { version, reason } = req.body;

            if (!version) {
                return res.status(400).json({ success: false, message: "Target version is required." });
            };

            const userName = `${req.user.first_name || "Super"} ${req.user.last_name || "Admin"}`.trim();
            const result = await VersionService.setSchoolVersion(schoolId, String(version).trim(), {
                userId: req.user.id,
                userName,
                reason: reason ? String(reason).trim() : null
            });

            return res.json({
                success: true,
                message: result.changed 
                    ? `School #${schoolId} moved from ${result.oldVersion} to ${result.newVersion} (${result.action}).`
                    : `School #${schoolId} is already on version ${result.newVersion}.`,
                result
            });
        } catch (error) {
            console.error("[versionController.updateSchoolVersionAPI Error]", error);
            return res.status(500).json({ success: false, message: error.message });
        };
    },

    bulkUpdateSchoolVersionAPI: async (req, res) => {
        try {
            let { school_ids, version, reason } = req.body;
            if (!version) {
                return res.status(400).json({ success: false, message: "Target version is required." });
            };

            let ids = [];
            if (Array.isArray(school_ids)) {
                ids = school_ids.map(Number).filter(Boolean);
            } else if (typeof school_ids === "string") {
                ids = school_ids.split(",").map(id => Number(id.trim())).filter(Boolean);
            };

            if (ids.length === 0) {
                return res.status(400).json({ success: false, message: "No valid schools selected." });
            };

            const userName = `${req.user.first_name || "Super"} ${req.user.last_name || "Admin"}`.trim();
            const results = await VersionService.bulkSetSchoolVersion(ids, String(version).trim(), {
                userId: req.user.id,
                userName,
                reason: reason ? String(reason).trim() : "Bulk version rollout"
            });

            const successCount = results.filter(r => r.success && r.changed).length;
            const alreadyCount = results.filter(r => r.success && !r.changed).length;
            const failCount = results.filter(r => !r.success).length;

            return res.json({
                success: true,
                message: `Bulk version update complete: ${successCount} updated to ${version}, ${alreadyCount} already on ${version}, ${failCount} failed.`,
                results
            });
        } catch (error) {
            console.error("[versionController.bulkUpdateSchoolVersionAPI Error]", error);
            return res.status(500).json({ success: false, message: error.message });
        };
    },

    rollbackVersionAPI: async (req, res) => {
        try {
            const historyId = req.params.historyId;
            const { reason } = req.body;
            const userName = `${req.user.first_name || "Super"} ${req.user.last_name || "Admin"}`.trim();
            const result = await VersionService.rollbackVersion(historyId, {
                userId: req.user.id,
                userName,
                reason: reason ? String(reason).trim() : null
            });

            return res.json({
                success: true,
                message: `Successfully rolled back School #${result.schoolId} to version ${result.newVersion}.`,
                result
            });
        } catch (error) {
            console.error("[versionController.rollbackVersionAPI Error]", error);
            return res.status(500).json({ success: false, message: error.message });
        };
    },

    getRolloutHistoryAPI: async (req, res) => {
        try {
            const { school_id, version, page = 1, limit = 20 } = req.query;
            const data = await VersionService.getRolloutHistory({
                schoolId: school_id ? Number(school_id) : null,
                version: version ? String(version).trim() : null,
                page: parseInt(page, 10) || 1,
                limit: parseInt(limit, 10) || 20
            });

            return res.json({ success: true, ...data });
        } catch (error) {
            console.error("[versionController.getRolloutHistoryAPI Error]", error);
            return res.status(500).json({ success: false, message: error.message });
        };
    },

    toggleSchoolFeatureAPI: async (req, res) => {
        try {
            const schoolId = req.params.id;
            const { feature_key, is_enabled } = req.body;

            if (!feature_key) {
                return res.status(400).json({ success: false, message: "feature_key is required." });
            };

            let parsedEnabled = is_enabled;
            if (is_enabled === "default" || is_enabled === "reset" || is_enabled === null || is_enabled === undefined) {
                parsedEnabled = null;
            } else {
                parsedEnabled = Boolean(is_enabled === true || is_enabled === "true" || is_enabled === 1 || is_enabled === "1");
            };

            await VersionService.setSchoolFeatureOverride(schoolId, feature_key, parsedEnabled, req.user.id);
            return res.json({
                success: true,
                message: parsedEnabled === null 
                    ? `Reset feature '${feature_key}' to default version state.`
                    : `Set feature '${feature_key}' to ${parsedEnabled ? 'ENABLED' : 'DISABLED'} for School #${schoolId}.`
            });
        } catch (error) {
            console.error("[versionController.toggleSchoolFeatureAPI Error]", error);
            return res.status(500).json({ success: false, message: error.message });
        };
    }
};

module.exports = versionController;