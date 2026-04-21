// @ts-nocheck

const JsonObject = {
  type: "object",
  additionalProperties: true
};

function jsonResponse(schema = JsonObject) {
  return {
    200: {
      description: "Success",
      content: {
        "application/json": {
          schema
        }
      }
    }
  };
}

function idPathParam(name, description) {
  return [
    {
      name,
      in: "path",
      required: true,
      schema: { type: "string" },
      description
    }
  ];
}

function bodyRequest(required = false) {
  return {
    required,
    content: {
      "application/json": {
        schema: JsonObject
      }
    }
  };
}

export function buildOpenApiSpec(baseUrl = "http://localhost:3001") {
  return {
    openapi: "3.1.0",
    info: {
      title: "SOVEREIGN API",
      version: "0.1.0",
      description:
        "Autonomous multi-agent company API with missions, councils, memory, runtime trust, heartbeat, and autopilot."
    },
    servers: [{ url: baseUrl }],
    tags: [
      { name: "System" },
      { name: "Dashboard" },
      { name: "Setup" },
      { name: "Gateway" },
      { name: "LLM" },
      { name: "Agents" },
      { name: "Missions" },
      { name: "Council" },
      { name: "Company" },
      { name: "Autopilot" },
      { name: "Heartbeat" },
      { name: "Architecture" },
      { name: "Memory" },
      { name: "Security" },
      { name: "Observability" }
    ],
    paths: {
      "/health": {
        get: {
          tags: ["System"],
          operationId: "getHealth",
          responses: jsonResponse({
            type: "object",
            properties: {
              status: { type: "string" },
              service: { type: "string" }
            },
            required: ["status", "service"]
          })
        }
      },
      "/api/openapi": {
        get: {
          tags: ["System"],
          operationId: "getOpenApiSpec",
          responses: jsonResponse()
        }
      },
      "/api/openapi.json": {
        get: {
          tags: ["System"],
          operationId: "getOpenApiSpecJson",
          responses: jsonResponse()
        }
      },
      "/api/system/persistence": {
        get: {
          tags: ["System"],
          operationId: "getPersistenceStatus",
          responses: jsonResponse()
        }
      },
      "/api/dashboard/snapshot": {
        get: {
          tags: ["Dashboard"],
          operationId: "getDashboardSnapshot",
          responses: jsonResponse()
        }
      },
      "/api/setup/doctor": {
        get: {
          tags: ["Setup"],
          operationId: "getSetupDoctor",
          responses: jsonResponse()
        }
      },
      "/api/setup/wizard/run": {
        post: {
          tags: ["Setup"],
          operationId: "runSetupWizard",
          requestBody: bodyRequest(true),
          responses: jsonResponse()
        }
      },
      "/api/setup/wizard/runs": {
        get: {
          tags: ["Setup"],
          operationId: "listSetupWizardRuns",
          responses: jsonResponse()
        }
      },
      "/api/setup/wizard/{runId}": {
        get: {
          tags: ["Setup"],
          operationId: "getSetupWizardRun",
          parameters: idPathParam("runId", "Wizard run identifier"),
          responses: jsonResponse()
        }
      },
      "/api/gateway/status": {
        get: {
          tags: ["Gateway"],
          operationId: "getGatewayStatus",
          responses: jsonResponse()
        }
      },
      "/api/gateway/ws-info": {
        get: {
          tags: ["Gateway"],
          operationId: "getGatewayWsInfo",
          responses: jsonResponse()
        }
      },
      "/api/gateway/bridge/status": {
        get: {
          tags: ["Gateway"],
          operationId: "getGatewayBridgeStatus",
          responses: jsonResponse()
        }
      },
      "/api/gateway/bridge/ws-info": {
        get: {
          tags: ["Gateway"],
          operationId: "getGatewayBridgeWsInfo",
          responses: jsonResponse()
        }
      },
      "/api/gateway/bridge/nodes": {
        get: {
          tags: ["Gateway"],
          operationId: "listGatewayBridgeNodes",
          responses: jsonResponse()
        }
      },
      "/api/gateway/nodes": {
        get: {
          tags: ["Gateway"],
          operationId: "listGatewayNodes",
          responses: jsonResponse()
        }
      },
      "/api/gateway/nodes/register": {
        post: {
          tags: ["Gateway"],
          operationId: "registerGatewayNode",
          requestBody: bodyRequest(true),
          responses: jsonResponse()
        }
      },
      "/api/gateway/nodes/{nodeId}": {
        get: {
          tags: ["Gateway"],
          operationId: "getGatewayNode",
          parameters: idPathParam("nodeId", "Node identifier"),
          responses: jsonResponse()
        }
      },
      "/api/gateway/nodes/{nodeId}/invoke": {
        post: {
          tags: ["Gateway"],
          operationId: "invokeGatewayNode",
          parameters: idPathParam("nodeId", "Node identifier"),
          requestBody: bodyRequest(true),
          responses: jsonResponse()
        }
      },
      "/api/gateway/browser/status": {
        get: {
          tags: ["Gateway"],
          operationId: "getGatewayBrowserStatus",
          responses: jsonResponse()
        }
      },
      "/api/gateway/browser/start": {
        post: {
          tags: ["Gateway"],
          operationId: "startGatewayBrowser",
          responses: jsonResponse()
        }
      },
      "/api/gateway/browser/stop": {
        post: {
          tags: ["Gateway"],
          operationId: "stopGatewayBrowser",
          responses: jsonResponse()
        }
      },
      "/api/gateway/browser/targets": {
        get: {
          tags: ["Gateway"],
          operationId: "listGatewayBrowserTargets",
          responses: jsonResponse()
        }
      },
      "/api/gateway/browser/open": {
        post: {
          tags: ["Gateway"],
          operationId: "openGatewayBrowserUrl",
          requestBody: bodyRequest(true),
          responses: jsonResponse()
        }
      },
      "/api/gateway/browser/cdp": {
        post: {
          tags: ["Gateway"],
          operationId: "runGatewayBrowserCdp",
          requestBody: bodyRequest(true),
          responses: jsonResponse()
        }
      },
      "/api/gateway/tailscale/status": {
        get: {
          tags: ["Gateway"],
          operationId: "getGatewayTailscaleStatus",
          responses: jsonResponse()
        }
      },
      "/api/gateway/tailscale/plan": {
        post: {
          tags: ["Gateway"],
          operationId: "planGatewayTailscale",
          requestBody: bodyRequest(false),
          responses: jsonResponse()
        }
      },
      "/api/gateway/tailscale/apply": {
        post: {
          tags: ["Gateway"],
          operationId: "applyGatewayTailscale",
          requestBody: bodyRequest(false),
          responses: jsonResponse()
        }
      },
      "/api/llm/providers": {
        get: {
          tags: ["LLM"],
          operationId: "listLlmProviders",
          responses: jsonResponse()
        }
      },
      "/api/llm/models": {
        get: {
          tags: ["LLM"],
          operationId: "listLlmModels",
          responses: jsonResponse()
        }
      },
      "/api/llm/respond": {
        post: {
          tags: ["LLM"],
          operationId: "llmRespond",
          requestBody: bodyRequest(true),
          responses: jsonResponse()
        }
      },
      "/api/agents": {
        get: {
          tags: ["Agents"],
          operationId: "listAgents",
          responses: jsonResponse()
        },
        post: {
          tags: ["Agents"],
          operationId: "createAgent",
          requestBody: bodyRequest(true),
          responses: jsonResponse()
        }
      },
      "/api/agents/{agentId}": {
        get: {
          tags: ["Agents"],
          operationId: "getAgent",
          parameters: idPathParam("agentId", "Agent identifier"),
          responses: jsonResponse()
        },
        patch: {
          tags: ["Agents"],
          operationId: "updateAgent",
          parameters: idPathParam("agentId", "Agent identifier"),
          requestBody: bodyRequest(true),
          responses: jsonResponse()
        }
      },
      "/api/missions": {
        get: {
          tags: ["Missions"],
          operationId: "listMissions",
          responses: jsonResponse()
        },
        post: {
          tags: ["Missions"],
          operationId: "createMission",
          requestBody: bodyRequest(true),
          responses: jsonResponse()
        }
      },
      "/api/missions/{missionId}": {
        get: {
          tags: ["Missions"],
          operationId: "getMission",
          parameters: idPathParam("missionId", "Mission identifier"),
          responses: jsonResponse()
        }
      },
      "/api/missions/{missionId}/start": {
        post: {
          tags: ["Missions"],
          operationId: "startMission",
          parameters: idPathParam("missionId", "Mission identifier"),
          responses: jsonResponse()
        }
      },
      "/api/missions/{missionId}/tasks": {
        post: {
          tags: ["Missions"],
          operationId: "createMissionTask",
          parameters: idPathParam("missionId", "Mission identifier"),
          requestBody: bodyRequest(true),
          responses: jsonResponse()
        }
      },
      "/api/missions/{missionId}/tasks/{taskId}": {
        patch: {
          tags: ["Missions"],
          operationId: "updateMissionTask",
          parameters: [
            ...idPathParam("missionId", "Mission identifier"),
            ...idPathParam("taskId", "Task identifier")
          ],
          requestBody: bodyRequest(true),
          responses: jsonResponse()
        }
      },
      "/api/missions/{missionId}/council/run": {
        post: {
          tags: ["Council"],
          operationId: "runCouncil",
          parameters: idPathParam("missionId", "Mission identifier"),
          requestBody: bodyRequest(true),
          responses: jsonResponse()
        }
      },
      "/api/company/runs": {
        get: {
          tags: ["Company"],
          operationId: "listCompanyRuns",
          responses: jsonResponse()
        }
      },
      "/api/company/runs/{runId}": {
        get: {
          tags: ["Company"],
          operationId: "getCompanyRun",
          parameters: idPathParam("runId", "Company run identifier"),
          responses: jsonResponse()
        }
      },
      "/api/company/runs/{runId}/resume": {
        post: {
          tags: ["Company"],
          operationId: "resumeCompanyRun",
          parameters: idPathParam("runId", "Company run identifier"),
          requestBody: bodyRequest(true),
          responses: jsonResponse()
        }
      },
      "/api/company/execute": {
        post: {
          tags: ["Company"],
          operationId: "executeCompanyObjective",
          requestBody: bodyRequest(true),
          responses: jsonResponse()
        }
      },
      "/api/autopilot/goals": {
        get: {
          tags: ["Autopilot"],
          operationId: "listAutopilotGoals",
          responses: jsonResponse()
        },
        post: {
          tags: ["Autopilot"],
          operationId: "createAutopilotGoal",
          requestBody: bodyRequest(true),
          responses: jsonResponse()
        }
      },
      "/api/autopilot/goals/{goalId}": {
        get: {
          tags: ["Autopilot"],
          operationId: "getAutopilotGoal",
          parameters: idPathParam("goalId", "Autopilot goal identifier"),
          responses: jsonResponse()
        }
      },
      "/api/autopilot/goals/{goalId}/run": {
        post: {
          tags: ["Autopilot"],
          operationId: "runAutopilotGoal",
          parameters: idPathParam("goalId", "Autopilot goal identifier"),
          responses: jsonResponse()
        }
      },
      "/api/autopilot/goals/{goalId}/pause": {
        post: {
          tags: ["Autopilot"],
          operationId: "pauseAutopilotGoal",
          parameters: idPathParam("goalId", "Autopilot goal identifier"),
          responses: jsonResponse()
        }
      },
      "/api/autopilot/goals/{goalId}/resume": {
        post: {
          tags: ["Autopilot"],
          operationId: "resumeAutopilotGoal",
          parameters: idPathParam("goalId", "Autopilot goal identifier"),
          responses: jsonResponse()
        }
      },
      "/api/autopilot/goals/{goalId}/cancel": {
        post: {
          tags: ["Autopilot"],
          operationId: "cancelAutopilotGoal",
          parameters: idPathParam("goalId", "Autopilot goal identifier"),
          responses: jsonResponse()
        }
      },
      "/api/architecture/blueprint": {
        get: {
          tags: ["Architecture"],
          operationId: "getArchitectureBlueprint",
          responses: jsonResponse()
        }
      },
      "/api/architecture/company-plan": {
        post: {
          tags: ["Architecture"],
          operationId: "buildCompanyPlan",
          requestBody: bodyRequest(true),
          responses: jsonResponse()
        }
      },
      "/api/architecture/soul/evolve": {
        post: {
          tags: ["Architecture"],
          operationId: "evolveAgentSoul",
          requestBody: bodyRequest(true),
          responses: jsonResponse()
        }
      },
      "/api/architecture/soul/{agentId}/history": {
        get: {
          tags: ["Architecture"],
          operationId: "listSoulHistory",
          parameters: idPathParam("agentId", "Agent identifier"),
          responses: jsonResponse()
        }
      },
      "/api/architecture/soul/{agentId}/rollback": {
        post: {
          tags: ["Architecture"],
          operationId: "rollbackAgentSoul",
          parameters: idPathParam("agentId", "Agent identifier"),
          requestBody: bodyRequest(true),
          responses: jsonResponse()
        }
      },
      "/api/heartbeat/jobs": {
        get: {
          tags: ["Heartbeat"],
          operationId: "listHeartbeatJobs",
          responses: jsonResponse()
        },
        post: {
          tags: ["Heartbeat"],
          operationId: "createHeartbeatJob",
          requestBody: bodyRequest(true),
          responses: jsonResponse()
        }
      },
      "/api/heartbeat/jobs/{jobId}/run": {
        post: {
          tags: ["Heartbeat"],
          operationId: "runHeartbeatJob",
          parameters: idPathParam("jobId", "Heartbeat job identifier"),
          responses: jsonResponse()
        }
      },
      "/api/heartbeat/jobs/{jobId}/pause": {
        post: {
          tags: ["Heartbeat"],
          operationId: "pauseHeartbeatJob",
          parameters: idPathParam("jobId", "Heartbeat job identifier"),
          responses: jsonResponse()
        }
      },
      "/api/heartbeat/jobs/{jobId}/resume": {
        post: {
          tags: ["Heartbeat"],
          operationId: "resumeHeartbeatJob",
          parameters: idPathParam("jobId", "Heartbeat job identifier"),
          responses: jsonResponse()
        }
      },
      "/api/heartbeat/runs": {
        get: {
          tags: ["Heartbeat"],
          operationId: "listHeartbeatRuns",
          responses: jsonResponse()
        }
      },
      "/api/heartbeat/outbox": {
        get: {
          tags: ["Heartbeat"],
          operationId: "listNotificationOutbox",
          responses: jsonResponse()
        }
      },
      "/api/heartbeat/outbox/process": {
        post: {
          tags: ["Heartbeat"],
          operationId: "processNotificationOutbox",
          requestBody: bodyRequest(false),
          responses: jsonResponse()
        }
      },
      "/api/memory/index": {
        post: {
          tags: ["Memory"],
          operationId: "indexMemoryDocument",
          requestBody: bodyRequest(true),
          responses: jsonResponse()
        }
      },
      "/api/memory/search": {
        post: {
          tags: ["Memory"],
          operationId: "searchMemory",
          requestBody: bodyRequest(true),
          responses: jsonResponse()
        }
      },
      "/api/memory/reindex": {
        post: {
          tags: ["Memory"],
          operationId: "reindexMemory",
          requestBody: bodyRequest(false),
          responses: jsonResponse()
        }
      },
      "/api/observability/events": {
        get: {
          tags: ["Observability"],
          operationId: "listObservabilityEvents",
          responses: jsonResponse()
        }
      },
      "/api/observability/metrics": {
        get: {
          tags: ["Observability"],
          operationId: "getObservabilityMetrics",
          responses: jsonResponse()
        }
      },
      "/api/observability/traces": {
        get: {
          tags: ["Observability"],
          operationId: "listTraces",
          responses: jsonResponse()
        }
      },
      "/api/security/pairings": {
        get: {
          tags: ["Security"],
          operationId: "listSecurityPairings",
          responses: jsonResponse()
        }
      },
      "/api/security/auth/issue": {
        post: {
          tags: ["Security"],
          operationId: "issueSecurityAuthToken",
          requestBody: bodyRequest(true),
          responses: jsonResponse()
        }
      }
    },
    components: {
      schemas: {
        GenericObject: JsonObject,
        Error: {
          type: "object",
          properties: {
            error: { type: "string" }
          },
          required: ["error"]
        }
      }
    }
  };
}
