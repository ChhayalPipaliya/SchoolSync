ALTER TABLE class_subjects DROP FOREIGN KEY class_subjects_ibfk_3;
ALTER TABLE homeworks DROP FOREIGN KEY homeworks_ibfk_1;
ALTER TABLE teacher_attendance DROP FOREIGN KEY teacher_attendance_ibfk_2;

UPDATE class_subjects cs
JOIN teachers t ON t.user_id = cs.teacher_id AND t.school_id = cs.school_id
SET cs.teacher_id = t.id
WHERE cs.teacher_id IS NOT NULL;

UPDATE homeworks h
JOIN teachers t ON t.user_id = h.teacher_id AND t.school_id = h.school_id
SET h.teacher_id = t.id;

UPDATE teacher_attendance ta
JOIN teachers t ON t.user_id = ta.teacher_id AND t.school_id = ta.school_id
SET ta.teacher_id = t.id;

UPDATE timetables tt
JOIN teachers t ON t.user_id = tt.teacher_id AND t.school_id = tt.school_id
SET tt.teacher_id = t.id
WHERE tt.teacher_id IS NOT NULL;

UPDATE marks m
JOIN teachers t ON t.user_id = m.teacher_id AND t.school_id = m.school_id
LEFT JOIN teachers current_teacher ON current_teacher.id = m.teacher_id AND current_teacher.school_id = m.school_id
SET m.teacher_id = t.id
WHERE m.teacher_id IS NOT NULL AND current_teacher.id IS NULL;

ALTER TABLE class_subjects
  ADD CONSTRAINT class_subjects_ibfk_3
  FOREIGN KEY (teacher_id) REFERENCES teachers (id) ON DELETE SET NULL;

ALTER TABLE homeworks
  ADD CONSTRAINT homeworks_ibfk_1
  FOREIGN KEY (teacher_id) REFERENCES teachers (id) ON DELETE CASCADE;

ALTER TABLE teacher_attendance
  ADD CONSTRAINT teacher_attendance_ibfk_2
  FOREIGN KEY (teacher_id) REFERENCES teachers (id) ON DELETE CASCADE;

ALTER TABLE timetables
  ADD CONSTRAINT timetables_ibfk_3
  FOREIGN KEY (teacher_id) REFERENCES teachers (id) ON DELETE SET NULL;

ALTER TABLE marks ADD KEY idx_marks_teacher (teacher_id);
ALTER TABLE marks
  ADD CONSTRAINT marks_ibfk_5
  FOREIGN KEY (teacher_id) REFERENCES teachers (id) ON DELETE SET NULL;
