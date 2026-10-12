CREATE TABLE IF NOT EXISTS users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('employee', 'director', 'accounts')),
  employee_signature_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vouchers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  voucher_number BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  employee_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  expense_date DATE NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected')),
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS voucher_approvals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  voucher_id BIGINT NOT NULL UNIQUE REFERENCES vouchers(id) ON DELETE RESTRICT,
  director_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  director_signature_path TEXT,
  rejection_reason TEXT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (decision = 'approved' AND director_signature_path IS NOT NULL AND rejection_reason IS NULL)
    OR (decision = 'rejected' AND rejection_reason IS NOT NULL AND length(trim(rejection_reason)) > 0)
  )
);
