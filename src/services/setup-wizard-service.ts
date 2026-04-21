// @ts-nocheck
import fs from "node:fs";
import path from "node:path";
import { makeId } from "../lib/id.js";
import { nowIso } from "../lib/time.js";

const DEFAULT_WORKSPACE_DIR = ".zeroclaw";
const DEFAULT_SCAFFOLD_FILES = [
  "MISSION.md",
  "SOUL.md",
  "SKILLS.md",
  "MEMORY.md",
  "HEARTBEAT.md",
  "SECURITY.md",
  "AGENTS.md",
  "ENV-CHECKLIST.md",
  path.join("docs", "ONBOARDING.md"),
  path.join("docs", "RUNBOOK.md")
];

const DEFAULT_SPECIALIST_BLUEPRINTS = [
  {
    name: "Investigator",
    title: "Evidence Investigator",
    skills: ["research", "analysis", "verification", "product"],
    canUseWeb: true,
    soul: {
      mission: "Find reliable evidence, surface blind spots, and challenge weak assumptions.",
      values: ["truth", "clarity", "evidence-first"],
      communicationStyle: "forensic",
      riskTolerance: "balanced"
    }
  },
  {
    name: "Strategist",
    title: "Growth Strategist",
    skills: ["strategy", "planning", "sales", "growth"],
    canUseWeb: true,
    soul: {
      mission: "Convert goals into focused plans with measurable upside and explicit tradeoffs.",
      values: ["focus", "outcomes", "tradeoff-discipline"],
      communicationStyle: "executive",
      riskTolerance: "balanced"
    }
  },
  {
    name: "Builder",
    title: "Execution Builder",
    skills: ["engineering", "coding", "ops", "delivery"],
    canUseWeb: false,
    soul: {
      mission: "Turn plans into shipped, reliable work with strong ownership and fast feedback loops.",
      values: ["ownership", "quality", "ship-fast"],
      communicationStyle: "direct",
      riskTolerance: "balanced"
    }
  },
  {
    name: "Guardian",
    title: "Risk Guardian",
    skills: ["security", "governance", "compliance", "reliability"],
    canUseWeb: true,
    soul: {
      mission: "Prevent avoidable incidents while keeping execution velocity high.",
      values: ["safety", "accountability", "resilience"],
      communicationStyle: "precise",
      riskTolerance: "conservative"
    }
  }
];

const SPECIALIST_COVERAGE_CHECKS = [
  {
    key: "research",
    title: "Research and evidence",
    skills: ["research", "analysis", "verification", "product"]
  },
  {
    key: "strategy",
    title: "Strategy and growth",
    skills: ["strategy", "planning", "sales", "growth", "product"]
  },
  {
    key: "execution",
    title: "Execution and delivery",
    skills: ["engineering", "coding", "ops", "delivery", "project-management"]
  },
  {
    key: "risk",
    title: "Risk and governance",
    skills: ["security", "governance", "compliance", "reliability", "legal"]
  }
];

function safeString(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function normalizeProviders(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const item of input) {
    const normalized = String(item ?? "").trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function writeIfMissing(filePath, content) {
  if (fs.existsSync(filePath)) {
    return false;
  }
  fs.writeFileSync(filePath, content, "utf8");
  return true;
}

function normalizeWorkspaceDir(cwd, workspaceDir) {
  return path.resolve(cwd, safeString(workspaceDir, DEFAULT_WORKSPACE_DIR));
}

function normalizeAgentSkills(agent) {
  return Array.isArray(agent?.skills)
    ? agent.skills.map((item) => safeString(item).toLowerCase()).filter(Boolean)
    : [];
}

function overlapCount(left = [], right = []) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || right.length === 0) {
    return 0;
  }
  const rightSet = new Set(right.map((item) => safeString(item).toLowerCase()).filter(Boolean));
  let overlap = 0;
  for (const item of left) {
    const normalized = safeString(item).toLowerCase();
    if (normalized && rightSet.has(normalized)) {
      overlap += 1;
    }
  }
  return overlap;
}

function buildCheck(input = {}) {
  return {
    id: safeString(input.id),
    category: safeString(input.category, "general"),
    title: safeString(input.title, "Untitled check"),
    status: safeString(input.status, "warn"),
    message: safeString(input.message),
    action: safeString(input.action),
    detail: input.detail && typeof input.detail === "object" ? input.detail : {}
  };
}

function statusWeight(status) {
  const normalized = safeString(status).toLowerCase();
  if (normalized === "pass") {
    return 1;
  }
  if (normalized === "warn") {
    return 0.55;
  }
  return 0;
}

function summarizeReadiness(checks = []) {
  const safeChecks = Array.isArray(checks) ? checks : [];
  const passCount = safeChecks.filter((check) => check.status === "pass").length;
  const warnCount = safeChecks.filter((check) => check.status === "warn").length;
  const failCount = safeChecks.filter((check) => check.status === "fail").length;
  const score =
    safeChecks.length === 0
      ? 0
      : Math.round(
          (safeChecks.reduce((sum, check) => sum + statusWeight(check.status), 0) / safeChecks.length) * 100
        );

  let verdict = "bootstrapping";
  if (failCount === 0 && score >= 85) {
    verdict = "production-leaning";
  } else if (failCount <= 1 && score >= 70) {
    verdict = "competitive-with-gaps";
  } else if (score >= 50) {
    verdict = "functional-but-fragile";
  }

  const categories = {};
  for (const check of safeChecks) {
    if (!categories[check.category]) {
      categories[check.category] = {
        total: 0,
        pass: 0,
        warn: 0,
        fail: 0,
        score: 0
      };
    }
    const bucket = categories[check.category];
    bucket.total += 1;
    bucket[check.status] = (bucket[check.status] ?? 0) + 1;
    bucket.score = Math.round(((bucket.score * (bucket.total - 1)) + statusWeight(check.status) * 100) / bucket.total);
  }

  const nextActions = safeChecks
    .filter((check) => check.status !== "pass" && check.action)
    .sort((left, right) => {
      const leftPriority = left.status === "fail" ? 0 : 1;
      const rightPriority = right.status === "fail" ? 0 : 1;
      return leftPriority - rightPriority;
    })
    .slice(0, 6)
    .map((check) => check.action);

  return {
    score,
    verdict,
    passCount,
    warnCount,
    failCount,
    categories,
    nextActions,
    summary:
      failCount === 0
        ? `Workspace readiness is ${score}/100 with ${warnCount} gap(s) still worth closing.`
        : `Workspace readiness is ${score}/100 with ${failCount} blocking gap(s) and ${warnCount} warning(s).`
  };
}

export class SetupWizardService {
  constructor(options = {}) {
    this.store = options.store;
    this.cwd = options.cwd ?? process.cwd();
    this.agentService = options.agentService;
    this.tunnelService = options.tunnelService ?? null;
    this.observabilityService = options.observabilityService ?? null;
    this.llmService = options.llmService ?? null;
    this.securityFabricService = options.securityFabricService ?? null;
    this.channelGatewayService = options.channelGatewayService ?? null;
    this.webResearchService = options.webResearchService ?? null;
    this.heartbeatService = options.heartbeatService ?? null;
    this.autopilotService = options.autopilotService ?? null;
    this.browserControlService = options.browserControlService ?? null;
    this.deviceBridgeService = options.deviceBridgeService ?? null;
    this.nodeService = options.nodeService ?? null;
    this.stateBackendService = options.stateBackendService ?? null;
  }

  async listRuns(workspaceId = null) {
    return this.store.listWizardRuns(workspaceId ? safeString(workspaceId) : null);
  }

  async getRun(runId) {
    return this.store.getWizardRunById(safeString(runId));
  }

  async runQuickSetup(input = {}) {
    const workspaceId = safeString(input.workspaceId, "default");
    const workspaceDir = normalizeWorkspaceDir(this.cwd, input.workspaceDir);
    const providers = normalizeProviders(input.providers ?? ["openai", "anthropic", "gemini"]);
    const channels = normalizeProviders(input.channels ?? ["local"]);
    const tunnelProvider = safeString(input.tunnelProvider, "custom").toLowerCase();
    const personaName = safeString(input.personaName, "SOVEREIGN");
    const timezone = safeString(input.timezone, "UTC");
    const autoCreateSpecialists = input.autoCreateSpecialists !== false;

    fs.mkdirSync(workspaceDir, { recursive: true });
    const docsDir = path.join(workspaceDir, "docs");
    fs.mkdirSync(docsDir, { recursive: true });

    const scaffoldFiles = [
      {
        file: path.join(workspaceDir, "MISSION.md"),
        content: `# Mission\n\nDefine your top-level objective contracts for ${personaName}.\n`
      },
      {
        file: path.join(workspaceDir, "SOUL.md"),
        content: `# Soul\n\nMission: Coordinate specialist agents to deliver outcomes.\nValues: clarity, ownership, trust.\n`
      },
      {
        file: path.join(workspaceDir, "SKILLS.md"),
        content: "# Skills\n\nCatalog of auto-generated and manually curated skills.\n"
      },
      {
        file: path.join(workspaceDir, "MEMORY.md"),
        content: "# Memory\n\nLong-term memory summaries and decisions.\n"
      },
      {
        file: path.join(workspaceDir, "HEARTBEAT.md"),
        content: "# Heartbeat\n\nScheduled proactive tasks and reminders.\n"
      },
      {
        file: path.join(workspaceDir, "SECURITY.md"),
        content: [
          "# Security",
          "",
          "- Require bearer auth on the gateway and security control plane.",
          "- Issue narrow-scoped tokens for automation and remote clients.",
          "- Review `/api/setup/doctor` until the readiness score is strong.",
          "- Document every externally reachable channel and pairing flow.",
          ""
        ].join("\n")
      },
      {
        file: path.join(workspaceDir, "AGENTS.md"),
        content: [
          "# Agent Roster",
          "",
          `## Main`,
          `- ${personaName} Main — executive synthesizer and final accountable agent.`,
          "",
          "## Specialists",
          ...DEFAULT_SPECIALIST_BLUEPRINTS.map(
            (blueprint) =>
              `- ${personaName} ${blueprint.name} — ${blueprint.title} (${blueprint.skills.join(", ")})`
          ),
          ""
        ].join("\n")
      },
      {
        file: path.join(workspaceDir, "ENV-CHECKLIST.md"),
        content: [
          "# Environment Checklist",
          "",
          "## Required before exposing the product",
          '- Set `SECURITY_BOOTSTRAP_TOKEN` to a strong secret.',
          "- Configure at least one LLM provider key.",
          "- Run `/api/setup/doctor` and close every failing check.",
          "",
          "## Optional but recommended",
          "- Configure Telegram or WhatsApp credentials if you want external channels.",
          "- Move from file persistence to Postgres/Redis before serious production use.",
          "- Enable the device bridge or browser controller only when you need them.",
          ""
        ].join("\n")
      },
      {
        file: path.join(docsDir, "ONBOARDING.md"),
        content: [
          "# Onboarding",
          "",
          "1. Configure at least one LLM provider and a bootstrap auth token.",
          "2. Run `GET /api/setup/doctor` until blockers are gone.",
          "3. Open `/dashboard` and confirm the readiness panel is healthy.",
          "4. Run your first company objective and inspect the evidence dossier.",
          ""
        ].join("\n")
      },
      {
        file: path.join(docsDir, "RUNBOOK.md"),
        content: [
          "# Runbook",
          "",
          "## Daily operator loop",
          "1. Check `/dashboard` for readiness, approvals, and active runs.",
          "2. Review `/api/setup/doctor` after any config or deployment change.",
          "3. Rotate bootstrap access into scoped tokens for automation and remote clients.",
          "4. Treat low-evidence runs as incomplete, even if execution technically finished.",
          ""
        ].join("\n")
      }
    ];

    let createdFiles = 0;
    for (const item of scaffoldFiles) {
      if (writeIfMissing(item.file, item.content)) {
        createdFiles += 1;
      }
    }

    let mainAgent = (await this.agentService.listAgents(workspaceId))
      .find((agent) => agent.role === "main");
    if (!mainAgent) {
      mainAgent = await this.agentService.createAgent({
        workspaceId,
        name: `${personaName} Main`,
        role: "main",
        skills: ["planning", "strategy", "execution", "governance"],
        canUseWeb: true,
        soul: {
          mission: "Run a company of specialist AI agents and deliver outcomes end-to-end.",
          values: ["clarity", "ownership", "trust"],
          communicationStyle: "executive",
          riskTolerance: "balanced"
        }
      });
    }

    const specialistSetup = autoCreateSpecialists
      ? await this.#ensureSpecialistTeam({
          workspaceId,
          personaName
        })
      : { specialists: [], createdSpecialists: [] };

    let tunnel = null;
    if (this.tunnelService) {
      tunnel = this.tunnelService.createTunnel({
        workspaceId,
        provider: tunnelProvider,
        name: `${tunnelProvider}-default`,
        active: false,
        traits: ["byotunnel", "secure-default"],
        config: {}
      });
    }

    const createdAt = nowIso();
    const run = this.store.createWizardRun({
      id: makeId("wizard"),
      workspaceId,
      status: "completed",
      steps: [
        "workspace",
        "provider",
        "channels",
        "tunnel",
        "tool-mode",
        "personalize",
        "scaffold"
      ],
      result: {
        workspaceDir,
        providers,
        channels,
        tunnelProvider,
        timezone,
        mainAgentId: mainAgent.id,
        specialistAgentIds: specialistSetup.specialists.map((agent) => agent.id),
        specialistCreatedCount: specialistSetup.createdSpecialists.length,
        tunnelId: tunnel?.id ?? null,
        createdFiles
      },
      createdAt,
      updatedAt: createdAt
    });
    const readiness = await this.runDoctor({
      workspaceId,
      workspaceDir
    });
    const patchedRun = await this.store.updateWizardRun(run.id, {
      steps: [
        "workspace",
        "provider",
        "channels",
        "tunnel",
        "tool-mode",
        "personalize",
        "scaffold",
        "specialists",
        "doctor"
      ],
      result: {
        ...run.result,
        readiness
      },
      updatedAt: nowIso()
    });

    this.#observe("wizard.completed", "Setup wizard completed.", {
      runId: patchedRun.id,
      workspaceId,
      createdFiles,
      specialistCreatedCount: specialistSetup.createdSpecialists.length,
      readinessScore: readiness.score
    });
    return patchedRun;
  }

  async runDoctor(input = {}) {
    const workspaceId = safeString(input.workspaceId, "default");
    const workspaceDir = await this.#resolveWorkspaceDir(workspaceId, input.workspaceDir);
    const scaffoldStatus = this.#readScaffoldStatus(workspaceDir);
    const agents = await this.agentService.listAgents(workspaceId);
    const mainAgent = agents.find((agent) => agent.role === "main") ?? null;
    const subAgents = agents.filter((agent) => agent.role === "sub");
    const specialistCoverage = this.#assessSpecialistCoverage(subAgents);
    const configuredProviders =
      this.llmService && typeof this.llmService.listProviders === "function"
        ? this.llmService.listProviders().filter((provider) => provider.configured)
        : [];
    const adapters =
      this.channelGatewayService && typeof this.channelGatewayService.listAdapters === "function"
        ? this.channelGatewayService.listAdapters()
        : [];
    const configuredExternalAdapters = adapters.filter(
      (adapter) => adapter.id !== "local" && adapter.configured === true
    );
    const persistenceStatus =
      typeof this.store?.getPersistenceStatus === "function"
        ? this.store.getPersistenceStatus()
        : { externalEnabled: false, externalError: null };
    const backendStatus =
      this.stateBackendService && typeof this.stateBackendService.getStatus === "function"
        ? await this.stateBackendService.getStatus()
        : { enabled: false, mode: "file" };
    const authTokens = await this.store.listSecurityAuthTokens({
      workspaceId,
      limit: 200
    });
    const pairings = await this.store.listSecurityPairings({
      workspaceId,
      limit: 200
    });
    const researchStatus =
      this.webResearchService && typeof this.webResearchService.getStatus === "function"
        ? this.webResearchService.getStatus()
        : {
            lookupProviders: [],
            documentFetchEnabled: false
          };
    const checks = [
      buildCheck({
        id: "security.control-plane-auth",
        category: "security",
        title: "Control plane auth",
        status: this.securityFabricService?.authRequired ? "pass" : "fail",
        message: this.securityFabricService?.authRequired
          ? "Gateway and security control-plane routes require bearer auth."
          : "Control-plane auth is disabled.",
        action: "Enable `SECURITY_REQUIRE_AUTH=true` before any remote exposure."
      }),
      buildCheck({
        id: "security.admin-bootstrap",
        category: "security",
        title: "Bootstrap or issued admin access",
        status:
          this.securityFabricService?.bootstrapToken || authTokens.length > 0
            ? "pass"
            : "warn",
        message:
          this.securityFabricService?.bootstrapToken || authTokens.length > 0
            ? "Administrative access path exists for first-run setup or automation."
            : "No bootstrap token or issued auth tokens were detected.",
        action: "Set `SECURITY_BOOTSTRAP_TOKEN` or issue a scoped token from `/api/security/auth/issue`."
      }),
      buildCheck({
        id: "workspace.main-agent",
        category: "team",
        title: "Main agent",
        status: mainAgent ? "pass" : "fail",
        message: mainAgent
          ? `Main agent "${mainAgent.name}" is configured.`
          : "No main agent exists for this workspace.",
        action: "Run the setup wizard or create a main agent before delegating work."
      }),
      buildCheck({
        id: "workspace.specialists",
        category: "team",
        title: "Specialist coverage",
        status:
          subAgents.length === 0
            ? "fail"
            : specialistCoverage.coveredCount >= 3
              ? "pass"
              : "warn",
        message:
          subAgents.length === 0
            ? "No specialist sub-agents exist yet."
            : `${specialistCoverage.coveredCount}/4 specialist lanes are covered across ${subAgents.length} sub-agent(s).`,
        action: "Create or keep at least research, strategy, execution, and risk specialists."
      }),
      buildCheck({
        id: "intelligence.providers",
        category: "intelligence",
        title: "LLM providers",
        status: configuredProviders.length > 0 ? "pass" : "fail",
        message:
          configuredProviders.length > 0
            ? `Configured providers: ${configuredProviders.map((provider) => provider.provider).join(", ")}.`
            : "No LLM providers are configured yet.",
        action: "Set at least one provider API key or local model endpoint before serious use."
      }),
      buildCheck({
        id: "intelligence.research",
        category: "intelligence",
        title: "Evidence retrieval depth",
        status:
          Array.isArray(researchStatus.lookupProviders) && researchStatus.lookupProviders.length >= 2
            ? "pass"
            : "warn",
        message:
          Array.isArray(researchStatus.lookupProviders) && researchStatus.lookupProviders.length > 0
            ? `Research providers available: ${researchStatus.lookupProviders.join(", ")}.`
            : "Research service is running with minimal source diversity.",
        action: "Expand evidence retrieval beyond a single lookup source before trusting strong verification claims."
      }),
      buildCheck({
        id: "workspace.scaffold",
        category: "onboarding",
        title: "Workspace scaffold",
        status:
          scaffoldStatus.missing.length === 0
            ? "pass"
            : scaffoldStatus.present.length >= 6
              ? "warn"
              : "fail",
        message:
          scaffoldStatus.missing.length === 0
            ? `Workspace scaffold is present in ${workspaceDir}.`
            : `${scaffoldStatus.present.length}/${DEFAULT_SCAFFOLD_FILES.length} recommended setup files were found.`,
        action: "Run the setup wizard to scaffold onboarding, runbook, and agent-roster files."
      }),
      buildCheck({
        id: "operations.persistence",
        category: "operations",
        title: "Persistence mode",
        status:
          backendStatus?.enabled || persistenceStatus?.externalEnabled
            ? "pass"
            : "warn",
        message:
          backendStatus?.enabled || persistenceStatus?.externalEnabled
            ? `External persistence is enabled (${safeString(backendStatus?.mode, "external")}).`
            : "The workspace is currently using local file persistence only.",
        action: "Move to Postgres or Redis-backed persistence before higher-scale or multi-operator use."
      }),
      buildCheck({
        id: "operations.channels",
        category: "operations",
        title: "Channel reach",
        status: configuredExternalAdapters.length > 0 ? "pass" : "warn",
        message:
          configuredExternalAdapters.length > 0
            ? `Configured external channels: ${configuredExternalAdapters.map((adapter) => adapter.id).join(", ")}.`
            : "Only the local channel appears ready right now.",
        action: "Configure at least one external channel if you want a true always-on assistant experience."
      }),
      buildCheck({
        id: "operations.automation",
        category: "operations",
        title: "Automation loop",
        status:
          this.heartbeatService?.autoStart !== false || this.autopilotService?.autoStart !== false
            ? "pass"
            : "warn",
        message:
          this.heartbeatService?.autoStart !== false || this.autopilotService?.autoStart !== false
            ? "At least one autonomous background loop is enabled."
            : "Heartbeat and autopilot background loops are both disabled.",
        action: "Enable heartbeat or autopilot when you want scheduled or unattended execution."
      }),
      buildCheck({
        id: "operations.operator-surface",
        category: "operations",
        title: "Operator surfaces",
        status: "pass",
        message: "Dashboard and API operator surfaces are available.",
        action: ""
      })
    ];

    const readiness = summarizeReadiness(checks);
    return {
      workspaceId,
      workspaceDir,
      generatedAt: nowIso(),
      ...readiness,
      checks,
      metrics: {
        configuredProviders: configuredProviders.length,
        configuredExternalChannels: configuredExternalAdapters.length,
        pairings: pairings.length,
        issuedAuthTokens: authTokens.length,
        agentCount: agents.length,
        mainAgentCount: mainAgent ? 1 : 0,
        subAgentCount: subAgents.length,
        specialistCoverage: specialistCoverage.coverage
      }
    };
  }

  #observe(type, message, payload) {
    if (!this.observabilityService) {
      return;
    }
    this.observabilityService.record({
      source: "setup-wizard",
      type,
      message,
      payload
    });
  }

  async #resolveWorkspaceDir(workspaceId, workspaceDir) {
    const explicit = safeString(workspaceDir);
    if (explicit) {
      return normalizeWorkspaceDir(this.cwd, explicit);
    }
    const runs = await this.listRuns(workspaceId);
    const latestRun = Array.isArray(runs) && runs.length > 0 ? runs[runs.length - 1] : null;
    const latestWorkspaceDir = safeString(latestRun?.result?.workspaceDir);
    return normalizeWorkspaceDir(this.cwd, latestWorkspaceDir || DEFAULT_WORKSPACE_DIR);
  }

  #readScaffoldStatus(workspaceDir) {
    const present = [];
    const missing = [];
    for (const relativeFile of DEFAULT_SCAFFOLD_FILES) {
      const target = path.join(workspaceDir, relativeFile);
      if (fs.existsSync(target)) {
        present.push(relativeFile);
      } else {
        missing.push(relativeFile);
      }
    }
    return {
      present,
      missing
    };
  }

  #assessSpecialistCoverage(subAgents = []) {
    const coverage = SPECIALIST_COVERAGE_CHECKS.map((check) => {
      const match = subAgents.find((agent) => overlapCount(normalizeAgentSkills(agent), check.skills) >= 2);
      return {
        key: check.key,
        title: check.title,
        covered: Boolean(match),
        agentId: match?.id ?? null,
        agentName: match?.name ?? null
      };
    });
    return {
      coverage,
      coveredCount: coverage.filter((item) => item.covered).length
    };
  }

  async #ensureSpecialistTeam(input = {}) {
    const workspaceId = safeString(input.workspaceId, "default");
    const personaName = safeString(input.personaName, "SOVEREIGN");
    const existingAgents = await this.agentService.listAgents(workspaceId);
    const subAgents = existingAgents.filter((agent) => agent.role === "sub");
    const specialists = [];
    const createdSpecialists = [];

    for (const blueprint of DEFAULT_SPECIALIST_BLUEPRINTS) {
      const expectedName = `${personaName} ${blueprint.name}`.toLowerCase();
      const existing =
        subAgents.find((agent) => safeString(agent.title).toLowerCase() === blueprint.title.toLowerCase()) ??
        subAgents.find((agent) => safeString(agent.name).toLowerCase() === expectedName) ??
        subAgents.find((agent) => overlapCount(normalizeAgentSkills(agent), blueprint.skills) >= 2);

      if (existing) {
        specialists.push(existing);
        continue;
      }

      const created = await this.agentService.createAgent({
        workspaceId,
        name: `${personaName} ${blueprint.name}`,
        role: "sub",
        title: blueprint.title,
        skills: blueprint.skills,
        canUseWeb: blueprint.canUseWeb,
        soul: blueprint.soul
      });
      subAgents.push(created);
      specialists.push(created);
      createdSpecialists.push(created);
    }

    return {
      specialists,
      createdSpecialists
    };
  }
}
