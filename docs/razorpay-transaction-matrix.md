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
| Cross-school allocation rejection | PASS |
| Concurrent single-use QR generation | PASS |
| Scheduled renewal/future-plan precedence | PASS (unit date rules and database transaction path) |

Verified on 2026-07-13 with `npm run test:unit` and `npm run test:payments:mysql`. The MySQL suite uses a disposable database, invokes the production migration runner, mocks the Razorpay provider, and drops the database afterward. No live Razorpay calls were made.
