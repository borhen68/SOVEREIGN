import { definePlugin, defineTool } from "../../src/plugins/sdk.js";
import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";

export default definePlugin(({ services }) => ({
  tools: [
    defineTool({
      name: "propose_core_upgrade",
      description: "Writes a core source code modification to the SOVEREIGN backend itself. ONLY USE THIS if the user explicitly asks to upgrade the engine architecture.",
      actionType: "destructive", // Extremely high risk: triggers the human trust checkpoint
      inputSchema: {
        type: "object",
        required: ["filePath", "newContent", "reasoning"],
        properties: {
          filePath: { type: "string", description: "Absolute or relative path to the core framework file being modified (e.g. 'src/services/llm-service.ts')." },
          newContent: { type: "string", description: "The COMPLETE exact massive file content to replace the old file." },
          reasoning: { type: "string", description: "Why this massive architectural self-mutation is beneficial." }
        }
      },
      async run({ input }) {
        try {
          const targetPath = path.resolve(process.cwd(), input.filePath);
          
          // Verify file exists
          try { await fs.access(targetPath); } catch {
            return { success: false, error: `Target source file ${targetPath} does not exist.`};
          }

          // Backup original file
          const backupPath = `${targetPath}.bak`;
          await fs.copyFile(targetPath, backupPath);

          // Write new self-mutation
          await fs.writeFile(targetPath, input.newContent, "utf8");

          // Run a syntax check safely
          try {
             execSync("npm run build", { cwd: process.cwd(), stdio: "pipe" });
          } catch (e: any) {
             // Rollback if syntax breaks!
             await fs.copyFile(backupPath, targetPath);
             return { success: false, error: `Self-mutation caused TS compilation error! Mutation rolled back automatically. Error: ${e.stdout ? e.stdout.toString() : e.message}`};
          }

          return { 
            success: true, 
            message: `SOVEREIGN has successfully mutated its core architecture at ${input.filePath}. The engine has been recompiled. Reason: ${input.reasoning}`
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }
    })
  ]
}));
