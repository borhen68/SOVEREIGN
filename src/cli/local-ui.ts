// @ts-nocheck
import process from "node:process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createApi } from "../server.js";
import { AgentRole } from "../domain/constants.js";

const DEFAULT_WORKSPACE_ID = "default";
const CLI_USER_ID = "local-cli-user";
const COLOR_ENABLED = Boolean(output.isTTY) && process.env.NO_COLOR !== "1";
const SPINNER_FRAMES = ["-", "\\", "|", "/"];

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m"
};

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

function terminalWidth() {
  const width = Number(output.columns);
  if (!Number.isInteger(width) || width < 40) {
    return 100;
  }
  return Math.min(width, 140);
}

function colorize(text, ...codes) {
  const value = String(text);
  if (!COLOR_ENABLED || codes.length === 0) {
    return value;
  }
  return `${codes.join("")}${value}${ANSI.reset}`;
}

function stripAnsi(value) {
  return String(value).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function repeat(char, length) {
  return String(char).repeat(Math.max(0, length));
}

function padRight(text, width) {
  const value = String(text);
  const length = stripAnsi(value).length;
  if (length >= width) {
    return value;
  }
  return `${value}${repeat(" ", width - length)}`;
}

function printLine(text = "") {
  output.write(`${String(text)}\n`);
}

function clearScreen() {
  if (!output.isTTY) {
    return;
  }
  output.write("\x1Bc");
}

function wrapText(text, width) {
  const safeWidth = Math.max(20, Number(width) || 80);
  const source = String(text ?? "");
  if (!source) {
    return [""];
  }
  const segments = [];
  for (const paragraph of source.split(/\r?\n/)) {
    const trimmed = paragraph.trim();
    if (!trimmed) {
      segments.push("");
      continue;
    }
    const words = trimmed.split(/\s+/);
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (stripAnsi(next).length > safeWidth) {
        if (line) {
          segments.push(line);
        }
        if (stripAnsi(word).length > safeWidth) {
          let chunk = word;
          while (chunk.length > safeWidth) {
            segments.push(chunk.slice(0, safeWidth));
            chunk = chunk.slice(safeWidth);
          }
          line = chunk;
        } else {
          line = word;
        }
      } else {
        line = next;
      }
    }
    if (line || trimmed.length === 0) {
      segments.push(line);
    }
  }
  return segments.length > 0 ? segments : [""];
}

function renderPanel(title, lines, options = {}) {
  const width = Math.min(terminalWidth(), Number(options.width) || terminalWidth());
  const tone = options.tone ?? ANSI.cyan;
  const normalizedTitle = normalizeString(title, "Panel");
  const normalizedLines = Array.isArray(lines) ? lines : [String(lines ?? "")];
  const flattenedLines = [];
  for (const line of normalizedLines) {
    const wrapped = wrapText(line, width - 6);
    for (const piece of wrapped) {
      flattenedLines.push(piece);
    }
  }
  const contentWidth = Math.max(30, width - 4);
  const top = `+${repeat("-", contentWidth + 2)}+`;
  const titleText = colorize(` ${normalizedTitle} `, ANSI.bold, tone);
  printLine(colorize(top, tone));
  printLine(colorize(`| ${padRight(titleText, contentWidth)} |`, tone));
  printLine(colorize(`| ${padRight(repeat("-", Math.min(contentWidth, 24)), contentWidth)} |`, tone));
  for (const line of flattenedLines) {
    printLine(colorize(`| ${padRight(line, contentWidth)} |`, tone));
  }
  printLine(colorize(top, tone));
}

function printHeader() {
  clearScreen();
  const width = terminalWidth();
  const title = "SOVEREIGN LOCAL CONSOLE";
  const subtitle = "Multi-agent command center";
  printLine(colorize(repeat("=", Math.max(40, width)), ANSI.gray));
  printLine(colorize(title, ANSI.bold, ANSI.cyan));
  printLine(colorize(subtitle, ANSI.dim));
  printLine(colorize(repeat("=", Math.max(40, width)), ANSI.gray));
  printLine();
}

function renderCommands() {
  renderPanel(
    "Commands",
    [
      "/help      Show command list",
      "/switch    Change active agent",
      "/model     Update active agent model policy",
      "/who       Show active agent details",
      "/clear     Clear terminal and redraw UI",
      "/history   Show latest chat turns",
      "/exit      Quit local console"
    ],
    { tone: ANSI.blue, width: 80 }
  );
}

function renderStatus(workspaceId, agent) {
  const role = normalizeString(agent?.role, "unknown").toUpperCase();
  const model = formatModel(agent?.model);
  const values = Array.isArray(agent?.soul?.values) ? agent.soul.values : [];
  renderPanel(
    "Session",
    [
      `Workspace : ${workspaceId}`,
      `Agent     : ${normalizeString(agent?.name, "unknown")} (${role})`,
      `Model     : ${model}`,
      `Web       : ${agent?.canUseWeb ? "enabled" : "disabled"}`,
      `Soul      : ${values.length > 0 ? values.join(", ") : "none"}`
    ],
    { tone: ANSI.magenta, width: 92 }
  );
}

function renderProviderHint(llmService) {
  const configured = listConfiguredModelRefs(llmService);
  if (configured.length > 0) {
    renderPanel(
      "LLM Providers",
      [
        `Configured model refs: ${configured.length}`,
        "You can pick one now or later with /model."
      ],
      { tone: ANSI.green, width: 86 }
    );
    return;
  }
  renderPanel(
    "LLM Providers",
    [
      "No provider API keys detected in this shell.",
      "Set OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY, then restart CLI.",
      "Or run local-only with Ollama by setting OLLAMA_BASE_URL and OLLAMA_MODEL."
    ],
    { tone: ANSI.yellow, width: 108 }
  );
}

function renderMessage(label, text, options = {}) {
  const tone = options.tone ?? ANSI.cyan;
  const body = normalizeString(text, "(empty)");
  renderPanel(label, body.split(/\r?\n/), { tone, width: terminalWidth() });
}

async function ask(rl, prompt, defaultValue = "") {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = await rl.question(
    colorize(`${prompt}${suffix}: `, ANSI.bold, ANSI.cyan)
  );
  const value = normalizeString(answer);
  if (value) {
    return value;
  }
  return normalizeString(defaultValue);
}

async function askRequired(rl, prompt) {
  while (true) {
    const value = normalizeString(await rl.question(colorize(`${prompt}: `, ANSI.bold, ANSI.cyan)));
    if (value) {
      return value;
    }
    printLine(colorize("Input required.", ANSI.yellow));
  }
}

async function askYesNo(rl, prompt, defaultValue = true) {
  const defaultHint = defaultValue ? "Y/n" : "y/N";
  const answer = normalizeString(
    await rl.question(colorize(`${prompt} (${defaultHint}): `, ANSI.bold, ANSI.cyan))
  ).toLowerCase();
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
  renderPanel(
    "Create Agent",
    [
      "Define the new agent profile.",
      "Tip: main agent = coordinator, sub agent = specialist."
    ],
    { tone: ANSI.green, width: 86 }
  );
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
  printLine(colorize(`Created agent ${agent.name} (${agent.id}).`, ANSI.green));
  return agent;
}

async function selectAgent(rl, agentService, workspaceId) {
  while (true) {
    const agents = await agentService.listAgents(workspaceId);
    if (!Array.isArray(agents) || agents.length === 0) {
      printLine(colorize(`No agents found in workspace '${workspaceId}'.`, ANSI.yellow));
      return createAgent(rl, agentService, workspaceId);
    }

    const rows = agents.map((agent, index) => {
      return `${index + 1}. ${agent.name} [${agent.role}]  model=${formatModel(agent.model)}`;
    });
    rows.push("n. Create new agent");
    renderPanel("Agent Picker", rows, { tone: ANSI.green, width: 110 });

    const rawChoice = normalizeString(
      await rl.question(colorize("Select agent number or 'n': ", ANSI.bold, ANSI.cyan))
    ).toLowerCase();
    if (rawChoice === "n" || rawChoice === "new") {
      return createAgent(rl, agentService, workspaceId);
    }

    const parsed = Number(rawChoice);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= agents.length) {
      return agents[parsed - 1];
    }
    printLine(colorize("Invalid choice.", ANSI.yellow));
  }
}

async function selectModelPolicy(rl, llmService, currentModel) {
  const currentPrimary = normalizeString(currentModel?.primary);
  const currentFallbacks = Array.isArray(currentModel?.fallbacks) ? currentModel.fallbacks : [];
  const configuredModelRefs = listConfiguredModelRefs(llmService);

  const lines = [`Current model: ${formatModel(currentModel)}`];
  if (configuredModelRefs.length > 0) {
    lines.push("Configured models:");
    for (let index = 0; index < configuredModelRefs.length; index += 1) {
      lines.push(`  ${index + 1}. ${configuredModelRefs[index]}`);
    }
  } else {
    lines.push("No configured models found from provider API keys.");
  }
  renderPanel("Model Policy", lines, { tone: ANSI.yellow, width: 110 });

  while (true) {
    const prompt =
      configuredModelRefs.length > 0
        ? "Select number, 'c' custom, or Enter keep current"
        : "Type 'c' for custom model or Enter keep current";
    const rawChoice = normalizeString(await rl.question(colorize(`${prompt}: `, ANSI.bold, ANSI.cyan))).toLowerCase();
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
        printLine(colorize(`Invalid model: ${normalizedPrimary.error}`, ANSI.red));
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
        printLine(colorize(`Skipping fallback '${fallback}': ${normalizedFallback.error}`, ANSI.yellow));
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

    printLine(colorize("Invalid choice.", ANSI.yellow));
  }
}

async function configureAgentModel(rl, agentService, llmService, agent) {
  const model = await selectModelPolicy(rl, llmService, agent.model ?? {});
  if (!model.primary) {
    printLine(colorize("No model selected. Agent remains without model policy.", ANSI.yellow));
    return agent;
  }
  const updated = await agentService.updateAgent(agent.id, {
    model
  });
  printLine(colorize(`Saved model policy: ${formatModel(updated.model)}`, ANSI.green));
  return updated;
}

function buildChatId(workspaceId, agentId) {
  return `cli-${workspaceId}-${agentId}`;
}

async function withSpinner(label, fn) {
  if (!output.isTTY) {
    return fn();
  }
  const safeLabel = normalizeString(label, "Working");
  let frame = 0;
  const interval = setInterval(() => {
    const glyph = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
    frame += 1;
    output.write(`\r${colorize(glyph, ANSI.cyan)} ${safeLabel}`);
  }, 80);
  try {
    return await fn();
  } finally {
    clearInterval(interval);
    output.write(`\r${repeat(" ", safeLabel.length + 6)}\r`);
  }
}

function renderHistory(transcript) {
  if (!Array.isArray(transcript) || transcript.length === 0) {
    renderPanel("History", ["No messages yet."], { tone: ANSI.gray, width: 82 });
    return;
  }
  const tail = transcript.slice(-10);
  const lines = [];
  for (const item of tail) {
    const role = item.role === "assistant" ? "assistant" : "user";
    const text = normalizeString(item.text).replace(/\s+/g, " ");
    const clipped = text.length > 130 ? `${text.slice(0, 127)}...` : text;
    lines.push(`${role}: ${clipped}`);
  }
  renderPanel("History (latest 10)", lines, { tone: ANSI.gray, width: 120 });
}

function renderWho(agent) {
  const skills = Array.isArray(agent?.skills) ? agent.skills : [];
  const lines = [
    `Id        : ${normalizeString(agent?.id, "unknown")}`,
    `Name      : ${normalizeString(agent?.name, "unknown")}`,
    `Role      : ${normalizeString(agent?.role, "unknown")}`,
    `Model     : ${formatModel(agent?.model)}`,
    `Can Web   : ${agent?.canUseWeb ? "yes" : "no"}`,
    `Soul      : ${normalizeString(agent?.soul?.mission, "none")}`,
    `Skills    : ${skills.length > 0 ? skills.join(", ") : "none"}`
  ];
  renderPanel("Active Agent", lines, { tone: ANSI.magenta, width: 98 });
}

async function main() {
  const api = createApi({
    cwd: process.cwd()
  });
  const rl = readline.createInterface({ input, output });
  const transcript = [];
  let interrupted = false;

  const onSigint = () => {
    interrupted = true;
    printLine(colorize("\nStopping local console...", ANSI.yellow));
    rl.close();
  };
  process.once("SIGINT", onSigint);

  try {
    printHeader();
    renderCommands();
    renderProviderHint(api.llmService);

    const workspaceId = await ask(rl, "Workspace ID", DEFAULT_WORKSPACE_ID);
    let activeAgent = await selectAgent(rl, api.agentService, workspaceId);
    const shouldConfigure = await askYesNo(
      rl,
      `Set LLM model for '${activeAgent.name}' now (provider/model, e.g. openai/gpt-4o-mini)`,
      !normalizeString(activeAgent?.model?.primary)
    );
    if (shouldConfigure) {
      activeAgent = await configureAgentModel(rl, api.agentService, api.llmService, activeAgent);
    }
    renderStatus(workspaceId, activeAgent);

    while (true) {
      const prompt = colorize("you > ", ANSI.bold, ANSI.cyan);
      const text = normalizeString(await rl.question(prompt));
      if (!text) {
        continue;
      }

      const command = text.toLowerCase();
      if (command === "/exit" || command === "exit") {
        break;
      }
      if (command === "/help") {
        renderCommands();
        continue;
      }
      if (command === "/clear") {
        printHeader();
        renderCommands();
        renderStatus(workspaceId, activeAgent);
        continue;
      }
      if (command === "/switch") {
        activeAgent = await selectAgent(rl, api.agentService, workspaceId);
        const configureAfterSwitch = await askYesNo(
          rl,
          `Set LLM model for '${activeAgent.name}' now (provider/model)`,
          !normalizeString(activeAgent?.model?.primary)
        );
        if (configureAfterSwitch) {
          activeAgent = await configureAgentModel(rl, api.agentService, api.llmService, activeAgent);
        }
        renderStatus(workspaceId, activeAgent);
        continue;
      }
      if (command === "/model") {
        activeAgent = await configureAgentModel(rl, api.agentService, api.llmService, activeAgent);
        renderStatus(workspaceId, activeAgent);
        continue;
      }
      if (command === "/who") {
        renderWho(activeAgent);
        continue;
      }
      if (command === "/history") {
        renderHistory(transcript);
        continue;
      }

      transcript.push({
        role: "user",
        text
      });
      renderMessage("You", text, { tone: ANSI.blue });

      try {
        const result = await withSpinner("Agent is thinking...", async () => {
          return api.channelGatewayService.processWebhook("local", {
            workspaceId,
            chatId: buildChatId(workspaceId, activeAgent.id),
            userId: CLI_USER_ID,
            text,
            metadata: {
              source: "local-cli",
              activeAgentId: activeAgent.id
            }
          });
        });
        const reply = normalizeString(result?.responses?.[0]?.reply, "(no reply)");
        transcript.push({
          role: "assistant",
          text: reply
        });
        renderMessage(activeAgent.name, reply, { tone: ANSI.green });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        renderMessage("Error", message, { tone: ANSI.red });
      }
    }
  } catch (error) {
    if (!interrupted) {
      const message = error instanceof Error ? error.message : String(error);
      renderMessage("Fatal Error", message, { tone: ANSI.red });
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
