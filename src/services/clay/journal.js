const { query } = require('../../config/db');

// Append-only audit journal. recordRun is best-effort by contract: a failure to
// journal must NEVER break or block a generation — the trail is for truth after
// the fact, not a dependency in the hot path. It also never fabricates: it writes
// only what actually happened (status, whether the provider was up, whether the
// run was grounded, and why it ended the way it did).
async function recordRun(f = {}) {
  try {
    await query(
      `INSERT INTO clay_runs
         (actor_id, kind, mode, category, concept_id, result_status,
          provider_available, grounded, source_count, reason, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        f.actorId || null,
        f.kind || 'generate',
        f.mode || null,
        f.category || null,
        f.conceptId || null,
        f.resultStatus || 'unknown',
        (typeof f.providerAvailable === 'boolean' ? f.providerAvailable : null),
        !!f.grounded,
        Number.isFinite(f.sourceCount) ? f.sourceCount : 0,
        f.reason ? String(f.reason).slice(0, 500) : null,
        Number.isFinite(f.durationMs) ? Math.round(f.durationMs) : null,
      ]
    );
  } catch (_) { /* the journal must never throw */ }
}

module.exports = { recordRun };
