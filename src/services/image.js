// Image rendering seam — DORMANT until an image provider key is set.
//
// Provider-agnostic by design: set IMAGE_API_KEY and IMAGE_API_URL (and
// optionally IMAGE_MODEL). With no key configured, renderImage reports
// 'unavailable' honestly and never fabricates an image. Some providers (e.g.
// Together AI's FLUX endpoint) want extra body fields — width, height, steps,
// n, response_format — so those are sent ONLY when their env vars are set,
// which keeps this generic (behavior is unchanged when they're absent) while
// letting a real provider be configured entirely from env, no code change.
const API_URL = () => process.env.IMAGE_API_URL || '';
const MODEL = () => process.env.IMAGE_MODEL || '';

function configured() { return !!process.env.IMAGE_API_KEY && !!API_URL(); }

// Parse an optional numeric env var; undefined (not sent) when unset or non-numeric.
function numEnv(name) {
  const v = process.env[name];
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// Build the request body. Only the prompt (and model, if set) are always sent; width/height/steps/n
// and response_format are added only when their env vars are present, so unconfigured providers see
// exactly the old minimal body. For Together's FLUX models, set IMAGE_STEPS (schnell likes 4) and
// IMAGE_RESPONSE_FORMAT=b64_json so bytes come back directly and can be stored permanently.
function requestBody(prompt) {
  const body = { prompt };
  if (MODEL()) body.model = MODEL();
  const w = numEnv('IMAGE_WIDTH'); if (w !== undefined) body.width = w;
  const h = numEnv('IMAGE_HEIGHT'); if (h !== undefined) body.height = h;
  const steps = numEnv('IMAGE_STEPS'); if (steps !== undefined) body.steps = steps;
  const n = numEnv('IMAGE_N'); if (n !== undefined) body.n = n;
  const rf = process.env.IMAGE_RESPONSE_FORMAT; if (rf) body.response_format = rf;
  return body;
}

async function renderImage({ prompt }) {
  if (!prompt || !String(prompt).trim()) return { status: 'empty', message: 'No prompt was provided.' };
  if (!configured()) {
    return { status: 'unavailable',
      message: 'Image rendering is not configured yet. Add an image provider key (IMAGE_API_KEY and IMAGE_API_URL) to turn it on. Nothing was fabricated.' };
  }
  try {
    const resp = await fetch(API_URL(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.IMAGE_API_KEY },
      body: JSON.stringify(requestBody(prompt)),
    });
    if (!resp.ok) {
      // Surface the provider's own error text (truncated) so a failure is diagnosable — e.g. a
      // wrong model name or a missing param — instead of a bare status code. Never fabricated.
      const detail = await resp.text().catch(() => '');
      return { status: 'unavailable',
        message: `Image provider returned ${resp.status}. Nothing was fabricated.` + (detail ? ' Provider said: ' + String(detail).slice(0, 300) : ''),
        provider_status: resp.status, detail: String(detail).slice(0, 500) };
    }
    const data = await resp.json().catch(() => ({}));
    // Accept the common response shapes so most providers work with a config-only change.
    const b64 = data.image_base64 || data.b64_json
      || (data.data && data.data[0] && data.data[0].b64_json) || null;
    const url = data.url || data.image_url
      || (data.data && data.data[0] && data.data[0].url)
      || (Array.isArray(data.images) ? (data.images[0] && (data.images[0].url || data.images[0])) : null) || null;
    if (!b64 && !url) return { status: 'empty', message: 'The image provider returned no image.' };
    return { status: 'answered', image_base64: b64, url, media_type: data.media_type || 'image/png' };
  } catch (err) {
    return { status: 'unavailable', message: `Could not reach the image provider: ${err.message}. Nothing was fabricated.` };
  }
}

// Host of the configured provider (for status readouts), e.g. 'api.together.xyz'. Null if unset.
function providerHost() {
  try { return new URL(API_URL()).host || null; } catch (_) { return null; }
}

module.exports = { configured, renderImage, providerHost, _requestBody: requestBody };
