// DELETING A PROJECT, INCLUDING THE MONEY ATTACHED TO IT.
//
// subscriptions.concept_id has no foreign key, so removing a project used to leave any per-project
// subscription behind — still marked active, pointing at something that no longer exists — while
// Stripe carried on charging for it. Someone deleting a project they had paid for would keep paying
// monthly for nothing, with nothing on screen to explain it.
//
// This lives in one place because there are TWO ways to delete a project — the API and Clay's own
// remove_concept tool — and only one of them would ever have been fixed otherwise. A second copy is
// how the two paths quietly stop agreeing.

const { query } = require('../config/db');
const stripe = require('../services/stripe');

// Returns { ok, deleted, cancelled } or { ok:false, reason } — never throws for an expected case.
async function deleteProject(userId, conceptId) {
  const subs = await query(
    `SELECT id, stripe_subscription_id FROM subscriptions
      WHERE concept_id = $1 AND user_id = $2 AND status = 'active'`, [conceptId, userId]);

  // Stop the billing BEFORE removing anything. Ordered this way on purpose: refusing the deletion
  // and saying why is far better than removing someone's work and leaving the charge running.
  for (const s of subs.rows) {
    if (s.stripe_subscription_id) {
      const out = await stripe.cancelSubscription(s.stripe_subscription_id);
      // The stripe helpers resolve with { ok:false } rather than throwing, so read the result.
      if (!out.ok && out.reason !== 'stripe_not_configured') {
        return { ok: false, reason: 'cancel_failed' };
      }
    }
    await query("UPDATE subscriptions SET status='canceled' WHERE id=$1", [s.id]);
  }

  const r = await query(
    'DELETE FROM concepts WHERE id=$1 AND owner_id=$2 RETURNING id', [conceptId, userId]);
  if (!r.rows.length) return { ok: false, reason: 'not_found' };
  return { ok: true, deleted: r.rows[0].id, cancelled: subs.rows.length };
}

const CANCEL_FAILED_MESSAGE =
  'Your project has NOT been deleted, because the subscription attached to it could not be cancelled '
  + 'and you would have kept being charged. Nothing has changed. Please try again shortly, or cancel '
  + 'from your billing page first.';

module.exports = { deleteProject, CANCEL_FAILED_MESSAGE };
