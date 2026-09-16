-- 060: DOCUMENTS, AND THE ONES THAT ARE NOT THERE.
--
-- Every tool in this space stores files. The useful half is knowing what SHOULD be on file and is
-- not — a folder cannot know what belongs in it, which is why a business discovers the missing
-- certificate of insurance on the day a client asks for it rather than the day it expired.
--
-- WHAT THIS DELIBERATELY IS NOT. It is not binary storage. A document here is a RECORD of a document:
-- what it is, who it belongs to, when it expires, and where it lives — which may be a link, a drive,
-- or a filing cabinet in somebody's kitchen. Recording that a W-9 exists and where it is beats
-- refusing to record anything until a PDF has been uploaded, because the second one is how the
-- ledger stays empty and the answer stays wrong.
--
-- EXPIRY IS THE POINT. A certificate of insurance that lapsed in March is worse than one that was
-- never collected: the business believes it is covered. So expires_on feeds the same ranked list as
-- everything else, through the same obligations table, with the same cost-of-missing arithmetic.

CREATE TABLE IF NOT EXISTS yp_labs.documents (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   uuid NOT NULL REFERENCES yp_labs.businesses(id) ON DELETE CASCADE,

  -- What kind of thing it is. Drives what Penny knows to look for and what expiring means.
  kind          text NOT NULL CHECK (kind IN (
                  'formation','ein','operating_agreement','licence','permit','insurance',
                  'w9','w8ben','coi','lease','contract','tax_return','bank','other')),
  title         text NOT NULL,

  -- Who it concerns, when it is about a person: a contractor's W-9, an employee's paperwork.
  relationship_id uuid REFERENCES yp_labs.relationships(id) ON DELETE CASCADE,
  -- Or what it concerns: a vehicle's insurance, a premises' certificate of occupancy.
  subject_id    uuid REFERENCES yp_labs.subjects(id) ON DELETE SET NULL,

  -- WHERE IT ACTUALLY IS. A link, a drive path, or a sentence. Never required to be a file we hold.
  location      text,
  location_kind text NOT NULL DEFAULT 'note'
                  CHECK (location_kind IN ('note','link','upload','elsewhere')),

  issued_on     date,
  expires_on    date,
  -- The obligation raised for this document's renewal, so completing one closes the other rather
  -- than leaving a stale task behind.
  obligation_id uuid REFERENCES yp_labs.obligations(id) ON DELETE SET NULL,

  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- A document about a person must say which person; one about nobody must not pretend to.
  CONSTRAINT person_doc_has_person CHECK (
    kind NOT IN ('w9','w8ben','coi') OR relationship_id IS NOT NULL),
  -- An expiry before issue is a typo, and a typo in a date here means a wrong warning.
  CONSTRAINT expiry_after_issue CHECK (
    expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on)
);
CREATE INDEX IF NOT EXISTS documents_business_idx ON yp_labs.documents(business_id);
CREATE INDEX IF NOT EXISTS documents_expiry_idx ON yp_labs.documents(expires_on)
  WHERE expires_on IS NOT NULL;
CREATE INDEX IF NOT EXISTS documents_relationship_idx ON yp_labs.documents(relationship_id)
  WHERE relationship_id IS NOT NULL;

COMMENT ON TABLE yp_labs.documents IS
  'A record of a document rather than the file itself. The useful half is computing which expected ones are absent.';
