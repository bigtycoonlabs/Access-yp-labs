const express = require('express');
const crypto = require('crypto');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../lib/http');
const { parseCookies, setCookie } = require('../lib/cookies');
const provider = require('../services/clay/provider');
const journal = require('../services/clay/journal');
const router = express.Router();

const COOKIE = 'ypl_v';

function ipHash(req) {
  const ip = ((req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '').trim();
  if (!ip) return null;
  const salt = process.env.JWT_SECRET || 'ypl-salt';
  return crypto.createHash('sha256').update(ip + '|' + salt).digest('hex');
}

function ensureToken(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token && /^[a-f0-9-]{16,64}$/i.test(token)) return token;
  const fresh = crypto.randomUUID();
  setCookie(res, COOKIE, fresh);
  return fresh;
}

// GET /api/hello — anonymous memory. Increments the visit count (once per ~30 min,
// so a refresh doesn't inflate it), sets the cookie if new, and reports whether an
// idea is already waiting. Surfaces the count only — nothing identifying.
router.get('/hello', asyncHandler(async (req, res) => {
  const token = ensureToken(req, res);
  const h = ipHash(req);
  const existing = await query('SELECT visit_count FROM visitors WHERE token=$1', [token]);
  let visits;
  if (existing.rows.length) {
    const u = await query(
      `UPDATE visitors SET
         visit_count = visit_count + CASE WHEN last_seen < now() - interval '30 minutes' THEN 1 ELSE 0 END,
         last_seen = now(), ip_hash = COALESCE($2, ip_hash)
       WHERE token=$1 RETURNING visit_count`, [token, h]);
    visits = u.rows[0].visit_count;
  } else {
    await query('INSERT INTO visitors (token, ip_hash) VALUES ($1,$2) ON CONFLICT (token) DO NOTHING', [token, h]);
    visits = 1;
  }
  const spark = await query(
    'SELECT idea FROM anon_sparks WHERE token=$1 AND claimed_by IS NULL ORDER BY created_at DESC LIMIT 1', [token]);
  res.json({
    visits,
    returning: visits > 1,
    has_spark: spark.rows.length > 0,
    spark_idea: spark.rows[0] ? spark.rows[0].idea : null,
  });
}));

async function shapeTeaser(idea) {
  const system = `You are Clay, the AI builder at Access YP Labs. A visitor just told you a business idea. Shape a TASTE of the concept you would build with them — not the full thing. Return ONLY minified JSON, no prose, no code fences, with exactly these keys:
{"title":"a sharp working name for the business, 6 words max",
"angle":"one vivid sentence naming the wedge or positioning",
"inside":["4 to 6 short items naming what the full build would include, e.g. 'Grounded market and competitor research', 'A pricing model', 'A launch waitlist page']}
Be honest and grounded. Do not invent statistics or numbers. Keep it a teaser that makes them want the full build. No markdown.`;
  const r = await provider.chat({ system, messages: [{ role: 'user', content: idea }], maxTokens: 400 });
  if (!r.ok || !r.text) return null;
  try {
    const parsed = JSON.parse(String(r.text).replace(/```json|```/g, '').trim());
    if (!parsed.title) return null;
    return {
      title: String(parsed.title).slice(0, 80),
      angle: String(parsed.angle || '').slice(0, 240),
      inside: Array.isArray(parsed.inside) ? parsed.inside.slice(0, 6).map((x) => String(x).slice(0, 90)) : [],
    };
  } catch (_) { return null; }
}

// POST /api/spark { idea } — Clay takes an anonymous visitor's idea, shapes a
// BOUNDED teaser (a working title, the angle, and what the full build would
// include — names only, never the buildable bodies), and stores it against the
// cookie so it's waiting the moment they sign up. Content protection: nothing here
// is the deliverable; the full build only ever happens inside an account.
router.post('/spark', asyncHandler(async (req, res) => {
  const token = ensureToken(req, res);
  const idea = (req.body && typeof req.body.idea === 'string') ? req.body.idea.trim() : '';
  if (idea.length < 3) throw new ApiError(400, 'Tell me a little more about the idea.');
  if (idea.length > 2000) throw new ApiError(400, "That's a lot — give me the heart of it in a sentence or two.");

  await query('INSERT INTO visitors (token) VALUES ($1) ON CONFLICT (token) DO NOTHING', [token]);
  const today = new Date().toISOString().slice(0, 10);
  const v = await query('SELECT taste_count, taste_day FROM visitors WHERE token=$1', [token]);
  let used = v.rows[0] ? v.rows[0].taste_count : 0;
  const day = v.rows[0] && v.rows[0].taste_day ? new Date(v.rows[0].taste_day).toISOString().slice(0, 10) : null;
  if (day !== today) used = 0;

  const t0 = Date.now();
  const providerAvailable = provider.available();
  let teaser = null;
  if (used < 5 && providerAvailable) {
    teaser = await shapeTeaser(idea);
    if (teaser) await query('UPDATE visitors SET taste_count=$2, taste_day=$3 WHERE token=$1', [token, used + 1, today]);
  }
  journal.recordRun({ kind: 'teaser', mode: 'create',
    resultStatus: teaser ? 'answered' : (providerAvailable ? 'empty' : 'unavailable'),
    providerAvailable, durationMs: Date.now() - t0 });

  await query(
    `INSERT INTO anon_sparks (token, idea, title, angle, inside)
     VALUES ($1,$2,$3,$4,$5)`,
    [token, idea, teaser ? teaser.title : null, teaser ? teaser.angle : null, teaser ? JSON.stringify(teaser.inside) : null]);

  res.json({
    captured: true,
    title: teaser ? teaser.title : null,
    angle: teaser ? teaser.angle : null,
    inside: teaser ? teaser.inside : null,
  });
}));

// GET /api/liveness — real, honest signals for the homepage. Only true counts:
// concepts shaped, concepts currently live in the Dreamhold, and people waiting on
// those live concepts. If there's nothing yet, the homepage says so plainly rather
// than inventing activity.
router.get('/liveness', asyncHandler(async (req, res) => {
  const [ideas, held, waiting] = await Promise.all([
    query('SELECT COUNT(*)::int AS n FROM concepts'),
    query("SELECT COUNT(*)::int AS n FROM listings WHERE status='live'"),
    query("SELECT COUNT(*)::int AS n FROM waitlist_signups w JOIN listings l ON l.concept_id=w.concept_id AND l.status='live'"),
  ]);
  res.json({
    ideas_shaped: ideas.rows[0].n,
    in_dreamhold: held.rows[0].n,
    waiting: waiting.rows[0].n,
  });
}));

module.exports = router;
module.exports.shapeTeaser = shapeTeaser;