// @ts-nocheck
import { AgentRole } from "../domain/constants.js";
import { makeId } from "../lib/id.js";
import { nowIso } from "../lib/time.js";

const WORKSTREAMS = [
  {
    id: "planning",
    title: "Planning and Strategy",
    tags: ["planning", "strategy", "roadmap", "product", "priority", "market"],
    modelTier: "high_general",
    canUseWeb: true,
    defaultSoul: {
      mission: "Convert goals into focused plans with explicit tradeoffs and milestones.",
      values: ["clarity", "focus", "outcomes"],
      communicationStyle: "executive",
      riskTolerance: "balanced"
    },
    taskTemplate: "Define strategy, milestones, and success checkpoints."
  },
  {
    id: "build",
    title: "Engineering and Delivery",
    tags: [
      "engineering",
      "coding",
      "code",
      "backend",
      "frontend",
      "test",
      "deployment",
      "architecture",
      "api"
    ],
    modelTier: "high_coding",
    canUseWeb: false,
    defaultSoul: {
      mission: "Ship robust systems quickly with tests and rollback discipline.",
      values: ["ownership", "quality", "speed-with-rigor"],
      communicationStyle: "direct",
      riskTolerance: "balanced"
    },
    taskTemplate: "Implement and validate with tests, telemetry, and rollback paths."
  },
  {
    id: "sales",
    title: "Sales and Growth",
    tags: ["sales", "pipeline", "crm", "outreach", "demo", "prospect", "conversion"],
    modelTier: "standard",
    canUseWeb: true,
    defaultSoul: {
      mission: "Turn value propositions into qualified pipeline and closed outcomes.",
      values: ["relevance", "speed", "customer-empathy"],
      communicationStyle: "persuasive",
      riskTolerance: "balanced"
    },
    taskTemplate: "Segment targets, personalize outreach, and optimize conversion loops."
  },
  {
    id: "research",
    title: "Research and Verification",
    tags: ["research", "analysis", "compare", "evidence", "validate", "benchmark"],
    modelTier: "small",
    canUseWeb: true,
    defaultSoul: {
      mission: "Find trustworthy signals and challenge weak assumptions.",
      values: ["evidence", "truth", "skepticism"],
      communicationStyle: "forensic",
      riskTolerance: "conservative"
    },
    taskTemplate: "Collect evidence, compare options, and flag weak assumptions."
  },
  {
    id: "operations",
    title: "Operations and Reliability",
    tags: ["ops", "operation", "incident", "monitor", "runbook", "reliability", "automation"],
    modelTier: "standard",
    canUseWeb: false,
    defaultSoul: {
      mission: "Keep execution stable through observability, automation, and recovery playbooks.",
      values: ["resilience", "discipline", "stability"],
      communicationStyle: "precise",
      riskTolerance: "conservative"
    },
    taskTemplate: "Instrument, automate, and enforce reliability guardrails."
  },
  {
    id: "governance",
    title: "Governance and Risk",
    tags: ["security", "compliance", "risk", "policy", "legal", "privacy"],
    modelTier: "high_general",
    canUseWeb: true,
    defaultSoul: {
      mission: "Protect user trust while maintaining execution velocity.",
      values: ["safety", "accountability", "proportionality"],
      communicationStyle: "precise",
      riskTolerance: "conservative"
    },
    taskTemplate: "Identify high-impact risks and design safe execution constraints."
  }
];

const HIGH_MODEL_HINTS = ["opus", "sonnet-4", "4.5", "4.6", "gpt-5", "o3", "o4", "pro", "ultra", "max"];
const SMALL_MODEL_HINTS = ["mini", "haiku", "flash", "nano", "small", "lite"];
const CODING_MODEL_HINTS = ["codex", "sonnet", "gpt-5", "o3", "o4", "deepseek", "code"];

const SOUL_RISK_VALUES = new Set(["conservative", "balanced", "bold"]);
const SOUL_STYLE_VALUES = new Set(["direct", "executive", "forensic", "precise", "persuasive"]);

function safeString(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function clampInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function tokenize(input) {
  return String(input ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

function dedupeStrings(values) {
  const output = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function includesAny(text, hints) {
  return hints.some((hint) => text.includes(hint));
}

function scoreSkillMatch(agent, stream, objectiveTokens) {
  const skills = Array.isArray(agent.skills) ? agent.skills.map((item) => String(item).toLowerCase()) : [];
  const soulMission = String(agent.soul?.mission ?? "").toLowerCase();
  const soulValues = Array.isArray(agent.soul?.values)
    ? agent.soul.values.map((item) => String(item).toLowerCase())
    : [];

  let score = 0;
  for (const tag of stream.tags) {
    if (skills.includes(tag)) {
      score += 4;
    }
    if (skills.some((skill) => skill.includes(tag))) {
      score += 2;
    }
    if (soulMission.includes(tag)) {
      score += 1;
    }
  }
  for (const token of objectiveTokens) {
    if (skills.includes(token)) {
      score += 3;
    }
    if (soulMission.includes(token)) {
      score += 1;
    }
    if (soulValues.includes(token)) {
      score += 1;
    }
  }
  if (stream.canUseWeb && agent.canUseWeb) {
    score += 0.5;
  }
  return score;
}

function normalizeRef(value) {
  return safeString(value).toLowerCase();
}

function classifyModelRef(modelRef) {
  const normalized = normalizeRef(modelRef);
  return {
    isHigh: includesAny(normalized, HIGH_MODEL_HINTS),
    isSmall: includesAny(normalized, SMALL_MODEL_HINTS),
    isCodingFriendly: includesAny(normalized, CODING_MODEL_HINTS)
  };
}

function normalizeSoulPatch(existingSoul, patch, now) {
  const existing = existingSoul && typeof existingSoul === "object" ? existingSoul : {};
  const source = patch && typeof patch === "object" ? patch : {};
  const riskCandidate = safeString(source.riskTolerance || existing.riskTolerance || "balanced").toLowerCase();
  const styleCandidate = safeString(
    source.communicationStyle || existing.communicationStyle || "direct"
  ).toLowerCase();

  return {
    mission: safeString(source.mission, safeString(existing.mission)),
    values: dedupeStrings([...(existing.values ?? []), ...(Array.isArray(source.values) ? source.values : [])]).slice(0, 16),
    communicationStyle: SOUL_STYLE_VALUES.has(styleCandidate) ? styleCandidate : "direct",
    riskTolerance: SOUL_RISK_VALUES.has(riskCandidate) ? riskCandidate : "balanced",
    evolvedAt: now
  };
}

export class ArchitectureService {
  constructor(options = {}) {
    this.agentService = options.agentService;
    this.skillService = options.skillService;
    this.llmService = options.llmService ?? null;
  }

  getBlueprint(input = {}) {
    const workspaceId = safeString(input.workspaceId, "default");
    const providers =
      this.llmService && typeof this.llmService.listProviders === "function"
        ? this.llmService.listProviders()
        : [];
    const models =
      this.llmService && typeof this.llmService.listModelRefs === "function"
        ? this.llmService.listModelRefs({ configuredOnly: false }).map((entry) => entry.modelRef)
        : [];

    return {
      architecture: "SOVEREIGN X Company OS",
      workspaceId,
      generatedAt: nowIso(),
      concept: {
        core: "Human sets objective once. Agent company decomposes, debates, executes, verifies, and reports done.",
        differentiators: [
          "Soul engine: each agent adapts mission/values/risk after outcomes.",
          "Skill forge: each agent can create and store reusable task skills with memory.",
          "Model mesh: per-workstream model routing (small/standard/high/coding) with failover.",
          "Company protocol: sub-agents challenge each other before main-agent synthesis.",
          "Notification-first UX: user receives completion updates, not implementation burden."
        ]
      },
      layers: [
        {
          id: "experience-mesh",
          name: "Experience Mesh",
          capabilities: ["CLI", "Webhook", "Telegram/WhatsApp adapters", "Any channel adapter plugin"]
        },
        {
          id: "security-fabric",
          name: "Security and Runtime Fabric",
          capabilities: ["Runtime trust gate", "Risk scoring", "Approval lanes", "Command queue lanes"]
        },
        {
          id: "company-orchestrator",
          name: "Company Orchestrator",
          capabilities: [
            "Objective decomposition",
            "Specialist assignment or auto-spawn",
            "Debate rounds and consensus",
            "Main-agent final decision"
          ]
        },
        {
          id: "soul-engine",
          name: "Soul Evolution Engine",
          capabilities: [
            "Mission/value updates from outcomes",
            "Risk tolerance tuning",
            "Communication style adaptation"
          ]
        },
        {
          id: "skill-forge",
          name: "Skill Forge",
          capabilities: [
            "Auto skill generation from tasks",
            "Per-skill memory",
            "LLM-assisted skill drafting with fallback"
          ]
        },
        {
          id: "model-mesh",
          name: "Model Mesh",
          capabilities: ["Provider-agnostic model refs", "Task-tier model routing", "Ordered fallback chain"],
          providers: providers.map((provider) => provider.provider),
          modelRefs: models
        },
        {
          id: "mission-brain",
          name: "Mission Brain",
          capabilities: ["Mission contracts", "Autopilot loops", "Heartbeat notifications", "Verification endpoint"]
        },
        {
          id: "memory-plane",
          name: "Memory Plane",
          capabilities: ["Agent memory", "Skill memory", "Council runs", "Timeline evidence"]
        }
      ],
      flow: [
        "Objective In",
        "Company Plan",
        "Parallel Specialist Work",
        "Debate and Rebuttal",
        "Execution via Tools",
        "Verification",
        "Soul and Skill Updates",
        "Done Notification"
      ]
    };
  }

  async buildCompanyPlan(input = {}) {
    const objective = safeString(input.objective ?? input.goal);
    if (!objective) {
      throw this.#badRequest("objective is required.");
    }

    const workspaceId = safeString(input.workspaceId, "default");
    const teamSize = clampInt(input.teamSize, 4, 2, 8);
    const debateRounds = clampInt(input.debateRounds, 2, 1, 4);
    const autoSpawnSubAgents = input.autoSpawnSubAgents !== false;
    const autoGenerateSkills = input.autoGenerateSkills !== false;
    const useLlmSkillDraft =
      input.useLlmSkillDraft === true &&
      this.skillService &&
      typeof this.skillService.generateSkillWithLlm === "function";

    const mainAgent = await this.#resolveMainAgent(workspaceId, safeString(input.mainAgentId));
    const objectiveTokens = tokenize(objective);
    const streams = this.#selectWorkstreams(objectiveTokens, teamSize);
    const subAgentPool = (await this.agentService
      .listAgents(workspaceId))
      .filter((agent) => agent.role === AgentRole.SUB);
    const selectedAgentIds = new Set();
    const spawnedAgents = [];
    const workstreams = [];
    const skillOps = [];

    for (const stream of streams) {
      let assigned = this.#selectBestSubAgent(stream, subAgentPool, objectiveTokens, selectedAgentIds);
      if (!assigned && autoSpawnSubAgents) {
        assigned = await this.#spawnSpecialist(workspaceId, stream);
        spawnedAgents.push(assigned);
        subAgentPool.push(assigned);
      }
      if (assigned) {
        selectedAgentIds.add(assigned.id);
      }

      const modelPlan = this.#resolveModelPlan(stream.modelTier);
      let skill = null;
      if (autoGenerateSkills && assigned && this.skillService) {
        const skillInput = {
          task: `${stream.title}: ${objective}`,
          context: stream.taskTemplate,
          seedMemory: {
            note: `Skill generated for workstream '${stream.title}' in architecture plan.`,
            source: "architecture.company-plan"
          }
        };
        try {
          const generated = useLlmSkillDraft
            ? await this.skillService.generateSkillWithLlm(assigned.id, {
                ...skillInput,
                llm: input.skillLlm && typeof input.skillLlm === "object" ? input.skillLlm : {}
              })
            : await this.skillService.generateSkill(assigned.id, skillInput);
          skill = generated.skill;
          skillOps.push({
            workstreamId: stream.id,
            agentId: assigned.id,
            skillId: generated.skill.id,
            created: generated.created !== false,
            llm: generated.llm ?? null
          });
        } catch (error) {
          const fallback = await this.skillService.generateSkill(assigned.id, skillInput);
          skill = fallback.skill;
          skillOps.push({
            workstreamId: stream.id,
            agentId: assigned.id,
            skillId: fallback.skill.id,
            created: fallback.created !== false,
            llm: {
              used: false,
              reason: error instanceof Error ? error.message : String(error)
            }
          });
        }
      }

      workstreams.push({
        id: stream.id,
        title: stream.title,
        task: stream.taskTemplate,
        modelTier: stream.modelTier,
        modelPlan,
        assignedAgentId: assigned?.id ?? null,
        assignedAgentName: assigned?.name ?? null,
        assignedAgentSoul: assigned?.soul ?? null,
        skillId: skill?.id ?? null,
        skillName: skill?.name ?? null
      });
    }

    return {
      planId: makeId("archplan"),
      createdAt: nowIso(),
      workspaceId,
      objective,
      mainAgent: {
        id: mainAgent.id,
        name: mainAgent.name,
        soul: mainAgent.soul
      },
      setup: {
        teamSizeRequested: teamSize,
        debateRounds,
        autoSpawnSubAgents,
        autoGenerateSkills,
        useLlmSkillDraft
      },
      workstreams,
      discussionProtocol: this.#buildDiscussionProtocol(workstreams, debateRounds),
      notifications: {
        onStart: `SOVEREIGN started objective: ${objective}`,
        onCheckpoint: "Workstreams running. Cross-agent challenge rounds active.",
        onDone: `Objective completed: ${objective}. Evidence and actions are available in mission timeline.`
      },
      metrics: {
        spawnedAgents: spawnedAgents.length,
        generatedSkills: skillOps.length,
        assignedWorkstreams: workstreams.filter((item) => item.assignedAgentId).length
      },
      spawnedAgents,
      skillOps
    };
  }

  async evolveAgentSoul(input = {}) {
    const agentId = safeString(input.agentId);
    if (!agentId) {
      throw this.#badRequest("agentId is required.");
    }
    const agent = await this.agentService.getAgent(agentId);
    if (!agent) {
      throw this.#notFound("Agent not found.");
    }

    const outcome = safeString(input.outcome ?? input.feedback);
    const performanceScore = clampNumber(input.performanceScore, 0.5, 0, 1);
    const outcomeText = outcome.toLowerCase();
    const currentSoul = agent.soul && typeof agent.soul === "object" ? agent.soul : {};
    const extraValues = [];

    if (performanceScore < 0.45) {
      extraValues.push("resilience", "verification-first");
    } else if (performanceScore >= 0.75) {
      extraValues.push("ownership", "execution-discipline");
    } else {
      extraValues.push("continuous-learning");
    }

    if (outcomeText.includes("incident") || outcomeText.includes("risk") || outcomeText.includes("security")) {
      extraValues.push("safety");
    }
    if (outcomeText.includes("test") || outcomeText.includes("qa") || outcomeText.includes("verify")) {
      extraValues.push("verification-first");
    }
    if (outcomeText.includes("customer") || outcomeText.includes("user")) {
      extraValues.push("customer-empathy");
    }

    let riskTolerance = safeString(currentSoul.riskTolerance, "balanced").toLowerCase();
    if (outcomeText.includes("incident") || outcomeText.includes("risk")) {
      riskTolerance = "conservative";
    } else if (
      (outcomeText.includes("speed") || outcomeText.includes("fast") || outcomeText.includes("slow")) &&
      performanceScore >= 0.7
    ) {
      riskTolerance = "balanced";
    }

    let communicationStyle = safeString(currentSoul.communicationStyle, "direct").toLowerCase();
    if (outcomeText.includes("unclear") || outcomeText.includes("confusing")) {
      communicationStyle = "precise";
    } else if (outcomeText.includes("executive") || outcomeText.includes("stakeholder")) {
      communicationStyle = "executive";
    }

    const updatedMission = safeString(input.mission, safeString(currentSoul.mission));
    const nextSoul = normalizeSoulPatch(
      currentSoul,
      {
        mission: updatedMission,
        values: extraValues,
        communicationStyle,
        riskTolerance
      },
      nowIso()
    );

    const updatedAgent =
      typeof this.agentService.applySoulMutation === "function"
        ? await this.agentService.applySoulMutation(agent.id, {
          soul: nextSoul,
          source: "soul-evolution",
          reason: "outcome-feedback",
          outcome,
          performanceScore
        })
        : await this.agentService.updateAgent(agent.id, {
          soul: nextSoul
        });

    return {
      agentBefore: {
        id: agent.id,
        soul: currentSoul
      },
      agentAfter: {
        id: updatedAgent.id,
        soul: updatedAgent.soul
      },
      evolution: {
        performanceScore,
        outcome,
        addedValues: nextSoul.values.filter(
          (value) => !(Array.isArray(currentSoul.values) ? currentSoul.values : []).includes(value)
        ),
        riskTolerance: nextSoul.riskTolerance,
        communicationStyle: nextSoul.communicationStyle
      }
    };
  }

  async listSoulHistory(input = {}) {
    const agentId = safeString(input.agentId);
    if (!agentId) {
      throw this.#badRequest("agentId is required.");
    }
    if (!this.agentService || typeof this.agentService.listSoulHistory !== "function") {
      throw this.#badRequest("Soul history is not available.");
    }
    const history = await this.agentService.listSoulHistory(agentId, clampInt(input.limit, 50, 1, 500));
    return {
      agentId,
      history,
      currentVersion: history.length > 0 ? history[history.length - 1].version : null
    };
  }

  async rollbackAgentSoul(input = {}) {
    const agentId = safeString(input.agentId);
    if (!agentId) {
      throw this.#badRequest("agentId is required.");
    }
    if (!this.agentService || typeof this.agentService.rollbackSoul !== "function") {
      throw this.#badRequest("Soul rollback is not available.");
    }
    return this.agentService.rollbackSoul(agentId, {
      targetVersion: input.targetVersion,
      reason: input.reason,
      outcome: input.outcome,
      performanceScore: input.performanceScore
    });
  }

  async #resolveMainAgent(workspaceId, explicitMainAgentId) {
    if (explicitMainAgentId) {
      const explicitAgent = await this.agentService.getAgent(explicitMainAgentId);
      if (!explicitAgent) {
        throw this.#notFound("mainAgentId was provided but agent does not exist.");
      }
      if (explicitAgent.workspaceId !== workspaceId) {
        throw this.#badRequest("mainAgentId does not belong to workspaceId.");
      }
      return explicitAgent;
    }

    const agents = await this.agentService.listAgents(workspaceId);
    const existingMain = agents.find((agent) => agent.role === AgentRole.MAIN);
    if (existingMain) {
      return existingMain;
    }

    return this.agentService.createAgent({
      workspaceId,
      name: "SOVEREIGN Main",
      role: AgentRole.MAIN,
      title: "Chief Orchestrator",
      skills: ["planning", "strategy", "governance", "execution"],
      canUseWeb: true,
      soul: {
        mission: "Coordinate a specialist agent company and deliver outcomes end-to-end.",
        values: ["clarity", "ownership", "trust"],
        communicationStyle: "executive",
        riskTolerance: "balanced"
      }
    });
  }

  #selectWorkstreams(objectiveTokens, teamSize) {
    const tokenSet = new Set(objectiveTokens);
    const scored = WORKSTREAMS.map((stream) => {
      let score = 0;
      for (const tag of stream.tags) {
        if (tokenSet.has(tag)) {
          score += 3;
        }
        if ([...tokenSet].some((token) => token.includes(tag) || tag.includes(token))) {
          score += 1;
        }
      }
      if (stream.id === "planning") {
        score += 1;
      }
      if (stream.id === "build" && (tokenSet.has("code") || tokenSet.has("coding") || tokenSet.has("engineering"))) {
        score += 2;
      }
      if (stream.id === "sales" && (tokenSet.has("sales") || tokenSet.has("demo"))) {
        score += 2;
      }
      return {
        stream,
        score
      };
    }).sort((a, b) => b.score - a.score);

    const selected = [];
    const desiredCount = Math.max(2, Math.min(teamSize, WORKSTREAMS.length));
    for (const item of scored) {
      if (selected.length >= desiredCount) {
        break;
      }
      if (item.score <= 0 && selected.length >= 2) {
        continue;
      }
      selected.push(item.stream);
    }

    if (!selected.some((stream) => stream.id === "planning")) {
      selected.unshift(WORKSTREAMS.find((stream) => stream.id === "planning"));
    }
    return dedupeStrings(selected.map((stream) => stream.id))
      .map((id) => WORKSTREAMS.find((stream) => stream.id === id))
      .filter(Boolean)
      .slice(0, desiredCount);
  }

  #selectBestSubAgent(stream, pool, objectiveTokens, selectedAgentIds) {
    let best = null;
    let bestScore = -Infinity;
    for (const agent of pool) {
      const baseScore = scoreSkillMatch(agent, stream, objectiveTokens);
      const reusePenalty = selectedAgentIds.has(agent.id) ? 2 : 0;
      const score = baseScore - reusePenalty;
      if (score > bestScore) {
        best = agent;
        bestScore = score;
      }
    }
    if (bestScore <= 0) {
      return null;
    }
    return best;
  }

  async #spawnSpecialist(workspaceId, stream) {
    const suffix = makeId("unit").split("_").pop();
    const name = `${stream.title.split(" ")[0]} Specialist ${suffix}`;
    return this.agentService.createAgent({
      workspaceId,
      name,
      role: AgentRole.SUB,
      title: stream.title,
      skills: stream.tags.slice(0, 5),
      canUseWeb: stream.canUseWeb,
      soul: stream.defaultSoul
    });
  }

  #resolveModelPlan(modelTier) {
    const refs =
      this.llmService && typeof this.llmService.listModelRefs === "function"
        ? this.llmService.listModelRefs({ configuredOnly: true }).map((entry) => entry.modelRef)
        : [];
    const candidateRefs =
      refs.length > 0
        ? refs
        : this.llmService && typeof this.llmService.listModelRefs === "function"
          ? this.llmService.listModelRefs({ configuredOnly: false }).map((entry) => entry.modelRef)
          : [];

    if (candidateRefs.length === 0) {
      return {
        primaryModelRef: null,
        fallbackModelRefs: [],
        reason: "no-llm-models-detected"
      };
    }

    const pools = {
      high: [],
      small: [],
      coding: [],
      standard: []
    };
    for (const ref of candidateRefs) {
      const classified = classifyModelRef(ref);
      if (classified.isHigh) {
        pools.high.push(ref);
      }
      if (classified.isSmall) {
        pools.small.push(ref);
      }
      if (classified.isCodingFriendly) {
        pools.coding.push(ref);
      }
      if (!classified.isHigh && !classified.isSmall) {
        pools.standard.push(ref);
      }
    }

    let primary = candidateRefs[0];
    if (modelTier === "high_coding") {
      primary = pools.coding[0] || pools.high[0] || pools.standard[0] || candidateRefs[0];
    } else if (modelTier === "high_general") {
      primary = pools.high[0] || pools.standard[0] || candidateRefs[0];
    } else if (modelTier === "small") {
      primary = pools.small[0] || pools.standard[0] || candidateRefs[0];
    } else {
      primary = pools.standard[0] || candidateRefs[0];
    }

    const seen = new Set([primary.toLowerCase()]);
    const fallbackModelRefs = [];
    for (const ref of [...pools.coding, ...pools.high, ...pools.standard, ...pools.small, ...candidateRefs]) {
      const key = ref.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      fallbackModelRefs.push(ref);
    }

    return {
      primaryModelRef: primary,
      fallbackModelRefs
    };
  }

  #buildDiscussionProtocol(workstreams, debateRounds) {
    const streamLabels = workstreams.map((stream) => stream.title);
    const protocol = [
      {
        stage: "decompose",
        summary: "Main agent defines objective contract and workstream owners."
      },
      {
        stage: "parallel-execution",
        summary: "Specialists execute streams in parallel and post evidence."
      }
    ];
    for (let round = 1; round <= debateRounds; round += 1) {
      protocol.push({
        stage: `challenge-round-${round}`,
        summary: `Cross-agent rebuttal for ${streamLabels.join(", ")}.`
      });
    }
    protocol.push({
      stage: "synthesis",
      summary: "Main agent finalizes plan, actions, and done notification."
    });
    return protocol;
  }

  #badRequest(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
  }

  #notFound(message) {
    const error = new Error(message);
    error.statusCode = 404;
    return error;
  }
}
