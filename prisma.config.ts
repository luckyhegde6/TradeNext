import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

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
        url: env('DATABASE_URL') || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/tradenext',
    },
});
