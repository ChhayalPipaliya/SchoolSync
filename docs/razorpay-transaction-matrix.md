# Razorpay transaction matrix

No live Razorpay calls were made.

| Case | Result |
|---|---|
| Monthly ₹999 amount / 99900 paise | PASS |
| Yearly configured amount | PASS |
| Month-end and leap-year calendar calculation | PASS |
| Valid mocked webhook signature | PASS |
| Tampered payload/signature | PASS |
| Provider captured status, order, amount, and INR validation | PASS |
| Database-backed order ownership and stored amount | PASS |
| Sequential/concurrent callback idempotency | PASS |
| Callback/webhook concurrency | PASS |
| Invoice and canonical receipt uniqueness | PASS |
| Forced rollback after payment/allocation/subscription writes | PASS |
| Fee allocation exactly once, including multi-fee and superseded orders | PASS |
| Failed gateway fee replaced offline; late capture isolated for reconciliation | PASS |
| Failed subscription checkout superseded; only replacement activates | PASS |
| `order.paid` followed by `payment.captured` binds the captured payment ID | PASS |
| Canonical order lookup wins over colliding legacy aliases | PASS |
| Cross-school allocation rejection | PASS |
| Concurrent single-use QR generation | PASS |
| Scheduled renewal/future-plan precedence | PASS (unit date rules and database transaction path) |

Verified on 2026-07-13 with `npm test` (38 tests) and `npm run test:payments:mysql` (15 transaction tests). The MySQL suite uses a disposable database, invokes the production migration runner, mocks the Razorpay provider, and drops the database afterward. No live Razorpay calls were made.
