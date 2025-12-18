// lib/db/server.ts
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

export const poolQuery = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    query_timeout: 10000, // 10 second query timeout
});
