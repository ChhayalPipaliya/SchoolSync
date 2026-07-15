const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../config/database');
const timetableService = require('../services/timetableService');

test.describe('Timetable Integration & Role Panel Tests', () => {

    test.before(async () => {
        // Ensure School 1 exists
        await db.queryAsync('INSERT IGNORE INTO schools (id, school_name, school_type, medium, status) VALUES (1, "Test School 1", "secondary", "English", "active")');
        // Ensure academic year exists
        await db.queryAsync('INSERT IGNORE INTO academic_years (id, school_id, code, status, is_current) VALUES (1, 1, "2026-2027", "active", 1)');
        // Ensure academic term exists
        await db.queryAsync('INSERT IGNORE INTO academic_terms (id, school_id, academic_year_id, term_name, status) VALUES (1, 1, 1, "Term 1", "active")');
        // Ensure class exists
        await db.queryAsync('INSERT IGNORE INTO classes (id, school_id, class_name, section, medium, academic_year) VALUES (1, 1, "Class 1", "A", "English", "2026-2027")');
        // Ensure subject exists
        await db.queryAsync('INSERT IGNORE INTO subjects (id, school_id, subject_name, subject_code, status) VALUES (1, 1, "Maths", "MATH", "active")');
        
        // Ensure class-subject mapping exists
        await db.queryAsync('INSERT IGNORE INTO class_subjects (school_id, class_id, subject_id) VALUES (1, 1, 1)');

        // Ensure user for teacher exists (teachers reference users)
        await db.queryAsync('INSERT IGNORE INTO users (id, school_id, email, password, role, first_name, last_name, status) VALUES (10, 1, "teacher1@school.com", "hash", "teacher", "John", "Doe", "active")');
        // Ensure teacher exists
        await db.queryAsync('INSERT IGNORE INTO teachers (id, school_id, user_id) VALUES (1, 1, 10)');
        
        // Ensure student exists (need user too)
        await db.queryAsync('INSERT IGNORE INTO users (id, school_id, email, password, role, first_name, last_name, status) VALUES (20, 1, "student1@school.com", "hash", "student", "Jane", "Smith", "active")');
        await db.queryAsync('INSERT IGNORE INTO students (id, school_id, user_id, class_id, admission_no, dob, admission_date, status) VALUES (1, 1, 20, 1, "ADM-001", "2015-05-05", "2026-06-01", "active")');

        // Ensure period slot exists
        await db.queryAsync(`INSERT IGNORE INTO period_slots (id, school_id, academic_year_id, period_number, label, start_time, end_time, slot_type, is_teaching_period, sort_order, status) 
            VALUES (1, 1, 1, 1, "Period 1", "08:00:00", "09:00:00", "teaching", 1, 1, "active")`);
        // Ensure working days exist
        await db.queryAsync('INSERT IGNORE INTO school_working_days (school_id, academic_year_id, day_of_week, is_working_day, is_half_day) VALUES (1, 1, "Monday", 1, 0)');

        // Ensure a draft version exists
        await db.queryAsync('INSERT IGNORE INTO timetable_versions (id, school_id, academic_year_id, term_id, version_number, status) VALUES (1, 1, 1, 1, 1, "draft")');
    });

    test.after(async () => {
        // Shut down the database pool to avoid hanging the test runner
        await db.pool.end();
    });

    test('buildTimetableGrid maps entries to the correct day and period slots (smoke test)', () => {
        const days = ['Monday', 'Tuesday'];
        const periods = [
            { id: 1, label: 'Period 1' },
            { id: 2, label: 'Period 2' }
        ];
        const entries = [
            { id: 101, day_of_week: 'Monday', period_slot_id: 1, subject_name: 'Maths' },
            { id: 102, day_of_week: 'Tuesday', period_slot_id: 2, subject_name: 'Science' }
        ];

        const grid = timetableService.buildTimetableGrid({ days, periods, entries });
        assert.equal(grid['Monday'][1].subject_name, 'Maths');
        assert.equal(grid['Tuesday'][2].subject_name, 'Science');
    });

    test('Cross-school isolation: cannot save entry for another school\'s resources', async () => {
        // Create mock data for School B: school_id = 9999
        await db.queryAsync('INSERT IGNORE INTO schools (id, school_name, school_type, medium, status) VALUES (9999, "School B", "secondary", "English", "active")');
        await db.queryAsync('INSERT IGNORE INTO academic_years (id, school_id, code, status, is_current) VALUES (9999, 9999, "2026-B", "active", 1)');
        await db.queryAsync('INSERT IGNORE INTO academic_terms (id, school_id, academic_year_id, term_name, status) VALUES (9999, 9999, 9999, "Term 1", "active")');
        await db.queryAsync('INSERT IGNORE INTO timetable_versions (id, school_id, academic_year_id, term_id, version_number, status) VALUES (9999, 9999, 9999, 9999, 1, "draft")');
        await db.queryAsync('INSERT IGNORE INTO classes (id, school_id, class_name, section) VALUES (9999, 9999, "Class B", "B")');
        await db.queryAsync('INSERT IGNORE INTO subjects (id, school_id, subject_name, subject_code, status) VALUES (9999, 9999, "Subject B", "SUBB", "active")');
        
        // Attempting to save entry for School 1 using resources of School 9999 should fail
        await assert.rejects(
            timetableService.saveTimetableEntry({
                schoolId: 1, // Requesting School A
                classId: 9999, // Resource of School B
                dayOfWeek: 'Monday',
                periodSlotId: 1,
                subjectId: 9999,
                teacherId: 9999,
                roomId: null,
                entryType: 'teaching',
                userId: 1
            }),
            /Selected class was not found/
        );

        // Cleanup School B mock data
        await db.queryAsync('DELETE FROM timetables WHERE school_id = 9999');
        await db.queryAsync('DELETE FROM timetable_versions WHERE school_id = 9999');
        await db.queryAsync('DELETE FROM classes WHERE school_id = 9999');
        await db.queryAsync('DELETE FROM subjects WHERE school_id = 9999');
        await db.queryAsync('DELETE FROM academic_terms WHERE school_id = 9999');
        await db.queryAsync('DELETE FROM academic_years WHERE school_id = 9999');
        await db.queryAsync('DELETE FROM schools WHERE id = 9999');
    });

    test('Assignment rules: unassigned teacher rejected', async () => {
        // Delete teacher-class assignment for testing
        await db.queryAsync('DELETE FROM teacher_class_assign WHERE school_id = 1 AND teacher_id = 1 AND subject_id = 1');

        await assert.rejects(
            timetableService.saveTimetableEntry({
                schoolId: 1,
                classId: 1,
                dayOfWeek: 'Monday',
                periodSlotId: 1,
                subjectId: 1,
                teacherId: 1,
                roomId: null,
                entryType: 'teaching',
                userId: 1
            }),
            /Please assign a teacher to this class and subject first/
        );
    });

    test('Portal visibility: teacher/student/parent views can only see published data', async () => {
        // Create a temp draft version and published version
        await db.queryAsync('DELETE FROM timetable_versions WHERE school_id = 1 AND version_number = 999');
        const draftRes = await db.queryAsync(
            'INSERT INTO timetable_versions (school_id, academic_year_id, term_id, version_number, status) VALUES (1, 1, 1, 999, "draft")'
        );
        const draftVersionId = draftRes.insertId;

        // Ensure assignments exist temporarily
        await db.queryAsync('INSERT IGNORE INTO teacher_class_assign (school_id, class_id, subject_id, teacher_id, academic_year) VALUES (1, 1, 1, 1, "2026-2027")');
        
        await db.queryAsync(
            `INSERT INTO timetables (school_id, version_id, class_id, day_of_week, period_slot_id, subject_id, teacher_id, academic_year_id, term_id)
                VALUES (1, ?, 1, "Monday", 1, 1, 1, 1, 1)`,
            [draftVersionId]
        );

        // Fetch student timetable (requires published status)
        const studentTimetable = await timetableService.getStudentTimetable(1, 1, 1, 1);
        const foundDraftEntry = studentTimetable.entries.some(e => e.version_id === draftVersionId);
        assert.equal(foundDraftEntry, false);

        // Fetch teacher timetable
        const teacherTimetable = await timetableService.getTeacherTimetable(1, 1, 1, 1);
        const foundDraftTeacherEntry = teacherTimetable.some(e => e.version_id === draftVersionId);
        assert.equal(foundDraftTeacherEntry, false);

        // Cleanup temp draft version
        await db.queryAsync('DELETE FROM timetables WHERE version_id = ?', [draftVersionId]);
        await db.queryAsync('DELETE FROM timetable_versions WHERE id = ?', [draftVersionId]);
    });

});
