UPDATE fee_payments SET razorpay_order_id = NULL WHERE TRIM(COALESCE(razorpay_order_id, '')) = '';
UPDATE fee_payments SET razorpay_payment_id = NULL WHERE TRIM(COALESCE(razorpay_payment_id, '')) = '';
UPDATE fee_payments SET receipt_no = NULL WHERE TRIM(COALESCE(receipt_no, '')) = '';
UPDATE fee_payments SET receipt_number = NULL WHERE TRIM(COALESCE(receipt_number, '')) = '';

UPDATE subscription_payments SET razorpay_order_id = NULL WHERE TRIM(COALESCE(razorpay_order_id, '')) = '';
UPDATE subscription_payments SET razorpay_payment_id = NULL WHERE TRIM(COALESCE(razorpay_payment_id, '')) = '';

CREATE TABLE IF NOT EXISTS fee_payment_allocations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  school_id INT NOT NULL,
  payment_id INT NOT NULL,
  student_fee_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fee_payment_allocation (payment_id, student_fee_id),
  KEY idx_fee_allocations_school (school_id),
  KEY idx_fee_allocations_student_fee (student_fee_id),
  CONSTRAINT fee_payment_allocations_ibfk_1 FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
  CONSTRAINT fee_payment_allocations_ibfk_2 FOREIGN KEY (payment_id) REFERENCES fee_payments (id) ON DELETE CASCADE,
  CONSTRAINT fee_payment_allocations_ibfk_3 FOREIGN KEY (student_fee_id) REFERENCES student_fees (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE fee_payments
  MODIFY razorpay_order_id VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  MODIFY razorpay_payment_id VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL;

ALTER TABLE subscription_payments
  MODIFY razorpay_order_id VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  MODIFY razorpay_payment_id VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL;

ALTER TABLE fee_payments ADD UNIQUE KEY uq_fee_payments_razorpay_order (razorpay_order_id);
ALTER TABLE fee_payments ADD UNIQUE KEY uq_fee_payments_razorpay_payment (razorpay_payment_id);
ALTER TABLE fee_payments ADD UNIQUE KEY uq_fee_payments_receipt_no (receipt_no);
ALTER TABLE fee_payments ADD UNIQUE KEY uq_fee_payments_receipt_number (receipt_number);

ALTER TABLE subscription_payments ADD UNIQUE KEY uq_subpay_razorpay_order (razorpay_order_id);
ALTER TABLE subscription_payments ADD UNIQUE KEY uq_subpay_razorpay_payment (razorpay_payment_id);
ALTER TABLE subscription_payments ADD UNIQUE KEY uq_subpay_receipt (receipt_no);
ALTER TABLE subscription_payments ADD UNIQUE KEY uq_subpay_subscription (subscription_id);

ALTER TABLE invoices ADD UNIQUE KEY uq_invoices_subscription (subscription_id);
