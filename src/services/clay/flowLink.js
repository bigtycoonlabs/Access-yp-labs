// PENNY HANDING WORK TO ARBO.
//
// Money is Arbo's, on YP Flow. Penny knows what a customer owes because the business side lives
// here, so she needs a way to pass it over rather than a sentence telling somebody to go and retype
// it. This is that seam, and it holds two rules:
//
//   THE FLOW ACCOUNT HOLDER DECIDES. Connecting sends a confirmation to the address on the Flow
//   account. Penny can ask; only they can agree. A shared secret proves this request came from
//   Labs, which is a different claim from knowing whose money it is.
//
//   NOTHING IS EVER REPORTED AS DONE THAT FLOW DID NOT SAY IT DID. Every answer here is what Flow
//   returned, in Flow's own words where it gave them. An invoice handed over arrives there marked
//   as coming from Penny, so it waits for the person to confirm it on that side before it counts
//   as money. Penny says that plainly rather than implying the books are updated.

const FLOW = () => (process.env.FLOW_URL || 'https://accessypflow.com').replace(/\/+$/, '');
const SECRET = () => process.env.LABS_LINK_SECRET || '';

const NOT_SET_UP = 'The connection to YP Flow is not set up on this server, so I could not try. '
  + 'Nothing changed.';

async function call(path, method, body) {
  if (!SECRET()) return { ok: false, kind: 'unavailable', says: NOT_SET_UP };
  let r;
  try {
    r = await fetch(FLOW() + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-labs-secret': SECRET() },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    return { ok: false, kind: 'unavailable',
      says: 'I could not reach YP Flow, so nothing happened there. ' + e.message };
  }
  let d = {};
  try { d = await r.json(); } catch (_) { d = {}; }
  if (r.status === 401) {
    return { ok: false, kind: 'unavailable',
      says: 'YP Flow did not accept this platform\u2019s credentials, so nothing happened there.' };
  }
  return Object.assign({ ok: !!d.ok, status: d.status || null, http: r.status }, d);
}

// Ask Flow to email the account holder. Their yes is what connects it, not this call.
async function connect(email, labsEmail) {
  const r = await call('/api/labs/link', 'POST', { email, labs_email: labsEmail });
  if (r.says) return r;
  return Object.assign(r, { says: r.ok ? 'YP Flow has been asked to connect those accounts.'
    : 'That did not connect, and nothing was changed on either side.' });
}

async function status(email) {
  const r = await call('/api/labs/link?email=' + encodeURIComponent(email), 'GET');
  if (!r || r.ok === false) return r;
  const said = {
    linked: 'Connected. I can hand invoices to Arbo, and you confirm each one in YP Flow.',
    pending: 'Waiting on the confirmation email sent to that address. Opening that link connects them.',
    not_linked: 'There is a YP Flow account with that address, but it is not connected to this one yet.',
    no_account: 'There is no YP Flow account with that address.',
    revoked: 'That connection was disconnected.',
  }[r.status] || 'I could not tell what state that connection is in.';
  return Object.assign(r, { says: said });
}

async function disconnect(email) {
  return call('/api/labs/link', 'DELETE', { email });
}

// Hand one invoice over. Flow applies its own guards again on arrival; these are here so Penny can
// say what is missing before anybody is told it went.
async function sendInvoice({ email, counterparty, label, amount_usd, due_date }) {
  const amount = Number(amount_usd);
  if (!counterparty) return { ok: false, kind: 'unclear', says: 'Who owes it?' };
  if (!label) return { ok: false, kind: 'unclear', says: 'What is it for?' };
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, kind: 'unclear',
      says: 'How much is it? An invoice needs an amount greater than zero, and I will not send a '
        + 'number I had to guess.' };
  }
  return call('/api/labs/invoice', 'POST', { email, counterparty, label, amount_usd: amount, due_date });
}

module.exports = { connect, status, disconnect, sendInvoice, FLOW };
