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
          body: payload ? tryParseJson(payload) : {}
        });
      }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

function tryParseJson(payload) {
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}

test("dashboard HTML route serves marketing UI", async () => {
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
    url: "/dashboard"
  });

  assert.equal(response.status, 200);
  assert.equal(typeof response.body, "string");
  assert.equal(response.body.includes("SOVEREIGN - Command Center"), true);
  assert.equal(response.body.includes("Company Orchestrator"), true);
  assert.equal(
    Object.values(response.headers).some((value) => String(value).includes("text/html")),
    true
  );
});

test("dashboard snapshot API returns orchestrator, debate, and risk data", async () => {
  const cwd = process.cwd();
  const api = createApi({
    cwd,
    persistPath: null,
    pluginsDir: path.join(cwd, "dist", "plugins"),
    autopilotAutoStart: false,
    heartbeatAutoStart: false
  });

  const runResponse = await callApi(api.handler, {
    method: "POST",
    url: "/api/company/execute",
    body: {
      workspaceId: "default",
      objective: "Plan product launch and create go-to-market execution board.",
      teamSize: 3,
      debateRounds: 2
    }
  });
  assert.equal(runResponse.status, 201);

  const snapshotResponse = await callApi(api.handler, {
    method: "GET",
    url: "/api/dashboard/snapshot?workspaceId=default&limit=12"
  });

  assert.equal(snapshotResponse.status, 200);
  assert.ok(snapshotResponse.body.snapshot);
  assert.equal(snapshotResponse.body.snapshot.workspaceId, "default");
  assert.ok(snapshotResponse.body.snapshot.stats);
  assert.ok(Array.isArray(snapshotResponse.body.snapshot.orchestrator.latestRuns));
  assert.ok(Array.isArray(snapshotResponse.body.snapshot.council.debateFeed));
  assert.ok(Array.isArray(snapshotResponse.body.snapshot.risk.latestActions));
  assert.ok(Array.isArray(snapshotResponse.body.snapshot.observability.events));
  assert.ok(snapshotResponse.body.snapshot.setup.readiness);
  assert.equal(typeof snapshotResponse.body.snapshot.setup.readiness.score, "number");
});
