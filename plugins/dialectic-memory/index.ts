import { definePlugin, defineTool } from "../../src/plugins/sdk.js";
import fs from "node:fs/promises";
import path from "node:path";

const PROFILE_FILE = path.join(process.cwd(), ".dialectic_profile.json");

async function loadProfile() {
  try {
    const data = await fs.readFile(PROFILE_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return { preferences: [], workflowRules: [], beliefs: [] };
  }
}

async function saveProfile(profile: any) {
  await fs.writeFile(PROFILE_FILE, JSON.stringify(profile, null, 2), "utf8");
}

export default definePlugin(({ services }) => ({
  tools: [
    defineTool({
      name: "extract_user_preference",
      description: "Extracts an implicit or explicit user preference from the current conversation and saves it permanently into the user's neural profile graph.",
      actionType: "write",
      inputSchema: {
        type: "object",
        required: ["category", "fact", "confidence"],
        properties: {
          category: { type: "string", enum: ["preferences", "workflowRules", "beliefs"], description: "The type of memory to store." },
          fact: { type: "string", description: "The concisely stated fact (e.g. 'User prefers TailwindCSS over Vanilla CSS' or 'User hates hallucinated answers')." },
          confidence: { type: "number", description: "Confidence score 0.0 to 1.0 of this fact being universally true." }
        }
      },
      async run({ input }) {
        try {
          const profile = await loadProfile();
          if (!profile[input.category]) profile[input.category] = [];
          
          // Deduplicate
          const exists = profile[input.category].find((t: any) => t.fact === input.fact);
          if (!exists) {
             profile[input.category].push({ fact: input.fact, confidence: input.confidence, timestamp: new Date().toISOString() });
             await saveProfile(profile);
          }
          
          return { success: true, message: `Fact permanently encoded into the user's Dialectic Profile.` };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }
    }),
    defineTool({
      name: "query_user_profile",
      description: "Reads everything SOVEREIGN permanently knows about the user's workflows, preferences, and beliefs.",
      actionType: "read",
      inputSchema: {
        type: "object",
        properties: {}
      },
      async run() {
        try {
          const profile = await loadProfile();
          return { success: true, profile };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }
    })
  ]
}));
