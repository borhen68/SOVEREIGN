// @ts-nocheck
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function safeString(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function parseBool(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseMode(value) {
  const normalized = safeString(value, "file").toLowerCase();
  if (normalized === "postgres") {
    return "postgres";
  }
  if (normalized === "postgres_redis" || normalized === "postgres+redis") {
    return "postgres_redis";
  }
  if (normalized === "redis") {
    return "redis";
  }
  return "file";
}

function serializeState(state) {
  return JSON.stringify(state ?? {});
}

function deserializeState(payload) {
  if (!payload) {
    return null;
  }
  try {
    const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export class StateBackendService {
  constructor(options = {}) {
    this.mode = parseMode(options.mode ?? process.env.STATE_BACKEND);
    this.databaseUrl = safeString(options.databaseUrl ?? process.env.DATABASE_URL);
    this.redisUrl = safeString(options.redisUrl ?? process.env.REDIS_URL);
    this.tableName = safeString(options.tableName ?? process.env.STATE_BACKEND_TABLE, "sovereign_state");
    this.stateKey = safeString(options.stateKey ?? process.env.STATE_BACKEND_KEY, "default");
    this.redisKey = safeString(options.redisKey ?? process.env.STATE_REDIS_KEY, "sovereign:state:default");
    this.redisTtlSeconds = Number.isInteger(Number(options.redisTtlSeconds))
      ? Math.max(30, Number(options.redisTtlSeconds))
      : Number.isInteger(Number(process.env.STATE_REDIS_TTL_SECONDS))
        ? Math.max(30, Number(process.env.STATE_REDIS_TTL_SECONDS))
        : 3600;
    this.preferRedisRead = parseBool(
      options.preferRedisRead ?? process.env.STATE_PREFER_REDIS_READ ?? "false"
    );

    this.pgPool = null;
    this.redisClient = null;
    this.tableReady = false;
    this.lastLoad = {
      source: "none",
      at: null,
      ok: true,
      error: null
    };
    this.lastSave = {
      at: null,
      ok: true,
      error: null
    };

    this.#validateConfiguration();
  }

  isEnabled() {
    return this.mode !== "file";
  }

  async loadState() {
    if (!this.isEnabled()) {
      return null;
    }

    const canUseRedis = this.mode === "redis" || this.mode === "postgres_redis";
    const canUsePostgres = this.mode === "postgres" || this.mode === "postgres_redis";

    try {
      if (this.preferRedisRead && canUseRedis) {
        const cached = await this.#loadFromRedis();
        if (cached) {
          this.lastLoad = {
            source: "redis",
            at: new Date().toISOString(),
            ok: true,
            error: null
          };
          return cached;
        }
      }

      if (canUsePostgres) {
        const fromPg = await this.#loadFromPostgres();
        if (fromPg) {
          if (canUseRedis) {
            await this.#saveToRedis(fromPg);
          }
          this.lastLoad = {
            source: "postgres",
            at: new Date().toISOString(),
            ok: true,
            error: null
          };
          return fromPg;
        }
      }

      if (canUseRedis) {
        const cached = await this.#loadFromRedis();
        if (cached) {
          this.lastLoad = {
            source: "redis",
            at: new Date().toISOString(),
            ok: true,
            error: null
          };
          return cached;
        }
      }

      this.lastLoad = {
        source: "none",
        at: new Date().toISOString(),
        ok: true,
        error: null
      };
      return null;
    } catch (error) {
      this.lastLoad = {
        source: "error",
        at: new Date().toISOString(),
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
      return null;
    }
  }

  async saveState(state) {
    if (!this.isEnabled()) {
      return;
    }
    try {
      if (this.mode === "postgres" || this.mode === "postgres_redis") {
        await this.#saveToPostgres(state);
      }
      if (this.mode === "redis" || this.mode === "postgres_redis") {
        await this.#saveToRedis(state);
      }
      this.lastSave = {
        at: new Date().toISOString(),
        ok: true,
        error: null
      };
    } catch (error) {
      this.lastSave = {
        at: new Date().toISOString(),
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
      throw error;
    }
  }

  async getStatus() {
    return {
      enabled: this.isEnabled(),
      mode: this.mode,
      postgres: {
        enabled: this.mode === "postgres" || this.mode === "postgres_redis",
        configured: Boolean(this.databaseUrl),
        table: this.tableName
      },
      redis: {
        enabled: this.mode === "redis" || this.mode === "postgres_redis",
        configured: Boolean(this.redisUrl),
        key: this.redisKey,
        ttlSeconds: this.redisTtlSeconds
      },
      stateKey: this.stateKey,
      lastLoad: this.lastLoad,
      lastSave: this.lastSave
    };
  }

  async close() {
    if (this.pgPool) {
      await this.pgPool.end();
      this.pgPool = null;
      this.tableReady = false;
    }
    if (this.redisClient) {
      await this.redisClient.quit();
      this.redisClient = null;
    }
  }

  async #getPgPool() {
    if (this.pgPool) {
      return this.pgPool;
    }
    if (!this.databaseUrl) {
      throw new Error("DATABASE_URL is required for postgres state backend.");
    }
    let pgModule = null;
    try {
      pgModule = await import("pg");
    } catch {
      throw new Error("Missing dependency 'pg'. Install with: npm install pg");
    }
    const { Pool } = pgModule;
    this.pgPool = new Pool({
      connectionString: this.databaseUrl
    });
    return this.pgPool;
  }

  async #ensureTable() {
    if (this.tableReady) {
      return;
    }
    const pool = await this.#getPgPool();
    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${this.tableName} (
        state_key TEXT PRIMARY KEY,
        state_json JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    );
    this.tableReady = true;
  }

  async #loadFromPostgres() {
    await this.#ensureTable();
    const pool = await this.#getPgPool();
    const result = await pool.query(
      `SELECT state_json FROM ${this.tableName} WHERE state_key = $1 LIMIT 1`,
      [this.stateKey]
    );
    const payload = result?.rows?.[0]?.state_json ?? null;
    return deserializeState(payload);
  }

  async #saveToPostgres(state) {
    await this.#ensureTable();
    const pool = await this.#getPgPool();
    await pool.query(
      `INSERT INTO ${this.tableName} (state_key, state_json, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (state_key)
       DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = NOW()`,
      [this.stateKey, serializeState(state)]
    );
  }

  async #getRedisClient() {
    if (this.redisClient) {
      return this.redisClient;
    }
    if (!this.redisUrl) {
      throw new Error("REDIS_URL is required for redis state backend.");
    }
    let redisModule = null;
    try {
      redisModule = await import("redis");
    } catch {
      throw new Error("Missing dependency 'redis'. Install with: npm install redis");
    }
    const client = redisModule.createClient({
      url: this.redisUrl
    });
    client.on("error", () => {});
    await client.connect();
    this.redisClient = client;
    return this.redisClient;
  }

  async #loadFromRedis() {
    const client = await this.#getRedisClient();
    const payload = await client.get(this.redisKey);
    return deserializeState(payload);
  }

  async #saveToRedis(state) {
    const client = await this.#getRedisClient();
    const payload = serializeState(state);
    await client.set(this.redisKey, payload, {
      EX: this.redisTtlSeconds
    });
  }

  #validateConfiguration() {
    if (!this.isEnabled()) {
      return;
    }

    const requiresPostgres = this.mode === "postgres" || this.mode === "postgres_redis";
    const requiresRedis = this.mode === "redis" || this.mode === "postgres_redis";

    if (requiresPostgres && !this.databaseUrl) {
      throw new Error("DATABASE_URL is required when STATE_BACKEND uses postgres.");
    }
    if (requiresRedis && !this.redisUrl) {
      throw new Error("REDIS_URL is required when STATE_BACKEND uses redis.");
    }

    if (requiresPostgres) {
      try {
        require.resolve("pg");
      } catch {
        throw new Error("Missing dependency 'pg'. Install with: npm install pg");
      }
    }

    if (requiresRedis) {
      try {
        require.resolve("redis");
      } catch {
        throw new Error("Missing dependency 'redis'. Install with: npm install redis");
      }
    }
  }
}

export function createStateBackendService(options = {}) {
  const service = new StateBackendService(options);
  return service.isEnabled() ? service : null;
}
