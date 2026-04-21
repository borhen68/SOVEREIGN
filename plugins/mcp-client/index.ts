// @ts-nocheck
import { definePlugin } from "../../src/plugins/sdk.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";

// To prevent reconnection loops in dev or multi-agent spawns
globalThis.mcpGlobalClients = globalThis.mcpGlobalClients || new Map();

export default definePlugin(async ({ log }) => {
  const rootTools = [];
  
  // Read mcp_servers.json from project root, or fallback to env.
  let mcpServers = {};
  const configPath = process.env.MCP_SERVERS_CONFIG || "./mcp_servers.json";
  
  if (fs.existsSync(configPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
      mcpServers = parsed.mcpServers || parsed;
      log.info(`Loaded MCP servers config from ${configPath}`);
    } catch (e) {
      log.error(`Failed to parse MCP servers config file:`, e);
    }
  }

  for (const [serverName, config] of Object.entries(mcpServers)) {
    try {
      if (!config.command) continue;

      let client = globalThis.mcpGlobalClients.get(serverName);

      if (!client) {
        log.info(`Connecting to MCP server: ${serverName}`);
        const transport = new StdioClientTransport({
          command: config.command,
          args: config.args || [],
          env: { ...process.env, ...(config.env || {}) }
        });

        client = new Client(
          { name: `sovereign-agent`, version: "1.0.0" },
          { capabilities: { tools: {} } }
        );

        await client.connect(transport);
        globalThis.mcpGlobalClients.set(serverName, client);
      }

      const res = await client.listTools();
      const serverTools = res.tools || [];
      
      for (const t of serverTools) {
        // Namespace the tool name to avoid collisions
        const safeToolName = `${serverName}_mcp_${t.name}`.replace(/[^a-zA-Z0-9_-]/g, "_");
        
        rootTools.push({
          name: safeToolName,
          description: t.description || `MCP Tool ${t.name} from ${serverName}`,
          inputSchema: t.inputSchema,
          actionType: "default", // We could potentially make some MCP tools 'destructive' if labeled
          async run({ input }) {
            const currentClient = globalThis.mcpGlobalClients.get(serverName);
            if (!currentClient) {
               throw new Error(`MCP Server ${serverName} is disconnected.`);
            }
            
            const response = await currentClient.callTool({
              name: t.name,
              arguments: input
            });
            
            // Reformat MCP content response into a readable string for the SOVEREIGN agent
            if (response && Array.isArray(response.content)) {
                return response.content.map(c => c.type === 'text' ? c.text : JSON.stringify(c)).join("\n");
            }
            
            return response;
          }
        });
      }

      log.info(`Registered ${serverTools.length} tools from MCP server '${serverName}'`);

    } catch (e) {
      log.error(`Failed to initialize MCP Server ${serverName}:`, e);
    }
  }

  return { tools: rootTools };
});
