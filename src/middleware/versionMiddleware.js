const VersionService = require("../services/versionService");

async function versionMiddleware(req, res, next) {
    try {
        const user = req.user || req.session?.user;
        const schoolId = user?.school_id || req.params?.school_id || req.params?.schoolId || null;

        if (schoolId) {
            const version = await VersionService.getSchoolVersion(schoolId);
            req.schoolVersion = version;
            res.locals.appVersion = version;

            req.isFeatureEnabled = (featureKey) => VersionService.isFeatureEnabled(schoolId, featureKey);
            res.locals.isFeatureEnabled = (featureKey) => VersionService.isFeatureEnabled(schoolId, featureKey);
        } else {
            req.schoolVersion = "1.0.0";
            res.locals.appVersion = "1.0.0";

            req.isFeatureEnabled = (featureKey) => VersionService.isFeatureEnabled(null, featureKey);
            res.locals.isFeatureEnabled = (featureKey) => VersionService.isFeatureEnabled(null, featureKey);
        };
        next();
    } catch (err) {
        console.error("[versionMiddleware Error]", err.message);
        req.schoolVersion = "1.0.0";
        res.locals.appVersion = "1.0.0";
        req.isFeatureEnabled = () => false;
        res.locals.isFeatureEnabled = () => false;
        next();
    };
};

module.exports = { versionMiddleware };