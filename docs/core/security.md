# Security Model

SOVEREIGN applies runtime policy controls to autonomous execution, instead of only static prompt rules.

## Core Controls

- Runtime trust mediation on tool actions
- Approval gates for high-risk action types
- Rate and cost limits in security fabric
- Bearer-token protection on gateway and security control-plane routes
- Filesystem sandbox path checks
- Encrypted local secrets storage
- Runtime pause/resume checkpoints for risky or low-consensus execution

## Reliability Hardening

- Mission budget cap enforcement in company/autopilot loops
- Council step timeout guards to prevent stalled worker lanes
- Durable notification outbox with retry and backoff

## High-Risk Actions

`actionType` supports:

- `read`
- `write`
- `external_send`
- `financial`
- `destructive`

High-risk actions can trigger approval workflows before execution continues.

## Recommended Deployment Baseline

- Use dedicated workspace credentials and service accounts.
- Set `SECURITY_BOOTSTRAP_TOKEN` for first-run admin access, then move automation onto scoped issued tokens.
- Use Postgres + Redis for non-trivial workloads.
- Set rate/cost caps in `.env`.
- Keep webhook secrets and provider keys in secret manager, not plain files.
- Enable channel auth and pairing before external access.
- Monitor observability events and runtime action logs continuously.
- Re-run `GET /api/setup/doctor` after auth, channel, or deployment changes.

## Practical Limits

SOVEREIGN is not a zero-trust kernel-level isolation system.
It is an application-layer autonomous runtime with policy enforcement and strong operational guardrails.
