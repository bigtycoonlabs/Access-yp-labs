const { query } = require('../../config/db');

// Retrieval grounding — find the user's OWN prior concepts most relevant to a new
// idea, so Clay can connect a fresh build to real earlier work instead of starting
// cold. Deliberately scoped to the user's own concepts only — never cross-user,
// because anonymity is a first-class promise here. Postgres full-text for now,
// with a clean seam to swap in pgvector embeddings later without touching callers.
//
// Best-effort by contract: any failure returns [] so a build is never blocked or
// broken by retrieval, and it never fabricates a match.
async function relatedConcepts(userId, text, { limit = 3, excludeId = null } = {}) {
  const q = String(text || '').trim();
  if (!userId || q.length < 3) return [];
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
      [userId, q, limit, excludeId]
    );
    return r.rows.map((x) => ({
      id: x.id,
      title: x.title,
      category: x.category || null,
      risk_summary: x.risk_summary || null,
      rank: Number(x.rank),
    }));
  } catch (_) {
    return [];
  }
}

module.exports = { relatedConcepts };
