#!/usr/bin/env node
// scripts/dev-local-cross.js
// Cross-platform local dev orchestration for TradeNext
// Prefers `docker compose`, falls back to `docker-compose`.
// Usage: node scripts/dev-local-cross.js

const { execSync } = require('child_process');
const fs = require('fs');

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
      console.log('✅ Postgres is ready');
      return;
    } catch (err) {
      attempts++;
      process.stdout.write('.');
      await sleep(intervalMs);
    }
  }
  throw new Error('Postgres did not become ready in time');
}

(async () => {
  try {
    const composeCmd = dockerComposeCmd();
    if (!composeCmd) {
      console.error('\nError: Neither `docker compose` nor `docker-compose` was found in PATH.');
      console.error('Possible fixes:');
      console.error('- Install Docker Desktop and enable WSL integration for your distro (Docker Desktop -> Settings -> Resources -> WSL Integration).');
      console.error('- Or install the Docker Compose plugin/CLI inside your WSL distro.');
      console.error('\nAfter fixing, re-run: npm run dev:local\n');
      process.exit(2);
    }

    console.log(`Using compose command: ${composeCmd}`);

    console.log('🧩 Starting Postgres (Timescale) + Redis...');
    run(`${composeCmd} up -d db redis`);

    process.stdout.write('⏳ Waiting for Postgres to be healthy ');
    await waitForPostgres(composeCmd);
    console.log('');

    console.log('🗄 Running Prisma migrations (inside tradenext container)...');
    // Use sh -c to run series of commands inside containe
    run(`${composeCmd} run --rm tradenext sh -c "npm ci --no-audit --no-fund && npx prisma generate --schema=prisma/schema.prisma && npx prisma migrate dev --name add_indexname_to_announcements"`);

    console.log('⏳ Enabling Timescale hypertable...');
    run(`${composeCmd} run --rm tradenext sh -c "npm ci --no-audit --no-fund && npx ts-node scripts/enable_timescale.ts"`);

    console.log('✅ Timescale enabled.');

    console.log('🚀 Starting tradenext service (app) ...');
    run(`${composeCmd} up tradenext`);

    console.log('');
    console.log('✅ Local dev environment ready!');
    console.log('Open http://localhost:3000');
    console.log('');
    console.log('Helpful commands:');
    console.log('  Trigger ingestion:');
    console.log('    curl -X POST http://localhost:3000/api/ingest/run -H "Content-Type: application/json" -d \'{"csvPath":"./api/sample_nse.csv"}\'');
    console.log('  Prisma Studio:');
    console.log(`    ${composeCmd} run --rm tradenext sh -c "npm ci --no-audit --no-fund && npx prisma studio"`);
    console.log('  Enter container:');
    console.log(`    ${composeCmd} exec tradenext sh`);
  } catch (err) {
    console.error('Error during dev setup:', err.message || err);
    process.exit(1);
  }
})();
