# API and SDK Reference

## OpenAPI

- Live spec:
  - `GET /api/openapi`
  - `GET /api/openapi.json`
- Export spec file:

```bash
npm run openapi:export
```

Generated artifact:

- `openapi.json`

## SDKs

- TypeScript runtime client:
  - `src/sdk/sovereign-client.ts`
- Publishable TS package:
  - `sdk/ts` (`@sovereign/client`)
- Python starter:
  - `sdk/python/sovereign_client.py`

## TypeScript Example

```ts
import { SovereignClient } from "@sovereign/client";

const client = new SovereignClient({ baseUrl: "http://localhost:3001" });

const run = await client.executeCompanyObjective({
  workspaceId: "default",
  objective: "Ship reliability updates and summarize outcomes."
});

console.log(run);
```

## High-Value Endpoint Groups

- Company orchestration:
  - `POST /api/company/execute`
  - `GET /api/company/runs`
  - `POST /api/company/runs/:runId/resume`
- Autopilot:
  - `POST /api/autopilot/goals`
  - `GET /api/autopilot/goals`
  - `POST /api/autopilot/goals/:goalId/run`
- Architecture and soul control:
  - `POST /api/architecture/company-plan`
  - `POST /api/architecture/soul/evolve`
  - `GET /api/architecture/soul/:agentId/history`
  - `POST /api/architecture/soul/:agentId/rollback`
- Memory:
  - `POST /api/memory/index`
  - `POST /api/memory/search`
  - `POST /api/memory/reindex`
- Observability:
  - `GET /api/observability/events`
  - `GET /api/observability/metrics`
  - `GET /api/observability/traces`
- Dashboard and setup:
  - `GET /api/dashboard/snapshot`
  - `GET /api/setup/doctor`
  - `POST /api/setup/wizard/run`
  - `GET /api/setup/wizard/runs`
- Gateway control plane:
  - `GET /api/gateway/status`
  - `GET /api/gateway/ws-info`
  - `GET /api/gateway/bridge/status`
  - `GET /api/gateway/bridge/ws-info`
  - `GET /api/gateway/bridge/nodes`
  - `GET /api/gateway/nodes`
  - `POST /api/gateway/nodes/register`
  - `POST /api/gateway/nodes/:nodeId/invoke`
  - `GET /api/gateway/browser/status`
  - `POST /api/gateway/browser/open`
  - `POST /api/gateway/tailscale/plan`

## API Notes

- Some write paths support idempotency keys (for replay safety).
- Runtime trust and approval flows mediate high-risk actions.
- Use `workspaceId` consistently for multi-workspace isolation boundaries.

## Gateway WebSocket Control Plane

Discover endpoint:

- `GET /api/gateway/ws-info`

RPC methods over WebSocket:

- `gateway.ping`, `gateway.status`, `events.subscribe`
- `sessions.list`, `sessions.history`, `sessions.send`
- `node.list`, `node.describe`, `node.invoke`
- `bridge.status`, `bridge.nodes`
- `browser.status`, `browser.open`
- `tailscale.status`, `tailscale.plan`, `tailscale.apply`

Node action support in this build:

- Implemented (host node): `system.run`, `system.notify`, `location.get`, `browser.open_url`, `browser.status`
- Implemented (bridge-connected companion nodes): `node.invoke` request/response over `/bridge/ws`
- Scaffolded (requires native app APIs): `camera.snap`, `camera.clip`, `screen.record`

## Bridge Invocation Example

1. Start API with bridge token (`DEVICE_BRIDGE_TOKEN`) configured.
2. Start macOS companion runtime (`npm run companion:macos`) with matching `COMPANION_BRIDGE_TOKEN`.
3. Invoke remote node action:

```bash
curl -X POST http://localhost:3001/api/gateway/nodes/<nodeId>/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "action": "system.notify",
    "input": { "title": "SOVEREIGN", "message": "Remote invoke works." }
  }'
```
