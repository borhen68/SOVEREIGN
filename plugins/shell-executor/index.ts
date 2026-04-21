// @ts-nocheck
import { definePlugin, defineTool } from "../../src/plugins/sdk.js";
import { exec } from "child_process";

export default definePlugin(({ services }) => ({
  tools: [
    defineTool({
      name: "run_command",
      description: "Executes a shell command on the host. Useful for running git, npm, node, python, or compiling checking code. Note: the command runs in the project root by default.",
      actionType: "destructive", // Requires trust gate
      inputSchema: {
        type: "object",
        required: ["command"],
        properties: {
          command: {
            type: "string",
            description: "The shell command to execute."
          },
          timeout: {
            type: "number",
            description: "Optional timeout in milliseconds (default: 30000)."
          }
        }
      },
      async run({ input }) {
        const { command, timeout = 30000 } = input;
        
        return new Promise((resolve) => {
          exec(
            command,
            { cwd: process.cwd(), timeout, maxBuffer: 1024 * 1024 * 10 },
            (error, stdout, stderr) => {
              const output = {
                command,
                stdout: stdout || "",
                stderr: stderr || "",
                exitCode: error ? error.code : 0,
                success: !error
              };
              
              if (error && error.killed) {
                output.stderr = `Command timed out after ${timeout}ms\n` + output.stderr;
              }

              resolve(output);
            }
          );
        });
      }
    })
  ]
}));
