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

const VERIFIED = '2026-09-15';

// Each rule: who imposes it, what it costs to miss, what happens beyond the money, and where that
// was read. `applies` decides whether it is this business's problem.
const RULES = [
  // ---------------------------------------------------------------- Florida
  {
    id: 'fl-llc-annual-report',
    scope: { states: ['FL'], entity_types: ['llc'] },
    kind: 'filing',
    title: 'Florida annual report',
    counterparty: 'Florida Division of Corporations',
    counterparty_kind: 'government',
    // Due 1 May every year, filing opens 1 January. No extensions and no grace period.
    due: { month: 5, day: 1 },
    recurs_every: '1 year',
    // The $400 is the LATE PENALTY, not the fee. That is the number that matters for ranking,
    // because the fee is owed either way and the penalty is what missing it costs.
    cost_if_missed_cents: 40000,
    cost_basis: 'known',
    cost_note: 'The filing itself is $138.75. The $400 is the late penalty on top, and it is '
      + 'non-waivable — the state does not reduce it for any reason.',
    consequence: 'A day late costs $400 on top of the $138.75 fee. Not filed by the third Friday '
      + 'in September and the state dissolves the company on the fourth Friday, which ends the '
      + 'liability protection the LLC exists for.',
    source: 'Florida Division of Corporations, Sunbiz',
    source_url: 'https://dos.fl.gov/sunbiz/manage-business/annual-report/',
    verified_on: VERIFIED,
  },

  // ---------------------------------------------------------------- Ohio
  {
    // NOT AN OBLIGATION. A correction, raised once, because the wrong belief is expensive and
    // extremely common — and because I held it myself while building this.
    id: 'oh-no-annual-report',
    scope: { states: ['OH'], entity_types: ['llc'] },
    kind: 'note',
    title: 'Ohio does not require an annual report',
    counterparty: 'Ohio Secretary of State',
    counterparty_kind: 'government',
    consequence: 'Ohio is one of about four states with no LLC annual report at all. There is '
      + 'nothing to file and nothing to pay each year. What you do have to keep is a statutory '
      + 'agent on file, and municipal income tax in every city you work in — Ohio has over 600 '
      + 'municipalities that levy their own.',
    source: 'Ohio Secretary of State business FAQ',
    source_url: 'https://www.ohiosos.gov/businesses/information-on-starting-and-maintaining-a-business/',
    verified_on: VERIFIED,
  },
  {
    id: 'oh-statutory-agent',
    scope: { states: ['OH'], entity_types: ['llc', 's_corp', 'c_corp'] },
    kind: 'registration',
    title: 'Keep a statutory agent on file in Ohio',
    counterparty: 'Ohio Secretary of State',
    counterparty_kind: 'government',
    // No recurring date — it is a standing condition, not a deadline. Giving it a fake annual date
    // would put a made-up deadline on the ranked list, which is the thing this file exists to stop.
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
function rulesFor(business, facts = {}) {
  const hit = RULES.filter((r) => applies(r, business, facts));
  return {
    obligations: hit.filter((r) => r.kind !== 'note').map((r) => ({
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
    })),
    notes: hit.filter((r) => r.kind === 'note').map((r) => ({
      title: r.title, says: r.consequence,
      source_ref: r.source + ' — ' + r.source_url + ' (checked ' + r.verified_on + ')',
    })),
  };
}

// WHAT WE DO NOT COVER, said out loud rather than left as silence. A person who thinks the list is
// complete is worse off than one who knows it is a start — silence reads as "nothing else applies".
const COVERED_STATES = ['FL', 'OH'];

function coverageNote(business) {
  const states = [business.formation_state, ...(business.operating_states || [])]
    .filter(Boolean).map((x) => String(x).toUpperCase());
  const uncovered = [...new Set(states)].filter((s) => !COVERED_STATES.includes(s));
  if (!uncovered.length) return null;
  return 'I have checked state rules for ' + COVERED_STATES.join(' and ') + ' so far, and not yet '
    + 'for ' + uncovered.join(', ') + '. Anything I have not checked is not on your list, so treat '
    + 'this as a start rather than the whole picture. Local city and county rules are almost always '
    + 'on top of the state ones.';
}

module.exports = { RULES, rulesFor, applies, nextDue, coverageNote, COVERED_STATES, VERIFIED };
