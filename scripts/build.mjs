import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function copyPluginManifests(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) {
    return;
  }
  fs.mkdirSync(targetDir, { recursive: true });
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(sourceDir, entry.name);
    const dstPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyPluginManifests(srcPath, dstPath);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      fs.mkdirSync(path.dirname(dstPath), { recursive: true });
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

const tscResult = spawnSync(process.execPath, [path.join("scripts", "run-tsc.mjs"), "-p", "tsconfig.json"], {
  stdio: "inherit"
});
if (tscResult.status !== 0) {
  process.exit(tscResult.status ?? 1);
}

copyPluginManifests(path.join(process.cwd(), "plugins"), path.join(process.cwd(), "dist", "plugins"));
