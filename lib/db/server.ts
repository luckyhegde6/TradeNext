// lib/db/server.ts
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

export const poolQuery = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
});
