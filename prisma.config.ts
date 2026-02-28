import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Get DATABASE_URL with fallback - handle case where it might not be set (e.g., during prisma generate)
function getDatabaseUrl(): string {
    // Check for remote database first
    if (process.env.USE_REMOTE_DB === 'true') {
        return process.env.DATABASE_REMOTE || process.env.ACCELERATE_URL || env('DATABASE_REMOTE') || env('ACCELERATE_URL') || 'postgresql://postgres:postgres@localhost:5432/tradenext';
    }
    try {
        return process.env.DATABASE_URL || env('DATABASE_URL') || 'postgresql://postgres:postgres@localhost:5432/tradenext';
    } catch (error) {
        // If env() throws, fall back to process.env or default
        return process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/tradenext';
    }
}

export default defineConfig({
    // path to your Prisma schema
    schema: 'prisma/schema.prisma',

    // where to place migrations (default)
    migrations: {
        path: 'prisma/migrations',
        seed: 'npx tsx prisma/seed.ts',
    },

    // supply the migration/runtime connection URL from env
    // (you can use DATABASE_URL or DIRECT_DATABASE_URL depending on your setup)
    datasource: {
        url: getDatabaseUrl(),
    },
});
