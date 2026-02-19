// @ts-nocheck
import os from "node:os";
import { spawn } from "node:child_process";
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

export class NodeService {
  constructor(options = {}) {
    this.browserControlService = options.browserControlService ?? null;
    this.remoteInvoker = typeof options.remoteInvoker === "function" ? options.remoteInvoker : null;
    this.enableSystemRun = options.enableSystemRun ?? process.env.NODE_SYSTEM_RUN_ENABLED === "true";
    this.enableShellCommand = options.enableShellCommand ?? process.env.NODE_SYSTEM_SHELL_ENABLED === "true";
    this.maxOutputChars = clampInt(
      options.maxOutputChars ?? process.env.NODE_SYSTEM_RUN_MAX_OUTPUT,
      20000,
      256,
      1_000_000
    );
    this.commandTimeoutMs = clampInt(
      options.commandTimeoutMs ?? process.env.NODE_SYSTEM_RUN_TIMEOUT_MS,
      20000,
      1000,
      300000
    );
    this.commandAllowlist = parseCsv(options.commandAllowlist ?? process.env.NODE_SYSTEM_RUN_ALLOWLIST);
    this.hostNodeId = safeString(options.hostNodeId ?? process.env.GATEWAY_HOST_NODE_ID, "host-node");
    this.hostNodeName = safeString(options.hostNodeName ?? process.env.GATEWAY_HOST_NODE_NAME, os.hostname());
    this.customNodes = new Map();
  }

  setRemoteInvoker(invoker) {
    this.remoteInvoker = typeof invoker === "function" ? invoker : null;
  }

  listNodes() {
    const host = this.#describeHostNode();
    return [host, ...this.customNodes.values()];
  }

  describeNode(nodeId) {
    const id = safeString(nodeId);
    if (!id || id === this.hostNodeId) {
      return this.#describeHostNode();
    }
    return this.customNodes.get(id) ?? null;
  }

  registerNode(node) {
    const id = safeString(node?.id);
    if (!id) {
      throw this.#badRequest("node.id is required.");
    }
    const normalized = {
      id,
      name: safeString(node?.name, id),
      type: safeString(node?.type, "remote"),
      platform: safeString(node?.platform, "unknown"),
      status: safeString(node?.status, "online"),
      capabilities: Array.isArray(node?.capabilities) ? node.capabilities.map((item) => String(item)) : [],
      permissionMap:
        node?.permissionMap && typeof node.permissionMap === "object" ? node.permissionMap : {},
      metadata: node?.metadata && typeof node.metadata === "object" ? node.metadata : {},
      updatedAt: nowIso()
    };
    this.customNodes.set(id, normalized);
    return normalized;
  }

  async invoke(input = {}) {
    const nodeId = safeString(input.nodeId, this.hostNodeId);
    const action = safeString(input.action).toLowerCase();
    const payload = input.input && typeof input.input === "object" ? input.input : {};
    if (!action) {
      throw this.#badRequest("action is required.");
    }

    const node = this.describeNode(nodeId);
    if (!node) {
      throw this.#notFound(`Node '${nodeId}' not found.`);
    }

    if (nodeId !== this.hostNodeId) {
      if (typeof this.remoteInvoker !== "function") {
        throw this.#badRequest(
          `Node '${nodeId}' is remote-only and no bridge invoker is configured.`
        );
      }
      const remoteResult = await this.remoteInvoker({
        nodeId,
        node,
        action,
        input: payload,
        timeoutMs: payload.timeoutMs
      });
      return this.#ok(action, nodeId, {
        remote: true,
        ...(remoteResult && typeof remoteResult === "object"
          ? remoteResult
          : { value: remoteResult })
      });
    }

    if (action === "system.run") {
      return this.#invokeSystemRun(payload);
    }
    if (action === "system.notify") {
      return this.#invokeSystemNotify(payload);
    }
    if (action === "browser.open_url") {
      if (!this.browserControlService) {
        throw this.#badRequest("browser control service is not configured.");
      }
      const result = await this.browserControlService.openUrl({
        url: payload.url
      });
      return this.#ok(action, nodeId, result);
    }
    if (action === "browser.status") {
      if (!this.browserControlService) {
        throw this.#badRequest("browser control service is not configured.");
      }
      return this.#ok(action, nodeId, this.browserControlService.getStatus());
    }
    if (action === "location.get") {
      return this.#ok(action, nodeId, {
        available: Boolean(process.env.NODE_LOCATION_LAT && process.env.NODE_LOCATION_LON),
        lat: safeString(process.env.NODE_LOCATION_LAT) || null,
        lon: safeString(process.env.NODE_LOCATION_LON) || null,
        source: process.env.NODE_LOCATION_SOURCE ?? null
      });
    }
    if (action === "camera.snap" || action === "camera.clip" || action === "screen.record") {
      return this.#ok(action, nodeId, {
        implemented: false,
        message:
          "Camera and screen capture nodes are scaffolded in API, but require native companion app integration."
      });
    }
    if (action === "notifications.send") {
      return this.#invokeSystemNotify(payload);
    }

    throw this.#badRequest(`Unsupported node action '${action}'.`);
  }

  async #invokeSystemRun(payload) {
    if (!this.enableSystemRun) {
      throw this.#badRequest(
        "system.run is disabled. Set NODE_SYSTEM_RUN_ENABLED=true to enable host command execution."
      );
    }

    const command = safeString(payload.command);
    const args = Array.isArray(payload.args) ? payload.args.map((item) => String(item)) : [];
    const shellCommand = safeString(payload.shellCommand);
    const timeoutMs = clampInt(payload.timeoutMs, this.commandTimeoutMs, 1000, 300000);
    const cwd = safeString(payload.cwd) || process.cwd();

    if (!command && !shellCommand) {
      throw this.#badRequest("Provide command (and optional args) or shellCommand.");
    }
    if (shellCommand && !this.enableShellCommand) {
      throw this.#badRequest(
        "shellCommand is disabled. Set NODE_SYSTEM_SHELL_ENABLED=true if you need shell execution."
      );
    }
    if (command) {
      this.#assertAllowedCommand(command);
    } else if (shellCommand) {
      this.#assertAllowedCommand(shellCommand.split(/\s+/)[0] ?? "");
    }

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

    return this.#ok("system.run", this.hostNodeId, {
      ...result,
      durationMs: Date.now() - startedAtMs
    });
  }

  async #invokeSystemNotify(payload) {
    const title = safeString(payload.title, "SOVEREIGN");
    const message = safeString(payload.message ?? payload.text);
    if (!message) {
      throw this.#badRequest("message is required for notification.");
    }

    if (process.platform !== "darwin") {
      return this.#ok("system.notify", this.hostNodeId, {
        delivered: false,
        platform: process.platform,
        reason: "Notification integration currently implemented for macOS only."
      });
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

    return this.#ok("system.notify", this.hostNodeId, {
      delivered: true,
      platform: process.platform,
      title
    });
  }

  #describeHostNode() {
    const browserCapable = Boolean(this.browserControlService?.isEnabled?.());
    return {
      id: this.hostNodeId,
      name: this.hostNodeName,
      type: "host",
      platform: `${os.platform()}-${os.arch()}`,
      status: "online",
      capabilities: [
        "system.run",
        "system.notify",
        "location.get",
        "camera.snap",
        "camera.clip",
        "screen.record",
        ...(browserCapable ? ["browser.open_url", "browser.status"] : [])
      ],
      permissionMap: {
        "system.run": this.enableSystemRun ? "granted" : "disabled",
        "system.notify": process.platform === "darwin" ? "available" : "limited",
        "browser.open_url": browserCapable ? "available" : "disabled",
        "camera.snap": "scaffolded",
        "camera.clip": "scaffolded",
        "screen.record": "scaffolded",
        "location.get": "configurable"
      },
      metadata: {
        hostname: os.hostname(),
        pid: process.pid,
        commandAllowlist: this.commandAllowlist
      },
      updatedAt: nowIso()
    };
  }

  #assertAllowedCommand(command) {
    const normalized = safeString(command);
    if (!normalized) {
      throw this.#badRequest("command is required.");
    }
    if (!Array.isArray(this.commandAllowlist) || this.commandAllowlist.length === 0) {
      return;
    }
    const allowed = this.commandAllowlist.some((entry) => normalized === entry || normalized.startsWith(`${entry}/`));
    if (!allowed) {
      throw this.#badRequest(
        `Command '${normalized}' is not in NODE_SYSTEM_RUN_ALLOWLIST.`
      );
    }
  }

  #ok(action, nodeId, result) {
    return {
      ok: true,
      action,
      nodeId,
      timestamp: nowIso(),
      result
    };
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
