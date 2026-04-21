import { definePlugin, defineTool } from "../../src/plugins/sdk.js";

export default definePlugin(({ services }) => ({
  tools: [
    defineTool({
      name: "create_routine",
      description: "Schedules a periodic mission that the agent will run autonomously at the specified interval.",
      actionType: "write",
      inputSchema: {
        type: "object",
        required: ["name", "prompt", "intervalMinutes"],
        properties: {
          name: { type: "string" },
          prompt: { type: "string", description: "The mission objective to run periodically." },
          intervalMinutes: { type: "number", minimum: 1, description: "Frequency of execution." }
        }
      },
      async run({ input }) {
        if (!services.store) return { success: false, error: "Store not available." };
        try {
          // Access internal heartbeat system via store since it's the source of truth for jobs
          const job = await services.store.createHeartbeatJob({
            id: `hjob-${Date.now()}`,
            workspaceId: "default",
            name: input.name,
            prompt: input.prompt,
            type: "company-objective",
            intervalMinutes: input.intervalMinutes,
            status: "active",
            nextRunAt: new Date(Date.now() + input.intervalMinutes * 60000).toISOString(),
            createdAt: new Date().toISOString()
          });
          return { success: true, jobId: job.id, message: `Routine '${input.name}' scheduled every ${input.intervalMinutes} minutes.` };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }
    }),
    defineTool({
      name: "list_routines",
      description: "Lists all currently active autonomous routines and scheduled missions.",
      actionType: "read",
      inputSchema: { type: "object", properties: {} },
      async run() {
        if (!services.store) return { success: false, error: "Store not available." };
        try {
          const jobs = await services.store.listHeartbeatJobs();
          return { success: true, routines: jobs };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }
    })
  ]
}));
