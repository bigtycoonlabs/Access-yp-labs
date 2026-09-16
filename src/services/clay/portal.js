// THE CUSTOMER PORTAL.
//
// Two sides. The owner (and Penny, with the owner's permissions) sets it up under the customers
// area. A customer signs in with an emailed link and sees only rows that carry their own id.
//
// Money is Arbo's. The portal shows what is open between a business and a customer as items with
// dates, never balances or payments; those belong to YP Flow.

const crypto = require('crypto');
const { query } = require('../../config/db');
const P = require('../../lib/permissions');
const C = require('./portalConfig');
const Domains = require('./domains');
const { sendEmail } = require('../email');

const LINK_MINUTES = 30;
const SESSION_DAYS = 30;
const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const token = () => crypto.randomBytes(32).toString('hex');
const refuse = (gate) => ({ ok: false, kind: 'refused',
  says: P.refusalLine(gate, 'customers', gate.perms && gate.perms.business.name) });

function site() { return (process.env.CLIENT_URL || 'https://accessyplabs.com').replace(/\/+$/, ''); }
function fromFor(name) {
  const n = String(name || 'Your business').replace(/["<>\r\n]/g, '').slice(0, 60);
  return '"' + n + ' via Access YP Labs" <penny@accessyplabs.com>';
}

// ------------------------------------------------------------------ owner side

async function load(business_id) {
  const b = (await query('SELECT id, name FROM businesses WHERE id=$1', [business_id])).rows[0];
  if (!b) return null;
  let p = (await query('SELECT * FROM portals WHERE business_id=$1', [business_id])).rows[0];
  if (!p) {
    p = (await query(
      `INSERT INTO portals (business_id, config) VALUES ($1,$2)
       ON CONFLICT (business_id) DO UPDATE SET business_id=EXCLUDED.business_id RETURNING *`,
      [business_id, JSON.stringify(C.defaults(b.name))])).rows[0];
  }
  const config = C.normalise(p.config, C.defaults(b.name)).config;
  return Object.assign(p, { config, business_name: b.name,
    url: p.slug ? site() + '/p/' + p.slug : null });
}

function summary(p) {
  return C.describe(p.config) + (p.is_open ? ' It is open at ' + p.url + '.'
    : p.slug ? ' It is closed, so customers cannot sign in.' : ' It has no address yet, so nobody can reach it.');
}

async function get(viewer, business_id) {
  const gate = await P.can(viewer.id, business_id, 'customers', 'view');
  if (!gate.ok) return refuse(gate);
  try {
    const p = await load(business_id);
    if (!p) return { ok: false, kind: 'unavailable', says: 'I cannot find that business.' };
    return { ok: true, portal: p, sections: C.SECTIONS, accents: C.ACCENTS, field_kinds: C.FIELD_KINDS,
      limits: C.LIMITS, says: summary(p), embed: embedSnippet(p) };
  } catch (e) {
    return { ok: false, kind: 'unavailable', says: 'I could not read your portal just now. ' + e.message };
  }
}

function embedSnippet(p) {
  if (!p.slug) return null;
  const color = C.ACCENTS[p.config.accent] || C.ACCENTS.violet;
  return '<a href="' + site() + '/p/' + p.slug + '" style="display:inline-block;min-height:44px;'
    + 'line-height:44px;padding:0 20px;border-radius:10px;background:' + color + ';color:#fff;'
    + 'font:600 16px/44px system-ui,sans-serif;text-decoration:none">Customer sign in</a>';
}

// Change the portal. `changes` uses the same shape as the config; `asked_for`, when Penny passes the
// person's words, is checked for things only a custom web application can do.
async function customise(viewer, business_id, { changes, asked_for }) {
  const gate = await P.can(viewer.id, business_id, 'customers', 'act');
  if (!gate.ok) return refuse(gate);
  const past = asked_for ? C.beyond(asked_for) : { beyond: false };
  const p = await load(business_id);
  if (!p) return { ok: false, kind: 'unavailable', says: 'I cannot find that business.' };
  const { config, ignored } = C.normalise(changes || {}, p.config);
  try {
    await query('UPDATE portals SET config=$2, updated_at=now() WHERE id=$1', [p.id, JSON.stringify(config)]);
  } catch (e) {
    return { ok: false, kind: 'unavailable', says: 'I could not save that, so the portal is unchanged. ' + e.message };
  }
  let says = 'Saved. ' + C.describe(config);
  if (ignored.length) says += ' I could not apply: ' + ignored.join('; ') + '.';
  if (past.beyond) says += ' ' + past.says;
  return { ok: true, config, ignored, beyond: past.beyond, says };
}

async function setOpen(viewer, business_id, { open, address }) {
  const gate = await P.can(viewer.id, business_id, 'customers', 'manage');
  if (!gate.ok) return refuse(gate);
  const p = await load(business_id);
  let slug = p.slug;
  if (address !== undefined && address !== null && address !== '') {
    slug = Domains.normalizeLabel(address);
    if (!Domains.validLabel(slug)) {
      return { ok: false, kind: 'unclear', says: 'Choose an address of letters, numbers and dashes, such as rivera-landscaping.' };
    }
  }
  if (open && !slug) return { ok: false, kind: 'unclear', says: 'Choose an address for the portal first.' };
  try {
    await query('UPDATE portals SET slug=$2, is_open=$3, updated_at=now() WHERE id=$1', [p.id, slug, !!open]);
  } catch (e) {
    if (e.code === '23505') return { ok: false, kind: 'refused', says: 'Someone already has ' + slug + '. Try another address.' };
    return { ok: false, kind: 'unavailable', says: 'I could not change that. ' + e.message };
  }
  const url = site() + '/p/' + slug;
  return { ok: true, url, says: open
    ? 'Your portal is open at ' + url + '. Customers you add can sign in there with a link I email them.'
    : 'Your portal is closed. Customers cannot sign in until you open it again.' };
}

async function customers(viewer, business_id) {
  const gate = await P.can(viewer.id, business_id, 'customers', 'view');
  if (!gate.ok) return refuse(gate);
  try {
    const r = await query(
      `SELECT c.id, c.name, c.email, c.invited_at, c.last_seen_at, c.created_at,
              (SELECT count(*)::int FROM portal_messages m WHERE m.customer_id=c.id AND m.from_customer
                 AND m.created_at > coalesce((SELECT max(created_at) FROM portal_messages x
                   WHERE x.customer_id=c.id AND NOT x.from_customer), 'epoch')) AS waiting,
              (SELECT count(*)::int FROM portal_files f WHERE f.customer_id=c.id) AS files,
              (SELECT count(*)::int FROM obligations o WHERE o.portal_customer_id=c.id AND o.status='open') AS open_items
         FROM portal_customers c
        WHERE c.business_id=$1 AND c.removed_at IS NULL ORDER BY c.name`, [business_id]);
    const waiting = r.rows.filter((x) => x.waiting > 0).length;
    return { ok: true, customers: r.rows, says: !r.rows.length
      ? 'No customers in the portal yet. Add one and I will email them a sign-in link.'
      : r.rows.length + (r.rows.length === 1 ? ' customer' : ' customers')
        + (waiting ? ', ' + waiting + ' waiting for your reply.' : '.') };
  } catch (e) {
    return { ok: false, kind: 'unavailable', says: 'I could not read your portal customers, so I do not know who is there. ' + e.message };
  }
}

async function customerFor(viewer, id, level) {
  const c = (await query('SELECT * FROM portal_customers WHERE id=$1 AND removed_at IS NULL', [id])).rows[0];
  if (!c) return { ok: false, kind: 'unavailable', says: 'I cannot find that customer.' };
  const gate = await P.can(viewer.id, c.business_id, 'customers', level);
  if (!gate.ok) return refuse(gate);
  return { ok: true, customer: c };
}

async function addCustomer(viewer, business_id, { name, email, invite }) {
  const gate = await P.can(viewer.id, business_id, 'customers', 'act');
  if (!gate.ok) return refuse(gate);
  const n = String(name || '').trim().slice(0, 120);
  const e = String(email || '').trim().toLowerCase();
  if (!n) return { ok: false, kind: 'unclear', says: 'They need a name.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { ok: false, kind: 'unclear', says: 'That email address does not look right.' };
  let c;
  try {
    c = (await query('INSERT INTO portal_customers (business_id, name, email) VALUES ($1,$2,$3) RETURNING *',
      [business_id, n, e])).rows[0];
  } catch (err) {
    if (err.code === '23505') return { ok: false, kind: 'refused', says: e + ' is already a customer in your portal.' };
    return { ok: false, kind: 'unavailable', says: 'I could not add them, so nothing was saved. ' + err.message };
  }
  let says = n + ' is added.';
  if (invite) {
    const inv = await sendLink(c, { invite: true });
    says += ' ' + inv.says;
  }
  return { ok: true, customer: c, says };
}

async function removeCustomer(viewer, id) {
  const g = await customerFor(viewer, id, 'act');
  if (!g.ok) return g;
  await query('UPDATE portal_customers SET removed_at=now() WHERE id=$1', [id]);
  await query(`DELETE FROM portal_tokens WHERE customer_id=$1`, [id]);
  return { ok: true, says: g.customer.name + ' is removed and can no longer sign in.' };
}

async function invite(viewer, id) {
  const g = await customerFor(viewer, id, 'act');
  if (!g.ok) return g;
  const r = await sendLink(g.customer, { invite: true });
  return r.sent ? { ok: true, says: r.says } : { ok: false, kind: 'unavailable', says: r.says };
}

async function shareFile(viewer, id, file_id, share) {
  const g = await customerFor(viewer, id, 'act');
  if (!g.ok) return g;
  const f = (await query('SELECT id, name, business_id FROM files WHERE id=$1 AND deleted_at IS NULL', [file_id])).rows[0];
  if (!f || f.business_id !== g.customer.business_id) return { ok: false, kind: 'unavailable', says: 'I cannot find that file in this business.' };
  if (share === false) {
    await query('DELETE FROM portal_files WHERE customer_id=$1 AND file_id=$2', [id, file_id]);
    return { ok: true, says: f.name + ' is no longer in ' + g.customer.name + '\u2019s portal.' };
  }
  await query('INSERT INTO portal_files (customer_id, file_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, file_id]);
  return { ok: true, says: g.customer.name + ' can now see ' + f.name + ' in their portal.' };
}

// Something open between the business and this customer. No amounts: money is Arbo's.
async function addItem(viewer, id, { direction, title, due_on, detail }) {
  const g = await customerFor(viewer, id, 'act');
  if (!g.ok) return g;
  const t = String(title || '').trim().slice(0, 160);
  if (!t) return { ok: false, kind: 'unclear', says: 'Say what it is.' };
  const theyOwe = direction === 'they_owe';
  if (!theyOwe && direction !== 'we_owe') return { ok: false, kind: 'unclear', says: 'Is it something they owe you, or something you owe them?' };
  const r = await query(
    `INSERT INTO obligations (business_id, kind, title, detail, counterparty, counterparty_kind, due_at,
        cost_basis, source, portal_customer_id)
     VALUES ($1,$2,$3,$4,$5,'customer',$6,'unknown','portal',$7) RETURNING id, title, due_at`,
    [g.customer.business_id, theyOwe ? 'invoice_out' : 'promise', t, detail ? String(detail).slice(0, 1000) : null,
      g.customer.name, due_on || null, id]);
  return { ok: true, item: r.rows[0], says: (theyOwe ? g.customer.name + ' will see that they owe you: '
    : g.customer.name + ' will see that you owe them: ') + t + '.' };
}

async function thread(viewer, id) {
  const g = await customerFor(viewer, id, 'view');
  if (!g.ok) return g;
  const r = await query(
    `SELECT m.id, m.from_customer, m.body, m.fields, m.created_at, u.name AS author
       FROM portal_messages m LEFT JOIN users u ON u.id=m.author_id
      WHERE m.customer_id=$1 ORDER BY m.created_at`, [id]);
  const files = await query(
    `SELECT f.id, f.name, f.kind FROM portal_files pf JOIN files f ON f.id=pf.file_id
      WHERE pf.customer_id=$1 AND f.deleted_at IS NULL ORDER BY pf.shared_at DESC`, [id]);
  const items = await query(
    `SELECT id, kind, title, due_at, status FROM obligations WHERE portal_customer_id=$1
      ORDER BY status='open' DESC, due_at NULLS LAST`, [id]);
  return { ok: true, customer: g.customer, messages: r.rows, files: files.rows, items: items.rows };
}

async function reply(viewer, id, body) {
  const g = await customerFor(viewer, id, 'act');
  if (!g.ok) return g;
  const text = String(body || '').trim().slice(0, 5000);
  if (!text) return { ok: false, kind: 'unclear', says: 'Write something first.' };
  await query(
    `INSERT INTO portal_messages (customer_id, business_id, from_customer, author_id, body)
     VALUES ($1,$2,false,$3,$4)`, [id, g.customer.business_id, viewer.id, text]);
  // Replying closes the reply this customer was waiting on.
  await query(
    `UPDATE obligations SET status='done', completed_at=now(), updated_at=now()
      WHERE portal_customer_id=$1 AND source='portal' AND kind='promise' AND status='open'
        AND title LIKE 'Reply to %'`, [id]).catch(() => {});
  const p = await load(g.customer.business_id);
  let says = 'Sent to ' + g.customer.name + '.';
  if (p.slug && p.is_open) {
    const n = await notify(g.customer, p, 'You have a new message from ' + p.business_name,
      p.business_name + ' wrote to you:\n\n' + text + '\n\nReply in your portal: ' + p.url);
    if (!n) says += ' I could not email them about it, so they will see it next time they sign in.';
  } else {
    says += ' Your portal is not open, so they will not see it until you open it.';
  }
  return { ok: true, says };
}

async function notify(customer, portal, subject, text) {
  try {
    const r = await sendEmail({ to: customer.email, subject, text, from: fromFor(portal.business_name),
      html: '<div style="font:16px/1.55 system-ui,sans-serif;max-width:560px">'
        + text.split('\n').map((l) => l ? '<p style="margin:0 0 10px">' + l.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]) + '</p>' : '').join('') + '</div>' });
    return !!(r && r.sent);
  } catch (_) { return false; }
}

// ------------------------------------------------------------------ customer side

async function sendLink(customer, { invite }) {
  const p = await load(customer.business_id);
  if (!p.slug || !p.is_open) {
    return { sent: false, says: 'The portal is not open yet, so I did not send a sign-in link. Open it first.' };
  }
  const t = token();
  await query(
    `INSERT INTO portal_tokens (token_hash, customer_id, kind, expires_at)
     VALUES ($1,$2,'link', now() + make_interval(mins => $3))`, [hash(t), customer.id, LINK_MINUTES]);
  const link = p.url + '/in?t=' + t;
  const ok = await notify(customer, p,
    invite ? p.business_name + ' has set up a portal for you' : 'Your sign-in link for ' + p.business_name,
    (invite ? p.business_name + ' has set up a customer portal for you. ' : '')
      + 'Open this link to sign in. It works once and for ' + LINK_MINUTES + ' minutes:\n\n' + link
      + '\n\nIf you did not expect this, you can ignore it.');
  if (invite && ok) await query('UPDATE portal_customers SET invited_at=now() WHERE id=$1', [customer.id]);
  return { sent: ok, says: ok ? 'I emailed ' + customer.email + ' a sign-in link.'
    : 'I could not email ' + customer.email + ' just now, so no link was sent.' };
}

async function openPortal(slug) {
  const s = String(slug || '').toLowerCase();
  if (!/^[a-z0-9-]{1,63}$/.test(s)) return null;
  const p = (await query('SELECT business_id FROM portals WHERE slug=$1 AND is_open', [s])).rows[0];
  return p ? load(p.business_id) : null;
}

// Always the same answer, whether or not the address belongs to a customer, so the form cannot be
// used to find out who a business's customers are.
async function requestLink(slug, email) {
  const same = 'If that address belongs to a customer here, a sign-in link is on its way. It works for '
    + LINK_MINUTES + ' minutes.';
  const p = await openPortal(slug);
  if (!p) return { ok: false, says: 'This portal is not open.' };
  const e = String(email || '').trim().toLowerCase();
  const c = (await query(
    'SELECT * FROM portal_customers WHERE business_id=$1 AND lower(email)=$2 AND removed_at IS NULL',
    [p.business_id, e])).rows[0];
  if (c) {
    const recent = await query(
      `SELECT count(*)::int AS n FROM portal_tokens WHERE customer_id=$1 AND kind='link'
         AND created_at > now() - interval '15 minutes'`, [c.id]);
    if (recent.rows[0].n < 3) await sendLink(c, { invite: false });
  }
  return { ok: true, says: same };
}

async function consumeLink(slug, t) {
  const p = await openPortal(slug);
  if (!p || !/^[a-f0-9]{64}$/.test(String(t || ''))) return { ok: false };
  const r = await query(
    `UPDATE portal_tokens pt SET used_at=now()
       FROM portal_customers c
      WHERE pt.token_hash=$1 AND pt.kind='link' AND pt.used_at IS NULL AND pt.expires_at > now()
        AND c.id=pt.customer_id AND c.business_id=$2 AND c.removed_at IS NULL
      RETURNING c.id`, [hash(t), p.business_id]);
  if (!r.rows.length) return { ok: false };
  const s = token();
  await query(
    `INSERT INTO portal_tokens (token_hash, customer_id, kind, expires_at)
     VALUES ($1,$2,'session', now() + make_interval(days => $3))`, [hash(s), r.rows[0].id, SESSION_DAYS]);
  await query('UPDATE portal_customers SET last_seen_at=now() WHERE id=$1', [r.rows[0].id]);
  return { ok: true, session: s, days: SESSION_DAYS };
}

async function whoIs(slug, session) {
  const p = await openPortal(slug);
  if (!p || !/^[a-f0-9]{64}$/.test(String(session || ''))) return { portal: p, customer: null };
  const c = (await query(
    `SELECT c.* FROM portal_tokens pt JOIN portal_customers c ON c.id=pt.customer_id
      WHERE pt.token_hash=$1 AND pt.kind='session' AND pt.expires_at > now()
        AND c.business_id=$2 AND c.removed_at IS NULL`, [hash(session), p.business_id])).rows[0];
  return { portal: p, customer: c || null };
}

async function signOut(session) {
  if (/^[a-f0-9]{64}$/.test(String(session || ''))) {
    await query(`DELETE FROM portal_tokens WHERE token_hash=$1 AND kind='session'`, [hash(session)]);
  }
}

// Everything one signed-in customer can see, and nothing else. Every query is keyed on their id.
async function customerView(customer) {
  const items = await query(
    `SELECT kind, title, detail, due_at, status FROM obligations
      WHERE portal_customer_id=$1 AND status='open' ORDER BY due_at NULLS LAST`, [customer.id]);
  const files = await query(
    `SELECT f.id, f.name, f.kind, f.description FROM portal_files pf JOIN files f ON f.id=pf.file_id
      WHERE pf.customer_id=$1 AND f.deleted_at IS NULL ORDER BY pf.shared_at DESC`, [customer.id]);
  const messages = await query(
    `SELECT from_customer, body, created_at FROM portal_messages
      WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 50`, [customer.id]);
  return {
    they_owe: items.rows.filter((i) => i.kind === 'invoice_out'),
    we_owe: items.rows.filter((i) => i.kind !== 'invoice_out'),
    files: files.rows, messages: messages.rows.reverse(),
  };
}

async function customerFile(customer, fileId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(fileId || ''))) return null;
  return (await query(
    `SELECT f.name, f.mime, f.kind, f.data FROM portal_files pf JOIN files f ON f.id=pf.file_id
      WHERE pf.customer_id=$1 AND f.id=$2 AND f.deleted_at IS NULL`, [customer.id, fileId])).rows[0] || null;
}

// A message or a request from the customer. Raises a reply on the owner's Today.
async function fromCustomer(customer, portal, { body, fields }) {
  let text = String(body || '').trim().slice(0, 5000);
  let clean = null;
  if (fields && typeof fields === 'object') {
    clean = {};
    portal.config.request.fields.forEach((f) => {
      const v = String(fields[f.label] == null ? '' : fields[f.label]).trim().slice(0, 2000);
      if (v) clean[f.label] = v;
    });
    const missing = portal.config.request.fields.filter((f) => f.required && !clean[f.label]).map((f) => f.label);
    if (missing.length) return { ok: false, code: 'missing', says: 'Please fill in: ' + missing.join(', ') + '.' };
    text = Object.entries(clean).map(([k, v]) => k + ': ' + v).join('\n');
  }
  if (!text) return { ok: false, code: 'empty', says: 'Write something before sending.' };
  const recent = await query(
    `SELECT count(*)::int AS n FROM portal_messages WHERE customer_id=$1 AND from_customer
       AND created_at > now() - interval '1 hour'`, [customer.id]);
  if (recent.rows[0].n >= 20) return { ok: false, code: 'slow', says: 'You have sent a lot of messages in the last hour. Please wait a little.' };

  const open = await query(
    `SELECT id FROM obligations WHERE portal_customer_id=$1 AND source='portal' AND kind='promise'
       AND status='open' AND title LIKE 'Reply to %' LIMIT 1`, [customer.id]);
  let obId = open.rows[0] ? open.rows[0].id : null;
  if (!obId) {
    obId = (await query(
      `INSERT INTO obligations (business_id, kind, title, detail, counterparty, counterparty_kind, due_at,
          cost_basis, consequence, source, portal_customer_id)
       VALUES ($1,'promise',$2,$3,$4,'customer', now() + interval '1 day','unknown',
          'A customer left waiting for a day starts to wonder whether anyone is there.','portal',$5)
       RETURNING id`,
      [customer.business_id, 'Reply to ' + customer.name + ' in your portal', text.slice(0, 1000),
        customer.name, customer.id])).rows[0].id;
  }
  await query(
    `INSERT INTO portal_messages (customer_id, business_id, from_customer, body, fields, obligation_id)
     VALUES ($1,$2,true,$3,$4,$5)`, [customer.id, customer.business_id, text, clean ? JSON.stringify(clean) : null, obId]);
  const owner = (await query(
    'SELECT u.email FROM businesses b JOIN users u ON u.id=b.owner_id WHERE b.id=$1', [customer.business_id])).rows[0];
  if (owner) {
    sendEmail({ to: owner.email, subject: customer.name + ' wrote in your customer portal',
      text: customer.name + ' wrote:\n\n' + text + '\n\nReply from ' + site() + '/portal.html\n\nPenny',
      html: '<pre style="font:15px/1.5 system-ui,sans-serif;white-space:pre-wrap">'
        + (customer.name + ' wrote:\n\n' + text).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]) + '</pre>' })
      .catch(() => {});
  }
  return { ok: true, code: clean ? 'asked' : 'sent', says: clean ? 'Your request is sent. ' + portal.business_name + ' will get back to you.'
    : 'Sent. ' + portal.business_name + ' will reply here.' };
}

async function portalForBusiness(business_id) {
  const p = (await query('SELECT slug FROM portals WHERE business_id=$1 AND is_open', [business_id])).rows[0];
  return p ? site() + '/p/' + p.slug : null;
}

module.exports = {
  get, customise, setOpen, customers, addCustomer, removeCustomer, invite, shareFile, addItem, thread,
  reply, requestLink, consumeLink, whoIs, signOut, customerView, customerFile, fromCustomer,
  openPortal, portalForBusiness, embedSnippet, LINK_MINUTES, SESSION_DAYS, hash,
};
