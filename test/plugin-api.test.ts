// @ts-nocheck
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../src/server.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sovereign-plugin-api-"));
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
  fs.writeFileSync(path.join(pluginDir, entry), input.code, "utf8");
}

async function callApi(handler, input) {
  const body = input.body === undefined ? "" : JSON.stringify(input.body);
  const req = Readable.from(body ? [body] : []);
  req.method = input.method ?? "GET";
  req.url = input.url;
  req.headers = {
    host: "localhost",
    ...(input.headers ?? {})
  };

  return new Promise((resolve, reject) => {
    let status = 200;
    let payload = "";
    const res = {
      writeHead(code) {
        status = code;
      },
      end(chunk) {
        payload += chunk ? String(chunk) : "";
        try {
          resolve({
            status,
            body: payload ? JSON.parse(payload) : {}
          });
        } catch (error) {
          reject(error);
        }
      }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

test("plugin API lists plugins and invokes plugin tools", async () => {
  const root = makeTempDir();
  const pluginsDir = path.join(root, "plugins");
  fs.mkdirSync(pluginsDir, { recursive: true });
  writePlugin(pluginsDir, {
    id: "http-demo",
    code: `
      module.exports = async function register() {
        return {
          tools: [
            {
              name: "echo",
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

  const api = createApi({
    cwd: root,
    persistPath: path.join(root, ".data", "store.json"),
    pluginsDir
  });

  const listRes = await callApi(api.handler, {
    method: "GET",
    url: "/api/plugins"
  });
  assert.equal(listRes.status, 200);
  assert.equal(Array.isArray(listRes.body.plugins), true);
  assert.equal(listRes.body.plugins.length, 1);
  assert.equal(listRes.body.plugins[0].id, "http-demo");

  const invokeRes = await callApi(api.handler, {
    method: "POST",
    url: "/api/plugins/http-demo/tools/echo/invoke",
    body: {
      input: {
        text: "hi from api"
      }
    }
  });
  assert.equal(invokeRes.status, 200);
  assert.equal(invokeRes.body.invocation.result.echoed, "hi from api");

  const runtimeActionsRes = await callApi(api.handler, {
    method: "GET",
    url: "/api/runtime/actions?limit=10"
  });
  assert.equal(runtimeActionsRes.status, 200);
  assert.equal(Array.isArray(runtimeActionsRes.body.actions), true);
  assert.equal(runtimeActionsRes.body.actions.length >= 1, true);
  assert.equal(runtimeActionsRes.body.actions[0].pluginId, "http-demo");

  const runtimeMetricsRes = await callApi(api.handler, {
    method: "GET",
    url: "/api/runtime/metrics"
  });
  assert.equal(runtimeMetricsRes.status, 200);
  assert.equal(typeof runtimeMetricsRes.body.metrics.total, "number");
});
