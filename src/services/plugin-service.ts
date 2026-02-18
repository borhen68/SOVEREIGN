// @ts-nocheck
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { nowIso } from "../lib/time.js";
import { ActionType } from "../domain/constants.js";

const MAX_PLUGIN_ID_LENGTH = 64;
const MAX_TOOL_NAME_LENGTH = 64;

function clone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function safeString(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeIdentifier(value, maxLength, label) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    throw badRequest(`${label} is required.`);
  }
  if (normalized.length > maxLength) {
    throw badRequest(`${label} must be <= ${maxLength} characters.`);
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(normalized)) {
    throw badRequest(`${label} must match /^[a-z0-9][a-z0-9_-]*$/.`);
  }
  return normalized;
}

function normalizeToolShape(tool) {
  if (!isRecord(tool)) {
    throw badRequest("Plugin tool entry must be an object.");
  }
  const name = normalizeIdentifier(tool.name, MAX_TOOL_NAME_LENGTH, "Tool name");
  if (typeof tool.run !== "function") {
    throw badRequest(`Tool '${name}' must define a run(input) function.`);
  }
  const actionType = normalizeActionType(tool.actionType);
  return {
    name,
    description: tool.description ? String(tool.description) : "",
    inputSchema: isRecord(tool.inputSchema) ? clone(tool.inputSchema) : null,
    actionType,
    run: tool.run
  };
}

function normalizeActionType(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return null;
  }
  if (!Object.values(ActionType).includes(normalized)) {
    throw badRequest(
      `Invalid tool actionType '${normalized}'. Allowed: ${Object.values(ActionType).join(", ")}.`
    );
  }
  return normalized;
}

function normalizeManifest(rawManifest, manifestPath) {
  if (!isRecord(rawManifest)) {
    throw badRequest(`Invalid manifest at ${manifestPath}. Expected JSON object.`);
  }
  const id = normalizeIdentifier(rawManifest.id, MAX_PLUGIN_ID_LENGTH, "Plugin id");
  const name = String(rawManifest.name ?? "").trim();
  if (!name) {
    throw badRequest(`Plugin '${id}' requires a non-empty name.`);
  }
  const version = String(rawManifest.version ?? "").trim();
  if (!version) {
    throw badRequest(`Plugin '${id}' requires a version string.`);
  }
  const entry = String(rawManifest.entry ?? "index.js").trim();
  if (!entry) {
    throw badRequest(`Plugin '${id}' entry cannot be empty.`);
  }
  return {
    id,
    name,
    version,
    description: rawManifest.description ? String(rawManifest.description) : "",
    entry,
    permissions: isRecord(rawManifest.permissions) ? clone(rawManifest.permissions) : {},
    metadata: isRecord(rawManifest.metadata) ? clone(rawManifest.metadata) : {}
  };
}

function normalizeToolCollection(pluginApi) {
  if (!pluginApi) {
    return [];
  }
  if (Array.isArray(pluginApi)) {
    return pluginApi.map(normalizeToolShape);
  }

  const tools = pluginApi.tools;
  if (!tools) {
    return [];
  }

  if (Array.isArray(tools)) {
    return tools.map(normalizeToolShape);
  }

  if (isRecord(tools)) {
    return Object.entries(tools).map(([name, run]) =>
      normalizeToolShape({
        name,
        run,
        description: "",
        inputSchema: null
      })
    );
  }

  throw badRequest("Plugin tools must be an array or object map.");
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw badRequest(
      `Failed to parse JSON file ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function validateObjectInput(input, schema) {
  if (!schema) {
    return;
  }
  if (!isRecord(schema)) {
    return;
  }
  const schemaType = String(schema.type ?? "").trim().toLowerCase();
  if (schemaType && schemaType !== "object") {
    return;
  }
  if (!isRecord(input)) {
    throw badRequest("Tool input must be a JSON object.");
  }

  const required = Array.isArray(schema.required) ? schema.required.map((item) => String(item)) : [];
  for (const field of required) {
    if (!(field in input)) {
      throw badRequest(`Tool input is missing required field '${field}'.`);
    }
  }

  const properties = isRecord(schema.properties) ? schema.properties : null;
  if (!properties) {
    return;
  }
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!(key in input)) {
      continue;
    }
    if (!isRecord(propertySchema)) {
      continue;
    }
    const expectedType = String(propertySchema.type ?? "").trim().toLowerCase();
    if (!expectedType) {
      continue;
    }
    const value = input[key];
    if (expectedType === "array" && !Array.isArray(value)) {
      throw badRequest(`Tool input field '${key}' must be an array.`);
    }
    if (expectedType === "object" && !isRecord(value)) {
      throw badRequest(`Tool input field '${key}' must be an object.`);
    }
    if (expectedType === "string" && typeof value !== "string") {
      throw badRequest(`Tool input field '${key}' must be a string.`);
    }
    if (expectedType === "number" && typeof value !== "number") {
      throw badRequest(`Tool input field '${key}' must be a number.`);
    }
    if (expectedType === "boolean" && typeof value !== "boolean") {
      throw badRequest(`Tool input field '${key}' must be a boolean.`);
    }
  }
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

function internalError(message) {
  const error = new Error(message);
  error.statusCode = 500;
  return error;
}

export class PluginService {
  constructor(options = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.pluginsDir = path.resolve(options.pluginsDir ?? path.join(this.cwd, "plugins"));
    this.services = isRecord(options.services) ? options.services : {};
    this.observabilityService =
      this.services.observabilityService && typeof this.services.observabilityService.record === "function"
        ? this.services.observabilityService
        : null;
    this.clock = typeof options.clock === "function" ? options.clock : nowIso;
    this.registry = new Map();
    this.loadErrors = [];
    this.lastLoadedAt = null;
    this.readyPromise = Promise.resolve();
    this.readyPromise = this.reload();
  }

  async waitUntilReady() {
    await this.readyPromise;
  }

  getStatus() {
    return {
      pluginsDir: this.pluginsDir,
      loadedPluginCount: this.registry.size,
      loadErrorCount: this.loadErrors.length,
      lastLoadedAt: this.lastLoadedAt
    };
  }

  listLoadErrors() {
    return clone(this.loadErrors);
  }

  listPlugins() {
    return [...this.registry.values()]
      .map((entry) => ({
        id: entry.manifest.id,
        name: entry.manifest.name,
        version: entry.manifest.version,
        description: entry.manifest.description,
        entry: entry.manifest.entry,
        pluginRoot: entry.pluginRoot,
        loadedAt: entry.loadedAt,
        permissions: entry.manifest.permissions,
        metadata: entry.manifest.metadata,
        tools: entry.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          actionType: tool.actionType ?? null
        })),
        toolCount: entry.tools.length
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  getPlugin(pluginId) {
    const id = normalizeIdentifier(pluginId, MAX_PLUGIN_ID_LENGTH, "Plugin id");
    const plugin = this.registry.get(id);
    return plugin
      ? this.listPlugins().find((entry) => entry.id === id) ?? null
      : null;
  }

  async reload() {
    const run = this.#reloadInternal();
    this.readyPromise = run;
    return run;
  }

  async invokeTool(pluginId, toolName, input = {}, context = {}) {
    await this.waitUntilReady();
    const normalizedPluginId = normalizeIdentifier(pluginId, MAX_PLUGIN_ID_LENGTH, "Plugin id");
    const normalizedToolName = normalizeIdentifier(toolName, MAX_TOOL_NAME_LENGTH, "Tool name");
    const plugin = this.registry.get(normalizedPluginId);
    if (!plugin) {
      throw notFound(`Plugin '${normalizedPluginId}' not found.`);
    }
    const tool = plugin.tools.find((entry) => entry.name === normalizedToolName);
    if (!tool) {
      throw notFound(`Tool '${normalizedToolName}' not found in plugin '${normalizedPluginId}'.`);
    }
    const safeInput = input === undefined || input === null ? {} : input;
    const safeContext = isRecord(context) ? context : {};
    validateObjectInput(safeInput, tool.inputSchema);
    const runtimeTrustService =
      this.services.runtimeTrustService && typeof this.services.runtimeTrustService.beforeInvoke === "function"
        ? this.services.runtimeTrustService
        : null;
    const telemetryContext = {
      workspaceId: safeString(safeContext.workspaceId, "default"),
      traceId: safeString(safeContext.traceId) || null,
      runId: safeString(safeContext.runId) || null,
      missionId: safeString(safeContext.missionId) || null,
      source: safeString(safeContext.source, "plugin.invoke")
    };

    const startedAt = this.clock();
    const startedAtEpoch = Date.now();
    this.#observe({
      ...telemetryContext,
      type: "tool.invoke.start",
      level: "info",
      message: "Plugin tool invocation started.",
      payload: {
        pluginId: normalizedPluginId,
        toolName: normalizedToolName,
        actionType: tool.actionType ?? null
      }
    });
    let trustGate = null;
    try {
      if (runtimeTrustService) {
        trustGate = await runtimeTrustService.beforeInvoke({
          manifest: plugin.manifest,
          pluginId: normalizedPluginId,
          tool: {
            name: tool.name,
            description: tool.description,
            actionType: tool.actionType
          },
          input: safeInput,
          context: safeContext
        });
        if (trustGate && trustGate.allowed === false) {
          this.#observe({
            ...telemetryContext,
            type: "tool.invoke.blocked",
            level: "warning",
            message: "Plugin tool invocation requires approval.",
            payload: {
              pluginId: normalizedPluginId,
              toolName: normalizedToolName,
              actionType: trustGate.actionType ?? null,
              riskScore: trustGate.riskScore ?? null,
              approvalId: trustGate.approvalId ?? null,
              runtimeActionId: trustGate.runtimeActionId ?? null
            },
            durationMs: Date.now() - startedAtEpoch
          });
          const approvalError = new Error(
            trustGate.approvalReason || "Tool action requires explicit approval."
          );
          approvalError.statusCode = 409;
          approvalError.code = "APPROVAL_REQUIRED";
          approvalError.actionType = trustGate.actionType ?? null;
          approvalError.approvalId = trustGate.approvalId ?? null;
          approvalError.missionActionId = trustGate.missionActionId ?? null;
          approvalError.runtimeActionId = trustGate.runtimeActionId ?? null;
          throw approvalError;
        }
      }

      const result = await tool.run({
        input: safeInput,
        context: safeContext,
        services: this.services,
        manifest: clone(plugin.manifest),
        plugin: {
          id: plugin.manifest.id,
          root: plugin.pluginRoot
        },
        log: this.#loggerFor(plugin.manifest.id, tool.name)
      });
      if (runtimeTrustService && trustGate) {
        await runtimeTrustService.afterInvoke({
          gate: trustGate,
          result
        });
      }
      const finishedAt = this.clock();
      this.#observe({
        ...telemetryContext,
        type: "tool.invoke.success",
        level: "info",
        message: "Plugin tool invocation succeeded.",
        payload: {
          pluginId: normalizedPluginId,
          toolName: normalizedToolName,
          actionType: tool.actionType ?? null,
          runtimeActionId: trustGate?.runtimeActionId ?? null,
          riskScore: trustGate?.riskScore ?? null
        },
        durationMs: Date.now() - startedAtEpoch
      });
      return {
        pluginId: normalizedPluginId,
        toolName: normalizedToolName,
        startedAt,
        finishedAt,
        trust: trustGate
          ? {
              runtimeActionId: trustGate.runtimeActionId ?? null,
              actionType: trustGate.actionType ?? null,
              riskScore: trustGate.riskScore ?? null,
              requiresApproval: Boolean(trustGate.requiresApproval),
              approvalId: trustGate.approvalId ?? null
            }
          : null,
        result: result === undefined ? null : result
      };
    } catch (error) {
      if (runtimeTrustService && trustGate && trustGate.allowed !== false) {
        await runtimeTrustService.afterInvoke({
          gate: trustGate,
          error
        });
      }
      const statusCode = Number(error?.statusCode);
      this.#observe({
        ...telemetryContext,
        type: "tool.invoke.failed",
        level: Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 500 ? "warning" : "error",
        message: "Plugin tool invocation failed.",
        payload: {
          pluginId: normalizedPluginId,
          toolName: normalizedToolName,
          actionType: tool.actionType ?? null,
          runtimeActionId: trustGate?.runtimeActionId ?? null,
          error: error instanceof Error ? error.message : String(error),
          statusCode: Number.isInteger(statusCode) ? statusCode : null
        },
        durationMs: Date.now() - startedAtEpoch
      });
      if (Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500) {
        throw error;
      }
      const pluginError = internalError(
        `Plugin tool failed (${normalizedPluginId}/${normalizedToolName}): ${error instanceof Error ? error.message : String(error)}`
      );
      pluginError.cause = error;
      throw pluginError;
    }
  }

  async #reloadInternal() {
    this.registry.clear();
    this.loadErrors = [];
    const manifestFiles = this.#discoverManifestFiles();
    for (const descriptor of manifestFiles) {
      try {
        // Force cache busting during reload so plugin edits are reflected immediately.
        await this.#loadManifestDescriptor(descriptor, Date.now());
      } catch (error) {
        this.loadErrors.push({
          manifestPath: descriptor.manifestPath,
          message: error instanceof Error ? error.message : String(error),
          occurredAt: this.clock()
        });
      }
    }
    this.lastLoadedAt = this.clock();
    return this.getStatus();
  }

  #discoverManifestFiles() {
    if (!fs.existsSync(this.pluginsDir)) {
      return [];
    }
    const directEntries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });
    const manifests = [];
    for (const entry of directEntries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const pluginRoot = path.join(this.pluginsDir, entry.name);
      const manifestPath = path.join(pluginRoot, "plugin.json");
      if (!fs.existsSync(manifestPath)) {
        continue;
      }
      manifests.push({
        pluginRoot,
        manifestPath
      });
    }
    return manifests.sort((a, b) => a.manifestPath.localeCompare(b.manifestPath));
  }

  async #loadManifestDescriptor(descriptor, cacheBust) {
    const rawManifest = readJsonFile(descriptor.manifestPath);
    const manifest = normalizeManifest(rawManifest, descriptor.manifestPath);
    if (this.registry.has(manifest.id)) {
      throw badRequest(`Duplicate plugin id '${manifest.id}' detected.`);
    }

    const resolvedEntry = path.resolve(descriptor.pluginRoot, manifest.entry);
    const relativeEntry = path.relative(descriptor.pluginRoot, resolvedEntry);
    if (relativeEntry.startsWith("..") || path.isAbsolute(relativeEntry)) {
      throw badRequest(`Plugin '${manifest.id}' entry escapes plugin directory.`);
    }
    if (!fs.existsSync(resolvedEntry)) {
      throw notFound(`Plugin '${manifest.id}' entry file not found: ${resolvedEntry}`);
    }

    const moduleUrl = `${pathToFileURL(resolvedEntry).href}?v=${cacheBust}`;
    const imported = await import(moduleUrl);
    const register = imported.register ?? imported.default;
    if (typeof register !== "function") {
      throw badRequest(
        `Plugin '${manifest.id}' must export a function (default export or named 'register').`
      );
    }

    const pluginApi = await register({
      manifest: clone(manifest),
      services: this.services,
      sdkVersion: "1.0.0",
      log: this.#loggerFor(manifest.id)
    });

    const tools = normalizeToolCollection(pluginApi);
    const dedupedNames = new Set();
    for (const tool of tools) {
      if (dedupedNames.has(tool.name)) {
        throw badRequest(`Plugin '${manifest.id}' defines duplicate tool '${tool.name}'.`);
      }
      dedupedNames.add(tool.name);
    }

    this.registry.set(manifest.id, {
      manifest,
      pluginRoot: descriptor.pluginRoot,
      manifestPath: descriptor.manifestPath,
      tools,
      loadedAt: this.clock()
    });
  }

  #observe(input = {}) {
    if (!this.observabilityService || typeof this.observabilityService.record !== "function") {
      return;
    }
    this.observabilityService.record({
      workspaceId: safeString(input.workspaceId, "default"),
      source: safeString(input.source, "plugin"),
      type: safeString(input.type, "tool.event"),
      level: safeString(input.level, "info"),
      message: safeString(input.message),
      payload: isRecord(input.payload) ? input.payload : {},
      traceId: safeString(input.traceId) || null,
      runId: safeString(input.runId) || null,
      missionId: safeString(input.missionId) || null,
      durationMs: Number.isFinite(Number(input.durationMs)) ? Number(input.durationMs) : null
    });
  }

  #loggerFor(pluginId, toolName = null) {
    const prefix = toolName ? `[plugin:${pluginId}:${toolName}]` : `[plugin:${pluginId}]`;
    return {
      info: (...args) => console.log(prefix, ...args),
      warn: (...args) => console.warn(prefix, ...args),
      error: (...args) => console.error(prefix, ...args)
    };
  }
}
