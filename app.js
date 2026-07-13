const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const expressLayouts = require("express-ejs-layouts");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const flash = require("connect-flash");
const passport = require("./src/config/passport");
const { createRedisSessionStore, initializeRedis } = require("./src/config/redis");
const { handleError, handleNotFound } = require("./src/middleware/errorHandler");
const { securityHeaders } = require("./src/middleware/securityHeaders");
const { sanitizeRequest, preventPrototypePollution } = require("./src/middleware/sanitize");
const { apiMetricsMiddleware } = require("./src/middleware/apiMetrics");
const { apiLimiter } = require("./src/middleware/rateLimit");
const { verifyToken } = require("./src/middleware/auth");
const { subscriptionGuard } = require("./src/middleware/subscriptionGuard");
const { checkConnection } = require("./src/config/database");
const cron = require("node-cron");
const { autoUpdateMeetingStatuses } = require("./src/controllers/meetingController");

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 4000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "src/views"));
app.use(expressLayouts);
app.set("layout", false);
const publicStatic = express.static(path.join(__dirname, "src/public"));
app.use((req, res, next) => {
    if (req.path.startsWith("/uploads/")) {
        return next();
    }
    return publicStatic(req, res, next);
});
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    const allowedOverrideMethods = new Set(["PUT", "PATCH", "DELETE"]);
    let overrideMethod = null;

    if (req.body && typeof req.body === "object" && "_method" in req.body) {
        overrideMethod = String(req.body._method || "").toUpperCase();
        delete req.body._method;
    } else if (req.query && req.query._method) {
        overrideMethod = String(req.query._method || "").toUpperCase();
        delete req.query._method;
    }

    if (allowedOverrideMethods.has(overrideMethod)) {
        req.method = overrideMethod;
    }
    next();
});

app.use(securityHeaders);
app.use(sanitizeRequest);
app.use(preventPrototypePollution);
app.use(apiMetricsMiddleware);
app.use((req, res, next) => {
    if (req.path.toLowerCase().includes('/api/')) {
        return apiLimiter(req, res, next);
    }
    next();
});

if (process.env.NODE_ENV !== "production") {
    const originalLog = console.log;
    console.log = (...args) => {
        const stack = new Error().stack.split("\n")[2].trim();
        originalLog(`[LOG @ ${stack}]`, ...args);
    };
}

const registerRoutes = () => {
    const authRoutes = require("./src/routes/authRoutes");
    app.use("/", authRoutes);

    const superAdminRouter = require("./src/routes/superAdminRoutes");
    app.use("/superadmin", superAdminRouter);

    const groupAdminRouter = require("./src/routes/groupAdminRoutes");
    app.use("/groupadmin", groupAdminRouter);

    const schoolAdminRouter = require("./src/routes/schoolAdminRoutes");
    app.use("/schooladmin", verifyToken, subscriptionGuard, schoolAdminRouter);

    const studentRouter = require("./src/routes/studentRoutes");
    app.use("/student", verifyToken, subscriptionGuard, studentRouter);

    const teacherRouter = require("./src/routes/teacherRoutes");
    app.use("/teacher", verifyToken, subscriptionGuard, teacherRouter);

    const driverPanelRouter = require("./src/routes/driverRoutes");
    app.use("/driver", verifyToken, subscriptionGuard, driverPanelRouter);

    const librarianRouter = require("./src/routes/librarianRoutes");
    app.use("/librarian", verifyToken, subscriptionGuard, librarianRouter);

    const parentRouter = require("./src/routes/parentRoutes");
    app.use("/parent", verifyToken, subscriptionGuard, parentRouter);

    const notificationRouter = require("./src/routes/notificationRoutes");
    app.use("/api/notifications", notificationRouter);

    const razorpayRouter = require("./src/routes/razorpayRoutes");
    app.use("/api/fees/razorpay", razorpayRouter);

    const webhookRouter = require("./src/routes/webhookRoutes");
    app.use("/webhooks", webhookRouter);

    const bulkRouter = require('./src/routes/bulkRoutes')
    app.use("/", bulkRouter);

    const admissionRouter = require('./src/routes/admissionRoutes');
    app.use('/admission', admissionRouter);

    const teacherAdmissionRouter = require('./src/routes/teacherAdmissionRouter');
    app.use('/', teacherAdmissionRouter);

    const meetingRouter = require("./src/routes/meetingRoutes");
    app.use("/", meetingRouter);

    const searchRouter = require("./src/routes/searchRoutes");
    app.use("/", searchRouter);

    const eventRouter = require("./src/routes/eventRoutes");
    app.use("/", eventRouter);

    const uploadRoutes = require("./src/routes/uploadRoutes");
    app.use("/", uploadRoutes);

};

const getSessionSecret = () => {
    if (process.env.SESSION_SECRET) {
        return process.env.SESSION_SECRET;
    };

    if (process.env.NODE_ENV === "production") {
        throw new Error("SESSION_SECRET is required in production.");
    };

    console.warn("[Session] SESSION_SECRET is not set. Using development-only fallback secret.");
    return "schoolsync-development-session-secret";
};

const migrateUploads = () => {
    const srcDir = path.join(__dirname, "src/public/uploads");
    const destDir = path.join(__dirname, "storage/uploads");

    if (fs.existsSync(srcDir)) {
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        };

        try {
            const items = fs.readdirSync(srcDir);
            for (const item of items) {
                const srcPath = path.join(srcDir, item);
                const destPath = path.join(destDir, item);

                if (fs.existsSync(srcPath)) {
                    if (fs.statSync(srcPath).isDirectory()) {
                        if (!fs.existsSync(destPath)) {
                            fs.renameSync(srcPath, destPath);
                        } else {
                            const files = fs.readdirSync(srcPath);
                            for (const f of files) {
                                const fileSrc = path.join(srcPath, f);
                                const fileDest = path.join(destPath, f);
                                if (!fs.existsSync(fileDest)) {
                                    fs.renameSync(fileSrc, fileDest);
                                };
                            };
                            try { fs.rmdirSync(srcPath); } catch (_) { }
                        };
                    } else {
                        if (!fs.existsSync(destPath)) {
                            fs.renameSync(srcPath, destPath);
                        };
                    };
                };
            };
            console.log("[Migration] Successfully migrated uploads to secure storage folder.");
        } catch (err) {
            console.error("[Migration] Failed to migrate uploads:", err.message);
        };
    };
};

const startServer = async () => {
    migrateUploads();
    await initializeRedis();

    const sessionConfig = {
        secret: getSessionSecret(),
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            maxAge: 24 * 60 * 60 * 1000
        }
    };

    const redisSessionStore = createRedisSessionStore();
    if (redisSessionStore) {
        sessionConfig.store = redisSessionStore;
    }

    app.use(session(sessionConfig));
    app.use(flash());
    app.use(async (req, res, next) => {
        res.locals.success = req.flash("success");
        res.locals.error = req.flash("error");
        res.locals.currentPath = req.path;
        res.locals.user = req.session?.user || req.user || undefined;
        res.locals.impersonation = req.session?.impersonation || null;
        res.locals.unreadMessages = 0;
        res.locals.chatPath = "";

        const routePath = req.path.toLowerCase();
        if (routePath.startsWith('/student')) {
            res.locals.cssFile = 'student.css';
        } else if (routePath.startsWith('/teacher')) {
            res.locals.cssFile = 'teacher.css';
        } else if (routePath.startsWith('/librarian')) {
            res.locals.cssFile = 'librarian.css';
        } else if (routePath.startsWith('/driver')) {
            res.locals.cssFile = 'driver.css';
        } else if (routePath.startsWith('/parent')) {
            res.locals.cssFile = 'student.css';
        } else if (routePath.startsWith('/schooladmin')) {
            res.locals.cssFile = 'schooladmin.css';
        } else if (routePath.startsWith('/groupadmin')) {
            res.locals.cssFile = 'groupadmin.css';
        } else if (routePath.startsWith('/superadmin')) {
            res.locals.cssFile = 'superadmin.css';
        };

        const chatRoles = new Set(["school_admin", "teacher", "librarian", "driver"]);
        const chatPathByRole = {
            school_admin: "/schooladmin/chat",
            teacher: "/teacher/chat",
            librarian: "/librarian/chat",
            driver: "/driver/chat"
        };
        const currentUser = res.locals.user;
        if (currentUser && chatRoles.has(currentUser.role)) {
            res.locals.chatPath = chatPathByRole[currentUser.role];
        };

        next();
    });

    app.use(passport.initialize());
    app.use(passport.session());

    const csrf = require("./src/middleware/csrf");
    app.use(csrf);

    registerRoutes();

    app.use(handleNotFound);
    app.use(handleError);

    const http = require("http");
    const server = http.createServer(app);

    const { initSocket } = require("./src/config/socket");
    initSocket(server);

    const dbHealth = await checkConnection();
    if (dbHealth.ok) {
        const { initCronJobs } = require("./src/services/emailQueueService");
        initCronJobs();

        const { initSubscriptionCron } = require("./src/services/subscriptionCron");
        initSubscriptionCron();

        const { initPerformanceMonitorCron } = require("./src/services/performanceMonitorCron");
        initPerformanceMonitorCron();

        cron.schedule("* * * * *", () => {
            autoUpdateMeetingStatuses().catch((err) => {
                console.error("[MeetingStatusCron] Error:", err.message || err);
            });
        });
    } else {
        console.error(
            `[DB] Connection unavailable (${dbHealth.code || "ERROR"}): ${dbHealth.message}.` +
            `Using ${dbHealth.config.user}@${dbHealth.config.host}/${dbHealth.config.database}` +
            `(password ${dbHealth.config.passwordConfigured ? "set" : "not set"}).` +
            "Fix DB_* values in .env before using database-backed pages."
        );
        console.warn("[Startup] Skipping DB-backed cron jobs and RBAC seed until database connection works.");
    };

    server.listen(PORT, async () => {
        console.log(`SchoolSync is running on port ${PORT}`);
        if (dbHealth.ok) {
            const { seedRBAC } = require("./src/config/rbacSeeder");
            try {
                await seedRBAC();
            } catch (err) {
                console.error("RBAC seed failed on startup:", err);
            };
        };
    });
};

startServer().catch((error) => {
    console.error("SchoolSync failed to start:", error);
    process.exit(1);
});
