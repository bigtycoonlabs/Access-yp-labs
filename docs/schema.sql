-- ═══════════════════════════════════════════════════
-- YP LABS — PostgreSQL Schema
-- Run this against your Supabase / Neon database
-- ═══════════════════════════════════════════════════

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── USERS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           VARCHAR(255) UNIQUE NOT NULL,
  password_hash   TEXT,
  name            VARCHAR(255) NOT NULL,
  role            VARCHAR(50) NOT NULL DEFAULT 'client'
                  CHECK (role IN ('client','staff','admin','master_staff')),
  status          VARCHAR(50) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('pending','active','suspended')),
  phone           VARCHAR(50),
  business_name   VARCHAR(255),
  referral_source VARCHAR(255),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ
);

-- ── WIZARD SUBMISSIONS ─────────────────────────────
CREATE TABLE IF NOT EXISTS wizard_submissions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  track           CHAR(1) NOT NULL CHECK (track IN ('A','B')),
  housing_type    VARCHAR(100),
  channel         VARCHAR(100),
  mission         TEXT,
  brand_color     VARCHAR(20),
  payment_plan    VARCHAR(20) NOT NULL CHECK (payment_plan IN ('one_time','financed')),
  subtotal        NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── SERVICE CATALOG ────────────────────────────────
CREATE TABLE IF NOT EXISTS service_catalog (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_type    VARCHAR(100) UNIQUE NOT NULL,
  name            VARCHAR(255) NOT NULL,
  price           NUMERIC(10,2) NOT NULL,
  sla_hours       INTEGER NOT NULL,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at      TIMESTAMPTZ
);

INSERT INTO service_catalog (service_type, name, price, sla_hours) VALUES
  ('arbitrage_access', 'YP Labs Arbo + Equity Arbitrage Access', 997.00, 24)
ON CONFLICT (service_type) DO NOTHING;

-- ── PROJECTS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wizard_submission_id  UUID REFERENCES wizard_submissions(id),
  track                 CHAR(1) NOT NULL CHECK (track IN ('A','B')),
  status                VARCHAR(50) NOT NULL DEFAULT 'awaiting_specialist_contact'
                        CHECK (status IN (
                          'awaiting_specialist_contact','onboarding',
                          'awaiting_payment','in_production','delivered','cancelled'
                        )),
  payment_plan          VARCHAR(20) NOT NULL DEFAULT 'one_time',
  subtotal              NUMERIC(10,2) NOT NULL DEFAULT 0,
  financed_total        NUMERIC(10,2),
  installment_amount    NUMERIC(10,2),
  hosting_monthly       NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  assigned_specialist   VARCHAR(255),
  internal_notes        TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ
);

-- ── ORDER LINE ITEMS ───────────────────────────────
CREATE TABLE IF NOT EXISTS order_line_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  service_type  VARCHAR(100) NOT NULL,
  label         VARCHAR(255) NOT NULL,
  amount        NUMERIC(10,2) NOT NULL DEFAULT 0,
  sla_hours     INTEGER,
  deadline      TIMESTAMPTZ,
  status        VARCHAR(50) NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','in_progress','delivered','cancelled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── MILESTONES ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS milestones (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title           VARCHAR(255) NOT NULL,
  status          VARCHAR(50) NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','in_progress','completed')),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  estimated_date  TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ
);

-- ── MESSAGES ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sender_id   UUID NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── PROJECT FILES ──────────────────────────────────
CREATE TABLE IF NOT EXISTS project_files (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  uploaded_by   UUID NOT NULL REFERENCES users(id),
  filename      VARCHAR(255) NOT NULL,
  file_url      TEXT NOT NULL,
  storage_public_id TEXT,
  storage_resource_type VARCHAR(50),
  file_type     VARCHAR(100),
  file_size     BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── CLIENT REQUESTS ────────────────────────────────
CREATE TABLE IF NOT EXISTS client_requests (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by      UUID NOT NULL REFERENCES users(id),
  title           VARCHAR(255) NOT NULL,
  description     TEXT NOT NULL,
  status          VARCHAR(50) NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','client_responded','closed','cancelled')),
  response_note   TEXT,
  response_files  JSONB,
  responded_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ
);

-- ── PAYMENT PLANS ──────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_plans (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id            UUID UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plan_type             VARCHAR(20) NOT NULL CHECK (plan_type IN ('one_time','financed')),
  subtotal              NUMERIC(10,2) NOT NULL,
  financed_total        NUMERIC(10,2),
  installment_amount    NUMERIC(10,2),
  installments_total    INTEGER NOT NULL DEFAULT 1,
  installments_paid     INTEGER NOT NULL DEFAULT 0,
  status                VARCHAR(50) NOT NULL DEFAULT 'pending_confirmation'
                        CHECK (status IN ('pending_confirmation','active','paid','past_due','cancelled')),
  stripe_customer_id    VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  stripe_checkout_session_id VARCHAR(255),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS stripe_events (
  id          VARCHAR(255) PRIMARY KEY,
  event_type  VARCHAR(255) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── CONTRACTS ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS contracts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id        UUID UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document_url      TEXT,
  signed_at         TIMESTAMPTZ,
  signed_ip         INET,
  no_refund_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  no_refund_ts      TIMESTAMPTZ,
  status            VARCHAR(50) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','sent','signed','voided')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── APPOINTMENTS ───────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id        UUID REFERENCES projects(id),
  lead_name         VARCHAR(255) NOT NULL,
  lead_email        VARCHAR(255),
  lead_phone        VARCHAR(50),
  scheduled_at      TIMESTAMPTZ NOT NULL,
  duration_minutes  INTEGER NOT NULL DEFAULT 30,
  type              VARCHAR(100) NOT NULL DEFAULT 'new_lead'
                    CHECK (type IN ('new_lead','onboarding','blueprint_review','follow_up','other')),
  platform          VARCHAR(100) NOT NULL DEFAULT 'google_meet',
  meeting_url       TEXT,
  status            VARCHAR(50) NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled','completed','cancelled','no_show')),
  notes             TEXT,
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ
);

-- ── INDEXES ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_projects_user_id     ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_status      ON projects(status);
CREATE INDEX IF NOT EXISTS idx_milestones_project   ON milestones(project_id);
CREATE INDEX IF NOT EXISTS idx_messages_project     ON messages(project_id);
CREATE INDEX IF NOT EXISTS idx_messages_created     ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_project        ON project_files(project_id);
CREATE INDEX IF NOT EXISTS idx_requests_project     ON client_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date    ON appointments(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_line_items_project   ON order_line_items(project_id);
