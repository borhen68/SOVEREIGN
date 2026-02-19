// @ts-nocheck
import os from "node:os";
import process from "node:process";
import { spawn } from "node:child_process";
import { MinimalWebSocketClient } from "../lib/websocket-client.js";
import { nowIso } from "../lib/time.js";

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

function parseCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => safeString(item))
    .filter(Boolean);
}

function toBool(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = safeString(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(normalized);
}

class MacOsCompanionNode {
  constructor(options = {}) {
    const port = Number(options.port ?? process.env.PORT ?? 3001);
    this.bridgeUrl = safeString(
      options.bridgeUrl ?? process.env.BRIDGE_URL,
      `ws://127.0.0.1:${port}/bridge/ws`
    );
    this.bridgeToken = safeString(
      options.bridgeToken ?? process.env.COMPANION_BRIDGE_TOKEN ?? process.env.DEVICE_BRIDGE_TOKEN
    );
    this.nodeId = safeString(options.nodeId ?? process.env.COMPANION_NODE_ID, `macos-${os.hostname()}`);
    this.nodeName = safeString(options.nodeName ?? process.env.COMPANION_NODE_NAME, os.hostname());
    this.reconnectDelayMs = clampInt(
      options.reconnectDelayMs ?? process.env.COMPANION_RECONNECT_MS,
      2000,
      250,
      120000
    );
    this.heartbeatMs = clampInt(
      options.heartbeatMs ?? process.env.COMPANION_HEARTBEAT_MS,
      10000,
      1000,
      120000
    );
    this.enableSystemRun = toBool(
      options.enableSystemRun ?? process.env.COMPANION_SYSTEM_RUN_ENABLED,
      false
    );
    this.enableShellCommand = toBool(
      options.enableShellCommand ?? process.env.COMPANION_SYSTEM_SHELL_ENABLED,
      false
    );
    this.commandAllowlist = parseCsv(
      options.commandAllowlist ?? process.env.COMPANION_SYSTEM_RUN_ALLOWLIST
    );
    this.commandTimeoutMs = clampInt(
      options.commandTimeoutMs ?? process.env.COMPANION_SYSTEM_RUN_TIMEOUT_MS,
      20000,
      1000,
      300000
    );
    this.maxOutputChars = clampInt(
      options.maxOutputChars ?? process.env.COMPANION_SYSTEM_RUN_MAX_OUTPUT,
      20000,
      256,
      1_000_000
    );

    this.running = false;
    this.client = null;
    this.heartbeatTimer = null;
  }

  async start() {
    this.running = true;
    while (this.running) {
      try {
        await this.#connectAndRun();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(`[companion] bridge error: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!this.running) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, this.reconnectDelayMs));
    }
  }

  stop() {
    this.running = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }

  async #connectAndRun() {
    const client = new MinimalWebSocketClient({
      url: this.bridgeUrl,
      connectTimeoutMs: 10000
    });
    this.client = client;
    await client.connect();
    // eslint-disable-next-line no-console
    console.log(`[companion] connected to ${this.bridgeUrl}`);

    await this.#register(client);
    this.#startHeartbeat(client);

    await new Promise((resolve) => {
      const onClose = () => {
        client.off("json", onJson);
        client.off("close", onClose);
        client.off("error", onError);
        if (this.heartbeatTimer) {
          clearInterval(this.heartbeatTimer);
          this.heartbeatTimer = null;
        }
        resolve(null);
      };
      const onError = () => onClose();
      const onJson = (message) => {
        this.#onBridgeMessage(client, message).catch((error) => {
          // eslint-disable-next-line no-console
          console.error(`[companion] message error: ${error instanceof Error ? error.message : String(error)}`);
        });
      };
      client.on("json", onJson);
      client.on("close", onClose);
      client.on("error", onError);
    });
  }

  async #register(client) {
    const requestId = `register-${Date.now()}`;
    const response = await client.request(
      {
        id: requestId,
        method: "bridge.register",
        params: {
          token: this.bridgeToken || undefined,
          node: {
            id: this.nodeId,
            name: this.nodeName,
            type: "macos",
            platform: `${process.platform}-${os.arch()}`,
            status: "online",
            capabilities: [
              "system.run",
              "system.notify",
              "location.get",
              "camera.snap",
              "camera.clip",
              "screen.record"
            ],
            permissionMap: {
              "system.run": this.enableSystemRun ? "granted" : "disabled",
              "system.notify": process.platform === "darwin" ? "available" : "limited",
              "camera.snap": "scaffolded",
              "camera.clip": "scaffolded",
              "screen.record": "scaffolded",
              "location.get": "configurable"
            },
            metadata: {
              runtime: "sovereign-companion-macos",
              pid: process.pid,
              startedAt: nowIso()
            }
          }
        }
      },
      {
        timeoutMs: 15000,
        matcher: (message) => message?.id === requestId
      }
    );

    if (safeString(response?.type).toLowerCase() === "error") {
      throw new Error(safeString(response?.error, "bridge.register failed"));
    }
    // eslint-disable-next-line no-console
    console.log(`[companion] registered node '${this.nodeId}'`);
  }

  #startHeartbeat(client) {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    this.heartbeatTimer = setInterval(() => {
      try {
        client.sendJson({
          method: "bridge.heartbeat",
          params: {
            nodeId: this.nodeId,
            status: "online",
            heartbeat: {
              now: nowIso(),
              uptimeSeconds: Math.floor(process.uptime())
            }
          }
        });
      } catch { }
    }, this.heartbeatMs);
  }

  async #onBridgeMessage(client, message) {
    if (!message || typeof message !== "object") {
      return;
    }
    const method = safeString(message.method);
    if (method !== "bridge.invoke") {
      return;
    }
    const requestId = safeString(message.id);
    const params = message.params && typeof message.params === "object" ? message.params : {};
    try {
      const result = await this.#invokeAction(params.action, params.input ?? {});
      client.sendJson({
        type: "result",
        id: requestId,
        result
      });
    } catch (error) {
      client.sendJson({
        type: "error",
        id: requestId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async #invokeAction(actionInput, payloadInput) {
    const action = safeString(actionInput).toLowerCase();
    const payload = payloadInput && typeof payloadInput === "object" ? payloadInput : {};
    if (!action) {
      throw new Error("action is required.");
    }
    if (action === "system.run") {
      return this.#runCommand(payload);
    }
    if (action === "system.notify" || action === "notifications.send") {
      return this.#sendNotification(payload);
    }
    if (action === "location.get") {
      return {
        available: Boolean(process.env.NODE_LOCATION_LAT && process.env.NODE_LOCATION_LON),
        lat: safeString(process.env.NODE_LOCATION_LAT) || null,
        lon: safeString(process.env.NODE_LOCATION_LON) || null,
        source: process.env.NODE_LOCATION_SOURCE ?? null
      };
    }
    if (action === "camera.snap" || action === "camera.clip" || action === "screen.record") {
      return {
        implemented: false,
        message:
          "Native media capture handlers are scaffolded in companion runtime but require dedicated device APIs."
      };
    }
    throw new Error(`Unsupported companion action '${action}'.`);
  }

  async #runCommand(payload) {
    if (!this.enableSystemRun) {
      throw new Error("system.run disabled. Set COMPANION_SYSTEM_RUN_ENABLED=true.");
    }
    const command = safeString(payload.command);
    const args = Array.isArray(payload.args) ? payload.args.map((item) => String(item)) : [];
    const shellCommand = safeString(payload.shellCommand);
    if (!command && !shellCommand) {
      throw new Error("Provide command or shellCommand.");
    }
    if (shellCommand && !this.enableShellCommand) {
      throw new Error("shellCommand disabled. Set COMPANION_SYSTEM_SHELL_ENABLED=true.");
    }

    const baseCommand = command || safeString(shellCommand.split(/\s+/)[0]);
    this.#assertAllowedCommand(baseCommand);
    const timeoutMs = clampInt(payload.timeoutMs, this.commandTimeoutMs, 1000, 300000);
    const cwd = safeString(payload.cwd) || process.cwd();
    const startedAtMs = Date.now();

    const result = await new Promise((resolve, reject) => {
      const child = shellCommand
        ? spawn(shellCommand, {
          cwd,
          env: process.env,
          shell: true
        })
        : spawn(command, args, {
          cwd,
          env: process.env,
          shell: false
        });

      let stdout = "";
      let stderr = "";
      let finished = false;
      const timer = setTimeout(() => {
        if (finished) {
          return;
        }
        finished = true;
        try {
          child.kill("SIGTERM");
        } catch { }
        reject(new Error(`system.run timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk ?? "");
        if (stdout.length > this.maxOutputChars) {
          stdout = stdout.slice(stdout.length - this.maxOutputChars);
        }
      });
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk ?? "");
        if (stderr.length > this.maxOutputChars) {
          stderr = stderr.slice(stderr.length - this.maxOutputChars);
        }
      });
      child.on("error", (error) => {
        if (finished) {
          return;
        }
        finished = true;
        clearTimeout(timer);
        reject(error);
      });
      child.on("exit", (code, signal) => {
        if (finished) {
          return;
        }
        finished = true;
        clearTimeout(timer);
        resolve({
          code: code ?? 0,
          signal: signal ?? null,
          stdout,
          stderr
        });
      });
    });

    return {
      ...result,
      durationMs: Date.now() - startedAtMs
    };
  }

  async #sendNotification(payload) {
    const title = safeString(payload.title, "SOVEREIGN");
    const message = safeString(payload.message ?? payload.text);
    if (!message) {
      throw new Error("message is required.");
    }
    if (process.platform !== "darwin") {
      return {
        delivered: false,
        platform: process.platform,
        reason: "Notification integration is currently macOS-only."
      };
    }
    const escapedTitle = title.replace(/"/g, '\\"');
    const escapedMessage = message.replace(/"/g, '\\"');
    await new Promise((resolve, reject) => {
      const child = spawn("osascript", [
        "-e",
        `display notification "${escapedMessage}" with title "${escapedTitle}"`
      ]);
      child.on("error", reject);
      child.on("exit", (code) => {
        if ((code ?? 0) !== 0) {
          reject(new Error(`osascript exited with code ${code}.`));
          return;
        }
        resolve(null);
      });
    });
    return {
      delivered: true,
      platform: process.platform,
      title
    };
  }

  #assertAllowedCommand(command) {
    const normalized = safeString(command);
    if (!normalized) {
      throw new Error("command is required.");
    }
    if (!Array.isArray(this.commandAllowlist) || this.commandAllowlist.length === 0) {
      return;
    }
    const allowed = this.commandAllowlist.some((entry) => normalized === entry || normalized.startsWith(`${entry}/`));
    if (!allowed) {
      throw new Error(`Command '${normalized}' is not in COMPANION_SYSTEM_RUN_ALLOWLIST.`);
    }
  }
}

async function main() {
  const companion = new MacOsCompanionNode();
  const shutdown = () => companion.stop();
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  // eslint-disable-next-line no-console
  console.log(`[companion] starting macOS node '${companion.nodeId}'`);
  await companion.start();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(`[companion] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
