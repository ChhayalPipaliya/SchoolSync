const db = require('../../config/database');
const teacherPermissions = require('../../services/teacherPermissionService');
const timetableService = require('../../services/timetableService');
const { classOrderSql, formatClassLabel } = require('../../utils/academicLabels');

const getSchoolId = (req) => {
    return req.session?.user?.school_id || req.user?.school_id;
};

const VALID_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const validatePeriodPayload = async ({ schoolId, periodNumber, startTime, endTime, sortOrder, excludeId = null }) => {
    if (!startTime || !endTime) return 'Start time and end time are required.';
    if (String(endTime) <= String(startTime)) return 'End time must be greater than start time.';

    const sort = sortOrder ? parseInt(sortOrder, 10) : parseInt(periodNumber, 10);
    if (Number.isNaN(sort)) return 'Sort order must be a valid number.';

    const [overlaps] = await db.query(
        `SELECT id, label
        FROM period_slots
        WHERE school_id = ?
            AND (? < end_time AND ? > start_time)
            ${excludeId ? 'AND id != ?' : ''}
        LIMIT 1`,
        excludeId ? [schoolId, startTime, endTime, excludeId] : [schoolId, startTime, endTime]
    );
    
    if (overlaps.length > 0) return `Period overlaps with ${overlaps[0].label}.`;
    const [sortConflict] = await db.query(
        `SELECT id FROM period_slots
        WHERE school_id = ? AND sort_order = ?
        ${excludeId ? 'AND id != ?' : ''}
        LIMIT 1`,
        excludeId ? [schoolId, sort, excludeId] : [schoolId, sort]
    );
    if (sortConflict.length > 0) return 'Sort order is already used by another period slot.';
    return null;
};

async function getClassSubjects(schoolId, classId) {
    const [rows] = await db.query(
        `SELECT DISTINCT s.id, s.subject_name AS name, s.subject_name, s.code, s.subject_code
        FROM class_subjects cs
        JOIN subjects s ON s.id = cs.subject_id AND s.school_id = cs.school_id
        WHERE cs.school_id = ?
            AND cs.class_id = ?
            AND COALESCE(cs.status, 'active') = 'active'
            AND s.status = 'active'
        ORDER BY s.subject_name`,
        [schoolId, classId]
    );
    return rows;
};

async function getClassSubjectTeachers(schoolId, classId, subjectId) {
    const [rows] = await db.query(
        `SELECT DISTINCT t.id, u.first_name, u.last_name
        FROM teacher_class_assign tca
        JOIN teachers t ON t.id = tca.teacher_id AND t.school_id = tca.school_id
        JOIN users u ON u.id = t.user_id
        WHERE tca.school_id = ?
            AND tca.class_id = ?
            AND tca.subject_id = ?
            AND COALESCE(tca.status, 'active') = 'active'
            AND u.status = 'active'
            AND u.deleted_at IS NULL
        ORDER BY u.first_name, u.last_name`,
        [schoolId, classId, subjectId]
    );
    return rows;
};

exports.listPeriodSlots = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const [periods] = await db.query(
            `SELECT * FROM period_slots 
            WHERE school_id = ? 
            ORDER BY sort_order, period_number`,
            [schoolId]
        );
        res.render('schoolAdmin/timetable/periodSlots', {
            title: 'Period Slots',
            periods,
            user: req.session.user || req.user,
            currentPath: '/schooladmin/timetable/period-slots'
        });
    } catch (error) {
        console.error('List period slots error:', error);
        req.flash('error', 'Failed to load period slots');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.addPeriodSlotForm = (req, res) => {
    res.render('schoolAdmin/timetable/addPeriodSlot', {
        title: 'Add Period Slot',
        user: req.session.user || req.user,
        currentPath: '/schooladmin/timetable/period-slots'
    });
};

exports.createPeriodSlot = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { period_number, label, start_time, end_time, is_break, sort_order } = req.body;
        const periodValidation = await validatePeriodPayload({
            schoolId,
            periodNumber: period_number,
            startTime: start_time,
            endTime: end_time,
            sortOrder: sort_order
        });
        if (periodValidation) {
            req.flash('error', periodValidation);
            return res.redirect('/schooladmin/timetable/period-slots/add');
        };

        const [existing] = await db.query(
            'SELECT id FROM period_slots WHERE school_id = ? AND period_number = ?',
            [schoolId, period_number]
        );
        if (existing.length > 0) {
            req.flash('error', 'A period slot with this period number already exists.');
            return res.redirect('/schooladmin/timetable/period-slots/add');
        };

        const finalSortOrder = sort_order ? parseInt(sort_order) : parseInt(period_number);
        await db.query(
            `INSERT INTO period_slots (school_id, period_number, label, start_time, end_time, is_break, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [schoolId, period_number, label, start_time, end_time, is_break ? 1 : 0, finalSortOrder]
        );

        req.flash('success', 'Period slot created successfully');
        res.redirect('/schooladmin/timetable/period-slots');
    } catch (error) {
        console.error('Create period slot error:', error);
        req.flash('error', 'Failed to create period slot');
        res.redirect('/schooladmin/timetable/period-slots');
    };
};

exports.editPeriodSlotForm = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;
        const [periods] = await db.query(
            'SELECT * FROM period_slots WHERE id = ? AND school_id = ?',
            [id, schoolId]
        );
        if (periods.length === 0) {
            req.flash('error', 'Period slot not found');
            return res.redirect('/schooladmin/timetable/period-slots');
        };
        res.render('schoolAdmin/timetable/editPeriodSlot', {
            title: 'Edit Period Slot',
            period: periods[0],
            user: req.session.user || req.user,
            currentPath: '/schooladmin/timetable/period-slots'
        });
    } catch (error) {
        console.error('Edit period slot form error:', error);
        req.flash('error', 'Failed to load period slot');
        res.redirect('/schooladmin/timetable/period-slots');
    };
};

exports.updatePeriodSlot = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;
        const { period_number, label, start_time, end_time, is_break, sort_order } = req.body;
        const periodValidation = await validatePeriodPayload({
            schoolId,
            periodNumber: period_number,
            startTime: start_time,
            endTime: end_time,
            sortOrder: sort_order,
            excludeId: id
        });
        if (periodValidation) {
            req.flash('error', periodValidation);
            return res.redirect(`/schooladmin/timetable/period-slots/edit/${id}`);
        };

        const [existing] = await db.query(
            'SELECT id FROM period_slots WHERE school_id = ? AND period_number = ? AND id != ?',
            [schoolId, period_number, id]
        );
        if (existing.length > 0) {
            req.flash('error', 'Another period slot with this period number already exists.');
            return res.redirect(`/schooladmin/timetable/period-slots/edit/${id}`);
        };

        const finalSortOrder = sort_order ? parseInt(sort_order) : parseInt(period_number);
        await db.query(
            `UPDATE period_slots 
            SET period_number = ?, label = ?, start_time = ?, end_time = ?, is_break = ?, sort_order = ?
            WHERE id = ? AND school_id = ?`,
            [period_number, label, start_time, end_time, is_break ? 1 : 0, finalSortOrder, id, schoolId]
        );

        req.flash('success', 'Period slot updated successfully');
        res.redirect('/schooladmin/timetable/period-slots');
    } catch (error) {
        console.error('Update period slot error:', error);
        req.flash('error', 'Failed to update period slot');
        res.redirect('/schooladmin/timetable/period-slots');
    };
};

exports.deletePeriodSlot = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;
        const [used] = await db.query(
            'SELECT COUNT(*) as count FROM timetables WHERE period_slot_id = ? AND school_id = ?',
            [id, schoolId]
        );
        if (used[0].count > 0) {
            req.flash('error', 'Cannot delete: slot is used in timetable');
            return res.redirect('/schooladmin/timetable/period-slots');
        };

        await db.query(
            'DELETE FROM period_slots WHERE id = ? AND school_id = ?',
            [id, schoolId]
        );

        req.flash('success', 'Period slot deleted successfully');
        res.redirect('/schooladmin/timetable/period-slots');
    } catch (error) {
        console.error('Delete period slot error:', error);
        req.flash('error', 'Failed to delete period slot');
        res.redirect('/schooladmin/timetable/period-slots');
    };
};

exports.viewTimetable = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const classId = req.query.class_id || null;
        const versionId = req.query.version_id || null;
        const [classes] = await db.query(
            `SELECT id, class_name as name, class_name, section, medium, stream
            FROM classes
            WHERE school_id = ?
            ORDER BY ${classOrderSql('classes')}, section, medium, stream`,
            [schoolId]
        );
        classes.forEach(cls => { cls.label = formatClassLabel(cls); });

        let selectedClass = null;
        let periods = [];
        let subjects = [];
        let teachers = [];
        let timetableGrid = {};
        let academicYears = [];
        let terms = [];
        let versions = [];
        let selectedVersion = null;
        const days = timetableService.DAYS;

        const activeAcademicYear = await timetableService.getActiveAcademicYearForSchool(schoolId);
        if (activeAcademicYear) {
            academicYears = await db.query('SELECT id, code, status, is_current FROM academic_years WHERE school_id = ? ORDER BY is_current DESC, id DESC', [schoolId]);
            terms = await timetableService.getTermsForAcademicYear(schoolId, activeAcademicYear.id);
        }

        if (classId) {
            const [selectedClassList] = await db.query(
                'SELECT * FROM classes WHERE id = ? AND school_id = ?',
                [classId, schoolId]
            );
            if (selectedClassList.length > 0) {
                selectedClass = selectedClassList[0];
                selectedClass.label = formatClassLabel(selectedClass);

                const academicYearId = activeAcademicYear?.id || null;
                versions = await timetableService.getClassTimetableVersions(schoolId, classId, academicYearId);
                selectedVersion = versionId ? versions.find(v => Number(v.id) === Number(versionId)) || null : null;
                if (!selectedVersion && versions.length > 0 && !versionId) {
                    selectedVersion = versions[0];
                }

                const [periodSlots] = await db.query(
                    'SELECT * FROM period_slots WHERE school_id = ? AND COALESCE(status, "active") = "active" ORDER BY sort_order, period_number',
                    [schoolId]
                );
                periods = periodSlots;
                subjects = await timetableService.getClassSubjects(schoolId, classId);
                teachers = [];

                const queryVersionClause = selectedVersion ? ' AND t.version_id = ?' : '';
                const queryParams = [classId, schoolId];
                if (selectedVersion) queryParams.push(selectedVersion.id);

                const [timetableSlots] = await db.query(
                    `SELECT t.*, s.subject_name as subject_name, u.first_name as teacher_first_name, u.last_name as teacher_last_name
                    FROM timetables t
                    LEFT JOIN subjects s ON s.id = t.subject_id AND s.school_id = t.school_id
                    LEFT JOIN teachers tchr ON tchr.id = t.teacher_id AND tchr.school_id = t.school_id
                    LEFT JOIN users u ON u.id = tchr.user_id AND u.school_id = t.school_id
                    WHERE t.class_id = ? AND t.school_id = ?${queryVersionClause}`,
                    queryParams
                );

                timetableGrid = timetableService.buildTimetableGrid({ days, periods, entries: timetableSlots });
            };
        };

        res.render('schoolAdmin/timetable/view', {
            title: 'Timetable Management',
            classes,
            selectedClassId: classId,
            selectedClass,
            periods,
            subjects,
            teachers,
            days,
            timetableGrid,
            academicYears,
            terms,
            versions,
            selectedVersionId: selectedVersion?.id || null,
            user: req.session.user || req.user,
            currentPath: '/schooladmin/timetable'
        });
    } catch (error) {
        console.error('View timetable error:', error);
        req.flash('error', 'Failed to load timetable');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.saveTimetableEntry = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { class_id, day_of_week, period_slot_id, subject_id, teacher_id, room_id, entry_type, academic_year_id, term_id, version_id, id } = req.body;

        if (!class_id || !day_of_week || !period_slot_id || !subject_id) {
            req.flash('error', 'All required fields must be filled');
            return res.redirect(`/schooladmin/timetable?class_id=${class_id}`);
        };

        if (!VALID_DAYS.includes(day_of_week)) {
            req.flash('error', 'Invalid timetable day selected');
            return res.redirect(`/schooladmin/timetable?class_id=${class_id}`);
        };

        const result = await timetableService.saveTimetableEntry({
            schoolId,
            classId: class_id,
            dayOfWeek: day_of_week,
            periodSlotId: period_slot_id,
            subjectId: subject_id,
            teacherId: teacher_id || null,
            roomId: room_id || null,
            entryType: entry_type || 'subject',
            academicYearId: academic_year_id || null,
            termId: term_id || null,
            versionId: version_id || null,
            userId: req.session?.user?.id || req.user?.id || null,
            existingEntryId: id || null
        });

        if (result?.success) {
            req.flash('success', 'Timetable entry saved successfully');
            return res.redirect(`/schooladmin/timetable?class_id=${class_id}`);
        }

        req.flash('error', 'Failed to save timetable entry');
        return res.redirect(`/schooladmin/timetable?class_id=${class_id}`);
    } catch (error) {
        console.error('Save timetable entry error:', error);
        req.flash('error', error.message || 'Failed to save timetable entry');
        res.redirect('/schooladmin/timetable');
    };
};

exports.getClassSubjectsJson = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { classId } = req.params;
        const [[cls]] = await db.query(
            'SELECT id FROM classes WHERE id = ? AND school_id = ? LIMIT 1',
            [classId, schoolId]
        );
        if (!cls) return res.status(404).json({ success: false, message: 'Class not found' });

        const subjects = await getClassSubjects(schoolId, classId);
        return res.json({
            success: true,
            subjects,
            message: subjects.length ? '' : 'No subjects assigned to this class.'
        });
    } catch (error) {
        console.error('getClassSubjectsJson error:', error);
        return res.status(500).json({ success: false, message: 'Failed to load subjects' });
    };
};

exports.getClassSubjectTeachersJson = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { classId, subjectId } = req.params;
        const [[subjectAssignment]] = await db.query(
            `SELECT cs.id
            FROM class_subjects cs
            JOIN subjects s ON s.id = cs.subject_id AND s.school_id = cs.school_id
            WHERE cs.school_id = ? AND cs.class_id = ? AND cs.subject_id = ?
                AND COALESCE(cs.status, 'active') = 'active'
                AND s.status = 'active'\
            LIMIT 1`,
            [schoolId, classId, subjectId]
        );
        if (!subjectAssignment) {
            return res.status(404).json({ success: false, message: 'Subject is not assigned to this class' });
        };

        const teachers = await getClassSubjectTeachers(schoolId, classId, subjectId);
        return res.json({
            success: true,
            teachers,
            message: teachers.length ? '' : 'No teacher assigned for this class subject.'
        });
    } catch (error) {
        console.error('getClassSubjectTeachersJson error:', error);
        return res.status(500).json({ success: false, message: 'Failed to load teachers' });
    };
};

exports.deleteTimetableEntry = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;
        const [entry] = await db.query(
            'SELECT class_id FROM timetables WHERE id = ? AND school_id = ?',
            [id, schoolId]
        );

        if (entry.length === 0) {
            req.flash('error', 'Timetable entry not found');
            return res.redirect('/schooladmin/timetable');
        };

        const classId = entry[0].class_id;
        await timetableService.deleteTimetableEntry({ schoolId, timetableId: id, userId: req.session?.user?.id || req.user?.id || null });

        req.flash('success', 'Timetable entry deleted successfully');
        res.redirect(`/schooladmin/timetable?class_id=${classId}`);
    } catch (error) {
        console.error('Delete timetable entry error:', error);
        req.flash('error', error.message || 'Failed to delete timetable entry');
        res.redirect('/schooladmin/timetable');
    };
};

exports.createDraftVersion = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { class_id, academic_year_id, term_id } = req.body;
        const version = await timetableService.createDraftVersion({
            schoolId,
            classId: class_id,
            academicYearId: academic_year_id || null,
            termId: term_id || null,
            userId: req.session?.user?.id || req.user?.id || null
        });
        req.flash('success', `Draft version ${version.version_number || 1} created successfully`);
        return res.redirect(`/schooladmin/timetable?class_id=${class_id}`);
    } catch (error) {
        req.flash('error', error.message || 'Failed to create draft version');
        return res.redirect('/schooladmin/timetable');
    }
};

exports.publishTimetableVersion = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;
        const result = await timetableService.publishTimetableVersion({ schoolId, versionId: id, userId: req.session?.user?.id || req.user?.id || null });
        if (result?.success) {
            req.flash('success', 'Timetable version published successfully');
        }
        return res.redirect('/schooladmin/timetable');
    } catch (error) {
        req.flash('error', error.message || 'Failed to publish timetable version');
        return res.redirect('/schooladmin/timetable');
    }
};

exports.getManagementPage = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const [classes] = await db.query('SELECT id, class_name, section FROM classes WHERE school_id = ? ORDER BY class_name, section', [schoolId]);
        const [periods] = await db.query('SELECT id, label, period_number, start_time, end_time, slot_type, status FROM period_slots WHERE school_id = ? ORDER BY sort_order, period_number', [schoolId]);
        const [rooms] = await db.query('SELECT id, name, room_type, status FROM rooms WHERE school_id = ? ORDER BY name', [schoolId]);
        const [workingDays] = await db.query('SELECT day_of_week, is_working_day FROM school_working_days WHERE school_id = ? ORDER BY FIELD(day_of_week, "Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday")', [schoolId]);
        res.render('schoolAdmin/timetable/management', {
            title: 'Timetable Management',
            classes,
            periods,
            rooms,
            workingDays,
            user: req.session.user || req.user,
            currentPath: '/schooladmin/timetable'
        });
    } catch (error) {
        req.flash('error', 'Unable to load timetable management');
        return res.redirect('/schooladmin/timetable');
    }
};

exports.saveWorkingDays = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const academicYear = await timetableService.getActiveAcademicYearForSchool(schoolId);
        const days = timetableService.DAYS;
        await Promise.all(days.map(async (day) => {
            const isWorking = Boolean(req.body[day] || req.body[`working_${day}`]);
            await db.query(
                `INSERT INTO school_working_days (school_id, academic_year_id, day_of_week, is_working_day, is_half_day)
                VALUES (?, ?, ?, ?, 0)
                ON DUPLICATE KEY UPDATE is_working_day = VALUES(is_working_day), is_half_day = VALUES(is_half_day)`,
                [schoolId, academicYear?.id, day, isWorking ? 1 : 0]
            );
        }));
        req.flash('success', 'Working days updated');
    } catch (error) {
        req.flash('error', error.message || 'Unable to save working days');
    }
    return res.redirect('/schooladmin/timetable/working-days');
};

exports.saveWorkload = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const academicYear = await timetableService.getActiveAcademicYearForSchool(schoolId);
        const { class_id, subject_id, weekly_periods_required, max_periods_per_day } = req.body;
        await db.query(
            `INSERT INTO class_subject_workloads (school_id, academic_year_id, class_id, subject_id, weekly_periods_required, max_periods_per_day)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE weekly_periods_required = VALUES(weekly_periods_required), max_periods_per_day = VALUES(max_periods_per_day)`,
            [schoolId, academicYear?.id, class_id, subject_id, weekly_periods_required, max_periods_per_day]
        );
        req.flash('success', 'Workload settings saved');
    } catch (error) {
        req.flash('error', error.message || 'Unable to save workload');
    }
    return res.redirect('/schooladmin/timetable/workload');
};

exports.saveTeacherAvailability = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const academicYear = await timetableService.getActiveAcademicYearForSchool(schoolId);
        const { teacher_id, day_of_week, period_slot_id, is_available, reason } = req.body;
        await db.query(
            `INSERT INTO teacher_availability (school_id, academic_year_id, teacher_id, day_of_week, period_slot_id, is_available, reason, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE is_available = VALUES(is_available), reason = VALUES(reason)`,
            [schoolId, academicYear?.id, teacher_id, day_of_week, period_slot_id, is_available ? 1 : 0, reason || null, req.session?.user?.id || req.user?.id || null]
        );
        req.flash('success', 'Teacher availability saved');
    } catch (error) {
        req.flash('error', error.message || 'Unable to save availability');
    }
    return res.redirect('/schooladmin/timetable/teacher-availability');
};

exports.saveRoom = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { name, code, room_type, capacity, status } = req.body;
        await db.query(
            `INSERT INTO rooms (school_id, name, code, room_type, capacity, status)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE code = VALUES(code), room_type = VALUES(room_type), capacity = VALUES(capacity), status = VALUES(status)`,
            [schoolId, name, code || null, room_type || 'classroom', capacity || null, status || 'active']
        );
        req.flash('success', 'Room saved');
    } catch (error) {
        req.flash('error', error.message || 'Unable to save room');
    }
    return res.redirect('/schooladmin/timetable/rooms');
};
