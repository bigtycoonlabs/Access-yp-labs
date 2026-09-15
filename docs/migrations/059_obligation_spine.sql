-- 059: THE SPINE.
--
-- Every task, project, customer commitment, filing, renewal, invoice and promise is the same record:
-- a counterparty, a date, and a consequence if it does not happen. They are shown as one list, ranked
-- by what missing each thing actually costs.
--
-- The reason no existing tool works this way is historical rather than principled. Asana was built
-- for software teams, HubSpot for sales teams, ZenBusiness for filings — three companies solving
-- three jobs for three buyers. A one-person cleaning business does not have three jobs. It has one
-- list, currently spread across four apps, a notebook, and their memory.
--
-- TWO THINGS IN HERE ARE LOAD-BEARING AND EXPENSIVE TO RETROFIT:
--
--   1. MULTI-BUSINESS. A business is a first-class object, not a setting. One person runs several,
--      each with its own entity, state, filings, customers and site. Somebody with a cleaning
--      company in Ohio, an Airbnb LLC in Tennessee and a consulting entity in Delaware has three
--      annual reports in three jurisdictions, and they are the likeliest person alive to lose an
--      entity to administrative dissolution.
--
--   2. NO CONCEPT OF A PROPERTY. An obligation attaches to a SUBJECT, which may be a vehicle, a
--      premises, a licence, a person or a unit. A short-term rental permit is an obligation whose
--      subject happens to be a property, exactly as a commercial vehicle inspection is one whose
--      subject happens to be a van. The test for every future column: describe it without using the
--      word property. If you cannot, it belongs in Access Your Place.

-- ---------------------------------------------------------------- businesses
CREATE TABLE IF NOT EXISTS yp_labs.businesses (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id        uuid NOT NULL REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  -- Legal name differs from trading name more often than not, and the filings use the legal one.
  legal_name      text,
  entity_type     text CHECK (entity_type IS NULL OR entity_type IN
                    ('sole_proprietor','llc','s_corp','c_corp','partnership','nonprofit','other')),
  formation_state text,
  formed_on       date,
  -- Where it actually OPERATES, which is what decides licences and nexus. Often not the formation
  -- state, and the gap between the two is where people get caught.
  operating_states text[] NOT NULL DEFAULT '{}',
  localities      text[] NOT NULL DEFAULT '{}',
  trade           text,
  headcount       integer NOT NULL DEFAULT 0,
  stage           text NOT NULL DEFAULT 'running'
                    CHECK (stage IN ('idea','forming','launching','running','winding_down')),
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS businesses_owner_idx ON yp_labs.businesses(owner_id) WHERE archived_at IS NULL;

-- ---------------------------------------------------------------- subjects
-- What an obligation is ABOUT, when it is about a thing. Keeps the model business-agnostic.
CREATE TABLE IF NOT EXISTS yp_labs.subjects (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id  uuid NOT NULL REFERENCES yp_labs.businesses(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN
                 ('premises','vehicle','licence','person','unit','equipment','account','other')),
  label        text NOT NULL,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- When the subject lives in another product. A lease is an AYP record; we reference, never copy.
  external_ref text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subjects_business_idx ON yp_labs.subjects(business_id);

-- ---------------------------------------------------------------- obligations
CREATE TABLE IF NOT EXISTS yp_labs.obligations (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     uuid NOT NULL REFERENCES yp_labs.businesses(id) ON DELETE CASCADE,
  subject_id      uuid REFERENCES yp_labs.subjects(id) ON DELETE SET NULL,

  -- What kind of thing it is. All of these are the same record; the kind only changes how it reads.
  kind            text NOT NULL CHECK (kind IN (
                    'filing','licence','permit','registration','insurance','tax',
                    'task','promise','invoice_out','invoice_in','renewal','meeting','other')),

  title           text NOT NULL,
  detail          text,

  -- WHO IT IS OWED TO. A government, a person, a company, or yourself. Every obligation has one.
  counterparty        text,
  counterparty_kind   text CHECK (counterparty_kind IS NULL OR counterparty_kind IN
                        ('government','customer','supplier','employee','contractor','landlord','self','other')),

  due_at          timestamptz,
  -- Recurrence as a plain interval rather than an RRULE. Annual reports, quarterly taxes, monthly
  -- rent. Anything more exotic than this is a task somebody sets each time.
  recurs_every    interval,

  -- THE RANKING COLUMN, AND THE REASON THIS PRODUCT EXISTS.
  --
  -- Every task manager ranks by priority, which is a label the user types, is a guess, and by the
  -- second week everything is high. It carries no information.
  --
  -- This ranks by what missing it actually costs, which the tool can work out because it knows what
  -- each thing IS. $25 for an Ohio filing. $2,400 for an uninvoiced job. And the basis is stored
  -- alongside, because a number nobody can explain is a number nobody should trust.
  cost_if_missed_cents bigint,
  cost_basis      text CHECK (cost_basis IS NULL OR cost_basis IN ('known','estimated','unknown')),
  cost_note       text,
  -- What happens beyond the money. Late fee, then good standing, then dissolution.
  consequence     text,

  status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','done','waived','superseded')),
  completed_at    timestamptz,
  assigned_to     uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL,

  -- PROVENANCE. Every fact carries where it came from and when, because "from your Flow books this
  -- morning" and "you told me in March" are different claims and a connected ecosystem that blurs
  -- them is harder to trust than three separate products.
  source          text NOT NULL DEFAULT 'stated'
                    CHECK (source IN ('stated','rule_engine','gmail','flow','ayp','imported','penny')),
  source_ref      text,
  source_at       timestamptz NOT NULL DEFAULT now(),

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- A cost that claims to be known must say what it is based on.
  CONSTRAINT cost_has_basis CHECK (cost_if_missed_cents IS NULL OR cost_basis IS NOT NULL),
  -- Done means done at a time.
  CONSTRAINT done_has_time CHECK (status <> 'done' OR completed_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS obligations_business_idx ON yp_labs.obligations(business_id, status);
CREATE INDEX IF NOT EXISTS obligations_due_idx ON yp_labs.obligations(due_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS obligations_assigned_idx ON yp_labs.obligations(assigned_to) WHERE status = 'open';

-- ---------------------------------------------------------------- relationships
-- A person's relationship TO a business. Not every relationship is a login: a landlord is a record,
-- a vendor is a record and a thread, a customer gets the portal. Only people who work in the
-- business take a seat, which is also what makes counting seats fair.
--
-- And the relationship type matters beyond access, because it CREATES obligations. A contractor
-- raises a W-9. An employee raises workers comp, which in most states triggers at the first hire.
-- An overseas VA raises a W-8BEN rather than a W-9.
CREATE TABLE IF NOT EXISTS yp_labs.relationships (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   uuid NOT NULL REFERENCES yp_labs.businesses(id) ON DELETE CASCADE,
  -- Null when they are a record rather than a user. A landlord usually never logs in.
  user_id       uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL,
  display_name  text NOT NULL,
  email         text,
  phone         text,
  kind          text NOT NULL CHECK (kind IN (
                  'owner','partner','employee','contractor','assistant',
                  'vendor','landlord','customer','professional')),
  started_on    date,
  ended_on      date,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- One person holds at most one relationship per business. A person who is both a partner and an
  -- employee is a partner; the stronger relationship wins rather than producing two rows.
  CONSTRAINT one_per_business UNIQUE (business_id, user_id)
);
CREATE INDEX IF NOT EXISTS relationships_business_idx ON yp_labs.relationships(business_id) WHERE ended_on IS NULL;

-- ---------------------------------------------------------------- permissions
-- Capability, scope, level. Fixed roles break immediately on real teams: somebody who does
-- compliance AND development is not admin and not staff, and inventing a role for every combination
-- is how permission systems become unusable.
--
-- EXPORT IS ITS OWN AREA on purpose. It is the one capability that removes data from your control
-- and the one nobody restricts until afterwards. It is never implied by 'view'.
CREATE TABLE IF NOT EXISTS yp_labs.permissions (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  relationship_id uuid NOT NULL REFERENCES yp_labs.relationships(id) ON DELETE CASCADE,
  area          text NOT NULL CHECK (area IN (
                  'compliance','money','customers','team','documents','projects','sites','export')),
  level         text NOT NULL CHECK (level IN ('none','view','act','manage')),
  granted_by    uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT one_level_per_area UNIQUE (relationship_id, area)
);

-- Every export is logged, with who, what and when, visible to the owner. A capability that removes
-- data from the building leaves a record behind.
CREATE TABLE IF NOT EXISTS yp_labs.export_log (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id  uuid NOT NULL REFERENCES yp_labs.businesses(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL,
  what         text NOT NULL,
  row_count    integer,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- connections
CREATE TABLE IF NOT EXISTS yp_labs.connections (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   uuid NOT NULL REFERENCES yp_labs.businesses(id) ON DELETE CASCADE,
  provider      text NOT NULL CHECK (provider IN ('flow','ayp','google','github','stripe','supabase')),
  scope         text[] NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','error')),
  -- Revocable in one action, and the revocation is recorded rather than the row being deleted.
  granted_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  last_ok_at    timestamptz,
  last_error    text,
  external_ref  text,
  CONSTRAINT one_live_per_provider UNIQUE (business_id, provider)
);

COMMENT ON TABLE yp_labs.obligations IS
  'The spine. Everything owed to anyone, ranked by cost_if_missed_cents. Tasks, filings, promises and invoices are all rows here.';
COMMENT ON COLUMN yp_labs.obligations.cost_if_missed_cents IS
  'What missing this actually costs. The ranking column. cost_basis says whether it is known or estimated, and an estimate must be shown as one.';
