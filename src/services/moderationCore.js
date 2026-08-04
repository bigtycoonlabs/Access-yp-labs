// ONE implementation of the consequential moderation decision, shared by the staff review route
// AND Clay's decide_listing tool — so the policy (only-policy-grounds reasons, seller recusal,
// atomic status guard, audit trail) can never drift between the two ways staff act.
const { query } = require('../config/db');

const REASONS = ['missing_baseline', 'running_business', 'fraud', 'missing_risk_disclosure'];

// Decide a listing. Returns { ok, status, action } or { ok:false, http, error }.
async function decideListing(user, listingId, { decision, reason, notes }) {
  if (!['approved', 'rejected'].includes(decision)) return { ok: false, http: 400, error: 'Decision must be approved or rejected.' };
  if (decision === 'rejected' && !REASONS.includes(reason)) {
    return { ok: false, http: 400, error: 'Rejecting needs a policy reason: ' + REASONS.join(', ') + '. "It competes with mine" is never a valid reason.' };
  }
  const l = await query('SELECT * FROM listings WHERE id=$1', [listingId]);
  if (!l.rows.length) return { ok: false, http: 404, error: 'Listing not found.' };
  const listing = l.rows[0];
  const isOperator = ['admin', 'master_staff'].includes(user.role);
  if (listing.seller_id === user.id && !isOperator) {
    await query(
      "INSERT INTO moderation_actions (listing_id, moderator_id, decision, recused, notes) VALUES ($1,$2,$3,true,'auto-recused: moderator is the seller')",
      [listing.id, user.id, decision]);
    return { ok: false, http: 403, error: 'You must recuse yourself — you are the seller of this listing.' };
  }
  if (listing.status !== 'in_review') return { ok: false, http: 400, error: 'Listing is not in review.' };
  const newStatus = decision === 'approved' ? 'live' : 'rejected';
  const upd = await query("UPDATE listings SET status=$2, updated_at=NOW() WHERE id=$1 AND status='in_review'", [listing.id, newStatus]);
  if (!upd.rowCount) return { ok: false, http: 409, error: 'This listing was just decided by another moderator.' };
  const selfReview = listing.seller_id === user.id;
  const auditNotes = notes || (selfReview ? 'operator self-review during marketplace seeding' : null);
  const act = await query(
    'INSERT INTO moderation_actions (listing_id, moderator_id, decision, reason, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [listing.id, user.id, decision, reason || null, auditNotes]);
  return { ok: true, status: newStatus, action: act.rows[0] };
}

module.exports = { REASONS, decideListing };
