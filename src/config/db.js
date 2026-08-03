const { Pool } = require('pg');

// Pin every connection to the yp_labs schema FIRST. This is a hard isolation
// guarantee: unqualified queries resolve app objects only in yp_labs, never
// yp_flow_arbo (YP Flow) or public (Access Your Place) — those are not on the
// path, so a brand can never touch another brand's tables.
//
// `extensions` follows yp_labs on the path so pgvector's `vector` type and its
// `<=>` similarity operator resolve at runtime (Supabase installs pgvector in
// the `extensions` schema). This is required by the embedding writes/reads in
// seed.js and retrieval.js — without it, `::vector` casts throw
// `type "vector" does not exist`. yp_labs stays first, so every app table still
// resolves to yp_labs; `extensions` holds only extension types/operators (no
// tables), so cross-brand isolation is fully preserved.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  options: '-c search_path=yp_labs,extensions',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// A dropped IDLE client (the Supavisor pooler recycling a connection, a brief
// network blip) MUST NOT take the whole app down. The pool simply discards the
// bad client and opens a fresh one on the next query, so we only log it. The
// previous handler called process.exit(-1), which turned a routine, recoverable
// blip into a full process crash — and on a restart-limited host, a crash loop
// that could leave the entire site returning errors until it was redeployed.
pool.on('error', (err) => {
  console.error('Idle DB client error (pool will recover, not exiting):', err && err.message);
});

// A briefly saturated pool or a just-recycled connection throws *before* the
// statement is ever sent to Postgres, so retrying once is safe for reads and
// writes alike — nothing executed. We match only those connection-acquisition
// errors; every other error (real query/logic errors) propagates unchanged.
const TRANSIENT_CONNECT = /timeout exceeded when trying to connect|Connection terminated due to connection timeout/i;

async function query(text, params) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    if (err && TRANSIENT_CONNECT.test(err.message || '')) {
      await new Promise((r) => setTimeout(r, 250));
      return pool.query(text, params);
    }
    throw err;
  }
}

const getClient = () => pool.connect();

module.exports = { query, getClient, pool };
