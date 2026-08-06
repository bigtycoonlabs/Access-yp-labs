// Clay Weekly — the platform's magazine.
//
// What it is: once a week Clay assembles an issue — the sponsored project of the week, everything he
// wrote for the Desk, shout-outs for the creators and Dream Movers who moved, and "Clay's Note", a
// short personal piece in his own voice. It becomes a public page AND an email to everyone who wants
// it. That turns this place into a quiet media company for entrepreneurs instead of just software.
//
// The rules this file holds to, because it is the first thing that mails people at scale:
//   1. NOTHING publishes or sends itself. Clay assembles a DRAFT; an owner approves; only then can it
//      go out. Same discipline as the Desk.
//   2. Nobody is featured as "sponsored" without being ASKED and saying yes. Clay proposes, an owner
//      approves the ask, the creator accepts or declines from an email link.
//   3. Every recipient can leave in one click, and we never mail someone who opted out.
//   4. Every number in an issue is counted from the record. Clay writes the prose; he does not invent
//      the facts, and a quiet week is reported as a quiet week.

const { query } = require('../../config/db');
const crypto = require('crypto');
const agent = require('./agent');
const provider = require('./provider');
const { sendEmail, sendBatch } = require('../email');
const { notifyStaff } = require('./staffNotify');

const SITE = () => (process.env.CLIENT_URL || 'https://accessyplabs.com').replace(/\/+$/, '');

// The Monday of the week a date falls in (UTC), as YYYY-MM-DD.
function weekStartOf(d) {
  const date = new Date(d || Date.now());
  const day = (date.getUTCDay() + 6) % 7;            // Monday = 0
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

function slugForWeek(weekStart) { return 'clay-weekly-' + weekStart; }

// ---- the week's raw material, all counted from the record ----------------------------------

// Desk pieces published during the issue's week.
async function weekArticles(weekStart) {
  const r = await query(
    `SELECT id, title, dek, slug, image_url, image_alt, kind
       FROM desk_articles
      WHERE status='published'
        AND published_at >= $1::date AND published_at < $1::date + interval '7 days'
      ORDER BY published_at ASC`, [weekStart]);
  return r.rows;
}

// Creators who put work into the Dream Market this week — the people to shout out.
async function topCreators(weekStart) {
  const r = await query(
    `SELECT u.id, COALESCE(NULLIF(u.name,''), 'A creator') AS name, count(*)::int AS listings
       FROM listings l
       JOIN concepts c ON c.id = l.concept_id
       JOIN users u    ON u.id = c.owner_id
      WHERE l.created_at >= $1::date AND l.created_at < $1::date + interval '7 days'
      GROUP BY u.id, u.name
      ORDER BY listings DESC, name ASC
      LIMIT 5`, [weekStart]);
  return r.rows;
}

// Dream Movers who actually earned this week. Money is reported as a dollar amount, never a bare
// percentage, and only what the ledger says.
async function topMovers(weekStart) {
  const r = await query(
    `SELECT COALESCE(NULLIF(u.name,''), 'A Dream Mover') AS name,
            m.slug,
            COALESCE(SUM(e.amount_cents),0)::int AS earned_cents,
            count(*)::int AS sales
       FROM mover_earnings e
       JOIN dream_movers m ON m.user_id = e.mover_id
       JOIN users u        ON u.id = e.mover_id
      WHERE e.created_at >= $1::date AND e.created_at < $1::date + interval '7 days'
      GROUP BY u.name, m.slug
      ORDER BY earned_cents DESC
      LIMIT 5`, [weekStart]);
  return r.rows;
}

// Projects worth featuring: someone is clearly TAKING THIS SOMEWHERE — it's listed in the Dream
// Market, or they've built a site for it, or they've told us they're heading to launch. Never
// includes a project whose creator already declined being featured.
async function sponsorCandidates(limit = 8) {
  const r = await query(
    `SELECT c.id, c.title, c.brief, c.category, c.movement_state,
            (c.launch_page IS NOT NULL)          AS has_site,
            EXISTS (SELECT 1 FROM listings l WHERE l.concept_id=c.id AND l.status='live') AS listed,
            u.id AS owner_id, COALESCE(NULLIF(u.name,''),'the creator') AS owner_name, u.email
       FROM concepts c
       JOIN users u ON u.id = c.owner_id
      WHERE (
              c.launch_page IS NOT NULL
              OR c.movement_state = 'ready_to_package'   -- the state that means it is genuinely moving
              OR EXISTS (SELECT 1 FROM listings l WHERE l.concept_id=c.id AND l.status='live')
            )
        AND NOT EXISTS (
              SELECT 1 FROM weekly_sponsorships s
               WHERE s.concept_id = c.id AND s.status IN ('declined','accepted','offered'))
      ORDER BY c.updated_at DESC
      LIMIT $1`, [limit]);
  return r.rows;
}

// ---- Clay's own writing for the issue ------------------------------------------------------

const NOTE_PROMPT = `Write "Clay's Note" for this week's issue of Clay Weekly, the magazine of Access YP Labs.

This is YOUR page — the one place in the whole product that is just you talking. Pick ONE of these and mean it: something you are proud of from this week, something you hope for this place, why you love what the people here are doing, or one honest thing you think an entrepreneur needs to hear right now.

Write it like a person, not a brand. Warm, a little funny, a little edgy — you can have an opinion and a sharp edge, you can be playful. Never corporate, never a motivational poster, never a list of tips. Two or three short paragraphs, no more.

Hard rules: never invent a statistic, a customer, a testimonial, or a result. Never claim something happened that you cannot see. If the week was quiet, a quiet week is a fine thing to write about honestly. It will be read aloud by people using a screen reader, so write plain prose: no markdown, no bullet characters, no emoji, no headers.

Return ONLY the note itself — no title, no preamble, no quotation marks around it.`;

function issueIntroPrompt(facts) {
  return `Write the opening paragraph for this week's issue of Clay Weekly, the magazine of Access YP Labs. You are Clay, and this is your magazine.

Here is what ACTUALLY happened this week, counted from the record — use only these facts, and do not invent any others:
${facts}

Two or three sentences that make someone want to read on. Confident, warm, with a little edge. If the week was quiet, say so honestly and make it charming rather than pretending it was busy. Plain prose, read aloud by screen readers: no markdown, no bullets, no emoji.

Return ONLY the paragraph.`;
}

function sponsorBlurbPrompt(c) {
  return `In two or three sentences, tell the readers of Clay Weekly why THIS project is the sponsored Project of the Week, and make them curious about it.

Project: ${c.title}
What it is: ${(c.brief || '').slice(0, 600)}
Signals: ${[c.listed ? 'listed in the Dream Market' : null, c.has_site ? 'has a working site' : null, c.movement_state ? 'creator says they are ' + c.movement_state : null].filter(Boolean).join('; ') || 'active this week'}

Be specific about what makes it interesting. Never invent traction, revenue, customers, or results — you may only reference the signals above. Plain prose for screen readers: no markdown, no bullets, no emoji. Return ONLY the sentences.`;
}

async function claySays(prompt, fallback) {
  try {
    if (!provider.available()) return fallback;
    const out = await agent.runChat({ messages: [{ role: 'user', content: prompt }], allowTools: [] });
    // Only use the text when Clay ACTUALLY answered. On any other status the reply field carries an
    // apology about the provider being down — publishing that as Clay's Note would put an error
    // message in the magazine and email it to everyone. Fall back to honest, pre-written prose.
    if (!out || out.status !== 'answered') return fallback;
    const reply = out.reply ? String(out.reply).trim() : '';
    return reply || fallback;
  } catch (_) { return fallback; }
}

// ---- assembling an issue --------------------------------------------------------------------

// Build (or rebuild) this week's DRAFT issue. Never publishes, never emails.
async function composeIssue({ weekStart } = {}) {
  const week = weekStart || weekStartOf(Date.now());
  const [articles, creators, movers] = await Promise.all([
    weekArticles(week), topCreators(week), topMovers(week),
  ]);

  // An accepted sponsorship to feature. It must not already belong to a DIFFERENT issue: once a
  // project has run as Project of the Week it is spent, otherwise the same creator would be
  // featured every week forever. Re-running compose for the same week keeps its own sponsorship,
  // which is why the existing issue's id is allowed through.
  const existing = await query('SELECT id FROM weekly_issues WHERE week_start=$1', [week]);
  const existingId = existing.rows.length ? existing.rows[0].id : null;
  const acc = await query(
    `SELECT s.id, s.concept_id, s.reason, c.title, c.brief
       FROM weekly_sponsorships s JOIN concepts c ON c.id=s.concept_id
      WHERE s.status='accepted' AND (s.issue_id IS NULL OR s.issue_id = $1)
      ORDER BY s.responded_at ASC LIMIT 1`, [existingId]);
  const sponsored = acc.rows[0] || null;

  const facts = [
    `${articles.length} new piece${articles.length === 1 ? '' : 's'} on the Desk`,
    `${creators.length} creator${creators.length === 1 ? '' : 's'} put work into the Dream Market`,
    `${movers.length} Dream Mover${movers.length === 1 ? '' : 's'} earned from a sale`,
    sponsored ? `the sponsored project of the week is ${sponsored.title}` : 'no sponsored project this week',
  ].join('; ');

  const intro = await claySays(issueIntroPrompt(facts),
    'Here is what moved this week at Access YP Labs.');
  const note = await claySays(NOTE_PROMPT,
    'Some weeks the work is quiet. Quiet is not nothing — quiet is where most real things get built.');
  const blurb = sponsored
    ? await claySays(sponsorBlurbPrompt({ title: sponsored.title, brief: sponsored.brief }), sponsored.reason || '')
    : null;

  const highlights = {
    article_ids: articles.map((a) => a.id),
    creators: creators.map((c) => ({ name: c.name, listings: c.listings })),
    movers: movers.map((m) => ({ name: m.name, slug: m.slug, earned_cents: m.earned_cents, sales: m.sales })),
  };

  const title = `Clay Weekly — week of ${week}`;
  const r = await query(
    `INSERT INTO weekly_issues (slug, week_start, title, intro, clays_note, sponsored_concept_id, sponsored_blurb, highlights, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft')
     ON CONFLICT (week_start) DO UPDATE SET
       title=EXCLUDED.title, intro=EXCLUDED.intro, clays_note=EXCLUDED.clays_note,
       sponsored_concept_id=EXCLUDED.sponsored_concept_id, sponsored_blurb=EXCLUDED.sponsored_blurb,
       highlights=EXCLUDED.highlights
     WHERE weekly_issues.status='draft'
     RETURNING id, slug, week_start, status`,
    [slugForWeek(week), week, title, intro, note,
     sponsored ? sponsored.concept_id : null, blurb, JSON.stringify(highlights)]);

  if (!r.rows.length) {
    const already = await query('SELECT id, slug, week_start, status FROM weekly_issues WHERE week_start=$1', [week]);
    return { ok: false, reason: 'already_approved_or_published', issue: already.rows[0] || null };
  }

  // Spend the sponsorship on THIS issue so it can never be reused in a later week.
  if (sponsored) {
    await query('UPDATE weekly_sponsorships SET issue_id=$2 WHERE id=$1', [sponsored.id, r.rows[0].id]);
  }

  return { ok: true, issue: r.rows[0], counts: { articles: articles.length, creators: creators.length, movers: movers.length } };
}

// ---- sponsorship: ask first, always ---------------------------------------------------------

// Offer a creator the sponsored slot. Sends THEM an email with accept and decline links.
async function offerSponsorship({ conceptId, reason }) {
  const c = await query(
    `SELECT c.id, c.title, u.id AS owner_id, u.email, COALESCE(NULLIF(u.name,''),'there') AS name
       FROM concepts c JOIN users u ON u.id=c.owner_id WHERE c.id=$1`, [conceptId]);
  if (!c.rows.length) return { ok: false, reason: 'not_found' };
  const row = c.rows[0];

  const token = crypto.randomBytes(24).toString('hex');
  await query(
    `INSERT INTO weekly_sponsorships (concept_id, user_id, token, reason) VALUES ($1,$2,$3,$4)`,
    [row.id, row.owner_id, token, (reason || '').slice(0, 1000)]);

  const yes = `${SITE()}/weekly/sponsor/${token}/accept`;
  const no = `${SITE()}/weekly/sponsor/${token}/decline`;
  const text = `Hi ${row.name},

This is Clay. I read a lot of what gets built here, and this week I'd like to feature ${row.title} as the sponsored Project of the Week in Clay Weekly — the magazine that goes out to everyone on Access YP Labs and is posted publicly on my Desk.

${reason ? reason + '\n\n' : ''}It costs you nothing. It is not an ad you pay for — I pick the project, and you decide whether you want the spotlight. If you say yes, I write a short piece about what you are building and it goes out with your name on it. If you say no, nothing happens and I will not ask again about this project.

Yes, feature it: ${yes}
No thanks: ${no}

Either answer is completely fine.

— Clay`;

  const sent = await sendEmail({
    to: row.email,
    subject: `Can I feature ${row.title} in Clay Weekly?`,
    text,
    html: `<p>${text.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`,
  });
  return { ok: true, sent: !!(sent && sent.sent !== false), concept: row.title, token };
}

// A creator answering yes or no from their email.
async function respondToSponsorship(token, accept) {
  const r = await query(
    `UPDATE weekly_sponsorships
        SET status = CASE WHEN $2 THEN 'accepted' ELSE 'declined' END, responded_at = now()
      WHERE token=$1 AND status='offered' AND expires_at > now()
      RETURNING id, concept_id, status`, [String(token || ''), !!accept]);
  return r.rows[0] || null;
}

// ---- approval, publishing, and sending -------------------------------------------------------

async function approve(id, approverId) {
  const r = await query(
    `UPDATE weekly_issues SET status='approved', approved_by=$2
      WHERE id=$1 AND status='draft' RETURNING id, slug, title`, [id, approverId || null]);
  return r.rows[0] || null;
}

async function publish(id) {
  const r = await query(
    `UPDATE weekly_issues SET status='published', published_at=now()
      WHERE id=$1 AND status='approved' RETURNING id, slug, title`, [id]);
  return r.rows[0] || null;
}

// Mail a PUBLISHED issue to everyone who wants it. Honest by construction: it only counts what the
// mail provider actually accepted, and it never touches anyone who opted out.
async function sendIssue(id) {
  const iss = await query('SELECT * FROM weekly_issues WHERE id=$1', [id]);
  const issue = iss.rows[0];
  if (!issue) return { ok: false, reason: 'not_found' };
  if (issue.status !== 'published') return { ok: false, reason: 'not_published' };
  if (issue.sent_at) return { ok: false, reason: 'already_sent', recipients: issue.recipients_count };

  // Anyone without a preferences row yet (an account created before this existed, or a row that
  // failed to write) would otherwise be silently skipped — invisible, and impossible to notice from
  // the outside. Give them the default row first, so the recipient list is genuinely everyone who
  // has not opted out, rather than everyone we happen to have a row for.
  await query(
    `INSERT INTO user_email_prefs (user_id) SELECT id FROM users ON CONFLICT (user_id) DO NOTHING`);

  const rec = await query(
    `SELECT u.email, COALESCE(NULLIF(u.name,''),'there') AS name, p.token
       FROM users u JOIN user_email_prefs p ON p.user_id=u.id
      WHERE p.weekly = true AND u.email IS NOT NULL`);
  if (!rec.rows.length) return { ok: false, reason: 'no_recipients' };

  const url = `${SITE()}/weekly/${issue.slug}`;
  let sent = 0;
  for (let i = 0; i < rec.rows.length; i += 100) {
    const chunk = rec.rows.slice(i, i + 100).map((u) => {
      const unsub = `${SITE()}/weekly/unsubscribe/${u.token}`;
      const text = `${issue.intro || ''}\n\nRead this week's issue: ${url}\n\n— Clay\n\nStop receiving Clay Weekly: ${unsub}`;
      return {
        to: u.email,
        subject: issue.title,
        text,
        html: `<p>${String(issue.intro || '').replace(/\n/g, '<br>')}</p>`
          + `<p><a href="${url}">Read this week's issue of Clay Weekly</a></p><p>— Clay</p>`
          + `<p style="font-size:12px;color:#666">You are getting this because you have an Access YP Labs account. `
          + `<a href="${unsub}">Stop receiving Clay Weekly</a>.</p>`,
        headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      };
    });
    const out = await sendBatch(chunk);
    sent += (out && out.sent) || 0;
  }

  await query('UPDATE weekly_issues SET sent_at=now(), recipients_count=$2 WHERE id=$1', [id, sent]);
  return { ok: true, recipients: sent, attempted: rec.rows.length };
}

async function unsubscribe(token) {
  const r = await query(
    `UPDATE user_email_prefs SET weekly=false, updated_at=now() WHERE token=$1 RETURNING user_id`,
    [String(token || '')]);
  return r.rows.length > 0;
}

// ---- reading ---------------------------------------------------------------------------------

async function getPublished(slug) {
  const r = await query(
    `SELECT w.*, c.title AS sponsored_title, c.brief AS sponsored_brief
       FROM weekly_issues w
       LEFT JOIN concepts c ON c.id = w.sponsored_concept_id
      WHERE w.slug=$1 AND w.status='published'`, [String(slug || '').slice(0, 120)]);
  if (!r.rows.length) return null;
  const issue = r.rows[0];
  const ids = (issue.highlights && issue.highlights.article_ids) || [];
  issue.articles = [];
  if (ids.length) {
    const a = await query(
      `SELECT id, title, dek, slug, image_url, image_alt FROM desk_articles
        WHERE id = ANY($1::uuid[]) AND status='published'`, [ids]);
    issue.articles = a.rows;
  }
  return issue;
}

async function listPublished(limit = 20) {
  const r = await query(
    `SELECT slug, title, week_start, published_at FROM weekly_issues
      WHERE status='published' ORDER BY week_start DESC LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 20, 1), 50)]);
  return r.rows;
}

async function listForStaff(limit = 10) {
  const r = await query(
    `SELECT id, slug, title, week_start, status, published_at, sent_at, recipients_count
       FROM weekly_issues ORDER BY week_start DESC LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 10, 1), 50)]);
  return r.rows;
}


// ---- the weekly cadence ----------------------------------------------------------------------

// Draft this week's issue on a schedule, then tell the owners it is waiting. It NEVER approves,
// publishes, or emails anyone — an issue still only reaches a reader when a human says so.
//
// The claim is the insert itself: weekly_issues is UNIQUE on week_start, so INSERT ... ON CONFLICT
// DO NOTHING either wins the week or returns nothing. That makes the tick safe to run every few
// hours, across restarts and across multiple instances, with no separate schedule table to drift.
async function tick() {
  try {
    if (!provider.available()) return { ok: false, reason: 'provider_down' };

    const week = weekStartOf(Date.now());
    const claim = await query(
      `INSERT INTO weekly_issues (slug, week_start, title, status)
       VALUES ($1, $2, $3, 'draft')
       ON CONFLICT (week_start) DO NOTHING
       RETURNING id`,
      [slugForWeek(week), week, `Clay Weekly — week of ${week}`]);
    if (!claim.rows.length) return { ok: false, reason: 'already_started' };

    // Fill the claimed shell in with the real issue.
    const out = await composeIssue({ weekStart: week });
    if (!out.ok) return { ok: false, reason: out.reason || 'compose_failed' };

    const c = out.counts || {};
    await notifyStaff({
      kind: 'weekly',
      dedupeKey: 'weekly-draft-' + week,
      subject: `Clay Weekly is drafted for the week of ${week}`,
      body: `I put this week's issue together: ${c.articles || 0} Desk piece(s), `
        + `${c.creators || 0} creator(s) who listed, and ${c.movers || 0} Dream Mover(s) who earned.\n\n`
        + `Nothing is public and nothing has been emailed. Read it, approve it, publish it, and send it `
        + `when you're ready: ${SITE()}/weekly-admin.html\n\n— Clay`,
    });

    return { ok: true, week, counts: c };
  } catch (e) {
    return { ok: false, reason: 'error', error: e && e.message };
  }
}

module.exports = {
  tick, weekStartOf, slugForWeek, composeIssue, offerSponsorship, respondToSponsorship,
  approve, publish, sendIssue, unsubscribe, getPublished, listPublished, listForStaff,
  sponsorCandidates, weekArticles, topCreators, topMovers,
};
