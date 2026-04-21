// @ts-nocheck
import { nowIso } from "../lib/time.js";

function withTimeout(ms, promise) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => {
      reject(new Error("Web research timeout"));
    }, ms);
    promise
      .then((value) => {
        clearTimeout(id);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(id);
        reject(error);
      });
  });
}

function safeString(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

// ─── Provider: Brave Search API ───
async function braveLookup(query, limit, apiKey) {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(limit, 20)));
  url.searchParams.set("safesearch", "moderate");

  const response = await withTimeout(8000, fetch(url.toString(), {
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey
    }
  }));
  if (!response.ok) {
    throw new Error(`Brave Search failed with status ${response.status}`);
  }
  const data = await response.json();
  const results = Array.isArray(data.web?.results) ? data.web.results : [];
  return results.slice(0, limit).map((item) => ({
    title: safeString(item.title, "Untitled"),
    snippet: safeString(item.description),
    url: safeString(item.url),
    source: "brave"
  }));
}

// ─── Provider: Tavily Search API ───
async function tavilyLookup(query, limit, apiKey) {
  const response = await withTimeout(10000, fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: Math.min(limit, 10),
      search_depth: "advanced",
      include_answer: true
    })
  }));
  if (!response.ok) {
    throw new Error(`Tavily Search failed with status ${response.status}`);
  }
  const data = await response.json();
  const results = Array.isArray(data.results) ? data.results : [];
  const findings = results.slice(0, limit).map((item) => ({
    title: safeString(item.title, "Untitled"),
    snippet: safeString(item.content),
    url: safeString(item.url),
    source: "tavily"
  }));
  // Tavily also provides a synthesized answer — prepend it as a finding
  if (data.answer && String(data.answer).trim()) {
    findings.unshift({
      title: "Tavily AI Answer",
      snippet: String(data.answer).trim(),
      url: "",
      source: "tavily-answer"
    });
  }
  return findings;
}

// ─── Provider: SerpAPI (Google) ───
async function serpApiLookup(query, limit, apiKey) {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("engine", "google");
  url.searchParams.set("num", String(Math.min(limit, 10)));

  const response = await withTimeout(10000, fetch(url.toString()));
  if (!response.ok) {
    throw new Error(`SerpAPI failed with status ${response.status}`);
  }
  const data = await response.json();
  const organic = Array.isArray(data.organic_results) ? data.organic_results : [];
  const findings = organic.slice(0, limit).map((item) => ({
    title: safeString(item.title, "Untitled"),
    snippet: safeString(item.snippet),
    url: safeString(item.link),
    source: "serpapi"
  }));
  // Include knowledge graph if present
  if (data.knowledge_graph?.description) {
    findings.unshift({
      title: safeString(data.knowledge_graph.title, "Knowledge Graph"),
      snippet: String(data.knowledge_graph.description),
      url: safeString(data.knowledge_graph.source?.link ?? ""),
      source: "serpapi-kg"
    });
  }
  return findings;
}

// ─── Provider: Perplexity (sonar-pro) via OpenAI-compatible API ───
async function perplexityLookup(query, limit, apiKey) {
  const response = await withTimeout(15000, fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "sonar-pro",
      messages: [
        {
          role: "system",
          content: "You are a research assistant. Return factual, citation-rich answers. Be concise."
        },
        {
          role: "user",
          content: `Research the following and provide key findings with sources: ${query}`
        }
      ],
      max_tokens: 800,
      temperature: 0.1
    })
  }));
  if (!response.ok) {
    throw new Error(`Perplexity API failed with status ${response.status}`);
  }
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  const citations = Array.isArray(data.citations) ? data.citations : [];

  const findings = [];
  // Extract citations as individual findings
  for (let i = 0; i < Math.min(citations.length, limit); i++) {
    findings.push({
      title: `Source ${i + 1}`,
      snippet: "",
      url: String(citations[i]),
      source: "perplexity"
    });
  }
  // The main answer as a finding
  if (text.trim()) {
    findings.unshift({
      title: "Perplexity Research Answer",
      snippet: text.trim().slice(0, 2000),
      url: "",
      source: "perplexity-answer"
    });
  }
  return findings;
}

// ─── Provider: Wikipedia (legacy fallback) ───
async function wikipediaLookup(query, limit) {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "opensearch");
  url.searchParams.set("search", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("namespace", "0");
  url.searchParams.set("format", "json");

  const response = await withTimeout(5000, fetch(url.toString()));
  if (!response.ok) {
    throw new Error(`Web lookup failed with status ${response.status}`);
  }
  const payload = await response.json();
  const titles = Array.isArray(payload[1]) ? payload[1] : [];
  const descriptions = Array.isArray(payload[2]) ? payload[2] : [];
  const links = Array.isArray(payload[3]) ? payload[3] : [];

  return titles.map((title, index) => ({
    title: String(title),
    snippet: String(descriptions[index] ?? ""),
    url: String(links[index] ?? ""),
    source: "wikipedia"
  }));
}

// ─── Page content fetcher for deeper evidence ───
async function fetchPageContent(pageUrl, maxChars = 3000) {
  try {
    const response = await withTimeout(8000, fetch(pageUrl, {
      headers: {
        "User-Agent": "SOVEREIGN-Agent/1.0 (autonomous research)",
        "Accept": "text/html,application/xhtml+xml"
      }
    }));
    if (!response.ok) {
      return null;
    }
    const html = await response.text();
    // Strip HTML tags and extract text content
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, maxChars);
  } catch {
    return null;
  }
}

// ─── Search Provider Resolution ───
function resolveSearchProviders() {
  const providers = [];

  const braveKey = safeString(process.env.BRAVE_SEARCH_API_KEY);
  if (braveKey) {
    providers.push({ id: "brave", lookup: (q, l) => braveLookup(q, l, braveKey) });
  }

  const tavilyKey = safeString(process.env.TAVILY_API_KEY);
  if (tavilyKey) {
    providers.push({ id: "tavily", lookup: (q, l) => tavilyLookup(q, l, tavilyKey) });
  }

  const serpApiKey = safeString(process.env.SERPAPI_API_KEY);
  if (serpApiKey) {
    providers.push({ id: "serpapi", lookup: (q, l) => serpApiLookup(q, l, serpApiKey) });
  }

  const perplexityKey = safeString(process.env.PERPLEXITY_API_KEY);
  if (perplexityKey) {
    providers.push({ id: "perplexity", lookup: (q, l) => perplexityLookup(q, l, perplexityKey) });
  }

  // Wikipedia is always available as last-resort fallback
  providers.push({ id: "wikipedia", lookup: (q, l) => wikipediaLookup(q, l) });

  return providers;
}

export class WebResearchService {
  constructor(options = {}) {
    this.lookupFn = options.lookupFn ?? null;
    this.searchProviders = options.searchProviders ?? null;
    this.documentFetchEnabled = options.documentFetchEnabled !== false;
    this.documentFetchMaxChars = Number(options.documentFetchMaxChars) || 3000;
    this._resolvedProviders = null;
  }

  #getProviders() {
    if (this._resolvedProviders) {
      return this._resolvedProviders;
    }
    if (this.searchProviders) {
      this._resolvedProviders = this.searchProviders;
      return this._resolvedProviders;
    }
    this._resolvedProviders = resolveSearchProviders();
    return this._resolvedProviders;
  }

  getStatus() {
    const providers = this.#getProviders();
    return {
      lookupProviders: providers.map((p) => p.id),
      documentFetchEnabled: this.documentFetchEnabled,
      primaryProvider: providers[0]?.id ?? "none",
      totalProviders: providers.length
    };
  }

  async research(input) {
    const query = String(input.query ?? "").trim();
    const limit = Number.isFinite(Number(input.limit)) ? Number(input.limit) : 5;
    const safeLimit = Math.max(1, Math.min(10, limit));
    const findings = [];

    if (!query) {
      return findings;
    }

    // If seed findings are provided, use them directly
    if (Array.isArray(input.seedFindings) && input.seedFindings.length > 0) {
      for (const item of input.seedFindings.slice(0, safeLimit)) {
        findings.push({
          title: String(item.title ?? "Provided source"),
          snippet: String(item.snippet ?? ""),
          url: String(item.url ?? ""),
          source: String(item.source ?? "provided"),
          retrievedAt: nowIso()
        });
      }
      return findings;
    }

    // If a custom lookup function is provided (legacy support), use it
    if (this.lookupFn) {
      try {
        const webFindings = await this.lookupFn(query, safeLimit);
        return this.#normalizeFindings(webFindings, safeLimit);
      } catch {
        return [];
      }
    }

    // Multi-provider search with fallback chain
    const providers = this.#getProviders();
    for (const provider of providers) {
      try {
        const results = await provider.lookup(query, safeLimit);
        if (results.length > 0) {
          const normalized = this.#normalizeFindings(results, safeLimit);
          // Optionally fetch page content for richer evidence
          if (this.documentFetchEnabled) {
            await this.#enrichWithPageContent(normalized);
          }
          return normalized;
        }
      } catch (error) {
        // Provider failed — try next one in the chain
        continue;
      }
    }

    return [];
  }

  async #enrichWithPageContent(findings) {
    const fetchable = findings.filter(
      (f) => f.url && f.url.startsWith("http") && !f.source.endsWith("-answer")
    );
    // Fetch top 2 pages in parallel for enrichment
    const toFetch = fetchable.slice(0, 2);
    const fetched = await Promise.allSettled(
      toFetch.map(async (finding) => {
        const content = await fetchPageContent(finding.url, this.documentFetchMaxChars);
        if (content && content.length > 100) {
          finding.pageContent = content;
          // If snippet was empty, use extracted content
          if (!finding.snippet || finding.snippet.length < 50) {
            finding.snippet = content.slice(0, 500);
          }
        }
      })
    );
  }

  #normalizeFindings(webFindings, limit) {
    return webFindings.slice(0, limit).map((item) => ({
      title: String(item.title ?? "Untitled source"),
      snippet: String(item.snippet ?? ""),
      url: String(item.url ?? ""),
      source: String(item.source ?? "web"),
      pageContent: item.pageContent ?? null,
      retrievedAt: nowIso()
    }));
  }
}
