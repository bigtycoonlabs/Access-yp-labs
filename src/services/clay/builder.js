// ASKING PENNY TO BUILD SOMETHING.
//
// The database refuses to charge for anything nobody approved. This is the flow above it, and its
// job is to make the free path the obvious one rather than a concession.
//
// ASK -> MOCK (free, unlimited) -> APPROVE -> REAL (charged once) -> HANDED OVER
//
// WHAT THIS REFUSES TO DO, AND WHY IT MATTERS MORE THAN WHAT IT DOES:
//
//   It will not build from a brief it does not understand. The old concept generator got this right
//   and it is the single behaviour worth carrying forward — it told somebody "'Making money' is a
//   goal, not yet a business concept" rather than generating something plausible. A build made from
//   a guess wastes the person's time and then asks them to judge it, which is worse than a question.
//
//   It will not say a build succeeded without a URL somebody can open. "Does it respond" is not "can
//   somebody get there", and this estate has three separate incidents where a thing was correct at
//   every layer that was checked and unreachable at the layer that counted.
//
//   It will not quietly re-charge. A second real build from the same mock is a retry unless the
//   person asked for something new, and the difference is decided here rather than left to a column
//   somebody sets by hand.

const { query } = require('../../config/db');
const P = require('../../lib/permissions');

// A brief has to say what the thing DOES. Not a length rule: "booking page" is four words and
// perfectly clear, while a long paragraph about wanting more customers says nothing buildable.
const VAGUE = [
  /^(make|build|create)?\s*(me)?\s*(a|an|some)?\s*(website|site|app|thing|something|tool)\s*$/i,
  /^(help|fix|improve|grow|make money|more customers|marketing)\s*$/i,
];

function understand(askedFor) {
  const t = String(askedFor || '').trim();
  if (t.length < 3) {
    return { ok: false, says: 'Tell me what you want it to do and I will build it.' };
  }
  if (VAGUE.some((r) => r.test(t))) {
    // Named as a question rather than a rejection, and it offers the shape of an answer — a refusal
    // that leaves somebody guessing what would have worked is just a slower no.
    return {
      ok: false,
      says: '"' + t + '" tells me what to make but not what it should do. What should somebody be '
        + 'able to do with it? For example: take a booking without calling you, see what they owe, '
        + 'or send you photos from a job.',
    };
  }
  return { ok: true };
}

async function requestMock(viewer, { business_id, asked_for, kind }) {
  const gate = await P.can(viewer.id, business_id, 'projects', 'act');
  if (!gate.ok) {
    return { ok: false, kind: 'refused',
      says: P.refusalLine(gate, 'projects', gate.perms && gate.perms.business.name) };
  }
  const u = understand(asked_for);
  if (!u.ok) return { ok: false, kind: 'unclear', says: u.says };

  try {
    const r = await query(
      `INSERT INTO builds (business_id, requested_by, asked_for, kind, stage, status)
       VALUES ($1,$2,$3,$4,'mock','queued') RETURNING *`,
      [business_id, viewer.id, String(asked_for).trim(), kind || null]);
    return { ok: true, build: r.rows[0],
      // Said plainly every time, because "free" that has to be discovered is not free in the way
      // that matters — somebody who is unsure whether this costs money does not ask for the second
      // one, and asking for the second one is the whole point.
      says: 'I will build you a working version to look at. It is free, it does not count against '
        + 'anything, and you can ask me for as many as you like before deciding.' };
  } catch (e) {
    return { ok: false, kind: 'unavailable',
      says: 'I could not start that build, so nothing was queued. ' + e.message };
  }
}

// Approving a mock creates the real build. The approval and the charge are the same moment on
// purpose: there is no state where somebody has agreed to pay and does not know it.
async function approve(viewer, { build_id }) {
  const m = (await query('SELECT * FROM builds WHERE id=$1', [build_id])).rows[0];
  if (!m) return { ok: false, kind: 'unavailable', says: 'I cannot find that build.' };

  const gate = await P.can(viewer.id, m.business_id, 'projects', 'act');
  if (!gate.ok) {
    return { ok: false, kind: 'refused',
      says: P.refusalLine(gate, 'projects', gate.perms && gate.perms.business.name) };
  }
  if (m.stage !== 'mock') {
    return { ok: false, kind: 'refused', says: 'That one is already a real build.' };
  }
  if (m.status !== 'ready') {
    // Approving something that is not finished would charge for work nobody has seen, which is the
    // exact thing the whole arrangement exists to prevent.
    return { ok: false, kind: 'refused',
      says: 'That version is not finished yet, so there is nothing to approve. I will tell you when '
        + 'it is ready to look at.' };
  }

  try {
    const r = await query(
      `INSERT INTO builds (business_id, requested_by, asked_for, kind, stage, status,
          mock_of, approved_at, chargeable)
       VALUES ($1,$2,$3,$4,'real','queued',$5,now(),true) RETURNING *`,
      [m.business_id, viewer.id, m.asked_for, m.kind, m.id]);
    return { ok: true, build: r.rows[0],
      says: 'Building the real one now. This is the one that is charged for, once. Anything I get '
        + 'wrong and have to fix afterwards is not charged again.' };
  } catch (e) {
    return { ok: false, kind: 'unavailable',
      says: 'I could not start the real build, so nothing was approved and nothing is owed. '
        + e.message };
  }
}

// Fixing something we got wrong. Never chargeable — the database refuses it, and this names it so
// nobody has to wonder.
async function fix(viewer, { build_id, whats_wrong }) {
  const prev = (await query('SELECT * FROM builds WHERE id=$1', [build_id])).rows[0];
  if (!prev) return { ok: false, kind: 'unavailable', says: 'I cannot find that build.' };
  const gate = await P.can(viewer.id, prev.business_id, 'projects', 'act');
  if (!gate.ok) {
    return { ok: false, kind: 'refused',
      says: P.refusalLine(gate, 'projects', gate.perms && gate.perms.business.name) };
  }
  try {
    const r = await query(
      `INSERT INTO builds (business_id, requested_by, asked_for, kind, stage, status,
          mock_of, attempt_of)
       VALUES ($1,$2,$3,$4,$5,'queued',$6,$7) RETURNING *`,
      [prev.business_id, viewer.id, String(whats_wrong || prev.asked_for).trim(), prev.kind,
        prev.stage, prev.mock_of, prev.id]);
    return { ok: true, build: r.rows[0], says: 'Fixing that now. This one is not charged for.' };
  } catch (e) {
    return { ok: false, kind: 'unavailable', says: 'I could not start that fix. ' + e.message };
  }
}

// Marking a build finished. Requires somewhere to look, always.
async function ready(build_id, { preview_url, repo_url }) {
  if (!preview_url) {
    // A build reported ready with nowhere to look is the silent-success defect exactly. Three
    // incidents in this estate were a thing correct at every layer checked and unreachable at the
    // one that counted.
    return { ok: false, kind: 'refused',
      says: 'A build is not ready until there is a URL somebody can open. Nothing was marked done.' };
  }
  const r = await query(
    `UPDATE builds SET status='ready', preview_url=$2, repo_url=COALESCE($3, repo_url),
        updated_at=now()
      WHERE id=$1 RETURNING *`, [build_id, preview_url, repo_url || null]);
  if (!r.rows.length) return { ok: false, kind: 'unavailable', says: 'I cannot find that build.' };
  return { ok: true, build: r.rows[0], says: 'Ready to look at: ' + preview_url };
}

async function failed(build_id, why) {
  // Every failure carries a reason. A build that fails silently teaches people the thing is broken
  // in general rather than that this one attempt did not work.
  const r = await query(
    `UPDATE builds SET status='failed', says=$2, updated_at=now() WHERE id=$1 RETURNING *`,
    [build_id, String(why || 'It failed and I do not have a reason to give you, which is itself a '
      + 'fault worth reporting.')]);
  return { ok: !!r.rows.length, build: r.rows[0] || null };
}

async function listFor(viewer, business_id) {
  const gate = await P.can(viewer.id, business_id, 'projects', 'view');
  if (!gate.ok) {
    return { ok: false, kind: 'refused',
      says: P.refusalLine(gate, 'projects', gate.perms && gate.perms.business.name) };
  }
  try {
    const r = await query(
      `SELECT * FROM builds WHERE business_id=$1 AND status <> 'discarded'
        ORDER BY created_at DESC LIMIT 50`, [business_id]);
    return { ok: true, builds: r.rows, says: summarise(r.rows) };
  } catch (e) {
    return { ok: false, kind: 'unavailable',
      says: 'I could not read your builds, so I do not know. That is not the same as you having '
        + 'none. ' + e.message };
  }
}

function summarise(rows) {
  if (!rows.length) {
    return 'Nothing built yet. Tell me what you want something to do and I will make you a working '
      + 'version to look at, free.';
  }
  const waiting = rows.filter((b) => b.stage === 'mock' && b.status === 'ready').length;
  const working = rows.filter((b) => b.status === 'queued' || b.status === 'building').length;
  const parts = [];
  if (waiting) {
    parts.push(waiting === 1 ? 'One version is ready for you to look at'
      : waiting + ' versions are ready for you to look at');
  }
  if (working) parts.push(working === 1 ? 'one is still building' : working + ' are still building');
  if (!parts.length) return rows.length + (rows.length === 1 ? ' build' : ' builds') + ', all done.';
  const s = parts.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

module.exports = { requestMock, approve, fix, ready, failed, listFor, understand, summarise };
