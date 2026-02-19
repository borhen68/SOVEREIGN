# Showcase Flows

This page gives short demos you can copy/paste for social posts or first-time tests.

## 1) Company Run

```bash
curl -X POST http://localhost:3001/api/company/execute \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "default",
    "objective": "Create launch plan, ship reliability updates, and send final summary."
  }'
```

Check status:

```bash
curl http://localhost:3001/api/company/runs
```

## 2) Autopilot Goal

```bash
curl -X POST http://localhost:3001/api/autopilot/goals \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "default",
    "title": "Weekly operations delegate",
    "objective": "Review reliability risks and produce action plan.",
    "maxCycles": 10
  }'
```

Trigger one cycle manually:

```bash
curl -X POST http://localhost:3001/api/autopilot/goals/<goalId>/run
```

## 3) Soul Evolution + Rollback

Evolve:

```bash
curl -X POST http://localhost:3001/api/architecture/soul/evolve \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "<agentId>",
    "performanceScore": 0.35,
    "outcome": "Incident happened, verification was weak."
  }'
```

History:

```bash
curl "http://localhost:3001/api/architecture/soul/<agentId>/history?limit=20"
```

Rollback:

```bash
curl -X POST http://localhost:3001/api/architecture/soul/<agentId>/rollback \
  -H "Content-Type: application/json" \
  -d '{
    "targetVersion": 1,
    "reason": "restore stable policy"
  }'
```

## 4) Outbox Retry Processing

Process queued notifications:

```bash
curl -X POST http://localhost:3001/api/heartbeat/outbox/process \
  -H "Content-Type: application/json" \
  -d '{"limit": 50}'
```

Inspect outbox:

```bash
curl "http://localhost:3001/api/heartbeat/outbox?status=pending&limit=50"
```
