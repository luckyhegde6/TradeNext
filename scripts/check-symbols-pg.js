import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: "postgresql://postgres:postgres@localhost:5432/tradenext"
});

async function main() {
  try {
    const client = await pool.connect();
    const res = await client.query('SELECT count(*) FROM symbols');
    console.log(`Total symbols in database: ${res.rows[0].count}`);
    
    const sample = await client.query('SELECT symbol, "companyName" FROM symbols LIMIT 5');
    console.log('Sample symbols:', JSON.stringify(sample.rows, null, 2));
    
    client.release();
  } catch (err) {
    console.error('Database connection error:', err);
  } finally {
    await pool.end();
  }
}

main();
