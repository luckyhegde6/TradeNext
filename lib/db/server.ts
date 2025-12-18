// lib/db/server.ts
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

export const poolQuery = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5, // Reduce max connections for serverless
    min: 0,
    idleTimeoutMillis: 15000, // Close idle connections after 15s
    connectionTimeoutMillis: 5000, // Connection timeout
    query_timeout: 30000, // 30 second query timeout
});
