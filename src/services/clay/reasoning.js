// REASONING TRANSPARENCY — Clay shows his thinking before a recommendation.
//
// A blind builder acts on what Clay says without being able to scan a screen and sanity-check
// it against everything else. So when Clay recommends something, makes a judgment call, or
// picks between options, he should say WHY first — the two or three factors that drive it, in
// plain words, and the main trade-off — then the recommendation. That way the builder can
// weigh the logic and push back BEFORE acting, instead of taking a verdict on faith.
//
// This module is the single source of that guidance for the system prompt, plus pure detectors
// the agent uses as a light nudge: if a reply clearly recommends something but exposes no
// reasoning at all, Clay gets ONE chance to add the "why". Reasoning is never fabricated on his
// behalf — if the nudge doesn't produce genuine reasoning, the original reply stands unchanged.

const RECOMMENDS = /\b(i'?d recommend|i recommend|i suggest|i'?d suggest|my (recommendation|suggestion|advice)|you should|the best (option|move|bet|choice|approach)|your best bet|i'?d (go with|pick|choose|lean|start with)|go with|lean(ing)? toward|the move here is|i'?d prioriti[sz]e|the smarter play|i'?d price it|i'?d set it)\b/i;

const HAS_REASONING = /\b(here'?s my thinking|here'?s why|here is why|the reason|reasons?( are| is|:)|because|since|that'?s (driven|because)|given (that|your|the)|the (trade[- ]?off|tradeoff)|weigh(ed|ing)?|comes down to|the thinking is|what tips it|i'?m weighing|on balance|the upside|the risk (here )?is|two things|a few things|it lets you|so that|to keep|that way)\b/i;

function looksLikeRecommendation(text) {
  return RECOMMENDS.test(String(text || ''));
}

function hasVisibleReasoning(text) {
  return HAS_REASONING.test(String(text || ''));
}

// True when a reply hands down a recommendation or verdict with no reasoning exposed at all —
// the case where a blind builder is asked to act on a bare conclusion.
function recommendsWithoutReasoning(text) {
  const t = String(text || '');
  return looksLikeRecommendation(t) && !hasVisibleReasoning(t);
}

// The one nudge, fed back to the model to add the "why" — never to fabricate certainty.
const NUDGE =
  "You gave the builder a recommendation or a verdict without showing your reasoning. They are blind and will act on your word, so FIRST say why in plain, short terms — the two or three factors that drive it, and the main trade-off — THEN give the recommendation clearly. Don't pad it; a couple of honest sentences is enough, and never claim a certainty you don't have. Add no claim about anything being done.";

// Single source for the system-prompt guidance.
const GUIDANCE =
  "When you recommend something, make a judgment call, or choose between options, show your thinking FIRST: name the two or three factors that drive it, in plain words, and the main trade-off — then give the recommendation clearly. The builder is blind and acts on your word, so let them weigh your logic and push back before they act, rather than taking a verdict on faith. Keep the reasoning short and for the ear, and never pretend to a certainty you don't have.";

module.exports = { looksLikeRecommendation, hasVisibleReasoning, recommendsWithoutReasoning, NUDGE, GUIDANCE };
