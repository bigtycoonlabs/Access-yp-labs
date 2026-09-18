// MAIL FORWARDED TO PENNY.
//
// Not a mailbox she reads. An address the business forwards to, which is a smaller thing to grant
// and a smaller thing to lose: she sees what was sent to her and nothing else.
//
// The address is <name>-<token>@in.<domain>. The token is random because an address that is only a
// business name is an address anybody can post to, and this one leads straight into somebody's
// records.

const crypto = require('crypto');
const { query } = require('../../config/db');

const DOMAIN = () => process.env.INBOUND_DOMAIN || 'in.accessyplabs.com';
const MAX_BODY = 40000;

function slug(name) {
  return String(name || 'business').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 24) || 'business';
}

// The address for a business, made on first ask and kept.
async function addressFor(viewer, business_id) {
  const r = await query(
    'SELECT id, name, inbox_token FROM businesses WHERE id=$1 AND owner_id=$2', [business_id, viewer.id]);
  const b = r.rows[0];
  if (!b) return { ok: false, kind: 'refused', says: 'That is not a business you own, so I have not made an address for it.' };
  let token = b.inbox_token;
  if (!token) {
    token = crypto.randomBytes(5).toString('hex');
    await query('UPDATE businesses SET inbox_token=$2 WHERE id=$1', [b.id, token]);
  }
  return { ok: true, address: slug(b.name) + '-' + token + '@' + DOMAIN(), business: b.name };
}

// Where a piece of mail belongs. The token decides, not the name in front of it, so a typo in the
// name still lands and a guessed name does not.
async function businessForAddress(to) {
  const local = String(to || '').split('@')[0].toLowerCase();
  const m = /([0-9a-f]{10})$/.exec(local);
  if (!m) return null;
  const r = await query('SELECT id, name, owner_id FROM businesses WHERE inbox_token=$1', [m[1]]);
  return r.rows[0] || null;
}

// Taking one in. Everything about the sender is data, never instruction: a forwarded email is a
// stranger's text arriving inside somebody's records.
async function receive({ to, from, from_name, subject, text, message_id }) {
  const biz = await businessForAddress(to);
  if (!biz) return { ok: false, kind: 'unknown_address' };
  const body = String(text || '').slice(0, MAX_BODY);
  const r = await query(
    `INSERT INTO inbound_mail (business_id, from_address, from_name, to_address, subject, body, message_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (business_id, message_id) WHERE message_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [biz.id, String(from || '').slice(0, 320), String(from_name || '').slice(0, 200),
      String(to || '').slice(0, 320), String(subject || '').slice(0, 500), body, message_id || null]);
  if (!r.rows.length) return { ok: true, duplicate: true, business: biz };
  return { ok: true, id: r.rows[0].id, business: biz };
}

async function list(viewer, { business_id, only_unhandled = false, limit = 20 } = {}) {
  const own = await query('SELECT id FROM businesses WHERE id=$1 AND owner_id=$2', [business_id, viewer.id]);
  if (!own.rows.length) return { ok: false, kind: 'refused', says: 'That is not a business you own.' };
  const r = await query(
    `SELECT id, from_address, from_name, subject, received_at, handled_at,
            left(body, 400) AS preview
       FROM inbound_mail WHERE business_id=$1 ${only_unhandled ? 'AND handled_at IS NULL' : ''}
      ORDER BY received_at DESC LIMIT $2`, [business_id, Math.min(50, Math.max(1, Number(limit) || 20))]);
  return { ok: true, mail: r.rows };
}

async function read(viewer, id) {
  const r = await query(
    `SELECT m.*, b.name AS business FROM inbound_mail m JOIN businesses b ON b.id = m.business_id
      WHERE m.id=$1 AND b.owner_id=$2`, [id, viewer.id]);
  if (!r.rows.length) return { ok: false, kind: 'refused', says: 'That is not a piece of mail I can read for you.' };
  return { ok: true, mail: r.rows[0] };
}

async function markHandled(viewer, id, note) {
  const r = await query(
    `UPDATE inbound_mail m SET handled_at=now(), handled_note=$3
       FROM businesses b WHERE b.id = m.business_id AND m.id=$1 AND b.owner_id=$2 AND m.handled_at IS NULL
     RETURNING m.subject`, [id, viewer.id, String(note || '').slice(0, 500) || null]);
  if (!r.rows.length) return { ok: false, kind: 'empty', says: 'That was already dealt with, or is not yours.' };
  return { ok: true, says: 'Marked as dealt with: ' + (r.rows[0].subject || 'no subject') + '.' };
}

module.exports = { addressFor, businessForAddress, receive, list, read, markHandled, slug, DOMAIN };
