# Razorpay transaction matrix

No live Razorpay calls were made.

| Case | Result |
|---|---|
| Monthly ₹999 amount / 99900 paise | PASS |
| Yearly configured amount | PASS |
| Month-end and leap-year calendar calculation | PASS |
| Valid mocked webhook signature | PASS |
| Tampered payload/signature | PASS |
| Database-backed order ownership and stored amount | Source audited; full disposable transaction test not completed |
| Sequential/concurrent callback idempotency | UNVERIFIED |
| Callback/webhook concurrency | UNVERIFIED |
| Invoice and receipt uniqueness | UNVERIFIED |
| Forced rollback after each transaction stage | UNVERIFIED |
| Fee allocation exactly once | UNVERIFIED |
| Scheduled renewal/future-plan precedence | Unit date logic passed; transaction path UNVERIFIED |

The project must not be considered payment-production-ready until every UNVERIFIED row is exercised against a disposable database with a mocked provider.
