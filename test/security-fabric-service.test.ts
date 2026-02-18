// @ts-nocheck
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { DataStore } from "../src/store/data-store.js";
import { SecurityFabricService } from "../src/services/security-fabric-service.js";

function makeTempDir() {
  const dir = path.join(process.cwd(), ".data", `sec-test-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test("security fabric handles pairing, auth tokens, rate limits, sandbox checks, and secrets", async () => {
  const tempDir = makeTempDir();
  const service = new SecurityFabricService({
    store: new DataStore({ persistPath: null }),
    cwd: tempDir,
    workspaceRoot: tempDir,
    windowRequestCap: 2,
    dayCostCap: 3,
    rateWindowMs: 60000
  });

  const created = await service.createGatewayPairing({
    workspaceId: "default",
    channelId: "telegram"
  });
  assert.ok(created.pairing.id);
  const invalid = await service.verifyGatewayPairing({
    pairingId: created.pairing.id,
    otp: "000000",
    bearerToken: created.bearerToken
  });
  assert.equal(invalid.paired, false);

  const valid = await service.verifyGatewayPairing({
    pairingId: created.pairing.id,
    otp: created.otp,
    bearerToken: created.bearerToken
  });
  assert.equal(valid.paired, true);

  const issued = await service.issueAuthToken({
    workspaceId: "default",
    channelId: "telegram",
    scopes: ["chat:write"]
  });
  const verified = await service.verifyAuthToken({
    workspaceId: "default",
    channelId: "telegram",
    token: issued.token,
    requiredScope: "chat:write"
  });
  assert.equal(verified.valid, true);

  const rateA = await service.checkRateLimit({ workspaceId: "default", channelId: "api", cost: 1 });
  const rateB = await service.checkRateLimit({ workspaceId: "default", channelId: "api", cost: 1 });
  const rateC = await service.checkRateLimit({ workspaceId: "default", channelId: "api", cost: 1 });
  assert.equal(rateA.allowed, true);
  assert.equal(rateB.allowed, true);
  assert.equal(rateC.allowed, false);

  const safePath = service.checkFilesystemPath({
    workspaceRoot: tempDir,
    targetPath: "docs/note.md",
    mode: "write"
  });
  const escaped = service.checkFilesystemPath({
    workspaceRoot: tempDir,
    targetPath: "../../etc/passwd",
    mode: "read"
  });
  assert.equal(safePath.allowed, true);
  assert.equal(escaped.allowed, false);

  const set = service.setSecret({
    workspaceId: "default",
    key: "api_token",
    value: "secret-123"
  });
  const get = service.getSecret({
    workspaceId: "default",
    key: "api_token"
  });
  assert.equal(set.stored, true);
  assert.equal(get.found, true);
  assert.equal(get.value, "secret-123");
  assert.ok(fs.existsSync(path.join(tempDir, ".data", "security.key")));
  assert.ok(fs.existsSync(path.join(tempDir, ".data", "secrets.enc")));
});
