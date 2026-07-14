const { queryAsync, withTransaction } = require('../config/database');
const notificationService = require('./notificationService');

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

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

async function getActiveAcademicYearForSchool(schoolId) {
    const rows = await queryAsync(
        `SELECT id, school_id, code, status, is_current
        FROM academic_years
        WHERE school_id = ?
        ORDER BY is_current DESC, id DESC
        LIMIT 1`,
        [schoolId]
    );
    return rows[0] || null;
}

async function getTermsForAcademicYear(schoolId, academicYearId) {
    return queryAsync(
        `SELECT id, school_id, academic_year_id, name, status, is_current
        FROM academic_terms
        WHERE school_id = ? AND academic_year_id = ?
        ORDER BY is_current DESC, name ASC`,
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

async function getClassTimetableVersions(schoolId, classId, academicYearId = null, termId = null) {
    const params = [schoolId, classId];
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
        `SELECT id, school_id, academic_year_id, term_id, class_id, version_number, status, created_by, published_by, published_at, archived_at, created_at
        FROM timetable_versions
        WHERE school_id = ? AND class_id = ?${clause}
        ORDER BY version_number DESC, id DESC`,
        params
    );
}

async function getPublishedTimetableVersion(schoolId, classId, academicYearId = null, termId = null) {
    const params = [schoolId, classId, 'published'];
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
        `SELECT id, school_id, academic_year_id, term_id, class_id, version_number, status, created_by, published_by, published_at, archived_at, created_at
        FROM timetable_versions
        WHERE school_id = ? AND class_id = ? AND status = ?${clause}
        ORDER BY version_number DESC, id DESC
        LIMIT 1`,
        params
    );
    return rows[0] || null;
}

async function ensureVersionForClass({ schoolId, classId, academicYearId, termId = null, userId = null }) {
    const versions = await getClassTimetableVersions(schoolId, classId, academicYearId, termId);
    const draft = versions.find((version) => version.status === 'draft');
    if (draft) return draft;

    const published = versions.find((version) => version.status === 'published');
    if (published) {
        return copyPublishedVersionToDraft({ schoolId, classId, academicYearId, termId, userId, publishedVersionId: published.id });
    }

    const nextVersion = 1;
    const result = await queryAsync(
        `INSERT INTO timetable_versions (school_id, academic_year_id, term_id, class_id, version_number, status, created_by)
        VALUES (?, ?, ?, ?, ?, 'draft', ?)`,
        [schoolId, academicYearId, termId, classId, nextVersion, userId]
    );
    return { id: result.insertId, version_number: nextVersion, status: 'draft' };
}

async function createDraftVersion({ schoolId, classId, academicYearId, termId = null, userId = null }) {
    return ensureVersionForClass({ schoolId, classId, academicYearId, termId, userId });
}

async function copyPublishedVersionToDraft({ schoolId, classId, academicYearId, termId = null, userId = null, publishedVersionId = null }) {
    let publishedVersion = null;
    if (publishedVersionId) {
        const rows = await queryAsync(
            `SELECT id, version_number FROM timetable_versions WHERE id = ? AND school_id = ? LIMIT 1`,
            [publishedVersionId, schoolId]
        );
        publishedVersion = rows[0] || null;
    } else {
        const rows = await queryAsync(
            `SELECT id, version_number FROM timetable_versions WHERE school_id = ? AND class_id = ? AND status = 'published' ORDER BY version_number DESC, id DESC LIMIT 1`,
            [schoolId, classId]
        );
        publishedVersion = rows[0] || null;
    }

    if (!publishedVersion) {
        return createDraftVersion({ schoolId, classId, academicYearId, termId, userId });
    }

    const nextVersion = Number(publishedVersion.version_number || 0) + 1;
    const result = await queryAsync(
        `INSERT INTO timetable_versions (school_id, academic_year_id, term_id, class_id, version_number, status, created_by)
        VALUES (?, ?, ?, ?, ?, 'draft', ?)`,
        [schoolId, academicYearId, termId, classId, nextVersion, userId]
    );
    const draftVersionId = result.insertId;

    await queryAsync(
        `UPDATE timetables
        SET version_id = ?
        WHERE school_id = ? AND class_id = ? AND version_id = ?`,
        [draftVersionId, schoolId, classId, publishedVersion.id]
    );

    return { id: draftVersionId, version_number: nextVersion, status: 'draft' };
}

async function publishTimetableVersion({ schoolId, versionId, userId }) {
    return withTransaction(async ({ query }) => {
        const rows = await query(
            `SELECT id, school_id, academic_year_id, term_id, class_id, version_number, status
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
            WHERE school_id = ? AND class_id = ? AND status = 'published' AND id != ?`,
            [schoolId, version.class_id, version.id]
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

async function validateTeacherSlotConflict({ schoolId, teacherId, dayOfWeek, periodSlotId, versionId, excludeTimetableId = null }) {
    if (!teacherId) return null;
    const params = [schoolId, teacherId, dayOfWeek, periodSlotId, versionId];
    const rows = await queryAsync(
        `SELECT id FROM timetables
        WHERE school_id = ? AND teacher_id = ? AND day_of_week = ? AND period_slot_id = ? AND version_id = ?${excludeTimetableId ? ' AND id != ?' : ''}
        LIMIT 1`,
        excludeTimetableId ? [...params, excludeTimetableId] : params
    );
    return rows[0] || null;
}

async function validateRoomSlotConflict({ schoolId, roomId, dayOfWeek, periodSlotId, versionId, excludeTimetableId = null }) {
    if (!roomId) return null;
    const params = [schoolId, roomId, dayOfWeek, periodSlotId, versionId];
    const rows = await queryAsync(
        `SELECT id FROM timetables
        WHERE school_id = ? AND room_id = ? AND day_of_week = ? AND period_slot_id = ? AND version_id = ?${excludeTimetableId ? ' AND id != ?' : ''}
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
    const rows = await queryAsync(
        `SELECT COUNT(*) AS count
        FROM timetables
        WHERE school_id = ? AND class_id = ? AND subject_id = ? AND academic_year_id = ? AND day_of_week = ? AND version_id = ?${excludeTimetableId ? ' AND id != ?' : ''}`,
        excludeTimetableId ? [...params, excludeTimetableId] : params
    );
    const count = Number(rows[0]?.count || 0);
    return { ok: true, count };
}

async function validateSubjectWeeklyWorkload({ schoolId, classId, subjectId, academicYearId, termId = null }) {
    const rows = await queryAsync(
        `SELECT weekly_periods_required
        FROM class_subject_workloads
        WHERE school_id = ? AND academic_year_id = ? AND class_id = ? AND subject_id = ? AND (term_id IS NULL OR term_id = ?)
        ORDER BY id DESC LIMIT 1`,
        [schoolId, academicYearId, classId, subjectId, termId]
    );
    const requirement = Number(rows[0]?.weekly_periods_required || 0);
    return { ok: true, requirement };
}

async function validateTeacherDailyWorkload({ schoolId, academicYearId, teacherId, dayOfWeek, versionId, excludeTimetableId = null }) {
    if (!teacherId) return { ok: true, count: 0 };
    const params = [schoolId, teacherId, academicYearId, dayOfWeek, versionId];
    const rows = await queryAsync(
        `SELECT COUNT(*) AS count
        FROM timetables
        WHERE school_id = ? AND teacher_id = ? AND academic_year_id = ? AND day_of_week = ? AND version_id = ?${excludeTimetableId ? ' AND id != ?' : ''}`,
        excludeTimetableId ? [...params, excludeTimetableId] : params
    );
    return { ok: true, count: Number(rows[0]?.count || 0) };
}

async function validateTeacherWeeklyWorkload({ schoolId, academicYearId, teacherId, versionId }) {
    if (!teacherId) return { ok: true, count: 0 };
    const rows = await queryAsync(
        `SELECT COUNT(*) AS count
        FROM timetables
        WHERE school_id = ? AND teacher_id = ? AND academic_year_id = ? AND version_id = ?`,
        [schoolId, teacherId, academicYearId, versionId]
    );
    return { ok: true, count: Number(rows[0]?.count || 0) };
}

async function validateTeacherConsecutivePeriods({ schoolId, academicYearId, teacherId, dayOfWeek, periodSlotId, versionId }) {
    if (!teacherId) return { ok: true };
    const rows = await queryAsync(
        `SELECT id
        FROM timetables
        WHERE school_id = ? AND teacher_id = ? AND academic_year_id = ? AND day_of_week = ? AND version_id = ?
        ORDER BY period_slot_id`,
        [schoolId, teacherId, academicYearId, dayOfWeek, versionId]
    );
    return { ok: true, rows };
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

        let resolvedVersionId = versionId;
        if (!resolvedVersionId) {
            const version = await ensureVersionForClass({ schoolId, classId, academicYearId: resolvedAcademicYearId, termId, userId });
            resolvedVersionId = version.id;
        }

        const [versionRows] = await query(
            `SELECT id, status FROM timetable_versions WHERE id = ? AND school_id = ? LIMIT 1`,
            [resolvedVersionId, schoolId]
        );
        const version = versionRows[0];
        if (!version) {
            throw new Error('Selected timetable version was not found.');
        }
        if (version.status !== 'draft') {
            throw new Error('Published timetables cannot be edited.');
        }

        const classRows = await query(
            `SELECT id FROM classes WHERE id = ? AND school_id = ? LIMIT 1`,
            [classId, schoolId]
        );
        if (!classRows[0]) {
            throw new Error('Selected class was not found.');
        }

        const periodRows = await query(
            `SELECT id, is_teaching_period, slot_type FROM period_slots WHERE id = ? AND school_id = ? AND academic_year_id = ? LIMIT 1`,
            [periodSlotId, schoolId, resolvedAcademicYearId]
        );
        const period = periodRows[0];
        if (!period) {
            throw new Error('Selected period slot was not found.');
        }
        if (Number(period.is_teaching_period) === 0 || String(period.slot_type) !== 'regular') {
            throw new Error('This period is marked as a break.');
        }

        const subjectRows = await query(
            `SELECT s.id FROM class_subjects cs JOIN subjects s ON s.id = cs.subject_id AND s.school_id = cs.school_id WHERE cs.school_id = ? AND cs.class_id = ? AND cs.subject_id = ? AND COALESCE(cs.status, 'active') = 'active' AND s.status = 'active' LIMIT 1`,
            [schoolId, classId, subjectId]
        );
        if (!subjectRows[0]) {
            throw new Error('Selected subject is not assigned to this class.');
        }

        const availability = await validateTeacherAvailability({ schoolId, academicYearId: resolvedAcademicYearId, teacherId, dayOfWeek, periodSlotId });
        if (!availability.ok) {
            throw new Error(availability.message || 'Teacher is unavailable during this period.');
        }

        const teacherAssignment = await validateSubjectTeacherAssignment({ schoolId, classId, subjectId, teacherId });
        if (!teacherAssignment.ok) {
            throw new Error(teacherAssignment.message || 'Selected teacher is not assigned to this class and subject.');
        }

        const classConflict = await validateClassSlotConflict({ schoolId, classId, dayOfWeek, periodSlotId, versionId: resolvedVersionId, excludeTimetableId: existingEntryId });
        if (classConflict) {
            throw new Error('This class is already assigned during the selected period.');
        }
        const teacherConflict = await validateTeacherSlotConflict({ schoolId, teacherId, dayOfWeek, periodSlotId, versionId: resolvedVersionId, excludeTimetableId: existingEntryId });
        if (teacherConflict) {
            throw new Error('Teacher is already assigned to another class during this period.');
        }
        const roomConflict = await validateRoomSlotConflict({ schoolId, roomId, dayOfWeek, periodSlotId, versionId: resolvedVersionId, excludeTimetableId: existingEntryId });
        if (roomConflict) {
            throw new Error('This room is already in use during this period.');
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

async function getAvailableSubstituteTeachers({ schoolId, teacherId, dayOfWeek, periodSlotId, date }) {
    return queryAsync(
        `SELECT DISTINCT t.id, u.first_name, u.last_name
        FROM teachers t
        JOIN users u ON u.id = t.user_id AND u.school_id = t.school_id
        WHERE t.school_id = ? AND t.status = 'active' AND u.status = 'active' AND t.id != ?
        ORDER BY u.first_name, u.last_name`,
        [schoolId, teacherId]
    );
}

async function assignSubstituteTeacher({ schoolId, timetableId, substitutionDate, originalTeacherId, substituteTeacherId, reason, assignedBy }) {
    const result = await queryAsync(
        `INSERT INTO timetable_substitutions (school_id, timetable_id, substitution_date, original_teacher_id, substitute_teacher_id, reason, status, assigned_by)
        VALUES (?, ?, ?, ?, ?, ?, 'assigned', ?)`,
        [schoolId, timetableId, substitutionDate, originalTeacherId, substituteTeacherId, reason, assignedBy]
    );
    await writeTimetableAuditLog({ schoolId, timetableId, action: 'substitution_assigned', changedBy: assignedBy, newValues: { timetableId, substitutionDate, substituteTeacherId, reason } });
    return { success: true, id: result.insertId };
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
    getActiveAcademicYearForSchool,
    getTermsForAcademicYear,
    getWorkingDays,
    getPeriodSlots,
    getClassTimetableVersions,
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
    getParentChildTimetable,
    getAvailableSubstituteTeachers,
    assignSubstituteTeacher,
    writeTimetableAuditLog,
    ensureVersionForClass
};
