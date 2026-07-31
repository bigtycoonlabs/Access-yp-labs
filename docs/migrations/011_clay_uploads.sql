-- 011: files a user attaches to Clay (code, images/graphics, documents — any type).
-- Clay reads what it can — code and text directly, images through its vision layer — and
-- folds the extracted content into everything it builds (plan, design, build path, notes,
-- demo), on both create and enhance.
--
-- We store the EXTRACTED, readable content (for an image: a description of it), not the raw
-- bytes. That is exactly what Clay uses, it keeps the table light, and it keeps Clay honest:
-- a file that is neither text nor image is recorded as a real attachment but marked
-- unreadable, so Clay can say "you gave me this, I can't see inside it" instead of inventing
-- its contents.
CREATE TABLE IF NOT EXISTS yp_labs.clay_uploads (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES yp_labs.users(id)    ON DELETE CASCADE,
  concept_id     uuid          REFERENCES yp_labs.concepts(id) ON DELETE CASCADE,
  filename       text NOT NULL,
  mime_type      text,
  kind           text NOT NULL,           -- code | text | data | image | binary
  byte_size      integer NOT NULL DEFAULT 0,
  extracted_text text,                     -- readable content, or a description for images
  read_status    text NOT NULL,           -- read | described | unreadable
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clay_uploads_user    ON yp_labs.clay_uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_clay_uploads_concept ON yp_labs.clay_uploads(concept_id);
