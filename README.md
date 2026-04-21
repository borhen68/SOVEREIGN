# SOVEREIGN (Super-Agent Runtime)

![SOVEREIGN Architecture](./sovereign-architecture.png)

> **SOVEREIGN is the first open-source agent runtime that treats AI autonomy as a trust problem.**
> While frameworks like OpenClaw run on blind loops, SOVEREIGN runs parallel specialist councils, auto-corrects its own failing tool logic using Hermes-grade routing, and stops to ask for your explicit approval before doing anything dangerous.

## The 60-Second Magic Moment

Experience what makes SOVEREIGN different right in your terminal. No setup required.

```bash
# Provide 1 API key (OpenAI, Anthropic, or Gemini)
export ANTHROPIC_API_KEY="sk-ant-..."

# Run a complex objective
npx sovereign "Audit our pricing page, research 3 competitors, and draft an updated pricing baseline with evidence."
```

**What you will see:**
1. **Planning**: SOVEREIGN dynamically creates 3 parallel workstreams.
2. **Debate**: Parallel specialist agents debate the objective (visible consensus scores).
3. **Execution**: The agents spawn tools. If a tool fails, it *auto-corrects its own JSON payload* and retries in milliseconds.
4. **Trust Gate**: When the agent attempts to finalize the pricing document, it pauses. Your terminal safely prompts you: `High-risk action detected. Approve? [y/n]`.
5. **Verified Deliverable**: You get a dossier with a multi-source Verification Confidence level.

## Why SOVEREIGN Beats Single-Model Frameworks

Current agents use one model for everything. SOVEREIGN uses a **Hermes-Grade Model Mesh**:
- **Tool calls** route to fast, structured models (like Groq/LLaMA 3.3).
- **Reasoning/Debates** route to heavy, smart models (like Claude 3.5 Sonnet / GPT-4o).
- Result: **40% cheaper** and **significantly fewer hallucinated JSON schemas**.

## Core Differentiators

- **Mission Contracts:** Every objective gets a bounded cost cap, strict deadline, and KPI.
- **Micro-Auto-Correction:** Instead of macro-looping an entire workflow upon failure, SOVEREIGN catches individual tool failures, analyzes the error, and self-corrects the input.
- **Gateway Control Plane:** REST + WebSocket RPC for tracing sessions, reviewing memory dumps, and remote overrides.

---

## Developer Quick Start

```bash
cp .env.example .env
npm install
npm run build
```

Run the background worker to handle asynchronous verification and background planning:
```bash
npm run worker
```

Run the API / Control Plane:
```bash
npm run start
```

- Health: `http://localhost:3001/health`
- UI Dashboard: `http://localhost:3001/dashboard`
- OpenAPI: `http://localhost:3001/api/openapi`

## GitHub Cleanup

Before pushing a heavily edited local copy, run:

```bash
npm run repo:audit
npm run build
```

What the audit checks:
- local `.env` presence
- generated `.data/` state
- machine-specific `mcp_servers.json`
- unusually large root files that deserve a second look before publishing

If this folder is not a git repo yet, initialize it here and review the first add carefully:

```bash
git init
git add .
git status
```

## Documentation Map

- Docs index: `docs/README.md`
- Quick start: `docs/start/getting-started.md`
- Demo flows: `docs/start/showcase.md`
- Security model: `docs/core/security.md`
- Architecture: `docs/core/architecture.md`
- API and SDK reference: `docs/reference/api.md`
- Operator runbook: `RUNBOOK.md`
- Support policy: `SUPPORT.md`

## OpenAPI + SDK

- OpenAPI endpoints:
  - `GET /api/openapi`
  - `GET /api/openapi.json`
- Export artifact:
  - `npm run openapi:export` -> `openapi.json`
- TypeScript SDK:
  - runtime client: `src/sdk/sovereign-client.ts`
  - publishable package: `sdk/ts` (`@sovereign/client`)
  - package docs: `sdk/ts/README.md`
- Python starter client:
  - `sdk/python/sovereign_client.py`

## Provider and Data Modes

SOVEREIGN supports local and cloud model providers.
Choose mode by provider configuration in `.env`.

- Local-heavy mode:
  - set `OLLAMA_BASE_URL` and `OLLAMA_MODEL`
  - avoid external provider keys
- Hybrid mode:
  - local for low-risk tasks, cloud for high-reasoning tasks
- Cloud mode:
  - OpenAI/Anthropic/Gemini/OpenRouter/etc.

## Current Status

- Build: `npm run build` passes
- Tests: `npm test` passes (`67/67` tests verified locally)
- API coverage: OpenAPI exposed and exported
- Reliability features shipped:
  - runtime HITL checkpoints
  - mission budget cap enforcement
  - council step timeout controls
  - durable notification outbox and retries
  - soul history and rollback

## Docker Quick Start (API + Worker + Postgres + Redis)

```bash
cp .env.example .env
docker compose up --build
```

Then open:

- `http://localhost:3001/health`
- `http://localhost:3001/dashboard`
- `http://localhost:3001/api/openapi`

## Local CLI UI

```bash
npm run ui
```

The CLI supports agent selection/creation, model policy updates, and local chat.

## Script Reference

- `npm run dev` builds and runs the API in watch mode.
- `npm run start` builds and starts the API server.
- `npm run worker` builds and starts the background worker.
- `npm run ui` launches the local terminal UI.
- `npm run stream:reasoning` runs the streaming reasoning CLI flow.
- `npm run companion:macos` starts the macOS bridge companion node.
- `npm run companion:windows` starts the Windows bridge companion node.
- `npm run openapi:export` regenerates `openapi.json`.
- `npm run repo:audit` checks local files before a GitHub push.
- `npm run repo:audit:strict` runs the same audit and exits non-zero on warnings.
- `npm run start:prod` and `npm run worker:prod` run the built artifacts without rebuilding.

## Setup Doctor

Use the setup wizard to scaffold a serious workspace and auto-create a specialist team:

```bash
curl -X POST http://localhost:3001/api/setup/wizard/run \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "default",
    "personaName": "SOVEREIGN"
  }'
```

Then inspect readiness:

```bash
curl "http://localhost:3001/api/setup/doctor?workspaceId=default"
```

The readiness report scores security, team coverage, onboarding scaffold, intelligence configuration, and operating posture so you can close the biggest blockers first.

## Control Plane Auth

Gateway and security control-plane routes are bearer-token protected by default.

Bootstrap first-run admin access:

```bash
export SECURITY_BOOTSTRAP_TOKEN="change-me-now"
```

Example:

```bash
curl http://localhost:3001/api/gateway/status \
  -H "Authorization: Bearer $SECURITY_BOOTSTRAP_TOKEN"
```

After startup, issue narrower scoped tokens from `/api/security/auth/issue` and use those for remote clients and automation. For gateway clients, explicitly request scopes such as `gateway:read`, `gateway:write`, `gateway:node:invoke`, or `gateway:browser:control`.

## Environment Quick Reference

Set any model providers you want:

```bash
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
export GEMINI_API_KEY="..."
```

State backend switch:

```bash
export STATE_BACKEND="file"               # file | postgres | postgres_redis
export DATABASE_URL="postgres://user:pass@host:5432/db"
export REDIS_URL="redis://host:6379"
```

Optional web research providers:

```bash
export BRAVE_SEARCH_API_KEY="..."
export TAVILY_API_KEY="..."
export SERPAPI_API_KEY="..."
export PERPLEXITY_API_KEY="..."
```

Companion / bridge node settings:

```bash
export BRIDGE_URL="ws://127.0.0.1:3001/bridge/ws"
export COMPANION_BRIDGE_TOKEN="replace-me"
export COMPANION_NODE_ID="windows-laptop"
export COMPANION_SYSTEM_RUN_ENABLED="false"
```

After Prisma schema changes:

```bash
npx prisma generate
```

## API Endpoints

### Health
- `GET /health`
- `GET /api/openapi`
- `GET /api/openapi.json`

### Live Dashboard
- `GET /dashboard` (real-time web UI for orchestrator, council debate, and risk)
- `GET /api/dashboard/snapshot`

### Setup and Readiness
- `GET /api/setup/doctor`
- `POST /api/setup/wizard/run`
- `GET /api/setup/wizard/runs`
- `GET /api/setup/wizard/:runId`

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

### Gateway Control Plane (WebSocket + Nodes)
- `GET /api/gateway/status`
- `GET /api/gateway/ws-info`
- `GET /api/gateway/bridge/status`
- `GET /api/gateway/bridge/ws-info`
- `GET /api/gateway/bridge/nodes`
- `GET /api/gateway/nodes`
- `POST /api/gateway/nodes/register`
- `GET /api/gateway/nodes/:nodeId`
- `POST /api/gateway/nodes/:nodeId/invoke`
- `GET /api/gateway/browser/status`
- `POST /api/gateway/browser/start`
- `POST /api/gateway/browser/stop`
- `GET /api/gateway/browser/targets`
- `POST /api/gateway/browser/open`
- `POST /api/gateway/browser/cdp`
- `GET /api/gateway/tailscale/status`
- `POST /api/gateway/tailscale/plan`
- `POST /api/gateway/tailscale/apply`

Gateway WebSocket RPC methods:
- `gateway.ping`, `gateway.status`, `events.subscribe`
- `sessions.list`, `sessions.history`, `sessions.send`
- `node.list`, `node.describe`, `node.invoke`
- `bridge.status`, `bridge.nodes`
- `browser.status`, `browser.open`
- `tailscale.status`, `tailscale.plan`, `tailscale.apply`

Current node action coverage:
- implemented on host node: `system.run`, `system.notify`, `location.get`, `browser.open_url`, `browser.status`
- implemented for connected bridge nodes: `node.invoke` over `/bridge/ws`
- scaffolded for companion nodes: `camera.snap`, `camera.clip`, `screen.record`

Device bridge protocol:
- Companion connects to `ws://<host>:3001/bridge/ws` (or `wss://...`)
- Companion registers with `bridge.register` and heartbeats with `bridge.heartbeat`
- Gateway executes remote actions by sending `bridge.invoke` and waiting for result

macOS companion runtime:

```bash
npm run companion:macos
```

Windows companion runtime:

```bash
npm run companion:windows
```

Bridge + companion quick setup:

```bash
# terminal 1
cp .env.example .env
export DEVICE_BRIDGE_TOKEN="replace-me"
npm run start
```

```bash
# terminal 2
export COMPANION_BRIDGE_TOKEN="replace-me"
export COMPANION_NODE_ID="macos-borhen"
npm run companion:macos
```

```bash
# terminal 3 (invoke companion node action through gateway)
curl -X POST http://localhost:3001/api/gateway/nodes/macos-borhen/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "action": "system.notify",
    "input": { "title": "SOVEREIGN", "message": "Bridge invoke is live." }
  }'
```

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

## Bundled Plugins

- Runtime and host tools: `filesystem`, `shell-executor`, `system-info`, `browser-playwright`, `vision`
- Autonomy and scheduling: `scheduling`, `hibernation`, `webhook-router`, `mcp-client`
- Memory and self-improvement: `dialectic-memory`, `trajectory-compressor`, `core-mutator`, `meta-engineering`
- Coordination and network surfaces: `swarm-protocol`, `company-bank`
- Example / starter: `hello-world`

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

Current local verification target:
- `npm run build`
- `npm test`

## Open Source Project Files

- License: `LICENSE` (Apache-2.0)
- Contribution guide: `CONTRIBUTING.md`
- Code of conduct: `CODE_OF_CONDUCT.md`
- Security policy: `SECURITY.md`
- Deployment guide: `DEPLOYMENT.md`
- Operator runbook: `RUNBOOK.md`
- Support guide: `SUPPORT.md`
- Changelog: `CHANGELOG.md`
- Docs index: `docs/README.md`
- TypeScript SDK guide: `sdk/ts/README.md`

## CI / Release

- CI workflow: `.github/workflows/ci.yml`
- Security workflow: `.github/workflows/security.yml`
- Release workflow (tags `v*`): `.github/workflows/release.yml`
