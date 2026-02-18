import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(packageRoot, "..", "..");

const sourcePath = path.resolve(projectRoot, "src", "sdk", "sovereign-client.ts");
const targetDir = path.resolve(packageRoot, "src");
const targetPath = path.resolve(targetDir, "index.ts");

if (!fs.existsSync(sourcePath)) {
  throw new Error(`Source SDK client missing: ${sourcePath}`);
}

fs.mkdirSync(targetDir, { recursive: true });
const source = fs.readFileSync(sourcePath, "utf8");
fs.writeFileSync(targetPath, source, "utf8");

// eslint-disable-next-line no-console
console.log(`Synchronized SDK source: ${targetPath}`);
