// @ts-nocheck
import path from "node:path";
import { createApi } from "./server.js";

const cwd = process.cwd();
const persistPath =
  process.env.PERSIST_PATH === undefined
    ? path.join(cwd, ".data", "store.json")
    : process.env.PERSIST_PATH;

const api = createApi({
  cwd,
  persistPath,
  autopilotAutoStart: process.env.AUTOPILOT_AUTO_START !== "false",
  heartbeatAutoStart: process.env.HEARTBEAT_AUTO_START !== "false"
});

// Keep process alive for background loops (autopilot + heartbeat).
const hold = setInterval(() => {}, 60_000);

function shutdown() {
  clearInterval(hold);
  try {
    if (api.autopilotService && typeof api.autopilotService.stop === "function") {
      api.autopilotService.stop();
    }
    if (api.heartbeatService && typeof api.heartbeatService.stop === "function") {
      api.heartbeatService.stop();
    }
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// eslint-disable-next-line no-console
console.log("SOVEREIGN worker started (autopilot + heartbeat).");
