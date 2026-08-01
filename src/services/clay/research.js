// Clay's research capability — grounded, or honestly absent.
//
// The whole point of research here is to replace confident recall with real,
// cited sources. So: when a search backend is available, we do a real web search
// and return results WITH their source URLs, so Clay can cite them and the user
// can verify. When none is available, we say so plainly and return nothing —
// Clay must never dress up model recall as researched fact.
//
// Two backends, in preference order:
//   1. Tavily (SEARCH_API_KEY, tvly-...) — purpose-built for LLM grounding, cheap
//      and fast, returns clean results + a synthesized answer. Preferred if set.
//   2. OpenAI's own hosted web_search tool (via the Responses API) — needs NO extra
//      service or key beyond OPENAI_API_KEY, which the platform already uses. This
//      is why Clay can research on the OpenAI key alone: the model searches the live
//      web and returns a grounded synthesis with real url citations.
// SEARCH_PROVIDER is reserved for future backends; the above order is the default.

const provider = require('./provider');

function tavilyConfigured() { return !!process.env.SEARCH_API_KEY; }

function available() {
  if (tavilyConfigured()) return true;               // Tavily configured
  return provider.providerName() === 'openai';        // OpenAI can web-search natively — no extra service
}

async function search(query, { maxResults = 5 } = {}) {
  const q = String(query || '').trim();
  if (!q) return { available: available(), reason: 'empty_query', results: [] };
  if (tavilyConfigured()) return tavilySearch(q, { maxResults });
  if (provider.providerName() === 'openai') return provider.webSearch(q, { maxResults });
  return { available: false, reason: 'not_configured', results: [] };
}

async function tavilySearch(q, { maxResults = 5 } = {}) {
  try {
    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SEARCH_API_KEY}`,
      },
      body: JSON.stringify({
        // api_key in the body too, for compatibility with older Tavily auth.
        api_key: process.env.SEARCH_API_KEY,
        query: q.slice(0, 400),
        max_results: Math.min(Math.max(maxResults, 1), 8),
        search_depth: 'basic',
        include_answer: true,
      }),
    });
    if (!resp.ok) return { available: true, reason: `search_${resp.status}`, results: [] };
    const data = await resp.json();
    const results = (data.results || []).slice(0, maxResults).map((r) => ({
      title: r.title || '',
      url: r.url || '',
      snippet: String(r.content || '').slice(0, 500),
    }));
    return { available: true, results, answer: data.answer || null };
  } catch (err) {
    return { available: true, reason: err.message, results: [] };
  }
}

// Pull the fuller, cleaned text of a specific source URL so Clay can verify
// specifics (a number, a claim, a regulation) before citing it — the "read the
// source in depth" step of a real research loop. Tavily-only; degrades honestly
// when Tavily isn't configured (the OpenAI backend already returns grounded
// synthesis inline, so a separate extract step isn't required there).
async function extract(url) {
  if (!tavilyConfigured()) return { available: false, reason: 'not_configured', content: '' };
  const u = String(url || '').trim();
  if (!u) return { available: true, reason: 'empty_url', content: '' };
  try {
    const resp = await fetch('https://api.tavily.com/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SEARCH_API_KEY}`,
      },
      body: JSON.stringify({ api_key: process.env.SEARCH_API_KEY, urls: [u] }),
    });
    if (!resp.ok) return { available: true, reason: `extract_${resp.status}`, content: '' };
    const data = await resp.json();
    const first = (data.results || [])[0];
    const content = first ? String(first.raw_content || first.content || '').slice(0, 4000) : '';
    return { available: true, url: u, content };
  } catch (err) {
    return { available: true, reason: err.message, content: '' };
  }
}

module.exports = { available, search, extract };
