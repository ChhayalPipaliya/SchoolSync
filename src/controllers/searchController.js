const { queryAsync } = require("../config/database");

const ROLE_PREFIX = {
    super_admin: "superadmin",
    group_admin: "groupadmin",
    school_admin: "schooladmin",
    teacher: "teacher",
    student: "student",
    parent: "parent",
    librarian: "librarian",
    driver: "driver"
};

const ROLE_LAYOUT = {
    super_admin: "superAdmin/layout",
    group_admin: "groupAdmin/layout",
    school_admin: "schoolAdmin/layout",
    teacher: "teacher/layout",
    student: "student/layout",
    parent: "parent/layout",
    librarian: "librarian/layout",
    driver: "driver/layout"
};

const linksByRole = {
    super_admin: [
        ["Dashboard", "/superadmin/dashboard", "overview analytics metrics"],
        ["Schools", "/superadmin/schools", "school institute campus"],
        ["Users", "/superadmin/users", "admin user account"],
        ["Plans", "/superadmin/plans", "subscription package billing"],
        ["Subscriptions", "/superadmin/subscriptions", "renewal plan billing"],
        ["Payments", "/superadmin/payments", "invoice receipt razorpay"],
        ["Reports", "/superadmin/reports", "analytics report"],
        ["Settings", "/superadmin/settings", "configuration platform"]
    ],
    school_admin: [
        ["Dashboard", "/schooladmin/dashboard", "overview analytics"],
        ["Admissions", "/schooladmin/admissions", "student teacher admission application"],
        ["Students", "/schooladmin/students", "student roll admission class"],
        ["Teachers", "/schooladmin/teachers", "teacher staff faculty"],
        ["Drivers", "/schooladmin/drivers", "driver transport"],
        ["Classes", "/schooladmin/classes", "class section medium stream"],
        ["Subjects", "/schooladmin/subjects", "subject syllabus"],
        ["Attendance", "/schooladmin/attendance/mark", "present absent late"],
        ["Fees", "/schooladmin/fees", "payment receipt dues"],
        ["Exams", "/schooladmin/exams", "marks result schedule"],
        ["Library", "/schooladmin/library", "books members issue"],
        ["Transport", "/schooladmin/transport/dashboard", "bus route vehicle"],
        ["Notices", "/schooladmin/notices", "announcement circular"],
        ["Meetings", "/schooladmin/meetings", "video meeting"],
        ["Reports", "/schooladmin/reports", "analytics export"]
    ],
    teacher: [
        ["Dashboard", "/teacher/dashboard", "overview"],
        ["My Students", "/teacher/students", "student class roll progress"],
        ["Attendance", "/teacher/attendance", "present absent late"],
        ["Homework", "/teacher/homework", "assignment task"],
        ["Marks", "/teacher/marks", "exam result"],
        ["Timetable", "/teacher/timetable", "schedule period"],
        ["Notices", "/teacher/notices", "announcement circular"],
        ["Meetings", "/teacher/meetings", "video meeting"],
        ["Messages", "/teacher/chat", "chat communication"]
    ],
    student: [
        ["Dashboard", "/student/dashboard", "overview"],
        ["Attendance", "/student/attendance", "present absent late"],
        ["Results", "/student/results", "marks exam result"],
        ["Exam Schedule", "/student/exams/schedule", "exam timetable"],
        ["Timetable", "/student/timetable", "schedule period"],
        ["Homework", "/student/homework", "assignment task"],
        ["Fees", "/student/fees", "payment receipt dues"],
        ["Library", "/student/library", "books issue"],
        ["Notices", "/student/notices", "announcement circular"],
        ["Meetings", "/student/meetings", "video meeting"]
    ],
    parent: [
        ["Dashboard", "/parent/dashboard", "overview"],
        ["Attendance", "/parent/attendance", "present absent late child"],
        ["Homework", "/parent/homework", "assignment task child"],
        ["Results", "/parent/results", "marks exam result child"],
        ["Fees", "/parent/fees", "payment receipt dues"],
        ["Notices", "/parent/notices", "announcement circular"],
        ["Meetings", "/parent/meetings", "video meeting"]
    ],
    librarian: [
        ["Dashboard", "/librarian/dashboard", "overview"],
        ["Books", "/librarian/books", "catalog title author isbn barcode"],
        ["Categories", "/librarian/categories", "book category"],
        ["Racks", "/librarian/racks", "shelf location"],
        ["Issue / Return", "/librarian/issues", "circulation issued returned overdue"],
        ["Fines", "/librarian/fines", "payment penalty due"],
        ["Reports", "/librarian/reports", "analytics report"],
        ["Notices", "/librarian/notices", "announcement circular"],
        ["Meetings", "/librarian/meetings", "video meeting"]
    ],
    driver: [
        ["Dashboard", "/driver/dashboard", "overview trip"],
        ["My Route", "/driver/my_route", "route stop pickup drop"],
        ["Students", "/driver/students", "passenger student"],
        ["Vehicle", "/driver/vehicle", "bus van vehicle"],
        ["Attendance", "/driver/attendance", "present absent"],
        ["Notices", "/driver/notices", "announcement circular"],
        ["Meetings", "/driver/meetings", "video meeting"],
        ["Support", "/driver/support", "help issue"]
    ],
    group_admin: [
        ["Dashboard", "/groupadmin/dashboard", "overview branches analytics"],
        ["Branches", "/groupadmin/branches", "school branches campus list"],
        ["Students", "/groupadmin/students", "student list search"],
        ["Teachers", "/groupadmin/teachers", "teacher list staff"],
        ["Attendance", "/groupadmin/attendance", "present absent report"],
        ["Fees", "/groupadmin/fees", "payments finance collections"],
        ["Transport", "/groupadmin/transport", "route vehicle bus"],
        ["Library", "/groupadmin/library", "books issue catalog"],
        ["Reports", "/groupadmin/reports", "statistics analytics export"],
        ["Chat", "/groupadmin/chat", "messaging conversation"],
        ["Meetings", "/groupadmin/meetings", "video meetings schedule"]
    ]
};

const likeTerm = (term) => `%${term}%`;
const pushGroup = (groups, title, icon, rows) => {
    const items = rows.filter(Boolean);
    if (items.length) {
        groups.push({ title, icon, items });
    };
};

const safeQuery = async (label, sql, params, mapper) => {
    try {
        const rows = await queryAsync(sql, params);
        return rows.map(mapper);
    } catch (error) {
        console.warn(`[GlobalSearch] ${label} skipped:`, error.message);
        return [];
    };
};

const navResults = (role, term) => {
    const q = term.toLowerCase();
    return (linksByRole[role] || [])
        .filter(([label, , keywords]) => `${label} ${keywords}`.toLowerCase().includes(q))
        .slice(0, 8)
        .map(([label, href, keywords]) => ({
            title: label,
            subtitle: keywords.split(" ").slice(0, 4).join(" "),
            href,
            meta: "Page"
        }));
};

const schoolScopedGroups = async (user, term) => {
    const role = user.role;
    const schoolId = user.school_id;
    const groups = [];
    const like = likeTerm(term);

    if (["school_admin", "teacher", "driver"].includes(role)) {
        const students = await safeQuery("students", `
        SELECT st.id, st.admission_no, st.roll_no, c.class_name, c.section,
            u.first_name, u.last_name, u.email, u.phone
        FROM students st
        JOIN users u ON u.id = st.user_id
        LEFT JOIN classes c ON c.id = st.class_id
        WHERE st.school_id = ?
            AND st.deleted_at IS NULL
            AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?
                OR st.admission_no LIKE ? OR st.roll_no LIKE ?)
        ORDER BY u.first_name ASC
        LIMIT 8
    `, [schoolId, like, like, like, like, like, like], (row) => {
            const href = role === "teacher"
                ? `/teacher/students/${row.id}/progress`
                : role === "driver"
                    ? "/driver/students"
                    : `/schooladmin/students/${row.id}/view`;
            return {
                title: `${row.first_name || ""} ${row.last_name || ""}`.trim() || "Student",
                subtitle: [row.class_name, row.section, row.admission_no && `Adm ${row.admission_no}`].filter(Boolean).join(" / "),
                href,
                meta: "Student"
            };
        });
        pushGroup(groups, "Students", "fa-user-graduate", students);
    };

    if (role === "school_admin") {
        const teachers = await safeQuery("teachers", `
            SELECT id, first_name, last_name, email, phone
            FROM users
            WHERE school_id = ? AND role = 'teacher' AND deleted_at IS NULL
                AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone LIKE ?)
            ORDER BY first_name ASC
            LIMIT 8
        `, [schoolId, like, like, like, like], (row) => ({
            title: `${row.first_name || ""} ${row.last_name || ""}`.trim() || "Teacher",
            subtitle: row.email || row.phone || "Teacher profile",
            href: `/schooladmin/teachers/${row.id}`,
            meta: "Teacher"
        }));
        pushGroup(groups, "Teachers", "fa-chalkboard-teacher", teachers);

        const drivers = await safeQuery("drivers", `
            SELECT id, first_name, last_name, phone, license_number
            FROM drivers
            WHERE school_id = ? AND deleted_at IS NULL
                AND (first_name LIKE ? OR last_name LIKE ? OR phone LIKE ? OR license_number LIKE ?)
            ORDER BY first_name ASC
            LIMIT 8
        `, [schoolId, like, like, like, like], (row) => ({
            title: `${row.first_name || ""} ${row.last_name || ""}`.trim() || "Driver",
            subtitle: [row.phone, row.license_number].filter(Boolean).join(" / "),
            href: `/schooladmin/drivers/${row.id}`,
            meta: "Driver"
        }));
        pushGroup(groups, "Drivers", "fa-id-card", drivers);

        const classes = await safeQuery("classes", `
            SELECT id, class_name, section, medium, stream, academic_year
            FROM classes
            WHERE school_id = ?
                AND (class_name LIKE ? OR section LIKE ? OR medium LIKE ? OR stream LIKE ? OR academic_year LIKE ?)
            ORDER BY class_name ASC, section ASC
            LIMIT 8
        `, [schoolId, like, like, like, like, like], (row) => ({
            title: [row.class_name, row.section].filter(Boolean).join(" - ") || "Class",
            subtitle: [row.medium, row.stream, row.academic_year].filter(Boolean).join(" / "),
            href: `/schooladmin/classes/${row.id}/edit`,
            meta: "Class"
        }));
        pushGroup(groups, "Classes", "fa-layer-group", classes);

        const subjects = await safeQuery("subjects", `
            SELECT id, subject_name, code, subject_code, subject_type
            FROM subjects
            WHERE school_id = ?
                AND (subject_name LIKE ? OR code LIKE ? OR subject_code LIKE ? OR subject_type LIKE ?)
            ORDER BY subject_name ASC
            LIMIT 8
        `, [schoolId, like, like, like, like], (row) => ({
            title: row.subject_name || "Subject",
            subtitle: [row.code || row.subject_code, row.subject_type].filter(Boolean).join(" / "),
            href: "/schooladmin/subjects",
            meta: "Subject"
        }));
        pushGroup(groups, "Subjects", "fa-book-open", subjects);
    };

    if (["school_admin", "student", "parent", "teacher", "librarian", "driver"].includes(role)) {
        const notices = await safeQuery("notices", `
            SELECT id, title, notice_type, priority, created_at
            FROM notices
            WHERE school_id = ?
                AND COALESCE(status, IF(is_active = 1, 'active', 'inactive')) = 'active'
                AND (title LIKE ? OR content LIKE ? OR notice_type LIKE ? OR priority LIKE ?)
            ORDER BY created_at DESC
            LIMIT 6
        `, [schoolId, like, like, like, like], (row) => ({
            title: row.title || "Notice",
            subtitle: [row.notice_type, row.priority].filter(Boolean).join(" / "),
            href: `/${ROLE_PREFIX[role]}/notices`,
            meta: "Notice"
        }));
        pushGroup(groups, "Notices", "fa-bullhorn", notices);
    };

    if (["school_admin", "student", "parent", "teacher", "librarian"].includes(role)) {
        const events = await safeQuery("events", `
            SELECT id, title, event_type, event_date, venue
            FROM events
            WHERE school_id = ?
                AND (title LIKE ? OR description LIKE ? OR event_type LIKE ? OR venue LIKE ?)
            ORDER BY event_date DESC
            LIMIT 6
        `, [schoolId, like, like, like, like], (row) => ({
            title: row.title || "Event",
            subtitle: [row.event_type, row.venue, row.event_date].filter(Boolean).join(" / "),
            href: "/events",
            meta: "Event"
        }));
        pushGroup(groups, "Events", "fa-images", events);
    };

    if (["school_admin", "librarian", "student"].includes(role)) {
        const books = await safeQuery("library books", `
            SELECT id, title, author, isbn, barcode, available_copies
            FROM library_books
            WHERE school_id = ?
                AND status = 'active'
                AND (title LIKE ? OR author LIKE ? OR isbn LIKE ? OR barcode LIKE ? OR category LIKE ?)
            ORDER BY title ASC
            LIMIT 8
        `, [schoolId, like, like, like, like, like], (row) => ({
            title: row.title || "Book",
            subtitle: [row.author, row.isbn, `${row.available_copies || 0} available`].filter(Boolean).join(" / "),
            href: role === "librarian" ? `/librarian/books?search=${encodeURIComponent(term)}` : "/student/library",
            meta: "Library"
        }));
        pushGroup(groups, "Library Books", "fa-book", books);
    };

    if (role === "librarian") {
        const issues = await safeQuery("library issues", `
            SELECT li.id, li.status, li.due_date, lb.title, u.first_name, u.last_name
            FROM library_issues li
            JOIN library_books lb ON lb.id = li.book_id
            JOIN users u ON u.id = li.user_id
            WHERE li.school_id = ?
                AND (lb.title LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR li.status LIKE ?)
            ORDER BY li.created_at DESC
            LIMIT 8
        `, [schoolId, like, like, like, like], (row) => ({
            title: row.title || "Book Issue",
            subtitle: [`${row.first_name || ""} ${row.last_name || ""}`.trim(), row.status, row.due_date && `Due ${row.due_date}`].filter(Boolean).join(" / "),
            href: "/librarian/issues",
            meta: "Issue"
        }));
        pushGroup(groups, "Book Issues", "fa-exchange-alt", issues);
    };

    if (role === "driver") {
        const transport = await safeQuery("driver transport", `
            SELECT r.route_name, r.start_point, r.end_point, v.vehicle_number
            FROM drivers d
            LEFT JOIN routes r ON r.driver_id = d.id AND r.school_id = d.school_id
            LEFT JOIN vehicles v ON v.id = r.vehicle_id AND v.school_id = d.school_id
            WHERE d.school_id = ? AND d.user_id = ?
                AND (r.route_name LIKE ? OR r.start_point LIKE ? OR r.end_point LIKE ? OR v.vehicle_number LIKE ?)
            LIMIT 6
        `, [schoolId, user.id, like, like, like, like], (row) => ({
            title: row.route_name || row.vehicle_number || "Transport",
            subtitle: [row.start_point, row.end_point, row.vehicle_number].filter(Boolean).join(" / "),
            href: "/driver/my_route",
            meta: "Transport"
        }));
        pushGroup(groups, "Transport", "fa-route", transport);
    };

    return groups;
};

const superAdminGroups = async (term) => {
    const groups = [];
    const like = likeTerm(term);

    const schools = await safeQuery("schools", `
        SELECT id, school_name, city, state, status
        FROM schools
        WHERE school_name LIKE ? OR school_email LIKE ? OR school_phone LIKE ? OR city LIKE ? OR state LIKE ?
        ORDER BY school_name ASC
        LIMIT 8
    `, [like, like, like, like, like], (row) => ({
        title: row.school_name || "School",
        subtitle: [row.city, row.state, row.status].filter(Boolean).join(" / "),
        href: `/superadmin/schools/${row.id}`,
        meta: "School"
    }));
    pushGroup(groups, "Schools", "fa-school", schools);

    const users = await safeQuery("users", `
        SELECT u.id, u.first_name, u.last_name, u.email, u.role, s.school_name
        FROM users u
        LEFT JOIN schools s ON s.id = u.school_id
        WHERE u.deleted_at IS NULL
            AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR u.role LIKE ? OR s.school_name LIKE ?)
        ORDER BY u.first_name ASC
        LIMIT 8
    `, [like, like, like, like, like], (row) => ({
        title: `${row.first_name || ""} ${row.last_name || ""}`.trim() || row.email || "User",
        subtitle: [row.role, row.school_name].filter(Boolean).join(" / "),
        href: `/superadmin/users/${row.id}`,
        meta: "User"
    }));
    pushGroup(groups, "Users", "fa-users", users);

    const plans = await safeQuery("plans", `
        SELECT id, name, plan_key, price, status, is_active
        FROM plans
        WHERE name LIKE ? OR plan_key LIKE ? OR description LIKE ?
        ORDER BY display_order ASC, id ASC
        LIMIT 8
    `, [like, like, like], (row) => ({
        title: row.name || "Plan",
        subtitle: [row.plan_key, row.status || (row.is_active ? "active" : "inactive"), row.price && `Rs. ${row.price}`].filter(Boolean).join(" / "),
        href: "/superadmin/plans",
        meta: "Plan"
    }));
    pushGroup(groups, "Plans", "fa-tags", plans);

    return groups;
};

const groupAdminScopedGroups = async (user, term) => {
    const groups = [];
    const like = likeTerm(term);

    let schoolIds = [];
    try {
        const { getAssignedSchoolIds } = require("../utils/groupAdminContext");
        schoolIds = await getAssignedSchoolIds(user.id);
    } catch (err) {
        console.error("[GlobalSearch] Failed to get group admin schools:", err.message);
    };

    if (!schoolIds || schoolIds.length === 0) {
        return groups;
    };

    const branches = await safeQuery("branches", `
        SELECT id, school_name, city, state, status
        FROM schools
        WHERE id IN (?)
            AND (school_name LIKE ? OR city LIKE ? OR state LIKE ?)
        ORDER BY school_name ASC
        LIMIT 8
  `, [schoolIds, like, like, like], (row) => ({
        title: row.school_name || "Branch",
        subtitle: [row.city, row.state, row.status].filter(Boolean).join(" / "),
        href: `/groupadmin/branch/${row.id}/overview`,
        meta: "Branch"
    }));
    pushGroup(groups, "Branches", "fa-school", branches);

    const students = await safeQuery("students", `
        SELECT st.id, st.admission_no, st.roll_no, c.class_name, c.section,
            u.first_name, u.last_name, u.email, u.phone, s.school_name, st.school_id
        FROM students st
        JOIN users u ON u.id = st.user_id
        JOIN schools s ON s.id = st.school_id
        LEFT JOIN classes c ON c.id = st.class_id
        WHERE st.school_id IN (?)
            AND st.deleted_at IS NULL
            AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?
                OR st.admission_no LIKE ? OR st.roll_no LIKE ?)
        ORDER BY u.first_name ASC
        LIMIT 8
    `, [schoolIds, like, like, like, like, like, like], (row) => ({
        title: `${row.first_name || ""} ${row.last_name || ""}`.trim() || "Student",
        subtitle: [`Branch: ${row.school_name}`, row.class_name, row.section].filter(Boolean).join(" / "),
        href: `/groupadmin/students?branchId=${row.school_id}&search=${encodeURIComponent(row.first_name + ' ' + row.last_name)}`,
        meta: "Student"
    }));
    pushGroup(groups, "Students", "fa-user-graduate", students);

    const teachers = await safeQuery("teachers", `
        SELECT u.id, u.first_name, u.last_name, u.email, u.phone, s.school_name, u.school_id
        FROM users u
        JOIN schools s ON s.id = u.school_id
        WHERE u.school_id IN (?) AND u.role = 'teacher' AND u.deleted_at IS NULL
            AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)
        ORDER BY u.first_name ASC
        LIMIT 8
    `, [schoolIds, like, like, like, like], (row) => ({
        title: `${row.first_name || ""} ${row.last_name || ""}`.trim() || "Teacher",
        subtitle: [`Branch: ${row.school_name}`, row.email || row.phone].filter(Boolean).join(" / "),
        href: `/groupadmin/teachers?branchId=${row.school_id}&search=${encodeURIComponent(row.first_name + ' ' + row.last_name)}`,
        meta: "Teacher"
    }));
    pushGroup(groups, "Teachers", "fa-chalkboard-teacher", teachers);
    return groups;
};

exports.index = async (req, res) => {
    const user = req.user || res.locals.user;
    const role = user?.role || "";
    const rawQuery = typeof req.query.q === "string" ? req.query.q : "";
    const q = rawQuery.trim().slice(0, 80);
    const groups = [];

    if (q) {
        pushGroup(groups, "Quick Links", "fa-link", navResults(role, q));
        if (role === "super_admin") {
            groups.push(...await superAdminGroups(q));
        } else if (role === "group_admin") {
            groups.push(...await groupAdminScopedGroups(user, q));
        } else if (user?.school_id) {
            groups.push(...await schoolScopedGroups(user, q));
        };
    };

    return res.render("search/index", {
        layout: ROLE_LAYOUT[role] || false,
        title: "Search",
        q,
        groups,
        totalResults: groups.reduce((sum, group) => sum + group.items.length, 0)
    });
};