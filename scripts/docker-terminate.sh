#!/usr/bin/env bash
set -euo pipefail

echo "🧹 Terminating project Docker: stop containers, remove volumes & networks..."

# Stop and remove compose-managed containers, networks, volumes for this directory
docker compose down -v --remove-orphans || true

# Optional: prune dangling objects (safe)
docker container prune -f || true
docker volume prune -f || true
docker network prune -f || true

echo "✅ Docker cleaned for this project."
