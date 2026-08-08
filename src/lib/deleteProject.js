// DELETING A PROJECT.
//
// FIRST, THE THING THAT MATTERS MOST: the $19 plan belongs to the ACCOUNT, not to a project. Someone
// on it can have twenty projects and delete nineteen; their subscription is untouched, because it
// was never attached to any of them. Deleting a project must never cancel a person's plan, and the
// query below is written so it structurally cannot.
//
// The only subscriptions this touches are the RETIRED per-project ones — the old $2.99 plan, where a
// subscription really did belong to a single project. Those were grandfathered and cancelled, and
// production currently has none active. This exists so that IF one is ever found, deleting its
// project stops the charge rather than leaving Stripe billing for something that no longer exists.
//
// The guard is explicit rather than incidental. `concept_id = $1` already excludes account-wide rows,
// because NULL never equals a uuid — but relying on that is relying on a SQL subtlety to protect
// somebody's subscription. The conditions below say what is meant, so a future reader cannot
// mistake this for per-project billing and neither can a future edit.
//
// This lives in one place because there are TWO ways to delete a project — the API and Clay's own
// remove_concept tool — and only one of them would ever have been fixed otherwise.

const { query } = require('../config/db');
const stripe = require('../services/stripe');

// Returns { ok, deleted, cancelled } or { ok:false, reason } — never throws for an expected case.
async function deleteProject(userId, conceptId) {
  // concept_id IS NOT NULL  ->  never an account-wide plan.
  // plan <> 'builder'       ->  never the plan we actually sell.
  const subs = await query(
    `SELECT id, stripe_subscription_id FROM subscriptions
      WHERE user_id = $2
        AND status = 'active'
        AND concept_id = $1
        AND concept_id IS NOT NULL
        AND plan <> 'builder'`,
    [conceptId, userId]);

  // Stop a LEGACY per-project charge before removing anything. Ordered this way on purpose: refusing
  // the deletion and saying why is far better than removing someone's work and leaving a charge
  // running. In the normal case this loop does nothing at all, which is correct.
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
