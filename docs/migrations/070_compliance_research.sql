-- 070: COMPLIANCE RESEARCH. What Penny found about a business's legal obligations, where she found it,
-- and when.
--
-- Compliance has no room for error (owner, 16 Sept 2026). Penny does not answer it from memory: each
-- answer comes from a live search and is kept with its sources and date, so it can be checked, reused
-- for 30 days without paying again, and shown to anyone who asks where it came from. An answer with no
-- source is never stored, because it would be recall dressed as research.

CREATE TABLE IF NOT EXISTS yp_labs.compliance_research (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   uuid NOT NULL REFERENCES yp_labs.businesses(id) ON DELETE CASCADE,
  area          text NOT NULL CHECK (area IN ('formation', 'state_tax', 'sales_tax', 'employer',
                  'local_license', 'trade_license', 'permits', 'federal', 'question')),
  question      text NOT NULL CHECK (length(question) BETWEEN 3 AND 600),
  profile_key   text NOT NULL,
  answer        text NOT NULL CHECK (length(answer) >= 20),
  sources       jsonb NOT NULL CHECK (jsonb_typeof(sources) = 'array' AND jsonb_array_length(sources) > 0),
  official      boolean NOT NULL,
  model         text,
  asked_by      uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL,
  searched_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS compliance_research_lookup_idx
  ON yp_labs.compliance_research(business_id, area, profile_key, searched_at DESC);
