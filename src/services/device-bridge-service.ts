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

function parseJsonSafe(text) {
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

export class DeviceBridgeService {
  constructor(options = {}) {
    this.path = safeString(options.path ?? process.env.DEVICE_BRIDGE_PATH, "/bridge/ws");
    this.authToken = safeString(options.authToken ?? process.env.DEVICE_BRIDGE_TOKEN);
    this.nodeService = options.nodeService ?? null;
    this.observabilityService = options.observabilityService ?? null;
    this.maxPayloadBytes = clampInt(
      options.maxPayloadBytes ?? process.env.DEVICE_BRIDGE_MAX_PAYLOAD,
      1_000_000,
      1024,
      8_000_000
    );
    this.invokeTimeoutMs = clampInt(
      options.invokeTimeoutMs ?? process.env.DEVICE_BRIDGE_INVOKE_TIMEOUT_MS,
      60000,
      1000,
      300000
    );
    this.connections = new Map();
    this.nodeConnections = new Map();
    this.pendingInvocations = new Map();
    this.startedAt = nowIso();
  }

  getStatus() {
    return {
      path: this.path,
      startedAt: this.startedAt,
      requiresToken: Boolean(this.authToken),
      clients: this.connections.size,
      connectedNodes: this.nodeConnections.size,
      pendingInvocations: this.pendingInvocations.size
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

  listConnectedNodes() {
    return [...this.connections.values()]
      .filter((connection) => Boolean(connection.nodeId))
      .map((connection) => ({
        nodeId: connection.nodeId,
        connectionId: connection.id,
        connectedAt: connection.connectedAt,
        lastSeenAt: connection.lastSeenAt,
        remoteAddress: connection.remoteAddress,
        node:
          this.nodeService && typeof this.nodeService.describeNode === "function"
            ? this.nodeService.describeNode(connection.nodeId)
            : null
      }));
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
      id: makeId("bridge"),
      socket,
      buffer: Buffer.alloc(0),
      connectedAt: nowIso(),
      remoteAddress: safeString(req.socket?.remoteAddress),
      lastSeenAt: nowIso(),
      nodeId: null
    };
    this.connections.set(connection.id, connection);
    this.#observe("bridge.connected", "Device bridge client connected.", {
      connectionId: connection.id
    });

    if (head && head.length > 0) {
      this.#onData(connection, head);
    }
    socket.on("data", (chunk) => this.#onData(connection, chunk));
    socket.on("close", () => this.#onClose(connection.id));
    socket.on("error", () => this.#onClose(connection.id));
    this.#send(connection, {
      type: "event",
      topic: "bridge.connected",
      timestamp: nowIso(),
      payload: {
        connectionId: connection.id
      }
    });
    return true;
  }

  async invokeNode(input = {}) {
    const nodeId = safeString(input.nodeId);
    const action = safeString(input.action).toLowerCase();
    const invokeInput = input.input && typeof input.input === "object" ? input.input : {};
    const timeoutMs = clampInt(input.timeoutMs, this.invokeTimeoutMs, 1000, 300000);
    if (!nodeId) {
      throw this.#badRequest("nodeId is required.");
    }
    if (!action) {
      throw this.#badRequest("action is required.");
    }

    const connectionId = this.nodeConnections.get(nodeId);
    if (!connectionId) {
      throw this.#notFound(`Node '${nodeId}' is not connected to bridge.`);
    }
    const connection = this.connections.get(connectionId);
    if (!connection) {
      this.nodeConnections.delete(nodeId);
      throw this.#notFound(`Node '${nodeId}' bridge session is stale.`);
    }

    const requestId = makeId("invoke");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingInvocations.delete(requestId);
        reject(new Error(`Bridge invoke timed out after ${timeoutMs}ms for node '${nodeId}'.`));
      }, timeoutMs);
      this.pendingInvocations.set(requestId, {
        requestId,
        nodeId,
        connectionId: connection.id,
        createdAt: nowIso(),
        resolve,
        reject,
        timer
      });
      try {
        this.#send(connection, {
          id: requestId,
          method: "bridge.invoke",
          params: {
            nodeId,
            action,
            input: invokeInput,
            requestedAt: nowIso()
          }
        });
      } catch (error) {
        clearTimeout(timer);
        this.pendingInvocations.delete(requestId);
        reject(error);
      }
    });
  }

  shutdown() {
    for (const pending of this.pendingInvocations.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Bridge is shutting down."));
    }
    this.pendingInvocations.clear();
    for (const connection of this.connections.values()) {
      try {
        connection.socket.write(encodeFrame(0x8, Buffer.alloc(0)));
      } catch { }
      try {
        connection.socket.destroy();
      } catch { }
    }
    this.connections.clear();
    this.nodeConnections.clear();
  }

  async #onMessage(connection, rawText) {
    const payload = parseJsonSafe(rawText);
    if (!payload || typeof payload !== "object") {
      this.#send(connection, {
        type: "error",
        error: "Invalid JSON payload."
      });
      return;
    }
    connection.lastSeenAt = nowIso();

    if (safeString(payload.type).toLowerCase() === "result" && safeString(payload.id)) {
      this.#handlePendingResult(payload.id, payload.result ?? {});
      return;
    }
    if (safeString(payload.type).toLowerCase() === "error" && safeString(payload.id)) {
      this.#handlePendingError(payload.id, payload.error ?? "Bridge node returned error.");
      return;
    }

    const method = safeString(payload.method);
    const requestId = payload.id ?? null;
    if (!method) {
      this.#send(connection, {
        type: "error",
        id: requestId,
        error: "method is required."
      });
      return;
    }

    try {
      const result = await this.#dispatch(connection, method, payload.params ?? {});
      if (requestId) {
        this.#send(connection, {
          type: "result",
          id: requestId,
          method,
          result
        });
      }
    } catch (error) {
      if (requestId) {
        this.#send(connection, {
          type: "error",
          id: requestId,
          method,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  async #dispatch(connection, method, params = {}) {
    if (method === "bridge.ping") {
      return {
        pong: true,
        time: nowIso()
      };
    }
    if (method === "bridge.register") {
      const token = safeString(params.token);
      if (this.authToken && token !== this.authToken) {
        throw this.#unauthorized("Invalid bridge token.");
      }
      const node = params.node && typeof params.node === "object" ? params.node : {};
      const nodeId = safeString(node.id);
      if (!nodeId) {
        throw this.#badRequest("node.id is required.");
      }
      const normalized = {
        ...node,
        id: nodeId,
        name: safeString(node.name, nodeId),
        type: safeString(node.type, "companion"),
        platform: safeString(node.platform, "unknown"),
        status: "online",
        capabilities: Array.isArray(node.capabilities) ? node.capabilities : [],
        permissionMap:
          node.permissionMap && typeof node.permissionMap === "object" ? node.permissionMap : {},
        metadata: {
          ...(node.metadata && typeof node.metadata === "object" ? node.metadata : {}),
          transport: "device-bridge",
          connectionId: connection.id,
          lastSeenAt: nowIso()
        }
      };

      const previousConnectionId = this.nodeConnections.get(nodeId);
      if (previousConnectionId && previousConnectionId !== connection.id) {
        const previousConnection = this.connections.get(previousConnectionId);
        if (previousConnection) {
          previousConnection.nodeId = null;
        }
      }
      connection.nodeId = nodeId;
      this.nodeConnections.set(nodeId, connection.id);
      if (this.nodeService && typeof this.nodeService.registerNode === "function") {
        this.nodeService.registerNode(normalized);
      }
      this.#observe("bridge.registered", "Device bridge node registered.", {
        connectionId: connection.id,
        nodeId
      });
      return {
        registered: true,
        nodeId,
        connectionId: connection.id
      };
    }
    if (method === "bridge.heartbeat") {
      const nodeId = safeString(params.nodeId || connection.nodeId);
      if (nodeId && this.nodeService && typeof this.nodeService.describeNode === "function") {
        const existing = this.nodeService.describeNode(nodeId);
        if (existing && typeof this.nodeService.registerNode === "function") {
          this.nodeService.registerNode({
            ...existing,
            status: safeString(params.status, "online"),
            metadata: {
              ...(existing.metadata && typeof existing.metadata === "object"
                ? existing.metadata
                : {}),
              lastSeenAt: nowIso(),
              heartbeat: params.heartbeat ?? null
            }
          });
        }
      }
      return {
        ok: true,
        nodeId: nodeId || null,
        time: nowIso()
      };
    }
    if (method === "bridge.invoke.result") {
      const requestId = safeString(params.requestId);
      if (!requestId) {
        throw this.#badRequest("requestId is required.");
      }
      this.#handlePendingResult(requestId, params.result ?? {});
      return {
        ack: true
      };
    }
    if (method === "bridge.invoke.error") {
      const requestId = safeString(params.requestId);
      if (!requestId) {
        throw this.#badRequest("requestId is required.");
      }
      this.#handlePendingError(requestId, params.error ?? "Bridge node invocation failed.");
      return {
        ack: true
      };
    }
    throw this.#notFound(`Unknown bridge method '${method}'.`);
  }

  #handlePendingResult(requestId, result) {
    const request = this.pendingInvocations.get(requestId);
    if (!request) {
      return;
    }
    clearTimeout(request.timer);
    this.pendingInvocations.delete(requestId);
    request.resolve(result);
  }

  #handlePendingError(requestId, error) {
    const request = this.pendingInvocations.get(requestId);
    if (!request) {
      return;
    }
    clearTimeout(request.timer);
    this.pendingInvocations.delete(requestId);
    request.reject(new Error(safeString(error, "Bridge node invocation failed.")));
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
        this.#onClose(connection.id);
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
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return;
    }
    this.connections.delete(connectionId);
    if (connection.nodeId) {
      this.nodeConnections.delete(connection.nodeId);
      if (this.nodeService && typeof this.nodeService.describeNode === "function") {
        const existing = this.nodeService.describeNode(connection.nodeId);
        if (existing && typeof this.nodeService.registerNode === "function") {
          this.nodeService.registerNode({
            ...existing,
            status: "offline",
            metadata: {
              ...(existing.metadata && typeof existing.metadata === "object"
                ? existing.metadata
                : {}),
              lastSeenAt: nowIso(),
              disconnectedAt: nowIso(),
              transport: "device-bridge"
            }
          });
        }
      }
      for (const pending of this.pendingInvocations.values()) {
        if (pending.connectionId === connectionId || pending.nodeId === connection.nodeId) {
          clearTimeout(pending.timer);
          this.pendingInvocations.delete(pending.requestId);
          pending.reject(new Error(`Bridge node '${connection.nodeId}' disconnected.`));
        }
      }
    }
    this.#observe("bridge.disconnected", "Device bridge client disconnected.", {
      connectionId,
      nodeId: connection.nodeId
    });
  }

  #send(connection, payload) {
    const text = JSON.stringify(payload);
    const frame = encodeFrame(0x1, Buffer.from(text, "utf8"));
    connection.socket.write(frame);
  }

  #observe(type, message, payload = {}) {
    if (!this.observabilityService || typeof this.observabilityService.record !== "function") {
      return;
    }
    this.observabilityService.record({
      source: "device-bridge",
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

  #unauthorized(message) {
    const error = new Error(message);
    error.statusCode = 401;
    return error;
  }

  #notFound(message) {
    const error = new Error(message);
    error.statusCode = 404;
    return error;
  }
}
