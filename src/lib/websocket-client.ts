// @ts-nocheck
import crypto from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import { EventEmitter } from "node:events";

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
    if (maskKey) {
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

function encodeClientFrame(opcode, payloadBuffer = Buffer.alloc(0)) {
  const payload = Buffer.from(payloadBuffer);
  const length = payload.length;
  const masked = true;
  let header = null;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = (masked ? 0x80 : 0x00) | length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = (masked ? 0x80 : 0x00) | 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = (masked ? 0x80 : 0x00) | 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(length, 6);
  }
  const maskKey = crypto.randomBytes(4);
  const maskedPayload = Buffer.alloc(length);
  for (let i = 0; i < length; i += 1) {
    maskedPayload[i] = payload[i] ^ maskKey[i % 4];
  }
  return Buffer.concat([header, maskKey, maskedPayload]);
}

function parseJsonSafe(value) {
  try {
    return JSON.parse(String(value ?? ""));
  } catch {
    return null;
  }
}

export class MinimalWebSocketClient extends EventEmitter {
  constructor(options = {}) {
    super();
    const urlValue = safeString(options.url);
    if (!urlValue) {
      throw new Error("WebSocket url is required.");
    }
    this.url = new URL(urlValue);
    this.headers =
      options.headers && typeof options.headers === "object" && !Array.isArray(options.headers)
        ? options.headers
        : {};
    this.connectTimeoutMs = clampInt(options.connectTimeoutMs, 10000, 1000, 120000);
    this.maxPayloadBytes = clampInt(options.maxPayloadBytes, 2_000_000, 1024, 16_000_000);
    this.insecure = Boolean(options.insecure);
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.handshakeDone = false;
    this.handshakeBuffer = Buffer.alloc(0);
    this.closed = false;
    this.connected = false;
  }

  async connect() {
    if (this.connected && this.socket && !this.closed) {
      return this;
    }
    const protocol = this.url.protocol.toLowerCase();
    if (protocol !== "ws:" && protocol !== "wss:") {
      throw new Error(`Unsupported websocket protocol '${this.url.protocol}'.`);
    }
    const isSecure = protocol === "wss:";
    const port = Number(this.url.port || (isSecure ? 443 : 80));
    const host = this.url.hostname;
    const pathWithQuery = `${this.url.pathname || "/"}${this.url.search || ""}`;
    const key = crypto.randomBytes(16).toString("base64");
    const hostHeader = this.url.port ? `${host}:${port}` : host;

    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error = null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (error) {
          reject(error);
          return;
        }
        resolve(null);
      };

      const timer = setTimeout(() => {
        finish(new Error(`WebSocket connect timed out after ${this.connectTimeoutMs}ms.`));
      }, this.connectTimeoutMs);

      const socket = isSecure
        ? tls.connect({
          host,
          port,
          servername: host,
          rejectUnauthorized: !this.insecure
        })
        : net.connect({
          host,
          port
        });

      this.socket = socket;
      socket.setNoDelay(true);
      socket.on("error", (error) => {
        if (!this.connected) {
          finish(error);
          return;
        }
        this.emit("error", error);
      });
      socket.on("close", () => {
        this.connected = false;
        this.closed = true;
        this.emit("close");
      });
      socket.on("data", (chunk) => {
        if (!this.handshakeDone) {
          this.handshakeBuffer = Buffer.concat([this.handshakeBuffer, Buffer.from(chunk)]);
          const markerIndex = this.handshakeBuffer.indexOf("\r\n\r\n");
          if (markerIndex === -1) {
            return;
          }
          const headerBuffer = this.handshakeBuffer.subarray(0, markerIndex + 4);
          const remaining = this.handshakeBuffer.subarray(markerIndex + 4);
          const headerText = headerBuffer.toString("utf8");
          const lines = headerText.split("\r\n").filter(Boolean);
          const statusLine = lines[0] ?? "";
          if (!statusLine.includes("101")) {
            finish(new Error(`WebSocket handshake failed: ${statusLine || "unknown status"}`));
            try {
              socket.destroy();
            } catch { }
            return;
          }
          this.handshakeDone = true;
          this.connected = true;
          this.closed = false;
          finish();
          this.emit("open");
          if (remaining.length > 0) {
            this.#onData(remaining);
          }
          return;
        }
        this.#onData(chunk);
      });
      socket.on("connect", () => {
        const lines = [
          `GET ${pathWithQuery} HTTP/1.1`,
          `Host: ${hostHeader}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          "Sec-WebSocket-Version: 13",
          `Sec-WebSocket-Key: ${key}`
        ];
        for (const [name, value] of Object.entries(this.headers)) {
          const headerName = safeString(name);
          const headerValue = safeString(value);
          if (!headerName || !headerValue) {
            continue;
          }
          lines.push(`${headerName}: ${headerValue}`);
        }
        lines.push("", "");
        socket.write(lines.join("\r\n"));
      });
    });
    return this;
  }

  sendText(text) {
    if (!this.socket || !this.connected || this.closed) {
      throw new Error("WebSocket is not connected.");
    }
    this.socket.write(encodeClientFrame(0x1, Buffer.from(String(text ?? ""), "utf8")));
  }

  sendJson(payload) {
    this.sendText(JSON.stringify(payload));
  }

  async request(payload, options = {}) {
    const timeoutMs = clampInt(options.timeoutMs, 15000, 1000, 300000);
    const expectedId = payload?.id;
    const matcher =
      typeof options.matcher === "function"
        ? options.matcher
        : (message) => message && typeof message === "object" && message.id === expectedId;

    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (error, result) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.off("json", onJson);
        this.off("error", onError);
        this.off("close", onClose);
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      };
      const onJson = (message) => {
        if (!matcher(message)) {
          return;
        }
        done(null, message);
      };
      const onError = (error) => done(error);
      const onClose = () => done(new Error("WebSocket closed before response was received."));
      const timer = setTimeout(() => {
        done(new Error(`WebSocket request timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      this.on("json", onJson);
      this.on("error", onError);
      this.on("close", onClose);
      try {
        this.sendJson(payload);
      } catch (error) {
        done(error);
      }
    });
  }

  close() {
    if (!this.socket || this.closed) {
      return;
    }
    try {
      this.socket.write(encodeClientFrame(0x8, Buffer.alloc(0)));
    } catch { }
    try {
      this.socket.end();
    } catch { }
    this.closed = true;
    this.connected = false;
  }

  #onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    let decoded = null;
    try {
      decoded = decodeFrames(this.buffer);
    } catch (error) {
      this.emit("error", error);
      this.close();
      return;
    }
    this.buffer = decoded.remaining;
    for (const frame of decoded.frames) {
      if (frame.payload.length > this.maxPayloadBytes) {
        this.emit("error", new Error("WebSocket payload too large."));
        this.close();
        return;
      }
      if (frame.opcode === 0x8) {
        this.close();
        return;
      }
      if (frame.opcode === 0x9) {
        try {
          this.socket?.write(encodeClientFrame(0xA, frame.payload));
        } catch { }
        continue;
      }
      if (frame.opcode === 0x1) {
        const text = frame.payload.toString("utf8");
        this.emit("message", text);
        const json = parseJsonSafe(text);
        if (json && typeof json === "object") {
          this.emit("json", json);
        }
      }
    }
  }
}

export async function wsJsonRequest(url, payload, options = {}) {
  const client = new MinimalWebSocketClient({
    url,
    headers: options.headers,
    connectTimeoutMs: options.connectTimeoutMs,
    maxPayloadBytes: options.maxPayloadBytes,
    insecure: options.insecure
  });
  try {
    await client.connect();
    const response = await client.request(payload, {
      timeoutMs: options.timeoutMs,
      matcher: options.matcher
    });
    return response;
  } finally {
    client.close();
  }
}
