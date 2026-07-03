const db = require("../../config/database");
const crypto = require("crypto");
const jitsiConfig = require("../../config/jitsi");
const NotificationService = require("../../services/notificationService");
const { getAssignedSchoolIds } = require("../../utils/groupAdminContext");
const { canAccessSchool } = require("../../utils/schoolAccess");
const { getSubscriptionState } = require("../../services/subscriptionService");

const STATUS_ALIASES = {
    upcoming: "scheduled",
    ongoing: "live",
    ended: "completed"
};

function normalizeMeetingStatus(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return STATUS_ALIASES[normalized] || normalized;
}

function validateGroupAdminMeetingPayload({ title, scheduledAt, durationMinutes }) {
    const errors = [];
    const trimmedTitle = String(title || "").trim();
    const scheduledAtRaw = String(scheduledAt || "").trim();
    const parsedScheduledAt = scheduledAtRaw ? new Date(scheduledAtRaw) : null;
    const parsedDuration = Number.parseInt(durationMinutes, 10);

    if (!trimmedTitle) {
        errors.push("Meeting title is required.");
    }

    if (!scheduledAtRaw || !parsedScheduledAt || Number.isNaN(parsedScheduledAt.getTime())) {
        errors.push("Meeting date and time is required.");
    } else if (parsedScheduledAt.getTime() <= Date.now()) {
        errors.push("Meeting cannot be scheduled in the past.");
    }

    if (!Number.isInteger(parsedDuration)) {
        errors.push("Duration is required.");
    } else if (parsedDuration < 5 || parsedDuration > 300) {
        errors.push("Duration must be between 5 and 300 minutes.");
    }

    return {
        valid: errors.length === 0,
        errors,
        values: {
            title: trimmedTitle,
            scheduledAt: scheduledAtRaw,
            durationMinutes: parsedDuration
        }
    };
}

function flashValidationErrors(req, errors) {
    errors.forEach(error => req.flash("error", error));
}

// Standard write-guard pattern for all Group Admin write operations:
// 1. Extract schoolId from req.params / req.body / req.query (whichever applies to the route)
// 2. const hasAccess = await canAccessSchool(req.user, schoolId);
// 3. if (!hasAccess) return res.status(403).json({ success: false, message: "Access Denied: You do not have access to this branch." })
//    (for JSON/AJAX routes) or render errors/403 view (for full-page form submits) — match the existing
//    pattern used in src/utils/groupAdminContext.js's ensureGroupSchoolAccess middleware.
// 4. Only after access is confirmed, perform the INSERT/UPDATE/DELETE.

const meetingController = {
    /**
     * Lists all meetings created by the Group Admin.
     */
    listMeetings: async (req, res) => {
        try {
            const userId = req.user.id;
            const assignedIds = await getAssignedSchoolIds(userId);

            let meetings = [];
            if (assignedIds.length > 0) {
                meetings = await db.queryAsync(
                    `SELECT m.*, s.school_name, s.branch_name, 
                            (
                                SELECT GROUP_CONCAT(TRIM(CONCAT(sa.first_name, ' ', COALESCE(sa.last_name, ''))) ORDER BY sa.first_name SEPARATOR ', ')
                                FROM users sa
                                WHERE sa.school_id = s.id
                                  AND sa.role = 'school_admin'
                                  AND sa.status = 'active'
                                  AND sa.deleted_at IS NULL
                            ) as admin_name
                     FROM meetings m
                     JOIN schools s ON m.school_id = s.id
                     WHERE m.school_id IN (?) AND m.created_by = ?
                     ORDER BY m.scheduled_at DESC`,
                    [assignedIds, userId]
                );
            }

            res.render("groupAdmin/meetings/list", {
                title: "Manage Video Meetings",
                meetings,
                user: req.user,
                layout: "groupAdmin/layout",
                currentPath: "/groupadmin/meetings"
            });
        } catch (err) {
            console.error("[GroupAdmin Meetings listMeetings]", err);
            req.flash("error", "Failed to load meetings list.");
            res.redirect("/groupadmin/dashboard");
        }
    },

    /**
     * Renders the Jitsi Meeting creation page.
     */
    renderCreateForm: async (req, res) => {
        try {
            const userId = req.user.id;
            const assignedIds = await getAssignedSchoolIds(userId);

            let branches = [];
            if (assignedIds.length > 0) {
                // Task 4 Fix: LEFT JOIN users so branches with no admins still return
                branches = await db.queryAsync(
                    `SELECT s.id, s.school_name, s.branch_name, 
                            u.id AS admin_id,
                            CONCAT(u.first_name, ' ', COALESCE(u.last_name, '')) as admin_name
                     FROM schools s
                     LEFT JOIN users u ON u.school_id = s.id AND u.role = 'school_admin' AND u.status = 'active' AND u.deleted_at IS NULL
                     WHERE s.id IN (?)
                     ORDER BY s.school_name ASC, s.branch_name ASC`,
                    [assignedIds]
                );
            }

            res.render("groupAdmin/meetings/create", {
                title: "Schedule Video Meeting",
                branches,
                user: req.user,
                layout: "groupAdmin/layout",
                currentPath: "/groupadmin/meetings"
            });
        } catch (err) {
            console.error("[GroupAdmin Meetings renderCreateForm]", err);
            req.flash("error", "Failed to load creation page.");
            res.redirect("/groupadmin/meetings");
        }
    },

    /**
     * Creates a meeting and sends notification to the branch school_admin.
     */
    createMeeting: async (req, res) => {
        try {
            const userId = req.user.id;
            const { schoolAdminCombo, title, description, scheduledAt, durationMinutes } = req.body;

            // 1. Validate schoolAdminCombo
            if (!schoolAdminCombo) {
                req.flash("error", "Branch and Admin selection is required.");
                return res.redirect("/groupadmin/meetings/create");
            }

            const [schoolIdStr, adminIdStr] = schoolAdminCombo.split("_");
            const schoolId = parseInt(schoolIdStr, 10);
            const adminId = adminIdStr && adminIdStr !== "null" ? parseInt(adminIdStr, 10) : null;

            if (!schoolId) {
                req.flash("error", "Invalid branch selected.");
                return res.redirect("/groupadmin/meetings/create");
            }

            if (!adminId) {
                req.flash("error", "Cannot schedule a meeting with a branch that has no active School Admin.");
                return res.redirect("/groupadmin/meetings/create");
            }

            // 2. School access check
            const hasAccess = await canAccessSchool(req.user, schoolId);
            if (!hasAccess) {
                req.flash("error", "Access Denied: You do not have access to this branch.");
                return res.redirect("/groupadmin/meetings");
            }

            // 3. Validate target school subscription
            const subState = await getSubscriptionState(schoolId);
            if (subState.school?.status === "suspended" || subState.school?.status === "inactive" || subState.subscriptionLocked) {
                req.flash("error", "This branch's subscription has expired or is suspended.");
                return res.redirect("/groupadmin/meetings/create");
            }
            if (typeof subState.hasFeature === "function" && !subState.hasFeature("meetings")) {
                req.flash("error", "Meetings feature is not enabled for this branch's plan.");
                return res.redirect("/groupadmin/meetings/create");
            }

            // 4. Validate fields
            const validation = validateGroupAdminMeetingPayload({ title, scheduledAt, durationMinutes });
            if (!validation.valid) {
                flashValidationErrors(req, validation.errors);
                return res.redirect("/groupadmin/meetings/create");
            }
            const values = validation.values;

            // 5. Look up school admin (verify they belong to the branch and are active)
            const [adminUser] = await db.queryAsync(
                "SELECT id FROM users WHERE id = ? AND school_id = ? AND role = 'school_admin' AND status = 'active' AND deleted_at IS NULL LIMIT 1",
                [adminId, schoolId]
            );
            if (!adminUser) {
                req.flash("error", "The selected branch admin is no longer active or assigned.");
                return res.redirect("/groupadmin/meetings/create");
            }

            // 6. Insert meeting
            const randomHex = crypto.randomBytes(8).toString("hex");
            const roomName = `schoolsync-${schoolId}-${randomHex}`;

            const insertMeetingSql = `
                INSERT INTO meetings 
                (school_id, created_by, creator_role, title, description, room_name, scheduled_at, duration_minutes, target_type, status)
                VALUES (?, ?, 'group_admin', ?, ?, ?, ?, ?, 'school_admin', 'scheduled')
            `;
            const meetingResult = await db.queryAsync(insertMeetingSql, [
                schoolId,
                userId,
                values.title,
                description ? description.trim() : null,
                roomName,
                values.scheduledAt,
                values.durationMinutes
            ]);
            const meetingId = meetingResult.insertId;

            // 7. Send notification to the branch school_admin
            try {
                await NotificationService.createAndSend({
                    recipient_id: adminUser.id,
                    recipient_role: "school_admin",
                    school_id: schoolId,
                    title: "New Meeting Scheduled by Group Admin",
                    message: `Meeting "${values.title}" is scheduled at ${new Date(values.scheduledAt).toLocaleString("en-IN")}.`,
                    type: "info",
                    category: "general",
                    reference_type: "meeting",
                    reference_id: meetingId,
                    created_by: userId,
                    action_url: "/schooladmin/meetings"
                });
            } catch (notifErr) {
                console.error("Failed to send meeting creation notification:", notifErr.message);
            }

            req.flash("success", "Meeting scheduled successfully.");
            res.redirect("/groupadmin/meetings");
        } catch (err) {
            console.error("[GroupAdmin Meetings createMeeting]", err);
            req.flash("error", "Failed to schedule meeting.");
            res.redirect("/groupadmin/meetings/create");
        }
    },

    /**
     * Renders the meeting edit form.
     */
    renderEditForm: async (req, res) => {
        try {
            const meetingId = req.params.id;

            const [meeting] = await db.queryAsync(
                `SELECT m.*, s.school_name, s.branch_name,
                        (
                            SELECT GROUP_CONCAT(TRIM(CONCAT(sa.first_name, ' ', COALESCE(sa.last_name, ''))) ORDER BY sa.first_name SEPARATOR ', ')
                            FROM users sa
                            WHERE sa.school_id = s.id
                              AND sa.role = 'school_admin'
                              AND sa.status = 'active'
                              AND sa.deleted_at IS NULL
                        ) as admin_name
                 FROM meetings m
                 JOIN schools s ON m.school_id = s.id
                 WHERE m.id = ?
                 LIMIT 1`,
                [meetingId]
            );

            if (!meeting) {
                req.flash("error", "Meeting not found.");
                return res.redirect("/groupadmin/meetings");
            }

            // Verify school access + ownership (group admin only edits meetings they created)
            const hasAccess = await canAccessSchool(req.user, meeting.school_id);
            if (!hasAccess || Number(meeting.created_by) !== Number(req.user.id)) {
                req.flash("error", "Access Denied: You can only edit meetings you scheduled.");
                return res.redirect("/groupadmin/meetings");
            }

            // Only scheduled meetings can be edited
            meeting.status = normalizeMeetingStatus(meeting.status);

            if (meeting.status !== "scheduled") {
                req.flash("error", "Only scheduled meetings can be edited.");
                return res.redirect(`/groupadmin/meetings/${meetingId}`);
            }

            res.render("groupAdmin/meetings/edit", {
                title: "Edit Meeting",
                meeting,
                user: req.user,
                layout: "groupAdmin/layout",
                currentPath: "/groupadmin/meetings"
            });
        } catch (err) {
            console.error("[GroupAdmin Meetings renderEditForm]", err);
            req.flash("error", "Failed to load edit meeting page.");
            res.redirect("/groupadmin/meetings");
        }
    },

    /**
     * Updates an existing meeting.
     */
    updateMeeting: async (req, res) => {
        try {
            const meetingId = req.params.id;
            const { title, description, scheduledAt, durationMinutes } = req.body;

            const [meeting] = await db.queryAsync(
                "SELECT * FROM meetings WHERE id = ? LIMIT 1",
                [meetingId]
            );

            if (!meeting) {
                req.flash("error", "Meeting not found.");
                return res.redirect("/groupadmin/meetings");
            }

            // Verify school access + ownership
            const hasAccess = await canAccessSchool(req.user, meeting.school_id);
            if (!hasAccess || Number(meeting.created_by) !== Number(req.user.id)) {
                req.flash("error", "Access Denied: You can only edit meetings you scheduled.");
                return res.redirect("/groupadmin/meetings");
            }

            // Only scheduled meetings can be edited
            meeting.status = normalizeMeetingStatus(meeting.status);

            if (meeting.status !== "scheduled") {
                req.flash("error", "Only scheduled meetings can be edited.");
                return res.redirect(`/groupadmin/meetings/${meetingId}`);
            }

            const validation = validateGroupAdminMeetingPayload({ title, scheduledAt, durationMinutes });
            if (!validation.valid) {
                flashValidationErrors(req, validation.errors);
                return res.redirect(`/groupadmin/meetings/${meetingId}/edit`);
            }
            const values = validation.values;

            // Update meeting (branch/school_id is fixed)
            await db.queryAsync(
                `UPDATE meetings
                 SET title = ?, description = ?, scheduled_at = ?, duration_minutes = ?, updated_at = NOW()
                 WHERE id = ? AND school_id = ?`,
                [values.title, description ? description.trim() : null, values.scheduledAt, values.durationMinutes, meetingId, meeting.school_id]
            );

            // Notify branch school admin(s)
            try {
                const admins = await db.queryAsync(
                    "SELECT id FROM users WHERE school_id = ? AND role = 'school_admin' AND status = 'active' AND deleted_at IS NULL",
                    [meeting.school_id]
                );
                for (const admin of admins) {
                    await NotificationService.createAndSend({
                        recipient_id: admin.id,
                        recipient_role: "school_admin",
                        school_id: meeting.school_id,
                        title: "Meeting Updated by Group Admin",
                        message: `The meeting "${values.title}" has been updated by the Group Admin. It is now scheduled for ${new Date(values.scheduledAt).toLocaleString("en-IN")}.`,
                        type: "info",
                        category: "general",
                        reference_type: "meeting",
                        reference_id: meetingId,
                        created_by: req.user.id,
                        action_url: "/schooladmin/meetings"
                    });
                }
            } catch (notifErr) {
                console.error("Failed to send meeting update notification:", notifErr.message);
            }

            req.flash("success", "Meeting updated successfully.");
            res.redirect(`/groupadmin/meetings/${meetingId}`);
        } catch (err) {
            console.error("[GroupAdmin Meetings updateMeeting]", err);
            req.flash("error", "Failed to update meeting.");
            res.redirect(`/groupadmin/meetings/${req.params.id}/edit`);
        }
    },

    /**
     * Cancels a meeting.
     */
    cancelMeeting: async (req, res) => {
        try {
            const meetingId = req.params.id;
            const { cancel_reason } = req.body;

            const [meeting] = await db.queryAsync(
                "SELECT * FROM meetings WHERE id = ? LIMIT 1",
                [meetingId]
            );

            if (!meeting) {
                return res.status(404).json({ success: false, message: "Meeting not found." });
            }

            // Verify school access + ownership
            const hasAccess = await canAccessSchool(req.user, meeting.school_id);
            if (!hasAccess || Number(meeting.created_by) !== Number(req.user.id)) {
                return res.status(403).json({ success: false, message: "Access Denied: You can only cancel meetings you scheduled." });
            }

            meeting.status = normalizeMeetingStatus(meeting.status);

            if (meeting.status !== "scheduled") {
                return res.status(400).json({ success: false, message: "Only scheduled meetings can be cancelled." });
            }

            const reason = cancel_reason ? cancel_reason.trim() : "No reason specified";

            // Update status
            await db.queryAsync(
                `UPDATE meetings
                 SET status = 'cancelled', cancelled_by = ?, cancelled_at = NOW(), cancel_reason = ?, updated_at = NOW()
                 WHERE id = ? AND school_id = ?`,
                [req.user.id, reason, meetingId, meeting.school_id]
            );

            // Notify school admin(s)
            try {
                const admins = await db.queryAsync(
                    "SELECT id FROM users WHERE school_id = ? AND role = 'school_admin' AND status = 'active' AND deleted_at IS NULL",
                    [meeting.school_id]
                );
                for (const admin of admins) {
                    await NotificationService.createAndSend({
                        recipient_id: admin.id,
                        recipient_role: "school_admin",
                        school_id: meeting.school_id,
                        title: "Meeting Cancelled by Group Admin",
                        message: `The meeting "${meeting.title}" scheduled for ${new Date(meeting.scheduled_at).toLocaleString("en-IN")} has been cancelled. Reason: ${reason}`,
                        type: "warning",
                        category: "general",
                        reference_type: "meeting",
                        reference_id: meetingId,
                        created_by: req.user.id,
                        action_url: "/schooladmin/meetings"
                    });
                }
            } catch (notifErr) {
                console.error("Failed to send meeting cancellation notification:", notifErr.message);
            }

            res.json({ success: true, message: "Meeting cancelled successfully." });
        } catch (err) {
            console.error("[GroupAdmin Meetings cancelMeeting]", err);
            res.status(500).json({ success: false, message: "Failed to cancel meeting." });
        }
    },

    /**
     * Shows detail view of a meeting.
     */
    getMeetingDetails: async (req, res) => {
        try {
            const meetingId = req.params.id;

            const [meeting] = await db.queryAsync(
                `SELECT m.*, s.school_name, s.branch_name,
                        (
                            SELECT GROUP_CONCAT(TRIM(CONCAT(sa.first_name, ' ', COALESCE(sa.last_name, ''))) ORDER BY sa.first_name SEPARATOR ', ')
                            FROM users sa
                            WHERE sa.school_id = s.id
                              AND sa.role = 'school_admin'
                              AND sa.status = 'active'
                              AND sa.deleted_at IS NULL
                        ) as admin_name
                 FROM meetings m
                 JOIN schools s ON m.school_id = s.id
                 WHERE m.id = ?
                 LIMIT 1`,
                [meetingId]
            );

            if (!meeting) {
                req.flash("error", "Meeting not found.");
                return res.redirect("/groupadmin/meetings");
            }

            // School access check
            const hasAccess = await canAccessSchool(req.user, meeting.school_id);
            if (!hasAccess) {
                req.flash("error", "Access Denied: You do not have access to this branch.");
                return res.redirect("/groupadmin/meetings");
            }

            res.render("groupAdmin/meetings/view", {
                title: `Meeting: ${meeting.title}`,
                meeting,
                user: req.user,
                layout: "groupAdmin/layout",
                currentPath: "/groupadmin/meetings"
            });
        } catch (err) {
            console.error("[GroupAdmin Meetings getMeetingDetails]", err);
            req.flash("error", "Failed to load meeting details.");
            res.redirect("/groupadmin/meetings");
        }
    },

    /**
     * Joins the Jitsi room, logs attendance.
     */
    joinMeeting: async (req, res) => {
        try {
            const userId = req.user.id;
            const role = req.user.role;
            const meetingId = req.params.id;

            const [meeting] = await db.queryAsync(
                "SELECT * FROM meetings WHERE id = ? LIMIT 1",
                [meetingId]
            );

            if (!meeting) {
                req.flash("error", "Meeting not found.");
                return res.redirect("/groupadmin/meetings");
            }

            // School access check
            const hasAccess = await canAccessSchool(req.user, meeting.school_id);
            if (!hasAccess) {
                req.flash("error", "Access Denied: You do not have access to this branch.");
                return res.redirect("/groupadmin/meetings");
            }

            // Log or update attendance
            const activeAttendance = await db.queryAsync(
                `UPDATE meeting_attendance
                 SET role = ?, last_seen_at = NOW(),
                     duration_minutes = GREATEST(0, TIMESTAMPDIFF(MINUTE, joined_at, NOW()))
                 WHERE meeting_id = ? AND user_id = ? AND left_at IS NULL`,
                [role, meeting.id, userId]
            );

            if (!activeAttendance.affectedRows) {
                await db.queryAsync(
                    `INSERT INTO meeting_attendance (meeting_id, user_id, role, joined_at, last_seen_at, left_at, duration_minutes)
                     VALUES (?, ?, ?, NOW(), NOW(), NULL, 0)`,
                    [meeting.id, userId, role]
                );
            }

            res.render("groupAdmin/meetings/join", {
                title: `Meeting: ${meeting.title}`,
                meeting,
                jitsiDomain: jitsiConfig.domain,
                user: req.user,
                layout: false
            });
        } catch (err) {
            console.error("[GroupAdmin Meetings joinMeeting]", err);
            req.flash("error", "Failed to join meeting room.");
            res.redirect("/groupadmin/meetings");
        }
    },

    /**
     * Renders meeting attendance report.
     */
    renderAttendanceReport: async (req, res) => {
        try {
            const meetingId = req.params.id;

            const [meeting] = await db.queryAsync(
                `SELECT m.*, s.school_name, s.branch_name,
                        (
                            SELECT GROUP_CONCAT(TRIM(CONCAT(sa.first_name, ' ', COALESCE(sa.last_name, ''))) ORDER BY sa.first_name SEPARATOR ', ')
                            FROM users sa
                            WHERE sa.school_id = s.id
                              AND sa.role = 'school_admin'
                              AND sa.status = 'active'
                              AND sa.deleted_at IS NULL
                        ) as admin_name
                 FROM meetings m
                 JOIN schools s ON m.school_id = s.id
                 WHERE m.id = ?
                 LIMIT 1`,
                [meetingId]
            );

            if (!meeting) {
                req.flash("error", "Meeting not found.");
                return res.redirect("/groupadmin/meetings");
            }

            // Verify school access + ownership
            const hasAccess = await canAccessSchool(req.user, meeting.school_id);
            if (!hasAccess || Number(meeting.created_by) !== Number(req.user.id)) {
                req.flash("error", "Access Denied: You do not have access to view this meeting report.");
                return res.redirect("/groupadmin/meetings");
            }

            const attendees = await db.queryAsync(
                `SELECT ma.*, CONCAT_WS(' ', u.first_name, u.last_name) AS name, u.email 
                 FROM meeting_attendance ma 
                 JOIN users u ON ma.user_id = u.id 
                 WHERE ma.meeting_id = ? AND u.school_id = ?
                 ORDER BY ma.joined_at DESC`,
                [meetingId, meeting.school_id]
            );

            // Compute total invited (active school admins for the target branch)
            const [totalInvitedRow] = await db.queryAsync(
                "SELECT COUNT(*) as count FROM users WHERE school_id = ? AND role = 'school_admin' AND status = 'active' AND deleted_at IS NULL",
                [meeting.school_id]
            );
            const totalInvited = totalInvitedRow?.count || 0;

            // Compute stats
            const totalJoined = attendees.length;
            const attendancePercent = totalInvited > 0 ? Math.round((totalJoined / totalInvited) * 100) : 0;
            const totalDuration = attendees.reduce((acc, curr) => acc + (curr.duration_minutes || 0), 0);
            const avgDuration = totalJoined > 0 ? Math.round(totalDuration / totalJoined) : 0;

            res.render("groupAdmin/meetings/attendanceReport", {
                title: `Attendance Report: ${meeting.title}`,
                meeting,
                attendees,
                stats: {
                    totalInvited,
                    totalJoined,
                    attendancePercent,
                    avgDuration
                },
                user: req.user,
                layout: "groupAdmin/layout",
                currentPath: "/groupadmin/meetings"
            });
        } catch (err) {
            console.error("[GroupAdmin Meetings renderAttendanceReport]", err);
            req.flash("error", "Failed to load attendance report.");
            res.redirect("/groupadmin/meetings");
        }
    }
};

module.exports = meetingController;
