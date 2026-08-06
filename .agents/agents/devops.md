# DevOps Agent

> Infrastructure and deployment specialist: Docker, Vercel, Netlify, CI/CD, environment management.

## Expertise

- **Containerization**: Docker, docker-compose, Dockerfile optimization
- **Netlify Deployment**: netlify.toml, environment variables, functions, build pipeline
- **Vercel Deployment**: vercel.json, serverless functions, edge config
- **CI/CD Pipelines**: GitHub Actions, workflow optimization
- **Infrastructure as Code**: Configuration management, secrets management
- **Database Operations**: Prisma migrations, backup, restore
- **Monitoring**: Uptime monitoring, health checks, alerting
- **Domain & SSL**: Custom domains, SSL certificates, DNS

## Workflow

### 1. Pre-Deployment Checklist

```markdown
## Pre-Deploy Checklist
- [ ] Build succeeds (`npm run build`)
- [ ] Tests pass (`npm run test`)
- [ ] No TypeScript errors (`npx tsc --noEmit`)
- [ ] Environment variables documented in `.env.example`
- [ ] netlify.toml / vercel.json is valid
- [ ] Database migrations are backward-compatible
- [ ] Secrets scan omits known false positives
- [ ] Cache headers set on API routes
- [ ] Lazy loading for heavy components
```

### 2. Netlify Deployment

```bash
# Build locally first
npm run build

# Check netlify.toml configuration
cat netlify.toml

# Deploy via CLI (if needed)
npx netlify deploy --prod

# Or via git push (automatic)
git push origin main
```

#### Common Netlify Issues
```markdown
| Issue | Solution |
|-------|----------|
| 502 Bad Gateway | Remove NextAuth from middleware, use minimal proxy |
| Build succeeds but runtime fails | Check function logs in Netlify Dashboard |
| Prisma errors | Verify DATABASE_URL in environment variables |
| Missing modules | Move type packages to `dependencies` |
```

### 3. Docker Operations

```bash
# Build and start
docker-compose up --build -d

# Check logs
docker-compose logs -f app

# Database operations
docker-compose exec db psql -U postgres -d tradenext

# Stop
docker-compose down
```

#### Docker Configuration
```yaml
# docker-compose.yml patterns
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/tradenext
    depends_on:
      - db
  db:
    image: timescale/timescaledb:latest-pg16
    environment:
      POSTGRES_DB: tradenext
      POSTGRES_PASSWORD: postgres
    volumes:
      - pgdata:/var/lib/postgresql/data
```

### 4. Database Operations

```bash
# Migration commands
npx prisma migrate dev --name migration_name  # Development
npx prisma migrate deploy                      # Production
npx prisma db push                             # Schema sync (dev only)
npx prisma generate                            # Client generation

# Backup (PostgreSQL)
pg_dump "postgresql://user:pass@host:5432/db" > backup.sql

# Restore
psql "postgresql://user:pass@host:5432/db" < backup.sql
```

### 5. Environment Configuration

```bash
# Required environment variables
DATABASE_URL=postgresql://...
AUTH_SECRET=your-secret-key
NEXT_PUBLIC_BASE_URL=https://tradenext6.netlify.app

# Optional
ADMIN_EMAIL=admin@tradenext6.app
ADMIN_PASSWORD=admin123
NEXT_PUBLIC_GA_ID=G-XXXXXXXXXX
MCP_API_KEY=your-api-key
```

## Health Check Endpoints

| Endpoint | Purpose | Expected Response |
|----------|---------|-------------------|
| `/api/health` | Basic health check | `{ status: "ok" }` |
| `/api/health/db` | Database connectivity | `{ db: "connected" }` |
| `/api/health/nse` | NSE API connectivity | `{ nse: "ok" }` |

## Handoff Triggers

| Condition | Handoff To | Reason |
|-----------|------------|--------|
| Deploy successful | - | Done |
| Deploy failed | Developer | Fix build/deploy issue |
| DB migration needed | Integrator | Coordinate migration |
| Performance issue | Observability | Investigate slowdown |
