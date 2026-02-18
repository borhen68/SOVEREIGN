# Deployment Guide

## 1. Prerequisites

- Node.js `20.x`
- Docker + Docker Compose
- `.env` file from `.env.example`

## 2. State Backend Modes

SOVEREIGN supports three persistence modes:

- `STATE_BACKEND=file`
  - Local JSON persistence (`.data/store.json`)
  - Easiest local development mode
- `STATE_BACKEND=postgres`
  - Uses `PrismaDataStore` (relational persistence through Prisma models)
  - Requires `DATABASE_URL`
- `STATE_BACKEND=postgres_redis`
  - Uses `DataStore` + `StateBackendService` snapshot persistence
  - Requires `DATABASE_URL` and `REDIS_URL`
  - This is the mode used by current `docker-compose.yml`

For `postgres`/`postgres_redis` adapter mode, install runtime dependencies:

```bash
npm install pg redis
```

Startup now fails fast if these adapters are missing while postgres/redis modes are enabled, so misconfiguration is detected immediately.

## 3. Local Production-like Run (Docker)

```bash
cp .env.example .env
npm install pg redis
docker compose up --build
```

API: `http://localhost:3001`

Note: the project `Dockerfile` installs `pg` and `redis` for container runtime compatibility with `STATE_BACKEND=postgres_redis`.

## 4. Prisma Preparation (when using STATE_BACKEND=postgres)

If Prisma schema changed, regenerate client:

```bash
npx prisma generate
```

If your target database has no schema yet:

```bash
npx prisma db push
```

Note: this repository currently has `prisma/schema.prisma` and no checked-in Prisma migration files, so `db push` is the practical bootstrap path.

## 5. Production Topology
- `api`: HTTP API and channel webhooks
- `worker`: autopilot + heartbeat background loops
- `postgres`: primary state backend (`STATE_BACKEND=postgres_redis`)
- `redis`: state cache backend (and future queue/cache extensions)

## 6. Health and Smoke Checks

```bash
curl http://localhost:3001/health
curl http://localhost:3001/api/system/persistence
curl http://localhost:3001/api/llm/providers
curl http://localhost:3001/api/architecture/blueprint
```

Recommended verification before shipping:

```bash
npm run build
npm test
```

## 7. Security Hardening
- Rotate all API keys regularly.
- Use HTTPS and a reverse proxy in production.
- Restrict webhook source IPs where possible.
- Use dedicated runtime host for the worker process.

## 8. Release Process
1. Merge to `main` with green CI.
2. Tag release: `git tag v0.1.0 && git push origin v0.1.0`
3. GitHub Actions creates release notes and runs tests.

## 9. Open Source Hygiene
- Keep `SECURITY.md`, `CONTRIBUTING.md`, and `CODE_OF_CONDUCT.md` current.
- Do not commit real secrets.
- Add migration notes when state schema changes.
