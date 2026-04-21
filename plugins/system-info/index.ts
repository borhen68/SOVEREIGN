import os from "node:os";
import { definePlugin, defineTool } from "../../src/plugins/sdk.js";

export default definePlugin(() => ({
  tools: [
    defineTool({
      name: "get_system_metrics",
      description: "Get real-time CPU, RAM, and OS metrics from the host.",
      actionType: "read",
      inputSchema: {
        type: "object",
        properties: {}
      },
      async run() {
        const cpus = os.cpus();
        const loadAvg = os.loadavg();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        
        return {
          os: {
            platform: os.platform(),
            release: os.release(),
            hostname: os.hostname(),
            uptimeSeconds: Math.floor(os.uptime())
          },
          memory: {
            totalGB: (totalMem / 1024 / 1024 / 1024).toFixed(2),
            freeGB: (freeMem / 1024 / 1024 / 1024).toFixed(2),
            usagePercent: (((totalMem - freeMem) / totalMem) * 100).toFixed(1) + "%"
          },
          cpu: {
            cores: cpus.length,
            model: cpus[0]?.model,
            loadAvg1m: loadAvg[0].toFixed(2),
            loadAvg5m: loadAvg[1].toFixed(2),
            loadAvg15m: loadAvg[2].toFixed(2)
          }
        };
      }
    })
  ]
}));
