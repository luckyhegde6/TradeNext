Param()

Write-Host "🧹 Terminating project Docker: stop containers, remove volumes & networks..." -ForegroundColor Cyan

try {
  docker compose down -v --remove-orphans
} catch {
  Write-Warning "docker compose down failed (continuing): $_"
}

Write-Host "Pruning dangling containers, volumes, networks..."
docker container prune -f
docker volume prune -f
docker network prune -f

Write-Host "✅ Docker cleaned for this project." -ForegroundColor Green
