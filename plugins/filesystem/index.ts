import { promises as fs } from "node:fs";
import * as path from "node:path";
import { definePlugin, defineTool } from "../../src/plugins/sdk.js";

function resolveSafePath(cwd: string, relativeOrAbsolutePath: string) {
  if (path.isAbsolute(relativeOrAbsolutePath)) {
    return relativeOrAbsolutePath;
  }
  return path.resolve(cwd, relativeOrAbsolutePath);
}

export default definePlugin(() => ({
  tools: [
    defineTool({
      name: "read_file",
      description: "Read the contents of a local file.",
      actionType: "read",
      inputSchema: {
        type: "object",
        required: ["path"],
        properties: {
          path: { type: "string", description: "Path to the file to read" }
        }
      },
      async run({ input }) {
        try {
          const target = resolveSafePath(process.cwd(), input.path);
          const content = await fs.readFile(target, "utf-8");
          return { success: true, path: target, content };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }
    }),
    defineTool({
      name: "write_file",
      description: "Write content to a local file, overwriting it if it exists.",
      actionType: "write",
      inputSchema: {
        type: "object",
        required: ["path", "content"],
        properties: {
          path: { type: "string", description: "Path to the file to write" },
          content: { type: "string", description: "File content to write" }
        }
      },
      async run({ input }) {
        try {
          const target = resolveSafePath(process.cwd(), input.path);
          const dir = path.dirname(target);
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(target, input.content, "utf-8");
          return { success: true, path: target };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }
    }),
    defineTool({
      name: "list_directory",
      description: "List all files and folders in a local directory.",
      actionType: "read",
      inputSchema: {
        type: "object",
        required: ["path"],
        properties: {
          path: { type: "string", description: "Path of the directory to list" }
        }
      },
      async run({ input }) {
        try {
          const target = resolveSafePath(process.cwd(), input.path);
          const items = await fs.readdir(target, { withFileTypes: true });
          const entries = items.map(item => ({
            name: item.name,
            isDirectory: item.isDirectory(),
            isFile: item.isFile()
          }));
          return { success: true, path: target, entries };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }
    })
  ]
}));
