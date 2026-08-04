// Clay writing for the Desk — his help articles and his short, witty stories.
//
// Clay DRAFTS; a human owner decides what the public sees. Every piece is filed as a 'draft' and
// nothing is ever published automatically (the same discipline Arbo's daily Desk holds). The gentle
// scheduler only drafts when the pending queue is small, so it can never flood the review queue or
// the page. Best-effort: nothing here throws.

const { query } = require('../../config/db');
const agent = require('./agent');
const provider = require('./provider');

// On-brand topic pools, so auto-drafted pieces vary instead of repeating. These are coaching
// topics: real business and marketing strategy for two kinds of creator — someone shaping a new
// idea to prove and sell, AND someone growing a business or digital asset they already run.
const HELP_TOPICS = [
  'the first ten customers: how to get them with no budget and no audience',
  'proving an idea before you build it: a coming-soon page and a real waitlist',
  'positioning: the one sentence that says who this is for and why it wins',
  'pricing your offer without guessing — and when to raise it',
  'turning a service you already do by hand into a product you can sell again and again',
  'one marketing channel done well beats five done badly — how to pick yours',
  'writing an offer people can’t ignore: the problem, the promise, the proof',
  'the difference between a feature and a benefit, and why your marketing lives on the benefit',
  'reading your own numbers: margin, break-even, and what a customer is really worth',
  'getting your first case study, testimonial, or before-and-after — and using it',
  'growing a business you already run: where the next dollar actually comes from',
  'referrals on purpose: making it easy and worth it for a happy customer to send the next one',
  'when to build it yourself and launch it, and when to package it and sell it',
  'your first hire or first bit of help: what to hand off, and how to pay for it',
  'a simple launch: going from a quiet coming-soon page to your first paying customer',
];
const STORY_TOPICS = [
  'a small idea that sat in a drawer for years, then finally took shape',
  'the whitespace nobody else was building in',
  'a dream that found the founder who would finally build it',
  'the night an “impossible” idea turned out to be simple',
  'two creators, one idea, and the honest question that changed it',
  'a founder who already ran a business, and the small change that doubled it',
  'the coming-soon page that got twelve strangers to raise their hand',
];

function pickTopic(kind) {
  const pool = kind === 'story' ? STORY_TOPICS : HELP_TOPICS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function buildComposePrompt(kind, topic) {
  const shared = 'Write it in your own voice for the PUBLIC Desk at Access YP Labs, where anyone — including people who have never signed up — might read it. It will be heard aloud by people using a screen reader, so write plain prose: no markdown, no bullet characters, no symbols, short paragraphs. Never fabricate a statistic, a testimonial, a real person, or a result; if you want to teach with numbers, use round, clearly illustrative ones and say plainly they are illustrative. Stay true to what you believe: proof is behavior not compliments, the idea stays theirs, and honesty is the confidence. Return ONLY a minified JSON object, no prose around it and no code fences, with exactly these keys: "title" (short, real, no clickbait), "dek" (one warm sentence under the title), "body" (the piece itself, a few short paragraphs).';
  if (kind === 'story') {
    return `Write a SHORT, witty, warm story for the Desk about: ${topic}. Keep it genuinely charming and human, never cheesy, and land it on something true about building — or growing — a business here. Under 250 words. ${shared}`;
  }
  return `Write a genuinely useful COACHING article for the Desk on this business or marketing topic: ${topic}. Coach like a sharp operator who has done this, not a listicle — teach ONE thing with real substance and give the reader a concrete move they can make this week. Remember two kinds of reader: someone shaping a brand-new idea to prove and maybe sell, AND someone already running a business or a digital asset who wants it to grow. Speak to whichever the topic fits, or to both. When numbers would make it click, walk one small illustrative example step by step. Under 500 words, and every sentence earns its place. ${shared}`;
}

function parsePiece(text) {
  if (!text) return null;
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try {
    const o = JSON.parse(s);
    if (o && typeof o.title === 'string' && typeof o.body === 'string' && o.title.trim() && o.body.trim()) {
      return { title: o.title.trim(), dek: typeof o.dek === 'string' ? o.dek.trim() : '', body: o.body.trim() };
    }
  } catch (_) { /* fall through */ }
  return null;
}

// Draft one Desk piece and file it for approval. Never publishes. Returns a plain result.
async function composePiece({ kind = 'help', topic = null, source = 'manual' } = {}) {
  try {
    let up = true;
    try { up = provider.available(); } catch (_) { up = false; }
    if (!up) return { ok: false, reason: 'provider_down' };

    const k = kind === 'story' ? 'story' : 'help';
    const t = topic || pickTopic(k);
    const out = await agent.runChat({ messages: [{ role: 'user', content: buildComposePrompt(k, t) }], allowTools: [] });
    if (!out || out.status !== 'answered' || !out.reply) return { ok: false, reason: out && out.status ? out.status : 'no_reply' };

    const piece = parsePiece(out.reply);
    if (!piece) return { ok: false, reason: 'unparseable' };

    const r = await query(
      `INSERT INTO desk_articles (kind, title, dek, body, topic, status, source)
       VALUES ($1,$2,$3,$4,$5,'draft','clay') RETURNING id`,
      [k, piece.title.slice(0, 200), piece.dek.slice(0, 300), piece.body.slice(0, 20000), String(t).slice(0, 120)]);
    return { ok: true, id: r.rows[0].id, kind: k, title: piece.title, source };
  } catch (e) {
    return { ok: false, reason: 'error', error: e && e.message };
  }
}

// Gentle scheduler tick — claims the slot atomically AND only fires when the pending-draft queue is
// under the cap, so Clay's drafting can never pile up. Mirrors the other schedulers; never throws.
async function tick() {
  try { if (!provider.available()) return { ok: false, reason: 'provider_down' }; }
  catch (_) { return { ok: false, reason: 'provider_down' }; }

  let claimed = false;
  try {
    const r = await query(`
      UPDATE desk_compose_schedule
         SET last_run_at = now(), updated_at = now()
       WHERE id = TRUE AND enabled = TRUE
         AND (last_run_at IS NULL OR last_run_at < now() - (min_gap_minutes || ' minutes')::interval)
         AND (SELECT count(*) FROM desk_articles WHERE status='draft') < max_pending
       RETURNING id`);
    claimed = r.rows.length > 0;
  } catch (e) {
    console.error('desk compose claim error:', e && e.message);
    return { ok: false, reason: 'claim_error' };
  }
  if (!claimed) return { ok: false, reason: 'not_due' };

  const kind = Math.random() < 0.6 ? 'help' : 'story';
  const out = await composePiece({ kind, source: 'scheduled' });
  console.log('desk compose:', JSON.stringify(out));
  return out;
}

async function listDrafts(limit = 20) {
  const r = await query(
    `SELECT id, kind, title, dek, body, topic, created_at
       FROM desk_articles WHERE status='draft' ORDER BY created_at DESC LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 20, 1), 50)]);
  return r.rows;
}

async function publishedArticles(limit = 12) {
  const r = await query(
    `SELECT id, kind, title, dek, body, published_at
       FROM desk_articles WHERE status='published' ORDER BY published_at DESC LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 12, 1), 30)]);
  return r.rows;
}

async function publish(id, approverId) {
  const r = await query(
    `UPDATE desk_articles SET status='published', published_at=now(), approved_by=$2
      WHERE id=$1 AND status='draft' RETURNING id, kind, title`,
    [id, approverId || null]);
  return r.rows[0] || null;
}

async function archive(id) {
  const r = await query(
    "UPDATE desk_articles SET status='archived' WHERE id=$1 RETURNING id, title",
    [id]);
  return r.rows[0] || null;
}

module.exports = { composePiece, tick, listDrafts, publishedArticles, publish, archive };
