const db = require('../../config/database');
const { getSubscriptionState, getPublicPlans, REMINDER_MESSAGES } = require('../../services/subscriptionService');
const { getSchoolTodayAttendanceSummary } = require('../../services/attendanceEngineService');
const { getTodaysBirthdays } = require('../../services/birthdayService');

const getSchoolId = (req) => (
    req.user?.school_id ||
    req.session?.user?.school_id ||
    req.session?.schoolId ||
    null
);

exports.getDashboard = async (req, res) => {
    try {
        const user = req.user || req.session?.user;
        const schoolId = getSchoolId(req);
        if (!schoolId) {
            console.error('[SchoolAdmin Dashboard Stats] Missing school_id for user:', user?.id || 'unknown');
            req.flash('error', 'Missing school context');
            return res.redirect('/');
        };
        const subscriptionState = req.subscriptionState || await getSubscriptionState(schoolId, {
            createReminders: true,
            userId: user?.id
        });

        const [[schoolRow]] = await db.query(
            `SELECT s.id, s.school_name AS name, s.subdomain, s.status,
                COALESCE(sub.plan, s.plan) AS plan, sub.end_date as subscription_expiry
            FROM schools s
            LEFT JOIN subscriptions sub ON s.id = sub.school_id AND sub.status IN ('active', 'trial')
            WHERE s.id = ? LIMIT 1`,
            [schoolId]
        );

        const [[subscriptionInfo]] = await db.query(
            `SELECT sub.*, p.student_limit, p.teacher_limit as staff_limit, p.max_students, p.max_teachers, p.max_classes
            FROM subscriptions sub
            JOIN plans p ON sub.plan_id = p.id
            WHERE sub.school_id = ? AND sub.status IN ('active', 'trial')
            LIMIT 1`,
            [schoolId]
        );

        const [[studentCount]] = await db.query(
            'SELECT COUNT(*) as count FROM students WHERE school_id = ? AND deleted_at IS NULL',
            [schoolId]
        );
        const [[genderStats]] = await db.query(
            `SELECT
                SUM(CASE WHEN gender = 'Male' THEN 1 ELSE 0 END) AS boys,
                SUM(CASE WHEN gender = 'Female' THEN 1 ELSE 0 END) AS girls
            FROM students WHERE school_id = ? AND deleted_at IS NULL`,
            [schoolId]
        );
        const [[teacherCount]] = await db.query(
            'SELECT COUNT(*) as count FROM teachers WHERE school_id = ? AND deleted_at IS NULL',
            [schoolId]
        );
        const [[driverCount]] = await db.query(
            'SELECT COUNT(*) as count FROM drivers WHERE school_id = ? AND status = "active"',
            [schoolId]
        );
        const [[classCount]] = await db.query(
            'SELECT COUNT(*) as count FROM classes WHERE school_id = ?',
            [schoolId]
        );
        const [[libraryMembersCount]] = await db.query(
            'SELECT COUNT(*) as count FROM library_members WHERE school_id = ? AND status = "active"',
            [schoolId]
        );
        const [[activeVehiclesCount]] = await db.query(
            'SELECT COUNT(*) as count FROM vehicles WHERE school_id = ? AND LOWER(status) = "active"',
            [schoolId]
        );

        const [[todayFees]] = await db.query(
            `SELECT COALESCE(SUM(amount), 0) as total FROM fee_payments 
            WHERE school_id = ? AND DATE(created_at) = CURDATE() AND status IN ('completed', 'paid')`,
            [schoolId]
        );
        const [[pendingFees]] = await db.query(
            `SELECT COALESCE(SUM(total_amount - paid_amount), 0) as total, COUNT(*) AS count FROM student_fees
            WHERE school_id = ? AND status IN ('pending', 'partial')`,
            [schoolId]
        );
        const [[paidFees]] = await db.query(
            `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) AS count
            FROM fee_payments WHERE school_id = ? AND status IN ('completed', 'paid')`,
            [schoolId]
        );
        const [[overdueFees]] = await db.query(
            `SELECT COALESCE(SUM(total_amount - paid_amount), 0) as total, COUNT(*) AS count FROM student_fees
            WHERE school_id = ? AND status IN ('pending', 'partial') AND due_date < CURDATE()`,
            [schoolId]
        );
        const [[thisMonthFees]] = await db.query(
            `SELECT COALESCE(SUM(amount), 0) as total FROM fee_payments 
            WHERE school_id = ? AND MONTH(created_at) = MONTH(CURDATE()) AND YEAR(created_at) = YEAR(CURDATE()) AND status IN ('completed', 'paid')`,
            [schoolId]
        );

        const [classFeeBreakdown] = await db.query(
            `SELECT c.class_name, c.section, 
                COALESCE(SUM(sf.paid_amount), 0) AS collected,
                COALESCE(SUM(sf.total_amount), 0) AS total
            FROM classes c
            LEFT JOIN students s ON s.class_id = c.id AND s.deleted_at IS NULL
            LEFT JOIN student_fees sf ON sf.student_id = s.id
            WHERE c.school_id = ?
            GROUP BY c.id
            ORDER BY c.class_name ASC, c.section ASC
            LIMIT 5`,
            [schoolId]
        );

        const [topDefaulters] = await db.query(
            `SELECT u.first_name as first_name, u.last_name as last_name, c.class_name, c.section,
                SUM(sf.total_amount - sf.paid_amount) AS balance
            FROM student_fees sf
            JOIN students s ON sf.student_id = s.id
            JOIN users u ON s.user_id = u.id
            LEFT JOIN classes c ON s.class_id = c.id
            WHERE sf.school_id = ? AND sf.status IN ('pending', 'partial')
            GROUP BY s.id
            ORDER BY balance DESC
            LIMIT 5`,
            [schoolId]
        );

        const [[pendingAdmissions]] = await db.query(
            'SELECT COUNT(*) as count FROM admission_requests WHERE school_id = ? AND status = "pending"',
            [schoolId]
        );

        const [[pendingLeaves]] = await db.query(
            'SELECT COUNT(*) as count FROM leaves WHERE school_id = ? AND status = "pending"',
            [schoolId]
        );

        const [[openTickets]] = await db.query(
            'SELECT COUNT(*) as count FROM support_tickets WHERE school_id = ? AND status IN ("open", "in_progress")',
            [schoolId]
        );

        const [[systemAlerts]] = await db.query(
            'SELECT COUNT(*) as count FROM system_alerts WHERE status = "active"'
        );

        const [[unreadNotifications]] = await db.query(
            'SELECT COUNT(*) as count FROM notifications WHERE school_id = ? AND read_at IS NULL',
            [schoolId]
        );

        const [recentStudents] = await db.query(
            `SELECT s.*, u.first_name as first_name, u.last_name as last_name, c.class_name AS className, c.section
            FROM students s 
            JOIN users u ON u.id = s.user_id
            LEFT JOIN classes c ON s.class_id = c.id
            WHERE s.school_id = ? AND s.deleted_at IS NULL 
            ORDER BY s.created_at DESC LIMIT 5`,
            [schoolId]
        );

        const [[todayAttendance]] = await db.query(
            `SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present,
                SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent,
                SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late
            FROM attendance 
            WHERE school_id = ? AND date = CURDATE()`,
            [schoolId]
        );

        const [[teacherAttendanceToday]] = await db.query(
            `SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present,
                SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent,
                SUM(CASE WHEN status = 'half-day' THEN 1 ELSE 0 END) as half_day,
                SUM(CASE WHEN status = 'leave' THEN 1 ELSE 0 END) as leave_count
            FROM teacher_attendance 
            WHERE school_id = ? AND date = CURDATE()`,
            [schoolId]
        );

        const [lowAttendanceClass] = await db.query(
            `SELECT c.class_name, c.section,
                ROUND(SUM(CASE WHEN a.status IN ('present', 'late') THEN 1 ELSE 0 END) * 100.0 / COUNT(*)) as rate
            FROM attendance a
            JOIN classes c ON a.class_id = c.id
            WHERE a.school_id = ? AND a.date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            GROUP BY c.id, c.class_name, c.section
            HAVING rate < 90
            ORDER BY rate ASC
            LIMIT 1`,
            [schoolId]
        );

        const [notices] = await db.query(
            `SELECT * FROM notices WHERE school_id = ? 
            ORDER BY created_at DESC LIMIT 5`,
            [schoolId]
        );

        const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const feeLabels = [];
        const feeCollectedData = [];
        const feePendingData = [];
        const now = new Date();
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const label = `${monthsShort[d.getMonth()]} ${d.getFullYear()}`;
            feeLabels.push(label);
            feeCollectedData.push(0);
            feePendingData.push(0);
        };

        const [collectedRows] = await db.query(
            `SELECT DATE_FORMAT(created_at, '%b %Y') AS monthLabel, SUM(amount) AS total
            FROM fee_payments 
            WHERE school_id = ? AND status IN ('completed', 'paid') AND created_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
            GROUP BY DATE_FORMAT(created_at, '%b %Y')`,
            [schoolId]
        );

        collectedRows.forEach(row => {
            const idx = feeLabels.indexOf(row.monthLabel);
            if (idx !== -1) {
                feeCollectedData[idx] = parseFloat(row.total || 0);
            };
        });

        const [pendingRows] = await db.query(
            `SELECT DATE_FORMAT(due_date, '%b %Y') AS monthLabel, SUM(total_amount - paid_amount) AS total
            FROM student_fees
            WHERE school_id = ? AND status IN ('pending', 'partial') AND due_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
            GROUP BY DATE_FORMAT(due_date, '%b %Y')`,
            [schoolId]
        );

        pendingRows.forEach(row => {
            const idx = feeLabels.indexOf(row.monthLabel);
            if (idx !== -1) {
                feePendingData[idx] = parseFloat(row.total || 0);
            };
        });

        const attLabels = [];
        const attData = [];
        const teacherAttLabels = [];
        const teacherAttData = [];
        const completionTrendLabels = [];
        const completionTrendData = [];

        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const label = `${d.getDate()} ${monthsShort[d.getMonth()]}`;
            attLabels.push(label);
            attData.push(0);
            teacherAttLabels.push(label);
            teacherAttData.push(0);
            completionTrendLabels.push(label);
            completionTrendData.push(0);
        };

        const [attRows] = await db.query(
            `SELECT DATE_FORMAT(date, '%e %b') AS formattedLabel,
                COUNT(*) AS total,
                SUM(CASE WHEN status IN ('present', 'late') THEN 1 ELSE 0 END) AS present
            FROM attendance
            WHERE school_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            GROUP BY date`,
            [schoolId]
        );

        attRows.forEach(row => {
            const label = row.formattedLabel.trim();
            const idx = attLabels.indexOf(label);
            if (idx !== -1 && row.total > 0) {
                attData[idx] = Math.round((row.present / row.total) * 100);
            };
        });

        const [teacherAttRows] = await db.query(
            `SELECT DATE_FORMAT(date, '%e %b') AS formattedLabel,
                COUNT(*) AS total,
                SUM(CASE WHEN status IN ('present', 'half-day') THEN 1 ELSE 0 END) AS present
            FROM teacher_attendance
            WHERE school_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            GROUP BY date`,
            [schoolId]
        ).catch(() => [[]]);

        teacherAttRows.forEach(row => {
            const label = row.formattedLabel.trim();
            const idx = teacherAttLabels.indexOf(label);
            if (idx !== -1 && row.total > 0) {
                teacherAttData[idx] = Math.round((row.present / row.total) * 100);
            };
        });

        const [completionTrendRows] = await db.query(
            `SELECT DATE_FORMAT(a.date, '%e %b') AS formattedLabel,
                COUNT(DISTINCT c.id) AS totalClasses,
                COUNT(DISTINCT a.class_id) AS markedClasses
            FROM classes c
            LEFT JOIN attendance a ON a.class_id = c.id AND a.school_id = c.school_id AND a.date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            WHERE c.school_id = ? AND a.date IS NOT NULL
            GROUP BY a.date`,
            [schoolId]
        ).catch(() => [[]]);

        completionTrendRows.forEach(row => {
            const label = row.formattedLabel ? row.formattedLabel.trim() : '';
            const idx = completionTrendLabels.indexOf(label);
            if (idx !== -1 && row.totalClasses > 0) {
                completionTrendData[idx] = Math.round((row.markedClasses / row.totalClasses) * 100);
            };
        });

        const [[admissionsStats]] = await db.query(
            `SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
                SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
            FROM admission_requests WHERE school_id = ?`,
            [schoolId]
        );

        const [admissionsTrend] = await db.query(
            `SELECT DATE_FORMAT(submitted_at, '%b %Y') as label, COUNT(*) as count
            FROM admission_requests
            WHERE school_id = ? AND submitted_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
            GROUP BY DATE_FORMAT(submitted_at, '%Y-%m'), DATE_FORMAT(submitted_at, '%b %Y')
            ORDER BY DATE_FORMAT(submitted_at, '%Y-%m')`,
            [schoolId]
        );

        const todaysBirthdays = await getTodaysBirthdays(schoolId);
        const birthdaysToday = [
            ...(todaysBirthdays.students || []),
            ...(todaysBirthdays.teachers || []),
            ...(todaysBirthdays.librarians || []),
            ...(todaysBirthdays.drivers || [])
        ];
        const [upcomingEvents] = await db.query(
            `SELECT * FROM academic_events
            WHERE school_id = ? AND start_date >= CURDATE() AND status = 'approved'
            ORDER BY start_date ASC LIMIT 5`,
            [schoolId]
        );

        const [[homeworkCount]] = await db.query(
            `SELECT COUNT(*) as count FROM homeworks WHERE school_id = ?`,
            [schoolId]
        );
        const [[homeworkSubmissionCount]] = await db.query(
            `SELECT COUNT(*) as count FROM homework_submissions hs
            JOIN homeworks h ON hs.homework_id = h.id
            WHERE h.school_id = ?`,
            [schoolId]
        );
        const [[examCount]] = await db.query(
            `SELECT COUNT(*) as count FROM exams WHERE school_id = ? AND start_date >= CURDATE()`,
            [schoolId]
        );
        const [[publishedResultsCount]] = await db.query(
            `SELECT COUNT(*) as count FROM exams WHERE school_id = ? AND is_published = 1`,
            [schoolId]
        );
        const [[overdueLibraryCount]] = await db.query(
            `SELECT COUNT(*) as count FROM library_issues WHERE school_id = ? AND status = 'overdue' AND return_date IS NULL`,
            [schoolId]
        ).catch(() => [[{ count: 0 }]]);
        const [[pendingLibraryFines]] = await db.query(
            `SELECT COALESCE(SUM(amount), 0) as total FROM library_fines WHERE school_id = ? AND status = 'pending'`,
            [schoolId]
        ).catch(() => [[{ total: 0 }]]);
        const [[upcomingPtmCount]] = await db.query(
            `SELECT COUNT(*) as count FROM ptm_slots WHERE school_id = ? AND slot_date >= CURDATE() AND status = 'open'`,
            [schoolId]
        ).catch(() => [[{ count: 0 }]]);
        const [[bookedPtmCount]] = await db.query(
            `SELECT COUNT(*) as count FROM ptm_bookings WHERE school_id = ? AND status = 'confirmed'`,
            [schoolId]
        ).catch(() => [[{ count: 0 }]]);

        const [timelinePayments] = await db.query(
            `SELECT 'fee_received' as type, fp.amount as detail, fp.created_at, CONCAT(u.first_name, ' ', u.last_name) as name 
            FROM fee_payments fp 
            JOIN students s ON fp.student_id = s.id 
            JOIN users u ON s.user_id = u.id 
            WHERE fp.school_id = ? AND fp.status IN ('completed', 'paid') ORDER BY fp.created_at DESC LIMIT 5`,
            [schoolId]
        );
        const [timelineStudents] = await db.query(
            `SELECT 'student_registered' as type, s.admission_no as detail, s.created_at, CONCAT(u.first_name, ' ', u.last_name) as name 
            FROM students s 
            JOIN users u ON s.user_id = u.id 
            WHERE s.school_id = ? AND s.deleted_at IS NULL ORDER BY s.created_at DESC LIMIT 5`,
            [schoolId]
        );
        const [timelineNotices] = await db.query(
            `SELECT 'notice_published' as type, n.title as detail, n.created_at, 'Admin' as name 
            FROM notices n WHERE n.school_id = ? ORDER BY n.created_at DESC LIMIT 5`,
            [schoolId]
        );

        const timelineEvents = [
            ...timelinePayments.map(p => ({ ...p, title: `Fee Received from ${p.name}`, text: `₹${parseFloat(p.detail).toLocaleString('en-IN')}` })),
            ...timelineStudents.map(s => ({ ...s, title: `Student Registered`, text: `${s.name} (Admn No: ${s.detail})` })),
            ...timelineNotices.map(n => ({ ...n, title: `Notice Published`, text: n.detail }))
        ]
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 6);

        const presentCount = Number(todayAttendance.present || 0);
        const absentCount = Number(todayAttendance.absent || 0);
        const lateCount = Number(todayAttendance.late || 0);
        const totalMarked = presentCount + absentCount + lateCount;
        const todayAttendancePct = totalMarked > 0 ? Math.round(((presentCount + lateCount) / totalMarked) * 100) : 0;
        const teacherPresent = Number(teacherAttendanceToday.present || 0);
        const teacherAbsent = Number(teacherAttendanceToday.absent || 0);
        const teacherHalfDay = Number(teacherAttendanceToday.half_day || 0);
        const teacherLeave = Number(teacherAttendanceToday.leave_count || 0);
        const teacherTotalMarked = teacherPresent + teacherAbsent + teacherHalfDay + teacherLeave;
        const teacherAttendancePct = teacherTotalMarked > 0 ? Math.round(((teacherPresent + (teacherHalfDay * 0.5)) / teacherTotalMarked) * 100) : 0;
        const feesCollected = parseFloat(paidFees.total || 0);
        const feesPending = parseFloat(pendingFees.total || 0);
        const feesTotal = feesCollected + feesPending;
        const feeCollectionPct = feesTotal > 0 ? Math.round((feesCollected / feesTotal) * 100) : 0;
        const attWeight = todayAttendancePct * 0.4;
        const finWeight = feeCollectionPct * 0.3;
        const queueDeductions = (pendingLeaves.count * 3) + (pendingAdmissions.count * 1.5) + (openTickets.count * 4) + (systemAlerts.count * 8);
        const operationsScore = Math.max(60, 100 - queueDeductions);
        const healthScore = Math.round(attWeight + finWeight + (operationsScore * 0.3));
        const activePlan = subscriptionState.currentPlan?.plan_key || subscriptionState.currentPlan?.name || (schoolRow ? schoolRow.plan : 'basic');
        const planLimits = subscriptionState.currentPlan || subscriptionInfo || {
            max_students: activePlan === 'premium' ? null : activePlan === 'standard' ? 500 : activePlan === 'trial' ? 50 : 200,
            max_teachers: activePlan === 'premium' ? null : activePlan === 'standard' ? 50 : activePlan === 'trial' ? 10 : 20,
            max_classes: activePlan === 'premium' ? null : activePlan === 'standard' ? 50 : activePlan === 'trial' ? 10 : 20
        };

        const buildPlanStatus = () => {
            if (subscriptionState.subscriptionLocked) {
                return {
                    label: 'Subscription Required',
                    daysLabel: 'Access Status',
                    daysValue: 'Locked',
                    labelClass: 'text-red-200',
                    daysClass: 'text-red-100'
                };
            };

            if (subscriptionState.isTrialActive) {
                return {
                    label: '7-Day Full Demo',
                    daysLabel: 'Demo Days Left',
                    daysValue: `${subscriptionState.trialDaysLeft} days`,
                    labelClass: 'text-emerald-200',
                    daysClass: 'text-yellow-200'
                };
            };

            if (subscriptionState.isSubscriptionActive) {
                const planName = subscriptionState.currentPlan?.name || schoolRow?.plan || 'Active Plan';
                return {
                    label: `${planName} Active`,
                    daysLabel: 'Plan Days Left',
                    daysValue: null,
                    labelClass: 'text-emerald-200',
                    daysClass: 'text-yellow-200'
                };
            };

            return {
                label: 'No Active Plan',
                daysLabel: 'Access Status',
                daysValue: 'Inactive',
                labelClass: 'text-slate-100',
                daysClass: 'text-slate-100'
            };
        };

        const planStatus = buildPlanStatus();
        let daysRemaining = 0;
        if (subscriptionState.isTrialActive) {
            daysRemaining = subscriptionState.trialDaysLeft;
        } else if (schoolRow && schoolRow.subscription_expiry) {
            const end = new Date(schoolRow.subscription_expiry);
            if (end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0 && end.getMilliseconds() === 0) {
                end.setHours(23, 59, 59, 999);
            };
            const now = new Date();
            daysRemaining = now > end ? 0 : Math.ceil((end - now) / (1000 * 60 * 60 * 24));
        } else {
            daysRemaining = 365;
        }
        if (!planStatus.daysValue) {
            planStatus.daysValue = `${daysRemaining} days`;
        };

        const publicPlans = await getPublicPlans();
        const subscriptionBannerMessage = subscriptionState.isTrialActive && subscriptionState.trialDaysLeft === 2
            ? REMINDER_MESSAGES.trial_2_days_left
            : subscriptionState.isTrialActive && subscriptionState.trialDaysLeft === 1
                ? REMINDER_MESSAGES.trial_1_day_left
                : subscriptionState.subscriptionLocked
                    ? REMINDER_MESSAGES.trial_expired
                    : "";

        const todayAttendanceSummary = await getSchoolTodayAttendanceSummary(schoolId);
        const renderVariables = {
            title: 'School Admin Dashboard',
            user,
            school: schoolRow || { name: 'School', subdomain: 'school', plan: 'basic', status: 'active' },
            totalStudents: studentCount.count,
            totalTeachers: teacherCount.count,
            totalClasses: classCount.count,
            totalDrivers: driverCount.count,
            driverCount: driverCount.count,
            libraryMembersCount: libraryMembersCount.count,
            activeVehiclesCount: activeVehiclesCount.count,
            boys: genderStats.boys || 0,
            girls: genderStats.girls || 0,
            healthScore,
            pendingAdmissionsCount: pendingAdmissions.count,
            pendingLeavesCount: pendingLeaves.count,
            openTicketsCount: openTickets.count,
            systemAlertsCount: systemAlerts.count,
            unreadNotificationsCount: unreadNotifications.count,
            todayFees: todayFees.total,
            feesCollected,
            feesPending,
            feesTotal,
            feeCollectionPct,
            overdueFees: overdueFees.total,
            thisMonthCollected: thisMonthFees.total,
            paidStudents: paidFees.count || 0,
            pendingStudents: pendingFees.count || 0,
            classFeeBreakdown,
            topDefaulters,
            todayAttendancePct: todayAttendanceSummary.isWorkingDay ? todayAttendanceSummary.attendancePct : 0,
            todayAttendanceSummary,
            pendingClassesCount: todayAttendanceSummary.pendingClassesCount || 0,
            pendingClassesList: todayAttendanceSummary.pendingClasses || [],
            isWorkingDay: todayAttendanceSummary.isWorkingDay,
            presentCount: todayAttendanceSummary.presentStudents || presentCount,
            absentCount: todayAttendanceSummary.absentStudents || absentCount,
            lateCount,
            leaveCount: 0,
            teacherAttendancePct,
            teacherPresent,
            teacherAbsent,
            teacherLeave,
            teacherHalfDay,
            lowAttendanceClass: lowAttendanceClass || null,
            feeLabels,
            feeCollectedData,
            feePendingData,
            attLabels,
            attData,
            teacherAttLabels,
            teacherAttData,
            completionTrendLabels,
            completionTrendData,
            admissionsStats: admissionsStats || { total: 0, pending: 0, approved: 0, rejected: 0 },
            admissionsTrend: admissionsTrend || [],
            birthdaysToday,
            todaysBirthdays,
            upcomingEvents,
            homeworkCount: homeworkCount.count,
            homeworkSubmissionCount: homeworkSubmissionCount.count,
            examCount: examCount.count,
            publishedResultsCount: publishedResultsCount.count,
            overdueLibraryCount: overdueLibraryCount?.count || 0,
            pendingLibraryFines: parseFloat(pendingLibraryFines?.total || 0),
            upcomingPtmCount: upcomingPtmCount?.count || 0,
            bookedPtmCount: bookedPtmCount?.count || 0,
            timelineEvents,
            daysRemaining,
            planStatus,
            planLimits,
            subscriptionState,
            publicPlans,
            subscriptionBannerMessage,
            notices,
            recentNotices: notices,
            recentStudents,
            currentPath: req.path
        };

        renderVariables.stats = {
            students: studentCount.count,
            teachers: teacherCount.count,
            classes: classCount.count,
            totalStudents: studentCount.count,
            totalTeachers: teacherCount.count,
            totalDrivers: driverCount.count,
            totalClasses: classCount.count,
            boys: genderStats.boys || 0,
            girls: genderStats.girls || 0,
            todayFees: todayFees.total,
            pendingFees,
            feesCollected,
            feesPaidCount: paidFees.count || 0,
            feesPending,
            feesPendingCount: pendingFees.count || 0,
            attendanceToday: todayAttendance.total || 0
        };
        res.render('schoolAdmin/dashboard', renderVariables);
    } catch (err) {
        console.error('Dashboard Error:', err);
        req.flash('error', 'Failed to load dashboard');
        res.redirect('/');
    };
};