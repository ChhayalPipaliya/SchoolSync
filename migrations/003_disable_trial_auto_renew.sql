ALTER TABLE subscriptions
    MODIFY COLUMN status ENUM('active', 'trial', 'scheduled', 'expired', 'cancelled')
    DEFAULT 'trial';

UPDATE subscriptions
SET auto_renew = 0,
    updated_at = NOW()
WHERE status = 'trial'
    OR trial_start_date IS NOT NULL
    OR trial_end_date IS NOT NULL
    OR LOWER(COALESCE(plan, '')) IN ('trial', 'free_trial', 'demo');
