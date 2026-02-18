// @ts-nocheck
import { makeId } from "../lib/id.js";
import { nowIso } from "../lib/time.js";

function safeString(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function clampInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function gradeFromScore(score) {
  if (score >= 0.9) {
    return "A";
  }
  if (score >= 0.8) {
    return "B";
  }
  if (score >= 0.65) {
    return "C";
  }
  if (score >= 0.5) {
    return "D";
  }
  return "F";
}

function extractJsonObject(text) {
  const raw = safeString(text);
  if (!raw) {
    return null;
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function mapVerificationScore(verification) {
  const verdict = safeString(verification?.verdict, "insufficient").toLowerCase();
  if (verdict === "verified") {
    return 1;
  }
  if (verdict === "contested") {
    return 0.45;
  }
  if (verdict === "insufficient") {
    return 0.3;
  }
  return 0;
}

function normalizeRecommendations(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const item of input) {
    const value = safeString(item);
    if (!value) {
      continue;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(value);
    if (out.length >= 8) {
      break;
    }
  }
  return out;
}

export class EvaluationService {
  constructor(options = {}) {
    this.llmService = options.llmService ?? null;
    this.observabilityService = options.observabilityService ?? null;
  }

  async evaluateCompanyRun(input = {}) {
    const run = input.run && typeof input.run === "object" ? input.run : null;
    const runId = safeString(input.runId, safeString(run?.id));
    const workspaceId = safeString(input.workspaceId, safeString(run?.workspaceId, "default"));
    const objective = safeString(input.objective, safeString(run?.objective));
    const verification = input.verification ?? run?.verification ?? null;
    const executionResults = Array.isArray(input.executionResults)
      ? input.executionResults
      : Array.isArray(run?.result?.executionResults)
        ? run.result.executionResults
        : [];
    const passThreshold = clampNumber(input.passThreshold, 0.62, 0, 1);
    const traceId = safeString(input.traceId) || null;

    const heuristics = this.#heuristicEvaluation({
      objective,
      executionResults,
      verification
    });

    let llmJudge = null;
    const shouldUseLlmJudge = input.useLlmJudge !== false;
    if (shouldUseLlmJudge) {
      llmJudge = await this.#llmJudge({
        objective,
        executionResults,
        verification,
        summary: safeString(input.summary, safeString(run?.summary)),
        modelRef: safeString(input.modelRef),
        provider: safeString(input.provider)
      });
    }

    const llmScore = Number.isFinite(Number(llmJudge?.score)) ? Number(llmJudge.score) : null;
    const score = Number(
      (
        llmScore === null
          ? heuristics.score
          : clampNumber(heuristics.score * 0.75 + llmScore * 0.25, heuristics.score, 0, 1)
      ).toFixed(4)
    );
    const grade = safeString(llmJudge?.grade, gradeFromScore(score));
    const passed = score >= passThreshold;

    const recommendations = normalizeRecommendations([
      ...(Array.isArray(heuristics.recommendations) ? heuristics.recommendations : []),
      ...(Array.isArray(llmJudge?.recommendations) ? llmJudge.recommendations : [])
    ]);

    const evaluation = {
      id: makeId("eval"),
      runId: runId || null,
      workspaceId,
      objective,
      score,
      grade,
      passed,
      passThreshold,
      mode: llmScore === null ? "heuristic" : "hybrid",
      rationale: safeString(llmJudge?.rationale, heuristics.rationale),
      recommendations,
      heuristics,
      llmJudge: llmJudge
        ? {
            modelRef: llmJudge.modelRef ?? null,
            score: llmScore,
            grade: llmJudge.grade ?? null,
            rationale: llmJudge.rationale ?? "",
            recommendations: llmJudge.recommendations ?? [],
            error: llmJudge.error ?? null
          }
        : null,
      createdAt: nowIso()
    };

    if (this.observabilityService && typeof this.observabilityService.recordEval === "function") {
      this.observabilityService.recordEval({
        workspaceId,
        runId: runId || null,
        traceId,
        score: evaluation.score,
        grade: evaluation.grade,
        passed: evaluation.passed,
        rationale: evaluation.rationale,
        recommendations: evaluation.recommendations,
        modelRef: evaluation.llmJudge?.modelRef ?? null,
        mode: evaluation.mode
      });
    }

    return evaluation;
  }

  #heuristicEvaluation(input = {}) {
    const executionResults = Array.isArray(input.executionResults) ? input.executionResults : [];
    const total = executionResults.length;
    const successCount = executionResults.filter((item) => item?.success).length;
    const failureCount = Math.max(0, total - successCount);
    const successRate = total === 0 ? 0 : successCount / total;
    const verificationScore = mapVerificationScore(input.verification);

    const consensusValues = executionResults
      .map((item) => Number(item?.consensus))
      .filter((value) => Number.isFinite(value) && value >= 0);
    const consensusScore =
      consensusValues.length === 0
        ? 0.5
        : consensusValues.reduce((sum, value) => sum + value, 0) / consensusValues.length;

    const score = clampNumber(
      0.55 * successRate + 0.35 * verificationScore + 0.1 * clampNumber(consensusScore, 0, 0, 1),
      0,
      0,
      1
    );
    const recommendations = [];
    if (total === 0) {
      recommendations.push("Break the objective into explicit workstreams before execution.");
    }
    if (failureCount > 0) {
      recommendations.push("Add retries, narrower tasks, or human checkpoints for failed workstreams.");
    }
    if (verificationScore < 0.6) {
      recommendations.push("Improve verification quality with stronger and independent evidence.");
    }
    if (consensusScore < 0.6) {
      recommendations.push("Increase debate depth between sub-agents before final synthesis.");
    }
    if (recommendations.length === 0) {
      recommendations.push("Promote this execution recipe to a reusable company playbook.");
    }

    return {
      score: Number(score.toFixed(4)),
      grade: gradeFromScore(score),
      successRate: Number(successRate.toFixed(4)),
      verificationScore: Number(verificationScore.toFixed(4)),
      consensusScore: Number(clampNumber(consensusScore, 0.5, 0, 1).toFixed(4)),
      totalWorkstreams: total,
      successCount,
      failureCount,
      rationale: `Heuristic quality score from success (${successCount}/${total || 0}), verification (${safeString(input.verification?.verdict, "none")}), and council consensus.`,
      recommendations
    };
  }

  async #llmJudge(input = {}) {
    if (!this.llmService || typeof this.llmService.respond !== "function") {
      return null;
    }
    const configuredProviders =
      typeof this.llmService.listProviders === "function"
        ? this.llmService.listProviders().filter((provider) => provider.configured)
        : [];
    if (configuredProviders.length === 0) {
      return null;
    }

    let modelRef = safeString(input.modelRef);
    if (!modelRef && typeof this.llmService.resolveDefaultModelRef === "function") {
      modelRef = safeString(this.llmService.resolveDefaultModelRef(safeString(input.provider)));
    }
    if (!modelRef) {
      return null;
    }

    const payload = {
      objective: safeString(input.objective),
      summary: safeString(input.summary),
      verification: input.verification ?? null,
      executionResults: Array.isArray(input.executionResults)
        ? input.executionResults.slice(0, clampInt(input.maxWorkstreams, 8, 1, 20))
        : []
    };

    const system = [
      "You are a strict enterprise evaluator for autonomous AI runs.",
      "Return ONLY JSON with keys: score, grade, rationale, recommendations.",
      "score must be a number from 0 to 1. grade must be one of A,B,C,D,F.",
      "recommendations must be a short array of actionable strings."
    ].join(" ");
    const prompt = `Evaluate this company run quality:\n${JSON.stringify(payload, null, 2)}`;

    try {
      const completion = await this.llmService.respond({
        modelRef,
        system,
        prompt,
        temperature: 0,
        maxTokens: 350
      });
      const parsed = extractJsonObject(completion.text);
      if (!parsed) {
        return {
          modelRef,
          error: "LLM judge did not return valid JSON."
        };
      }
      const score = clampNumber(parsed.score, NaN, 0, 1);
      if (!Number.isFinite(score)) {
        return {
          modelRef,
          error: "LLM judge score is missing or invalid."
        };
      }
      const grade = safeString(parsed.grade, gradeFromScore(score)).toUpperCase();
      return {
        modelRef,
        score: Number(score.toFixed(4)),
        grade: ["A", "B", "C", "D", "F"].includes(grade) ? grade : gradeFromScore(score),
        rationale: safeString(parsed.rationale),
        recommendations: normalizeRecommendations(parsed.recommendations)
      };
    } catch (error) {
      return {
        modelRef,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
