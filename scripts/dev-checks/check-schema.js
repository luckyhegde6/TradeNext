import { Pool } from 'pg';

const connectionString = 'postgresql://postgres:postgres@localhost:5432/tradenext';
const pool = new Pool({ connectionString });

async function checkSchema() {
  const client = await pool.connect();
  try {
    // Check if User table exists
    const tableResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'User'
    `);
    console.log("User table exists:", tableResult.rows.length > 0);
    
    if (tableResult.rows.length > 0) {
      const count = await client.query('SELECT COUNT(*) FROM "User"');
      console.log("Users count:", count.rows[0].count);
    }
  } catch (error) {
    console.error("Error:", error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

checkSchema();
