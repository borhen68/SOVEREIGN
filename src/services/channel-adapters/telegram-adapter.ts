// @ts-nocheck
function safeJson(response) {
  return response
    .json()
    .catch(async () => {
      try {
        return {
          text: await response.text()
        };
      } catch {
        return null;
      }
    });
}

function normalizeWorkspaceId(context, options) {
  return (
    String(context?.workspaceId ?? "").trim() ||
    String(options.defaultWorkspaceId ?? "").trim() ||
    "default"
  );
}

export function createTelegramAdapter(options = {}) {
  const fetchFn = options.fetchFn ?? fetch;
  const botToken = String(options.botToken ?? process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const verifySecret = String(options.verifySecret ?? process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();

  return {
    id: "telegram",
    aliases: ["tg"],
    name: "Telegram",
    description: "Telegram webhook adapter (supports local webhook relay and direct send).",
    capabilities: {
      chatTypes: ["direct", "group", "channel", "thread"],
      reactions: true,
      threads: true,
      media: true,
      polls: true,
      nativeCommands: true,
      blockStreaming: true
    },
    reload: {
      configPrefixes: ["channels.telegram"]
    },
    config: {
      supportsAccounts: false,
      requiredEnvForSend: ["TELEGRAM_BOT_TOKEN"],
      optionalEnv: ["TELEGRAM_WEBHOOK_SECRET"]
    },
    isConfigured() {
      return Boolean(botToken);
    },
    async parseInbound({ payload, context }) {
      const updates = Array.isArray(payload) ? payload : [payload];
      const events = [];
      for (const update of updates) {
        const message = update?.message ?? update?.edited_message ?? null;
        if (!message?.text) {
          continue;
        }
        events.push({
          workspaceId: normalizeWorkspaceId(context, options),
          chatId: String(message.chat?.id ?? ""),
          userId: String(message.from?.id ?? "unknown"),
          text: String(message.text),
          messageId: message.message_id ? String(message.message_id) : null,
          metadata: {
            telegramUpdateId: update?.update_id ?? null,
            chatType: message.chat?.type ?? null,
            username: message.from?.username ?? null
          }
        });
      }
      return events;
    },
    async verifyWebhook({ query }) {
      if (!verifySecret) {
        return {
          statusCode: 200,
          body: {
            ok: true
          }
        };
      }
      const provided = String(query.get("secret") ?? "").trim();
      if (provided === verifySecret) {
        return {
          statusCode: 200,
          body: {
            ok: true
          }
        };
      }
      return {
        statusCode: 403,
        body: {
          error: "Invalid Telegram webhook secret."
        }
      };
    },
    async sendMessage({ event, text }) {
      const payload = {
        chat_id: event.chatId,
        text
      };
      if (!botToken) {
        return {
          status: "skipped",
          reason: "Missing TELEGRAM_BOT_TOKEN.",
          payload
        };
      }

      const response = await fetchFn(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      return {
        status: response.ok ? "sent" : "failed",
        httpStatus: response.status,
        response: await safeJson(response)
      };
    }
  };
}
