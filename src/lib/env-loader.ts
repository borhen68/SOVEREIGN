// @ts-nocheck
import fs from "node:fs";
import path from "node:path";

function parseEnvValue(raw) {
  const value = String(raw ?? "").trim();
  if (!value) {
    return "";
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    const inner = value.slice(1, -1);
    if (value.startsWith('"')) {
      return inner.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t");
    }
    return inner;
  }
  return value.replace(/\s+#.*$/, "").trim();
}

export function loadEnvFile(options = {}) {
  if (process.env.SOVEREIGN_DISABLE_ENV_AUTOLOAD === "true") {
    return {
      path: null,
      loaded: false,
      keysLoaded: 0
    };
  }

  const cwd = options.cwd ?? process.cwd();
  const envPath = options.path ?? path.join(cwd, ".env");
  if (!fs.existsSync(envPath)) {
    return {
      path: envPath,
      loaded: false,
      keysLoaded: 0
    };
  }

  const raw = fs.readFileSync(envPath, "utf8");
  let keysLoaded = 0;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = String(line ?? "").trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const normalized = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trim()
      : trimmed;
    const eq = normalized.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = normalized.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    if (process.env[key] !== undefined) {
      continue;
    }
    const value = parseEnvValue(normalized.slice(eq + 1));
    process.env[key] = value;
    keysLoaded += 1;
  }

  return {
    path: envPath,
    loaded: true,
    keysLoaded
  };
}
