// @ts-nocheck
function normalizeEvent(input, fallbackWorkspaceId) {
  return {
    workspaceId: input.workspaceId ? String(input.workspaceId) : fallbackWorkspaceId,
    chatId: input.chatId ? String(input.chatId) : "local-chat",
    userId: input.userId ? String(input.userId) : "local-user",
    text: String(input.text ?? "").trim(),
    messageId: input.messageId ? String(input.messageId) : null,
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {}
  };
}

export function createLocalChatAdapter(options = {}) {
  const defaultWorkspaceId = options.defaultWorkspaceId ?? "default";
  return {
    id: "local",
    aliases: ["local-chat", "web"],
    name: "Local Chat",
    description: "Simple local webhook adapter for browser, terminal, or API testing.",
    capabilities: {
      chatTypes: ["direct", "group"],
      nativeCommands: true
    },
    reload: {
      configPrefixes: ["channels.local"]
    },
    config: {
      supportsAccounts: false,
      requiredEnv: [],
      optionalEnv: []
    },
    isConfigured() {
      return true;
    },
    async parseInbound({ payload }) {
      const rawEvents = Array.isArray(payload?.events) ? payload.events : [payload];
      const events = [];
      for (const item of rawEvents) {
        if (!item || typeof item !== "object") {
          continue;
        }
        const normalized = normalizeEvent(item, defaultWorkspaceId);
        if (!normalized.text) {
          continue;
        }
        events.push(normalized);
      }
      return events;
    },
    async sendMessage({ event, text }) {
      return {
        status: "local",
        channel: "local",
        chatId: event.chatId,
        userId: event.userId,
        text
      };
    }
  };
}
