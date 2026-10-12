ALTER TABLE vouchers
  ADD COLUMN IF NOT EXISTS department TEXT,
  ADD COLUMN IF NOT EXISTS expense_title TEXT,
  ADD COLUMN IF NOT EXISTS voucher_date DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS employee_signature_path TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS director_signature_path TEXT;

CREATE INDEX IF NOT EXISTS vouchers_employee_created_idx
  ON vouchers (employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vouchers_status_date_idx
  ON vouchers (status, expense_date DESC);
