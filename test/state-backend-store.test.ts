// @ts-nocheck
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import assert from "node:assert/strict";
import { DataStore } from "../src/store/data-store.js";
import { createApi } from "../src/server.js";
import { createStateBackendService } from "../src/infra/state-backend-service.js";

function callApi(handler, input) {
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
          body: payload ? JSON.parse(payload) : {}
        });
      }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

test("DataStore hydrates and persists through external backend adapter", async () => {
  const saved = [];
  const store = new DataStore({
    persistPath: null,
    externalPersistence: {
      async loadState() {
        return {
          missions: [
            {
              id: "mission_seed",
              title: "Seed mission"
            }
          ]
        };
      },
      async saveState(state) {
        saved.push(state);
      }
    }
  });

  await store.waitUntilReady();
  assert.equal(store.listMissions().length, 1);
  store.createMission({
    id: "mission_new",
    title: "New mission"
  });
  await store.waitForPersistence();
  assert.equal(saved.length >= 1, true);
  assert.equal(saved[saved.length - 1].missions.some((item) => item.id === "mission_new"), true);
});

test("system persistence endpoint returns backend status", async () => {
  const api = createApi({
    cwd: process.cwd(),
    persistPath: null,
    pluginsDir: path.join(process.cwd(), "dist", "plugins"),
    stateBackend: {
      async loadState() {
        return null;
      },
      async saveState() {},
      async getStatus() {
        return {
          enabled: true,
          mode: "postgres_redis",
          postgres: { enabled: true, configured: true, table: "sovereign_state" },
          redis: { enabled: true, configured: true, key: "sovereign:state:default", ttlSeconds: 3600 }
        };
      },
      async close() {}
    },
    autopilotAutoStart: false,
    heartbeatAutoStart: false
  });

  const response = await callApi(api.handler, {
    method: "GET",
    url: "/api/system/persistence"
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.backend.mode, "postgres_redis");
  assert.equal(response.body.backend.postgres.enabled, true);
});

test("state backend rejects unsafe SQL table identifiers", () => {
  assert.throws(
    () =>
      createStateBackendService({
        mode: "postgres",
        databaseUrl: "postgres://user:pass@localhost:5432/app",
        tableName: "state;drop_table"
      }),
    /STATE_BACKEND_TABLE must be a valid SQL identifier/
  );
});
