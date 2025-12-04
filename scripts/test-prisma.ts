
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

async function main() {
    console.log('Importing dependencies...');
    try {
        const connectionString = process.env.DATABASE_URL;
        const pool = new Pool({ connectionString });
        const adapter = new PrismaPg(pool);

        console.log('Instantiating PrismaClient with adapter...');
        const prisma = new PrismaClient({ adapter });

        console.log('Connecting...');
        await prisma.$connect();
        console.log('Connected to database successfully');

        await prisma.$disconnect();
        console.log('Disconnected');
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    }
}

main();
