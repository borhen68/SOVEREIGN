// @ts-nocheck
import { spawn } from "node:child_process";
import { nowIso } from "../lib/time.js";

const VALID_MODES = new Set(["off", "serve", "funnel"]);

function safeString(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function toBool(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(text);
}

export class TailscaleExposureService {
  constructor(options = {}) {
    this.gatewayBind = safeString(options.gatewayBind ?? process.env.GATEWAY_BIND, "127.0.0.1");
    this.gatewayPort = Number(options.gatewayPort ?? process.env.PORT ?? 3001);
    this.mode = this.#normalizeMode(options.mode ?? process.env.GATEWAY_TAILSCALE_MODE);
    this.authMode = safeString(options.authMode ?? process.env.GATEWAY_AUTH_MODE, "password").toLowerCase();
    this.allowTailscaleHeaders = toBool(
      options.allowTailscaleHeaders ?? process.env.GATEWAY_AUTH_ALLOW_TAILSCALE,
      true
    );
    this.resetOnExit = toBool(
      options.resetOnExit ?? process.env.GATEWAY_TAILSCALE_RESET_ON_EXIT,
      false
    );
    this.automationEnabled = toBool(
      options.automationEnabled ?? process.env.GATEWAY_TAILSCALE_AUTOMATION,
      false
    );
    this.lastApplied = null;
    this.lastError = null;
  }

  getStatus() {
    return {
      gatewayBind: this.gatewayBind,
      gatewayPort: this.gatewayPort,
      mode: this.mode,
      authMode: this.authMode,
      allowTailscaleHeaders: this.allowTailscaleHeaders,
      resetOnExit: this.resetOnExit,
      automationEnabled: this.automationEnabled,
      lastApplied: this.lastApplied,
      lastError: this.lastError
    };
  }

  plan(input = {}) {
    const mode = this.#normalizeMode(input.mode ?? this.mode);
    const bind = safeString(input.gatewayBind ?? this.gatewayBind, this.gatewayBind);
    const port = Number(input.gatewayPort ?? this.gatewayPort);
    const authMode = safeString(input.authMode ?? this.authMode, this.authMode).toLowerCase();
    const allowTailscaleHeaders = toBool(
      input.allowTailscaleHeaders ?? this.allowTailscaleHeaders,
      this.allowTailscaleHeaders
    );

    if (mode !== "off" && !this.#isLoopback(bind)) {
      throw this.#badRequest(
        `gateway.bind must stay loopback for mode '${mode}'. Received '${bind}'.`
      );
    }
    if (mode === "funnel" && authMode !== "password") {
      throw this.#badRequest("Funnel mode requires gateway authMode=password.");
    }

    const base = `http://${bind}:${port}`;
    const commands = [];
    if (mode === "serve") {
      commands.push({
        cmd: ["tailscale", "serve", "--bg", "--https=443", "/", base],
        note: allowTailscaleHeaders
          ? "Tailnet-only HTTPS with Tailscale identity headers."
          : "Tailnet-only HTTPS without trusted Tailscale headers."
      });
    }
    if (mode === "funnel") {
      commands.push({
        cmd: ["tailscale", "funnel", "--bg", "443", base],
        note: "Public HTTPS funnel. Password auth should be enabled."
      });
    }
    if (mode === "off") {
      commands.push({
        cmd: ["tailscale", "serve", "reset"],
        note: "Disable active serve/funnel exposure."
      });
    }

    return {
      mode,
      gatewayBind: bind,
      gatewayPort: port,
      authMode,
      allowTailscaleHeaders,
      commands
    };
  }

  async apply(input = {}) {
    const plan = this.plan(input);
    if (!this.automationEnabled) {
      return {
        applied: false,
        reason: "automation_disabled",
        plan
      };
    }

    const results = [];
    for (const command of plan.commands) {
      const result = await this.#exec(command.cmd);
      results.push(result);
    }
    this.mode = plan.mode;
    this.gatewayBind = plan.gatewayBind;
    this.gatewayPort = plan.gatewayPort;
    this.authMode = plan.authMode;
    this.allowTailscaleHeaders = plan.allowTailscaleHeaders;
    this.lastApplied = nowIso();
    this.lastError = null;
    return {
      applied: true,
      plan,
      results
    };
  }

  async shutdown() {
    if (!this.resetOnExit || !this.automationEnabled) {
      return {
        reset: false
      };
    }
    try {
      const result = await this.#exec(["tailscale", "serve", "reset"]);
      return {
        reset: true,
        result
      };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return {
        reset: false,
        error: this.lastError
      };
    }
  }

  #normalizeMode(value) {
    const normalized = safeString(value, "off").toLowerCase();
    if (!VALID_MODES.has(normalized)) {
      return "off";
    }
    return normalized;
  }

  #isLoopback(bind) {
    const normalized = safeString(bind).toLowerCase();
    return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
  }

  async #exec(command) {
    const [bin, ...args] = command;
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, {
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk ?? "");
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk ?? "");
      });
      child.on("error", reject);
      child.on("exit", (code, signal) => {
        if ((code ?? 0) !== 0) {
          reject(
            new Error(
              `tailscale command failed (${bin} ${args.join(" ")}): code=${code} signal=${
                signal ?? "none"
              } stderr=${stderr}`
            )
          );
          return;
        }
        resolve({
          command: [bin, ...args],
          code: code ?? 0,
          signal: signal ?? null,
          stdout,
          stderr
        });
      });
    });
  }

  #badRequest(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
  }
}
