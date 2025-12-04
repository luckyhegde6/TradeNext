# Docker Compose Environment Variables

## Setup Instructions

The `docker-compose.yml` file now uses environment variables for PostgreSQL credentials to avoid committing secrets to git.

### For Local Development

1. Create a `.env` file in the project root (this file is gitignored):

```bash
# .env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_secure_password_here
POSTGRES_DB=tradenext
```

2. Docker Compose will automatically load these variables when you run:

```bash
docker-compose up
```

### Default Values

If you don't create a `.env` file, the following defaults will be used:
- `POSTGRES_USER`: postgres
- `POSTGRES_PASSWORD`: postgres
- `POSTGRES_DB`: tradenext

### For Production

**Never use default passwords in production!**

Set strong passwords using:
- Environment variables in your CI/CD pipeline
- Docker secrets (for Docker Swarm)
- Kubernetes secrets (for K8s deployments)
- Cloud provider secret managers (AWS Secrets Manager, Azure Key Vault, etc.)

## What Changed

The `docker-compose.yml` now uses this syntax:

```yaml
environment:
  POSTGRES_USER: ${POSTGRES_USER:-postgres}
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
  POSTGRES_DB: ${POSTGRES_DB:-tradenext}
```

This means:
- `${POSTGRES_USER:-postgres}` - Use env var `POSTGRES_USER` if set, otherwise use `postgres`
- The `:-` syntax provides a default fallback value
- No hardcoded secrets in the committed file

## Security Best Practices

✅ **DO:**
- Use `.env` files for local development (already gitignored)
- Use strong, unique passwords
- Rotate credentials regularly
- Use secret management tools in production

❌ **DON'T:**
- Commit `.env` files to git
- Use default passwords in production
- Share credentials in plain text
- Hardcode secrets in docker-compose.yml
