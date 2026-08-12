// THE MOMENT AFTER CLAY BUILDS SOMETHING.
//
// This is where the platform loses people, and the data is unambiguous: every stalled project on the
// platform sits in the identical state — fourteen materials, stage 'concept', movement state
// 'needs_customer_clarity' — and then nothing, for days. Four projects, three different people, the
// same wall.
//
// The wall is not that Clay is wrong. He is right: they do not have a clear customer yet. But that
// verdict arrives at the exact moment somebody feels finished, and it arrives with nothing to DO.
// They came with an idea, watched something substantial appear, and the last thing they hear is that
// the hard part has not started.
//
// And then the only message this platform has ever sent them is the expiry warning — that their
// dream is about to fade. The single follow-up we had was a death notice.
//
// So: one email, a few days after things go quiet, with ONE action small enough to actually take
// this week. Not a nag, not a summary, not a feature announcement.

const { query } = require('../../config/db');
const { sendEmail } = require('../email');

const SITE = () => (process.env.CLIENT_URL || 'https://accessyplabs.com').replace(/\/+$/, '');

// One action per lane. Concrete enough to do on a Tuesday evening, and honest about what it proves.
// Deliberately NOT "keep building" — more material is what they already have too much of.
const NEXT_STEP = {
  needs_customer_clarity: {
    ask: 'Name one person who has this problem badly enough to pay someone to fix it.',
    how: 'Not a category — a person. "Salon owners" is a category. "Someone who runs a two-chair shop and '
      + 'turns away walk-ins on Saturdays" is a person you can go and find. If you cannot picture one, that '
      + 'is the most useful thing you have learned this week, and it is worth more than another page of plan.',
    reply: 'Reply to Clay with who that person is and he will pressure-test it with you.',
  },
  needs_proof: {
    ask: 'Get one stranger to act — not to compliment.',
    how: 'A booked paid call, a small preorder, a deposit, or a landing page that converts. One person you '
      + 'are not related to, doing something that costs them something. Encouragement from people who like '
      + 'you is not evidence, and it is the thing that has convinced more founders to waste a year than '
      + 'anything else.',
    reply: 'Tell Clay what happened either way — a no is information, and he will not flinch at it.',
  },
  ready_to_package: {
    ask: 'You have a clear customer and evidence they will pay. Decide what this becomes.',
    how: 'Launch it yourself, or list it in the Exchange and let someone else run with it. Both are '
      + 'real choices and neither is a failure. What is a waste is leaving it sitting here finished.',
    reply: 'Ask Clay what it is honestly worth as a listing — he will tell you, including when the answer is "not much yet".',
  },
};

// Projects that have gone quiet, whose owner has not been nudged about this one before. A single
// message per project, ever: the point is to be useful once, not to become the thing they filter.
async function findStalled({ quietDays = 3, limit = 25 } = {}) {
  const r = await query(
    `SELECT c.id, c.title, c.movement_state, c.owner_id,
            u.email, COALESCE(NULLIF(u.name,''), 'there') AS name
       FROM concepts c
       JOIN users u ON u.id = c.owner_id
      WHERE u.email IS NOT NULL
        AND u.email <> 'clay@accessyplabs.com'
        AND c.expired_at IS NULL
        AND c.updated_at < now() - ($1 || ' days')::interval
        AND c.nudged_at IS NULL
        AND EXISTS (SELECT 1 FROM assets a WHERE a.concept_id = c.id AND a.is_current)
      ORDER BY c.updated_at ASC
      LIMIT $2`, [String(quietDays), Math.min(Math.max(Number(limit) || 25, 1), 100)]);
  return r.rows;
}

async function nudgeOne(row) {
  const step = NEXT_STEP[row.movement_state || 'needs_customer_clarity'] || NEXT_STEP.needs_customer_clarity;
  const link = `${SITE()}/concept.html?id=${row.id}`;

  const text = `Hi ${row.name},\n\n`
    + `"${row.title}" has been sitting for a few days, and I think I know why.\n\n`
    + 'You have a finished project — the plan, the research, the risk read, all of it. What you do not '
    + 'have yet is the one thing none of that can give you, and there is no amount of extra material '
    + 'that will produce it.\n\n'
    + `THIS WEEK: ${step.ask}\n\n${step.how}\n\n${step.reply}\n\n`
    + `Open it here: ${link}\n\n`
    + 'Nothing is expiring and nothing is wrong. This is just the next real step, and it is smaller than it looks.';

  const out = await sendEmail({
    to: row.email,
    subject: `One step for "${row.title}"`,
    text,
    html: `<p>Hi ${row.name},</p>`
      + `<p><strong>"${row.title}"</strong> has been sitting for a few days, and I think I know why.</p>`
      + '<p>You have a finished project — the plan, the research, the risk read, all of it. What you do not have '
      + 'yet is the one thing none of that can give you, and there is no amount of extra material that will '
      + 'produce it.</p>'
      + `<p><strong>This week: ${step.ask}</strong></p><p>${step.how}</p><p>${step.reply}</p>`
      + `<p><a href="${link}">Open your project</a></p>`
      + '<p style="color:#666">Nothing is expiring and nothing is wrong. This is just the next real step, and it '
      + 'is smaller than it looks.</p>',
  }).catch((e) => ({ sent: false, reason: (e && e.message) || 'threw' }));

  // sendEmail resolves with { sent:false } rather than throwing. Marking it nudged when nothing was
  // delivered would burn the ONE message this project gets on an email that never arrived.
  if (!out || !out.sent) {
    return { ok: false, concept_id: row.id, reason: (out && out.reason) || 'unknown' };
  }
  await query('UPDATE concepts SET nudged_at = now() WHERE id = $1', [row.id]);
  return { ok: true, concept_id: row.id };
}

async function runNudges(opts = {}) {
  try {
    const rows = await findStalled(opts);
    if (!rows.length) return { ok: true, sent: 0, considered: 0 };
    let sent = 0;
    const failed = [];
    for (const row of rows) {
      const r = await nudgeOne(row);
      if (r.ok) sent += 1; else failed.push(r);
    }
    // Reported honestly: a nudge run that reached nobody is not a successful run.
    return { ok: sent > 0 || failed.length === 0, sent, considered: rows.length, failed: failed.length,
      ...(failed.length ? { first_failure: failed[0].reason } : {}) };
  } catch (e) {
    return { ok: false, reason: 'error', error: e && e.message };
  }
}

module.exports = { NEXT_STEP, findStalled, nudgeOne, runNudges };
