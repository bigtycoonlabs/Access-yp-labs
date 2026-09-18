// WHAT PENNY HAS BEEN TOLD.
//
// How this person likes to work, and what is true about their business that is not in a record
// anywhere. She carries it into every conversation, so nobody has to explain themselves twice.
//
// THE RULE THAT KEEPS THIS SAFE: only what they actually said. Never something she worked out about
// them. A note is read back as fact in every later conversation, and a guess read back as fact is
// how somebody ends up arguing with their own assistant about their own business.
//
// They can hear everything she is holding, and remove any of it, in one sentence.

const { query } = require('../../config/db');

const MAX = 40;

async function list(userId, businessId) {
  const r = await query(
    `SELECT n.id, n.note, n.business_id, b.name AS business, n.created_at
       FROM penny_notes n LEFT JOIN businesses b ON b.id = n.business_id
      WHERE n.user_id = $1 AND n.removed_at IS NULL
        AND ($2::uuid IS NULL OR n.business_id = $2 OR n.business_id IS NULL)
      ORDER BY n.created_at`, [userId, businessId || null]);
  return r.rows;
}

async function remember(userId, note, businessId) {
  const said = String(note || '').trim().slice(0, 600);
  if (!said) return { ok: false, kind: 'unclear', says: 'What would you like me to remember?' };
  const held = await list(userId, null);
  if (held.length >= MAX) {
    return { ok: false, kind: 'refused',
      says: 'I am already holding ' + MAX + ' things you have told me, which is as many as I can keep '
        + 'straight. Ask me what I am holding and tell me which to drop, and I will add this one.' };
  }
  const same = held.find((h) => h.note.toLowerCase() === said.toLowerCase());
  if (same) return { ok: true, id: same.id, already: true, says: 'I already had that, so I have not added it twice.' };
  const r = await query(
    `INSERT INTO penny_notes (user_id, business_id, note) VALUES ($1,$2,$3) RETURNING id`,
    [userId, businessId || null, said]);
  return { ok: true, id: r.rows[0].id, says: 'Noted, and I will keep it in mind from now on.' };
}

async function forget(userId, idOrText) {
  const t = String(idOrText || '').trim();
  if (!t) return { ok: false, kind: 'unclear', says: 'Which one should I drop?' };
  const isId = /^[0-9a-f-]{36}$/i.test(t);
  const r = await query(
    isId ? `UPDATE penny_notes SET removed_at = now() WHERE user_id=$1 AND id=$2 AND removed_at IS NULL RETURNING note`
      : `UPDATE penny_notes SET removed_at = now() WHERE user_id=$1 AND removed_at IS NULL
           AND lower(note) LIKE '%' || lower($2) || '%' RETURNING note`,
    [userId, t]);
  if (!r.rows.length) return { ok: false, kind: 'empty', says: 'I was not holding anything like that, so nothing changed.' };
  return { ok: true, dropped: r.rows.map((x) => x.note),
    says: 'Dropped: ' + r.rows.map((x) => '"' + x.note + '"').join('; ') + '. I will not act on it again.' };
}

/** The lines added to her prompt each turn. Said as what she was told, never as what she concluded. */
async function forPrompt(userId) {
  let held = [];
  try { held = await list(userId, null); } catch (_) { return ''; }
  if (!held.length) return '';
  return '\n\nWHAT THIS PERSON HAS TOLD YOU, in their own words. Work this way without being asked '
    + 'again, and never present it as something you worked out about them:\n'
    + held.map((h) => '- ' + (h.business ? '(' + h.business + ') ' : '') + h.note).join('\n');
}

module.exports = { list, remember, forget, forPrompt, MAX };
