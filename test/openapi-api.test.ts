// @ts-nocheck
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../src/server.js";

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
    const headers = {};
    const res = {
      writeHead(code, responseHeaders = {}) {
        status = code;
        Object.assign(headers, responseHeaders);
      },
      end(chunk) {
        payload += chunk ? String(chunk) : "";
        resolve({
          status,
          headers,
          body: payload ? JSON.parse(payload) : {}
        });
      }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

test("openapi endpoint returns discoverable api spec", async () => {
  const cwd = process.cwd();
  const api = createApi({
    cwd,
    persistPath: null,
    pluginsDir: path.join(cwd, "dist", "plugins"),
    autopilotAutoStart: false,
    heartbeatAutoStart: false
  });

  const response = await callApi(api.handler, {
    method: "GET",
    url: "/api/openapi"
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.openapi, "3.1.0");
  assert.ok(response.body.paths["/api/company/execute"]);
  assert.ok(response.body.paths["/api/architecture/soul/{agentId}/rollback"]);
  assert.ok(response.body.paths["/api/heartbeat/outbox/process"]);
  assert.ok(response.body.paths["/api/gateway/status"]);
  assert.ok(response.body.paths["/api/gateway/bridge/status"]);
  assert.ok(response.body.paths["/api/gateway/bridge/nodes"]);
  assert.ok(response.body.paths["/api/gateway/nodes/{nodeId}/invoke"]);
  assert.ok(response.body.paths["/api/gateway/tailscale/plan"]);
});
