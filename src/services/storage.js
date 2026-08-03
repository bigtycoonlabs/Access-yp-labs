// Object storage for generated images — keeps the database lean by putting image bytes in a
// Supabase Storage bucket and storing only a URL. Entirely optional: if the storage env vars
// aren't set (or an upload fails), the caller falls back to an inline data URL, so images always
// work. Uploads use the backend service role, which bypasses Storage RLS.
//
// Configure (Railway) to switch it on:
//   SUPABASE_URL              e.g. https://adcbrclppmnguzkzwiys.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_STORAGE_KEY) — a backend key with storage write access

const BUCKET = 'concept-images';

function baseUrl() { return (process.env.SUPABASE_URL || '').replace(/\/+$/, ''); }
function token() { return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_STORAGE_KEY || ''; }
function configured() { return !!baseUrl() && !!token(); }

function extFor(mediaType) {
  if (/jpe?g/i.test(mediaType || '')) return 'jpg';
  if (/webp/i.test(mediaType || '')) return 'webp';
  return 'png';
}

// A tidy object key: <conceptId>/<timestamp>-<rand>.<ext>
function keyFor(conceptId, mediaType) {
  const rand = Math.random().toString(36).slice(2, 8);
  return String(conceptId) + '/' + Date.now() + '-' + rand + '.' + extFor(mediaType);
}

function publicUrl(key) {
  return baseUrl() + '/storage/v1/object/public/' + BUCKET + '/' + key;
}

// Upload base64 image bytes. Returns { ok, url, key } or { ok:false, reason }.
async function uploadImage({ base64, mediaType, key }) {
  if (!configured()) return { ok: false, reason: 'unconfigured' };
  if (!base64) return { ok: false, reason: 'empty' };
  const objectKey = key || keyFor('misc', mediaType);
  const dest = baseUrl() + '/storage/v1/object/' + BUCKET + '/' + objectKey;
  try {
    const resp = await fetch(dest, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token(),
        'Content-Type': mediaType || 'image/png',
        'x-upsert': 'true',
      },
      body: Buffer.from(base64, 'base64'),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      return { ok: false, reason: 'upload_failed', status: resp.status, detail: String(detail).slice(0, 200) };
    }
    return { ok: true, url: publicUrl(objectKey), key: objectKey };
  } catch (err) {
    return { ok: false, reason: 'error', message: err && err.message };
  }
}

module.exports = { configured, uploadImage, keyFor, publicUrl, extFor, BUCKET };
