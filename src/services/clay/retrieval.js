const { query } = require('../../config/db');
const embeddings = require('./retrieval-embeddings');

// Retrieval grounding — find the user's OWN prior concepts most relevant to a new
// idea, so Clay can connect a fresh build to real earlier work instead of starting
// cold. Scoped strictly to the caller's concepts — never cross-user, because
// anonymity is a first-class promise here.
//
// Two layers, degrading honestly:
//   1. Semantic (pgvector) when an embedding provider is configured and the concept
//      has an embedding — connects ideas by MEANING.
//   2. Full-text (Postgres FTS) otherwise, and for any concept not yet embedded.
//
// Best-effort by contract: any failure returns [] so a build is never blocked or
// broken by retrieval, and it never fabricates a match.
async function relatedConcepts(userId, text, { limit = 3, excludeId = null } = {}) {
  const q = String(text || '').trim();
  if (!userId || q.length < 3) return [];

  // 1. Semantic first, when possible.
  if (embeddings.available()) {
    try {
      const vec = await embeddings.embed(q);
      if (vec) {
        const lit = embeddings.toVectorLiteral(vec);
        const r = await query(
          `SELECT id, title, category, risk_summary, (embedding <=> $2::vector) AS distance
             FROM concepts
            WHERE owner_id=$1 AND embedding IS NOT NULL AND ($4::uuid IS NULL OR id <> $4)
            ORDER BY embedding <=> $2::vector
            LIMIT $3`,
          [userId, lit, limit, excludeId]);
        // Keep only genuinely-close matches (cosine distance; lower = closer).
        const rows = r.rows.filter((x) => Number(x.distance) <= 0.6);
        if (rows.length) {
          return rows.map((x) => ({
            id: x.id, title: x.title, category: x.category || null,
            risk_summary: x.risk_summary || null,
            rank: Number((1 - Number(x.distance)).toFixed(4)), method: 'semantic',
          }));
        }
      }
    } catch (_) { /* fall through to full-text */ }
  }

  // 2. Full-text fallback.
  try {
    const r = await query(
      `WITH docs AS (
         SELECT c.id, c.title, c.category, c.risk_summary,
           to_tsvector('english',
             coalesce(c.title,'') || ' ' || coalesce(c.risk_summary,'') || ' ' ||
             coalesce((SELECT string_agg(a.body,' ') FROM assets a
                        WHERE a.concept_id=c.id AND a.is_current=true),'')
           ) AS doc
         FROM concepts c
         WHERE c.owner_id=$1 AND ($4::uuid IS NULL OR c.id <> $4)
       )
       SELECT id, title, category, risk_summary,
              ts_rank(doc, websearch_to_tsquery('english', $2)) AS rank
       FROM docs
       WHERE doc @@ websearch_to_tsquery('english', $2)
       ORDER BY rank DESC
       LIMIT $3`,
      [userId, q, limit, excludeId]);
    return r.rows.map((x) => ({
      id: x.id, title: x.title, category: x.category || null,
      risk_summary: x.risk_summary || null, rank: Number(x.rank), method: 'fulltext',
    }));
  } catch (_) {
    return [];
  }
}

// Best-effort: embed a concept and store the vector so future builds can find it
// semantically. Never throws, never blocks a build. A no-op without an embedding
// provider — the concept simply stays discoverable by full-text.
async function embedAndStore(conceptId, text) {
  if (!conceptId || !embeddings.available()) return;
  try {
    const vec = await embeddings.embed(text);
    if (!vec) return;
    await query('UPDATE concepts SET embedding=$2::vector WHERE id=$1',
      [conceptId, embeddings.toVectorLiteral(vec)]);
  } catch (_) { /* best-effort */ }
}

module.exports = { relatedConcepts, embedAndStore };
