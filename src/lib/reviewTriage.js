// WHY A LISTING IS SITTING IN THE REVIEW QUEUE.
//
// 33 listings in review against 13 live. Counts alone cannot say whether that is a staffing
// bottleneck, missing creator materials, or review policy friction — and today nobody can tell,
// because a listing in review says nothing about itself. Staff rediscover the same problem every
// time they open the queue, and the creator waits in silence with nothing to fix.
//
// This computes one status from what the listing actually carries. It is a FIRST READ, not a
// decision: a human still approves or rejects everything, and staff can change the status. The point
// is that the queue arrives sorted into "waiting on us" and "waiting on them", which is the single
// distinction that tells the owner whether 33 is a hiring problem or a materials problem.
//
// Deliberately conservative. Where it is unsure it says ready_for_decision and lets a person look,
// because a wrong "you are missing something" sends a creator off to fix a thing that was never
// wrong, and that is worse than saying nothing.

const STATUSES = [
  'ready_for_decision',
  'missing_baseline',
  'possible_live_business',
  'possible_misrepresentation',
  'needs_risk_disclosure',
];

// What a buyer needs to see before they can judge a listing at all. Not a quality bar — the
// value ladder handles quality by pricing it. This is the floor below which a listing is not
// describing anything.
const BASELINE = ['business_plan'];

// Phrases that promise an outcome. Every one of these is a claim the platform cannot stand behind,
// and the reason the check exists is that a listing carrying one is not a moderation judgement call,
// it is a factual problem with the copy.
const OUTCOME_CLAIMS = [
  /\bguarantee[ds]?\b/i,
  /\bpassive income\b/i,
  /\brisk[- ]free\b/i,
  /\bwill (?:earn|make|generate|profit)\b/i,
  /\b(?:earns?|makes?|generates?)\s*\$[\d,]+/i,
  /\b\$[\d,]+\s*(?:\/|per\s*)(?:mo|month|year|yr|week|day)\b/i,
  /\bturnkey\b/i,          // the vocabulary of business-opportunity enforcement
  /\bautopilot\b/i,
  /\bget rich\b/i,
];

// The SELLING copy. What the listing claims about itself.
//
// Deliberately excludes the risk note, and finding out why cost two false positives on the live
// queue. A risk note's whole job is to name what could go wrong, which means saying things like
// "risk rises if you market this as guaranteed professional outcomes" — and the outcome-claim
// checker flagged that listing for containing the word "guaranteed", in a sentence warning against
// guaranteeing anything.
//
// Scanning a disclosure for the thing it discloses is a category error. Honest risk notes talk about
// dishonesty; that is what makes them honest.
function sellingCopy(concept, listing) {
  const brief = concept && concept.brief && typeof concept.brief === 'object' ? concept.brief : {};
  return [concept && concept.title, listing && listing.summary,
    brief.problem, brief.customer, brief.earning, brief.why_you]
    .filter(Boolean).join(' \n ');
}

// Everything, including the risk note. Used only for the live-business read, where a mention
// anywhere is worth a second look and the cost of a false positive is a gentle question.
function allText(concept, listing) {
  return [sellingCopy(concept, listing), concept && concept.risk_summary].filter(Boolean).join(' \n ');
}

// Returns { status, note }. The note is written for the CREATOR to read, because a queue that
// tells staff what is wrong and leaves the creator guessing has only moved the silence.
function triage({ concept = {}, listing = {}, assetKinds = [] } = {}) {
  const kinds = new Set(assetKinds);
  const text = allText(concept, listing);
  const selling = sellingCopy(concept, listing);

  // A business somebody already runs cannot be listed. The listings route refuses it outright, so
  // this only catches the case where the flag is not set but the words say otherwise — and it says
  // POSSIBLE, because self-declaration is porous and a false accusation here is insulting.
  if (concept.is_operating) {
    return { status: 'possible_live_business',
      note: 'This is marked as a business you already run. The Exchange sells projects that have not '
        + 'launched yet, so this one cannot be listed — but everything else on it still works.' };
  }
  if (/\b(?:my|our) (?:current|existing|running) business\b|\balready (?:trading|operating|running)\b|\bcurrent customers\b/i.test(text)) {
    return { status: 'possible_live_business',
      note: 'Some of the wording here reads like a business that is already trading. If it is, it '
        + 'cannot be listed on the Exchange. If it is not, a quick reword will clear this up.' };
  }

  for (const re of OUTCOME_CLAIMS) {
    const m = selling.match(re);
    if (m) {
      return { status: 'possible_misrepresentation',
        note: 'This says "' + String(m[0]).trim() + '", which promises a buyer an outcome nobody can '
          + 'promise. Say what the project contains and what the research found, and let the buyer '
          + 'draw their own conclusion.' };
    }
  }

  const risk = String(concept.risk_summary || '').trim();
  if (risk.length < 40) {
    return { status: 'needs_risk_disclosure',
      note: 'The risk note is missing or very short. A buyer needs to know honestly what could go '
        + 'wrong here — licensing, competition, whatever is genuinely uncertain. This is the part '
        + 'that makes the rest believable.' };
  }

  const missing = BASELINE.filter((k) => !kinds.has(k));
  if (missing.length) {
    return { status: 'missing_baseline',
      note: 'This listing has no business plan yet, so there is nothing for a buyer to read about '
        + 'what they would be taking on. Ask Clay to build one and it can go straight back in.' };
  }

  return { status: 'ready_for_decision',
    note: 'Nothing is missing. This one is waiting on a person.' };
}

// True when the listing is waiting on US rather than on the creator. This is the number that tells
// the owner whether a queue of 33 is a hiring decision or a materials problem, and it is the reason
// the whole file exists.
function waitingOnStaff(status) {
  return status === 'ready_for_decision';
}

module.exports = { triage, waitingOnStaff, STATUSES, OUTCOME_CLAIMS, BASELINE };
