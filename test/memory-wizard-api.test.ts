// @ts-nocheck
import path from "node:path";
import fs from "node:fs";
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

test("memory API indexes and searches, wizard API scaffolds setup", async () => {
  const cwd = process.cwd();
  const api = createApi({
    cwd,
    persistPath: null,
    pluginsDir: path.join(cwd, "dist", "plugins"),
    autopilotAutoStart: false,
    heartbeatAutoStart: false
  });

  const indexRes = await callApi(api.handler, {
    method: "POST",
    url: "/api/memory/index",
    body: {
      workspaceId: "default",
      sourceId: "doc-1",
      text: "# Sales Plan\nWe need better sales conversion.\n# Engineering\nShip reliable code fast."
    }
  });
  assert.equal(indexRes.status, 201);
  assert.ok(indexRes.body.chunksIndexed >= 1);

  const searchRes = await callApi(api.handler, {
    method: "POST",
    url: "/api/memory/search",
    body: {
      workspaceId: "default",
      query: "sales conversion",
      limit: 3
    }
  });
  assert.equal(searchRes.status, 200);
  assert.ok(Array.isArray(searchRes.body.hits));
  assert.ok(searchRes.body.hits.length >= 1);
  assert.ok(Array.isArray(searchRes.body.queryEntities));
  assert.ok(Array.isArray(searchRes.body.queryRelationTypes));
  assert.ok(Array.isArray(searchRes.body.hits[0].graph.entities));
  assert.equal(typeof searchRes.body.hits[0].scores.entityOverlap, "number");
  assert.equal(typeof searchRes.body.hits[0].scores.relationOverlap, "number");

  const secondIndex = await callApi(api.handler, {
    method: "POST",
    url: "/api/memory/index",
    body: {
      workspaceId: "default",
      sourceId: "doc-2",
      text: "# Market Plan\nSales conversion improves when onboarding friction drops."
    }
  });
  assert.equal(secondIndex.status, 201);

  const graphRes = await callApi(api.handler, {
    method: "POST",
    url: "/api/memory/graph/query",
    body: {
      workspaceId: "default",
      query: "sales conversion onboarding",
      hops: 2
    }
  });
  assert.equal(graphRes.status, 200);
  assert.ok(Array.isArray(graphRes.body.nodes));
  assert.ok(Array.isArray(graphRes.body.edges));
  assert.ok(graphRes.body.nodes.length >= 1);
  assert.ok(Array.isArray(graphRes.body.nodes[0].entities));
  assert.ok(Array.isArray(graphRes.body.nodes[0].relations));

  const graphStatsRes = await callApi(api.handler, {
    method: "GET",
    url: "/api/memory/graph/stats?workspaceId=default"
  });
  assert.equal(graphStatsRes.status, 200);
  assert.ok(Number(graphStatsRes.body.nodes) >= 2);
  assert.ok(Array.isArray(graphStatsRes.body.topEntities));
  assert.ok(Array.isArray(graphStatsRes.body.topRelationTypes));

  const workspaceDir = path.join(".data", "wizard-api-test");
  const wizardRes = await callApi(api.handler, {
    method: "POST",
    url: "/api/setup/wizard/run",
    body: {
      workspaceId: "default",
      workspaceDir,
      providers: ["openai", "anthropic"],
      channels: ["local", "telegram"],
      personaName: "SovereignX"
    }
  });
  assert.equal(wizardRes.status, 201);
  assert.ok(wizardRes.body.run.id);
  const wizardRunId = wizardRes.body.run.id;

  const missionFile = path.join(cwd, workspaceDir, "MISSION.md");
  assert.equal(fs.existsSync(missionFile), true);

  const runsRes = await callApi(api.handler, {
    method: "GET",
    url: "/api/setup/wizard/runs?workspaceId=default"
  });
  assert.equal(runsRes.status, 200);
  assert.ok(Array.isArray(runsRes.body.runs));
  assert.ok(runsRes.body.runs.length >= 1);

  const runRes = await callApi(api.handler, {
    method: "GET",
    url: `/api/setup/wizard/${wizardRunId}`
  });
  assert.equal(runRes.status, 200);
  assert.equal(runRes.body.run.id, wizardRunId);
});
