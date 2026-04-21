// @ts-nocheck
import { makeId } from "../lib/id.js";
import { nowIso } from "../lib/time.js";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "there",
  "this",
  "to",
  "was",
  "we",
  "with",
  "you",
  "your"
]);

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

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function tokenize(input) {
  return String(input ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function makeTokenFreq(tokens) {
  const freq = new Map();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }
  return freq;
}

function tokenizeWithFreq(text) {
  return makeTokenFreq(tokenize(text));
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  const limit = Math.max(a.length, b.length);
  for (let i = 0; i < limit; i += 1) {
    const av = Number(a[i] ?? 0);
    const bv = Number(b[i] ?? 0);
    dot += av * bv;
    aNorm += av * av;
    bNorm += bv * bv;
  }
  if (!aNorm || !bNorm) {
    return 0;
  }
  return dot / Math.sqrt(aNorm * bNorm);
}

function splitMarkdownChunks(text, maxChunkChars = 900) {
  const raw = String(text ?? "");
  if (!raw.trim()) {
    return [];
  }
  const lines = raw.split(/\r?\n/);
  const chunks = [];
  let current = [];
  let currentHeading = "";

  const flush = () => {
    if (current.length === 0) {
      return;
    }
    chunks.push(`${currentHeading ? `${currentHeading}\n` : ""}${current.join("\n")}`.trim());
    current = [];
  };

  for (const line of lines) {
    const isHeading = /^#{1,6}\s+/.test(line);
    if (isHeading) {
      flush();
      currentHeading = line.trim();
      continue;
    }
    current.push(line);
    const joined = current.join("\n");
    if (joined.length >= maxChunkChars) {
      flush();
    }
  }
  flush();
  if (chunks.length === 0) {
    return [raw.slice(0, maxChunkChars)];
  }
  return chunks;
}

async function fetchEmbedding(text, dim = 1536) {
  const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return hashToVector(text, dim);
  }
  try {
    const isOpenRouter = Boolean(process.env.OPENROUTER_API_KEY);
    const baseUrl = process.env.OPENAI_BASE_URL ?? (isOpenRouter ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1");
    // Default to a widely supported embedding model on OpenRouter, or OpenAI's text-embedding-3-small
    const model = process.env.EMBEDDING_MODEL ?? (isOpenRouter ? "openai/text-embedding-3-small" : "text-embedding-3-small");

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://sovereign-agent.io",
        "X-Title": "SOVEREIGN Agent"
      },
      body: JSON.stringify({ input: text, model }),
      signal: controller.signal
    });
    clearTimeout(id);

    if (res.ok) {
      const data = await res.json();
      const vec = data.data?.[0]?.embedding;
      if (Array.isArray(vec)) {
        if (vec.length === dim) return vec;
        if (vec.length > dim) return vec.slice(0, dim);
        const padded = Array(dim).fill(0);
        for (let i = 0; i < vec.length; i++) padded[i] = vec[i];
        return padded;
      }
    }
  } catch (err) {
    // Ignore and fallback
  }
  return hashToVector(text, dim);
}

function hashToVector(text, dim = 64) {
  const vector = Array.from({ length: dim }, () => 0);
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    return vector;
  }
  for (const token of tokens) {
    let hash = 2166136261;
    for (let i = 0; i < token.length; i += 1) {
      hash ^= token.charCodeAt(i);
      hash *= 16777619;
      hash >>>= 0;
    }
    const idx = hash % dim;
    vector[idx] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / norm).toFixed(6)));
}

function mapToObject(map) {
  const out = {};
  for (const [key, value] of map.entries()) {
    out[key] = value;
  }
  return out;
}

function objectToMap(input) {
  const map = new Map();
  if (!input || typeof input !== "object") {
    return map;
  }
  for (const [key, value] of Object.entries(input)) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) {
      continue;
    }
    map.set(key, num);
  }
  return map;
}

function normalizeConcept(input) {
  const normalized = String(input ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized.length < 3) {
    return "";
  }
  if (STOP_WORDS.has(normalized)) {
    return "";
  }
  return normalized;
}

function dedupeStrings(values, maxItems = 64) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeConcept(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= maxItems) {
      break;
    }
  }
  return out;
}

function extractConcepts(text, maxConcepts = 18) {
  const tokens = tokenize(text).filter((token) => token.length >= 3);
  if (tokens.length === 0) {
    return [];
  }
  const tokenFreq = makeTokenFreq(tokens);
  const bigramFreq = new Map();
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const left = tokens[i];
    const right = tokens[i + 1];
    if (left.length < 3 || right.length < 3) {
      continue;
    }
    const phrase = `${left} ${right}`;
    bigramFreq.set(phrase, (bigramFreq.get(phrase) ?? 0) + 1);
  }

  const ranked = [
    ...[...bigramFreq.entries()].map(([concept, count]) => ({
      concept,
      score: count + 0.25
    })),
    ...[...tokenFreq.entries()].map(([concept, count]) => ({
      concept,
      score: count
    }))
  ]
    .sort((a, b) => b.score - a.score || a.concept.localeCompare(b.concept))
    .map((entry) => entry.concept);

  return dedupeStrings(ranked, Math.max(1, maxConcepts));
}

function overlapCount(left = [], right = []) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || right.length === 0) {
    return 0;
  }
  const rightSet = new Set(right);
  let overlap = 0;
  for (const value of left) {
    if (rightSet.has(value)) {
      overlap += 1;
    }
  }
  return overlap;
}

const ENTITY_TYPES = Object.freeze({
  ORGANIZATION: "organization",
  PERSON: "person",
  PRODUCT: "product",
  SYSTEM: "system",
  TASK: "task",
  METRIC: "metric",
  CONCEPT: "concept"
});

function canonicalEntityKey(name) {
  return normalizeConcept(name).replace(/\s+/g, "_").slice(0, 80);
}

function classifyEntityType(name) {
  const normalized = normalizeConcept(name);
  if (!normalized) {
    return ENTITY_TYPES.CONCEPT;
  }
  if (/\b(inc|corp|llc|ltd|company|team|group|org|foundation)\b/.test(normalized)) {
    return ENTITY_TYPES.ORGANIZATION;
  }
  if (/\b(api|sdk|model|service|platform|engine|agent|workflow)\b/.test(normalized)) {
    return ENTITY_TYPES.SYSTEM;
  }
  if (/\b(kpi|revenue|mrr|arr|latency|throughput|conversion|cost|score)\b/.test(normalized)) {
    return ENTITY_TYPES.METRIC;
  }
  if (/\b(task|ticket|milestone|objective|roadmap|plan)\b/.test(normalized)) {
    return ENTITY_TYPES.TASK;
  }
  if (/\b(gpt|claude|gemini|openai|anthropic|google|mistral|groq)\b/.test(normalized)) {
    return ENTITY_TYPES.PRODUCT;
  }
  if (/^[a-z]+(?:\s+[a-z]+){1,2}$/.test(normalized) && !/\d/.test(normalized)) {
    return ENTITY_TYPES.CONCEPT;
  }
  return ENTITY_TYPES.CONCEPT;
}

function splitSentences(text) {
  return String(text ?? "")
    .split(/[\n\r.!?;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function extractEntities(text, concepts = [], maxEntities = 24) {
  const raw = String(text ?? "");
  const candidates = [];

  const properNouns = raw.match(/\b[A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,2}\b/g) ?? [];
  const acronyms = raw.match(/\b[A-Z]{2,}(?:-[A-Z0-9]+)?\b/g) ?? [];
  const conceptCandidates = Array.isArray(concepts)
    ? concepts.filter((item) => String(item ?? "").trim().split(/\s+/).length <= 3)
    : [];

  candidates.push(...properNouns, ...acronyms, ...conceptCandidates);

  const entities = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const name = safeString(candidate);
    if (!name) {
      continue;
    }
    const key = canonicalEntityKey(name);
    if (!key || STOP_WORDS.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    entities.push({
      key,
      name,
      type: classifyEntityType(name)
    });
    if (entities.length >= maxEntities) {
      break;
    }
  }
  return entities;
}

const RELATION_HINTS = [
  { type: "depends_on", pattern: /\bdepends on\b/ },
  { type: "reports_to", pattern: /\breports to\b/ },
  { type: "uses", pattern: /\buses?\b/ },
  { type: "owns", pattern: /\bowns?\b/ },
  { type: "manages", pattern: /\bmanages?\b/ },
  { type: "improves", pattern: /\bimproves?\b/ },
  { type: "requires", pattern: /\brequires?\b/ },
  { type: "blocks", pattern: /\bblocks?\b/ },
  { type: "enables", pattern: /\benables?\b/ }
];

function extractRelations(text, entities = [], maxRelations = 40) {
  const entityList = Array.isArray(entities) ? entities : [];
  if (entityList.length < 2) {
    return [];
  }
  const relations = [];
  const seen = new Set();
  const sentences = splitSentences(text);

  for (const sentence of sentences) {
    const lowerSentence = sentence.toLowerCase();
    const mentioned = entityList.filter((entity) => {
      const name = safeString(entity.name).toLowerCase();
      const keyAsWords = safeString(entity.key).replace(/_/g, " ").toLowerCase();
      return (name && lowerSentence.includes(name)) || (keyAsWords && lowerSentence.includes(keyAsWords));
    });
    if (mentioned.length < 2) {
      continue;
    }

    let relationType = "related_to";
    for (const hint of RELATION_HINTS) {
      if (hint.pattern.test(lowerSentence)) {
        relationType = hint.type;
        break;
      }
    }

    for (let i = 0; i < mentioned.length - 1; i += 1) {
      const from = mentioned[i];
      const to = mentioned[i + 1];
      if (!from?.key || !to?.key || from.key === to.key) {
        continue;
      }
      const signature = `${from.key}|${relationType}|${to.key}`;
      if (seen.has(signature)) {
        continue;
      }
      seen.add(signature);
      relations.push({
        from: from.key,
        to: to.key,
        type: relationType,
        evidence: sentence.slice(0, 180)
      });
      if (relations.length >= maxRelations) {
        return relations;
      }
    }
  }

  return relations;
}

export class MemoryEngineService {
  constructor(options = {}) {
    this.store = options.store;
    this.graphRagService = options.graphRagService ?? null;
    this.vectorDim = clampInt(options.vectorDim, 1536, 8, 8192);
    this.chunkChars = clampInt(options.chunkChars, 900, 200, 4000);
    this.hybridAlpha = Number.isFinite(Number(options.hybridAlpha))
      ? Math.max(0, Math.min(1, Number(options.hybridAlpha)))
      : 0.55;
    this.embeddingCacheMax = clampInt(options.embeddingCacheMax, 5000, 100, 100000);
    this.graphMaxConcepts = clampInt(options.graphMaxConcepts, 18, 4, 64);
    this.graphEdgeLimit = clampInt(options.graphEdgeLimit, 10, 2, 64);
    this.graphHopLimit = clampInt(options.graphHopLimit, 2, 1, 4);
    this.graphDecay = clampNumber(options.graphDecay, 0.7, 0.1, 0.95);
    this.graphBoost = clampNumber(options.graphBoost, 0.2, 0, 2);
    this.graphRagBoost = clampNumber(options.graphRagBoost, 0.12, 0, 2);
    this.embeddingCache = new Map();
  }

  async indexDocument(input = {}) {
    const workspaceId = safeString(input.workspaceId, "default");
    const sourceId = safeString(input.sourceId, makeId("source"));
    const text = safeString(input.text);
    if (!text) {
      throw this.#badRequest("text is required.");
    }
    const metadata = input.metadata && typeof input.metadata === "object" ? input.metadata : {};
    const chunks = splitMarkdownChunks(text, this.chunkChars);
    const now = nowIso();
    const created = [];

    for (let i = 0; i < chunks.length; i += 1) {
      const chunkText = chunks[i];
      const tokenFreq = tokenizeWithFreq(chunkText);
      const vector = await this.#embedCached(chunkText);
      const concepts = extractConcepts(chunkText, this.graphMaxConcepts);
      const entities = extractEntities(chunkText, concepts, this.graphMaxConcepts);
      const relations = extractRelations(chunkText, entities, this.graphMaxConcepts * 2);
      const entry = this.store.createMemoryDocument({
        id: makeId("mem"),
        workspaceId,
        sourceId,
        chunkIndex: i,
        text: chunkText,
        metadata,
        tokenFreq: mapToObject(tokenFreq),
        vector,
        graph: {
          concepts,
          entities,
          relations,
          edges: []
        },
        createdAt: now,
        updatedAt: now
      });
      created.push(entry);
    }

    const graph = this.#rebuildWorkspaceGraph(workspaceId);
    this.#syncGraphRagDocuments(created).catch(() => {});
    return {
      workspaceId,
      sourceId,
      chunksIndexed: created.length,
      ids: created.map((item) => item.id),
      graph,
      graphRag: this.graphRagService?.getStatus ? this.graphRagService.getStatus() : null
    };
  }

  async search(input = {}) {
    const workspaceId = safeString(input.workspaceId, "default");
    const query = safeString(input.query);
    if (!query) {
      throw this.#badRequest("query is required.");
    }
    const limit = clampInt(input.limit, 8, 1, 100);
    const docs = this.store.listMemoryDocuments({
      workspaceId,
      limit: clampInt(input.scanLimit, 5000, 1, 50000)
    });
    if (docs.length === 0) {
      return {
        hits: [],
        total: 0
      };
    }

    const queryFreq = tokenizeWithFreq(query);
    const queryVector = await this.#embedCached(query);
    const queryConcepts = extractConcepts(query, this.graphMaxConcepts);
    const queryEntities = extractEntities(query, queryConcepts, this.graphMaxConcepts);
    const queryEntityKeys = queryEntities.map((entity) => entity.key);
    const queryRelationTypes = [...new Set(extractRelations(query, queryEntities).map((item) => item.type))];
    const docFrequency = this.#buildDocFrequency(docs);
    const docCount = docs.length;
    const graphIndex = this.#buildGraphIndex(docs);

    const base = docs.map((doc) => {
      const tokenFreq = objectToMap(doc.tokenFreq);
      const keywordScore = this.#scoreKeyword(queryFreq, tokenFreq, docFrequency, docCount);
      const vectorScore = cosineSimilarity(queryVector, Array.isArray(doc.vector) ? doc.vector : []);
      const hybridScore = this.hybridAlpha * vectorScore + (1 - this.hybridAlpha) * keywordScore;
      const concepts = graphIndex.conceptsByDoc.get(doc.id) ?? [];
      const conceptOverlap = overlapCount(queryConcepts, concepts);
      const entities = graphIndex.entitiesByDoc.get(doc.id) ?? [];
      const relationTypes = graphIndex.relationTypesByDoc.get(doc.id) ?? [];
      const entityOverlap = overlapCount(
        queryEntityKeys,
        entities.map((entity) => entity.key)
      );
      const relationOverlap = overlapCount(queryRelationTypes, relationTypes);
      return {
        doc,
        keywordScore,
        vectorScore,
        baseHybridScore: hybridScore,
        conceptOverlap,
        entityOverlap,
        relationOverlap
      };
    });

    const graphScores = this.#scoreGraphContext(base, graphIndex.edgesByDoc, {
      seedLimit: clampInt(input.graphSeedLimit, 4, 1, 16),
      hops: clampInt(input.graphHops, this.graphHopLimit, 1, 4)
    });
    const graphSeedLimit = clampInt(input.graphSeedLimit, 4, 1, 16);
    const graphRagScores = await this.#searchGraphRagContext({
      workspaceId,
      base,
      seedLimit: graphSeedLimit,
      entityKeys: queryEntityKeys,
      relationTypes: queryRelationTypes,
      hops: clampInt(input.graphHops, this.graphHopLimit, 1, 4)
    });

    const scored = base
      .map((item) => {
        const graphScore = graphScores.get(item.doc.id) ?? 0;
        const graphRagScore = graphRagScores.get(item.doc.id) ?? 0;
        const score =
          item.baseHybridScore +
          this.graphBoost * graphScore +
          this.graphRagBoost * graphRagScore;
        return {
          id: item.doc.id,
          workspaceId: item.doc.workspaceId,
          sourceId: item.doc.sourceId,
          chunkIndex: item.doc.chunkIndex,
          text: item.doc.text,
          metadata: item.doc.metadata ?? {},
          graph: {
            concepts: graphIndex.conceptsByDoc.get(item.doc.id) ?? [],
            entities: graphIndex.entitiesByDoc.get(item.doc.id) ?? [],
            relationTypes: graphIndex.relationTypesByDoc.get(item.doc.id) ?? []
          },
          scores: {
            hybrid: Number(score.toFixed(6)),
            baseHybrid: Number(item.baseHybridScore.toFixed(6)),
            vector: Number(item.vectorScore.toFixed(6)),
            keyword: Number(item.keywordScore.toFixed(6)),
            graph: Number(graphScore.toFixed(6)),
            graphRag: Number(graphRagScore.toFixed(6)),
            conceptOverlap: item.conceptOverlap,
            entityOverlap: item.entityOverlap,
            relationOverlap: item.relationOverlap
          }
        };
      })
      .sort((a, b) => b.scores.hybrid - a.scores.hybrid)
      .slice(0, limit);

    return {
      hits: scored,
      total: docs.length,
      queryConcepts,
      queryEntities,
      queryRelationTypes,
      graphRagContextHits: graphRagScores.size
    };
  }

  queryGraph(input = {}) {
    const workspaceId = safeString(input.workspaceId, "default");
    const query = safeString(input.query);
    if (!query) {
      throw this.#badRequest("query is required.");
    }
    const limit = clampInt(input.limit, 24, 1, 250);
    const hops = clampInt(input.hops, this.graphHopLimit, 1, 4);
    const docs = this.store.listMemoryDocuments({
      workspaceId,
      limit: clampInt(input.scanLimit, 5000, 1, 50000)
    });
    if (docs.length === 0) {
      return {
        workspaceId,
        query,
        queryConcepts: [],
        nodes: [],
        edges: [],
        totalNodes: 0,
        totalEdges: 0
      };
    }

    const graphIndex = this.#buildGraphIndex(docs);
    const queryConcepts = extractConcepts(query, this.graphMaxConcepts);
    const seeds = docs
      .map((doc) => ({
        doc,
        overlap: overlapCount(queryConcepts, graphIndex.conceptsByDoc.get(doc.id) ?? [])
      }))
      .filter((item) => item.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, Math.min(8, limit));

    if (seeds.length === 0) {
      return {
        workspaceId,
        query,
        queryConcepts,
        nodes: [],
        edges: [],
        totalNodes: 0,
        totalEdges: 0
      };
    }

    const selected = new Set();
    const queue = seeds.map((item) => ({
      id: item.doc.id,
      depth: 0
    }));
    while (queue.length > 0 && selected.size < limit) {
      const current = queue.shift();
      if (!current || selected.has(current.id)) {
        continue;
      }
      selected.add(current.id);
      if (current.depth >= hops) {
        continue;
      }
      const neighbors = graphIndex.edgesByDoc.get(current.id) ?? [];
      for (const edge of neighbors) {
        if (selected.has(edge.to)) {
          continue;
        }
        queue.push({
          id: edge.to,
          depth: current.depth + 1
        });
      }
    }

    const docsById = new Map(docs.map((doc) => [doc.id, doc]));
    const nodes = [...selected]
      .map((id) => {
        const doc = docsById.get(id);
        if (!doc) {
          return null;
        }
        return {
          id: doc.id,
          sourceId: doc.sourceId,
          chunkIndex: doc.chunkIndex,
          preview: String(doc.text ?? "").slice(0, 200),
          concepts: graphIndex.conceptsByDoc.get(doc.id) ?? [],
          entities: graphIndex.entitiesByDoc.get(doc.id) ?? [],
          relations: graphIndex.relationsByDoc.get(doc.id) ?? [],
          metadata: doc.metadata ?? {}
        };
      })
      .filter(Boolean);

    const edgeKey = new Set();
    const edges = [];
    for (const from of selected) {
      const fromEdges = graphIndex.edgesByDoc.get(from) ?? [];
      for (const edge of fromEdges) {
        if (!selected.has(edge.to)) {
          continue;
        }
        const key = [from, edge.to].sort().join("::");
        if (edgeKey.has(key)) {
          continue;
        }
        edgeKey.add(key);
        edges.push({
          from,
          to: edge.to,
          weight: edge.weight,
          sharedConcepts: edge.sharedConcepts,
          sharedEntities: edge.sharedEntities ?? [],
          relationTypes: edge.relationTypes ?? []
        });
      }
    }

    return {
      workspaceId,
      query,
      queryConcepts,
      nodes,
      edges,
      totalNodes: nodes.length,
      totalEdges: edges.length
    };
  }

  reindexWorkspace(input = {}) {
    const workspaceId = safeString(input.workspaceId, "default");
    const docs = this.store.listMemoryDocuments({
      workspaceId,
      limit: 100000
    });
    let updated = 0;
    for (const doc of docs) {
      const tokenFreq = tokenizeWithFreq(doc.text);
      const vector = this.#embedCached(doc.text);
      const concepts = extractConcepts(doc.text, this.graphMaxConcepts);
      const entities = extractEntities(doc.text, concepts, this.graphMaxConcepts);
      const relations = extractRelations(doc.text, entities, this.graphMaxConcepts * 2);
      const patched = this.store.updateMemoryDocument(doc.id, {
        tokenFreq: mapToObject(tokenFreq),
        vector,
        graph: {
          concepts,
          entities,
          relations,
          edges: []
        },
        updatedAt: nowIso()
      });
      if (patched) {
        updated += 1;
      }
    }
    const graph = this.#rebuildWorkspaceGraph(workspaceId);
    this.#syncGraphRagDocuments(docs).catch(() => {});
    return {
      workspaceId,
      scanned: docs.length,
      updated,
      graph,
      graphRag: this.graphRagService?.getStatus ? this.graphRagService.getStatus() : null
    };
  }

  getStats(input = {}) {
    const workspaceId = safeString(input.workspaceId, "default");
    const docs = this.store.listMemoryDocuments({
      workspaceId,
      limit: 100000
    });
    const sourceIds = new Set();
    for (const doc of docs) {
      sourceIds.add(doc.sourceId);
    }
    const graphStats = this.getGraphStats({ workspaceId });
    return {
      workspaceId,
      chunks: docs.length,
      sources: sourceIds.size,
      vectorDim: this.vectorDim,
      cacheSize: this.embeddingCache.size,
      graph: {
        nodes: graphStats.nodes,
        edges: graphStats.edges,
        avgDegree: graphStats.avgDegree,
        entities: graphStats.entities,
        relationTypes: graphStats.relationTypes
      },
      graphRag: this.graphRagService?.getStatus ? this.graphRagService.getStatus() : null
    };
  }

  async #searchGraphRagContext(input = {}) {
    if (
      !this.graphRagService ||
      typeof this.graphRagService.isEnabled !== "function" ||
      !this.graphRagService.isEnabled() ||
      typeof this.graphRagService.searchRelatedDocIds !== "function"
    ) {
      return new Map();
    }
    const base = Array.isArray(input.base) ? input.base : [];
    if (base.length === 0) {
      return new Map();
    }
    const rankedSeeds = [...base]
      .sort((a, b) => {
        const left = a.baseHybridScore + a.conceptOverlap * 0.1 + (a.entityOverlap ?? 0) * 0.2;
        const right = b.baseHybridScore + b.conceptOverlap * 0.1 + (b.entityOverlap ?? 0) * 0.2;
        return right - left;
      })
      .slice(0, clampInt(input.seedLimit, 4, 1, 16))
      .map((entry) => entry.doc.id);
    if (rankedSeeds.length === 0) {
      return new Map();
    }
    try {
      const results = await this.graphRagService.searchRelatedDocIds({
        workspaceId: safeString(input.workspaceId, "default"),
        seedDocIds: rankedSeeds,
        entityKeys: Array.isArray(input.entityKeys) ? input.entityKeys : [],
        relationTypes: Array.isArray(input.relationTypes) ? input.relationTypes : [],
        hops: clampInt(input.hops, this.graphHopLimit, 1, 4),
        limit: clampInt(input.limit, 96, 1, 400)
      });
      if (!Array.isArray(results) || results.length === 0) {
        return new Map();
      }
      let maxScore = 0;
      for (const item of results) {
        const score = Number(item?.score ?? 0);
        if (Number.isFinite(score) && score > maxScore) {
          maxScore = score;
        }
      }
      const normalizedMax = maxScore > 0 ? maxScore : 1;
      const map = new Map();
      for (const item of results) {
        const docId = safeString(item?.docId);
        const score = Number(item?.score ?? 0);
        if (!docId || !Number.isFinite(score) || score <= 0) {
          continue;
        }
        map.set(docId, Number((score / normalizedMax).toFixed(6)));
      }
      return map;
    } catch {
      return new Map();
    }
  }

  async #syncGraphRagDocuments(documents = []) {
    if (
      !this.graphRagService ||
      typeof this.graphRagService.isEnabled !== "function" ||
      !this.graphRagService.isEnabled() ||
      typeof this.graphRagService.ingestDocument !== "function"
    ) {
      return;
    }
    const docs = Array.isArray(documents) ? documents : [];
    for (const doc of docs) {
      const graph = doc.graph && typeof doc.graph === "object" ? doc.graph : {};
      await this.graphRagService.ingestDocument({
        workspaceId: safeString(doc.workspaceId, "default"),
        sourceId: safeString(doc.sourceId),
        docId: safeString(doc.id),
        chunkIndex: Number(doc.chunkIndex ?? 0),
        text: safeString(doc.text),
        entities: Array.isArray(graph.entities) ? graph.entities : [],
        relations: Array.isArray(graph.relations) ? graph.relations : [],
        concepts: Array.isArray(graph.concepts) ? graph.concepts : []
      });
    }
  }

  getGraphStats(input = {}) {
    const workspaceId = safeString(input.workspaceId, "default");
    const docs = this.store.listMemoryDocuments({
      workspaceId,
      limit: clampInt(input.scanLimit, 100000, 1, 200000)
    });
    if (docs.length === 0) {
      return {
        workspaceId,
        nodes: 0,
        edges: 0,
        avgDegree: 0,
        entities: 0,
        relationTypes: 0,
        topConcepts: [],
        topEntities: [],
        topRelationTypes: []
      };
    }
    const graphIndex = this.#buildGraphIndex(docs);
    let directedEdges = 0;
    for (const edges of graphIndex.edgesByDoc.values()) {
      directedEdges += edges.length;
    }
    const undirectedEdges = Math.floor(directedEdges / 2);
    const topConcepts = [...graphIndex.conceptFrequency.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 15)
      .map(([concept, count]) => ({
        concept,
        count
      }));
    const topEntities = [...graphIndex.entityFrequency.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 15)
      .map(([entity, count]) => ({
        entity,
        count
      }));
    const topRelationTypes = [...graphIndex.relationTypeFrequency.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 15)
      .map(([type, count]) => ({
        type,
        count
      }));
    return {
      workspaceId,
      nodes: docs.length,
      edges: undirectedEdges,
      avgDegree: Number((directedEdges / Math.max(1, docs.length)).toFixed(3)),
      entities: graphIndex.entityFrequency.size,
      relationTypes: graphIndex.relationTypeFrequency.size,
      topConcepts,
      topEntities,
      topRelationTypes
    };
  }

  #buildDocFrequency(docs) {
    const frequency = new Map();
    for (const doc of docs) {
      const tokenFreq = objectToMap(doc.tokenFreq);
      for (const token of tokenFreq.keys()) {
        frequency.set(token, (frequency.get(token) ?? 0) + 1);
      }
    }
    return frequency;
  }

  #scoreKeyword(queryFreq, docFreq, corpusDocFrequency, docCount) {
    let score = 0;
    for (const [token, qf] of queryFreq.entries()) {
      const tf = docFreq.get(token) ?? 0;
      if (!tf) {
        continue;
      }
      const df = corpusDocFrequency.get(token) ?? 1;
      const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
      score += tf * idf * qf;
    }
    return Number(Math.max(0, score).toFixed(6));
  }

  #scoreGraphContext(baseEntries, edgesByDoc, options = {}) {
    if (!Array.isArray(baseEntries) || baseEntries.length === 0) {
      return new Map();
    }

    const seeds = [...baseEntries]
      .sort((a, b) => {
        const aSeed =
          a.baseHybridScore +
          a.conceptOverlap * 0.1 +
          (a.entityOverlap ?? 0) * 0.15 +
          (a.relationOverlap ?? 0) * 0.2;
        const bSeed =
          b.baseHybridScore +
          b.conceptOverlap * 0.1 +
          (b.entityOverlap ?? 0) * 0.15 +
          (b.relationOverlap ?? 0) * 0.2;
        return bSeed - aSeed;
      })
      .slice(0, clampInt(options.seedLimit, 4, 1, 16));

    const hopLimit = clampInt(options.hops, this.graphHopLimit, 1, 4);
    const frontier = seeds.map((seed, index) => ({
      id: seed.doc.id,
      score: Number((1 - index * 0.08).toFixed(6))
    }));
    const graphScores = new Map();
    for (const seed of frontier) {
      graphScores.set(seed.id, Math.max(graphScores.get(seed.id) ?? 0, seed.score));
    }

    let currentFrontier = frontier;
    for (let depth = 1; depth <= hopLimit; depth += 1) {
      const decay = Math.pow(this.graphDecay, depth);
      const nextFrontier = [];
      for (const node of currentFrontier) {
        const edges = edgesByDoc.get(node.id) ?? [];
        for (const edge of edges) {
          const propagated = node.score * edge.weight * decay;
          if (propagated <= 0.001) {
            continue;
          }
          const existing = graphScores.get(edge.to) ?? 0;
          if (propagated > existing) {
            graphScores.set(edge.to, propagated);
          }
          nextFrontier.push({
            id: edge.to,
            score: propagated
          });
        }
      }
      if (nextFrontier.length === 0) {
        break;
      }
      currentFrontier = nextFrontier
        .sort((a, b) => b.score - a.score)
        .slice(0, 256);
    }
    return graphScores;
  }

  #normalizeConceptList(values) {
    if (!Array.isArray(values)) {
      return [];
    }
    return dedupeStrings(values, this.graphMaxConcepts);
  }

  #normalizeEntityList(values, maxEntities = this.graphMaxConcepts) {
    if (!Array.isArray(values)) {
      return [];
    }
    const entities = [];
    const seen = new Set();
    for (const value of values) {
      const name = safeString(value?.name ?? value);
      const key = safeString(value?.key, canonicalEntityKey(name));
      if (!name || !key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      entities.push({
        key,
        name,
        type: safeString(value?.type, classifyEntityType(name))
      });
      if (entities.length >= maxEntities) {
        break;
      }
    }
    return entities;
  }

  #normalizeRelationList(values, validEntityKeys = new Set()) {
    if (!Array.isArray(values)) {
      return [];
    }
    const relations = [];
    const seen = new Set();
    for (const value of values) {
      const from = safeString(value?.from);
      const to = safeString(value?.to);
      if (!from || !to || from === to) {
        continue;
      }
      if (validEntityKeys.size > 0 && (!validEntityKeys.has(from) || !validEntityKeys.has(to))) {
        continue;
      }
      const type = safeString(value?.type, "related_to")
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]+/g, "");
      const signature = `${from}|${type}|${to}`;
      if (seen.has(signature)) {
        continue;
      }
      seen.add(signature);
      relations.push({
        from,
        to,
        type: type || "related_to",
        evidence: safeString(value?.evidence).slice(0, 180)
      });
      if (relations.length >= this.graphMaxConcepts * 3) {
        break;
      }
    }
    return relations;
  }

  #buildGraphIndex(docs) {
    const conceptsByDoc = new Map();
    const entitiesByDoc = new Map();
    const relationsByDoc = new Map();
    const relationTypesByDoc = new Map();
    const conceptFrequency = new Map();
    const entityFrequency = new Map();
    const relationTypeFrequency = new Map();
    const membersByConcept = new Map();
    const membersByEntity = new Map();
    const membersByRelationType = new Map();

    for (const doc of docs) {
      const fallback = extractConcepts(doc.text, this.graphMaxConcepts);
      const concepts = this.#normalizeConceptList(doc.graph?.concepts ?? fallback);
      const entities = this.#normalizeEntityList(
        doc.graph?.entities ?? extractEntities(doc.text, concepts, this.graphMaxConcepts),
        this.graphMaxConcepts
      );
      const validEntityKeys = new Set(entities.map((entity) => entity.key));
      const relations = this.#normalizeRelationList(
        doc.graph?.relations ?? extractRelations(doc.text, entities, this.graphMaxConcepts * 2),
        validEntityKeys
      );
      const relationTypes = [...new Set(relations.map((relation) => relation.type))];
      conceptsByDoc.set(doc.id, concepts);
      entitiesByDoc.set(doc.id, entities);
      relationsByDoc.set(doc.id, relations);
      relationTypesByDoc.set(doc.id, relationTypes);
      for (const concept of concepts) {
        conceptFrequency.set(concept, (conceptFrequency.get(concept) ?? 0) + 1);
        if (!membersByConcept.has(concept)) {
          membersByConcept.set(concept, []);
        }
        membersByConcept.get(concept).push(doc.id);
      }
      for (const entity of entities) {
        entityFrequency.set(entity.key, (entityFrequency.get(entity.key) ?? 0) + 1);
        if (!membersByEntity.has(entity.key)) {
          membersByEntity.set(entity.key, []);
        }
        membersByEntity.get(entity.key).push(doc.id);
      }
      for (const relationType of relationTypes) {
        relationTypeFrequency.set(relationType, (relationTypeFrequency.get(relationType) ?? 0) + 1);
        if (!membersByRelationType.has(relationType)) {
          membersByRelationType.set(relationType, []);
        }
        membersByRelationType.get(relationType).push(doc.id);
      }
    }

    const edgeMaps = new Map();
    const ensureEdge = (fromId, toId, descriptor = {}) => {
      if (!edgeMaps.has(fromId)) {
        edgeMaps.set(fromId, new Map());
      }
      const toMap = edgeMaps.get(fromId);
      if (!toMap.has(toId)) {
        toMap.set(toId, {
          to: toId,
          sharedConcepts: new Set(),
          sharedEntities: new Set(),
          relationTypes: new Set(),
          sharedCount: 0
        });
      }
      const edge = toMap.get(toId);
      if (descriptor.kind === "concept" && descriptor.value && !edge.sharedConcepts.has(descriptor.value)) {
        edge.sharedConcepts.add(descriptor.value);
        edge.sharedCount += 1;
      }
      if (descriptor.kind === "entity" && descriptor.value && !edge.sharedEntities.has(descriptor.value)) {
        edge.sharedEntities.add(descriptor.value);
        edge.sharedCount += 1.25;
      }
      if (descriptor.kind === "relation" && descriptor.value && !edge.relationTypes.has(descriptor.value)) {
        edge.relationTypes.add(descriptor.value);
        edge.sharedCount += 2;
      }
    };

    for (const [concept, docIds] of membersByConcept.entries()) {
      if (docIds.length < 2) {
        continue;
      }
      for (let i = 0; i < docIds.length; i += 1) {
        for (let j = i + 1; j < docIds.length; j += 1) {
          const left = docIds[i];
          const right = docIds[j];
          ensureEdge(left, right, { kind: "concept", value: concept });
          ensureEdge(right, left, { kind: "concept", value: concept });
        }
      }
    }

    for (const [entityKey, docIds] of membersByEntity.entries()) {
      if (docIds.length < 2) {
        continue;
      }
      for (let i = 0; i < docIds.length; i += 1) {
        for (let j = i + 1; j < docIds.length; j += 1) {
          const left = docIds[i];
          const right = docIds[j];
          ensureEdge(left, right, { kind: "entity", value: entityKey });
          ensureEdge(right, left, { kind: "entity", value: entityKey });
        }
      }
    }

    for (const [relationType, docIds] of membersByRelationType.entries()) {
      if (docIds.length < 2) {
        continue;
      }
      for (let i = 0; i < docIds.length; i += 1) {
        for (let j = i + 1; j < docIds.length; j += 1) {
          const left = docIds[i];
          const right = docIds[j];
          ensureEdge(left, right, { kind: "relation", value: relationType });
          ensureEdge(right, left, { kind: "relation", value: relationType });
        }
      }
    }

    const edgesByDoc = new Map();
    for (const doc of docs) {
      const conceptCount = Math.max(1, (conceptsByDoc.get(doc.id) ?? []).length);
      const entityCount = Math.max(1, (entitiesByDoc.get(doc.id) ?? []).length);
      const toMap = edgeMaps.get(doc.id);
      if (!toMap) {
        edgesByDoc.set(doc.id, []);
        continue;
      }
      const edges = [...toMap.values()]
        .map((edge) => ({
          to: edge.to,
          weight: Number((edge.sharedCount / (conceptCount + entityCount)).toFixed(6)),
          sharedConcepts: [...edge.sharedConcepts].slice(0, 12),
          sharedEntities: [...edge.sharedEntities].slice(0, 12),
          relationTypes: [...edge.relationTypes].slice(0, 8)
        }))
        .sort((a, b) => b.weight - a.weight)
        .slice(0, this.graphEdgeLimit);
      edgesByDoc.set(doc.id, edges);
    }

    return {
      conceptsByDoc,
      edgesByDoc,
      entitiesByDoc,
      relationsByDoc,
      relationTypesByDoc,
      conceptFrequency,
      entityFrequency,
      relationTypeFrequency
    };
  }

  #rebuildWorkspaceGraph(workspaceId) {
    const docs = this.store.listMemoryDocuments({
      workspaceId,
      limit: 100000
    });
    if (docs.length === 0) {
      return {
        nodes: 0,
        edges: 0,
        updated: 0
      };
    }
    const graphIndex = this.#buildGraphIndex(docs);
    const now = nowIso();
    let updated = 0;
    let directedEdges = 0;
    for (const doc of docs) {
      const concepts = graphIndex.conceptsByDoc.get(doc.id) ?? [];
      const entities = graphIndex.entitiesByDoc.get(doc.id) ?? [];
      const relations = graphIndex.relationsByDoc.get(doc.id) ?? [];
      const edges = graphIndex.edgesByDoc.get(doc.id) ?? [];
      directedEdges += edges.length;
      const patched = this.store.updateMemoryDocument(doc.id, {
        graph: {
          concepts,
          entities,
          relations,
          edges
        },
        updatedAt: now
      });
      if (patched) {
        updated += 1;
      }
    }
    return {
      nodes: docs.length,
      edges: Math.floor(directedEdges / 2),
      updated
    };
  }

  async #embedCached(text) {
    const key = safeString(text).slice(0, 2000);
    if (this.embeddingCache.has(key)) {
      const cached = this.embeddingCache.get(key);
      this.embeddingCache.delete(key);
      this.embeddingCache.set(key, cached);
      return cached;
    }
    const embedded = await fetchEmbedding(text, this.vectorDim);
    this.embeddingCache.set(key, embedded);
    if (this.embeddingCache.size > this.embeddingCacheMax) {
      const oldest = this.embeddingCache.keys().next().value;
      this.embeddingCache.delete(oldest);
    }
    return embedded;
  }

  #badRequest(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
  }
}
