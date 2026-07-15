-- ==========================================
-- Stage 1 Timetable Database Schema Migration
-- ==========================================

-- 1. Create academic_terms table
CREATE TABLE IF NOT EXISTS academic_terms (
  id int NOT NULL AUTO_INCREMENT,
  school_id int NOT NULL,
  academic_year_id int NOT NULL,
  term_name varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  start_date date DEFAULT NULL,
  end_date date DEFAULT NULL,
  status enum('active','completed','upcoming') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_academic_terms_school_year (school_id, academic_year_id),
  CONSTRAINT fk_academic_terms_school FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
  CONSTRAINT fk_academic_terms_year FOREIGN KEY (academic_year_id) REFERENCES academic_years (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. ALTER period_slots table
-- Comments: start_time must be before end_time, and slots must not overlap within the same school+academic_year.
-- (This validation belongs in the service layer in Stage 2, not database check constraints/triggers).
ALTER TABLE period_slots ADD COLUMN academic_year_id int NOT NULL;
ALTER TABLE period_slots ADD COLUMN slot_type enum('teaching','short_break','lunch_break','assembly','activity') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'teaching';
ALTER TABLE period_slots ADD COLUMN is_teaching_period tinyint(1) NOT NULL DEFAULT '1';
ALTER TABLE period_slots ADD COLUMN status enum('active','inactive') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active';

ALTER TABLE period_slots ADD CONSTRAINT fk_period_slots_year FOREIGN KEY (academic_year_id) REFERENCES academic_years (id) ON DELETE CASCADE;

-- Update unique key unique_period to (school_id, academic_year_id, period_number)
ALTER TABLE period_slots DROP INDEX unique_period;
ALTER TABLE period_slots ADD UNIQUE KEY unique_period (school_id, academic_year_id, period_number);

-- 3. Create school_working_days table
CREATE TABLE IF NOT EXISTS school_working_days (
  id int NOT NULL AUTO_INCREMENT,
  school_id int NOT NULL,
  academic_year_id int NOT NULL,
  day_of_week enum('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  is_working_day tinyint(1) NOT NULL DEFAULT '1',
  is_half_day tinyint(1) NOT NULL DEFAULT '0',
  max_period_slot_id int DEFAULT NULL,
  created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY unique_working_day (school_id, academic_year_id, day_of_week),
  CONSTRAINT fk_school_working_days_school FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
  CONSTRAINT fk_school_working_days_year FOREIGN KEY (academic_year_id) REFERENCES academic_years (id) ON DELETE CASCADE,
  CONSTRAINT fk_school_working_days_max_period FOREIGN KEY (max_period_slot_id) REFERENCES period_slots (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Create timetable_versions table
CREATE TABLE IF NOT EXISTS timetable_versions (
  id int NOT NULL AUTO_INCREMENT,
  school_id int NOT NULL,
  academic_year_id int NOT NULL,
  term_id int NOT NULL,
  version_number int NOT NULL DEFAULT '1',
  status enum('draft','published','archived') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  created_by int DEFAULT NULL,
  published_by int DEFAULT NULL,
  published_at timestamp NULL DEFAULT NULL,
  archived_at timestamp NULL DEFAULT NULL,
  created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_timetable_versions_lookup (school_id, academic_year_id, term_id, status),
  CONSTRAINT fk_timetable_versions_school FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
  CONSTRAINT fk_timetable_versions_year FOREIGN KEY (academic_year_id) REFERENCES academic_years (id) ON DELETE CASCADE,
  CONSTRAINT fk_timetable_versions_term FOREIGN KEY (term_id) REFERENCES academic_terms (id) ON DELETE CASCADE,
  CONSTRAINT fk_timetable_versions_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_timetable_versions_published_by FOREIGN KEY (published_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Create rooms table
CREATE TABLE IF NOT EXISTS rooms (
  id int NOT NULL AUTO_INCREMENT,
  school_id int NOT NULL,
  room_name varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  room_type enum('classroom','science_lab','computer_lab','library','activity_room','sports_ground') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  capacity int DEFAULT NULL,
  status enum('active','inactive') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY unique_room (school_id, room_name),
  CONSTRAINT fk_rooms_school FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Create class_subject_workloads table
CREATE TABLE IF NOT EXISTS class_subject_workloads (
  id int NOT NULL AUTO_INCREMENT,
  school_id int NOT NULL,
  academic_year_id int NOT NULL,
  class_id int NOT NULL,
  subject_id int NOT NULL,
  weekly_required_periods int NOT NULL DEFAULT '0',
  maximum_periods_per_day int NOT NULL DEFAULT '0',
  preferred_period_type varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  status enum('active','inactive') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY unique_class_subject_workload (school_id, academic_year_id, class_id, subject_id),
  CONSTRAINT fk_class_subject_workloads_school FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
  CONSTRAINT fk_class_subject_workloads_year FOREIGN KEY (academic_year_id) REFERENCES academic_years (id) ON DELETE CASCADE,
  CONSTRAINT fk_class_subject_workloads_class FOREIGN KEY (class_id) REFERENCES classes (id) ON DELETE CASCADE,
  CONSTRAINT fk_class_subject_workloads_subject FOREIGN KEY (subject_id) REFERENCES subjects (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Create teacher_availability table
CREATE TABLE IF NOT EXISTS teacher_availability (
  id int NOT NULL AUTO_INCREMENT,
  school_id int NOT NULL,
  academic_year_id int NOT NULL,
  teacher_id int NOT NULL,
  day_of_week enum('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  period_slot_id int NOT NULL,
  is_available tinyint(1) NOT NULL DEFAULT '1',
  reason varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY unique_teacher_availability (school_id, academic_year_id, teacher_id, day_of_week, period_slot_id),
  CONSTRAINT fk_teacher_availability_school FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
  CONSTRAINT fk_teacher_availability_year FOREIGN KEY (academic_year_id) REFERENCES academic_years (id) ON DELETE CASCADE,
  CONSTRAINT fk_teacher_availability_teacher FOREIGN KEY (teacher_id) REFERENCES teachers (id) ON DELETE CASCADE,
  CONSTRAINT fk_teacher_availability_period FOREIGN KEY (period_slot_id) REFERENCES period_slots (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Create teacher_workload_limits table
CREATE TABLE IF NOT EXISTS teacher_workload_limits (
  id int NOT NULL AUTO_INCREMENT,
  school_id int NOT NULL,
  academic_year_id int NOT NULL,
  teacher_id int NOT NULL,
  maximum_periods_per_day int DEFAULT '8',
  max_periods_per_week int DEFAULT '40',
  max_consecutive_periods int DEFAULT '4',
  created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY unique_teacher_workload_limit (school_id, academic_year_id, teacher_id),
  CONSTRAINT fk_teacher_workload_limits_school FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
  CONSTRAINT fk_teacher_workload_limits_year FOREIGN KEY (academic_year_id) REFERENCES academic_years (id) ON DELETE CASCADE,
  CONSTRAINT fk_teacher_workload_limits_teacher FOREIGN KEY (teacher_id) REFERENCES teachers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Create timetable_substitutions table
CREATE TABLE IF NOT EXISTS timetable_substitutions (
  id int NOT NULL AUTO_INCREMENT,
  school_id int NOT NULL,
  timetable_id int NOT NULL,
  substitution_date date NOT NULL,
  original_teacher_id int DEFAULT NULL,
  substitute_teacher_id int NOT NULL,
  reason varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  created_by int DEFAULT NULL,
  assigned_by int DEFAULT NULL,
  status enum('active','cancelled') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_timetable_substitutions_lookup (school_id, substitution_date),
  CONSTRAINT fk_timetable_substitutions_school FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
  CONSTRAINT fk_timetable_substitutions_timetable FOREIGN KEY (timetable_id) REFERENCES timetables (id) ON DELETE CASCADE,
  CONSTRAINT fk_timetable_substitutions_original_teacher FOREIGN KEY (original_teacher_id) REFERENCES teachers (id) ON DELETE SET NULL,
  CONSTRAINT fk_timetable_substitutions_substitute_teacher FOREIGN KEY (substitute_teacher_id) REFERENCES teachers (id) ON DELETE CASCADE,
  CONSTRAINT fk_timetable_substitutions_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_timetable_substitutions_assigned_by FOREIGN KEY (assigned_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. ALTER timetables table
ALTER TABLE timetables ADD COLUMN academic_year_id int NOT NULL;
ALTER TABLE timetables ADD COLUMN term_id int NOT NULL;
ALTER TABLE timetables ADD COLUMN version_id int NOT NULL;
ALTER TABLE timetables ADD COLUMN room_id int DEFAULT NULL;
ALTER TABLE timetables ADD COLUMN entry_type enum('teaching','class_teacher','sports','library','lab','activity','assembly') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'teaching';
ALTER TABLE timetables ADD COLUMN created_by int DEFAULT NULL;
ALTER TABLE timetables ADD COLUMN updated_by int DEFAULT NULL;

ALTER TABLE timetables ADD CONSTRAINT fk_timetables_year FOREIGN KEY (academic_year_id) REFERENCES academic_years (id) ON DELETE CASCADE;
ALTER TABLE timetables ADD CONSTRAINT fk_timetables_term FOREIGN KEY (term_id) REFERENCES academic_terms (id) ON DELETE CASCADE;
ALTER TABLE timetables ADD CONSTRAINT fk_timetables_version FOREIGN KEY (version_id) REFERENCES timetable_versions (id) ON DELETE CASCADE;
ALTER TABLE timetables ADD CONSTRAINT fk_timetables_room FOREIGN KEY (room_id) REFERENCES rooms (id) ON DELETE SET NULL;
ALTER TABLE timetables ADD CONSTRAINT fk_timetables_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE timetables ADD CONSTRAINT fk_timetables_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;

-- Update unique key unique_slot to (school_id, version_id, class_id, day_of_week, period_slot_id)
ALTER TABLE timetables DROP INDEX unique_slot;
ALTER TABLE timetables ADD UNIQUE KEY unique_slot (school_id, version_id, class_id, day_of_week, period_slot_id);

-- Additional indexes for teacher and room conflict check
ALTER TABLE timetables DROP INDEX idx_timetable_teacher_slot;
ALTER TABLE timetables ADD KEY idx_timetable_teacher_conflict (school_id, teacher_id, version_id, day_of_week, period_slot_id);
ALTER TABLE timetables ADD KEY idx_timetable_room_conflict (school_id, room_id, version_id, day_of_week, period_slot_id);
