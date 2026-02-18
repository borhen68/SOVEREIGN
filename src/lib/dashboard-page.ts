// @ts-nocheck

function safeString(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderDashboardPage(options = {}) {
  const defaultWorkspaceId = escapeAttr(safeString(options.defaultWorkspaceId, "default"));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SOVEREIGN Live Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet">
  <style>
    :root {
      color-scheme: light dark;
      --bg: #0a1626;
      --bg-2: #0f2136;
      --panel: #122a43;
      --panel-soft: #152f4b;
      --line: rgba(152, 199, 255, 0.24);
      --text: #e9f3ff;
      --muted: #9fb5ce;
      --teal: #37d7c7;
      --lime: #97de3d;
      --orange: #ff9f43;
      --red: #ff6a6a;
      --cyan: #51b7ff;
      --radius: 14px;
      --shadow: 0 22px 40px rgba(5, 14, 24, 0.45);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: "Space Grotesk", "Segoe UI", sans-serif;
      background:
        radial-gradient(60rem 35rem at 8% -6%, rgba(55, 215, 199, 0.24), transparent 62%),
        radial-gradient(45rem 28rem at 92% -9%, rgba(255, 159, 67, 0.22), transparent 68%),
        linear-gradient(170deg, var(--bg) 0%, #071221 54%, #0f1a2e 100%);
      color: var(--text);
      min-height: 100vh;
      padding: 24px;
    }

    .shell {
      max-width: 1480px;
      margin: 0 auto;
      display: grid;
      gap: 16px;
    }

    .hero {
      border: 1px solid var(--line);
      border-radius: calc(var(--radius) + 4px);
      background:
        linear-gradient(120deg, rgba(83, 183, 255, 0.12), transparent 33%),
        linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0.01)),
        var(--panel);
      box-shadow: var(--shadow);
      padding: 18px 20px;
      display: grid;
      gap: 14px;
    }

    .hero-top {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    h1 {
      margin: 0;
      font-size: clamp(1.24rem, 2.2vw, 1.9rem);
      letter-spacing: 0.01em;
    }

    .subtitle {
      margin: 0;
      color: var(--muted);
      font-size: 0.98rem;
    }

    .tag {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid rgba(81, 183, 255, 0.45);
      color: #c4ebff;
      background: rgba(20, 44, 66, 0.78);
      border-radius: 999px;
      padding: 6px 12px;
      font-size: 0.76rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
    }

    .pulse {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--lime);
      box-shadow: 0 0 0 rgba(151, 222, 61, 0.9);
      animation: pulse 1.5s infinite;
    }

    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(151, 222, 61, 0.8); }
      70% { box-shadow: 0 0 0 10px rgba(151, 222, 61, 0); }
      100% { box-shadow: 0 0 0 0 rgba(151, 222, 61, 0); }
    }

    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
    }

    .control {
      display: grid;
      gap: 4px;
      font-size: 0.74rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
    }

    .control input,
    .control select,
    .control button {
      font: inherit;
      color: var(--text);
      border-radius: 10px;
      border: 1px solid rgba(152, 199, 255, 0.38);
      background: rgba(10, 23, 38, 0.85);
      padding: 8px 10px;
      min-height: 36px;
    }

    .control button {
      background: linear-gradient(135deg, rgba(55, 215, 199, 0.28), rgba(81, 183, 255, 0.28));
      cursor: pointer;
      font-weight: 700;
      transition: filter 0.2s ease;
    }

    .control button:hover {
      filter: brightness(1.12);
    }

    .control button:disabled {
      cursor: default;
      opacity: 0.7;
    }

    .stamp {
      margin-left: auto;
      font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      color: var(--muted);
      font-size: 0.78rem;
      white-space: nowrap;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(6, minmax(120px, 1fr));
      gap: 10px;
    }

    .stat {
      border-radius: 12px;
      border: 1px solid var(--line);
      background: var(--panel-soft);
      padding: 10px;
      display: grid;
      gap: 5px;
      min-height: 84px;
    }

    .stat label {
      font-size: 0.67rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      font-weight: 700;
    }

    .stat b {
      font-size: 1.22rem;
      line-height: 1;
      letter-spacing: 0.01em;
    }

    .stat small {
      color: var(--muted);
      font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.74rem;
    }

    .grid {
      display: grid;
      grid-template-columns: 1.6fr 1.1fr 1.1fr;
      gap: 12px;
    }

    .panel {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: linear-gradient(180deg, rgba(22, 47, 74, 0.95), rgba(17, 39, 62, 0.94));
      box-shadow: var(--shadow);
      min-height: 220px;
      display: grid;
      grid-template-rows: auto 1fr;
      overflow: hidden;
    }

    .panel > header {
      padding: 12px 14px;
      border-bottom: 1px solid rgba(152, 199, 255, 0.18);
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
    }

    .panel > header h2 {
      margin: 0;
      font-size: 0.99rem;
      letter-spacing: 0.01em;
    }

    .panel > header small {
      color: var(--muted);
      font-size: 0.75rem;
      font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    .list {
      overflow: auto;
      display: grid;
      gap: 8px;
      padding: 10px;
    }

    .item {
      border: 1px solid rgba(152, 199, 255, 0.2);
      border-radius: 11px;
      background: rgba(11, 24, 38, 0.72);
      padding: 10px;
      display: grid;
      gap: 7px;
    }

    .item-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .mono {
      font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.74rem;
    }

    .badge {
      border-radius: 999px;
      padding: 3px 8px;
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      font-weight: 700;
      border: 1px solid transparent;
      white-space: nowrap;
    }

    .status-completed { color: #8df0c8; background: rgba(28, 124, 89, 0.25); border-color: rgba(114, 214, 182, 0.6); }
    .status-failed { color: #ffb0b0; background: rgba(120, 33, 44, 0.34); border-color: rgba(255, 106, 106, 0.55); }
    .status-error { color: #ffb0b0; background: rgba(120, 33, 44, 0.34); border-color: rgba(255, 106, 106, 0.55); }
    .status-waiting_human { color: #ffd39d; background: rgba(128, 75, 20, 0.35); border-color: rgba(255, 159, 67, 0.6); }
    .status-blocked { color: #ffd39d; background: rgba(128, 75, 20, 0.35); border-color: rgba(255, 159, 67, 0.6); }
    .status-executing,
    .status-planning,
    .status-running,
    .status-active,
    .status-pending,
    .status-info { color: #b6e5ff; background: rgba(26, 84, 134, 0.34); border-color: rgba(81, 183, 255, 0.56); }
    .status-warning { color: #ffd39d; background: rgba(128, 75, 20, 0.35); border-color: rgba(255, 159, 67, 0.6); }
    .status-success { color: #8df0c8; background: rgba(28, 124, 89, 0.25); border-color: rgba(114, 214, 182, 0.6); }
    .status-default { color: #d3e5f7; background: rgba(79, 108, 136, 0.26); border-color: rgba(152, 199, 255, 0.42); }

    .risk-bar {
      width: 100%;
      height: 8px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.08);
      overflow: hidden;
    }

    .risk-fill {
      height: 100%;
      width: 0%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--lime), var(--orange), var(--red));
      transition: width 0.25s ease;
    }

    .muted {
      color: var(--muted);
    }

    .debate-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      padding: 10px;
      overflow: auto;
    }

    .debate {
      border: 1px solid rgba(152, 199, 255, 0.21);
      border-radius: 10px;
      background: rgba(14, 31, 48, 0.72);
      padding: 9px;
      display: grid;
      gap: 6px;
    }

    .debate strong {
      font-size: 0.86rem;
    }

    .debate p {
      margin: 0;
      color: #d5e9fb;
      font-size: 0.83rem;
      line-height: 1.36;
    }

    .debate .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      color: var(--muted);
      font-size: 0.73rem;
    }

    .empty {
      border: 1px dashed rgba(152, 199, 255, 0.35);
      border-radius: 10px;
      padding: 12px;
      color: var(--muted);
      font-size: 0.82rem;
      text-align: center;
      background: rgba(8, 19, 31, 0.65);
    }

    @media (max-width: 1240px) {
      .stats {
        grid-template-columns: repeat(3, minmax(120px, 1fr));
      }
      .grid {
        grid-template-columns: 1fr 1fr;
      }
      .panel.wide {
        grid-column: span 2;
      }
    }

    @media (max-width: 820px) {
      body {
        padding: 12px;
      }
      .stats {
        grid-template-columns: repeat(2, minmax(120px, 1fr));
      }
      .grid {
        grid-template-columns: 1fr;
      }
      .panel.wide {
        grid-column: span 1;
      }
      .debate-grid {
        grid-template-columns: 1fr;
      }
      .stamp {
        margin-left: 0;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="hero">
      <div class="hero-top">
        <div>
          <h1>SOVEREIGN Live Company Dashboard</h1>
          <p class="subtitle">Watch the orchestrator route work, agents debate options, and runtime trust scores update in real time.</p>
        </div>
        <div class="tag"><span class="pulse"></span> Live Agent Operations</div>
      </div>
      <div class="controls">
        <label class="control">
          Workspace
          <input id="workspace" value="${defaultWorkspaceId}" />
        </label>
        <label class="control">
          Refresh
          <select id="refresh">
            <option value="2000">2s</option>
            <option value="3000" selected>3s</option>
            <option value="5000">5s</option>
            <option value="10000">10s</option>
            <option value="0">Manual</option>
          </select>
        </label>
        <label class="control">
          Actions
          <button id="refreshBtn" type="button">Refresh now</button>
        </label>
        <span id="updatedAt" class="stamp">Waiting for first snapshot...</span>
      </div>
      <div class="stats">
        <article class="stat"><label>Active Runs</label><b id="stat-runs-active">0</b><small id="stat-runs-total">0 total</small></article>
        <article class="stat"><label>Waiting Human</label><b id="stat-waiting">0</b><small id="stat-completed">0 completed</small></article>
        <article class="stat"><label>Failed</label><b id="stat-failed">0</b><small id="stat-risk">avg risk 0.00</small></article>
        <article class="stat"><label>Pending Approvals</label><b id="stat-approvals">0</b><small id="stat-consensus">avg consensus 0.00</small></article>
        <article class="stat"><label>P95 Latency</label><b id="stat-latency">0 ms</b><small id="stat-tokens">0 tokens</small></article>
        <article class="stat"><label>Cost</label><b id="stat-cost">$0.000000</b><small id="stat-agents">0 agents</small></article>
      </div>
    </section>

    <section class="grid">
      <article class="panel wide">
        <header>
          <h2>Company Orchestrator</h2>
          <small id="runs-count">0 runs</small>
        </header>
        <div id="runs-list" class="list"></div>
      </article>

      <article class="panel">
        <header>
          <h2>Trust And Risk</h2>
          <small id="risk-count">0 actions</small>
        </header>
        <div id="risk-list" class="list"></div>
      </article>

      <article class="panel">
        <header>
          <h2>Council Sessions</h2>
          <small id="council-count">0 councils</small>
        </header>
        <div id="council-list" class="list"></div>
      </article>

      <article class="panel wide">
        <header>
          <h2>Agent Debate Feed</h2>
          <small id="debate-count">0 messages</small>
        </header>
        <div id="debate-grid" class="debate-grid"></div>
      </article>

      <article class="panel">
        <header>
          <h2>Observability Events</h2>
          <small id="event-count">0 events</small>
        </header>
        <div id="event-list" class="list"></div>
      </article>

      <article class="panel">
        <header>
          <h2>Active Traces</h2>
          <small id="trace-count">0 traces</small>
        </header>
        <div id="trace-list" class="list"></div>
      </article>
    </section>
  </div>

  <script>
    (function () {
      var workspaceInput = document.getElementById("workspace");
      var refreshSelect = document.getElementById("refresh");
      var refreshBtn = document.getElementById("refreshBtn");
      var updatedAt = document.getElementById("updatedAt");
      var timer = null;

      function clamp(value, min, max, fallback) {
        var parsed = Number(value);
        if (!Number.isFinite(parsed)) {
          return fallback;
        }
        return Math.max(min, Math.min(max, parsed));
      }

      function esc(value) {
        return String(value == null ? "" : value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }

      function statusClass(status) {
        var normalized = String(status || "").toLowerCase().replace(/[^a-z0-9_]+/g, "_");
        if (!normalized) {
          return "status-default";
        }
        return "status-" + normalized;
      }

      function fmtNumber(value, digits) {
        var n = Number(value || 0);
        if (!Number.isFinite(n)) {
          n = 0;
        }
        return n.toFixed(typeof digits === "number" ? digits : 0);
      }

      function fmtPercent(value) {
        var n = Number(value || 0);
        if (!Number.isFinite(n)) {
          n = 0;
        }
        return (n * 100).toFixed(0) + "%";
      }

      function fmtDate(iso) {
        if (!iso) {
          return "-";
        }
        var d = new Date(iso);
        if (Number.isNaN(d.getTime())) {
          return "-";
        }
        return d.toLocaleTimeString();
      }

      function emptyState(text) {
        return '<div class="empty">' + esc(text) + '</div>';
      }

      function renderStats(snapshot) {
        var stats = snapshot.stats || {};
        var agents = snapshot.agents || {};

        document.getElementById("stat-runs-active").textContent = String(stats.runsActive || 0);
        document.getElementById("stat-runs-total").textContent = String(stats.runsTotal || 0) + " total";
        document.getElementById("stat-waiting").textContent = String(stats.runsWaitingHuman || 0);
        document.getElementById("stat-completed").textContent = String(stats.runsCompleted || 0) + " completed";
        document.getElementById("stat-failed").textContent = String(stats.runsFailed || 0);
        document.getElementById("stat-risk").textContent = "avg risk " + fmtNumber(stats.avgRiskScore, 2);
        document.getElementById("stat-approvals").textContent = String(stats.pendingApprovals || 0);
        document.getElementById("stat-consensus").textContent = "avg consensus " + fmtNumber(stats.avgConsensus, 2);
        document.getElementById("stat-latency").textContent = fmtNumber(stats.latencyP95Ms, 0) + " ms";
        document.getElementById("stat-tokens").textContent = fmtNumber(stats.tokenUsageTotal, 0) + " tokens";
        document.getElementById("stat-cost").textContent = "$" + fmtNumber(stats.costUsdTotal, 6);
        document.getElementById("stat-agents").textContent = String(agents.total || 0) + " agents";
      }

      function renderRuns(snapshot) {
        var runs = (((snapshot || {}).orchestrator || {}).latestRuns) || [];
        var list = document.getElementById("runs-list");
        document.getElementById("runs-count").textContent = String(runs.length) + " runs";
        if (!runs.length) {
          list.innerHTML = emptyState("No company runs yet. Trigger /api/company/execute and this board will animate.");
          return;
        }

        list.innerHTML = runs.map(function (run) {
          var risk = run.pendingEscalation ? ("Escalated: " + (run.pendingEscalation.reason || "human approval needed")) : "No escalation";
          var consensus = run.consensusAvg == null ? "-" : fmtNumber(run.consensusAvg, 2);
          var missionTitle = run.mission && run.mission.title ? run.mission.title : "";
          var stageName = run.stage && run.stage.name ? run.stage.name : "stage.unknown";
          var stageMessage = run.stage && run.stage.message ? run.stage.message : "";
          var evaluation = run.evaluation ? ("Eval " + fmtNumber(run.evaluation.score, 2) + " (" + esc(run.evaluation.grade || "n/a") + ")") : "Eval not available";

          return '' +
            '<article class="item">' +
              '<div class="item-head">' +
                '<div class="mono">' + esc(run.id) + '</div>' +
                '<span class="badge ' + statusClass(run.status) + '">' + esc(run.status || "unknown") + '</span>' +
              '</div>' +
              '<div><strong>' + esc(run.objective || "") + '</strong></div>' +
              '<div class="muted">' + esc(run.summary || "") + '</div>' +
              '<div class="mono muted">mission: ' + esc(run.missionId || "-") + (missionTitle ? (" | " + esc(missionTitle)) : "") + '</div>' +
              '<div class="mono muted">stage: ' + esc(stageName) + (stageMessage ? (" | " + esc(stageMessage)) : "") + '</div>' +
              '<div class="mono muted">consensus: ' + esc(consensus) + ' | ' + esc(evaluation) + '</div>' +
              '<div class="mono muted">updated: ' + esc(fmtDate(run.updatedAt || run.startedAt)) + ' | ' + esc(risk) + '</div>' +
            '</article>';
        }).join("");
      }

      function renderRisk(snapshot) {
        var risk = (snapshot || {}).risk || {};
        var actions = risk.latestActions || [];
        var bands = risk.bands || {};
        var list = document.getElementById("risk-list");
        document.getElementById("risk-count").textContent = String(actions.length) + " actions";

        var header = '' +
          '<article class="item">' +
            '<div class="mono">low ' + esc(String(bands.low || 0)) +
            ' | medium ' + esc(String(bands.medium || 0)) +
            ' | high ' + esc(String(bands.high || 0)) +
            ' | critical ' + esc(String(bands.critical || 0)) + '</div>' +
          '</article>';

        if (!actions.length) {
          list.innerHTML = header + emptyState("No runtime actions yet.");
          return;
        }

        var rows = actions.slice(0, 14).map(function (action) {
          var score = clamp(action.riskScore, 0, 1, 0);
          return '' +
            '<article class="item">' +
              '<div class="item-head">' +
                '<div class="mono">' + esc(action.actionType || "read") + '</div>' +
                '<span class="badge ' + statusClass(action.status) + '">' + esc(action.status || "pending") + '</span>' +
              '</div>' +
              '<div class="muted">' + esc(action.summary || "") + '</div>' +
              '<div class="risk-bar"><div class="risk-fill" style="width:' + esc(fmtPercent(score)) + '"></div></div>' +
              '<div class="mono muted">risk ' + esc(fmtNumber(score, 2)) + ' | decision ' + esc(action.decision || "n/a") + '</div>' +
            '</article>';
        });
        list.innerHTML = header + rows.join("");
      }

      function renderCouncil(snapshot) {
        var council = (snapshot || {}).council || {};
        var runs = council.latestRuns || [];
        var list = document.getElementById("council-list");
        document.getElementById("council-count").textContent = String(runs.length) + " councils";
        if (!runs.length) {
          list.innerHTML = emptyState("No council sessions yet.");
          return;
        }

        list.innerHTML = runs.slice(0, 12).map(function (run) {
          var score = run.consensusScore == null ? "-" : fmtNumber(run.consensusScore, 2);
          return '' +
            '<article class="item">' +
              '<div class="item-head">' +
                '<div class="mono">' + esc(run.id) + '</div>' +
                '<span class="badge ' + statusClass(run.status) + '">' + esc(run.status || "unknown") + '</span>' +
              '</div>' +
              '<div class="mono muted">mission ' + esc(run.missionId || "-") + '</div>' +
              '<div class="mono muted">rounds ' + esc(String(run.debateRounds || 0)) + ' | consensus ' + esc(score) + '</div>' +
              '<div class="muted">' + esc(run.topAction || "No top action extracted yet.") + '</div>' +
            '</article>';
        }).join("");
      }

      function renderDebate(snapshot) {
        var council = (snapshot || {}).council || {};
        var messages = council.debateFeed || [];
        var grid = document.getElementById("debate-grid");
        document.getElementById("debate-count").textContent = String(messages.length) + " messages";
        if (!messages.length) {
          grid.innerHTML = emptyState("Debate feed will appear after councils run.");
          return;
        }

        grid.innerHTML = messages.slice(0, 24).map(function (msg) {
          return '' +
            '<article class="debate">' +
              '<strong>' + esc(msg.agentName || "Agent") + " | " + esc(msg.trackTitle || "Track") + '</strong>' +
              '<p>' + esc(msg.insight || "No insight yet.") + '</p>' +
              '<div class="meta">' +
                '<span>confidence ' + esc(fmtNumber(msg.confidence, 2)) + '</span>' +
                '<span>style ' + esc(msg.soulStyle || "n/a") + '</span>' +
                '<span>' + esc(fmtDate(msg.at)) + '</span>' +
              '</div>' +
              '<div class="mono muted">action: ' + esc(msg.recommendedAction || "-") + '</div>' +
            '</article>';
        }).join("");
      }

      function renderEvents(snapshot) {
        var obs = (snapshot || {}).observability || {};
        var events = obs.events || [];
        var list = document.getElementById("event-list");
        document.getElementById("event-count").textContent = String(events.length) + " events";
        if (!events.length) {
          list.innerHTML = emptyState("No observability events yet.");
          return;
        }
        list.innerHTML = events.slice(0, 18).map(function (event) {
          return '' +
            '<article class="item">' +
              '<div class="item-head">' +
                '<div class="mono">' + esc(event.source || "system") + "." + esc(event.type || "event") + '</div>' +
                '<span class="badge ' + statusClass(event.level) + '">' + esc(event.level || "info") + '</span>' +
              '</div>' +
              '<div class="muted">' + esc(event.message || "") + '</div>' +
              '<div class="mono muted">' + esc(fmtDate(event.createdAt)) + ' | run ' + esc(event.runId || "-") + '</div>' +
            '</article>';
        }).join("");
      }

      function renderTraces(snapshot) {
        var obs = (snapshot || {}).observability || {};
        var traces = obs.traces || [];
        var list = document.getElementById("trace-list");
        document.getElementById("trace-count").textContent = String(traces.length) + " traces";
        if (!traces.length) {
          list.innerHTML = emptyState("No traces yet.");
          return;
        }
        list.innerHTML = traces.slice(0, 14).map(function (trace) {
          return '' +
            '<article class="item">' +
              '<div class="item-head">' +
                '<div class="mono">' + esc(trace.name || trace.id) + '</div>' +
                '<span class="badge ' + statusClass(trace.status) + '">' + esc(trace.status || "active") + '</span>' +
              '</div>' +
              '<div class="mono muted">events ' + esc(String(trace.eventCount || 0)) + ' | spans ' + esc(String(trace.spanCount || 0)) + ' | errors ' + esc(String(trace.errorCount || 0)) + '</div>' +
              '<div class="mono muted">' + esc(fmtDate(trace.startedAt)) + ' | run ' + esc(trace.runId || "-") + '</div>' +
            '</article>';
        }).join("");
      }

      function render(snapshot) {
        renderStats(snapshot);
        renderRuns(snapshot);
        renderRisk(snapshot);
        renderCouncil(snapshot);
        renderDebate(snapshot);
        renderEvents(snapshot);
        renderTraces(snapshot);
      }

      async function loadSnapshot() {
        var workspaceId = String(workspaceInput.value || "default").trim() || "default";
        refreshBtn.disabled = true;
        try {
          var query = new URLSearchParams({
            workspaceId: workspaceId,
            limit: "12"
          });
          var response = await fetch("/api/dashboard/snapshot?" + query.toString(), {
            method: "GET",
            headers: {
              "Accept": "application/json"
            }
          });
          if (!response.ok) {
            throw new Error("Snapshot request failed: HTTP " + response.status);
          }
          var payload = await response.json();
          render(payload.snapshot || {});
          updatedAt.textContent = "Updated " + new Date().toLocaleTimeString() + " | workspace " + workspaceId;
        } catch (error) {
          updatedAt.textContent = "Update failed: " + (error && error.message ? error.message : "unknown error");
        } finally {
          refreshBtn.disabled = false;
        }
      }

      function resetTimer() {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        var ms = clamp(refreshSelect.value, 0, 60000, 3000);
        if (ms > 0) {
          timer = setInterval(loadSnapshot, ms);
        }
      }

      refreshBtn.addEventListener("click", function () {
        loadSnapshot();
      });
      refreshSelect.addEventListener("change", function () {
        resetTimer();
      });
      workspaceInput.addEventListener("change", function () {
        loadSnapshot();
      });

      loadSnapshot();
      resetTimer();
    })();
  </script>
</body>
</html>`;
}
