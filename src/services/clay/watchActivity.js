// Watching a dream, and actually being told about it.
//
// Watches existed already, but nothing ever spoke — following something and then hearing nothing is
// worse than not offering it, because the person believes they're covered.
//
// How it works, and why:
//   * Activity is RECORDED first and mailed later. Several things often happen to a listing at once
//     (a bid, then another bid, then the seller adds material); batching turns that into one message
//     instead of five, and an event that fails to send stays pending instead of being lost.
//   * The person who caused the event is never notified about their own action.
//   * Every message says what actually happened in plain words, and never implies more than the
//     record shows — "someone placed a bid" is the truth; "interest is heating up" is not.
//   * Watch mail has its own switch, separate from the magazine, with an unsubscribe link on every
//     message.

const { query } = require('../../config/db');
const { sendBatch } = require('../email');
const { notifyStaff } = require('./staffNotify');

const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;   // after three days, activity news is not news

const SITE = () => (process.env.CLIENT_URL || 'https://accessyplabs.com').replace(/\/+$/, '');
const money = (c) => '$' + ((Number(c) || 0) / 100).toFixed(2);

// Record something that happened to a listing. Best-effort by design: an activity note must never
// be able to break the action that caused it — a bid that succeeded must not fail because the
// bookkeeping did.
async function record(listingId, kind, detail) {
  try {
    if (!listingId || !kind) return { ok: false, reason: 'missing' };
    await query('INSERT INTO listing_events (listing_id, kind, detail) VALUES ($1,$2,$3)',
      [listingId, kind, String(detail || '').slice(0, 400)]);
    return { ok: true };
  } catch (e) {
    console.error('listing event not recorded:', kind, e && e.message);
    return { ok: false, reason: 'error' };
  }
}

// Ready-made wordings, so every notice reads the same way and none of them oversell.
const say = {
  bid: (amount) => `Someone placed a bid of ${money(amount)}.`,
  valueAdded: (what) => `The creator added to it${what ? ': ' + what : ''}.`,
  priceChanged: (amount) => `The price is now ${money(amount)}.`,
  sold: () => 'It has been claimed by a buyer, so it is no longer available.',
  auctionEnded: (amount) => amount
    ? `The auction ended. The winning bid was ${money(amount)}.`
    : 'The auction ended without any bids.',
  relisted: () => 'It is back on the market.',
};

// Send pending activity to the people watching. Never throws.
async function notifyWatchers(limit = 200) {
  try {
    const ev = await query(
      `SELECT e.id, e.listing_id, e.kind, e.detail, e.created_at, c.title
         FROM listing_events e
         JOIN listings l ON l.id = e.listing_id
         JOIN concepts c ON c.id = l.concept_id
        WHERE e.notified_at IS NULL
        ORDER BY e.created_at ASC
        LIMIT $1`, [limit]);
    if (!ev.rows.length) return { ok: true, sent: 0, events: 0 };

    // Group by listing so one dream produces one message, however much happened to it.
    const byListing = new Map();
    ev.rows.forEach((e) => {
      if (!byListing.has(e.listing_id)) byListing.set(e.listing_id, { title: e.title, events: [] });
      byListing.get(e.listing_id).events.push(e);
    });

    let sent = 0;
    let undelivered = 0;
    let abandoned = 0;
    for (const [listingId, group] of byListing) {
      let groupSent = 0;
      // Who is watching, minus anyone who switched watch mail off. The seller is excluded: they get
      // their own notices and shouldn't be told about their own listing as if they were a bystander.
      const watchers = await query(
        `SELECT u.email, COALESCE(NULLIF(u.name,''),'there') AS name, p.token
           FROM watches w
           JOIN users u ON u.id = w.user_id
           JOIN user_email_prefs p ON p.user_id = u.id
           JOIN listings l ON l.id = w.listing_id
          WHERE w.listing_id = $1 AND p.watch_activity = true AND u.email IS NOT NULL
            AND w.user_id <> l.seller_id`, [listingId]);

      if (watchers.rows.length) {
        const lines = group.events.map((e) => '- ' + (e.detail || e.kind));
        const url = `${SITE()}/listing.html?id=${listingId}`;
        const emails = watchers.rows.map((w) => {
          const stop = `${SITE()}/watch/unsubscribe/${w.token}`;
          const body = `Hi ${w.name},\n\nSomething happened with a dream you're watching — ${group.title}:\n\n`
            + `${lines.join('\n')}\n\nSee it: ${url}\n\n— Clay\n\nStop getting news about projects you watch: ${stop}`;
          return {
            to: w.email,
            subject: `${group.title} — ${group.events.length === 1 ? 'an update' : group.events.length + ' updates'}`,
            text: body,
            html: `<p>Something happened with a dream you're watching — <strong>${group.title}</strong>:</p>`
              + `<ul>${group.events.map((e) => `<li>${e.detail || e.kind}</li>`).join('')}</ul>`
              + `<p><a href="${url}">See it</a></p><p>— Clay</p>`
              + `<p style="font-size:12px;color:#666"><a href="${stop}">Stop getting news about projects you watch</a>.</p>`,
            headers: { 'List-Unsubscribe': `<${stop}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
          };
        });
        for (let i = 0; i < emails.length; i += 100) {
          const out = await sendBatch(emails.slice(i, i + 100));
          groupSent += (out && out.sent) || 0;
        }
        sent += groupSent;
      }

      // TWO DIFFERENT OUTCOMES THAT USED TO LOOK THE SAME.
      //
      // Nobody watching: there is genuinely nothing to send, so mark it handled — leaving it
      // pending forever would grow the queue without end.
      //
      // Watchers, but delivery FAILED: marking it handled throws the news away. The people who
      // asked to be told would never be told, and there would be no trace. Those events stay
      // pending so the next run tries again, and a repeated failure is reported rather than
      // quietly eating everyone's notifications.
      const nobodyToTell = watchers.rows.length === 0;
      const delivered = groupSent > 0;
      if (nobodyToTell || delivered) {
        await query('UPDATE listing_events SET notified_at = now() WHERE id = ANY($1::uuid[])',
          [group.events.map((e) => e.id)]);
      } else {
        // Retried, but not forever. If email stays broken, holding every event for all time just
        // trades one silent failure for an unbounded table. After three days the news is stale
        // enough that sending it would confuse more than it helps, so it is released — and that
        // release is REPORTED, because giving up quietly is the thing this whole change exists to
        // prevent.
        const stale = group.events.filter((e) => (Date.now() - new Date(e.created_at).getTime()) > STALE_AFTER_MS);
        if (stale.length) {
          await query('UPDATE listing_events SET notified_at = now() WHERE id = ANY($1::uuid[])',
            [stale.map((e) => e.id)]);
          abandoned += stale.length;
        }
        undelivered += group.events.length - stale.length;
      }
    }

    if (abandoned > 0) {
      console.error(`watch activity: gave up on ${abandoned} event(s) older than three days`);
    }
    if (undelivered > 0 || abandoned > 0) {
      console.error(`watch activity: ${undelivered} event(s) could not be delivered; left pending for retry`);
      try {
        await notifyStaff({
          kind: 'watch_delivery_failed',
          dedupeKey: 'watch-undelivered-' + new Date().toISOString().slice(0, 13),
          subject: 'Watchers are not being told about activity',
          body: `${undelivered} activity notice(s) could not be delivered to people watching a project`
            + (abandoned ? `, and ${abandoned} older than three days were given up on entirely.` : '.')
            + '\n\nQueued notices will be retried, so those are not lost yet — but people who asked to be '
            + 'kept informed are currently not being. Worth checking email delivery.',
        });
      } catch (e) { console.error('could not report undelivered watch notices:', e && e.message); }
    }

    return { ok: undelivered === 0 && abandoned === 0, sent, undelivered, abandoned, events: ev.rows.length, listings: byListing.size };
  } catch (e) {
    return { ok: false, reason: 'error', error: e && e.message };
  }
}

async function unsubscribeWatch(token) {
  const r = await query(
    'UPDATE user_email_prefs SET watch_activity=false, updated_at=now() WHERE token=$1 RETURNING user_id',
    [String(token || '')]);
  return r.rows.length > 0;
}

module.exports = { record, say, notifyWatchers, unsubscribeWatch };
