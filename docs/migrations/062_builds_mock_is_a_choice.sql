-- 062: THE MOCK-UP IS A CHOICE THE PERSON MAKES, NOT A GATE THEY ARE FORCED THROUGH.
--
-- 061 required every chargeable build to name an approved mock. The owner overruled that on
-- 16 Sept 2026: somebody asking for a quick edit does not need a demo first. Penny asks, every time,
-- whether they want a mock-up before she starts, and does what they choose.
--
-- What does NOT loosen: nothing is chargeable without a recorded yes. A chargeable build must carry
-- the moment it was approved AND either the mock it was approved from or the moment the person
-- declined a mock-up. There is no third path, so a build cannot become billable because nobody was
-- asked. A mock is still always free, and fixing our own mistake is still never billed.
--
-- Also here: somewhere to keep the page Penny writes, and an address to open it at.
--
-- Applied to production 16 Sept 2026 with gen_random_bytes written as extensions.gen_random_bytes,
-- because pgcrypto lives in the extensions schema there. Locally it is in public and found unqualified.
-- Verified in production by driving every constraint inside a rolled-back function: a charge with no
-- recorded yes was refused, a charge after a recorded skip was accepted, a mock claiming a skip, a
-- chargeable mock and a charged retry were all refused, and a preview token was generated.

ALTER TABLE yp_labs.builds
  ADD COLUMN IF NOT EXISTS mock_declined_at timestamptz,
  -- The build this one changes. A quick edit to something already built.
  ADD COLUMN IF NOT EXISTS edit_of uuid REFERENCES yp_labs.builds(id) ON DELETE SET NULL,
  -- The address a preview opens at. Unguessable, because the page is not public and the person
  -- opening it is not signed in inside the sandbox it runs in.
  ADD COLUMN IF NOT EXISTS preview_token text UNIQUE DEFAULT encode(gen_random_bytes(18), 'hex'),
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS started_at timestamptz;

UPDATE yp_labs.builds SET preview_token = encode(gen_random_bytes(18), 'hex')
 WHERE preview_token IS NULL;
ALTER TABLE yp_labs.builds ALTER COLUMN preview_token SET NOT NULL;

ALTER TABLE yp_labs.builds DROP CONSTRAINT IF EXISTS charged_only_after_approval;
ALTER TABLE yp_labs.builds ADD CONSTRAINT charged_only_after_a_yes CHECK (
  NOT chargeable OR (approved_at IS NOT NULL
    AND (mock_of IS NOT NULL OR mock_declined_at IS NOT NULL)));

-- Only a real build can skip the mock-up. A mock that "declined a mock" is nonsense.
ALTER TABLE yp_labs.builds DROP CONSTRAINT IF EXISTS declined_mock_is_real;
ALTER TABLE yp_labs.builds ADD CONSTRAINT declined_mock_is_real CHECK (
  mock_declined_at IS NULL OR stage = 'real');

ALTER TABLE yp_labs.builds DROP CONSTRAINT IF EXISTS no_self_edit;
ALTER TABLE yp_labs.builds ADD CONSTRAINT no_self_edit CHECK (edit_of IS DISTINCT FROM id);

-- The page itself. Kept apart from builds so listing someone's builds never drags every page along.
CREATE TABLE IF NOT EXISTS yp_labs.build_pages (
  build_id   uuid PRIMARY KEY REFERENCES yp_labs.builds(id) ON DELETE CASCADE,
  html       text NOT NULL CHECK (length(html) BETWEEN 200 AND 400000),
  -- What was checked before it was called ready, and what each check found. Kept so "ready" is a
  -- claim with its evidence attached.
  checks     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON CONSTRAINT charged_only_after_a_yes ON yp_labs.builds IS
  'Chargeable only with a recorded approval, and either an approved mock or a recorded decision to skip one.';
