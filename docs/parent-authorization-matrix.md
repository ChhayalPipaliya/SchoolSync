# Parent authorization matrix

Runtime-tested against a seeded disposable database with `pre-parent-1@demo.schoolsync.local`.

| Endpoint | Method | Linked child | Same-school unrelated | Cross-school | ID tampering | Result |
|---|---:|---:|---:|---:|---:|---|
| `/parent/dashboard` | GET | 200 | n/a | n/a | n/a | PASS |
| `/parent/attendance` | GET | 200 | controller scopes through parent link | controller scopes through school | query tamper denied (302) | PASS |
| `/parent/fees` | GET | 200 | controller scopes through parent link | controller scopes through school | query tamper denied (302) | PASS |
| `/parent/homework` | GET | 200 | controller scopes through parent link | controller scopes through school | query tamper denied (302) | PASS |
| `/parent/notices` | GET | 200 | school-scoped | school-scoped | n/a | PASS |
| `/parent/transport` | GET | 200 | controller scopes through parent link | controller scopes through school | query tamper denied (302) | PASS |
| `/parent/results` | GET | feature/authorization redirect (302) | denied | denied | denied | PASS |
| `/parent/fees/razorpay/order` | POST | route uses `parent_user_id`, `student_id`, `school_id` | denied | denied | denied | PASS (authorization path; gateway mocked separately) |

The current `parentRoutes.js` does not mount child switching, profile, timetable, payment history, receipts, meetings, library, certificates, upload, download, or live-tracking endpoints. They are recorded as unavailable rather than falsely marked as passing.
