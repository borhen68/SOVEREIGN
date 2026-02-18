// @ts-nocheck
import { makeId } from "../lib/id.js";
import { nowIso } from "../lib/time.js";

const ALLOWED_PROVIDERS = new Set([
  "cloudflare",
  "tailscale",
  "ngrok",
  "bore",
  "frp",
  "ssh",
  "custom"
]);

function safeString(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function normalizeTraits(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const item of input) {
    const normalized = String(item ?? "").trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export class TunnelService {
  constructor(options = {}) {
    this.store = options.store;
  }

  listTunnels(workspaceId = null) {
    return this.store.listTunnelProfiles(workspaceId ? safeString(workspaceId) : null);
  }

  getTunnel(tunnelId) {
    return this.store.getTunnelProfileById(safeString(tunnelId));
  }

  createTunnel(input = {}) {
    const workspaceId = safeString(input.workspaceId, "default");
    const providerRaw = safeString(input.provider, "custom").toLowerCase();
    const provider = ALLOWED_PROVIDERS.has(providerRaw) ? providerRaw : "custom";
    const name = safeString(input.name, `${provider}-tunnel`);
    const url = safeString(input.url);
    const config = input.config && typeof input.config === "object" ? input.config : {};
    const createdAt = nowIso();

    const profile = this.store.createTunnelProfile({
      id: makeId("tunnel"),
      workspaceId,
      provider,
      name,
      url,
      active: Boolean(input.active),
      traits: normalizeTraits(input.traits),
      config,
      status: safeString(input.status, "configured"),
      createdAt,
      updatedAt: createdAt,
      activatedAt: input.active ? createdAt : null
    });

    if (profile.active) {
      this.#deactivateOthers(profile.workspaceId, profile.id);
    }
    return profile;
  }

  updateTunnel(tunnelId, input = {}) {
    const existing = this.getTunnel(tunnelId);
    if (!existing) {
      throw this.#notFound("Tunnel not found.");
    }
    const patch = {
      updatedAt: nowIso()
    };
    if (input.name !== undefined) {
      patch.name = safeString(input.name, existing.name);
    }
    if (input.url !== undefined) {
      patch.url = safeString(input.url, existing.url);
    }
    if (input.provider !== undefined) {
      const candidate = safeString(input.provider).toLowerCase();
      patch.provider = ALLOWED_PROVIDERS.has(candidate) ? candidate : "custom";
    }
    if (input.traits !== undefined) {
      patch.traits = normalizeTraits(input.traits);
    }
    if (input.config !== undefined) {
      patch.config = input.config && typeof input.config === "object" ? input.config : {};
    }
    if (input.status !== undefined) {
      patch.status = safeString(input.status, existing.status);
    }
    if (input.active !== undefined) {
      patch.active = Boolean(input.active);
      patch.activatedAt = patch.active ? nowIso() : null;
    }
    const updated = this.store.updateTunnelProfile(existing.id, patch);
    if (updated?.active) {
      this.#deactivateOthers(updated.workspaceId, updated.id);
    }
    return updated;
  }

  activateTunnel(tunnelId) {
    const existing = this.getTunnel(tunnelId);
    if (!existing) {
      throw this.#notFound("Tunnel not found.");
    }
    const updated = this.store.updateTunnelProfile(existing.id, {
      active: true,
      status: "active",
      activatedAt: nowIso(),
      updatedAt: nowIso()
    });
    this.#deactivateOthers(updated.workspaceId, updated.id);
    return updated;
  }

  deactivateTunnel(tunnelId) {
    const existing = this.getTunnel(tunnelId);
    if (!existing) {
      throw this.#notFound("Tunnel not found.");
    }
    return this.store.updateTunnelProfile(existing.id, {
      active: false,
      status: "inactive",
      updatedAt: nowIso()
    });
  }

  getActiveTunnel(workspaceId = "default") {
    const profiles = this.listTunnels(workspaceId);
    return profiles.find((profile) => profile.active) ?? null;
  }

  #deactivateOthers(workspaceId, activeTunnelId) {
    const profiles = this.listTunnels(workspaceId);
    for (const profile of profiles) {
      if (profile.id === activeTunnelId) {
        continue;
      }
      if (!profile.active) {
        continue;
      }
      this.store.updateTunnelProfile(profile.id, {
        active: false,
        status: "inactive",
        updatedAt: nowIso()
      });
    }
  }

  #notFound(message) {
    const error = new Error(message);
    error.statusCode = 404;
    return error;
  }
}
