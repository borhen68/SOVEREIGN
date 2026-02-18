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
