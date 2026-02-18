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

test("channel API exposes adapters and local webhook flow", async () => {
  const cwd = process.cwd();
  const api = createApi({
    cwd,
    persistPath: null,
    pluginsDir: path.join(cwd, "dist", "plugins")
  });

  const adaptersResponse = await callApi(api.handler, {
    method: "GET",
    url: "/api/channels/adapters"
  });
  assert.equal(adaptersResponse.status, 200);
  assert.ok(Array.isArray(adaptersResponse.body.adapters));
  assert.ok(adaptersResponse.body.adapters.some((item) => item.id === "local"));
  assert.ok(adaptersResponse.body.adapters.some((item) => item.id === "telegram"));

  const webhookResponse = await callApi(api.handler, {
    method: "POST",
    url: "/api/channels/local/webhook",
    body: {
      workspaceId: "default",
      chatId: "webchat-1",
      userId: "user-1",
      text: "hello from api"
    }
  });
  assert.equal(webhookResponse.status, 200);
  assert.equal(webhookResponse.body.processed, 1);
  assert.equal(Array.isArray(webhookResponse.body.responses), true);

  const sessionsResponse = await callApi(api.handler, {
    method: "GET",
    url: "/api/channels/sessions"
  });
  assert.equal(sessionsResponse.status, 200);
  assert.equal(sessionsResponse.body.sessions.length, 1);

  const sessionId = sessionsResponse.body.sessions[0].id;
  const messagesResponse = await callApi(api.handler, {
    method: "GET",
    url: `/api/channels/sessions/${sessionId}/messages`
  });
  assert.equal(messagesResponse.status, 200);
  assert.equal(messagesResponse.body.messages.length, 2);
});
