// Clay's auto-seed scheduler. When enabled by staff, it tops up the Dream Market review queue on a
// gentle cadence — a couple of concepts a day, spaced out. Every seed still lands in 'in_review';
// nothing goes live without a staff member approving it.
//
// Safety by construction:
//   - OFF by default (seed_schedule.enabled). Staff turn it on deliberately.
//   - The next slot is CLAIMED in a single atomic UPDATE: it only fires when enabled, respects the
//     minimum gap, and stops at the daily target — and if the app runs on more than one instance,
//     only the one whose UPDATE lands first wins the slot (the others' WHERE no longer matches).
//   - The provider must be available, or we don't even claim a slot (so an outage doesn't burn the
//     day's budget). seed.runSeed() then enforces its own hard DAILY_CAP and minority guard.

const { query } = require('../../config/db');
const seed = require('./seed');
const provider = require('./provider');

// Attempt one scheduled seed. Returns a plain result; never throws.
async function tick() {
  // Don't consume a slot when Clay's builder is down — try again next tick.
  try { if (!provider.available()) return { ok: false, reason: 'provider_down' }; }
  catch (_) { return { ok: false, reason: 'provider_down' }; }

  let claimed = false;
  try {
    const r = await query(`
      UPDATE seed_schedule
         SET last_seed_at = now(), updated_at = now()
       WHERE id = TRUE
         AND enabled = TRUE
         AND (last_seed_at IS NULL OR last_seed_at < now() - (min_gap_minutes || ' minutes')::interval)
         AND (SELECT COUNT(*) FROM concepts
                WHERE origin = 'clay_seed' AND created_at >= date_trunc('day', now())) < daily_target
       RETURNING id`);
    claimed = r.rows.length > 0;
  } catch (e) {
    console.error('seed scheduler claim error:', e && e.message);
    return { ok: false, reason: 'claim_error' };
  }
  if (!claimed) return { ok: false, reason: 'not_due' };

  try {
    const out = await seed.runSeed({ source: 'scheduled' });
    console.log('scheduled seed:', JSON.stringify(out));
    return out || { ok: false, reason: 'no_result' };
  } catch (e) {
    console.error('scheduled seed error:', e && e.message);
    return { ok: false, reason: 'seed_error' };
  }
}

// Current schedule + how much Clay has seeded today / all-time.
async function status() {
  const r = await query(`
    SELECT s.enabled, s.daily_target, s.min_gap_minutes, s.last_seed_at,
      (SELECT COUNT(*) FROM concepts WHERE origin='clay_seed' AND created_at >= date_trunc('day', now()))::int AS seeded_today,
      (SELECT COUNT(*) FROM concepts WHERE origin='clay_seed')::int AS seeded_total
    FROM seed_schedule s WHERE s.id = TRUE`);
  return r.rows[0] || null;
}

// Staff update. Clamped to safe ranges; the daily target can never exceed the hard DAILY_CAP.
async function configure({ enabled, dailyTarget, minGapMinutes } = {}) {
  const sets = [];
  const vals = [];
  let i = 1;
  if (typeof enabled === 'boolean') { sets.push('enabled=$' + (i++)); vals.push(enabled); }
  if (Number.isInteger(dailyTarget)) { sets.push('daily_target=$' + (i++)); vals.push(Math.max(1, Math.min(seed.DAILY_CAP, dailyTarget))); }
  if (Number.isInteger(minGapMinutes)) { sets.push('min_gap_minutes=$' + (i++)); vals.push(Math.max(30, Math.min(1440, minGapMinutes))); }
  if (sets.length) {
    sets.push('updated_at=now()');
    await query('UPDATE seed_schedule SET ' + sets.join(', ') + ' WHERE id = TRUE', vals);
  }
  return status();
}

module.exports = { tick, status, configure };
