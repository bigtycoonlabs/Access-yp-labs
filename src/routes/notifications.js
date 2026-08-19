// WHAT HAPPENED, FOR THE PERSON IT HAPPENED TO.
//
// Read-only except for marking things read. Notifications are a record of events, not a to-do list
// somebody edits.

const express = require('express');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../lib/http');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT id, kind, headline, body, url, read_at, created_at
       FROM notifications WHERE user_id=$1
      ORDER BY created_at DESC LIMIT 50`, [req.user.id]);
  const unread = r.rows.filter((n) => !n.read_at).length;
  res.json({
    ok: true,
    notifications: r.rows,
    unread,
    // Said in words, because a bare 0 and a failed read look identical and only one of them means
    // nothing happened.
    summary: r.rows.length
      ? (unread ? unread + ' new since you last looked.' : 'Nothing new since you last looked.')
      : 'Nothing has happened on your projects yet.',
  });
}));

// What happened while you were away. The idle mechanic, and it is already true: a listing is live
// 24 hours a day and the platform has never once said what happened on it overnight.
//
// Some mornings this says nothing happened, and it has to be allowed to. A report that always finds
// something to celebrate is one nobody believes by week three.
router.get('/overnight', authenticate, asyncHandler(async (req, res) => {
  const hours = Math.min(168, Math.max(1, Number(req.query.hours) || 24));
  // UNREAD ONLY. Caught by looking at the rendered dashboard: somebody who had already read and
  // acted on everything was still being shown it under "While you were away". If you have read it,
  // you were not away.
  //
  // Without this the panel repeats itself every morning for a day, which teaches people to skip the
  // one part of the page whose entire job is being worth reading.
  const r = await query(
    `SELECT kind, headline, body, url, created_at
       FROM notifications
      WHERE user_id=$1 AND read_at IS NULL
        AND created_at > now() - ($2 || ' hours')::interval
      ORDER BY created_at DESC LIMIT 20`,
    [req.user.id, String(hours)]);

  res.json({
    ok: true,
    hours,
    events: r.rows,
    // No invented encouragement on an empty day. "Nothing happened" is the honest answer and it is
    // what makes the days something did happen worth reading.
    line: r.rows.length
      ? 'While you were away: ' + r.rows.map((x) => x.headline).slice(0, 4).join('. ') + '.'
      : 'Nothing new on your projects in the last ' + (hours === 24 ? 'day' : hours + ' hours') + '.',
  });
}));

router.post('/:id/read', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `UPDATE notifications SET read_at=NOW()
      WHERE id=$1 AND user_id=$2 AND read_at IS NULL RETURNING id`,
    [req.params.id, req.user.id]);
  // Already read is not an error. Marking something twice is a person clicking twice.
  res.json({ ok: true, changed: r.rows.length > 0 });
}));

router.post('/read-all', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `UPDATE notifications SET read_at=NOW() WHERE user_id=$1 AND read_at IS NULL RETURNING id`,
    [req.user.id]);
  res.json({ ok: true, marked: r.rows.length });
}));

module.exports = router;
