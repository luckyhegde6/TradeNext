import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: "postgresql://postgres:postgres@localhost:5432/tradenext"
});

async function main() {
  try {
    const client = await pool.connect();
    console.log('Cleaning up symbols table...');
    
    const res = await client.query(`
      UPDATE symbols 
      SET 
        symbol = TRIM(BOTH FROM symbol),
        "companyName" = TRIM(BOTH FROM "companyName")
      WHERE symbol LIKE '%\n%' OR "companyName" LIKE '%\n%' OR symbol LIKE '% ' OR "companyName" LIKE '% '
    `);
    
    console.log(`Updated ${res.rowCount} symbols.`);
    
    // Also remove any control characters if necessary
    await client.query(`
      UPDATE symbols 
      SET 
        symbol = REGEXP_REPLACE(symbol, '[\\r\\n\\t]+', '', 'g'),
        "companyName" = REGEXP_REPLACE("companyName", '[\\r\\n\\t]+', ' ', 'g')
    `);
    
    console.log('Control characters removed.');
    
    const sample = await client.query('SELECT symbol, "companyName" FROM symbols LIMIT 5');
    console.log('Sample cleaned symbols:', JSON.stringify(sample.rows, null, 2));
    
    client.release();
  } catch (err) {
    console.error('Error cleaning symbols:', err);
  } finally {
    await pool.end();
  }
}

main();
