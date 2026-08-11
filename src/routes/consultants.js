const express = require('express');
const router = express.Router();

// ---------------------------------------------------------------------------------------------
// CONSULTANTS ARE RETIRED. LAUNCH PARTNERS REPLACED THEM.
//
// First the pages went and the dashboard section came out, and thirteen endpoints stayed live and
// reachable by anyone with an account — including POST /engagements/:id/pay, which opened a real
// $150 Stripe checkout. A retired product with a working payment link is not a leftover; it is a way
// to take somebody's money for something we no longer do and cannot deliver. That was closed at the
// router, with the handlers left intact below it and unreachable.
//
// The owner has now retired the product outright, so the handlers are gone too, and so is
// stripe.createConsultCheckout. Leaving 200 lines of dead code that reference a deleted payment
// function is how a closed door quietly becomes an open one again: somebody removes the gate to
// "clean up", and thirteen endpoints come back.
//
// Nothing is stranded. Read from production before deleting any of it: zero consultants, zero
// applications, zero engagements, zero users holding the consultant role, zero reviews of a
// consultant. Nobody applied, nobody was approved, nobody was paid. The tables are left in place —
// dropping them destroys the shape of an arrangement without gaining anything, and they hold no rows
// to protect.
//
// 410 Gone rather than 404, because these endpoints DID exist. A client still calling one deserves
// to be told it was withdrawn, not that it never was.
const RETIRED = 'Paid consultant sessions are retired. Launch partners replaced them: people find '
  + 'each other on the partner board, agree their own terms directly, and we take no fee and are not '
  + 'party to the arrangement. Nothing has been charged.';

router.use((req, res) => {
  res.status(410).json({ ok: false, error: RETIRED, retired: true, replaced_by: '/partners.html' });
});

module.exports = router;
