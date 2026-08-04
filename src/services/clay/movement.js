// Single source of truth for the per-concept movement board. Three honest lanes, in order.
// A concept advances only on real behavior — proof — never on how finished it reads. This
// mirrors Clay's proof discipline (4.8): no named buyer means customer clarity; a clear buyer
// with no evidence means proof; both means it's ready to package.
const LANES = ['needs_customer_clarity', 'needs_proof', 'ready_to_package'];

const DETAIL = {
  needs_customer_clarity: {
    label: 'Needs customer clarity',
    meaning: 'You haven’t pinned down exactly who the customer is yet.',
    moves: 'Name one specific person or group who has this problem badly enough to pay for a fix. When you can say who, it moves to Needs proof.',
  },
  needs_proof: {
    label: 'Needs proof',
    meaning: 'You know who the customer is, but nothing yet proves they’ll actually pay.',
    moves: 'Get one real proof action — a booked paid call, a preorder, a deposit, a landing page that converts. A stranger acting, not a compliment. When you have it, it moves to Ready to package.',
  },
  ready_to_package: {
    label: 'Ready to package',
    meaning: 'You have a clear customer and real evidence they’ll pay.',
    moves: 'It’s ready to package and list in the Dream Market.',
  },
};

const DEFAULT_LANE = 'needs_customer_clarity';

function isLane(s) { return LANES.indexOf(s) !== -1; }
function describe(s) { return DETAIL[s] || DETAIL[DEFAULT_LANE]; }
function label(s) { return describe(s).label; }

module.exports = { LANES, DETAIL, DEFAULT_LANE, isLane, describe, label };
