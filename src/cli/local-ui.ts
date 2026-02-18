// @ts-nocheck
import process from "node:process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createApi } from "../server.js";
import { AgentRole } from "../domain/constants.js";

const DEFAULT_WORKSPACE_ID = "default";
const CLI_USER_ID = "local-cli-user";

function normalizeString(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function uniqueList(values, options = {}) {
  const caseInsensitive = options.caseInsensitive !== false;
  const seen = new Set();
  const outputList = [];
  for (const item of values) {
    const value = normalizeString(item);
    if (!value) {
      continue;
    }
    const key = caseInsensitive ? value.toLowerCase() : value;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    outputList.push(value);
  }
  return outputList;
}

function parseCsv(inputValue) {
  return uniqueList(
    String(inputValue ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function dedupeFallbacks(fallbacks, primary) {
  const primaryKey = normalizeString(primary).toLowerCase();
  const seen = new Set(primaryKey ? [primaryKey] : []);
  const outputList = [];
  for (const item of fallbacks) {
    const value = normalizeString(item);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) {
      continue;
    }
    seen.add(key);
    outputList.push(value);
  }
  return outputList;
}

function formatModel(model) {
  const primary = normalizeString(model?.primary);
  const fallbacks = Array.isArray(model?.fallbacks) ? model.fallbacks : [];
  if (!primary) {
    return "none";
  }
  if (fallbacks.length === 0) {
    return primary;
  }
  return `${primary} (+${fallbacks.length} fallback)`;
}

function printLine(text = "") {
  output.write(`${String(text)}\n`);
}

async function ask(rl, prompt, defaultValue = "") {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = await rl.question(`${prompt}${suffix}: `);
  const value = normalizeString(answer);
  if (value) {
    return value;
  }
  return normalizeString(defaultValue);
}

async function askRequired(rl, prompt) {
  while (true) {
    const value = normalizeString(await rl.question(`${prompt}: `));
    if (value) {
      return value;
    }
    printLine("Input required.");
  }
}

async function askYesNo(rl, prompt, defaultValue = true) {
  const defaultHint = defaultValue ? "Y/n" : "y/N";
  const answer = normalizeString(await rl.question(`${prompt} (${defaultHint}): `)).toLowerCase();
  if (!answer) {
    return defaultValue;
  }
  if (["y", "yes"].includes(answer)) {
    return true;
  }
  if (["n", "no"].includes(answer)) {
    return false;
  }
  return defaultValue;
}

function listConfiguredModelRefs(llmService) {
  if (!llmService || typeof llmService.listModelRefs !== "function") {
    return [];
  }
  const seen = new Set();
  const refs = [];
  for (const entry of llmService.listModelRefs({ configuredOnly: true })) {
    const modelRef = normalizeString(entry?.modelRef);
    const key = modelRef.toLowerCase();
    if (!modelRef || seen.has(key)) {
      continue;
    }
    seen.add(key);
    refs.push(modelRef);
  }
  return refs;
}

function normalizeModelRef(llmService, modelRef) {
  const raw = normalizeString(modelRef);
  if (!raw) {
    return {
      value: "",
      error: ""
    };
  }
  if (!llmService || typeof llmService.normalizeModelRef !== "function") {
    return {
      value: raw,
      error: ""
    };
  }
  try {
    const normalized = llmService.normalizeModelRef(raw);
    if (!normalized) {
      return {
        value: "",
        error: `Invalid model ref '${raw}'. Use provider/model.`
      };
    }
    return {
      value: normalized,
      error: ""
    };
  } catch (error) {
    return {
      value: "",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function createAgent(rl, agentService, workspaceId) {
  printLine("\nCreate new agent");
  const name = await askRequired(rl, "Agent name");
  const roleInput = normalizeString(
    await ask(rl, "Role (main/sub)", AgentRole.MAIN),
    AgentRole.MAIN
  ).toLowerCase();
  const role = roleInput === AgentRole.SUB ? AgentRole.SUB : AgentRole.MAIN;
  const title = await ask(rl, "Title (optional)");
  const mission = await ask(rl, "Soul mission (optional)");
  const soulValues = parseCsv(await ask(rl, "Soul values comma-separated (optional)"));
  const skills = parseCsv(await ask(rl, "Initial skills comma-separated (optional)"));
  const canUseWeb = await askYesNo(rl, "Allow web research", true);

  const agent = await agentService.createAgent({
    workspaceId,
    name,
    role,
    title,
    skills,
    soul: {
      mission,
      values: soulValues,
      communicationStyle: "direct",
      riskTolerance: "balanced"
    },
    canUseWeb
  });
  printLine(`Created agent ${agent.name} (${agent.id}).`);
  return agent;
}

async function selectAgent(rl, agentService, workspaceId) {
  while (true) {
    const agents = await agentService.listAgents(workspaceId);
    if (!Array.isArray(agents) || agents.length === 0) {
      printLine(`No agents found in workspace '${workspaceId}'.`);
      return createAgent(rl, agentService, workspaceId);
    }

    printLine("\nAgents");
    for (let index = 0; index < agents.length; index += 1) {
      const agent = agents[index];
      printLine(`${index + 1}) ${agent.name} [${agent.role}] model=${formatModel(agent.model)}`);
    }
    printLine("n) Create new agent");
    const rawChoice = normalizeString(
      await rl.question("Select agent number or 'n': ")
    ).toLowerCase();
    if (rawChoice === "n" || rawChoice === "new") {
      return createAgent(rl, agentService, workspaceId);
    }

    const parsed = Number(rawChoice);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= agents.length) {
      return agents[parsed - 1];
    }
    printLine("Invalid choice.");
  }
}

async function selectModelPolicy(rl, llmService, currentModel) {
  const currentPrimary = normalizeString(currentModel?.primary);
  const currentFallbacks = Array.isArray(currentModel?.fallbacks) ? currentModel.fallbacks : [];
  const configuredModelRefs = listConfiguredModelRefs(llmService);

  printLine(`Current model: ${formatModel(currentModel)}`);
  if (configuredModelRefs.length > 0) {
    printLine("Configured models:");
    for (let index = 0; index < configuredModelRefs.length; index += 1) {
      printLine(`  ${index + 1}) ${configuredModelRefs[index]}`);
    }
  } else {
    printLine("No configured models found from provider API keys.");
  }

  while (true) {
    const prompt =
      configuredModelRefs.length > 0
        ? "Select number, 'c' custom, or Enter keep current"
        : "Type 'c' for custom model or Enter keep current";
    const rawChoice = normalizeString(await rl.question(`${prompt}: `)).toLowerCase();
    if (!rawChoice) {
      return {
        primary: currentPrimary,
        fallbacks: currentFallbacks
      };
    }
    if (rawChoice === "c" || rawChoice === "custom") {
      const customPrimaryRaw = await askRequired(rl, "Primary modelRef (provider/model)");
      const normalizedPrimary = normalizeModelRef(llmService, customPrimaryRaw);
      if (!normalizedPrimary.value) {
        printLine(`Invalid model: ${normalizedPrimary.error}`);
        continue;
      }
      const fallbackInput = await ask(rl, "Fallback modelRefs comma-separated (optional)");
      const candidateFallbacks = parseCsv(fallbackInput);
      const normalizedFallbacks = [];
      for (const fallback of candidateFallbacks) {
        const normalizedFallback = normalizeModelRef(llmService, fallback);
        if (normalizedFallback.value) {
          normalizedFallbacks.push(normalizedFallback.value);
          continue;
        }
        printLine(`Skipping fallback '${fallback}': ${normalizedFallback.error}`);
      }
      return {
        primary: normalizedPrimary.value,
        fallbacks: dedupeFallbacks(normalizedFallbacks, normalizedPrimary.value)
      };
    }

    const selectedIndex = Number(rawChoice);
    if (
      Number.isInteger(selectedIndex) &&
      selectedIndex >= 1 &&
      selectedIndex <= configuredModelRefs.length
    ) {
      const primary = configuredModelRefs[selectedIndex - 1];
      const includeFallbacks = await askYesNo(rl, "Use other configured models as fallbacks", true);
      const extraFallbacks = includeFallbacks
        ? configuredModelRefs.filter((modelRef) => modelRef !== primary)
        : [];
      const mergedFallbacks = dedupeFallbacks([...currentFallbacks, ...extraFallbacks], primary);
      return {
        primary,
        fallbacks: mergedFallbacks
      };
    }

    printLine("Invalid choice.");
  }
}

async function configureAgentModel(rl, agentService, llmService, agent) {
  printLine(`\nModel setup for ${agent.name}`);
  const model = await selectModelPolicy(rl, llmService, agent.model ?? {});
  if (!model.primary) {
    printLine("No model selected. Agent remains without model policy.");
    return agent;
  }
  const updated = await agentService.updateAgent(agent.id, {
    model
  });
  printLine(`Saved model policy: ${formatModel(updated.model)}`);
  return updated;
}

function buildChatId(workspaceId, agentId) {
  return `cli-${workspaceId}-${agentId}`;
}

async function main() {
  const api = createApi({
    cwd: process.cwd()
  });
  const rl = readline.createInterface({ input, output });
  let interrupted = false;

  const onSigint = () => {
    interrupted = true;
    printLine("\nStopping local CLI...");
    rl.close();
  };
  process.once("SIGINT", onSigint);

  try {
    printLine("SOVEREIGN Local CLI");
    printLine("Use /switch to change agent, /model to update model, /exit to quit.");

    const workspaceId = await ask(rl, "Workspace ID", DEFAULT_WORKSPACE_ID);
    let activeAgent = await selectAgent(rl, api.agentService, workspaceId);
    activeAgent = await configureAgentModel(rl, api.agentService, api.llmService, activeAgent);

    while (true) {
      const text = normalizeString(await rl.question("\nYou > "));
      if (!text) {
        continue;
      }
      if (text === "/exit" || text === "exit") {
        break;
      }
      if (text === "/switch") {
        activeAgent = await selectAgent(rl, api.agentService, workspaceId);
        activeAgent = await configureAgentModel(rl, api.agentService, api.llmService, activeAgent);
        continue;
      }
      if (text === "/model") {
        activeAgent = await configureAgentModel(rl, api.agentService, api.llmService, activeAgent);
        continue;
      }
      if (text === "/who") {
        printLine(`Active agent: ${activeAgent.name} (${activeAgent.role})`);
        printLine(`Model: ${formatModel(activeAgent.model)}`);
        continue;
      }

      try {
        const result = await api.channelGatewayService.processWebhook("local", {
          workspaceId,
          chatId: buildChatId(workspaceId, activeAgent.id),
          userId: CLI_USER_ID,
          text,
          metadata: {
            source: "local-cli",
            activeAgentId: activeAgent.id
          }
        });
        const reply = normalizeString(result?.responses?.[0]?.reply, "(no reply)");
        printLine(`\n${activeAgent.name} > ${reply}`);
      } catch (error) {
        printLine(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    if (!interrupted) {
      printLine(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
    if (api.autopilotService && typeof api.autopilotService.stop === "function") {
      api.autopilotService.stop();
    }
    rl.close();
  }
}

main();
