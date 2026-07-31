// Stale-build sweep.
//
// A Clay build runs inside the web process. If that process restarts mid-build — a deploy, a
// crash — the build's row is orphaned in 'building' forever, and the person is left being told
// work is still happening when it isn't. The client even promises "I'll email it to you the
// moment it's ready." This sweep makes that promise honest: any build stuck 'building' well
// past the longest a real build could take is marked failed (nothing saved, nothing fabricated)
// and the person is emailed the truth, so they know to try again instead of waiting on a
// concept that will never arrive.
const { query } = require('../config/db');
const { sendEmail } = require('./email');

// A real build can't run this long — the model call itself caps at ~3 minutes and the client
// gives up watching at ~6. Anything still 'building' past this is dead, not slow.
const STALE_AFTER_MIN = 10;

const FAILED_MESSAGE = 'This build didn’t finish — the server most likely restarted while Clay was working. Nothing was saved and nothing was made up. Please try again.';

async function logBuildFailedEmail(toEmail, res) {
  try {
    const sent = !!(res && res.sent);
    await query('INSERT INTO email_log (to_email, kind, sent, reason, provider_id) VALUES ($1,$2,$3,$4,$5)',
      [toEmail, 'build_failed', sent, sent ? null : ((res && res.reason) || 'unknown'), sent ? (res.id || null) : null]);
  } catch (_) { /* logging must never break the sweep */ }
}

async function sweepStaleBuilds() {
  const stale = (await query(
    `SELECT b.id, u.email
       FROM clay_builds b JOIN users u ON u.id=b.actor_id
      WHERE b.status='building'
        AND b.updated_at < now() - interval '${STALE_AFTER_MIN} minutes'
      LIMIT 100`)).rows;
  let failed = 0;
  for (const b of stale) {
    // Fail it — but only if it's still 'building', so we never stomp a build that just
    // finished on its own between our read and our write.
    const upd = await query(
      `UPDATE clay_builds
          SET status='failed', message=$2, notes = notes || $3::jsonb, updated_at=now()
        WHERE id=$1 AND status='building'
        RETURNING id`,
      [b.id, FAILED_MESSAGE, JSON.stringify([{ text: FAILED_MESSAGE }])]);
    if (!upd.rows.length) continue;
    failed++;
    if (b.email) {
      let res = { sent: false, reason: 'unknown' };
      try {
        res = await sendEmail({
          to: b.email,
          subject: 'Your Clay build didn’t finish',
          text: FAILED_MESSAGE + ' Open Access YP Labs and try again: https://accessyplabs.com/app.html',
          html: '<div style="max-width:600px;margin:0 auto;font-family:system-ui,sans-serif;font-size:16px;line-height:1.55;color:#1c1917">' +
            '<p>' + FAILED_MESSAGE + '</p>' +
            '<p><a href="https://accessyplabs.com/app.html" style="display:inline-block;background:#7c2d12;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none">Open Access YP Labs and try again</a></p>' +
            '<p>— Clay, at Access YP Labs</p></div>',
        });
      } catch (e) { res = { sent: false, reason: (e && e.message) || 'error' }; }
      await logBuildFailedEmail(b.email, res);
    }
  }
  return { stale_failed: failed };
}

module.exports = { sweepStaleBuilds, STALE_AFTER_MIN };
