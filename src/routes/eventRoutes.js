const express = require("express");
const router = express.Router();
const { verifyToken, tenantIsolation } = require("../middleware/auth");
const { subscriptionGuard } = require("../middleware/subscriptionGuard");
const eventController = require("../controllers/eventController");
const mediaController = require("../controllers/mediaController");

router.use(verifyToken, subscriptionGuard, tenantIsolation);

router.use((req, res, next) => {
    const role = req.user?.role || req.session?.user?.role;
    if (role === "driver") {
        if (typeof req.flash === "function") {
            req.flash("error", "Events gallery is not available in the driver panel.");
        };
        return res.redirect("/driver/dashboard");
    };
    next();
});

router.use((req, res, next) => {
    const role = req.user?.role || req.session?.user?.role || "student";
    let layoutPath = "student/layout";
    let cssFile = "student.css";

    if (role === "school_admin") {
        layoutPath = "schoolAdmin/layout";
        cssFile = "schooladmin.css";
    } else if (role === "teacher") {
        layoutPath = "teacher/layout";
        cssFile = "teacher.css";
    } else if (role === "librarian") {
        layoutPath = "librarian/layout";
        cssFile = "librarian.css";
    } else if (role === "driver") {
        layoutPath = "driver/layout";
        cssFile = "driver.css";
    } else if (role === "parent") {
        layoutPath = "parent/layout";
        cssFile = "student.css";
    } else if (role === "super_admin") {
        layoutPath = "superAdmin/layout";
        cssFile = "superadmin.css";
    };

    res.locals.layout = layoutPath;
    res.locals.cssFile = cssFile;
    res.locals.user = req.user || req.session?.user;

    const originalRender = res.render;
    res.render = function (view, options, fn) {
        if (typeof options === "function") {
            fn = options;
            options = { layout: layoutPath };
        } else if (typeof options === "object") {
            options.layout = options.layout !== undefined ? options.layout : layoutPath;
        } else {
            options = { layout: layoutPath };
        };
        originalRender.call(this, view, options, fn);
    };
    next();
});

router.get("/events", eventController.listEventsPublic);
router.get("/events/:id", eventController.viewEventPublic);
router.get("/media/:mediaId", mediaController.streamMedia);
router.get("/media/:mediaId/download", mediaController.downloadMedia);

module.exports = router;