# Getting Started

SOVEREIGN is an autonomous agent runtime.
You give one objective, the agent company executes with safety controls.

## Prerequisites

- Node.js 18+
- npm
- Optional: Docker + Docker Compose (for Postgres/Redis quick setup)

## Local Quick Start

```bash
cp .env.example .env
npm install
export SECURITY_BOOTSTRAP_TOKEN="change-me-now"
npm run start
```

In another terminal:

```bash
npm run worker
```

Open:

- `http://localhost:3001/health`
- `http://localhost:3001/dashboard`
- `http://localhost:3001/api/openapi`

## Recommended First-Run Flow

1. Run the setup wizard:

```bash
curl -X POST http://localhost:3001/api/setup/wizard/run \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "default",
    "personaName": "SOVEREIGN"
  }'
```

2. Check readiness:

```bash
curl "http://localhost:3001/api/setup/doctor?workspaceId=default"
```

3. Open `/dashboard` and watch the readiness panel until blockers are gone.

## First Objective

```bash
curl -X POST http://localhost:3001/api/company/execute \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "default",
    "objective": "Plan launch priorities and ship reliability fixes."
  }'
```

Check runs:

```bash
curl http://localhost:3001/api/company/runs
```

## CLI UI

```bash
npm run ui
```

Use CLI for:

- selecting/creating agents
- setting model policy per agent
- chatting with local channel flow

## Provider Setup

Set only the providers you want:

```bash
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
export GEMINI_API_KEY="..."
```

Local-first option:

```bash
export OLLAMA_BASE_URL="http://localhost:11434/v1"
export OLLAMA_MODEL="llama3.2"
```

## State Backend Modes

- `STATE_BACKEND=file` for fast local start
- `STATE_BACKEND=postgres` for Prisma/Postgres persistence
- `STATE_BACKEND=postgres_redis` for snapshot backend mode

Example:

```bash
export STATE_BACKEND="postgres"
export DATABASE_URL="postgres://sovereign:sovereign@localhost:5432/sovereign"
```

If schema changes:

```bash
npx prisma generate
```

## Optional Docker Flow

```bash
cp .env.example .env
docker compose up --build
```

## Next Steps

- Demo workflows: `docs/start/showcase.md`
- Security model: `docs/core/security.md`
- Architecture: `docs/core/architecture.md`
- API reference: `docs/reference/api.md`
