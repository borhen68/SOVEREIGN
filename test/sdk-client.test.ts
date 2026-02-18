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
