const { queryAsync, withTransaction } = require('../config/database');
const notificationService = require('./notificationService');
const academicYearService = require('./academicYearService');

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const PERIOD_SLOT_TYPE_ALIASES = Object.freeze({
    teaching: 'teaching',
    regular: 'teaching',
    zero_period: 'teaching',
    short_break: 'short_break',
    break: 'short_break',
    lunch_break: 'lunch_break',
    lunch: 'lunch_break',
    assembly: 'assembly',
    activity: 'activity'
});

function normalizePeriodSlotType(slotType, isBreak = false) {
    const value = String(slotType || '').trim().toLowerCase();
    if (!value) return isBreak ? 'short_break' : 'teaching';
    return PERIOD_SLOT_TYPE_ALIASES[value] || null;
}

function buildTimetableGrid({ days = DAYS, periods = [], entries = [] }) {
    const grid = {};
    days.forEach((day) => {
        grid[day] = {};
        periods.forEach((period) => {
            const entry = entries.find((item) => item.day_of_week === day && Number(item.period_slot_id) === Number(period.id));
            grid[day][Number(period.id)] = entry || null;
        });
    });
    return grid;
}

const getActiveAcademicYearForSchool = academicYearService.getActiveAcademicYearForSchool;
const ensureActiveAcademicYearForSchool = academicYearService.ensureActiveAcademicYearForSchool;

async function getTermsForAcademicYear(schoolId, academicYearId) {
    return queryAsync(
        `SELECT id, school_id, academic_year_id, term_name AS name, status
        FROM academic_terms
        WHERE school_id = ? AND academic_year_id = ?
        ORDER BY term_name ASC`,
        [schoolId, academicYearId]
    );
}

async function getWorkingDays(schoolId, academicYearId) {
    const rows = await queryAsync(
        `SELECT id, school_id, academic_year_id, day_of_week, is_working_day, is_half_day, max_period_slot_id
        FROM school_working_days
        WHERE school_id = ? AND academic_year_id = ?
        ORDER BY FIELD(day_of_week, 'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')`,
        [schoolId, academicYearId]
    );
    return rows;
}

async function getPeriodSlots(schoolId, academicYearId) {
    return queryAsync(
        `SELECT id, school_id, academic_year_id, period_number, label, start_time, end_time, slot_type, is_teaching_period, sort_order, status
        FROM period_slots
        WHERE school_id = ? AND academic_year_id = ? AND COALESCE(status, 'active') = 'active'
        ORDER BY sort_order, period_number`,
        [schoolId, academicYearId]
    );
}

async function getTermTimetableVersions(schoolId, academicYearId = null, termId = null) {
    const params = [schoolId];
    let clause = '';
    if (academicYearId) {
        clause += ' AND academic_year_id = ?';
        params.push(academicYearId);
    }
    if (termId) {
        clause += ' AND term_id = ?';
        params.push(termId);
    }

    return queryAsync(
        `SELECT id, school_id, academic_year_id, term_id, version_number, status, created_by, published_by, published_at, archived_at, created_at
        FROM timetable_versions
        WHERE school_id = ?${clause}
        ORDER BY version_number DESC, id DESC`,
        params
    );
}

async function getPublishedTimetableVersion(schoolId, academicYearId = null, termId = null) {
    const params = [schoolId, 'published'];
    let clause = '';
    if (academicYearId) {
        clause += ' AND academic_year_id = ?';
        params.push(academicYearId);
    }
    if (termId) {
        clause += ' AND term_id = ?';
        params.push(termId);
    }

    const rows = await queryAsync(
        `SELECT id, school_id, academic_year_id, term_id, version_number, status, created_by, published_by, published_at, archived_at, created_at
        FROM timetable_versions
        WHERE school_id = ? AND status = ?${clause}
        ORDER BY version_number DESC, id DESC
        LIMIT 1`,
        params
    );
    return rows[0] || null;
}

async function ensureVersionForTerm({ schoolId, academicYearId, termId = null, userId = null }) {
    const versions = await getTermTimetableVersions(schoolId, academicYearId, termId);
    const draft = versions.find((version) => version.status === 'draft');
    if (draft) return draft;

    const published = versions.find((version) => version.status === 'published');
    if (published) {
        return copyPublishedVersionToDraft({ schoolId, academicYearId, termId, userId, publishedVersionId: published.id });
    }

    const nextVersion = 1;
    const result = await queryAsync(
        `INSERT INTO timetable_versions (school_id, academic_year_id, term_id, version_number, status, created_by)
        VALUES (?, ?, ?, ?, 'draft', ?)`,
        [schoolId, academicYearId, termId, nextVersion, userId]
    );
    return { id: result.insertId, version_number: nextVersion, status: 'draft' };
}

async function createDraftVersion({ schoolId, academicYearId, termId = null, userId = null }) {
    return ensureVersionForTerm({ schoolId, academicYearId, termId, userId });
}

async function copyPublishedVersionToDraft({ schoolId, academicYearId, termId = null, userId = null, publishedVersionId = null }) {
    return withTransaction(async ({ query }) => {
        let publishedVersion = null;
        if (publishedVersionId) {
            const rows = await query(
                `SELECT id, version_number FROM timetable_versions WHERE id = ? AND school_id = ? LIMIT 1`,
                [publishedVersionId, schoolId]
            );
            publishedVersion = rows[0] || null;
        } else {
            const rows = await query(
                `SELECT id, version_number FROM timetable_versions WHERE school_id = ? AND academic_year_id = ? AND term_id = ? AND status = 'published' ORDER BY version_number DESC, id DESC LIMIT 1`,
                [schoolId, academicYearId, termId]
            );
            publishedVersion = rows[0] || null;
        }

        if (!publishedVersion) {
            const nextVersion = 1;
            const result = await query(
                `INSERT INTO timetable_versions (school_id, academic_year_id, term_id, version_number, status, created_by)
                VALUES (?, ?, ?, ?, 'draft', ?)`,
                [schoolId, academicYearId, termId, nextVersion, userId]
            );
            return { id: result.insertId, version_number: nextVersion, status: 'draft' };
        }

        const nextVersion = Number(publishedVersion.version_number || 0) + 1;
        const result = await query(
            `INSERT INTO timetable_versions (school_id, academic_year_id, term_id, version_number, status, created_by)
            VALUES (?, ?, ?, ?, 'draft', ?)`,
            [schoolId, academicYearId, termId, nextVersion, userId]
        );
        const draftVersionId = result.insertId;

        // Copy all entries from the published version across all classes in the school
        await query(
            `INSERT INTO timetables (
                school_id, academic_year_id, term_id, version_id, class_id, period_slot_id, 
                day_of_week, subject_id, teacher_id, room_id, entry_type, created_by
            )
            SELECT 
                school_id, academic_year_id, term_id, ?, class_id, period_slot_id, 
                day_of_week, subject_id, teacher_id, room_id, entry_type, ?
            FROM timetables
            WHERE school_id = ? AND version_id = ?`,
            [draftVersionId, userId, schoolId, publishedVersion.id]
        );

        return { id: draftVersionId, version_number: nextVersion, status: 'draft' };
    });
}

async function publishTimetableVersion({ schoolId, versionId, userId }) {
    return withTransaction(async ({ query }) => {
        const rows = await query(
            `SELECT id, school_id, academic_year_id, term_id, version_number, status
            FROM timetable_versions
            WHERE id = ? AND school_id = ?
            LIMIT 1 FOR UPDATE`,
            [versionId, schoolId]
        );
        const version = rows[0];
        if (!version) {
            throw new Error('Selected timetable version was not found.');
        }
        if (version.status !== 'draft') {
            throw new Error('Only draft versions can be published.');
        }

        await query(
            `UPDATE timetable_versions
            SET status = 'archived', archived_at = CURRENT_TIMESTAMP
            WHERE school_id = ? AND academic_year_id = ? AND term_id = ? AND status = 'published' AND id != ?`,
            [schoolId, version.academic_year_id, version.term_id, version.id]
        );

        await query(
            `UPDATE timetable_versions
            SET status = 'published', published_by = ?, published_at = CURRENT_TIMESTAMP, archived_at = NULL
            WHERE id = ? AND school_id = ?`,
            [userId, version.id, schoolId]
        );

        await writeTimetableAuditLog({
            schoolId,
            timetableVersionId: version.id,
            action: 'timetable_published',
            changedBy: userId,
            newValues: { version_id: version.id, status: 'published' }
        }, query);

        return { success: true, versionId: version.id };
    });
}

async function archiveTimetableVersion({ schoolId, versionId, userId }) {
    await queryAsync(
        `UPDATE timetable_versions
        SET status = 'archived', archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND school_id = ?`,
        [versionId, schoolId]
    );
    await writeTimetableAuditLog({
        schoolId,
        timetableVersionId: versionId,
        action: 'timetable_archived',
        changedBy: userId,
        newValues: { status: 'archived' }
    });
    return { success: true };
}

async function getClassSubjects(schoolId, classId) {
    return queryAsync(
        `SELECT DISTINCT s.id, s.subject_name AS name, s.subject_name, s.code, s.subject_code
        FROM class_subjects cs
        JOIN subjects s ON s.id = cs.subject_id AND s.school_id = cs.school_id
        WHERE cs.school_id = ? AND cs.class_id = ? AND COALESCE(cs.status, 'active') = 'active' AND s.status = 'active'
        ORDER BY s.subject_name`,
        [schoolId, classId]
    );
}

async function getEligibleTeachers(schoolId, classId, subjectId) {
    return queryAsync(
        `SELECT DISTINCT t.id, u.first_name, u.last_name
        FROM teacher_class_assign tca
        JOIN teachers t ON t.id = tca.teacher_id AND t.school_id = tca.school_id
        JOIN users u ON u.id = t.user_id AND u.school_id = t.school_id
        WHERE tca.school_id = ? AND tca.class_id = ? AND tca.subject_id = ? AND COALESCE(tca.status, 'active') = 'active'
        ORDER BY u.first_name, u.last_name`,
        [schoolId, classId, subjectId]
    );
}

async function getAvailableRooms(schoolId, academicYearId, versionId, dayOfWeek, periodSlotId) {
    return queryAsync(
        `SELECT r.id, r.name, r.code, r.room_type
        FROM rooms r
        LEFT JOIN timetables tt ON tt.room_id = r.id AND tt.school_id = r.school_id AND tt.version_id = ? AND tt.day_of_week = ? AND tt.period_slot_id = ?
        WHERE r.school_id = ? AND r.status = 'active' AND (tt.id IS NULL OR tt.room_id IS NULL)
        ORDER BY r.name`,
        [versionId, dayOfWeek, periodSlotId, schoolId]
    );
}

async function validateClassSlotConflict({ schoolId, classId, dayOfWeek, periodSlotId, versionId, excludeTimetableId = null }) {
    const params = [schoolId, classId, dayOfWeek, periodSlotId, versionId];
    const rows = await queryAsync(
        `SELECT id FROM timetables
        WHERE school_id = ? AND class_id = ? AND day_of_week = ? AND period_slot_id = ? AND version_id = ?${excludeTimetableId ? ' AND id != ?' : ''}
        LIMIT 1`,
        excludeTimetableId ? [...params, excludeTimetableId] : params
    );
    return rows[0] || null;
}

async function validateTeacherSlotConflict({ schoolId, teacherId, dayOfWeek, periodSlotId, versionId, classId = null, excludeTimetableId = null }) {
    if (!teacherId) return null;

    const params = [schoolId, teacherId, dayOfWeek, periodSlotId, versionId, classId];
    const rows = await queryAsync(
        `SELECT t.id, c.class_name, c.section, ps.label
        FROM timetables t
        JOIN timetable_versions tv ON t.version_id = tv.id AND t.school_id = tv.school_id
        JOIN classes c ON t.class_id = c.id AND c.school_id = t.school_id
        JOIN period_slots ps ON t.period_slot_id = ps.id AND ps.school_id = t.school_id
        WHERE t.school_id = ? 
            AND t.teacher_id = ? 
            AND t.day_of_week = ? 
            AND t.period_slot_id = ? 
            AND (
                t.version_id = ? 
                OR (
                    t.class_id != ? 
                    AND tv.status = 'published'
                )
            )
            ${excludeTimetableId ? ' AND t.id != ?' : ''}
        LIMIT 1`,
        excludeTimetableId ? [...params, excludeTimetableId] : params
    );
    return rows[0] || null;
}

async function validateRoomSlotConflict({ schoolId, roomId, dayOfWeek, periodSlotId, versionId, classId = null, excludeTimetableId = null }) {
    if (!roomId) return null;

    const params = [schoolId, roomId, dayOfWeek, periodSlotId, versionId, classId];
    const rows = await queryAsync(
        `SELECT t.id, c.class_name, c.section, ps.label
        FROM timetables t
        JOIN timetable_versions tv ON t.version_id = tv.id AND t.school_id = tv.school_id
        JOIN classes c ON t.class_id = c.id AND c.school_id = t.school_id
        JOIN period_slots ps ON t.period_slot_id = ps.id AND ps.school_id = t.school_id
        WHERE t.school_id = ? 
            AND t.room_id = ? 
            AND t.day_of_week = ? 
            AND t.period_slot_id = ? 
            AND (
                t.version_id = ? 
                OR (
                    t.class_id != ? 
                    AND tv.status = 'published'
                )
            )
            ${excludeTimetableId ? ' AND t.id != ?' : ''}
        LIMIT 1`,
        excludeTimetableId ? [...params, excludeTimetableId] : params
    );
    return rows[0] || null;
}

async function validateTeacherAvailability({ schoolId, academicYearId, teacherId, dayOfWeek, periodSlotId }) {
    if (!teacherId) return { ok: true };
    const rows = await queryAsync(
        `SELECT id, is_available, reason
        FROM teacher_availability
        WHERE school_id = ? AND academic_year_id = ? AND teacher_id = ? AND day_of_week = ? AND period_slot_id = ?
        ORDER BY id DESC LIMIT 1`,
        [schoolId, academicYearId, teacherId, dayOfWeek, periodSlotId]
    );
    const availability = rows[0];
    if (!availability) return { ok: true };
    if (Number(availability.is_available) === 0) {
        return { ok: false, message: availability.reason || 'Teacher is unavailable during this period.' };
    }
    return { ok: true };
}

async function validateSubjectTeacherAssignment({ schoolId, classId, subjectId, teacherId }) {
    if (!teacherId) return { ok: true };
    const rows = await queryAsync(
        `SELECT id
        FROM teacher_class_assign
        WHERE school_id = ? AND class_id = ? AND subject_id = ? AND teacher_id = ? AND COALESCE(status, 'active') = 'active'
        LIMIT 1`,
        [schoolId, classId, subjectId, teacherId]
    );
    return rows[0] ? { ok: true } : { ok: false, message: 'Selected teacher is not assigned to this class and subject.' };
}

async function validateSubjectDailyLimit({ schoolId, classId, subjectId, academicYearId, dayOfWeek, versionId, excludeTimetableId = null }) {
    const params = [schoolId, classId, subjectId, academicYearId, dayOfWeek, versionId];
    const countRows = await queryAsync(
        `SELECT COUNT(*) AS count
        FROM timetables
        WHERE school_id = ? AND class_id = ? AND subject_id = ? AND academic_year_id = ? AND day_of_week = ? AND version_id = ?${excludeTimetableId ? ' AND id != ?' : ''}`,
        excludeTimetableId ? [...params, excludeTimetableId] : params
    );
    const currentCount = Number(countRows[0]?.count || 0);

    const limitRows = await queryAsync(
        `SELECT maximum_periods_per_day FROM class_subject_workloads
        WHERE school_id = ? AND academic_year_id = ? AND class_id = ? AND subject_id = ?
        ORDER BY id DESC LIMIT 1`,
        [schoolId, academicYearId, classId, subjectId]
    );
    if (limitRows.length > 0) {
        const maxLimit = Number(limitRows[0].maximum_periods_per_day || 0);
        if (maxLimit > 0 && currentCount >= maxLimit) {
            return { ok: false, message: `This subject has reached its daily limit of ${maxLimit} periods for this class.` };
        }
    }
    return { ok: true, count: currentCount };
}

async function validateSubjectWeeklyWorkload({ schoolId, classId, subjectId, academicYearId, termId = null }) {
    const rows = await queryAsync(
        `SELECT weekly_required_periods
        FROM class_subject_workloads
        WHERE school_id = ? AND academic_year_id = ? AND class_id = ? AND subject_id = ? AND (term_id IS NULL OR term_id = ?)
        ORDER BY id DESC LIMIT 1`,
        [schoolId, academicYearId, classId, subjectId, termId]
    );
    const requirement = Number(rows[0]?.weekly_required_periods || 0);
    return { ok: true, requirement };
}

async function validateTeacherWorkloadLimits({ schoolId, academicYearId, teacherId, dayOfWeek, versionId, excludeTimetableId = null }) {
    if (!teacherId) return { ok: true };

    const limitRows = await queryAsync(
        `SELECT maximum_periods_per_day, max_periods_per_week, max_consecutive_periods
        FROM teacher_workload_limits
        WHERE school_id = ? AND academic_year_id = ? AND teacher_id = ?
        LIMIT 1`,
        [schoolId, academicYearId, teacherId]
    );
    const dbLimits = limitRows[0] || {};
    const limits = {
        maximum_periods_per_day: dbLimits.maximum_periods_per_day ?? 8,
        max_periods_per_week: dbLimits.max_periods_per_week ?? 40,
        max_consecutive_periods: dbLimits.max_consecutive_periods ?? 4
    };

    const dailyCountRows = await queryAsync(
        `SELECT COUNT(*) AS count FROM timetables t
        JOIN timetable_versions tv ON t.version_id = tv.id AND t.school_id = tv.school_id
        WHERE t.school_id = ?
          AND t.teacher_id = ?
          AND t.academic_year_id = ?
          AND t.day_of_week = ?
          AND (t.version_id = ? OR tv.status = 'published')
          ${excludeTimetableId ? 'AND t.id != ?' : ''}`,
        excludeTimetableId
            ? [schoolId, teacherId, academicYearId, dayOfWeek, versionId, excludeTimetableId]
            : [schoolId, teacherId, academicYearId, dayOfWeek, versionId]
    );
    const dailyCount = Number(dailyCountRows[0]?.count || 0);
    if (dailyCount >= limits.maximum_periods_per_day) {
        return { ok: false, message: `Teacher has reached their configured daily limit of ${limits.maximum_periods_per_day} periods.` };
    }

    const weeklyCountRows = await queryAsync(
        `SELECT COUNT(*) AS count FROM timetables t
        JOIN timetable_versions tv ON t.version_id = tv.id AND t.school_id = tv.school_id
        WHERE t.school_id = ?
          AND t.teacher_id = ?
          AND t.academic_year_id = ?
          AND (t.version_id = ? OR tv.status = 'published')
          ${excludeTimetableId ? 'AND t.id != ?' : ''}`,
        excludeTimetableId
            ? [schoolId, teacherId, academicYearId, versionId, excludeTimetableId]
            : [schoolId, teacherId, academicYearId, versionId]
    );
    const weeklyCount = Number(weeklyCountRows[0]?.count || 0);
    if (weeklyCount >= limits.max_periods_per_week) {
        return { ok: false, message: `Teacher has reached their configured weekly limit of ${limits.max_periods_per_week} periods.` };
    }

    return { ok: true };
}

async function validateTeacherConsecutivePeriods({ schoolId, academicYearId, teacherId, dayOfWeek, periodSlotId, versionId, excludeTimetableId = null }) {
    if (!teacherId) return { ok: true };

    const limitRows = await queryAsync(
        `SELECT max_consecutive_periods
        FROM teacher_workload_limits
        WHERE school_id = ? AND academic_year_id = ? AND teacher_id = ?
        LIMIT 1`,
        [schoolId, academicYearId, teacherId]
    );
    const maxConsecutive = Number(limitRows[0]?.max_consecutive_periods || 4);

    const allSlots = await queryAsync(
        `SELECT id, is_teaching_period, sort_order FROM period_slots
        WHERE school_id = ? AND academic_year_id = ? AND COALESCE(status, 'active') = 'active'
        ORDER BY sort_order, period_number`,
        [schoolId, academicYearId]
    );

    const assignments = await queryAsync(
        `SELECT t.period_slot_id FROM timetables t
        JOIN timetable_versions tv ON t.version_id = tv.id AND t.school_id = tv.school_id
        WHERE t.school_id = ?
          AND t.teacher_id = ?
          AND t.academic_year_id = ?
          AND t.day_of_week = ?
          AND (t.version_id = ? OR tv.status = 'published')
          ${excludeTimetableId ? 'AND t.id != ?' : ''}`,
        excludeTimetableId
            ? [schoolId, teacherId, academicYearId, dayOfWeek, versionId, excludeTimetableId]
            : [schoolId, teacherId, academicYearId, dayOfWeek, versionId]
    );

    const assignedSlotIds = new Set(assignments.map(a => a.period_slot_id));
    assignedSlotIds.add(Number(periodSlotId));

    let consecutiveCount = 0;
    let maxConsecutiveObserved = 0;

    for (const slot of allSlots) {
        const isTeaching = Number(slot.is_teaching_period) === 1;
        const isAssigned = assignedSlotIds.has(slot.id);

        if (isTeaching && isAssigned) {
            consecutiveCount++;
            if (consecutiveCount > maxConsecutiveObserved) {
                maxConsecutiveObserved = consecutiveCount;
            }
        } else {
            consecutiveCount = 0;
        }
    }

    if (maxConsecutiveObserved > maxConsecutive) {
        return { ok: false, message: `This assignment would exceed the teacher's limit of ${maxConsecutive} consecutive teaching periods.` };
    }

    return { ok: true };
}

async function validateTeacherDailyWorkload({ schoolId, academicYearId, teacherId, dayOfWeek, versionId, excludeTimetableId = null }) {
    if (!teacherId) return { ok: true, count: 0 };
    const params = [schoolId, teacherId, academicYearId, dayOfWeek, versionId];
    const rows = await queryAsync(
        `SELECT COUNT(*) AS count FROM timetables t
        JOIN timetable_versions tv ON t.version_id = tv.id AND t.school_id = tv.school_id
        WHERE t.school_id = ? AND t.teacher_id = ? AND t.academic_year_id = ? AND t.day_of_week = ? AND (t.version_id = ? OR tv.status = 'published')${excludeTimetableId ? ' AND t.id != ?' : ''}`,
        excludeTimetableId ? [...params, excludeTimetableId] : params
    );
    return { ok: true, count: Number(rows[0]?.count || 0) };
}

async function validateTeacherWeeklyWorkload({ schoolId, academicYearId, teacherId, versionId }) {
    if (!teacherId) return { ok: true, count: 0 };
    const rows = await queryAsync(
        `SELECT COUNT(*) AS count FROM timetables t
        JOIN timetable_versions tv ON t.version_id = tv.id AND t.school_id = tv.school_id
        WHERE t.school_id = ? AND t.teacher_id = ? AND t.academic_year_id = ? AND (t.version_id = ? OR tv.status = 'published')`,
        [schoolId, teacherId, academicYearId, versionId]
    );
    return { ok: true, count: Number(rows[0]?.count || 0) };
}

async function saveTimetableEntry(payload) {
    return withTransaction(async ({ query }) => {
        const {
            schoolId,
            classId,
            dayOfWeek,
            periodSlotId,
            subjectId,
            teacherId = null,
            roomId = null,
            entryType = 'subject',
            academicYearId = null,
            termId = null,
            versionId = null,
            userId = null,
            existingEntryId = null
        } = payload;

        if (!classId || !dayOfWeek || !periodSlotId || !subjectId) {
            throw new Error('All required fields must be filled.');
        }

        let resolvedAcademicYearId = academicYearId;
        if (!resolvedAcademicYearId) {
            const activeYear = await getActiveAcademicYearForSchool(schoolId);
            resolvedAcademicYearId = activeYear?.id || null;
        }

        if (!resolvedAcademicYearId) {
            throw new Error('No active academic year was found for this school.');
        }

        // 1. Verify academic year belongs to school
        const yearRows = await query(
            `SELECT id, code FROM academic_years WHERE id = ? AND school_id = ? LIMIT 1`,
            [resolvedAcademicYearId, schoolId]
        );
        if (!yearRows[0]) {
            throw new Error('Selected academic year was not found.');
        }
        const academicYearCode = yearRows[0].code;

        // Verify term belongs to academic year and school
        let resolvedTermId = termId;
        if (!resolvedTermId) {
            const terms = await getTermsForAcademicYear(schoolId, resolvedAcademicYearId);
            const activeTerm = terms.find(t => t.status === 'active') || terms[0];
            resolvedTermId = activeTerm?.id || null;
        } else {
            const termRows = await query(
                `SELECT id FROM academic_terms WHERE id = ? AND school_id = ? AND academic_year_id = ? LIMIT 1`,
                [resolvedTermId, schoolId, resolvedAcademicYearId]
            );
            if (!termRows[0]) {
                throw new Error('Selected term was not found.');
            }
        }

        let resolvedVersionId = versionId;
        if (!resolvedVersionId) {
            const version = await ensureVersionForTerm({ schoolId, academicYearId: resolvedAcademicYearId, termId: resolvedTermId, userId });
            resolvedVersionId = version.id;
        }

        // Verify version belongs to school, academic year, and term
        const versionRows = await query(
            `SELECT id, status FROM timetable_versions 
            WHERE id = ? AND school_id = ? AND academic_year_id = ? AND (term_id IS NULL OR term_id = ?) LIMIT 1`,
            [resolvedVersionId, schoolId, resolvedAcademicYearId, resolvedTermId]
        );
        const version = versionRows[0];
        if (!version) {
            throw new Error('Selected timetable version was not found.');
        }

        // 2. Version status must be 'draft'
        if (version.status !== 'draft') {
            throw new Error('Published timetables cannot be edited.');
        }

        // 3. Class belongs to the current school
        const classRows = await query(
            `SELECT id FROM classes WHERE id = ? AND school_id = ? LIMIT 1`,
            [classId, schoolId]
        );
        if (!classRows[0]) {
            throw new Error('Selected class was not found.');
        }

        // 4. Period slot belongs to the same school + academic_year_id
        const periodRows = await query(
            `SELECT id, is_teaching_period, slot_type FROM period_slots 
            WHERE id = ? AND school_id = ? AND academic_year_id = ? LIMIT 1`,
            [periodSlotId, schoolId, resolvedAcademicYearId]
        );
        const period = periodRows[0];
        if (!period) {
            throw new Error('Selected period slot was not found.');
        }

        // 5. Selected day is a working day
        const workingDayRows = await query(
            `SELECT is_working_day, is_half_day, max_period_slot_id 
            FROM school_working_days 
            WHERE school_id = ? AND academic_year_id = ? AND day_of_week = ? LIMIT 1`,
            [schoolId, resolvedAcademicYearId, dayOfWeek]
        );
        if (workingDayRows[0]) {
            if (Number(workingDayRows[0].is_working_day) === 0) {
                throw new Error('Selected day is a non-working day.');
            }
            // 6. Half-day limit
            if (Number(workingDayRows[0].is_half_day) === 1 && workingDayRows[0].max_period_slot_id) {
                const maxSlotRows = await query(
                    `SELECT sort_order FROM period_slots WHERE id = ? AND school_id = ? LIMIT 1`,
                    [workingDayRows[0].max_period_slot_id, schoolId]
                );
                const currentSlotRows = await query(
                    `SELECT sort_order FROM period_slots WHERE id = ? AND school_id = ? LIMIT 1`,
                    [periodSlotId, schoolId]
                );
                if (maxSlotRows[0] && currentSlotRows[0]) {
                    if (currentSlotRows[0].sort_order > maxSlotRows[0].sort_order) {
                        throw new Error('Cannot assign entries after the maximum period slot on a half day.');
                    }
                }
            }
        }

        // 7. Subject is assigned to class
        const subjectRows = await query(
            `SELECT s.id FROM class_subjects cs 
            JOIN subjects s ON s.id = cs.subject_id AND s.school_id = cs.school_id 
            WHERE cs.school_id = ? AND cs.class_id = ? AND cs.subject_id = ? 
              AND COALESCE(cs.status, 'active') = 'active' AND s.status = 'active' LIMIT 1`,
            [schoolId, classId, subjectId]
        );
        if (!subjectRows[0]) {
            throw new Error('Selected subject is not assigned to this class.');
        }

        // 8. Teacher assignment and optional/mandatory checks
        const isTeachingSlot = period.slot_type === 'teaching';
        if (isTeachingSlot && !teacherId) {
            throw new Error('Teacher is required for teaching periods.');
        }

        if (teacherId) {
            // 10. Teacher is active
            const teacherRows = await query(
                `SELECT t.id FROM teachers t
                JOIN users u ON u.id = t.user_id AND u.school_id = t.school_id
                WHERE t.id = ? AND t.school_id = ? AND u.status = 'active' AND u.deleted_at IS NULL LIMIT 1`,
                [teacherId, schoolId]
            );
            if (!teacherRows[0]) {
                throw new Error('Selected teacher is inactive or not found.');
            }

            // 8. Validate class-subject teacher assignment
            const rows = await query(
                `SELECT id FROM teacher_class_assign
                WHERE school_id = ? AND class_id = ? AND subject_id = ? AND teacher_id = ? 
                  AND academic_year = ? AND COALESCE(status, 'active') = 'active' LIMIT 1`,
                [schoolId, classId, subjectId, teacherId, academicYearCode]
            );
            if (!rows[0]) {
                throw new Error('Please assign a teacher to this class and subject first.');
            }
        }

        // 9. Room ownership
        if (roomId) {
            const roomRows = await query(
                `SELECT id FROM rooms WHERE id = ? AND school_id = ? AND status = 'active' LIMIT 1`,
                [roomId, schoolId]
            );
            if (!roomRows[0]) {
                throw new Error('Selected room was not found.');
            }
        }

        const availability = await validateTeacherAvailability({ schoolId, academicYearId: resolvedAcademicYearId, teacherId, dayOfWeek, periodSlotId });
        if (!availability.ok) {
            throw new Error(availability.message || 'Teacher is unavailable during this period.');
        }

        const classConflict = await validateClassSlotConflict({ schoolId, classId, dayOfWeek, periodSlotId, versionId: resolvedVersionId, excludeTimetableId: existingEntryId });
        if (classConflict) {
            throw new Error('This class is already assigned during the selected period.');
        }
        const teacherConflict = await validateTeacherSlotConflict({ schoolId, teacherId, dayOfWeek, periodSlotId, versionId: resolvedVersionId, classId, excludeTimetableId: existingEntryId });
        if (teacherConflict) {
            throw new Error(`Teacher is already assigned to Class ${teacherConflict.class_name}${teacherConflict.section ? ' - ' + teacherConflict.section : ''} during period "${teacherConflict.label}".`);
        }
        const roomConflict = await validateRoomSlotConflict({ schoolId, roomId, dayOfWeek, periodSlotId, versionId: resolvedVersionId, classId, excludeTimetableId: existingEntryId });
        if (roomConflict) {
            throw new Error(`This room is already in use by Class ${roomConflict.class_name}${roomConflict.section ? ' - ' + roomConflict.section : ''} during period "${roomConflict.label}".`);
        }

        const subjectLimit = await validateSubjectDailyLimit({ schoolId, classId, subjectId, academicYearId: resolvedAcademicYearId, dayOfWeek, versionId: resolvedVersionId, excludeTimetableId: existingEntryId });
        if (!subjectLimit.ok) {
            throw new Error(subjectLimit.message);
        }

        const teacherWorkloads = await validateTeacherWorkloadLimits({ schoolId, academicYearId: resolvedAcademicYearId, teacherId, dayOfWeek, versionId: resolvedVersionId, excludeTimetableId: existingEntryId });
        if (!teacherWorkloads.ok) {
            throw new Error(teacherWorkloads.message);
        }

        const consecutiveCheck = await validateTeacherConsecutivePeriods({ schoolId, academicYearId: resolvedAcademicYearId, teacherId, dayOfWeek, periodSlotId, versionId: resolvedVersionId, excludeTimetableId: existingEntryId });
        if (!consecutiveCheck.ok) {
            throw new Error(consecutiveCheck.message);
        }

        if (existingEntryId) {
            await query(
                `UPDATE timetables
                SET academic_year_id = ?, term_id = ?, version_id = ?, room_id = ?, entry_type = ?, subject_id = ?, teacher_id = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND school_id = ?`,
                [resolvedAcademicYearId, termId, resolvedVersionId, roomId || null, entryType, subjectId, teacherId || null, userId, existingEntryId, schoolId]
            );
            await writeTimetableAuditLog({ schoolId, timetableId: existingEntryId, timetableVersionId: resolvedVersionId, action: 'timetable_entry_updated', changedBy: userId, oldValues: { existingEntryId }, newValues: { subjectId, teacherId, roomId, entryType } }, query);
            return { success: true, id: existingEntryId, versionId: resolvedVersionId };
        }

        const result = await query(
            `INSERT INTO timetables (school_id, academic_year_id, term_id, version_id, class_id, period_slot_id, day_of_week, subject_id, teacher_id, room_id, entry_type, created_by, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [schoolId, resolvedAcademicYearId, termId, resolvedVersionId, classId, periodSlotId, dayOfWeek, subjectId, teacherId || null, roomId || null, entryType, userId, userId]
        );
        await writeTimetableAuditLog({ schoolId, timetableId: result.insertId, timetableVersionId: resolvedVersionId, action: 'timetable_entry_created', changedBy: userId, newValues: { classId, dayOfWeek, periodSlotId, subjectId, teacherId, roomId, entryType } }, query);
        return { success: true, id: result.insertId, versionId: resolvedVersionId };
    });
}

async function deleteTimetableEntry({ schoolId, timetableId, userId }) {
    return withTransaction(async ({ query }) => {
        const rows = await query(
            `SELECT id, version_id FROM timetables WHERE id = ? AND school_id = ? LIMIT 1`,
            [timetableId, schoolId]
        );
        const entry = rows[0];
        if (!entry) {
            throw new Error('Timetable entry was not found.');
        }

        const versionRows = await query(
            `SELECT status FROM timetable_versions WHERE id = ? AND school_id = ? LIMIT 1`,
            [entry.version_id, schoolId]
        );
        const version = versionRows[0];
        if (!version || version.status !== 'draft') {
            throw new Error('Entries can only be deleted from draft timetables.');
        }

        await query(`DELETE FROM timetables WHERE id = ? AND school_id = ?`, [timetableId, schoolId]);
        await writeTimetableAuditLog({ schoolId, timetableId, timetableVersionId: entry.version_id, action: 'timetable_entry_deleted', changedBy: userId, oldValues: { timetableId } }, query);
        return { success: true };
    });
}

async function getTeacherTimetable(teacherId, schoolId) {
    const rows = await queryAsync(
        `SELECT t.id, t.day_of_week, t.period_slot_id, t.subject_id, t.teacher_id, t.class_id, t.room_id, t.entry_type,
            ps.label, ps.start_time, ps.end_time, ps.is_break,
            s.subject_name,
            c.class_name, c.section AS section_name, c.medium, c.academic_year,
            u.first_name AS teacher_first_name, u.last_name AS teacher_last_name
        FROM timetables t
        JOIN period_slots ps ON ps.id = t.period_slot_id AND ps.school_id = t.school_id
        LEFT JOIN subjects s ON s.id = t.subject_id AND s.school_id = t.school_id
        LEFT JOIN classes c ON c.id = t.class_id AND c.school_id = t.school_id
        LEFT JOIN teachers tchr ON tchr.id = t.teacher_id AND tchr.school_id = t.school_id
        LEFT JOIN users u ON u.id = tchr.user_id AND u.school_id = t.school_id
        WHERE t.school_id = ? AND t.teacher_id = ? AND t.version_id IN (
            SELECT id FROM timetable_versions WHERE school_id = ? AND status = 'published'
        )
        ORDER BY FIELD(t.day_of_week, 'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'), ps.sort_order, ps.period_number`,
        [schoolId, teacherId, schoolId]
    );
    return rows;
}

async function getStudentTimetable(studentId, schoolId) {
    const studentRows = await queryAsync(
        `SELECT id, class_id, school_id FROM students WHERE id = ? AND school_id = ? LIMIT 1`,
        [studentId, schoolId]
    );
    const student = studentRows[0];
    if (!student || !student.class_id) {
        return { classId: null, entries: [] };
    }

    const rows = await queryAsync(
        `SELECT t.id, t.day_of_week, t.period_slot_id, t.subject_id, t.teacher_id, t.class_id, t.room_id, t.entry_type,
            ps.label, ps.start_time, ps.end_time, ps.is_break,
            s.subject_name,
            u.first_name AS teacher_first_name, u.last_name AS teacher_last_name
        FROM timetables t
        JOIN period_slots ps ON ps.id = t.period_slot_id AND ps.school_id = t.school_id
        LEFT JOIN subjects s ON s.id = t.subject_id AND s.school_id = t.school_id
        LEFT JOIN teachers tchr ON tchr.id = t.teacher_id AND tchr.school_id = t.school_id
        LEFT JOIN users u ON u.id = tchr.user_id AND u.school_id = t.school_id
        WHERE t.school_id = ? AND t.class_id = ? AND t.version_id IN (
            SELECT id FROM timetable_versions WHERE school_id = ? AND status = 'published'
        )
        ORDER BY FIELD(t.day_of_week, 'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'), ps.sort_order, ps.period_number`,
        [schoolId, student.class_id, schoolId]
    );
    return { classId: student.class_id, entries: rows };
}

async function getStudentTimetableForDate(classId, schoolId, dateStr) {
    const date = new Date(dateStr);
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOfWeek = days[date.getDay()];

    const rows = await queryAsync(
        `SELECT t.id, t.day_of_week, t.period_slot_id, t.subject_id, t.teacher_id, t.class_id, t.room_id, t.entry_type,
            ps.label, ps.start_time, ps.end_time, ps.is_break,
            s.subject_name,
            u.first_name AS teacher_first_name, u.last_name AS teacher_last_name,
            tsub.id AS substitution_id, u_sub.first_name AS sub_first_name, u_sub.last_name AS sub_last_name
        FROM timetables t
        JOIN period_slots ps ON ps.id = t.period_slot_id AND ps.school_id = t.school_id
        LEFT JOIN subjects s ON s.id = t.subject_id AND s.school_id = t.school_id
        LEFT JOIN teachers tchr ON tchr.id = t.teacher_id AND tchr.school_id = t.school_id
        LEFT JOIN users u ON u.id = tchr.user_id AND u.school_id = t.school_id
        LEFT JOIN timetable_substitutions tsub ON tsub.timetable_id = t.id AND tsub.school_id = t.school_id AND tsub.substitution_date = ?
        LEFT JOIN teachers tchr_sub ON tchr_sub.id = tsub.substitute_teacher_id AND tchr_sub.school_id = tsub.school_id
        LEFT JOIN users u_sub ON u_sub.id = tchr_sub.user_id AND u_sub.school_id = tsub.school_id
        WHERE t.school_id = ? AND t.class_id = ? AND t.day_of_week = ?
          AND t.version_id IN (
              SELECT id FROM timetable_versions WHERE school_id = ? AND status = 'published'
          )
        ORDER BY ps.sort_order, ps.period_number`,
        [dateStr, schoolId, classId, dayOfWeek, schoolId]
    );

    const mapped = rows.map(r => {
        if (r.substitution_id) {
            return {
                ...r,
                teacher_first_name: r.sub_first_name,
                teacher_last_name: r.sub_last_name,
                is_substituted: true
            };
        }
        return r;
    });

    return mapped;
}

async function getTeacherTimetableForDate(teacherId, schoolId, dateStr) {
    const date = new Date(dateStr);
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOfWeek = days[date.getDay()];

    const regularSlots = await queryAsync(
        `SELECT t.id, t.day_of_week, t.period_slot_id, t.subject_id, t.teacher_id, t.class_id, t.room_id, t.entry_type,
            ps.label, ps.start_time, ps.end_time, ps.is_break,
            s.subject_name,
            c.class_name, c.section AS section_name
        FROM timetables t
        JOIN period_slots ps ON ps.id = t.period_slot_id AND ps.school_id = t.school_id
        LEFT JOIN subjects s ON s.id = t.subject_id AND s.school_id = t.school_id
        LEFT JOIN classes c ON c.id = t.class_id AND c.school_id = t.school_id
        WHERE t.school_id = ? AND t.teacher_id = ? AND t.day_of_week = ?
          AND t.version_id IN (
              SELECT id FROM timetable_versions WHERE school_id = ? AND status = 'published'
          )
        ORDER BY ps.sort_order, ps.period_number`,
        [schoolId, teacherId, dayOfWeek, schoolId]
    );

    const regularSubstitutedOut = await queryAsync(
        `SELECT timetable_id FROM timetable_substitutions
        WHERE school_id = ? AND original_teacher_id = ? AND substitution_date = ?`,
        [schoolId, teacherId, dateStr]
    );
    const substitutedOutSet = new Set(regularSubstitutedOut.map(r => r.timetable_id));
    const activeRegularSlots = regularSlots.filter(r => !substitutedOutSet.has(r.id));

    const substitutionSlots = await queryAsync(
        `SELECT t.id, t.day_of_week, t.period_slot_id, t.subject_id, tsub.substitute_teacher_id AS teacher_id, t.class_id, t.room_id, t.entry_type,
            ps.label, ps.start_time, ps.end_time, ps.is_break,
            s.subject_name,
            c.class_name, c.section AS section_name,
            tsub.reason AS sub_reason
        FROM timetable_substitutions tsub
        JOIN timetables t ON t.id = tsub.timetable_id AND t.school_id = tsub.school_id
        JOIN period_slots ps ON ps.id = t.period_slot_id AND ps.school_id = t.school_id
        LEFT JOIN subjects s ON s.id = t.subject_id AND s.school_id = t.school_id
        LEFT JOIN classes c ON c.id = t.class_id AND c.school_id = t.school_id
        WHERE tsub.school_id = ? AND tsub.substitute_teacher_id = ? AND tsub.substitution_date = ?
        ORDER BY ps.sort_order, ps.period_number`,
        [schoolId, teacherId, dateStr]
    );

    const combined = [...activeRegularSlots, ...substitutionSlots].sort((a, b) => {
        return a.start_time.localeCompare(b.start_time);
    });

    return combined;
}

async function getParentChildTimetable(childId, schoolId) {
    const childRows = await queryAsync(
        `SELECT id, class_id, school_id FROM students WHERE id = ? AND school_id = ? LIMIT 1`,
        [childId, schoolId]
    );
    const child = childRows[0];
    if (!child || !child.class_id) {
        return { classId: null, entries: [] };
    }

    const rows = await queryAsync(
        `SELECT t.id, t.day_of_week, t.period_slot_id, t.subject_id, t.teacher_id, t.class_id, t.room_id, t.entry_type,
            ps.label, ps.start_time, ps.end_time, ps.is_break,
            s.subject_name,
            u.first_name AS teacher_first_name, u.last_name AS teacher_last_name
        FROM timetables t
        JOIN period_slots ps ON ps.id = t.period_slot_id AND ps.school_id = t.school_id
        LEFT JOIN subjects s ON s.id = t.subject_id AND s.school_id = t.school_id
        LEFT JOIN teachers tchr ON tchr.id = t.teacher_id AND tchr.school_id = t.school_id
        LEFT JOIN users u ON u.id = tchr.user_id AND u.school_id = t.school_id
        WHERE t.school_id = ? AND t.class_id = ? AND t.version_id IN (
            SELECT id FROM timetable_versions WHERE school_id = ? AND status = 'published'
        )
        ORDER BY FIELD(t.day_of_week, 'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'), ps.sort_order, ps.period_number`,
        [schoolId, child.class_id, schoolId]
    );
    return { classId: child.class_id, entries: rows };
}

async function getAvailableSubstituteTeachers({ schoolId, teacherId, dayOfWeek, periodSlotId, date, timetableId = null }) {
    let originalTeacherId = teacherId;
    let subjectId = null;
    let academicYearId = null;

    let entry = null;
    if (timetableId) {
        const [rows] = await queryAsync(
            `SELECT class_id, subject_id, teacher_id AS original_teacher_id, day_of_week, period_slot_id, academic_year_id 
            FROM timetables WHERE id = ? AND school_id = ? LIMIT 1`,
            [timetableId, schoolId]
        );
        entry = rows[0];
    } else if (teacherId && dayOfWeek && periodSlotId) {
        const activeYear = await getActiveAcademicYearForSchool(schoolId);
        const [rows] = await queryAsync(
            `SELECT class_id, subject_id, teacher_id AS original_teacher_id, day_of_week, period_slot_id, academic_year_id 
            FROM timetables 
            WHERE school_id = ? AND teacher_id = ? AND day_of_week = ? AND period_slot_id = ? AND academic_year_id = ? LIMIT 1`,
            [schoolId, teacherId, dayOfWeek, periodSlotId, activeYear?.id || null]
        );
        entry = rows[0];
    }

    if (entry) {
        originalTeacherId = entry.original_teacher_id;
        subjectId = entry.subject_id;
        academicYearId = entry.academic_year_id;
        dayOfWeek = entry.day_of_week;
        periodSlotId = entry.period_slot_id;
    }

    if (!academicYearId) {
        const activeYear = await getActiveAcademicYearForSchool(schoolId);
        academicYearId = activeYear?.id || null;
    }

    const activeTeachers = await queryAsync(
        `SELECT t.id, u.first_name, u.last_name,
               CASE WHEN tca.id IS NOT NULL THEN 1 ELSE 0 END AS prefers_subject
        FROM teachers t
        JOIN users u ON u.id = t.user_id AND u.school_id = t.school_id
        LEFT JOIN teacher_class_assign tca ON tca.teacher_id = t.id 
          AND tca.school_id = t.school_id 
          AND tca.subject_id = ?
          AND COALESCE(tca.status, 'active') = 'active'
        WHERE t.school_id = ?
          AND t.deleted_at IS NULL
          AND u.status = 'active'
          AND u.deleted_at IS NULL
          -- Exclude original teacher
          AND t.id != ?
          -- 1. Not busy in currently published version of the timetable at that day/period
          AND NOT EXISTS (
              SELECT 1 FROM timetables tt
              JOIN timetable_versions tv ON tt.version_id = tv.id AND tt.school_id = tv.school_id
              WHERE tt.teacher_id = t.id
                AND tt.school_id = t.school_id
                AND tt.day_of_week = ?
                AND tt.period_slot_id = ?
                AND tv.status = 'published'
          )
          -- 2. Not already substituted elsewhere for that exact date + period
          AND NOT EXISTS (
              SELECT 1 FROM timetable_substitutions tsub
              JOIN timetables tt ON tsub.timetable_id = tt.id AND tsub.school_id = tt.school_id
              WHERE tsub.substitute_teacher_id = t.id
                AND tsub.school_id = t.school_id
                AND tsub.substitution_date = ?
                AND tt.period_slot_id = ?
                AND tsub.status = 'active'
          )
          -- 3. Satisfies teacher_availability (is_available = 1 or no row exists)
          AND NOT EXISTS (
              SELECT 1 FROM teacher_availability ta
              WHERE ta.teacher_id = t.id
                AND ta.school_id = t.school_id
                AND ta.day_of_week = ?
                AND ta.period_slot_id = ?
                AND ta.academic_year_id = ?
                AND ta.is_available = 0
          )
        ORDER BY prefers_subject DESC, u.first_name, u.last_name`,
        [subjectId, schoolId, originalTeacherId, dayOfWeek, periodSlotId, date, periodSlotId, dayOfWeek, periodSlotId, academicYearId]
    );

    return activeTeachers;
}

async function assignSubstituteTeacher({ schoolId, timetableId, substitutionDate, originalTeacherId, substituteTeacherId, reason, assignedBy }) {
    const result = await queryAsync(
        `INSERT INTO timetable_substitutions (school_id, timetable_id, substitution_date, original_teacher_id, substitute_teacher_id, reason, status, assigned_by)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
        [schoolId, timetableId, substitutionDate, originalTeacherId, substituteTeacherId, reason, assignedBy]
    );
    await writeTimetableAuditLog({ schoolId, timetableId, action: 'substitution_assigned', changedBy: assignedBy, newValues: { timetableId, substitutionDate, substituteTeacherId, reason } });
    return { success: true, id: result.insertId };
}

async function validateTimetableVersion(schoolId, versionId) {
    const errors = [];
    const warnings = [];
    const completedClasses = [];
    const incompleteClasses = [];
    const missingSubjectPeriods = [];
    const teacherWorkloadProblems = [];

    // Resolve version metadata
    const [versionRows] = await queryAsync(
        `SELECT id, school_id, academic_year_id, term_id, status 
        FROM timetable_versions WHERE id = ? AND school_id = ? LIMIT 1`,
        [versionId, schoolId]
    );
    const version = versionRows[0];
    if (!version) {
        throw new Error('Selected timetable version was not found.');
    }

    const academicYearId = version.academic_year_id;
    const termId = version.term_id;

    // Load active classes
    const classes = await queryAsync(
        `SELECT id, class_name, section FROM classes WHERE school_id = ? ORDER BY class_name, section`,
        [schoolId]
    );

    // Load periods
    const periods = await queryAsync(
        `SELECT id, label, period_number, is_teaching_period, slot_type, sort_order 
        FROM period_slots WHERE school_id = ? AND academic_year_id = ? AND COALESCE(status, 'active') = 'active'`,
        [schoolId, academicYearId]
    );

    // Load all entries in this draft version
    const entries = await queryAsync(
        `SELECT t.id, t.class_id, t.day_of_week, t.period_slot_id, t.subject_id, t.teacher_id, t.room_id, t.entry_type,
                c.class_name, c.section, s.subject_name,
                u.first_name AS teacher_first_name, u.last_name AS teacher_last_name,
                ps.label AS period_label, ps.sort_order AS period_sort_order, ps.slot_type AS period_slot_type
        FROM timetables t
        JOIN classes c ON c.id = t.class_id AND c.school_id = t.school_id
        LEFT JOIN subjects s ON s.id = t.subject_id AND s.school_id = t.school_id
        LEFT JOIN teachers te ON te.id = t.teacher_id AND te.school_id = t.school_id
        LEFT JOIN users u ON u.id = te.user_id AND u.school_id = te.school_id
        JOIN period_slots ps ON ps.id = t.period_slot_id AND ps.school_id = t.school_id
        WHERE t.version_id = ? AND t.school_id = ?`,
        [versionId, schoolId]
    );

    // Load working days
    const workingDays = await queryAsync(
        `SELECT day_of_week, is_working_day, is_half_day, max_period_slot_id 
        FROM school_working_days WHERE school_id = ? AND academic_year_id = ?`,
        [schoolId, academicYearId]
    );
    const workingDaysMap = {};
    workingDays.forEach(wd => {
        workingDaysMap[wd.day_of_week] = wd;
    });

    // 1. Check working days and half day boundaries
    for (const entry of entries) {
        const wd = workingDaysMap[entry.day_of_week];
        if (wd) {
            if (Number(wd.is_working_day) === 0) {
                errors.push(`Entry for Class ${entry.class_name}${entry.section ? ' - ' + entry.section : ''} on ${entry.day_of_week} is scheduled on a non-working day.`);
            } else if (Number(wd.is_half_day) === 1 && wd.max_period_slot_id) {
                const maxSlot = periods.find(p => p.id === wd.max_period_slot_id);
                if (maxSlot && entry.period_sort_order > maxSlot.sort_order) {
                    errors.push(`Entry for Class ${entry.class_name}${entry.section ? ' - ' + entry.section : ''} on ${entry.day_of_week} is scheduled past the maximum slot (${maxSlot.label}) for half-day.`);
                }
            }
        }

        // 2. Check break slots containing subjects
        if (entry.period_slot_type !== 'teaching' && entry.subject_id) {
            errors.push(`Class ${entry.class_name}${entry.section ? ' - ' + entry.section : ''} has a subject assigned to break slot "${entry.period_label}".`);
        }
    }

    // 3. Class duplicates (conflicts)
    const classDayPeriodMap = {};
    entries.forEach(entry => {
        const key = `${entry.class_id}-${entry.day_of_week}-${entry.period_slot_id}`;
        if (!classDayPeriodMap[key]) classDayPeriodMap[key] = [];
        classDayPeriodMap[key].push(entry);
    });
    Object.keys(classDayPeriodMap).forEach(key => {
        if (classDayPeriodMap[key].length > 1) {
            const first = classDayPeriodMap[key][0];
            errors.push(`Class ${first.class_name}${first.section ? ' - ' + first.section : ''} has multiple assignments on ${first.day_of_week} at ${first.period_label}.`);
        }
    });

    // 4. Teacher duplicates (conflicts)
    const teacherDayPeriodMap = {};
    entries.forEach(entry => {
        if (entry.teacher_id) {
            const key = `${entry.teacher_id}-${entry.day_of_week}-${entry.period_slot_id}`;
            if (!teacherDayPeriodMap[key]) teacherDayPeriodMap[key] = [];
            teacherDayPeriodMap[key].push(entry);
        }
    });
    Object.keys(teacherDayPeriodMap).forEach(key => {
        if (teacherDayPeriodMap[key].length > 1) {
            const first = teacherDayPeriodMap[key][0];
            errors.push(`Teacher ${first.teacher_first_name} ${first.teacher_last_name} is assigned to multiple classes on ${first.day_of_week} at ${first.period_label}.`);
        }
    });

    // 5. Room duplicates (conflicts)
    const roomDayPeriodMap = {};
    entries.forEach(entry => {
        if (entry.room_id) {
            const key = `${entry.room_id}-${entry.day_of_week}-${entry.period_slot_id}`;
            if (!roomDayPeriodMap[key]) roomDayPeriodMap[key] = [];
            roomDayPeriodMap[key].push(entry);
        }
    });
    Object.keys(roomDayPeriodMap).forEach(key => {
        if (roomDayPeriodMap[key].length > 1) {
            const first = roomDayPeriodMap[key][0];
            errors.push(`Room is double-booked on ${first.day_of_week} at ${first.period_label} across classes.`);
        }
    });

    // 6. Teacher availability
    const teacherAvailabilities = await queryAsync(
        `SELECT teacher_id, day_of_week, period_slot_id, is_available, reason 
        FROM teacher_availability 
        WHERE school_id = ? AND academic_year_id = ? AND is_available = 0`,
        [schoolId, academicYearId]
    );
    const unavailableMap = {};
    teacherAvailabilities.forEach(ta => {
        unavailableMap[`${ta.teacher_id}-${ta.day_of_week}-${ta.period_slot_id}`] = ta.reason || 'Not available';
    });
    entries.forEach(entry => {
        if (entry.teacher_id) {
            const key = `${entry.teacher_id}-${entry.day_of_week}-${entry.period_slot_id}`;
            if (unavailableMap[key]) {
                errors.push(`Teacher ${entry.teacher_first_name} ${entry.teacher_last_name} is assigned on ${entry.day_of_week} at ${entry.period_label} but is marked unavailable: ${unavailableMap[key]}.`);
            }
        }
    });

    // 7. Workload Limits validation for each teacher
    const workloadLimits = await queryAsync(
        `SELECT teacher_id, maximum_periods_per_day, max_periods_per_week, max_consecutive_periods 
        FROM teacher_workload_limits WHERE school_id = ? AND academic_year_id = ?`,
        [schoolId, academicYearId]
    );
    const limitsMap = {};
    workloadLimits.forEach(wl => {
        limitsMap[wl.teacher_id] = wl;
    });

    // Count daily and weekly entries for teachers in this draft version
    const teacherDailyCounts = {};
    const teacherWeeklyCounts = {};
    const teacherDaySlotsMap = {};

    entries.forEach(entry => {
        if (entry.teacher_id) {
            const tId = entry.teacher_id;
            const day = entry.day_of_week;

            teacherDailyCounts[`${tId}-${day}`] = (teacherDailyCounts[`${tId}-${day}`] || 0) + 1;
            teacherWeeklyCounts[tId] = (teacherWeeklyCounts[tId] || 0) + 1;

            if (entry.period_slot_type === 'teaching') {
                const key = `${tId}-${day}`;
                if (!teacherDaySlotsMap[key]) teacherDaySlotsMap[key] = [];
                teacherDaySlotsMap[key].push({ id: entry.period_slot_id, sort_order: entry.period_sort_order });
            }
        }
    });

    // Run limits checks
    const activeTeacherIds = Array.from(new Set(entries.map(e => e.teacher_id).filter(Boolean)));
    for (const tId of activeTeacherIds) {
        const wl = limitsMap[tId] || {};
        const maxDay = wl.maximum_periods_per_day ?? 8;
        const maxWeek = wl.max_periods_per_week ?? 40;
        const maxConsecutive = wl.max_consecutive_periods ?? 4;

        const firstEntry = entries.find(e => e.teacher_id === tId);
        const name = `${firstEntry.teacher_first_name} ${firstEntry.teacher_last_name}`;

        // Weekly check
        const weeklyAssigned = teacherWeeklyCounts[tId] || 0;
        if (weeklyAssigned > maxWeek) {
            const msg = `Teacher ${name} exceeds weekly limit of ${maxWeek} periods (assigned: ${weeklyAssigned}).`;
            teacherWorkloadProblems.push(msg);
            errors.push(msg);
        }

        // Daily check & Consecutive check
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        for (const day of days) {
            const dailyAssigned = teacherDailyCounts[`${tId}-${day}`] || 0;
            if (dailyAssigned > maxDay) {
                const msg = `Teacher ${name} exceeds daily limit of ${maxDay} periods on ${day} (assigned: ${dailyAssigned}).`;
                teacherWorkloadProblems.push(msg);
                errors.push(msg);
            }

            // Consecutive check
            const slots = teacherDaySlotsMap[`${tId}-${day}`] || [];
            if (slots.length > maxConsecutive) {
                slots.sort((a, b) => a.sort_order - b.sort_order);
                let consecutiveCount = 0;
                let maxConsecutiveObserved = 0;
                for (const slot of periods) {
                    const isTeaching = Number(slot.is_teaching_period) === 1;
                    const isAssigned = slots.some(s => s.id === slot.id);
                    if (isTeaching && isAssigned) {
                        consecutiveCount++;
                        if (consecutiveCount > maxConsecutiveObserved) {
                            maxConsecutiveObserved = consecutiveCount;
                        }
                    } else {
                        consecutiveCount = 0;
                    }
                }
                if (maxConsecutiveObserved > maxConsecutive) {
                    const msg = `Teacher ${name} exceeds consecutive limit of ${maxConsecutive} periods on ${day} (observed: ${maxConsecutiveObserved}).`;
                    teacherWorkloadProblems.push(msg);
                    errors.push(msg);
                }
            }
        }
    }

    // 8. Class Subject Workloads checks
    const classSubjectWorkloads = await queryAsync(
        `SELECT csw.class_id, csw.subject_id, csw.weekly_required_periods, c.class_name, c.section, s.subject_name
        FROM class_subject_workloads csw
        JOIN classes c ON c.id = csw.class_id AND c.school_id = csw.school_id
        JOIN subjects s ON s.id = csw.subject_id AND s.school_id = csw.school_id
        WHERE csw.school_id = ? AND csw.academic_year_id = ?`,
        [schoolId, academicYearId]
    );

    const actualClassSubjectCounts = {};
    entries.forEach(entry => {
        const key = `${entry.class_id}-${entry.subject_id}`;
        actualClassSubjectCounts[key] = (actualClassSubjectCounts[key] || 0) + 1;
    });

    const classCompleteness = {};
    classes.forEach(c => {
        classCompleteness[c.id] = true;
    });

    classSubjectWorkloads.forEach(csw => {
        const key = `${csw.class_id}-${csw.subject_id}`;
        const assigned = actualClassSubjectCounts[key] || 0;
        const required = Number(csw.weekly_required_periods || 0);

        if (assigned !== required) {
            classCompleteness[csw.class_id] = false;
            const diff = Math.abs(required - assigned);
            const statusType = assigned < required ? 'missing' : 'extra';
            const msg = `${csw.subject_name} required: ${required}, assigned: ${assigned}, ${statusType}: ${diff}`;
            missingSubjectPeriods.push(`Class ${csw.class_name}${csw.section ? ' - ' + csw.section : ''}: ${msg}`);
            warnings.push(`Class ${csw.class_name}${csw.section ? ' - ' + csw.section : ''}: ${msg}`);
        }
    });

    // Check completed vs incomplete classes
    classes.forEach(c => {
        const classLabel = `${c.class_name}${c.section ? ' - ' + c.section : ''}`;
        const hasEntries = entries.some(e => e.class_id === c.id);

        if (classCompleteness[c.id] && hasEntries) {
            completedClasses.push(classLabel);
        } else {
            incompleteClasses.push(classLabel);
        }
    });

    return {
        errors,
        warnings,
        completedClasses,
        incompleteClasses,
        missingSubjectPeriods,
        teacherWorkloadProblems
    };
}

async function writeTimetableAuditLog({ schoolId, timetableId = null, timetableVersionId = null, action, oldValues = null, newValues = null, changedBy = null }, queryRunner = null) {
    const runner = queryRunner || queryAsync;
    const sql = `INSERT INTO timetable_audit_logs (school_id, timetable_id, timetable_version_id, action, old_values, new_values, changed_by, changed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`;
    const params = [schoolId, timetableId, timetableVersionId, action, oldValues ? JSON.stringify(oldValues) : null, newValues ? JSON.stringify(newValues) : null, changedBy];
    if (typeof runner === 'function') {
        return runner(sql, params);
    }
    return runner.query(sql, params);
}

module.exports = {
    DAYS,
    buildTimetableGrid,
    normalizePeriodSlotType,
    getActiveAcademicYearForSchool,
    ensureActiveAcademicYearForSchool,
    getTermsForAcademicYear,
    getWorkingDays,
    getPeriodSlots,
    getTermTimetableVersions,
    getPublishedTimetableVersion,
    createDraftVersion,
    copyPublishedVersionToDraft,
    publishTimetableVersion,
    archiveTimetableVersion,
    getClassSubjects,
    getEligibleTeachers,
    getAvailableRooms,
    validateClassSlotConflict,
    validateTeacherSlotConflict,
    validateRoomSlotConflict,
    validateTeacherAvailability,
    validateSubjectTeacherAssignment,
    validateSubjectDailyLimit,
    validateSubjectWeeklyWorkload,
    validateTeacherDailyWorkload,
    validateTeacherWeeklyWorkload,
    validateTeacherConsecutivePeriods,
    saveTimetableEntry,
    deleteTimetableEntry,
    getTeacherTimetable,
    getStudentTimetable,
    getStudentTimetableForDate,
    getTeacherTimetableForDate,
    getParentChildTimetable,
    getAvailableSubstituteTeachers,
    assignSubstituteTeacher,
    writeTimetableAuditLog,
    ensureVersionForTerm,
    validateTimetableVersion
};
