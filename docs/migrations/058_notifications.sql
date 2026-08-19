-- 058: WHAT HAPPENED, AND WHO NEEDS TO KNOW.
--
-- Everything built this week works and tells nobody. A contributor offers help and the owner finds
-- out only if they happen to open the project page. Somebody's work is accepted and they learn about
-- it by checking. That is not a missing feature, it is the reason none of it will get used: a
-- collaboration platform where you have to poll for the collaboration is a filing cabinet.
--
-- IN-APP IS THE TRUTH, EMAIL IS BEST-EFFORT. Email needs a key that may not be set, a domain that
-- may not be verified, and an inbox that may bounce. The row in this table is what actually
-- happened; a send is an attempt recorded against it. Zero delivered is never success and is never
-- recorded as sent.
--
-- APPEND-ONLY. A notification is a record of an event, not a mutable to-do. Reading one sets
-- read_at; nothing else about it changes, and nothing is deleted.

CREATE TABLE IF NOT EXISTS yp_labs.notifications (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       uuid NOT NULL REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  -- Written for the person receiving it, in a full sentence, at the moment it happened. Stored
  -- rather than rendered later from ids, because a notification that says "a contribution was
  -- accepted" is useless and one that says "Rel accepted your marketing plan at 20%" is not — and
  -- rebuilding that sentence months later means re-reading records that may have changed since.
  headline      text NOT NULL,
  body          text,
  concept_id    uuid REFERENCES yp_labs.concepts(id) ON DELETE SET NULL,
  listing_id    uuid REFERENCES yp_labs.listings(id) ON DELETE SET NULL,
  actor_id      uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL,
  url           text,
  read_at       timestamptz,
  -- Email is an attempt, not a fact. NULL means never tried; a row in email_status says what
  -- happened when we did.
  -- 'accepted' rather than 'sent', and the word matters.
  --
  -- Resend returning 200 means the provider TOOK the message. It does not mean anybody received it.
  -- Verified deliverability separately: a real send from clay@accessyplabs.com to a test inbox came
  -- back "delivered", so the path works — but that was checked in the provider's dashboard, not by
  -- this platform, and the platform cannot know it.
  --
  -- Delivery is only knowable from a provider webhook. The one webhook on this Resend account is
  -- DISABLED and points at accessyourplace.com, a different platform. So a bounce here is invisible,
  -- and calling provider acceptance 'sent' would be this codebase's signature defect in its own
  -- records: reporting success for something it did not verify.
  email_status  text CHECK (email_status IS NULL OR email_status IN ('accepted','skipped','failed')),
  email_reason  text,
  -- The provider's own id, kept so a bounce can be traced back to the person it was meant for once
  -- a webhook exists. Throwing it away is what makes that impossible later.
  email_provider_id text,
  -- The same real-world event cannot be recorded twice. A retry, a double-click, or a route called
  -- from two places all collapse to one notification.
  dedupe_key    text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_idx
  ON yp_labs.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON yp_labs.notifications(user_id) WHERE read_at IS NULL;

-- Whether this person wants the collaboration emails at all. Defaults on, because somebody whose
-- work is waiting on a decision needs to know, and defaults off would make the whole system silent
-- for everyone who never found the setting.
ALTER TABLE yp_labs.user_email_prefs
  ADD COLUMN IF NOT EXISTS team_activity boolean NOT NULL DEFAULT true;
