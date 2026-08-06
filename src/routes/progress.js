const express = require('express');
const { query } = require('../config/db');
const { asyncHandler } = require('../lib/http');
const { authenticate } = require('../middleware/auth');

// YOUR PATH — the visible route from arriving to earning.
//
// This is the closest thing here to a game, so the rule that makes it honest matters more than the
// mechanic: every step is EARNED FROM THE RECORD. A step is complete only because the thing
// actually happened — a project exists, a listing is live, money actually landed. There are no
// points, no streaks, and nothing that rewards logging in. If someone has earned nothing, this says
// so plainly rather than dressing up activity as progress. A person deciding whether they have a
// real shot here deserves the truth, not a progress bar tuned to feel good.
//
// It is also written to be HEARD: each step carries a short spoken-friendly line and one concrete
// next action, so the path works read aloud, in order, with no visual layout carrying meaning.

const router = express.Router();

// GET /api/progress — where this person actually stands.
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const uid = req.user.id;

  const r = await query(
    `SELECT
       (SELECT count(*) FROM concepts WHERE owner_id=$1)                                    AS projects,
       (SELECT count(*) FROM concepts WHERE owner_id=$1
          -- Real movement states (see the concepts_movement_state_check constraint):
          -- needs_customer_clarity, needs_proof, ready_to_package. 'ready_to_package' is the one
          -- that means the creator has taken it somewhere; the earlier two mean work still to do.
          AND (launch_page IS NOT NULL OR movement_state = 'ready_to_package')) AS moving,
       (SELECT count(*) FROM listings l JOIN concepts c ON c.id=l.concept_id
         WHERE c.owner_id=$1 AND l.status='live')                                           AS live_listings,
       (SELECT count(*) FROM seller_accounts WHERE user_id=$1 AND kyc_status='verified')    AS payouts_ready,
       (SELECT count(*) FROM dream_movers WHERE user_id=$1 AND status='active')             AS is_mover,
       (SELECT COALESCE(SUM(amount_cents),0) FROM orders_transfers
         WHERE seller_id=$1 AND status='released')                                          AS sales_cents,
       (SELECT COALESCE(SUM(amount_cents),0) FROM orders_transfers
         WHERE seller_id=$1 AND status IN ('in_escrow','proof_submitted','delivered'))      AS pending_cents,
       (SELECT COALESCE(SUM(amount_cents),0) FROM mover_earnings WHERE mover_id=$1)         AS mover_cents`,
    [uid]);
  const s = r.rows[0] || {};
  const n = (v) => Number(v || 0);

  const earnedCents = n(s.sales_cents) + n(s.mover_cents);
  const pendingCents = n(s.pending_cents);

  // Two routes to earning, and a person may walk either or both. Nothing here assumes someone must
  // have an idea of their own — the Dream Mover route deliberately doesn't.
  const steps = [
    {
      key: 'shape',
      title: 'Shape your first project',
      done: n(s.projects) > 0,
      spoken: n(s.projects) > 0
        ? `Done. You have ${n(s.projects)} project${n(s.projects) === 1 ? '' : 's'}.`
        : 'Not yet. Tell Clay an idea in plain words and he shapes it into a real business package you own.',
      action: { label: 'Open your Laboratory', href: '/app.html' },
    },
    {
      key: 'move',
      title: 'Take one somewhere real',
      done: n(s.moving) > 0,
      spoken: n(s.moving) > 0
        ? 'Done. At least one of your projects has a site or is on its way to launch.'
        : 'Not yet. Give a project a site, or tell Clay you are building it, so it stops being only an idea.',
      action: { label: 'See your projects', href: '/dashboard.html' },
    },
    {
      key: 'list',
      title: 'Put one in the Dream Market',
      done: n(s.live_listings) > 0,
      spoken: n(s.live_listings) > 0
        ? `Done. You have ${n(s.live_listings)} listing${n(s.live_listings) === 1 ? '' : 's'} live.`
        : 'Not yet. Listing a project is how someone else can buy it — this is the step that makes earning possible.',
      action: { label: 'Sell a project', href: '/sell.html' },
    },
    {
      key: 'payouts',
      title: 'Set up how you get paid',
      done: n(s.payouts_ready) > 0,
      spoken: n(s.payouts_ready) > 0
        ? 'Done. Your payout account is verified, so money can reach you.'
        : 'Not yet. Until this is set up, a sale cannot actually pay you.',
      action: { label: 'Set up payouts', href: '/dashboard.html' },
    },
    {
      key: 'mover',
      title: 'Or earn without an idea of your own',
      done: n(s.is_mover) > 0,
      spoken: n(s.is_mover) > 0
        ? 'Done. You are a Dream Mover — share what you believe in and earn on each sale.'
        : 'Optional, and open to anyone. Become a Dream Mover, promote projects you believe in, and earn a commission when one sells.',
      action: { label: 'Become a Dream Mover', href: '/movers.html' },
    },
  ];

  const nextStep = steps.find((x) => !x.done) || null;

  res.json({
    steps,
    completed: steps.filter((x) => x.done).length,
    total: steps.length,
    next: nextStep ? { key: nextStep.key, title: nextStep.title, action: nextStep.action } : null,
    earned_cents: earnedCents,
    pending_cents: pendingCents,
    // Said out loud, because this is the number a person actually cares about, and pretending is
    // the one thing that would make the whole path worthless. Money still in escrow is reported
    // SEPARATELY and never counted as earned — it is not yours until it is released.
    earned_spoken: (() => {
      const money = (c) => '$' + (c / 100).toFixed(2);
      if (earnedCents > 0 && pendingCents > 0) {
        return `You have earned ${money(earnedCents)} so far, and ${money(pendingCents)} more is still in escrow — that part is not yours yet.`;
      }
      if (earnedCents > 0) return `You have earned ${money(earnedCents)} on this platform so far.`;
      if (pendingCents > 0) {
        return `Nothing has been released to you yet, though ${money(pendingCents)} is sitting in escrow from a sale in progress.`;
      }
      return 'You have not earned anything yet. That is the honest number, and the steps above are the route to changing it.';
    })(),
  });
}));

module.exports = router;
