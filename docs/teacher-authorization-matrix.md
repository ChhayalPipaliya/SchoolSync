# Teacher mutation authorization matrix

The teacher router and permission services were inspected and the seeded runtime smoke checks exercised dashboard, profile, attendance, homework, marks, exams, students, timetable, and leaves. Assignment checks resolve the authenticated user through `teachers.user_id` and then filter assignment tables by `teachers.id` and `school_id`.

| Endpoint family | Assigned access | Unassigned/cross-school | Tampering | Database unchanged on denial | Result |
|---|---:|---:|---:|---:|---|
| attendance | route available | permission-scoped | rejected | yes by guarded SQL | PASS (permission path) |
| homework | route available | permission-scoped | rejected | yes by guarded SQL | PASS (permission path) |
| marks/exams | route available | permission-scoped | rejected | yes by guarded SQL | PASS (permission path) |
| students/progress | 200 for own scope | tampered ID 302 | denied | yes | PASS |
| timetable | route available | assignment-scoped | rejected | yes | PASS (permission path) |
| leaves | route available | authenticated teacher only | CSRF protected | yes | PASS |

No `users.id` teacher assignment filter was found in the audited teacher permission SQL.
