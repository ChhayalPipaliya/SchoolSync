const db = require('../../config/database');
const teacherPermissions = require('../../services/teacherPermissionService');
const timetableService = require('../../services/timetableService');
const { classOrderSql, formatClassLabel } = require('../../utils/academicLabels');

const getSchoolId = (req) => {
    return req.session?.user?.school_id || req.user?.school_id;
};

const VALID_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const validatePeriodPayload = async ({ schoolId, academicYearId, periodNumber, startTime, endTime, sortOrder, excludeId = null }) => {
    if (!startTime || !endTime) return 'Start time and end time are required.';
    if (String(endTime) <= String(startTime)) return 'End time must be greater than start time.';

    const sort = sortOrder ? parseInt(sortOrder, 10) : parseInt(periodNumber, 10);
    if (Number.isNaN(sort)) return 'Sort order must be a valid number.';

    const [overlaps] = await db.query(
        `SELECT id, label
        FROM period_slots
        WHERE school_id = ?
            AND academic_year_id = ?
            AND (? < end_time AND ? > start_time)
            ${excludeId ? 'AND id != ?' : ''}
        LIMIT 1`,
        excludeId ? [schoolId, academicYearId, startTime, endTime, excludeId] : [schoolId, academicYearId, startTime, endTime]
    );

    if (overlaps.length > 0) return `Period overlaps with ${overlaps[0].label}.`;
    const [sortConflict] = await db.query(
        `SELECT id FROM period_slots
        WHERE school_id = ? AND academic_year_id = ? AND sort_order = ?
        ${excludeId ? 'AND id != ?' : ''}
        LIMIT 1`,
        excludeId ? [schoolId, academicYearId, sort, excludeId] : [schoolId, academicYearId, sort]
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
    const activeYear = await timetableService.ensureActiveAcademicYearForSchool(schoolId);
    const resolvedAcademicYearCode = activeYear?.code || '';
    const [rows] = await db.query(
        `SELECT DISTINCT t.id, u.first_name, u.last_name
        FROM teacher_class_assign tca
        JOIN teachers t ON t.id = tca.teacher_id AND t.school_id = tca.school_id
        JOIN users u ON u.id = t.user_id
        WHERE tca.school_id = ?
            AND tca.class_id = ?
            AND tca.subject_id = ?
            AND tca.academic_year = ?
            AND COALESCE(tca.status, 'active') = 'active'
            AND u.status = 'active'
            AND u.deleted_at IS NULL
        ORDER BY u.first_name, u.last_name`,
        [schoolId, classId, subjectId, resolvedAcademicYearCode]
    );
    return rows;
};

exports.listPeriodSlots = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const activeYear = await timetableService.ensureActiveAcademicYearForSchool(schoolId);
        if (!activeYear) {
            req.flash('error', 'Please configure an active academic year first.');
            return res.redirect('/schooladmin/dashboard');
        }

        const [periods] = await db.query(
            `SELECT * FROM period_slots 
            WHERE school_id = ? AND academic_year_id = ?
            ORDER BY sort_order, period_number`,
            [schoolId, activeYear.id]
        );
        res.render('schoolAdmin/timetable/periodSlots', {
            title: 'Period Slots',
            periods,
            activeYear,
            user: req.session.user || req.user,
            currentPath: '/schooladmin/timetable/period-slots'
        });
    } catch (error) {
        console.error('List period slots error:', error);
        req.flash('error', 'Failed to load period slots');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.addPeriodSlotForm = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const activeYear = await timetableService.ensureActiveAcademicYearForSchool(schoolId);
        if (!activeYear) {
            req.flash('error', 'No active academic year configured.');
            return res.redirect('/schooladmin/timetable/period-slots');
        }
        res.render('schoolAdmin/timetable/addPeriodSlot', {
            title: 'Add Period Slot',
            activeYear,
            user: req.session.user || req.user,
            currentPath: '/schooladmin/timetable/period-slots'
        });
    } catch (error) {
        console.error('Add period slot form error:', error);
        req.flash('error', 'Failed to load form');
        res.redirect('/schooladmin/timetable/period-slots');
    }
};

exports.createPeriodSlot = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { period_number, label, start_time, end_time, is_break, sort_order, slot_type } = req.body;

        const activeYear = await timetableService.ensureActiveAcademicYearForSchool(schoolId);
        if (!activeYear) {
            req.flash('error', 'No active academic year configured.');
            return res.redirect('/schooladmin/timetable/period-slots');
        }

        const finalSlotType = timetableService.normalizePeriodSlotType(slot_type, Boolean(is_break));
        if (!finalSlotType) {
            req.flash('error', 'Invalid period slot type.');
            return res.redirect('/schooladmin/timetable/period-slots/add');
        }
        const isTeachingPeriod = finalSlotType === 'teaching' ? 1 : 0;
        const isBreakPeriod = ['short_break', 'lunch_break'].includes(finalSlotType) ? 1 : 0;

        const periodValidation = await validatePeriodPayload({
            schoolId,
            academicYearId: activeYear.id,
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
            'SELECT id FROM period_slots WHERE school_id = ? AND academic_year_id = ? AND period_number = ?',
            [schoolId, activeYear.id, period_number]
        );
        if (existing.length > 0) {
            req.flash('error', 'A period slot with this period number already exists.');
            return res.redirect('/schooladmin/timetable/period-slots/add');
        };

        const finalSortOrder = sort_order ? parseInt(sort_order) : parseInt(period_number);
        await db.query(
            `INSERT INTO period_slots (school_id, academic_year_id, period_number, label, start_time, end_time, slot_type, is_teaching_period, is_break, sort_order, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
            [schoolId, activeYear.id, period_number, label, start_time, end_time, finalSlotType, isTeachingPeriod, isBreakPeriod, finalSortOrder]
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
        const activeYear = await timetableService.ensureActiveAcademicYearForSchool(schoolId);
        res.render('schoolAdmin/timetable/editPeriodSlot', {
            title: 'Edit Period Slot',
            period: periods[0],
            activeYear,
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
        const { period_number, label, start_time, end_time, is_break, sort_order, slot_type } = req.body;

        const [existingSlot] = await db.query(
            'SELECT academic_year_id FROM period_slots WHERE id = ? AND school_id = ?',
            [id, schoolId]
        );
        if (existingSlot.length === 0) {
            req.flash('error', 'Period slot not found');
            return res.redirect('/schooladmin/timetable/period-slots');
        }
        const academicYearId = existingSlot[0].academic_year_id;

        const finalSlotType = timetableService.normalizePeriodSlotType(slot_type, Boolean(is_break));
        if (!finalSlotType) {
            req.flash('error', 'Invalid period slot type.');
            return res.redirect(`/schooladmin/timetable/period-slots/edit/${id}`);
        }
        const isTeachingPeriod = finalSlotType === 'teaching' ? 1 : 0;
        const isBreakPeriod = ['short_break', 'lunch_break'].includes(finalSlotType) ? 1 : 0;

        const periodValidation = await validatePeriodPayload({
            schoolId,
            academicYearId,
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
            'SELECT id FROM period_slots WHERE school_id = ? AND academic_year_id = ? AND period_number = ? AND id != ?',
            [schoolId, academicYearId, period_number, id]
        );
        if (existing.length > 0) {
            req.flash('error', 'Another period slot with this period number already exists.');
            return res.redirect(`/schooladmin/timetable/period-slots/edit/${id}`);
        };

        const finalSortOrder = sort_order ? parseInt(sort_order) : parseInt(period_number);
        await db.query(
            `UPDATE period_slots 
            SET period_number = ?, label = ?, start_time = ?, end_time = ?, slot_type = ?, is_teaching_period = ?, is_break = ?, sort_order = ?
            WHERE id = ? AND school_id = ?`,
            [period_number, label, start_time, end_time, finalSlotType, isTeachingPeriod, isBreakPeriod, finalSortOrder, id, schoolId]
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
        const versionIdQuery = req.query.version_id ? parseInt(req.query.version_id, 10) : null;

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
        let timetableGrid = {};
        let versions = [];
        let selectedVersion = null;
        let draftVersion = null;
        let publishedVersion = null;
        const days = timetableService.DAYS;

        const activeYear = await timetableService.ensureActiveAcademicYearForSchool(schoolId);
        const resolvedAcademicYearId = activeYear?.id || null;

        let resolvedTermId = null;
        if (resolvedAcademicYearId) {
            const terms = await timetableService.getTermsForAcademicYear(schoolId, resolvedAcademicYearId);
            resolvedTermId = (terms.find(t => t.is_current === 1) || terms[0])?.id || null;
            if (!resolvedTermId) {
                const [tRes] = await db.query(
                    "INSERT INTO academic_terms (school_id, academic_year_id, term_name, status) VALUES (?, ?, 'Term 1', 'active')",
                    [schoolId, resolvedAcademicYearId]
                );
                resolvedTermId = tRes.insertId;
            }
        }

        if (classId) {
            const [selectedClassList] = await db.query(
                'SELECT * FROM classes WHERE id = ? AND school_id = ?',
                [classId, schoolId]
            );
            if (selectedClassList.length > 0) {
                selectedClass = selectedClassList[0];
                selectedClass.label = formatClassLabel(selectedClass);

                versions = await timetableService.getTermTimetableVersions(schoolId, resolvedAcademicYearId, resolvedTermId);
                draftVersion = versions.find(v => v.status === 'draft') || null;
                publishedVersion = versions.find(v => v.status === 'published') || null;

                if (versionIdQuery) {
                    selectedVersion = versions.find(v => v.id === versionIdQuery) || draftVersion || publishedVersion || null;
                } else {
                    selectedVersion = draftVersion || publishedVersion || null;
                }

                if (resolvedAcademicYearId) {
                    const [periodSlots] = await db.query(
                        'SELECT * FROM period_slots WHERE school_id = ? AND academic_year_id = ? AND COALESCE(status, "active") = "active" ORDER BY sort_order, period_number',
                        [schoolId, resolvedAcademicYearId]
                    );
                    periods = periodSlots;
                }
                subjects = await timetableService.getClassSubjects(schoolId, classId);

                if (selectedVersion) {
                    const [timetableSlots] = await db.query(
                        `SELECT t.*, s.subject_name as subject_name, u.first_name as teacher_first_name, u.last_name as teacher_last_name
                        FROM timetables t
                        LEFT JOIN subjects s ON s.id = t.subject_id AND s.school_id = t.school_id
                        LEFT JOIN teachers tchr ON tchr.id = t.teacher_id AND tchr.school_id = t.school_id
                        LEFT JOIN users u ON u.id = tchr.user_id AND u.school_id = t.school_id
                        WHERE t.class_id = ? AND t.school_id = ? AND t.version_id = ?`,
                        [classId, schoolId, selectedVersion.id]
                    );
                    timetableGrid = timetableService.buildTimetableGrid({ days, periods, entries: timetableSlots });
                }
            };
        };

        const todayDayIndex = new Date().getDay();
        const todayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][todayDayIndex];

        res.render('schoolAdmin/timetable/view', {
            title: 'Timetable Management',
            classes,
            selectedClassId: classId,
            selectedClass,
            periods,
            subjects,
            days,
            timetableGrid,
            versions,
            selectedVersion,
            selectedVersionId: selectedVersion?.id || null,
            draftVersion,
            publishedVersion,
            selectedAcademicYearId: resolvedAcademicYearId,
            selectedTermId: resolvedTermId,
            todayName,
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

exports.getAvailableRoomsJson = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { academic_year_id, version_id, day_of_week, period_slot_id } = req.query;
        if (!version_id || !day_of_week || !period_slot_id) {
            return res.status(400).json({ success: false, message: 'Missing parameters' });
        }
        const [[version]] = await db.query(
            'SELECT id FROM timetable_versions WHERE id = ? AND school_id = ? LIMIT 1',
            [version_id, schoolId]
        );
        if (!version) {
            return res.status(404).json({ success: false, message: 'Version not found' });
        }
        const rooms = await timetableService.getAvailableRooms(
            schoolId,
            academic_year_id,
            version_id,
            day_of_week,
            period_slot_id
        );
        return res.json({ success: true, rooms });
    } catch (error) {
        console.error('getAvailableRoomsJson error:', error);
        return res.status(500).json({ success: false, message: 'Failed to load rooms' });
    }
};

exports.getTeachersJson = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const [teachers] = await db.query(
            `SELECT t.id, u.first_name, u.last_name
            FROM teachers t
            JOIN users u ON u.id = t.user_id AND u.school_id = t.school_id
            WHERE t.school_id = ? AND t.deleted_at IS NULL AND u.status = 'active'
            ORDER BY u.first_name, u.last_name`,
            [schoolId]
        );
        return res.json({ success: true, teachers });
    } catch (error) {
        console.error('getTeachersJson error:', error);
        return res.status(500).json({ success: false, message: 'Failed to load teachers' });
    }
};

exports.getClassWorkloadsJson = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { classId } = req.params;
        const [workloads] = await db.query(
            `SELECT csw.*, s.subject_name
            FROM class_subject_workloads csw
            JOIN subjects s ON s.id = csw.subject_id AND s.school_id = csw.school_id
            WHERE csw.school_id = ? AND csw.class_id = ?`,
            [schoolId, classId]
        );
        return res.json({ success: true, workloads });
    } catch (error) {
        console.error('getClassWorkloadsJson error:', error);
        return res.status(500).json({ success: false, message: 'Failed to load workloads' });
    }
};

exports.deleteTimetableEntry = async (req, res) => {
    const isAjax = req.headers['content-type'] === 'application/json' || req.headers['accept']?.includes('application/json');
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;
        const [entry] = await db.query(
            'SELECT class_id FROM timetables WHERE id = ? AND school_id = ?',
            [id, schoolId]
        );

        if (entry.length === 0) {
            if (isAjax) return res.json({ success: false, message: 'Entry not found' });
            req.flash('error', 'Timetable entry not found');
            return res.redirect('/schooladmin/timetable');
        };

        const classId = entry[0].class_id;
        await timetableService.deleteTimetableEntry({ schoolId, timetableId: id, userId: req.session?.user?.id || req.user?.id || null });

        if (isAjax) return res.json({ success: true });
        req.flash('success', 'Timetable entry deleted successfully');
        res.redirect(`/schooladmin/timetable?class_id=${classId}`);
    } catch (error) {
        console.error('Delete timetable entry error:', error);
        if (isAjax) return res.json({ success: false, message: 'Failed to delete' });
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
        const classId = req.query.class_id || req.body.class_id || '';

        // Run validation pass
        const validation = await timetableService.validateTimetableVersion(schoolId, id);
        if (validation.errors && validation.errors.length > 0) {
            return res.render('schoolAdmin/timetable/publishValidation', {
                title: 'Publish Validation Failed',
                validation,
                versionId: id,
                currentPath: '/schooladmin/timetable',
                user: req.session?.user || req.user
            });
        }

        const result = await timetableService.publishTimetableVersion({ schoolId, versionId: id, userId: req.session?.user?.id || req.user?.id || null });
        if (result?.success) {
            req.flash('success', 'Timetable version published successfully');
            return res.redirect(`/schooladmin/timetable${classId ? '?class_id=' + classId : ''}`);
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
        const [classes] = await db.query('SELECT id, class_name, section, stream FROM classes WHERE school_id = ? ORDER BY class_name, section', [schoolId]);
        classes.forEach(c => {
            c.name = c.class_name;
            c.label = (c.class_name || '') + (c.stream && c.stream !== 'General' ? ' - ' + c.stream : '') + (c.section ? ' - ' + c.section : '');
        });
        const activeYear = await timetableService.ensureActiveAcademicYearForSchool(schoolId);
        const resolvedAcademicYearId = activeYear?.id || null;
        const [periods] = await db.query('SELECT id, label, period_number, start_time, end_time, slot_type, status, is_break FROM period_slots WHERE school_id = ? AND academic_year_id = ? ORDER BY sort_order, period_number', [schoolId, resolvedAcademicYearId]);
        const [rooms] = await db.query('SELECT id, room_name AS name, room_name, room_type, status FROM rooms WHERE school_id = ? ORDER BY room_name', [schoolId]);
        const [workingDays] = await db.query('SELECT day_of_week, is_working_day FROM school_working_days WHERE school_id = ? ORDER BY FIELD(day_of_week, "Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday")', [schoolId]);
        
        const days = workingDays && workingDays.length 
            ? workingDays.filter(d => d.is_working_day).map(d => d.day_of_week) 
            : ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

        const classId = req.query.class_id ? Number(req.query.class_id) : null;
        const selectedClass = classId ? classes.find(c => c.id === classId) || null : null;

        res.render('schoolAdmin/timetable/management', {
            title: 'Timetable Management',
            classes,
            periods,
            slots: periods,
            rooms,
            workingDays,
            days,
            selectedClassId: classId,
            selectedClass,
            subjects: [],
            teachers: [],
            timetableGrid: {},
            user: req.session.user || req.user,
            currentPath: '/schooladmin/timetable'
        });
    } catch (error) {
        console.error('[getManagementPage Error]', error);
        req.flash('error', error.message || 'Unable to load timetable management');
        return res.redirect('/schooladmin/timetable');
    }
};

exports.saveWorkingDays = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const academicYear = await timetableService.ensureActiveAcademicYearForSchool(schoolId);
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
        const academicYear = await timetableService.ensureActiveAcademicYearForSchool(schoolId);
        const { class_id, subject_id, weekly_required_periods, maximum_periods_per_day } = req.body;
        await db.query(
            `INSERT INTO class_subject_workloads (school_id, academic_year_id, class_id, subject_id, weekly_required_periods, maximum_periods_per_day)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE weekly_required_periods = VALUES(weekly_required_periods), maximum_periods_per_day = VALUES(maximum_periods_per_day)`,
            [schoolId, academicYear?.id, class_id, subject_id, weekly_required_periods, maximum_periods_per_day]
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
        const academicYear = await timetableService.ensureActiveAcademicYearForSchool(schoolId);
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
        const { name, room_name, room_type, capacity, status } = req.body;
        const roomNameVal = room_name || name;
        if (!roomNameVal) {
            req.flash('error', 'Room name is required');
            return res.redirect('/schooladmin/timetable/rooms');
        }
        await db.query(
            `INSERT INTO rooms (school_id, room_name, room_type, capacity, status)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE room_type = VALUES(room_type), capacity = VALUES(capacity), status = VALUES(status)`,
            [schoolId, roomNameVal, room_type || 'classroom', capacity || 40, status || 'active']
        );
        req.flash('success', 'Room saved successfully');
    } catch (error) {
        console.error('[saveRoom Error]', error);
        req.flash('error', error.message || 'Unable to save room');
    }
    return res.redirect('/schooladmin/timetable/rooms');
};

exports.getSubstitutionsPage = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const dateStr = req.query.date || new Date().toISOString().split('T')[0];
        const date = new Date(dateStr);

        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const dayOfWeek = days[date.getDay()];

        const [slots] = await db.query(
            `SELECT t.id AS timetable_id, c.class_name, c.section, ps.label AS period_label, ps.start_time, ps.end_time,
                   s.subject_name, u.first_name AS teacher_first_name, u.last_name AS teacher_last_name, t.teacher_id, t.period_slot_id,
                   l.id AS leave_id, l.reason AS leave_reason,
                   tsub.id AS substitution_id, tsub.substitute_teacher_id, u_sub.first_name AS sub_first_name, u_sub.last_name AS sub_last_name,
                   tsub.reason AS sub_reason
            FROM timetables t
            JOIN period_slots ps ON t.period_slot_id = ps.id AND t.school_id = ps.school_id
            JOIN classes c ON t.class_id = c.id AND t.school_id = c.school_id
            JOIN subjects s ON t.subject_id = s.id AND t.school_id = s.school_id
            JOIN timetable_versions tv ON t.version_id = tv.id AND t.school_id = tv.school_id
            LEFT JOIN teachers tchr ON tchr.id = t.teacher_id AND tchr.school_id = t.school_id
            LEFT JOIN users u ON u.id = tchr.user_id AND u.school_id = t.school_id
            LEFT JOIN leaves l ON l.user_id = u.id AND l.school_id = t.school_id AND l.status = 'approved' AND ? BETWEEN l.from_date AND l.to_date
            LEFT JOIN timetable_substitutions tsub ON tsub.timetable_id = t.id AND tsub.school_id = t.school_id AND tsub.substitution_date = ?
            LEFT JOIN teachers tchr_sub ON tchr_sub.id = tsub.substitute_teacher_id AND tchr_sub.school_id = tsub.school_id
            LEFT JOIN users u_sub ON u_sub.id = tchr_sub.user_id AND u_sub.school_id = tsub.school_id
            WHERE t.school_id = ? AND t.day_of_week = ? AND tv.status = 'published'
            ORDER BY c.class_name, c.section, ps.sort_order, ps.period_number`,
            [dateStr, dateStr, schoolId, dayOfWeek]
        );

        res.render('schoolAdmin/timetable/substitutions', {
            title: 'Teacher Substitutions',
            slots,
            selectedDate: dateStr,
            dayOfWeek,
            user: req.session.user || req.user,
            currentPath: '/schooladmin/timetable'
        });
    } catch (error) {
        console.error('getSubstitutionsPage error:', error);
        req.flash('error', 'Failed to load substitutions page');
        res.redirect('/schooladmin/timetable');
    }
};

exports.getAvailableSubstituteTeachersJson = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { teacher_id, day_of_week, period_slot_id, date, timetable_id } = req.query;
        if (!day_of_week || !period_slot_id || !date) {
            return res.status(400).json({ success: false, message: 'Missing parameters' });
        }
        const teachers = await timetableService.getAvailableSubstituteTeachers({
            schoolId,
            teacherId: teacher_id ? parseInt(teacher_id, 10) : null,
            dayOfWeek: day_of_week,
            periodSlotId: parseInt(period_slot_id, 10),
            date,
            timetableId: timetable_id ? parseInt(timetable_id, 10) : null
        });
        return res.json({ success: true, teachers });
    } catch (error) {
        console.error('getAvailableSubstituteTeachersJson error:', error);
        return res.status(500).json({ success: false, message: 'Failed to load substitute teachers' });
    }
};

exports.saveSubstitution = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { timetable_id, substitution_date, original_teacher_id, substitute_teacher_id, reason } = req.body;
        if (!timetable_id || !substitution_date || !substitute_teacher_id) {
            req.flash('error', 'All fields are required');
            return res.redirect(`/schooladmin/timetable/substitutions?date=${substitution_date}`);
        }
        await timetableService.assignSubstituteTeacher({
            schoolId,
            timetableId: parseInt(timetable_id, 10),
            substitutionDate: substitution_date,
            originalTeacherId: original_teacher_id ? parseInt(original_teacher_id, 10) : null,
            substituteTeacherId: parseInt(substitute_teacher_id, 10),
            reason,
            assignedBy: req.session?.user?.id || req.user?.id || null
        });
        req.flash('success', 'Substitute teacher assigned successfully');
        return res.redirect(`/schooladmin/timetable/substitutions?date=${substitution_date}`);
    } catch (error) {
        console.error('saveSubstitution error:', error);
        req.flash('error', error.message || 'Failed to save substitution');
        return res.redirect(`/schooladmin/timetable/substitutions`);
    }
};
