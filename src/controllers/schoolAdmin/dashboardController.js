const db = require('../../config/database');
const { getSubscriptionState, getPublicPlans, REMINDER_MESSAGES } = require('../../services/subscriptionService');
const { getDaysRemaining } = require('../../utils/subscriptionPeriods');
const { getCompleteAttendanceDashboardData } = require('../../services/attendanceEngineService');
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
                COALESCE(sub.plan, s.plan) AS plan, COALESCE(sub.end_date, s.subscription_ends_at, s.subscription_end) as subscription_expiry
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

        const attendanceDashData = await getCompleteAttendanceDashboardData(schoolId);
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

        const attLabels = attendanceDashData.trends.attLabels;
        const attData = attendanceDashData.trends.attData;
        const teacherAttLabels = attendanceDashData.trends.teacherAttLabels;
        const teacherAttData = attendanceDashData.trends.teacherAttData;
        const completionTrendLabels = attendanceDashData.trends.completionTrendLabels;
        const completionTrendData = attendanceDashData.trends.completionTrendData;

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

        const presentCount = attendanceDashData.studentSummary.present;
        const absentCount = attendanceDashData.studentSummary.absent;
        const lateCount = attendanceDashData.studentSummary.late;
        const leaveCount = attendanceDashData.studentSummary.leave;
        const todayAttendancePct = attendanceDashData.studentSummary.percentage;
        const teacherPresent = attendanceDashData.teacherSummary.present;
        const teacherAbsent = attendanceDashData.teacherSummary.absent;
        const teacherHalfDay = attendanceDashData.teacherSummary.halfDay;
        const teacherLeave = attendanceDashData.teacherSummary.leave;
        const teacherAttendancePct = attendanceDashData.teacherSummary.percentage;
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
                const rawPlan = subscriptionState.currentPlan?.name || schoolRow?.plan || 'Premium';
                const formattedPlan = rawPlan.charAt(0).toUpperCase() + rawPlan.slice(1);
                const planLabel = formattedPlan.toLowerCase().includes('plan') ? formattedPlan : `${formattedPlan} Plan`;
                return {
                    label: planLabel,
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
            daysRemaining = getDaysRemaining(schoolRow.subscription_expiry);
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

        const todayAttendanceSummary = {
            isWorkingDay: attendanceDashData.completionSummary.isWorkingDay,
            statusLabel: attendanceDashData.completionSummary.statusLabel,
            totalStudents: attendanceDashData.studentSummary.total,
            presentStudents: attendanceDashData.studentSummary.present,
            absentStudents: attendanceDashData.studentSummary.absent,
            lateStudents: attendanceDashData.studentSummary.late,
            leaveStudents: attendanceDashData.studentSummary.leave,
            pendingStudents: attendanceDashData.studentSummary.pending,
            attendancePct: attendanceDashData.studentSummary.percentage,
            pendingClassesCount: attendanceDashData.completionSummary.pendingClassesCount,
            pendingClasses: attendanceDashData.completionSummary.pendingClasses,
            totalClasses: attendanceDashData.completionSummary.totalClasses,
            completedClasses: attendanceDashData.completionSummary.completedClasses,
            completionPct: attendanceDashData.completionSummary.completionPct
        };

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
            todayAttendancePct: attendanceDashData.studentSummary.percentage,
            todayAttendanceSummary,
            studentSummary: attendanceDashData.studentSummary,
            teacherSummary: attendanceDashData.teacherSummary,
            driverSummary: attendanceDashData.driverSummary,
            librarianSummary: attendanceDashData.librarianSummary,
            completionSummary: attendanceDashData.completionSummary,
            pendingClassesCount: attendanceDashData.completionSummary.pendingClassesCount || 0,
            pendingClassesList: attendanceDashData.completionSummary.pendingClasses || [],
            isWorkingDay: attendanceDashData.isWorkingDay,
            presentCount: attendanceDashData.studentSummary.present,
            absentCount: attendanceDashData.studentSummary.absent,
            lateCount: attendanceDashData.studentSummary.late,
            leaveCount: attendanceDashData.studentSummary.leave,
            halfDayCount: attendanceDashData.studentSummary.halfDay,
            pendingCount: attendanceDashData.studentSummary.pending,
            teacherAttendancePct: attendanceDashData.teacherSummary.percentage,
            teacherPresent: attendanceDashData.teacherSummary.present,
            teacherAbsent: attendanceDashData.teacherSummary.absent,
            teacherLate: attendanceDashData.teacherSummary.late,
            teacherLeave: attendanceDashData.teacherSummary.leave,
            teacherHalfDay: attendanceDashData.teacherSummary.halfDay,
            teacherPending: attendanceDashData.teacherSummary.pending,
            lowAttendanceClass: attendanceDashData.riskAlert || null,
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
            attendanceToday: attendanceDashData.studentSummary.present + attendanceDashData.studentSummary.absent + attendanceDashData.studentSummary.late
        };
        res.render('schoolAdmin/dashboard', renderVariables);
    } catch (err) {
        console.error('Dashboard Error:', err);
        req.flash('error', 'Failed to load dashboard');
        res.redirect('/');
    };
};