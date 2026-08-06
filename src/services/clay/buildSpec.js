// THE BUILD SPEC PACKAGE — what Clay makes INSTEAD of building applications.
//
// We do not run other people's code, and we are not going to. Sandboxing arbitrary applications,
// per-tenant databases, secrets, deploys and abuse protection is somebody else's whole company, and
// competing there would be a bad use of what we are good at.
//
// What we ARE good at is understanding a business well enough to say precisely what needs building.
// So when someone needs real software, Clay writes the document a developer — or an AI builder like
// Claude Code, Cursor, Lovable or Replit — can actually work from: screens, data, flows, rules,
// services, costs, and what counts as finished. The person owns it and can take it anywhere.
//
// Two honesty rules hold this together, because a confident spec is easy to fake:
//   1. It is built from what the project ACTUALLY contains. Where the project has not established
//      something, the spec says so as an open question rather than inventing a requirement — a made
//      up rule in a build document becomes real code and real cost.
//   2. It never claims we will build or host it. It is a hand-off, and it says so plainly.

const { query } = require('../../config/db');

const PROMPT = `You are writing a BUILD SPEC PACKAGE: the document someone hands to a developer or
pastes into an AI builder to get this software actually built. You are NOT writing marketing, and you
are NOT building it yourself.

Return ONLY JSON, no preamble and no code fences, in exactly this shape:

{
  "summary": string,              // 2-3 sentences: what this software is and who uses it.
  "screens": [                    // every screen/page. Be concrete about what a person does on each.
    { "name": string, "purpose": string, "elements": [string], "actions": [string] }
  ],
  "data_model": [                 // the tables/collections. Only fields the flows actually need.
    { "entity": string, "fields": [string], "notes": string }
  ],
  "flows": [                      // end-to-end journeys, step by step, including what can go wrong.
    { "name": string, "steps": [string], "failure_cases": [string] }
  ],
  "rules": [string],              // business logic that must hold true. Be specific and testable.
  "services": [                   // external services and keys. Be honest about cost.
    { "name": string, "what_for": string, "needed": boolean, "rough_cost": string }
  ],
  "done_when": [string],          // acceptance criteria — how you know it is actually finished.
  "open_questions": [string],     // decisions NOT yet made. Do not invent answers to these.
  "builder_prompt": string        // a paste-ready opening prompt for Claude Code / Cursor / Lovable.
}

Rules you must follow:
- Base everything on the project material you are given. If the project has not established
  something — pricing, a policy, who approves what — put it in open_questions instead of inventing
  it. An invented requirement becomes real code and real cost for this person.
- Keep the scope buildable. A first version someone can actually finish beats an exhaustive wish
  list. Say what is deliberately left out.
- Be honest about services: mark needed vs optional, and give real rough costs including free tiers.
- builder_prompt must be self-contained enough that pasting it alone gets a sensible start.
- Plain language. This is read aloud by people who are not engineers.`;

// Build the spec from a project the person owns.
async function buildSpec(conceptId, userId, opts = {}) {
  const c = (await query(
    `SELECT id, title, brief, category FROM concepts WHERE id=$1 AND owner_id=$2`,
    [conceptId, userId])).rows[0];
  if (!c) return { ok: false, reason: 'not_found' };

  // Feed it the real material, not the title alone — a spec written from a name is fiction.
  const assets = await query(
    `SELECT type, title, body FROM assets
      WHERE concept_id=$1 AND is_current=true AND scan_status <> 'flagged'
      ORDER BY created_at ASC LIMIT 12`, [conceptId]);

  const material = assets.rows
    .map((a) => `[${a.type}] ${a.title || ''}\n${String(a.body || '').slice(0, 4000)}`)
    .join('\n\n');

  const provider = require('./provider');
  if (!provider.available || !provider.available()) {
    return { ok: false, reason: 'provider_unavailable',
      message: 'I cannot write the build spec right now — my model connection is not available. '
        + 'Nothing has been saved. This is worth waiting for rather than guessing at.' };
  }

  const focusLine = opts.focus ? `\n\nFocus this spec on: ${opts.focus}` : '';
  const out = await provider.complete({
    system: PROMPT,
    user: `PROJECT: ${c.title}\nCATEGORY: ${c.category || 'unspecified'}\n\n`
      + `WHAT THE PROJECT CONTAINS:\n${material || '(no material yet — say so in open_questions)'}`
      + focusLine,
    json: true,
    maxTokens: 4000,
  });

  let spec;
  try {
    spec = JSON.parse(String(out || '').replace(/```json|```/g, '').trim());
  } catch (_) {
    return { ok: false, reason: 'unreadable',
      message: 'I wrote a spec but it came back in a shape I could not read, so I have not saved '
        + 'anything rather than save something malformed. Worth trying again.' };
  }
  return { ok: true, concept_id: conceptId, title: c.title, spec };
}

// Render it as the document a person actually reads or hands over.
function renderSpec(title, spec) {
  const L = [];
  const list = (arr) => (arr || []).map((x) => '- ' + x).join('\n');
  L.push(`BUILD SPEC — ${title}`);
  L.push('');
  L.push('This is a hand-off document. Access YP Labs does not build or host applications; this is');
  L.push('what you give a developer, or paste into an AI builder like Claude Code, Cursor or Lovable,');
  L.push('to get it built. It is yours to take anywhere.');
  L.push('');
  L.push('WHAT THIS IS'); L.push(spec.summary || ''); L.push('');
  L.push('SCREENS');
  (spec.screens || []).forEach((s) => {
    L.push(`${s.name} — ${s.purpose}`);
    if (s.elements && s.elements.length) L.push('  On screen: ' + s.elements.join('; '));
    if (s.actions && s.actions.length) L.push('  You can: ' + s.actions.join('; '));
  });
  L.push('');
  L.push('DATA');
  (spec.data_model || []).forEach((d) => {
    L.push(`${d.entity}: ${(d.fields || []).join(', ')}`);
    if (d.notes) L.push('  ' + d.notes);
  });
  L.push('');
  L.push('HOW IT WORKS, STEP BY STEP');
  (spec.flows || []).forEach((f) => {
    L.push(f.name);
    (f.steps || []).forEach((s, i) => L.push(`  ${i + 1}. ${s}`));
    if (f.failure_cases && f.failure_cases.length) L.push('  What can go wrong: ' + f.failure_cases.join('; '));
  });
  L.push('');
  L.push('RULES THAT MUST HOLD'); L.push(list(spec.rules)); L.push('');
  L.push('SERVICES AND KEYS YOU WILL NEED');
  (spec.services || []).forEach((s) => {
    L.push(`${s.name} — ${s.what_for} (${s.needed ? 'needed' : 'optional'}; ${s.rough_cost || 'cost unclear'})`);
  });
  L.push('');
  L.push('DONE WHEN'); L.push(list(spec.done_when)); L.push('');
  if ((spec.open_questions || []).length) {
    L.push('STILL TO DECIDE — these are NOT settled, and nobody should build as if they were.');
    L.push(list(spec.open_questions)); L.push('');
  }
  L.push('PASTE THIS INTO YOUR BUILDER TO START');
  L.push(spec.builder_prompt || '');
  return L.join('\n');
}

module.exports = { buildSpec, renderSpec, PROMPT };
