/* ==========================================================================
   JARVIS — Marketing (Content Intelligence)

   Paid requests (InsightSocial, Claude) only ever run on JARVIS's own
   Firebase Cloud Functions (functions/), which hold the API keys as server
   secrets, accept only the owner's signed-in account, and enforce the
   monthly credit cap and AI budget. The browser never sees a key.

   Settings, the idea library and research notes are private Firestore
   documents under users/{uid}/ (JarvisCloud.data). Usage, snapshots and run
   history are written only by the server and are read-only here.

   Earlier versions stored the InsightSocial key in this browser's
   localStorage; that copy is deleted on load.
   ========================================================================== */

(function () {
  "use strict";

  const LEGACY_KEY_STORAGE = "jarvisInsightSocialKey";
  const HANDLE_RE = /^[a-z0-9._]{1,30}$/;
  const MAX_WATCHLIST = 10;
  // Mirrors functions/lib/settings.js; the server re-checks everything.
  const DEFAULT_SETTINGS = {
    monthlyCreditCap: 1500,
    monthlyBudgetUsd: 20,
    insightPlanMonthlyUsd: 0,
    aiModel: "claude-opus-5-5",
    brandProfile: "",
    contentPillars: ["Faith", "Behind the brand", "Style & outfits", "Community", "Product drops"],
    watchlist: []
  };
  // Rough size of one idea request (system prompt + brief + research) for
  // the cost estimate shown before generating; the server makes the real
  // check with the actual prompt.
  const TYPICAL_INPUT_TOKENS = 3000;
  const STATUSES = [
    { value: "draft", label: "Draft" },
    { value: "ready", label: "Ready to film" },
    { value: "filmed", label: "Filmed" },
    { value: "posted", label: "Posted" }
  ];
  const STAGES = [
    { value: "unaware", label: "Unaware" },
    { value: "problem_aware", label: "Problem aware" },
    { value: "solution_aware", label: "Solution aware" },
    { value: "product_aware", label: "Product aware" },
    { value: "most_aware", label: "Most aware" }
  ];
  const PLATFORM_LABELS = { instagram: "Instagram", tiktok: "TikTok", both: "Instagram + TikTok" };
  const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
  const MODEL_LABELS = { "claude-opus-5-5": "Claude Opus 5.5", "claude-sonnet-5-5": "Claude Sonnet 5.5", "claude-haiku-5-5": "Claude Haiku 5.5" };

  const state = {
    status: null,
    statusError: "",
    settings: null,
    snapshots: [],
    research: null,
    ideas: [],
    findings: [],
    dataError: "",
    loaded: false,
    loading: false,
    generated: [],
    lastBrief: null,
    editingId: null,
    editingDraftIndex: -1,
    lastHandle: ""
  };

  function $(id) { return document.getElementById(id); }
  function core() { return window.JarvisCore; }
  function cloud() { return window.JarvisCloud || null; }
  function signedIn() { const c = cloud(); return !!(c && c.isSignedIn()); }
  // Private document storage; rejects instead of throwing if it's missing.
  function data() {
    const c = cloud();
    if (c && c.data) return c.data;
    const fail = function () { return Promise.reject(new Error("cloud storage isn't available")); };
    return { get: fail, set: fail, remove: fail, list: fail };
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function removeLegacyBrowserKey() {
    try {
      if (localStorage.getItem(LEGACY_KEY_STORAGE) === null) return false;
      localStorage.removeItem(LEGACY_KEY_STORAGE);
      return true;
    } catch (e) {
      return false;
    }
  }

  function formatNumber(n) { return typeof n === "number" && isFinite(n) ? n.toLocaleString() : "—"; }
  function money(n) { return "$" + (typeof n === "number" && isFinite(n) ? n : 0).toFixed(2); }
  function stageLabel(v) { const s = STAGES.find(function (x) { return x.value === v; }); return s ? s.label : v || "—"; }
  function statusLabel(v) { const s = STATUSES.find(function (x) { return x.value === v; }); return s ? s.label : "Draft"; }
  // "2026-10-14" as a local calendar day (new Date() would read it as UTC
  // midnight and show the previous day in US time zones).
  function formatDay(isoDay) { return isoDay ? core().formatDate(String(isoDay).slice(0, 10) + "T00:00:00") : ""; }
  function normalizeHandle(raw) { return String(raw || "").trim().replace(/^@+/, "").toLowerCase(); }

  // Turns a Cloud Functions error into something actionable.
  function describeCallError(err) {
    const code = (err && err.code) || "";
    const message = (err && err.message) || "";
    if (code === "functions/unauthenticated") return "Sign in to JARVIS to use Marketing.";
    if (code === "functions/permission-denied") return "This account isn't allowed to use Marketing research.";
    if (code === "functions/not-found") return "The Marketing server isn't deployed yet (see functions/README.md).";
    if (code === "functions/failed-precondition" || code === "functions/resource-exhausted" || code === "functions/invalid-argument") return message;
    if (code === "functions/unavailable" && /Claude/.test(message)) return message;
    if (code === "functions/unavailable" || code === "functions/deadline-exceeded") return "Couldn't reach the Marketing server. Check your connection and try again.";
    return "Something went wrong talking to the Marketing server" + (message ? ": " + message : ".");
  }

  // Firestore errors when reading/writing your private marketing documents.
  function describeDataError(err) {
    const code = (err && err.code) || "";
    if (code === "functions/unauthenticated") return "Sign in to JARVIS to use Marketing.";
    if (code === "permission-denied") return "Your Firestore rules don't allow this yet. Deploy the updated rules: npx firebase-tools deploy --only functions,firestore:rules (see functions/README.md).";
    if (code === "unavailable") return "Couldn't reach your cloud storage. Check your connection and try again.";
    return "Couldn't load or save your marketing data" + (err && err.message ? ": " + err.message : ".");
  }

  /* ---------------- settings ---------------- */

  function clampNumber(v, min, max, fallback) {
    const n = Number(v);
    if (!isFinite(n) || v === "" || v === null) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function sanitizeSettings(raw) {
    const r = raw || {};
    const pillars = Array.isArray(r.contentPillars)
      ? r.contentPillars.map(function (p) { return String(p || "").trim().slice(0, 40); }).filter(Boolean).slice(0, 12)
      : DEFAULT_SETTINGS.contentPillars.slice();
    const seen = {};
    const watch = (Array.isArray(r.watchlist) ? r.watchlist : []).map(normalizeHandle).filter(function (h) {
      if (!HANDLE_RE.test(h) || seen[h]) return false;
      seen[h] = true;
      return true;
    }).slice(0, MAX_WATCHLIST);
    return {
      monthlyCreditCap: Math.round(clampNumber(r.monthlyCreditCap, 0, 100000, DEFAULT_SETTINGS.monthlyCreditCap)),
      monthlyBudgetUsd: clampNumber(r.monthlyBudgetUsd, 0, 500, DEFAULT_SETTINGS.monthlyBudgetUsd),
      insightPlanMonthlyUsd: clampNumber(r.insightPlanMonthlyUsd, 0, 500, DEFAULT_SETTINGS.insightPlanMonthlyUsd),
      aiModel: MODEL_LABELS[r.aiModel] ? r.aiModel : DEFAULT_SETTINGS.aiModel,
      brandProfile: typeof r.brandProfile === "string" ? r.brandProfile.slice(0, 3000) : "",
      contentPillars: pillars.length ? pillars : DEFAULT_SETTINGS.contentPillars.slice(),
      watchlist: watch
    };
  }

  function saveSettings(patch) {
    const next = sanitizeSettings(Object.assign({}, state.settings || DEFAULT_SETTINGS, patch));
    return data().set("marketing/settings", next, true).then(function () {
      state.settings = next;
      return next;
    });
  }

  /* ---------------- loading ---------------- */

  function loadAll() {
    if (!signedIn()) {
      state.loaded = false;
      renderAll();
      return Promise.resolve();
    }
    state.loading = true;
    renderAll();
    const c = cloud();
    const statusP = c.call("marketingStatus").then(function (s) { state.status = s; state.statusError = ""; })
      .catch(function (err) { state.status = null; state.statusError = describeCallError(err); });
    const dataP = Promise.all([
      data().get("marketing/settings"),
      data().list("marketingSnapshots"),
      data().get("marketingState/research"),
      data().list("marketingIdeas"),
      data().list("marketingFindings")
    ]).then(function (r) {
      state.settings = sanitizeSettings(r[0]);
      state.snapshots = r[1] || [];
      state.research = r[2];
      state.ideas = r[3] || [];
      state.findings = r[4] || [];
      state.dataError = "";
    }).catch(function (err) {
      state.settings = state.settings || sanitizeSettings(null);
      state.dataError = describeDataError(err);
    });
    return Promise.all([statusP, dataP]).then(function () {
      state.loading = false;
      state.loaded = true;
      renderAll();
    });
  }

  function refreshStatus() {
    if (!signedIn()) return Promise.resolve();
    return cloud().call("marketingStatus").then(function (s) { state.status = s; state.statusError = ""; })
      .catch(function (err) { state.statusError = describeCallError(err); })
      .then(function () { renderStatus(); renderBudget(); renderResearchSummary(); renderIdeaCostHint(); });
  }

  function renderAll() {
    renderStatus();
    renderBudget();
    renderResearchSummary();
    renderCompetitors();
    renderFindings();
    renderPillarOptions();
    renderIdeaCostHint();
    renderLibrary();
    renderSettingsForm();
  }

  function skeleton(container, lines) {
    container.textContent = "";
    for (let i = 0; i < (lines || 2); i++) {
      const s = el("div", "mkt-skeleton" + (i % 2 ? " short" : ""));
      s.setAttribute("aria-hidden", "true");
      container.appendChild(s);
    }
    const sr = el("span", "visually-hidden", "Loading…");
    container.appendChild(sr);
  }

  function emptyState(container, text) {
    container.textContent = "";
    container.appendChild(el("p", "empty-state", text));
  }

  function errorLine(container, text) {
    container.textContent = "";
    const p = el("p", "field-hint text-negative", text);
    p.setAttribute("role", "alert");
    container.appendChild(p);
  }

  /* ---------------- overview: server status ---------------- */

  function renderStatus(notice) {
    const statusEl = $("ciConnectionStatus");
    const usageEl = $("ciUsageSummary");
    if (!statusEl) return;
    statusEl.classList.remove("text-negative");
    usageEl.textContent = notice || state.notice || "";

    const c = cloud();
    if (!c) {
      statusEl.textContent = "Marketing needs JARVIS's sign-in service, which didn't load. Your other data is unaffected.";
      return;
    }
    if (!c.isSignedIn()) {
      statusEl.textContent = "Sign in to JARVIS to use Marketing. Requests run on your private server, not in this browser.";
      return;
    }
    if (state.loading && !state.status) { statusEl.textContent = "Checking your Marketing server…"; return; }
    if (state.statusError) {
      statusEl.textContent = state.statusError;
      statusEl.classList.add("text-negative");
      return;
    }
    const s = state.status;
    if (!s) { statusEl.textContent = "Checking your Marketing server…"; return; }
    const parts = [];
    parts.push(s.keyConfigured ? "InsightSocial key: set on the server" : "InsightSocial key: not set on the server yet");
    parts.push(s.aiKeyConfigured ? "Claude key: set on the server" : "Claude key: not set (AI ideas unavailable)");
    statusEl.textContent = "Connected to your Marketing server. " + parts.join(" · ") + ".";
    if (!s.keyConfigured) statusEl.classList.add("text-negative");
    if (typeof (s.usage || {}).lastCreditsRemaining === "number") {
      usageEl.textContent = (usageEl.textContent ? usageEl.textContent + " " : "") + formatNumber(s.usage.lastCreditsRemaining) + " credits left on your InsightSocial plan (last reported by InsightSocial).";
    }
  }

  /* ---------------- overview: budget ---------------- */

  function meter(label, used, limit, valueText) {
    const wrap = el("div", "mkt-meter-row");
    const pct = limit > 0 ? used / limit : (used > 0 ? 1 : 0);
    const level = pct >= 1 ? "over" : pct >= 0.8 ? "warn" : "ok";
    const head = el("div", "mkt-meter-head");
    head.appendChild(el("span", "mkt-meter-label", label));
    head.appendChild(el("span", "mkt-meter-value", valueText));
    wrap.appendChild(head);
    const bar = el("div", "mkt-meter mkt-meter-" + level);
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", label);
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", String(Math.min(100, Math.round(pct * 100))));
    bar.setAttribute("aria-valuetext", valueText);
    const fill = el("div", "mkt-meter-fill");
    fill.style.width = Math.min(100, Math.max(0, pct * 100)) + "%";
    bar.appendChild(fill);
    wrap.appendChild(bar);
    if (level !== "ok") {
      wrap.appendChild(el("p", "mkt-meter-note mkt-note-" + level, level === "over" ? "Limit reached. Paid requests of this kind are blocked until next month or until you raise the limit in Settings." : Math.round(pct * 100) + "% used. Nearing this month's limit."));
    }
    return wrap;
  }

  function ideaWorstCaseUsd(model) {
    const s = state.status;
    if (!s || !s.aiPrices) return null;
    const p = s.aiPrices[model || s.aiModel];
    if (!p) return null;
    return (TYPICAL_INPUT_TOKENS * p.input + (s.aiMaxOutputTokens || 16000) * p.output) / 1e6;
  }

  function renderBudget() {
    const box = $("mktBudget");
    if (!box) return;
    if (!signedIn()) { emptyState(box, "Sign in to see this month's usage."); return; }
    if (state.loading && !state.status) { skeleton(box, 3); return; }
    const s = state.status;
    if (!s) { errorLine(box, state.statusError || "Usage isn't available."); return; }
    const u = s.usage || {};
    box.textContent = "";
    box.appendChild(meter("InsightSocial credits", u.creditsUsed || 0, s.monthlyCreditCap, formatNumber(u.creditsUsed || 0) + " of " + formatNumber(s.monthlyCreditCap)));
    box.appendChild(meter("AI ideas (Claude)", u.aiCostUsd || 0, s.aiAllowanceUsd, money(u.aiCostUsd) + " of " + money(s.aiAllowanceUsd)));
    const total = (s.insightPlanMonthlyUsd || 0) + (u.aiCostUsd || 0);
    box.appendChild(meter("Total estimated", total, s.monthlyBudgetUsd, money(total) + " of " + money(s.monthlyBudgetUsd)));

    const list = el("ul", "mkt-cost-list");
    const plan = el("li");
    plan.textContent = s.insightPlanMonthlyUsd > 0
      ? "InsightSocial plan: " + money(s.insightPlanMonthlyUsd) + "/month (as entered in Settings)."
      : "InsightSocial plan price not entered yet. Add it in Settings so the total is accurate.";
    list.appendChild(plan);
    const credits = el("li");
    credits.textContent = u.requests
      ? "InsightSocial: " + formatNumber(u.requests) + " request(s) this month, averaging " + ((u.creditsUsed || 0) / u.requests).toFixed(1) + " credit(s) each as reported by InsightSocial." + (u.unknownCostRequests ? " " + u.unknownCostRequests + " didn't report a cost." : "")
      : "InsightSocial: credit cost per request is reported by InsightSocial after each request; none yet this month.";
    list.appendChild(credits);
    const worst = ideaWorstCaseUsd();
    const ai = el("li");
    ai.textContent = "AI ideas with " + (MODEL_LABELS[s.aiModel] || s.aiModel) + ": up to about " + money(worst) + " per generation (worst case)" +
      (u.aiRequests ? "; your " + u.aiRequests + " generation(s) this month averaged " + money((u.aiCostUsd || 0) / u.aiRequests) + "." : ".") +
      " Costs are estimated from token counts and published prices.";
    list.appendChild(ai);
    box.appendChild(list);
  }

  /* ---------------- overview: daily research ---------------- */

  function renderResearchSummary() {
    const box = $("mktResearchSummary");
    if (!box) return;
    if (!signedIn()) { emptyState(box, "Sign in to see research runs."); return; }
    if (state.loading && !state.status) { skeleton(box, 2); return; }
    const s = state.status;
    const run = (s && s.lastRun) || (state.research && state.research.lastRun) || null;
    box.textContent = "";
    if (!run) {
      emptyState(box, "No research has run yet. Add competitors, then tap Run now or wait for tomorrow's automatic run.");
    } else {
      const head = el("p", "field-hint");
      head.textContent = (run.trigger === "schedule" ? "Automatic run" : "Manual run") + " · " + core().formatDateTime(run.finishedAt || run.startedAt) +
        " · " + formatNumber(run.creditsUsed || 0) + " credit(s) used" + (run.ok ? "" : " · finished with problems");
      box.appendChild(head);
      const ul = el("ul", "mkt-summary-list");
      (run.summary || []).forEach(function (line) { ul.appendChild(el("li", "", line)); });
      box.appendChild(ul);
    }
    const last = (s && s.lastSuccessfulRunAt) || (state.research && state.research.lastSuccessfulRunAt);
    box.appendChild(el("p", "field-hint", "Last successful update: " + (last ? core().formatDateTime(last) : "none yet") + "."));

    const hist = $("mktRunHistory");
    const runs = (state.research && Array.isArray(state.research.runs)) ? state.research.runs : [];
    hist.textContent = "";
    if (!runs.length) {
      hist.appendChild(el("li", "empty-state", "No runs recorded yet."));
    } else {
      runs.forEach(function (r) {
        const li = el("li", "list-item");
        const row = el("div", "list-item-row");
        row.appendChild(el("span", "list-item-title", core().formatDateTime(r.finishedAt || r.startedAt)));
        row.appendChild(el("span", "badge " + (r.ok ? "badge-green" : "badge-yellow"), r.ok ? "OK" : "Problems"));
        li.appendChild(row);
        li.appendChild(el("p", "field-hint", (r.trigger === "schedule" ? "Automatic" : "Manual") + " · " + r.handles + " handle(s) · " + r.failures + " failed · " + formatNumber(r.creditsUsed || 0) + " credit(s)"));
        hist.appendChild(li);
      });
    }
  }

  function runResearchNow() {
    if (!signedIn()) { core().showToast("Sign in to JARVIS to use Marketing."); return; }
    const btn = $("mktRunResearchBtn");
    const box = $("mktResearchSummary");
    btn.disabled = true;
    btn.textContent = "Running…";
    skeleton(box, 3);
    cloud().call("runResearch", {}, { timeout: 300000 }).then(function (res) {
      if (res && res.note) core().showToast(res.note);
      return Promise.all([
        data().get("marketingState/research").then(function (r) { state.research = r; }),
        data().list("marketingSnapshots").then(function (r) { state.snapshots = r || []; })
      ]).catch(function () { /* the status call below still shows the run */ });
    }).catch(function (err) {
      core().showToast(describeCallError(err));
    }).then(function () {
      btn.disabled = false;
      btn.textContent = "Run now";
      renderCompetitors();
      return refreshStatus();
    });
  }

  /* ---------------- overview: profile lookup ---------------- */

  function showResult(res) {
    const statusEl = $("ciLookupStatus");
    const resultEl = $("ciLookupResult");
    const refreshBtn = $("ciRefreshBtn");
    resultEl.textContent = "";
    refreshBtn.classList.toggle("hidden", !(res.ok && res.cached));

    if (res.ok) {
      const parts = [];
      if (res.cached) {
        parts.push("Saved result from " + core().formatDateTime(res.fetchedAt) + " — no credits used");
      } else {
        parts.push("Fresh result from InsightSocial");
        parts.push(typeof res.creditsUsed === "number" ? res.creditsUsed + " credit(s) used" : "credit cost not reported");
      }
      if (res.note) parts.push(res.note.replace(/\.$/, ""));
      statusEl.textContent = parts.join(" · ") + ".";
    } else {
      const parts = ["InsightSocial request failed" + (res.status ? " (HTTP " + res.status + ")" : "") + ": " + res.error];
      if (typeof res.creditsUsed === "number") parts.push(res.creditsUsed + " credit(s) charged");
      statusEl.textContent = parts.join(" · ");
    }
    if (res.body) {
      const details = document.createElement("details");
      details.open = !!res.ok;
      details.appendChild(el("summary", "", "Response data (shown as received)"));
      const pre = el("pre", "video-raw-response", JSON.stringify(res.body, null, 2));
      details.appendChild(pre);
      resultEl.appendChild(details);
    }
  }

  function runLookup(handle, refresh) {
    if (!signedIn()) { core().showToast("Sign in to JARVIS to use Marketing."); return; }
    const btn = $("ciLookupBtn");
    const refreshBtn = $("ciRefreshBtn");
    const statusEl = $("ciLookupStatus");
    btn.disabled = true;
    refreshBtn.disabled = true;
    statusEl.textContent = (refresh ? "Refreshing" : "Looking up") + " @" + handle + "…";
    $("ciLookupResult").textContent = "";
    cloud().call("insightRequest", { endpoint: "instagram.profile", params: { handle: handle }, refresh: !!refresh }).then(function (res) {
      showResult(res);
      if (!res.cached) refreshStatus();
    }).catch(function (err) {
      statusEl.textContent = describeCallError(err);
    }).then(function () {
      btn.disabled = false;
      refreshBtn.disabled = false;
    });
  }

  function handleLookup(e) {
    e.preventDefault();
    const handle = normalizeHandle($("ciLookupHandle").value);
    if (!handle) { core().showToast("Enter an Instagram handle."); return; }
    state.lastHandle = handle;
    runLookup(handle, false);
  }

  /* ---------------- competitors ---------------- */

  function sparkline(points, label) {
    const NS = "http://www.w3.org/2000/svg";
    const w = 120;
    const h = 32;
    const values = points.map(function (p) { return p.value; });
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const span = max - min || 1;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.setAttribute("class", "mkt-spark");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label + ": " + points.map(function (p) { return p.date + " " + p.value.toLocaleString(); }).join(", "));
    const coords = points.map(function (p, i) {
      const x = points.length === 1 ? w / 2 : (i / (points.length - 1)) * (w - 4) + 2;
      const y = h - 3 - ((p.value - min) / span) * (h - 6);
      return x.toFixed(1) + "," + y.toFixed(1);
    });
    const line = document.createElementNS(NS, "polyline");
    line.setAttribute("points", coords.join(" "));
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", "2");
    line.setAttribute("stroke-linejoin", "round");
    line.setAttribute("stroke-linecap", "round");
    svg.appendChild(line);
    const last = coords[coords.length - 1].split(",");
    const dot = document.createElementNS(NS, "circle");
    dot.setAttribute("cx", last[0]);
    dot.setAttribute("cy", last[1]);
    dot.setAttribute("r", "2.5");
    dot.setAttribute("fill", "currentColor");
    svg.appendChild(dot);
    return svg;
  }

  function competitorCard(handle) {
    const card = el("div", "card mkt-competitor");
    const row = el("div", "list-item-row");
    row.appendChild(el("h2", "card-title", "@" + handle));
    const remove = el("button", "btn-icon danger", "Remove");
    remove.type = "button";
    remove.setAttribute("aria-label", "Remove @" + handle + " from watchlist");
    remove.addEventListener("click", function () { removeWatch(handle); });
    row.appendChild(remove);
    card.appendChild(row);

    const snap = state.snapshots.find(function (s) { return s.id === handle || s.handle === handle; });
    if (!snap || !snap.latest) {
      card.appendChild(el("p", "field-hint", "No snapshot yet. It will be captured on the next research run."));
      return card;
    }
    const history = Array.isArray(snap.history) ? snap.history.slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); }) : [];
    const prev = history.length > 1 ? history[history.length - 2] : null;
    card.appendChild(el("p", "field-hint", "Latest snapshot " + snap.latest.date + (prev ? " · compared with " + prev.date : " · first snapshot") + " · source: InsightSocial profile"));

    const metrics = snap.latest.metrics || {};
    const names = Object.keys(metrics);
    if (!names.length) {
      card.appendChild(el("p", "field-hint", "InsightSocial didn't return any numeric fields for this account."));
      return card;
    }
    const sparkMetric = names.indexOf("followers") !== -1 ? "followers" : names[0];
    const sparkPoints = history.filter(function (h) { return h.metrics && typeof h.metrics[sparkMetric] === "number"; })
      .map(function (h) { return { date: h.date, value: h.metrics[sparkMetric] }; });
    if (sparkPoints.length >= 2) {
      const sp = el("div", "mkt-spark-wrap");
      sp.appendChild(sparkline(sparkPoints, "@" + handle + " " + sparkMetric + " over time"));
      sp.appendChild(el("span", "field-hint", sparkMetric + ", " + sparkPoints.length + " snapshots"));
      card.appendChild(sp);
    }
    const table = el("table", "mkt-metrics");
    const thead = el("thead");
    const hr = el("tr");
    ["Field (as named by InsightSocial)", "Value", "Change"].forEach(function (t) { hr.appendChild(el("th", "", t)); });
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el("tbody");
    names.forEach(function (name) {
      const tr = el("tr");
      tr.appendChild(el("td", "", name));
      tr.appendChild(el("td", "", formatNumber(metrics[name])));
      let change = "—";
      let cls = "";
      if (prev && prev.metrics && typeof prev.metrics[name] === "number") {
        const d = metrics[name] - prev.metrics[name];
        change = d === 0 ? "no change" : (d > 0 ? "+" : "") + d.toLocaleString();
        cls = d > 0 ? "text-positive" : d < 0 ? "text-negative" : "";
      }
      tr.appendChild(el("td", cls, change));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    const scroll = el("div", "mkt-table-scroll");
    scroll.appendChild(table);
    card.appendChild(scroll);
    return card;
  }

  function renderCompetitors() {
    const box = $("mktCompetitorList");
    if (!box) return;
    if (!signedIn()) { emptyState(box, "Sign in to manage your competitor watchlist."); return; }
    if (state.loading && !state.loaded) { skeleton(box, 3); return; }
    if (state.dataError) { errorLine(box, state.dataError); return; }
    const list = (state.settings || DEFAULT_SETTINGS).watchlist;
    if (!list.length) { emptyState(box, "No competitors yet. Add an Instagram handle above to start tracking it."); return; }
    box.textContent = "";
    list.forEach(function (h) { box.appendChild(competitorCard(h)); });
  }

  function handleWatchAdd(e) {
    e.preventDefault();
    const status = $("mktWatchStatus");
    const handle = normalizeHandle($("mktWatchHandle").value);
    if (!signedIn()) { status.textContent = "Sign in to JARVIS first."; return; }
    if (!HANDLE_RE.test(handle)) { status.textContent = "Enter a valid Instagram handle (letters, numbers, dots, underscores; up to 30)."; return; }
    const current = (state.settings || DEFAULT_SETTINGS).watchlist;
    if (current.indexOf(handle) !== -1) { status.textContent = "@" + handle + " is already on your watchlist."; return; }
    if (current.length >= MAX_WATCHLIST) { status.textContent = "The watchlist holds up to " + MAX_WATCHLIST + " accounts. Remove one first."; return; }
    $("mktWatchAddBtn").disabled = true;
    saveSettings({ watchlist: current.concat([handle]) }).then(function () {
      $("mktWatchHandle").value = "";
      status.textContent = "Added @" + handle + ". It will be researched on the next run.";
      renderCompetitors();
    }).catch(function (err) {
      status.textContent = describeDataError(err);
    }).then(function () { $("mktWatchAddBtn").disabled = false; });
  }

  function removeWatch(handle) {
    if (!window.confirm("Stop tracking @" + handle + "? Saved snapshots are kept.")) return;
    const current = (state.settings || DEFAULT_SETTINGS).watchlist;
    saveSettings({ watchlist: current.filter(function (h) { return h !== handle; }) }).then(function () {
      $("mktWatchStatus").textContent = "Removed @" + handle + ".";
      renderCompetitors();
    }).catch(function (err) { $("mktWatchStatus").textContent = describeDataError(err); });
  }

  /* ---------------- research notes ---------------- */

  function findingItem(f) {
    const li = el("li", "list-item");
    const row = el("div", "list-item-row");
    row.appendChild(el("span", "list-item-title", f.text));
    const del = el("button", "btn-icon danger", "Delete");
    del.type = "button";
    del.setAttribute("aria-label", "Delete note");
    del.addEventListener("click", function () { deleteFinding(f); });
    row.appendChild(del);
    li.appendChild(row);
    const meta = (f.source ? "Source: " + f.source : "No source") + (f.createdAt ? " · " + core().formatDate(f.createdAt) : "");
    li.appendChild(el("p", "field-hint", meta));
    return li;
  }

  function renderFindings() {
    const v = $("mktFindingsVerified");
    const h = $("mktFindingsHypotheses");
    if (!v) return;
    v.textContent = "";
    h.textContent = "";
    if (!signedIn()) { v.appendChild(el("li", "empty-state", "Sign in to keep research notes.")); return; }
    if (state.loading && !state.loaded) { skeleton(v, 2); return; }
    if (state.dataError) { errorLine(v, state.dataError); return; }
    const sorted = state.findings.slice().sort(function (a, b) { return String(b.createdAt || "").localeCompare(String(a.createdAt || "")); });
    const verified = sorted.filter(function (f) { return f.kind === "verified"; });
    const hyp = sorted.filter(function (f) { return f.kind !== "verified"; });
    if (!verified.length) v.appendChild(el("li", "empty-state", "No verified findings yet."));
    verified.forEach(function (f) { v.appendChild(findingItem(f)); });
    if (!hyp.length) h.appendChild(el("li", "empty-state", "No hypotheses yet."));
    hyp.forEach(function (f) { h.appendChild(findingItem(f)); });
  }

  function handleFindingAdd(e) {
    e.preventDefault();
    const status = $("mktFindingStatus");
    const text = $("mktFindingText").value.trim();
    const kind = $("mktFindingKind").value === "verified" ? "verified" : "hypothesis";
    const source = $("mktFindingSource").value.trim();
    if (!signedIn()) { status.textContent = "Sign in to JARVIS first."; return; }
    if (!text) { status.textContent = "Write the finding first."; return; }
    if (kind === "verified" && !source) { status.textContent = "A verified finding needs a source. Add one, or save it as a hypothesis."; return; }
    const f = { id: core().uid(), text: text.slice(0, 400), kind: kind, source: source.slice(0, 200), createdAt: new Date().toISOString() };
    $("mktFindingAddBtn").disabled = true;
    const doc = { text: f.text, kind: f.kind, source: f.source, createdAt: f.createdAt };
    data().set("marketingFindings/" + f.id, doc).then(function () {
      state.findings.push(f);
      $("mktFindingForm").reset();
      status.textContent = "Saved.";
      renderFindings();
    }).catch(function (err) { status.textContent = describeDataError(err); })
      .then(function () { $("mktFindingAddBtn").disabled = false; });
  }

  function deleteFinding(f) {
    if (!window.confirm("Delete this research note?")) return;
    data().remove("marketingFindings/" + f.id).then(function () {
      state.findings = state.findings.filter(function (x) { return x.id !== f.id; });
      renderFindings();
    }).catch(function (err) { core().showToast(describeDataError(err)); });
  }

  /* ---------------- AI ideas ---------------- */

  function renderPillarOptions() {
    const pillars = (state.settings || DEFAULT_SETTINGS).contentPillars;
    [["mktIdeaPillar", "Any pillar"], ["mktLibPillar", "All pillars"]].forEach(function (pair) {
      const sel = $(pair[0]);
      if (!sel) return;
      const keep = sel.value;
      sel.textContent = "";
      const any = el("option", "", pair[1]);
      any.value = "";
      sel.appendChild(any);
      const all = pillars.slice();
      if (pair[0] === "mktLibPillar") {
        state.ideas.forEach(function (i) { if (i.contentPillar && all.indexOf(i.contentPillar) === -1) all.push(i.contentPillar); });
      }
      all.forEach(function (p) { const o = el("option", "", p); o.value = p; sel.appendChild(o); });
      sel.value = all.indexOf(keep) !== -1 ? keep : "";
    });
    const dl = $("mktPillarOptions");
    if (dl) {
      dl.textContent = "";
      pillars.forEach(function (p) { const o = el("option"); o.value = p; dl.appendChild(o); });
    }
  }

  function renderIdeaCostHint() {
    const hint = $("mktIdeaCostHint");
    const btn = $("mktIdeaGenerateBtn");
    if (!hint) return;
    hint.classList.remove("text-negative");
    if (!signedIn()) { hint.textContent = "Sign in to generate ideas."; btn.disabled = true; return; }
    const s = state.status;
    if (!s) { hint.textContent = state.statusError || "Checking your AI budget…"; btn.disabled = !!state.statusError; return; }
    if (!s.aiKeyConfigured) {
      hint.textContent = "The Claude API key isn't set on your server yet, so ideas can't be generated. See functions/README.md, step 3.";
      hint.classList.add("text-negative");
      btn.disabled = true;
      return;
    }
    const worst = ideaWorstCaseUsd();
    const used = (s.usage || {}).aiCostUsd || 0;
    const left = Math.max(0, s.aiAllowanceUsd - used);
    if (worst !== null && worst > left) {
      hint.textContent = "Blocked to protect your budget: " + money(left) + " of AI budget left this month, and one generation with " + (MODEL_LABELS[s.aiModel] || s.aiModel) + " can cost up to " + money(worst) + ". Switch to a cheaper model or raise the budget in Settings.";
      hint.classList.add("text-negative");
      btn.disabled = true;
      return;
    }
    hint.textContent = "Uses " + (MODEL_LABELS[s.aiModel] || s.aiModel) + ". Estimated cost: up to " + money(worst) + " per generation, usually less. " + money(left) + " of AI budget left this month. No InsightSocial credits are used.";
    btn.disabled = false;
  }

  function readBrief() {
    return {
      platform: $("mktIdeaPlatform").value,
      awarenessStage: $("mktIdeaStage").value,
      contentPillar: $("mktIdeaPillar").value,
      count: Number($("mktIdeaCount").value) || 3,
      goal: $("mktIdeaGoal").value.trim()
    };
  }

  function generate(brief) {
    if (!signedIn()) { core().showToast("Sign in to JARVIS first."); return; }
    const status = $("mktIdeaStatus");
    const btn = $("mktIdeaGenerateBtn");
    const results = $("mktIdeaResults");
    btn.disabled = true;
    $("mktIdeaRegenerateBtn").disabled = true;
    status.textContent = "Writing ideas… this can take up to a minute or two.";
    skeleton(results, 4);
    state.lastBrief = brief;
    cloud().call("generateIdeas", brief, { timeout: 240000 }).then(function (res) {
      if (!res || !res.ok) {
        status.textContent = ((res && res.error) || "Claude didn't return ideas.") + (res && typeof res.costUsd === "number" ? " Estimated cost: " + money(res.costUsd) + "." : "");
        results.textContent = "";
        return;
      }
      state.generated = res.ideas.map(function (i) { return Object.assign({}, i, { model: res.model, generatedAt: res.generatedAt }); });
      const r = res.researchUsed || {};
      status.textContent = res.ideas.length + " idea(s) from " + (MODEL_LABELS[res.model] || res.model) + " · estimated cost " + money(res.costUsd) +
        " · research used: " + (r.snapshots || 0) + " competitor snapshot(s), " + (r.findings || 0) + " note(s)." +
        (!r.snapshots && !r.findings ? " With no research saved, every supporting point is a hypothesis." : "");
      renderGenerated();
    }).catch(function (err) {
      status.textContent = describeCallError(err);
      results.textContent = "";
    }).then(function () {
      $("mktIdeaRegenerateBtn").disabled = false;
      refreshStatus();
    });
  }

  function textBlock(label, text) {
    const wrap = el("div", "mkt-idea-block");
    wrap.appendChild(el("h3", "mkt-idea-label", label));
    wrap.appendChild(el("p", "mkt-idea-text", text || "—"));
    return wrap;
  }

  function ideaBody(idea) {
    const frag = document.createDocumentFragment();
    frag.appendChild(textBlock("Objective", idea.objective));
    frag.appendChild(textBlock("Target audience", idea.targetAudience));
    frag.appendChild(textBlock("Hook", idea.hook));
    frag.appendChild(textBlock("Script", idea.script));
    const shots = el("div", "mkt-idea-block");
    shots.appendChild(el("h3", "mkt-idea-label", "Shots & visual direction"));
    const ol = el("ol", "mkt-idea-shots");
    (idea.shots || []).forEach(function (s) { ol.appendChild(el("li", "", s)); });
    if (!(idea.shots || []).length) ol.appendChild(el("li", "", "—"));
    shots.appendChild(ol);
    frag.appendChild(shots);
    frag.appendChild(textBlock("Caption", idea.caption));
    frag.appendChild(textBlock("Call to action", idea.cta));
    if ((idea.researchBasis || []).length) {
      const rb = el("div", "mkt-idea-block");
      rb.appendChild(el("h3", "mkt-idea-label", "Supporting research"));
      const ul = el("ul", "mkt-research-basis");
      idea.researchBasis.forEach(function (b) {
        const li = el("li");
        li.appendChild(el("span", "badge " + (b.kind === "verified" ? "badge-green" : "badge-yellow"), b.kind === "verified" ? "Verified" : "Hypothesis"));
        li.appendChild(document.createTextNode(" " + b.point + (b.source ? " — " + b.source : "")));
        ul.appendChild(li);
      });
      rb.appendChild(ul);
      frag.appendChild(rb);
    }
    frag.appendChild(textBlock("Why it might work", idea.whyItMightWork));
    if (idea.notes) frag.appendChild(textBlock("Your notes", idea.notes));
    return frag;
  }

  function ideaBadges(idea, withStatus) {
    const b = el("div", "mkt-badges");
    b.appendChild(el("span", "badge badge-accent", PLATFORM_LABELS[idea.platform] || "Instagram + TikTok"));
    if (idea.contentPillar) b.appendChild(el("span", "badge badge-neutral", idea.contentPillar));
    b.appendChild(el("span", "badge badge-neutral", stageLabel(idea.awarenessStage)));
    if (withStatus) {
      b.appendChild(el("span", "badge " + (idea.status === "posted" ? "badge-green" : idea.status === "ready" || idea.status === "filmed" ? "badge-accent" : "badge-neutral"), statusLabel(idea.status)));
      if (idea.priority) b.appendChild(el("span", "badge " + (idea.priority === "high" ? "badge-yellow" : "badge-neutral"), idea.priority.charAt(0).toUpperCase() + idea.priority.slice(1) + " priority"));
      if (idea.plannedDate) b.appendChild(el("span", "badge badge-neutral", "Planned " + formatDay(idea.plannedDate)));
    }
    return b;
  }

  function renderGenerated() {
    const box = $("mktIdeaResults");
    box.textContent = "";
    $("mktIdeaResultActions").classList.toggle("hidden", !state.generated.length);
    state.generated.forEach(function (idea, index) {
      const card = el("article", "card mkt-idea-card");
      card.appendChild(el("h2", "card-title", idea.title));
      card.appendChild(ideaBadges(idea, false));
      card.appendChild(ideaBody(idea));
      const actions = el("div", "form-actions");
      const save = el("button", "btn btn-primary", idea.savedId ? "Saved ✓" : "Save to Library");
      save.type = "button";
      save.disabled = !!idea.savedId;
      save.addEventListener("click", function () { saveGenerated(index); });
      const edit = el("button", "btn btn-secondary", "Edit before saving");
      edit.type = "button";
      edit.disabled = !!idea.savedId;
      edit.addEventListener("click", function () { openEditor(null, index); });
      actions.appendChild(save);
      actions.appendChild(edit);
      card.appendChild(actions);
      box.appendChild(card);
    });
  }

  function libraryRecord(idea, extra) {
    const now = new Date().toISOString();
    return Object.assign({
      title: idea.title || "Untitled idea",
      platform: idea.platform || "both",
      objective: idea.objective || "",
      targetAudience: idea.targetAudience || "",
      awarenessStage: idea.awarenessStage || "unaware",
      contentPillar: idea.contentPillar || "",
      hook: idea.hook || "",
      script: idea.script || "",
      shots: Array.isArray(idea.shots) ? idea.shots : [],
      caption: idea.caption || "",
      cta: idea.cta || "",
      researchBasis: Array.isArray(idea.researchBasis) ? idea.researchBasis : [],
      whyItMightWork: idea.whyItMightWork || "",
      notes: idea.notes || "",
      status: idea.status || "draft",
      priority: idea.priority || "medium",
      favorite: !!idea.favorite,
      plannedDate: idea.plannedDate || "",
      source: idea.model ? "ai" : (idea.source || "manual"),
      model: idea.model || "",
      createdAt: idea.createdAt || now,
      updatedAt: now
    }, extra || {});
  }

  function persistIdea(id, record) {
    return data().set("marketingIdeas/" + id, record).then(function () {
      const withId = Object.assign({ id: id }, record);
      const i = state.ideas.findIndex(function (x) { return x.id === id; });
      if (i === -1) state.ideas.push(withId); else state.ideas[i] = withId;
      return withId;
    });
  }

  function saveGenerated(index) {
    const idea = state.generated[index];
    if (!idea || idea.savedId) return Promise.resolve();
    const id = core().uid();
    return persistIdea(id, libraryRecord(idea)).then(function () {
      idea.savedId = id;
      renderGenerated();
      renderPillarOptions();
      renderLibrary();
      core().showToast("Saved to Library.");
    }).catch(function (err) { core().showToast(describeDataError(err)); });
  }

  function saveAllGenerated() {
    let chain = Promise.resolve();
    state.generated.forEach(function (_, i) { chain = chain.then(function () { return saveGenerated(i); }); });
    return chain;
  }

  function regenerate() {
    const brief = Object.assign({}, state.lastBrief || readBrief());
    brief.avoidTitles = state.generated.map(function (i) { return i.title; })
      .concat(state.ideas.map(function (i) { return i.title; })).slice(0, 20);
    generate(brief);
  }

  /* ---------------- library ---------------- */

  function filteredIdeas() {
    const q = ($("mktLibSearch").value || "").trim().toLowerCase();
    const f = {
      platform: $("mktLibPlatform").value,
      status: $("mktLibStatus").value,
      pillar: $("mktLibPillar").value,
      stage: $("mktLibStage").value,
      priority: $("mktLibPriority").value,
      fav: $("mktLibFavOnly").checked
    };
    const sort = $("mktLibSort").value;
    const list = state.ideas.filter(function (i) {
      if (f.platform && i.platform !== f.platform) return false;
      if (f.status && (i.status || "draft") !== f.status) return false;
      if (f.pillar && i.contentPillar !== f.pillar) return false;
      if (f.stage && i.awarenessStage !== f.stage) return false;
      if (f.priority && (i.priority || "medium") !== f.priority) return false;
      if (f.fav && !i.favorite) return false;
      if (q) {
        const hay = [i.title, i.hook, i.script, i.caption, i.cta, i.objective, i.notes, i.contentPillar].join(" ").toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    list.sort(function (a, b) {
      if (sort === "oldest") return String(a.createdAt).localeCompare(String(b.createdAt));
      if (sort === "priority") return (PRIORITY_RANK[a.priority] || 1) - (PRIORITY_RANK[b.priority] || 1) || String(b.createdAt).localeCompare(String(a.createdAt));
      if (sort === "planned") {
        if (!a.plannedDate !== !b.plannedDate) return a.plannedDate ? -1 : 1;
        return String(a.plannedDate).localeCompare(String(b.plannedDate));
      }
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
    return list;
  }

  function libraryCard(idea) {
    const card = el("article", "card mkt-idea-card");
    const head = el("div", "list-item-row");
    head.appendChild(el("h2", "card-title", idea.title));
    const fav = el("button", "btn-icon mkt-fav" + (idea.favorite ? " active" : ""), idea.favorite ? "★" : "☆");
    fav.type = "button";
    fav.setAttribute("aria-pressed", idea.favorite ? "true" : "false");
    fav.setAttribute("aria-label", idea.favorite ? "Remove from favorites" : "Add to favorites");
    fav.addEventListener("click", function () { updateIdea(idea.id, { favorite: !idea.favorite }); });
    head.appendChild(fav);
    card.appendChild(head);
    card.appendChild(ideaBadges(idea, true));
    card.appendChild(el("p", "mkt-idea-hook", idea.hook));

    const details = el("details", "mkt-details");
    details.appendChild(el("summary", "", "Full idea"));
    details.appendChild(ideaBody(idea));
    details.appendChild(el("p", "field-hint", (idea.source === "ai" ? "Generated by " + (MODEL_LABELS[idea.model] || idea.model || "Claude") : "Added manually") + " · saved " + core().formatDateTime(idea.createdAt)));
    card.appendChild(details);

    const actions = el("div", "mkt-lib-actions");
    const statusSel = el("select");
    statusSel.setAttribute("aria-label", "Status for " + idea.title);
    STATUSES.forEach(function (s) { const o = el("option", "", s.label); o.value = s.value; statusSel.appendChild(o); });
    statusSel.value = idea.status || "draft";
    statusSel.addEventListener("change", function () { updateIdea(idea.id, { status: statusSel.value }); });
    actions.appendChild(statusSel);
    const edit = el("button", "btn btn-secondary", "Edit");
    edit.type = "button";
    edit.addEventListener("click", function () { openEditor(idea.id, -1); });
    actions.appendChild(edit);
    const del = el("button", "btn-icon danger", "Delete");
    del.type = "button";
    del.setAttribute("aria-label", "Delete " + idea.title);
    del.addEventListener("click", function () { deleteIdea(idea); });
    actions.appendChild(del);
    card.appendChild(actions);
    return card;
  }

  function renderLibrary() {
    const box = $("mktLibList");
    const count = $("mktLibCount");
    if (!box) return;
    if (!signedIn()) { count.textContent = ""; emptyState(box, "Sign in to see your content idea library."); return; }
    if (state.loading && !state.loaded) { count.textContent = ""; skeleton(box, 4); return; }
    if (state.dataError) { count.textContent = ""; errorLine(box, state.dataError); return; }
    if (!state.ideas.length) { count.textContent = ""; emptyState(box, "No saved ideas yet. Generate some in AI Ideas, or tap New idea to add your own."); return; }
    const list = filteredIdeas();
    count.textContent = list.length === state.ideas.length ? state.ideas.length + " idea(s)" : list.length + " of " + state.ideas.length + " idea(s) match";
    box.textContent = "";
    if (!list.length) { emptyState(box, "No ideas match these filters."); return; }
    list.forEach(function (i) { box.appendChild(libraryCard(i)); });
  }

  function updateIdea(id, patch) {
    const idea = state.ideas.find(function (x) { return x.id === id; });
    if (!idea) return Promise.resolve();
    const record = Object.assign({}, idea, patch, { updatedAt: new Date().toISOString() });
    delete record.id;
    return persistIdea(id, record).then(function () { renderLibrary(); })
      .catch(function (err) { core().showToast(describeDataError(err)); renderLibrary(); });
  }

  function deleteIdea(idea) {
    if (!window.confirm('Delete "' + idea.title + '"? This can\'t be undone.')) return;
    data().remove("marketingIdeas/" + idea.id).then(function () {
      state.ideas = state.ideas.filter(function (x) { return x.id !== idea.id; });
      renderLibrary();
    }).catch(function (err) { core().showToast(describeDataError(err)); });
  }

  /* ---------------- idea editor ---------------- */

  const EDIT_FIELDS = [
    ["mktEdTitle", "title"], ["mktEdStatus", "status"], ["mktEdPriority", "priority"], ["mktEdPlatform", "platform"],
    ["mktEdStage", "awarenessStage"], ["mktEdPillar", "contentPillar"], ["mktEdDate", "plannedDate"],
    ["mktEdObjective", "objective"], ["mktEdAudience", "targetAudience"], ["mktEdHook", "hook"], ["mktEdScript", "script"],
    ["mktEdCaption", "caption"], ["mktEdCta", "cta"], ["mktEdWhy", "whyItMightWork"], ["mktEdNotes", "notes"]
  ];

  function openEditor(id, draftIndex) {
    if (!signedIn()) { core().showToast("Sign in to JARVIS first."); return; }
    state.editingId = id;
    state.editingDraftIndex = draftIndex;
    const idea = id ? state.ideas.find(function (x) { return x.id === id; }) : draftIndex >= 0 ? state.generated[draftIndex] : null;
    const src = libraryRecord(idea || { source: "manual" });
    if (!idea) src.title = "";
    EDIT_FIELDS.forEach(function (pair) { $(pair[0]).value = src[pair[1]] || ""; });
    $("mktEdShots").value = (src.shots || []).join("\n");
    $("mktIdeaModalTitle").textContent = id ? "Edit Idea" : draftIndex >= 0 ? "Edit Before Saving" : "New Idea";
    core().openModal("mktIdeaModal");
    $("mktEdTitle").focus();
  }

  function closeEditor() {
    core().closeModal("mktIdeaModal");
    state.editingId = null;
    state.editingDraftIndex = -1;
  }

  function handleEditorSave(e) {
    e.preventDefault();
    const values = {};
    EDIT_FIELDS.forEach(function (pair) { values[pair[1]] = $(pair[0]).value.trim(); });
    values.shots = $("mktEdShots").value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 20);
    if (!values.title) { core().showToast("Give the idea a title."); return; }
    const btn = $("mktEdSaveBtn");
    btn.disabled = true;
    let p;
    if (state.editingId) {
      const idea = state.ideas.find(function (x) { return x.id === state.editingId; });
      const record = Object.assign({}, idea, values, { updatedAt: new Date().toISOString() });
      delete record.id;
      p = persistIdea(state.editingId, record);
    } else if (state.editingDraftIndex >= 0) {
      const draft = state.generated[state.editingDraftIndex];
      const idx = state.editingDraftIndex;
      const id = core().uid();
      p = persistIdea(id, libraryRecord(Object.assign({}, draft, values))).then(function () {
        state.generated[idx].savedId = id;
        renderGenerated();
      });
    } else {
      p = persistIdea(core().uid(), libraryRecord(Object.assign({ source: "manual" }, values)));
    }
    p.then(function () {
      closeEditor();
      renderPillarOptions();
      renderLibrary();
      core().showToast("Saved to Library.");
    }).catch(function (err) { core().showToast(describeDataError(err)); })
      .then(function () { btn.disabled = false; });
  }

  /* ---------------- settings ---------------- */

  function renderSettingsForm() {
    const form = $("mktSettingsForm");
    if (!form) return;
    const s = state.settings || DEFAULT_SETTINGS;
    $("mktSetBudget").value = s.monthlyBudgetUsd;
    $("mktSetPlan").value = s.insightPlanMonthlyUsd;
    $("mktSetCredits").value = s.monthlyCreditCap;
    $("mktSetModel").value = s.aiModel;
    $("mktSetBrand").value = s.brandProfile;
    $("mktSetPillars").value = s.contentPillars.join("\n");
    renderModelHint();
    const status = $("mktSettingsStatus");
    if (!signedIn()) status.textContent = "Sign in to change Marketing settings.";
    else if (state.dataError) status.textContent = state.dataError;
    else if (status.textContent.indexOf("Sign in") === 0) status.textContent = "";
  }

  function renderModelHint() {
    const hint = $("mktSetModelHint");
    if (!hint) return;
    const worst = ideaWorstCaseUsd($("mktSetModel").value);
    hint.textContent = worst === null
      ? "Prices per model come from your server once it's connected."
      : "Worst case per generation with this model: about " + money(worst) + ". Opus and Sonnet automatically fall back to another model if the first is overloaded.";
  }

  function handleSettingsSave(e) {
    e.preventDefault();
    const status = $("mktSettingsStatus");
    if (!signedIn()) { status.textContent = "Sign in to JARVIS first."; return; }
    const budget = Number($("mktSetBudget").value);
    const plan = Number($("mktSetPlan").value);
    if (!isFinite(budget) || budget < 0) { status.textContent = "Enter a monthly budget of $0 or more."; return; }
    if (!isFinite(plan) || plan < 0) { status.textContent = "Enter the InsightSocial plan price (0 if you don't know it yet)."; return; }
    if (plan > budget) { status.textContent = "Note: the InsightSocial plan alone is over your budget, so AI ideas will be blocked."; }
    const patch = {
      monthlyBudgetUsd: budget,
      insightPlanMonthlyUsd: plan,
      monthlyCreditCap: Number($("mktSetCredits").value),
      aiModel: $("mktSetModel").value,
      brandProfile: $("mktSetBrand").value.trim(),
      contentPillars: $("mktSetPillars").value.split("\n").map(function (p) { return p.trim(); }).filter(Boolean)
    };
    const btn = $("mktSettingsSaveBtn");
    btn.disabled = true;
    saveSettings(patch).then(function () {
      const warn = plan > budget ? " The InsightSocial plan is over your total budget, so AI ideas are blocked." : "";
      status.textContent = "Saved." + warn;
      renderSettingsForm();
      status.textContent = "Saved." + warn;
      renderPillarOptions();
      renderCompetitors();
      return refreshStatus();
    }).catch(function (err) { status.textContent = describeDataError(err); })
      .then(function () { btn.disabled = false; });
  }

  /* ---------------- init ---------------- */

  function fillStaticSelects() {
    const libStatus = $("mktLibStatus");
    const edStatus = $("mktEdStatus");
    STATUSES.forEach(function (s) {
      const a = el("option", "", s.label); a.value = s.value; libStatus.appendChild(a);
      const b = el("option", "", s.label); b.value = s.value; edStatus.appendChild(b);
    });
    const libStage = $("mktLibStage");
    const edStage = $("mktEdStage");
    STAGES.forEach(function (s) {
      const a = el("option", "", s.label); a.value = s.value; libStage.appendChild(a);
      const b = el("option", "", s.label); b.value = s.value; edStage.appendChild(b);
    });
  }

  function init() {
    if (!$("ciLookupForm")) return;
    fillStaticSelects();
    $("ciLookupForm").addEventListener("submit", handleLookup);
    $("ciRefreshBtn").addEventListener("click", function () { if (state.lastHandle) runLookup(state.lastHandle, true); });
    $("ciStatusRefreshBtn").addEventListener("click", function () { loadAll(); });
    $("mktRunResearchBtn").addEventListener("click", runResearchNow);
    $("mktWatchForm").addEventListener("submit", handleWatchAdd);
    $("mktFindingForm").addEventListener("submit", handleFindingAdd);
    $("mktIdeaForm").addEventListener("submit", function (e) { e.preventDefault(); generate(readBrief()); });
    $("mktIdeaRegenerateBtn").addEventListener("click", regenerate);
    $("mktIdeaSaveAllBtn").addEventListener("click", saveAllGenerated);
    $("mktLibNewBtn").addEventListener("click", function () { openEditor(null, -1); });
    ["mktLibPlatform", "mktLibStatus", "mktLibPillar", "mktLibStage", "mktLibPriority", "mktLibSort", "mktLibFavOnly"].forEach(function (id) {
      $(id).addEventListener("change", renderLibrary);
    });
    $("mktLibSearch").addEventListener("input", renderLibrary);
    $("mktIdeaEditForm").addEventListener("submit", handleEditorSave);
    $("mktIdeaModalCloseBtn").addEventListener("click", closeEditor);
    $("mktEdCancelBtn").addEventListener("click", closeEditor);
    $("mktSettingsForm").addEventListener("submit", handleSettingsSave);
    $("mktSetModel").addEventListener("change", renderModelHint);

    // Load when Marketing is opened (sign-in can finish after start-up).
    const nav = $("navBtnMarketing");
    if (nav) nav.addEventListener("click", function () { if (!state.loading && (!state.loaded || !state.status)) loadAll(); });

    const removed = removeLegacyBrowserKey();
    state.notice = removed ? "The InsightSocial key previously saved in this browser was deleted; your server holds the only copy now." : "";
    loadAll();
  }

  window.JarvisContentIntel = { init: init };
})();
