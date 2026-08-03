// Clay's weekly self-and-platform review.
//
// Once a week Clay looks honestly at how the platform is doing and researches how to do better,
// across the four questions the owners care about: how to improve HIMSELF, how to improve the
// PLATFORM, how to GROW creators, and how to MOVE concepts forward. He grounds it in a real
// AGGREGATE snapshot (counts and movement only — never any one person's private content) plus live
// web research, then files it to the team through staffNotify.
//
// It is ADVISORY ONLY. It emails and logs; it never changes anything on its own — the same
// discipline Arbo's daily Desk holds ("filed for approval, never auto-acts"). Best-effort: nothing
// here throws, and a bad week (provider down, thin data) just produces no email, honestly logged.

const { query } = require('../../config/db');
const agent = require('./agent');
const research = require('./research');
const staffNotify = require('./staffNotify');
const provider = require('./provider');

// Aggregate-only snapshot. No private concept content, no per-person rows — only counts a public
// dashboard could show. Defensive: any failure yields an empty snapshot rather than throwing.
async function snapshot() {
  try {
    const r = await query(`
      SELECT
        (SELECT count(*) FROM users WHERE role NOT IN ('staff','admin','master_staff'))::int AS creators,
        (SELECT count(*) FROM users WHERE role NOT IN ('staff','admin','master_staff')
           AND created_at >= now() - interval '7 days')::int AS new_creators_7d,
        (SELECT count(*) FROM concepts)::int AS concepts_total,
        (SELECT count(*) FROM concepts WHERE created_at >= now() - interval '7 days')::int AS concepts_7d,
        (SELECT count(*) FROM concepts WHERE origin='clay_seed')::int AS clay_seeds,
        (SELECT count(*) FROM listings WHERE status='live')::int AS listings_live,
        (SELECT count(*) FROM listings WHERE status='in_review')::int AS listings_in_review,
        (SELECT count(*) FROM concept_intents WHERE path='build_myself')::int AS intent_build,
        (SELECT count(*) FROM concept_intents WHERE path='refine_to_sell')::int AS intent_sell,
        (SELECT count(*) FROM concept_intents WHERE path='exploring')::int AS intent_exploring
    `);
    return r.rows[0] || {};
  } catch (e) {
    return { _error: e && e.message };
  }
}

// A couple of best-effort research pulls to keep the review grounded in the outside world, not just
// our own numbers. If research isn't connected, we simply proceed without it and say so.
async function gatherFindings() {
  const topics = [
    'how solo founders and small creators validate business ideas before launching 2026',
    'what makes an online marketplace of digital products grow its sellers and buyers',
  ];
  const findings = [];
  for (const t of topics) {
    try {
      const r = await research.search(t, { maxResults: 4 });
      if (r && r.available && r.results && r.results.length) {
        findings.push({
          topic: t,
          answer: r.answer || null,
          sources: r.results.slice(0, 4).map((s) => ({ title: s.title || s.url, url: s.url })),
        });
      }
    } catch (_) { /* best-effort */ }
  }
  return findings;
}

function buildPrompt(snap, findings) {
  const lines = [];
  lines.push('This is your own WEEKLY REVIEW, written for the owners of Access YP Labs (Vission and Rel), who read by screen reader.');
  lines.push('Look honestly at where the platform is and think about how to make it better. Cover four things, briefly and concretely, each as its own short section with a plain heading: how to improve YOURSELF (Clay), how to improve the PLATFORM, how to GROW our creators, and how to MOVE concepts forward toward becoming real businesses.');
  lines.push('');
  lines.push('Here is this week\'s aggregate snapshot (counts only):');
  lines.push(JSON.stringify(snap));
  lines.push('');
  if (findings.length) {
    lines.push('Here is some live research you pulled to ground your thinking. Cite a source by name when you lean on it:');
    lines.push(JSON.stringify(findings));
  } else {
    lines.push('Live research was not available this week, so reason from the snapshot and your own judgment, and say plainly that this review is not research-backed.');
  }
  lines.push('');
  lines.push('Rules: be specific and useful, not generic. Ground every claim in the snapshot or a cited source; never invent a number. If the data is too thin to say something real, say so instead of padding. Keep it to something an owner can read in a couple of minutes. Write it to be heard aloud: plain prose, short sections, no markdown symbols or bullet characters. This is advisory — you are proposing, not doing; nothing here changes anything until an owner decides.');
  return lines.join('\n');
}

// Generate and file one weekly review. Returns a plain result; never throws.
async function runWeeklyReview({ source = 'scheduled' } = {}) {
  try {
    let up = true;
    try { up = provider.available(); } catch (_) { up = false; }
    if (!up) return { ok: false, reason: 'provider_down' };

    const snap = await snapshot();
    const findings = await gatherFindings();
    const userMsg = buildPrompt(snap, findings);

    // Full-persona Clay (his purpose, values, family all apply), no tools — he reasons over the
    // snapshot and findings we already gathered and writes the review.
    const out = await agent.runChat({ messages: [{ role: 'user', content: userMsg }], allowTools: [] });
    if (!out || out.status !== 'answered' || !out.reply) return { ok: false, reason: out && out.status ? out.status : 'no_reply' };

    const digest = out.reply;
    const note = await staffNotify.notifyStaff({
      kind: 'weekly_review',
      subject: 'Your weekly review — how we grow from here',
      body: digest,
      dedupeKey: 'weekly_review_' + new Date().toISOString().slice(0, 10),
    });
    return { ok: true, source, emailed: note.sent, recipients: note.recipients, skipped: note.skipped, chars: digest.length };
  } catch (e) {
    return { ok: false, reason: 'error', error: e && e.message };
  }
}

// Scheduler tick — claims the weekly slot atomically (mirrors seedScheduler), so it fires at most
// once per gap even across restarts or multiple instances, then runs the review.
async function tick() {
  try { if (!provider.available()) return { ok: false, reason: 'provider_down' }; }
  catch (_) { return { ok: false, reason: 'provider_down' }; }

  let claimed = false;
  try {
    const r = await query(`
      UPDATE clay_review_schedule
         SET last_run_at = now(), updated_at = now()
       WHERE id = TRUE AND enabled = TRUE
         AND (last_run_at IS NULL OR last_run_at < now() - (min_gap_minutes || ' minutes')::interval)
       RETURNING id`);
    claimed = r.rows.length > 0;
  } catch (e) {
    console.error('weekly review claim error:', e && e.message);
    return { ok: false, reason: 'claim_error' };
  }
  if (!claimed) return { ok: false, reason: 'not_due' };

  const out = await runWeeklyReview({ source: 'scheduled' });
  console.log('weekly review:', JSON.stringify(out));
  return out;
}

async function status() {
  try {
    const r = await query('SELECT enabled, last_run_at, min_gap_minutes FROM clay_review_schedule WHERE id = TRUE');
    return r.rows[0] || null;
  } catch (_) { return null; }
}

module.exports = { runWeeklyReview, tick, status, snapshot };
