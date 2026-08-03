const { Pool } = require('pg');

// Pin every connection to the yp_labs schema. This is a hard isolation
// guarantee: unqualified queries can only ever touch YP Labs tables, never
// yp_flow_arbo (YP Flow) or public (Access Your Place).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  options: '-c search_path=yp_labs',
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
