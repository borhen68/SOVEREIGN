# Runbook

## SLO Targets
- API availability: 99.9%
- Webhook processing success: 99.5%
- Company run completion without manual intervention: 90%+

## Operational Checks
- `GET /health`
- `GET /api/observability/metrics`
- `GET /api/runtime/metrics`
- `GET /api/heartbeat/runs?limit=50`

## Incident Response
1. Identify impacted surface (API, worker, channels, LLM upstream).
2. Pause risky automation:
   - `POST /api/autopilot/goals/:goalId/pause`
   - `POST /api/heartbeat/jobs/:jobId/pause`
3. Inspect logs and runtime actions.
4. Mitigate and rollback if needed.
5. Resume paused jobs when stable.

## Backup / Restore
- Persisted state is stored in `.data/store.json` by default.
- Back up `.data/` regularly.
- Restore by replacing `.data/store.json` and restarting services.
