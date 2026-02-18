// @ts-nocheck
import { makeId } from "../lib/id.js";
import { normalizeModelPolicy, normalizeModelRefList } from "../lib/model-policy.js";
import { nowIso } from "../lib/time.js";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "there",
  "this",
  "to",
  "was",
  "we",
  "with",
  "you",
  "your"
]);

const TAG_RULES = [
  {
    tag: "coding",
    keywords: ["code", "bug", "fix", "refactor", "deploy", "api", "backend", "frontend"]
  },
  {
    tag: "testing",
    keywords: ["test", "qa", "regression", "coverage", "assert", "failure"]
  },
  {
    tag: "sales",
    keywords: ["sales", "lead", "demo", "pipeline", "prospect", "crm", "outreach", "close"]
  },
  {
    tag: "planning",
    keywords: ["plan", "roadmap", "timeline", "milestone", "scope", "delivery"]
  },
  {
    tag: "strategy",
    keywords: ["strategy", "positioning", "pricing", "tradeoff", "market", "growth"]
  },
  {
    tag: "research",
    keywords: ["research", "analyze", "analysis", "compare", "investigate", "evidence"]
  },
  {
    tag: "operations",
    keywords: ["ops", "operate", "incident", "monitor", "reliability", "runbook", "automation"]
  }
];

const HIGH_TASK_HINTS = [
  "architecture",
  "distributed",
  "refactor",
  "performance",
  "scalable",
  "migration",
  "security",
  "multi-agent",
  "orchestrator",
  "framework",
  "debug",
  "optimization"
];

const LOW_TASK_HINTS = [
  "summarize",
  "summary",
  "draft",
  "rewrite",
  "rename",
  "format",
  "outline",
  "short",
  "quick",
  "minor",
  "simple"
];

const CODING_TASK_HINTS = [
  "code",
  "coding",
  "bug",
  "test",
  "refactor",
  "api",
  "backend",
  "frontend",
  "typescript",
  "javascript",
  "python",
  "database",
  "query",
  "schema"
];

const HIGH_MODEL_HINTS = [
  "opus",
  "sonnet-4",
  "4.5",
  "4.6",
  "gpt-5",
  "o3",
  "o4",
  "pro",
  "ultra",
  "max"
];

const SMALL_MODEL_HINTS = ["mini", "haiku", "flash", "nano", "small", "lite"];
const CODING_MODEL_HINTS = ["codex", "sonnet", "gpt-5", "o3", "o4", "deepseek", "code"];

function normalizeStringList(values, { lowercase = true } = {}) {
  if (!Array.isArray(values)) {
    return [];
  }
  const mapped = values
    .map((item) => String(item).trim())
    .filter(Boolean)
    .map((value) => (lowercase ? value.toLowerCase() : value));
  return [...new Set(mapped)];
}

function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

function extractKeywords(text, limit = 8) {
  const tokens = tokenize(text).filter((token) => !STOP_WORDS.has(token));
  const counts = new Map();
  const firstSeen = new Map();
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    counts.set(token, (counts.get(token) ?? 0) + 1);
    if (!firstSeen.has(token)) {
      firstSeen.set(token, i);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return (firstSeen.get(a[0]) ?? 0) - (firstSeen.get(b[0]) ?? 0);
    })
    .slice(0, Math.max(1, limit))
    .map(([token]) => token);
}

function inferTags(taskText, agent) {
  const tokenSet = new Set(tokenize(taskText));
  const tags = [];
  for (const rule of TAG_RULES) {
    if (rule.keywords.some((keyword) => tokenSet.has(keyword))) {
      tags.push(rule.tag);
    }
  }

  const agentSkills = normalizeStringList(agent.skills);
  if (tags.length === 0 && agentSkills.length > 0) {
    tags.push(...agentSkills.slice(0, 3));
  }
  if (tags.length === 0) {
    tags.push("execution");
  }
  return normalizeStringList(tags);
}

function toTitle(value) {
  return String(value)
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildSkillName(keywords, tags) {
  const first = keywords[0] ?? tags[0] ?? "general";
  const second = keywords[1] ?? "workflow";
  return `${toTitle(first)} ${toTitle(second)} Skill`;
}

function buildSkillSummary(task, tags) {
  const taskText = String(task).trim();
  const shortTask = taskText.length > 180 ? `${taskText.slice(0, 180).trimEnd()}...` : taskText;
  const tagText = tags.slice(0, 3).join(", ");
  return `Auto-generated from task "${shortTask}" with focus on ${tagText}.`;
}

function buildTriggerPatterns(keywords, tags) {
  const patterns = [];
  for (const keyword of keywords.slice(0, 4)) {
    patterns.push(`when-task-includes:${keyword}`);
  }
  for (const tag of tags.slice(0, 4)) {
    patterns.push(`domain:${tag}`);
  }
  return [...new Set(patterns)];
}

function buildExecutionSteps(tags) {
  const steps = [];
  if (tags.includes("research")) {
    steps.push("Collect baseline facts and constraints before action.");
  }
  if (tags.includes("planning") || tags.includes("strategy")) {
    steps.push("Define milestones, owners, and decision checkpoints.");
  }
  if (tags.includes("coding") || tags.includes("testing")) {
    steps.push("Implement in small increments and validate with tests.");
  }
  if (tags.includes("sales")) {
    steps.push("Segment targets, personalize outreach, and track conversion signals.");
  }
  if (tags.includes("operations")) {
    steps.push("Monitor outcomes and create rollback steps for high-risk changes.");
  }
  steps.push("Record what worked and what failed in skill memory.");
  return [...new Set(steps)].slice(0, 6);
}

function buildCanonicalKey(text) {
  const keywords = extractKeywords(text, 6);
  if (keywords.length > 0) {
    return keywords.join(":");
  }
  const normalized = String(text ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return normalized.slice(0, 64) || "general";
}

function inferConfidence(agent, tags, keywords) {
  const agentSkills = normalizeStringList(agent.skills);
  const overlap = tags.filter((tag) => agentSkills.includes(tag)).length;
  const score = 0.55 + overlap * 0.08 + Math.min(0.2, keywords.length * 0.02) + (agent.canUseWeb ? 0.03 : 0);
  return Number(Math.min(0.95, score).toFixed(2));
}

function normalizeSeedMemory(input) {
  if (!input || typeof input !== "object") {
    return null;
  }
  const note = String(input.note ?? input.observation ?? "").trim();
  if (!note) {
    return null;
  }
  return {
    note,
    task: input.task ? String(input.task) : null,
    outcome: input.outcome ? String(input.outcome) : null,
    evidence: input.evidence ? String(input.evidence) : null,
    source: input.source ? String(input.source) : "task.autogen",
    score: Number.isFinite(Number(input.score)) ? Number(input.score) : null
  };
}

function parseMemoryLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 100;
  }
  return Math.min(500, parsed);
}

function clampConfidence(value, fallback = 0.7) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Number(Math.min(1, Math.max(0, parsed)).toFixed(2));
}

function extractJsonObject(text) {
  const raw = String(text ?? "").trim();
  if (!raw) {
    return null;
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    return null;
  }
  const segment = raw.slice(start, end + 1);
  try {
    return JSON.parse(segment);
  } catch {
    return null;
  }
}

function uniqueModelRefs(values, primary = "") {
  const primaryKey = String(primary ?? "")
    .trim()
    .toLowerCase();
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (key === primaryKey || seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function includesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function matchCount(text, keywords) {
  let count = 0;
  for (const keyword of keywords) {
    if (text.includes(keyword)) {
      count += 1;
    }
  }
  return count;
}

function profileTaskForRouting(task, context) {
  const combined = `${String(task ?? "")} ${String(context ?? "")}`
    .toLowerCase()
    .trim();
  const tokens = tokenize(combined);
  const codingSignal = matchCount(combined, CODING_TASK_HINTS);
  const highSignal = matchCount(combined, HIGH_TASK_HINTS);
  const lowSignal = matchCount(combined, LOW_TASK_HINTS);

  let complexity = 0;
  if (tokens.length >= 36) {
    complexity += 3;
  } else if (tokens.length >= 22) {
    complexity += 2;
  } else if (tokens.length >= 10) {
    complexity += 1;
  }
  complexity += Math.min(4, highSignal);
  complexity -= Math.min(3, lowSignal);
  if (codingSignal > 0) {
    complexity += 1;
  }

  let tier = "standard";
  if ((codingSignal > 0 && complexity >= 2) || complexity >= 5) {
    tier = "high";
  } else if (complexity <= 0) {
    tier = "small";
  }

  return {
    tier,
    isCoding: codingSignal > 0,
    complexity,
    codingSignal,
    highSignal,
    lowSignal
  };
}

function classifyModelRef(modelRef) {
  const normalized = String(modelRef ?? "").toLowerCase();
  return {
    isHigh: includesAny(normalized, HIGH_MODEL_HINTS),
    isSmall: includesAny(normalized, SMALL_MODEL_HINTS),
    isCodingFriendly: includesAny(normalized, CODING_MODEL_HINTS)
  };
}

export class SkillService {
  constructor(store, agentService, llmService = null) {
    this.store = store;
    this.agentService = agentService;
    this.llmService = llmService;
  }

  async listAgentSkills(agentId) {
    await this.#requireAgent(agentId);
    return this.store.listAgentSkills(agentId);
  }

  async getAgentSkill(agentId, skillId) {
    await this.#requireAgent(agentId);
    const skill = await this.store.getSkillById(skillId);
    if (!skill || skill.agentId !== agentId) {
      throw this.#notFound("Skill not found.");
    }
    return skill;
  }

  async createSkill(agentId, input) {
    const agent = await this.#requireAgent(agentId);
    const name = String(input.name ?? "").trim();
    if (!name) {
      throw this.#badRequest("Skill name is required.");
    }

    const sourceTask = String(input.sourceTask ?? input.task ?? "").trim();
    const tags = normalizeStringList(input.tags);
    const resolvedTags = tags.length > 0 ? tags : inferTags(`${name} ${sourceTask}`, agent);
    const keywords = extractKeywords(`${name} ${sourceTask}`, 8);
    const canonicalKey = String(input.canonicalKey ?? "").trim() || buildCanonicalKey(`${name} ${sourceTask}`);

    const existing = await this.store.getAgentSkillByCanonicalKey(agent.id, canonicalKey);
    if (existing) {
      throw this.#conflict("A skill with the same canonical key already exists for this agent.");
    }

    const createdAt = nowIso();
    const skill = {
      id: makeId("skill"),
      agentId: agent.id,
      workspaceId: agent.workspaceId ?? "default",
      canonicalKey,
      name,
      summary:
        String(input.summary ?? "").trim() || buildSkillSummary(sourceTask || name, resolvedTags),
      sourceTask,
      context: input.context ? String(input.context) : "",
      tags: resolvedTags,
      triggerPatterns:
        normalizeStringList(input.triggerPatterns, { lowercase: false }).length > 0
          ? normalizeStringList(input.triggerPatterns, { lowercase: false })
          : buildTriggerPatterns(keywords, resolvedTags),
      executionSteps:
        normalizeStringList(input.executionSteps, { lowercase: false }).length > 0
          ? normalizeStringList(input.executionSteps, { lowercase: false })
          : buildExecutionSteps(resolvedTags),
      confidence: inferConfidence(agent, resolvedTags, keywords),
      generation: {
        mode: "manual",
        task: sourceTask
      },
      memory: [],
      memoryCount: 0,
      lastUsedAt: null,
      createdAt,
      updatedAt: createdAt
    };

    const createdSkill = await this.store.createSkill(skill);
    await this.#mergeAgentSkills(agent, resolvedTags);

    const seedMemory = normalizeSeedMemory(input.seedMemory);
    if (!seedMemory) {
      return createdSkill;
    }
    return (await this.addSkillMemory(agent.id, createdSkill.id, seedMemory)).skill;
  }

  async generateSkill(agentId, input) {
    const agent = await this.#requireAgent(agentId);
    const task = String(input.task ?? input.problem ?? input.objective ?? "").trim();
    if (!task) {
      throw this.#badRequest("Task is required for auto skill generation.");
    }
    const context = String(input.context ?? "").trim();
    const canonicalKey = buildCanonicalKey(`${task} ${context}`);
    const existing = await this.store.getAgentSkillByCanonicalKey(agent.id, canonicalKey);

    const seedMemory = normalizeSeedMemory(input.seedMemory);
    if (existing) {
      let skill = existing;
      if (seedMemory) {
        skill = (await this.addSkillMemory(agent.id, existing.id, {
          ...seedMemory,
          task: seedMemory.task ?? task,
          source: seedMemory.source || "task.autogen.replay"
        })).skill;
      }
      return { skill, created: false };
    }

    const taskText = `${task} ${context}`.trim();
    const keywords = extractKeywords(taskText, 8);
    const tags = inferTags(taskText, agent);
    const createdAt = nowIso();
    const skill = await this.store.createSkill({
      id: makeId("skill"),
      agentId: agent.id,
      workspaceId: agent.workspaceId ?? "default",
      canonicalKey,
      name: buildSkillName(keywords, tags),
      summary: buildSkillSummary(task, tags),
      sourceTask: task,
      context,
      tags,
      triggerPatterns: buildTriggerPatterns(keywords, tags),
      executionSteps: buildExecutionSteps(tags),
      confidence: inferConfidence(agent, tags, keywords),
      generation: {
        mode: "auto",
        task,
        context
      },
      memory: [],
      memoryCount: 0,
      lastUsedAt: null,
      createdAt,
      updatedAt: createdAt
    });

    await this.#mergeAgentSkills(agent, tags);

    if (!seedMemory) {
      return { skill, created: true };
    }
    const withMemory = await this.addSkillMemory(agent.id, skill.id, {
      ...seedMemory,
      task: seedMemory.task ?? task,
      source: seedMemory.source || "task.autogen"
    });
    return { skill: withMemory.skill, created: true };
  }

  async generateSkillWithLlm(agentId, input) {
    const agent = await this.#requireAgent(agentId);
    const llmConfig = input?.llm && typeof input.llm === "object" && !Array.isArray(input.llm) ? input.llm : {};
    const hasProvider = Boolean(String(llmConfig.provider ?? "").trim());
    const hasModelRef = Boolean(String(llmConfig.modelRef ?? "").trim());
    const agentModel = normalizeModelPolicy(agent.model);
    const modelPlan = this.#resolveTaskAwareLlmModelPlan({
      llmConfig,
      hasProvider,
      hasModelRef,
      agentModel,
      task: input.task,
      context: input.context
    });

    if (!hasProvider && !modelPlan.modelRef) {
      throw this.#badRequest(
        "llm.provider or llm.modelRef is required, or configure agent.model.primary."
      );
    }
    if (!this.llmService) {
      throw this.#badRequest("LLM service is not configured.");
    }

    const generated = await this.generateSkill(agentId, input);
    if (!generated.created) {
      return {
        ...generated,
        llm: {
          used: false,
          reason: "existing-skill"
        }
      };
    }

    const prompt = this.#buildLlmSkillPrompt({
      agent,
      task: input.task,
      context: input.context,
      seedSkill: generated.skill
    });

    try {
      const llm = await this.llmService.respond({
        provider: hasProvider ? llmConfig.provider : undefined,
        model: llmConfig.model,
        modelRef: modelPlan.modelRef || undefined,
        fallbacks: modelPlan.fallbacks.length > 0 ? modelPlan.fallbacks : undefined,
        temperature: llmConfig.temperature ?? 0.2,
        maxTokens: llmConfig.maxTokens ?? 500,
        system:
          "Return valid JSON only. Do not use markdown. Keep fields concise and actionable for an autonomous agent.",
        prompt
      });

      const parsed = extractJsonObject(llm.text);
      if (!parsed || typeof parsed !== "object") {
        return {
          ...generated,
          llm: {
            used: false,
            provider: llm.provider,
            model: llm.model,
            reason: "invalid-json-response"
          }
        };
      }

      const patch = {
        updatedAt: nowIso()
      };
      if (parsed.name && String(parsed.name).trim()) {
        patch.name = String(parsed.name).trim();
      }
      if (parsed.summary && String(parsed.summary).trim()) {
        patch.summary = String(parsed.summary).trim();
      }
      if (Array.isArray(parsed.tags)) {
        patch.tags = normalizeStringList(parsed.tags);
      }
      if (Array.isArray(parsed.triggerPatterns)) {
        patch.triggerPatterns = normalizeStringList(parsed.triggerPatterns, { lowercase: false });
      }
      if (Array.isArray(parsed.executionSteps)) {
        patch.executionSteps = normalizeStringList(parsed.executionSteps, { lowercase: false });
      }
      patch.confidence = clampConfidence(parsed.confidence, generated.skill.confidence);

      const updated = await this.store.updateSkill(generated.skill.id, patch) ?? generated.skill;
      if (Array.isArray(patch.tags) && patch.tags.length > 0) {
        await this.#mergeAgentSkills(agent, patch.tags);
      }

      return {
        skill: updated,
        created: true,
        llm: {
          used: true,
          provider: llm.provider,
          model: llm.model,
          modelRef: llm.modelRef ?? `${llm.provider}/${llm.model}`,
          routing: modelPlan.routing
        }
      };
    } catch (error) {
      const allowFallback = input?.llm?.fallback !== false;
      if (!allowFallback) {
        throw error;
      }
      return {
        ...generated,
        llm: {
          used: false,
          reason: "fallback",
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  async updateSkill(agentId, skillId, input) {
    const agent = await this.#requireAgent(agentId);
    const skill = await this.getAgentSkill(agent.id, skillId);
    const patch = {
      updatedAt: nowIso()
    };

    if (input.name !== undefined) {
      const name = String(input.name).trim();
      if (!name) {
        throw this.#badRequest("Skill name cannot be empty.");
      }
      patch.name = name;
    }
    if (input.summary !== undefined) {
      patch.summary = String(input.summary);
    }
    if (input.tags !== undefined) {
      patch.tags = normalizeStringList(input.tags);
      await this.#mergeAgentSkills(agent, patch.tags);
    }
    if (input.triggerPatterns !== undefined) {
      patch.triggerPatterns = normalizeStringList(input.triggerPatterns, { lowercase: false });
    }
    if (input.executionSteps !== undefined) {
      patch.executionSteps = normalizeStringList(input.executionSteps, { lowercase: false });
    }
    if (input.confidence !== undefined) {
      const confidence = Number(input.confidence);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        throw this.#badRequest("Skill confidence must be a number between 0 and 1.");
      }
      patch.confidence = Number(confidence.toFixed(2));
    }

    const updated = await this.store.updateSkill(skill.id, patch);
    if (!updated) {
      throw this.#notFound("Skill not found.");
    }
    return updated;
  }

  async addSkillMemory(agentId, skillId, input) {
    const skill = await this.getAgentSkill(agentId, skillId);
    const note = String(input.note ?? input.observation ?? "").trim();
    if (!note) {
      throw this.#badRequest("Skill memory note is required.");
    }

    const createdAt = nowIso();
    const memory = {
      id: makeId("skillmem"),
      skillId: skill.id,
      note,
      task: input.task ? String(input.task) : null,
      outcome: input.outcome ? String(input.outcome) : null,
      evidence: input.evidence ? String(input.evidence) : null,
      source: input.source ? String(input.source) : "manual",
      score: Number.isFinite(Number(input.score)) ? Number(input.score) : null,
      createdAt
    };

    const updated = await this.store.appendSkillMemory(skill.id, memory, parseMemoryLimit(input.maxMemory));
    if (!updated) {
      throw this.#notFound("Skill not found.");
    }

    return {
      skill: updated,
      memory
    };
  }

  async listSkillMemory(agentId, skillId) {
    const skill = await this.getAgentSkill(agentId, skillId);
    return Array.isArray(skill.memory) ? skill.memory : [];
  }

  #buildLlmSkillPrompt(input) {
    return [
      "Generate a reusable autonomous agent skill as JSON.",
      "Required JSON schema:",
      '{"name":"string","summary":"string","tags":["string"],"triggerPatterns":["string"],"executionSteps":["string"],"confidence":0.0}',
      `Task: ${String(input.task ?? "").trim()}`,
      `Context: ${String(input.context ?? "").trim()}`,
      `Agent role: ${input.agent.role}`,
      `Agent skills: ${(Array.isArray(input.agent.skills) ? input.agent.skills : []).join(", ")}`,
      `Agent soul mission: ${String(input.agent.soul?.mission ?? "")}`,
      `Seed skill name: ${input.seedSkill.name}`,
      `Seed summary: ${input.seedSkill.summary}`,
      "Rules:",
      "1) Keep tags short and lowercase.",
      "2) Keep execution steps concrete and outcome-oriented.",
      "3) Do not include markdown or explanations, return JSON only."
    ].join("\n");
  }

  #resolveTaskAwareLlmModelPlan(input) {
    const llmConfig = input.llmConfig ?? {};
    const hasProvider = input.hasProvider === true;
    const hasModelRef = input.hasModelRef === true;
    const agentModel = input.agentModel ?? { primary: "", fallbacks: [] };

    const normalizeRef = (value, fallbackProvider = "") => {
      const raw = String(value ?? "").trim();
      if (!raw) {
        return "";
      }
      if (typeof this.llmService?.normalizeModelRef === "function") {
        return this.llmService.normalizeModelRef(raw, fallbackProvider) ?? raw;
      }
      return raw;
    };

    const explicitModelRef = hasModelRef
      ? normalizeRef(llmConfig.modelRef, hasProvider ? llmConfig.provider : "")
      : "";
    const primaryFromAgent = normalizeRef(agentModel.primary);
    const fallbackFromConfig = normalizeModelRefList(llmConfig.fallbacks ?? agentModel.fallbacks, {
      splitCommas: true
    }).map((entry) => normalizeRef(entry));

    if (hasProvider || explicitModelRef) {
      const explicitPrimary = explicitModelRef || primaryFromAgent;
      return {
        modelRef: explicitPrimary,
        fallbacks: uniqueModelRefs(fallbackFromConfig, explicitPrimary),
        routing: {
          mode: "explicit",
          tier: "manual",
          isCoding: false
        }
      };
    }

    const configuredModelRefs = this.#listConfiguredModelRefs().map((ref) => normalizeRef(ref));
    const taskProfile = profileTaskForRouting(input.task, input.context);
    const envSmall = normalizeRef(process.env.TASK_MODEL_SMALL);
    const envStandard = normalizeRef(process.env.TASK_MODEL_STANDARD);
    const envHighCoding = normalizeRef(process.env.TASK_MODEL_HIGH_CODING);
    const envHighGeneral = normalizeRef(process.env.TASK_MODEL_HIGH_GENERAL);

    const pools = {
      high: [],
      small: [],
      coding: [],
      standard: []
    };
    for (const modelRef of configuredModelRefs) {
      const classified = classifyModelRef(modelRef);
      if (classified.isHigh) {
        pools.high.push(modelRef);
      }
      if (classified.isSmall) {
        pools.small.push(modelRef);
      }
      if (classified.isCodingFriendly) {
        pools.coding.push(modelRef);
      }
      if (!classified.isHigh && !classified.isSmall) {
        pools.standard.push(modelRef);
      }
    }

    let selected = "";
    if (taskProfile.tier === "high") {
      if (taskProfile.isCoding) {
        selected = envHighCoding || pools.coding[0] || pools.high[0] || "";
      } else {
        selected = envHighGeneral || pools.high[0] || "";
      }
    } else if (taskProfile.tier === "small") {
      selected = envSmall || pools.small[0] || "";
    } else {
      selected = envStandard || primaryFromAgent || pools.standard[0] || pools.high[0] || pools.small[0] || "";
    }

    if (!selected) {
      selected =
        primaryFromAgent ||
        (typeof this.llmService?.resolveDefaultModelRef === "function"
          ? this.llmService.resolveDefaultModelRef("")
          : "") ||
        configuredModelRefs[0] ||
        "";
    }

    const routingFallbackCandidates = [];
    if (taskProfile.tier === "high") {
      routingFallbackCandidates.push(...pools.coding, ...pools.high, primaryFromAgent, ...pools.standard, ...pools.small);
    } else if (taskProfile.tier === "small") {
      routingFallbackCandidates.push(...pools.small, ...pools.standard, primaryFromAgent, ...pools.high);
    } else {
      routingFallbackCandidates.push(primaryFromAgent, ...pools.standard, ...pools.high, ...pools.small);
    }
    routingFallbackCandidates.push(...configuredModelRefs, ...fallbackFromConfig);

    return {
      modelRef: selected,
      fallbacks: uniqueModelRefs(routingFallbackCandidates, selected),
      routing: {
        mode: "task-aware",
        tier: taskProfile.tier,
        isCoding: taskProfile.isCoding,
        complexity: taskProfile.complexity
      }
    };
  }

  #listConfiguredModelRefs() {
    if (!this.llmService || typeof this.llmService.listModelRefs !== "function") {
      return [];
    }
    const entries = this.llmService.listModelRefs({ configuredOnly: true });
    const refs = [];
    const seen = new Set();
    for (const entry of entries) {
      const value = String(entry?.modelRef ?? "").trim();
      const key = value.toLowerCase();
      if (!value || seen.has(key)) {
        continue;
      }
      seen.add(key);
      refs.push(value);
    }
    return refs;
  }

  async #mergeAgentSkills(agent, skillTags) {
    const tags = normalizeStringList(skillTags);
    if (tags.length === 0) {
      return;
    }
    const existing = normalizeStringList(agent.skills);
    const merged = [...new Set([...existing, ...tags])];
    if (merged.length === existing.length) {
      return;
    }
    await this.store.updateAgent(agent.id, {
      skills: merged,
      updatedAt: nowIso()
    });
  }

  async #requireAgent(agentId) {
    if (!agentId) {
      throw this.#badRequest("Agent id is required.");
    }
    const agent = await this.agentService.getAgent(agentId);
    if (!agent) {
      throw this.#notFound("Agent not found.");
    }
    return agent;
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
