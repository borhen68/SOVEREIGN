// @ts-nocheck
/**
 * SOVEREIGN One-Shot CLI Runner
 *
 * Usage:
 *   node dist/src/cli/run.js "Plan sales growth, ship coding improvements, and improve reliability."
 *   node dist/src/cli/run.js --teamSize 4 --debateRounds 3 "Your objective here"
 *
 * This is the viral entry point — takes a plain-text objective and runs it
 * through the full Company Orchestrator pipeline with beautiful terminal output.
 */
import process from "node:process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createApi } from "../server.js";

const COLOR = Boolean(output.isTTY) && process.env.NO_COLOR !== "1";
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m"
};

function c(text, ...codes) {
  if (!COLOR) return String(text);
  return `${codes.join("")}${text}${C.reset}`;
}

function w(text) { output.write(text); }
function ln(text = "") { output.write(`${text}\n`); }

function safeStr(v, fb = "") {
  const s = String(v ?? "").trim();
  return s || fb;
}

function elapsed(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = (ms / 1000).toFixed(1);
  return `${s}s`;
}

function banner() {
  const width = Math.min(Number(output.columns) || 80, 100);
  const line = "━".repeat(width);
  ln();
  ln(c(line, C.cyan));
  ln(c("  ◆ SOVEREIGN", C.bold, C.cyan) + c("  —  Autonomous Agent Runtime", C.dim));
  ln(c("  Objective → Plan → Debate → Execute → Verify → Report", C.gray));
  ln(c(line, C.cyan));
  ln();
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    objective: "",
    workspaceId: "default",
    teamSize: 3,
    debateRounds: 2,
    autoApprove: false,
    help: false
  };

  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") { opts.help = true; continue; }
    if (arg === "--team" || arg === "--teamSize") { opts.teamSize = Number(args[++i]) || 3; continue; }
    if (arg === "--rounds" || arg === "--debateRounds") { opts.debateRounds = Number(args[++i]) || 2; continue; }
    if (arg === "--workspace") { opts.workspaceId = safeStr(args[++i], "default"); continue; }
    if (arg === "--auto-approve" || arg === "--yes" || arg === "-y") { opts.autoApprove = true; continue; }
    positional.push(arg);
  }
  opts.objective = positional.join(" ").trim();
  return opts;
}

function showHelp() {
  banner();
  ln(c("  USAGE", C.bold, C.yellow));
  ln(`    node dist/src/cli/run.js ${c("[options]", C.dim)} ${c('"Your objective here"', C.green)}`);
  ln();
  ln(c("  OPTIONS", C.bold, C.yellow));
  ln(`    ${c("--team <n>", C.cyan)}          Number of specialist agents (default: 3)`);
  ln(`    ${c("--rounds <n>", C.cyan)}        Council debate rounds (default: 2)`);
  ln(`    ${c("--workspace <id>", C.cyan)}    Workspace ID (default: "default")`);
  ln(`    ${c("--auto-approve, -y", C.cyan)}  Skip human approval prompts`);
  ln(`    ${c("--help, -h", C.cyan)}          Show this help`);
  ln();
  ln(c("  EXAMPLES", C.bold, C.yellow));
  ln(`    node dist/src/cli/run.js "Research top 3 AI frameworks and write a comparison report"`);
  ln(`    node dist/src/cli/run.js --team 4 --rounds 3 "Audit our pricing and draft a new strategy"`);
  ln(`    node dist/src/cli/run.js -y "Generate Q3 marketing brief with competitor analysis"`);
  ln();
}

function stepIcon(status) {
  if (status === "done") return c("✓", C.green);
  if (status === "fail") return c("✗", C.red);
  if (status === "warn") return c("⚠", C.yellow);
  if (status === "pause") return c("⏸", C.yellow, C.bold);
  return c("→", C.cyan);
}

function printStep(icon, label, detail = "") {
  const detailStr = detail ? c(`  ${detail}`, C.dim) : "";
  ln(`  ${icon}  ${label}${detailStr}`);
}

async function withSpinner(label, fn) {
  if (!output.isTTY) {
    return fn();
  }
  let frame = 0;
  const interval = setInterval(() => {
    const glyph = SPINNER[frame % SPINNER.length];
    w(`\r  ${c(glyph, C.cyan)}  ${label}`);
    frame++;
  }, 80);
  try {
    const result = await fn();
    w(`\r${"  ".padEnd(label.length + 10)}\r`);
    return result;
  } finally {
    clearInterval(interval);
  }
}

async function askApproval(question) {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(
      `  ${c("⏸", C.yellow, C.bold)}  ${c(question, C.yellow)} ${c("[y/n]", C.dim)}: `
    );
    const normalized = safeStr(answer).toLowerCase();
    return ["y", "yes", "approve"].includes(normalized);
  } finally {
    rl.close();
  }
}

function printWorkstreams(plan) {
  const workstreams = Array.isArray(plan?.workstreams) ? plan.workstreams : [];
  if (workstreams.length === 0) return;
  ln();
  ln(c("  WORKSTREAMS", C.bold, C.magenta));
  for (let i = 0; i < workstreams.length; i++) {
    const ws = workstreams[i];
    const title = safeStr(ws.title, `Workstream ${i + 1}`);
    const agent = safeStr(ws.assignedAgentName, "auto");
    ln(`    ${c(`${i + 1}.`, C.bold, C.white)} ${title}  ${c(`[${agent}]`, C.dim)}`);
  }
  ln();
}

function printResults(run) {
  const results = run?.result?.executionResults ?? [];
  const verification = run?.verification;
  const evaluation = run?.evaluation;
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.length - successCount;

  ln();
  ln(c("  ─── RESULTS ───", C.bold, C.cyan));
  ln();

  for (const r of results) {
    const icon = r.success ? c("✓", C.green) : c("✗", C.red);
    const ws = safeStr(r.workstreamId, "workstream");
    const consensus = typeof r.consensus === "number" ? ` consensus=${(r.consensus * 100).toFixed(0)}%` : "";
    ln(`    ${icon}  ${ws}${c(consensus, C.dim)}`);
  }

  ln();

  if (verification) {
    const badge = verification.verdict === "verified"
      ? c("VERIFIED", C.bold, C.green)
      : verification.verdict === "contested"
        ? c("CONTESTED", C.yellow)
        : c(verification.verdict?.toUpperCase() ?? "UNKNOWN", C.dim);
    ln(`  ${c("Verification:", C.bold)} ${badge}  ${c(verification.confidenceLabel ?? "", C.dim)}`);
  }

  if (evaluation) {
    const grade = safeStr(evaluation.grade, "N/A").toUpperCase();
    const gradeColor = grade === "PASS" ? C.green : grade === "FAIL" ? C.red : C.yellow;
    ln(`  ${c("Evaluation:", C.bold)}   ${c(grade, C.bold, gradeColor)}  ${c(safeStr(evaluation.reason), C.dim)}`);
  }

  ln();
  ln(`  ${c("Summary:", C.bold)} ${c(`${successCount}/${results.length} workstreams completed`, successCount === results.length ? C.green : C.yellow)}`);
  if (failCount > 0) {
    ln(`  ${c(`${failCount} workstream(s) failed`, C.red)}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    showHelp();
    process.exit(0);
  }

  if (!opts.objective) {
    showHelp();
    ln(c("  ✗ Objective is required. Provide it as the last argument.", C.red));
    ln();
    process.exit(1);
  }

  banner();

  printStep(stepIcon("info"), c("Objective", C.bold), opts.objective);
  printStep(stepIcon("info"), c("Config", C.bold), `team=${opts.teamSize}  rounds=${opts.debateRounds}  workspace=${opts.workspaceId}`);
  ln();

  // Initialize SOVEREIGN
  printStep(stepIcon("info"), "Initializing SOVEREIGN engine...");
  const startTime = Date.now();

  const api = createApi({
    cwd: process.cwd(),
    autopilotAutoStart: false,
    heartbeatAutoStart: false
  });

  printStep(stepIcon("done"), "Engine initialized", elapsed(Date.now() - startTime));
  ln();

  // Phase 1: Planning
  ln(c("  ── PHASE 1: PLANNING ──", C.bold, C.blue));
  const planStart = Date.now();

  let run;
  try {
    run = await withSpinner("Building company plan...", async () => {
      return api.companyOrchestratorService.executeObjective({
        workspaceId: opts.workspaceId,
        objective: opts.objective,
        teamSize: opts.teamSize,
        debateRounds: opts.debateRounds,
        autoApproveEscalation: opts.autoApprove
      });
    });
  } catch (error) {
    // If the error contains a run object (orchestrator wraps errors with .run), extract it
    if (error?.run) {
      run = error.run;
    } else {
      printStep(stepIcon("fail"), "Planning failed", error?.message ?? String(error));
      process.exit(1);
    }
  }

  const planElapsed = elapsed(Date.now() - planStart);
  
  if (run.status === "completed") {
    printStep(stepIcon("done"), "Plan built & executed", planElapsed);
  } else if (run.status === "failed") {
    printStep(stepIcon("fail"), "Execution failed", planElapsed);
  } else if (run.status === "waiting_human") {
    printStep(stepIcon("done"), "Plan built", planElapsed);
    ln();
    ln(c("  ── PHASE 2: EXECUTION ──", C.bold, C.blue));
  }

  // Handle human approvals in a loop
  while (run.status === "waiting_human") {
    const escalation = run.pendingEscalation ?? {};
    ln();
    ln(c("  ── HUMAN APPROVAL REQUIRED ──", C.bold, C.yellow));
    printStep(stepIcon("warn"), c("Reason:", C.bold), safeStr(escalation.reason, "Risk detected"));
    printStep(stepIcon("info"), c("Stage:", C.bold), safeStr(escalation.stage, "pre_execution"));

    if (escalation.triggers && Array.isArray(escalation.triggers)) {
      printStep(stepIcon("info"), c("Triggers:", C.bold), escalation.triggers.join(", "));
    }

    ln();

    if (opts.autoApprove) {
      printStep(stepIcon("info"), "Auto-approving (--auto-approve flag)...");
    }

    const approved = opts.autoApprove || await askApproval("Approve and continue execution?");

    if (!approved) {
      printStep(stepIcon("fail"), "Execution rejected by user.");
      try {
        await api.companyOrchestratorService.resumeRun(run.id, {
          decision: "reject",
          note: "Rejected via CLI."
        });
      } catch { /* best effort */ }
      
      // Force exit
      const totalElapsed = elapsed(Date.now() - startTime);
      ln(c("  ─────────────────────", C.dim));
      ln(`  ${c("Status:", C.bold)}  ${c("REJECTED", C.bold, C.red)}`);
      ln(`  ${c("Time:", C.bold)}    ${totalElapsed}`);
      process.exit(0);
    }

    // Resume
    printStep(stepIcon("info"), "Resuming execution...");

    const resumeStart = Date.now();
    try {
      run = await withSpinner("Executing workstreams...", async () => {
        return api.companyOrchestratorService.resumeRun(run.id, {
          decision: "approve",
          note: "Approved via CLI."
        });
      });
    } catch (error) {
      if (error?.run) {
        run = error.run;
      } else {
        printStep(stepIcon("fail"), "Execution failed", error?.message ?? String(error));
        process.exit(1);
      }
    }

    const resumeElapsed = elapsed(Date.now() - resumeStart);
    if (run.status !== "waiting_human") {
       const finalIcon = run.status === "completed" ? stepIcon("done") : stepIcon("fail");
       printStep(finalIcon, `Execution ${run.status}`, resumeElapsed);
    }
  }

  // Print results
  printResults(run);

  // Print summary
  const totalElapsed = elapsed(Date.now() - startTime);
  ln(c("  ─────────────────────", C.dim));
  ln(`  ${c("Run ID:", C.bold)}  ${c(run.id, C.cyan)}`);
  ln(`  ${c("Status:", C.bold)}  ${run.status === "completed" ? c("COMPLETED", C.bold, C.green) : c(run.status?.toUpperCase(), C.bold, C.red)}`);
  ln(`  ${c("Time:", C.bold)}    ${totalElapsed}`);
  if (run.missionId) {
    ln(`  ${c("Mission:", C.bold)} ${c(run.missionId, C.dim)}`);
  }
  ln();

  // Clean exit
  if (api.autopilotService && typeof api.autopilotService.stop === "function") {
    api.autopilotService.stop();
  }
  process.exit(run.status === "completed" ? 0 : 1);
}

main().catch((error) => {
  ln();
  ln(c(`  ✗ Fatal: ${error?.message ?? String(error)}`, C.red));
  ln();
  process.exit(1);
});
