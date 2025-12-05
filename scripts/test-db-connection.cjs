const { Client } = require('pg');

const connectionString = 'postgresql://postgres:postgres@localhost:5432/tradenext';

console.log(`Testing connection to: ${connectionString}`);

const client = new Client({
  connectionString,
});

async function testConnection() {
  try {
    await client.connect();
    console.log('Successfully connected to the database!');
    const res = await client.query('SELECT NOW()');
    console.log('Current time from DB:', res.rows[0].now);
    await client.end();
  } catch (err) {
    console.error('Connection error:', err);
    process.exit(1);
  }
}

testConnection();
