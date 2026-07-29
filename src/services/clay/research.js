// Clay's research capability — grounded, or honestly absent.
//
// The whole point of research here is to replace confident recall with real,
// cited sources. So: if a search backend is configured (SEARCH_API_KEY), we do
// a real web search and return results WITH their source URLs, so Clay can cite
// them and the user can verify. If it is NOT configured, we say so plainly and
// return nothing — Clay must never dress up model recall as researched fact.
//
// Backend: Tavily (built for LLM grounding; returns clean results + an optional
// synthesized answer, each tied to a source). Set SEARCH_API_KEY to a Tavily key
// (tvly-...). SEARCH_PROVIDER is reserved for future backends; Tavily is default.

function available() {
  return !!process.env.SEARCH_API_KEY;
}

async function search(query, { maxResults = 5 } = {}) {
  if (!available()) return { available: false, reason: 'not_configured', results: [] };
  const q = String(query || '').trim();
  if (!q) return { available: true, reason: 'empty_query', results: [] };
  try {
    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
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

module.exports = { available, search };
