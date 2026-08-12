'use strict';
// Similarity — pure and testable. Before Clay builds a brand-new idea from scratch, we check the
// Exchange for a listing that's already selling something a lot like it, so a creator can buy
// and enhance instead of starting from zero. This is deliberately simple, deterministic
// token-overlap matching (no external model, no new infra): it catches obvious overlaps well and
// never claims more confidence than that. Generic scaffolding words (business, app, platform…) are
// dropped so ideas match on what they're actually ABOUT (dog-walking, tutoring, ceramics), not on
// the words every idea shares.

const STOP = new Set([
  // common english
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'your', 'you', 'are', 'our', 'has', 'have',
  'will', 'can', 'would', 'could', 'they', 'them', 'their', 'about', 'into', 'more', 'than', 'then',
  'been', 'want', 'wants', 'need', 'needs', 'make', 'makes', 'made', 'help', 'helps', 'people',
  'someone', 'anyone', 'where', 'which', 'what', 'when', 'like', 'just', 'also', 'each', 'other',
  'some', 'any', 'all', 'get', 'gets', 'let', 'lets', 'who', 'why', 'how',
  'not', 'but', 'was', 'out', 'use', 'one', 'its', 'may', 'per', 'off', 'too', 'yet', 'via', 'own',
  // business-generic scaffolding — kept out so ideas match on their subject, not their shape
  'business', 'businesses', 'company', 'companies', 'startup', 'idea', 'ideas', 'concept', 'project',
  'app', 'apps', 'application', 'platform', 'service', 'services', 'online', 'website', 'websites',
  'site', 'sites', 'web', 'product', 'products', 'marketplace', 'market', 'tool', 'tools', 'system',
  'systems', 'based', 'using', 'customers', 'customer', 'users', 'user', 'new', 'small', 'local',
]);

// Extract the meaningful, distinct lowercase tokens from a chunk of text. Words shorter than 3
// characters and stopwords are dropped (so real short subjects like dog, gym, spa, art survive);
// the result is capped so one long prompt can't dominate.
function significantTokens(text, cap = 18) {
  const seen = new Set();
  const out = [];
  String(text == null ? '' : text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .forEach((w) => {
      if (w.length < 3 || STOP.has(w) || seen.has(w)) return;
      seen.add(w);
      out.push(w);
      if (out.length >= cap) return;
    });
  return out.slice(0, cap);
}

// Score one candidate's text against the idea's tokens: how many distinct idea tokens appear.
// score is the fraction of the idea's tokens that show up (0..1); matched is the raw count.
function similarityScore(ideaTokens, candidateText) {
  const text = String(candidateText == null ? '' : candidateText).toLowerCase();
  if (!ideaTokens.length) return { matched: 0, score: 0 };
  let matched = 0;
  ideaTokens.forEach((t) => { if (text.indexOf(t) !== -1) matched += 1; });
  return { matched, score: matched / ideaTokens.length };
}

// Rank listings by similarity to the idea's tokens. Each listing needs a `blob` of its text.
// Returns the sorted matches (score > 0) plus a `strong` flag: true only when the top match is
// genuinely close, which is the bar for stopping to suggest buy-and-enhance rather than building.
function rankBySimilarity(ideaTokens, listings) {
  const scored = (listings || []).map((l) => {
    const s = similarityScore(ideaTokens, l.blob);
    return Object.assign({}, l, { matched: s.matched, score: s.score });
  }).filter((l) => l.matched > 0);
  scored.sort((a, b) => (b.score - a.score) || (b.matched - a.matched));
  const top = scored[0] || null;
  const strong = !!(top && top.score >= 0.5 && top.matched >= 3);
  return { matches: scored, top, strong };
}

module.exports = { significantTokens, similarityScore, rankBySimilarity, STOP };
