-- SchoolSync current-code compatibility migration.

CREATE TABLE IF NOT EXISTS school_groups (
  id int unsigned NOT NULL AUTO_INCREMENT,
  group_name varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  owner_name varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  email varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  phone varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  city varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  address text COLLATE utf8mb4_unicode_ci,
  status enum('active','inactive') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  created_by int DEFAULT NULL,
  updated_by int DEFAULT NULL,
  created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_school_groups_name (group_name),
  KEY idx_school_groups_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS group_admins (
  id int unsigned NOT NULL AUTO_INCREMENT,
  user_id int NOT NULL,
  school_group_id int unsigned NOT NULL,
  status enum('active','inactive') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_group_admins_user (user_id),
  KEY idx_group_admins_group_status (school_group_id, status),
  CONSTRAINT fk_group_admins_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_group_admins_group FOREIGN KEY (school_group_id) REFERENCES school_groups (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS group_admin_schools (
  id int unsigned NOT NULL AUTO_INCREMENT,
  group_admin_id int unsigned NOT NULL,
  school_id int NOT NULL,
  status enum('active','inactive') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_group_admin_schools_assignment (group_admin_id, school_id),
  KEY idx_group_admin_schools_school_status (school_id, status),
  CONSTRAINT fk_group_admin_schools_admin FOREIGN KEY (group_admin_id) REFERENCES group_admins (id) ON DELETE CASCADE,
  CONSTRAINT fk_group_admin_schools_school FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS school_chat_permissions (
  id int unsigned NOT NULL AUTO_INCREMENT,
  school_id int NOT NULL,
  sender_role varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  receiver_role varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  is_allowed tinyint(1) NOT NULL DEFAULT 0,
  is_locked tinyint(1) NOT NULL DEFAULT 0,
  updated_by int DEFAULT NULL,
  created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_school_chat_pair (school_id, sender_role, receiver_role),
  KEY idx_school_chat_school (school_id),
  CONSTRAINT fk_school_chat_school FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sections (
  id int unsigned NOT NULL AUTO_INCREMENT,
  school_id int NOT NULL,
  class_id int NOT NULL,
  section_name varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  capacity int unsigned NOT NULL DEFAULT 40,
  status enum('active','inactive') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  created_by int DEFAULT NULL,
  updated_by int DEFAULT NULL,
  created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sections_school_class_name (school_id, class_id, section_name),
  KEY idx_sections_class_status (class_id, status),
  CONSTRAINT fk_sections_school FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
  CONSTRAINT fk_sections_class FOREIGN KEY (class_id) REFERENCES classes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS academic_years (
  id int unsigned NOT NULL AUTO_INCREMENT,
  school_id int NOT NULL,
  code varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  name varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  start_date date DEFAULT NULL,
  end_date date DEFAULT NULL,
  status enum('active','inactive','archived') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  created_by int DEFAULT NULL,
  updated_by int DEFAULT NULL,
  created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_academic_year_school_code (school_id, code),
  KEY idx_academic_year_status (school_id, status),
  CONSTRAINT fk_academic_year_school FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS student_academic_records (
  id int unsigned NOT NULL AUTO_INCREMENT,
  school_id int NOT NULL,
  student_id int NOT NULL,
  academic_year_id int unsigned NOT NULL,
  class_id int NOT NULL,
  roll_number varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  enrollment_status enum('active','promoted','repeated','graduated','inactive','transferred') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  result_status enum('pass','fail','pending') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  promoted_from_record_id int unsigned DEFAULT NULL,
  created_by int DEFAULT NULL,
  updated_by int DEFAULT NULL,
  created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_student_year_record (school_id, student_id, academic_year_id),
  KEY idx_sar_class_status (school_id, class_id, enrollment_status),
  KEY idx_sar_year_status (academic_year_id, enrollment_status),
  CONSTRAINT fk_sar_school FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
  CONSTRAINT fk_sar_student FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE,
  CONSTRAINT fk_sar_year FOREIGN KEY (academic_year_id) REFERENCES academic_years (id) ON DELETE CASCADE,
  CONSTRAINT fk_sar_class FOREIGN KEY (class_id) REFERENCES classes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS student_promotion_batches (
  id int unsigned NOT NULL AUTO_INCREMENT,
  school_id int NOT NULL,
  from_academic_year_id int unsigned NOT NULL,
  to_academic_year_id int unsigned NOT NULL,
  from_class_id int DEFAULT NULL,
  status enum('draft','previewed','completed','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'previewed',
  total_students int unsigned NOT NULL DEFAULT 0,
  promoted_count int unsigned NOT NULL DEFAULT 0,
  repeated_count int unsigned NOT NULL DEFAULT 0,
  skipped_count int unsigned NOT NULL DEFAULT 0,
  graduated_count int unsigned NOT NULL DEFAULT 0,
  created_by int DEFAULT NULL,
  updated_by int DEFAULT NULL,
  created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_spb_school_status (school_id, status, created_at),
  KEY idx_spb_years (from_academic_year_id, to_academic_year_id),
  CONSTRAINT fk_spb_school FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
  CONSTRAINT fk_spb_from_year FOREIGN KEY (from_academic_year_id) REFERENCES academic_years (id) ON DELETE RESTRICT,
  CONSTRAINT fk_spb_to_year FOREIGN KEY (to_academic_year_id) REFERENCES academic_years (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS student_promotion_items (
  id int unsigned NOT NULL AUTO_INCREMENT,
  batch_id int unsigned NOT NULL,
  student_id int NOT NULL,
  from_academic_record_id int unsigned NOT NULL,
  from_class_id int NOT NULL,
  to_class_id int DEFAULT NULL,
  result_status enum('pass','fail','pending') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  promotion_action enum('promote','repeat','skip','graduate') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'promote',
  reason varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_spi_batch_student (batch_id, student_id),
  KEY idx_spi_student (student_id),
  KEY idx_spi_action (promotion_action),
  CONSTRAINT fk_spi_batch FOREIGN KEY (batch_id) REFERENCES student_promotion_batches (id) ON DELETE CASCADE,
  CONSTRAINT fk_spi_student FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE,
  CONSTRAINT fk_spi_record FOREIGN KEY (from_academic_record_id) REFERENCES student_academic_records (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS driver_documents (
  id int unsigned NOT NULL AUTO_INCREMENT,
  driver_id int unsigned NOT NULL,
  document_name varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  document_type varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  document_path varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  file_path varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  file_url varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  status enum('active','expired','rejected','pending') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  expiry_date date DEFAULT NULL,
  uploaded_at datetime DEFAULT CURRENT_TIMESTAMP,
  created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_driver_documents_driver (driver_id),
  KEY idx_driver_documents_type_status (document_type, status),
  CONSTRAINT fk_driver_documents_driver FOREIGN KEY (driver_id) REFERENCES drivers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE schools ADD COLUMN current_plan_id int unsigned DEFAULT NULL AFTER plan_id;
ALTER TABLE schools ADD COLUMN subscription_status enum('active','trial','expired','cancelled','inactive') COLLATE utf8mb4_unicode_ci DEFAULT 'trial' AFTER status;
ALTER TABLE schools ADD COLUMN trial_started_at datetime DEFAULT NULL AFTER subscription_status;
ALTER TABLE schools ADD COLUMN subscription_started_at datetime DEFAULT NULL AFTER trial_ends_at;
ALTER TABLE schools ADD COLUMN subscription_ends_at datetime DEFAULT NULL AFTER subscription_started_at;
ALTER TABLE schools ADD COLUMN school_group_id int unsigned DEFAULT NULL AFTER is_trial_used;
ALTER TABLE schools ADD COLUMN branch_name varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER school_group_id;
ALTER TABLE schools ADD COLUMN area varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER branch_name;
ALTER TABLE schools ADD COLUMN branch_code varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER area;
ALTER TABLE schools ADD KEY idx_schools_current_plan_id (current_plan_id);
ALTER TABLE schools ADD KEY idx_schools_school_group_id (school_group_id);
ALTER TABLE schools ADD KEY idx_schools_branch_code (branch_code);

ALTER TABLE meetings ADD COLUMN room_name varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER description;
ALTER TABLE meetings ADD COLUMN scheduled_at datetime DEFAULT NULL AFTER room_name;
ALTER TABLE meetings ADD COLUMN duration_minutes int DEFAULT NULL AFTER scheduled_at;
ALTER TABLE meetings ADD COLUMN creator_role varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER created_by;
ALTER TABLE meetings ADD COLUMN target_type enum('all','teachers','students','parents','staff','drivers','librarians','school_admin','specific_class','multiple_classes') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'all' AFTER duration_minutes;
ALTER TABLE meetings ADD COLUMN target_class_id int DEFAULT NULL AFTER target_type;
ALTER TABLE meetings ADD COLUMN started_at datetime DEFAULT NULL AFTER status;
ALTER TABLE meetings ADD COLUMN ended_at datetime DEFAULT NULL AFTER started_at;
ALTER TABLE meetings ADD COLUMN cancelled_at datetime DEFAULT NULL AFTER ended_at;
ALTER TABLE meetings ADD COLUMN cancelled_by int DEFAULT NULL AFTER cancelled_at;
ALTER TABLE meetings ADD COLUMN cancel_reason text COLLATE utf8mb4_unicode_ci AFTER cancelled_by;
ALTER TABLE meetings ADD COLUMN updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;
ALTER TABLE meetings ADD UNIQUE KEY uq_meetings_room_name (room_name);
ALTER TABLE meetings ADD KEY idx_meetings_scheduled_at (school_id, scheduled_at);
ALTER TABLE meetings ADD KEY idx_meetings_target_class_id (target_class_id);
ALTER TABLE meetings ADD KEY idx_meetings_cancelled_by (cancelled_by);
ALTER TABLE meetings ADD CONSTRAINT fk_meetings_target_class FOREIGN KEY (target_class_id) REFERENCES classes (id) ON DELETE SET NULL;
ALTER TABLE meetings ADD CONSTRAINT fk_meetings_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES users (id) ON DELETE SET NULL;
UPDATE meetings SET scheduled_at = CONCAT(meeting_date, ' ', start_time) WHERE scheduled_at IS NULL AND meeting_date IS NOT NULL AND start_time IS NOT NULL;

ALTER TABLE support_tickets ADD COLUMN reporter_name varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER user_id;
ALTER TABLE support_tickets ADD COLUMN reporter_email varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER reporter_name;
ALTER TABLE support_tickets ADD KEY idx_support_tickets_reporter_email (reporter_email);

ALTER TABLE teacher_class_assign ADD COLUMN medium varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER subject_id;
ALTER TABLE teacher_class_assign ADD COLUMN academic_year varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER medium;
ALTER TABLE teacher_class_assign ADD COLUMN status enum('active','inactive') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' AFTER academic_year;
ALTER TABLE teacher_class_assign ADD COLUMN assigned_by int DEFAULT NULL AFTER status;
ALTER TABLE teacher_class_assign ADD KEY idx_tca_status (school_id, status);
ALTER TABLE teacher_class_assign ADD KEY idx_tca_assigned_by (assigned_by);

ALTER TABLE vehicles ADD COLUMN ownership_type enum('school_owned','contract') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'school_owned' AFTER fuel_type;
ALTER TABLE vehicles ADD COLUMN gps_device_id varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER fuel_type;
ALTER TABLE vehicles ADD COLUMN permit_expiry date DEFAULT NULL AFTER insurance_expiry;
ALTER TABLE vehicles ADD COLUMN fitness_expiry date DEFAULT NULL AFTER permit_expiry;
ALTER TABLE vehicles ADD COLUMN puc_expiry date DEFAULT NULL AFTER insurance_expiry;
ALTER TABLE vehicles ADD COLUMN next_service_date date DEFAULT NULL AFTER last_service_date;
ALTER TABLE vehicles ADD COLUMN vehicle_photo varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER color;
ALTER TABLE vehicles ADD COLUMN odometer_reading int DEFAULT NULL AFTER next_service_date;

ALTER TABLE routes ADD COLUMN school_shift enum('morning','evening','full_day') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'full_day' AFTER status;
ALTER TABLE routes ADD COLUMN zone varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER school_shift;
ALTER TABLE routes ADD COLUMN route_code varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER zone;
ALTER TABLE routes ADD KEY idx_routes_shift_zone (school_id, school_shift, zone);
ALTER TABLE routes ADD KEY idx_routes_route_code (school_id, route_code);

CREATE TABLE IF NOT EXISTS student_address_transport (
  id int NOT NULL AUTO_INCREMENT,
  student_id int NOT NULL,
  permanent_address text COLLATE utf8mb4_unicode_ci,
  permanent_city varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  permanent_state varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  permanent_pincode varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  current_address_same tinyint(1) DEFAULT 0,
  current_address text COLLATE utf8mb4_unicode_ci,
  current_city varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  current_state varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  current_pincode varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  emergency_contact varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  emergency_contact_name varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  transport_required tinyint(1) DEFAULT 0,
  transport_mode varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  transport_route varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  transport_vehicle_no varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  pickup_point varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  drop_point varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  hostel_required tinyint(1) DEFAULT 0,
  hostel_name varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  hostel_room_no varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  hostel_phone_number varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_student_address_transport_student (student_id),
  KEY idx_sat_transport_required (transport_required)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vehicle_checklists (
  id int NOT NULL AUTO_INCREMENT,
  school_id int NOT NULL,
  vehicle_id int NOT NULL,
  driver_id int NOT NULL,
  check_date date NOT NULL,
  checklist_data json DEFAULT NULL,
  notes text COLLATE utf8mb4_unicode_ci,
  odometer_reading int DEFAULT NULL,
  all_passed tinyint(1) DEFAULT 1,
  created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vehicle_checklist_day (school_id, vehicle_id, check_date),
  KEY idx_vehicle_checklists_driver (school_id, driver_id, check_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS transport_trip_locations (
  id int NOT NULL AUTO_INCREMENT,
  school_id int NOT NULL,
  trip_id int DEFAULT NULL,
  vehicle_id int DEFAULT NULL,
  driver_id int DEFAULT NULL,
  latitude decimal(10,7) DEFAULT NULL,
  longitude decimal(10,7) DEFAULT NULL,
  speed decimal(8,2) DEFAULT 0,
  heading decimal(8,2) DEFAULT NULL,
  accuracy decimal(8,2) DEFAULT NULL,
  recorded_at datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ttl_trip_time (school_id, trip_id, recorded_at),
  KEY idx_ttl_driver_time (school_id, driver_id, recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS driver_vehicle_assign (
  id int NOT NULL AUTO_INCREMENT,
  school_id int DEFAULT NULL,
  driver_id int NOT NULL,
  vehicle_id int NOT NULL,
  assigned_date date DEFAULT NULL,
  assigned_from date DEFAULT NULL,
  assigned_to date DEFAULT NULL,
  is_active tinyint(1) DEFAULT 1,
  status enum('active','inactive') COLLATE utf8mb4_unicode_ci DEFAULT 'active',
  created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_dva_driver_active (driver_id, is_active),
  KEY idx_dva_vehicle_active (vehicle_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS student_transport_allocations (
  id int NOT NULL AUTO_INCREMENT,
  school_id int NOT NULL,
  student_id int NOT NULL,
  route_id int DEFAULT NULL,
  vehicle_id int DEFAULT NULL,
  driver_id int DEFAULT NULL,
  pickup_stop_id int DEFAULT NULL,
  drop_stop_id int DEFAULT NULL,
  status enum('active','inactive','paused') COLLATE utf8mb4_unicode_ci DEFAULT 'active',
  created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sta_route_status (school_id, route_id, status),
  KEY idx_sta_student_status (school_id, student_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS transport_trips (
  id int NOT NULL AUTO_INCREMENT,
  school_id int NOT NULL,
  route_id int DEFAULT NULL,
  vehicle_id int DEFAULT NULL,
  driver_id int DEFAULT NULL,
  trip_type enum('pickup','drop') COLLATE utf8mb4_unicode_ci DEFAULT 'pickup',
  trip_date date DEFAULT NULL,
  status enum('scheduled','running','completed','cancelled') COLLATE utf8mb4_unicode_ci DEFAULT 'scheduled',
  created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_transport_trips_driver_day (school_id, driver_id, trip_date, status),
  KEY idx_transport_trips_route_day (school_id, route_id, trip_date, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS transport_trip_students (
  id int NOT NULL AUTO_INCREMENT,
  school_id int NOT NULL,
  trip_id int NOT NULL,
  student_id int NOT NULL,
  status enum('pending','picked','dropped','absent','missed','no_show') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  marked_at datetime DEFAULT NULL,
  created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_transport_trip_student (school_id, trip_id, student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS transport_alerts (
  id int NOT NULL AUTO_INCREMENT,
  school_id int NOT NULL,
  vehicle_id int DEFAULT NULL,
  driver_id int DEFAULT NULL,
  alert_type varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  title varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  message text COLLATE utf8mb4_unicode_ci,
  status enum('open','resolved','dismissed') COLLATE utf8mb4_unicode_ci DEFAULT 'open',
  created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_transport_alerts_school_status (school_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE drivers ADD COLUMN first_name varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL;
ALTER TABLE drivers ADD COLUMN last_name varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL;
ALTER TABLE drivers ADD COLUMN firstName varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL;
ALTER TABLE drivers ADD COLUMN lastName varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL;
UPDATE drivers SET first_name = COALESCE(first_name, firstName), last_name = COALESCE(last_name, lastName);

ALTER TABLE vehicles ADD COLUMN vehicle_number varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL;
ALTER TABLE vehicles ADD COLUMN registration_number varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL;
ALTER TABLE vehicles ADD COLUMN vehicle_no varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL;
ALTER TABLE vehicles ADD COLUMN bus_no varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL;
ALTER TABLE vehicles ADD COLUMN registration_no varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL;
ALTER TABLE vehicles ADD COLUMN model varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL;
ALTER TABLE vehicles ADD COLUMN type varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL;
ALTER TABLE vehicles ADD COLUMN color varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL;
UPDATE vehicles SET vehicle_number = COALESCE(vehicle_number, vehicle_no, bus_no), registration_number = COALESCE(registration_number, registration_no);

ALTER TABLE driver_vehicle_assign ADD COLUMN school_id int DEFAULT NULL;
ALTER TABLE driver_vehicle_assign ADD COLUMN assigned_date date DEFAULT NULL;
ALTER TABLE driver_vehicle_assign ADD COLUMN is_active tinyint(1) DEFAULT 1;
UPDATE driver_vehicle_assign dva JOIN drivers d ON dva.driver_id = d.id SET dva.school_id = COALESCE(dva.school_id, d.school_id);

ALTER TABLE transport_route_stops ADD COLUMN stop_address varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL;
ALTER TABLE transport_route_stops ADD COLUMN estimated_students int DEFAULT 0;
ALTER TABLE transport_route_stops ADD COLUMN created_by int DEFAULT NULL;
ALTER TABLE transport_route_stops ADD COLUMN updated_by int DEFAULT NULL;
ALTER TABLE transport_route_stops ADD COLUMN updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE student_transport_allocations ADD COLUMN stop_id int DEFAULT NULL;
ALTER TABLE student_transport_allocations ADD COLUMN fee_plan_id int DEFAULT NULL;
ALTER TABLE student_transport_allocations ADD COLUMN start_date date DEFAULT NULL;
ALTER TABLE student_transport_allocations ADD COLUMN end_date date DEFAULT NULL;
ALTER TABLE student_transport_allocations ADD COLUMN allocation_start_date date DEFAULT NULL;
ALTER TABLE student_transport_allocations ADD COLUMN allocation_end_date date DEFAULT NULL;
ALTER TABLE student_transport_allocations ADD COLUMN pickup_required tinyint(1) DEFAULT 1;
ALTER TABLE student_transport_allocations ADD COLUMN drop_required tinyint(1) DEFAULT 1;
ALTER TABLE student_transport_allocations ADD COLUMN pickup_address varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL;
ALTER TABLE student_transport_allocations ADD COLUMN pickup_latitude decimal(10,7) DEFAULT NULL;
ALTER TABLE student_transport_allocations ADD COLUMN pickup_longitude decimal(10,7) DEFAULT NULL;
ALTER TABLE student_transport_allocations ADD COLUMN drop_address varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL;
ALTER TABLE student_transport_allocations ADD COLUMN drop_latitude decimal(10,7) DEFAULT NULL;
ALTER TABLE student_transport_allocations ADD COLUMN drop_longitude decimal(10,7) DEFAULT NULL;
ALTER TABLE student_transport_allocations ADD COLUMN notes text COLLATE utf8mb4_unicode_ci;
ALTER TABLE student_transport_allocations ADD COLUMN created_by int DEFAULT NULL;
ALTER TABLE student_transport_allocations ADD COLUMN updated_by int DEFAULT NULL;
ALTER TABLE student_transport_allocations ADD COLUMN updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE student_transport_allocations MODIFY COLUMN status enum('active','inactive','paused') COLLATE utf8mb4_unicode_ci DEFAULT 'active';
UPDATE student_transport_allocations SET allocation_start_date = COALESCE(allocation_start_date, start_date), allocation_end_date = COALESCE(allocation_end_date, end_date);

ALTER TABLE transport_trips MODIFY COLUMN status enum('scheduled','started','active','running','completed','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'scheduled';
UPDATE transport_trips SET status = 'running' WHERE status IN ('started','active');
ALTER TABLE transport_trips MODIFY COLUMN status enum('scheduled','running','completed','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'scheduled';
ALTER TABLE transport_trips ADD COLUMN trip_shift enum('morning','evening','full_day') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'full_day';
ALTER TABLE transport_trips ADD COLUMN start_time datetime DEFAULT NULL;
ALTER TABLE transport_trips ADD COLUMN end_time datetime DEFAULT NULL;
ALTER TABLE transport_trips ADD COLUMN start_at datetime DEFAULT NULL;
ALTER TABLE transport_trips ADD COLUMN end_at datetime DEFAULT NULL;
ALTER TABLE transport_trips ADD COLUMN started_at datetime DEFAULT NULL;
ALTER TABLE transport_trips ADD COLUMN ended_at datetime DEFAULT NULL;
ALTER TABLE transport_trips ADD COLUMN picked_count int DEFAULT 0;
ALTER TABLE transport_trips ADD COLUMN dropped_count int DEFAULT 0;
ALTER TABLE transport_trips ADD COLUMN absent_count int DEFAULT 0;
ALTER TABLE transport_trips ADD COLUMN missed_count int DEFAULT 0;
ALTER TABLE transport_trips ADD COLUMN no_show_count int DEFAULT 0;
ALTER TABLE transport_trips ADD COLUMN created_by int DEFAULT NULL;
ALTER TABLE transport_trips ADD COLUMN updated_by int DEFAULT NULL;
UPDATE transport_trips SET start_at = COALESCE(start_at, start_time), started_at = COALESCE(started_at, start_at, start_time), end_at = COALESCE(end_at, end_time), ended_at = COALESCE(ended_at, end_at, end_time);

ALTER TABLE transport_trip_students MODIFY COLUMN status enum('assigned','pending','picked','dropped','absent','missed','no_show') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending';
UPDATE transport_trip_students SET status = 'pending' WHERE status = 'assigned';
ALTER TABLE transport_trip_students MODIFY COLUMN status enum('pending','picked','dropped','absent','missed','no_show') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending';
ALTER TABLE transport_trip_students ADD COLUMN allocation_id int DEFAULT NULL;
ALTER TABLE transport_trip_students ADD COLUMN pickup_stop_id int DEFAULT NULL;
ALTER TABLE transport_trip_students ADD COLUMN drop_stop_id int DEFAULT NULL;
ALTER TABLE transport_trip_students ADD COLUMN picked_at datetime DEFAULT NULL;
ALTER TABLE transport_trip_students ADD COLUMN dropped_at datetime DEFAULT NULL;
ALTER TABLE transport_trip_students ADD COLUMN marked_at datetime DEFAULT NULL;
ALTER TABLE transport_trip_students ADD COLUMN remarks text COLLATE utf8mb4_unicode_ci;
ALTER TABLE transport_trip_students ADD COLUMN pickup_latitude decimal(10,7) DEFAULT NULL;
ALTER TABLE transport_trip_students ADD COLUMN pickup_longitude decimal(10,7) DEFAULT NULL;
ALTER TABLE transport_trip_students ADD COLUMN drop_latitude decimal(10,7) DEFAULT NULL;
ALTER TABLE transport_trip_students ADD COLUMN drop_longitude decimal(10,7) DEFAULT NULL;
ALTER TABLE transport_trip_students ADD COLUMN created_by int DEFAULT NULL;
ALTER TABLE transport_trip_students ADD COLUMN updated_by int DEFAULT NULL;
ALTER TABLE transport_trip_students ADD COLUMN updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE transport_trip_locations ADD COLUMN heading decimal(8,2) DEFAULT NULL;
ALTER TABLE transport_trip_locations ADD COLUMN accuracy decimal(8,2) DEFAULT NULL;

ALTER TABLE transport_alerts ADD COLUMN student_id int DEFAULT NULL;
ALTER TABLE transport_alerts ADD COLUMN route_id int DEFAULT NULL;
ALTER TABLE transport_alerts ADD COLUMN trip_id int DEFAULT NULL;
ALTER TABLE transport_alerts ADD COLUMN target_role varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL;
ALTER TABLE transport_alerts ADD COLUMN target_user_id int DEFAULT NULL;
ALTER TABLE transport_alerts ADD COLUMN resolved_at datetime DEFAULT NULL;
ALTER TABLE transport_alerts ADD COLUMN dismissed_at datetime DEFAULT NULL;
ALTER TABLE transport_alerts ADD COLUMN created_by int DEFAULT NULL;
ALTER TABLE transport_alerts ADD COLUMN updated_by int DEFAULT NULL;
ALTER TABLE transport_alerts ADD COLUMN updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE transport_alerts MODIFY COLUMN status enum('open','resolved','dismissed','pending','sent','read','failed','active','new') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open';
UPDATE transport_alerts SET status = 'open' WHERE status IN ('pending','sent','read','failed','active','new');
ALTER TABLE transport_alerts MODIFY COLUMN status enum('open','resolved','dismissed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open';

ALTER TABLE transport_fee_plans ADD COLUMN plan_name varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL;
ALTER TABLE transport_fee_plans ADD COLUMN name varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL;
ALTER TABLE transport_fee_plans ADD COLUMN fee_amount decimal(10,2) DEFAULT 0.00;
ALTER TABLE transport_fee_plans ADD COLUMN amount decimal(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE transport_fee_plans ADD COLUMN stop_id int DEFAULT NULL;
ALTER TABLE transport_fee_plans ADD COLUMN effective_from date DEFAULT NULL;
ALTER TABLE transport_fee_plans ADD COLUMN effective_to date DEFAULT NULL;
ALTER TABLE transport_fee_plans ADD COLUMN created_by int DEFAULT NULL;
ALTER TABLE transport_fee_plans ADD COLUMN updated_by int DEFAULT NULL;
UPDATE transport_fee_plans SET plan_name = COALESCE(plan_name, name), fee_amount = COALESCE(fee_amount, amount), amount = COALESCE(NULLIF(amount, 0), fee_amount, 0);
