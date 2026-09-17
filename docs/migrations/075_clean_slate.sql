-- 075: A CLEAN SLATE (owner, 16 September 2026). Clay is retired, with the marketplace he ran.
--
--   - Every project a PERSON made becomes a business at the idea stage, and its plan, research and
--     demo page become files on that business, so nothing anybody worked on is lost.
--   - Every project Clay seeded is retired, and every listing is withdrawn. Nothing about a retired
--     project is shown or sent again.
--   - Clay's own account is suspended, so nothing can act as him.
--   - Desk articles that send readers to the Exchange are archived.
-- Safe to run twice: it only touches projects not already retired.

ALTER TABLE yp_labs.concepts ADD COLUMN IF NOT EXISTS retired_at timestamptz;
ALTER TABLE yp_labs.concepts ADD COLUMN IF NOT EXISTS migrated_business_id uuid REFERENCES yp_labs.businesses(id) ON DELETE SET NULL;

DO $$
DECLARE
  c record; a record; biz uuid; fname text; bytes_ bytea; kind_ text; mime_ text;
  clay uuid := (SELECT id FROM yp_labs.users WHERE email = 'clay@accessyplabs.com');
BEGIN
  FOR c IN SELECT * FROM yp_labs.concepts WHERE retired_at IS NULL AND owner_id IS DISTINCT FROM clay LOOP
    INSERT INTO yp_labs.businesses (owner_id, name, stage)
      VALUES (c.owner_id, left(coalesce(nullif(trim(c.title), ''), 'My project'), 200), 'idea')
      RETURNING id INTO biz;
    FOR a IN SELECT * FROM yp_labs.assets WHERE concept_id = c.id AND is_current AND coalesce(length(body), 0) > 0 LOOP
      IF a.type::text = 'html_demo' THEN
        fname := 'Demo page.html'; kind_ := 'document'; mime_ := 'text/html';
      ELSE
        fname := initcap(replace(a.type::text, '_', ' ')) || '.md'; kind_ := 'text'; mime_ := 'text/markdown';
      END IF;
      bytes_ := convert_to(a.body, 'UTF8');
      CONTINUE WHEN length(bytes_) > 10485760;
      INSERT INTO yp_labs.files (business_id, uploaded_by, name, mime, kind, bytes, sha256, storage, data, description, description_by)
        VALUES (biz, c.owner_id, left(fname, 200), mime_, kind_, length(bytes_),
          encode(sha256(bytes_), 'hex'), 'db', bytes_,
          'Carried over from your project "' || left(c.title, 120) || '".', 'penny');
    END LOOP;
    UPDATE yp_labs.concepts SET migrated_business_id = biz WHERE id = c.id;
  END LOOP;

  UPDATE yp_labs.concepts SET retired_at = now() WHERE retired_at IS NULL;
  UPDATE yp_labs.listings SET status = 'withdrawn' WHERE status IN ('live', 'in_review', 'draft');
  IF clay IS NOT NULL THEN UPDATE yp_labs.users SET status = 'suspended' WHERE id = clay; END IF;
  UPDATE yp_labs.desk_articles SET status = 'archived'
    WHERE status = 'published' AND slug IN ('your-feature-is-not-the-sale', 'choosing-your-path-cf48a7',
      'make-your-unbuilt-idea-ownable-d7a14c', 'what-makes-a-concept-worth-buying-3ca27a');
END $$;
