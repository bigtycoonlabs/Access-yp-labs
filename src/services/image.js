// Image rendering seam.
//
// Two ways to be configured, tried in this order:
//   1. A DEDICATED image provider — set IMAGE_API_KEY + IMAGE_API_URL (+ optional IMAGE_MODEL and
//      IMAGE_WIDTH/HEIGHT/STEPS/RESPONSE_FORMAT). Use this for Together AI, fal, Replicate, etc.
//   2. NO dedicated provider, but Clay's OpenAI brain key is present — then image generation just
//      works with the OPENAI_API_KEY you ALREADY have. No new account, no new dashboard. It uses
//      OpenAI's image endpoint with dall-e-3 by default, which needs NO org verification (unlike the
//      gpt-image models). Turn this fallback off with IMAGE_OPENAI_FALLBACK=0.
// With neither, renderImage reports 'unavailable' honestly and never fabricates an image.

const API_URL = () => process.env.IMAGE_API_URL || '';
const MODEL = () => process.env.IMAGE_MODEL || '';
const OPENAI_IMAGE_URL = 'https://api.openai.com/v1/images/generations';
const OPENAI_IMAGE_MODEL_DEFAULT = 'dall-e-3';

function dedicatedConfigured() { return !!process.env.IMAGE_API_KEY && !!API_URL(); }
// The OpenAI fallback is on by default whenever the brain key exists — so images work with no extra
// setup — but can be switched off explicitly without unsetting the brain key.
function openaiFallbackOn() { return process.env.IMAGE_OPENAI_FALLBACK !== '0' && !!process.env.OPENAI_API_KEY; }
function configured() { return dedicatedConfigured() || openaiFallbackOn(); }

// Parse an optional numeric env var; undefined (not sent) when unset or non-numeric.
function numEnv(name) {
  const v = process.env[name];
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// Body for a DEDICATED provider (Together/fal/etc.). Only prompt (and model, if set) are always
// sent; width/height/steps/n/response_format are added only when their env vars are present, so an
// unconfigured provider sees exactly the old minimal body. For Together's FLUX models, set
// IMAGE_STEPS (schnell likes 4) and IMAGE_RESPONSE_FORMAT=b64_json so bytes come back directly.
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

// Which OpenAI image model the fallback uses. Defaults to dall-e-3 (no org verification needed).
// Deliberately does NOT read IMAGE_MODEL — that var names a dedicated-provider model (e.g. a Together
// FLUX id) and would be wrong to send to OpenAI.
function openaiImageModel() { return process.env.OPENAI_IMAGE_MODEL || OPENAI_IMAGE_MODEL_DEFAULT; }

// Body for OpenAI's image endpoint. dall-e models accept response_format:'b64_json' (we get the bytes
// directly, so images can be stored permanently); the gpt-image models REJECT response_format (they
// return b64_json by default), so it's never sent for those.
function openaiBody(prompt, model) {
  const size = process.env.IMAGE_SIZE || '1024x1024';
  const body = { model, prompt, n: 1, size };
  if (!/^gpt-image/i.test(model)) body.response_format = 'b64_json';
  return body;
}

// Resolve the active provider: dedicated first, then the OpenAI fallback, then none.
function resolveProvider() {
  if (dedicatedConfigured()) return { mode: 'dedicated', url: API_URL(), key: process.env.IMAGE_API_KEY, model: MODEL() || null };
  if (openaiFallbackOn()) return { mode: 'openai', url: OPENAI_IMAGE_URL, key: process.env.OPENAI_API_KEY, model: openaiImageModel() };
  return null;
}

async function renderImage({ prompt }) {
  if (!prompt || !String(prompt).trim()) return { status: 'empty', message: 'No prompt was provided.' };
  const prov = resolveProvider();
  if (!prov) {
    return { status: 'unavailable',
      message: 'Image rendering is not configured yet. Either set OPENAI_API_KEY so Clay can make images with its existing brain key, or add a dedicated image provider (IMAGE_API_KEY and IMAGE_API_URL). Nothing was fabricated.' };
  }
  try {
    const body = prov.mode === 'openai' ? openaiBody(prompt, prov.model) : requestBody(prompt);
    const resp = await fetch(prov.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + prov.key },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      // Surface the provider's own error text (truncated) so a failure is diagnosable — a wrong
      // model name, a missing param, an unverified org — instead of a bare status code. Never faked.
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

// Status helpers for the "check systems" readout.
function providerHost() {
  const prov = resolveProvider();
  if (!prov) return null;
  try { return new URL(prov.url).host || null; } catch (_) { return null; }
}
function activeMode() { const p = resolveProvider(); return p ? p.mode : null; }
function activeModel() { const p = resolveProvider(); return p ? (p.model || null) : null; }

module.exports = { configured, renderImage, providerHost, activeMode, activeModel, _requestBody: requestBody, _openaiBody: openaiBody };
