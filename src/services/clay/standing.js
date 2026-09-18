// WORK PENNY DOES WITHOUT BEING ASKED.
//
// A standing job is an instruction in the owner's own words, run on a cadence, with every run
// recorded and reported to them afterwards.
//
// THE LINE, set by the owner: she does the safe work herself. Anything that spends money, could
// break something, or needs a human decision, she does not do alone. Unattended, a tool that asks
// for confirmation is never confirmed by her: the run stops, says what it was about to do, and waits
// for the person. That is the whole safety model, and it is enforced here rather than trusted to the
// model's judgement, because a prompt is a request and a gate is a rule.
//
// A run that fails says it failed. A run that did nothing says it did nothing. Neither is ever
// reported as a quiet success, because somebody who cannot see the screen has only this report.

const { query } = require('../../config/db');
const agent = require('./agent');
const { PENNY_WORKSPACE, WORKSPACE_TOOLS } = require('./penny');
const Notes = require('./notes');

const CADENCES = ['daily', 'weekdays', 'weekly', 'monthly'];
const MAX_PER_USER = 10;

// Tools she may use on her own. Read anything; write only what the person can undo and that costs
// nothing. Everything left out is not forbidden forever: it waits for them.
//
// Worked out on first use rather than at load, because workspace.js loads this file too and at load
// time its tool table does not exist yet. A list built from an empty table would silently be every
// tool or none, which is exactly the kind of quiet wrong this gate must never be.
const NEVER_ALONE = ['send_invoice_to_flow', 'launch_build', 'start_build', 'connect_flow'];
let unattended = null;
function UNATTENDED_TOOLS() {
  if (unattended) return unattended;
  // Required here, not at the top: workspace.js requires this file, and it replaces its exports
  // object after loading, so a reference captured at load time stays empty forever.
  const T = require('./workspace').TOOLS || {};
  unattended = WORKSPACE_TOOLS.filter((t) => T[t] && !T[t].requires_confirmation && !T[t].irreversible)
    .filter((t) => !NEVER_ALONE.includes(t));
  return unattended;
}

// The next time this job should run, in the person's own zone.
function nextRun(job, from = new Date()) {
  const tz = job.timezone || 'America/Chicago';
  const at = Number(job.at_hour == null ? 8 : job.at_hour);
  for (let i = 0; i < 400; i += 1) {
    const day = new Date(from.getTime() + i * 86400000);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', day: 'numeric',
      hour: 'numeric', hour12: false }).formatToParts(day);
    const get = (t) => parts.find((p) => p.type === t).value;
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    const dom = Number(get('day'));
    const hourNow = Number(get('hour'));
    const fits = job.cadence === 'daily'
      || (job.cadence === 'weekdays' && weekday >= 1 && weekday <= 5)
      || (job.cadence === 'weekly' && weekday === Number(job.weekday == null ? 1 : job.weekday))
      || (job.cadence === 'monthly' && dom === Number(job.day_of_month || 1));
    if (!fits) continue;
    // The hour, in that zone, on that day.
    const guess = new Date(day);
    guess.setUTCHours(guess.getUTCHours() + (at - hourNow), 0, 0, 0);
    if (guess > from) return guess;
  }
  return new Date(from.getTime() + 86400000);
}

async function add(viewer, { asked_for, cadence, at_hour, weekday, day_of_month, timezone, business_id }) {
  const said = String(asked_for || '').trim().slice(0, 600);
  if (said.length < 3) return { ok: false, kind: 'unclear', says: 'What should I do each time?' };
  if (!CADENCES.includes(cadence)) {
    return { ok: false, kind: 'unclear', says: 'How often: every day, weekdays, once a week, or once a month?' };
  }
  // THE SAME JOB TWICE IS A BUG, not a choice. Asked live, she set the same weekly check up four
  // times in one turn (17 Sept 2026) and then had to offer to undo her own work.
  const same = await query(
    `SELECT id, next_run_at FROM standing_jobs
      WHERE user_id=$1 AND active AND cadence=$2 AND lower(btrim(asked_for)) = lower(btrim($3))
        AND business_id IS NOT DISTINCT FROM $4 LIMIT 1`,
    [viewer.id, cadence, said, business_id || null]);
  if (same.rows.length) {
    return { ok: true, id: same.rows[0].id, already: true, next_run_at: same.rows[0].next_run_at,
      says: 'You already have that on a schedule, so I have not set it up twice.' };
  }
  const held = await query(
    'SELECT count(*)::int AS n FROM standing_jobs WHERE user_id=$1 AND active', [viewer.id]);
  if (held.rows[0].n >= MAX_PER_USER) {
    return { ok: false, kind: 'refused',
      says: 'You already have ' + MAX_PER_USER + ' standing jobs, which is as many as I run. Stop one '
        + 'and I will add this.' };
  }
  const job = { cadence, at_hour: at_hour == null ? 8 : Number(at_hour), weekday, day_of_month,
    timezone: timezone || 'America/Chicago' };
  const next = nextRun(job);
  const r = await query(
    `INSERT INTO standing_jobs (user_id, business_id, asked_for, cadence, at_hour, weekday,
        day_of_month, timezone, next_run_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, next_run_at`,
    [viewer.id, business_id || null, said, cadence, job.at_hour,
      weekday == null ? null : Number(weekday), day_of_month == null ? null : Number(day_of_month),
      job.timezone, next]);
  return { ok: true, id: r.rows[0].id, next_run_at: r.rows[0].next_run_at,
    says: 'I will do that ' + describe(job) + ', starting ' + r.rows[0].next_run_at.toISOString().slice(0, 16).replace('T', ' at ')
      + ' UTC, and tell you what I did each time. Anything that spends money or needs your decision I '
      + 'will bring to you instead of doing it.' };
}

function describe(job) {
  const at = ' at ' + (job.at_hour == null ? 8 : job.at_hour) + ':00 ' + (job.timezone || 'America/Chicago');
  if (job.cadence === 'daily') return 'every day' + at;
  if (job.cadence === 'weekdays') return 'every weekday' + at;
  if (job.cadence === 'weekly') {
    return 'every ' + ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][job.weekday == null ? 1 : job.weekday] + at;
  }
  return 'on day ' + (job.day_of_month || 1) + ' of each month' + at;
}

async function list(viewer) {
  const r = await query(
    `SELECT j.*, b.name AS business,
            (SELECT status FROM standing_runs s WHERE s.job_id=j.id ORDER BY started_at DESC LIMIT 1) AS last_status,
            (SELECT summary FROM standing_runs s WHERE s.job_id=j.id ORDER BY started_at DESC LIMIT 1) AS last_summary
       FROM standing_jobs j LEFT JOIN businesses b ON b.id=j.business_id
      WHERE j.user_id=$1 AND j.active ORDER BY j.next_run_at`, [viewer.id]);
  return r.rows.map((j) => Object.assign(j, { when: describe(j) }));
}

async function stop(viewer, idOrText) {
  const t = String(idOrText || '').trim();
  if (!t) return { ok: false, kind: 'unclear', says: 'Which one should I stop?' };
  const isId = /^[0-9a-f-]{36}$/i.test(t);
  const r = await query(
    isId ? `UPDATE standing_jobs SET active=false, stopped_at=now() WHERE user_id=$1 AND id=$2 AND active RETURNING asked_for`
      : `UPDATE standing_jobs SET active=false, stopped_at=now() WHERE user_id=$1 AND active
           AND lower(asked_for) LIKE '%' || lower($2) || '%' RETURNING asked_for`, [viewer.id, t]);
  if (!r.rows.length) return { ok: false, kind: 'empty', says: 'I had no standing job like that, so nothing changed.' };
  return { ok: true, says: 'Stopped: ' + r.rows.map((x) => '"' + x.asked_for + '"').join('; ') + '. I will not run it again.' };
}

// RUNNING THE DUE ONES.
//
// Claimed in the database before the work starts, so two servers cannot run the same job twice. Every
// run is written down before anything is reported, and the person is told afterwards whether it went,
// stopped for them, or failed.
async function runDue({ send, now = new Date(), limit = 20 } = {}) {
  const due = await query(
    `UPDATE standing_jobs SET last_run_at = now()
      WHERE id IN (SELECT id FROM standing_jobs WHERE active AND next_run_at <= $1
                    ORDER BY next_run_at LIMIT $2 FOR UPDATE SKIP LOCKED)
      RETURNING *`, [now, limit]);
  const out = { considered: due.rows.length, done: 0, needs_you: 0, failed: 0 };
  for (const job of due.rows) {
    const run = (await query(
      `INSERT INTO standing_runs (job_id, status) VALUES ($1,'running') RETURNING id`, [job.id])).rows[0];
    const person = (await query(
      'SELECT id, name, email, role FROM users WHERE id=$1', [job.user_id])).rows[0];
    let status = 'failed';
    let summary = '';
    let used = [];
    try {
      if (!person) throw new Error('that account is gone');
      const Allowance = require('../allowance');
      const allowed = await Allowance.check(person, 'penny_message');
      if (!allowed.ok) {
        status = 'needs_you';
        summary = 'I did not run this because your monthly allowance is used up. ' + allowed.says;
      } else {
        const told = await Notes.forPrompt(person.id).catch(() => '');
        const executors = {};
        for (const name of UNATTENDED_TOOLS()) {
          const fn = require('./workspace').EXECUTORS[name];
          if (fn) executors[name] = (params) => fn({ id: person.id, name: person.name }, params || {});
        }
        const events = [];
        const r = await agent.runChat({
          messages: [{ role: 'user', content: job.asked_for }],
          executors,
          allowTools: UNATTENDED_TOOLS(),
          systemOverride: PENNY_WORKSPACE + told + UNATTENDED_NOTE,
          assistantName: 'Penny',
          maxSteps: 10,
          viewer: { role: person.role, name: person.name },
          onEvent: (e) => events.push(e),
        });
        used = events.filter((e) => e.type === 'tool_done').map((e) => ({ tool: e.tool, ok: e.ok, note: e.note }));
        await Allowance.record(person, 'penny_message').catch(() => {});
        if (r.status === 'confirmation_required') {
          status = 'needs_you';
          summary = (r.reply || '') + ' I stopped there because that needs your say-so.';
        } else if (r.status === 'unavailable') {
          status = 'failed';
          summary = 'I could not run this time, so nothing was done.';
        } else {
          status = 'done';
          summary = r.reply || 'Nothing needed doing.';
        }
      }
    } catch (e) {
      status = 'failed';
      summary = 'This did not run: ' + e.message + '. Nothing was changed.';
    }

    await query(
      `UPDATE standing_runs SET finished_at=now(), status=$2, summary=$3, tools=$4::jsonb WHERE id=$1`,
      [run.id, status, summary.slice(0, 4000), JSON.stringify(used)]);
    await query('UPDATE standing_jobs SET next_run_at=$2 WHERE id=$1', [job.id, nextRun(job)]);
    out[status] = (out[status] || 0) + 1;

    // Telling them is part of the job, not an extra. A silent run is indistinguishable from no run.
    if (send && person && person.email) {
      const headline = status === 'done' ? 'Done: ' + job.asked_for
        : status === 'needs_you' ? 'Waiting for you: ' + job.asked_for
          : 'Could not do: ' + job.asked_for;
      try {
        await send({ to: person.email, name: person.name, headline, body: summary });
        await query('UPDATE standing_runs SET told_them=true WHERE id=$1', [run.id]);
      } catch (_) { /* the run stands; the telling is recorded as not done */ }
    }
  }
  return out;
}

// Added to her prompt for an unattended run only.
const UNATTENDED_NOTE = `

YOU ARE RUNNING THIS ON YOUR OWN, with nobody reading along. Do the work you can do safely and write
down what you found. Anything that spends money, sends something out of the business, or needs a
person's decision: do NOT do it. Say what you were about to do and leave it for them. Report what you
actually did, in a few sentences, as though telling them when they get back. If nothing needed doing,
say that plainly rather than inventing work.`;

module.exports = { add, list, stop, runDue, nextRun, describe, CADENCES, UNATTENDED_TOOLS, NEVER_ALONE, MAX_PER_USER };
