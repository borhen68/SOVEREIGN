// @ts-nocheck
import { nowIso } from "../lib/time.js";

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

function normalizeEntities(values, maxItems = 48) {
  if (!Array.isArray(values)) {
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const key = safeString(value?.key);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({
      key,
      name: safeString(value?.name, key),
      type: safeString(value?.type, "concept")
    });
    if (out.length >= maxItems) {
      break;
    }
  }
  return out;
}

function normalizeRelations(values, entityKeys = new Set(), maxItems = 128) {
  if (!Array.isArray(values)) {
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const from = safeString(value?.from);
    const to = safeString(value?.to);
    if (!from || !to || from === to) {
      continue;
    }
    if (entityKeys.size > 0 && (!entityKeys.has(from) || !entityKeys.has(to))) {
      continue;
    }
    const type = safeString(value?.type, "related_to")
      .toLowerCase()
      .replace(/\s+/g, "_");
    const key = `${from}|${type}|${to}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({
      from,
      to,
      type,
      evidence: safeString(value?.evidence).slice(0, 200)
    });
    if (out.length >= maxItems) {
      break;
    }
  }
  return out;
}

function safePreview(text, maxChars = 260) {
  const normalized = safeString(text);
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(8, maxChars - 3))}...`;
}

export class GraphRagService {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.uri = safeString(options.uri ?? process.env.MEMGRAPH_URI);
    this.user = safeString(options.user ?? process.env.MEMGRAPH_USER);
    this.password = safeString(options.password ?? process.env.MEMGRAPH_PASSWORD);
    this.database = safeString(options.database ?? process.env.MEMGRAPH_DATABASE);
    this.hopLimit = clampInt(options.hopLimit ?? process.env.MEMGRAPH_HOP_LIMIT, 2, 1, 4);
    this.defaultLimit = clampInt(options.defaultLimit ?? process.env.MEMGRAPH_SEARCH_LIMIT, 48, 1, 500);
    this.driverPromise = null;
    this.lastError = null;
    this.connectedAt = null;
  }

  isEnabled() {
    return this.enabled && Boolean(this.uri);
  }

  getStatus() {
    return {
      enabled: this.isEnabled(),
      configured: Boolean(this.uri),
      uri: this.uri,
      database: this.database || null,
      connectedAt: this.connectedAt,
      lastError: this.lastError
    };
  }

  async ingestDocument(input = {}) {
    if (!this.isEnabled()) {
      return { stored: false, reason: "memgraph_disabled" };
    }
    const workspaceId = safeString(input.workspaceId, "default");
    const docId = safeString(input.docId);
    if (!docId) {
      return { stored: false, reason: "missing_doc_id" };
    }
    const sourceId = safeString(input.sourceId, "source");
    const chunkIndex = Number.isFinite(Number(input.chunkIndex)) ? Number(input.chunkIndex) : 0;
    const textPreview = safePreview(input.text);
    const entities = normalizeEntities(input.entities);
    const entityKeys = new Set(entities.map((entity) => entity.key));
    const relations = normalizeRelations(input.relations, entityKeys);
    const updatedAt = nowIso();

    const driver = await this.#getDriver();
    if (!driver) {
      return { stored: false, reason: "driver_unavailable", error: this.lastError };
    }
    const session = driver.session(this.database ? { database: this.database } : undefined);
    try {
      await session.run(
        `
        MERGE (d:Document {id:$docId, workspaceId:$workspaceId})
        SET d.sourceId = $sourceId,
            d.chunkIndex = $chunkIndex,
            d.textPreview = $textPreview,
            d.updatedAt = $updatedAt
        `,
        {
          docId,
          workspaceId,
          sourceId,
          chunkIndex,
          textPreview,
          updatedAt
        }
      );

      if (entities.length > 0) {
        await session.run(
          `
          MATCH (d:Document {id:$docId, workspaceId:$workspaceId})
          UNWIND $entities AS entity
          MERGE (e:Entity {workspaceId:$workspaceId, key:entity.key})
          SET e.name = entity.name,
              e.type = entity.type,
              e.updatedAt = $updatedAt
          MERGE (d)-[:MENTIONS]->(e)
          `,
          {
            docId,
            workspaceId,
            entities,
            updatedAt
          }
        );
      }

      if (relations.length > 0) {
        await session.run(
          `
          UNWIND $relations AS relation
          MATCH (left:Entity {workspaceId:$workspaceId, key:relation.from})
          MATCH (right:Entity {workspaceId:$workspaceId, key:relation.to})
          MERGE (left)-[r:RELATES {workspaceId:$workspaceId, type:relation.type}]->(right)
          SET r.evidence = relation.evidence,
              r.updatedAt = $updatedAt
          `,
          {
            workspaceId,
            relations,
            updatedAt
          }
        );
      }

      return {
        stored: true,
        workspaceId,
        docId,
        entityCount: entities.length,
        relationCount: relations.length
      };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return {
        stored: false,
        workspaceId,
        docId,
        error: this.lastError
      };
    } finally {
      await session.close();
    }
  }

  async searchRelatedDocIds(input = {}) {
    if (!this.isEnabled()) {
      return [];
    }
    const workspaceId = safeString(input.workspaceId, "default");
    const seedDocIds = Array.isArray(input.seedDocIds)
      ? input.seedDocIds.map((item) => safeString(item)).filter(Boolean)
      : [];
    const entityKeys = Array.isArray(input.entityKeys)
      ? input.entityKeys.map((item) => safeString(item)).filter(Boolean)
      : [];
    const hops = clampInt(input.hops, this.hopLimit, 1, 4);
    const limit = clampInt(input.limit, this.defaultLimit, 1, 500);

    if (seedDocIds.length === 0 && entityKeys.length === 0) {
      return [];
    }

    const driver = await this.#getDriver();
    if (!driver) {
      return [];
    }
    const session = driver.session(this.database ? { database: this.database } : undefined);
    try {
      if (seedDocIds.length > 0) {
        const result = await session.run(
          `
          UNWIND $seedDocIds AS seedDocId
          MATCH (seed:Document {workspaceId:$workspaceId, id:seedDocId})-[:MENTIONS]->(seedEntity:Entity {workspaceId:$workspaceId})
          MATCH path = (seedEntity)-[:RELATES*0..${hops}]-(:Entity {workspaceId:$workspaceId})<-[:MENTIONS]-(other:Document {workspaceId:$workspaceId})
          WHERE other.id <> seed.id
          WITH other.id AS docId, count(path) AS pathScore, count(DISTINCT seedEntity) AS sharedSeedEntities
          RETURN docId, (pathScore + sharedSeedEntities) AS score
          ORDER BY score DESC
          LIMIT $limit
          `,
          {
            workspaceId,
            seedDocIds,
            limit
          }
        );
        return result.records.map((record) => ({
          docId: safeString(record.get("docId")),
          score: Number(record.get("score") ?? 0)
        }));
      }

      const result = await session.run(
        `
        UNWIND $entityKeys AS entityKey
        MATCH (seed:Entity {workspaceId:$workspaceId, key:entityKey})
        MATCH path = (seed)-[:RELATES*0..${hops}]-(:Entity {workspaceId:$workspaceId})<-[:MENTIONS]-(other:Document {workspaceId:$workspaceId})
        WITH other.id AS docId, count(path) AS score
        RETURN docId, score
        ORDER BY score DESC
        LIMIT $limit
        `,
        {
          workspaceId,
          entityKeys,
          limit
        }
      );
      return result.records.map((record) => ({
        docId: safeString(record.get("docId")),
        score: Number(record.get("score") ?? 0)
      }));
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return [];
    } finally {
      await session.close();
    }
  }

  async getStats(workspaceId = "default") {
    if (!this.isEnabled()) {
      return {
        enabled: false,
        nodes: 0,
        documentNodes: 0,
        entityNodes: 0,
        mentionEdges: 0,
        relationEdges: 0
      };
    }

    const driver = await this.#getDriver();
    if (!driver) {
      return {
        enabled: false,
        nodes: 0,
        documentNodes: 0,
        entityNodes: 0,
        mentionEdges: 0,
        relationEdges: 0,
        error: this.lastError
      };
    }
    const session = driver.session(this.database ? { database: this.database } : undefined);
    try {
      const result = await session.run(
        `
        MATCH (d:Document {workspaceId:$workspaceId})
        OPTIONAL MATCH (e:Entity {workspaceId:$workspaceId})
        OPTIONAL MATCH (:Document {workspaceId:$workspaceId})-[m:MENTIONS]->(:Entity {workspaceId:$workspaceId})
        OPTIONAL MATCH (:Entity {workspaceId:$workspaceId})-[r:RELATES {workspaceId:$workspaceId}]->(:Entity {workspaceId:$workspaceId})
        RETURN
          count(DISTINCT d) AS documentNodes,
          count(DISTINCT e) AS entityNodes,
          count(DISTINCT m) AS mentionEdges,
          count(DISTINCT r) AS relationEdges
        `,
        {
          workspaceId
        }
      );
      const row = result.records[0];
      const documentNodes = Number(row?.get("documentNodes") ?? 0);
      const entityNodes = Number(row?.get("entityNodes") ?? 0);
      const mentionEdges = Number(row?.get("mentionEdges") ?? 0);
      const relationEdges = Number(row?.get("relationEdges") ?? 0);
      return {
        enabled: true,
        nodes: documentNodes + entityNodes,
        documentNodes,
        entityNodes,
        mentionEdges,
        relationEdges
      };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return {
        enabled: false,
        nodes: 0,
        documentNodes: 0,
        entityNodes: 0,
        mentionEdges: 0,
        relationEdges: 0,
        error: this.lastError
      };
    } finally {
      await session.close();
    }
  }

  async close() {
    if (!this.driverPromise) {
      return;
    }
    try {
      const driver = await this.driverPromise;
      if (driver && typeof driver.close === "function") {
        await driver.close();
      }
    } catch {
      // best effort
    } finally {
      this.driverPromise = null;
    }
  }

  async #getDriver() {
    if (!this.isEnabled()) {
      return null;
    }
    if (this.driverPromise) {
      return this.driverPromise;
    }
    this.driverPromise = (async () => {
      try {
        const neo4j = await import("neo4j-driver");
        const auth =
          this.user || this.password
            ? neo4j.auth.basic(this.user, this.password)
            : neo4j.auth.none();
        const driver = neo4j.driver(this.uri, auth);
        await driver.verifyConnectivity();
        this.connectedAt = nowIso();
        this.lastError = null;
        return driver;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        return null;
      }
    })();
    return this.driverPromise;
  }
}

