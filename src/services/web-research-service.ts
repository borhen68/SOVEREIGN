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

async function defaultLookup(query, limit) {
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

export class WebResearchService {
  constructor(options = {}) {
    this.lookupFn = options.lookupFn ?? defaultLookup;
  }

  async research(input) {
    const query = String(input.query ?? "").trim();
    const limit = Number.isFinite(Number(input.limit)) ? Number(input.limit) : 3;
    const safeLimit = Math.max(1, Math.min(10, limit));
    const findings = [];

    if (!query) {
      return findings;
    }

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

    try {
      const webFindings = await this.lookupFn(query, safeLimit);
      for (const item of webFindings.slice(0, safeLimit)) {
        findings.push({
          title: String(item.title ?? "Untitled source"),
          snippet: String(item.snippet ?? ""),
          url: String(item.url ?? ""),
          source: String(item.source ?? "web"),
          retrievedAt: nowIso()
        });
      }
      return findings;
    } catch {
      return [];
    }
  }
}
