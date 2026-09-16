// EVERY STATE — WHAT AN LLC OWES ITS SECRETARY OF STATE EACH YEAR.
//
// This file exists because I invented an Ohio filing that does not exist, and the fix for one state
// is worthless if the other forty-nine are guesses. So this is built to a rule:
//
//   EVERY ENTRY DECLARES ITS OWN CONFIDENCE, and the confidence is what the person is told.
//
//     verified    Multiple independent sources agree on the fee, the date and the penalty. Stated
//                 as fact, with the number.
//     unconfirmed The obligation exists and the timing is well established, but the exact fee moved
//                 recently or sources disagree. Stated as a deadline WITHOUT a confident figure.
//     none        The state genuinely does not require one. Stated as a correction, because people
//                 pay for filings they never needed.
//
// An unconfirmed entry is still worth far more than silence. "Georgia has an annual registration due
// around 1 April and I have not confirmed this year's fee" is useful. A wrong fee is not, and
// silence is the worst of the three because it reads as "nothing applies".
//
// WHY THE FEE IS NOT THE RANKING NUMBER. What missing a filing costs is the penalty plus, eventually,
// administrative dissolution — which ends the liability protection the entity exists for. That
// consequence is close to universal and it is the real stake. The fee is owed either way.
//
// FEES AGE BADLY. Kansas moved in February 2026, Louisiana moves in October 2026, Pennsylvania's
// report is new since 2025 with enforcement starting 2027, South Dakota's due-date system changes in
// 2027, and Alabama removed its standalone report in 2024. Anything in here needs re-checking on a
// schedule, which is why every entry carries the date it was last looked at.

const CHECKED = '2026-09-15';

// fee_cents is the cost of FILING. late_cents is what missing it costs, which is the ranking number.
// due: { month, day } for a fixed statewide date, or 'anniversary' where the date follows formation.
const STATES = {
  // ---------------------------------------------------------------- no report at all
  AZ: { report: 'none', note: 'Arizona does not require an LLC annual report.', confidence: 'verified' },
  MO: { report: 'none', note: 'Missouri does not require an LLC annual report.', confidence: 'verified' },
  NM: { report: 'none', note: 'New Mexico does not require an LLC annual report.', confidence: 'verified' },
  OH: { report: 'none', confidence: 'verified',
    note: 'Ohio does not require an LLC annual report — one of only a handful of states with none '
      + 'at all. What Ohio does require is a statutory agent on file, and municipal income tax in '
      + 'every city you work in: there are over 600 municipalities levying their own.' },
  SC: { report: 'none', confidence: 'verified',
    note: 'South Carolina does not require a standalone LLC annual report. An LLC taxed as a '
      + 'corporation files differently, so check if that is you.' },
  AL: { report: 'none', confidence: 'unconfirmed',
    note: 'Alabama removed its standalone LLC annual report in 2024. The Business Privilege Tax is '
      + 'separate and may still apply — worth confirming for your situation.' },

  // ---------------------------------------------------------------- verified, fixed date
  FL: { report: 'annual', due: { month: 5, day: 1 }, fee_cents: 13875, late_cents: 40000,
    confidence: 'verified',
    consequence: 'A day late costs $400 on top of the $138.75 fee, non-waivable. Not filed by the '
      + 'third Friday in September and the state dissolves the company on the fourth Friday.',
    note: 'The filing itself is $138.75; the $400 is the late penalty on top, and it is '
      + 'non-waivable. The window opens 1 January and there are no extensions and no grace '
      + 'period.' },
  DE: { report: 'annual_tax', due: { month: 6, day: 1 }, fee_cents: 30000, late_cents: 20000,
    confidence: 'unconfirmed',
    consequence: 'Delaware charges a late penalty plus interest, and the entity falls out of good '
      + 'standing.',
    note: 'Delaware LLCs pay a flat annual tax rather than filing a report form. Sources disagree '
      + 'on whether it is $300 or $400 — check the Division of Corporations before paying.' },
  // TWO OBLIGATIONS, NOT ONE. The first version of this entry merged them and put the franchise
  // tax's date on the Statement of Information — which would have told a California owner their
  // $20 filing was due 15 April and said nothing about the $800 that actually is.
  //
  // The Statement of Information is biennial and keyed to the formation anniversary. The $800
  // franchise tax is annual, due 15 April, and owed whether or not the business made a penny.
  CA: { report: 'biennial', due: 'anniversary', fee_cents: 2000, late_cents: 25000,
    confidence: 'verified',
    consequence: 'A late Statement of Information carries a penalty and loss of good standing.',
    note: 'Every two years, keyed to your formation anniversary. This is the small one — see the '
      + 'franchise tax below, which is the one that hurts.',
    extra: {
      kind: 'tax',
      title: 'California $800 franchise tax',
      due: { month: 4, day: 15 },
      recurs_every: '1 year',
      cost_if_missed_cents: 80000,
      cost_basis: 'known',
      confidence: 'verified',
      consequence: 'Owed every year regardless of income, even at zero revenue. Non-payment brings '
        + 'penalties and interest and can suspend the entity.',
      note: 'Paid to the Franchise Tax Board rather than the Secretary of State, which is why it '
        + 'gets missed. Above $250,000 of gross receipts there is an additional fee on top.',
      counterparty: 'California Franchise Tax Board',
    } },
  TX: { report: 'franchise', due: { month: 5, day: 15 }, fee_cents: 0, confidence: 'verified',
    consequence: 'Skipping the franchise filing forfeits the entity\u2019s right to do business in '
      + 'Texas.',
    note: 'No fee to file, but the franchise tax report itself is required. Most LLCs under the '
      + 'revenue threshold owe $0 and must still file.' },
  NV: { report: 'annual', due: 'anniversary', fee_cents: 35000, late_cents: 17500,
    confidence: 'verified',
    consequence: 'Late filing adds penalties and the entity falls out of good standing.',
    note: 'Two filings that arrive together: the Annual List of Members at $150 and the State '
      + 'Business License at $200. Due in your formation anniversary month.' },
  MA: { report: 'annual', due: 'anniversary', fee_cents: 50000, confidence: 'verified',
    consequence: 'Continued non-filing leads to administrative dissolution.',
    note: 'The highest standard annual report fee in the country, due on your formation '
      + 'anniversary. There is a small extra charge for filing online.' },
  TN: { report: 'annual', due: { month: 4, day: 1 }, fee_cents: 30000, confidence: 'verified',
    consequence: 'Non-filing leads to administrative dissolution.',
    note: '$50 per member per year, with a $300 minimum and a $3,000 cap. Most single-member LLCs '
      + 'pay the $300 minimum.' },
  MN: { report: 'annual', due: { month: 12, day: 31 }, fee_cents: 0, confidence: 'verified',
    consequence: 'Missing it means administrative dissolution, even though filing is free.',
    note: 'No fee, and still compulsory. The free ones are the easiest to forget.' },
  MD: { report: 'annual', due: { month: 4, day: 15 }, fee_cents: 30000, confidence: 'unconfirmed',
    consequence: 'Late filing brings penalties and eventual forfeiture of the charter.',
    note: 'Maryland also assesses personal property tax for some businesses, filed alongside.' },
  NC: { report: 'annual', due: { month: 4, day: 15 }, fee_cents: 20000, confidence: 'unconfirmed',
    consequence: 'Non-filing leads to administrative dissolution.' },
  GA: { report: 'annual', due: { month: 4, day: 1 }, confidence: 'unconfirmed',
    consequence: 'Non-filing leads to administrative dissolution.' },
  PA: { report: 'annual', due: { month: 9, day: 30 }, fee_cents: 700, confidence: 'unconfirmed',
    consequence: 'Enforcement and administrative dissolution begin in 2027; there was a grace '
      + 'period for 2025 and 2026.',
    note: 'Pennsylvania\u2019s annual report is new since 2025 and catches people who have run an '
      + 'LLC there for years without one. LLCs file by 30 September.' },

  // ---------------------------------------------------------------- biennial
  AK: { report: 'biennial', due: { month: 1, day: 2 }, fee_cents: 10000, confidence: 'unconfirmed',
    note: 'Alaska files every two years, through the Division of Corporations, Business and '
      + 'Professional Licensing rather than a Secretary of State.' },
  DC: { report: 'biennial', due: { month: 4, day: 1 }, fee_cents: 30000, confidence: 'unconfirmed' },
  IN: { report: 'biennial', due: 'anniversary', fee_cents: 3200, confidence: 'unconfirmed',
    note: 'Every two years, in your anniversary month. Cheaper online than on paper.' },
  IA: { report: 'biennial', due: { month: 4, day: 1 }, confidence: 'unconfirmed' },
  KS: { report: 'biennial', due: { month: 4, day: 15 }, confidence: 'unconfirmed',
    note: 'Kansas fees changed in February 2026 and sources disagree on the new figures.' },
  NE: { report: 'biennial', due: { month: 4, day: 1 }, confidence: 'unconfirmed' },
  NY: { report: 'biennial', due: 'anniversary', fee_cents: 900, confidence: 'unconfirmed',
    note: 'New York files a biennial statement in the anniversary month. Separately, a new LLC has '
      + 'a publication requirement that can cost far more than the filing.' },

  // ---------------------------------------------------------------- annual, fee not confirmed
  AR: { report: 'franchise', due: { month: 5, day: 1 }, confidence: 'unconfirmed',
    note: 'Arkansas uses a franchise tax report rather than a standard annual report.' },
  CO: { report: 'annual', due: 'anniversary', confidence: 'unconfirmed',
    note: 'Colorado calls it a Periodic Report, due in a window around the anniversary month.' },
  CT: { report: 'annual', due: { month: 3, day: 31 }, confidence: 'unconfirmed' },
  HI: { report: 'annual', due: 'anniversary', confidence: 'unconfirmed',
    note: 'Hawaii assigns a filing quarter based on when the entity was formed.' },
  ID: { report: 'annual', due: 'anniversary', fee_cents: 0, confidence: 'unconfirmed',
    note: 'No fee, and still required. Free filings are the easiest to forget.' },
  IL: { report: 'annual', due: 'anniversary', confidence: 'unconfirmed' },
  KY: { report: 'annual', due: { month: 6, day: 30 }, confidence: 'unconfirmed',
    note: 'Kentucky also has a minimum Limited Liability Entity Tax that is separate from the '
      + 'report.' },
  LA: { report: 'annual', due: 'anniversary', confidence: 'unconfirmed',
    note: 'Louisiana fees change in October 2026.' },
  ME: { report: 'annual', due: { month: 6, day: 1 }, confidence: 'unconfirmed' },
  MI: { report: 'annual', due: { month: 2, day: 15 }, confidence: 'unconfirmed' },
  MS: { report: 'annual', due: { month: 4, day: 15 }, fee_cents: 0, confidence: 'unconfirmed',
    note: 'No fee for an LLC, and still required.' },
  MT: { report: 'annual', due: { month: 4, day: 15 }, confidence: 'unconfirmed' },
  ND: { report: 'annual', due: { month: 11, day: 15 }, confidence: 'unconfirmed' },
  NH: { report: 'annual', due: { month: 4, day: 1 }, confidence: 'unconfirmed' },
  NJ: { report: 'annual', due: 'anniversary', confidence: 'unconfirmed' },
  OK: { report: 'annual', due: 'anniversary', confidence: 'unconfirmed' },
  OR: { report: 'annual', due: 'anniversary', confidence: 'unconfirmed' },
  RI: { report: 'annual', due: { month: 5, day: 1 }, confidence: 'unconfirmed' },
  SD: { report: 'annual', due: 'anniversary', fee_cents: 5500, confidence: 'unconfirmed',
    note: 'South Dakota\u2019s due-date system changes again in 2027.' },
  UT: { report: 'annual', due: 'anniversary', confidence: 'unconfirmed' },
  VA: { report: 'annual', due: 'anniversary', confidence: 'unconfirmed' },
  VT: { report: 'annual', due: { month: 3, day: 31 }, confidence: 'unconfirmed',
    note: 'Vermont also has a minimum entity tax separate from the report.' },
  WA: { report: 'annual', due: 'anniversary', confidence: 'unconfirmed' },
  WI: { report: 'annual', due: 'anniversary', confidence: 'unconfirmed' },
  WV: { report: 'annual', due: { month: 7, day: 1 }, confidence: 'unconfirmed' },
  WY: { report: 'annual', due: 'anniversary', confidence: 'unconfirmed',
    note: 'Wyoming\u2019s fee is based on assets located in the state, with a minimum.' },
};

// Administrative dissolution is the real stake almost everywhere, and it is what makes an unknown
// fee still worth ranking. Used when a state has no consequence of its own written down.
const DEFAULT_CONSEQUENCE =
  'Missing it means late penalties and loss of good standing, and continued non-filing ends in '
  + 'administrative dissolution — which removes the liability protection the company exists for.';

// The national average, used ONLY to say that a number is not known rather than to assert one.
const TYPICAL_LATE_CENTS = 9100;

const SOURCE_URL = 'https://www.sba.gov/business-guide/manage-your-business/stay-legally-compliant';

function stateRule(code, business) {
  const st = STATES[String(code || '').toUpperCase()];
  if (!st) return null;
  const name = String(code).toUpperCase();

  if (st.report === 'none') {
    return { kind: 'note', state: name, confidence: st.confidence,
      title: name + ' does not require an LLC annual report', says: st.note };
  }

  const label = {
    annual: name + ' annual report',
    biennial: name + ' biennial report',
    annual_tax: name + ' annual tax',
    franchise: name + ' franchise tax report',
  }[st.report];

  // An anniversary-based state needs the formation date. Without it, say so rather than inventing a
  // date — a made-up deadline is the whole failure this engine was rebuilt to prevent.
  let due = null; let dueNote = null;
  if (st.due === 'anniversary') {
    if (business && business.formed_on) {
      const f = new Date(business.formed_on);
      due = { month: f.getUTCMonth() + 1, day: f.getUTCDate() };
    } else {
      dueNote = name + ' times this from your formation anniversary, and I do not have that date. '
        + 'Tell me when the company was formed and I will put a real date on it.';
    }
  } else {
    due = st.due;
  }

  const verified = st.confidence === 'verified';
  const main = {
    kind: st.report === 'franchise' || st.report === 'annual_tax' ? 'tax' : 'filing',
    state: name,
    title: label,
    due,
    due_note: dueNote,
    recurs_every: st.report === 'biennial' ? '2 years' : '1 year',
    // Only a verified entry carries a confident number. Everything else ranks on the typical
    // penalty and SAYS that is what it is.
    cost_if_missed_cents: verified ? (st.late_cents ?? st.fee_cents ?? null) : TYPICAL_LATE_CENTS,
    cost_basis: verified ? 'known' : 'estimated',
    cost_note: verified
      ? (st.note || null)
      : 'I have not confirmed ' + name + '\u2019s current figures — fees in several states moved in '
        + '2025 and 2026. This uses a typical late penalty so it ranks sensibly; check the '
        + 'Secretary of State for the real number.'
        + (st.note ? ' ' + st.note : ''),
    consequence: st.consequence || DEFAULT_CONSEQUENCE,
    confidence: st.confidence,
    source_ref: verified
      ? name + ' Secretary of State (checked ' + CHECKED + ')'
      : name + ' Secretary of State — figures unconfirmed, checked ' + CHECKED,
  };

  // Some states levy a second, separate thing that is easier to miss than the report itself.
  if (!st.extra) return main;
  return [main, {
    kind: st.extra.kind,
    state: name,
    title: st.extra.title,
    due: st.extra.due,
    due_note: null,
    recurs_every: st.extra.recurs_every,
    cost_if_missed_cents: st.extra.cost_if_missed_cents,
    cost_basis: st.extra.cost_basis,
    cost_note: st.extra.note || null,
    consequence: st.extra.consequence,
    confidence: st.extra.confidence,
    counterparty: st.extra.counterparty,
    source_ref: (st.extra.counterparty || name) + ' (checked ' + CHECKED + ')',
  }];
}

const ALL_STATES = Object.keys(STATES);
const NO_REPORT_STATES = ALL_STATES.filter((s) => STATES[s].report === 'none');
const VERIFIED_STATES = ALL_STATES.filter((s) => STATES[s].confidence === 'verified');

module.exports = {
  STATES, stateRule, ALL_STATES, NO_REPORT_STATES, VERIFIED_STATES,
  CHECKED, DEFAULT_CONSEQUENCE, TYPICAL_LATE_CENTS, SOURCE_URL,
};
