// ASKING PENNY TO BUILD SOMETHING.
//
// The database refuses to charge for anything nobody approved. This is the flow above it, and its
// job is to make the free path the obvious one rather than a concession.
//
// ASK -> "DO YOU WANT A MOCK-UP FIRST?" -> either
//          MOCK (free, unlimited) -> APPROVE -> REAL
//       or REAL straight away, with the choice to skip the mock-up recorded
//
// THE QUESTION IS ALWAYS ASKED. The owner decided on 16 Sept 2026 that a mock-up is offered, never
// forced: somebody making a quick edit should not have to sit through a demo. So nothing starts until
// the person has answered, and the answer is stored. A build does not become chargeable because
// nobody asked; the database refuses one with neither an approved mock nor a recorded "no".
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

// The question, in one place, so the screen and Penny say the same words.
const MOCK_QUESTION = 'Do you want me to create a mock-up first, so you can make sure everything is '
  + 'to your liking before I start building? Or I can go straight to building it.';

function mockChoice(v) {
  if (v === true || v === 'yes' || v === 'true') return 'yes';
  if (v === false || v === 'no' || v === 'false') return 'no';
  return null;
}

// Starting anything. Asks the mock-up question until it has an answer, then does what was chosen.
async function start(viewer, { business_id, asked_for, kind, mock_first, edit_of }) {
  const gate = await P.can(viewer.id, business_id, 'projects', 'act');
  if (!gate.ok) {
    return { ok: false, kind: 'refused',
      says: P.refusalLine(gate, 'projects', gate.perms && gate.perms.business.name) };
  }
  const u = understand(asked_for);
  if (!u.ok) return { ok: false, kind: 'unclear', says: u.says };

  let base = null;
  if (edit_of) {
    base = (await query('SELECT id, business_id, status FROM builds WHERE id=$1', [edit_of])).rows[0];
    if (!base || base.business_id !== business_id) {
      return { ok: false, kind: 'unavailable',
        says: 'I cannot find the thing you want changed, so nothing was started.' };
    }
    if (base.status !== 'ready') {
      return { ok: false, kind: 'refused',
        says: 'That one is not finished yet, so there is nothing to edit. I will tell you when it is.' };
    }
  }

  const choice = mockChoice(mock_first);
  if (!choice) {
    // Not an error and not a refusal: nothing happens until they answer.
    return { ok: true, needs: 'mock_choice', question: MOCK_QUESTION, says: MOCK_QUESTION };
  }
  if (choice === 'yes') return requestMock(viewer, { business_id, asked_for, kind, edit_of }, gate);

  try {
    const r = await query(
      `INSERT INTO builds (business_id, requested_by, asked_for, kind, stage, status,
          approved_at, mock_declined_at, chargeable, edit_of)
       VALUES ($1,$2,$3,$4,'real','queued',now(),now(),true,$5) RETURNING *`,
      [business_id, viewer.id, String(asked_for).trim(), kind || null, edit_of || null]);
    return { ok: true, build: r.rows[0],
      says: edit_of
        ? 'Making that change now, without a mock-up, as you asked. I will tell you when it is ready.'
        : 'Building it now, without a mock-up, as you asked. I will tell you when it is ready to open.' };
  } catch (e) {
    return { ok: false, kind: 'unavailable',
      says: 'I could not start that build, so nothing was started and nothing is owed. ' + e.message };
  }
}

async function requestMock(viewer, { business_id, asked_for, kind, edit_of }, checked) {
  if (!checked) {
    const gate = await P.can(viewer.id, business_id, 'projects', 'act');
    if (!gate.ok) {
      return { ok: false, kind: 'refused',
        says: P.refusalLine(gate, 'projects', gate.perms && gate.perms.business.name) };
    }
    const u = understand(asked_for);
    if (!u.ok) return { ok: false, kind: 'unclear', says: u.says };
  }

  try {
    const r = await query(
      `INSERT INTO builds (business_id, requested_by, asked_for, kind, stage, status, edit_of)
       VALUES ($1,$2,$3,$4,'mock','queued',$5) RETURNING *`,
      [business_id, viewer.id, String(asked_for).trim(), kind || null, edit_of || null]);
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
          mock_of, approved_at, chargeable, edit_of)
       VALUES ($1,$2,$3,$4,'real','queued',$5,now(),true,$6) RETURNING *`,
      [m.business_id, viewer.id, m.asked_for, m.kind, m.id, m.edit_of || null]);
    return { ok: true, build: r.rows[0],
      // No price is set and no charge is taken yet (metering and invoicing are not built), so this
      // says what is true today rather than promising a charge that does not happen.
      says: 'Building the real one now. This is the version you keep. Anything I get wrong and have '
        + 'to fix afterwards is never charged.' };
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
          mock_of, attempt_of, edit_of)
       VALUES ($1,$2,$3,$4,$5,'queued',$6,$7,$8) RETURNING *`,
      [prev.business_id, viewer.id, String(whats_wrong || prev.asked_for).trim(), prev.kind,
        prev.stage, prev.mock_of, prev.id, prev.edit_of || null]);
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
      `SELECT id, business_id, stage, asked_for, kind, status, says, mock_of, attempt_of, edit_of,
              approved_at, mock_declined_at, chargeable, preview_url, repo_url, created_at,
              updated_at
         FROM builds WHERE business_id=$1 AND status <> 'discarded'
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
    return 'Nothing built yet. Tell me what you want something to do. Before I start I will ask '
      + 'whether you want a free mock-up first or want me to go straight to building it.';
  }
  const waiting = rows.filter((b) => b.stage === 'mock' && b.status === 'ready').length;
  const built = rows.filter((b) => b.stage === 'real' && b.status === 'ready').length;
  const working = rows.filter((b) => b.status === 'queued' || b.status === 'building').length;
  const failedN = rows.filter((b) => b.status === 'failed').length;
  const parts = [];
  if (waiting) {
    parts.push(waiting === 1 ? 'one mock-up is ready for you to look at'
      : waiting + ' mock-ups are ready for you to look at');
  }
  // A finished real build used to go unmentioned, which made the list sound emptier than it was.
  if (built) parts.push(built === 1 ? 'one build is finished and ready to open' : built + ' builds are finished and ready to open');
  if (working) parts.push(working === 1 ? 'one is still building' : working + ' are still building');
  if (failedN) parts.push(failedN === 1 ? 'one did not finish' : failedN + ' did not finish');
  if (!parts.length) return rows.length + (rows.length === 1 ? ' build' : ' builds') + ', all done.';
  const s = parts.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

module.exports = { start, MOCK_QUESTION, mockChoice, requestMock, approve, fix, ready, failed, listFor, understand, summarise };
