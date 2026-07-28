-- 009: user customization for the Dreamhold onboarding (interests, existing
-- business, launch budget) so the right dreams leap at each user.
CREATE TABLE IF NOT EXISTS yp_labs.user_preferences (
  user_id uuid PRIMARY KEY REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  interests text[] NOT NULL DEFAULT '{}',
  runs_business boolean NOT NULL DEFAULT false,
  business_kind text NOT NULL DEFAULT '',
  launch_budget text NOT NULL DEFAULT '',
  onboarded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
