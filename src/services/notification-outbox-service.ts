// @ts-nocheck
import { makeId } from "../lib/id.js";
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

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

export class NotificationOutboxService {
  constructor(options = {}) {
    this.store = options.store;
    this.channelGatewayService = options.channelGatewayService ?? null;
    this.observabilityService = options.observabilityService ?? null;
    this.maxAttempts = clampInt(
      options.maxAttempts ?? process.env.NOTIFICATION_OUTBOX_MAX_ATTEMPTS,
      8,
      1,
      100
    );
    this.batchSize = clampInt(
      options.batchSize ?? process.env.NOTIFICATION_OUTBOX_BATCH_SIZE,
      25,
      1,
      1000
    );
    this.retryBaseMs = clampInt(
      options.retryBaseMs ?? process.env.NOTIFICATION_OUTBOX_RETRY_BASE_MS,
      5000,
      100,
      600000
    );
    this.retryMaxMs = clampInt(
      options.retryMaxMs ?? process.env.NOTIFICATION_OUTBOX_RETRY_MAX_MS,
      300000,
      1000,
      3600000
    );
  }

  async enqueue(input = {}) {
    if (!this.store || typeof this.store.createNotificationOutboxItem !== "function") {
      return null;
    }
    const channelId = safeString(input.channelId).toLowerCase();
    const chatId = safeString(input.chatId);
    const text = safeString(input.text);
    if (!channelId || !chatId || !text) {
      throw this.#badRequest("channelId, chatId, and text are required to enqueue outbox message.");
    }

    const createdAt = nowIso();
    const item = {
      id: makeId("nout"),
      workspaceId: safeString(input.workspaceId, "default"),
      channelId,
      chatId,
      userId: safeString(input.userId, "outbox"),
      text,
      metadata:
        input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
          ? input.metadata
          : {},
      status: "pending",
      attempts: 0,
      maxAttempts: clampInt(input.maxAttempts, this.maxAttempts, 1, 100),
      nextAttemptAt: safeString(input.nextAttemptAt, createdAt),
      lastAttemptAt: null,
      sentAt: null,
      lastError: null,
      missionId: safeString(input.missionId) || null,
      runId: safeString(input.runId) || null,
      createdAt,
      updatedAt: createdAt
    };

    const created = await Promise.resolve(this.store.createNotificationOutboxItem(item));
    this.#observe("notification.outbox.queued", "Notification queued in durable outbox.", {
      itemId: created?.id ?? item.id,
      workspaceId: item.workspaceId,
      channelId: item.channelId,
      missionId: item.missionId,
      runId: item.runId
    });
    return created;
  }

  async listItems(filters = {}) {
    if (!this.store || typeof this.store.listNotificationOutboxItems !== "function") {
      return [];
    }
    return await Promise.resolve(
      this.store.listNotificationOutboxItems({
        workspaceId: safeString(filters.workspaceId),
        status: safeString(filters.status),
        statuses: Array.isArray(filters.statuses) ? filters.statuses : undefined,
        missionId: safeString(filters.missionId),
        runId: safeString(filters.runId),
        channelId: safeString(filters.channelId),
        dueOnly: filters.dueOnly === true,
        dueBefore: safeString(filters.dueBefore),
        limit: clampInt(filters.limit, this.batchSize, 1, 1000)
      })
    );
  }

  async processDue(input = {}) {
    if (
      !this.store ||
      typeof this.store.listNotificationOutboxItems !== "function" ||
      typeof this.store.updateNotificationOutboxItem !== "function" ||
      !this.channelGatewayService ||
      typeof this.channelGatewayService.sendProactiveMessage !== "function"
    ) {
      return {
        processed: 0,
        sent: 0,
        failed: 0,
        requeued: 0
      };
    }

    const limit = clampInt(input.limit, this.batchSize, 1, 1000);
    const dueBefore = safeString(input.dueBefore, nowIso());
    const items = await Promise.resolve(
      this.store.listNotificationOutboxItems({
        workspaceId: safeString(input.workspaceId),
        statuses: ["pending"],
        dueOnly: true,
        dueBefore,
        limit
      })
    );

    let sent = 0;
    let failed = 0;
    let requeued = 0;

    for (const item of items) {
      const result = await this.#processItem(item);
      if (result === "sent") {
        sent += 1;
      } else if (result === "requeued") {
        requeued += 1;
      } else if (result === "failed") {
        failed += 1;
      }
    }

    return {
      processed: items.length,
      sent,
      failed,
      requeued
    };
  }

  async #processItem(item) {
    const attempts = Math.max(0, Math.round(Number(item?.attempts ?? 0)));
    const maxAttempts = clampInt(item?.maxAttempts, this.maxAttempts, 1, 100);
    const updatedAt = nowIso();

    if (attempts >= maxAttempts) {
      await Promise.resolve(
        this.store.updateNotificationOutboxItem(item.id, {
          status: "failed",
          updatedAt,
          lastError: safeString(item.lastError, "Max attempts reached.")
        })
      );
      return "failed";
    }

    try {
      await this.channelGatewayService.sendProactiveMessage({
        channelId: safeString(item.channelId),
        workspaceId: safeString(item.workspaceId, "default"),
        chatId: safeString(item.chatId),
        userId: safeString(item.userId, "outbox"),
        text: safeString(item.text),
        metadata:
          item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
            ? item.metadata
            : {}
      });

      await Promise.resolve(
        this.store.updateNotificationOutboxItem(item.id, {
          status: "sent",
          attempts: attempts + 1,
          sentAt: updatedAt,
          lastAttemptAt: updatedAt,
          nextAttemptAt: null,
          lastError: null,
          updatedAt
        })
      );
      this.#observe("notification.outbox.sent", "Outbox notification delivered.", {
        itemId: item.id,
        workspaceId: item.workspaceId,
        channelId: item.channelId
      });
      return "sent";
    } catch (error) {
      const nextAttempts = attempts + 1;
      const exhausted = nextAttempts >= maxAttempts;
      const nextAttemptAt = exhausted
        ? null
        : new Date(Date.now() + this.#computeRetryDelayMs(nextAttempts)).toISOString();
      const errorMessage = error instanceof Error ? error.message : String(error);

      await Promise.resolve(
        this.store.updateNotificationOutboxItem(item.id, {
          status: exhausted ? "failed" : "pending",
          attempts: nextAttempts,
          lastAttemptAt: updatedAt,
          nextAttemptAt,
          lastError: errorMessage,
          updatedAt
        })
      );
      this.#observe(
        exhausted ? "notification.outbox.failed" : "notification.outbox.retry",
        exhausted ? "Outbox notification permanently failed." : "Outbox notification send failed; retry scheduled.",
        {
          itemId: item.id,
          workspaceId: item.workspaceId,
          channelId: item.channelId,
          attempts: nextAttempts,
          maxAttempts,
          nextAttemptAt,
          error: errorMessage
        }
      );
      return exhausted ? "failed" : "requeued";
    }
  }

  #computeRetryDelayMs(attempt) {
    const power = Math.max(0, Number(attempt) - 1);
    const raw = this.retryBaseMs * Math.pow(2, power);
    const jitterRatio = 0.2;
    const jitter = raw * jitterRatio * (Math.random() * 2 - 1);
    const delayed = Math.round(raw + jitter);
    return clampNumber(delayed, this.retryBaseMs, 100, this.retryMaxMs);
  }

  #observe(type, message, payload = {}) {
    if (!this.observabilityService || typeof this.observabilityService.record !== "function") {
      return;
    }
    this.observabilityService.record({
      source: "notification",
      type,
      message,
      payload
    });
  }

  #badRequest(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
  }
}
