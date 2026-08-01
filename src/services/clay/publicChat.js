// THE PUBLIC BRAIN. A logged-out visitor talks to the SAME reasoning agent an account holder
// does — not a forked prompt — but through the public capability profile: only the account-free
// tools, the visitor system prompt, and tight budgets. This is the surface parity both siblings
// (Arbo, Penny) already have and Clay lacked.
//
// SAFE BY CONSTRUCTION: the executors below close over NO user. They read only the live
// marketplace and the static glossary — never a row scoped to a person. So even if a model
// hallucinated an account tool, there is no account in scope to reach; and the profile's
// allowTools means the model is only ever offered these three in the first place.

const { query } = require('../../config/db');
const glossary = require('./glossary');
const describe = require('../../lib/describe');
const agent = require('./agent');
const pacing = require('./pacing');
const { publicProfile } = require('./capabilityProfile');

// The account-free executors — identical reads to the authenticated ones, but taking no user.
function buildPublicExecutors() {
  return {
    search_marketplace: async ({ query: q, category }) => {
      const clauses = ["l.status='live'"]; const args = [];
      if (category) { args.push(category); clauses.push(`c.category=$${args.length}`); }
      if (q) { args.push('%' + q + '%'); clauses.push(`(c.title ILIKE $${args.length} OR c.risk_summary ILIKE $${args.length})`); }
      const r = await query(
        `SELECT l.id, c.title, c.category, l.format, l.price_cents, l.starting_bid_cents
         FROM listings l JOIN concepts c ON c.id=l.concept_id
         WHERE ${clauses.join(' AND ')} ORDER BY l.created_at DESC LIMIT 25`, args);
      return { listings: r.rows };
    },
    get_listing: async ({ listing_id }) => {
      const r = await query(
        `SELECT l.id, l.format, l.price_cents, l.starting_bid_cents, c.title, c.category, c.risk_summary
         FROM listings l JOIN concepts c ON c.id=l.concept_id WHERE l.id=$1 AND l.status='live'`, [listing_id]);
      if (!r.rows.length) return { error: 'Listing not found.' };
      const d = await query(
        `SELECT body FROM assets WHERE concept_id=(SELECT concept_id FROM listings WHERE id=$1)
         AND is_current=true AND type IN ('html_demo','built_site') ORDER BY created_at DESC LIMIT 1`, [listing_id]);
      const demo = d.rows.length ? describe.outline(d.rows[0].body) : null;
      return { listing: r.rows[0], demo_description: demo ? { items: demo.items, accessibility: demo.a11y.summary } : null };
    },
    define_term: async ({ term }) => {
      const e = glossary.defineTerm(term);
      return e
        ? { found: true, term: e.term, definition: e.definition }
        : { found: false, term, note: "Not in Clay's business glossary — explain it in plain words as general knowledge, not as an authoritative definition." };
    },
  };
}

// Run the real agent for an anonymous visitor under the public profile. Returns the agent result
// plus paced bubbles for the ear. Never throws for a provider outage — the agent reports that
// honestly rather than fabricating.
async function runPublicChat({ messages }) {
  const profile = publicProfile();
  const out = await agent.runChat({
    messages,
    executors: buildPublicExecutors(),
    maxSteps: profile.maxSteps,
    systemOverride: profile.systemPrompt,
    allowTools: profile.allowTools,
  });
  out.bubbles = pacing.bubblesFor(out.reply || '', { serious: out.status !== 'answered' });
  return out;
}

module.exports = { buildPublicExecutors, runPublicChat };
