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
const { notifyStaff } = require('./staffNotify');

// Attempt one scheduled seed. Returns a plain result; never throws.
async function tick() {
  // Don't consume a slot when Clay's builder is down — try again next tick.
  try { if (!provider.available()) return { ok: false, reason: 'provider_down' }; }
  catch (_) { return { ok: false, reason: 'provider_down' }; }

  let claimed = false;
  let prevLastSeed = null;
  try {
    const prev = await query('SELECT last_seed_at FROM seed_schedule WHERE id = TRUE');
    prevLastSeed = prev.rows[0] ? prev.rows[0].last_seed_at : null;
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

  // A claimed slot that then fails used to be silent AND self-blocking: last_seed_at was already
  // moved forward, so the gap timer stopped any retry, and nobody was told. That is exactly how
  // three seeds a day quietly became zero with the schedule still reading 'enabled'. Now a failure
  // gives the slot BACK so the next tick can try again, and says what went wrong.
  const giveBackSlot = async (why) => {
    try {
      await query(`UPDATE seed_schedule SET last_seed_at = $1, updated_at = now() WHERE id = TRUE`,
        [prevLastSeed]);
    } catch (e) { console.error('could not release the seed slot:', e && e.message); }
    try {
      await notifyStaff({
        kind: 'seed_failed',
        dedupeKey: 'seed-failed-' + new Date().toISOString().slice(0, 13),
        subject: 'Clay could not seed a project',
        body: `Clay claimed a seeding slot and then failed, so no project was created.\n\n`
          + `Reason: ${why}\n\nThe slot has been released, so the next run will try again. `
          + `If this keeps repeating, something is wrong with the builder rather than the schedule.`,
      });
    } catch (e) { console.error('seed failure notice failed:', e && e.message); }
  };

  try {
    const out = await seed.runSeed({ source: 'scheduled' });
    console.log('scheduled seed:', JSON.stringify(out));
    if (!out || out.ok === false) {
      const why = (out && (out.reason || out.message)) || 'no result returned';
      // A DELIBERATE REFUSAL IS NOT A FAILURE, but it must still be visible. Clay declining because
      // of the daily cap or the minority rule is the guardrail working — yet reported as nothing at
      // all it looks exactly like the seeder being broken, which is precisely how this went unnoticed
      // for a day. Say which it is, in plain words, and do not hand the slot back for a rule that
      // will still be true in ten minutes.
      const DECLINED = {
        daily_cap: 'Clay has already seeded his limit for today. This is the guardrail working, not a fault.',
        minority_cap: 'Clay is holding back: he already owns too large a share of the live listings. He will seed again once real creators have more of the market.',
        no_novel_idea: 'Clay could not think of an idea different enough from what is already here, so he wrote nothing rather than repeat himself.',
      };
      if (DECLINED[why]) {
        console.log('seed declined on purpose:', why, '-', DECLINED[why]);
        return { ok: false, reason: why, declined: true, message: DECLINED[why] };
      }
      await giveBackSlot(why);
      return out || { ok: false, reason: 'no_result' };
    }
    return out;
  } catch (e) {
    console.error('scheduled seed error:', e && e.message);
    await giveBackSlot(e && e.message ? e.message : 'threw an error');
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
  const row = r.rows[0] || null;
  if (!row) return null;

  // Say plainly whether Clay WILL seed, and if not, why. 'Enabled: true' with nothing appearing is
  // indistinguishable from a broken seeder — which is exactly how a working guardrail got mistaken
  // for a fault. The status now answers the question a person is actually asking.
  const share = await query(`
    SELECT COUNT(*)::int AS live_total,
           COUNT(*) FILTER (WHERE seller_id = (SELECT id FROM users WHERE email='clay@accessyplabs.com'))::int AS clay_live
      FROM listings WHERE status='live'`);
  const s = share.rows[0] || { live_total: 0, clay_live: 0 };
  const human = s.live_total - s.clay_live;
  row.clay_live = s.clay_live;
  row.human_live = human;

  if (!row.enabled) {
    row.will_seed = false;
    row.why = 'Seeding is switched off.';
  } else if (row.seeded_today >= row.daily_target) {
    row.will_seed = false;
    row.why = `Clay has seeded ${row.seeded_today} today, which is his limit. He will start again tomorrow.`;
  } else if (human >= 10 && s.live_total > 0 && (s.clay_live / s.live_total) >= 0.5) {
    row.will_seed = false;
    row.why = `Clay is holding back: he owns ${s.clay_live} of the ${s.live_total} live listings. `
      + 'He seeds again once real creators hold more of the market.';
  } else {
    row.will_seed = true;
    row.why = `Clay will seed. ${row.seeded_today} of ${row.daily_target} done today; `
      + `${human} live listing(s) belong to real creators.`;
  }
  return row;
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
