// @ts-nocheck
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeIdentifier(value, label) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(normalized)) {
    throw new Error(`${label} must match /^[a-z0-9][a-z0-9_-]*$/.`);
  }
  return normalized;
}

export function defineTool(input) {
  if (!isRecord(input)) {
    throw new Error("Tool config must be an object.");
  }
  const name = normalizeIdentifier(input.name, "Tool name");
  if (typeof input.run !== "function") {
    throw new Error(`Tool '${name}' must define a run function.`);
  }
  return {
    name,
    description: input.description ? String(input.description) : "",
    inputSchema: isRecord(input.inputSchema) ? input.inputSchema : null,
    actionType: input.actionType ? String(input.actionType).trim().toLowerCase() : null,
    run: input.run
  };
}

export function definePlugin(factory) {
  if (typeof factory !== "function") {
    throw new Error("definePlugin requires a factory function.");
  }
  return async (context) => {
    const output = await factory(context);
    if (!output) {
      return { tools: [] };
    }
    if (Array.isArray(output)) {
      return { tools: output.map((tool) => defineTool(tool)) };
    }
    if (!isRecord(output)) {
      throw new Error("Plugin factory must return an object or an array of tools.");
    }
    const tools = Array.isArray(output.tools) ? output.tools : [];
    return {
      ...output,
      tools: tools.map((tool) => defineTool(tool))
    };
  };
}
