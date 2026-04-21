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

test("company API executes objective end-to-end", async () => {
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
      objective: "Plan sales growth, ship coding improvements, and improve reliability.",
      teamSize: 3,
      debateRounds: 2
    }
  });
  assert.equal(runRes.status, 201);
  assert.ok(runRes.body.run.id);
  assert.ok(["completed", "failed"].includes(runRes.body.run.status));
  assert.ok(runRes.body.run.missionId);

  const getRes = await callApi(api.handler, {
    method: "GET",
    url: `/api/company/runs/${runRes.body.run.id}`
  });
  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.run.id, runRes.body.run.id);

  const listRes = await callApi(api.handler, {
    method: "GET",
    url: "/api/company/runs?workspaceId=default"
  });
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.runs.some((item) => item.id === runRes.body.run.id), true);
});

test("company API pauses risky objective and resumes after human approval", async () => {
  const cwd = process.cwd();
  const api = createApi({
    cwd,
    persistPath: null,
    pluginsDir: path.join(cwd, "dist", "plugins"),
    autopilotAutoStart: false,
    heartbeatAutoStart: false
  });

  const pausedRes = await callApi(api.handler, {
    method: "POST",
    url: "/api/company/execute",
    body: {
      workspaceId: "default",
      objective: "Nuke staging database, then rebuild and verify integrity.",
      teamSize: 3,
      debateRounds: 2
    }
  });
  assert.equal(pausedRes.status, 201);
  assert.equal(pausedRes.body.run.status, "waiting_human");
  assert.ok(pausedRes.body.run.pendingEscalation);

  const resumeRes = await callApi(api.handler, {
    method: "POST",
    url: `/api/company/runs/${pausedRes.body.run.id}/resume`,
    body: {
      decision: "approve",
      note: "Proceed with controlled execution.",
      runtimePauseOnHighRiskStream: false,
      runtimePauseOnLowConsensus: false
    }
  });
  assert.equal(resumeRes.status, 200);
  assert.ok(["completed", "failed"].includes(resumeRes.body.run.status));
  assert.ok(resumeRes.body.run.evaluation);
});

test("company API pauses at runtime on low consensus and resumes from checkpoint", async () => {
  const cwd = process.cwd();
  const api = createApi({
    cwd,
    persistPath: null,
    pluginsDir: path.join(cwd, "dist", "plugins"),
    autopilotAutoStart: false,
    heartbeatAutoStart: false
  });

  let councilCalls = 0;
  api.councilService.runCouncil = async () => {
    councilCalls += 1;
    const artifactBody = [
      "# Workstream Deliverable",
      "",
      "## Strategic read",
      "- The team analyzed the objective and identified key execution milestones.",
      "- Evidence was collected from multiple internal and external sources to validate assumptions.",
      "- Risk assessment completed with mitigation strategies documented.",
      "",
      "## Recommended actions",
      "- Define owner-assigned tasks for each workstream.",
      "- Define KPI checkpoints for each milestone.",
      "- Validate assumptions against the cited external sources.",
      "",
      "## Risks and blockers",
      "- External evidence gap on certain workstreams requires further investigation."
    ].join("\n");
    return {
      id: `council-mock-${councilCalls}`,
      consensus: {
        consensusScore: 0.2
      },
      contributions: [
        {
          id: `contrib-mock-${councilCalls}`,
          trackTitle: "Execution",
          agentId: "agent-mock",
          agentName: "Mock Builder",
          agentSkills: ["engineering"],
          confidence: 0.5,
          keyInsights: ["Key insight from mock council analysis."],
          recommendedActions: [
            "Define owner-assigned tasks for each workstream.",
            "Define KPI checkpoints for each milestone."
          ],
          blockers: [],
          executionArtifact: {
            title: "Execution deliverable",
            format: "markdown",
            body: artifactBody,
            acceptanceCriteria: [
              "Includes at least one concrete deliverable or next step.",
              "Captures evidence used or explicitly names the evidence gap.",
              "Documents blockers, risks, or unresolved questions."
            ]
          },
          webFindings: []
        }
      ],
      finalBriefing: {
        recommendedPlan: [
          "Define owner-assigned tasks for each workstream.",
          "Define KPI checkpoints for each milestone.",
          "Validate assumptions against cited external sources."
        ]
      }
    };
  };

  const pausedRes = await callApi(api.handler, {
    method: "POST",
    url: "/api/company/execute",
    body: {
      workspaceId: "default",
      objective: "Build launch assets and execution checklist.",
      teamSize: 3,
      runtimePauseOnLowConsensus: true,
      runtimeLowConsensusThreshold: 0.9
    }
  });
  assert.equal(pausedRes.status, 201);
  assert.equal(pausedRes.body.run.status, "waiting_human");
  assert.equal(pausedRes.body.run.pendingEscalation.stage, "runtime_post_council");
  assert.ok(pausedRes.body.run.resumeState);
  assert.ok(Number(pausedRes.body.run.resumeState.nextWorkstreamIndex) >= 1);
  assert.ok(Array.isArray(pausedRes.body.run.resumeState.executionResults));
  assert.ok(pausedRes.body.run.resumeState.executionResults.length >= 1);

  const resumeRes = await callApi(api.handler, {
    method: "POST",
    url: `/api/company/runs/${pausedRes.body.run.id}/resume`,
    body: {
      decision: "approve",
      note: "Continue without low-consensus pauses.",
      runtimePauseOnLowConsensus: false
    }
  });
  assert.equal(resumeRes.status, 200);
  assert.ok(["completed", "failed"].includes(resumeRes.body.run.status));
  assert.ok(resumeRes.body.run.result);
  assert.ok(Array.isArray(resumeRes.body.run.result.executionResults));
});
