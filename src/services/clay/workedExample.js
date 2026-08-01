// WORKED EXAMPLES — Clay teaches a beginner with a concrete walkthrough, not an abstraction.
//
// A definition tells you what a word means; a worked example shows you the thing happening with
// real numbers, one step at a time. For a blind beginner especially — who can't glance at a chart
// or a table — a spoken, step-by-step example is how an idea actually lands. This is the same move
// Arbo makes ("buy X at $a, sell at $b, net $n" with today's numbers); here it teaches the core
// money concepts a small-business builder keeps hitting.
//
// THE HONESTY LINE THAT DOES NOT BEND: the numbers in an example are ROUND and ILLUSTRATIVE — a
// device to show how the math works, never a claim about the builder's real business. Every example
// carries that label, so a blind builder can never mistake a teaching number for a real projection
// about their money. This is the honesty guard applied to teaching.

const ILLUSTRATIVE_NOTE =
  "These are round example numbers to show how it works — not a measurement of your real business. Swap in your own and the same steps hold.";

// Exhaustive, keyed map of the core money concepts, each a spoken, step-by-step walkthrough.
// Written for the ear: no symbols, no lists, dollars said as words the model can voice naturally.
const EXAMPLES = {
  margin: {
    teaches: 'what you actually keep per sale',
    walkthrough:
      "Say you charge one hundred dollars for a job, and each job costs you sixty dollars once you add up materials and your time. You keep forty dollars. That forty is your margin, and as a share it's forty percent. The point of knowing it is simple: if your margin is thin, one slow month or one refund hurts a lot, so you either raise the price or cut the cost until what you keep can absorb a bad week.",
  },
  pricing_to_target: {
    teaches: 'what to charge to hit an income goal',
    walkthrough:
      "Start from the number you want to take home, say three thousand dollars in a month. Now figure out what you keep on one sale after costs — say fifty dollars. Divide three thousand by fifty and you get sixty. That's sixty sales in the month, about two a day. If two a day feels impossible, that tells you the price is too low or the offer is too small, before you've risked a dollar finding out the hard way.",
  },
  break_even: {
    teaches: 'how many sales until you stop losing money',
    walkthrough:
      "Your fixed costs are the things you pay whether or not you sell — say five hundred dollars a month for a subscription and a phone line. If you keep twenty-five dollars on each sale, divide five hundred by twenty-five: twenty sales. Those first twenty just cover your fixed costs — you're not behind and not ahead. Sale number twenty-one is the first dollar you actually make. That number, twenty, is your break-even, and it's the most honest target to aim at first.",
  },
  cac_ltv: {
    teaches: 'what a customer costs to get versus what they are worth',
    walkthrough:
      "Say you spend twenty dollars on ads to bring in one paying customer — that twenty is your cost to acquire them. Now say that customer, over the whole time they stay with you, spends one hundred and twenty dollars — that's their lifetime value. You made a hundred dollars beyond what it cost to win them. The rule of thumb: you want lifetime value comfortably above acquisition cost — several times over — because if it costs more to get a customer than they ever spend, more customers just means losing money faster.",
  },
  runway: {
    teaches: 'how long your money lasts',
    walkthrough:
      "Say you've set aside six thousand dollars for the business, and each month you spend one thousand dollars more than you bring in while you're getting started. Divide six thousand by one thousand: six. You have six months of runway — six months to reach the point where you're covering your own costs before the money runs out. Knowing that number turns a vague worry into a clear deadline you can actually plan against.",
  },
  market_size: {
    teaches: 'how big the opportunity really is, honestly',
    walkthrough:
      "Be honest in three steps, from the dream down to the doable. Say a hundred thousand people in your area could in theory want this — that's the whole market. But maybe only twenty thousand are the kind you can genuinely reach and serve well — that's your realistic slice. And in a first year, winning five hundred of those would be a real result. The honest version of market size always narrows like that, from the big number down to the one you can actually get — a plan built on the big number alone is how good ideas run out of money.",
  },
};

// Common ways a builder might name each concept, mapped to the key above.
const ALIASES = {
  margin: 'margin', margins: 'margin', 'profit margin': 'margin', 'unit economics': 'margin', markup: 'margin',
  pricing: 'pricing_to_target', price: 'pricing_to_target', 'what to charge': 'pricing_to_target', 'pricing to target': 'pricing_to_target',
  'break even': 'break_even', breakeven: 'break_even', break_even: 'break_even',
  cac: 'cac_ltv', ltv: 'cac_ltv', 'customer acquisition cost': 'cac_ltv', 'lifetime value': 'cac_ltv', 'cac ltv': 'cac_ltv', 'cac vs ltv': 'cac_ltv',
  runway: 'runway', burn: 'runway', 'burn rate': 'runway',
  'market size': 'market_size', tam: 'market_size', sam: 'market_size', som: 'market_size', 'total addressable market': 'market_size', market_size: 'market_size',
};

function normalizeKey(topic) {
  const t = String(topic || '').toLowerCase().trim().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (EXAMPLES[t]) return t;
  if (ALIASES[t]) return ALIASES[t];
  const collapsed = t.replace(/ /g, '_');
  if (EXAMPLES[collapsed]) return collapsed;
  return null;
}

// Return a worked example for a topic, optionally anchored to the builder's real concept by NAME
// only. The name grounds the example in their world; the NUMBERS stay round and illustrative —
// personalization never invents a figure about their actual business.
function workedExample(topic, opts = {}) {
  const key = normalizeKey(topic);
  if (!key) return null;
  const e = EXAMPLES[key];
  const title = opts.conceptTitle ? String(opts.conceptTitle).slice(0, 80) : null;
  const lead = title
    ? `Here's how ${e.teaches} would work for ${title}, with round example numbers.`
    : `Here's ${e.teaches}, with round example numbers.`;
  return {
    topic: key,
    teaches: e.teaches,
    example: `${lead} ${e.walkthrough} ${ILLUSTRATIVE_NOTE}`,
    illustrative: true,
  };
}

function exampleKeys() { return Object.keys(EXAMPLES); }

module.exports = { EXAMPLES, ALIASES, ILLUSTRATIVE_NOTE, normalizeKey, workedExample, exampleKeys };
