#!/usr/bin/env bash
set -euo pipefail

echo "⏹ Stopping DB+Redis..."
docker compose down -v --remove-orphans
echo "Stopped."
