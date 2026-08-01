// THE SINGLE SOURCE OF TRUTH FOR CLAY'S VERSION.
//
// Ported from Arbo, which learned this the hard way: six surfaces each hardcoded
// their own version string, drifted apart, and a client could read one number on a
// badge and hear a different one from the AI in the same breath. A version string is
// invisible to types and to most tests, so it goes stale silently. Every surface —
// the homepage badge and Clay's own self-description — now reads from HERE, so a
// release is this ONE line and nothing can fall behind.
//
// History (why the number is what it is):
//   4.4 → 4.5  Clay gained real web research (OpenAI web_search), an honest systems
//              self-check (brain/research/email/payments), and the false-action-claim
//              guard ported from Arbo — he will not tell a blind builder something was
//              done (listed, bought, emailed) unless a tool truly did it that turn.
const CLAY_VERSION = '4.5';
const CLAY_VERSION_LABEL = `Clay ${CLAY_VERSION}`;

module.exports = { CLAY_VERSION, CLAY_VERSION_LABEL };
