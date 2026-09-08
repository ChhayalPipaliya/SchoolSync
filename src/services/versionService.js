const { queryAsync, executeAsync, withTransaction } = require("../config/database");
const { getRedisClient } = require("../config/redis");

const VERSION_CACHE_PREFIX = "school:version:";
const FEATURES_CACHE_PREFIX = "school:features:";
const inMemoryVersionCache = new Map();
const inMemoryFeaturesCache = new Map();

function compareSemver(vA, vB) {
    if (!vA || !vB) return 0;
    const clean = (v) => String(v).replace(/^v/i, '').trim();
    const partsA = clean(vA).split('.').map(n => parseInt(n, 10) || 0);
    const partsB = clean(vB).split('.').map(n => parseInt(n, 10) || 0);

    for (let i = 0; i < Math.max(partsA.length, partsB.length, 3); i++) {
        const a = partsA[i] || 0;
        const b = partsB[i] || 0;
        if (a > b) return 1;
        if (a < b) return -1;
    };
    return 0;
};

const VersionService = {
    compareSemver,
    async getSchoolVersion(schoolId) {
        if (!schoolId) return "1.0.0";

        const memCached = inMemoryVersionCache.get(Number(schoolId));
        if (memCached && memCached.expiresAt > Date.now()) {
            return memCached.version;
        };

        const redisClient = getRedisClient();
        const cacheKey = `${VERSION_CACHE_PREFIX}${schoolId}`;

        if (redisClient) {
            try {
                const cached = await redisClient.get(cacheKey);
                if (cached) {
                    inMemoryVersionCache.set(Number(schoolId), {
                        version: cached,
                        expiresAt: Date.now() + 60000
                    });
                    return cached;
                };
            } catch (err) {
                console.error("[VersionCache Get Error]", err.message);
            };
        };

        try {
            const rows = await queryAsync(
                "SELECT app_version FROM schools WHERE id = ? LIMIT 1",
                [schoolId]
            );
            const version = (rows && rows[0] && rows[0].app_version) ? rows[0].app_version : "1.0.0";

            inMemoryVersionCache.set(Number(schoolId), {
                version,
                expiresAt: Date.now() + 60000
            });

            if (redisClient) {
                try {
                    await redisClient.setEx(cacheKey, 300, version);
                } catch (err) {
                    console.error("[VersionCache Set Error]", err.message);
                };
            };
            return version;
        } catch (err) {
            console.error("[VersionService getSchoolVersion Error]", err.message);
            return "1.0.0";
        };
    },

    async invalidateSchoolCache(schoolId) {
        if (!schoolId) return;
        const sId = Number(schoolId);
        inMemoryVersionCache.delete(sId);
        inMemoryFeaturesCache.delete(sId);

        const redisClient = getRedisClient();
        if (redisClient) {
            try {
                await redisClient.del(`${VERSION_CACHE_PREFIX}${schoolId}`);
                await redisClient.del(`${FEATURES_CACHE_PREFIX}${schoolId}`);
            } catch (err) {
                console.error("[VersionCache Del Error]", err.message);
            };
        };
    },

    async isFeatureEnabled(schoolId, featureKey) {
        if (!featureKey) return false;
        if (!schoolId) {
            const features = await this.getAllFeaturesCatalog();
            const feat = features.find(f => f.feature_key === featureKey);
            return feat ? Boolean(feat.is_globally_enabled) : false;
        };

        const featuresMap = await this.getComputedFeaturesMap(schoolId);
        return Boolean(featuresMap[featureKey]);
    },

    async getAvailableVersions() {
        return queryAsync(
            "SELECT * FROM app_versions ORDER BY release_date ASC, id ASC"
        );
    },

    async getAllFeaturesCatalog() {
        return queryAsync(
            "SELECT * FROM app_features ORDER BY min_version ASC, id ASC"
        );
    },

    async getComputedFeaturesMap(schoolId) {
        const memCached = inMemoryFeaturesCache.get(Number(schoolId));
        if (memCached && memCached.expiresAt > Date.now()) {
            return memCached.map;
        };

        const [schoolVersion, catalog, overrides] = await Promise.all([
            this.getSchoolVersion(schoolId),
            this.getAllFeaturesCatalog(),
            queryAsync("SELECT feature_key, is_enabled FROM school_feature_flags WHERE school_id = ?", [schoolId])
        ]);

        const overrideMap = {};
        for (const row of overrides) {
            overrideMap[row.feature_key] = Boolean(row.is_enabled);
        };

        const map = {};
        for (const feat of catalog) {
            if (overrideMap[feat.feature_key] !== undefined) {
                map[feat.feature_key] = overrideMap[feat.feature_key];
            } else if (feat.is_globally_enabled) {
                map[feat.feature_key] = true;
            } else {
                map[feat.feature_key] = compareSemver(schoolVersion, feat.min_version) >= 0;
            };
        };

        inMemoryFeaturesCache.set(Number(schoolId), {
            map,
            expiresAt: Date.now() + 60000
        });
        return map;
    },

    async getSchoolFeaturesDetailed(schoolId) {
        const [schoolVersion, catalog, overrides] = await Promise.all([
            this.getSchoolVersion(schoolId),
            this.getAllFeaturesCatalog(),
            queryAsync("SELECT feature_key, is_enabled, updated_at FROM school_feature_flags WHERE school_id = ?", [schoolId])
        ]);

        const overrideMap = {};
        for (const row of overrides) {
            overrideMap[row.feature_key] = {
                isEnabled: Boolean(row.is_enabled),
                updatedAt: row.updated_at
            };
        };

        return catalog.map(feat => {
            const hasOverride = overrideMap[feat.feature_key] !== undefined;
            const meetsVersion = compareSemver(schoolVersion, feat.min_version) >= 0;
            const isGloballyEnabled = Boolean(feat.is_globally_enabled);
            const effectiveEnabled = hasOverride 
                ? overrideMap[feat.feature_key].isEnabled 
                : (isGloballyEnabled || meetsVersion);

            return {
                feature_key: feat.feature_key,
                name: feat.name,
                description: feat.description,
                min_version: feat.min_version,
                is_globally_enabled: isGloballyEnabled,
                meets_version: meetsVersion,
                has_override: hasOverride,
                override_enabled: hasOverride ? overrideMap[feat.feature_key].isEnabled : null,
                is_enabled: effectiveEnabled
            };
        });
    },

    async setSchoolFeatureOverride(schoolId, featureKey, isEnabled, userId = null) {
        if (!schoolId || !featureKey) {
            throw new Error("schoolId and featureKey are required.");
        };

        if (isEnabled === null || isEnabled === undefined || isEnabled === "default") {
            await executeAsync(
                "DELETE FROM school_feature_flags WHERE school_id = ? AND feature_key = ?",
                [schoolId, featureKey]
            );
        } else {
            const enabledVal = isEnabled ? 1 : 0;
            await executeAsync(`
                INSERT INTO school_feature_flags (school_id, feature_key, is_enabled, updated_by_user_id)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled), updated_by_user_id = VALUES(updated_by_user_id)
            `, [schoolId, featureKey, enabledVal, userId]);
        };
        await this.invalidateSchoolCache(schoolId);
        return { success: true };
    },

    async setSchoolVersion(schoolId, newVersion, { userId, userName, reason, action } = {}) {
        if (!schoolId || !newVersion) {
            throw new Error("schoolId and newVersion are required.");
        };

        const [verCheck] = await queryAsync(
            "SELECT version, status FROM app_versions WHERE version = ? LIMIT 1",
            [newVersion]
        );
        if (!verCheck) {
            throw new Error(`Target version '${newVersion}' is not recognized in app_versions catalog.`);
        };

        const [school] = await queryAsync(
            "SELECT id, school_name, app_version FROM schools WHERE id = ? LIMIT 1",
            [schoolId]
        );
        if (!school) {
            throw new Error(`School #${schoolId} not found.`);
        };

        const oldVersion = school.app_version || "1.0.0";
        if (oldVersion === newVersion) {
            return {
                changed: false,
                schoolId,
                oldVersion,
                newVersion,
                message: `School is already on version ${newVersion}`
            };
        };

        const determinedAction = action || (compareSemver(newVersion, oldVersion) > 0 ? "upgrade" : "downgrade");
        await withTransaction(async (conn) => {
            await conn.execute(
                "UPDATE schools SET app_version = ? WHERE id = ?",
                [newVersion, schoolId]
            );

            await conn.execute(`
                INSERT INTO school_version_history 
                (school_id, old_version, new_version, action, changed_by_user_id, changed_by_name, reason)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                schoolId,
                oldVersion,
                newVersion,
                determinedAction,
                userId || null,
                userName || "Super Admin",
                reason || `Version changed from ${oldVersion} to ${newVersion}`
            ]);
        });

        await this.invalidateSchoolCache(schoolId);
        return {
            changed: true,
            schoolId,
            schoolName: school.school_name,
            oldVersion,
            newVersion,
            action: determinedAction
        };
    },

    async bulkSetSchoolVersion(schoolIds, newVersion, { userId, userName, reason } = {}) {
        if (!Array.isArray(schoolIds) || schoolIds.length === 0) {
            throw new Error("No schools selected for version change.");
        };

        const results = [];
        for (const sid of schoolIds) {
            try {
                const res = await this.setSchoolVersion(sid, newVersion, {
                    userId,
                    userName,
                    reason: reason || "Bulk version deployment"
                });
                results.push({ schoolId: sid, success: true, ...res });
            } catch (err) {
                results.push({ schoolId: sid, success: false, error: err.message });
            };
        };
        return results;
    },

    async rollbackVersion(historyId, { userId, userName, reason } = {}) {
        if (!historyId) {
            throw new Error("historyId is required for rollback.");
        };

        const [history] = await queryAsync(
            "SELECT * FROM school_version_history WHERE id = ? LIMIT 1",
            [historyId]
        );
        if (!history) {
            throw new Error(`Rollout history entry #${historyId} not found.`);
        };

        if (!history.old_version) {
            throw new Error("Cannot rollback an entry with no previous version recorded.");
        };

        const rollbackVersion = history.old_version;
        const schoolId = history.school_id;
        const result = await this.setSchoolVersion(schoolId, rollbackVersion, {
            userId,
            userName,
            action: "rollback",
            reason: reason || `Rollback to ${rollbackVersion} from previous ${history.new_version} change (Ref #${historyId})`
        });
        return result;
    },

    async getRolloutHistory({ schoolId = null, version = null, page = 1, limit = 20 } = {}) {
        const offset = (Math.max(page, 1) - 1) * limit;
        let whereClause = "WHERE 1=1";
        const params = [];

        if (schoolId) {
            whereClause += " AND svh.school_id = ?";
            params.push(schoolId);
        };
        if (version) {
            whereClause += " AND (svh.new_version = ? OR svh.old_version = ?)";
            params.push(version, version);
        };

        const rows = await queryAsync(`
            SELECT 
                svh.*,
                s.school_name,
                s.subdomain,
                s.city
            FROM school_version_history svh
            JOIN schools s ON s.id = svh.school_id
            ${whereClause}
            ORDER BY svh.created_at DESC, svh.id DESC
            LIMIT ? OFFSET ?
        `, [...params, limit, offset]);

        const [countRow] = await queryAsync(`
            SELECT COUNT(*) AS total
            FROM school_version_history svh
            ${whereClause}
        `, params);

        const total = countRow ? countRow.total : 0;
        return {
            history: rows,
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    },

    async getVersionDashboardData({ status = null, version = null, search = null, page = 1, limit = 20 } = {}) {
        const offset = (Math.max(page, 1) - 1) * limit;
        let whereClause = "WHERE 1=1";
        const params = [];

        if (status) {
            whereClause += " AND s.status = ?";
            params.push(status);
        };
        if (version) {
            whereClause += " AND s.app_version = ?";
            params.push(version);
        };
        if (search) {
            whereClause += " AND (s.school_name LIKE ? OR s.subdomain LIKE ? OR s.city LIKE ?)";
            const term = `%${search}%`;
            params.push(term, term, term);
        };
        
        const schools = await queryAsync(`
            SELECT 
                s.id,
                s.school_name,
                s.subdomain,
                s.status,
                s.app_version,
                s.city,
                s.created_at,
                (
                    SELECT JSON_ARRAYAGG(feature_key) 
                    FROM school_feature_flags 
                    WHERE school_id = s.id AND is_enabled = 1
                ) AS custom_features_json,
                (
                    SELECT new_version 
                    FROM school_version_history 
                    WHERE school_id = s.id 
                    ORDER BY created_at DESC, id DESC LIMIT 1
                ) AS last_history_version,
                (
                    SELECT created_at 
                    FROM school_version_history 
                    WHERE school_id = s.id 
                    ORDER BY created_at DESC, id DESC LIMIT 1
                ) AS last_version_update
            FROM schools s
            ${whereClause}
            ORDER BY s.school_name ASC
            LIMIT ? OFFSET ?
        `, [...params, limit, offset]);

        const [totalCountRow] = await queryAsync(` SELECT COUNT(*) AS total FROM schools s ${whereClause} `, params);
        const [statsRow] = await queryAsync(`
            SELECT 
                COUNT(*) AS total_schools,
                COUNT(CASE WHEN s.app_version = '1.0.0' THEN 1 END) AS count_v100,
                COUNT(CASE WHEN s.app_version = '1.1.0' THEN 1 END) AS count_v110,
                COUNT(CASE WHEN s.app_version NOT IN ('1.0.0', '1.1.0') THEN 1 END) AS count_other,
                COUNT(DISTINCT sff.school_id) AS schools_with_overrides
            FROM schools s
            LEFT JOIN school_feature_flags sff ON s.id = sff.school_id
        `);

        const availableReleases = await this.getAvailableVersions();
        const features = await this.getAllFeaturesCatalog();
        const total = totalCountRow ? totalCountRow.total : 0;
        return {
            schools: schools.map(s => {
                let customFeatures = [];
                if (s.custom_features_json) {
                    try {
                        customFeatures = typeof s.custom_features_json === 'string' 
                            ? JSON.parse(s.custom_features_json) 
                            : s.custom_features_json;
                    } catch (_) {}
                };
                return {
                    ...s,
                    custom_features: customFeatures || []
                };
            }),
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                totalPages: Math.ceil(total / limit)
            },
            stats: statsRow || {
                total_schools: 0,
                count_v100: 0,
                count_v110: 0,
                count_other: 0,
                schools_with_overrides: 0
            },
            availableReleases,
            features
        };
    },

    async upsertRelease({ version, release_title, release_notes, status = 'beta', is_default = 0 }) {
        if (!version || !release_title) {
            throw new Error("Version and release title are required.");
        };

        if (is_default) {
            await executeAsync("UPDATE app_versions SET is_default = 0");
        };

        await executeAsync(`
            INSERT INTO app_versions (version, release_title, release_notes, status, is_default, release_date)
            VALUES (?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE 
                release_title = VALUES(release_title),
                release_notes = VALUES(release_notes),
                status = VALUES(status),
                is_default = VALUES(is_default)
        `, [version, release_title, release_notes || '', status, is_default ? 1 : 0]);
        return { success: true, version };
    }
};

module.exports = VersionService;