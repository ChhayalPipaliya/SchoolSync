# Parent feature status

| Feature | Existing route/controller/view/database support | Current status | Required action |
|---|---|---|---|
| Dashboard | `/parent/dashboard`; parent controller/view; attendance/homework/fees/notices tables | Working and mounted | None |
| Child switching | linked-child service and session existed; no route | Working and mounted | Added validated `/parent/children/switch` |
| Student profile | student/user/class data existed | Working and mounted | Added parent-scoped profile route/view |
| Attendance | parent controller/view and attendance table | Working and mounted | Explicit child tampering now rejected |
| Marks/results | parent result controller/view and marks/exams tables | Working and mounted | Explicit child tampering now rejected |
| Homework | parent controller/view and homework tables | Working and mounted | Explicit child tampering now rejected |
| Timetable | student implementation and timetable tables existed | Working and mounted | Added parent-scoped query and view; uses `teachers.id` join |
| Fees/history | parent fees controller/view and payment tables | Working and mounted | None |
| Receipts | payment records existed; parent route absent | Working and mounted | Added ownership-checked JSON receipt endpoint; no physical path returned |
| Notices | parent controller/view | Working and mounted | None |
| Meetings | shared meeting routes/controller/views already mounted in `app.js` | Working and mounted | Reused existing audience authorization |
| Library | student implementation and library tables existed | Working and mounted | Added parent-scoped read-only route/view |
| Certificates | school-admin implementation and issued table existed | Working and mounted | Added parent-scoped read-only route/view |
| Transport/live tracking | transport page existed; latest-location endpoint absent | Working and mounted | Added school/child/trip-scoped latest location endpoint |
| Upload | no parent business workflow requiring upload | Not applicable by existing business rules | Intentionally unsupported |
| Download | certificate PDF paths and homework files exist, but no safe parent download service | Partially implemented | Intentionally not mounted until storage abstraction can authorize and stream files without exposing paths |
