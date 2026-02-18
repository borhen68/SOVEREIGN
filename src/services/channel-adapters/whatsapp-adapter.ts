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

export function createWhatsappAdapter(options = {}) {
  const fetchFn = options.fetchFn ?? fetch;
  const accessToken = String(options.accessToken ?? process.env.WHATSAPP_ACCESS_TOKEN ?? "").trim();
  const verifyToken = String(options.verifyToken ?? process.env.WHATSAPP_VERIFY_TOKEN ?? "").trim();
  const defaultPhoneNumberId = String(
    options.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID ?? ""
  ).trim();
  const graphApiBase = String(options.graphApiBase ?? "https://graph.facebook.com/v21.0").trim();

  return {
    id: "whatsapp",
    aliases: ["wa"],
    name: "WhatsApp Cloud API",
    description: "WhatsApp webhook adapter for Meta Cloud API payloads.",
    capabilities: {
      chatTypes: ["direct", "group"],
      polls: true,
      reactions: true,
      media: true,
      nativeCommands: true
    },
    reload: {
      configPrefixes: ["channels.whatsapp", "web"]
    },
    config: {
      supportsAccounts: false,
      requiredEnvForSend: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"],
      optionalEnv: ["WHATSAPP_VERIFY_TOKEN"]
    },
    isConfigured() {
      return Boolean(accessToken && defaultPhoneNumberId);
    },
    async parseInbound({ payload, context }) {
      const workspaceId = normalizeWorkspaceId(context, options);
      const events = [];
      const entries = Array.isArray(payload?.entry) ? payload.entry : [];
      for (const entry of entries) {
        const changes = Array.isArray(entry?.changes) ? entry.changes : [];
        for (const change of changes) {
          const value = change?.value ?? {};
          const phoneNumberId = String(value?.metadata?.phone_number_id ?? "").trim() || null;
          const messages = Array.isArray(value?.messages) ? value.messages : [];
          for (const message of messages) {
            if (message?.type !== "text" || !message?.text?.body) {
              continue;
            }
            const from = String(message.from ?? "").trim();
            if (!from) {
              continue;
            }
            events.push({
              workspaceId,
              chatId: from,
              userId: from,
              text: String(message.text.body),
              messageId: message.id ? String(message.id) : null,
              metadata: {
                phoneNumberId,
                profileName: String(value?.contacts?.[0]?.profile?.name ?? ""),
                timestamp: message.timestamp ? String(message.timestamp) : null
              }
            });
          }
        }
      }
      return events;
    },
    async verifyWebhook({ query }) {
      const mode = String(query.get("hub.mode") ?? "");
      const token = String(query.get("hub.verify_token") ?? "");
      const challenge = String(query.get("hub.challenge") ?? "");
      if (mode !== "subscribe") {
        return {
          statusCode: 400,
          body: {
            error: "Invalid hub.mode."
          }
        };
      }
      if (verifyToken && token !== verifyToken) {
        return {
          statusCode: 403,
          body: {
            error: "Invalid WhatsApp verify token."
          }
        };
      }
      return {
        statusCode: 200,
        body: challenge,
        contentType: "text/plain; charset=utf-8"
      };
    },
    async sendMessage({ event, text }) {
      const phoneNumberId =
        String(event?.metadata?.phoneNumberId ?? "").trim() || defaultPhoneNumberId || "";
      const payload = {
        messaging_product: "whatsapp",
        to: event.chatId,
        type: "text",
        text: {
          body: text
        }
      };
      if (!accessToken || !phoneNumberId) {
        return {
          status: "skipped",
          reason: "Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID.",
          payload
        };
      }

      const response = await fetchFn(`${graphApiBase}/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`
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
