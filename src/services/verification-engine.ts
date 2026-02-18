// @ts-nocheck
function scoreSource(source) {
  const type = source.type ?? "web";
  const baseByType = {
    primary: 0.95,
    academic: 0.9,
    government: 0.9,
    web: 0.7,
    social: 0.45
  };
  return baseByType[type] ?? 0.6;
}

function recencyBoost(isoDate) {
  if (!isoDate) {
    return 0;
  }
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return 0;
  }
  const days = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
  if (days <= 7) {
    return 0.08;
  }
  if (days <= 30) {
    return 0.04;
  }
  if (days <= 365) {
    return 0.01;
  }
  return -0.04;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export class VerificationEngine {
  verifyClaim(input) {
    const claim = String(input.claim ?? "").trim();
    const sources = Array.isArray(input.sources) ? input.sources : [];

    if (!claim) {
      return {
        claim,
        verdict: "invalid",
        confidence: 0,
        confidenceLabel: "0% verified",
        summary: "Claim is required.",
        contradictionCount: 0,
        supportCount: 0
      };
    }

    if (sources.length === 0) {
      return {
        claim,
        verdict: "insufficient",
        confidence: 0.2,
        confidenceLabel: "20% verified",
        summary: "No sources provided. Add at least two independent sources.",
        contradictionCount: 0,
        supportCount: 0
      };
    }

    let weightedSupport = 0;
    let weightedContradiction = 0;
    let supportCount = 0;
    let contradictionCount = 0;

    for (const source of sources) {
      const weight = clamp(scoreSource(source) + recencyBoost(source.publishedAt), 0.1, 1);
      const stance = source.stance === "contradict" ? "contradict" : "support";
      if (stance === "support") {
        weightedSupport += weight;
        supportCount += 1;
      } else {
        weightedContradiction += weight;
        contradictionCount += 1;
      }
    }

    const total = weightedSupport + weightedContradiction;
    const rawConfidence = total === 0 ? 0.2 : weightedSupport / total;
    const confidence = clamp(rawConfidence, 0, 1);
    const confidencePct = Math.round(confidence * 100);

    let verdict = "verified";
    if (contradictionCount > 0 && confidencePct < 80) {
      verdict = "contested";
    } else if (confidencePct < 60) {
      verdict = "insufficient";
    }

    return {
      claim,
      verdict,
      confidence,
      confidenceLabel: `${confidencePct}% verified`,
      summary: this.#summary(verdict, supportCount, contradictionCount),
      contradictionCount,
      supportCount
    };
  }

  #summary(verdict, supportCount, contradictionCount) {
    if (verdict === "verified") {
      return `Claim is supported by ${supportCount} source(s) with limited contradiction evidence.`;
    }
    if (verdict === "contested") {
      return `Claim is contested: ${supportCount} supporting vs ${contradictionCount} contradicting source(s).`;
    }
    return "Evidence is insufficient for a reliable conclusion.";
  }
}
