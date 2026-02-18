// @ts-nocheck
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { PluginService } from "../src/services/plugin-service.js";
import { DataStore } from "../src/store/data-store.js";
import { PolicyEngine } from "../src/services/policy-engine.js";
import { RuntimeTrustService } from "../src/services/runtime-trust-service.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sovereign-plugin-service-"));
}

function writePlugin(pluginsDir, input) {
  const pluginDir = path.join(pluginsDir, input.folder ?? input.id);
  fs.mkdirSync(pluginDir, { recursive: true });
  const entry = input.entry ?? "index.cjs";
  fs.writeFileSync(
    path.join(pluginDir, "plugin.json"),
    JSON.stringify(
      {
        id: input.id,
        name: input.name ?? input.id,
        version: input.version ?? "0.0.1",
        entry
      },
      null,
      2
    ),
    "utf8"
  );
  if (input.code !== undefined) {
    fs.writeFileSync(path.join(pluginDir, entry), input.code, "utf8");
  }
}

test("PluginService loads plugin manifests and invokes tools", async () => {
  const root = makeTempDir();
  const pluginsDir = path.join(root, "plugins");
  fs.mkdirSync(pluginsDir, { recursive: true });

  writePlugin(pluginsDir, {
    id: "demo-tools",
    code: `
      module.exports = async function register() {
        return {
          tools: [
            {
              name: "echo",
              description: "Echo user input",
              inputSchema: {
                type: "object",
                required: ["text"],
                properties: {
                  text: { type: "string" }
                }
              },
              async run({ input }) {
                return { echoed: input.text };
              }
            }
          ]
        };
      }
    `
  });

  const pluginService = new PluginService({
    pluginsDir
  });
  await pluginService.waitUntilReady();

  const listed = pluginService.listPlugins();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, "demo-tools");
  assert.equal(listed[0].tools.length, 1);

  const invocation = await pluginService.invokeTool("demo-tools", "echo", {
    text: "hello"
  });
  assert.equal(invocation.result.echoed, "hello");
});

test("PluginService validates tool input schema", async () => {
  const root = makeTempDir();
  const pluginsDir = path.join(root, "plugins");
  fs.mkdirSync(pluginsDir, { recursive: true });

  writePlugin(pluginsDir, {
    id: "schema-tools",
    code: `
      module.exports = async function register() {
        return {
          tools: [
            {
              name: "sum",
              inputSchema: {
                type: "object",
                required: ["a", "b"],
                properties: {
                  a: { type: "number" },
                  b: { type: "number" }
                }
              },
              async run({ input }) {
                return { total: input.a + input.b };
              }
            }
          ]
        };
      }
    `
  });

  const pluginService = new PluginService({ pluginsDir });
  await pluginService.waitUntilReady();

  await assert.rejects(
    async () => {
      await pluginService.invokeTool("schema-tools", "sum", {
        a: "1",
        b: 2
      });
    },
    (error) => {
      assert.equal(error.statusCode, 400);
      return true;
    }
  );
});

test("PluginService keeps valid plugins when others fail to load", async () => {
  const root = makeTempDir();
  const pluginsDir = path.join(root, "plugins");
  fs.mkdirSync(pluginsDir, { recursive: true });

  writePlugin(pluginsDir, {
    id: "healthy",
    code: `
      module.exports = async function register() {
        return {
          tools: [
            {
              name: "ping",
              async run() {
                return { ok: true };
              }
            }
          ]
        };
      }
    `
  });
  writePlugin(pluginsDir, {
    id: "broken",
    entry: "missing.js"
  });

  const pluginService = new PluginService({ pluginsDir });
  await pluginService.waitUntilReady();

  const status = pluginService.getStatus();
  assert.equal(status.loadedPluginCount, 1);
  assert.equal(status.loadErrorCount, 1);

  const errors = pluginService.listLoadErrors();
  assert.equal(errors.length, 1);
  assert.ok(errors[0].message.includes("entry file not found"));
});

test("PluginService blocks high-risk tool actions and logs runtime audit", async () => {
  const root = makeTempDir();
  const pluginsDir = path.join(root, "plugins");
  fs.mkdirSync(pluginsDir, { recursive: true });
  writePlugin(pluginsDir, {
    id: "billing-tools",
    code: `
      module.exports = async function register() {
        return {
          tools: [
            {
              name: "charge_customer",
              actionType: "financial",
              inputSchema: {
                type: "object",
                required: ["amount"],
                properties: {
                  amount: { type: "number" }
                }
              },
              async run({ input }) {
                return { charged: input.amount };
              }
            }
          ]
        };
      }
    `
  });

  const store = new DataStore({ persistPath: null });
  const runtimeTrustService = new RuntimeTrustService({
    store,
    policyEngine: new PolicyEngine()
  });

  const pluginService = new PluginService({
    pluginsDir,
    services: {
      runtimeTrustService
    }
  });
  await pluginService.waitUntilReady();

  await assert.rejects(
    async () => {
      await pluginService.invokeTool("billing-tools", "charge_customer", { amount: 42 }, {
        source: "test",
        workspaceId: "default"
      });
    },
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "APPROVAL_REQUIRED");
      assert.equal(error.actionType, "financial");
      return true;
    }
  );

  const actions = store.listRuntimeActions({ limit: 10 });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].pluginId, "billing-tools");
  assert.equal(actions[0].toolName, "charge_customer");
  assert.equal(actions[0].actionType, "financial");
  assert.equal(actions[0].decision, "blocked");
  assert.equal(actions[0].status, "blocked");
});
