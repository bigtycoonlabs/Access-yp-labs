-- Why an issue was sent back. Recorded so the reason survives the rewrite: Clay can see what was
-- wrong with the last draft rather than producing the same thing again.
ALTER TABLE yp_labs.weekly_issues ADD COLUMN IF NOT EXISTS rejection_note text;
