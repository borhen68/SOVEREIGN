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
  <title>SOVEREIGN - Command Center</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg-primary: #06090f;
      --bg-secondary: #0c1117;
      --bg-card: rgba(13, 19, 28, 0.65);
      --bg-card-hover: rgba(18, 26, 38, 0.8);
      --glass: rgba(255, 255, 255, 0.03);
      --glass-border: rgba(255, 255, 255, 0.06);
      --glass-border-hover: rgba(255, 255, 255, 0.12);
      --text-primary: #e8edf5;
      --text-secondary: #8899ad;
      --text-muted: #556577;
      --accent-blue: #3b82f6;
      --accent-cyan: #06b6d4;
      --accent-green: #10b981;
      --accent-amber: #f59e0b;
      --accent-red: #ef4444;
      --accent-purple: #8b5cf6;
      --accent-pink: #ec4899;
      --glow-blue: rgba(59, 130, 246, 0.15);
      --glow-green: rgba(16, 185, 129, 0.15);
      --glow-red: rgba(239, 68, 68, 0.12);
      --radius: 16px;
      --radius-sm: 10px;
      --radius-xs: 6px;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #020408;
      color: var(--text-primary);
      min-height: 100vh;
      overflow-x: hidden;
    }

    /* Background */
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background: 
        radial-gradient(circle at 20% 30%, rgba(59, 130, 246, 0.15), transparent 40%),
        radial-gradient(circle at 80% 70%, rgba(139, 92, 246, 0.12), transparent 40%),
        radial-gradient(circle at 50% 50%, rgba(6, 182, 212, 0.08), transparent 60%);
      filter: blur(80px);
      z-index: -1;
    }

    .matrix-bg {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: linear-gradient(rgba(2, 4, 8, 0.9), rgba(2, 4, 8, 0.95));
      z-index: -1;
    }

    .app { position: relative; z-index: 1; padding: 20px; max-width: 1700px; margin: 0 auto; }

    /* Top Bar */
    .topbar {
      display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px;
      padding: 16px 20px;
      background: var(--bg-card);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      backdrop-filter: blur(20px);
      margin-bottom: 20px;
    }
    .topbar-left { display: flex; align-items: center; gap: 14px; }
    .logo {
      font-size: 1.4rem; font-weight: 800; letter-spacing: -0.02em;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6, #06b6d4);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .live-badge {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 12px; border-radius: 999px;
      background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.25);
      font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--accent-green);
    }
    .live-dot {
      width: 6px; height: 6px; border-radius: 50%; background: var(--accent-green);
      animation: livePulse 2s ease-in-out infinite;
    }
    @keyframes livePulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.6); }
      50% { box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
    }
    .topbar-right { display: flex; align-items: center; gap: 10px; }
    .topbar-input {
      font-family: 'JetBrains Mono', monospace; font-size: 0.78rem;
      background: rgba(255,255,255,0.04); border: 1px solid var(--glass-border);
      border-radius: var(--radius-xs); padding: 6px 10px; color: var(--text-primary);
      outline: none; transition: border-color 0.2s;
    }
    .topbar-input:focus { border-color: var(--accent-blue); }
    .topbar-select {
      font-family: 'Inter', sans-serif; font-size: 0.75rem;
      background: rgba(255,255,255,0.04); border: 1px solid var(--glass-border);
      border-radius: var(--radius-xs); padding: 6px 10px; color: var(--text-primary);
      outline: none; cursor: pointer;
    }
    .topbar-btn {
      font-family: 'Inter', sans-serif; font-size: 0.72rem; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.06em;
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(139, 92, 246, 0.2));
      border: 1px solid rgba(59, 130, 246, 0.3); border-radius: var(--radius-xs);
      padding: 6px 14px; color: var(--text-primary); cursor: pointer;
      transition: all 0.2s;
    }
    .topbar-btn:hover { background: linear-gradient(135deg, rgba(59, 130, 246, 0.35), rgba(139, 92, 246, 0.35)); }
    .topbar-stamp {
      font-family: 'JetBrains Mono', monospace; font-size: 0.7rem;
      color: var(--text-muted);
    }

    /* Stats Row */
    .stats-row {
      display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px;
      margin-bottom: 20px;
    }
    .stat-card {
      padding: 16px;
      background: var(--bg-card);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-sm);
      backdrop-filter: blur(12px);
      transition: all 0.25s ease;
      position: relative; overflow: hidden;
    }
    .stat-card::before {
      content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
      background: linear-gradient(90deg, transparent, var(--stat-accent, var(--accent-blue)), transparent);
      opacity: 0.6;
    }
    .stat-card:hover { border-color: var(--glass-border-hover); transform: translateY(-1px); }
    .stat-label {
      font-size: 0.65rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.1em; color: var(--text-muted); margin-bottom: 8px;
    }
    .stat-value {
      font-size: 1.6rem; font-weight: 800; letter-spacing: -0.02em;
      line-height: 1; margin-bottom: 4px;
    }
    .stat-sub {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.68rem; color: var(--text-secondary);
    }
    .stat-green { --stat-accent: var(--accent-green); }
    .stat-green .stat-value { color: var(--accent-green); }
    .stat-blue { --stat-accent: var(--accent-blue); }
    .stat-amber { --stat-accent: var(--accent-amber); }
    .stat-amber .stat-value { color: var(--accent-amber); }
    .stat-red { --stat-accent: var(--accent-red); }
    .stat-red .stat-value { color: var(--accent-red); }
    .stat-purple { --stat-accent: var(--accent-purple); }
    .stat-cyan { --stat-accent: var(--accent-cyan); }

    /* Grid Layout */
    .grid { display: grid; grid-template-columns: 1.5fr 1fr 1fr; gap: 14px; margin-bottom: 14px; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
    .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-bottom: 14px; }

    /* Panel Cards */
    .panel {
      background: var(--bg-card);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      backdrop-filter: blur(12px);
      display: flex; flex-direction: column;
      overflow: hidden;
      transition: border-color 0.3s;
      min-height: 260px;
    }
    .panel:hover { border-color: var(--glass-border-hover); }
    .panel-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 16px;
      border-bottom: 1px solid var(--glass-border);
    }
    .panel-title {
      font-size: 0.85rem; font-weight: 700; letter-spacing: -0.01em;
    }
    .panel-badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.65rem; padding: 3px 8px;
      border-radius: 999px;
      background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.2);
      color: var(--accent-blue);
    }
    .panel-body { flex: 1; overflow-y: auto; padding: 10px; display: grid; gap: 8px; align-content: start; }

    /* Item Cards */
    .item {
      padding: 12px;
      background: rgba(255, 255, 255, 0.015);
      border: 1px solid rgba(255, 255, 255, 0.04);
      border-radius: var(--radius-sm);
      display: grid; gap: 6px;
      transition: all 0.2s;
      animation: itemFadeIn 0.3s ease;
    }
    @keyframes itemFadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .item:hover { background: rgba(255, 255, 255, 0.03); border-color: rgba(255, 255, 255, 0.08); }
    .item-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
    .item-title { font-size: 0.82rem; font-weight: 600; }
    .item-mono {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.68rem; color: var(--text-muted);
    }
    .item-desc { font-size: 0.78rem; color: var(--text-secondary); line-height: 1.4; }

    /* Status Badges */
    .badge {
      display: inline-flex; align-items: center; padding: 2px 8px;
      border-radius: 999px; font-size: 0.6rem; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.07em; white-space: nowrap;
    }
    .badge-green { background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.3); color: #34d399; }
    .badge-blue { background: rgba(59, 130, 246, 0.12); border: 1px solid rgba(59, 130, 246, 0.3); color: #60a5fa; }
    .badge-amber { background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.3); color: #fbbf24; }
    .badge-red { background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; }
    .badge-purple { background: rgba(139, 92, 246, 0.12); border: 1px solid rgba(139, 92, 246, 0.3); color: #a78bfa; }
    .badge-gray { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); color: var(--text-secondary); }

    /* Risk Bar */
    .risk-track { width: 100%; height: 4px; border-radius: 999px; background: rgba(255,255,255,0.06); overflow: hidden; }
    .risk-fill { height: 100%; border-radius: inherit; transition: width 0.4s ease; }

    /* Empty State */
    .empty-state {
      padding: 24px;
      text-align: center; color: var(--text-muted); font-size: 0.78rem;
      border: 1px dashed rgba(255,255,255,0.06);
      border-radius: var(--radius-sm);
    }

    /* Tool Pill */
    .tool-pill {
      display: inline-flex; padding: 3px 8px;
      background: rgba(6, 182, 212, 0.08); border: 1px solid rgba(6, 182, 212, 0.18);
      border-radius: var(--radius-xs); font-size: 0.65rem; color: var(--accent-cyan);
      font-family: 'JetBrains Mono', monospace;
    }

    /* Debate Cards */
    .debate-card {
      padding: 12px;
      background: rgba(139, 92, 246, 0.04);
      border: 1px solid rgba(139, 92, 246, 0.12);
      border-radius: var(--radius-sm);
      display: grid; gap: 6px;
    }
    .debate-card strong { font-size: 0.78rem; color: var(--accent-purple); }
    .debate-card p { font-size: 0.76rem; color: var(--text-secondary); line-height: 1.4; }

    /* Responsive */
    @media (max-width: 1200px) {
      .stats-row { grid-template-columns: repeat(3, 1fr); }
      .grid { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 768px) {
      .app { padding: 12px; }
      .stats-row { grid-template-columns: repeat(2, 1fr); }
      .grid, .grid-2, .grid-3 { grid-template-columns: 1fr; }
    }
    
    /* scrollbar */
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 99px; }
  </style>
</head>
<body>
  <div class="matrix-bg"></div>
  <div class="app">
    <!-- Top Bar -->
    <div class="topbar">
      <div class="topbar-left">
        <span class="logo">SOVEREIGN</span>
        <span class="live-badge"><span class="live-dot"></span> Live</span>
      </div>
      <div class="topbar-right">
        <input id="workspace" class="topbar-input" value="${defaultWorkspaceId}" placeholder="workspace" style="width:120px" />
        <select id="refresh" class="topbar-select">
          <option value="1500">1.5s</option>
          <option value="3000" selected>3s</option>
          <option value="5000">5s</option>
          <option value="10000">10s</option>
          <option value="0">Manual</option>
        </select>
        <button id="refreshBtn" class="topbar-btn" type="button">Refresh</button>
        <span id="updatedAt" class="topbar-stamp">Connecting...</span>
      </div>
    </div>

    <!-- Stats -->
    <div class="stats-row">
      <div class="stat-card stat-green"><div class="stat-label">Active Runs</div><div class="stat-value" id="s-active">0</div><div class="stat-sub" id="s-total">0 total</div></div>
      <div class="stat-card stat-amber"><div class="stat-label">Waiting Human</div><div class="stat-value" id="s-waiting">0</div><div class="stat-sub" id="s-completed">0 completed</div></div>
      <div class="stat-card stat-red"><div class="stat-label">Failed</div><div class="stat-value" id="s-failed">0</div><div class="stat-sub" id="s-risk">avg risk 0.00</div></div>
      <div class="stat-card stat-purple"><div class="stat-label">Approvals</div><div class="stat-value" id="s-approvals">0</div><div class="stat-sub" id="s-consensus">consensus 0.00</div></div>
      <div class="stat-card stat-blue"><div class="stat-label">P95 Latency</div><div class="stat-value" id="s-latency">0<small style="font-size:0.6em;opacity:0.6">ms</small></div><div class="stat-sub" id="s-tokens">0 tokens</div></div>
      <div class="stat-card stat-cyan"><div class="stat-label">Cost</div><div class="stat-value" id="s-cost">$0.00</div><div class="stat-sub" id="s-agents">0 agents</div></div>
    </div>

    <!-- Row 1: Orchestrator + Plugins + Bank -->
    <div class="grid">
      <div class="panel">
        <div class="panel-header"><span class="panel-title">Company Orchestrator</span><span class="panel-badge" id="runs-count">0 runs</span></div>
        <div class="panel-body" id="runs-list"></div>
      </div>
      <div class="panel">
        <div class="panel-header"><span class="panel-title">Active Plugins</span><span class="panel-badge" id="plugin-count">-</span></div>
        <div class="panel-body" id="plugin-list"></div>
      </div>
      <div class="panel">
        <div class="panel-header"><span class="panel-title">Company Bank</span><span class="panel-badge" id="bank-badge">-</span></div>
        <div class="panel-body" id="bank-list"></div>
      </div>
    </div>

    <!-- Row 2: Risk + Council + Agents -->
    <div class="grid-3">
      <div class="panel">
        <div class="panel-header"><span class="panel-title">Trust and Risk</span><span class="panel-badge" id="risk-count">0</span></div>
        <div class="panel-body" id="risk-list"></div>
      </div>
      <div class="panel">
        <div class="panel-header"><span class="panel-title">Council Sessions</span><span class="panel-badge" id="council-count">0</span></div>
        <div class="panel-body" id="council-list"></div>
      </div>
      <div class="panel">
        <div class="panel-header"><span class="panel-title">Agent Roster</span><span class="panel-badge" id="agent-count">0</span></div>
        <div class="panel-body" id="agent-list"></div>
      </div>
    </div>

    <!-- Row 3: Debate + Events + Traces -->
    <div class="grid-3">
      <div class="panel">
        <div class="panel-header"><span class="panel-title">Debate Feed</span><span class="panel-badge" id="debate-count">0</span></div>
        <div class="panel-body" id="debate-grid"></div>
      </div>
      <div class="panel">
        <div class="panel-header"><span class="panel-title">Event Stream</span><span class="panel-badge" id="event-count">0</span></div>
        <div class="panel-body" id="event-list"></div>
      </div>
      <div class="panel">
        <div class="panel-header"><span class="panel-title">Traces</span><span class="panel-badge" id="trace-count">0</span></div>
        <div class="panel-body" id="trace-list"></div>
      </div>
    </div>

    <!-- Row 4: Readiness -->
    <div class="grid-2">
      <div class="panel">
        <div class="panel-header"><span class="panel-title">Launch Readiness</span><span class="panel-badge" id="setup-count">-</span></div>
        <div class="panel-body" id="setup-list"></div>
      </div>
      <div class="panel">
        <div class="panel-header"><span class="panel-title">Chat Sessions</span><span class="panel-badge" id="session-count">0</span></div>
        <div class="panel-body" id="session-list"></div>
      </div>
    </div>
  </div>

  <script>
    (function () {
      var workspaceInput = document.getElementById("workspace");
      var refreshSelect = document.getElementById("refresh");
      var refreshBtn = document.getElementById("refreshBtn");
      var updatedAt = document.getElementById("updatedAt");
      var timer = null;

      function esc(v) { return String(v == null ? "" : v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
      function cleanText(v) { return String(v || "").replace(/\\^/g, "").replace(/\\^/g, "").trim(); }
      function shortId(id) { return id ? String(id).substring(0, 10) : "-"; }
      function fmtN(v, d) { var n = Number(v||0); return Number.isFinite(n) ? n.toFixed(d||0) : "0"; }
      function fmtPct(v) { return (Number(v||0)*100).toFixed(0)+"%"; }
      function fmtTime(iso) { if (!iso) return "-"; var d=new Date(iso); return isNaN(d)?"-":d.toLocaleTimeString(); }
      function empty(t) { return '<div class="empty-state">'+esc(t)+'</div>'; }

      function badgeClass(status) {
        var s = String(status||"").toLowerCase();
        if (["completed","success"].includes(s)) return "badge-green";
        if (["failed","error"].includes(s)) return "badge-red";
        if (["waiting_human","blocked","warning"].includes(s)) return "badge-amber";
        if (["executing","planning","running","active","pending","info"].includes(s)) return "badge-blue";
        return "badge-gray";
      }

      function riskColor(score) {
        if (score >= 0.8) return "var(--accent-red)";
        if (score >= 0.5) return "var(--accent-amber)";
        return "var(--accent-green)";
      }

      // Stats
      function renderStats(snap) {
        var s = snap.stats || {};
        var a = snap.agents || {};
        document.getElementById("s-active").textContent = s.runsActive || "0";
        document.getElementById("s-total").textContent = (s.runsTotal||0) + " total";
        document.getElementById("s-waiting").textContent = s.runsWaitingHuman || "0";
        document.getElementById("s-completed").textContent = (s.runsCompleted||0) + " completed";
        document.getElementById("s-failed").textContent = s.runsFailed || "0";
        document.getElementById("s-risk").textContent = "avg risk " + fmtN(s.avgRiskScore, 2);
        document.getElementById("s-approvals").textContent = s.pendingApprovals || "0";
        document.getElementById("s-consensus").textContent = "consensus " + fmtN(s.avgConsensus, 2);
        document.getElementById("s-latency").innerHTML = fmtN(s.latencyP95Ms,0) + '<small style="font-size:0.6em;opacity:0.6">ms</small>';
        document.getElementById("s-tokens").textContent = fmtN(s.tokenUsageTotal,0) + " tokens";
        document.getElementById("s-cost").textContent = "$" + fmtN(s.costUsdTotal, 4);
        document.getElementById("s-agents").textContent = (a.total||0) + " agents";
      }

      // Runs
      function renderRuns(snap) {
        var runs = ((snap.orchestrator||{}).latestRuns)||[];
        document.getElementById("runs-count").textContent = runs.length + " runs";
        var el = document.getElementById("runs-list");
        if (!runs.length) { el.innerHTML = empty("No runs yet. Execute a company objective to animate this panel."); return; }
        el.innerHTML = runs.map(function(r) {
          var obj = cleanText(r.objective||"");
          return '<div class="item">' +
            '<div class="item-row"><span class="item-title">' + esc(obj.substring(0,80)) + '</span>' +
            '<span class="badge '+badgeClass(r.status)+'">' + esc(r.status||"?") + '</span></div>' +
            '<div class="item-mono">' + esc(shortId(r.id)) + ' - mission ' + esc(shortId(r.missionId)) + '</div>' +
            (r.consensusAvg != null ? '<div class="item-mono">consensus ' + fmtN(r.consensusAvg,2) + '</div>' : '') +
            '<div class="item-mono">' + esc(fmtTime(r.updatedAt||r.startedAt)) + '</div>' +
          '</div>';
        }).join("");
      }

      // Plugins
      async function renderPlugins() {
        var el = document.getElementById("plugin-list");
        try {
          var res = await fetch("/api/plugins");
          if (!res.ok) throw new Error();
          var data = await res.json();
          var plugins = data.plugins || [];
          var totalTools = plugins.reduce(function(s,p){return s+(p.toolCount||0);},0);
          document.getElementById("plugin-count").textContent = plugins.length + " plugins - " + totalTools + " tools";
          if (!plugins.length) { el.innerHTML = empty("No plugins loaded."); return; }
          el.innerHTML = plugins.map(function(p) {
            var tools = (p.tools||[]).map(function(t){ return '<span class="tool-pill">'+esc(t.name)+'</span>'; }).join(" ");
            return '<div class="item">' +
              '<div class="item-row"><span class="item-title">' + esc(p.name||p.id) + '</span>' +
              '<span class="badge badge-blue">' + (p.toolCount||0) + ' tools</span></div>' +
              '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:2px">' + tools + '</div>' +
            '</div>';
          }).join("");
        } catch(e) {
          el.innerHTML = empty("Could not load plugins.");
        }
      }

      // Bank
      async function renderBank() {
        var el = document.getElementById("bank-list");
        try {
          var res = await fetch("/api/plugins/company-bank/tools/check_balance/invoke",{
            method:"POST",headers:{"Content-Type":"application/json"},body:'{"input":{}}'
          });
          if (!res.ok) throw new Error();
          var data = await res.json();
          var r = data.invocation?.result || {};
          document.getElementById("bank-badge").textContent = r.remaining || "$0.00";
          el.innerHTML =
            '<div class="item">' +
              '<div class="item-row"><span class="item-title">Budget Cap</span><span style="color:var(--accent-green);font-weight:700">'+esc(r.budgetCap||"$0")+'</span></div>' +
              '<div class="item-row"><span class="item-desc">Total Spent</span><span class="item-mono">'+esc(r.totalSpent||"$0")+'</span></div>' +
              '<div class="item-row"><span class="item-desc">Remaining</span><span style="color:var(--accent-cyan);font-weight:600">'+esc(r.remaining||"$0")+'</span></div>' +
              '<div class="item-row"><span class="item-desc">Per-TX Limit</span><span class="item-mono">'+esc(r.perTransactionLimit||"$0")+'</span></div>' +
              '<div class="item-row"><span class="item-desc">Transactions</span><span class="item-mono">'+esc(r.transactionCount||0)+'</span></div>' +
            '</div>';
        } catch(e) {
          el.innerHTML = empty("Bank plugin not loaded or not reachable.");
        }
      }

      // Risk
      function renderRisk(snap) {
        var risk = (snap||{}).risk||{};
        var actions = risk.latestActions||[];
        var bands = risk.bands||{};
        document.getElementById("risk-count").textContent = actions.length + " actions";
        var el = document.getElementById("risk-list");
        var header = '<div class="item"><div class="item-mono">low '+esc(bands.low||0)+' - med '+esc(bands.medium||0)+' - high '+esc(bands.high||0)+' - crit '+esc(bands.critical||0)+'</div></div>';
        if (!actions.length) { el.innerHTML = header+empty("No runtime actions yet."); return; }
        el.innerHTML = header + actions.slice(0,10).map(function(a) {
          var sc = Number(a.riskScore||0);
          return '<div class="item">'+
            '<div class="item-row"><span class="item-mono">'+esc(a.actionType||"read")+'</span><span class="badge '+badgeClass(a.status)+'">'+esc(a.status||"?")+'</span></div>'+
            '<div class="risk-track"><div class="risk-fill" style="width:'+fmtPct(sc)+';background:'+riskColor(sc)+'"></div></div>'+
            '<div class="item-mono">risk '+fmtN(sc,2)+' - '+esc(a.decision||"n/a")+'</div>'+
          '</div>';
        }).join("");
      }

      // Council
      function renderCouncil(snap) {
        var runs = ((snap||{}).council||{}).latestRuns||[];
        document.getElementById("council-count").textContent = runs.length;
        var el = document.getElementById("council-list");
        if (!runs.length) { el.innerHTML = empty("No council sessions."); return; }
        el.innerHTML = runs.slice(0,8).map(function(r) {
          return '<div class="item">'+
            '<div class="item-row"><span class="item-mono">'+esc(shortId(r.id))+'</span><span class="badge '+badgeClass(r.status)+'">'+esc(r.status||"?")+'</span></div>'+
            '<div class="item-mono">rounds '+esc(r.debateRounds||0)+' - consensus '+(r.consensusScore!=null?fmtN(r.consensusScore,2):"-")+'</div>'+
            (r.topAction?'<div class="item-desc">'+esc(r.topAction)+'</div>':'')+
          '</div>';
        }).join("");
      }

      // Agents
      function renderAgents(snap) {
        var agents = ((snap||{}).agents||{}).list||[];
        document.getElementById("agent-count").textContent = (snap.agents?.total||0) + " agents";
        var el = document.getElementById("agent-list");
        if (!agents.length) { el.innerHTML = empty("No agents yet."); return; }
        el.innerHTML = agents.slice(0,10).map(function(a) {
          return '<div class="item">'+
            '<div class="item-row"><span class="item-title">'+esc(a.name)+'</span><span class="badge badge-purple">'+esc(a.role)+'</span></div>'+
            '<div class="item-mono">'+esc(a.skillCount||0)+' skills - web '+(a.canUseWeb?"yes":"no")+'</div>'+
          '</div>';
        }).join("");
      }

      // Debate
      function renderDebate(snap) {
        var msgs = ((snap||{}).council||{}).debateFeed||[];
        document.getElementById("debate-count").textContent = msgs.length;
        var el = document.getElementById("debate-grid");
        if (!msgs.length) { el.innerHTML = empty("Debate feed appears after councils run."); return; }
        el.innerHTML = msgs.slice(0,12).map(function(m) {
          return '<div class="debate-card">'+
            '<strong>'+esc(m.agentName||"Agent")+' - '+esc(m.trackTitle||"Track")+'</strong>'+
            '<p>'+esc(m.insight||"No insight.")+'</p>'+
            '<div class="item-mono">confidence '+fmtN(m.confidence,2)+' - '+esc(fmtTime(m.at))+'</div>'+
          '</div>';
        }).join("");
      }

      // Events
      function renderEvents(snap) {
        var evts = ((snap||{}).observability||{}).events||[];
        document.getElementById("event-count").textContent = evts.length;
        var el = document.getElementById("event-list");
        if (!evts.length) { el.innerHTML = empty("No events yet."); return; }
        el.innerHTML = evts.slice(0,15).map(function(e) {
          return '<div class="item">'+
            '<div class="item-row"><span class="item-mono">'+esc(e.source||"")+'.'+esc(e.type||"")+'</span><span class="badge '+badgeClass(e.level)+'">'+esc(e.level||"info")+'</span></div>'+
            '<div class="item-desc">'+esc((e.message||"").substring(0,120))+'</div>'+
            '<div class="item-mono">'+esc(fmtTime(e.createdAt))+'</div>'+
          '</div>';
        }).join("");
      }

      // Traces
      function renderTraces(snap) {
        var traces = ((snap||{}).observability||{}).traces||[];
        document.getElementById("trace-count").textContent = traces.length;
        var el = document.getElementById("trace-list");
        if (!traces.length) { el.innerHTML = empty("No traces yet."); return; }
        el.innerHTML = traces.slice(0,10).map(function(t) {
          return '<div class="item">'+
            '<div class="item-row"><span class="item-mono">'+esc(t.name||shortId(t.id))+'</span><span class="badge '+badgeClass(t.status)+'">'+esc(t.status||"active")+'</span></div>'+
            '<div class="item-mono">events '+esc(t.eventCount||0)+' - spans '+esc(t.spanCount||0)+' - errors '+esc(t.errorCount||0)+'</div>'+
          '</div>';
        }).join("");
      }

      // Setup
      function renderSetup(snap) {
        var readiness = ((snap||{}).setup||{}).readiness;
        var el = document.getElementById("setup-list");
        if (!readiness) {
          document.getElementById("setup-count").textContent = "No report";
          el.innerHTML = empty("Run /api/setup/doctor to generate readiness scores.");
          return;
        }
        document.getElementById("setup-count").textContent = (readiness.score||0)+"/100 - "+esc(readiness.verdict||"?");
        var cats = readiness.categories||{};
        el.innerHTML = Object.keys(cats).map(function(key) {
          var c = cats[key]||{};
          var bc = (c.fail||0)>0?"badge-red":(c.warn||0)>0?"badge-amber":"badge-green";
          return '<div class="item"><div class="item-row"><span class="item-mono">'+esc(key)+'</span><span class="badge '+bc+'">'+(c.score||0)+'/100</span></div></div>';
        }).join("");
      }

      // Sessions
      function renderSessions(snap) {
        var sessions = ((snap||{}).channels||{}).sessions||[];
        document.getElementById("session-count").textContent = sessions.length;
        var el = document.getElementById("session-list");
        if (!sessions.length) { el.innerHTML = empty("No chat sessions yet."); return; }
        el.innerHTML = sessions.slice(0,10).map(function(s) {
          return '<div class="item">'+
            '<div class="item-row"><span class="item-mono">'+esc(s.channelId||"?")+'</span><span class="badge badge-blue">'+esc(s.userId||"")+'</span></div>'+
            '<div class="item-mono">'+esc(fmtTime(s.updatedAt))+'</div>'+
          '</div>';
        }).join("");
      }

      // Main render
      function render(snapshot) {
        renderStats(snapshot);
        renderRuns(snapshot);
        renderRisk(snapshot);
        renderCouncil(snapshot);
        renderAgents(snapshot);
        renderDebate(snapshot);
        renderEvents(snapshot);
        renderTraces(snapshot);
        renderSetup(snapshot);
        renderSessions(snapshot);
      }

      async function loadSnapshot() {
        var wid = String(workspaceInput.value||"default").trim()||"default";
        refreshBtn.disabled = true;
        try {
          var query = new URLSearchParams({workspaceId:wid,limit:"12"});
          var response = await fetch("/api/dashboard/snapshot?"+query.toString(),{method:"GET",headers:{"Accept":"application/json"}});
          if (!response.ok) throw new Error("HTTP "+response.status);
          var payload = await response.json();
          render(payload.snapshot||{});
          renderPlugins();
          renderBank();
          updatedAt.textContent = new Date().toLocaleTimeString() + " - " + wid;
        } catch(error) {
          updatedAt.textContent = "Error: "+(error&&error.message?error.message:"unknown");
        } finally {
          refreshBtn.disabled = false;
        }
      }

      function resetTimer() {
        if (timer) { clearInterval(timer); timer = null; }
        var ms = Number(refreshSelect.value)||0;
        if (ms > 0) timer = setInterval(loadSnapshot, ms);
      }

      refreshBtn.addEventListener("click", loadSnapshot);
      refreshSelect.addEventListener("change", resetTimer);
      workspaceInput.addEventListener("change", loadSnapshot);
      loadSnapshot();
      resetTimer();
    })();
  </script>
</body>
</html>`;
}
