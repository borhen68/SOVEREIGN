// @ts-nocheck
import fs from "node:fs";
import path from "node:path";
import { makeId } from "../lib/id.js";
import { nowIso } from "../lib/time.js";

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

export class SetupWizardService {
  constructor(options = {}) {
    this.store = options.store;
    this.cwd = options.cwd ?? process.cwd();
    this.agentService = options.agentService;
    this.tunnelService = options.tunnelService ?? null;
    this.observabilityService = options.observabilityService ?? null;
  }

  async listRuns(workspaceId = null) {
    return this.store.listWizardRuns(workspaceId ? safeString(workspaceId) : null);
  }

  async getRun(runId) {
    return this.store.getWizardRunById(safeString(runId));
  }

  async runQuickSetup(input = {}) {
    const workspaceId = safeString(input.workspaceId, "default");
    const workspaceDir = path.resolve(this.cwd, safeString(input.workspaceDir, ".zeroclaw"));
    const providers = normalizeProviders(input.providers ?? ["openai", "anthropic", "gemini"]);
    const channels = normalizeProviders(input.channels ?? ["local"]);
    const tunnelProvider = safeString(input.tunnelProvider, "custom").toLowerCase();
    const personaName = safeString(input.personaName, "SOVEREIGN");
    const timezone = safeString(input.timezone, "UTC");

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
        content: "# Security\n\nPairing, auth gate, rate limits, and secret handling policy.\n"
      },
      {
        file: path.join(docsDir, "ONBOARDING.md"),
        content: "# Onboarding\n\n1. Configure model providers.\n2. Connect channels.\n3. Run first company objective.\n"
      },
      {
        file: path.join(docsDir, "RUNBOOK.md"),
        content: "# Runbook\n\nOperational procedures, incident handling, and rollback steps.\n"
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
        tunnelId: tunnel?.id ?? null,
        createdFiles
      },
      createdAt,
      updatedAt: createdAt
    });

    this.#observe("wizard.completed", "Setup wizard completed.", {
      runId: run.id,
      workspaceId,
      createdFiles
    });
    return run;
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
}
