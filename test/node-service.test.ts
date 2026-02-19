// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { NodeService } from "../src/services/node-service.js";

test("node service routes non-host invocation through remote invoker", async () => {
  const calls = [];
  const service = new NodeService({
    hostNodeId: "host-node",
    remoteInvoker: async (input) => {
      calls.push(input);
      return {
        delivered: true,
        channel: "bridge"
      };
    }
  });

  service.registerNode({
    id: "remote-node-1",
    name: "Remote Node",
    type: "macos",
    platform: "darwin-arm64",
    capabilities: ["system.notify"]
  });

  const invocation = await service.invoke({
    nodeId: "remote-node-1",
    action: "system.notify",
    input: {
      message: "hello"
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].nodeId, "remote-node-1");
  assert.equal(calls[0].action, "system.notify");
  assert.equal(invocation.ok, true);
  assert.equal(invocation.nodeId, "remote-node-1");
  assert.equal(invocation.result.remote, true);
  assert.equal(invocation.result.channel, "bridge");
});
