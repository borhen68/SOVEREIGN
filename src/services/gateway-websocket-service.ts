// @ts-nocheck
import crypto from "node:crypto";
import { makeId } from "../lib/id.js";
import { nowIso } from "../lib/time.js";

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

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

function parseJson(text) {
  try {
    return JSON.parse(String(text ?? ""));
  } catch {
    return null;
  }
}

function wsAccept(key) {
  return crypto.createHash("sha1").update(`${key}${WS_MAGIC}`).digest("base64");
}

function encodeFrame(opcode, payloadBuffer = Buffer.alloc(0)) {
  const length = payloadBuffer.length;
  let header = null;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(length, 6);
  }
  return Buffer.concat([header, payloadBuffer]);
}

function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const b1 = buffer[offset];
    const b2 = buffer[offset + 1];
    const fin = (b1 & 0x80) !== 0;
    const opcode = b1 & 0x0f;
    const masked = (b2 & 0x80) !== 0;
    let length = b2 & 0x7f;
    let cursor = offset + 2;

    if (length === 126) {
      if (cursor + 2 > buffer.length) {
        break;
      }
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (cursor + 8 > buffer.length) {
        break;
      }
      const high = buffer.readUInt32BE(cursor);
      const low = buffer.readUInt32BE(cursor + 4);
      if (high !== 0) {
        throw new Error("Large websocket frames are not supported.");
      }
      length = low;
      cursor += 8;
    }

    const maskKeyLength = masked ? 4 : 0;
    if (cursor + maskKeyLength + length > buffer.length) {
      break;
    }

    const maskKey = masked ? buffer.subarray(cursor, cursor + 4) : null;
    cursor += maskKeyLength;
    const payload = Buffer.from(buffer.subarray(cursor, cursor + length));
    if (masked && maskKey) {
      for (let i = 0; i < payload.length; i += 1) {
        payload[i] ^= maskKey[i % 4];
      }
    }
    frames.push({
      fin,
      opcode,
      payload
    });
    offset = cursor + length;
  }
  return {
    frames,
    remaining: buffer.subarray(offset)
  };
}

export class GatewayWebsocketService {
  constructor(options = {}) {
    this.channelGatewayService = options.channelGatewayService;
    this.nodeService = options.nodeService;
    this.deviceBridgeService = options.deviceBridgeService ?? null;
    this.browserControlService = options.browserControlService ?? null;
    this.tailscaleExposureService = options.tailscaleExposureService ?? null;
    this.observabilityService = options.observabilityService ?? null;
    this.path = safeString(options.path ?? process.env.GATEWAY_WS_PATH, "/gateway/ws");
    this.maxPayloadBytes = clampInt(
      options.maxPayloadBytes ?? process.env.GATEWAY_WS_MAX_PAYLOAD,
      1_000_000,
      1024,
      8_000_000
    );
    this.connections = new Map();
    this.startedAt = nowIso();
  }

  getStatus() {
    return {
      wsPath: this.path,
      startedAt: this.startedAt,
      clients: this.connections.size,
      sessions: [...this.connections.values()].map((connection) => ({
        id: connection.id,
        connectedAt: connection.connectedAt,
        remoteAddress: connection.remoteAddress,
        subscriptions: [...connection.subscriptions]
      }))
    };
  }

  getWsInfo(input = {}) {
    const host = safeString(input.host, "localhost:3001");
    const protocol = safeString(input.protocol, "http:");
    const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
    return {
      path: this.path,
      url: `${wsProtocol}//${host}${this.path}`
    };
  }

  handleUpgrade(req, socket, head = Buffer.alloc(0)) {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname !== this.path) {
      return false;
    }

    const key = safeString(req.headers["sec-websocket-key"]);
    const upgrade = safeString(req.headers.upgrade).toLowerCase();
    if (!key || upgrade !== "websocket") {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return true;
    }

    const acceptKey = wsAccept(key);
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${acceptKey}`,
        "\r\n"
      ].join("\r\n")
    );
    socket.setNoDelay(true);

    const connection = {
      id: makeId("gws"),
      socket,
      buffer: Buffer.alloc(0),
      connectedAt: nowIso(),
      remoteAddress: safeString(req.socket?.remoteAddress),
      subscriptions: new Set(["*"])
    };
    this.connections.set(connection.id, connection);
    this.#observe("gateway.ws.connected", "Gateway websocket client connected.", {
      connectionId: connection.id
    });
    this.#sendEvent(connection, "gateway.connected", {
      connectionId: connection.id,
      connectedAt: connection.connectedAt
    });

    if (head && head.length > 0) {
      this.#onData(connection, head);
    }

    socket.on("data", (chunk) => this.#onData(connection, chunk));
    socket.on("close", () => this.#onClose(connection.id));
    socket.on("error", () => this.#onClose(connection.id));
    return true;
  }

  shutdown() {
    for (const connection of this.connections.values()) {
      try {
        connection.socket.write(encodeFrame(0x8, Buffer.alloc(0)));
      } catch { }
      try {
        connection.socket.destroy();
      } catch { }
    }
    this.connections.clear();
  }

  broadcast(topic, payload = {}) {
    for (const connection of this.connections.values()) {
      if (!connection.subscriptions.has("*") && !connection.subscriptions.has(topic)) {
        continue;
      }
      this.#sendEvent(connection, topic, payload);
    }
  }

  async #onMessage(connection, message) {
    const payload = parseJson(message);
    if (!payload || typeof payload !== "object") {
      this.#send(connection, {
        type: "error",
        error: "Invalid JSON payload."
      });
      return;
    }

    const method = safeString(payload.method);
    if (!method) {
      this.#send(connection, {
        type: "error",
        id: payload.id ?? null,
        error: "method is required."
      });
      return;
    }

    try {
      const result = await this.#dispatch(connection, method, payload.params ?? {});
      this.#send(connection, {
        type: "result",
        id: payload.id ?? null,
        method,
        result
      });
    } catch (error) {
      this.#send(connection, {
        type: "error",
        id: payload.id ?? null,
        method,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async #dispatch(connection, method, params = {}) {
    if (method === "gateway.ping") {
      return {
        pong: true,
        time: nowIso(),
        connectionId: connection.id
      };
    }
    if (method === "gateway.status") {
      return this.getStatus();
    }
    if (method === "events.subscribe") {
      const topics = Array.isArray(params.topics) ? params.topics.map((item) => safeString(item)) : [];
      connection.subscriptions = new Set(topics.length > 0 ? topics : ["*"]);
      return {
        topics: [...connection.subscriptions]
      };
    }
    if (method === "sessions.list" || method === "sessions_list") {
      const sessions = await this.channelGatewayService.listSessions(
        safeString(params.workspaceId) || null
      );
      return { sessions };
    }
    if (method === "sessions.history" || method === "sessions_history") {
      const messages = await this.channelGatewayService.listSessionMessages(
        safeString(params.sessionId),
        clampInt(params.limit, 100, 1, 500)
      );
      return { messages };
    }
    if (method === "sessions.send" || method === "sessions_send") {
      const result = await this.channelGatewayService.sendProactiveMessage({
        channelId: params.channelId,
        workspaceId: params.workspaceId,
        chatId: params.chatId,
        userId: params.userId,
        text: params.text,
        metadata: {
          source: "gateway.ws.sessions.send",
          ...(params.metadata && typeof params.metadata === "object" ? params.metadata : {})
        }
      });
      this.broadcast("sessions.sent", {
        channelId: params.channelId,
        workspaceId: params.workspaceId,
        chatId: params.chatId,
        userId: params.userId
      });
      return result;
    }
    if (method === "node.list" || method === "node_list") {
      return {
        nodes: this.nodeService.listNodes()
      };
    }
    if (method === "node.describe" || method === "node_describe") {
      const node = this.nodeService.describeNode(safeString(params.nodeId));
      if (!node) {
        throw this.#notFound("Node not found.");
      }
      return { node };
    }
    if (method === "node.invoke" || method === "node_invoke") {
      const invocation = await this.nodeService.invoke({
        nodeId: params.nodeId,
        action: params.action,
        input: params.input
      });
      this.broadcast("node.invoked", {
        nodeId: params.nodeId,
        action: params.action
      });
      return invocation;
    }
    if (method === "bridge.status") {
      return this.deviceBridgeService?.getStatus?.() ?? { enabled: false };
    }
    if (method === "bridge.ws_info" || method === "bridge.ws-info") {
      return this.deviceBridgeService?.getWsInfo?.({
        host: safeString(params.host, "localhost:3001"),
        protocol: safeString(params.protocol, "http:")
      }) ?? { path: null, url: null };
    }
    if (method === "bridge.nodes") {
      return {
        nodes: this.deviceBridgeService?.listConnectedNodes?.() ?? []
      };
    }
    if (method === "browser.status") {
      return this.browserControlService?.getStatus?.() ?? { enabled: false };
    }
    if (method === "browser.open") {
      if (!this.browserControlService) {
        throw this.#badRequest("Browser control service is not configured.");
      }
      return this.browserControlService.openUrl({
        url: params.url
      });
    }
    if (method === "tailscale.status") {
      return this.tailscaleExposureService?.getStatus?.() ?? { mode: "off", enabled: false };
    }
    if (method === "tailscale.plan") {
      if (!this.tailscaleExposureService) {
        throw this.#badRequest("Tailscale exposure service is not configured.");
      }
      return this.tailscaleExposureService.plan(params);
    }
    if (method === "tailscale.apply") {
      if (!this.tailscaleExposureService) {
        throw this.#badRequest("Tailscale exposure service is not configured.");
      }
      return this.tailscaleExposureService.apply(params);
    }
    throw this.#notFound(`Unknown gateway method '${method}'.`);
  }

  #onData(connection, chunk) {
    connection.buffer = Buffer.concat([connection.buffer, Buffer.from(chunk)]);
    let decoded = null;
    try {
      decoded = decodeFrames(connection.buffer);
    } catch (error) {
      this.#send(connection, {
        type: "error",
        error: error instanceof Error ? error.message : String(error)
      });
      try {
        connection.socket.destroy();
      } catch { }
      this.connections.delete(connection.id);
      return;
    }
    connection.buffer = decoded.remaining;
    for (const frame of decoded.frames) {
      if (frame.payload.length > this.maxPayloadBytes) {
        this.#send(connection, {
          type: "error",
          error: "Payload too large."
        });
        continue;
      }
      if (frame.opcode === 0x8) {
        try {
          connection.socket.write(encodeFrame(0x8, Buffer.alloc(0)));
          connection.socket.destroy();
        } catch { }
        this.connections.delete(connection.id);
        return;
      }
      if (frame.opcode === 0x9) {
        connection.socket.write(encodeFrame(0xA, frame.payload));
        continue;
      }
      if (frame.opcode === 0x1) {
        const text = frame.payload.toString("utf8");
        this.#onMessage(connection, text).catch((error) => {
          this.#send(connection, {
            type: "error",
            error: error instanceof Error ? error.message : String(error)
          });
        });
      }
    }
  }

  #onClose(connectionId) {
    this.connections.delete(connectionId);
    this.#observe("gateway.ws.disconnected", "Gateway websocket client disconnected.", {
      connectionId
    });
  }

  #send(connection, payload) {
    const text = JSON.stringify(payload);
    const frame = encodeFrame(0x1, Buffer.from(text, "utf8"));
    connection.socket.write(frame);
  }

  #sendEvent(connection, topic, payload) {
    this.#send(connection, {
      type: "event",
      topic,
      timestamp: nowIso(),
      payload
    });
  }

  #observe(type, message, payload = {}) {
    if (!this.observabilityService || typeof this.observabilityService.record !== "function") {
      return;
    }
    this.observabilityService.record({
      source: "gateway",
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

  #notFound(message) {
    const error = new Error(message);
    error.statusCode = 404;
    return error;
  }
}
