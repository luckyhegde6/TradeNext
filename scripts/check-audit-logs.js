import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: "postgresql://postgres:postgres@localhost:5432/tradenext"
});

async function main() {
  try {
    const client = await pool.connect();
    const res = await client.query('SELECT * FROM audit_logs ORDER BY "createdAt" DESC LIMIT 5');
    console.log('Recent Audit Logs:', JSON.stringify(res.rows, null, 2));
    client.release();
  } catch (err) {
    console.error('Database connection error:', err);
  } finally {
    await pool.end();
  }
}

main();
