#!/usr/bin/env node
// scripts/docker-terminate-cross.cjs
// Cross-platform script to terminate Docker containers, volumes, and networks
// Usage: node scripts/docker-terminate-cross.cjs

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
  if (which('docker')) {
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
    // Ignore errors for cleanup commands
    console.warn(`Warning: Command failed (continuing anyway): ${cmd}`);
  }
}

(async () => {
  try {
    console.log('🧹 Terminating project Docker: stop containers, remove volumes & networks...');
    console.log('');

    const composeCmd = dockerComposeCmd();
    if (!composeCmd) {
      console.error('\nError: Neither `docker compose` nor `docker-compose` was found in PATH.');
      console.error('Make sure Docker is installed and running.\n');
      process.exit(2);
    }

    console.log(`Using compose command: ${composeCmd}`);

    // Stop and remove compose-managed containers, networks, volumes for this directory
    run(`${composeCmd} down -v --remove-orphans`);

    // Optional: prune dangling objects (safe)
    run('docker container prune -f');
    run('docker volume prune -f');
    run('docker network prune -f');

    console.log('');
    console.log('✅ Docker cleaned for this project.');
  } catch (err) {
    console.error('Error during Docker cleanup:', err.message || err);
    process.exit(1);
  }
})();
