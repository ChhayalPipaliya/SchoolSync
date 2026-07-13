# Teacher mutation runtime matrix

| Workflow | Assignment enforcement | Tenant enforcement | Runtime mutation exercised | Result |
|---|---|---|---|---|
| Attendance save/update | resolves user to `teachers.id`; assigned class required | `school_id` on teacher, class, student, attendance | Not fully exercised against disposable DB | UNVERIFIED |
| Homework create/delete | `canTeachSubject(teachers.id, school_id, class_id, subject_id)` | school-scoped ownership queries | Not fully exercised against disposable DB | UNVERIFIED |
| Marks create/update | assignment and exam/class checks use `teachers.id` | school/class/student filters | Not fully exercised against disposable DB | UNVERIFIED |
| Student progress | assigned class required | school/student filters | tampered ID rejected in prior HTTP pass | PASS (read path) |
| Exam/timetable access | teacher assignments | school-scoped joins | authenticated GET paths exercised | PASS (read path) |
| Leave create/update | authenticated teacher identity | school/user filters | Not fully exercised against disposable DB | UNVERIFIED |

This report deliberately does not treat source inspection or GET status codes as mutation verification.
