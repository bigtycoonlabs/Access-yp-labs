// Video rendering seam — DORMANT until a video provider key is set.
// Mirrors the image seam. Provider-agnostic: VIDEO_API_KEY + VIDEO_API_URL
// (optional VIDEO_MODEL). Honest 'unavailable' with no key; never fabricates.
// Note: video is the most expensive path (dollars per clip) — render scripts
// first, and only wire a provider when there's real demand.
const API_URL = () => process.env.VIDEO_API_URL || '';
const MODEL = () => process.env.VIDEO_MODEL || '';

function configured() { return !!process.env.VIDEO_API_KEY && !!API_URL(); }

async function renderVideo({ prompt }) {
  if (!prompt || !String(prompt).trim()) return { status: 'empty', message: 'No script or prompt was provided.' };
  if (!configured()) {
    return { status: 'unavailable',
      message: 'Video rendering is not configured yet. Add a video provider key (VIDEO_API_KEY and VIDEO_API_URL) to turn it on. Nothing was fabricated.' };
  }
  try {
    const resp = await fetch(API_URL(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.VIDEO_API_KEY },
      body: JSON.stringify({ prompt, model: MODEL() || undefined }),
    });
    if (!resp.ok) return { status: 'unavailable', message: `Video provider returned ${resp.status}. Nothing was fabricated.` };
    const data = await resp.json().catch(() => ({}));
    const url = data.url || data.video_url
      || (data.data && data.data[0] && (data.data[0].url || data.data[0].video_url))
      || (Array.isArray(data.videos) ? (data.videos[0] && (data.videos[0].url || data.videos[0])) : null) || null;
    if (!url) return { status: 'empty', message: 'The video provider returned no video.' };
    return { status: 'answered', url };
  } catch (err) {
    return { status: 'unavailable', message: `Could not reach the video provider: ${err.message}. Nothing was fabricated.` };
  }
}

module.exports = { configured, renderVideo };
