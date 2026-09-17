// COMPLIANCE RESEARCH. What a business is legally required to do, found live and cited.
//
// Compliance has no room for error (owner, 16 Sept 2026), so Penny never answers it from memory:
//   - the eight AREAS below are the whole picture, so nothing is skipped because nobody thought of it;
//   - each is researched live on the top model at high reasoning, told to prefer official sources;
//   - an answer comes back only with the pages it came from, and a page on a government domain is
//     marked official; an answer with no source is refused, never shown;
//   - results are kept 30 days with their date and sources, so a repeat question is instant, free,
//     and auditable, and a change to the business (a new state, first hire) searches again.
// The fixed state filing table in states.js stays the first answer for annual reports; this covers
// everything around it.

const { query } = require('../../config/db');
const P = require('../../lib/permissions');
const provider = require('./provider');

const FRESH_DAYS = 30;

const AREAS = {
  formation: 'Keeping the business in good standing: annual or biennial reports, franchise or privilege '
    + 'taxes tied to the entity, registered agent requirements, and foreign registration in each state it operates in.',
  state_tax: 'State tax registration and filings for the business itself: income, franchise, gross receipts '
    + 'or margin taxes, which agency, which form, due dates and what a late filing costs.',
  sales_tax: 'Sales and use tax: whether what this business sells is taxable, when it must register, how '
    + 'often it files, and any local sales taxes.',
  employer: 'Obligations of having employees: state withholding and unemployment registration, workers\u2019 '
    + 'compensation, new hire reporting, required posters, and minimum wage or paid leave rules.',
  local_license: 'City and county requirements: general business licences, business tax receipts, home '
    + 'occupation permits, and their renewal dates and fees.',
  trade_license: 'Licences, certifications or registrations required for this specific trade, by the state '
    + 'and by any local authority, including insurance or bonding required to hold them.',
  permits: 'Permits this kind of business commonly needs: health, food handling, fire, signage, zoning, '
    + 'vehicle, or environmental, depending on what it does.',
  federal: 'Federal obligations: EIN, federal tax returns and deadlines for this entity type, federal '
    + 'employment filings, and any federal licence or registration for this trade.',
};
const AREA_NAMES = Object.keys(AREAS);

const INSTRUCTION = [
  'You are researching legal compliance for a real small business. A wrong answer can cost them money or',
  'their right to operate, so accuracy matters more than completeness.',
  'Search the web. Prefer official sources: state secretary of state and revenue sites, city and county',
  'sites, IRS.gov, SBA.gov and licensing boards. Use other sites only to find the official page.',
  'For each requirement give: what it is, who administers it, the form or filing name, the due date or',
  'frequency, the fee, and the penalty for missing it, where the source states them.',
  'Say plainly when something depends on facts not given (revenue, exact city, what is sold), and when',
  'a requirement does not apply. Never state a figure or date you did not find on a page. If you could',
  'not confirm something, say "not confirmed" rather than guessing. Plain sentences, no tables.',
  'Begin with one line that starts "In short:" and gives the answer in two sentences at most.',
].join(' ');

// The headline of a finding: its "In short:" line, or its opening sentences for older research.
function shortOf(answer) {
  const a = String(answer || '').replace(/\*\*/g, '');
  const m = a.match(/In short:\s*([^\n]+)/i);
  let t = m ? m[1] : a.replace(/^#+.*$/gm, '').replace(/\s+/g, ' ').trim();
  // The "In short:" line is the research's own two-sentence answer, and cutting it drops findings:
  // a Texas answer lost its sales tax sentence at 320 characters, and Penny then called sales tax
  // unconfirmed (16 Sept 2026). It is kept whole up to a generous limit.
  const limit = m ? 900 : 320;
  if (t.length > limit) {
    const cut = t.slice(0, limit);
    const end = cut.lastIndexOf('. ');
    t = (end > 120 ? cut.slice(0, end + 1) : cut + '\u2026');
  }
  return t.trim();
}

// Links are stored and read to people as the pages they are, without the search tool's tracking tags.
function cleanUrl(url) {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch (_) { return url; }
}

function isOfficial(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return /\.gov$/.test(h) || /\.(state|[a-z]{2})\.us$/.test(h) || /\.mil$/.test(h);
  } catch (_) { return false; }
}

function profileOf(b) {
  const states = [b.formation_state, ...(b.operating_states || [])].filter(Boolean);
  return {
    entity: b.entity_type || null,
    formed_in: b.formation_state || null,
    states: [...new Set(states)],
    localities: b.localities || [],
    trade: b.trade || null,
    headcount: b.headcount == null ? null : b.headcount,
  };
}

// Changes when any fact that changes the answer changes, so stale research is never reused.
function profileKey(p) {
  return JSON.stringify([p.entity, p.formed_in, [...p.states].sort(), [...p.localities].sort(), p.trade, p.headcount]);
}

function describe(name, p) {
  const bits = [];
  bits.push((p.entity ? p.entity.toUpperCase() : 'business') + (p.formed_in ? ' formed in ' + p.formed_in : ''));
  if (p.states.length) bits.push('operating in ' + p.states.join(', '));
  if (p.localities.length) bits.push('located in ' + p.localities.join('; '));
  if (p.trade) bits.push('trade: ' + p.trade);
  bits.push(p.headcount == null ? 'number of employees unknown' : p.headcount + ' employees besides the owner');
  return 'Business: ' + name + ', ' + bits.join(', ') + '.';
}

function missingFacts(p) {
  const m = [];
  if (!p.entity) m.push('what kind of entity it is (LLC, corporation, sole proprietor)');
  if (!p.formed_in) m.push('which state it was formed in');
  if (!p.localities.length) m.push('which city or county it operates from');
  if (!p.trade) m.push('what the business does');
  return m;
}

async function cached(business_id, area, question, key) {
  const r = await query(
    `SELECT * FROM compliance_research WHERE business_id=$1 AND area=$2 AND question=$3 AND profile_key=$4
       AND searched_at > now() - ($5 || ' days')::interval ORDER BY searched_at DESC LIMIT 1`,
    [business_id, area, question, key, String(FRESH_DAYS)]);
  return r.rows[0] || null;
}

async function researchOne(viewer, b, p, area, question, fresh) {
  const key = profileKey(p);
  const q = area === 'question' ? question : AREAS[area];
  if (!fresh) {
    const hit = await cached(b.id, area, q, key);
    if (hit) return { ok: true, area, answer: hit.answer, sources: hit.sources, official: hit.official, searched_at: hit.searched_at, reused: true };
  }
  const ask = () => provider.webSearch(describe(b.name, p) + '\nWhat to find out: ' + q,
    { maxResults: 8, instruction: INSTRUCTION, effort: 'high', maxChars: 2000 });
  let found = await ask();
  // One retry: on 16 Sept 2026 two of eight searches ended without an answer and then succeeded alone.
  if (found && found.available !== false && (!found.answer || !(found.results || []).length)) {
    console.error('[compliance] ' + area + ' search gave nothing (' + (found.reason || 'no reason') + '), trying once more');
    found = await ask();
  }
  if (!found || found.available === false) {
    return { ok: false, area, says: 'Web research is not available on this site right now, so I have not answered this. I will not answer compliance from memory.' };
  }
  const sources = (found.results || []).filter((s) => s && /^https?:\/\//.test(s.url))
    .map((s) => ({ title: String(s.title || s.url).slice(0, 200), url: cleanUrl(s.url), official: isOfficial(s.url) }));
  const answer = String(found.answer || '').trim();
  if (!answer || !sources.length) {
    return { ok: false, area, says: 'I searched but could not find a source I can point you to'
      + (found.reason ? ' (' + String(found.reason).slice(0, 120) + ')' : '')
      + ', so I am not answering this one. Check with the agency directly, or ask me again later.' };
  }
  const official = sources.some((s) => s.official);
  const row = (await query(
    `INSERT INTO compliance_research (business_id, area, question, profile_key, answer, sources, official, model, asked_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING searched_at`,
    [b.id, area, q, key, answer, JSON.stringify(sources), official, provider.modelName(), viewer.id])).rows[0];
  return { ok: true, area, answer, sources, official, searched_at: row.searched_at, reused: false };
}

// areas: a list of AREA_NAMES, or ['all']; or a free question.
async function research(viewer, { business_id, areas, question, fresh } = {}) {
  const gate = await P.can(viewer.id, business_id, 'compliance', 'view');
  if (!gate.ok) return { ok: false, kind: 'refused', says: P.refusalLine(gate, 'compliance', gate.perms && gate.perms.business.name) };
  const b = (await query('SELECT * FROM businesses WHERE id=$1', [business_id])).rows[0];
  if (!b) return { ok: false, kind: 'unavailable', says: 'I cannot find that business.' };
  const p = profileOf(b);

  let jobs;
  const q = String(question || '').trim();
  if (q) {
    if (q.length < 3 || q.length > 600) return { ok: false, kind: 'unclear', says: 'Ask the question in a sentence or two.' };
    jobs = ['question'];
  } else {
    const want = !areas || !areas.length || areas.includes('all') ? AREA_NAMES : areas;
    const bad = want.filter((a) => !AREA_NAMES.includes(a));
    if (bad.length) return { ok: false, kind: 'unclear', says: 'I do not have an area called ' + bad.join(', ') + '.' };
    jobs = want;
  }

  // Four at a time: a full picture is eight searches, and in a row they would take minutes.
  const results = [];
  for (let i = 0; i < jobs.length; i += 4) {
    const batch = await Promise.all(jobs.slice(i, i + 4).map((a) =>
      researchOne(viewer, b, p, a, q, !!fresh).catch((e) => ({ ok: false, area: a, says: 'That search failed: ' + e.message }))));
    results.push(...batch);
  }

  const done = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const gaps = missingFacts(p);
  const unofficial = done.filter((r) => !r.official).map((r) => r.area);
  let says;
  if (!done.length) says = failed[0].says;
  else {
    says = 'I researched ' + done.length + ' of ' + results.length + (results.length === 1 ? ' question' : ' areas')
      + ' for ' + b.name + ', with sources for each.';
    if (unofficial.length) says += ' For ' + unofficial.join(', ') + ' I found no government page, so treat those as leads to confirm, not settled.';
    if (failed.length) says += ' I could not confirm ' + failed.map((r) => r.area).join(', ') + ', so I have said nothing about ' + (failed.length === 1 ? 'it' : 'them') + '.';
    const reasons = failed.map((r) => (String(r.says).match(/\(([^)]+)\)/) || [])[1]).filter(Boolean);
    if (reasons.length) says += ' What went wrong: ' + [...new Set(reasons)].join('; ') + '.';
  }
  if (gaps.length) says += ' The answers are less exact because I do not know ' + gaps.join(', ') + '.';
  return { ok: done.length > 0, kind: done.length ? null : 'unavailable', says, business: b.name,
    missing_facts: gaps, results };
}

// ------------------------------------------------------------------ background runs
//
// Research takes minutes, so asking for it starts a run and returns straight away. Anything already
// researched in the last 30 days for this business as it stands is answered at once instead.

function wanted(areas, question) {
  if (question) return ['question'];
  return !areas || !areas.length || areas.includes('all') ? AREA_NAMES : areas;
}

async function start(viewer, { business_id, areas, question, fresh } = {}) {
  const gate = await P.can(viewer.id, business_id, 'compliance', 'view');
  if (!gate.ok) return { ok: false, kind: 'refused', says: P.refusalLine(gate, 'compliance', gate.perms && gate.perms.business.name) };
  const b = (await query('SELECT * FROM businesses WHERE id=$1', [business_id])).rows[0];
  if (!b) return { ok: false, kind: 'unavailable', says: 'I cannot find that business.' };
  const q = String(question || '').trim() || null;
  if (q && (q.length < 3 || q.length > 600)) return { ok: false, kind: 'unclear', says: 'Ask the question in a sentence or two.' };
  const want = wanted(areas, q);
  const bad = want.filter((a) => a !== 'question' && !AREA_NAMES.includes(a));
  if (bad.length) return { ok: false, kind: 'unclear', says: 'I do not have an area called ' + bad.join(', ') + '.' };

  // Everything already fresh: answer now, no search, no charge.
  if (!fresh) {
    const p = profileOf(b); const key = profileKey(p);
    const hits = [];
    for (const a of want) {
      const h = await cached(b.id, a, a === 'question' ? q : AREAS[a], key);
      if (!h) break;
      hits.push({ ok: true, area: a, answer: h.answer, sources: h.sources, official: h.official, searched_at: h.searched_at, reused: true });
    }
    if (hits.length === want.length) {
      return { ok: true, ready: true, business: b.name, results: hits, missing_facts: missingFacts(p),
        says: 'Here is what I found for ' + b.name + ', researched within the last ' + FRESH_DAYS + ' days, with sources.' };
    }
  }

  // A full review of all eight areas uses a review; anything narrower uses a question.
  const unit = !q && want.length === AREA_NAMES.length ? 'compliance_review' : 'compliance_question';
  const allowed = await require('../allowance').check(viewer, unit);
  if (!allowed.ok) return { ok: false, kind: 'refused', says: allowed.says };

  const running = (await query(
    `SELECT id, created_at FROM compliance_runs WHERE business_id=$1 AND status IN ('queued','running')
       AND created_at > now() - interval '30 minutes' ORDER BY created_at DESC LIMIT 1`, [b.id])).rows[0];
  if (running) {
    const mins = Math.max(1, Math.round((Date.now() - new Date(running.created_at).getTime()) / 60000));
    return { ok: true, ready: false, run_id: running.id, business: b.name,
      says: 'I am already researching ' + b.name + '. I started ' + mins + (mins === 1 ? ' minute' : ' minutes') + ' ago.' };
  }
  const run = (await query(
    `INSERT INTO compliance_runs (business_id, areas, question, fresh, requested_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [b.id, q ? [] : want, q, !!fresh, viewer.id])).rows[0];
  setImmediate(() => { runJob(run.id).catch((e) => console.error('[compliance] run failed to start:', e.message)); });
  const n = q ? 'your question' : want.length === AREA_NAMES.length ? 'all eight areas' : want.length + (want.length === 1 ? ' area' : ' areas');
  return { ok: true, ready: false, run_id: run.id, business: b.name,
    says: 'I have started researching ' + n + ' for ' + b.name + ' on the live web. It takes a few minutes, often five to ten for all eight. Ask me whether it is done, and I will give you what I found with its sources.' };
}

async function runJob(runId) {
  const run = (await query(
    `UPDATE compliance_runs SET status='running', started_at=now()
      WHERE id=$1 AND (status='queued' OR (status='running' AND started_at < now() - interval '30 minutes'))
      RETURNING *`, [runId])).rows[0];
  if (!run) return;
  const meter = require('../meter');
  let out;
  try {
    out = await meter.within({ user_id: run.requested_by, business_id: run.business_id, purpose: 'compliance' },
      () => research({ id: run.requested_by }, { business_id: run.business_id,
        areas: run.question ? null : run.areas, question: run.question, fresh: run.fresh }));
  } catch (e) {
    out = { ok: false, says: 'The research stopped partway: ' + e.message };
  }
  await query(`UPDATE compliance_runs SET status=$2, says=$3, finished_at=now() WHERE id=$1`,
    [runId, out.ok ? 'done' : 'failed', out.says || 'It ended without saying why.']);
  // Counted only when something was found. Reused findings never reach here, so they are free.
  if (out.ok && run.requested_by) {
    const who = (await query('SELECT id, role, billing_test FROM users WHERE id=$1', [run.requested_by])).rows[0];
    const full = !run.question && (run.areas || []).length === AREA_NAMES.length;
    if (who) await require('../allowance').record(who, full ? 'compliance_review' : 'compliance_question', runId);
  }
}

async function status(viewer, business_id) {
  const h = await history(viewer, business_id);
  if (!h.ok) return h;
  const run = (await query(
    `SELECT id, status, says, areas, question, created_at, finished_at FROM compliance_runs
      WHERE business_id=$1 ORDER BY created_at DESC LIMIT 1`, [business_id])).rows[0] || null;
  let says;
  if (!run && !h.research.length) says = 'Nothing has been researched for this business yet.';
  else if (run && (run.status === 'queued' || run.status === 'running')) says = 'Research is still running; it started at ' + new Date(run.created_at).toISOString().slice(11, 16) + ' UTC.';
  else if (run) says = (run.status === 'done' ? 'The last research finished. ' : 'The last research did not finish. ') + run.says;
  else says = 'Here is what has been researched.';
  return { ok: true, run, research: h.research, says };
}

async function resume() {
  try {
    const r = await query(`SELECT id FROM compliance_runs WHERE status='queued'
      OR (status='running' AND started_at < now() - interval '30 minutes') LIMIT 20`);
    for (const row of r.rows) runJob(row.id).catch((e) => console.error('[compliance] resume:', e.message));
    return r.rows.length;
  } catch (e) {
    console.error('compliance resume failed:', e.message);
    return 0;
  }
}

async function history(viewer, business_id) {
  const gate = await P.can(viewer.id, business_id, 'compliance', 'view');
  if (!gate.ok) return { ok: false, kind: 'refused', says: P.refusalLine(gate, 'compliance', gate.perms && gate.perms.business.name) };
  const r = await query(
    `SELECT DISTINCT ON (area, question) area, question, answer, sources, official, searched_at
       FROM compliance_research WHERE business_id=$1 ORDER BY area, question, searched_at DESC`, [business_id]);
  return { ok: true, research: r.rows };
}

module.exports = { cleanUrl, shortOf, start, runJob, status, resume, AREAS, AREA_NAMES, INSTRUCTION, FRESH_DAYS, research, history, isOfficial, profileOf, profileKey, describe, missingFacts };
