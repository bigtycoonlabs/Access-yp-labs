// THE FALSE-ACTION-CLAIM GUARD — ported from Arbo's actionClaimGuard, adapted to Clay.
//
// Clay can write "I've listed your concept on the marketplace" or "I've emailed it to
// you — check your inbox" without any tool having done it. To a BLIND builder who cannot
// see that nothing changed, the concept simply is not listed and the email never came,
// and they never know. So a reply that claims a stateful action was COMPLETED is only
// true if a tool actually did it this turn.
//
// For Clay this is even sharper than for Arbo: in chat, listing and buying ALWAYS hand
// off to the vetted review-and-publish / checkout screens (they never complete inside a
// chat turn), and email is not a chat action at all. So a completion claim about any of
// them in a chat reply is provably false. Removal only happens via an explicit confirm.
//
// Kept tight on purpose: it matches COMPLETION language ("I've listed it", "it's in your
// inbox"), never a truthful STATUS READOUT ("your concept is a draft"), never an OFFER or
// a FUTURE ("I can list it for you", "want me to email it?").

const CLASSES = ['listed', 'purchased', 'removed', 'emailed'];

// Phrases that make a sentence an offer or a future intention rather than a completion —
// if present, we do not treat a nearby verb as something already done.
const OFFER_OR_FUTURE =
  /\b(want me to|would you like|shall i|i can|i could|i'?ll|i will|do you want|ready to|to (list|sell|buy|purchase|remove|email)|if you(?:'?d)? (want|like)|just say|let me know|once you|when you|after you)\b/;

function claimedCompletedActions(text) {
  const t = (text || '').toLowerCase();
  const out = [];

  // LISTED on the marketplace / Dream Market
  const listed =
    /\b(i'?ve|i have|i just|i'?ve gone ahead and)\b[^.!?]{0,45}\b(listed|posted|published|put it up|put your (concept|idea) up)\b[^.!?]{0,30}\b(marketplace|for sale|dreamhold|dream market|listing)\b/.test(t) ||
    /\byour (concept|idea|listing)\b[^.!?]{0,20}\b(is|are)\b[^.!?]{0,8}\b(now )?(live|listed|posted|published|up)\b[^.!?]{0,18}\b(marketplace|for sale|dreamhold|dream market)\b/.test(t) ||
    /\bit'?s (now )?(live|listed|up|published) (on the )?(marketplace|for sale|dreamhold|dream market)\b/.test(t);
  if (listed) out.push('listed');

  // PURCHASED / unlocked / kept
  const purchased =
    /\b(i'?ve|i have|i just)\b[^.!?]{0,45}\b(bought|purchased|unlocked|acquired|checked out)\b[^.!?]{0,25}\b(it|the concept|the idea|the listing|this|it for you)\b/.test(t) ||
    /\b(the )?(purchase|checkout|payment|order)\b[^.!?]{0,12}\b(is|has been)\b[^.!?]{0,8}\b(complete|completed|done|processed|successful|gone through)\b/.test(t) ||
    /\byou (now )?own (it|the concept|this)\b/.test(t);
  if (purchased) out.push('purchased');

  // REMOVED / unlisted / deleted
  const removed =
    /\b(i'?ve|i have|i just)\b[^.!?]{0,45}\b(removed|unlisted|deleted|taken it down|pulled it down|taken it off)\b/.test(t) ||
    /\bit'?s (been )?(removed|unlisted|deleted|taken down|taken off the marketplace)\b/.test(t);
  if (removed) out.push('removed');

  // EMAILED / sent to inbox — the exact false claim to avoid (Clay cannot send mail from chat)
  const emailed =
    /\b(i'?ve|i have|i just)\b[^.!?]{0,45}\b(emailed|sent)\b[^.!?]{0,32}\b(to (you|your inbox|your email)|your way|over to you|it to you|to your inbox)\b/.test(t) ||
    /\b(check|it'?s in|it is in|you'?ll find it in) your (inbox|email)\b/.test(t) ||
    /\bi'?ve (just )?(dropped|popped|put) [^.!?]{0,20}in your inbox\b/.test(t);
  if (emailed) out.push('emailed');

  // An offer/future framing anywhere in the sentence means nothing was claimed as done.
  if (out.length && OFFER_OR_FUTURE.test(t)) return [];
  return out;
}

// Which class a successfully-run tool actually backs. Email has no chat tool, so an
// "emailed" claim can never be backed here — which is the point.
function actionClassForTool(tool) {
  if (tool === 'list_on_marketplace') return 'listed';
  if (tool === 'purchase_concept') return 'purchased';
  if (tool === 'remove_concept') return 'removed';
  return null;
}

const META = {
  listed: {
    correction: "you told the builder their concept is listed on the marketplace, but nothing listed it this turn — in chat, listing always opens the review-and-publish screen for the builder to post themselves, so you cannot have listed it",
    fallback: "To be straight with you: I haven't actually listed it — in chat I can't publish a listing. I open the review-and-publish screen and you post it. Want me to open that now?",
  },
  purchased: {
    correction: "you told the builder a purchase is complete, but nothing bought anything this turn — buying always opens the listing's checkout for the buyer to complete",
    fallback: "To be accurate: I haven't bought anything — purchases go through the listing's checkout, which you complete yourself. Want me to open it?",
  },
  removed: {
    correction: "you told the builder the concept is removed, but no removal ran this turn (removal takes an explicit confirm)",
    fallback: "To be accurate: I haven't removed anything this turn. Tell me to remove it and confirm, and it's gone.",
  },
  emailed: {
    correction: "you told the builder you emailed them or that it's in their inbox, but Clay cannot send email from chat and nothing was sent this turn — telling a blind builder to 'check your inbox' when nothing was sent is exactly the false claim never to make",
    fallback: "To be honest: I haven't emailed anything — I can't send mail from here. Your materials are on your concept screen to download whenever you want.",
  },
};

function auditUnbackedClaims(text, backing) {
  const backed = (backing && backing.backedActions) || new Set();
  const issues = [];
  for (const a of claimedCompletedActions(text)) {
    if (!backed.has(a)) issues.push({ kind: a, correction: META[a].correction, fallback: META[a].fallback });
  }
  return issues;
}

function buildCorrection(issues) {
  return (
    'STOP — you just told the builder something no tool did this turn: ' +
    issues.map((i) => i.correction).join('; ') +
    '. For each one, do ONE of exactly two things: actually take the step by opening the right flow, or rewrite your reply so it makes no such claim — offer it and let them decide. Never tell a builder something was done for them unless a tool truly did it this turn. They are blind and cannot see that nothing changed.'
  );
}

// Deterministic honest fallback appended when a rewrite still leaves a false claim, so the
// builder always receives the correction even if the model won't rephrase.
function appendFallbacks(text, issues) {
  const adds = issues.map((i) => i.fallback);
  return (text ? String(text).trim() + '\n\n' : '') + adds.join(' ');
}

module.exports = {
  CLASSES,
  claimedCompletedActions,
  actionClassForTool,
  auditUnbackedClaims,
  buildCorrection,
  appendFallbacks,
};
