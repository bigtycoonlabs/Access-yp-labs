-- Admin controls, subscription metadata, discounts, login audit, and performance records.

-- NOTE: the ALTER statements below target project_files / payment_plans — tables from the housing
-- product this platform pivoted away from. They do not exist in production and nothing in src/
-- references them, so they are wrapped in a guard: skipped when the table is absent, still applied
-- if some old environment still has it. Without this, a database rebuilt from this repo fails here.
DO $mig$
BEGIN
  IF to_regclass('payment_plans') IS NOT NULL THEN
    ALTER TABLE payment_plans
      ADD COLUMN IF NOT EXISTS billing_interval VARCHAR(20) NOT NULL DEFAULT 'one_time',
      ADD COLUMN IF NOT EXISTS subscription_tier VARCHAR(80),
      ADD COLUMN IF NOT EXISTS monthly_amount NUMERIC(10,2),
      ADD COLUMN IF NOT EXISTS growth_adjustment_rate NUMERIC(8,4),
      ADD COLUMN IF NOT EXISTS discount_code_id UUID;
  END IF;
END $mig$;

CREATE TABLE IF NOT EXISTS login_activity (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  email VARCHAR(255),
  success BOOLEAN NOT NULL DEFAULT FALSE,
  ip_address INET,
  user_agent TEXT,
  reason VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS discount_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(80) UNIQUE NOT NULL,
  description TEXT,
  discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('percent','amount')),
  discount_value NUMERIC(10,2) NOT NULL,
  max_redemptions INTEGER,
  redemptions INTEGER NOT NULL DEFAULT 0,
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS platform_performance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  -- Was a foreign key to the retired housing-era `projects` table. Kept as a plain column so the
  -- schema still rebuilds; there is no table left to point at, and nothing in src/ reads it.
  project_id UUID,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  reported_profit NUMERIC(12,2) NOT NULL DEFAULT 0,
  platform_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  growth_rate NUMERIC(8,4),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_login_activity_user ON login_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_login_activity_created ON login_activity(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_performance_user ON platform_performance(user_id);
CREATE INDEX IF NOT EXISTS idx_discount_codes_code ON discount_codes(code);
