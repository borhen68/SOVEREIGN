import { definePlugin, defineTool } from "../../src/plugins/sdk.js";
import path from "node:path";

export default definePlugin(({ services }) => ({
  tools: [
    defineTool({
      name: "analyze_desktop",
      description: "Captures a screenshot of the physical desktop and analyzes it using Vision AI to understand what's happening on the screen.",
      actionType: "read",
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", description: "What to look for in the screenshot (e.g. 'Read the error message' or 'Find the browser window')." }
        }
      },
      async run({ input }) {
        try {
          // 1. Take screenshot via the companion node (or local bridge)
          // For MVP, we invoke the companion tool 'screen.screenshot'
          const screenshotPath = `screenshot_${Date.now()}.png`;
          const nodeResult = await services.councilService?.llmService?.fetchFn?.("http://localhost:3001/api/gateway/nodes/windows-" + require("os").hostname() + "/invoke", {
             method: "POST",
             headers: { "Content-Type": "application/json" },
             body: JSON.stringify({ action: "screen.screenshot", input: { path: screenshotPath } })
          });
          
          // 2. Pass to LLM with Vision
          const completion = await services.llmService.respond({
             prompt: `You are looking at a screenshot of the user's desktop. Query: ${input.query}. Describe what you see and answer accurately.`,
             imagePath: screenshotPath,
             maxTokens: 1000
          });

          return { success: true, analysis: completion.text, screenshot: screenshotPath };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }
    })
  ]
}));
