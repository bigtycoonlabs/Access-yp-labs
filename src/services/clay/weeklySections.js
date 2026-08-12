// WHAT MAKES CLAY WEEKLY A PUBLICATION RATHER THAN A DIGEST.
//
// A digest lists what happened. A publication has a point of view, teaches you something, and is
// worth reading even in a week when nothing much occurred. These are the recurring sections that
// carry that: the week's best writing, a business term explained properly, the builder who kept
// turning up, and what changed in the wider world for very small businesses.
//
// The editorial stance, written down so it stays consistent: the rest of the world treats an
// unbuilt idea as worthless — a daydream, a someday, a thing you mention at a party. That is a
// failure of imagination and of markets, not of the idea. Clay is allowed to be pointed about that.
// He is NOT allowed to be smug, to punch at individuals, or to pretend our own market is busier
// than it is. Mockery aimed at an absent institution is funny; mockery that requires exaggerating
// our own position is just a lie with a joke on top.

const { query } = require('../../config/db');

// ---- 1. The week's best writing -----------------------------------------------------------------

// The five pieces worth someone's time this week. Ranked on what we can actually observe — recency
// and whether the piece is properly finished — because we do not have reader analytics and will not
// invent engagement numbers to look sophisticated.
async function topArticles(weekStart, limit = 5) {
  const r = await query(
    `SELECT id, title, dek, slug, category, image_url, image_alt, published_at
       FROM desk_articles
      WHERE status='published'
        AND published_at >= $1::date - interval '7 days'
      ORDER BY
        (CASE WHEN dek IS NOT NULL AND dek <> '' THEN 1 ELSE 0 END) DESC,
        published_at DESC
      LIMIT $2`,
    [weekStart, Math.min(Math.max(Number(limit) || 5, 1), 10)]);
  if (r.rows.length) return r.rows;

  // A quiet week is normal, especially early. Rather than print an empty section, fall back to the
  // best of what exists — and the caller says plainly that these are from earlier.
  const back = await query(
    `SELECT id, title, dek, slug, category, image_url, image_alt, published_at
       FROM desk_articles WHERE status='published'
      ORDER BY published_at DESC LIMIT $1`, [limit]);
  return back.rows.map((a) => ({ ...a, from_earlier: true }));
}

// ---- 2. Business term of the week ---------------------------------------------------------------

// Terms someone starting their first business will genuinely hit, in the order they tend to hit
// them. Explained the way you would explain them to a friend, not the way a textbook does.
const TERMS = [
  { term: 'Margin', short: 'What you actually keep out of each sale.',
    long: 'Sell something for $50, and if it costs you $20 to make and deliver, your margin is $30 — sixty per cent. It is the number that decides whether volume helps you or slowly kills you. Two businesses with identical revenue can be a living and a disaster depending on this one figure.' },
  { term: 'Runway', short: 'How long you can keep going before the money runs out.',
    long: 'If you have $6,000 set aside and the business costs $1,000 a month to run, you have six months of runway. It matters because it converts a vague worry into a date, and a date can be planned around.' },
  { term: 'Customer acquisition cost', short: 'What it costs you to get one customer through the door.',
    long: 'Spend $200 on ads and get eight customers, and each one cost you $25. The moment that matters is when you compare it to what a customer is worth over time — if they spend $40 once, that $25 is close to ruinous.' },
  { term: 'Lifetime value', short: 'What one customer is worth over the whole time they stay.',
    long: 'A $12 monthly subscription someone keeps for two years is $288, not $12. This is why businesses will happily lose money getting you in the door, and why a repeat customer is worth so much more than a first sale.' },
  { term: 'Churn', short: 'The share of customers who leave in a given period.',
    long: 'Lose five of a hundred subscribers a month and that is five per cent churn. It sounds survivable and it compounds brutally: at that rate you replace your entire customer base roughly every twenty months just to stand still.' },
  { term: 'Break-even', short: 'The point where the money coming in covers the money going out.',
    long: 'Not profit — simply not losing. Knowing the number turns "am I doing all right?" into "I need eleven more sales this month," which is a question you can actually answer.' },
  { term: 'Gross versus net', short: 'What came in, versus what you keep.',
    long: 'Gross is the total before costs. Net is what is left after them. People quote gross when they want to sound impressive and net when they are being honest with themselves.' },
  { term: 'Working capital', short: 'The money tied up in simply operating.',
    long: 'Stock on a shelf and an invoice a customer has not paid yet are both money you technically have and cannot spend. Plenty of profitable businesses have died holding exactly this kind of wealth.' },
  { term: 'Pre-selling', short: 'Taking money before the thing exists.',
    long: 'It sounds like cheating and it is the single most honest test there is. Someone saying "great idea" costs them nothing; someone paying you twenty dollars before you have built anything has told you the truth.' },
  { term: 'Unit economics', short: 'Whether one single sale makes sense on its own.',
    long: 'Strip away everything else and look at one transaction: what came in, what it cost, what is left. If a single unit does not work, doing it a thousand times does not fix it — it multiplies it.' },
];

// Rotate deterministically by week, so an issue can be rebuilt and produce the same term rather than
// a different one each time it is assembled.
function termForWeek(weekStart) {
  const d = new Date(weekStart);
  const weeks = Math.floor(d.getTime() / (7 * 24 * 60 * 60 * 1000));
  return TERMS[((weeks % TERMS.length) + TERMS.length) % TERMS.length];
}

// ---- 3. The builder who kept turning up ---------------------------------------------------------

// Someone who showed up and worked this week — NOT what they worked on.
//
// This deliberately measures presence, not achievement: sessions with Clay and materials shaped. A
// person with no sale, no listing and no audience can absolutely be the most active builder here,
// and saying so is the point. It never names a project, never says what they are building, and uses
// the display name only — being noticed for turning up must never become being exposed.
async function topDreamer(weekStart) {
  const r = await query(
    `SELECT COALESCE(NULLIF(u.display_name,''), 'A builder') AS tag,
            COUNT(DISTINCT a.id)::int AS shaped,
            COUNT(DISTINCT date_trunc('day', a.created_at))::int AS days_here
       FROM users u
       JOIN concepts c ON c.owner_id = u.id
       JOIN assets a ON a.concept_id = c.id
      WHERE a.created_at >= $1::date - interval '7 days'
        AND u.email <> 'clay@accessyplabs.com'
        AND u.role = 'member'
      GROUP BY u.id, u.display_name
      HAVING COUNT(DISTINCT a.id) > 0
      ORDER BY days_here DESC, shaped DESC
      LIMIT 1`, [weekStart]);
  if (!r.rows.length) return null;
  const d = r.rows[0];
  return {
    tag: d.tag,
    days_here: d.days_here,
    shaped: d.shaped,
    // Written so it reads as recognition, not a leaderboard, and says nothing about what they made.
    note: `${d.tag} kept showing up this week — here on ${d.days_here} separate day${d.days_here === 1 ? '' : 's'}, `
      + `shaping and reshaping. No launch, no sale, no announcement. Just the work, which is the part nobody sees `
      + 'and the only part that has ever mattered.',
  };
}


// ---- 4. What changed out there ------------------------------------------------------------------

// Real news for very small businesses: a rule change, a platform fee, a threshold that moved, or
// something genuinely worth watching. Sourced from the live web every time.
//
// THE RULE THAT MATTERS MOST HERE: if the search finds nothing usable, this section does not appear.
// A magazine that invents a regulatory change is worse than one with a short issue, because a reader
// might act on it — change their pricing, register something, file something. Every item carries the
// source it came from, and anything without one is dropped.
const NEWS_QUERIES = [
  'small business regulation change this week',
  'new rules for online sellers and marketplaces',
  'sole trader tax threshold change',
  'platform fee change etsy shopify gumroad sellers',
  'new grant or funding for micro businesses',
];

async function worldNews({ limit = 3 } = {}) {
  const provider = require('./provider');
  try {
    if (!provider.available || !provider.available()) return { ok: false, reason: 'unavailable', items: [] };
  } catch (_) { return { ok: false, reason: 'unavailable', items: [] }; }

  const pick = NEWS_QUERIES[Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000)) % NEWS_QUERIES.length];
  let found;
  try {
    found = await provider.webSearch(pick, { maxResults: 6 });
  } catch (e) {
    return { ok: false, reason: 'search_failed', error: e && e.message, items: [] };
  }
  const results = (found && (found.results || found.items)) || [];
  if (!results.length) return { ok: false, reason: 'nothing_found', items: [] };

  const sourced = results
    .filter((r) => r && r.url && (r.title || r.snippet))
    .slice(0, Math.min(Math.max(Number(limit) || 3, 1), 5))
    .map((r) => ({ title: String(r.title || '').slice(0, 200), url: r.url, note: String(r.snippet || '').slice(0, 300) }));

  // Sourced or not at all.
  if (!sourced.length) return { ok: false, reason: 'nothing_sourced', items: [] };
  return { ok: true, query: pick, items: sourced };
}

module.exports = { topArticles, worldNews, NEWS_QUERIES, TERMS, termForWeek, topDreamer };
