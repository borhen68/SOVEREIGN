// @ts-nocheck
import { definePlugin, defineTool } from "../../src/plugins/sdk.js";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export default definePlugin(({ services }) => ({
  tools: [
    defineTool({
      name: "create_plugin",
      description: "Generates a complete native TS plugin. Use this when you don't have the necessary tools to complete a mission and need to invent one.",
      actionType: "destructive", // Triggers the Trust Gate for user permission!
      inputSchema: {
        type: "object",
        required: ["pluginId", "description", "pluginCode"],
        properties: {
          pluginId: { type: "string", description: "A unique kebab-case ID for the new plugin (e.g., 'pdf-parser', 'math-solver')" },
          description: { type: "string", description: "What the plugin does." },
          pluginCode: { type: "string", description: "The full exact contents of index.ts, matching the SOVEREIGN SDK format." }
        }
      },
      async run({ input }) {
        const { pluginId, description, pluginCode } = input;
        
        // 1. Setup paths
        const pluginsDir = path.join(process.cwd(), "plugins", pluginId);
        if (fs.existsSync(pluginsDir)) {
          return { success: false, error: `Plugin ${pluginId} already exists.` };
        }
        
        fs.mkdirSync(pluginsDir, { recursive: true });

        // 2. Write Manifest
        const manifest = {
          id: pluginId,
          name: pluginId.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
          version: "1.0.0",
          description: description,
          entry: "index.js",
          permissions: { network: true, filesystem: true }
        };
        fs.writeFileSync(path.join(pluginsDir, "plugin.json"), JSON.stringify(manifest, null, 2));

        // 3. Write TypeScript
        fs.writeFileSync(path.join(pluginsDir, "index.ts"), pluginCode);

        // 4. Compile the plugin Native Code
        const buildResult = spawnSync("npm", ["run", "build"], { cwd: process.cwd(), encoding: "utf8" });
        if (buildResult.status !== 0) {
          // Rollback on syntax error
          fs.rmSync(pluginsDir, { recursive: true, force: true });
          return { success: false, error: `Compilation failed:\n${buildResult.stderr}` };
        }

        // 5. Hot Reload the Host System
        try {
          const response = await fetch("http://localhost:3001/api/plugins/reload", { method: "POST" });
          if (!response.ok) {
            return { success: false, error: "Compiled successfully but API failed to hot-reload." };
          }
        } catch (e) {
          return { success: false, error: `Hot reload fetch failed: ${e.message}` };
        }

        return { 
          success: true, 
          message: `Plugin '${pluginId}' successfully written, compiled, and hot-loaded into the active engine! You may now use it on your next turn.` 
        };
      }
    })
  ]
}));
