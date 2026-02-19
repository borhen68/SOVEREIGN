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

test("gateway API exposes control plane status, nodes, browser, and tailscale plans", async () => {
  const cwd = process.cwd();
  const api = createApi({
    cwd,
    persistPath: null,
    pluginsDir: path.join(cwd, "dist", "plugins"),
    autopilotAutoStart: false,
    heartbeatAutoStart: false
  });

  const statusResponse = await callApi(api.handler, {
    method: "GET",
    url: "/api/gateway/status"
  });
  assert.equal(statusResponse.status, 200);
  assert.equal(typeof statusResponse.body.gateway?.wsPath, "string");
  assert.equal(typeof statusResponse.body.ws?.url, "string");
  assert.match(statusResponse.body.ws.url, /^ws:\/\//);

  const wsInfoResponse = await callApi(api.handler, {
    method: "GET",
    url: "/api/gateway/ws-info"
  });
  assert.equal(wsInfoResponse.status, 200);
  assert.equal(typeof wsInfoResponse.body.path, "string");
  assert.equal(typeof wsInfoResponse.body.url, "string");

  const bridgeStatusResponse = await callApi(api.handler, {
    method: "GET",
    url: "/api/gateway/bridge/status"
  });
  assert.equal(bridgeStatusResponse.status, 200);
  assert.equal(typeof bridgeStatusResponse.body.bridge?.path, "string");

  const bridgeWsInfoResponse = await callApi(api.handler, {
    method: "GET",
    url: "/api/gateway/bridge/ws-info"
  });
  assert.equal(bridgeWsInfoResponse.status, 200);
  assert.equal(typeof bridgeWsInfoResponse.body.path, "string");
  assert.equal(typeof bridgeWsInfoResponse.body.url, "string");

  const bridgeNodesResponse = await callApi(api.handler, {
    method: "GET",
    url: "/api/gateway/bridge/nodes"
  });
  assert.equal(bridgeNodesResponse.status, 200);
  assert.equal(Array.isArray(bridgeNodesResponse.body.nodes), true);

  const nodesResponse = await callApi(api.handler, {
    method: "GET",
    url: "/api/gateway/nodes"
  });
  assert.equal(nodesResponse.status, 200);
  assert.equal(Array.isArray(nodesResponse.body.nodes), true);
  assert.ok(nodesResponse.body.nodes.some((node) => node.id === "host-node"));

  const registerNodeResponse = await callApi(api.handler, {
    method: "POST",
    url: "/api/gateway/nodes/register",
    body: {
      id: "ios-node-1",
      name: "iPhone Node",
      type: "ios",
      capabilities: ["camera.snap", "screen.record"]
    }
  });
  assert.equal(registerNodeResponse.status, 201);
  assert.equal(registerNodeResponse.body.node.id, "ios-node-1");

  const getNodeResponse = await callApi(api.handler, {
    method: "GET",
    url: "/api/gateway/nodes/ios-node-1"
  });
  assert.equal(getNodeResponse.status, 200);
  assert.equal(getNodeResponse.body.node.id, "ios-node-1");

  const invokeResponse = await callApi(api.handler, {
    method: "POST",
    url: "/api/gateway/nodes/host-node/invoke",
    body: {
      action: "location.get",
      input: {}
    }
  });
  assert.equal(invokeResponse.status, 200);
  assert.equal(invokeResponse.body.invocation.ok, true);
  assert.equal(invokeResponse.body.invocation.action, "location.get");

  const browserStatusResponse = await callApi(api.handler, {
    method: "GET",
    url: "/api/gateway/browser/status"
  });
  assert.equal(browserStatusResponse.status, 200);
  assert.equal(typeof browserStatusResponse.body.browser?.enabled, "boolean");

  const tailscaleStatusResponse = await callApi(api.handler, {
    method: "GET",
    url: "/api/gateway/tailscale/status"
  });
  assert.equal(tailscaleStatusResponse.status, 200);
  assert.equal(typeof tailscaleStatusResponse.body.tailscale?.mode, "string");

  const tailscalePlanResponse = await callApi(api.handler, {
    method: "POST",
    url: "/api/gateway/tailscale/plan",
    body: {
      mode: "off"
    }
  });
  assert.equal(tailscalePlanResponse.status, 200);
  assert.equal(Array.isArray(tailscalePlanResponse.body.plan.commands), true);
});
