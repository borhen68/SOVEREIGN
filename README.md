# SOVEREIGN MVP API

![SOVEREIGN Architecture](./sovereign-architecture.png)

Initial coding implementation from the SOVEREIGN PRD v1.1.

This service provides:
- Mission contracts (`goal + KPI + deadline + policy`)
- Task tracking with closure metrics
- Runtime risk scoring with approval gates
- Runtime human checkpoints during execution with resume-from-checkpoint state
- Action timeline and evidence logging
- Basic truth verification endpoint
- Multi-agent councils (agents with souls + skills collaborating under a main agent)
- Lane-aware command queue for safe concurrent runs
- Company orchestrator (`objective -> plan -> execute -> verify -> notify`)
- Security fabric (pairing, auth gate, rate/cost cap, sandbox path checks, encrypted local secrets)
- Hybrid memory engine (vector + keyword + graph entities/relations)
- Tunnel manager, heartbeat cron jobs, setup wizard, observability traces, evals, and telemetry metrics

## Quick Start

```bash
cp .env.example .env
npm run start
```

Server starts on `http://localhost:3001`.
Local runtime commands (`start`, `worker`, `ui`) auto-load `./.env` by default.
Shell env vars still win if already set.

Run background autonomy loops in a second process:

```bash
npm run worker
```

## Docker Quick Start (API + Worker + Postgres + Redis)

```bash
cp .env.example .env
docker compose up --build
```

Then open:
- `http://localhost:3001/health`
- `http://localhost:3001/dashboard`
- `http://localhost:3001/api/architecture/blueprint`
- `http://localhost:3001/api/company/runs`

## Recent Updates (V1.1+)

### 1) Hybrid GraphRAG Memory
- Memory chunks now store:
  - concepts
  - entities
  - typed relations
- Search scoring now uses:
  - vector similarity
  - keyword relevance
  - concept overlap
  - entity overlap
  - relation-type overlap
- Graph APIs return enriched nodes/edges with shared entities + relation types.

### 2) Runtime HITL Checkpoints (not only pre-execution)
- Company runs can pause mid-execution when:
  - a workstream is high-risk
  - consensus after council is below threshold
- Resume continues from saved checkpoint with:
  - `nextWorkstreamIndex`
  - prior `executionResults`
  - persisted runtime escalation policy

Useful execution flags (body fields on `POST /api/company/execute` or resume):
- `runtimeEscalationEnabled` (default `true`)
- `runtimePauseOnHighRiskStream` (default `true`)
- `runtimePauseOnLowConsensus` (default `true`)
- `runtimeLowConsensusThreshold` (default `0.6`)
- `runtimeRiskHints` (optional extra risk keywords)

### 3) Deep Observability + Eval Telemetry
- LLM telemetry now records:
  - request/attempt start, success, failure
  - latency
  - token usage
  - estimated cost
- Plugin tool telemetry now records:
  - invocation start/success/failure/blocked
  - duration and risk metadata
- Metrics endpoint now includes:
  - latency distribution (`avg`, `p50`, `p95`, `max`)
  - token usage totals
  - cost totals
  - per-source usage breakdown

### 4) Async Core Refactor + Prisma Stabilization (Feb 2026)
- Core mission/council/skill/autopilot flows were aligned to async I/O end-to-end.
- Service call-sites and tests were updated to await async datastore methods consistently.
- Prisma client/schema sync issues were resolved (`npx prisma generate` + datastore method alignment).
- Current project verification:
  - `npm run build` passes
  - `npm test` passes

### 5) Production Hardening Pass
- CI syntax step now validates built runtime files (`dist/src/server.js`, `dist/src/worker.js`).
- State backend now fails fast on startup if required adapters are missing:
  - postgres mode requires `pg`
  - redis modes require `redis`
- Prisma datastore no longer leaves channel/runtime/security/memory methods as empty stubs.
- Backend adapters (`pg`, `redis`) are now first-class npm dependencies for reliable local, CI, and Docker runs.

### 6) Budget, Timeout, and Durable Delivery Guards
- Mission budget cap circuit breaker is now enforced in execution loops:
  - company orchestrator checks budget before each workstream
  - autopilot checks budget before planning and before task execution
- Council execution now has configurable step timeout guards:
  - `COMPANY_COUNCIL_STEP_TIMEOUT_MS`
  - `AUTOPILOT_STEP_TIMEOUT_MS`
- Notification delivery is now durable:
  - failed sends are queued in a persistent outbox
  - heartbeat tick retries pending outbox items with exponential backoff
  - outbox works with file store and Prisma/Postgres store

### 7) Soul Versioning + Rollback
- Agents now persist soul version history with metadata (`reason`, `source`, `outcome`, `performanceScore`).
- Soul evolution appends immutable versions instead of mutating in place only.
- Rollback creates a new version that restores a prior soul snapshot.
- New APIs:
  - `GET /api/architecture/soul/:agentId/history`
  - `POST /api/architecture/soul/:agentId/rollback`

### 8) OpenAPI + Typed SDK
- OpenAPI spec is now available at:
  - `GET /api/openapi`
  - `GET /api/openapi.json`
- Exported artifact can be generated at repo root:
  - `npm run openapi:export` -> `openapi.json`
- Typed TypeScript SDK available at:
  - `src/sdk/sovereign-client.ts`
  - publishable package layout: `sdk/ts` (`@sovereign/client`)
- Python client starter available at:
  - `sdk/python/sovereign_client.py`

### Local CLI UI (agent select + model select + chat)

```bash
npm run ui
```

The CLI lets you:
- select or create an agent
- assign/update that agent's model policy (`provider/model` with fallbacks)
- chat locally with that selected agent
- use a richer console UX with:
  - session status panel (workspace, role, model, web access, soul values)
  - command palette (`/help`, `/switch`, `/model`, `/who`, `/history`, `/clear`, `/exit`)
  - structured chat cards and in-flight "agent is thinking" spinner

### Optional LLM Providers

Set any provider keys you want to use:

```bash
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
export GEMINI_API_KEY="..."   # or GOOGLE_API_KEY
```

SOVEREIGN also supports 22+ OpenAI-compatible providers (OpenRouter, Groq, Mistral, Together, Fireworks, DeepSeek, xAI, Perplexity, Venice, Cohere, Ollama, custom URL, and more). Configure them via `.env` variables in `.env.example`.

### State Backend Switch (File / Postgres / Postgres+Redis)

Use environment variables:

```bash
export STATE_BACKEND="file"               # file | postgres | postgres_redis
export DATABASE_URL="postgres://user:pass@host:5432/db"
export REDIS_URL="redis://host:6379"
export STATE_BACKEND_TABLE="sovereign_state"
export STATE_BACKEND_KEY="default"
```

When using `STATE_BACKEND=postgres` or `postgres_redis`, install adapter packages:

```bash
npm install pg redis
```

Important mode behavior:
- `STATE_BACKEND=postgres`: uses `PrismaDataStore` (relational persistence through Prisma models).
- `STATE_BACKEND=postgres_redis`: uses `DataStore` + `StateBackendService` snapshot persistence (Postgres/Redis adapter), not direct Prisma row-level store.

After any Prisma schema change, regenerate the client:

```bash
npx prisma generate
```

Runtime status:

```bash
curl http://localhost:3001/api/system/persistence
```

Optional model overrides:

```bash
export OPENAI_MODEL="gpt-4o-mini"
export ANTHROPIC_MODEL="claude-3-5-sonnet-latest"
export GEMINI_MODEL="gemini-1.5-pro"
```

Task-aware routing overrides (optional):

```bash
export TASK_MODEL_SMALL="openai/gpt-4o-mini"
export TASK_MODEL_STANDARD="anthropic/claude-3-5-sonnet-latest"
export TASK_MODEL_HIGH_CODING="anthropic/claude-opus-4-6"
export TASK_MODEL_HIGH_GENERAL="gemini/gemini-2.5-pro"
```

Optional chat model routing (OpenClaw-style model refs):

```bash
export CHAT_MODEL_PRIMARY="openai/gpt-4o-mini"
export CHAT_MODEL_FALLBACKS="anthropic/claude-3-5-sonnet-latest,gemini/gemini-1.5-pro"
```

## API Endpoints

### Health
- `GET /health`
- `GET /api/openapi`
- `GET /api/openapi.json`

### Live Dashboard
- `GET /dashboard` (real-time web UI for orchestrator, council debate, and risk)
- `GET /api/dashboard/snapshot`

### System
- `GET /api/system/persistence`

### Queue
- `GET /api/queue/stats`

### LLM
- `GET /api/llm/providers`
- `GET /api/llm/models`
- `POST /api/llm/respond`

### Plugins
- `GET /api/plugins`
- `POST /api/plugins/reload`
- `GET /api/plugins/:pluginId`
- `POST /api/plugins/:pluginId/tools/:toolName/invoke`

### Runtime Trust (Mediated Tool Actions)
- `GET /api/runtime/actions`
- `GET /api/runtime/actions/:runtimeActionId`
- `GET /api/runtime/metrics`

### Channels (Local + Messaging Platforms)
- `GET /api/channels/adapters`
- `GET /api/channels/sessions`
- `GET /api/channels/sessions/:sessionId/messages`
- `POST /api/channels/:channelId/webhook`
- `GET /api/channels/:channelId/webhook` (platform verification handshake where supported)

### Autopilot Delegation
- `GET /api/autopilot/goals`
- `POST /api/autopilot/goals`
- `GET /api/autopilot/goals/:goalId`
- `GET /api/autopilot/goals/:goalId/logs`
- `POST /api/autopilot/goals/:goalId/run`
- `POST /api/autopilot/goals/:goalId/pause`
- `POST /api/autopilot/goals/:goalId/resume`
- `POST /api/autopilot/goals/:goalId/cancel`

### Architecture (Company of Agents)
- `GET /api/architecture/blueprint`
- `POST /api/architecture/company-plan`
- `POST /api/architecture/soul/evolve`
- `GET /api/architecture/soul/:agentId/history`
- `POST /api/architecture/soul/:agentId/rollback`

### Company Orchestrator
- `GET /api/company/runs`
- `GET /api/company/runs/:runId`
- `POST /api/company/runs/:runId/resume`
- `POST /api/company/execute`

### Security Fabric
- `GET /api/security/pairings`
- `POST /api/security/pairings/create`
- `POST /api/security/pairings/verify`
- `POST /api/security/auth/issue`
- `POST /api/security/auth/verify`
- `GET /api/security/rate/events`
- `POST /api/security/rate/check`
- `POST /api/security/sandbox/check`
- `GET /api/security/secrets`
- `POST /api/security/secrets/set`
- `POST /api/security/secrets/get`

### Tunnel
- `GET /api/tunnels`
- `POST /api/tunnels`
- `GET /api/tunnels/active`
- `GET /api/tunnels/:tunnelId`
- `PATCH /api/tunnels/:tunnelId`
- `POST /api/tunnels/:tunnelId/activate`
- `POST /api/tunnels/:tunnelId/deactivate`

### Memory Engine
- `POST /api/memory/index`
- `POST /api/memory/search`
- `POST /api/memory/reindex`
- `POST /api/memory/graph/query`
- `GET /api/memory/graph/stats`
- `GET /api/memory/stats`

### Evals
- `POST /api/evals/company/:runId`

### Heartbeat & Cron
- `GET /api/heartbeat/jobs`
- `POST /api/heartbeat/jobs`
- `GET /api/heartbeat/jobs/:jobId`
- `POST /api/heartbeat/jobs/:jobId/run`
- `POST /api/heartbeat/jobs/:jobId/pause`
- `POST /api/heartbeat/jobs/:jobId/resume`
- `GET /api/heartbeat/runs`
- `GET /api/heartbeat/outbox`
- `POST /api/heartbeat/outbox/process`

### Setup Wizard
- `POST /api/setup/wizard/run`
- `GET /api/setup/wizard/runs`
- `GET /api/setup/wizard/:runId`

### Missions
- `GET /api/missions`
- `POST /api/missions`
- `GET /api/missions/:missionId`
- `POST /api/missions/:missionId/simulate`
- `POST /api/missions/:missionId/start`
- `GET /api/missions/:missionId/council`
- `GET /api/missions/:missionId/council/runs`
- `POST /api/missions/:missionId/council/run`

### Tasks
- `POST /api/missions/:missionId/tasks`
- `PATCH /api/missions/:missionId/tasks/:taskId`

### Actions / Trust Fabric
- `POST /api/missions/:missionId/actions`
  - `actionType`: `read|write|external_send|financial|destructive`
  - optional `idempotencyKey` to prevent duplicate side effects
  - high-risk actions create approval requests automatically

### Approvals
- `POST /api/approvals/:approvalId/decision`
  - `decision`: `approve|reject`

### Observability
- `GET /api/missions/:missionId/timeline`
- `GET /api/missions/:missionId/metrics`

### System Observability
- `GET /api/observability/events`
- `GET /api/observability/metrics`
- `GET /api/observability/traces`
- `GET /api/observability/traces/:traceId`

### Verification
- `POST /api/verify`

### Agents
- `GET /api/agents`
- `POST /api/agents`
- `GET /api/agents/:agentId`
- `PATCH /api/agents/:agentId`

### Agent Skills (auto-created + memory)
- `GET /api/agents/:agentId/skills`
- `POST /api/agents/:agentId/skills`
- `POST /api/agents/:agentId/skills/generate`
- `GET /api/agents/:agentId/skills/:skillId`
- `PATCH /api/agents/:agentId/skills/:skillId`
- `GET /api/agents/:agentId/skills/:skillId/memory`
- `POST /api/agents/:agentId/skills/:skillId/memory`

### Council Sessions
- `GET /api/councils/:councilId`
- `GET /api/council-runs/:runId`

`POST /api/missions/:missionId/council/run` supports:
- `subAgentIds` (optional): manual sub-agent list
- `teamSize` (optional): auto-assembly size when `subAgentIds` is omitted
- `debateRounds` (optional): number of challenge/rebuttal rounds (1-4)
- `idempotencyKey` (optional): replay-safe council execution key
- `autoSpawnSubAgents` (optional, default `true`): spawn specialist sub-agents when capacity is missing
- `autoGenerateSkills` (optional, default `true`): generate/reuse per-workstream skills and write skill memory

## Example: Create Mission

```bash
curl -X POST http://localhost:3001/api/missions \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Book 12 demos",
    "objective": "Increase qualified pipeline",
    "kpi": "12 booked demos in 14 days",
    "deadline": "2026-03-15",
    "policyPreset": "balanced"
  }'
```

## Example: Create Agent

```bash
curl -X POST http://localhost:3001/api/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Scout",
    "role": "sub",
    "skills": ["research", "analysis", "strategy"],
    "model": {
      "primary": "anthropic/claude-3-5-sonnet-latest",
      "fallbacks": ["openai/gpt-4o-mini", "gemini/gemini-1.5-pro"]
    },
    "canUseWeb": true,
    "soul": {
      "mission": "Find truth and challenge assumptions.",
      "values": ["clarity", "evidence"],
      "communicationStyle": "direct",
      "riskTolerance": "balanced"
    }
  }'
```

Per-agent model policy is supported for both `main` and `sub` agents:
- `agent.model.primary`: first model ref (`provider/model`)
- `agent.model.fallbacks`: ordered fallback refs

When present:
- channel chat uses the session `metadata.activeAgentId` model policy when provided; otherwise it prefers workspace main agent model policy
- council skill generation for that agent can auto-use its model policy
- `POST /api/agents/:agentId/skills/generate` with `"llm": {}` uses the agent model policy

## Example: Run Multi-Agent Council

```bash
curl -X POST http://localhost:3001/api/missions/<missionId>/council/run \
  -H "Content-Type: application/json" \
  -d '{
    "problem": "How do we increase activation without harming reliability?",
    "mainAgentId": "<mainAgentId>",
    "subAgentIds": ["<subAgentA>", "<subAgentB>", "<subAgentC>"],
    "idempotencyKey": "council-activation-001",
    "debateRounds": 2,
    "autoSpawnSubAgents": true,
    "autoGenerateSkills": true,
    "allowWebResearch": true
  }'
```

Council runs are queued by mission lane (`mission:<missionId>`) so overlapping runs for the same mission execute safely in order while different missions can run in parallel.

If you omit `subAgentIds`, SOVEREIGN auto-assembles a specialist team from available sub-agents in the same workspace using skills + soul matching. If the workspace has fewer specialists than requested, it can auto-spawn specialist sub-agents with role-specific souls.

## Example: Execute Company Objective (Runtime Checkpoints Enabled)

```bash
curl -X POST http://localhost:3001/api/company/execute \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "default",
    "objective": "Plan launch, ship reliability fixes, and update sales assets",
    "runtimeEscalationEnabled": true,
    "runtimePauseOnHighRiskStream": true,
    "runtimePauseOnLowConsensus": true,
    "runtimeLowConsensusThreshold": 0.65
  }'
```

## Example: Resume Paused Company Run

```bash
curl -X POST http://localhost:3001/api/company/runs/<runId>/resume \
  -H "Content-Type: application/json" \
  -d '{
    "decision": "approve",
    "note": "Approved by founder. Continue.",
    "runtimePauseOnLowConsensus": false
  }'
```

## Example: Build Company Plan (Souls + Skills + Model Routing)

```bash
curl -X POST http://localhost:3001/api/architecture/company-plan \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "default",
    "objective": "Increase sales demos while shipping reliable product improvements.",
    "teamSize": 4,
    "debateRounds": 2,
    "autoSpawnSubAgents": true,
    "autoGenerateSkills": true
  }'
```

## Example: Evolve Agent Soul From Outcome

```bash
curl -X POST http://localhost:3001/api/architecture/soul/evolve \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "<agentId>",
    "performanceScore": 0.42,
    "outcome": "Incident occurred. Add stronger verification and risk control."
  }'
```

## Example: List Soul History

```bash
curl "http://localhost:3001/api/architecture/soul/<agentId>/history?limit=20"
```

## Example: Roll Back Soul to Prior Version

```bash
curl -X POST http://localhost:3001/api/architecture/soul/<agentId>/rollback \
  -H "Content-Type: application/json" \
  -d '{
    "targetVersion": 1,
    "reason": "rollback after regression"
  }'
```

## Example: Process Notification Outbox Retries

```bash
curl -X POST http://localhost:3001/api/heartbeat/outbox/process \
  -H "Content-Type: application/json" \
  -d '{
    "limit": 50
  }'
```

## Example: Auto-Generate Agent Skill From Task

```bash
curl -X POST http://localhost:3001/api/agents/<agentId>/skills/generate \
  -H "Content-Type: application/json" \
  -d '{
    "task": "Fix checkout bug and add regression tests",
    "seedMemory": {
      "note": "Root cause likely stale cart cache",
      "source": "mission.bootstrap"
    }
  }'
```

## Example: Auto-Generate Skill Using Specific LLM

```bash
curl -X POST http://localhost:3001/api/agents/<agentId>/skills/generate \
  -H "Content-Type: application/json" \
  -d '{
    "task": "Fix checkout bug and add regression tests",
    "llm": {
      "provider": "anthropic",
      "model": "claude-3-5-sonnet-latest",
      "temperature": 0.2
    }
  }'
```

## Example: Direct LLM Call (OpenAI/Claude/Gemini)

```bash
curl -X POST http://localhost:3001/api/llm/respond \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "default",
    "traceId": "trace-demo-001",
    "modelRef": "gemini/gemini-1.5-pro",
    "fallbacks": ["openai/gpt-4o-mini"],
    "prompt": "Summarize this mission objective in 2 lines."
  }'
```

`/api/llm/respond` response now includes telemetry fields:
- `durationMs`
- `usageNormalized` (`promptTokens`, `completionTokens`, `totalTokens`)
- `costUsd` (estimated, if configured)

## SDK Usage (TypeScript)

```ts
import { SovereignClient } from "@sovereign/client";

const client = new SovereignClient({
  baseUrl: "http://localhost:3001"
});

const run = await client.executeCompanyObjective({
  workspaceId: "default",
  objective: "Plan, execute, and verify launch readiness."
});

console.log(run);
```

## SDK Usage (Python)

```python
from sdk.python.sovereign_client import SovereignClient

client = SovereignClient(base_url="http://localhost:3001")
print(client.health())
print(client.list_company_runs())
```

## Plugin SDK

Plugins live under `plugins/<plugin-folder>/` with:
- `plugin.json` manifest
- module file (default `index.js`) exporting a function (default export or named `register`)

Manifest example:

```json
{
  "id": "hello-world",
  "name": "Hello World Plugin",
  "version": "0.1.0",
  "description": "Example plugin tools",
  "entry": "index.js",
  "permissions": {
    "network": false,
    "filesystem": false
  }
}
```

Plugin module example:

```js
import { definePlugin, defineTool } from "../../src/plugins/sdk.js";

export default definePlugin(() => ({
  tools: [
    defineTool({
      name: "echo",
      actionType: "read",
      inputSchema: {
        type: "object",
        required: ["text"],
        properties: {
          text: { type: "string" }
        }
      },
      async run({ input }) {
        return { echoed: input.text };
      }
    })
  ]
}));
```

Tool `actionType` supports:
- `read`
- `write`
- `external_send`
- `financial`
- `destructive`

Every plugin tool call is mediated by runtime policy and recorded in runtime audits with redacted snapshots.

### Example: List Loaded Plugins

```bash
curl http://localhost:3001/api/plugins
```

### Example: Reload Plugins

```bash
curl -X POST http://localhost:3001/api/plugins/reload
```

### Example: Invoke Plugin Tool

```bash
curl -X POST http://localhost:3001/api/plugins/hello-world/tools/echo/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "text": "hello plugin"
    }
  }'
```

## Multi-Channel Gateway (WhatsApp/Telegram/Local)

SOVEREIGN now includes a channel gateway with built-in adapters:
- `local` (for browser/terminal/API testing)
- `telegram`
- `whatsapp` (Meta Cloud API format)

### Environment variables (optional)

```bash
export CHAT_PROVIDER="openai"               # default chat provider for channel replies
export DEFAULT_WORKSPACE_ID="default"
export AUTOPILOT_POLL_MS="3000"             # background loop polling interval
export AUTOPILOT_MAX_CYCLES="12"            # max execution cycles per goal

export TELEGRAM_BOT_TOKEN="..."
export TELEGRAM_WEBHOOK_SECRET="..."

export WHATSAPP_ACCESS_TOKEN="..."
export WHATSAPP_VERIFY_TOKEN="..."
export WHATSAPP_PHONE_NUMBER_ID="..."
```

### Example: Local channel webhook (no external platform required)

```bash
curl -X POST http://localhost:3001/api/channels/local/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "default",
    "chatId": "founder-chat",
    "userId": "borhen",
    "text": "/help"
  }'
```

## Autopilot Example (Human Delegates, Agent Delivers)

```bash
curl -X POST http://localhost:3001/api/autopilot/goals \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "default",
    "title": "Prepare launch brief",
    "objective": "Draft, validate, and finalize launch brief with execution plan",
    "maxCycles": 20,
    "notifyTargets": [
      {
        "channelId": "local",
        "chatId": "founder-dm",
        "userId": "founder"
      }
    ]
  }'
```

Manual single-step run (for testing/debug):

```bash
curl -X POST http://localhost:3001/api/autopilot/goals/<goalId>/run
```

### Example: Telegram webhook endpoint

Set your Telegram webhook to:

```text
https://<your-domain>/api/channels/telegram/webhook?secret=<your-secret>
```

### Example: WhatsApp webhook endpoint

In Meta webhook config:
- Verify URL: `https://<your-domain>/api/channels/whatsapp/webhook`
- Verify token: same value as `WHATSAPP_VERIFY_TOKEN`

## Example: Add Skill Memory

```bash
curl -X POST http://localhost:3001/api/agents/<agentId>/skills/<skillId>/memory \
  -H "Content-Type: application/json" \
  -d '{
    "note": "Patch reduced checkout failure rate by 40%",
    "outcome": "improved conversion",
    "source": "task.run",
    "score": 0.84
  }'
```

## Tests

```bash
npm test
```

## Open Source Project Files

- License: `LICENSE` (Apache-2.0)
- Contribution guide: `CONTRIBUTING.md`
- Code of conduct: `CODE_OF_CONDUCT.md`
- Security policy: `SECURITY.md`
- Deployment guide: `DEPLOYMENT.md`
- Changelog: `CHANGELOG.md`

## CI / Release

- CI workflow: `.github/workflows/ci.yml`
- Security workflow: `.github/workflows/security.yml`
- Release workflow (tags `v*`): `.github/workflows/release.yml`
