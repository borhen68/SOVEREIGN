import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const modulePath = path.resolve(projectRoot, "dist", "src", "lib", "openapi-spec.js");
if (!fs.existsSync(modulePath)) {
  throw new Error(`OpenAPI builder not found at ${modulePath}. Run npm run build first.`);
}

const { buildOpenApiSpec } = await import(modulePath);
const spec = buildOpenApiSpec("http://localhost:3001");
const targetPath = path.resolve(projectRoot, "openapi.json");
fs.writeFileSync(targetPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");

// eslint-disable-next-line no-console
console.log(`Exported OpenAPI spec to ${targetPath}`);
