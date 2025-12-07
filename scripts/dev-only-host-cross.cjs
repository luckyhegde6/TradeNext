#!/usr/bin/env node
// scripts/dev-only-host-cross.js
// Cross-platform script to start DB+Redis in Docker for local development
// The Next.js app runs on the host machine for fast dev loop
// Usage: node scripts/dev-only-host-cross.js

const { execSync } = require('child_process');

function which(cmd) {
  try {
    const res = execSync(process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`, { stdio: 'pipe' }).toString().trim();
    return !!res;
  } catch {
    return false;
  }
}

function dockerComposeCmd() {
  if (which('docker') && which('docker')) {
    // prefer `docker compose` if supported
    try {
      // test `docker compose version`
      execSync('docker compose version', { stdio: 'ignore', shell: true });
      return 'docker compose';
    } catch {
      // fallback to docker-compose binary
      if (which('docker-compose')) return 'docker-compose';
    }
  }
  return null;
}

function run(cmd, opts = {}) {
  console.log(`\n> ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit', shell: true, ...opts });
  } catch (err) {
    console.error(`\nCommand failed: ${cmd}\n`);
    throw err;
  }
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function waitForPostgres(composeCmd, maxAttempts = 60, intervalMs = 2000) {
  let attempts = 0;
  while (attempts < maxAttempts) {
    try {
      // Use compose exec to run pg_isready inside the db container
      execSync(`${composeCmd} exec db pg_isready -U postgres -d tradenext`, { stdio: 'ignore', shell: true });
      console.log(' ✅');
      return;
    } catch (err) {
      attempts++;
      process.stdout.write('.');
      await sleep(intervalMs);
    }
  }
  throw new Error('❌ Postgres did not become ready in time.');
}

(async () => {
  try {
    console.log('=========================================');
    console.log('  TradeNext — dev-only-host (DB+Redis in Docker; app on host)');
    console.log('=========================================');
    console.log('');

    const composeCmd = dockerComposeCmd();
    if (!composeCmd) {
      console.error('\nError: Neither `docker compose` nor `docker-compose` was found in PATH.');
      console.error('Possible fixes:');
      console.error('- Install Docker Desktop and ensure it is running.');
      console.error('- On Windows with WSL, enable WSL integration (Docker Desktop -> Settings -> Resources -> WSL Integration).');
      console.error('- Or install the Docker Compose plugin/CLI.');
      console.error('\nAfter fixing, re-run: npm run local\n');
      process.exit(2);
    }

    console.log(`Using compose command: ${composeCmd}`);
    console.log('');

    console.log('🧩 Ensuring Postgres (Timescale) + Redis are up in Docker...');
    run(`${composeCmd} up -d db redis`);

    process.stdout.write('⏳ Waiting for Postgres to be healthy');
    await waitForPostgres(composeCmd);
    console.log('');
    
    console.log('✅ DB + Redis are ready in Docker.');
    console.log('');

    // Auto-migration Logic
    try {
      const { Client } = require('pg');
      const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/tradenext';
      
      console.log('🔍 Checking if database requires migration...');
      const client = new Client({ connectionString });
      await client.connect();
      
      // Check if _prisma_migrations table exists to determine if DB is initialized
      const res = await client.query(`
        SELECT COUNT(*) as count 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = '_prisma_migrations';
      `);
      const count = parseInt(res.rows[0].count, 10);
      await client.end();

      if (count === 0) {
        console.log('⚠️  Database appears empty (no _prisma_migrations found).');
        console.log('🚀 Running initial migration: npx prisma migrate dev --name add_tradenext_models');
        console.log('   (This allows interactive prompts if needed, though usually automatic in clean state)');
        
        // Running with inherit to allow interaction if strictly necessary, strictly synchronous
        execSync('npx prisma migrate dev --name add_indexname_to_announcements', { stdio: 'inherit', shell: true });
        console.log('✅ Migration completed successfully.');
        console.log('Generating Prisma Client...'); 
        execSync('npx prisma generate', { stdio: 'inherit', shell: true });
        console.log('🌱 Running database seed...');
        execSync('npx prisma db seed', { stdio: 'inherit', shell: true });
        console.log('✅ Seeding completed successfully.');
      } else {
        console.log('✅ Database already initialized (migrations table found). skipping auto-migrate.');
      }
    } catch (e) {
       console.error('⚠️  Auto-migration check failed:', e.message);
       console.log('   Continuing... you may need to run migration manually if tables are missing.');
    }

    console.log('');
    console.log('Now run the Next.js app on your host (fast dev loop):');
    console.log('  Ensure .env has DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tradenext');
    console.log('  Then: npm run dev');
    console.log('');
    console.log('If you need to apply migrations from host (recommended once after schema changes):');
    console.log('  npx prisma migrate dev --name add_tradenext_models');
    console.log('');
  } catch (err) {
    console.error('Error during dev setup:', err.message || err);
    process.exit(1);
  }
})();
