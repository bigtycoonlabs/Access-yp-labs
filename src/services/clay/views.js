// WHOSE WORK AM I DOING RIGHT NOW.
//
// One account, two places to stand: your own work, or a team you were added to. The choice is
// stored, not guessed, because it decides whose plan pays for the work — and a guess about that is
// a guess about somebody's money.
//
// Standing in a team never gives more than the owner allowed, and never mixes the two: their own
// businesses are not visible from the team view and the team's are not visible from theirs.

const { query } = require('../../config/db');

// Every place this person can stand: their own, plus each team they are on.
async function available(userId) {
  const r = await query(
    `SELECT DISTINCT u.id AS owner_id, u.name AS owner_name, count(b.id)::int AS businesses
       FROM relationships r
       JOIN businesses b ON b.id = r.business_id AND b.archived_at IS NULL
       JOIN users u ON u.id = b.owner_id
      WHERE r.user_id = $1 AND r.ended_on IS NULL AND u.id <> $1
      GROUP BY u.id, u.name ORDER BY u.name`, [userId]);
  return r.rows;
}

async function current(userId) {
  const r = await query(
    `SELECT u.working_for, o.name AS owner_name FROM users u
       LEFT JOIN users o ON o.id = u.working_for WHERE u.id = $1`, [userId]);
  const row = r.rows[0] || {};
  return { working_for: row.working_for || null, owner_name: row.owner_name || null };
}

// Standing somewhere is only allowed while the seat exists: an ended relationship puts them back in
// their own work rather than leaving them somewhere they can no longer be.
async function setTo(userId, ownerId) {
  if (!ownerId) {
    await query('UPDATE users SET working_for = NULL WHERE id = $1', [userId]);
    return { ok: true, working_for: null, says: 'You are in your own work now.' };
  }
  const teams = await available(userId);
  const team = teams.find((t) => t.owner_id === ownerId);
  if (!team) {
    return { ok: false, kind: 'refused',
      says: 'You are not on that team, so I have not moved you. You can only work in a business '
        + 'somebody added you to.' };
  }
  await query('UPDATE users SET working_for = $2 WHERE id = $1', [userId, ownerId]);
  return { ok: true, working_for: ownerId, owner_name: team.owner_name,
    says: 'You are working in ' + team.owner_name + '\u2019s business now. What you do here counts '
      + 'against their plan, and you can only do what they allowed. Your own work is untouched.' };
}

// Whose plan pays. Their own unless they are standing in somebody else's team.
async function billTo(user) {
  if (!user || !user.id) return user;
  const c = await current(user.id).catch(() => ({ working_for: null }));
  if (!c.working_for) return user;
  const r = await query('SELECT id, email, name, role FROM users WHERE id = $1', [c.working_for]);
  return r.rows[0] || user;
}

module.exports = { available, current, setTo, billTo };
