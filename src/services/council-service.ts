// @ts-nocheck
import { makeId } from "../lib/id.js";
import { nowIso } from "../lib/time.js";
import { AgentRole, CouncilRunStatus, CouncilStatus } from "../domain/constants.js";

const DEFAULT_TRACKS = [
  {
    key: "diagnosis",
    title: "Diagnosis",
    prompt: "Find root causes and constraints.",
    skillTags: ["analysis", "research", "debugging", "incident-response", "product"]
  },
  {
    key: "strategy",
    title: "Strategy",
    prompt: "Propose strategic options and tradeoffs.",
    skillTags: ["strategy", "planning", "sales", "growth", "product"]
  },
  {
    key: "execution",
    title: "Execution",
    prompt: "Design an execution plan with milestones.",
    skillTags: ["engineering", "coding", "ops", "project-management", "delivery"]
  },
  {
    key: "risk",
    title: "Risk and Governance",
    prompt: "Assess safety, policy, legal, and operational risk.",
    skillTags: ["security", "compliance", "legal", "governance", "reliability"]
  }
];

const DEFAULT_AGENT_ARCHETYPES = [
  {
    key: "investigator",
    name: "Investigator",
    title: "Evidence Investigator",
    canUseWeb: true,
    skills: ["research", "analysis", "verification", "product"],
    soul: {
      mission: "Find reliable evidence and expose weak assumptions before execution.",
      values: ["truth", "clarity", "evidence-first"],
      communicationStyle: "forensic",
      riskTolerance: "balanced"
    }
  },
  {
    key: "strategist",
    name: "Strategist",
    title: "Growth Strategist",
    canUseWeb: true,
    skills: ["strategy", "planning", "sales", "growth"],
    soul: {
      mission: "Turn constraints into executable strategy with measurable upside.",
      values: ["focus", "outcomes", "tradeoff-discipline"],
      communicationStyle: "executive",
      riskTolerance: "balanced"
    }
  },
  {
    key: "builder",
    name: "Builder",
    title: "Execution Builder",
    canUseWeb: false,
    skills: ["engineering", "coding", "ops", "delivery"],
    soul: {
      mission: "Convert plans into reliable shipped work with tight feedback loops.",
      values: ["ownership", "ship-fast", "quality"],
      communicationStyle: "direct",
      riskTolerance: "balanced"
    }
  },
  {
    key: "guardian",
    name: "Guardian",
    title: "Risk Guardian",
    canUseWeb: true,
    skills: ["security", "governance", "compliance", "reliability"],
    soul: {
      mission: "Prevent high-impact failure modes while preserving execution velocity.",
      values: ["safety", "accountability", "resilience"],
      communicationStyle: "precise",
      riskTolerance: "conservative"
    }
  }
];

const DEFAULT_DEBATE_ROUNDS = 2;
const MIN_DEBATE_ROUNDS = 1;
const MAX_DEBATE_ROUNDS = 4;
const DEFAULT_TEAM_SIZE = 3;
const MAX_TEAM_SIZE = DEFAULT_TRACKS.length;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

function uniqueStrings(values) {
  return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))];
}

function clampInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function normalizeIdempotencyKey(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const key = String(value).trim();
  if (!key) {
    return null;
  }
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    const error = new Error(`idempotencyKey must be <= ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`);
    error.statusCode = 400;
    throw error;
  }
  return key;
}

function normalizeSkills(agent) {
  return Array.isArray(agent.skills) ? agent.skills.map((item) => String(item).toLowerCase()) : [];
}

function normalizeSoul(agent) {
  const soul = agent?.soul && typeof agent.soul === "object" ? agent.soul : {};
  return {
    mission: soul.mission ? String(soul.mission) : "",
    values: Array.isArray(soul.values) ? soul.values.map((value) => String(value)).filter(Boolean) : [],
    communicationStyle: soul.communicationStyle ? String(soul.communicationStyle) : "direct",
    riskTolerance: soul.riskTolerance ? String(soul.riskTolerance) : "balanced"
  };
}

function tokenize(input) {
  return String(input ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

function scoreAgentForTrack(agent, track) {
  const skills = normalizeSkills(agent);
  const tags = Array.isArray(track?.skillTags) ? track.skillTags : [];
  const soulValues = Array.isArray(agent.soul?.values) ? agent.soul.values : [];
  const mission = String(agent.soul?.mission ?? "").toLowerCase();
  let score = 0;

  for (const tag of tags) {
    if (skills.includes(tag)) {
      score += 4;
    }
    if (skills.some((skill) => skill.includes(tag))) {
      score += 2;
    }
    if (mission.includes(tag)) {
      score += 1;
    }
  }
  score += Math.min(2, soulValues.length * 0.25);
  return score;
}

function scoreAgentForProblem(agent, problemTokens) {
  const skills = normalizeSkills(agent);
  const mission = String(agent.soul?.mission ?? "").toLowerCase();
  const values = Array.isArray(agent.soul?.values) ? agent.soul.values.map((item) => String(item)) : [];
  const profile = `${mission} ${values.join(" ").toLowerCase()}`;
  let score = 0;

  for (const token of problemTokens) {
    if (skills.includes(token)) {
      score += 4;
    }
    if (skills.some((skill) => skill.includes(token))) {
      score += 2;
    }
    if (profile.includes(token)) {
      score += 1;
    }
  }
  if (agent.canUseWeb) {
    score += 0.5;
  }
  return score;
}

function scoreArchetypeForProblem(archetype, problemTokens) {
  const skills = Array.isArray(archetype.skills)
    ? archetype.skills.map((item) => String(item).toLowerCase())
    : [];
  const mission = String(archetype.soul?.mission ?? "").toLowerCase();
  const profile = `${skills.join(" ")} ${mission}`;
  let score = 0;
  for (const token of problemTokens) {
    if (skills.includes(token)) {
      score += 3;
    }
    if (profile.includes(token)) {
      score += 1;
    }
  }
  if (archetype.canUseWeb) {
    score += 0.25;
  }
  return score;
}

function selectBestAgent(track, agents, usedAgentIds) {
  let bestAgent = null;
  let bestScore = -Infinity;
  for (const agent of agents) {
    const baseScore = scoreAgentForTrack(agent, track);
    const reusePenalty = usedAgentIds.has(agent.id) ? 2 : 0;
    const score = baseScore - reusePenalty;
    if (score > bestScore) {
      bestAgent = agent;
      bestScore = score;
    }
  }
  return bestAgent;
}

function dedupePreservingOrder(values) {
  return [...new Set(values)];
}

function normalizeSeedFindings(seedFindings) {
  if (!Array.isArray(seedFindings)) {
    return [];
  }
  return seedFindings.map((item) => ({
    title: String(item?.title ?? ""),
    snippet: String(item?.snippet ?? ""),
    url: String(item?.url ?? ""),
    source: String(item?.source ?? "")
  }));
}

function buildCouncilIdempotencySignature(input) {
  return JSON.stringify({
    problem: input.problem,
    mainAgentId: input.mainAgentId,
    requestedSubAgentIds: input.requestedSubAgentIds,
    teamSize: input.teamSize,
    debateRounds: input.debateRounds,
    allowWebResearch: input.allowWebResearch,
    autoSpawnSubAgents: input.autoSpawnSubAgents,
    autoGenerateSkills: input.autoGenerateSkills,
    seedFindings: normalizeSeedFindings(input.seedFindings)
  });
}

function recommendedActionsForContribution(contribution) {
  const actions = [];
  actions.push(`Create owner-assigned task for ${contribution.trackTitle}.`);
  actions.push(`Define KPI checkpoint for ${contribution.trackTitle.toLowerCase()}.`);
  if (contribution.webFindings.length > 0) {
    actions.push("Validate assumptions against the cited external sources.");
  } else {
    actions.push("Collect at least two external sources before final commitment.");
  }
  return actions;
}

function estimateConfidence(agent, track, webFindingCount) {
  const trackScore = scoreAgentForTrack(agent, track);
  const evidenceBoost = Math.min(0.2, webFindingCount * 0.08);
  const score = Math.min(1, 0.35 + trackScore * 0.03 + evidenceBoost);
  return Number(score.toFixed(2));
}

function buildEvidenceSummary(findings, limit = 2) {
  if (!Array.isArray(findings) || findings.length === 0) {
    return "";
  }
  return findings
    .slice(0, limit)
    .map((finding) => String(finding?.url ?? finding?.title ?? "").trim())
    .filter(Boolean)
    .join(" | ");
}

export class CouncilService {
  store: any;
  missionService: any;
  agentService: any;
  webResearchService: any;
  skillService: any;

  constructor(store, missionService, agentService, webResearchService, skillService = null) {
    this.store = store;
    this.missionService = missionService;
    this.agentService = agentService;
    this.webResearchService = webResearchService;
    this.skillService = skillService;
  }

  async listMissionCouncils(missionId) {
    await this.#requireMission(missionId);
    return this.store.listMissionCouncilSessions(missionId);
  }

  async listMissionCouncilRuns(missionId) {
    await this.#requireMission(missionId);
    return this.store.listMissionCouncilRuns(missionId);
  }

  async getCouncilRun(runId) {
    return this.store.getCouncilRunById(runId);
  }

  async getCouncil(councilId) {
    return this.store.getCouncilSessionById(councilId);
  }

  async runCouncil(missionId, input) {
    const mission = await this.#requireMission(missionId);
    const problem = String(input.problem ?? "").trim();
    if (!problem) {
      throw this.#badRequest("Council problem statement is required.");
    }

    const mainAgent = await this.#requireAgent(String(input.mainAgentId ?? ""));
    if (mainAgent.role !== AgentRole.MAIN) {
      throw this.#badRequest("mainAgentId must reference an agent with role 'main'.");
    }
    const requestedSubAgentIds = uniqueStrings(Array.isArray(input.subAgentIds) ? input.subAgentIds : []);
    const teamSize = clampInt(input.teamSize, DEFAULT_TEAM_SIZE, 1, MAX_TEAM_SIZE);
    const debateRounds = clampInt(
      input.debateRounds,
      DEFAULT_DEBATE_ROUNDS,
      MIN_DEBATE_ROUNDS,
      MAX_DEBATE_ROUNDS
    );
    const allowWebResearch = Boolean(input.allowWebResearch);
    const autoSpawnSubAgents = input.autoSpawnSubAgents !== false;
    const autoGenerateSkills = input.autoGenerateSkills !== false;
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    const idempotencySignature = idempotencyKey
      ? buildCouncilIdempotencySignature({
        problem,
        mainAgentId: mainAgent.id,
        requestedSubAgentIds,
        teamSize,
        debateRounds,
        allowWebResearch,
        autoSpawnSubAgents,
        autoGenerateSkills,
        seedFindings: input.seedFindings
      })
      : null;

    if (idempotencyKey) {
      const existingRun = await this.store.getMissionCouncilRunByIdempotencyKey(mission.id, idempotencyKey);
      if (existingRun) {
        if (
          existingRun.idempotencySignature &&
          existingRun.idempotencySignature !== idempotencySignature
        ) {
          throw this.#conflict(
            `idempotencyKey '${idempotencyKey}' is already used with different council parameters.`
          );
        }
        if (existingRun.councilId) {
          const existingCouncil = await this.store.getCouncilSessionById(existingRun.councilId);
          if (existingCouncil) {
            return existingCouncil;
          }
        }
        if (existingRun.status === CouncilRunStatus.RUNNING) {
          throw this.#conflict(
            `Council run ${existingRun.id} is still running for idempotencyKey '${idempotencyKey}'.`
          );
        }
        if (existingRun.status === CouncilRunStatus.FAILED) {
          throw this.#conflict(
            `Council run ${existingRun.id} failed for idempotencyKey '${idempotencyKey}'. Use a new key to retry.`
          );
        }
        throw this.#conflict(
          `idempotencyKey '${idempotencyKey}' is already bound to council run ${existingRun.id}.`
        );
      }
    }

    const { subAgents, spawnedSubAgents } = await this.#resolveSubAgents({
      mission,
      mainAgent,
      problem,
      requestedSubAgentIds,
      teamSize,
      autoSpawnSubAgents
    });
    const subAgentIds = subAgents.map((agent) => agent.id);
    const spawnedSubAgentIds = spawnedSubAgents.map((agent) => agent.id);
    const teamAssembly = requestedSubAgentIds.length > 0 ? "manual" : "auto";

    const decomposition = this.#decomposeProblem(problem, subAgents);

    const runId = makeId("councilrun");
    const runStartedAt = nowIso();
    await this.store.createCouncilRun({
      id: runId,
      missionId: mission.id,
      workspaceId: mission.workspaceId ?? "default",
      problem,
      mainAgentId: mainAgent.id,
      subAgentIds,
      spawnedSubAgentIds,
      teamAssembly,
      debateRounds,
      autoSpawnSubAgents,
      autoGenerateSkills,
      idempotencyKey,
      idempotencySignature,
      status: CouncilRunStatus.RUNNING,
      createdAt: runStartedAt,
      startedAt: runStartedAt,
      endedAt: null,
      councilId: null,
      error: null
    });

    try {
      const contributions = [];
      for (const workstream of decomposition) {
        const assignedAgent = subAgents.find((agent) => agent.id === workstream.assignedAgentId);
        const activatedSkill = await this.#activateSkillForWorkstream({
          mission,
          problem,
          workstream,
          assignedAgent,
          autoGenerateSkills
        });
        const contribution = await this.#buildContribution({
          mission,
          problem,
          workstream,
          assignedAgent,
          activatedSkill,
          allowWebResearch,
          seedFindings: input.seedFindings
        });
        contribution.skillMemory = await this.#rememberContribution({
          assignedAgent,
          workstream,
          contribution
        });
        if (contribution.activatedSkill && contribution.skillMemory) {
          contribution.activatedSkill.memoryCount = contribution.skillMemory.totalMemory;
        }
        contributions.push(contribution);
      }

      const discussion = this.#buildDiscussion(contributions, subAgents, debateRounds);
      const consensus = this.#buildConsensus(contributions);
      const finalBriefing = this.#buildFinalBriefing({
        mission,
        problem,
        mainAgent,
        decomposition,
        subAgents,
        spawnedSubAgents,
        contributions,
        discussion,
        debateRounds,
        consensus
      });

      const createdAt = nowIso();
      const council = {
        id: makeId("council"),
        missionId: mission.id,
        workspaceId: mission.workspaceId ?? "default",
        runId,
        status: CouncilStatus.COMPLETED,
        problem,
        mainAgentId: mainAgent.id,
        subAgentIds,
        spawnedSubAgentIds,
        allowWebResearch,
        teamAssembly,
        debateRounds,
        autoSpawnSubAgents,
        autoGenerateSkills,
        idempotencyKey,
        decomposition,
        contributions,
        discussion,
        consensus,
        finalBriefing,
        createdAt,
        updatedAt: createdAt
      };
      await this.store.createCouncilSession(council);
      await this.store.updateCouncilRun(runId, {
        status: CouncilRunStatus.COMPLETED,
        councilId: council.id,
        endedAt: createdAt
      });
      await this.store.createEvent({
        id: makeId("event"),
        missionId: mission.id,
        type: "council.completed",
        actor: "system",
        payload: {
          runId,
          councilId: council.id,
          mainAgentId: mainAgent.id,
          subAgentCount: subAgents.length,
          spawnedSubAgentCount: spawnedSubAgents.length,
          allowWebResearch,
          teamAssembly,
          debateRounds,
          autoSpawnSubAgents,
          autoGenerateSkills,
          idempotencyKey
        },
        createdAt
      });

      return council;
    } catch (error) {
      await this.store.updateCouncilRun(runId, {
        status: CouncilRunStatus.FAILED,
        error: error instanceof Error ? error.message : String(error),
        endedAt: nowIso()
      });
      throw error;
    }
  }

  async #resolveSubAgents(input) {
    const mission = input.mission;
    const mainAgent = input.mainAgent;
    const requestedSubAgentIds = input.requestedSubAgentIds;
    if (requestedSubAgentIds.length > 0) {
      if (requestedSubAgentIds.includes(mainAgent.id)) {
        throw this.#badRequest("Main agent cannot be included in subAgentIds.");
      }
      const subAgents = await Promise.all(requestedSubAgentIds.map(async (id) => {
        const agent = await this.#requireAgent(id);
        this.#assertSubRole(agent);
        return agent;
      }));
      return {
        subAgents,
        spawnedSubAgents: []
      };
    }

    const workspaceId = mission.workspaceId ?? "default";
    const allAgents = await this.agentService.listAgents(workspaceId);
    const availableSubAgents = allAgents
      .filter((agent) => agent.role === AgentRole.SUB && agent.id !== mainAgent.id);

    const problemTokens = tokenize(`${input.problem} ${mission.title} ${mission.objective} ${mission.kpi}`);
    const ranked = availableSubAgents
      .map((agent) => {
        const trackAffinity = DEFAULT_TRACKS.reduce((sum, track) => sum + scoreAgentForTrack(agent, track), 0);
        return {
          agent,
          score: scoreAgentForProblem(agent, problemTokens) + trackAffinity * 0.2
        };
      })
      .sort((a, b) => b.score - a.score || a.agent.name.localeCompare(b.agent.name));

    const selectedSubAgents = ranked
      .slice(0, Math.min(input.teamSize, ranked.length))
      .map((item) => item.agent);

    const missingSlots = Math.max(0, input.teamSize - selectedSubAgents.length);
    let spawnedSubAgents = [];
    if (missingSlots > 0 && input.autoSpawnSubAgents) {
      spawnedSubAgents = await this.#spawnSubAgents({
        workspaceId,
        missingSlots,
        problemTokens,
        existingAgents: [...availableSubAgents, ...selectedSubAgents]
      });
      selectedSubAgents.push(...spawnedSubAgents);
    }

    if (selectedSubAgents.length === 0) {
      throw this.#badRequest(
        "No sub-agents are available in this workspace. Add sub-agents, allow auto-spawn, or pass subAgentIds."
      );
    }

    return {
      subAgents: selectedSubAgents.slice(0, input.teamSize),
      spawnedSubAgents
    };
  }

  async #spawnSubAgents(input) {
    const existingNames = new Set(
      input.existingAgents.map((agent) => String(agent.name ?? "").trim().toLowerCase()).filter(Boolean)
    );
    const rankedArchetypes = DEFAULT_AGENT_ARCHETYPES.map((archetype, index) => ({
      archetype,
      order: index,
      score: scoreArchetypeForProblem(archetype, input.problemTokens)
    })).sort((a, b) => b.score - a.score || a.order - b.order);

    const spawned = [];
    for (const item of rankedArchetypes) {
      if (spawned.length >= input.missingSlots) {
        break;
      }
      const archetype = item.archetype;
      const name = this.#nextUniqueAgentName(archetype.name, existingNames);
      const created = await this.agentService.createAgent({
        workspaceId: input.workspaceId,
        name,
        role: AgentRole.SUB,
        title: archetype.title,
        skills: archetype.skills,
        canUseWeb: archetype.canUseWeb,
        soul: archetype.soul
      });
      spawned.push(created);
    }
    return spawned;
  }

  #nextUniqueAgentName(baseName, existingNames) {
    let index = 1;
    while (true) {
      const candidate = index === 1 ? baseName : `${baseName} ${index}`;
      const normalized = candidate.toLowerCase();
      if (!existingNames.has(normalized)) {
        existingNames.add(normalized);
        return candidate;
      }
      index += 1;
    }
  }

  #decomposeProblem(problem, subAgents) {
    const tracks = DEFAULT_TRACKS.slice(0, Math.max(1, Math.min(DEFAULT_TRACKS.length, subAgents.length)));
    const usedAgentIds = new Set();
    const decomposition = [];

    for (const track of tracks) {
      const selected = selectBestAgent(track, subAgents, usedAgentIds) ?? subAgents[0];
      usedAgentIds.add(selected.id);
      decomposition.push({
        id: makeId("workstream"),
        trackKey: track.key,
        trackTitle: track.title,
        prompt: `${track.prompt} Problem: ${problem}`,
        assignedAgentId: selected.id,
        assignedAgentName: selected.name
      });
    }

    return decomposition;
  }

  async #buildContribution(input) {
    const agent = input.assignedAgent;
    const workstream = input.workstream;
    const webFindings =
      input.allowWebResearch && agent.canUseWeb
        ? await this.webResearchService.research({
          query: `${input.problem} ${workstream.trackTitle}`,
          limit: 3,
          seedFindings: input.seedFindings
        })
        : [];

    const soul = normalizeSoul(agent);
    const soulStyle = soul.communicationStyle;
    const confidence = estimateConfidence(agent, workstream, webFindings.length);
    const activatedSkill = input.activatedSkill ?? null;
    const keyInsights = [
      `${agent.name} frames ${workstream.trackTitle.toLowerCase()} around "${soul.mission || "delivery and clarity"}".`,
      activatedSkill
        ? `Activated skill "${activatedSkill.name}" (${activatedSkill.created ? "new" : "reused"}) to execute this track.`
        : "No dedicated skill activated for this track.",
      `Primary stance: ${workstream.prompt}`,
      webFindings.length > 0
        ? `External evidence collected: ${webFindings.length} finding(s).`
        : "No external evidence collected in this pass."
    ];

    return {
      id: makeId("contribution"),
      workstreamId: workstream.id,
      trackTitle: workstream.trackTitle,
      agentId: agent.id,
      agentName: agent.name,
      agentSkills: agent.skills,
      soulProfile: soul,
      soulStyle,
      activatedSkill,
      confidence,
      keyInsights,
      recommendedActions: recommendedActionsForContribution({
        trackTitle: workstream.trackTitle,
        webFindings
      }),
      blockers:
        webFindings.length > 0
          ? []
          : [`External evidence gap on ${workstream.trackTitle.toLowerCase()}.`],
      webFindings
    };
  }

  async #activateSkillForWorkstream(input) {
    if (!input.autoGenerateSkills || !this.skillService) {
      return null;
    }
    const agent = input.assignedAgent;
    const workstream = input.workstream;
    try {
      const hasAgentModelPrimary = Boolean(
        String(agent?.model?.primary ?? "").trim()
      );
      const generated = hasAgentModelPrimary && typeof this.skillService.generateSkillWithLlm === "function"
        ? await this.skillService.generateSkillWithLlm(agent.id, {
          task: workstream.prompt,
          context: `Mission: ${input.mission.title}. Objective: ${input.mission.objective}. Problem: ${input.problem}.`,
          llm: {}
        })
        : await this.skillService.generateSkill(agent.id, {
          task: workstream.prompt,
          context: `Mission: ${input.mission.title}. Objective: ${input.mission.objective}. Problem: ${input.problem}.`
        });
      const llmMeta = generated?.llm ?? null;
      return {
        id: generated.skill.id,
        name: generated.skill.name,
        created: generated.created,
        tags: generated.skill.tags,
        confidence: generated.skill.confidence,
        llm: llmMeta
          ? {
            used: Boolean(llmMeta.used),
            provider: llmMeta.provider ?? null,
            model: llmMeta.model ?? null
          }
          : null,
        memoryCount: generated.skill.memoryCount ?? 0
      };
    } catch {
      return null;
    }
  }

  async #rememberContribution(input) {
    if (!this.skillService) {
      return null;
    }
    const activatedSkill = input.contribution.activatedSkill;
    if (!activatedSkill?.id) {
      return null;
    }
    try {
      const memoryResult = await this.skillService.addSkillMemory(
        input.assignedAgent.id,
        activatedSkill.id,
        {
          note: input.contribution.keyInsights[0],
          task: input.workstream.prompt,
          outcome: input.contribution.recommendedActions[0] ?? null,
          evidence: buildEvidenceSummary(input.contribution.webFindings),
          source: "council.run",
          score: input.contribution.confidence
        }
      );
      return {
        id: memoryResult.memory.id,
        source: memoryResult.memory.source,
        totalMemory: memoryResult.skill.memoryCount ?? 0
      };
    } catch {
      return null;
    }
  }

  #buildDiscussion(contributions, subAgents, debateRounds) {
    if (contributions.length === 1) {
      return [];
    }
    const messages = [];
    for (let round = 1; round <= debateRounds; round += 1) {
      const reviewerShift =
        subAgents.length > 1 ? ((round - 1) % (subAgents.length - 1)) + 1 : 1;
      for (let index = 0; index < contributions.length; index += 1) {
        const contribution = contributions[index];
        let reviewer = subAgents[(index + reviewerShift) % subAgents.length];
        if (reviewer && reviewer.id === contribution.agentId && subAgents.length > 1) {
          reviewer = subAgents[(index + reviewerShift + 1) % subAgents.length];
        }
        if (!reviewer || reviewer.id === contribution.agentId) {
          continue;
        }
        const reviewerContribution = contributions.find((item) => item.agentId === reviewer.id) ?? null;
        const reviewerSkill =
          reviewerContribution?.activatedSkill?.name ??
          reviewer.skills?.[0] ??
          "general review";
        const targetSkill = contribution.activatedSkill?.name ?? contribution.agentSkills?.[0] ?? "execution";
        const challenge = {
          id: makeId("discussion"),
          round,
          type: "challenge",
          speakerAgentId: reviewer.id,
          speakerAgentName: reviewer.name,
          targetAgentId: contribution.agentId,
          content: `${reviewer.name} challenges ${contribution.agentName} using ${reviewerSkill}: pressure-test assumptions and define measurable checkpoints for ${contribution.trackTitle.toLowerCase()}.`
        };
        const response = {
          id: makeId("discussion"),
          round,
          type: "response",
          speakerAgentId: contribution.agentId,
          speakerAgentName: contribution.agentName,
          targetAgentId: reviewer.id,
          content: `${contribution.agentName} responds from ${targetSkill} with tighter owners, KPIs, and risk controls for ${contribution.trackTitle.toLowerCase()}.`
        };
        const resolution = {
          id: makeId("discussion"),
          round,
          type: "resolution",
          speakerAgentId: contribution.agentId,
          speakerAgentName: contribution.agentName,
          targetAgentId: null,
          content: `${contribution.agentName} commits to update this workstream after round ${round} feedback.`
        };
        messages.push(challenge, response, resolution);
      }
    }
    return messages;
  }

  #buildConsensus(contributions) {
    const actionSupport = new Map();
    const votes = [];
    for (const contribution of contributions) {
      const selectedActions = dedupePreservingOrder(contribution.recommendedActions).slice(0, 2);
      votes.push({
        agentId: contribution.agentId,
        agentName: contribution.agentName,
        selectedActions
      });
      for (const action of selectedActions) {
        actionSupport.set(action, (actionSupport.get(action) ?? 0) + 1);
      }
    }

    const topActions = [...actionSupport.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 6)
      .map(([action, support]) => ({ action, support }));

    const topSupport = topActions[0]?.support ?? 0;
    const consensusScore = Number((topSupport / Math.max(1, contributions.length)).toFixed(2));
    const dissentingViews = contributions
      .filter((contribution) => contribution.confidence < 0.6 || contribution.webFindings.length === 0)
      .map((contribution) => ({
        agentId: contribution.agentId,
        agentName: contribution.agentName,
        reason:
          contribution.webFindings.length === 0
            ? "No external evidence collected."
            : "Low confidence due to weak skill-to-track fit."
      }));

    return {
      consensusScore,
      votes,
      topActions,
      dissentingViews
    };
  }

  #buildFinalBriefing(input) {
    const mission = input.mission;
    const fallbackPlan = dedupePreservingOrder(
      input.contributions.flatMap((item) => item.recommendedActions)
    ).slice(0, 6);
    const recommendedPlan =
      input.consensus.topActions.length > 0
        ? input.consensus.topActions.map((item) => item.action)
        : fallbackPlan;
    const criticalFindings = input.contributions.map((item) => ({
      track: item.trackTitle,
      agentName: item.agentName,
      insight: item.keyInsights[0],
      evidenceCount: item.webFindings.length,
      confidence: item.confidence
    }));
    const unresolvedQuestions = dedupePreservingOrder(
      input.contributions
        .filter((item) => item.webFindings.length === 0 || item.confidence < 0.6)
        .map((item) => {
          if (item.webFindings.length === 0) {
            return `Need external validation for ${item.trackTitle.toLowerCase()}.`;
          }
          return `Low confidence on ${item.trackTitle.toLowerCase()} requires tighter evidence.`;
        })
    );
    const activatedSkillMap = new Map();
    for (const contribution of input.contributions) {
      const activatedSkill = contribution.activatedSkill;
      if (!activatedSkill?.id) {
        continue;
      }
      if (!activatedSkillMap.has(activatedSkill.id)) {
        activatedSkillMap.set(activatedSkill.id, {
          id: activatedSkill.id,
          name: activatedSkill.name,
          agentId: contribution.agentId,
          agentName: contribution.agentName,
          createdInRun: Boolean(activatedSkill.created),
          memoryCount: Number(activatedSkill.memoryCount ?? 0),
          tags: Array.isArray(activatedSkill.tags) ? activatedSkill.tags : []
        });
      }
    }
    const teamSoulMap = input.subAgents.map((agent) => ({
      agentId: agent.id,
      agentName: agent.name,
      skills: agent.skills,
      soul: normalizeSoul(agent)
    }));
    const createdSkillCount = [...activatedSkillMap.values()].filter((skill) => skill.createdInRun).length;

    return {
      presenterAgentId: input.mainAgent.id,
      presenterAgentName: input.mainAgent.name,
      missionTitle: mission.title,
      problem: input.problem,
      summary: `Council completed decomposition, ${input.debateRounds} debate round(s), activated ${activatedSkillMap.size} skill(s) (${createdSkillCount} new), and synthesized a coordinated execution plan for the main agent.`,
      consensusScore: input.consensus.consensusScore,
      dissentingViews: input.consensus.dissentingViews,
      teamSoulMap,
      activatedSkills: [...activatedSkillMap.values()],
      spawnedSubAgentIds: input.spawnedSubAgents.map((agent) => agent.id),
      criticalFindings,
      recommendedPlan,
      unresolvedQuestions
    };
  }

  async #requireMission(missionId) {
    const mission = await this.missionService.getMission(missionId);
    if (!mission) {
      throw this.#notFound("Mission not found.");
    }
    return mission;
  }

  async #requireAgent(agentId) {
    if (!agentId) {
      throw this.#badRequest("Agent id is required.");
    }
    const agent = await this.agentService.getAgent(agentId);
    if (!agent) {
      throw this.#notFound(`Agent not found: ${agentId}`);
    }
    return agent;
  }

  #assertSubRole(agent) {
    if (agent.role !== AgentRole.SUB) {
      throw this.#badRequest(`Agent ${agent.id} must have role 'sub' for council delegation.`);
    }
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

  #conflict(message) {
    const error = new Error(message);
    error.statusCode = 409;
    return error;
  }
}
