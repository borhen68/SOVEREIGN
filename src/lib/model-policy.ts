// @ts-nocheck
function normalizeString(value) {
  return String(value ?? "").trim();
}

function normalizeModelRef(value) {
  return normalizeString(value);
}

export function normalizeModelRefList(input, options = {}) {
  const splitCommas = options.splitCommas !== false;
  if (Array.isArray(input)) {
    return input.map((item) => normalizeModelRef(item)).filter(Boolean);
  }
  const value = normalizeModelRef(input);
  if (!value) {
    return [];
  }
  if (!splitCommas) {
    return [value];
  }
  return value
    .split(",")
    .map((item) => normalizeModelRef(item))
    .filter(Boolean);
}

function dedupeModelRefs(values, primary = "") {
  const seen = new Set();
  const out = [];
  const primaryKey = normalizeModelRef(primary).toLowerCase();
  for (const value of values) {
    const normalized = normalizeModelRef(value);
    const key = normalized.toLowerCase();
    if (!normalized || key === primaryKey || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function resolvePrimaryFromObject(input) {
  const primary = normalizeModelRef(input.primary ?? input.modelRef);
  if (primary) {
    return primary;
  }

  const provider = normalizeModelRef(input.provider);
  const model = normalizeModelRef(input.model);
  if (provider && model && !model.includes("/")) {
    return `${provider}/${model}`;
  }
  if (model.includes("/")) {
    return model;
  }
  return "";
}

export function normalizeModelPolicy(input) {
  let primary = "";
  let fallbacks = [];

  if (typeof input === "string") {
    primary = normalizeModelRef(input);
  } else if (input && typeof input === "object" && !Array.isArray(input)) {
    primary = resolvePrimaryFromObject(input);
    fallbacks = normalizeModelRefList(input.fallbacks ?? input.fallback ?? [], {
      splitCommas: true
    });
  }

  return {
    primary,
    fallbacks: dedupeModelRefs(fallbacks, primary)
  };
}
