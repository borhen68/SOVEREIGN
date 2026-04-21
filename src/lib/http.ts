import { IncomingMessage, ServerResponse } from "node:http";

export function jsonResponse(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(payload));
}

export async function readJsonBody(req: IncomingMessage): Promise<any> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }

  if (!body) {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch {
    const error: any = new Error("Invalid JSON body");
    error.statusCode = 400;
    throw error;
  }
}

export function readBearerToken(req: IncomingMessage, url?: URL | null): string {
  const authHeader = String(req.headers.authorization ?? "").trim();
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) {
      return token;
    }
  }

  const headerToken = String(req.headers["x-sovereign-token"] ?? "").trim();
  if (headerToken) {
    return headerToken;
  }

  if (url) {
    const queryToken = String(
      url.searchParams.get("token") ??
        url.searchParams.get("access_token") ??
        url.searchParams.get("authToken") ??
        ""
    ).trim();
    if (queryToken) {
      return queryToken;
    }
  }

  return "";
}
