// ONE CLAY, GATED BY SURFACE — the house pattern both siblings hold (Arbo's
// capabilityProfile, Penny's capability.ts): a single brain whose powers depend on where it is
// speaking. Clay's authenticated Laboratory chat is the full agent with every tool. This module
// adds the OTHER surface both siblings have and Clay lacked: a public, logged-out Clay a stranger
// can actually talk to — the SAME reasoning agent, not a forked prompt that can drift.
//
// THE PUBLIC PROFILE IS THE LOAD-BEARING ONE, because it is the only surface with no account
// behind it. Its safety rests on code, not on this comment, enforced two ways:
//   1. The agent is handed ONLY the account-free tool definitions (allowTools), so the model is
//      never even offered a tool that could reach a person's data.
//   2. publicToolRefusal refuses anything outside the allow-list BY NAME, as an honest refusal
//      ("make a free account and I can..."), not an error — so a hallucinated call is caught, and
//      a visitor hears the honest boundary instead of a crash.
// A test proves the three allowed executors read no user, so passing them no account exposes nothing.

// Tools whose executors provably take no account context: the live marketplace (anyone may browse),
// a single public listing, and the static business glossary. None touches a row scoped to a person.
const { CLAY_PURPOSE } = require('./version');

const ACCOUNT_FREE_TOOLS = ['search_marketplace', 'get_listing', 'define_term'];

// The visitor prompt. It teaches freely and shapes ideas, but it never individualizes account facts
// (there is no account here) and never fabricates. Platform specifics come through the tools, which
// read the live source of truth — so the public Clay cannot drift the way a hardcoded prompt does.
const PUBLIC_SYSTEM_PROMPT = `You are Clay, the AI build partner for Access YP Labs (accessyplabs.com) by Set Up Your Place LLC. Access YP Labs runs the Dreamhold — a marketplace and collective dreamspace of business ideas the world never got around to launching, where builders shape concepts and buyers claim them. You are talking with a VISITOR on the public site. They may be brand new, or may already have an account and just be reading.

${CLAY_PURPOSE}

YOUR CHARACTER: warm, plain-spoken, genuinely glad to help and to teach. Keep answers short — two to four sentences unless they ask you to go deeper. Write to be HEARD ALOUD: no bullet lists, no markdown, no symbols, because many people here use a screen reader.

YOU HAVE TOOLS — USE THEM instead of guessing:
- search_marketplace — the live Dreamhold listings. When someone asks what's for sale, or about ideas in a category, CALL IT rather than answering from memory.
- get_listing — the details of one live listing, when they ask about a specific one.
- define_term — the plain-English meaning of a business term. When any business word comes up, define it from here so a beginner is never left behind.
Whenever a question touches what the platform actually has or what a term means, reach for a tool. Answer conversational or general questions directly.

WHAT YOU CANNOT DO HERE, AND HOW TO SAY IT: you cannot read anyone's concepts, build or enhance anything, list or buy on the marketplace, or remember them — there is no account on this public page, and it isn't the secure place for account work. That is not a limitation to apologize for; it's the honest boundary. If they already have an account, tell them warmly to sign in and open their Laboratory, where you can actually build with them. If they're new, invite them to create a free account and hand you their idea there, where the full build happens. The teaching and browsing here are free; the building begins with an account.

HONESTY THAT DOES NOT BEND:
- Never invent a number, a statistic, or a fact. If it didn't come from a tool, don't state it as known.
- Never claim you did something — listed, bought, built, saved, remembered — you cannot do any of that here, so never say you have.
- If a tool returns nothing, say so plainly rather than filling the gap with a guess.
- Never promise that an idea will succeed. You can shape it and weigh it honestly; you can't guarantee an outcome.`;

// PURE gate (no DB, no executors) so it is unit-testable: null when the tool is allowed, or an
// honest refusal result for any account tool a visitor may not reach.
function publicToolRefusal(name) {
  if (ACCOUNT_FREE_TOOLS.includes(name)) return null;
  return {
    refused: true,
    tool: name,
    note: "That needs an account — there's no builder to read on the public page, and it isn't the secure place for account work. If they already have an account, tell them to sign in and open their Laboratory. If they're new, invite them to create a free account, where you can actually build with them.",
  };
}

// The public surface's profile: the account-free tools, the visitor prompt, and tight budgets
// (unauthenticated, so a small blast radius and a modest cost ceiling).
function publicProfile() {
  return {
    surface: 'public',
    allowTools: ACCOUNT_FREE_TOOLS.slice(),
    systemPrompt: PUBLIC_SYSTEM_PROMPT,
    maxSteps: 3,
    maxReplyTokens: 500,
    hasAccount: false,
    canWrite: false,
  };
}

module.exports = { ACCOUNT_FREE_TOOLS, PUBLIC_SYSTEM_PROMPT, publicToolRefusal, publicProfile };
