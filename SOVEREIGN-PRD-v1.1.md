# SOVEREIGN
## Product Requirements Document (v1.1)

**Subtitle:** The Outcome Intelligence Platform  
**Version:** 1.1 (Execution Draft)  
**Date:** February 17, 2026  
**Status:** Pre-Seed / Build-Ready  
**Owner:** Founding Team  
**Classification:** Confidential

---

## 1) Executive Summary
SOVEREIGN is a personal and team AI platform that turns goals into completed outcomes with verifiable proof.

Where existing agent platforms optimize for capability breadth, SOVEREIGN optimizes for a different promise:

**Reliable autonomy with trust guarantees.**

Users do not ask for tasks. They define outcomes.

Example:
- Not: "Send follow-up emails"
- But: "Book 12 qualified demos in 14 days under $2,000 spend"

SOVEREIGN plans, simulates, executes, verifies, and continuously adapts until the contract is complete or explicitly blocked.

### Product Positioning
- **Category:** Outcome Intelligence OS (open-core)
- **Primary wedge (v1):** Startup operators + engineering teams
- **Core value:** Commitment-to-closure automation with runtime trust
- **Deployment:** Local-first (Mac/Windows/Linux) + optional encrypted relay
- **Models:** OpenAI, Anthropic, and local LLMs

### 12-Month Goal
- 20,000 active users
- 1,000 paying teams
- $2M ARR
- Measurable reduction in missed commitments across pilot customers

---

## 2) Problem Statement
Current AI assistants fail at business-critical autonomy for five reasons:

1. **No outcome accountability**
They execute tasks, but do not own measurable business results.

2. **Low trust under autonomy**
Approvals are usually one-time; risk should be evaluated per action at runtime.

3. **Weak verification discipline**
Answers are often fluent but unverified, with limited contradiction handling.

4. **No closure engine**
Actions happen, but commitments are left half-finished and untracked.

5. **Poor operational observability**
Teams cannot confidently answer: what did the agent do, why, and with what impact?

### Opportunity
The winning platform will combine broad execution ability with:
- contract-based outcomes,
- runtime policy enforcement,
- verifiable reasoning and evidence,
- and explicit ROI reporting.

---

## 3) Product Vision
### Vision Statement
"An AI that can represent you, act safely, and close meaningful outcomes with proof."

### Design Principles
1. **Outcome-first:** every workflow maps to a KPI and deadline.
2. **Trust-by-design:** high-risk actions require runtime checks and approvals.
3. **Proof over claims:** every critical action produces evidence.
4. **Human override always:** user can pause, edit, or roll back.
5. **Progressive autonomy:** trust increases with demonstrated reliability.

---

## 4) Competitive Strategy (vs OpenClaw and peers)
SOVEREIGN does not try to win by integration count.

It wins with four moats:

1. **Mission Contracts**
Goal + deadline + budget + risk policy in one executable object.

2. **Shadow Simulation**
Simulate multiple execution strategies before committing real-world actions.

3. **Runtime Trust Fabric**
Per-action policy, risk scoring, approvals, and rollback.

4. **Closure + ROI Layer**
Every commitment resolves to `done`, `blocked`, or `cancelled` with evidence and impact.

### Positioning Table
| Capability | Typical agent platforms | SOVEREIGN |
|---|---|---|
| Broad integrations | Strong | Strong |
| Local-first control | Strong | Strong |
| Outcome contracting | Weak/none | Native |
| Simulate-before-execute | Weak/none | Native |
| Runtime policy per action | Partial | Native |
| Closure accountability | Partial | Native |
| ROI attribution | Weak | Native |

---

## 5) Product Scope
## 5.1 V1 (first 90 days) - Must ship
1. **Mission Contract Engine**
- Define outcome contract: KPI, deadline, budget, constraints
- Decompose into executable task graph
- Track progress and confidence in real time

2. **Execution + Verification Loop**
- Planner/Executor/Critic architecture
- Truth checks for high-impact factual claims
- Retry/fallback logic for failed actions

3. **Runtime Trust Fabric**
- Action-level risk classification (`read`, `write`, `external send`, `financial`, `destructive`)
- Policy-based approvals for risky categories
- Full audit log and rollback for reversible actions

4. **Closure Dashboard**
- Commitment tracker with status (`done/blocked/cancelled`)
- KPI delta (before vs after)
- Evidence timeline per mission

5. **Initial Connectors (v1 only)**
- Gmail
- Slack
- GitHub

## 5.2 V1 Non-goals
- Public skills marketplace
- Agent-to-agent open federation
- Family brain / multi-tenant social graph
- Advanced voice calling workflows
- Mobile-native app

---

## 6) Moonshot Pillars (Roadmap Narrative)
The original seven-pillar vision remains, but sequenced for execution.

### Phase A (Now): Trust + Closure Core
1. Soul Engine (basic identity profile and values)
2. Truth Engine (verification + contradiction surfacing)
3. Craftsperson Code (opinionated coding mode for engineering workflows)

### Phase B (Next): Growth Platform
4. Investigator Search (dossier-grade research)
5. Skills Economy (curated paid skills)

### Phase C (Future): Network Effects
6. Agent Council (controlled agent-to-agent negotiation)
7. Ambient Intelligence (always-on proactive mode)

---

## 7) User Personas (v1 focus)
1. **Operator Founder**
- Pain: dropped commitments, context switching
- Success: more commitments closed weekly with less manual follow-up

2. **Engineering Lead**
- Pain: issue triage and fix loops are slow and noisy
- Success: lower MTTR, faster validated PR flow

3. **Revenue Operator**
- Pain: follow-ups and CRM hygiene break pipeline momentum
- Success: faster response cycles and higher meeting-booked rate

---

## 8) Core User Journeys
## 8.1 Mission Creation
User creates mission: "Ship bugfix X and reduce support tickets by 25% in 14 days."

System output:
- contract summary,
- proposed strategies (simulated),
- selected plan,
- required approvals.

## 8.2 Runtime Execution
- AI executes low-risk tasks automatically.
- High-risk tasks generate explicit approval prompts.
- Critic verifies evidence and blocks low-confidence branches.

## 8.3 Closure and Review
- Mission completes with KPI report.
- Timeline shows decisions, actions, evidence, and rollback points.
- User can fork mission playbook for reuse.

---

## 9) Functional Requirements
## 9.1 Mission Contract Engine
- `FR-001`: Create/edit mission contracts with structured schema.
- `FR-002`: Convert mission into DAG of tasks with dependencies.
- `FR-003`: Support constraints (budget, tools, policy, deadlines).
- `FR-004`: Maintain mission state and confidence scoring.

## 9.2 Agent Runtime
- `FR-005`: Planner generates >=3 candidate plans when possible.
- `FR-006`: Executor performs tool actions with idempotency guards.
- `FR-007`: Critic validates outputs and enforces stop conditions.
- `FR-008`: Failed steps auto-retry based on strategy rules.

## 9.3 Trust and Governance
- `FR-009`: Every action receives risk score at runtime.
- `FR-010`: Policy engine maps risk to required approval level.
- `FR-011`: Immutable audit event for each action.
- `FR-012`: Rollback for supported reversible operations.

## 9.4 Verification Layer
- `FR-013`: High-impact factual claims require source-backed verification.
- `FR-014`: Contradicting sources must be surfaced, not hidden.
- `FR-015`: Claims include confidence and freshness metadata.

## 9.5 Integrations (v1)
- `FR-016`: Gmail read/draft/send with scoped permissions.
- `FR-017`: Slack channel/DM interaction with policy rules.
- `FR-018`: GitHub issue/PR workflows and status checks.

## 9.6 Observability and ROI
- `FR-019`: Mission timeline with filterable action history.
- `FR-020`: KPI attribution and weekly ROI summary.

---

## 10) Non-Functional Requirements
1. **Security:** local-first encrypted storage by default.
2. **Privacy:** user-controlled keys for optional cloud sync.
3. **Latency:** <2s response for control-plane actions; tool actions vary by provider.
4. **Reliability:** 99.5% mission orchestration uptime for hosted components.
5. **Traceability:** every action is attributable to mission, actor, and policy decision.
6. **Extensibility:** connector and skill interfaces versioned from day one.

---

## 11) Technical Architecture
## 11.1 Runtime Components
- **Control Plane:** mission creation, policy configuration, dashboard
- **Orchestrator:** planner/executor/critic loop + queue
- **Policy Engine:** risk classification + approval routing
- **Verification Service:** source retrieval, contradiction analysis, confidence scoring
- **Connector Layer:** Gmail, Slack, GitHub adapters
- **Evidence Store:** immutable action/event log

## 11.2 Suggested Stack
- Runtime: Node.js + TypeScript
- UI: React + Next.js desktop/web control panel
- Queue: Redis + worker pool
- DB: Postgres (metadata), object store for artifacts
- Local storage: encrypted SQLite for on-device context
- Model routing: provider-agnostic adapter (OpenAI/Anthropic/local)

## 11.3 Security Model
- Secrets in encrypted vault, never plaintext in logs
- Short-lived tokens where possible
- Connector permissions scoped minimally
- High-risk action categories blocked by default

---

## 12) Data Model (v1)
Core entities:
- `User`
- `Workspace`
- `MissionContract`
- `MissionTask`
- `ActionEvent`
- `EvidenceArtifact`
- `PolicyRule`
- `ApprovalRequest`
- `IntegrationConnection`
- `MetricSnapshot`

Key statuses:
- Mission: `draft`, `simulating`, `executing`, `paused`, `completed`, `blocked`, `cancelled`
- Task: `pending`, `in_progress`, `done`, `failed`, `skipped`
- Approval: `requested`, `approved`, `rejected`, `expired`

---

## 13) Success Metrics
## 13.1 North Star
**Commitment Closure Rate (CCR)**  
`% of mission commitments completed on time with evidence`.

## 13.2 Primary KPIs (Day 90 targets)
1. CCR >= 70% across pilot teams
2. Missed-commitment rate reduced by >= 30%
3. Median time-to-first-meaningful-action <= 10 minutes
4. User trust score (post-mission) >= 4.3/5
5. Weekly active mission creators >= 35% of MAU

## 13.3 Guardrail KPIs
1. Unsafe action incidents = 0
2. Approval bypass incidents = 0
3. Verification override rate <= 5%
4. Rollback success rate >= 95% for supported action classes

---

## 14) Roadmap
## Phase 1 (0-3 months): Core Launch
- Mission Contract Engine
- Planner/Executor/Critic loop
- Runtime policy + approvals
- Gmail/Slack/GitHub connectors
- Closure dashboard

## Phase 2 (3-6 months): Quality and Scale
- Investigator Search v1
- Craftsperson Code deep mode
- Team workspaces and RBAC
- Playbook templates by workflow type

## Phase 3 (6-9 months): Platform Expansion
- Curated Skills Economy launch
- Advanced verification (temporal tracking)
- Agent Council private beta (opt-in)

## Phase 4 (9-12 months): Ecosystem
- Marketplace expansion
- Enterprise controls (SSO, audit export)
- Mobile command center

---

## 15) Business Model
1. **Free:** limited active missions + basic connectors
2. **Pro ($29/mo):** expanded missions, advanced verification, deeper automations
3. **Team ($79/seat/mo):** shared workspaces, policy controls, analytics
4. **Enterprise:** custom pricing, deployment options, compliance features
5. **Marketplace (Phase 3+):** 20% fee on paid skills and templates

---

## 16) Go-to-Market
1. Launch narrative: **"From AI actions to AI outcomes."**
2. Public challenge campaign: live mission completion with evidence replay.
3. 10 design partners (operators + engineering leads) for case studies.
4. Content engine: before/after KPI reports, not generic demos.

---

## 17) Risks and Mitigations
1. **Over-scope risk**
Mitigation: strict v1 scope gate and monthly kill-list review.

2. **Model quality variance**
Mitigation: multi-model routing + critic validation + fallback chains.

3. **Legal and policy risk in automation workflows**
Mitigation: compliance-first connector policies, no evasion positioning, explicit user accountability controls.

4. **User trust failure after one bad autonomous action**
Mitigation: progressive autonomy, approval defaults, immediate rollback + incident report.

5. **Competitor feature catch-up**
Mitigation: prioritize trust fabric + closure metrics + mission replay moat.

---

## 18) Open Decisions
1. Which vertical playbooks ship first: engineering velocity or revenue ops?
2. What minimum evidence standard is required for mission completion?
3. Should mission simulation be mandatory for high-risk missions?
4. What policy presets should be default for first-time users?

---

## 19) Appendix: Original Vision Alignment
Your original vision remains intact and maps into this execution model:
- **Soul Engine** -> trust and identity continuity
- **Truth Engine** -> verification and contradiction handling
- **Ghost Browser vision** -> reframed as compliant adaptive automation
- **Investigator Search** -> phase-2 research-grade outputs
- **Craftsperson Code** -> opinionated engineering mode
- **Skills Economy** -> monetized extension layer
- **Agent Council** -> long-term network protocol

This v1.1 draft preserves the ambition while making the build sequence credible.
