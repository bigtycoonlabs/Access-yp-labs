// FILES AND PHOTOS.
//
// WHAT THIS REFUSES, AND WHY.
//   HTML, SVG and anything executable. A file served from our origin that a browser will run is a
//   way to read somebody's session, and SVG is HTML with a different extension. A business that needs
//   to keep one can zip it.
//   A type decided by the browser. The browser says what the file claims to be; the first bytes say
//   what it is. We store what it is.
//
// A PHOTO IS DESCRIBED OUT LOUD. Both owners are blind. When a photo arrives Penny describes it and
// the description is labelled as hers. If she cannot, the photo says so, rather than having no
// description and looking finished.

const crypto = require('crypto');
const { query } = require('../../config/db');
const P = require('../../lib/permissions');

const MAX_BYTES = 10 * 1024 * 1024;
const SHARE_DEFAULT_DAYS = 7;
const SHARE_MAX_DAYS = 30;

// Magic numbers. Anything not here is refused by name.
function sniff(buf, claimedName) {
  const b = buf || Buffer.alloc(0);
  const head = b.subarray(0, 16);
  const hex = head.toString('hex');
  const ascii = b.subarray(0, 512).toString('latin1');
  const name = String(claimedName || '').toLowerCase();
  if (hex.startsWith('ffd8ff')) return { mime: 'image/jpeg', kind: 'photo', ext: 'jpg' };
  if (hex.startsWith('89504e470d0a1a0a')) return { mime: 'image/png', kind: 'photo', ext: 'png' };
  if (hex.startsWith('474946383')) return { mime: 'image/gif', kind: 'photo', ext: 'gif' };
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') {
    return { mime: 'image/webp', kind: 'photo', ext: 'webp' };
  }
  if (ascii.slice(4, 12) === 'ftypheic' || ascii.slice(4, 12) === 'ftypheix'
      || ascii.slice(4, 12) === 'ftypmif1') {
    return { mime: 'image/heic', kind: 'photo', ext: 'heic' };
  }
  if (ascii.startsWith('%PDF-')) return { mime: 'application/pdf', kind: 'document', ext: 'pdf' };
  if (hex.startsWith('504b0304')) {
    // Office files are zips. Which one is decided by the parts inside, not the name alone.
    if (ascii.includes('word/') || name.endsWith('.docx')) {
      return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        kind: 'document', ext: 'docx' };
    }
    if (ascii.includes('xl/') || name.endsWith('.xlsx')) {
      return { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        kind: 'spreadsheet', ext: 'xlsx' };
    }
    if (ascii.includes('ppt/') || name.endsWith('.pptx')) {
      return { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        kind: 'document', ext: 'pptx' };
    }
    return { mime: 'application/zip', kind: 'other', ext: 'zip' };
  }
  if (/^\s*(<!doctype|<html|<svg|<\?xml|<script)/i.test(ascii)) {
    return { refused: 'web pages and SVG images can run code when opened, so I do not keep them. '
      + 'Zip it first if you need to store it.' };
  }
  if (hex.startsWith('4d5a') || hex.startsWith('7f454c46') || ascii.startsWith('#!')) {
    return { refused: 'that is a program, and I do not keep programs.' };
  }
  // Plain text: valid UTF-8 with no control characters beyond whitespace.
  const text = b.toString('utf8');
  if (!text.includes('\uFFFD') && !/[\u0000-\u0008\u000E-\u001F]/.test(text.slice(0, 4096))) {
    if (name.endsWith('.csv')) return { mime: 'text/csv', kind: 'spreadsheet', ext: 'csv' };
    return { mime: 'text/plain', kind: 'text', ext: 'txt' };
  }
  return { refused: 'I could not tell what kind of file that is, so I did not keep it.' };
}

function cleanName(name, ext) {
  let n = String(name || '').replace(/[\\/\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n) n = 'file';
  if (n.length > 180) n = n.slice(0, 180);
  if (ext && !n.toLowerCase().endsWith('.' + ext)) n = n.replace(/\.[a-z0-9]{1,5}$/i, '') + '.' + ext;
  return n;
}

const gateLine = (gate) => P.refusalLine(gate, 'documents', gate.perms && gate.perms.business.name);

async function describePhoto(buf, mime) {
  if (mime === 'image/heic') {
    return { ok: false, says: 'I cannot look at HEIC photos yet, so this one has no description. '
      + 'Add one yourself, or upload it as a JPEG.' };
  }
  let provider;
  try { provider = require('./provider'); } catch (_) { provider = null; }
  if (!provider || !provider.available()) {
    return { ok: false, says: 'I could not describe this photo because no model is connected.' };
  }
  const r = await provider.describeImage({
    imageBase64: buf.toString('base64'), mediaType: mime, maxTokens: 2500,
    system: 'You describe photos for a person who is blind and runs a small business. Plain, '
      + 'factual, two to four sentences. Say what is in the photo and anything a business owner '
      + 'would need to know from it, such as visible damage, text, or the state of a room. Never '
      + 'guess at identities. Never use the em-dash character.',
    prompt: 'Describe this photo.',
  });
  const text = String(r.text || '').replace(/\u2014/g, ', ').trim();
  if (!r.ok || !text) {
    return { ok: false, says: 'I could not describe this photo just now, so it has no description '
      + 'yet. Add one yourself, or ask me to try again.' };
  }
  return { ok: true, text: text.slice(0, 2000) };
}

async function upload(viewer, { business_id, name, buffer, description }) {
  const gate = await P.can(viewer.id, business_id, 'documents', 'act');
  if (!gate.ok) return { ok: false, kind: 'refused', says: gateLine(gate) };
  if (!buffer || !buffer.length) return { ok: false, kind: 'unclear', says: 'That file is empty.' };
  if (buffer.length > MAX_BYTES) {
    return { ok: false, kind: 'refused', says: 'That file is '
      + (buffer.length / 1048576).toFixed(1) + ' MB. The limit is 10 MB a file for now.' };
  }
  const t = sniff(buffer, name);
  if (t.refused) return { ok: false, kind: 'refused', says: 'I did not keep ' + (name || 'that file') + ': ' + t.refused };

  let desc = description ? String(description).trim().slice(0, 2000) : null;
  let descBy = desc ? 'person' : null;
  let note = null;
  if (!desc && t.kind === 'photo') {
    const d = await describePhoto(buffer, t.mime);
    if (d.ok) { desc = d.text; descBy = 'penny'; } else { note = d.says; }
  }
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  try {
    const r = await query(
      `INSERT INTO files (business_id, uploaded_by, name, mime, kind, bytes, sha256, data,
          description, description_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, name, mime, kind, bytes, description, description_by, created_at`,
      [business_id, viewer.id, cleanName(name, t.ext), t.mime, t.kind, buffer.length, sha, buffer,
        desc, descBy]);
    const f = r.rows[0];
    let says = f.name + ' is saved.';
    if (descBy === 'penny') says += ' Here is what I see in it: ' + desc;
    if (note) says += ' ' + note;
    return { ok: true, file: f, says };
  } catch (e) {
    return { ok: false, kind: 'unavailable', says: 'I could not save ' + (name || 'that file')
      + ', so it is not stored. ' + e.message };
  }
}

// PENNY WRITING SOMETHING DOWN.
//
// The owner's point: she should not have to hold everything in her head. What is worth keeping gets
// written into the business's own documents, where the person can read it, edit the file, share it
// or delete it like anything else they own. It is not a hidden store she alone can see.
//
// It goes through the same upload as a file a person drops in, so the same permission, the same
// limit and the same record. A second way in is a second set of rules to keep in step.
async function write(viewer, { business_id, name, text, description }) {
  const body = String(text == null ? '' : text);
  if (!body.trim()) return { ok: false, kind: 'unclear', says: 'There was nothing to write, so nothing was saved.' };
  const clean = String(name || '').trim() || 'Note';
  const filename = /\.[a-z0-9]{1,5}$/i.test(clean) ? clean : clean + '.md';
  const r = await upload(viewer, {
    business_id, name: filename, buffer: Buffer.from(body, 'utf8'),
    description: description || 'Written by Penny.',
  });
  if (!r.ok) return r;
  return { ok: true, file: r.file, says: r.file.name + ' is saved in your documents.' };
}

// READING ONE BACK. Text only: a PDF or a photo is not something this can turn into words, and
// pretending otherwise would put invented contents into a conversation.
const READABLE = /^text\/|json$|^application\/xml$/;
async function read(viewer, id, { max = 20000 } = {}) {
  const g = await fileFor(viewer, id, 'see');
  if (!g.ok) return g;
  const f = g.file;
  if (!READABLE.test(f.mime)) {
    return { ok: false, kind: 'refused',
      says: f.name + ' is ' + f.mime + ', which I cannot read as words. I know it is there and what it '
        + 'is called' + (f.description ? ', and its note says: ' + f.description : '') + '.' };
  }
  if (!f.data) return { ok: false, kind: 'unavailable', says: f.name + ' has no contents stored.' };
  const text = Buffer.from(f.data).toString('utf8');
  const cut = text.length > max;
  return { ok: true, name: f.name, text: cut ? text.slice(0, max) : text, truncated: cut,
    says: cut ? 'This is the first part of ' + f.name + '; it is longer than I read in one go.' : null };
}

async function list(viewer, business_id) {
  const gate = await P.can(viewer.id, business_id, 'documents', 'view');
  if (!gate.ok) return { ok: false, kind: 'refused', says: gateLine(gate) };
  try {
    const r = await query(
      `SELECT f.id, f.name, f.mime, f.kind, f.bytes, f.description, f.description_by, f.created_at,
              u.name AS uploaded_by_name,
              (SELECT json_agg(json_build_object('id', s.id, 'shared_with', s.shared_with,
                  'expires_at', s.expires_at, 'opens', s.opens, 'token', s.token)
                  ORDER BY s.created_at DESC)
                 FROM file_shares s
                WHERE s.file_id = f.id AND s.revoked_at IS NULL AND s.expires_at > now()) AS shares
         FROM files f LEFT JOIN users u ON u.id = f.uploaded_by
        WHERE f.business_id = $1 AND f.deleted_at IS NULL
        ORDER BY f.created_at DESC LIMIT 200`, [business_id]);
    const rows = r.rows.map((x) => Object.assign(x, { shares: x.shares || [] }));
    return { ok: true, files: rows, says: summarise(rows) };
  } catch (e) {
    return { ok: false, kind: 'unavailable', says: 'I could not read your files, so I do not know '
      + 'what is here. That is not the same as there being nothing. ' + e.message };
  }
}

function summarise(rows) {
  if (!rows.length) return 'No files yet. Add photos, contracts or anything else the business keeps.';
  const photos = rows.filter((r) => r.kind === 'photo').length;
  const undescribed = rows.filter((r) => r.kind === 'photo' && !r.description).length;
  const shared = rows.filter((r) => r.shares && r.shares.length).length;
  let s = rows.length === 1 ? 'One file' : rows.length + ' files';
  if (photos) s += ', ' + (photos === 1 ? 'one of them a photo' : photos + ' of them photos');
  s += '.';
  if (undescribed) {
    s += ' ' + (undescribed === 1 ? 'One photo has' : undescribed + ' photos have')
      + ' no description yet.';
  }
  if (shared) s += ' ' + (shared === 1 ? 'One is' : shared + ' are') + ' shared by a link that is still open.';
  return s;
}

async function fileFor(viewer, id, level) {
  const f = (await query('SELECT * FROM files WHERE id=$1 AND deleted_at IS NULL', [id])).rows[0];
  if (!f) return { ok: false, kind: 'unavailable', says: 'I cannot find that file.' };
  const gate = await P.can(viewer.id, f.business_id, 'documents', level);
  if (!gate.ok) return { ok: false, kind: 'refused', says: gateLine(gate) };
  return { ok: true, file: f };
}

async function update(viewer, id, { name, description }) {
  const g = await fileFor(viewer, id, 'act');
  if (!g.ok) return g;
  const newName = name != null ? cleanName(name, null) : g.file.name;
  const hasDesc = description !== undefined;
  const d = hasDesc ? (String(description || '').trim().slice(0, 2000) || null) : g.file.description;
  const by = hasDesc ? (d ? 'person' : null) : g.file.description_by;
  const r = await query(
    `UPDATE files SET name=$2, description=$3, description_by=$4, updated_at=now()
      WHERE id=$1 RETURNING id, name, description, description_by`, [id, newName, d, by]);
  return { ok: true, file: r.rows[0], says: 'Saved.' };
}

async function redescribe(viewer, id) {
  const g = await fileFor(viewer, id, 'act');
  if (!g.ok) return g;
  if (g.file.kind !== 'photo') return { ok: false, kind: 'refused', says: 'Only photos get a description from me.' };
  const d = await describePhoto(g.file.data, g.file.mime);
  if (!d.ok) return { ok: false, kind: 'unavailable', says: d.says };
  await query(`UPDATE files SET description=$2, description_by='penny', updated_at=now() WHERE id=$1`,
    [id, d.text]);
  return { ok: true, says: 'Here is what I see in it: ' + d.text };
}

async function remove(viewer, id) {
  const g = await fileFor(viewer, id, 'act');
  if (!g.ok) return g;
  // The bytes go now. Open share links die with the file.
  await query(`UPDATE files SET deleted_at=now(), data=NULL, updated_at=now() WHERE id=$1`, [id]);
  await query(`UPDATE file_shares SET revoked_at=now() WHERE file_id=$1 AND revoked_at IS NULL`, [id]);
  return { ok: true, says: g.file.name + ' is deleted, and any links to it have stopped working.' };
}

async function share(viewer, id, { days, shared_with }) {
  let n = parseInt(days, 10);
  if (!Number.isFinite(n) || n < 1) n = SHARE_DEFAULT_DAYS;
  if (n > SHARE_MAX_DAYS) {
    return { ok: false, kind: 'refused', says: 'A link can last up to 30 days. Make a new one after that.' };
  }
  const g = await fileFor(viewer, id, 'act');
  if (!g.ok) return g;
  const r = await query(
    `INSERT INTO file_shares (file_id, created_by, shared_with, expires_at)
     VALUES ($1,$2,$3, now() + make_interval(days => $4)) RETURNING id, token, expires_at, shared_with`,
    [id, viewer.id, shared_with ? String(shared_with).trim().slice(0, 120) : null, n]);
  const s = r.rows[0];
  const site = (process.env.CLIENT_URL || 'https://accessyplabs.com').replace(/\/+$/, '');
  return { ok: true, share: Object.assign(s, { url: site + '/f/' + s.token }),
    says: 'Anyone with this link can open ' + g.file.name + ' for ' + n
      + (n === 1 ? ' day' : ' days') + '. You can stop it any time.' };
}

async function revoke(viewer, shareId) {
  const s = (await query('SELECT * FROM file_shares WHERE id=$1', [shareId])).rows[0];
  if (!s) return { ok: false, kind: 'unavailable', says: 'I cannot find that link.' };
  const g = await fileFor(viewer, s.file_id, 'act');
  if (!g.ok) return g;
  await query('UPDATE file_shares SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL', [shareId]);
  return { ok: true, says: 'That link has stopped working.' };
}

async function openShared(token) {
  if (!/^[a-f0-9]{36}$/.test(String(token || ''))) return { ok: false };
  const r = await query(
    `UPDATE file_shares s SET opens = opens + 1, last_opened_at = now()
       FROM files f
      WHERE s.token = $1 AND s.file_id = f.id AND s.revoked_at IS NULL AND s.expires_at > now()
        AND f.deleted_at IS NULL
      RETURNING f.name, f.mime, f.kind, f.data`, [token]);
  return r.rows[0] ? { ok: true, file: r.rows[0] } : { ok: false };
}

module.exports = { upload, write, read, list, update, redescribe, remove, share, revoke, openShared, fileFor,
  sniff, cleanName, summarise, MAX_BYTES };
