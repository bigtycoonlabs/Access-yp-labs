// Per-concept creator intent — the keystone that lets Clay coach.
//
// For one concept, a creator has a plan: build it themselves and launch it as a real business, keep
// refining it to sell at the highest value in the Dreamhold, or they're still exploring. Clay reads
// this in every concept conversation and coaches toward it; when it's unknown he learns it and
// records it here. This module is the single source of truth: the same PATHS the UI shows are the
// ones Clay coaches from, so the guidance a creator hears always matches the choices they see.
//
// Nothing here spends money, publishes, or deletes. It only reads and writes a small intent record
// scoped to (concept, user). Values are validated against a fixed set and length-capped.

const { query } = require('../../config/db');

// The three plans a creator can take with ONE concept.
const PATHS = [
  {
    id: 'build_myself',
    label: 'Build it myself',
    short: 'Launch this as a real business you run and keep everything it earns.',
    coaching: 'Coach toward launching a real business they run: the concrete build steps, the '
      + 'services and keys the build needs, how to land the first customers on a small budget, and '
      + 'the unit economics. Keep momentum pointed at a working, launched business they own.',
  },
  {
    id: 'refine_to_sell',
    label: 'Refine it to sell',
    short: 'Polish the concept to sell at the highest honest value in the Dreamhold.',
    coaching: 'Coach toward a sellable asset: sharpen the pitch, the proof, the demo, and the '
      + 'completeness so a buyer immediately sees the value. Aim for the highest HONEST sale price '
      + 'in the Dreamhold — never inflate or fabricate traction to raise it.',
  },
  {
    id: 'exploring',
    label: 'Still exploring',
    short: 'Not sure yet — keep shaping it and decide the path later.',
    coaching: 'Help them decide: surface what would make this more worth BUILDING versus more worth '
      + 'SELLING, and revisit the choice out loud as the concept firms up. Do not push them into a '
      + 'path before they are ready.',
  },
];
const PATH_IDS = PATHS.map((p) => p.id);

// The ways a creator can EARN on the platform. This is the potential the founder keeps having to
// explain by hand — encoded once so Clay can teach it naturally and the UI can show it.
const EARNING_PATHS = [
  {
    id: 'sell_your_ideas',
    title: 'Build and sell your own ideas',
    how: 'Shape a concept with Clay, refine it, and list it in the Dreamhold. When it sells you '
      + 'earn the sale price minus the platform fee.',
  },
  {
    id: 'resell_ideas',
    title: 'Buy and resell other people\u2019s ideas',
    how: 'Buy a concept in the Dreamhold, sharpen or extend it with Clay, and relist it for more '
      + 'than you paid.',
  },
  {
    id: 'launch_business',
    title: 'Build an idea and launch it as a real business',
    how: 'Use the build materials \u2014 the plan, the demo, the step-by-step build \u2014 to '
      + 'actually launch and run the business yourself, keeping everything it earns.',
  },
  {
    id: 'consult',
    title: 'Become a consultant',
    how: 'As you gain experience shaping and launching ideas, help other creators do the same as a '
      + 'paid consultant on the platform.',
  },
];

function pathById(id) {
  return PATHS.find((p) => p.id === id) || null;
}

// The current intent for (concept, user), or null if the creator hasn't chosen a path yet.
async function getIntent(conceptId, userId) {
  if (!conceptId || !userId) return null;
  const r = await query(
    'SELECT path, note, set_by, updated_at FROM concept_intents WHERE concept_id=$1 AND user_id=$2',
    [conceptId, userId]);
  if (!r.rows.length) return null;
  const row = r.rows[0];
  const def = pathById(row.path);
  return {
    path: row.path,
    label: def ? def.label : row.path,
    short: def ? def.short : null,
    coaching: def ? def.coaching : null,
    note: row.note || null,
    set_by: row.set_by,
    updated_at: row.updated_at,
  };
}

// Record or update the creator's chosen path for a concept. Validated and length-capped. `setBy`
// distinguishes the creator choosing it themselves from Clay recording what they told him.
async function setIntent(conceptId, userId, path, note, setBy) {
  if (!conceptId || !userId) return { ok: false, reason: 'missing_ids' };
  if (!PATH_IDS.includes(path)) return { ok: false, reason: 'invalid_path' };
  const n = note == null ? null : (String(note).trim().slice(0, 500) || null);
  const by = setBy === 'clay' ? 'clay' : 'user';
  await query(
    `INSERT INTO concept_intents (concept_id, user_id, path, note, set_by)
       VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (concept_id, user_id)
       DO UPDATE SET path=EXCLUDED.path, note=EXCLUDED.note, set_by=EXCLUDED.set_by, updated_at=now()`,
    [conceptId, userId, path, n, by]);
  return { ok: true, intent: await getIntent(conceptId, userId) };
}

module.exports = { PATHS, PATH_IDS, EARNING_PATHS, pathById, getIntent, setIntent };
