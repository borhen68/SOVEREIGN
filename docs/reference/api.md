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

## API Notes

- Some write paths support idempotency keys (for replay safety).
- Runtime trust and approval flows mediate high-risk actions.
- Use `workspaceId` consistently for multi-workspace isolation boundaries.
