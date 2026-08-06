-- 036: launch partner opportunities live IN the Dream Market, and the creator controls disclosure.
--
-- Two kinds of opportunity, one market: projects for sale, and projects being built that want a
-- launch partner. The second kind has no price — the currency is the work.
--
-- Two additions:
--   * visibility — a creator decides how much of the project a browser sees before they raise their
--     hand. Someone asking for help should not have to publish everything to ask.
--   * open_to_partnering — a creator saying "I would be a launch partner for someone else". That
--     consent is what lets Clay suggest opportunities to them; without it he stays quiet.
ALTER TABLE yp_labs.partner_requests
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'summary'
  CHECK (visibility IN ('summary','full'));

ALTER TABLE yp_labs.users
  ADD COLUMN IF NOT EXISTS open_to_partnering boolean NOT NULL DEFAULT false;
