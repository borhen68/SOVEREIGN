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

test("architecture API exposes blueprint, company-plan, and soul evolution", async () => {
  const cwd = process.cwd();
  const api = createApi({
    cwd,
    persistPath: null,
    pluginsDir: path.join(cwd, "dist", "plugins"),
    autopilotAutoStart: false
  });

  const blueprintRes = await callApi(api.handler, {
    method: "GET",
    url: "/api/architecture/blueprint"
  });
  assert.equal(blueprintRes.status, 200);
  assert.equal(blueprintRes.body.blueprint.architecture, "SOVEREIGN X Company OS");
  assert.ok(Array.isArray(blueprintRes.body.blueprint.layers));

  const planRes = await callApi(api.handler, {
    method: "POST",
    url: "/api/architecture/company-plan",
    body: {
      workspaceId: "default",
      objective: "Plan growth, improve coding output, and stabilize operations.",
      teamSize: 3,
      autoSpawnSubAgents: true,
      autoGenerateSkills: true
    }
  });
  assert.equal(planRes.status, 201);
  assert.ok(planRes.body.plan.planId);
  assert.ok(planRes.body.plan.mainAgent.id);
  assert.ok(planRes.body.plan.workstreams.length >= 2);

  const evolveRes = await callApi(api.handler, {
    method: "POST",
    url: "/api/architecture/soul/evolve",
    body: {
      agentId: planRes.body.plan.mainAgent.id,
      performanceScore: 0.8,
      outcome: "Execution was successful with clear stakeholder communication."
    }
  });
  assert.equal(evolveRes.status, 200);
  assert.equal(evolveRes.body.evolution.agentAfter.id, planRes.body.plan.mainAgent.id);
});
