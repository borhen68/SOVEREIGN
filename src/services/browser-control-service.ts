// @ts-nocheck
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { nowIso } from "../lib/time.js";
import { wsJsonRequest } from "../lib/websocket-client.js";

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

function parseCsv(input) {
  const value = safeString(input);
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((item) => safeString(item).toLowerCase())
    .filter(Boolean);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return response.json();
}

export class BrowserControlService {
  constructor(options = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.enabled = options.enabled ?? process.env.BROWSER_CONTROL_ENABLED !== "false";
    this.debuggingPort = clampInt(
      options.debuggingPort ?? process.env.BROWSER_CDP_PORT,
      9222,
      1024,
      65535
    );
    this.headless = options.headless ?? process.env.BROWSER_HEADLESS === "true";
    this.launchTimeoutMs = clampInt(
      options.launchTimeoutMs ?? process.env.BROWSER_LAUNCH_TIMEOUT_MS,
      10000,
      1000,
      120000
    );
    this.allowedDomains = parseCsv(options.allowedDomains ?? process.env.BROWSER_ALLOWLIST_DOMAINS);
    this.profileDir = path.resolve(
      options.profileDir ?? process.env.BROWSER_PROFILE_DIR ?? path.join(this.cwd, ".data", "browser-profile")
    );
    this.binaryPath = this.#resolveBinary(options.binaryPath ?? process.env.BROWSER_CHROME_PATH);
    this.process = null;
    this.startedAt = null;
    this.lastError = null;
  }

  isEnabled() {
    return Boolean(this.enabled);
  }

  getStatus() {
    return {
      enabled: this.isEnabled(),
      running: Boolean(this.process && !this.process.killed),
      binaryPath: this.binaryPath,
      debuggingPort: this.debuggingPort,
      wsBase: `ws://127.0.0.1:${this.debuggingPort}`,
      httpBase: `http://127.0.0.1:${this.debuggingPort}`,
      headless: this.headless,
      startedAt: this.startedAt,
      pid: this.process?.pid ?? null,
      profileDir: this.profileDir,
      allowlistDomains: this.allowedDomains,
      lastError: this.lastError
    };
  }

  async start() {
    if (!this.isEnabled()) {
      throw this.#badRequest("Browser control is disabled.");
    }
    if (this.process && !this.process.killed) {
      return this.getStatus();
    }
    if (!this.binaryPath) {
      throw this.#badRequest(
        "No Chrome/Chromium binary found. Set BROWSER_CHROME_PATH to enable browser control."
      );
    }

    fs.mkdirSync(this.profileDir, { recursive: true });
    const args = [
      `--remote-debugging-port=${this.debuggingPort}`,
      `--user-data-dir=${this.profileDir}`,
      "--no-first-run",
      "--no-default-browser-check"
    ];
    if (this.headless) {
      args.push("--headless=new");
    }
    args.push("about:blank");

    const child = spawn(this.binaryPath, args, {
      stdio: "ignore",
      detached: false
    });
    this.process = child;
    this.startedAt = nowIso();
    this.lastError = null;
    child.on("exit", (code, signal) => {
      if (code !== 0 && code !== null) {
        this.lastError = `Browser exited with code ${code} signal ${signal ?? "none"}.`;
      }
      this.process = null;
    });
    child.on("error", (error) => {
      this.lastError = error instanceof Error ? error.message : String(error);
    });
    child.unref?.();

    await this.#waitForDevtools();
    return this.getStatus();
  }

  async stop() {
    if (!this.process || this.process.killed) {
      return this.getStatus();
    }
    try {
      this.process.kill("SIGTERM");
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
    this.process = null;
    return this.getStatus();
  }

  async ensureRunning() {
    if (this.process && !this.process.killed) {
      return this.getStatus();
    }
    return this.start();
  }

  async listTargets() {
    await this.ensureRunning();
    return fetchJson(`http://127.0.0.1:${this.debuggingPort}/json/list`);
  }

  async openUrl(input = {}) {
    const url = safeString(input.url ?? input.targetUrl);
    if (!url) {
      throw this.#badRequest("url is required.");
    }
    this.#validateAllowedDomain(url);
    await this.ensureRunning();

    const endpoint = `http://127.0.0.1:${this.debuggingPort}/json/new?${encodeURIComponent(url)}`;
    try {
      return await fetchJson(endpoint, { method: "PUT" });
    } catch {
      // Some Chrome builds accept GET instead of PUT.
      return fetchJson(endpoint, { method: "GET" });
    }
  }

  async runCdpCommand(input = {}) {
    const targetId = safeString(input.targetId);
    const method = safeString(input.method);
    if (!targetId || !method) {
      throw this.#badRequest("targetId and method are required for CDP command.");
    }
    const targets = await this.listTargets();
    const target = (targets ?? []).find((item) => item?.id === targetId);
    if (!target?.webSocketDebuggerUrl) {
      throw this.#notFound("CDP target not found.");
    }
    const timeoutMs = clampInt(input.timeoutMs, 10000, 1000, 120000);
    const params = input.params && typeof input.params === "object" ? input.params : {};
    const requestId = Date.now();
    const response = await wsJsonRequest(
      target.webSocketDebuggerUrl,
      {
        id: requestId,
        method,
        params
      },
      {
        timeoutMs,
        matcher: (message) => message?.id === requestId
      }
    );
    if (response?.error) {
      throw new Error(response.error?.message ?? "CDP command failed.");
    }
    return response?.result ?? {};
  }

  #resolveBinary(explicitPath) {
    const explicit = safeString(explicitPath);
    if (explicit && fs.existsSync(explicit)) {
      return explicit;
    }
    const candidates = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium"
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
  }

  async #waitForDevtools() {
    const start = Date.now();
    let lastError = null;
    while (Date.now() - start < this.launchTimeoutMs) {
      try {
        await fetchJson(`http://127.0.0.1:${this.debuggingPort}/json/version`);
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    throw new Error(
      `Browser DevTools did not become ready. Last error: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }

  #validateAllowedDomain(rawUrl) {
    if (this.allowedDomains.length === 0) {
      return;
    }
    let host = "";
    try {
      const parsed = new URL(rawUrl);
      host = safeString(parsed.hostname).toLowerCase();
    } catch {
      throw this.#badRequest("Invalid URL.");
    }
    const allowed = this.allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
    if (!allowed) {
      throw this.#badRequest(
        `URL host '${host}' is not in BROWSER_ALLOWLIST_DOMAINS.`
      );
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
}
