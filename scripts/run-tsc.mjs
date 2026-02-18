import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const candidates = [];

try {
  candidates.push(require.resolve("typescript/lib/tsc.js", { paths: [process.cwd()] }));
} catch {
  // fall through to global lookup
}

const npmRootResult = spawnSync("npm", ["root", "-g"], {
  encoding: "utf8"
});
if (npmRootResult.status === 0) {
  const npmRoot = String(npmRootResult.stdout ?? "").trim();
  if (npmRoot) {
    candidates.push(path.join(npmRoot, "typescript", "lib", "tsc.js"));
    candidates.push(path.join(npmRoot, "@nestjs", "cli", "node_modules", "typescript", "lib", "tsc.js"));
  }
}

const tscPath = candidates.find((candidate) => candidate && existsSync(candidate));
if (!tscPath) {
  // eslint-disable-next-line no-console
  console.error("TypeScript compiler not found. Install 'typescript' or provide it globally.");
  process.exit(1);
}

const result = spawnSync(process.execPath, [tscPath, ...args], {
  stdio: "inherit"
});
if (typeof result.status === "number") {
  process.exit(result.status);
}
process.exit(1);
