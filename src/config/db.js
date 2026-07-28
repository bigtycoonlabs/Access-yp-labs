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

pool.on('error', (err) => {
  console.error('Unexpected DB client error:', err);
  process.exit(-1);
});

const query = (text, params) => pool.query(text, params);
const getClient = () => pool.connect();

module.exports = { query, getClient, pool };
