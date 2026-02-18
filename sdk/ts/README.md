# @sovereign/client

Typed TypeScript client for the SOVEREIGN API.

## Install

```bash
npm install @sovereign/client
```

## Usage

```ts
import { SovereignClient } from "@sovereign/client";

const client = new SovereignClient({
  baseUrl: "http://localhost:3001"
});

const health = await client.getHealth();
const run = await client.executeCompanyObjective({
  workspaceId: "default",
  objective: "Plan and execute launch readiness."
});

console.log({ health, run });
```

## Generate OpenAPI

The SOVEREIGN server exposes the OpenAPI spec at:
- `GET /api/openapi`
- `GET /api/openapi.json`
