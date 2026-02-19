// @ts-nocheck
import http from "node:http";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../src/server.js";
import { MinimalWebSocketClient } from "../src/lib/websocket-client.js";

async function startTestServer(cwd) {
  const api = createApi({
    cwd,
    persistPath: null,
    pluginsDir: path.join(cwd, "dist", "plugins"),
    autopilotAutoStart: false,
    heartbeatAutoStart: false,
    port: 0
  });
  const server = http.createServer(api.handler);
  server.on("upgrade", (req, socket, head) => {
    const handledGateway =
      api.gatewayWebsocketService &&
      typeof api.gatewayWebsocketService.handleUpgrade === "function"
        ? api.gatewayWebsocketService.handleUpgrade(req, socket, head)
        : false;
    const handledBridge =
      !handledGateway &&
      api.deviceBridgeService &&
      typeof api.deviceBridgeService.handleUpgrade === "function"
        ? api.deviceBridgeService.handleUpgrade(req, socket, head)
        : false;
    if (!handledGateway && !handledBridge) {
      socket.destroy();
    }
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("error", onError);
      reject(error);
    };
    server.on("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve(null);
    });
  });
  const address = server.address();
  const port = Number(address?.port ?? 0);
  return { api, server, port };
}

test("device bridge registers companion node and serves remote node.invoke", async (t) => {
  const cwd = process.cwd();
  let serverInfo = null;
  try {
    serverInfo = await startTestServer(cwd);
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("sandbox does not allow opening local listen sockets");
      return;
    }
    throw error;
  }
  const { server, port } = serverInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/bridge/ws`;

  const bridgeClient = new MinimalWebSocketClient({ url: wsUrl });
  await bridgeClient.connect();

  const registerId = "register-1";
  const registerResponse = await bridgeClient.request(
    {
      id: registerId,
      method: "bridge.register",
      params: {
        node: {
          id: "macos-test-node",
          name: "macOS Test Node",
          type: "macos",
          platform: "darwin-arm64",
          capabilities: ["location.get"]
        }
      }
    },
    {
      timeoutMs: 10000,
      matcher: (message) => message?.id === registerId
    }
  );
  assert.equal(registerResponse.type, "result");
  assert.equal(registerResponse.result.registered, true);

  bridgeClient.on("json", (message) => {
    if (message?.method !== "bridge.invoke") {
      return;
    }
    bridgeClient.sendJson({
      type: "result",
      id: message.id,
      result: {
        from: "companion-test",
        action: message?.params?.action ?? null
      }
    });
  });

  const invokeResponse = await fetch(`${baseUrl}/api/gateway/nodes/macos-test-node/invoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      action: "location.get",
      input: {}
    })
  });
  const invokeBody = await invokeResponse.json();
  assert.equal(invokeResponse.status, 200);
  assert.equal(invokeBody.invocation.ok, true);
  assert.equal(invokeBody.invocation.nodeId, "macos-test-node");
  assert.equal(invokeBody.invocation.result.remote, true);
  assert.equal(invokeBody.invocation.result.from, "companion-test");
  assert.equal(invokeBody.invocation.result.action, "location.get");

  const bridgeNodesResponse = await fetch(`${baseUrl}/api/gateway/bridge/nodes`);
  const bridgeNodesBody = await bridgeNodesResponse.json();
  assert.equal(bridgeNodesResponse.status, 200);
  assert.equal(Array.isArray(bridgeNodesBody.nodes), true);
  assert.ok(bridgeNodesBody.nodes.some((item) => item.nodeId === "macos-test-node"));

  bridgeClient.close();
  await new Promise((resolve) => server.close(resolve));
});
