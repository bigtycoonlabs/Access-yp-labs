// CUSTOMERS, WHICH IS NOT A CRM.
//
// A CRM is a place to put people so you can look at how many you have. Almost no small business
// needs that, and the ones that buy it stop updating it inside a month because keeping it current is
// work that pays nobody.
//
// What actually costs money is narrower and sharper: WHAT DID I PROMISE THIS PERSON, AND WHAT DO
// THEY OWE ME. Both of those are already obligations — a promise with a counterparty, a date and a
// consequence — so this is a view over the spine rather than a second database of people.
//
// THE CONSEQUENCE OF THAT CHOICE: there is nothing to keep up to date. A customer appears here
// because you owe them something or they owe you, and leaves when neither is true. Nobody ever has
// to remember to file them.
//
// THE ONE THING IT WILL NOT DO is rank customers by value. That is the feature every CRM has and it
// is the wrong instinct for a business this size: the customer who owes you $400 and the one you
// promised a callback are not comparable on one axis, and sorting people by what they are worth is
// how the callback never happens.

const { query } = require('../../config/db');
const R = require('../../lib/ranking');

// What the business owes the customer, versus what the customer owes the business. Kept apart on
// purpose — netting them into one number hides a late invoice behind a promise you have kept.
const OWED_TO_THEM = ['promise', 'task', 'meeting'];
const OWED_TO_US = ['invoice_out'];

async function forBusiness(businessId, { includeSettled = false } = {}) {
  let rows;
  try {
    rows = (await query(
      `SELECT o.*, r.id AS relationship_id, r.display_name, r.email, r.phone
         FROM obligations o
         LEFT JOIN relationships r
           ON r.business_id = o.business_id
          AND r.kind = 'customer'
          AND lower(r.display_name) = lower(o.counterparty)
          AND r.ended_on IS NULL
        WHERE o.business_id = $1
          AND o.counterparty_kind = 'customer'
          AND o.counterparty IS NOT NULL
          ${includeSettled ? '' : "AND o.status = 'open'"}
        ORDER BY o.due_at ASC NULLS LAST`,
      [businessId])).rows;
  } catch (e) {
    // A failed read is not a business with no customers.
    return { ok: false, reason: e.message };
  }

  const byName = new Map();
  for (const o of rows) {
    const key = o.counterparty.trim().toLowerCase();
    if (!byName.has(key)) {
      byName.set(key, {
        name: o.counterparty.trim(),
        relationship_id: o.relationship_id || null,
        email: o.email || null,
        phone: o.phone || null,
        // Named plainly, because "a contact record exists" and "we know how to reach them" are
        // different things and only one of them is useful when something is overdue.
        reachable: !!(o.email || o.phone),
        you_owe_them: [],
        they_owe_you: [],
        owed_cents: 0,
        overdue_count: 0,
      });
    }
    const c = byName.get(key);
    const overdue = o.due_at && new Date(o.due_at) < Date.now() && o.status === 'open';
    if (overdue) c.overdue_count += 1;
    const entry = {
      id: o.id, title: o.title, due_at: o.due_at, status: o.status, overdue,
      says: R.explain(Object.assign({}, o, { overdue })),
    };
    if (OWED_TO_US.includes(o.kind)) {
      c.they_owe_you.push(entry);
      if (o.status === 'open' && o.cost_if_missed_cents) {
        c.owed_cents += Number(o.cost_if_missed_cents);
      }
    } else if (OWED_TO_THEM.includes(o.kind)) {
      c.you_owe_them.push(entry);
    }
  }

  const customers = [...byName.values()];

  // Ordered by what is LATE, not by what they are worth. A promise you are three weeks late on costs
  // you the customer; an invoice they are three weeks late on costs you the money. Both are late,
  // and lateness is the thing worth surfacing.
  customers.sort((a, b) => (b.overdue_count - a.overdue_count) || (b.owed_cents - a.owed_cents));

  return { ok: true, customers, says: summarise(customers) };
}

function summarise(customers) {
  if (!customers.length) {
    return 'Nothing outstanding with any customer. People appear here when you owe them something '
      + 'or they owe you, so an empty list means there is nothing to chase either way.';
  }
  const late = customers.filter((c) => c.overdue_count > 0);
  const owed = customers.reduce((n, c) => n + c.owed_cents, 0);
  const parts = [];
  if (late.length) {
    parts.push(late.length === 1
      ? 'One customer has something late: ' + late[0].name
      : late.length + ' customers have something late');
  }
  // COUNT THE ONES WHO ACTUALLY OWE. The first version said "$3,260 owed across 3 customers" while
  // one of the three owed nothing and was listed only for a promise. A number attached to the wrong
  // denominator is how somebody works out an average that is quietly false.
  const owing = customers.filter((c) => c.owed_cents > 0).length;
  if (owed) parts.push(R.money(owed) + ' is owed to you across ' + owing
    + (owing === 1 ? ' customer' : ' customers'));
  if (!parts.length) {
    return customers.length + (customers.length === 1 ? ' customer' : ' customers')
      + ' with something outstanding, none of it late.';
  }
  const s = parts.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

module.exports = { forBusiness, summarise, OWED_TO_THEM, OWED_TO_US };
