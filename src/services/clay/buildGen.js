// WRITING THE PAGE.
//
// builder.js decides what may be built and whether it can be charged. This writes the thing.
//
// THE RULE: A PAGE IS NOT READY BECAUSE A MODEL RETURNED TEXT.
// It is ready when it has passed the checks below and has an address somebody can open. Every check
// is about a person, not about markup purity:
//   - a screen reader user can find where they are (one main, one h1, a title, a language)
//   - every field says what it is for (a placeholder is not a label)
//   - nothing loads from anywhere else (the preview has no network, and a page that silently
//     depends on a font server or a script host is a page that half-renders)
//   - no em-dashes, by the owner's standing rule
// A page that fails is written again once, told exactly what failed. If it fails twice the build is
// marked failed with the reasons in words. It is never called ready to be tidy.
//
// AND IT NEVER RUNS ON OUR ORIGIN. Sessions live in localStorage on accessyplabs.com, so a generated
// page served normally could read them. The preview route serves it inside a CSP sandbox with an
// opaque origin. See routes/preview.js.

const { query } = require('../../config/db');
const provider = require('./provider');
const B = require('./builder');

const SITE = () => (process.env.CLIENT_URL || 'https://accessyplabs.com').replace(/\/+$/, '');

const SYSTEM = `You build single web pages for small businesses. You return ONE complete HTML document
and nothing else: no explanation, no markdown fences.

The page must work with no network at all. No external scripts, stylesheets, fonts or images. Inline
CSS in one <style> element and inline JavaScript in <script> elements only. Use inline SVG or CSS for
any imagery, and never an <img> pointing at a URL.

It is used by people who are blind, so accessibility is the structure, not decoration:
- <html lang="en">, a meaningful <title>, exactly one <main>, exactly one <h1>.
- Every input, select and textarea has a visible <label for="..."> bound to its id.
- Buttons are <button> elements, never clickable divs. Touch targets at least 44px tall.
- Status after any action goes in an element with role="status" aria-live="polite", written as a
  full sentence that says what happened.
- Linear, speakable wording. Meaning never carried by colour alone.
- Never use the em-dash character. Use commas or full stops.

Forms cannot send anything anywhere in this preview. Handle submit in JavaScript with
preventDefault, and say plainly in the status region that this is a preview and nothing was sent.

Never invent facts about the business: no made-up prices, addresses, phone numbers, reviews or
awards. Where a real detail is needed and you do not have it, write a clearly marked placeholder in
square brackets, for example [your phone number]. That applies to facts about the business shown on
the page only. Input fields that customers fill in do not get bracketed placeholder text; leave
their placeholder empty or give a plain example such as 512 555 0100.

Make it look genuinely good: clear hierarchy, generous spacing, a restrained palette with strong
contrast, and a layout that works on a phone first.`;

const MAX_TOKENS = 16000;

function extractHtml(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.search(/<!doctype html|<html[\s>]/i);
  const end = t.toLowerCase().lastIndexOf('</html>');
  if (start < 0 || end < 0) return null;
  return t.slice(start, end + 7);
}

function count(re, s) { return (s.match(re) || []).length; }

// Every check returns a sentence a person can read, so a failure is self-explaining.
function check(html) {
  const problems = [];
  const h = String(html || '');
  if (!/^<!doctype html/i.test(h)) problems.push('it does not start with a doctype');
  if (!/<html[^>]*\slang=["'][a-z]{2}/i.test(h)) problems.push('the html element has no language');
  if (!/<title>[^<]{3,}<\/title>/i.test(h)) problems.push('it has no title');
  const mains = count(/<main[\s>]/gi, h);
  if (mains !== 1) problems.push('it has ' + mains + ' main landmarks instead of exactly one');
  const h1s = count(/<h1[\s>]/gi, h);
  if (h1s !== 1) problems.push('it has ' + h1s + ' h1 headings instead of exactly one');

  const labelFor = new Set();
  h.replace(/<label[^>]*\sfor=["']([^"']+)["']/gi, (_, id) => { labelFor.add(id); return _; });
  const unlabelled = [];
  const fieldRe = /<(input|select|textarea)\b([^>]*)>/gi;
  let m;
  while ((m = fieldRe.exec(h))) {
    const attrs = m[2];
    if (/\stype=["']?(hidden|submit|button|reset|image)\b/i.test(attrs)) continue;
    if (/\saria-label(ledby)?=["'][^"']+["']/i.test(attrs)) continue;
    const id = (attrs.match(/\sid=["']([^"']+)["']/i) || [])[1];
    if (id && labelFor.has(id)) continue;
    // A field wrapped in its label is labelled.
    const before = h.slice(Math.max(0, m.index - 400), m.index);
    const open = before.lastIndexOf('<label'); const close = before.lastIndexOf('</label>');
    if (open > close) continue;
    unlabelled.push(id || m[1]);
  }
  if (unlabelled.length) {
    problems.push('these fields have no label: ' + unlabelled.slice(0, 6).join(', '));
  }

  const external = [];
  const extRe = /<(script|link|img|iframe|source|video|audio|embed|object)\b[^>]*\s(?:src|href|data)=["']\s*(https?:|\/\/)/gi;
  while ((m = extRe.exec(h))) external.push(m[1].toLowerCase());
  if (/@import\s+url\(\s*['"]?https?:/i.test(h) || /url\(\s*['"]?https?:/i.test(h)) external.push('css url');
  if (external.length) {
    problems.push('it loads things from other sites (' + [...new Set(external)].join(', ')
      + '), which the preview blocks');
  }
  if (/\u2014/.test(h) || /&mdash;/i.test(h)) problems.push('it uses em-dashes');
  if (!/role=["']status["']/i.test(h) && /<(form|button)\b/i.test(h)) {
    problems.push('it has controls but no status region to say what they did');
  }
  if (h.length < 200) problems.push('it is too short to be a page');
  if (h.length > 400000) problems.push('it is too large');
  return { ok: problems.length === 0, problems };
}

// The brief, with its history. A fix or an edit carries the original words and the page being
// changed, because "the button is wrong" means nothing without the thing it is about.
async function briefFor(build) {
  const parts = [];
  let original = build;
  if (build.attempt_of) {
    const prev = (await query('SELECT * FROM builds WHERE id=$1', [build.attempt_of])).rows[0];
    if (prev) {
      original = prev;
      parts.push('The earlier version got something wrong. What the person says is wrong: '
        + build.asked_for);
    }
  }
  const basis = build.edit_of || build.attempt_of || build.mock_of;
  let basePage = null;
  if (basis) {
    basePage = (await query('SELECT html FROM build_pages WHERE build_id=$1', [basis])).rows[0];
  }
  const biz = (await query('SELECT name, trade, entity_type, formation_state FROM businesses WHERE id=$1',
    [build.business_id])).rows[0] || {};

  const lines = [];
  lines.push('Business: ' + (biz.name || 'unnamed') + (biz.trade ? ', which does ' + biz.trade : '') + '.');
  if (build.kind) lines.push('What is being built: a ' + build.kind + '.');
  if (build.edit_of) {
    lines.push('This is an EDIT to an existing page. Change only what is asked and keep everything '
      + 'else as it is.');
    lines.push('The change they asked for, in their words: ' + build.asked_for);
  } else {
    lines.push('What they asked for, in their words: ' + original.asked_for);
  }
  lines.push(...parts);
  if (basePage) lines.push('The current page:\n' + basePage.html);
  return lines.join('\n\n');
}

async function write(build, attemptProblems) {
  let user = await briefFor(build);
  if (attemptProblems && attemptProblems.length) {
    user += '\n\nYour previous attempt failed these checks, fix every one: '
      + attemptProblems.join('; ') + '.';
  }
  const r = await provider.complete({ system: SYSTEM, user, maxTokens: MAX_TOKENS, effort: 'low' });
  if (!r.ok) return { ok: false, unavailable: true, reason: r.reason === 'unavailable'
    ? 'no model is configured on this server' : (r.error || 'the model call failed') };
  const html = extractHtml(r.text);
  if (!html) return { ok: false, problems: ['it did not return an HTML document'] };
  const c = check(html);
  return { ok: c.ok, html, problems: c.problems, model: r.fallback_model || provider.modelName() };
}

const running = new Set();

// Build one. Claims it first so two processes, or a double click, never write the same build twice.
async function run(buildId) {
  if (running.has(buildId)) return { ok: false, reason: 'already running' };
  running.add(buildId);
  try {
    const claimed = await query(
      `UPDATE builds SET status='building', started_at=now(), updated_at=now()
        WHERE id=$1 AND (status='queued'
          OR (status='building' AND started_at < now() - interval '10 minutes'))
        RETURNING *`, [buildId]);
    const build = claimed.rows[0];
    if (!build) return { ok: false, reason: 'not waiting to be built' };

    let out = await write(build, null);
    if (out.unavailable) {
      await B.failed(build.id, 'I could not reach the model that writes pages ('
        + out.reason + '), so nothing was built and nothing is owed.');
      return { ok: false, reason: out.reason };
    }
    let first = out.problems;
    if (!out.ok) {
      out = await write(build, out.problems);
      if (out.unavailable) {
        await B.failed(build.id, 'The first version failed its checks and I could not reach the '
          + 'model to try again, so nothing was built.');
        return { ok: false, reason: out.reason };
      }
    }
    if (!out.ok) {
      await B.failed(build.id, 'I wrote it twice and it did not pass my own checks, so I am not '
        + 'calling it ready: ' + out.problems.join('; ') + '. Ask me to try again and I will.');
      return { ok: false, reason: 'checks failed', problems: out.problems };
    }

    await query(
      `INSERT INTO build_pages (build_id, html, checks) VALUES ($1,$2,$3)
       ON CONFLICT (build_id) DO UPDATE SET html=EXCLUDED.html, checks=EXCLUDED.checks,
         created_at=now()`,
      [build.id, out.html, JSON.stringify({ passed: true, first_attempt_problems: first || [],
        bytes: out.html.length })]);
    await query('UPDATE builds SET model=$2 WHERE id=$1', [build.id, out.model || null]);
    const url = SITE() + '/preview/' + build.preview_token;
    const done = await B.ready(build.id, { preview_url: url });
    return { ok: done.ok, url };
  } catch (e) {
    try {
      await B.failed(buildId, 'Something broke on our side while building this, so it is not '
        + 'ready: ' + e.message);
    } catch (_) { /* the failure is already in the log below */ }
    console.error('build ' + buildId + ' failed:', e.message);
    return { ok: false, reason: e.message };
  } finally {
    running.delete(buildId);
  }
}

// Fire and forget, with the failure recorded rather than lost.
function kick(buildId) {
  setImmediate(() => { run(buildId).catch((e) => console.error('build kick', e.message)); });
}

// After a restart, anything queued, or stuck building on a process that died, is picked up.
async function resume() {
  try {
    const r = await query(
      `SELECT id FROM builds WHERE status='queued'
          OR (status='building' AND started_at < now() - interval '10 minutes')
        ORDER BY created_at LIMIT 20`);
    for (const row of r.rows) await run(row.id);
    return r.rows.length;
  } catch (e) {
    console.error('build resume failed:', e.message);
    return -1;
  }
}

module.exports = { run, kick, resume, check, extractHtml, briefFor, SYSTEM };
