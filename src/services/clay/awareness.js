// WHERE THIS PERSON ACTUALLY STANDS — the context that lets Clay notice things instead of waiting
// to be asked.
//
// Clay had memory (what someone told him) and project context (what a project contains), but no
// sense of the person's SITUATION: what they've done, what's blocking them, whether money could
// even reach them. So he could describe a project beautifully while missing that a sale couldn't
// pay them.
//
// Two rules hold this honest, and they are the same rules the visible path follows:
//   1. EVERY LINE IS EARNED FROM THE RECORD. Nothing here is inferred, predicted, or encouraging.
//      If someone has earned nothing, it says so.
//   2. Money in escrow is NOT earnings. It is reported separately, because it is not theirs yet.
//
// This is the single source of truth for the path — the dashboard endpoint reads it too — so the
// two can never drift apart and tell a person different things about their own situation.

const { query } = require('../../config/db');

const money = (cents) => '$' + ((Number(cents) || 0) / 100).toFixed(2);

// The five steps, computed from live records for one person.
async function pathFor(userId) {
  const r = await query(
    `SELECT
       (SELECT count(*) FROM concepts WHERE owner_id=$1)                                     AS projects,
       (SELECT count(*) FROM concepts WHERE owner_id=$1
          AND (launch_page IS NOT NULL OR movement_state = 'ready_to_package'))              AS moving,
       (SELECT count(*) FROM listings l JOIN concepts c ON c.id=l.concept_id
         WHERE c.owner_id=$1 AND l.status='live')                                            AS live_listings,
       (SELECT count(*) FROM seller_accounts WHERE user_id=$1 AND kyc_status='verified')     AS payouts_ready,
       (SELECT count(*) FROM dream_movers WHERE user_id=$1 AND status='active')              AS is_mover,
       (SELECT COALESCE(SUM(amount_cents),0) FROM orders_transfers
         WHERE seller_id=$1 AND status='released')                                           AS sales_cents,
       (SELECT COALESCE(SUM(amount_cents),0) FROM orders_transfers
         WHERE seller_id=$1 AND status IN ('in_escrow','proof_submitted','delivered'))       AS pending_cents,
       (SELECT COALESCE(SUM(amount_cents),0) FROM mover_earnings WHERE mover_id=$1)          AS mover_cents,
       (SELECT count(*) FROM partner_requests WHERE owner_id=$1 AND status='open')           AS my_asks,
       (SELECT count(*) FROM partner_interest pi JOIN partner_requests pr ON pr.id=pi.request_id
         WHERE pr.owner_id=$1 AND pi.status='pending')                                       AS hands_waiting,
       (SELECT count(*) FROM watches WHERE user_id=$1)                                       AS watching,
       (SELECT display_name FROM users WHERE id=$1)                                          AS builder_tag,
       (SELECT open_to_partnering FROM users WHERE id=$1)                                    AS open_to_partnering`,
    [userId]);
  const s = r.rows[0] || {};
  const n = (v) => Number(v || 0);
  return {
    projects: n(s.projects),
    moving: n(s.moving),
    live_listings: n(s.live_listings),
    payouts_ready: n(s.payouts_ready) > 0,
    is_mover: n(s.is_mover) > 0,
    earned_cents: n(s.sales_cents) + n(s.mover_cents),
    pending_cents: n(s.pending_cents),
    my_asks: n(s.my_asks),
    hands_waiting: n(s.hands_waiting),
    watching: n(s.watching),
    builder_tag: (s.builder_tag || '').trim() || null,
    open_to_partnering: !!s.open_to_partnering,
  };
}

// Partner asks this person could actually help with — ONLY if they said they wanted to hear about
// them. Consent gates this: without it Clay stays quiet rather than pitching at someone.
async function partnerOpportunities(userId, limit = 3) {
  const r = await query(
    `SELECT c.title, pr.needs
       FROM partner_requests pr
       JOIN concepts c ON c.id = pr.concept_id
      WHERE pr.status='open' AND pr.owner_id <> $1
        AND NOT EXISTS (SELECT 1 FROM partner_interest pi
                         WHERE pi.request_id = pr.id AND pi.user_id = $1)
      ORDER BY pr.created_at DESC
      LIMIT $2`, [userId, limit]);
  return r.rows;
}

// Render it as a short block for Clay's context. Deliberately terse: this is background awareness,
// not a briefing he should read out. The wording tells him what is TRUE, and the guidance in his
// instructions tells him when it is worth mentioning.
async function renderAwareness(userId) {
  try {
    const p = await pathFor(userId);
    const lines = [];

    lines.push(`Projects: ${p.projects}. Live listings: ${p.live_listings}. Watching: ${p.watching}.`);

    if (p.earned_cents > 0) lines.push(`Earned so far: ${money(p.earned_cents)}.`);
    else lines.push('Earned so far: nothing yet. Do not soften this or imply otherwise.');
    if (p.pending_cents > 0) {
      lines.push(`${money(p.pending_cents)} is in escrow from a sale in progress — NOT theirs yet, never call it earnings.`);
    }

    // The blocker worth naming, in the order it actually bites.
    if (p.projects === 0) {
      lines.push('Next step: they have not shaped a project yet.');
    } else if (p.live_listings > 0 && !p.payouts_ready) {
      lines.push('BLOCKER: they have live listings but NO verified payout account — if someone bought today, the money could not reach them. This is worth saying plainly if it fits the conversation.');
    } else if (p.moving === 0) {
      lines.push('Next step: none of their projects has a site or is marked ready to package.');
    } else if (p.live_listings === 0) {
      lines.push('Next step: nothing of theirs is listed in the Exchange yet.');
    } else if (!p.payouts_ready) {
      lines.push('Next step: payouts are not set up, so a sale could not pay them.');
    }

    if (p.hands_waiting > 0) {
      lines.push(`${p.hands_waiting} person(s) have offered to help on their launch partner ask and are WAITING for an answer.`);
    }
    if (!p.builder_tag && p.projects > 0) {
      lines.push('They have no display name yet, and they have finished at least one project — a good moment to offer one.');
    }

    if (p.open_to_partnering) {
      const opps = await partnerOpportunities(userId, 3);
      if (opps.length) {
        lines.push('They said they are open to being a launch partner. Currently asking for help: '
          + opps.map((o) => `"${o.title}" (needs ${(o.needs || []).join(', ')})`).join('; ')
          + '. Mention only if it genuinely fits what they are talking about.');
      }
    }

    return 'WHERE THEY STAND (counted from the record — never invent or inflate any of it, and do not '
      + 'recite it back as a list. Use it to be useful at the right moment; if it is not relevant to what '
      + 'they asked, say nothing about it):\n' + lines.map((l) => '- ' + l).join('\n');
  } catch (e) {
    // Awareness is a bonus, never a dependency: if it fails, Clay simply does not have it and the
    // conversation continues normally rather than breaking.
    console.error('awareness unavailable:', e && e.message);
    return null;
  }
}

module.exports = { pathFor, partnerOpportunities, renderAwareness };
