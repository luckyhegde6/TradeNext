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

// DIRECT_URL holds the DIRECT connection string to Prisma Postgres
// (postgres://USER:PASSWORD@db.prisma.io:5432/?sslmode=require). Accelerate
// (prisma+postgres://accelerate.prisma-data.net) is a QUERY proxy — it cannot
// run migrations/DDL, so Prisma Migrate (deploy/dev/db push) must connect
// directly. When DIRECT_URL is unset, CLI ops fall back to getDatabaseUrl()
// (local Docker + remote legacy configs keep working unchanged).
function getDirectUrl(): string | undefined {
    try {
        return process.env.DIRECT_URL || env('DIRECT_URL') || undefined;
    } catch {
        return process.env.DIRECT_URL || undefined;
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
    // CLI operations (migrate/db push) use directUrl when set (required for
    // Prisma Postgres via Accelerate); otherwise fall back to url.
    datasource: {
        url: getDatabaseUrl(),
        ...(getDirectUrl() ? { directUrl: getDirectUrl() as string } : {}),
    },
});
