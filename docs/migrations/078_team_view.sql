-- 078: WORKING IN SOMEBODY ELSE'S BUSINESS (owner, 17 September 2026).
--
-- "They are restricted to the limitations set by the owner of the team unless they subscribe for
-- their own usage, and they need to be able to toggle between their team view and their personal
-- view."
--
-- So a person has one account and can be standing in one of two places: their own work, or a team
-- they were added to. Which one they are standing in decides whose plan pays for the work, which is
-- why it is stored rather than guessed from whichever business was mentioned last.
ALTER TABLE yp_labs.users ADD COLUMN IF NOT EXISTS working_for uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL;
COMMENT ON COLUMN yp_labs.users.working_for IS
  'The owner whose team this person is currently working in. Null means their own work. Their usage counts against this owner''s plan while it is set.';
