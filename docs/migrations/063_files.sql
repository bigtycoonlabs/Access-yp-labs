-- 063: FILES AND PHOTOS, KEPT BY THE BUSINESS AND SHARED ON PURPOSE.
--
-- 060 recorded where a document is. This holds the file itself, for the people who want it here.
--
-- A PHOTO IS DESCRIBED. Both owners are blind. A photo nobody can hear is a file with a name, so
-- every image carries a description, and the description says who wrote it: the person, or Penny.
-- One written by Penny is labelled as hers, because a guessed description presented as fact is the
-- silent-success defect wearing different clothes.
--
-- SHARING IS A LINK THAT ENDS. Every share has an expiry, can be revoked, and counts its opens.
-- There is no "public forever" setting, because the file most often shared from a small business is
-- a W-9, a lease or a photo of somebody's home.
--
-- WHERE THE BYTES LIVE. In Postgres, capped at 10 MB a file, for now. There is no object storage
-- configured on the service today (SUPABASE_URL is not set on Railway), and a working store beats a
-- promised one. The storage column exists so moving to object storage later is a data move, not a
-- schema change.
--
-- Applied to production 16 Sept 2026 (extension functions qualified with extensions.). Verified there
-- by driving it in a rolled-back function: over 10 MB, a description with no author, a file with no
-- bytes, a 31-day link and an already expired link were refused; a described photo and a 7-day link
-- were accepted, and the link got a token.

CREATE TABLE IF NOT EXISTS yp_labs.files (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   uuid NOT NULL REFERENCES yp_labs.businesses(id) ON DELETE CASCADE,
  uploaded_by   uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  -- Decided from the file's own first bytes, never from what the browser claimed.
  mime          text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('photo', 'document', 'spreadsheet', 'text', 'other')),
  bytes         integer NOT NULL CHECK (bytes > 0 AND bytes <= 10485760),
  sha256        text NOT NULL,
  storage       text NOT NULL DEFAULT 'db' CHECK (storage IN ('db', 'object')),
  data          bytea,
  description   text,
  description_by text CHECK (description_by IS NULL OR description_by IN ('person', 'penny')),
  -- The document record this file is, when it is one: a W-9, a lease, a certificate.
  document_id   uuid REFERENCES yp_labs.documents(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,

  CONSTRAINT bytes_are_somewhere CHECK (storage <> 'db' OR data IS NOT NULL OR deleted_at IS NOT NULL),
  CONSTRAINT description_says_who CHECK ((description IS NULL) = (description_by IS NULL))
);
CREATE INDEX IF NOT EXISTS files_business_idx ON yp_labs.files(business_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS yp_labs.file_shares (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_id       uuid NOT NULL REFERENCES yp_labs.files(id) ON DELETE CASCADE,
  token         text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(18), 'hex'),
  created_by    uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL,
  -- Who it was for, in words. Not a login: the person opening it has no account.
  shared_with   text,
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  opens         integer NOT NULL DEFAULT 0,
  last_opened_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- No share lasts more than 30 days. Longer is a new link, made on purpose.
  CONSTRAINT share_ends CHECK (expires_at > created_at
    AND expires_at <= created_at + interval '30 days 1 minute')
);
CREATE INDEX IF NOT EXISTS file_shares_file_idx ON yp_labs.file_shares(file_id);

COMMENT ON TABLE yp_labs.files IS
  'Files and photos a business keeps. Photos carry a description and say who wrote it.';
COMMENT ON TABLE yp_labs.file_shares IS
  'Share links that always end, can be revoked, and count their opens.';
