// @ts-nocheck
import { definePlugin, defineTool } from "../../src/plugins/sdk.js";

export default definePlugin(({ services }) => ({
  tools: [
    defineTool({
      name: "echo",
      description: "Return the provided text and optional tone.",
      inputSchema: {
        type: "object",
        required: ["text"],
        properties: {
          text: { type: "string" },
          tone: { type: "string" }
        }
      },
      async run({ input }) {
        return {
          text: input.text,
          tone: input.tone ?? "neutral"
        };
      }
    }),
    defineTool({
      name: "mission-count",
      description: "Return total missions currently stored.",
      inputSchema: {
        type: "object",
        properties: {}
      },
      async run() {
        const missionCount = services.missionService.listMissions().length;
        return { missionCount };
      }
    })
  ]
}));
