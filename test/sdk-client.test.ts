// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { SovereignApiError, SovereignClient } from "../src/sdk/sovereign-client.js";

test("sdk client performs typed request with query serialization", async () => {
  const calls = [];
  const client = new SovereignClient({
    baseUrl: "http://localhost:3001",
    fetchFn: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ runs: [] }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
  });

  const response = await client.listCompanyRuns({
    workspaceId: "default",
    status: "running",
    limit: 5
  });

  assert.deepEqual(response, { runs: [] });
  assert.match(calls[0].url, /\/api\/company\/runs\?/);
  assert.match(calls[0].url, /workspaceId=default/);
  assert.match(calls[0].url, /status=running/);
  assert.match(calls[0].url, /limit=5/);
  assert.equal(calls[0].init.method, "GET");
});

test("sdk client throws structured API error", async () => {
  const client = new SovereignClient({
    baseUrl: "http://localhost:3001",
    fetchFn: async () =>
      new Response(JSON.stringify({ error: "invalid objective" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json"
        }
      })
  });

  await assert.rejects(
    () =>
      client.executeCompanyObjective({
        objective: ""
      }),
    (error) => {
      assert.ok(error instanceof SovereignApiError);
      assert.equal(error.status, 400);
      assert.equal(error.payload.error, "invalid objective");
      return true;
    }
  );
});

test("sdk client exposes gateway helpers", async () => {
  const calls = [];
  const client = new SovereignClient({
    baseUrl: "http://localhost:3001",
    fetchFn: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
  });

  await client.invokeGatewayNode("host-node", {
    action: "location.get",
    input: {}
  });
  await client.getGatewayBridgeStatus();
  await client.listGatewayBridgeNodes();
  await client.planGatewayTailscale({ mode: "off" });

  assert.equal(calls[0].init.method, "POST");
  assert.match(calls[0].url, /\/api\/gateway\/nodes\/host-node\/invoke$/);
  assert.equal(calls[1].init.method, "GET");
  assert.match(calls[1].url, /\/api\/gateway\/bridge\/status$/);
  assert.equal(calls[2].init.method, "GET");
  assert.match(calls[2].url, /\/api\/gateway\/bridge\/nodes$/);
  assert.equal(calls[3].init.method, "POST");
  assert.match(calls[3].url, /\/api\/gateway\/tailscale\/plan$/);
});
