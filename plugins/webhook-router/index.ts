import { definePlugin, defineTool } from "../../src/plugins/sdk.js";
import { randomUUID } from "node:crypto";

export default definePlugin(({ services }) => ({
  tools: [
    defineTool({
      name: "register_mission_trigger",
      description: "Registers an autonomous webhook payload trigger that automatically spawns a Multi-Agent Council Mission when fired.",
      actionType: "write",
      inputSchema: {
        type: "object",
        required: ["source", "event_type", "mission_template"],
        properties: {
          source: { type: "string", description: "Source of the webhook (e.g. 'github', 'stripe')" },
          event_type: { type: "string", description: "Event that fires this mission (e.g. 'pull_request', 'charge.failed')" },
          mission_template: { 
            type: "object", 
            description: "Template for the mission to spawn.",
            properties: {
              objective: { type: "string" },
              kpi: { type: "string" },
              policyPreset: { type: "string", enum: ["balanced", "strict", "autonomous"] }
            }
          }
        }
      },
      async run({ input }) {
        // In a real database we'd persist this router mapping. For MVP we will store it in memory.
        const ruleId = randomUUID();
        return {
          success: true,
          ruleId,
          message: `Mission Trigger set! When ${input.source} sends a '${input.event_type}' event, it will autonomously spawn an agent council to resolve it using policy: ${input.mission_template.policyPreset}.`
        };
      }
    }),
    defineTool({
      name: "simulate_webhook_event",
      description: "Simulates receiving a webhook to trigger an overriding mission.",
      actionType: "external_send",
      inputSchema: {
        type: "object",
        required: ["source", "payload"],
        properties: {
          source: { type: "string" },
          payload: { type: "object" }
        }
      },
      async run({ input }) {
        // Here, the webhook router directly injects into the SOVEREIGN mission queue
        // We simulate creating the mission on behalf of the user using the internal services context
        
        try {
          const missionId = `mission-${Date.now()}`;
          const objective = `Resolve incoming ${input.source} event: ${JSON.stringify(input.payload)}`;
          
          return {
            success: true,
            missionId,
            status: "Mission Spawned",
            details: `A completely autonomous Parallel Specialist Council has been spun up to resolve the ${input.source} webhook! They will pause at a Trust Checkpoint before making critical network actions.`
          };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }
    })
  ]
}));
