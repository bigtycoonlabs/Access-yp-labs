// Clay Weekly — the platform's magazine.
//
// What it is: once a week Clay assembles an issue — the sponsored project of the week, everything he
// wrote for the Desk, shout-outs for the creators and Affiliates who moved, and "Clay's Note", a
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
const sections = require('./weeklySections');
const subscribers = require('./weeklySubscribers');
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

// Creators who put work into the Exchange this week — the people to shout out.
async function topCreators(weekStart) {
  const r = await query(
    // THE DREAMER TAG, NEVER THE REAL NAME. This read u.name, so the magazine — which goes to every
    // account and is posted publicly — was printing people's actual first and last names. The whole
    // point of a builder tag is that it is the only name shown anywhere; a publication leaking real
    // names is the single worst place for that rule to break.
    `SELECT u.id, COALESCE(NULLIF(u.display_name,''), 'A creator') AS name, count(*)::int AS listings
       FROM listings l
       JOIN concepts c ON c.id = l.concept_id
       JOIN users u    ON u.id = c.owner_id
      WHERE l.created_at >= $1::date AND l.created_at < $1::date + interval '7 days'
      GROUP BY u.id, u.display_name
      ORDER BY listings DESC, name ASC
      LIMIT 5`, [weekStart]);
  return r.rows;
}

// Affiliates who actually earned this week. Money is reported as a dollar amount, never a bare
// percentage, and only what the ledger says.
async function topMovers(weekStart) {
  const r = await query(
    `SELECT COALESCE(NULLIF(u.display_name,''), 'An Affiliate') AS name,
            m.slug,
            COALESCE(SUM(e.amount_cents),0)::int AS earned_cents,
            count(*)::int AS sales
       FROM mover_earnings e
       JOIN dream_movers m ON m.user_id = e.mover_id
       JOIN users u        ON u.id = e.mover_id
      WHERE e.created_at >= $1::date AND e.created_at < $1::date + interval '7 days'
      GROUP BY u.display_name, m.slug
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

WHAT THIS MAGAZINE BELIEVES, and you may say it in your own words whenever it fits:

An idea nobody has built is treated by the rest of the world as worth precisely nothing. It is a daydream, a someday, the thing you mention at a party and then apologise for. Every serious institution has agreed on this without ever examining it: banks will not lend against it, investors will not look until it already works, and the entire business press writes about companies that made it — as if the interesting part were the end rather than the beginning.

That is not a judgement about ideas. It is a failure of imagination, and a gap in the market so obvious it is almost funny that it was left sitting there. An unbuilt business that has been researched properly, costed honestly, and shaped into something someone else could pick up and run is an ASSET. It has value the moment it exists, not the moment it succeeds. We are simply the first people to treat it that way and write the price on the tag.

You are allowed to be pointed and dry about the world's blind spot. You are NOT allowed to be smug, to sneer at any individual person or named company, or to exaggerate how busy this place is in order to land a joke. Mocking an absent institution is funny; mockery that needs our own numbers inflated is just a lie with a joke on top. When the week is thin, the honest version — 'small week, and here is what it is worth anyway' — is better than any boast.

Return ONLY the paragraph.`;
}

function sponsorBlurbPrompt(c) {
  return `In two or three sentences, tell the readers of Clay Weekly why THIS project is the sponsored Project of the Week, and make them curious about it.

Project: ${c.title}
What it is: ${(c.brief || '').slice(0, 600)}
Signals: ${[c.listed ? 'listed in the Exchange' : null, c.has_site ? 'has a working site' : null, c.movement_state ? 'creator says they are ' + c.movement_state : null].filter(Boolean).join('; ') || 'active this week'}

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
  const [articles, creators, movers, best, builder, news] = await Promise.all([
    weekArticles(week), topCreators(week), topMovers(week),
    // The recurring sections that make this a publication rather than a digest. Each fails soft:
    // a section with nothing real behind it is left out, never filled with something invented.
    sections.topArticles(week, 5).catch(() => []),
    sections.topDreamer(week).catch(() => null),
    sections.worldNews({ limit: 3 }).catch(() => ({ ok: false, items: [] })),
  ]);
  const term = sections.termForWeek(week);

  // THE WHITE PAPER RIDES WITH THE FIRST ISSUE ONLY. Nobody reading the very first Clay Weekly knows
  // what this place is, so the issue that introduces the magazine should also introduce the platform
  // — why it exists, what it costs, and how everyone involved makes money. Checked against whether
  // any issue has EVER been sent rather than a flag someone has to remember to clear, so it can be
  // rebuilt or rejected and rewritten without losing it, and can never reappear in issue two.
  const priorSends = await query('SELECT COUNT(*)::int AS n FROM weekly_issues WHERE sent_at IS NOT NULL');
  const isFirstIssue = (priorSends.rows[0].n || 0) === 0;

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
    best.length ? `the five pieces worth reading are ${best.slice(0, 5).map((a) => a.title).join('; ')}` : null,
    `the term explained this week is ${term.term} — ${term.short}`,
    builder ? `the builder who kept turning up is ${builder.tag}, here on ${builder.days_here} days` : null,
    (news && news.ok && news.items.length) ? `outside news worth noting: ${news.items.map((i) => i.title).join('; ')}` : null,
    isFirstIssue ? 'this is the FIRST issue ever, and it carries the white paper explaining why this place exists — mention that this one comes with the whole argument attached' : null,
    `${articles.length} new piece${articles.length === 1 ? '' : 's'} on the Desk`,
    `${creators.length} creator${creators.length === 1 ? '' : 's'} put work into the Exchange`,
    `${movers.length} Affiliate${movers.length === 1 ? '' : 's'} earned from a sale`,
    sponsored ? `the sponsored project of the week is ${sponsored.title}` : 'no sponsored project this week',
  ].filter(Boolean).join('; ');

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
    // The publication sections, stored with the issue so what a reader sees is exactly what was
    // approved — not re-computed at render time, when the week's numbers would already have moved.
    best_reads: best.map((a) => ({ title: a.title, dek: a.dek, slug: a.slug, category: a.category,
      from_earlier: !!a.from_earlier })),
    term,
    builder,
    world_news: (news && news.ok) ? news.items : [],
    white_paper: isFirstIssue ? {
      title: 'Why we built this place',
      blurb: 'Since this is the first issue: the whole argument, in full. What Access YP Labs is, '
        + 'what it costs, how everyone involved makes money, the uncomfortable part about how often '
        + 'things actually sell, and the one line we never cross.',
      url: '/white-paper',
    } : null,
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

  // CLAY'S OWN PROJECTS NEED NOBODY'S PERMISSION. Consent exists to protect a real creator from
  // being written about without agreeing to it. A project the platform seeded has no such creator —
  // asking means emailing Clay to ask Clay, and then waiting for a reply that has to be clicked by
  // hand before the issue can move. That is not a safeguard, it is a dead end in the workflow.
  const isPlatformOwned = await query(
    `SELECT 1 FROM concepts c JOIN users u ON u.id = c.owner_id
      WHERE c.id = $1 AND (c.origin = 'clay_seed' OR u.email = 'clay@accessyplabs.com') LIMIT 1`,
    [conceptId]);
  if (isPlatformOwned.rows.length) {
    const selfToken = crypto.randomBytes(24).toString('hex');
    await query(
      `INSERT INTO weekly_sponsorships (concept_id, user_id, token, reason, status, responded_at)
       VALUES ($1,$2,$3,$4,'accepted',now())`,
      [row.id, row.owner_id, selfToken, (reason || '').slice(0, 1000)]);
    return {
      ok: true, status: 'accepted', self_owned: true,
      message: `${row.title} is one of Clay's own projects, so there is nobody to ask — it is featured straight away.`,
    };
  }

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
  // Members AND public subscribers. The magazine exists to reach people who are not here yet, so
  // leaving subscribers out of the send would defeat the point of collecting them.
  let outsiders = [];
  try { outsiders = await subscribers.recipients(); } catch (_) { outsiders = []; }
  const everyone = rec.rows.concat(outsiders.map((s) => ({ email: s.email, name: s.name, token: s.token, outsider: true })));
  if (!everyone.length) return { ok: false, reason: 'no_recipients' };

  const url = `${SITE()}/weekly/${issue.slug}`;
  let sent = 0;
  for (let i = 0; i < everyone.length; i += 100) {
    const chunk = everyone.slice(i, i + 100).map((u) => {
      // Subscribers unsubscribe through their own link — the member path expects an account and
      // would fail for someone who has never had one.
      const unsub = u.outsider
        ? `${SITE()}/weekly/leave/${u.token}`
        : `${SITE()}/weekly/unsubscribe/${u.token}`;
      // No sign-off. A magazine is not a letter: it does not end 'love, the editor'. This used to
      // close '— Clay', and the creator lines above it printed real names, so an issue ended with a
      // signature and somebody's actual name underneath. The masthead at the top is the byline.
      const text = `${issue.intro || ''}\n\nRead this week's issue: ${url}\n\nStop receiving Clay Weekly: ${unsub}`;
      return {
        to: u.email,
        subject: issue.title,
        text,
        html: `<p>${String(issue.intro || '').replace(/\n/g, '<br>')}</p>`
          + `<p><a href="${url}">Read this week's issue of Clay Weekly</a></p>`
          + `<p style="font-size:12px;color:#666">You are getting this because you have an Access YP Labs account. `
          + `<a href="${unsub}">Stop receiving Clay Weekly</a>.</p>`,
        headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      };
    });
    const out = await sendBatch(chunk);
    sent += (out && out.sent) || 0;
  }

  // ZERO DELIVERED IS NOT A SEND. This used to mark the issue as sent regardless, which was doubly
  // wrong: it reported success for an issue nobody received, AND stamping sent_at meant the
  // already_sent guard above would refuse to ever try again. A week's issue could be silently lost
  // with the record insisting it had gone out.
  if (sent === 0) {
    return { ok: false, reason: 'nothing_delivered', recipients: 0, attempted: everyone.length,
      message: `Nothing was delivered — all ${everyone.length} attempts failed, so no reader has it. `
        + 'The issue has NOT been marked as sent, so you can try again once the problem is fixed.' };
  }
  await query('UPDATE weekly_issues SET sent_at=now(), recipients_count=$2 WHERE id=$1', [id, sent]);
  if (sent < rec.rows.length) {
    return { ok: true, recipients: sent, attempted: everyone.length,
      message: `Sent to ${sent} of ${everyone.length}. The rest did not go through — that gap is real.` };
  }
  return { ok: true, recipients: sent, attempted: everyone.length, message: `Sent to all ${sent} readers.` };
}

async function unsubscribe(token) {
  const r = await query(
    `UPDATE user_email_prefs SET weekly=false, updated_at=now() WHERE token=$1 RETURNING user_id`,
    [String(token || '')]);
  return r.rows.length > 0;
}

// ---- reading ---------------------------------------------------------------------------------

// Read an issue by slug. `includeDrafts` is for STAFF PREVIEW only, and it is the whole reason this
// parameter exists: without it the only way to read an issue was to publish it first, which meant
// the one person who is supposed to approve it could not see what they were approving. Approving
// something you cannot read is not approval.
async function getBySlug(slug, { includeDrafts = false } = {}) {
  const r = await query(
    `SELECT w.*, c.title AS sponsored_title, c.brief AS sponsored_brief
       FROM weekly_issues w
       LEFT JOIN concepts c ON c.id = w.sponsored_concept_id
      WHERE w.slug=$1 AND ($2 = true OR w.status='published')`,
    [String(slug || '').slice(0, 120), includeDrafts]);
  if (!r.rows.length) return null;
  const issue = r.rows[0];
  const ids = (issue.highlights && issue.highlights.article_ids) || [];
  issue.articles = [];
  if (ids.length) {
    // A draft issue may reference Desk articles that are themselves still drafts. In preview we
    // want to see them, so the person approving sees the real issue rather than a version with
    // holes in it.
    const a = await query(
      `SELECT id, title, dek, slug, image_url, image_alt, status FROM desk_articles
        WHERE id = ANY($1::uuid[]) AND ($2 = true OR status='published')`, [ids, includeDrafts]);
    issue.articles = a.rows;
  }
  return issue;
}

// The public reader: published only, always.
async function getPublished(slug) { return getBySlug(slug, { includeDrafts: false }); }

// The staff preview: read an issue at any stage, exactly as a reader would see it.
async function getForPreview(slug) { return getBySlug(slug, { includeDrafts: true }); }

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
        + `${c.creators || 0} creator(s) who listed, and ${c.movers || 0} Affiliate(s) who earned.\n\n`
        + `Nothing is public and nothing has been emailed. Read it, approve it, publish it, and send it `
        + `when you're ready: ${SITE()}/weekly-admin.html\n\n— Clay`,
    });

    return { ok: true, week, counts: c };
  } catch (e) {
    return { ok: false, reason: 'error', error: e && e.message };
  }
}


// ---- taking an issue back ------------------------------------------------------------------------
//
// The workflow was one-way: compose, approve, publish, send. There was no way to reject a draft you
// did not like, no way to have Clay write it again, and no way to delete one — so a bad issue sat
// there permanently and the only path forward was publishing it.

// Send an approved or published issue back to draft. Refused once it has actually been emailed,
// because you cannot unsend a magazine and pretending otherwise would be worse than saying no.
async function reject(id, reason = null) {
  const r = await query('SELECT status, sent_at FROM weekly_issues WHERE id=$1', [id]);
  if (!r.rows.length) return { ok: false, reason: 'not_found' };
  if (r.rows[0].sent_at) {
    return { ok: false, reason: 'already_sent',
      message: 'This issue has already been emailed to readers. It cannot be pulled back — they have it. '
        + 'You can edit it for the archive, but anyone who opened the email has already read what was sent.' };
  }
  const u = await query(
    `UPDATE weekly_issues SET status='draft', published_at=NULL
      WHERE id=$1 RETURNING id, slug, status`, [id]);
  if (reason) {
    await query('UPDATE weekly_issues SET rejection_note=$2 WHERE id=$1', [id, String(reason).slice(0, 1000)])
      .catch(() => {});
  }
  return { ok: true, issue: u.rows[0],
    message: 'Back to draft. Nothing is public and nobody has been emailed. Have Clay write it again, or edit it yourself.' };
}

// Throw the draft away and have Clay write the week from scratch. Refused for a sent issue.
async function recompose(id) {
  const r = await query('SELECT week_start, sent_at FROM weekly_issues WHERE id=$1', [id]);
  if (!r.rows.length) return { ok: false, reason: 'not_found' };
  if (r.rows[0].sent_at) {
    return { ok: false, reason: 'already_sent',
      message: 'This issue has been emailed already, so rewriting it would not reach anyone who read it.' };
  }
  const week = r.rows[0].week_start;
  // composeIssue upserts on week_start, so this genuinely replaces the draft rather than making a
  // second issue for the same week. Any accepted sponsorship attached to it survives, which is what
  // you want: the creator already agreed to be featured.
  await query('DELETE FROM weekly_issues WHERE id=$1', [id]);
  return composeIssue({ weekStart: week });
}

// Delete an issue outright. Permanent, and refused once it has been sent — a sent issue is a record
// of something real that people received, and erasing it would leave the archive lying.
async function remove(id) {
  const r = await query('SELECT status, sent_at, title FROM weekly_issues WHERE id=$1', [id]);
  if (!r.rows.length) return { ok: false, reason: 'not_found' };
  if (r.rows[0].sent_at) {
    return { ok: false, reason: 'already_sent',
      message: 'This issue was emailed to readers, so it stays in the archive. Deleting it would leave the '
        + 'record showing something different from what people actually received.' };
  }
  await query('UPDATE weekly_sponsorships SET issue_id=NULL WHERE issue_id=$1', [id]).catch(() => {});
  await query('DELETE FROM weekly_issues WHERE id=$1', [id]);
  return { ok: true, message: `"${r.rows[0].title}" is gone. Nothing was public and nobody was emailed.` };
}

module.exports = {
  reject, recompose, remove,
  getBySlug, getForPreview,
  tick, weekStartOf, slugForWeek, composeIssue, offerSponsorship, respondToSponsorship,
  approve, publish, sendIssue, unsubscribe, getPublished, listPublished, listForStaff,
  sponsorCandidates, weekArticles, topCreators, topMovers,
};
