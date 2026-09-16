// KEYS: the secrets a business lets Penny use.
//
// THE RULES, in the order they matter:
//   A key is checked before it is kept. A key that does not work is not saved, and the person is told
//   what it can reach before they rely on it.
//   A key is never shown again. Not to the owner, not to staff, not to Penny. Only the service, the
//   last four characters, what the check found, and when it was last used.
//   Penny never sees a key. Her tools say what to do with the business's key; the server uses it.
//   A key in the chat is taken out before the message is stored or reaches the model.
//   Every key says when to replace it, and that date goes on Today.

const { query } = require('../../config/db');
const P = require('../../lib/permissions');
const V = require('../../lib/vault');

const ROTATE_DAYS = 90;
const SERVICES = {
  github: 'GitHub',
  railway: 'Railway',
  supabase: 'Supabase',
};

// Shapes we can recognise with confidence. `keep` says whether Keys stores it; the rest are still taken
// out of the chat, because a secret in a conversation is a leak whatever it is for.
const SHAPES = [
  { service: 'github', keep: true, name: 'GitHub key', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{60,255})\b/g },
  { service: 'supabase', keep: true, name: 'Supabase access token', re: /\bsbp_[A-Za-z0-9]{40,}\b/g },
  { service: 'supabase', keep: false, name: 'Supabase secret key', re: /\bsb_secret_[A-Za-z0-9_-]{16,}\b/g },
  { service: null, keep: false, name: 'service key', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { service: null, keep: false, name: 'OpenAI key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { service: null, keep: false, name: 'Stripe secret key', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
];
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// A bare UUID is only treated as a Railway key when the same message says so. Anything else is an ID.
const RAILWAY_CONTEXT = /\brailway\b[\s\S]{0,80}\b(token|key)\b|\b(token|key)\b[\s\S]{0,80}\brailway\b/i;

function detect(text) {
  const t = String(text || '');
  const found = [];
  for (const s of SHAPES) {
    for (const m of t.matchAll(s.re)) {
      found.push({ service: s.service, keep: s.keep, name: s.name, value: m[0], index: m.index });
    }
  }
  if (RAILWAY_CONTEXT.test(t)) {
    for (const m of t.matchAll(UUID)) {
      found.push({ service: 'railway', keep: true, name: 'Railway key', value: m[0], index: m.index, guessed: true });
    }
  }
  // Longest first, so a JWT inside something else is not taken twice.
  return found.sort((a, b) => a.index - b.index)
    .filter((f, i, all) => !all.some((g, j) => j < i && f.index >= g.index && f.index < g.index + g.value.length));
}

function redact(text, found) {
  let out = String(text || '');
  for (const f of found) out = out.split(f.value).join('[' + f.name + ', removed from the chat]');
  return out;
}

// ------------------------------------------------------------------ checking a key before keeping it

async function fetchJson(url, opts) {
  const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(10000) }, opts));
  let body = null;
  try { body = await r.json(); } catch (_) { body = null; }
  return { status: r.status, ok: r.ok, body, headers: r.headers };
}

async function checkGithub(value) {
  const r = await fetchJson('https://api.github.com/user', {
    headers: { Authorization: 'Bearer ' + value, 'User-Agent': 'access-yp-labs', Accept: 'application/vnd.github+json' },
  });
  if (r.status === 401) return { ok: false, says: 'GitHub did not accept that key. It may be mistyped, expired or revoked.' };
  if (!r.ok || !r.body) return { ok: false, unreachable: true, says: 'I could not reach GitHub to check that key, so I did not keep it. Try again in a minute.' };
  const scopes = r.headers.get('x-oauth-scopes');
  const expires = r.headers.get('github-authentication-token-expiration');
  const fine = value.startsWith('github_pat_');
  const detail = { acts_as: r.body.login, kind: fine ? 'fine-grained' : 'classic', scopes: scopes || null, expires: expires || null };
  let says = 'It works, and acts as ' + r.body.login + ' on GitHub.';
  if (!fine) says += ' It is a classic key' + (scopes ? ' with access to ' + scopes : '') + '. A fine-grained key limited to one repository would be safer.';
  if (expires) says += ' GitHub says it expires ' + expires + '.';
  else if (!fine) says += ' It has no expiry date.';
  return { ok: true, detail, says };
}

async function checkRailway(value) {
  const gql = (headers, q) => fetchJson('https://backboard.railway.com/graphql/v2', {
    method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
    body: JSON.stringify({ query: q }),
  });
  let r = await gql({ Authorization: 'Bearer ' + value }, '{ me { email } }');
  if (r.ok && r.body && r.body.data && r.body.data.me) {
    return { ok: true, detail: { kind: 'account', acts_as: r.body.data.me.email },
      says: 'It works. It is an account key for ' + r.body.data.me.email + ', which can create projects.' };
  }
  r = await gql({ Authorization: 'Bearer ' + value }, '{ projects { edges { node { id } } } }');
  if (r.ok && r.body && r.body.data && r.body.data.projects) {
    const n = r.body.data.projects.edges.length;
    return { ok: true, detail: { kind: 'workspace', projects: n },
      says: 'It works. It is a workspace key that can see ' + n + (n === 1 ? ' project' : ' projects') + ', and can create new ones.' };
  }
  r = await gql({ 'Project-Access-Token': value }, '{ projectToken { projectId environmentId } }');
  if (r.ok && r.body && r.body.data && r.body.data.projectToken) {
    return { ok: true, detail: { kind: 'project', project_id: r.body.data.projectToken.projectId },
      says: 'It works, but it is a project key: it can deploy to one existing project and cannot create new ones. '
        + 'To launch a new app I will need an account or workspace key.' };
  }
  if (r.status >= 500 || r.status === 0) return { ok: false, unreachable: true, says: 'I could not reach Railway to check that key, so I did not keep it.' };
  return { ok: false, says: 'Railway did not accept that key. It may be mistyped or revoked.' };
}

async function checkSupabase(value) {
  if (!value.startsWith('sbp_')) {
    return { ok: false, says: 'For Supabase I need an access token, which starts with sbp_ and is made under Account, Access Tokens. A project\u2019s secret or service key is not the right one.' };
  }
  const r = await fetchJson('https://api.supabase.com/v1/projects', { headers: { Authorization: 'Bearer ' + value } });
  if (r.status === 401) return { ok: false, says: 'Supabase did not accept that token. It may be mistyped or revoked.' };
  if (!r.ok || !Array.isArray(r.body)) return { ok: false, unreachable: true, says: 'I could not reach Supabase to check that token, so I did not keep it.' };
  const n = r.body.length;
  return { ok: true, detail: { kind: 'access token', projects: n },
    says: 'It works, and can see ' + n + (n === 1 ? ' Supabase project' : ' Supabase projects') + '. Creating a new project can cost money, so I will always ask first.' };
}

const CHECKS = { github: checkGithub, railway: checkRailway, supabase: checkSupabase };

// ------------------------------------------------------------------ storing

const refuse = (gate) => ({ ok: false, kind: 'refused',
  says: P.refusalLine(gate, 'keys', gate.perms && gate.perms.business.name) });

async function save(viewer, business_id, { service, value, label, via }) {
  const gate = await P.can(viewer.id, business_id, 'keys', 'manage');
  if (!gate.ok) return refuse(gate);
  if (!SERVICES[service]) return { ok: false, kind: 'unclear', says: 'Keys holds GitHub, Railway and Supabase keys for now.' };
  const v = String(value || '').trim();
  if (v.length < 20 || v.length > 512 || /\s/.test(v)) return { ok: false, kind: 'unclear', says: 'That does not look like a whole key. Paste it again, with nothing before or after it.' };
  if (!V.ready()) return { ok: false, kind: 'unavailable', says: 'Key storage is not switched on for this site yet, so nothing was saved. The owner needs to set it up.' };

  let check;
  try { check = await CHECKS[service](v); } catch (e) {
    check = { ok: false, unreachable: true, says: 'I could not reach ' + SERVICES[service] + ' to check that key, so I did not keep it.' };
  }
  if (!check.ok) return { ok: false, kind: check.unreachable ? 'unavailable' : 'refused', says: check.says };

  const sealed = V.seal(v);
  const biz = gate.perms.business.name;
  // Replace it by 90 days, or a week before the service says it expires, whichever is sooner. A
  // reminder that arrives after the key has stopped working is not a reminder.
  let days = ROTATE_DAYS;
  const exp = check.detail && check.detail.expires ? Date.parse(String(check.detail.expires).replace(' UTC', 'Z').replace(' ', 'T')) : NaN;
  if (Number.isFinite(exp)) {
    const before = Math.floor((exp - Date.now()) / 86400000) - 7;
    days = Math.max(0, Math.min(ROTATE_DAYS, before));
  }
  try {
    const prev = (await query(
      // A replaced key is wiped, not just hidden. Walked 16 Sept 2026: replacing left the old
      // encrypted value in place while only removing did this.
      `UPDATE business_keys SET removed_at=now(), ciphertext='\\x00'::bytea
        WHERE business_id=$1 AND service=$2 AND removed_at IS NULL
       RETURNING rotation_obligation_id`, [business_id, service])).rows;
    for (const p of prev) {
      if (p.rotation_obligation_id) {
        await query(`UPDATE obligations SET status='superseded', updated_at=now() WHERE id=$1 AND status='open'`,
          [p.rotation_obligation_id]);
      }
    }
    const k = (await query(
      `INSERT INTO business_keys (business_id, service, label, ciphertext, iv, tag, key_version, last4,
          checked, added_by, added_via, rotate_after)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now() + make_interval(days => $12))
       RETURNING id, rotate_after`,
      [business_id, service, label ? String(label).slice(0, 80) : null, sealed.ciphertext, sealed.iv, sealed.tag,
        sealed.version, v.slice(-4), JSON.stringify(check.detail || {}), viewer.id, via === 'penny' ? 'penny' : 'person',
        days])).rows[0];
    const ob = await query(
      `INSERT INTO obligations (business_id, kind, title, detail, counterparty, counterparty_kind, due_at,
          cost_basis, consequence, source, source_ref)
       VALUES ($1,'renewal',$2,$3,$4,'self',$5,'unknown',$6,'penny',$7) RETURNING id`,
      [business_id, 'Replace your ' + SERVICES[service] + ' key',
        'Make a new key in ' + SERVICES[service] + ', add it on the Keys page, then delete the old one there.',
        SERVICES[service], k.rotate_after,
        'A key that is never replaced is the one most likely to be leaked and still working.',
        'key ' + k.id]);
    await query('UPDATE business_keys SET rotation_obligation_id=$2 WHERE id=$1', [k.id, ob.rows[0].id]);
    await logUse(k.id, 'saved and checked', viewer.id, via === 'penny' ? 'penny' : 'person', true);
    return { ok: true, key: { id: k.id, service, last4: v.slice(-4) },
      says: 'Saved your ' + SERVICES[service] + ' key for ' + biz + ', encrypted. ' + check.says
        + ' It ends in ' + v.slice(-4) + '. I put a reminder on Today to replace it in ' + days
        + (days === 1 ? ' day' : ' days') + (days < ROTATE_DAYS ? ', a week before it expires' : '')
        + (prev.length ? ', and the key it replaces is no longer used.' : '.') };
  } catch (e) {
    return { ok: false, kind: 'unavailable', says: 'I could not save that key, so it is not stored. ' + e.message };
  }
}

async function list(viewer, business_id) {
  const gate = await P.can(viewer.id, business_id, 'keys', 'view');
  if (!gate.ok) return refuse(gate);
  try {
    const r = await query(
      `SELECT k.id, k.service, k.label, k.last4, k.checked, k.added_via, k.rotate_after, k.last_used_at,
              k.created_at, u.name AS added_by_name,
              (SELECT json_agg(json_build_object('action', x.action, 'via', x.via, 'ok', x.ok, 'at', x.created_at)
                  ORDER BY x.created_at DESC) FROM (SELECT * FROM key_uses WHERE key_id=k.id
                  ORDER BY created_at DESC LIMIT 5) x) AS recent_uses
         FROM business_keys k LEFT JOIN users u ON u.id=k.added_by
        WHERE k.business_id=$1 AND k.removed_at IS NULL ORDER BY k.service`, [business_id]);
    const have = r.rows.map((k) => k.service);
    const missing = Object.keys(SERVICES).filter((s) => !have.includes(s)).map((s) => SERVICES[s]);
    const due = r.rows.filter((k) => new Date(k.rotate_after) < new Date()).map((k) => SERVICES[k.service]);
    let says = r.rows.length ? 'Keys on file: ' + r.rows.map((k) => SERVICES[k.service] + ' ending ' + k.last4).join(', ') + '.'
      : 'No keys on file yet.';
    if (missing.length) says += ' Not on file: ' + missing.join(', ') + '.';
    if (due.length) says += ' Due to be replaced: ' + due.join(', ') + '.';
    return { ok: true, keys: r.rows, services: SERVICES, vault_ready: V.ready(), says };
  } catch (e) {
    return { ok: false, kind: 'unavailable', says: 'I could not read your keys, so I do not know what is on file. ' + e.message };
  }
}

async function remove(viewer, id) {
  const k = (await query('SELECT * FROM business_keys WHERE id=$1 AND removed_at IS NULL', [id])).rows[0];
  if (!k) return { ok: false, kind: 'unavailable', says: 'I cannot find that key.' };
  const gate = await P.can(viewer.id, k.business_id, 'keys', 'manage');
  if (!gate.ok) return refuse(gate);
  // The encrypted value is wiped, not just hidden.
  await query(`UPDATE business_keys SET removed_at=now(), ciphertext='\\x00'::bytea WHERE id=$1`, [id]);
  if (k.rotation_obligation_id) {
    await query(`UPDATE obligations SET status='superseded', updated_at=now() WHERE id=$1 AND status='open'`, [k.rotation_obligation_id]);
  }
  await logUse(id, 'removed', viewer.id, 'person', true);
  return { ok: true, says: 'Removed the ' + SERVICES[k.service] + ' key ending ' + k.last4 + '. I can no longer use it. '
    + 'It still works at ' + SERVICES[k.service] + ' until you revoke it there, which is worth doing if it may have leaked.' };
}

async function logUse(keyId, action, actorId, via, ok) {
  try {
    await query('INSERT INTO key_uses (key_id, action, actor_id, via, ok) VALUES ($1,$2,$3,$4,$5)',
      [keyId, String(action).slice(0, 120), actorId || null, via, !!ok]);
  } catch (e) { console.error('key use not logged:', e.message); }
}

// ------------------------------------------------------------------ using a key, server side only
//
// The only place a key is ever decrypted. It is handed to `fn` for one job and never returned; the use
// is logged whether the job works or not. Nothing a person or Penny can call reaches this directly:
// only a confirmed launch step does.
async function withKey(business_id, service, { action, actor_id, via }, fn) {
  const k = (await query(
    `SELECT * FROM business_keys WHERE business_id=$1 AND service=$2 AND removed_at IS NULL`,
    [business_id, service])).rows[0];
  if (!k) return { ok: false, missing: true, says: 'There is no ' + SERVICES[service] + ' key on file. Add one on the Keys page.' };
  let value;
  try {
    value = V.open({ ciphertext: k.ciphertext, iv: k.iv, tag: k.tag, version: k.key_version });
  } catch (e) {
    await logUse(k.id, action + ' (could not unlock)', actor_id, via, false);
    return { ok: false, says: 'I could not unlock the ' + SERVICES[service] + ' key, so nothing was done. Add it again on the Keys page.' };
  }
  let out;
  try {
    out = await fn(value, { checked: k.checked || {}, last4: k.last4 });
  } catch (e) {
    out = { ok: false, says: SERVICES[service] + ' did not complete that: ' + e.message };
  } finally {
    value = null;
  }
  await logUse(k.id, action, actor_id, via, !!(out && out.ok));
  await query('UPDATE business_keys SET last_used_at=now() WHERE id=$1', [k.id]).catch(() => {});
  return out;
}

// ------------------------------------------------------------------ keys pasted into the chat

// Takes keys out of every message before anything else sees them. Returns the cleaned messages and
// what was found, without the values in any string that could be logged.
function scrub(messages) {
  const found = [];
  const clean = (messages || []).map((m) => {
    if (!m || typeof m.content !== 'string') return m;
    const hits = detect(m.content);
    if (!hits.length) return m;
    // Each distinct key once, however many times it was pasted, so it is checked and saved once.
    if (m.role === 'user') hits.forEach((h) => { if (!found.some((f) => f.value === h.value)) found.push(h); });
    return Object.assign({}, m, { content: redact(m.content, hits) });
  });
  return { messages: clean, found };
}

// After a scrub: store what can be stored, and say plainly what happened to each one.
async function takeFromChat(viewer, found) {
  if (!found.length) return null;
  const lines = [];
  const mine = await P.myBusinesses(viewer.id).catch(() => []);
  const biz = [];
  for (const b of mine || []) {
    if ((await P.can(viewer.id, b.id, 'keys', 'manage')).ok) biz.push(b);
  }
  for (const f of found) {
    if (!f.keep) {
      lines.push('I removed a ' + f.name + ' from our chat and did not keep it. If it is a live key, it is worth replacing, because it was typed into a conversation.');
      continue;
    }
    if (biz.length !== 1) {
      lines.push('I removed a ' + f.name + ' from our chat. ' + (biz.length
        ? 'You run more than one business, so add it on the Keys page for the right one.'
        : 'Add a business first, then add the key on the Keys page.'));
      continue;
    }
    const r = await save(viewer, biz[0].id, { service: f.service, value: f.value, via: 'penny' });
    lines.push('I removed a ' + f.name + ' from our chat. ' + (r.ok ? r.says
      : 'I did not keep it: ' + r.says + ' You can add it on the Keys page.'));
  }
  return lines.join(' ');
}

module.exports = { SERVICES, ROTATE_DAYS, detect, redact, scrub, save, list, remove, takeFromChat, logUse, withKey };
