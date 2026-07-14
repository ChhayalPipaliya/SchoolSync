CREATE TABLE IF NOT EXISTS academic_terms (
    id int NOT NULL AUTO_INCREMENT,
    school_id int NOT NULL,
    academic_year_id int NOT NULL,
    name varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
    start_date date DEFAULT NULL,
    end_date date DEFAULT NULL,
    status enum('active','inactive') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
    is_current tinyint(1) NOT NULL DEFAULT 0,
    created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_academic_term_scope (school_id, academic_year_id, name),
    KEY idx_academic_terms_current (school_id, academic_year_id, is_current, status),
    CONSTRAINT fk_academic_terms_school FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT fk_academic_terms_year FOREIGN KEY (academic_year_id) REFERENCES academic_years (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS timetable_migration_backup_005 LIKE timetables;
INSERT IGNORE INTO timetable_migration_backup_005 SELECT * FROM timetables;

CREATE TABLE IF NOT EXISTS timetable_migration_issues (
    id int NOT NULL AUTO_INCREMENT,
    migration_name varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
    timetable_id int DEFAULT NULL,
    school_id int DEFAULT NULL,
    class_id int DEFAULT NULL,
    issue varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
    created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_timetable_migration_issue (migration_name, timetable_id, issue)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO academic_years (school_id, code, status, is_current)
SELECT s.id,
    COALESCE(MAX(NULLIF(c.academic_year, '')), CONCAT(YEAR(CURDATE()), '-', YEAR(CURDATE()) + 1)),
    'active',
    1
FROM schools s
LEFT JOIN classes c ON c.school_id = s.id
WHERE NOT EXISTS (
    SELECT 1 FROM academic_years ay WHERE ay.school_id = s.id
)
GROUP BY s.id;

ALTER TABLE period_slots
    ADD COLUMN academic_year_id int NULL AFTER school_id,
    ADD COLUMN slot_type enum('regular','break','lunch','assembly','activity','zero_period') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'regular' AFTER end_time,
    ADD COLUMN is_teaching_period tinyint(1) NOT NULL DEFAULT 1 AFTER slot_type,
    ADD COLUMN status enum('active','inactive') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' AFTER sort_order,
    ADD COLUMN created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

UPDATE period_slots ps
SET ps.academic_year_id = COALESCE(
    (SELECT ay.id FROM academic_years ay WHERE ay.school_id = ps.school_id AND ay.is_current = 1 ORDER BY ay.id DESC LIMIT 1),
    (SELECT ay.id FROM academic_years ay WHERE ay.school_id = ps.school_id ORDER BY ay.id DESC LIMIT 1)
)
WHERE ps.academic_year_id IS NULL;

UPDATE period_slots
SET slot_type = CASE WHEN COALESCE(is_break, 0) = 1 THEN 'break' ELSE slot_type END,
    is_teaching_period = CASE WHEN COALESCE(is_break, 0) = 1 THEN 0 ELSE is_teaching_period END,
    sort_order = CASE WHEN sort_order IS NULL OR sort_order = 0 THEN period_number ELSE sort_order END;

ALTER TABLE period_slots
    MODIFY academic_year_id int NOT NULL,
    MODIFY is_break tinyint(1) NOT NULL DEFAULT 0;

ALTER TABLE period_slots DROP INDEX unique_period;
ALTER TABLE period_slots
    ADD UNIQUE KEY uq_period_school_year_number (school_id, academic_year_id, period_number),
    ADD UNIQUE KEY uq_period_school_year_sort (school_id, academic_year_id, sort_order),
    ADD KEY idx_period_school_year_status (school_id, academic_year_id, status, sort_order),
    ADD CONSTRAINT fk_period_slots_year FOREIGN KEY (academic_year_id) REFERENCES academic_years (id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS timetable_versions (
    id int NOT NULL AUTO_INCREMENT,
    school_id int NOT NULL,
    academic_year_id int NOT NULL,
    term_id int DEFAULT NULL,
    term_id_key int GENERATED ALWAYS AS (COALESCE(term_id, 0)) STORED,
    class_id int NOT NULL,
    version_number int NOT NULL DEFAULT 1,
    status enum('draft','published','archived') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
    published_scope_key tinyint GENERATED ALWAYS AS (CASE WHEN status = 'published' THEN 1 ELSE NULL END) STORED,
    effective_from date DEFAULT NULL,
    effective_to date DEFAULT NULL,
    created_by int DEFAULT NULL,
    published_by int DEFAULT NULL,
    published_at timestamp NULL DEFAULT NULL,
    archived_at timestamp NULL DEFAULT NULL,
    created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_timetable_version_number (school_id, academic_year_id, term_id_key, class_id, version_number),
    UNIQUE KEY uq_timetable_one_published (school_id, academic_year_id, term_id_key, class_id, published_scope_key),
    KEY idx_timetable_versions_lookup (school_id, academic_year_id, term_id, class_id, status),
    CONSTRAINT fk_timetable_versions_school FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT fk_timetable_versions_year FOREIGN KEY (academic_year_id) REFERENCES academic_years (id) ON DELETE RESTRICT,
    CONSTRAINT fk_timetable_versions_term FOREIGN KEY (term_id) REFERENCES academic_terms (id) ON DELETE RESTRICT,
    CONSTRAINT fk_timetable_versions_class FOREIGN KEY (class_id) REFERENCES classes (id) ON DELETE CASCADE,
    CONSTRAINT fk_timetable_versions_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_timetable_versions_published_by FOREIGN KEY (published_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS school_working_days (
    id int NOT NULL AUTO_INCREMENT,
    school_id int NOT NULL,
    academic_year_id int NOT NULL,
    day_of_week enum('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday') COLLATE utf8mb4_unicode_ci NOT NULL,
    is_working_day tinyint(1) NOT NULL DEFAULT 1,
    is_half_day tinyint(1) NOT NULL DEFAULT 0,
    max_period_slot_id int DEFAULT NULL,
    created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_working_day_scope (school_id, academic_year_id, day_of_week),
    KEY idx_working_days_active (school_id, academic_year_id, is_working_day),
    CONSTRAINT fk_working_days_school FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT fk_working_days_year FOREIGN KEY (academic_year_id) REFERENCES academic_years (id) ON DELETE CASCADE,
    CONSTRAINT fk_working_days_max_period FOREIGN KEY (max_period_slot_id) REFERENCES period_slots (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO school_working_days (school_id, academic_year_id, day_of_week, is_working_day, is_half_day)
SELECT defaults.school_id, defaults.academic_year_id, defaults.day_name,
    defaults.is_working_day, defaults.is_half_day
FROM (
    SELECT ay.school_id, ay.id AS academic_year_id, days.day_name,
        CASE WHEN days.day_name = 'Sunday' THEN 0 ELSE 1 END AS is_working_day,
        0 AS is_half_day
    FROM academic_years ay
    CROSS JOIN (
        SELECT 'Monday' AS day_name UNION ALL SELECT 'Tuesday' UNION ALL SELECT 'Wednesday'
        UNION ALL SELECT 'Thursday' UNION ALL SELECT 'Friday' UNION ALL SELECT 'Saturday' UNION ALL SELECT 'Sunday'
    ) AS days
) AS defaults
ON DUPLICATE KEY UPDATE day_of_week = VALUES(day_of_week);

CREATE TABLE IF NOT EXISTS rooms (
    id int NOT NULL AUTO_INCREMENT,
    school_id int NOT NULL,
    name varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
    code varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    room_type enum('classroom','computer_lab','science_lab','library','music_room','auditorium','playground','other') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'classroom',
    capacity int DEFAULT NULL,
    status enum('active','inactive') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
    created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_room_name (school_id, name),
    UNIQUE KEY uq_room_code (school_id, code),
    KEY idx_rooms_active_type (school_id, status, room_type),
    CONSTRAINT fk_rooms_school FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS class_subject_workloads (
    id int NOT NULL AUTO_INCREMENT,
    school_id int NOT NULL,
    academic_year_id int NOT NULL,
    term_id int DEFAULT NULL,
    term_id_key int GENERATED ALWAYS AS (COALESCE(term_id, 0)) STORED,
    class_id int NOT NULL,
    subject_id int NOT NULL,
    weekly_periods_required int NOT NULL DEFAULT 0,
    max_periods_per_day int NOT NULL DEFAULT 1,
    requires_consecutive_periods tinyint(1) NOT NULL DEFAULT 0,
    preferred_time enum('any','morning','afternoon') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'any',
    requires_room_type varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_class_subject_workload (school_id, academic_year_id, term_id_key, class_id, subject_id),
    KEY idx_workload_class (school_id, academic_year_id, class_id),
    CONSTRAINT fk_workloads_school FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT fk_workloads_year FOREIGN KEY (academic_year_id) REFERENCES academic_years (id) ON DELETE CASCADE,
    CONSTRAINT fk_workloads_term FOREIGN KEY (term_id) REFERENCES academic_terms (id) ON DELETE RESTRICT,
    CONSTRAINT fk_workloads_class FOREIGN KEY (class_id) REFERENCES classes (id) ON DELETE CASCADE,
    CONSTRAINT fk_workloads_subject FOREIGN KEY (subject_id) REFERENCES subjects (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teacher_availability (
    id int NOT NULL AUTO_INCREMENT,
    school_id int NOT NULL,
    academic_year_id int NOT NULL,
    teacher_id int NOT NULL,
    day_of_week enum('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday') COLLATE utf8mb4_unicode_ci NOT NULL,
    period_slot_id int NOT NULL,
    is_available tinyint(1) NOT NULL DEFAULT 1,
    reason varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    created_by int DEFAULT NULL,
    created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_teacher_availability (school_id, academic_year_id, teacher_id, day_of_week, period_slot_id),
    KEY idx_teacher_availability_lookup (school_id, academic_year_id, day_of_week, period_slot_id, is_available),
    CONSTRAINT fk_teacher_availability_school FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT fk_teacher_availability_year FOREIGN KEY (academic_year_id) REFERENCES academic_years (id) ON DELETE CASCADE,
    CONSTRAINT fk_teacher_availability_teacher FOREIGN KEY (teacher_id) REFERENCES teachers (id) ON DELETE CASCADE,
    CONSTRAINT fk_teacher_availability_period FOREIGN KEY (period_slot_id) REFERENCES period_slots (id) ON DELETE CASCADE,
    CONSTRAINT fk_teacher_availability_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teacher_workload_limits (
    id int NOT NULL AUTO_INCREMENT,
    school_id int NOT NULL,
    academic_year_id int NOT NULL,
    teacher_id int NOT NULL,
    max_periods_per_day int NOT NULL DEFAULT 8,
    max_periods_per_week int NOT NULL DEFAULT 40,
    max_consecutive_periods int NOT NULL DEFAULT 4,
    created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_teacher_workload_limit (school_id, academic_year_id, teacher_id),
    CONSTRAINT fk_teacher_limits_school FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT fk_teacher_limits_year FOREIGN KEY (academic_year_id) REFERENCES academic_years (id) ON DELETE CASCADE,
    CONSTRAINT fk_teacher_limits_teacher FOREIGN KEY (teacher_id) REFERENCES teachers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE timetables
    MODIFY day_of_week enum('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday') COLLATE utf8mb4_unicode_ci NOT NULL,
    ADD COLUMN academic_year_id int NULL AFTER school_id,
    ADD COLUMN term_id int NULL AFTER academic_year_id,
    ADD COLUMN version_id int NULL AFTER term_id,
    ADD COLUMN room_id int NULL AFTER teacher_id,
    ADD COLUMN entry_type enum('subject','break','assembly','activity','library','lab','sports','other') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'subject' AFTER room_id,
    ADD COLUMN created_by int NULL AFTER entry_type,
    ADD COLUMN updated_by int NULL AFTER created_by;

INSERT INTO timetable_versions (
    school_id, academic_year_id, term_id, class_id, version_number, status,
    effective_from, created_by, published_by, published_at
)
SELECT existing.school_id,
    COALESCE(
        (SELECT ay.id FROM academic_years ay JOIN classes c2 ON c2.id = existing.class_id AND c2.school_id = existing.school_id WHERE ay.school_id = existing.school_id AND ay.code = c2.academic_year ORDER BY ay.id DESC LIMIT 1),
        (SELECT ay.id FROM academic_years ay WHERE ay.school_id = existing.school_id AND ay.is_current = 1 ORDER BY ay.id DESC LIMIT 1),
        (SELECT ay.id FROM academic_years ay WHERE ay.school_id = existing.school_id ORDER BY ay.id DESC LIMIT 1)
    ),
    NULL,
    existing.class_id,
    1,
    'published',
    CURDATE(),
    NULL,
    NULL,
    CURRENT_TIMESTAMP
FROM (SELECT DISTINCT school_id, class_id FROM timetables) existing
ON DUPLICATE KEY UPDATE id = id;

UPDATE timetables tt
JOIN timetable_versions tv
    ON tv.school_id = tt.school_id
    AND tv.class_id = tt.class_id
    AND tv.version_number = 1
SET tt.version_id = tv.id,
    tt.academic_year_id = tv.academic_year_id,
    tt.term_id = tv.term_id
WHERE tt.version_id IS NULL;

INSERT IGNORE INTO timetable_migration_issues (migration_name, timetable_id, school_id, class_id, issue)
SELECT '005_production_timetable', tt.id, tt.school_id, tt.class_id,
    'No academic year/version could be resolved during timetable backfill'
FROM timetables tt
WHERE tt.academic_year_id IS NULL OR tt.version_id IS NULL;

ALTER TABLE timetables DROP INDEX unique_slot;
ALTER TABLE timetables
    MODIFY academic_year_id int NOT NULL,
    MODIFY version_id int NOT NULL,
    ADD UNIQUE KEY uq_timetable_class_slot (school_id, version_id, class_id, day_of_week, period_slot_id),
    ADD UNIQUE KEY uq_timetable_teacher_slot (school_id, version_id, day_of_week, period_slot_id, teacher_id),
    ADD UNIQUE KEY uq_timetable_room_slot (school_id, version_id, day_of_week, period_slot_id, room_id),
    ADD KEY idx_timetable_published_lookup (school_id, academic_year_id, term_id, class_id, version_id),
    ADD CONSTRAINT fk_timetables_year FOREIGN KEY (academic_year_id) REFERENCES academic_years (id) ON DELETE RESTRICT,
    ADD CONSTRAINT fk_timetables_term FOREIGN KEY (term_id) REFERENCES academic_terms (id) ON DELETE RESTRICT,
    ADD CONSTRAINT fk_timetables_version FOREIGN KEY (version_id) REFERENCES timetable_versions (id) ON DELETE CASCADE,
    ADD CONSTRAINT fk_timetables_room FOREIGN KEY (room_id) REFERENCES rooms (id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_timetables_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_timetables_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS timetable_substitutions (
    id int NOT NULL AUTO_INCREMENT,
    school_id int NOT NULL,
    timetable_id int NOT NULL,
    substitution_date date NOT NULL,
    original_teacher_id int DEFAULT NULL,
    substitute_teacher_id int NOT NULL,
    reason varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
    status enum('assigned','completed','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'assigned',
    active_scope_key tinyint GENERATED ALWAYS AS (CASE WHEN status = 'assigned' THEN 1 ELSE NULL END) STORED,
    assigned_by int DEFAULT NULL,
    created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_active_timetable_substitution (school_id, timetable_id, substitution_date, active_scope_key),
    KEY idx_substitute_date (school_id, substitute_teacher_id, substitution_date, status),
    CONSTRAINT fk_substitutions_school FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT fk_substitutions_timetable FOREIGN KEY (timetable_id) REFERENCES timetables (id) ON DELETE CASCADE,
    CONSTRAINT fk_substitutions_original_teacher FOREIGN KEY (original_teacher_id) REFERENCES teachers (id) ON DELETE SET NULL,
    CONSTRAINT fk_substitutions_substitute_teacher FOREIGN KEY (substitute_teacher_id) REFERENCES teachers (id) ON DELETE RESTRICT,
    CONSTRAINT fk_substitutions_assigned_by FOREIGN KEY (assigned_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
