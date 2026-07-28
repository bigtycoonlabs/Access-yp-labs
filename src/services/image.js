// Image rendering seam — DORMANT until an image provider key is set.
//
// Provider-agnostic by design: set IMAGE_API_KEY and IMAGE_API_URL (and
// optionally IMAGE_MODEL). With no key configured, renderImage reports
// 'unavailable' honestly and never fabricates an image. When a provider is
// chosen (e.g. an aggregator like fal/Replicate, or Imagen/Flux/Ideogram),
// finalize the request/response adapter below to match its exact contract.
const API_URL = () => process.env.IMAGE_API_URL || '';
const MODEL = () => process.env.IMAGE_MODEL || '';

function configured() { return !!process.env.IMAGE_API_KEY && !!API_URL(); }

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
      body: JSON.stringify({ prompt, model: MODEL() || undefined }),
    });
    if (!resp.ok) return { status: 'unavailable', message: `Image provider returned ${resp.status}. Nothing was fabricated.` };
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

module.exports = { configured, renderImage };
