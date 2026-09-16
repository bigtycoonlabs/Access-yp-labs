-- 061: BUILDS, AND THE MOCK THAT HAS TO COME FIRST.
--
-- Penny builds things for the business: a booking page, a customer portal, an internal tool. The
-- design rests on one rule, and this migration puts that rule in the database rather than in the
-- application, because a rule that lives only in a route gets bypassed by the second route.
--
-- THE RULE: NOTHING IS CHARGED FOR UNTIL SOMEBODY HAS SEEN IT WORK.
--
-- Every build starts as a mock — a real, working HTML page the person can open and click, free and
-- unmetered, with no limit on how many they ask for. Only once they have seen one and said yes does
-- a build become chargeable. So a chargeable build must point at the mock it came from, and the
-- constraint below refuses one that does not.
--
-- WHY THIS IS NOT A PRODUCT DECISION THAT CAN DRIFT. The alternative — quote first, build after — is
-- how this category works and it is why small businesses have been burned by developers: you pay to
-- find out whether the person understood you. Here the understanding is demonstrated before money is
-- mentioned. If that can be turned off by a flag, it is marketing. If the database refuses, it is
-- the product.
--
-- AND A MISTAKE IS NEVER BILLED. attempt_of points at the build this one is fixing. A build that is
-- an attempt at an earlier build is not chargeable, full stop — the person does not pay twice
-- because Penny misunderstood the first time.

CREATE TABLE IF NOT EXISTS yp_labs.builds (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id    uuid NOT NULL REFERENCES yp_labs.businesses(id) ON DELETE CASCADE,
  requested_by   uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL,

  -- mock: free, unmetered, always. real: the thing that runs, and the only kind that can be charged.
  stage          text NOT NULL DEFAULT 'mock' CHECK (stage IN ('mock', 'real')),

  -- What they asked for, in their words. Kept verbatim: the brief is the evidence of what was
  -- understood, and paraphrasing it loses the thing a disagreement would turn on.
  asked_for      text NOT NULL,
  kind           text CHECK (kind IS NULL OR kind IN
                   ('page','site','portal','form','tool','automation','other')),

  status         text NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued','building','ready','failed','declined','discarded')),
  -- Why, in words, whenever it is not ready. A failed build that says nothing is the silent-success
  -- defect wearing a different hat.
  says           text,

  -- The mock this real build was approved from.
  mock_of        uuid REFERENCES yp_labs.builds(id) ON DELETE SET NULL,
  approved_at    timestamptz,
  -- The build this one exists to fix. Never chargeable.
  attempt_of     uuid REFERENCES yp_labs.builds(id) ON DELETE SET NULL,

  chargeable     boolean NOT NULL DEFAULT false,
  invoiced_at    timestamptz,

  -- Where the result lives. Ownership is the point: the code goes to their GitHub, not ours.
  preview_url    text,
  repo_url       text,
  handed_over_at timestamptz,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- A mock is never chargeable. This is the free tier and it is not negotiable per-row.
  CONSTRAINT mock_is_free CHECK (NOT (stage = 'mock' AND chargeable)),

  -- A chargeable build must name the mock it was approved from, and carry the moment of approval.
  -- Nothing is charged for that nobody saw working and said yes to.
  CONSTRAINT charged_only_after_approval CHECK (
    NOT chargeable OR (mock_of IS NOT NULL AND approved_at IS NOT NULL)),

  -- Fixing Penny's own mistake is never billed.
  CONSTRAINT retries_are_free CHECK (NOT (chargeable AND attempt_of IS NOT NULL)),

  -- Nothing is invoiced that was not chargeable in the first place.
  CONSTRAINT invoice_needs_charge CHECK (invoiced_at IS NULL OR chargeable),

  -- A build cannot be its own mock or its own retry.
  CONSTRAINT no_self_reference CHECK (mock_of IS DISTINCT FROM id AND attempt_of IS DISTINCT FROM id)
);

CREATE INDEX IF NOT EXISTS builds_business_idx ON yp_labs.builds(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS builds_open_idx ON yp_labs.builds(status)
  WHERE status IN ('queued', 'building');
CREATE INDEX IF NOT EXISTS builds_uninvoiced_idx ON yp_labs.builds(business_id)
  WHERE chargeable AND invoiced_at IS NULL;

COMMENT ON TABLE yp_labs.builds IS
  'Things Penny builds. A mock is always free; a real build must name the approved mock it came from. Retries of our own mistakes can never be charged.';
COMMENT ON COLUMN yp_labs.builds.asked_for IS
  'Their words, verbatim. The brief is the evidence of what was understood.';
