// @ts-nocheck
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { makeId } from "../lib/id.js";
import { nowIso } from "../lib/time.js";

const MAX_PAIRING_ATTEMPTS = 8;
const SYSTEM_PREFIXES = [
  "/bin",
  "/sbin",
  "/usr",
  "/etc",
  "/private",
  "/System",
  "/Library",
  "/Applications"
];

function safeString(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function clampInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function uniqueLower(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function timingSafeHashMatch(rawValue, expectedHashHex) {
  const a = Buffer.from(sha256(rawValue), "hex");
  const b = Buffer.from(String(expectedHashHex ?? ""), "hex");
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function xorBuffer(buffer, key) {
  const output = Buffer.alloc(buffer.length);
  for (let i = 0; i < buffer.length; i += 1) {
    output[i] = buffer[i] ^ key[i % key.length];
  }
  return output;
}

export class SecurityFabricService {
  constructor(options = {}) {
    this.store = options.store;
    this.cwd = options.cwd ?? process.cwd();
    this.workspaceRoot = path.resolve(options.workspaceRoot ?? this.cwd);
    this.rateWindowMs = clampInt(options.rateWindowMs ?? process.env.SECURITY_RATE_WINDOW_MS, 60000, 1000, 3600000);
    this.windowRequestCap = clampInt(
      options.windowRequestCap ?? process.env.SECURITY_WINDOW_REQUEST_CAP,
      60,
      1,
      100000
    );
    this.dayCostCap = clampInt(options.dayCostCap ?? process.env.SECURITY_DAY_COST_CAP, 1000, 1, 10000000);
    this.keyPath = path.resolve(options.keyPath ?? path.join(this.cwd, ".data", "security.key"));
    this.secretsPath = path.resolve(options.secretsPath ?? path.join(this.cwd, ".data", "secrets.enc"));
  }

  async listPairings(filters = {}) {
    return this.store.listSecurityPairings({
      workspaceId: filters.workspaceId ? safeString(filters.workspaceId) : undefined,
      channelId: filters.channelId ? safeString(filters.channelId).toLowerCase() : undefined,
      limit: clampInt(filters.limit, 100, 1, 1000)
    });
  }

  async createGatewayPairing(input = {}) {
    const workspaceId = safeString(input.workspaceId, "default");
    const channelId = safeString(input.channelId, "local").toLowerCase();
    const ttlSeconds = clampInt(input.ttlSeconds, 300, 30, 3600);
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    const bearerToken = crypto.randomBytes(18).toString("hex");
    const now = Date.now();
    const pairing = await this.store.createSecurityPairing({
      id: makeId("pair"),
      workspaceId,
      channelId,
      otpDigest: sha256(code),
      tokenDigest: sha256(bearerToken),
      attempts: 0,
      status: "pending",
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
      pairedAt: null
    });

    return {
      pairing: {
        ...pairing,
        otpDigest: undefined,
        tokenDigest: undefined
      },
      otp: code,
      bearerToken
    };
  }

  async verifyGatewayPairing(input = {}) {
    const pairingId = safeString(input.pairingId);
    if (!pairingId) {
      throw this.#badRequest("pairingId is required.");
    }
    const otp = safeString(input.otp);
    const bearerToken = safeString(input.bearerToken);
    if (!otp || !bearerToken) {
      throw this.#badRequest("otp and bearerToken are required.");
    }
    const pairing = await this.store.getSecurityPairingById(pairingId);
    if (!pairing) {
      throw this.#notFound("Pairing not found.");
    }
    if (pairing.status === "paired") {
      return {
        paired: true,
        reason: "already-paired",
        pairing
      };
    }

    if (Date.parse(pairing.expiresAt) <= Date.now()) {
      const expired = await this.store.updateSecurityPairing(pairing.id, {
        status: "expired",
        updatedAt: nowIso()
      });
      return {
        paired: false,
        reason: "expired",
        pairing: expired
      };
    }

    const attempts = Number(pairing.attempts ?? 0) + 1;
    const otpOk = timingSafeHashMatch(otp, pairing.otpDigest);
    const tokenOk = timingSafeHashMatch(bearerToken, pairing.tokenDigest);
    if (!otpOk || !tokenOk) {
      const nextStatus = attempts >= MAX_PAIRING_ATTEMPTS ? "blocked" : "pending";
      const updated = await this.store.updateSecurityPairing(pairing.id, {
        attempts,
        status: nextStatus,
        updatedAt: nowIso()
      });
      return {
        paired: false,
        reason: nextStatus === "blocked" ? "too-many-attempts" : "invalid-credentials",
        pairing: updated
      };
    }

    const updated = await this.store.updateSecurityPairing(pairing.id, {
      attempts,
      status: "paired",
      pairedAt: nowIso(),
      updatedAt: nowIso()
    });
    return {
      paired: true,
      reason: "ok",
      pairing: updated
    };
  }

  async issueAuthToken(input = {}) {
    const workspaceId = safeString(input.workspaceId, "default");
    const channelId = safeString(input.channelId, "local").toLowerCase();
    const scopes = uniqueLower(Array.isArray(input.scopes) ? input.scopes : ["chat:read", "chat:write"]);
    const ttlHours = clampInt(input.ttlHours, 24, 1, 24 * 30);
    const now = Date.now();
    const token = crypto.randomBytes(24).toString("hex");
    const created = await this.store.createSecurityAuthToken({
      id: makeId("auth"),
      workspaceId,
      channelId,
      scopes,
      tokenDigest: sha256(token),
      status: "active",
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlHours * 3600 * 1000).toISOString(),
      revokedAt: null
    });

    return {
      token,
      auth: {
        ...created,
        tokenDigest: undefined
      }
    };
  }

  async verifyAuthToken(input = {}) {
    const token = safeString(input.token);
    const workspaceId = safeString(input.workspaceId, "default");
    const channelId = safeString(input.channelId, "").toLowerCase();
    const requiredScope = safeString(input.requiredScope).toLowerCase();
    if (!token) {
      throw this.#badRequest("token is required.");
    }

    const tokens = await this.store.listSecurityAuthTokens({
      workspaceId,
      channelId: channelId || undefined,
      limit: 2000
    });
    const now = Date.now();
    for (const entry of tokens) {
      if (entry.status !== "active") {
        continue;
      }
      if (Date.parse(entry.expiresAt) <= now) {
        continue;
      }
      if (!timingSafeHashMatch(token, entry.tokenDigest)) {
        continue;
      }
      if (requiredScope && !Array.isArray(entry.scopes)) {
        continue;
      }
      if (requiredScope && !entry.scopes.includes(requiredScope)) {
        continue;
      }
      return {
        valid: true,
        reason: "ok",
        auth: {
          ...entry,
          tokenDigest: undefined
        }
      };
    }

    return {
      valid: false,
      reason: "invalid-or-expired"
    };
  }

  async checkRateLimit(input = {}) {
    const workspaceId = safeString(input.workspaceId, "default");
    const channelId = safeString(input.channelId, "local").toLowerCase();
    const now = Date.now();
    const cost = clampInt(input.cost, 1, 1, 100000);
    const windowSince = now - this.rateWindowMs;
    const daySince = now - 24 * 3600 * 1000;

    const events = await this.store.listSecurityRateEvents({
      workspaceId,
      channelId,
      limit: 50000
    });
    const windowEvents = events.filter((event) => Date.parse(event.createdAt) >= windowSince);
    const dayEvents = events.filter((event) => Date.parse(event.createdAt) >= daySince);

    const windowCount = windowEvents.length;
    const dayCost = dayEvents.reduce((sum, event) => sum + Number(event.cost ?? 0), 0);

    let allowed = true;
    let reason = "ok";
    if (windowCount + 1 > this.windowRequestCap) {
      allowed = false;
      reason = "rate-window-cap";
    } else if (dayCost + cost > this.dayCostCap) {
      allowed = false;
      reason = "day-cost-cap";
    }

    await this.store.createSecurityRateEvent({
      id: makeId("rate"),
      workspaceId,
      channelId,
      cost,
      allowed,
      reason,
      createdAt: nowIso()
    });

    return {
      allowed,
      reason,
      windowCount: windowCount + 1,
      windowCap: this.windowRequestCap,
      dayCost: dayCost + cost,
      dayCostCap: this.dayCostCap
    };
  }

  async listRateEvents(filters = {}) {
    return this.store.listSecurityRateEvents({
      workspaceId: filters.workspaceId ? safeString(filters.workspaceId) : undefined,
      channelId: filters.channelId ? safeString(filters.channelId).toLowerCase() : undefined,
      limit: clampInt(filters.limit, 200, 1, 2000)
    });
  }

  checkFilesystemPath(input = {}) {
    const targetPath = safeString(input.targetPath);
    if (!targetPath) {
      throw this.#badRequest("targetPath is required.");
    }
    if (targetPath.includes("\0")) {
      return {
        allowed: false,
        reason: "null-byte",
        normalizedPath: null
      };
    }

    const workspaceRoot = path.resolve(safeString(input.workspaceRoot, this.workspaceRoot));
    const resolved = path.resolve(workspaceRoot, targetPath);
    const mode = safeString(input.mode, "read").toLowerCase();

    if (!this.#isInsideRoot(resolved, workspaceRoot)) {
      return {
        allowed: false,
        reason: "path-traversal",
        normalizedPath: resolved
      };
    }

    for (const prefix of SYSTEM_PREFIXES) {
      if (resolved === prefix || resolved.startsWith(`${prefix}${path.sep}`)) {
        return {
          allowed: false,
          reason: "system-dir-blocked",
          normalizedPath: resolved
        };
      }
    }

    const basename = path.basename(resolved);
    if (basename.startsWith(".") && mode !== "read") {
      return {
        allowed: false,
        reason: "dotfile-write-blocked",
        normalizedPath: resolved
      };
    }

    if (fs.existsSync(resolved)) {
      const real = fs.realpathSync.native(resolved);
      if (!this.#isInsideRoot(real, workspaceRoot)) {
        return {
          allowed: false,
          reason: "symlink-escape",
          normalizedPath: real
        };
      }
    }

    return {
      allowed: true,
      reason: "ok",
      normalizedPath: resolved
    };
  }

  listSecretKeys(workspaceId = "default") {
    const map = this.#readSecretMap();
    const bucket = map[safeString(workspaceId, "default")] ?? {};
    return Object.keys(bucket).sort();
  }

  setSecret(input = {}) {
    const workspaceId = safeString(input.workspaceId, "default");
    const key = safeString(input.key).toLowerCase();
    const value = safeString(input.value);
    if (!key) {
      throw this.#badRequest("key is required.");
    }
    if (!value) {
      throw this.#badRequest("value is required.");
    }

    const map = this.#readSecretMap();
    if (!map[workspaceId] || typeof map[workspaceId] !== "object") {
      map[workspaceId] = {};
    }
    map[workspaceId][key] = value;
    this.#writeSecretMap(map);

    return {
      workspaceId,
      key,
      stored: true
    };
  }

  getSecret(input = {}) {
    const workspaceId = safeString(input.workspaceId, "default");
    const key = safeString(input.key).toLowerCase();
    if (!key) {
      throw this.#badRequest("key is required.");
    }
    const map = this.#readSecretMap();
    const value = map?.[workspaceId]?.[key];
    if (!value) {
      return {
        found: false,
        workspaceId,
        key
      };
    }
    return {
      found: true,
      workspaceId,
      key,
      value
    };
  }

  #isInsideRoot(candidate, root) {
    const normalizedRoot = path.resolve(root);
    const normalizedCandidate = path.resolve(candidate);
    return (
      normalizedCandidate === normalizedRoot ||
      normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)
    );
  }

  #ensureSecretKey() {
    if (!fs.existsSync(this.keyPath)) {
      fs.mkdirSync(path.dirname(this.keyPath), { recursive: true });
      fs.writeFileSync(this.keyPath, crypto.randomBytes(32), { mode: 0o600 });
      fs.chmodSync(this.keyPath, 0o600);
    }
    return fs.readFileSync(this.keyPath);
  }

  #readSecretMap() {
    if (!fs.existsSync(this.secretsPath)) {
      return {};
    }
    try {
      const key = this.#ensureSecretKey();
      const raw = fs.readFileSync(this.secretsPath, "utf8").trim();
      if (!raw) {
        return {};
      }

      if (raw.startsWith("{")) {
        const envelope = JSON.parse(raw);
        if (envelope?.v === 2 && envelope.iv && envelope.tag && envelope.ciphertext) {
          const iv = Buffer.from(String(envelope.iv), "base64");
          const tag = Buffer.from(String(envelope.tag), "base64");
          const ciphertext = Buffer.from(String(envelope.ciphertext), "base64");
          const decipher = crypto.createDecipheriv("aes-256-gcm", key.subarray(0, 32), iv);
          decipher.setAuthTag(tag);
          const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
          const parsed = JSON.parse(plain);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed;
          }
        }
      } else {
        const encrypted = Buffer.from(raw, "base64");
        const decrypted = xorBuffer(encrypted, key).toString("utf8");
        const parsed = JSON.parse(decrypted);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed;
        }
      }
      return {};
    } catch {
      return {};
    }
  }

  #writeSecretMap(map) {
    const key = this.#ensureSecretKey();
    const plain = Buffer.from(JSON.stringify(map), "utf8");
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key.subarray(0, 32), iv);
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    const envelope = {
      v: 2,
      alg: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      ciphertext: ciphertext.toString("base64")
    };
    fs.mkdirSync(path.dirname(this.secretsPath), { recursive: true });
    fs.writeFileSync(this.secretsPath, JSON.stringify(envelope), "utf8");
  }

  #badRequest(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
  }

  #notFound(message) {
    const error = new Error(message);
    error.statusCode = 404;
    return error;
  }
}
