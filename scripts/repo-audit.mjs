import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const strict = process.argv.includes("--strict");
const warnings = [];
const infos = [];

function projectPath(...parts) {
  return path.join(root, ...parts);
}

function exists(...parts) {
  return fs.existsSync(projectPath(...parts));
}

function pushInfo(title, detail) {
  infos.push({ title, detail });
}

function pushWarning(title, detail) {
  warnings.push({ title, detail });
}

function listEntries(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

if (!exists(".git")) {
  pushWarning(
    "Git is not initialized here",
    "Run `git init` in this folder before your first GitHub push, then review `git status` carefully."
  );
}

if (exists(".env")) {
  pushWarning(
    "Local .env file detected",
    "Keep `.env` private and make sure only `.env.example` goes to GitHub."
  );
}

const dataEntries = listEntries(projectPath(".data")).filter((entry) => !entry.name.startsWith("."));
if (dataEntries.length > 0) {
  pushWarning(
    "Local runtime state detected",
    "`.data/` contains local state and test artifacts. It is ignored, but do not force-add it to Git."
  );
}

if (exists("mcp_servers.json")) {
  pushWarning(
    "Local MCP config detected",
    "`mcp_servers.json` looks machine-specific. Keep it ignored unless you intentionally want to publish a shared config."
  );
}

if (exists("dist")) {
  pushInfo("Build output present", "`dist/` exists locally and is already ignored.");
}

if (exists("node_modules")) {
  pushInfo("Dependencies installed", "`node_modules/` exists locally and is already ignored.");
}

const largeRootFiles = listEntries(root)
  .filter((entry) => entry.isFile() && entry.name !== ".env")
  .map((entry) => ({
    name: entry.name,
    size: fs.statSync(projectPath(entry.name)).size
  }))
  .filter((entry) => entry.size > 500 * 1024)
  .sort((left, right) => right.size - left.size);

for (const file of largeRootFiles) {
  pushWarning(
    `Large root file: ${file.name}`,
    `Review whether this belongs in the repo (${Math.round(file.size / 1024)} KB).`
  );
}

console.log("SOVEREIGN repo audit");
console.log("");

if (warnings.length === 0 && infos.length === 0) {
  console.log("No obvious publish issues found.");
}

if (warnings.length > 0) {
  console.log("Warnings:");
  for (const item of warnings) {
    console.log(`- ${item.title}: ${item.detail}`);
  }
  console.log("");
}

if (infos.length > 0) {
  console.log("Notes:");
  for (const item of infos) {
    console.log(`- ${item.title}: ${item.detail}`);
  }
  console.log("");
}

console.log("Suggested pre-push flow:");
console.log("1. Run `npm run repo:audit`.");
console.log("2. Run `npm run build`.");
console.log("3. Review only intentional files before pushing to GitHub.");

if (strict && warnings.length > 0) {
  process.exitCode = 1;
}
