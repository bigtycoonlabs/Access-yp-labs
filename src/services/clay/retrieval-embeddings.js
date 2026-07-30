// Embeddings for semantic retrieval. Embeddings need OpenAI specifically (there's
// no first-party Anthropic embeddings endpoint here), so this is available only
// when an OpenAI key is set — independent of which provider drives Clay's chat.
// Everything is honest: no key, or any failure, returns null and callers fall back
// to full-text search. It never fabricates a vector.
let OpenAI = null;
try { OpenAI = require('openai'); } catch (_) { /* optional */ }

const MODEL = process.env.CLAY_EMBED_MODEL || 'text-embedding-3-small';
const DIMS = 1536; // must match the concepts.embedding column

function available() { return !!(OpenAI && process.env.OPENAI_API_KEY); }

async function embed(text) {
  if (!available()) return null;
  const t = String(text || '').trim().slice(0, 6000);
  if (!t) return null;
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20000, maxRetries: 1 });
    const r = await client.embeddings.create({ model: MODEL, input: t });
    const v = r && r.data && r.data[0] && r.data[0].embedding;
    return Array.isArray(v) && v.length === DIMS ? v : null;
  } catch (_) { return null; }
}

// Render a float array as a pgvector literal: [0.1,0.2,...]
function toVectorLiteral(vec) {
  return '[' + vec.map((x) => Number(x)).join(',') + ']';
}

module.exports = { available, embed, toVectorLiteral, MODEL, DIMS };
