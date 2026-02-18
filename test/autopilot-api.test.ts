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

test("autopilot API creates goal and progresses to done state", async () => {
  const cwd = process.cwd();
  const api = createApi({
    cwd,
    persistPath: null,
    pluginsDir: path.join(cwd, "dist", "plugins"),
    autopilotAutoStart: false
  });

  const createRes = await callApi(api.handler, {
    method: "POST",
    url: "/api/autopilot/goals",
    body: {
      workspaceId: "default",
      title: "Autopilot API Goal",
      objective: "Handle a delegated objective and complete all planned tasks",
      maxCycles: 20
    }
  });
  assert.equal(createRes.status, 201);
  const goalId = createRes.body.goal.id;
  assert.ok(goalId);

  for (let i = 0; i < 20; i += 1) {
    await callApi(api.handler, {
      method: "POST",
      url: `/api/autopilot/goals/${goalId}/run`
    });
    const detail = await callApi(api.handler, {
      method: "GET",
      url: `/api/autopilot/goals/${goalId}`
    });
    if (detail.body.goal.status === "done") {
      break;
    }
  }

  const finalRes = await callApi(api.handler, {
    method: "GET",
    url: `/api/autopilot/goals/${goalId}`
  });
  assert.equal(finalRes.status, 200);
  assert.equal(finalRes.body.goal.status, "done");

  const listRes = await callApi(api.handler, {
    method: "GET",
    url: "/api/autopilot/goals?workspaceId=default"
  });
  assert.equal(listRes.status, 200);
  assert.equal(Array.isArray(listRes.body.goals), true);
  assert.equal(listRes.body.goals.some((goal) => goal.id === goalId), true);

  const logsRes = await callApi(api.handler, {
    method: "GET",
    url: `/api/autopilot/goals/${goalId}/logs?limit=50`
  });
  assert.equal(logsRes.status, 200);
  assert.equal(Array.isArray(logsRes.body.logs), true);
  assert.equal(logsRes.body.logs.length > 0, true);
});
