// @ts-nocheck
let initialized = false;

function parseBool(value, fallback = false) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export async function initializeTracing(options = {}) {
  if (initialized) {
    return {
      initialized: true,
      skipped: true,
      reason: "already_initialized"
    };
  }
  const disabled = parseBool(options.disabled ?? process.env.TRACELOOP_DISABLED, false);
  if (disabled) {
    return {
      initialized: false,
      skipped: true,
      reason: "disabled"
    };
  }

  try {
    const traceloop = await import("@traceloop/node-server-sdk");
    traceloop.initialize({
      disableBatch: true
    });
    initialized = true;
    return {
      initialized: true,
      skipped: false
    };
  } catch (error) {
    if (parseBool(options.strict ?? process.env.TRACELOOP_STRICT, false)) {
      throw error;
    }
    return {
      initialized: false,
      skipped: true,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

