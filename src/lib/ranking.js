// THE RANKED LIST — the reason this product exists, and it is a SQL query.
//
// Every task manager ranks by priority. Priority is a label the user types, it is a guess, and by
// the second week everything is high. It carries no information.
//
// This ranks by what missing each thing actually costs, which the tool can work out because it
// knows what each thing IS. $25 for an Florida annual report today and eventually the company. $2,400
// for an uninvoiced job. $1,800 of work for a quote nobody answered.
//
// NO MODEL IS CALLED TO PRODUCE IT. That is deliberate three times over: it is arithmetic and
// arithmetic should not be probabilistic; it is the thing a person reads every morning so it has to
// be identical twice; and calling a model for what SQL already answers is how competitors end up
// spending $30 a month per user on inference.
//
// It answers the question an owner is actually asking at 7am, which is not "what are my tasks". It
// is "what happens if I do not get to all of this".

const { query } = require('../config/db');

// How much an overdue thing climbs. A filing that was due last week is worse than one due next week
// even when the fee is identical, because the consequence is compounding behind it.
//
// Capped, because an ancient forgotten item should not permanently outrank a real deadline today —
// that is how a ranked list becomes a list nobody trusts.
const OVERDUE_MULTIPLIER_CAP = 3.0;

// A known cost outranks an estimate of the same size. If two things both say $2,000 and one of them
// is an actual invoice, the invoice is the one to act on.
const ESTIMATE_DISCOUNT = 0.8;
const UNKNOWN_DISCOUNT = 0.4;

// Beyond this horizon it is not today's problem, whatever it costs. Without a horizon a $400 filing
// due in eight months sits above a $200 one due on Friday, which is exactly wrong.
const DEFAULT_HORIZON_DAYS = 45;

// SCORE, in SQL, so it is stable and explainable.
//
// weight = cost × basis confidence × urgency
//
// Urgency is 1.0 at the horizon edge and climbs as the date approaches, then keeps climbing once
// overdue, to the cap. Something with no due date gets a floor rather than a zero, because an
// undated obligation is still owed.
const SCORE_SQL = `
  (
    COALESCE(o.cost_if_missed_cents, 0)
    * CASE o.cost_basis
        WHEN 'known' THEN 1.0
        WHEN 'estimated' THEN ${ESTIMATE_DISCOUNT}
        ELSE ${UNKNOWN_DISCOUNT}
      END
    * CASE
        WHEN o.due_at IS NULL THEN 0.5
        WHEN o.due_at < now() THEN
          LEAST(${OVERDUE_MULTIPLIER_CAP},
                1.0 + (EXTRACT(EPOCH FROM (now() - o.due_at)) / 86400.0) / 14.0)
        ELSE
          GREATEST(0.2,
                   1.0 - (EXTRACT(EPOCH FROM (o.due_at - now())) / 86400.0) / 60.0)
      END
  )`;

// WHICH PERMISSION AREA EACH KIND OF OBLIGATION BELONGS TO.
//
// Found by running the list as a bookkeeper who had money:view and nothing else: she saw five items
// including the Florida annual report and the city licence renewal. The query filtered by which
// BUSINESSES she could reach and then showed her everything in them.
//
// That is the same defect as a screen that hides a number while the assistant reads it out — the
// permission existed, and the query that produces the thing people actually read did not use it.
//
// A person must hold at least 'view' on the mapped area for a row to appear at all.
const KIND_AREA = {
  filing: 'compliance', licence: 'compliance', permit: 'compliance',
  registration: 'compliance', insurance: 'compliance', tax: 'compliance',
  renewal: 'compliance',
  invoice_out: 'money', invoice_in: 'money',
  promise: 'customers',
  task: 'projects', meeting: 'projects', other: 'projects',
};

// SQL form of the same map, plus the check itself. The owner short-circuits: they own it, so they
// are not a row in permissions and must never be filtered by one.
const VISIBLE_SQL = `
  (
    b.owner_id = $1
    OR EXISTS (
      SELECT 1 FROM relationships r
        JOIN permissions p ON p.relationship_id = r.id
       WHERE r.business_id = b.id AND r.user_id = $1 AND r.ended_on IS NULL
         AND p.level <> 'none'
         AND p.area = CASE o.kind
              WHEN 'filing' THEN 'compliance' WHEN 'licence' THEN 'compliance'
              WHEN 'permit' THEN 'compliance' WHEN 'registration' THEN 'compliance'
              WHEN 'insurance' THEN 'compliance' WHEN 'tax' THEN 'compliance'
              WHEN 'renewal' THEN 'compliance'
              WHEN 'invoice_out' THEN 'money' WHEN 'invoice_in' THEN 'money'
              WHEN 'promise' THEN 'customers'
              ELSE 'projects' END
    )
  )`;

// Today: what is owed now, across every business this person can reach, ordered by what missing it
// costs. Cross-business by default, because an owner's morning is not divided by entity.
async function rankedToday(userId, { businessIds = null, horizonDays = DEFAULT_HORIZON_DAYS, limit = 40 } = {}) {
  const r = await query(
    `SELECT o.id, o.business_id, b.name AS business_name, o.kind, o.title, o.detail,
            o.counterparty, o.counterparty_kind, o.due_at,
            o.cost_if_missed_cents, o.cost_basis, o.cost_note, o.consequence,
            o.source, o.source_at, o.assigned_to,
            ${SCORE_SQL} AS score,
            (o.due_at IS NOT NULL AND o.due_at < now()) AS overdue
       FROM obligations o
       JOIN businesses b ON b.id = o.business_id
      WHERE o.status = 'open'
        AND b.archived_at IS NULL
        AND ${VISIBLE_SQL}
        AND ($2::uuid[] IS NULL OR o.business_id = ANY($2))
        AND (o.due_at IS NULL OR o.due_at < now() + ($3 || ' days')::interval)
      ORDER BY score DESC, o.due_at ASC NULLS LAST
      LIMIT $4`,
    [userId, businessIds, String(horizonDays), limit]);
  return r.rows;
}

// The next thirty days, so nothing arrives as a surprise. Ordered by date rather than cost, because
// this is a calendar question rather than a triage one.
async function coming(userId, { days = 30, businessIds = null, limit = 40 } = {}) {
  const r = await query(
    `SELECT o.id, o.business_id, b.name AS business_name, o.kind, o.title,
            o.due_at, o.cost_if_missed_cents, o.cost_basis, o.consequence
       FROM obligations o
       JOIN businesses b ON b.id = o.business_id
      WHERE o.status = 'open' AND b.archived_at IS NULL
        AND o.due_at IS NOT NULL
        AND o.due_at >= now()
        AND o.due_at < now() + ($2 || ' days')::interval
        AND ${VISIBLE_SQL}
        AND ($3::uuid[] IS NULL OR o.business_id = ANY($3))
      ORDER BY o.due_at ASC
      LIMIT $4`,
    [userId, String(days), businessIds, limit]);
  return r.rows;
}

const money = (cents) => {
  if (cents == null) return null;
  const d = cents / 100;
  return '$' + (d % 1 === 0 ? d.toLocaleString('en-US') : d.toFixed(2));
};

// WHY THIS IS WHERE IT IS, in a sentence a person can check.
//
// A ranking nobody can explain is a ranking nobody should trust, and the whole argument for this
// list over a priority field is that the ordering is arithmetic rather than opinion. So every row
// can say what put it there — including when the honest answer is that we do not know the cost.
function explain(row) {
  const parts = [];
  const amount = money(row.cost_if_missed_cents);

  // "roughly" already says it is an estimate. The earlier version appended ", estimated" as well and
  // produced "costs roughly $1,800, estimated and it was due 3 days ago", which stumbles when read
  // aloud — and this line is read aloud every morning.
  if (amount && row.cost_basis === 'known') parts.push('Missing it costs ' + amount);
  else if (amount) parts.push('Missing it costs roughly ' + amount);
  else parts.push('I do not know what missing it costs yet');

  if (row.overdue) {
    const days = Math.floor((Date.now() - new Date(row.due_at)) / 86400000);
    parts.push(days <= 0 ? 'and it was due today'
      : 'and it was due ' + days + ' day' + (days === 1 ? '' : 's') + ' ago');
  } else if (row.due_at) {
    const days = Math.ceil((new Date(row.due_at) - Date.now()) / 86400000);
    parts.push(days <= 0 ? 'and it is due today'
      : 'and it is due in ' + days + ' day' + (days === 1 ? '' : 's'));
  } else {
    parts.push('and it has no date on it');
  }

  let s = parts.join(' ') + '.';
  // The consequence often already ends in a full stop, and appending another produced
  // "...on the fourth Friday.." — which a screen reader reads as a stumble and a sighted reader
  // reads as sloppiness. Add one only if it is missing.
  if (row.consequence) {
    const c = row.consequence.trim();
    s += ' ' + c + (/[.!?]$/.test(c) ? '' : '.');
  }
  return s;
}

// The line at the top of the morning. Says what is true, including when nothing is.
//
// "Nothing is due" has to be a real answer. A list that always finds something urgent is a list
// people stop reading, and the days it says nothing are what make the other days worth reading.
function summarise(rows) {
  if (!rows.length) return 'Nothing is due. Nothing overdue either.';
  const overdue = rows.filter((r) => r.overdue).length;
  const top = rows[0];
  const amount = money(top.cost_if_missed_cents);

  let s = rows.length === 1 ? 'One thing needs you' : rows.length + ' things need you';
  // "One thing needs you, 1 of them overdue" — wrong for a single item, and this line is spoken.
  if (overdue && rows.length === 1) s += ', and it is overdue';
  else if (overdue === rows.length) s += ', all of them overdue';
  else if (overdue) s += ', ' + overdue + ' of them overdue';
  // THE TOP OF THIS LIST IS WHAT TO DO FIRST, NOT NECESSARILY WHAT COSTS MOST. Rows are ranked by
  // urgency and cost together, so a $25 thing with no date can sit above a $60 thing due next week.
  // This used to say "the one that costs most is" the top row, which was false whenever urgency won,
  // and it contradicted the Businesses screen, which really does name the costliest. So: say what
  // the ranking means, and name the costliest separately only when it is a different item.
  s += '. Start with ' + top.title;
  if (amount) {
    s += ', which costs ' + amount + (top.cost_basis === 'estimated' ? ', roughly,' : '')
      + ' if missed';
  }
  s += '.';
  const priced = rows.filter((r) => r.cost_if_missed_cents != null);
  const dearest = priced.reduce((a, r) =>
    (!a || Number(r.cost_if_missed_cents) > Number(a.cost_if_missed_cents) ? r : a), null);
  if (dearest && dearest !== top
      && Number(dearest.cost_if_missed_cents) > Number(top.cost_if_missed_cents || 0)) {
    s += ' The costliest is ' + dearest.title + ' at ' + money(dearest.cost_if_missed_cents)
      + (dearest.cost_basis === 'estimated' ? ', roughly' : '') + '.';
  }
  return s;
}

module.exports = {
  rankedToday, coming, explain, summarise, money, KIND_AREA, VISIBLE_SQL,
  SCORE_SQL, OVERDUE_MULTIPLIER_CAP, ESTIMATE_DISCOUNT, UNKNOWN_DISCOUNT, DEFAULT_HORIZON_DAYS,
};
