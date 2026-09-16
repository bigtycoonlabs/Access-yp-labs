// THE SWEEP — being told before it is too late.
//
// Obligations have carried due dates since the spine was built and nothing acted on them. A
// compliance ledger you have to remember to open defeats its own purpose: the person who loses an
// entity to administrative dissolution is not somebody who checked and ignored it, it is somebody
// who never looked because nothing made them.
//
// THREE RULES THIS SWEEP FOLLOWS, ALL EARNED ELSEWHERE IN THIS ESTATE:
//
//   Zero delivered is never recorded as sent. If the email fails, the reminder is not marked as
//   given and it will be tried again. A "sent" flag set before delivery is how somebody believes
//   they were warned about something they never heard of.
//
//   Nothing is warned about twice at the same distance. Somebody who gets the same reminder every
//   morning stops reading all of them, and then the one that mattered arrives in a stream they have
//   learned to ignore.
//
//   A person is warned about what THEY can see. The sweep runs per relationship and per permission
//   area, not per business — a bookkeeper with money:view is not told about a licence renewal, in a
//   reminder any more than on a screen.
//
// WHEN TO WARN. Not a fixed schedule: the distance is set by what missing it costs and how long the
// thing takes to do. A $400 Florida penalty with a hard 1 May date deserves earlier warning than a
// $25 renewal, and both deserve one the week it is due.

const { query } = require('../../config/db');
const R = require('../../lib/ranking');

// Days before the due date at which a reminder is worth sending. Expensive things get a longer run
// up, because the whole point is leaving enough time to actually do it.
function windowsFor(cents) {
  if (cents == null) return [7, 1];
  if (cents >= 30000) return [30, 14, 7, 1];
  if (cents >= 5000) return [14, 7, 1];
  return [7, 1];
}

function pickWindow(dueAt, cents) {
  const days = Math.ceil((new Date(dueAt) - Date.now()) / 86400000);
  // THE TIGHTEST WINDOW THAT STILL CONTAINS TODAY, which means walking them from small to large.
  //
  // The first version walked the list as written — [30, 14, 7, 1] — and returned the first match, so
  // thirteen days out matched 30. Every reminder landed in the 30-day window, and because the dedupe
  // is keyed on the window, that meant each obligation warned ONCE and then went silent. A $400
  // Florida filing would be mentioned a month out and never again until it was late, which is worse
  // than no reminder at all: it would have been believed.
  //
  // Ascending also gives the gap behaviour this needs — a day the job did not run does not skip a
  // reminder, because the next run still falls inside the same window and fires it.
  const ws = windowsFor(cents).slice().sort((a, b) => a - b);
  for (const w of ws) {
    if (days <= w) return { days, window: w };
  }
  return null;
}

// Who should hear about this one. The owner always; anybody else only if their permissions cover the
// area it belongs to.
async function audienceFor(o) {
  const area = R.KIND_AREA[o.kind] || 'projects';
  const r = await query(
    `SELECT u.id, u.email, u.name
       FROM businesses b
       JOIN users u ON u.id = b.owner_id
      WHERE b.id = $1 AND b.archived_at IS NULL
      UNION
     SELECT u.id, u.email, u.name
       FROM relationships rel
       JOIN users u ON u.id = rel.user_id
       JOIN permissions p ON p.relationship_id = rel.id
      WHERE rel.business_id = $1 AND rel.ended_on IS NULL
        AND p.area = $2 AND p.level <> 'none'`,
    [o.business_id, area]);
  return r.rows;
}

// THE TABLE ALREADY HAD THIS. I hand-rolled a dedupe by pattern-matching a suffix onto the url,
// and every insert failed on a NOT NULL I had not looked for: notifications.dedupe_key, with a
// unique index on it. The mechanism I was rebuilding badly was already there and enforced by the
// database, which is a better place for it than a LIKE query.
//
// Keyed on the person, the obligation and the WINDOW rather than the day, so a sweep that runs twice
// in a morning does not warn twice, and a day the job did not run does not silently skip one.
const dedupeKey = (userId, obligationId, window) =>
  'obligation_due:' + userId + ':' + obligationId + ':w' + window;

async function sweep({ send = null, limit = 500 } = {}) {
  let due;
  try {
    due = await query(
      `SELECT o.*, b.name AS business_name
         FROM obligations o
         JOIN businesses b ON b.id = o.business_id
        WHERE o.status='open' AND b.archived_at IS NULL
          AND o.due_at IS NOT NULL
          AND o.due_at > now() - interval '1 day'
          AND o.due_at < now() + interval '31 days'
        ORDER BY o.due_at ASC
        LIMIT $1`, [limit]);
  } catch (e) {
    // A sweep that could not read is not a sweep that found nothing.
    return { ok: false, reason: e.message, considered: 0, sent: 0, failed: 0 };
  }

  let considered = 0; let sent = 0; let failed = 0; let skipped = 0;
  for (const o of due.rows) {
    const w = pickWindow(o.due_at, o.cost_if_missed_cents);
    if (!w) continue;
    considered += 1;

    const people = await audienceFor(o);
    for (const person of people) {
      const key = dedupeKey(person.id, o.id, w.window);
      const seen = await query('SELECT 1 FROM notifications WHERE dedupe_key=$1 LIMIT 1', [key]);
      if (seen.rows.length) { skipped += 1; continue; }

      const says = R.explain(Object.assign({}, o, { overdue: false }));
      const headline = w.days <= 1
        ? o.title + ' is due tomorrow'
        : o.title + ' is due in ' + w.days + ' days';

      // DELIVERY FIRST, RECORD SECOND. If the send throws, nothing is written and the next sweep
      // tries again — rather than a row claiming they were told.
      if (send) {
        try {
          await send({ to: person.email, name: person.name, headline, body: says, obligation: o });
        } catch (e) {
          failed += 1;
          continue;
        }
      }

      try {
        await query(
          `INSERT INTO notifications (user_id, kind, headline, body, url, dedupe_key)
           VALUES ($1,'obligation_due',$2,$3,$4,$5)
           ON CONFLICT (dedupe_key) DO NOTHING`,
          [person.id, headline, says + ' (' + o.business_name + ')',
            '/today.html?o=' + o.id, key]);
        sent += 1;
      } catch (e) {
        failed += 1;
      }
    }
  }
  return { ok: true, considered, sent, failed, skipped };
}

module.exports = { sweep, pickWindow, windowsFor, audienceFor };
