/* ==========================================================================
   JARVIS — Marketing (Content Intelligence)

   Works with no extra setup:
   - All Marketing data (settings, competitor watchlist and the numbers you
     log, research notes, the idea library, AI spend) lives in one
     localStorage key, jarvisMarketing, which auth.js syncs into the
     account's existing users/{uid} document like every other JARVIS tab.
   - Paid requests (Claude ideas, InsightSocial lookups, automatic daily
     research) only ever run on the optional Marketing server (Firebase
     Cloud Functions), which holds the API keys as server secrets. Until it
     is deployed those features say so, and competitor numbers can be
     logged by hand.

   The prompt, schema and prices come from functions/lib/idea-spec.js,
   shared with the server so both paths ask for the same thing.
   ========================================================================== */

(function () {
  "use strict";

  const LEGACY_KEY_STORAGE = "jarvisInsightSocialKey";
  const HANDLE_RE = /^[a-z0-9._]{1,30}$/;
  const MAX_WATCHLIST = 10;
  // Mirrors functions/lib/settings.js; the server re-checks everything.
  const DEFAULT_SETTINGS = {
    monthlyCreditCap: 1500,
    // Most one "Research My Niche" run may spend (a full default run is 220).
    researchRunCreditCap: 250,
    monthlyBudgetUsd: 20,
    // The owner's InsightSocial plan, $10/month as they reported it.
    insightPlanMonthlyUsd: 10,
    aiModel: "claude-sonnet-5-5",
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

  // All Marketing data, synced through the JARVIS account (see header).
  // users/{uid} has a 1 MB limit shared with every JARVIS tab, so Marketing
  // stays under this many characters of JSON.
  const STORE_KEY = "jarvisMarketing";
  const STORE_LIMIT_CHARS = 350000;

  const state = {
    store: null,
    checkingServer: false,
    serverCheckedOnce: false,
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

  // Firestore may not allow the browser to write the server's copy of your
  // settings, so they travel with each server call instead; the server checks
  // it's you, clamps them and keeps its own copy (used by the daily run and
  // the credit caps). Only settings you've actually saved are sent, so a new
  // device that hasn't synced yet can't overwrite them with defaults.
  function serverPayload(extra) {
    const out = Object.assign({}, extra);
    if (state.store && state.store.settings) out.settings = sanitizeSettings(state.store.settings);
    return out;
  }
  function spec() { return window.JarvisIdeaSpec || null; }
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
    if (code === "functions/not-found") return "The Marketing server isn't deployed yet. See \"How to fix setup problems\" under Server Health.";
    if (code === "functions/internal") {
      const ref = err.details && err.details.ref;
      if (ref) return "The Marketing server hit an unexpected error (reference " + ref + "). Find that reference in Firebase console → Functions → Logs.";
      // The Firebase SDK reports a bare "internal" when no usable response
      // came back at all — most often because the function isn't deployed
      // (the 404 lacks CORS headers, so the browser blocks it).
      return "Couldn't get a response from the Marketing server. Usually its functions aren't deployed yet or the last deploy failed. See \"How to fix setup problems\" under Server Health.";
    }
    if (code === "functions/failed-precondition" || code === "functions/resource-exhausted" || code === "functions/invalid-argument") return message;
    if (code === "functions/unavailable" && /Claude/.test(message)) return message;
    if (code === "functions/unavailable" || code === "functions/deadline-exceeded") return "Couldn't reach the Marketing server. Check your connection and try again.";
    return "Something went wrong talking to the Marketing server" + (message ? ": " + message : ".");
  }

  // Firestore errors when reading/writing your private marketing documents.
  function describeDataError(err) {
    const code = (err && err.code) || "";
    if (code === "store-full") return "Marketing storage is full (it shares your account's sync space with the rest of JARVIS). Delete some old ideas or notes, then try again.";
    if (code === "functions/unauthenticated") return "Sign in to JARVIS to use Marketing.";
    if (code === "permission-denied") return "Firestore blocked this: the Marketing rules haven't been published to your Firebase project yet. Overview → Server Health → \"How to fix setup problems\" shows the 2-minute fix.";
    if (code === "unavailable") return "Couldn't reach your cloud storage. Check your connection and try again.";
    if (code === "deadline-exceeded") return "Loading your marketing data took too long. Check your connection and try again.";
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
      researchRunCreditCap: Math.round(clampNumber(r.researchRunCreditCap, 0, 5000, DEFAULT_SETTINGS.researchRunCreditCap)),
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
    return commit(function (st) { st.settings = next; }).then(function () {
      mirrorSettingsToServer();
      return next;
    });
  }

  /* ---------------- local store ---------------- */

  function normalizeStore(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const byId = function (list) {
      return (Array.isArray(list) ? list : []).filter(function (x) { return x && typeof x === "object" && typeof x.id === "string"; });
    };
    return {
      version: 1,
      settings: r.settings && typeof r.settings === "object" ? r.settings : null,
      ideas: byId(r.ideas),
      findings: byId(r.findings),
      snapshots: r.snapshots && typeof r.snapshots === "object" ? r.snapshots : {},
      niche: r.niche && typeof r.niche === "object" ? r.niche : null,
      finds: byId(r.finds),
      importedCloud: !!r.importedCloud
    };
  }

  function loadStore() {
    state.store = normalizeStore(core().loadJSON(STORE_KEY, null));
    syncStateFromStore();
  }

  function syncStateFromStore() {
    state.settings = sanitizeSettings(state.store.settings);
    state.ideas = state.store.ideas;
    state.findings = state.store.findings;
  }

  function storeChars(st) { return JSON.stringify(st || state.store).length; }

  // Applies a change to a copy of the store and saves it (which also syncs
  // it to the account). Refuses changes that would grow the store past its
  // limit.
  function commit(mutate) {
    return new Promise(function (resolve, reject) {
      const next = normalizeStore(JSON.parse(JSON.stringify(state.store)));
      const result = mutate(next);
      const size = storeChars(next);
      if (size > STORE_LIMIT_CHARS && size > storeChars(state.store)) {
        reject(Object.assign(new Error("Marketing storage is full"), { code: "store-full" }));
        return;
      }
      core().saveJSON(STORE_KEY, next);
      state.store = next;
      syncStateFromStore();
      renderNiche();
      renderCompetitors();
      resolve(result);
    });
  }

  function upsertById(list, item) {
    const i = list.findIndex(function (x) { return x.id === item.id; });
    if (i === -1) list.push(item); else list[i] = item;
  }

  // The optional server reads settings from Firestore; keep its copy current.
  function mirrorSettingsToServer() {
    if (!state.status) return;
    data().set("marketing/settings", state.settings, true).catch(function () { /* optional */ });
  }

  // Per-device "last worked" times, shown in Server Health. Convenience only.
  const SYNC_KEY = "jarvisMarketingLastSync";
  function readSync() {
    try { return JSON.parse(localStorage.getItem(SYNC_KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  function markSync(which) {
    const s = readSync();
    s[which] = new Date().toISOString();
    try { localStorage.setItem(SYNC_KEY, JSON.stringify(s)); } catch (e) { /* storage unavailable: skip */ }
  }

  /* ---------------- loading ---------------- */

  function loadAll() {
    loadStore();
    state.loaded = true;
    state.loading = false;
    if (!signedIn()) {
      state.status = null;
      state.statusError = "";
      renderAll();
      return Promise.resolve();
    }
    state.checkingServer = true;
    state.serverCheckedOnce = true;
    renderAll();
    return cloud().call("marketingStatus", serverPayload(), { timeout: 20000 }).then(function (s) {
      state.status = s;
      state.statusError = "";
      markSync("server");
      return loadServerExtras();
    }).catch(function (err) {
      state.status = null;
      state.statusError = describeCallError(err);
      state.statusErrorRef = !!(err && err.details && err.details.ref);
    }).then(function () {
      state.checkingServer = false;
      renderAll();
    });
  }

  // Only reachable once the optional server (and its Firestore rules) are
  // deployed: server-collected snapshots, research runs, and a one-time
  // import of anything saved by the earlier server-only version.
  function loadServerExtras() {
    return Promise.all([data().list("marketingSnapshots"), data().get("marketingState/research")]).then(function (r) {
      state.snapshots = r[0] || [];
      state.research = r[1];
      if (state.store.importedCloud) return null;
      return Promise.all([data().get("marketing/settings"), data().list("marketingIdeas"), data().list("marketingFindings")]).then(function (c) {
        return commit(function (st) {
          if (!st.settings && c[0]) st.settings = c[0];
          (c[1] || []).forEach(function (i) { if (!st.ideas.some(function (x) { return x.id === i.id; })) st.ideas.push(i); });
          (c[2] || []).forEach(function (f) { if (!st.findings.some(function (x) { return x.id === f.id; })) st.findings.push(f); });
          st.importedCloud = true;
        });
      });
    }).catch(function () { /* optional extras */ });
  }

  function refreshStatus() {
    if (!signedIn()) { renderAll(); return Promise.resolve(); }
    return cloud().call("marketingStatus", serverPayload(), { timeout: 20000 }).then(function (s) { state.status = s; state.statusError = ""; markSync("server"); })
      .catch(function () { /* keep the last known state */ })
      .then(function () { renderStatus(); renderBudget(); renderResearchSummary(); renderIdeaCostHint(); renderServerOnlyControls(); renderNiche(); });
  }

  function renderNiche() {
    if (window.JarvisNicheResearch) window.JarvisNicheResearch.render();
  }

  function renderAll() {
    renderNiche();
    renderServerOnlyControls();
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

  /* ---------------- overview: server status ---------------- */

  function healthRows() {
    const rows = [];
    const pct = Math.round(storeChars() / STORE_LIMIT_CHARS * 100);
    rows.push(signedIn()
      ? { label: "Your marketing data", level: "ok", text: "Saved on this device and synced with your JARVIS account (" + pct + "% of Marketing's space used)." }
      : { label: "Your marketing data", level: "local", text: "Saved on this device only. Sign in to JARVIS to sync it to your other devices (" + pct + "% of Marketing's space used)." });

    const backend = aiBackend();
    if (backend === "server") rows.push({ label: "AI content ideas", level: "ok", text: "Through your Marketing server." });
    else if (state.checkingServer) rows.push({ label: "AI content ideas", level: "pending", text: "Checking…" });
    else if (state.status) rows.push({ label: "AI content ideas", level: "warn", text: "Your Marketing server is up, but its Claude API key isn't set." });
    else rows.push({ label: "AI content ideas", level: "optional", text: "Optional, not set up. It needs the Marketing server, which keeps your Claude key off your devices." });

    if (state.checkingServer) rows.push({ label: "Automatic competitor research", level: "pending", text: "Checking…" });
    else if (state.status && state.status.keyConfigured) rows.push({ label: "Automatic competitor research", level: "ok", text: "Through your Marketing server (InsightSocial)." });
    else if (state.status) rows.push({ label: "Automatic competitor research", level: "warn", text: "Your Marketing server is up, but its InsightSocial key isn't set." });
    else if (state.statusErrorRef) rows.push({ label: "Automatic competitor research", level: "bad", text: state.statusError });
    else rows.push({ label: "Automatic competitor research", level: "optional", text: "Optional, not set up. It needs the Marketing server. Meanwhile you can log competitor numbers by hand in Competitors." });
    return rows;
  }

  const LEVEL_BADGE = { ok: ["badge-green", "OK"], bad: ["badge-red", "Problem"], warn: ["badge-yellow", "Off"], optional: ["badge-neutral", "Optional"], local: ["badge-neutral", "This device"], pending: ["badge-neutral", "Checking"] };

  function renderStatus(notice) {
    const statusEl = $("ciConnectionStatus");
    const usageEl = $("ciUsageSummary");
    const list = $("mktHealthList");
    if (!statusEl) return;
    const rows = healthRows();
    list.textContent = "";
    rows.forEach(function (r) {
      const li = el("li", "mkt-health-row");
      const head = el("div", "mkt-health-head");
      head.appendChild(el("span", "mkt-health-label", r.label));
      const b = LEVEL_BADGE[r.level];
      head.appendChild(el("span", "badge " + b[0], b[1]));
      li.appendChild(head);
      li.appendChild(el("p", "field-hint mkt-health-text" + (r.level === "bad" ? " text-negative" : ""), r.text));
      list.appendChild(li);
    });
    const problems = rows.filter(function (r) { return r.level === "bad"; }).length;
    const checking = rows.some(function (r) { return r.level === "pending"; });
    statusEl.classList.toggle("text-negative", problems > 0);
    statusEl.textContent = problems ? problems + " problem" + (problems === 1 ? "" : "s") + " found. Details below."
      : "Marketing is ready to use." + (checking ? " Checking optional extras…" : "");

    const sync = readSync();
    $("mktLastSync").textContent = sync.server ? "Marketing server last reached from this device: " + core().formatDateTime(sync.server) + "." : "";

    usageEl.textContent = notice || state.notice || "";
    const s = state.status;
    if (s && typeof (s.usage || {}).lastCreditsRemaining === "number") {
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
    const sp = spec();
    if (!sp) return null;
    const m = model || (state.settings || DEFAULT_SETTINGS).aiModel;
    return sp.worstCaseCostUsd(m, TYPICAL_INPUT_TOKENS, sp.AI_MAX_OUTPUT_TOKENS);
  }

  // This month's AI spend, as recorded by the server.
  function aiSpend() {
    const server = (state.status && state.status.usage) || {};
    return { costUsd: server.aiCostUsd || 0, requests: server.aiRequests || 0 };
  }

  function aiAllowance() {
    const st = state.settings || DEFAULT_SETTINGS;
    return Math.max(0, st.monthlyBudgetUsd - st.insightPlanMonthlyUsd);
  }

  function renderBudget() {
    const box = $("mktBudget");
    if (!box) return;
    const st = state.settings || DEFAULT_SETTINGS;
    const s = state.status;
    const spend = aiSpend();
    const allowance = aiAllowance();
    box.textContent = "";
    box.appendChild(meter("AI ideas (Claude)", spend.costUsd, allowance, money(spend.costUsd) + " of " + money(allowance)));
    const total = st.insightPlanMonthlyUsd + spend.costUsd;
    box.appendChild(meter("Total estimated", total, st.monthlyBudgetUsd, money(total) + " of " + money(st.monthlyBudgetUsd)));
    if (s) {
      const u = s.usage || {};
      box.appendChild(meter("InsightSocial credits", u.creditsUsed || 0, s.monthlyCreditCap, formatNumber(u.creditsUsed || 0) + " of " + formatNumber(s.monthlyCreditCap)));
    }

    const list = el("ul", "mkt-cost-list");
    list.appendChild(el("li", "", st.insightPlanMonthlyUsd > 0
      ? "InsightSocial plan: " + money(st.insightPlanMonthlyUsd) + "/month (from Settings), leaving " + money(allowance) + " for AI."
      : "InsightSocial plan price is set to $0 in Settings."));
    const worst = ideaWorstCaseUsd();
    list.appendChild(el("li", "", "AI ideas with " + (MODEL_LABELS[st.aiModel] || st.aiModel) + ": up to about " + money(worst) + " per generation (worst case)" +
      (spend.requests ? "; your " + spend.requests + " generation(s) this month averaged " + money(spend.costUsd / spend.requests) + "." : ".") +
      " These are estimates from token counts and published prices, not Anthropic's invoice."));
    if (s) {
      const u = s.usage || {};
      list.appendChild(el("li", "", u.requests
        ? "InsightSocial: " + formatNumber(u.requests) + " request(s) this month, averaging " + ((u.creditsUsed || 0) / u.requests).toFixed(1) + " credit(s) each as reported by InsightSocial."
        : "InsightSocial: no requests this month yet."));
    } else {
      list.appendChild(el("li", "", "InsightSocial credits are tracked by the optional Marketing server, which isn't set up."));
    }
    box.appendChild(list);
  }

  /* ---------------- overview: daily research ---------------- */

  function renderResearchSummary() {
    const box = $("mktResearchSummary");
    if (!box) return;
    if (state.checkingServer && !state.status) { skeleton(box, 2); return; }
    const s = state.status;
    if (!s) {
      emptyState(box, "Automatic daily research needs the optional Marketing server, which isn't set up. Meanwhile, log competitor numbers by hand in Competitors; they're saved with your account.");
      $("mktRunHistory").textContent = "";
      return;
    }
    const run = s.lastRun || (state.research && state.research.lastRun) || null;
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

  // Lookup and research buttons only work with the optional server.
  function renderServerOnlyControls() {
    const on = !!state.status;
    const run = $("mktRunResearchBtn");
    const look = $("ciLookupBtn");
    if (run) run.disabled = !on;
    if (look) look.disabled = !on;
    const note = $("ciLookupStatus");
    if (note && !on && !note.dataset.result) {
      note.textContent = state.checkingServer ? "Checking for your Marketing server…" : "Lookups run through the optional Marketing server, which isn't set up. You can log a competitor's numbers by hand in Competitors.";
    }
  }

  function runResearchNow() {
    if (!state.status) { core().showToast("Automatic research needs the optional Marketing server."); return; }
    const btn = $("mktRunResearchBtn");
    const box = $("mktResearchSummary");
    btn.disabled = true;
    btn.textContent = "Running…";
    skeleton(box, 3);
    cloud().call("runResearch", serverPayload(), { timeout: 300000 }).then(function (res) {
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
    statusEl.dataset.result = "1";
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
    if (!state.status) { core().showToast("Lookups need the optional Marketing server."); return; }
    const btn = $("ciLookupBtn");
    const refreshBtn = $("ciRefreshBtn");
    const statusEl = $("ciLookupStatus");
    btn.disabled = true;
    refreshBtn.disabled = true;
    statusEl.textContent = (refresh ? "Refreshing" : "Looking up") + " @" + handle + "…";
    $("ciLookupResult").textContent = "";
    cloud().call("insightRequest", serverPayload({ endpoint: "instagram.profile", params: { handle: handle }, refresh: !!refresh })).then(function (res) {
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

  // Every snapshot we have for a handle, oldest first: ones the optional
  // server collected from InsightSocial plus numbers logged by hand.
  function competitorHistory(handle) {
    const out = [];
    const snap = state.snapshots.find(function (s) { return s.id === handle || s.handle === handle; });
    if (snap && Array.isArray(snap.history)) {
      snap.history.forEach(function (h) { if (h && h.metrics) out.push({ date: h.date, metrics: h.metrics, source: "insightsocial" }); });
    }
    (state.store.snapshots[handle] || []).forEach(function (h) {
      if (h && h.metrics) out.push({ date: h.date, metrics: h.metrics, source: "manual" });
    });
    return out.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)) || (a.source === "manual" ? 1 : -1); });
  }

  function sourceLabel(src) { return src === "manual" ? "entered by you" : "InsightSocial profile"; }

  function logNumbersForm(handle) {
    const details = el("details", "mkt-details mkt-log");
    details.appendChild(el("summary", "", "Log numbers by hand"));
    const form = el("form", "mkt-log-form");
    form.noValidate = true;
    const mk = function (label, type, attrs) {
      const wrap = el("label", "mkt-log-field");
      wrap.appendChild(el("span", "", label));
      const input = el("input");
      input.type = type;
      Object.keys(attrs || {}).forEach(function (k) { input.setAttribute(k, attrs[k]); });
      wrap.appendChild(input);
      form.appendChild(wrap);
      return input;
    };
    const followers = mk("Followers", "number", { min: "0", step: "1", inputmode: "numeric", placeholder: "e.g. 1250" });
    const posts = mk("Posts (optional)", "number", { min: "0", step: "1", inputmode: "numeric" });
    const date = mk("Date", "date", {});
    date.value = core().todayISODate();
    const btn = el("button", "btn btn-secondary", "Save");
    btn.type = "submit";
    form.appendChild(btn);
    const msg = el("p", "field-hint");
    msg.setAttribute("role", "status");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const f = Number(followers.value);
      const pv = posts.value === "" ? null : Number(posts.value);
      if (followers.value === "" || !isFinite(f) || f < 0) { msg.textContent = "Enter the follower count shown on their profile."; return; }
      if (pv !== null && (!isFinite(pv) || pv < 0)) { msg.textContent = "Posts must be a number, or leave it empty."; return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value)) { msg.textContent = "Pick a date."; return; }
      const metrics = { followers: Math.round(f) };
      if (pv !== null) metrics.posts = Math.round(pv);
      commit(function (st) {
        const list = (st.snapshots[handle] || []).filter(function (x) { return x.date !== date.value; });
        list.push({ date: date.value, metrics: metrics, savedAt: new Date().toISOString() });
        list.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
        st.snapshots[handle] = list.slice(-90);
      }).then(function () {
        core().showToast("Saved @" + handle + "'s numbers.");
        renderCompetitors();
      }).catch(function (err) { msg.textContent = describeDataError(err); });
    });
    details.appendChild(form);
    details.appendChild(msg);
    return details;
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
    const link = el("a", "mkt-profile-link", "instagram.com/" + handle);
    link.href = "https://www.instagram.com/" + encodeURIComponent(handle) + "/";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    card.appendChild(link);

    const history = competitorHistory(handle);
    if (!history.length) {
      card.appendChild(el("p", "field-hint", state.status
        ? "No numbers yet. They'll be captured on the next research run, or log them by hand below."
        : "No numbers yet. Open their profile, then log what you see below."));
      card.appendChild(logNumbersForm(handle));
      return card;
    }
    const latest = history[history.length - 1];
    const prev = history.length > 1 ? history[history.length - 2] : null;
    card.appendChild(el("p", "field-hint", "Latest " + latest.date + " (" + sourceLabel(latest.source) + ")" + (prev ? " · compared with " + prev.date + " (" + sourceLabel(prev.source) + ")" : " · first snapshot")));

    const metrics = latest.metrics || {};
    const names = Object.keys(metrics).filter(function (n) { return typeof metrics[n] === "number"; });
    const sparkMetric = names.indexOf("followers") !== -1 ? "followers" : names[0];
    const sparkPoints = sparkMetric ? history.filter(function (h) { return typeof h.metrics[sparkMetric] === "number"; })
      .map(function (h) { return { date: h.date, value: h.metrics[sparkMetric] }; }) : [];
    if (sparkPoints.length >= 2) {
      const sp = el("div", "mkt-spark-wrap");
      sp.appendChild(sparkline(sparkPoints, "@" + handle + " " + sparkMetric + " over time"));
      sp.appendChild(el("span", "field-hint", sparkMetric + ", " + sparkPoints.length + " snapshots"));
      card.appendChild(sp);
    }
    if (names.length) {
      const table = el("table", "mkt-metrics");
      const thead = el("thead");
      const hr = el("tr");
      ["Field", "Value", "Change"].forEach(function (t) { hr.appendChild(el("th", "", t)); });
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
    }
    card.appendChild(logNumbersForm(handle));
    return card;
  }

  function renderCompetitors() {
    const box = $("mktCompetitorList");
    if (!box) return;
    const list = (state.settings || DEFAULT_SETTINGS).watchlist;
    if (!list.length) { emptyState(box, "No competitors yet. Add an Instagram handle above to start tracking it."); return; }
    box.textContent = "";
    list.forEach(function (h) { box.appendChild(competitorCard(h)); });
  }

  function handleWatchAdd(e) {
    e.preventDefault();
    const status = $("mktWatchStatus");
    const handle = normalizeHandle($("mktWatchHandle").value);
    if (!HANDLE_RE.test(handle)) { status.textContent = "Enter a valid Instagram handle (letters, numbers, dots, underscores; up to 30)."; return; }
    const current = (state.settings || DEFAULT_SETTINGS).watchlist;
    if (current.indexOf(handle) !== -1) { status.textContent = "@" + handle + " is already on your watchlist."; return; }
    if (current.length >= MAX_WATCHLIST) { status.textContent = "The watchlist holds up to " + MAX_WATCHLIST + " accounts. Remove one first."; return; }
    $("mktWatchAddBtn").disabled = true;
    saveSettings({ watchlist: current.concat([handle]) }).then(function () {
      $("mktWatchHandle").value = "";
      status.textContent = "Added @" + handle + "." + (state.status ? " It will be researched on the next run." : " Log their numbers below whenever you check their profile.");
      renderCompetitors();
    }).catch(function (err) {
      status.textContent = describeDataError(err);
    }).then(function () { $("mktWatchAddBtn").disabled = false; });
  }

  function removeWatch(handle) {
    if (!window.confirm("Stop tracking @" + handle + "? Numbers you logged are kept.")) return;
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
    if (!text) { status.textContent = "Write the finding first."; return; }
    if (kind === "verified" && !source) { status.textContent = "A verified finding needs a source. Add one, or save it as a hypothesis."; return; }
    const f = { id: core().uid(), text: text.slice(0, 400), kind: kind, source: source.slice(0, 200), createdAt: new Date().toISOString() };
    $("mktFindingAddBtn").disabled = true;
    commit(function (st) { st.findings.push(f); }).then(function () {
      $("mktFindingForm").reset();
      status.textContent = "Saved.";
      renderFindings();
    }).catch(function (err) { status.textContent = describeDataError(err); })
      .then(function () { $("mktFindingAddBtn").disabled = false; });
  }

  function deleteFinding(f) {
    if (!window.confirm("Delete this research note?")) return;
    commit(function (st) { st.findings = st.findings.filter(function (x) { return x.id !== f.id; }); }).then(function () {
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

  function aiBackend() {
    return state.status && state.status.aiKeyConfigured ? "server" : null;
  }

  function renderIdeaCostHint() {
    const hint = $("mktIdeaCostHint");
    const btn = $("mktIdeaGenerateBtn");
    if (!hint) return;
    hint.classList.remove("text-negative");
    const backend = aiBackend();
    const model = (state.settings || DEFAULT_SETTINGS).aiModel;
    if (!backend) {
      hint.textContent = state.checkingServer ? "Checking for your Marketing server…"
        : state.status ? "Your Marketing server is up, but its Claude API key isn't set, so ideas can't be generated yet."
        : "AI ideas run on the optional Marketing server, which keeps your Claude API key off your devices. It isn't set up yet. Everything else in Marketing works without it.";
      btn.disabled = true;
      return;
    }
    const worst = ideaWorstCaseUsd();
    const left = Math.max(0, aiAllowance() - aiSpend().costUsd);
    if (worst !== null && worst > left) {
      hint.textContent = "Blocked to protect your budget: " + money(left) + " of AI budget left this month, and one generation with " + (MODEL_LABELS[model] || model) + " can cost up to " + money(worst) + ". Switch to a cheaper model or raise the budget in Settings.";
      hint.classList.add("text-negative");
      btn.disabled = true;
      return;
    }
    hint.textContent = "Uses " + (MODEL_LABELS[model] || model) + " through your Marketing server" +
      ". Estimated cost: up to " + money(worst) + " per generation, usually less. " + money(left) + " of AI budget left this month.";
    btn.disabled = false;
  }

  // The server reads settings and notes from Firestore; send it the
  // current ones first.
  function mirrorForServer() {
    if (!state.status) return Promise.resolve();
    const writes = [data().set("marketing/settings", state.settings, true)];
    state.findings.slice(-30).forEach(function (f) {
      writes.push(data().set("marketingFindings/" + f.id, { text: f.text, kind: f.kind, source: f.source || "", createdAt: f.createdAt || "" }));
    });
    return Promise.all(writes).catch(function () { /* best effort */ });
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
    const backend = aiBackend();
    if (!backend) { renderIdeaCostHint(); return; }
    const status = $("mktIdeaStatus");
    const btn = $("mktIdeaGenerateBtn");
    const results = $("mktIdeaResults");
    btn.disabled = true;
    $("mktIdeaRegenerateBtn").disabled = true;
    status.textContent = "Writing ideas… this can take up to a minute or two.";
    skeleton(results, 4);
    state.lastBrief = brief;
    mirrorForServer().then(function () { return cloud().call("generateIdeas", brief, { timeout: 240000 }); }).then(function (res) {
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
    const withId = Object.assign({ id: id }, record);
    return commit(function (st) { upsertById(st.ideas, withId); }).then(function () { return withId; });
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
    if (!state.ideas.length) { count.textContent = ""; emptyState(box, "No saved ideas yet. Tap New idea to add your own" + (aiBackend() ? ", or generate some in AI Ideas." : ".")); return; }
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
    commit(function (st) { st.ideas = st.ideas.filter(function (x) { return x.id !== idea.id; }); }).then(function () {
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
    $("mktSetRunCredits").value = s.researchRunCreditCap;
    renderRunHint();
    $("mktSetModel").value = s.aiModel;
    $("mktSetBrand").value = s.brandProfile;
    $("mktSetPillars").value = s.contentPillars.join("\n");
    renderModelHint();
    const status = $("mktSettingsStatus");
    $("mktStorageUse").textContent = "Marketing is using " + Math.round(storeChars() / STORE_LIMIT_CHARS * 100) + "% of its storage space" + (signedIn() ? " (synced with your JARVIS account)." : " (on this device; sign in to sync).");
    if (status.textContent.indexOf("Sign in") === 0) status.textContent = "";
  }

  function renderRunHint() {
    const hint = $("mktSetRunHint");
    if (!hint) return;
    const spec = window.JarvisNicheSpec;
    if (!spec) { hint.textContent = ""; return; }
    hint.textContent = "A full Research My Niche run uses up to " + formatNumber(spec.MAX_RUN_CREDITS) + " credits. Saved results are reused for " +
      spec.RESULT_TTL_HOURS + " hours, so pressing it again costs nothing. A run skips any search that would go over this limit.";
  }

  function renderModelHint() {
    const hint = $("mktSetModelHint");
    if (!hint) return;
    const worst = ideaWorstCaseUsd($("mktSetModel").value);
    hint.textContent = worst === null
      ? ""
      : "Worst case per generation with this model: about " + money(worst) + ".";
  }

  function handleSettingsSave(e) {
    e.preventDefault();
    const status = $("mktSettingsStatus");
    const budget = Number($("mktSetBudget").value);
    const plan = Number($("mktSetPlan").value);
    if (!isFinite(budget) || budget < 0) { status.textContent = "Enter a monthly budget of $0 or more."; return; }
    if (!isFinite(plan) || plan < 0) { status.textContent = "Enter the InsightSocial plan price (0 if you don't know it yet)."; return; }
    if (plan > budget) { status.textContent = "Note: the InsightSocial plan alone is over your budget, so AI ideas will be blocked."; }
    const patch = {
      monthlyBudgetUsd: budget,
      insightPlanMonthlyUsd: plan,
      monthlyCreditCap: Number($("mktSetCredits").value),
      researchRunCreditCap: Number($("mktSetRunCredits").value),
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
      renderBudget();
      renderIdeaCostHint();
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

  // What the Niche Research tab (js/niche-research.js) may use. It reads the
  // same local store, so everything it saves syncs like the rest of Marketing.
  function nicheApi() {
    return {
      getStore: function () { return state.store; },
      getSettings: function () { return state.settings || DEFAULT_SETTINGS; },
      getIdeas: function () { return state.ideas; },
      getStatus: function () { return state.status; },
      isChecking: function () { return state.checkingServer; },
      isSignedIn: signedIn,
      callServer: function (name, payload, options) {
        const c = cloud();
        if (!c) return Promise.reject(Object.assign(new Error("Sign in to JARVIS to use Marketing."), { code: "functions/unauthenticated" }));
        return c.call(name, serverPayload(payload), options);
      },
      refreshStatus: refreshStatus,
      describeCallError: describeCallError,
      commit: commit,
      sanitizeSettings: sanitizeSettings,
      mirrorSettings: mirrorSettingsToServer,
      saveSettings: saveSettings,
      describeDataError: describeDataError,
      showTab: function (buttonId) { const b = $(buttonId); if (b) b.click(); },
      maxWatchlist: MAX_WATCHLIST,
      core: core
    };
  }

  function init() {
    if (!$("ciLookupForm")) return;
    loadStore();
    if (window.JarvisNicheResearch) window.JarvisNicheResearch.init(nicheApi());
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
    if (nav) nav.addEventListener("click", function () {
      loadStore();
      if (!state.serverCheckedOnce && !state.checkingServer) loadAll(); else renderAll();
    });

    const removed = removeLegacyBrowserKey();
    state.notice = removed ? "The InsightSocial key previously saved in this browser was deleted; your server holds the only copy now." : "";
    loadAll();
  }

  window.JarvisContentIntel = { init: init };
})();
