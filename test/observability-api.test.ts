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

test("observability traces and eval endpoints expose execution telemetry", async () => {
  const cwd = process.cwd();
  const api = createApi({
    cwd,
    persistPath: null,
    pluginsDir: path.join(cwd, "dist", "plugins"),
    autopilotAutoStart: false,
    heartbeatAutoStart: false
  });

  const runRes = await callApi(api.handler, {
    method: "POST",
    url: "/api/company/execute",
    body: {
      workspaceId: "default",
      objective: "Create a launch plan and engineering execution checklist.",
      teamSize: 3,
      debateRounds: 2
    }
  });
  assert.equal(runRes.status, 201);
  assert.ok(runRes.body.run.id);

  const tracesRes = await callApi(api.handler, {
    method: "GET",
    url: `/api/observability/traces?workspaceId=default&runId=${encodeURIComponent(runRes.body.run.id)}`
  });
  assert.equal(tracesRes.status, 200);
  assert.ok(Array.isArray(tracesRes.body.traces));
  assert.ok(tracesRes.body.traces.length >= 1);

  const traceId = tracesRes.body.traces[0].id;
  const traceRes = await callApi(api.handler, {
    method: "GET",
    url: `/api/observability/traces/${traceId}?workspaceId=default`
  });
  assert.equal(traceRes.status, 200);
  assert.ok(traceRes.body.trace);
  assert.ok(Array.isArray(traceRes.body.spans));
  assert.ok(Array.isArray(traceRes.body.events));
  assert.ok(traceRes.body.events.length >= 1);

  const evalRes = await callApi(api.handler, {
    method: "POST",
    url: `/api/evals/company/${runRes.body.run.id}`,
    body: {
      useLlmJudge: false
    }
  });
  assert.equal(evalRes.status, 200);
  assert.ok(evalRes.body.evaluation);
  assert.equal(typeof evalRes.body.evaluation.score, "number");
  assert.ok(evalRes.body.run.evaluation);
});

test("observability metrics include llm latency and token telemetry", async () => {
  const cwd = process.cwd();
  const api = createApi({
    cwd,
    persistPath: null,
    pluginsDir: path.join(cwd, "dist", "plugins"),
    autopilotAutoStart: false,
    heartbeatAutoStart: false,
    openaiApiKey: "test-key",
    openaiBaseUrl: "https://fake-openai.example/v1",
    fetchFn: async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "ok"
            }
          }
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30
        }
      })
    })
  });

  const llmRes = await callApi(api.handler, {
    method: "POST",
    url: "/api/llm/respond",
    body: {
      workspaceId: "default",
      provider: "openai",
      prompt: "Say ok"
    }
  });
  assert.equal(llmRes.status, 200);
  assert.equal(llmRes.body.completion.text, "ok");
  assert.equal(llmRes.body.completion.usageNormalized.totalTokens, 30);

  const metricsRes = await callApi(api.handler, {
    method: "GET",
    url: "/api/observability/metrics?workspaceId=default"
  });
  assert.equal(metricsRes.status, 200);
  assert.ok(metricsRes.body.metrics.byType["llm.attempt.success"] >= 1);
  assert.ok(metricsRes.body.metrics.byType["llm.request.success"] >= 1);
  assert.ok(metricsRes.body.metrics.latencyMs.count >= 1);
  assert.ok(metricsRes.body.metrics.tokenUsage.total >= 30);
});
