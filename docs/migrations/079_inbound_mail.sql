-- 079: MAIL FORWARDED TO PENNY (18 September 2026).
--
-- The owner wants her to see what arrives, not only to send. Reading somebody's whole mailbox means
-- OAuth into Gmail or Microsoft, their entire correspondence, and a permission most small operators
-- should think twice about granting. A forwarding address is the smaller, safer shape: the business
-- forwards what it wants her to have, and nothing else is visible to anybody.
--
-- The address carries a random token so it cannot be guessed. An address that is only a business
-- name is an address anybody can post to.
ALTER TABLE yp_labs.businesses ADD COLUMN IF NOT EXISTS inbox_token text UNIQUE;

CREATE TABLE IF NOT EXISTS yp_labs.inbound_mail (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  business_id uuid NOT NULL REFERENCES yp_labs.businesses(id) ON DELETE CASCADE,
  from_address text,
  from_name text,
  to_address text,
  subject text,
  body text,
  -- What the sender's own message said it was, kept so a reply can thread and so duplicates from a
  -- double forward can be spotted.
  message_id text,
  received_at timestamptz NOT NULL DEFAULT now(),
  -- Set when somebody has dealt with it, so "what needs me" is answerable.
  handled_at timestamptz,
  handled_note text
);
CREATE INDEX IF NOT EXISTS inbound_mail_business_idx ON yp_labs.inbound_mail (business_id, received_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS inbound_mail_dedupe_idx ON yp_labs.inbound_mail (business_id, message_id)
  WHERE message_id IS NOT NULL;
