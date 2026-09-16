// THE RULE ENGINE, AND WHY IT REFUSES TO GUESS.
//
// I INVENTED A FILING. Throughout building this platform I used "Ohio annual report, $25, due
// annually" as the worked example — in seed data, in test fixtures, in the ranked list, in commit
// messages. It does not exist. Ohio is one of about four states (with Arizona, Missouri and New
// Mexico) that require NO annual report from an LLC at all. The $25 was most likely pattern-matched
// from Ohio's Statutory Agent Update fee, which is a different filing for a different event.
//
// It was plausible, specific, confidently stated, and wrong — produced while building the exact
// machinery meant to prevent that. Had it shipped, an Ohio owner would have been told every year to
// file something that does not exist, and the product's one real claim would have been false on its
// first screen.
//
// So this file has a hard rule, enforced in code rather than in review:
//
//   NO RULE WITHOUT A SOURCE. Every obligation carries the authority that imposes it, a URL, and
//   the date somebody last checked. A rule missing any of those throws at load rather than
//   producing a confident sentence about somebody's business.
//
// And a second rule, which is the honest consequence of the first:
//
//   ABSENCE IS AN ANSWER WORTH STATING. Telling an Ohio LLC "you have no annual report, unlike most
//   states" is as useful as telling a Florida one that theirs costs $400 if it is a day late. Every
//   compliance tool lists what you owe. Almost none tell you what you do not, which is why people
//   pay for filings they never needed.
//
// COVERAGE IS SMALL ON PURPOSE. Two states and the federal basics, verified. A rule engine that
// covers fifty states badly is worse than one that covers two states honestly and says so.

const states = require('./states');

const VERIFIED = '2026-09-15';

// Each rule: who imposes it, what it costs to miss, what happens beyond the money, and where that
// was read. `applies` decides whether it is this business's problem.
const RULES = [
  // State annual reports are no longer hand-written here. They live in states.js, one entry per
  // state, each declaring its own confidence — because fixing one state is worthless if the other
  // forty-nine are guesses. Ohio's statutory agent stays below: it is a standing condition rather
  // than an annual filing, which the state table does not model.
  {
    id: 'oh-statutory-agent',
    scope: { states: ['OH'], entity_types: ['llc', 's_corp', 'c_corp'] },
    kind: 'registration',
    title: 'Keep a statutory agent on file in Ohio',
    counterparty: 'Ohio Secretary of State',
    counterparty_kind: 'government',
    due: null,
    cost_if_missed_cents: 2500,
    cost_basis: 'known',
    cost_note: 'Updating the agent costs $25 (Form 521). The real cost of not having one is losing '
      + 'good standing.',
    consequence: 'Without a valid statutory agent the company can lose good standing, and legal '
      + 'notices go to an address nobody reads.',
    source: 'Ohio Secretary of State, Statutory Agent Update (Form 521)',
    source_url: 'https://www.ohiosos.gov/businesses/filing-forms--fee-schedule/',
    verified_on: VERIFIED,
  },

  // ---------------------------------------------------------------- Federal, any state
  {
    id: 'fed-contractor-1099',
    scope: { states: '*', entity_types: '*', when: 'has_contractors' },
    kind: 'tax',
    title: 'Send 1099-NEC to contractors paid $600 or more',
    counterparty: 'Internal Revenue Service',
    counterparty_kind: 'government',
    due: { month: 1, day: 31 },
    recurs_every: '1 year',
    cost_basis: 'estimated',
    cost_if_missed_cents: 6000,
    cost_note: 'Penalties are per form and rise the longer they are late, so the real figure '
      + 'depends on how many contractors and how late. This is the low end for one form.',
    consequence: 'A penalty for each form, per contractor, increasing with delay.',
    source: 'IRS, Instructions for Forms 1099-MISC and 1099-NEC',
    source_url: 'https://www.irs.gov/forms-pubs/about-form-1099-nec',
    verified_on: VERIFIED,
  },
  {
    id: 'fed-w9-before-paying',
    scope: { states: '*', entity_types: '*', when: 'has_contractors' },
    kind: 'task',
    title: 'Get a W-9 from every contractor before you pay them',
    counterparty: 'Your contractors',
    counterparty_kind: 'contractor',
    due: null,
    cost_basis: 'unknown',
    consequence: 'Without it you cannot file their 1099 in January, and chasing a tax ID from '
      + 'somebody who has stopped working for you is much harder than asking on day one.',
    source: 'IRS, About Form W-9',
    source_url: 'https://www.irs.gov/forms-pubs/about-form-w-9',
    verified_on: VERIFIED,
  },
];

// LOADED-TIME ENFORCEMENT. A rule that cannot say where it came from never reaches a person.
for (const r of RULES) {
  if (!r.source || !r.source_url || !r.verified_on) {
    throw new Error('rule ' + r.id + ' has no source. A rule that cannot cite itself must not ship.');
  }
  if (r.cost_if_missed_cents != null && !r.cost_basis) {
    throw new Error('rule ' + r.id + ' puts a number on it without saying what that is based on.');
  }
}

function applies(rule, business, facts = {}) {
  const s = rule.scope;
  const states = new Set([business.formation_state, ...(business.operating_states || [])]
    .filter(Boolean).map((x) => String(x).toUpperCase()));
  if (s.states !== '*' && !s.states.some((st) => states.has(st))) return false;
  if (s.entity_types !== '*' && !s.entity_types.includes(business.entity_type)) return false;
  if (s.when === 'has_contractors' && !facts.has_contractors) return false;
  return true;
}

// Next occurrence of a month/day, from today.
function nextDue(due, from = new Date()) {
  if (!due) return null;
  const y = from.getUTCFullYear();
  let d = new Date(Date.UTC(y, due.month - 1, due.day, 9, 0, 0));
  if (d <= from) d = new Date(Date.UTC(y + 1, due.month - 1, due.day, 9, 0, 0));
  return d;
}

// What this business owes, and what it notably does NOT.
// Every state the business touches, not only where it was formed. An LLC formed in Delaware and
// operating in California owes in both, and that is precisely the person who loses an entity.
function stateObligations(business) {
  const codes = [...new Set([business.formation_state, ...(business.operating_states || [])]
    .filter(Boolean).map((x) => String(x).toUpperCase()))];
  const out = { obligations: [], notes: [], unknown: [] };
  for (const code of codes) {
    const got = states.stateRule(code, business);
    if (!got) { out.unknown.push(code); continue; }
    // A state may return more than one thing — California's franchise tax is separate from its
    // Statement of Information and is the one people actually miss.
    for (const r of [].concat(got)) {
    if (r.kind === 'note') { out.notes.push({ title: r.title, says: r.says, source_ref: r.source_ref }); continue; }
    out.obligations.push({
      rule_id: 'state-' + code.toLowerCase() + '-report',
      kind: r.kind,
      title: r.title,
      counterparty: r.counterparty || (code + ' Secretary of State'),
      counterparty_kind: 'government',
      due_at: nextDue(r.due),
      due_note: r.due_note,
      recurs_every: r.recurs_every,
      cost_if_missed_cents: r.cost_if_missed_cents,
      cost_basis: r.cost_basis,
      cost_note: r.cost_note,
      consequence: r.consequence,
      confidence: r.confidence,
      source: 'rule_engine',
      source_ref: r.source_ref,
    });
    }
  }
  return out;
}

function rulesFor(business, facts = {}) {
  const hit = RULES.filter((r) => applies(r, business, facts));
  const st = stateObligations(business);
  return {
    obligations: st.obligations.concat(hit.filter((r) => r.kind !== 'note').map((r) => ({
      rule_id: r.id,
      kind: r.kind,
      title: r.title,
      counterparty: r.counterparty,
      counterparty_kind: r.counterparty_kind,
      due_at: nextDue(r.due),
      recurs_every: r.recurs_every || null,
      cost_if_missed_cents: r.cost_if_missed_cents ?? null,
      cost_basis: r.cost_basis || null,
      cost_note: r.cost_note || null,
      consequence: r.consequence,
      source: 'rule_engine',
      source_ref: r.source + ' — ' + r.source_url + ' (checked ' + r.verified_on + ')',
    }))),
    notes: st.notes.concat(hit.filter((r) => r.kind === 'note').map((r) => ({
      title: r.title, says: r.consequence,
      source_ref: r.source + ' — ' + r.source_url + ' (checked ' + r.verified_on + ')',
    }))),
    unknown_states: st.unknown,
  };
}

// WHAT WE DO NOT COVER, said out loud rather than left as silence. A person who thinks the list is
// complete is worse off than one who knows it is a start — silence reads as "nothing else applies".
const COVERED_STATES = states.ALL_STATES;

// WHAT IS STILL NOT KNOWN, said plainly. Every state is now in the table, but only some are verified
// down to the fee — and a person who believes the list is complete is worse off than one who knows
// which parts are solid.
function coverageNote(business) {
  const codes = [...new Set([business.formation_state, ...(business.operating_states || [])]
    .filter(Boolean).map((x) => String(x).toUpperCase()))];
  const unverified = codes.filter((c) => states.STATES[c]
    && states.STATES[c].confidence !== 'verified');
  const missing = codes.filter((c) => !states.STATES[c]);
  const parts = [];
  if (missing.length) {
    parts.push('I do not have rules for ' + missing.join(', ') + ' at all, so nothing from there is '
      + 'on your list.');
  }
  if (unverified.length) {
    parts.push('For ' + unverified.join(', ') + ' I have the deadline but not a confirmed fee — '
      + 'several states changed theirs in 2025 and 2026, so check the exact figure before paying.');
  }
  parts.push('And state rules are never the whole picture: city and county licences sit on top of '
    + 'them, and I do not have those yet.');
  return parts.join(' ');
}

module.exports = { RULES, rulesFor, applies, nextDue, coverageNote, stateObligations,
  COVERED_STATES, VERIFIED, states };
