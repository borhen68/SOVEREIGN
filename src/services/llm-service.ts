// @ts-nocheck
function withTimeout(ms, promise) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("LLM request timed out")), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function clampInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function safeString(value, fallback = "") {
  const normalized = value === undefined || value === null ? "" : String(value).trim();
  return normalized || String(fallback ?? "").trim();
}

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const normalized = String(value ?? "")
      .trim()
      .toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizeArray(input) {
  if (!input) {
    return [];
  }
  if (Array.isArray(input)) {
    return input;
  }
  return [input];
}

function buildAttemptSummary(attempt) {
  const statusSuffix =
    typeof attempt.statusCode === "number" ? ` (status ${attempt.statusCode})` : "";
  return `${attempt.provider}/${attempt.model}: ${attempt.error}${statusSuffix}`;
}

function safeNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") {
    return {
      promptTokens: null,
      completionTokens: null,
      totalTokens: null
    };
  }
  const promptTokens = safeNumber(
    usage.prompt_tokens ?? usage.promptTokenCount ?? usage.input_tokens ?? usage.inputTokenCount
  );
  const completionTokens = safeNumber(
    usage.completion_tokens ??
      usage.completionTokenCount ??
      usage.output_tokens ??
      usage.outputTokenCount ??
      usage.candidatesTokenCount
  );
  const totalTokens = safeNumber(
    usage.total_tokens ??
      usage.totalTokenCount ??
      (promptTokens !== null || completionTokens !== null
        ? (promptTokens ?? 0) + (completionTokens ?? 0)
        : null)
  );
  const reasoningTokens = safeNumber(
    usage.reasoning_tokens ?? usage.reasoningTokens
  );
  return {
    promptTokens: promptTokens === null ? null : Math.max(0, Math.round(promptTokens)),
    completionTokens: completionTokens === null ? null : Math.max(0, Math.round(completionTokens)),
    totalTokens: totalTokens === null ? null : Math.max(0, Math.round(totalTokens)),
    reasoningTokens: reasoningTokens === null ? null : Math.max(0, Math.round(reasoningTokens))
  };
}

const OPENAI_COMPAT_PROVIDER_SPECS = [
  {
    id: "openrouter",
    aliases: ["openrouter"],
    keyEnv: "OPENROUTER_API_KEY",
    baseEnv: "OPENROUTER_BASE_URL",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    modelEnv: "OPENROUTER_MODEL",
    defaultModel: "openai/gpt-4o-mini"
  },
  {
    id: "groq",
    aliases: ["groq"],
    keyEnv: "GROQ_API_KEY",
    baseEnv: "GROQ_BASE_URL",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    modelEnv: "GROQ_MODEL",
    defaultModel: "llama-3.3-70b-versatile"
  },
  {
    id: "mistral",
    aliases: ["mistral"],
    keyEnv: "MISTRAL_API_KEY",
    baseEnv: "MISTRAL_BASE_URL",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    modelEnv: "MISTRAL_MODEL",
    defaultModel: "mistral-large-latest"
  },
  {
    id: "together",
    aliases: ["together", "togetherai"],
    keyEnv: "TOGETHER_API_KEY",
    baseEnv: "TOGETHER_BASE_URL",
    defaultBaseUrl: "https://api.together.xyz/v1",
    modelEnv: "TOGETHER_MODEL",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo"
  },
  {
    id: "fireworks",
    aliases: ["fireworks", "fireworksai"],
    keyEnv: "FIREWORKS_API_KEY",
    baseEnv: "FIREWORKS_BASE_URL",
    defaultBaseUrl: "https://api.fireworks.ai/inference/v1",
    modelEnv: "FIREWORKS_MODEL",
    defaultModel: "accounts/fireworks/models/llama-v3p1-70b-instruct"
  },
  {
    id: "deepseek",
    aliases: ["deepseek"],
    keyEnv: "DEEPSEEK_API_KEY",
    baseEnv: "DEEPSEEK_BASE_URL",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    modelEnv: "DEEPSEEK_MODEL",
    defaultModel: "deepseek-chat"
  },
  {
    id: "xai",
    aliases: ["xai", "grok"],
    keyEnv: "XAI_API_KEY",
    baseEnv: "XAI_BASE_URL",
    defaultBaseUrl: "https://api.x.ai/v1",
    modelEnv: "XAI_MODEL",
    defaultModel: "grok-2-latest"
  },
  {
    id: "perplexity",
    aliases: ["perplexity"],
    keyEnv: "PERPLEXITY_API_KEY",
    baseEnv: "PERPLEXITY_BASE_URL",
    defaultBaseUrl: "https://api.perplexity.ai",
    modelEnv: "PERPLEXITY_MODEL",
    defaultModel: "sonar-pro"
  },
  {
    id: "venice",
    aliases: ["venice"],
    keyEnv: "VENICE_API_KEY",
    baseEnv: "VENICE_BASE_URL",
    defaultBaseUrl: "https://api.venice.ai/api/v1",
    modelEnv: "VENICE_MODEL",
    defaultModel: "venice-uncensored"
  },
  {
    id: "cohere",
    aliases: ["cohere"],
    keyEnv: "COHERE_API_KEY",
    baseEnv: "COHERE_BASE_URL",
    defaultBaseUrl: "https://api.cohere.ai/compatibility/v1",
    modelEnv: "COHERE_MODEL",
    defaultModel: "command-r-plus"
  },
  {
    id: "cloudflare",
    aliases: ["cloudflare", "cloudflareai"],
    keyEnv: "CLOUDFLARE_API_KEY",
    baseEnv: "CLOUDFLARE_BASE_URL",
    defaultBaseUrl: "",
    modelEnv: "CLOUDFLARE_MODEL",
    defaultModel: "@cf/meta/llama-3.1-8b-instruct"
  },
  {
    id: "bedrock",
    aliases: ["bedrock", "awsbedrock"],
    keyEnv: "BEDROCK_API_KEY",
    baseEnv: "BEDROCK_BASE_URL",
    defaultBaseUrl: "",
    modelEnv: "BEDROCK_MODEL",
    defaultModel: "anthropic.claude-3-5-sonnet-20240620-v1:0"
  },
  {
    id: "ollama",
    aliases: ["ollama"],
    keyEnv: "OLLAMA_API_KEY",
    baseEnv: "OLLAMA_BASE_URL",
    defaultBaseUrl: "http://localhost:11434/v1",
    modelEnv: "OLLAMA_MODEL",
    defaultModel: "llama3.2",
    allowKeyless: true
  },
  {
    id: "minimax",
    aliases: ["minimax"],
    keyEnv: "MINIMAX_API_KEY",
    baseEnv: "MINIMAX_BASE_URL",
    defaultBaseUrl: "",
    modelEnv: "MINIMAX_MODEL",
    defaultModel: "MiniMax-Text-01"
  },
  {
    id: "nscale",
    aliases: ["nscale"],
    keyEnv: "NSCALE_API_KEY",
    baseEnv: "NSCALE_BASE_URL",
    defaultBaseUrl: "",
    modelEnv: "NSCALE_MODEL",
    defaultModel: "nscale-chat"
  },
  {
    id: "cerebras",
    aliases: ["cerebras"],
    keyEnv: "CEREBRAS_API_KEY",
    baseEnv: "CEREBRAS_BASE_URL",
    defaultBaseUrl: "https://api.cerebras.ai/v1",
    modelEnv: "CEREBRAS_MODEL",
    defaultModel: "llama3.1-70b"
  },
  {
    id: "moonshot",
    aliases: ["moonshot", "kimi"],
    keyEnv: "MOONSHOT_API_KEY",
    baseEnv: "MOONSHOT_BASE_URL",
    defaultBaseUrl: "",
    modelEnv: "MOONSHOT_MODEL",
    defaultModel: "moonshot-v1-8k"
  },
  {
    id: "alibaba",
    aliases: ["alibaba", "qwen"],
    keyEnv: "ALIBABA_API_KEY",
    baseEnv: "ALIBABA_BASE_URL",
    defaultBaseUrl: "",
    modelEnv: "ALIBABA_MODEL",
    defaultModel: "qwen-plus"
  },
  {
    id: "sambanova",
    aliases: ["sambanova", "samba"],
    keyEnv: "SAMBANOVA_API_KEY",
    baseEnv: "SAMBANOVA_BASE_URL",
    defaultBaseUrl: "",
    modelEnv: "SAMBANOVA_MODEL",
    defaultModel: "Meta-Llama-3.1-70B-Instruct"
  },
  {
    id: "friendli",
    aliases: ["friendli"],
    keyEnv: "FRIENDLI_API_KEY",
    baseEnv: "FRIENDLI_BASE_URL",
    defaultBaseUrl: "",
    modelEnv: "FRIENDLI_MODEL",
    defaultModel: "meta-llama-3.1-70b-instruct"
  },
  {
    id: "anyscale",
    aliases: ["anyscale"],
    keyEnv: "ANYSCALE_API_KEY",
    baseEnv: "ANYSCALE_BASE_URL",
    defaultBaseUrl: "",
    modelEnv: "ANYSCALE_MODEL",
    defaultModel: "meta-llama/Llama-3.1-70B-Instruct"
  },
  {
    id: "custom",
    aliases: ["custom"],
    keyEnv: "CUSTOM_LLM_API_KEY",
    baseEnv: "CUSTOM_LLM_BASE_URL",
    defaultBaseUrl: "",
    modelEnv: "CUSTOM_LLM_MODEL",
    defaultModel: "gpt-4o-mini"
  },
  {
    id: "nvidia",
    aliases: ["nvidia", "nv"],
    keyEnv: "NVIDIA_API_KEY",
    baseEnv: "NVIDIA_BASE_URL",
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
    modelEnv: "NVIDIA_MODEL",
    defaultModel: "z-ai/glm4.7"
  }
];

/**
 * Hermes-grade Model Routing Tier Preferences.
 *
 * Each tier defines an ordered list of provider+model combinations
 * ranked by suitability for that task class. The system walks the list
 * and picks the first provider that is configured (has a valid API key).
 *
 * - tool:      Optimized for structured tool/function calling (low hallucination).
 * - reasoning: High-capability models for Council debates, planning, critic analysis.
 * - small:     Fast, low-cost models for summarization, classification, utilities.
 * - coding:    Models tuned for code generation, review, and debugging.
 */
const MODEL_TIER_PREFERENCES = Object.freeze({
  tool: [
    { provider: "groq",       model: "llama-3.3-70b-versatile" },
    { provider: "fireworks",  model: "accounts/fireworks/models/llama-v3p1-70b-instruct" },
    { provider: "together",   model: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
    { provider: "openai",     model: "gpt-4o-mini" },
    { provider: "anthropic",  model: "claude-3-5-sonnet-latest" },
    { provider: "gemini",     model: "gemini-1.5-flash" },
    { provider: "cerebras",   model: "llama3.1-70b" },
    { provider: "deepseek",   model: "deepseek-chat" },
    { provider: "ollama",     model: "llama3.2" }
  ],
  reasoning: [
    { provider: "nvidia",     model: "z-ai/glm4.7" },
    { provider: "anthropic",  model: "claude-3-5-sonnet-latest" },
    { provider: "openai",     model: "gpt-4o" },
    { provider: "gemini",     model: "gemini-1.5-pro" },
    { provider: "deepseek",   model: "deepseek-chat" },
    { provider: "mistral",    model: "mistral-large-latest" },
    { provider: "xai",        model: "grok-2-latest" },
    { provider: "cohere",     model: "command-r-plus" },
    { provider: "openrouter", model: "openai/gpt-4o" }
  ],
  small: [
    { provider: "openai",     model: "gpt-4o-mini" },
    { provider: "gemini",     model: "gemini-1.5-flash" },
    { provider: "groq",       model: "llama-3.3-70b-versatile" },
    { provider: "cerebras",   model: "llama3.1-70b" },
    { provider: "anthropic",  model: "claude-3-5-haiku-latest" },
    { provider: "mistral",    model: "mistral-small-latest" },
    { provider: "ollama",     model: "llama3.2" }
  ],
  coding: [
    { provider: "anthropic",  model: "claude-3-5-sonnet-latest" },
    { provider: "deepseek",   model: "deepseek-coder" },
    { provider: "openai",     model: "gpt-4o" },
    { provider: "gemini",     model: "gemini-1.5-pro" },
    { provider: "fireworks",  model: "accounts/fireworks/models/llama-v3p1-70b-instruct" },
    { provider: "together",   model: "meta-llama/Llama-3.3-70B-Instruct-Turbo" }
  ]
});

export class LlmService {
  constructor(options = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = clampInt(options.timeoutMs, 30_000, 1_000, 120_000);
    this.observabilityService = options.observabilityService ?? null;
    this.defaultWorkspaceId = safeString(
      options.defaultWorkspaceId ?? process.env.DEFAULT_WORKSPACE_ID ?? "default"
    );
    this.costPer1kTokens = clampNumber(
      options.llmCostPer1kTokens ?? process.env.LLM_COST_PER_1K_TOKENS,
      0,
      0,
      100
    );

    this.providers = new Map();
    this.providerAliases = new Map();
    this.#registerProvider({
      id: "openai",
      aliases: ["openai"],
      apiKey: safeString(options.openaiApiKey ?? process.env.OPENAI_API_KEY).trim(),
      defaultModel: safeString(options.openaiModel ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini").trim(),
      transport: "openai_compatible",
      baseUrl: safeString(options.openaiBaseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").trim()
    });
    this.#registerProvider({
      id: "anthropic",
      aliases: ["anthropic", "claude"],
      apiKey: safeString(options.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY).trim(),
      defaultModel: safeString(
        options.anthropicModel ?? process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-latest"
      ).trim(),
      transport: "anthropic",
      baseUrl: "https://api.anthropic.com/v1"
    });
    this.#registerProvider({
      id: "gemini",
      aliases: ["gemini", "google"],
      apiKey: safeString(
        options.geminiApiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
      ).trim(),
      defaultModel: safeString(options.geminiModel ?? process.env.GEMINI_MODEL ?? "gemini-1.5-pro").trim(),
      transport: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta"
    });

    for (const spec of OPENAI_COMPAT_PROVIDER_SPECS) {
      this.#registerProvider({
        id: spec.id,
        aliases: spec.aliases,
        apiKey: safeString(options[`${spec.id}ApiKey`] ?? process.env[spec.keyEnv]).trim(),
        defaultModel: safeString(
          options[`${spec.id}Model`] ?? process.env[spec.modelEnv] ?? spec.defaultModel
        ).trim(),
        transport: "openai_compatible",
        baseUrl: safeString(
          options[`${spec.id}BaseUrl`] ?? process.env[spec.baseEnv] ?? spec.defaultBaseUrl
        ).trim(),
        allowKeyless: spec.allowKeyless === true
      });
    }
  }

  listProviders() {
    return [...this.providers.values()]
      .map((provider) => ({
        provider: provider.id,
        aliases: [...provider.aliases],
        configured: this.#isProviderConfigured(provider),
        defaultModel: provider.defaultModel,
        transport: provider.transport,
        baseUrl: provider.baseUrl
      }))
      .sort((a, b) => a.provider.localeCompare(b.provider));
  }

  listModelRefs(options = {}) {
    const configuredOnly = options.configuredOnly === true;
    return this.listProviders()
      .filter((provider) => (!configuredOnly ? true : provider.configured))
      .filter((provider) => Boolean(provider.defaultModel))
      .map((provider) => ({
        modelRef: `${provider.provider}/${provider.defaultModel}`,
        provider: provider.provider,
        model: provider.defaultModel,
        configured: provider.configured,
        isDefault: true
      }));
  }

  resolveDefaultModelRef(preferredProvider = "") {
    const providers = this.listProviders().filter((entry) => entry.configured);
    if (providers.length === 0) {
      return null;
    }
    const preferred = this.#normalizeProvider(preferredProvider);
    if (preferred) {
      const preferredProviderInfo = providers.find((entry) => entry.provider === preferred);
      if (preferredProviderInfo) {
        return `${preferredProviderInfo.provider}/${preferredProviderInfo.defaultModel}`;
      }
    }
    const first = providers[0];
    return `${first.provider}/${first.defaultModel}`;
  }

  /**
   * Hermes-grade Model Routing: Resolve the best model for structured tool/function calling.
   *
   * Prefers models known for low hallucination rates on tool-use tasks:
   * Hermes models via OpenRouter, Groq (fast Hermes inference), function-calling-tuned models.
   * Falls back to the default model if no specialized tool-caller is configured.
   *
   * @param {string} [preferredProvider] - Optional provider preference.
   * @returns {string|null} modelRef like "groq/llama-3.3-70b-versatile"
   */
  resolveToolModelRef(preferredProvider = "") {
    return this.#resolveModelRefByTier("tool", preferredProvider);
  }

  /**
   * Hermes-grade Model Routing: Resolve the best model for high-reasoning tasks.
   *
   * Used for Council debates, Critic analysis, and complex planning.
   * Prefers large reasoning models (GPT-4o, Claude 3.5, Gemini 1.5 Pro).
   *
   * @param {string} [preferredProvider] - Optional provider preference.
   * @returns {string|null} modelRef like "openai/gpt-4o"
   */
  resolveReasoningModelRef(preferredProvider = "") {
    return this.#resolveModelRefByTier("reasoning", preferredProvider);
  }

  /**
   * Hermes-grade Model Routing: Resolve a fast/small model for lightweight operations.
   *
   * Used for summarization, classification, and low-latency utility tasks.
   * Prefers small footprint models (GPT-4o-mini, Gemini Flash, Llama 8B).
   *
   * @param {string} [preferredProvider] - Optional provider preference.
   * @returns {string|null} modelRef like "openai/gpt-4o-mini"
   */
  resolveSmallModelRef(preferredProvider = "") {
    return this.#resolveModelRefByTier("small", preferredProvider);
  }

  /**
   * Resolve the optimal model ref for a given tier.
   *
   * @param {"tool"|"reasoning"|"small"|"coding"} tier
   * @param {string} [preferredProvider]
   * @returns {string|null}
   */
  resolveModelRefByTier(tier, preferredProvider = "") {
    return this.#resolveModelRefByTier(tier, preferredProvider);
  }

  /**
   * Returns the tier configuration for inspection/debugging.
   */
  getModelTiers() {
    const configuredProviders = new Set(
      this.listProviders().filter((entry) => entry.configured).map((entry) => entry.provider)
    );
    const tiers = {};
    for (const [tier, preferences] of Object.entries(MODEL_TIER_PREFERENCES)) {
      const resolved = this.#resolveModelRefByTier(tier);
      tiers[tier] = {
        resolved,
        preferenceCount: preferences.length,
        configuredCandidates: preferences.filter((pref) => configuredProviders.has(pref.provider)).length
      };
    }
    return tiers;
  }

  normalizeModelRef(raw, fallbackProvider = "") {
    const parsed = this.#parseModelRef(raw, fallbackProvider);
    if (!parsed) {
      return null;
    }
    const resolved = this.#resolveCandidate(parsed);
    return resolved ? resolved.modelRef : null;
  }

  async respond(input = {}) {
    const prompt = String(input.prompt ?? "").trim();
    if (!prompt) {
      throw this.#badRequest("prompt is required.");
    }
    const system = String(input.system ?? "").trim();
    const temperature = clampNumber(input.temperature, 0.2, 0, 2);
    const maxTokens = clampInt(input.maxTokens, 700, 1, 8_192);

    const candidates = this.#resolveCandidates(input);
    if (candidates.length === 0) {
      throw this.#badRequest(
        "provider or modelRef is required (example: provider='openai' or modelRef='openai/gpt-4o-mini')."
      );
    }

    const context = {
      workspaceId: safeString(input.workspaceId, this.defaultWorkspaceId),
      traceId: safeString(input.traceId) || null,
      runId: safeString(input.runId) || null,
      missionId: safeString(input.missionId) || null,
      source: safeString(input.source, "llm.respond")
    };
    const requestStarted = Date.now();
    this.#observe({
      ...context,
      type: "llm.request.start",
      level: "info",
      message: "LLM request started.",
      payload: {
        candidateCount: candidates.length,
        promptChars: prompt.length,
        systemChars: system.length,
        hasImage: Boolean(input.imageUrl || input.imagePath),
        temperature,
        maxTokens
      }
    });

    const attempts = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const attemptStarted = Date.now();
      try {
        const completion = await this.#dispatch(candidate, {
          prompt,
          system,
          temperature,
          maxTokens,
          imageUrl: input.imageUrl,
          imagePath: input.imagePath
        });
        const usage = normalizeUsage(completion.usage);
        const costUsd = this.#estimateCostUsd(usage.totalTokens);
        const durationMs = Date.now() - attemptStarted;
        this.#observe({
          ...context,
          type: "llm.attempt.success",
          level: "info",
          message: "LLM candidate succeeded.",
          payload: {
            provider: candidate.provider,
            model: candidate.model,
            modelRef: `${candidate.provider}/${candidate.model}`,
            attemptIndex: index + 1,
            candidateCount: candidates.length,
            promptChars: prompt.length
          },
          durationMs,
          tokenUsage: usage.totalTokens,
          costUsd
        });
        this.#observe({
          ...context,
          type: "llm.request.success",
          level: "info",
          message: "LLM request succeeded.",
          payload: {
            provider: candidate.provider,
            model: candidate.model,
            modelRef: `${candidate.provider}/${candidate.model}`,
            attemptsTried: attempts.length + 1
          },
          durationMs: Date.now() - requestStarted,
          tokenUsage: usage.totalTokens,
          costUsd
        });
        return {
          ...completion,
          modelRef: `${completion.provider}/${completion.model}`,
          usageNormalized: usage,
          durationMs,
          costUsd,
          attempts: attempts.map((attempt) => ({
            provider: attempt.provider,
            model: attempt.model,
            error: attempt.error,
            statusCode: attempt.statusCode
          }))
        };
      } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        const statusCode = Number(normalizedError.statusCode);
        attempts.push({
          provider: candidate.provider,
          model: candidate.model,
          error: normalizedError.message,
          statusCode: Number.isInteger(statusCode) ? statusCode : null,
          _error: normalizedError
        });
        this.#observe({
          ...context,
          type: "llm.attempt.failed",
          level: "warning",
          message: "LLM candidate failed.",
          payload: {
            provider: candidate.provider,
            model: candidate.model,
            modelRef: `${candidate.provider}/${candidate.model}`,
            attemptIndex: index + 1,
            candidateCount: candidates.length,
            error: normalizedError.message,
            statusCode: Number.isInteger(statusCode) ? statusCode : null
          },
          durationMs: Date.now() - attemptStarted
        });
      }
    }

    if (attempts.length === 1) {
      this.#observe({
        ...context,
        type: "llm.request.failed",
        level: "error",
        message: "LLM request failed.",
        payload: {
          attempts: attempts.map((attempt) => ({
            provider: attempt.provider,
            model: attempt.model,
            error: attempt.error,
            statusCode: attempt.statusCode
          }))
        },
        durationMs: Date.now() - requestStarted
      });
      throw attempts[0]._error;
    }

    const aggregate = new Error(
      `LLM request failed across ${attempts.length} candidates: ${attempts
        .map((attempt) => buildAttemptSummary(attempt))
        .join(" | ")}`
    );
    const statusCandidates = attempts
      .map((attempt) => attempt.statusCode)
      .filter((status) => Number.isInteger(status));
    aggregate.statusCode = statusCandidates.length > 0 ? Math.max(...statusCandidates) : 502;
    aggregate.attempts = attempts.map((attempt) => ({
      provider: attempt.provider,
      model: attempt.model,
      error: attempt.error,
      statusCode: attempt.statusCode
    }));
    this.#observe({
      ...context,
      type: "llm.request.failed",
      level: "error",
      message: "LLM request failed.",
      payload: {
        attempts: aggregate.attempts
      },
      durationMs: Date.now() - requestStarted
    });
    throw aggregate;
  }

  #resolveCandidates(input) {
    const candidates = [];
    const seen = new Set();
    const add = (candidate) => {
      if (!candidate) {
        return;
      }
      const key = `${candidate.provider}/${candidate.model}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      candidates.push(candidate);
    };

    const primaryModelRef = String(input.modelRef ?? "").trim();
    const primary = this.#resolveCandidate({
      modelRef: primaryModelRef || undefined,
      provider: input.provider,
      model: input.model,
      defaultProvider: input.defaultProvider
    });
    add(primary);

    for (const fallbackEntry of normalizeArray(input.fallbacks)) {
      const fallback = this.#resolveFallbackCandidate(fallbackEntry);
      add(fallback);
    }

    if (candidates.length > 0 || input.autoFallbackProviders !== true) {
      return candidates;
    }

    const primaryRef = this.resolveDefaultModelRef(input.defaultProvider);
    if (!primaryRef) {
      return candidates;
    }
    add(this.#resolveCandidate({ modelRef: primaryRef }));
    for (const modelRef of this.listModelRefs({ configuredOnly: true }).map((entry) => entry.modelRef)) {
      add(this.#resolveCandidate({ modelRef }));
    }
    return candidates;
  }

  #resolveFallbackCandidate(entry) {
    if (typeof entry === "string") {
      return this.#resolveCandidate({ modelRef: entry });
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }
    return this.#resolveCandidate({
      modelRef: entry.modelRef,
      provider: entry.provider,
      model: entry.model
    });
  }

  #resolveCandidate(input = {}) {
    const explicitModelRef = String(input.modelRef ?? "").trim();
    const modelValue = String(input.model ?? "").trim();
    const shouldUseModelRef =
      Boolean(explicitModelRef) ||
      (!String(input.provider ?? "").trim() && modelValue.includes("/"));
    const inferredModelRef = shouldUseModelRef ? (explicitModelRef || modelValue).trim() : "";
    const parsed = this.#parseModelRef(inferredModelRef, input.defaultProvider);
    if (parsed) {
      const providerConfig = this.providers.get(parsed.provider);
      if (!providerConfig) {
        throw this.#badRequest(`Unsupported provider '${parsed.provider}'.`);
      }
      const model = String(parsed.model ?? "").trim() || providerConfig.defaultModel;
      if (!model) {
        throw this.#badRequest(`No model configured for provider '${providerConfig.id}'.`);
      }
      return {
        provider: providerConfig.id,
        model,
        modelRef: `${providerConfig.id}/${model}`
      };
    }

    const providerId = this.#normalizeProvider(input.provider ?? input.defaultProvider);
    if (!providerId) {
      return null;
    }
    const providerConfig = this.providers.get(providerId);
    if (!providerConfig) {
      throw this.#badRequest(`Unsupported provider '${providerId}'.`);
    }
    const model = String(input.model ?? providerConfig.defaultModel ?? "").trim();
    if (!model) {
      throw this.#badRequest(`No model configured for provider '${providerConfig.id}'.`);
    }
    return {
      provider: providerConfig.id,
      model,
      modelRef: `${providerConfig.id}/${model}`
    };
  }

  #parseModelRef(raw, fallbackProvider = "") {
    const trimmed = String(raw ?? "").trim();
    if (!trimmed) {
      return null;
    }
    const slash = trimmed.indexOf("/");
    if (slash === -1) {
      const provider = this.#normalizeProvider(fallbackProvider);
      if (!provider) {
        return null;
      }
      return {
        provider,
        model: trimmed
      };
    }
    const provider = this.#normalizeProvider(trimmed.slice(0, slash));
    const model = trimmed.slice(slash + 1).trim();
    if (!provider || !model) {
      return null;
    }
    return {
      provider,
      model
    };
  }

  #normalizeProvider(provider) {
    const normalized = String(provider ?? "")
      .trim()
      .toLowerCase();
    if (!normalized) {
      return "";
    }
    return this.providerAliases.get(normalized) ?? normalized;
  }

  #registerProvider(provider) {
    const id = String(provider.id ?? "")
      .trim()
      .toLowerCase();
    if (!id) {
      return;
    }
    const aliases = uniqueStrings([id, ...(provider.aliases ?? [])]);
    const normalized = {
      id,
      aliases,
      apiKey: String(provider.apiKey ?? "").trim(),
      defaultModel: String(provider.defaultModel ?? "").trim(),
      transport: String(provider.transport ?? "openai_compatible").trim(),
      baseUrl: String(provider.baseUrl ?? "").trim(),
      allowKeyless: provider.allowKeyless === true
    };
    this.providers.set(id, normalized);
    for (const alias of aliases) {
      this.providerAliases.set(alias, id);
    }
  }

  #resolveModelRefByTier(tier, preferredProvider = "") {
    const preferences = MODEL_TIER_PREFERENCES[tier];
    if (!Array.isArray(preferences) || preferences.length === 0) {
      return this.resolveDefaultModelRef(preferredProvider);
    }

    const configuredProviders = new Map();
    for (const entry of this.listProviders()) {
      if (entry.configured) {
        configuredProviders.set(entry.provider, entry);
      }
    }

    // If a preferred provider is specified and configured, check if it's in the tier preferences
    const preferred = this.#normalizeProvider(preferredProvider);
    if (preferred && configuredProviders.has(preferred)) {
      const tierPref = preferences.find((pref) => pref.provider === preferred);
      if (tierPref) {
        return `${preferred}/${tierPref.model}`;
      }
      // Not in tier preferences, but configured — use its default model
      const providerConfig = configuredProviders.get(preferred);
      if (providerConfig && providerConfig.defaultModel) {
        return `${preferred}/${providerConfig.defaultModel}`;
      }
    }

    // Walk the tier preference list and pick the first configured provider
    for (const pref of preferences) {
      if (configuredProviders.has(pref.provider)) {
        return `${pref.provider}/${pref.model}`;
      }
    }

    // No tier-specific provider is configured — fall back to default
    return this.resolveDefaultModelRef(preferredProvider);
  }

  async #dispatch(candidate, request) {
    const provider = this.providers.get(candidate.provider);
    if (!provider) {
      throw this.#badRequest(`Unsupported provider '${candidate.provider}'.`);
    }
    if (!this.#isProviderConfigured(provider)) {
      throw this.#badRequest(
        `Provider '${provider.id}' is not configured. Set the matching API key environment variable.`
      );
    }
    if (provider.transport === "anthropic") {
      return this.#callAnthropic({
        apiKey: provider.apiKey,
        model: candidate.model,
        ...request
      });
    }
    if (provider.transport === "gemini") {
      return this.#callGemini({
        apiKey: provider.apiKey,
        model: candidate.model,
        ...request
      });
    }
    if (provider.transport === "openai_compatible") {
      return this.#callOpenAiCompatible({
        provider: provider.id,
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        model: candidate.model,
        ...request
      });
    }
    throw this.#badRequest(`Unsupported provider transport '${provider.transport}'.`);
  }

  async #callOpenAiCompatible(input) {
    const baseUrl = String(input.baseUrl ?? "")
      .trim()
      .replace(/\/+$/g, "");
    if (!baseUrl) {
      throw this.#badRequest(
        `Provider '${input.provider}' requires a base URL. Set ${String(input.provider).toUpperCase()}_BASE_URL.`
      );
    }
    const headers = {
      "content-type": "application/json"
    };
    if (input.apiKey) {
      headers.authorization = `Bearer ${input.apiKey}`;
    }

    const userContent = [];
    if (input.imageUrl) {
      userContent.push({ type: "image_url", image_url: { url: input.imageUrl } });
    } else if (input.imagePath) {
      // Logic for local file relative to CWD
      const b64 = fs.readFileSync(path.resolve(process.cwd(), input.imagePath)).toString("base64");
      userContent.push({ type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } });
    }
    userContent.push({ type: "text", text: input.prompt });

    const payload = {
      model: input.model,
      messages: [
        ...(input.system ? [{ role: "system", content: input.system }] : []),
        { role: "user", content: userContent }
      ],
      temperature: input.temperature,
      max_tokens: input.maxTokens
    };
    
    // NVIDIA / DeepSeek Reasoning Template Kwargs
    if (input.provider === "nvidia" || String(input.model).includes("glm4.7")) {
       payload.chat_template_kwargs = { enable_thinking: true, clear_thinking: false };
    }

    const json = await this.#fetchJson(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    const messageObj = json?.choices?.[0]?.message;
    const content = messageObj?.content;
    let text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .map((item) =>
                typeof item === "string" ? item : String(item?.text ?? item?.content ?? "").trim()
              )
              .filter(Boolean)
              .join("\n")
          : "";
          
    if (messageObj?.reasoning_content && typeof messageObj.reasoning_content === "string") {
      text = `<thought>\n${messageObj.reasoning_content.trim()}\n</thought>\n\n${text}`;
    }

    if (!text.trim()) {
      throw this.#upstream(`${input.provider} response did not contain text content.`);
    }

    const rawUsage = json?.usage ?? null;
    let normalizedUsage = null;
    if (rawUsage) {
      normalizedUsage = {
        prompt_tokens: rawUsage.prompt_tokens,
        completion_tokens: rawUsage.completion_tokens,
        total_tokens: rawUsage.total_tokens,
        reasoning_tokens:
          rawUsage.completion_tokens_details?.reasoning_tokens ?? 
          rawUsage.reasoningTokens ?? 
          0
      };
    }

    return {
      provider: input.provider,
      model: input.model,
      text: text.trim(),
      usage: normalizedUsage
    };
  }

  async #callAnthropic(input) {
    const payload = {
      model: input.model,
      max_tokens: input.maxTokens,
      temperature: input.temperature,
      system: input.system || undefined,
      messages: [{ role: "user", content: input.prompt }]
    };

    const json = await this.#fetchJson("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(payload)
    });

    const blocks = Array.isArray(json?.content) ? json.content : [];
    const text = blocks
      .filter((block) => block && block.type === "text")
      .map((block) => String(block.text ?? "").trim())
      .filter(Boolean)
      .join("\n");

    if (!text) {
      throw this.#upstream("Anthropic response did not contain text content.");
    }
    return {
      provider: "anthropic",
      model: input.model,
      text,
      usage: json?.usage ?? null
    };
  }

  async #callGemini(input) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(input.apiKey)}`;
    const payload = {
      contents: [{ role: "user", parts: [{ text: input.prompt }] }],
      generationConfig: {
        temperature: input.temperature,
        maxOutputTokens: input.maxTokens
      }
    };
    if (input.system) {
      payload.systemInstruction = {
        role: "system",
        parts: [{ text: input.system }]
      };
    }

    const json = await this.#fetchJson(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const candidates = Array.isArray(json?.candidates) ? json.candidates : [];
    const text = candidates
      .flatMap((candidate) => {
        const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
        return parts.map((part) => String(part?.text ?? "").trim()).filter(Boolean);
      })
      .join("\n");

    if (!text) {
      throw this.#upstream("Gemini response did not contain text content.");
    }
    return {
      provider: "gemini",
      model: input.model,
      text,
      usage: json?.usageMetadata ?? null
    };
  }

  #isProviderConfigured(provider) {
    if (!provider) {
      return false;
    }
    if (provider.transport === "anthropic" || provider.transport === "gemini") {
      return Boolean(provider.apiKey);
    }
    if (provider.transport === "openai_compatible") {
      if (!provider.baseUrl) {
        return false;
      }
      if (provider.allowKeyless) {
        return true;
      }
      return Boolean(provider.apiKey);
    }
    return Boolean(provider.apiKey);
  }

  #estimateCostUsd(totalTokens) {
    const tokens = safeNumber(totalTokens, null);
    if (tokens === null || tokens <= 0 || this.costPer1kTokens <= 0) {
      return null;
    }
    return Number(((tokens / 1000) * this.costPer1kTokens).toFixed(6));
  }

  #observe(input = {}) {
    if (!this.observabilityService || typeof this.observabilityService.record !== "function") {
      return;
    }
    this.observabilityService.record({
      workspaceId: safeString(input.workspaceId, this.defaultWorkspaceId),
      source: safeString(input.source, "llm"),
      type: safeString(input.type, "llm.event"),
      level: safeString(input.level, "info"),
      message: safeString(input.message),
      payload: input.payload && typeof input.payload === "object" ? input.payload : {},
      traceId: safeString(input.traceId) || null,
      runId: safeString(input.runId) || null,
      missionId: safeString(input.missionId) || null,
      durationMs: Number.isFinite(Number(input.durationMs)) ? Number(input.durationMs) : null,
      tokenUsage: Number.isFinite(Number(input.tokenUsage)) ? Number(input.tokenUsage) : null,
      costUsd: Number.isFinite(Number(input.costUsd)) ? Number(input.costUsd) : null
    });
  }

  async #fetchJson(url, init) {
    const response = await withTimeout(this.timeoutMs, this.fetchFn(url, init));
    if (!response.ok) {
      const bodyText = await this.#safeReadText(response);
      const error = new Error(`LLM upstream error (${response.status}): ${bodyText || "no body"}`);
      error.statusCode = response.status >= 400 && response.status < 600 ? response.status : 502;
      throw error;
    }
    return response.json();
  }

  async #safeReadText(response) {
    try {
      return await response.text();
    } catch {
      return "";
    }
  }

  #badRequest(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
  }

  #upstream(message) {
    const error = new Error(message);
    error.statusCode = 502;
    return error;
  }
}
