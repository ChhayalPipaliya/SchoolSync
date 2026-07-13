const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const routeDir = path.join(root, "src/routes");
const outputFile = path.join(root, "docs/route-matrix.md");

const mounts = {
    "admissionRoutes.js": "/admission",
    "authRoutes.js": "",
    "bulkRoutes.js": "",
    "driverRoutes.js": "/driver",
    "eventRoutes.js": "",
    "groupAdminRoutes.js": "/groupadmin",
    "librarianRoutes.js": "/librarian",
    "meetingRoutes.js": "",
    "notificationRoutes.js": "/api/notifications",
    "parentRoutes.js": "/parent",
    "razorpayRoutes.js": "/api/fees/razorpay",
    "schoolAdminRoutes.js": "/schooladmin",
    "searchRoutes.js": "",
    "studentRoutes.js": "/student",
    "superAdminRoutes.js": "/superadmin",
    "teacherAdmissionRouter.js": "",
    "teacherRoutes.js": "/teacher",
    "uploadRoutes.js": "",
    "webhookRoutes.js": "/webhooks"
};

function balancedCall(source, openIndex) {
    let depth = 0;
    let quote = null;
    let escaped = false;
    for (let i = openIndex; i < source.length; i += 1) {
        const char = source[i];
        if (quote) {
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === quote) quote = null;
            continue;
        };
        if (["'", '"', "`"].includes(char)) quote = char;
        else if (char === "(") depth += 1;
        else if (char === ")") {
            depth -= 1;
            if (depth === 0) return source.slice(openIndex + 1, i);
        };
    };
    return "";
}

function splitTopLevel(value) {
    const parts = [];
    let current = "";
    let depth = 0;
    let quote = null;
    let escaped = false;
    for (const char of value) {
        if (quote) {
            current += char;
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === quote) quote = null;
            continue;
        };
        if (["'", '"', "`"].includes(char)) quote = char;
        else if (["(", "[", "{"].includes(char)) depth += 1;
        else if ([")", "]", "}"].includes(char)) depth -= 1;
        if (char === "," && depth === 0) {
            parts.push(current.trim());
            current = "";
        } else current += char;
    };
    if (current.trim()) parts.push(current.trim());
    return parts;
}

function fullUrl(mount, routePath) {
    const joined = `${mount}/${routePath.replace(/^\/+/, "")}`.replace(/\/{2,}/g, "/");
    return joined.length > 1 ? joined.replace(/\/$/, "") : "/";
}

function rolesFor(file, handlers) {
    const explicit = [...handlers.matchAll(/is(SuperAdmin|Admin|SchoolAdmin|GroupAdmin|Teacher|Student|Driver|Librarian|Library|Parent)/g)]
        .map((match) => match[1].replace(/([a-z])([A-Z])/g, "$1 $2"));
    const arrayRoles = [...handlers.matchAll(/['"](super_admin|group_admin|school_admin|teacher|student|parent|driver|librarian)['"]/g)]
        .map((match) => match[1]);
    const mountRoles = {
        "superAdminRoutes.js": ["super_admin"],
        "groupAdminRoutes.js": ["group_admin"],
        "schoolAdminRoutes.js": ["school_admin"],
        "teacherRoutes.js": ["teacher"],
        "studentRoutes.js": ["student"],
        "parentRoutes.js": ["parent"],
        "driverRoutes.js": ["driver"],
        "librarianRoutes.js": ["librarian"]
    };
    return [...new Set([...explicit, ...arrayRoles, ...(mountRoles[file] || [])])].join(", ") || "public/handler-defined";
}

function tenantFor(file, url) {
    if (file === "superAdminRoutes.js" || ["authRoutes.js", "admissionRoutes.js", "webhookRoutes.js"].includes(file)) return "No/platform or token-bound";
    if (file === "groupAdminRoutes.js") return "Assigned schools only";
    if (url.startsWith("/superadmin")) return "No/platform";
    return "Yes (school_id)";
}

function featureFor(url) {
    const mappings = [
        ["/admissions", "admissions"], ["/certificates", "certificates"], ["/transport", "transport"],
        ["/drivers", "transport"], ["/library", "library"], ["/librarians", "library"],
        ["/salary", "salary"], ["/analytics", "analytics"], ["/reports", "reports"],
        ["/meetings", "meetings"], ["/leaves", "leaves"], ["/chat", "messaging"],
        ["/portal", "portal"], ["/settings", "settings"], ["/attendance", "attendance"],
        ["/fees", "fees"], ["/homework", "homework"], ["/timetable", "timetable"],
        ["/exams", "exams"], ["/marks", "exams"], ["/results", "exams"],
        ["/students", "students"], ["/teachers", "teachers"], ["/classes", "classes"],
        ["/subjects", "subjects"], ["/events", "events"], ["/notices", "notices"]
    ];
    const lower = url.toLowerCase();
    const match = mappings.find(([segment]) => lower.includes(segment));
    return match ? match[1] : "none/dashboard/controller-defined";
}

function responseFor(handler) {
    const render = handler.match(/res\.render\(\s*['"]([^'"]+)/);
    if (render) return `EJS: ${render[1]}`;
    if (/\.json\(|res\.json\(/.test(handler)) return "JSON";
    if (/res\.redirect\(/.test(handler)) return "Redirect";
    return "Controller-defined EJS/JSON";
}

const rows = [];
for (const [file, mount] of Object.entries(mounts)) {
    const source = fs.readFileSync(path.join(routeDir, file), "utf8");
    const pattern = /router\.(get|post|put|patch|delete|all)\s*\(\s*(['"])(.*?)\2/gms;
    for (const match of source.matchAll(pattern)) {
        const openIndex = source.indexOf("(", match.index);
        const args = splitTopLevel(balancedCall(source, openIndex));
        const routePath = match[3];
        const handlers = args.slice(1);
        const controller = handlers.at(-1) || "inline";
        const middleware = handlers.slice(0, -1).join(", ") || "none";
        const url = fullUrl(mount, routePath);
        rows.push({
            file,
            method: match[1].toUpperCase(),
            url,
            middleware: middleware.replace(/\s+/g, " ").slice(0, 180),
            controller: controller.replace(/\s+/g, " ").slice(0, 140),
            roles: rolesFor(file, `${middleware},${controller}`),
            tenant: tenantFor(file, url),
            feature: featureFor(url),
            response: responseFor(controller)
        });
    };
};

rows.sort((a, b) => a.url.localeCompare(b.url) || a.method.localeCompare(b.method));
const escape = (value) => String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const lines = [
    "# SchoolSync route matrix",
    "",
    `Generated from the actual app.js mounts and route files. Total mounted routes: ${rows.length}.`,
    "",
    "Response type is marked controller-defined when the route delegates response selection to its controller.",
    "",
    "| Method | Mounted URL | Middleware | Controller/handler | Roles | Tenant | Feature | Response | Source |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows.map((row) => `| ${escape(row.method)} | ${escape(row.url)} | ${escape(row.middleware)} | ${escape(row.controller)} | ${escape(row.roles)} | ${escape(row.tenant)} | ${escape(row.feature)} | ${escape(row.response)} | ${escape(row.file)} |`),
    "",
    "## Unmounted route aggregators",
    "",
    "- `src/routes/index.js` is not mounted by `app.js`.",
    "- `src/routes/fileRoutes.js` is intentionally not mounted; `uploadRoutes.js` is the canonical owner-authorized upload handler.",
    ""
];

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, lines.join("\n"));
console.log(`Wrote ${rows.length} routes to ${path.relative(root, outputFile)}`);
