const path = require("path");
const fs = require("fs");
const http = require("http");
const cron = require("node-cron");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const expressLayouts = require("express-ejs-layouts");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const flash = require("connect-flash");
const passport = require("./src/config/passport");
const { createRedisSessionStore, initializeRedis } = require("./src/config/redis");
const { checkConnection } = require("./src/config/database");
const { handleError, handleNotFound } = require("./src/middleware/errorHandler");
const { securityHeaders } = require("./src/middleware/securityHeaders");
const { sanitizeRequest, preventPrototypePollution } = require("./src/middleware/sanitize");
const { apiMetricsMiddleware } = require("./src/middleware/apiMetrics");
const { apiLimiter } = require("./src/middleware/rateLimit");
const { verifyToken } = require("./src/middleware/auth");
const { subscriptionGuard } = require("./src/middleware/subscriptionGuard");
const { autoUpdateMeetingStatuses } = require("./src/controllers/meetingController");

const app = express();
const PORT = process.env.PORT || 4000;

if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
} else {
    app.set("trust proxy", false);
};

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "src/views"));
app.use(expressLayouts);
app.set("layout", false);
app.use((req, res, next) => {
    if (req.path.startsWith("/uploads/") || req.path === "/uploads") {
        return next();
    }
    express.static(path.join(__dirname, "src/public"))(req, res, next);
});

app.use(express.json({
    limit: "10mb",
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

app.use((req, res, next) => {
    const allowed = new Set(["PUT", "PATCH", "DELETE"]);
    let method = null;

    if (req.body?._method) {
        method = String(req.body._method).toUpperCase();
        delete req.body._method;
    } else if (req.query?._method) {
        method = String(req.query._method).toUpperCase();
        delete req.query._method;
    }

    if (allowed.has(method)) {
        req.method = method;
    }
    next();
});

app.use(securityHeaders);
app.use(sanitizeRequest);
app.use(preventPrototypePollution);
app.use(apiMetricsMiddleware);

app.use("/api", apiLimiter);

if (process.env.NODE_ENV !== "production") {
    const originalLog = console.log;
    console.log = (...args) => {
        const stack = new Error().stack.split("\n")[2]?.trim() || "unknown";
        originalLog(`[LOG @ ${stack}]`, ...args);
    };
};


const getSessionSecret = () => {
    if (process.env.SESSION_SECRET) {
        return process.env.SESSION_SECRET;
    };
    if (process.env.NODE_ENV === "production") {
        throw new Error("SESSION_SECRET is required in production.");
    };
    console.warn("[Session] SESSION_SECRET not set. Using development fallback.");
    return "schoolsync-dev-secret-" + Date.now();
};

const migrateUploads = () => {
    const srcDir = path.join(__dirname, "src/public/uploads");
    const destDir = path.join(__dirname, "storage/uploads");

    if (!fs.existsSync(srcDir)) return;

    try {
        fs.mkdirSync(destDir, { recursive: true });

        const items = fs.readdirSync(srcDir);
        for (const item of items) {
            const srcPath = path.join(srcDir, item);
            const destPath = path.join(destDir, item);

            if (!fs.existsSync(srcPath)) continue;
            if (fs.statSync(srcPath).isDirectory()) {
                if (!fs.existsSync(destPath)) {
                    fs.renameSync(srcPath, destPath);
                } else {
                    const files = fs.readdirSync(srcPath);
                    for (const f of files) {
                        const fSrc = path.join(srcPath, f);
                        const fDest = path.join(destPath, f);
                        if (!fs.existsSync(fDest)) {
                            fs.renameSync(fSrc, fDest);
                        };
                    };
                    try { fs.rmdirSync(srcPath); } catch (_) {  }
                };
            } else if (!fs.existsSync(destPath)) {
                fs.renameSync(srcPath, destPath);
            };
        };
        if (fs.existsSync(srcDir)) {
            try {
                const remaining = fs.readdirSync(srcDir);
                if (remaining.length === 0) {
                    fs.rmdirSync(srcDir);
                };
            } catch (_) { };
        };
    } catch (err) {
        console.error("[Migration] Failed:", err.message);
    };
};

const setupLocals = (req, res, next) => {
    res.locals.success = req.flash("success");
    res.locals.error = req.flash("error");
    res.locals.warning = req.flash("warning");
    res.locals.info = req.flash("info");
    res.locals.currentPath = req.path;
    res.locals.user = req.session?.user || req.user || undefined;
    res.locals.impersonation = req.session?.impersonation || null;
    res.locals.unreadMessages = 0;
    res.locals.chatPath = "";

    const routePath = req.path.toLowerCase();
    const cssMap = {
        "/student": "student.css",
        "/teacher": "teacher.css",
        "/librarian": "librarian.css",
        "/driver": "driver.css",
        "/parent": "student.css",
        "/schooladmin": "schooladmin.css",
        "/groupadmin": "groupadmin.css",
        "/superadmin": "superadmin.css"
    };

    for (const [prefix, cssFile] of Object.entries(cssMap)) {
        if (routePath.startsWith(prefix)) {
            res.locals.cssFile = cssFile;
            break;
        };
    };

    const chatRoles = new Set(["school_admin", "teacher", "librarian", "driver"]);
    const chatPaths = {
        school_admin: "/schooladmin/chat",
        teacher: "/teacher/chat",
        librarian: "/librarian/chat",
        driver: "/driver/chat"
    };

    const currentUser = res.locals.user;
    if (currentUser && chatRoles.has(currentUser.role)) {
        res.locals.chatPath = chatPaths[currentUser.role];
    };

    next();
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

    const redisStore = createRedisSessionStore();
    if (redisStore) {
        sessionConfig.store = redisStore;
    }

    app.use(session(sessionConfig));
    app.use(flash());
    app.use(setupLocals);

    app.use(passport.initialize());
    app.use(passport.session());

    const csrf = require("./src/middleware/csrf");
    app.use(csrf);

    app.use("/", require("./src/routes/authRoutes"));
    app.use("/", require("./src/routes/bulkRoutes"));
    app.use("/", require("./src/routes/meetingRoutes"));
    app.use("/", require("./src/routes/searchRoutes"));
    app.use("/", require("./src/routes/eventRoutes"));
    app.use("/", require("./src/routes/uploadRoutes"));
    app.use("/", require("./src/routes/teacherAdmissionRouter"));
    app.use("/", require("./src/routes/gpsRouter"));
    app.use("/admission", require("./src/routes/admissionRoutes"));
    app.use("/webhooks", require("./src/routes/webhookRoutes"));
    app.use("/api/notifications", require("./src/routes/notificationRoutes"));
    app.use("/api/fees/razorpay", require("./src/routes/razorpayRoutes"));
    app.use("/api/ai", require("./src/routes/aiRoutes"));

    const protectedRoutes = [
        { path: "/superadmin", router: "./src/routes/superAdminRoutes", guard: false },
        { path: "/groupadmin", router: "./src/routes/groupAdminRoutes", guard: false },
        { path: "/schooladmin", router: "./src/routes/schoolAdminRoutes", guard: true },
        { path: "/student", router: "./src/routes/studentRoutes", guard: true },
        { path: "/teacher", router: "./src/routes/teacherRoutes", guard: true },
        { path: "/driver", router: "./src/routes/driverRoutes", guard: true },
        { path: "/librarian", router: "./src/routes/librarianRoutes", guard: true },
        { path: "/parent", router: "./src/routes/parentRoutes", guard: true },
    ];

    protectedRoutes.forEach(({ path: routePath, router, guard }) => {
        const routerModule = require(router);
        if (guard) {
            app.use(routePath, verifyToken, subscriptionGuard, routerModule);
        } else {
            app.use(routePath, routerModule);
        };
    });

    app.use(handleNotFound);
    app.use(handleError);

    const server = http.createServer(app);
    const { initSocket } = require("./src/config/socket");
    initSocket(server);

    const dbHealth = await checkConnection();
    if (!dbHealth.ok) {
        console.error(
            `[DB] Connection failed (${dbHealth.code || "ERROR"}): ${dbHealth.message}. ` +
            `Config: ${dbHealth.config.user}@${dbHealth.config.host}/${dbHealth.config.database} ` +
            `(password: ${dbHealth.config.passwordConfigured ? "set" : "missing"})`
        );
        console.warn("[Startup] Skipping DB cron jobs and RBAC seed.");
    } else {
        const { initCronJobs } = require("./src/services/emailQueueService");
        const { initSubscriptionCron } = require("./src/services/subscriptionCron");
        const { initPerformanceMonitorCron } = require("./src/services/performanceMonitorCron");
        const { initLibraryCron } = require("./src/services/libraryCron");
        const { initAttendanceReminderCron } = require("./src/services/attendanceReminderCron");
        const { initFeeReminderCron } = require("./src/services/feeReminderCron");
        const { initSalaryGenerationCron } = require("./src/services/salaryGenerationCron");
        const { initAttendanceDefaulterCron } = require("./src/services/attendanceDefaulterCron");
        const { initTransportExpiryCron } = require("./src/services/transportExpiryCron");
        const { initTripAutoCloseCron } = require("./src/services/tripAutoCloseCron");

        initCronJobs();
        initSubscriptionCron();
        initPerformanceMonitorCron();
        initLibraryCron();
        initAttendanceReminderCron();
        initFeeReminderCron();
        initSalaryGenerationCron();
        initAttendanceDefaulterCron();
        initTransportExpiryCron();
        initTripAutoCloseCron();

        cron.schedule("* * * * *", () => {
            autoUpdateMeetingStatuses().catch(err => {
                console.error("[MeetingStatusCron] Error:", err.message || err);
            });
        });
    };

    const gracefulShutdown = (signal) => {
        server.close(() => {
            process.exit(0);
        });
    };

    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));

    server.listen(PORT, async () => {
        console.log(`SchoolSync running on port ${PORT}`);

        if (dbHealth.ok) {
            try {
                const { seedRBAC } = require("./src/config/rbacSeeder");
                await seedRBAC();
            } catch (err) {
                console.error("RBAC seed failed:", err);
            };
        };
    });
};

startServer().catch((error) => {
    console.error("SchoolSync failed to start:", error);
    process.exit(1);
});