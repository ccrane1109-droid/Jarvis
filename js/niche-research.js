/* ==========================================================================
   JARVIS — Marketing › Niche (AI Niche Research dashboard, Instagram + TikTok)

   What these tabs do (Overview, Discover, AI Analysis, Research History, and
   the saved posts in Saved Library all render from here):
   - Holds the niche profile (business, audience, keywords, platforms,
     competitors) that research is built from.
   - "Research My Niche" searches Instagram and TikTok for your keywords
     through InsightSocial, on your Marketing server (the key never reaches
     the browser). Every source shows what really happened: completed,
     cached, unavailable or failed. Without the server it opens a manual
     research kit instead: one-tap searches plus a form to save what you find.
   - Search results show exactly what InsightSocial returned, with links to
     the original posts. Saved finds, themes, competitors and ideas come from
     data you entered or JARVIS stored. Nothing on this tab is sample data.

   Posts from every research run are kept by the Marketing server (the
   "research library"): Discover filters, sorts and searches them, marks
   captions that match your keywords or repeat another post, and lets you
   bookmark the ones worth keeping. Browsing costs no credits.

   AI analysis and daily niche reports arrive in later updates and will plug
   into the same sections. Until then those sections say so.

   Data lives in the Marketing store (localStorage key jarvisMarketing, synced
   with the JARVIS account); competitor handles are the Marketing watchlist.
   ========================================================================== */

(function () {
  "use strict";

  const MAX_KEYWORDS = 20;
  const MAX_FINDS = 150;
  const KEYWORD_PREVIEW = 6;
  const FINDS_PREVIEW = 5;
  const HANDLE_RE = /^[a-z0-9._]{1,30}$/;

  const PLATFORMS = [
    { value: "instagram", label: "Instagram" },
    { value: "tiktok", label: "TikTok" }
  ];
  const FORMATS = [
    { value: "", label: "Not sure" },
    { value: "talking", label: "Talking to camera" },
    { value: "pov", label: "POV / skit" },
    { value: "outfit", label: "Outfit / try-on" },
    { value: "bts", label: "Behind the scenes" },
    { value: "story", label: "Voiceover / story" },
    { value: "product", label: "Product showcase" },
    { value: "dayinlife", label: "Day in the life" },
    { value: "other", label: "Other" }
  ];
  const IDEA_STATUS = { draft: "Draft", ready: "Ready to film", filmed: "Filmed", posted: "Posted" };

  // The starting niche comes from what the owner told JARVIS about Gratiel:
  // a Christian streetwear clothing brand; minimalist, premium, authentic
  // Christian messaging. Audience is left blank because it hasn't been given.
  const DEFAULT_NICHE = {
    businessName: "Gratiel",
    industry: "Christian streetwear clothing",
    targetAudience: "",
    productCategory: "Clothing",
    brandPersonality: "Authentic, minimalist, premium, faith-driven",
    keywords: [
      "Christian streetwear", "Faith-based clothing", "Minimalist Christian fashion", "Premium streetwear",
      "Christian lifestyle content", "Clothing brand marketing", "Clothing brand launches", "Fashion storytelling",
      "Streetwear product photography", "Behind-the-scenes clothing brand content"
    ],
    platforms: ["instagram", "tiktok"]
  };

  let api = null;
  const LIB_PAGE = 20;
  const NO_FILTER = { platform: "all", days: 0, minViews: 0, minRate: 0, relevantOnly: false, bookmarkedOnly: false, hideDupes: false, search: "", session: "" };
  const LIB_DEFAULT_FILTER = { platform: "all", days: 30, minViews: 0, minRate: 0, relevantOnly: false, bookmarkedOnly: false, hideDupes: true, search: "", session: "" };
  const ui = {
    filter: "all", showAllFinds: false, showAllKeywords: false, editingFindId: null, lastAttempt: null, openerId: null,
    running: false, run: null,
    // The research library as the server returned it: status is idle | loading | ready | unavailable | error.
    lib: { status: "idle", posts: [], total: 0, count: 0, limit: 0, error: "", loadedAt: 0 },
    f: Object.assign({}, LIB_DEFAULT_FILTER), sort: "views", libShown: LIB_PAGE, bmShown: 0, bookmarkBusy: {}, enriched: null
  };

  function $(id) { return document.getElementById(id); }
  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* ---------------- pure helpers (also exposed for tests) ---------------- */

  function clean(v, max) { return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : ""; }
  function platformLabel(v) { const p = PLATFORMS.find(function (x) { return x.value === v; }); return p ? p.label : v; }
  function formatLabel(v) { const f = FORMATS.find(function (x) { return x.value === v; }); return f && f.value ? f.label : ""; }

  function parseKeywords(text) {
    const seen = {};
    const keywords = [];
    const tooLong = [];
    let overflow = false;
    String(text || "").split(/[\n,]+/).forEach(function (part) {
      const k = part.replace(/\s+/g, " ").trim();
      if (!k) return;
      if (k.length > 60) { tooLong.push(k.slice(0, 20) + "…"); return; }
      const key = k.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      if (keywords.length >= MAX_KEYWORDS) { overflow = true; return; }
      keywords.push(k);
    });
    return { keywords: keywords, tooLong: tooLong, overflow: overflow };
  }

  // Accepts @handle, handle, or an instagram.com profile link.
  function parseHandles(text, max) {
    const seen = {};
    const handles = [];
    const invalid = [];
    let overflow = false;
    String(text || "").split(/[\s,]+/).forEach(function (raw) {
      let t = raw.trim();
      if (!t) return;
      const m = t.match(/instagram\.com\/([^/?#\s]+)/i);
      if (m) t = m[1];
      t = t.replace(/^@+/, "").toLowerCase();
      if (!HANDLE_RE.test(t)) { invalid.push(raw.slice(0, 30)); return; }
      if (seen[t]) return;
      seen[t] = true;
      if (handles.length >= max) { overflow = true; return; }
      handles.push(t);
    });
    return { handles: handles, invalid: invalid, overflow: overflow };
  }

  function sanitizeNiche(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const d = DEFAULT_NICHE;
    const pick = function (key, max) { return typeof r[key] === "string" ? clean(r[key], max) : d[key]; };
    const kw = Array.isArray(r.keywords) ? parseKeywords(r.keywords.join("\n")).keywords : d.keywords.slice();
    const platforms = Array.isArray(r.platforms)
      ? PLATFORMS.map(function (p) { return p.value; }).filter(function (v) { return r.platforms.indexOf(v) !== -1; })
      : [];
    return {
      businessName: clean(r.businessName, 60) || d.businessName,
      industry: pick("industry", 80),
      targetAudience: pick("targetAudience", 300),
      productCategory: pick("productCategory", 80),
      brandPersonality: pick("brandPersonality", 200),
      keywords: kw,
      platforms: platforms.length ? platforms : d.platforms.slice()
    };
  }

  function hashtagOf(keyword) {
    const t = String(keyword || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return t.length >= 2 ? t.slice(0, 60) : "";
  }

  function detectPlatform(hostname) {
    const h = String(hostname || "").toLowerCase();
    if (h === "instagram.com" || h.slice(-14) === ".instagram.com") return "instagram";
    if (h === "tiktok.com" || h.slice(-11) === ".tiktok.com") return "tiktok";
    return "";
  }

  // Returns { ok, url, platform, key } or { ok:false, error }.
  function normalizeSourceUrl(input) {
    let t = String(input || "").trim();
    if (!t) return { ok: false, error: "Paste the link to the video or post." };
    if (t.length > 500) return { ok: false, error: "That link is too long." };
    if (t.indexOf("://") === -1) t = "https://" + t;
    let u;
    try { u = new URL(t); } catch (e) { return { ok: false, error: "That doesn't look like a link." }; }
    if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "Only web links (https) are allowed." };
    if (u.username || u.password) return { ok: false, error: "Remove the username or password from the link." };
    const platform = detectPlatform(u.hostname);
    if (!platform) return { ok: false, error: "The link must be from instagram.com or tiktok.com." };
    u.protocol = "https:";
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    return { ok: true, url: u.href, platform: platform, key: platform + ":" + path };
  }

  // "12.5K" / "1.2M" / "1,284" -> number; "" -> null; anything else -> undefined.
  function parseCount(text) {
    const t = String(text == null ? "" : text).trim();
    if (!t) return null;
    const m = t.match(/^([0-9][0-9,]*(?:\.[0-9]+)?)\s*([kKmM])?$/);
    if (!m) return undefined;
    let n = parseFloat(m[1].replace(/,/g, ""));
    if (m[2]) n *= m[2].toLowerCase() === "k" ? 1e3 : 1e6;
    n = Math.round(n);
    return n >= 0 && n <= 1e10 ? n : undefined;
  }

  function formatCompact(n) {
    if (typeof n !== "number" || !isFinite(n)) return "—";
    if (n < 10000) return n.toLocaleString();
    if (n < 1e6) return (Math.round(n / 100) / 10).toString().replace(/\.0$/, "") + "K";
    return (Math.round(n / 1e5) / 10).toString().replace(/\.0$/, "") + "M";
  }

  function formatDay(isoDay) {
    if (!isoDay) return "";
    const d = new Date(String(isoDay).slice(0, 10) + "T00:00:00");
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }

  function todayIso() {
    const d = new Date();
    const p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function themeCounts(finds) {
    const counts = {};
    finds.forEach(function (f) { if (f.format) counts[f.format] = (counts[f.format] || 0) + 1; });
    return Object.keys(counts).map(function (k) { return { key: k, label: formatLabel(k) || k, count: counts[k] }; })
      .sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label); });
  }

  /* ---------------- data access ---------------- */

  function store() { return api.getStore(); }
  function niche() { return sanitizeNiche(store().niche); }
  function finds() { return store().finds || []; }
  function watchlist() { return api.getSettings().watchlist || []; }

  function externalLink(href, text, className, label) {
    const a = el("a", className, text);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    if (label) a.setAttribute("aria-label", label + " (opens in a new tab)");
    return a;
  }

  /* ---------------- hero ---------------- */

  function renderHero() {
    const n = niche();
    $("nrHeroTitle").textContent = n.businessName + (n.industry ? " · " + n.industry : "");
    $("nrNicheSummary").textContent = n.keywords.length + " research keyword" + (n.keywords.length === 1 ? "" : "s") +
      (n.brandPersonality ? " · " + n.brandPersonality : "");
    const chips = $("nrPlatformChips");
    chips.textContent = "";
    n.platforms.forEach(function (p) { chips.appendChild(el("li", "nr-chip nr-chip-" + p, platformLabel(p))); });
    $("nrProfileGap").textContent = n.targetAudience ? "" : "Add your target audience in Edit niche so ideas fit your customers.";
    $("nrProfileGap").classList.toggle("hidden", !!n.targetAudience);
  }

  /* ---------------- overview ---------------- */

  function tile(label, value, sub) {
    const t = el("div", "nr-tile");
    t.appendChild(el("p", "nr-tile-label", label));
    const text = String(value);
    t.appendChild(el("p", "nr-tile-value" + (text.length > 8 ? " nr-tile-value-sm" : ""), text));
    if (sub) t.appendChild(el("p", "nr-tile-sub", sub));
    return t;
  }

  function statsLib() { return window.JarvisMarketingStats || null; }

  // Numbers for the newest research, or null when there is none (or the numbers helper didn't load).
  function currentStats() {
    const S = statsLib();
    const run = currentRun();
    return S && run ? S.runStats(run, new Date()) : null;
  }

  function shortDate(iso) {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  // Posts of the latest run whose caption matches one of your keywords.
  function latestRelevance() {
    const S = statsLib();
    const run = currentRun();
    if (!S || !run) return null;
    const posts = S.uniquePosts(run).map(function (d) { return d.item; });
    const rated = S.enrich(posts, niche().keywords, new Date());
    const withCaption = rated.filter(function (p) { return p.relevance !== null; });
    return {
      total: rated.length, withCaption: withCaption.length,
      relevant: withCaption.filter(function (p) { return p.relevance >= S.RELEVANT_MIN; }).length
    };
  }

  function renderTiles() {
    const S = statsLib();
    const st = currentStats();
    const server = api.getStatus();
    const box = $("nrTiles");
    box.textContent = "";
    const none = "No research yet";
    box.appendChild(tile("Posts found", st ? st.posts.toLocaleString() : "—", st ? "in your latest research" : none));
    const rel = latestRelevance();
    box.appendChild(tile("Relevant posts", rel && rel.withCaption ? rel.relevant + " of " + rel.total : "—",
      rel ? (rel.withCaption ? "captions that match your keywords" : "no captions to compare") : none));
    box.appendChild(tile("Engagement rate", st && st.rated ? S.formatRate(st.avgRate) : "—",
      st ? (st.rated ? "average of " + st.rated + " posts with views" : "needs posts that report views") : none));
    box.appendChild(tile("Posted in 30 days", st && st.dated ? st.fresh + " of " + st.dated : "—",
      st ? (st.dated ? "posts that include a date" : "no dates reported") : none));
    const libCount = ui.lib.status === "ready" ? ui.lib.total : (server && typeof server.libraryCount === "number" ? server.libraryCount : null);
    const marks = ui.lib.status === "ready" ? ui.lib.posts.filter(function (p) { return p.bookmarked; }).length : (server && typeof server.libraryBookmarks === "number" ? server.libraryBookmarks : null);
    box.appendChild(tile("In your library", libCount !== null ? libCount.toLocaleString() : "—",
      libCount !== null ? (marks ? marks + " bookmarked" : "posts saved from every run") : (server && !supportsModes() ? "needs the server update" : "Marketing server not connected")));
    box.appendChild(tile("Last research", st && st.finishedAt ? shortDate(st.finishedAt) : "Never",
      st && st.finishedAt ? timeText(st.finishedAt).replace(/^[A-Za-z]+ \d+, /, "") + " · " + st.trigger : "Press Research My Niche"));
    box.appendChild(tile("Competitors", watchlist().length, "Instagram accounts tracked"));
    box.appendChild(tile("Saved ideas", api.getIdeas().length, "in your library"));
    const used = server && server.usage && typeof server.usage.creditsUsed === "number" ? server.usage.creditsUsed : null;
    box.appendChild(tile("Credits this month", used !== null ? used.toLocaleString() + " / " + (server.monthlyCreditCap || 0).toLocaleString() : "—",
      used !== null ? "InsightSocial, against your cap" : "Marketing server not connected"));
    const aiOn = !!(server && server.aiKeyConfigured);
    const aiUsd = server && server.usage && typeof server.usage.aiCostUsd === "number" ? server.usage.aiCostUsd : 0;
    box.appendChild(tile("AI spend", server ? (aiOn ? "$" + aiUsd.toFixed(2) : "Off") : "—",
      server ? (aiOn ? "of $" + (server.aiAllowanceUsd || 0).toFixed(2) + " this month" : "No Claude key yet") : "Marketing server not connected"));
    $("nrTilesNote").textContent = "“Relevant” means the caption matches one of your keywords. It reads captions only, not the video. Trend labels and an opportunity score arrive in later updates; they need research over several weeks.";
  }

  function renderOverview() {
    renderTiles();

    const themes = $("nrThemes");
    themes.textContent = "";
    const list = finds();
    if (list.length < 3) {
      themes.appendChild(el("p", "nr-empty", "Themes appear once you've saved 3 or more posts. Save posts you find with the research kit in Discover, and JARVIS counts which formats keep showing up."));
      return;
    }
    const counts = themeCounts(list);
    if (!counts.length) {
      themes.appendChild(el("p", "nr-empty", "None of your saved posts have a format yet. Add one when you save a post to see which formats keep showing up."));
      return;
    }
    const max = counts[0].count;
    const ul = el("ul", "nr-bars");
    counts.slice(0, 5).forEach(function (c) {
      const li = el("li", "nr-bar-row");
      const head = el("div", "nr-bar-head");
      head.appendChild(el("span", "nr-bar-label", c.label));
      head.appendChild(document.createTextNode(" "));
      head.appendChild(el("span", "nr-bar-value", c.count + (c.count === 1 ? " post" : " posts")));
      li.appendChild(head);
      const track = el("div", "nr-bar-track");
      track.setAttribute("aria-hidden", "true");
      const fill = el("div", "nr-bar-fill");
      fill.style.width = Math.max(6, Math.round(c.count / max * 100)) + "%";
      track.appendChild(fill);
      li.appendChild(track);
      ul.appendChild(li);
    });
    themes.appendChild(ul);
  }

  /* ---------------- sources + manual kit ---------------- */

  const STATUS_VIEW = {
    ready: { icon: "✓", label: "Ready", cls: "ok" },
    completed: { icon: "✓", label: "Completed", cls: "ok" },
    cached: { icon: "◷", label: "Cached", cls: "info" },
    running: { icon: "…", label: "Running", cls: "info" },
    unavailable: { icon: "⊘", label: "Unavailable", cls: "off" },
    failed: { icon: "✕", label: "Failed", cls: "bad" }
  };

  function spec() { return window.JarvisNicheSpec || null; }

  // The searches a run would make: mode "lean" is a quick refresh, "full" a full sweep.
  function planFor(n, mode) {
    const sp = spec();
    return sp
      ? sp.planSearches({ keywords: n.keywords, platforms: n.platforms }, { mode: mode || "full", dayIndex: sp.dayIndex(new Date()) })
      : { mode: "full", steps: [], credits: 0, omitted: { tiktok: 0, instagram: 0 }, resting: { tiktok: 0, instagram: 0 } };
  }

  // Quick refreshes and the research library need the updated server, which
  // reports its saved research sessions with its status.
  function supportsModes() {
    const server = api.getStatus();
    return !!(server && Array.isArray(server.nicheRuns));
  }

  // A full sweep when none ran in the last 7 days, otherwise a quick refresh.
  function suggestedMode() {
    const sp = spec();
    const server = api.getStatus();
    if (!sp || !supportsModes()) return "full";
    return sp.suggestMode(server.nicheLastFullAt || null, new Date());
  }
  function otherMode(m) { return m === "lean" ? "full" : "lean"; }

  // The newest run: the one just made on this device, or the server's last.
  function currentRun() {
    const server = api.getStatus();
    const fromServer = server && server.nicheRun && typeof server.nicheRun === "object" && Array.isArray(server.nicheRun.sources) ? server.nicheRun : null;
    if (ui.run && (!fromServer || String(ui.run.finishedAt || "") >= String(fromServer.finishedAt || ""))) return ui.run;
    return fromServer;
  }

  // Why automatic search can't run right now, or "" when it can.
  function researchBlocker() {
    if (!spec()) return "Automatic search didn't load. Refresh the page and try again.";
    if (!api.isSignedIn()) return "Sign in to JARVIS to use automatic search.";
    const server = api.getStatus();
    if (!server) {
      return api.isChecking() ? "Still checking for your Marketing server. Try again in a moment."
        : "Couldn't reach your Marketing server. It may not be set up yet, or you may be offline.";
    }
    if (!server.keyConfigured) return "The InsightSocial key isn't set on your Marketing server yet.";
    if (!Array.isArray(server.endpoints) || server.endpoints.indexOf("tiktok.search.top") === -1) {
      return "Your Marketing server needs the latest update before it can search. It has to be redeployed from Cloud Shell.";
    }
    return "";
  }

  const isOk = function (s) { return s.status === "completed" || s.status === "cached"; };
  const sumOf = function (list, pick) { return list.reduce(function (t, x) { return t + (pick(x) || 0); }, 0); };

  function timeText(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  // One line per search, in words (status is never shown by color alone).
  function searchDetail(s) {
    const posts = Array.isArray(s.items) ? s.items.length : 0;
    const bits = [];
    if (s.status === "completed") {
      bits.push(posts + (posts === 1 ? " post" : " posts"));
      bits.push(s.creditsUsed ? s.creditsUsed + " credits" : "no credits used");
    } else if (s.status === "cached") {
      bits.push(posts + (posts === 1 ? " post" : " posts"));
      bits.push("saved results from " + (timeText(s.fetchedAt) || "earlier") + (s.stale ? " (older than usual: " + (s.note || "credit limit reached") + ")" : ""));
      bits.push("no credits used");
    } else {
      bits.push(s.error || "Not run.");
    }
    if (s.dropped > 0) bits.push(s.dropped + " unusable " + (s.dropped === 1 ? "result" : "results") + " skipped");
    return bits.join(" · ");
  }

  function summarizePlatform(name, sources) {
    const ok = sources.filter(isOk);
    let status;
    if (ok.length) status = ok.some(function (s) { return s.status === "completed"; }) ? "completed" : "cached";
    else status = sources.some(function (s) { return s.status === "failed"; }) ? "failed" : "unavailable";
    const unique = {};
    ok.forEach(function (s) { (Array.isArray(s.items) ? s.items : []).forEach(function (it) { if (it && it.id) unique[it.id] = true; }); });
    const posts = Object.keys(unique).length;
    const credits = sumOf(sources, function (s) { return s.creditsUsed; });
    const detail = ok.length + " of " + sources.length + (sources.length === 1 ? " search" : " searches") + " returned results (" + posts + (posts === 1 ? " post" : " posts") + ") · " +
      (credits ? credits + " credits" : "no credits used");
    return { name: name, status: status, detail: detail, searches: sources };
  }

  function sourceRows(n) {
    const blocker = researchBlocker();
    const run = currentRun();
    const mode = suggestedMode();
    const plan = planFor(n, mode);
    const rows = n.platforms.map(function (p) {
      const name = platformLabel(p) + " search";
      if (ui.running) return { name: name, status: "running", detail: "Searching through InsightSocial…" };
      const mine = run ? run.sources.filter(function (s) { return s.platform === p; }) : [];
      if (mine.length) return summarizePlatform(name, mine);
      if (blocker) return { name: name, status: "unavailable", detail: blocker };
      const steps = plan.steps.filter(function (s) { return s.platform === p; });
      if (!steps.length && mode === "lean" && n.keywords.length) {
        return { name: name, status: "ready", detail: "Searched in the weekly full sweep. Quick refreshes only search TikTok." };
      }
      return {
        name: name, status: "ready",
        detail: steps.length ? "Ready: " + steps.length + (steps.length === 1 ? " search" : " searches") + ", up to " + sumOf(steps, function (s) { return s.credits; }) + " credits."
          : "No usable keywords for this platform yet."
      };
    });
    rows.push({ name: "Manual research kit", status: "ready", detail: "Open the searches below and save the posts you find." });
    return rows;
  }

  function renderSources() {
    const n = niche();
    const ul = $("nrSources");
    ul.textContent = "";
    sourceRows(n).forEach(function (r) {
      const v = STATUS_VIEW[r.status];
      const li = el("li", "nr-source");
      const badge = el("span", "nr-status-badge nr-status-" + v.cls);
      badge.appendChild(el("span", "nr-status-icon", v.icon)).setAttribute("aria-hidden", "true");
      badge.appendChild(document.createTextNode(" " + v.label));
      const text = el("div", "nr-source-text");
      text.appendChild(el("p", "nr-source-name", r.name));
      text.appendChild(el("p", "nr-source-detail", r.detail));
      if (r.searches && r.searches.length) {
        const sub = el("ul", "nr-subsources");
        r.searches.forEach(function (s) {
          const sv = STATUS_VIEW[s.status] || STATUS_VIEW.unavailable;
          const row = el("li", "nr-subsource");
          row.appendChild(el("span", "nr-subsource-label", s.label));
          row.appendChild(document.createTextNode(" "));
          const st = el("span", "nr-subsource-status nr-status-" + sv.cls);
          st.appendChild(el("span", "nr-status-icon", sv.icon)).setAttribute("aria-hidden", "true");
          st.appendChild(document.createTextNode(" " + sv.label));
          row.appendChild(st);
          row.appendChild(el("span", "nr-subsource-detail", searchDetail(s)));
          sub.appendChild(row);
        });
        text.appendChild(sub);
      }
      li.appendChild(text);
      li.appendChild(badge);
      ul.appendChild(li);
    });

    const box = $("nrKitLinks");
    box.textContent = "";
    const shown = ui.showAllKeywords ? n.keywords : n.keywords.slice(0, KEYWORD_PREVIEW);
    n.platforms.forEach(function (p) {
      const group = el("div", "nr-kit-group");
      group.appendChild(el("h4", "nr-kit-platform", platformLabel(p)));
      const list = el("ul", "nr-kit-list");
      shown.forEach(function (k) {
        const li = el("li", "nr-kit-row");
        li.appendChild(el("span", "nr-kit-keyword", k));
        const links = el("span", "nr-kit-links");
        const tag = hashtagOf(k);
        if (p === "tiktok") {
          links.appendChild(externalLink("https://www.tiktok.com/search?q=" + encodeURIComponent(k), "Search", "nr-kit-link", "Search TikTok for " + k));
          if (tag) links.appendChild(externalLink("https://www.tiktok.com/tag/" + encodeURIComponent(tag), "#" + tag, "nr-kit-link", "Open the #" + tag + " hashtag on TikTok"));
        } else if (tag) {
          links.appendChild(externalLink("https://www.instagram.com/explore/tags/" + encodeURIComponent(tag) + "/", "#" + tag, "nr-kit-link", "Open the #" + tag + " hashtag on Instagram"));
        } else {
          links.appendChild(el("span", "nr-muted", "No hashtag"));
        }
        li.appendChild(links);
        list.appendChild(li);
      });
      group.appendChild(list);
      box.appendChild(group);
    });
    if (n.keywords.length > KEYWORD_PREVIEW) {
      const more = el("button", "nr-btn nr-btn-ghost nr-btn-small", ui.showAllKeywords ? "Show fewer keywords" : "Show all " + n.keywords.length + " keywords");
      more.type = "button";
      more.addEventListener("click", function () { ui.showAllKeywords = !ui.showAllKeywords; renderSources(); });
      box.appendChild(more);
    }
    box.appendChild(el("p", "nr-hint", "Instagram and TikTok may ask you to log in. Hashtag pages only show what the app chooses to show you."));

    const run = currentRun();
    const stale = $("nrSourcesStale");
    if (stale) {
      // Stale when the last run searched something that is no longer in the niche.
      const have = {};
      n.keywords.forEach(function (k) { have["tiktok:" + k.toLowerCase()] = true; if (hashtagOf(k)) have["instagram:" + hashtagOf(k)] = true; });
      const changed = !!run && !ui.running && run.sources.some(function (s) {
        return n.platforms.indexOf(s.platform) === -1 || !have[s.id];
      });
      stale.textContent = changed ? "Your keywords or platforms changed since the last run. Press Research My Niche to search for the new ones." : "";
      stale.classList.toggle("hidden", !changed);
    }
  }

  function openKit() {
    $("nrKit").open = true;
  }

  function scrollToCard(id) {
    const card = $(id);
    if (card && card.scrollIntoView) {
      const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      card.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    }
  }

  // "3 keywords on TikTok and 1 hashtag on Instagram" for a plan.
  function describePlan(plan) {
    const tt = plan.steps.filter(function (x) { return x.platform === "tiktok"; }).length;
    const ig = plan.steps.filter(function (x) { return x.platform === "instagram"; }).length;
    const parts = [];
    if (tt) parts.push(tt + (tt === 1 ? " keyword" : " keywords") + " on TikTok");
    if (ig) parts.push(ig + (ig === 1 ? " hashtag" : " hashtags") + " on Instagram");
    return parts.join(" and ");
  }

  // The sentence under the buttons: what pressing it will do and cost.
  function researchHint(n, mode, plan, server) {
    const used = server.usage && typeof server.usage.creditsUsed === "number" ? server.usage.creditsUsed : 0;
    const month = "This month: " + used.toLocaleString() + " of " + (server.monthlyCreditCap || 0).toLocaleString() + " credits used.";
    const limit = " Each run is limited to " + (server.researchRunCreditCap || 0).toLocaleString() + " credits.";
    const saved = "Results are saved for " + spec().RESULT_TTL_HOURS + " hours, so pressing it again costs nothing.";
    if (!supportsModes()) {
      return "Searches " + n.platforms.map(platformLabel).join(" and ") + " through InsightSocial: " + plan.steps.length + (plan.steps.length === 1 ? " search" : " searches") +
        ", up to " + plan.credits + " credits. " + month + limit + " " + saved + (plan.credits > (server.researchRunCreditCap || 0) ? " Some searches will be skipped by the run limit." : "");
    }
    const last = server.nicheLastFullAt ? "the last one was " + shortDate(server.nicheLastFullAt) : "none has run yet";
    if (mode === "lean") {
      const rest = plan.resting.tiktok + plan.resting.instagram;
      const full = planFor(n, "full");
      return "Quick refresh: searches " + describePlan(plan) + " (" + plan.credits + " credits)" + (rest ? "; your other " + rest + " rotate in on other days" : "") + ". " +
        "A full sweep (" + describePlan(full) + ", up to " + full.credits + " credits) is suggested once a week; " + last + ". " + month + " " + saved;
    }
    return "Full sweep: " + describePlan(plan) + ", up to " + plan.credits + " credits" +
      (server.nicheLastFullAt ? " (none in the last " + spec().FULL_SWEEP_DAYS + " days; " + last + ")" : " (" + last + ")") + ". " +
      "Quick refreshes of " + describePlan(planFor(n, "lean")) + " cost " + planFor(n, "lean").credits + " credits. " + month + limit + " " + saved +
      (plan.credits > (server.researchRunCreditCap || 0) ? " Some searches will be skipped by the run limit." : "");
  }

  function buttonLabel(mode, plan) {
    if (!supportsModes()) return "Research My Niche";
    return mode === "lean" ? "Research My Niche · " + plan.credits + " credits" : "Research My Niche · full sweep, up to " + plan.credits + " credits";
  }

  function renderResearchControls() {
    const n = niche();
    const blocker = researchBlocker();
    const mode = suggestedMode();
    const plan = planFor(n, mode);
    const ready = !blocker && plan.steps.length > 0;
    ["nrResearchBtn", "nrResearchBtn2"].forEach(function (id) {
      const btn = $(id);
      if (!btn) return;
      btn.disabled = ui.running;
      btn.textContent = ui.running ? "Researching…" : (ready ? buttonLabel(mode, plan) : "Research My Niche");
      btn.setAttribute("aria-busy", ui.running ? "true" : "false");
    });
    const sw = $("nrModeSwitchBtn");
    const otherPlan = planFor(n, otherMode(mode));
    const canSwitch = ready && supportsModes() && otherPlan.steps.length > 0 && otherPlan.credits !== plan.credits;
    sw.classList.toggle("hidden", !canSwitch);
    sw.disabled = ui.running;
    if (canSwitch) {
      sw.textContent = otherMode(mode) === "full" ? "Run a full sweep instead · up to " + otherPlan.credits + " credits" : "Run a quick refresh instead · " + otherPlan.credits + " credits";
    }
    const hint = $("nrResearchHint");
    const disc = $("nrDiscoverHint");
    let text;
    if (blocker) {
      text = blocker + " Until then this opens your research kit: searches to run yourself and a place to save what you find.";
    } else if (!plan.steps.length) {
      text = "Add research keywords and pick a platform in Edit niche to search.";
    } else {
      text = researchHint(n, mode, plan, api.getStatus());
    }
    hint.textContent = text;
    disc.textContent = blocker || !plan.steps.length ? text : text + " New posts are added to your research library below.";
  }

  function runSummaryLine(run) {
    return (run.summary || []).join(" ");
  }

  // The same message shows on Overview and Discover so it's seen wherever the button was pressed.
  function setStatus(text) {
    ["nrResearchStatus", "nrResearchStatus2"].forEach(function (id) { if ($(id)) $(id).textContent = text; });
  }

  function handleResearch(origin, forcedMode) {
    if (ui.running) return;
    ui.lastAttempt = new Date();
    const blocker = researchBlocker();
    if (blocker) {
      setStatus(blocker + " Use the manual research kit in Discover, and save what you find.");
      renderSources();
      openKit();
      if (origin !== "discover") api.showTab("mktSubNavDiscover");
      scrollToCard("nrSourcesCard");
      return;
    }
    const n = niche();
    const mode = forcedMode || suggestedMode();
    if (!planFor(n, mode).steps.length) {
      setStatus("Add research keywords and pick a platform in Edit niche first.");
      return;
    }
    ui.running = true;
    setStatus((mode === "lean" && supportsModes() ? "Quick refresh: searching " : "Searching ") + (mode === "lean" && supportsModes() ? describePlan(planFor(n, mode)) : n.platforms.map(platformLabel).join(" and ")) + " through InsightSocial. This can take up to a minute.");
    render();
    if (origin === "discover") scrollToCard("nrDiscoverTitle");
    const payload = { niche: { keywords: n.keywords, platforms: n.platforms } };
    // Tell the server which mode the cost on the button was for.
    if (supportsModes()) payload.mode = mode;
    api.callServer("researchNiche", payload, { timeout: 300000 }).then(function (res) {
      if (res && res.run && Array.isArray(res.run.sources)) {
        ui.run = res.run;
        setStatus(runSummaryLine(res.run));
      } else {
        setStatus("The server answered, but not in the format JARVIS expects, so nothing was shown.");
      }
    }).catch(function (err) {
      setStatus(api.describeCallError(err));
    }).then(function () {
      ui.running = false;
      ui.libShown = LIB_PAGE;
      render();
      return api.refreshStatus();
    }).then(function () {
      // Pick up the posts this run added to the library.
      if (ui.run && ui.lib.status !== "unavailable") return loadLibrary(true);
      return null;
    }).then(function () {
      render();
      if (ui.run) scrollToCard(origin === "discover" ? "nrDiscCard" : "nrSummaryTitle");
    });
  }

  /* ---------------- research library (every post past runs found) ---------------- */

  function collectDiscoveries(run) {
    const S = statsLib();
    const out = S ? S.uniquePosts(run) : [];
    out.sort(function (a, b) {
      return (typeof b.item.views === "number" ? b.item.views : -1) - (typeof a.item.views === "number" ? a.item.views : -1);
    });
    return out;
  }

  const LIB_KEY_RE = /^(instagram|tiktok)_[A-Za-z0-9._-]{1,64}$/;
  const numOrNull = function (v) { return typeof v === "number" && isFinite(v) ? v : null; };
  const strOrNull = function (v, max) { return typeof v === "string" && v ? v.slice(0, max) : null; };
  const strList = function (v, max) { return Array.isArray(v) ? v.filter(function (x) { return typeof x === "string"; }).slice(0, max).map(function (x) { return x.slice(0, 80); }) : []; };

  // Keeps only the fields the page uses, with the right types, from a post the server sent.
  function cleanLibraryPost(p) {
    if (!p || typeof p !== "object" || typeof p.key !== "string" || !LIB_KEY_RE.test(p.key)) return null;
    const platform = p.key.indexOf("instagram_") === 0 ? "instagram" : "tiktok";
    return {
      key: p.key, platform: platform, id: p.key.slice(platform.length + 1),
      url: strOrNull(p.url, 500), text: typeof p.text === "string" ? p.text.slice(0, 300) : "", author: strOrNull(p.author, 60),
      views: numOrNull(p.views), likes: numOrNull(p.likes), comments: numOrNull(p.comments), shares: numOrNull(p.shares),
      publishedAt: strOrNull(p.publishedAt, 40), firstSeenAt: strOrNull(p.firstSeenAt, 40), lastSeenAt: strOrNull(p.lastSeenAt, 40),
      seenCount: numOrNull(p.seenCount) || 1, prevViews: numOrNull(p.prevViews), prevSeenAt: strOrNull(p.prevSeenAt, 40),
      queries: strList(p.queries, 8), sessions: strList(p.sessions, 8), bookmarked: p.bookmarked === true
    };
  }

  function maybeLoadLibrary() {
    if (ui.lib.status !== "idle" || !api.isSignedIn() || !api.getStatus() || !supportsModes()) return;
    const on = function (id) { const e = $(id); return !!e && e.classList.contains("active"); };
    if (on("mkt-discover") || on("mkt-library")) loadLibrary(false);
  }

  function loadLibrary(force) {
    if (!api.isSignedIn() || !api.getStatus()) return Promise.resolve();
    if (ui.lib.status === "loading") return Promise.resolve();
    if (!supportsModes()) { ui.lib.status = "unavailable"; return Promise.resolve(); }
    if (!force && ui.lib.status !== "idle" && ui.lib.status !== "error") return Promise.resolve();
    ui.lib.status = "loading";
    renderDiscoveries();
    renderBookmarks();
    return api.callServer("marketingLibrary", { action: "list" }, { timeout: 30000 }).then(function (res) {
      if (res && res.ok && Array.isArray(res.posts)) {
        ui.lib = {
          status: "ready", posts: res.posts.map(cleanLibraryPost).filter(Boolean), total: numOrNull(res.total) || 0,
          count: numOrNull(res.count) || 0, limit: numOrNull(res.limit) || 0, error: "", loadedAt: Date.now()
        };
        ui.enriched = null;
      } else {
        ui.lib.status = "error";
        ui.lib.error = "The server answered, but not in the format JARVIS expects, so nothing was shown.";
      }
    }).catch(function (err) {
      ui.lib.status = "error";
      ui.lib.error = api.describeCallError(err);
    }).then(function () {
      renderDiscoveries();
      renderBookmarks();
      renderTiles();
    });
  }

  // The library's posts with rate, age, keyword match and repeated-caption marks added.
  function enrichedLibrary() {
    const S = statsLib();
    const kw = niche().keywords;
    const stamp = ui.lib.loadedAt + "|" + kw.join("\n");
    if (!ui.enriched || ui.enriched.stamp !== stamp) ui.enriched = { stamp: stamp, list: S.enrich(ui.lib.posts, kw, new Date()) };
    return ui.enriched.list;
  }

  // Before the library has loaded (or on a server without one): the latest run's posts, in the same shape.
  function latestRunPosts() {
    const S = statsLib();
    const run = currentRun();
    if (!S || !run) return [];
    const posts = collectDiscoveries(run).map(function (d) {
      return Object.assign({
        key: d.platform + "_" + d.item.id, platform: d.platform, firstSeenAt: null, lastSeenAt: run.finishedAt || null, seenCount: 1,
        prevViews: null, prevSeenAt: null, queries: d.via ? [d.via] : [], sessions: [], bookmarked: false
      }, d.item);
    });
    return S.enrich(posts, niche().keywords, new Date());
  }

  function latestSessionId() {
    const server = api.getStatus();
    const first = server && Array.isArray(server.nicheRuns) && server.nicheRuns[0];
    const run = currentRun();
    return (run && run.id) || (first && first.id) || "";
  }

  function viewsChangeText(p) {
    const S = statsLib();
    const c = S ? S.viewsChange(p) : null;
    if (!c || c.change === 0) return "";
    return "Views " + (c.change > 0 ? "+" : "−") + formatCompact(Math.abs(c.change)) + " since " + shortDate(c.since);
  }

  function libraryCard(p, canBookmark) {
    const S = statsLib();
    const card = el("article", "nr-find");
    const top = el("div", "nr-find-top");
    top.appendChild(el("span", "nr-chip nr-chip-" + p.platform, platformLabel(p.platform)));
    if (p.queries && p.queries.length) top.appendChild(el("span", "nr-chip nr-chip-plain", "Found by " + p.queries[0] + (p.queries.length > 1 ? " +" + (p.queries.length - 1) : "")));
    if (canBookmark && p.seenCount === 1 && p.sessions.indexOf(latestSessionId()) !== -1) top.appendChild(el("span", "nr-chip nr-chip-new", "New"));
    if (p.relevance !== null && p.relevance !== undefined && p.relevance >= S.RELEVANT_MIN && p.matched && p.matched.length) {
      top.appendChild(el("span", "nr-chip nr-chip-match", "Matches " + p.matched[0] + (p.matched.length > 1 ? " +" + (p.matched.length - 1) : "")));
    }
    if (p.dupOf) top.appendChild(el("span", "nr-chip nr-chip-plain", "Same caption as another post"));
    if (p.seenCount > 1) top.appendChild(el("span", "nr-chip nr-chip-plain", "Seen " + p.seenCount + " times"));
    card.appendChild(top);
    card.appendChild(el("h3", "nr-find-title nr-find-caption" + (p.text ? "" : " nr-muted"), p.text || "No caption provided"));
    const meta = [];
    if (typeof p.author === "string" && p.author) meta.push("by @" + p.author);
    if (typeof p.publishedAt === "string" && p.publishedAt) meta.push("posted " + formatDay(p.publishedAt));
    if (meta.length) card.appendChild(el("p", "nr-find-meta", meta.join(" · ")));

    const stats = el("dl", "nr-stats");
    [["Views", p.views], ["Likes", p.likes], ["Comments", p.comments], ["Shares", p.shares]].forEach(function (pair) {
      if (typeof pair[1] === "number") stats.appendChild(statItem(pair[0], pair[1]));
    });
    if (typeof p.rate === "number") {
      const wrap = el("div", "nr-stat");
      wrap.appendChild(el("dt", "nr-stat-label", "Engagement"));
      wrap.appendChild(el("dd", "nr-stat-value", S.formatRate(p.rate)));
      stats.appendChild(wrap);
    }
    if (stats.childNodes.length) card.appendChild(stats);
    const change = viewsChangeText(p);
    if (change) card.appendChild(el("p", "nr-find-meta nr-change", change));

    const foot = el("div", "nr-find-foot");
    // Only a link on the right site, over https, is ever shown as a link.
    const link = typeof p.url === "string" ? normalizeSourceUrl(p.url) : { ok: false };
    if (link.ok && link.platform === p.platform) {
      let host = "";
      try { host = new URL(link.url).hostname.replace(/^www\./, ""); } catch (e) { host = "source"; }
      foot.appendChild(externalLink(link.url, "Open on " + host + " ↗", "nr-link", "Open the original " + platformLabel(p.platform) + " post"));
    } else {
      foot.appendChild(el("span", "nr-muted", "No link provided"));
    }
    if (canBookmark) {
      const bm = el("button", "nr-btn nr-btn-ghost nr-btn-small nr-bm" + (p.bookmarked ? " on" : ""), p.bookmarked ? "★ Bookmarked" : "☆ Bookmark");
      bm.type = "button";
      bm.setAttribute("aria-pressed", p.bookmarked ? "true" : "false");
      bm.setAttribute("aria-label", (p.bookmarked ? "Remove bookmark: " : "Bookmark post: ") + (p.text || "no caption").slice(0, 40));
      bm.disabled = !!ui.bookmarkBusy[p.key];
      bm.addEventListener("click", function () { toggleBookmark(p); });
      foot.appendChild(bm);
    }
    card.appendChild(foot);
    card.appendChild(el("p", "nr-provenance", "Reported by InsightSocial · not verified by JARVIS" + (p.firstSeenAt ? " · first found " + shortDate(p.firstSeenAt) : "")));
    return card;
  }

  function toggleBookmark(p) {
    if (ui.bookmarkBusy[p.key]) return;
    const want = !p.bookmarked;
    const set = function (value) {
      ui.lib.posts.forEach(function (x) { if (x.key === p.key) x.bookmarked = value; });
      ui.enriched = null;
    };
    ui.bookmarkBusy[p.key] = true;
    set(want);
    renderDiscoveries();
    renderBookmarks();
    api.callServer("marketingLibrary", { action: "bookmark", key: p.key, bookmarked: want }, { timeout: 20000 }).then(function (res) {
      if (!res || res.ok !== true) throw new Error("unexpected reply");
      api.core().showToast(want ? "Bookmarked." : "Bookmark removed.");
    }).catch(function (err) {
      set(!want);
      api.core().showToast(err && err.message === "unexpected reply" ? "Couldn't save the bookmark." : api.describeCallError(err));
    }).then(function () {
      delete ui.bookmarkBusy[p.key];
      renderDiscoveries();
      renderBookmarks();
    });
  }

  function currentFilter() {
    const f = Object.assign({}, ui.f);
    return f;
  }

  // How many of the "More filters" are changed from their defaults.
  function activeFilterCount() {
    const d = LIB_DEFAULT_FILTER;
    return ["days", "minViews", "minRate", "relevantOnly", "bookmarkedOnly", "hideDupes", "session"].filter(function (k) { return ui.f[k] !== d[k]; }).length;
  }

  function syncFilterControls() {
    const search = $("nrLibSearch");
    if (document.activeElement !== search) search.value = ui.f.search;
    $("nrLibSort").value = ui.sort;
    $("nrLibDays").value = String(ui.f.days);
    $("nrLibViews").value = String(ui.f.minViews);
    $("nrLibRate").value = String(ui.f.minRate);
    $("nrLibRelevant").checked = ui.f.relevantOnly;
    $("nrLibBookmarked").checked = ui.f.bookmarkedOnly;
    $("nrLibDupes").checked = ui.f.hideDupes;
    const sel = $("nrLibSession");
    const server = api.getStatus();
    const runs = server && Array.isArray(server.nicheRuns) ? server.nicheRuns : [];
    sel.textContent = "";
    const all = el("option", "", "All research");
    all.value = "";
    sel.appendChild(all);
    runs.forEach(function (r) {
      if (!r || typeof r.id !== "string") return;
      const o = el("option", "", timeText(r.finishedAt || r.startedAt) + " · " + (r.mode === "lean" ? "quick refresh" : r.mode === "full" ? "full sweep" : "research"));
      o.value = r.id;
      sel.appendChild(o);
    });
    // A session that has aged out of the server's list can't be picked; fall back to everything.
    if (ui.f.session && !runs.some(function (r) { return r && r.id === ui.f.session; })) ui.f.session = "";
    sel.value = ui.f.session;
    const n = activeFilterCount();
    $("nrLibMoreSummary").textContent = n ? "More filters (" + n + " changed)" : "More filters";
    $("nrLibResetBtn").disabled = !n && !ui.f.search && ui.f.platform === "all" && ui.sort === "views";
  }

  function resetFilters() {
    ui.f = Object.assign({}, LIB_DEFAULT_FILTER);
    ui.sort = "views";
    ui.libShown = LIB_PAGE;
    renderDiscoveries();
  }

  function hiddenNotes(hidden) {
    const bits = [];
    if (hidden.undated) bits.push(hidden.undated + (hidden.undated === 1 ? " post has" : " posts have") + " no publish date, so the date filter hides " + (hidden.undated === 1 ? "it" : "them"));
    if (hidden.noViews) bits.push(hidden.noViews + (hidden.noViews === 1 ? " post doesn't" : " posts don't") + " report views, so the views filter hides " + (hidden.noViews === 1 ? "it" : "them"));
    if (hidden.noRate) bits.push(hidden.noRate + (hidden.noRate === 1 ? " post has" : " posts have") + " too few views to work out an engagement rate");
    if (hidden.noCaption) bits.push(hidden.noCaption + (hidden.noCaption === 1 ? " post has" : " posts have") + " no caption to compare with your keywords");
    return bits.length ? bits.join("; ") + "." : "";
  }

  function renderDiscoveries() {
    const S = statsLib();
    const hint = $("nrDiscHint");
    const filters = $("nrDiscFilters");
    const box = $("nrDisc");
    const count = $("nrLibCount");
    filters.textContent = "";
    box.textContent = "";
    count.textContent = "";
    if (!S) { hint.textContent = "The numbers helper didn't load. Refresh the page and try again."; return; }
    syncFilterControls();
    const lib = ui.lib;
    const asReceived = "Posts, numbers and links are shown as received from InsightSocial. JARVIS hasn't verified or analyzed them yet; AI analysis comes in a later update.";
    let list;
    let fromLibrary = false;
    if (lib.status === "ready") {
      list = enrichedLibrary();
      fromLibrary = true;
      hint.textContent = list.length
        ? "Every post your searches found, kept so you can filter and sort across all of your research. Browsing costs no credits. " + asReceived
        : "Your library is empty. Press Research My Niche to fill it. Posts appear here with links to the originals.";
    } else {
      list = latestRunPosts();
      const run = currentRun();
      if (lib.status === "loading") {
        hint.textContent = "Loading your research library…";
      } else if (lib.status === "error") {
        hint.textContent = "Couldn't load your research library: " + lib.error + (list.length ? " Showing only your latest research for now." : "");
      } else if (api.getStatus() && !supportsModes()) {
        const when = run ? timeText(run.finishedAt) : "";
        hint.textContent = (run ? "From the search" + (when ? " on " + when : "") + ". " : "No search results yet. Press Research My Niche to search Instagram and TikTok. ") +
          "Your Marketing server needs the latest update to keep a research library, so only your latest research is shown. It has to be redeployed from Cloud Shell." +
          (list.length ? " " + asReceived : "");
      } else if (!run) {
        hint.textContent = "No search results yet. Press Research My Niche to search Instagram and TikTok. Posts appear here with links to the originals.";
      } else {
        const when = timeText(run.finishedAt);
        hint.textContent = "From the search" + (when ? " on " + when : "") + ". " + asReceived;
      }
      if (lib.status === "error") {
        const retry = el("button", "nr-btn nr-btn-ghost nr-btn-small", "Try again");
        retry.type = "button";
        retry.addEventListener("click", function () { loadLibrary(true); });
        box.appendChild(retry);
      }
    }
    const platformCounts = { all: 0, instagram: 0, tiktok: 0 };
    // Counts follow every filter except the platform, so the chips show what each would give.
    // (The latest-run view has no filters besides the platform.)
    const withoutPlatform = S.filterPosts(list, fromLibrary ? Object.assign(currentFilter(), { platform: "all" }) : NO_FILTER);
    withoutPlatform.posts.forEach(function (p) { platformCounts.all++; if (platformCounts[p.platform] !== undefined) platformCounts[p.platform]++; });
    const controls = $("nrLibMore").parentNode;
    const hasAny = list.length > 0;
    Array.prototype.forEach.call(controls.querySelectorAll(".nr-libsearch, .nr-libsort, .nr-morefilters"), function (e) { e.classList.toggle("hidden", !hasAny || !fromLibrary); });
    filters.classList.toggle("hidden", !hasAny);
    if (!hasAny) {
      const run = currentRun();
      if (!fromLibrary && run && lib.status !== "loading") {
        box.appendChild(el("p", "nr-empty", run.ok
          ? "The searches ran but returned no posts for your keywords. Try broader keywords in Edit niche."
          : "No results came back. The Research sources card below says what happened with each search."));
      }
      return;
    }
    [["all", "All"], ["instagram", "Instagram"], ["tiktok", "TikTok"]].forEach(function (pair) {
      const b = el("button", "nr-filter" + (ui.f.platform === pair[0] ? " active" : ""), pair[1] + " (" + platformCounts[pair[0]] + ")");
      b.type = "button";
      b.setAttribute("aria-pressed", ui.f.platform === pair[0] ? "true" : "false");
      b.addEventListener("click", function () { ui.f.platform = pair[0]; ui.libShown = LIB_PAGE; renderDiscoveries(); });
      filters.appendChild(b);
    });
    // The fallback view (latest run only) has no filters of its own besides platform.
    const result = fromLibrary
      ? S.filterPosts(list, currentFilter())
      : S.filterPosts(list, Object.assign({}, NO_FILTER, { platform: ui.f.platform }));
    const sorted = S.sortPosts(result.posts, fromLibrary ? ui.sort : "views");
    const shown = sorted.slice(0, ui.libShown);
    count.textContent = (sorted.length === list.length ? "Showing " + shown.length + " of " + sorted.length + " posts." : "Showing " + shown.length + " of " + sorted.length + " matching posts (" + list.length + " in all).") +
      (fromLibrary ? " " + hiddenNotes(result.hidden) : "");
    if (!sorted.length) {
      box.appendChild(el("p", "nr-empty", fromLibrary
        ? "No posts match these filters. Try “Reset filters”, or widen the date range under More filters."
        : "No " + platformLabel(ui.f.platform) + " results in this run."));
      return;
    }
    shown.forEach(function (p) { box.appendChild(libraryCard(p, fromLibrary)); });
    if (sorted.length > shown.length) {
      const more = el("button", "nr-btn nr-btn-ghost", "Show " + Math.min(LIB_PAGE, sorted.length - shown.length) + " more (" + (sorted.length - shown.length) + " left)");
      more.type = "button";
      more.addEventListener("click", function () { ui.libShown += LIB_PAGE; renderDiscoveries(); });
      box.appendChild(more);
    }
  }

  // Bookmarked research posts, shown in the Saved Library tab.
  function renderBookmarks() {
    const box = $("nrBookmarks");
    if (!box) return;
    box.textContent = "";
    const S = statsLib();
    const lib = ui.lib;
    if (!S) return;
    if (lib.status === "ready") {
      const list = enrichedLibrary().filter(function (p) { return p.bookmarked; })
        .sort(function (a, b) { return String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || "")); });
      if (!list.length) {
        box.appendChild(el("p", "nr-empty", "No bookmarks yet. In Discover, tap Bookmark on a post worth keeping and it shows up here."));
        return;
      }
      const shown = list.slice(0, ui.bmShown || LIB_PAGE);
      shown.forEach(function (p) { box.appendChild(libraryCard(p, true)); });
      if (list.length > shown.length) {
        const more = el("button", "nr-btn nr-btn-ghost", "Show more (" + (list.length - shown.length) + " left)");
        more.type = "button";
        more.addEventListener("click", function () { ui.bmShown = (ui.bmShown || LIB_PAGE) + LIB_PAGE; renderBookmarks(); });
        box.appendChild(more);
      }
      return;
    }
    if (lib.status === "error") {
      box.appendChild(el("p", "nr-empty", "Couldn't load your bookmarks: " + lib.error));
      const retry = el("button", "nr-btn nr-btn-ghost nr-btn-small", "Try again");
      retry.type = "button";
      retry.addEventListener("click", function () { loadLibrary(true); });
      box.appendChild(retry);
      return;
    }
    const server = api.getStatus();
    box.appendChild(el("p", "nr-empty",
      lib.status === "loading" ? "Loading your bookmarks…"
        : !api.isSignedIn() ? "Sign in to JARVIS to use the research library."
        : server && !supportsModes() ? "Bookmarks need the latest Marketing server update. It has to be redeployed from Cloud Shell."
        : server ? "Your bookmarks load when you open this tab." : "Bookmarks appear here once your Marketing server is connected."));
  }

  /* ---------------- trending content (your finds) ---------------- */

  function statItem(label, value) {
    const wrap = el("div", "nr-stat");
    wrap.appendChild(el("dt", "nr-stat-label", label));
    wrap.appendChild(el("dd", "nr-stat-value", formatCompact(value)));
    return wrap;
  }

  function findCard(f) {
    const card = el("article", "nr-find");
    const top = el("div", "nr-find-top");
    top.appendChild(el("span", "nr-chip nr-chip-" + f.platform, platformLabel(f.platform)));
    if (formatLabel(f.format)) top.appendChild(el("span", "nr-chip nr-chip-plain", formatLabel(f.format)));
    card.appendChild(top);
    card.appendChild(el("h3", "nr-find-title", f.description));
    const metaBits = [];
    if (f.creator) metaBits.push("by " + f.creator);
    if (f.postedAt) metaBits.push("posted " + formatDay(f.postedAt));
    if (metaBits.length) card.appendChild(el("p", "nr-find-meta", metaBits.join(" · ")));

    const stats = el("dl", "nr-stats");
    if (typeof f.views === "number") stats.appendChild(statItem("Views", f.views));
    if (typeof f.likes === "number") stats.appendChild(statItem("Likes", f.likes));
    if (typeof f.comments === "number") stats.appendChild(statItem("Comments", f.comments));
    if (stats.childNodes.length) card.appendChild(stats);

    if (f.hook) {
      const p = el("p", "nr-find-hook");
      p.appendChild(el("span", "nr-find-label", "Opening hook "));
      p.appendChild(document.createTextNode("“" + f.hook + "”"));
      card.appendChild(p);
    }
    if (f.note) {
      const p = el("p", "nr-find-note");
      p.appendChild(el("span", "nr-find-label", "Your note "));
      p.appendChild(document.createTextNode(f.note));
      card.appendChild(p);
    }
    const foot = el("div", "nr-find-foot");
    let host = "";
    try { host = new URL(f.url).hostname.replace(/^www\./, ""); } catch (e) { host = "source"; }
    foot.appendChild(externalLink(f.url, "Open on " + host + " ↗", "nr-link", "Open the original " + platformLabel(f.platform) + " post"));
    const actions = el("span", "nr-find-actions");
    const edit = el("button", "nr-btn nr-btn-ghost nr-btn-small", "Edit");
    edit.type = "button";
    edit.id = "nrEdit_" + f.id;
    edit.setAttribute("aria-label", "Edit saved post: " + f.description.slice(0, 40));
    edit.addEventListener("click", function () { openFindModal(f.id, edit.id); });
    const del = el("button", "nr-btn nr-btn-ghost nr-btn-small nr-btn-danger", "Delete");
    del.type = "button";
    del.setAttribute("aria-label", "Delete saved post: " + f.description.slice(0, 40));
    del.addEventListener("click", function () { deleteFind(f); });
    actions.appendChild(edit);
    actions.appendChild(del);
    foot.appendChild(actions);
    card.appendChild(foot);
    card.appendChild(el("p", "nr-provenance", "Entered by you · not verified by JARVIS"));
    return card;
  }

  function renderFinds() {
    const all = finds().slice().sort(function (a, b) { return String(b.savedAt || "").localeCompare(String(a.savedAt || "")); });
    const counts = { all: all.length, instagram: 0, tiktok: 0 };
    all.forEach(function (f) { if (counts[f.platform] !== undefined) counts[f.platform]++; });
    const filters = $("nrFindFilters");
    filters.textContent = "";
    [["all", "All"], ["instagram", "Instagram"], ["tiktok", "TikTok"]].forEach(function (pair) {
      const b = el("button", "nr-filter" + (ui.filter === pair[0] ? " active" : ""), pair[1] + " (" + counts[pair[0]] + ")");
      b.type = "button";
      b.setAttribute("aria-pressed", ui.filter === pair[0] ? "true" : "false");
      b.addEventListener("click", function () { ui.filter = pair[0]; ui.showAllFinds = false; renderFinds(); });
      filters.appendChild(b);
    });

    const box = $("nrFinds");
    box.textContent = "";
    const list = ui.filter === "all" ? all : all.filter(function (f) { return f.platform === ui.filter; });
    if (!all.length) {
      box.appendChild(el("p", "nr-empty", "No saved posts yet. Open a search in Discover, find a post that's doing well, then tap Save a post to keep its link and numbers."));
      return;
    }
    if (!list.length) {
      box.appendChild(el("p", "nr-empty", "No saved " + platformLabel(ui.filter) + " posts yet."));
      return;
    }
    const shown = ui.showAllFinds ? list : list.slice(0, FINDS_PREVIEW);
    shown.forEach(function (f) { box.appendChild(findCard(f)); });
    if (list.length > FINDS_PREVIEW) {
      const more = el("button", "nr-btn nr-btn-ghost", ui.showAllFinds ? "Show fewer" : "Show all " + list.length);
      more.type = "button";
      more.addEventListener("click", function () { ui.showAllFinds = !ui.showAllFinds; renderFinds(); });
      box.appendChild(more);
    }
  }

  function deleteFind(f) {
    if (!window.confirm("Delete this saved post? This can't be undone.")) return;
    api.commit(function (st) { st.finds = st.finds.filter(function (x) { return x.id !== f.id; }); })
      .catch(function (err) { api.core().showToast(api.describeDataError(err)); });
  }

  /* ---------------- content opportunities ---------------- */

  function renderOpportunities() {
    const box = $("nrOpps");
    box.textContent = "";
    const ideas = api.getIdeas().slice().sort(function (a, b) { return String(b.createdAt || "").localeCompare(String(a.createdAt || "")); }).slice(0, 3);
    if (!ideas.length) {
      box.appendChild(el("p", "nr-empty", "No ideas saved yet. Add your own in the Saved Library, or generate some in the Content Studio once your Marketing server is set up."));
    }
    ideas.forEach(function (i) {
      const row = el("div", "nr-idea");
      const head = el("div", "nr-idea-head");
      head.appendChild(el("h3", "nr-idea-title", i.title || "Untitled idea"));
      head.appendChild(el("span", "nr-chip nr-chip-plain", IDEA_STATUS[i.status] || "Draft"));
      row.appendChild(head);
      if (i.hook) row.appendChild(el("p", "nr-idea-hook", i.hook));
      box.appendChild(row);
    });
    const actions = el("div", "nr-actions-row");
    const lib = el("button", "nr-btn nr-btn-ghost", ideas.length ? "Open Saved Library" : "Add an idea");
    lib.type = "button";
    lib.addEventListener("click", function () { api.showTab("mktSubNavLibrary"); });
    const gen = el("button", "nr-btn nr-btn-ghost", "Content Studio");
    gen.type = "button";
    gen.addEventListener("click", function () { api.showTab("mktSubNavIdeas"); });
    actions.appendChild(lib);
    actions.appendChild(gen);
    box.appendChild(actions);
  }

  /* ---------------- status strip, research summary, history, AI state ---------------- */

  function stripChip(state, text) {
    const v = STATUS_VIEW[state];
    const li = el("li", "nr-strip-item nr-status-" + v.cls);
    li.appendChild(el("span", "nr-status-icon", v.icon)).setAttribute("aria-hidden", "true");
    li.appendChild(document.createTextNode(" " + text));
    return li;
  }

  // Three quick answers to "can I use this right now?", each as icon plus words.
  function renderStatusStrip() {
    const ul = $("nrStatusStrip");
    ul.textContent = "";
    const server = api.getStatus();
    if (!api.isSignedIn()) ul.appendChild(stripChip("unavailable", "Signed out"));
    else if (server) ul.appendChild(stripChip("ready", "Server connected"));
    else if (api.isChecking()) ul.appendChild(stripChip("running", "Checking server"));
    else ul.appendChild(stripChip("failed", "Server not reachable"));
    ul.appendChild(server ? (server.keyConfigured ? stripChip("ready", "InsightSocial key set") : stripChip("unavailable", "InsightSocial key missing"))
      : stripChip("unavailable", "InsightSocial unknown"));
    ul.appendChild(server ? (server.aiKeyConfigured ? stripChip("ready", "Claude AI ready") : stripChip("unavailable", "Claude AI off"))
      : stripChip("unavailable", "Claude AI unknown"));
  }

  function topPostRow(d) {
    const it = d.item;
    const row = el("div", "nr-toprow");
    const head = el("div", "nr-toprow-head");
    head.appendChild(el("span", "nr-chip nr-chip-" + d.platform, platformLabel(d.platform)));
    head.appendChild(el("span", "nr-toprow-views", formatCompact(it.views) + " views"));
    row.appendChild(head);
    row.appendChild(el("p", "nr-toprow-text" + (it.text ? "" : " nr-muted"), it.text || "No caption provided"));
    const link = typeof it.url === "string" ? normalizeSourceUrl(it.url) : { ok: false };
    if (link.ok && link.platform === d.platform) {
      let host = "";
      try { host = new URL(link.url).hostname.replace(/^www\./, ""); } catch (e) { host = "source"; }
      row.appendChild(externalLink(link.url, "Open on " + host + " ↗", "nr-link", "Open the original " + platformLabel(d.platform) + " post"));
    }
    return row;
  }

  // Everything here is arithmetic on the posts InsightSocial returned: no AI, nothing estimated.
  function renderSummary() {
    const S = statsLib();
    const run = currentRun();
    const st = currentStats();
    const note = $("nrSummaryNote");
    const list = $("nrSummary");
    const top = $("nrTopPosts");
    list.textContent = "";
    top.textContent = "";
    $("nrSeeAllBtn").classList.toggle("hidden", !st || !st.posts);
    if (!S || !st) {
      note.textContent = "No research yet. Press Research My Niche above. This section stays empty until there is real data.";
      top.appendChild(el("p", "nr-empty", "Your most viewed posts will appear here after your first research."));
    } else {
      const when = timeText(run.finishedAt);
      note.textContent = "From the research" + (when ? " finished " + when : "") + ". Calculated directly from what InsightSocial returned. No AI involved.";
      S.describeRun(st).forEach(function (line) { list.appendChild(el("li", "", line)); });
      if (st.topByViews.length) st.topByViews.forEach(function (d) { top.appendChild(topPostRow(d)); });
      else top.appendChild(el("p", "nr-empty", "None of these posts reported a view count."));
    }
    const server = api.getStatus();
    $("nrBriefNote").textContent = server && server.aiKeyConfigured
      ? "A Claude key is set. The written brief (executive summary, top opportunities, next steps) arrives in a later update."
      : "The written brief arrives in a later update. It needs a Claude key, which isn't set yet. Until then, the numbers above are the whole report.";
  }

  function modeName(m) { return m === "lean" ? "quick refresh" : "full sweep"; }

  // The sessions the server remembers (its newest 20), each with a way to open its posts.
  function renderSessions() {
    const ul = $("nrSessions");
    const note = $("nrHistoryNote");
    ul.textContent = "";
    const server = api.getStatus();
    if (!server) {
      note.textContent = api.isChecking() ? "Checking for your Marketing server…" : "Past sessions appear here once your Marketing server is connected.";
      return;
    }
    if (!supportsModes()) {
      note.textContent = "Only the latest session is shown until your Marketing server gets the latest update. It has to be redeployed from Cloud Shell.";
      return;
    }
    const runs = server.nicheRuns;
    note.textContent = runs.length
      ? "Your last " + runs.length + (runs.length === 1 ? " session" : " sessions") + " (the server keeps 20). “View posts” opens the library filtered to that session. Looking costs no credits."
      : "No sessions yet. They appear here after your first research.";
    runs.forEach(function (r) {
      if (!r || typeof r.id !== "string") return;
      const li = el("li", "nr-session");
      const head = el("div", "nr-session-head");
      head.appendChild(el("span", "nr-session-when", timeText(r.finishedAt || r.startedAt) || "—"));
      head.appendChild(el("span", "nr-chip nr-chip-plain", r.mode === "lean" || r.mode === "full" ? modeName(r.mode) : "research"));
      if (r.ok === false) head.appendChild(el("span", "nr-chip nr-status-bad", "no results"));
      li.appendChild(head);
      const bits = [];
      if (typeof r.searches === "number") bits.push(r.searches + (r.searches === 1 ? " search" : " searches"));
      if (typeof r.posts === "number") bits.push(r.posts + (r.posts === 1 ? " post" : " posts") + (typeof r.newPosts === "number" ? " (" + r.newPosts + " new)" : ""));
      bits.push(typeof r.creditsUsed === "number" && r.creditsUsed > 0 ? r.creditsUsed + " credits" : "no credits used");
      if (r.failures) bits.push(r.failures + " failed");
      li.appendChild(el("p", "nr-session-facts", bits.join(" · ")));
      if (r.balance && typeof r.balance.unexplained === "number" && r.balance.unexplained > 0) {
        li.appendChild(el("p", "nr-session-warn", "InsightSocial's balance dropped " + r.balance.unexplained.toLocaleString() + " more than the searches reported."));
      }
      const btn = el("button", "nr-btn nr-btn-ghost nr-btn-small", "View posts");
      btn.type = "button";
      btn.setAttribute("aria-label", "View posts from the session on " + (timeText(r.finishedAt || r.startedAt) || "this date"));
      btn.addEventListener("click", function () { viewSession(r.id); });
      li.appendChild(btn);
      ul.appendChild(li);
    });
  }

  function viewSession(id) {
    ui.f = Object.assign({}, LIB_DEFAULT_FILTER, { session: id, days: 0, hideDupes: false });
    ui.sort = "views";
    ui.libShown = LIB_PAGE;
    api.showTab("mktSubNavDiscover");
    $("nrLibMore").open = true;
    loadLibrary(false);
    renderDiscoveries();
    scrollToCard("nrDiscCard");
  }

  function renderHistory() {
    renderSessions();
    const box = $("nrHistoryLatest");
    box.textContent = "";
    const run = currentRun();
    const st = currentStats();
    if (!run || !st) {
      box.appendChild(el("p", "nr-empty", "No research has run yet. Press Research My Niche on the Overview."));
      return;
    }
    const cached = run.sources.filter(function (s) { return s.status === "cached"; }).length;
    const rows = [
      ["Finished", timeText(run.finishedAt) || "—"],
      ["Started by", st.trigger === "scheduled" ? "the daily schedule" : "you"]
    ];
    if (run.mode === "lean" || run.mode === "full") rows.push(["Type", modeName(run.mode)]);
    rows.push(
      ["Searches", st.searches.ok + " of " + st.searches.total + " returned results"],
      ["Posts found", st.posts.toLocaleString()]
    );
    if (run.library && typeof run.library.created === "number") rows.push(["New in your library", run.library.created.toLocaleString()]);
    rows.push(
      ["Credits used", st.creditsUsed.toLocaleString() + (run.runCreditCap ? " (limit " + run.runCreditCap.toLocaleString() + ")" : "")],
      ["Reused saved results", cached + (cached === 1 ? " search" : " searches")]
    );
    const bal = run.balance;
    if (bal && typeof bal.before === "number" && typeof bal.after === "number") {
      rows.push(["InsightSocial balance", bal.before.toLocaleString() + " → " + bal.after.toLocaleString() + " credits"]);
      rows.push(["Balance check", typeof bal.unexplained !== "number" ? "Couldn't be checked"
        : bal.unexplained > 0 ? "Dropped " + bal.unexplained.toLocaleString() + " more than the searches reported"
        : "Matches what the searches reported"]);
    }
    const dl = el("dl", "nr-facts");
    rows.forEach(function (r) {
      const wrap = el("div", "nr-fact");
      wrap.appendChild(el("dt", "nr-fact-label", r[0]));
      wrap.appendChild(el("dd", "nr-fact-value", r[1]));
      dl.appendChild(wrap);
    });
    box.appendChild(dl);
  }

  function renderAnalysis() {
    const badge = $("nrAiState");
    badge.textContent = "";
    const server = api.getStatus();
    const on = !!(server && server.aiKeyConfigured);
    const v = STATUS_VIEW[on ? "ready" : "unavailable"];
    badge.className = "nr-status-badge nr-status-" + v.cls;
    badge.appendChild(el("span", "nr-status-icon", v.icon)).setAttribute("aria-hidden", "true");
    badge.appendChild(document.createTextNode(" " + (on ? "Claude key set" : server ? "No Claude key" : "Not connected")));
  }

  /* ---------------- daily intelligence ---------------- */

  function renderDaily() {
    const server = api.getStatus();
    const line = $("nrDailyStatus");
    if (server) {
      line.textContent = "Your Marketing server is connected. Its daily 8:00 AM Eastern run refreshes competitor numbers only. Niche research runs when you press Research My Niche; daily automatic niche research and reports are added in a later update." +
        (server.lastSuccessfulRunAt ? " Last successful run: " + api.core().formatDateTime(server.lastSuccessfulRunAt) + "." : "");
    } else {
      line.textContent = api.isChecking() ? "Checking for your Marketing server…"
        : "Daily 8:00 AM Eastern research isn't running: it needs the Marketing server, which isn't set up yet.";
    }
    const box = $("nrReports");
    box.textContent = "";
    box.appendChild(el("p", "nr-empty", "No daily reports yet. Each report will list what's new since the last one, with recommended actions."));
  }

  /* ---------------- modals ---------------- */

  function openSheet(id, openerId) {
    ui.openerId = openerId || null;
    api.core().openModal(id);
  }
  function closeSheet(id) {
    api.core().closeModal(id);
    const opener = (ui.openerId && $(ui.openerId)) || $("nrAddFindBtn");
    ui.openerId = null;
    if (opener && opener.focus) opener.focus();
  }

  function openProfileModal() {
    const n = niche();
    $("nrBusinessName").value = n.businessName;
    $("nrIndustry").value = n.industry;
    $("nrAudience").value = n.targetAudience;
    $("nrProductCategory").value = n.productCategory;
    $("nrPersonality").value = n.brandPersonality;
    $("nrCompetitors").value = watchlist().map(function (h) { return "@" + h; }).join("\n");
    $("nrKeywords").value = n.keywords.join("\n");
    $("nrPlatIg").checked = n.platforms.indexOf("instagram") !== -1;
    $("nrPlatTt").checked = n.platforms.indexOf("tiktok") !== -1;
    $("nrProfileError").textContent = "";
    openSheet("nrProfileModal", "nrEditNicheBtn");
    $("nrBusinessName").focus();
  }

  function saveProfile(e) {
    e.preventDefault();
    const err = $("nrProfileError");
    const name = clean($("nrBusinessName").value, 60);
    if (!name) { err.textContent = "Enter your business name."; return; }
    const kw = parseKeywords($("nrKeywords").value);
    if (kw.tooLong.length) { err.textContent = "Keywords can be up to 60 characters: " + kw.tooLong[0]; return; }
    if (!kw.keywords.length) { err.textContent = "Add at least one research keyword."; return; }
    if (kw.overflow) { err.textContent = "Research keywords are limited to " + MAX_KEYWORDS + " so each run stays within budget."; return; }
    const comp = parseHandles($("nrCompetitors").value, api.maxWatchlist);
    if (comp.invalid.length) { err.textContent = "Not a valid Instagram handle: " + comp.invalid[0]; return; }
    if (comp.overflow) { err.textContent = "You can track up to " + api.maxWatchlist + " competitors."; return; }
    const platforms = [];
    if ($("nrPlatIg").checked) platforms.push("instagram");
    if ($("nrPlatTt").checked) platforms.push("tiktok");
    if (!platforms.length) { err.textContent = "Pick at least one platform."; return; }

    const next = sanitizeNiche({
      businessName: name,
      industry: $("nrIndustry").value,
      targetAudience: $("nrAudience").value,
      productCategory: $("nrProductCategory").value,
      brandPersonality: $("nrPersonality").value,
      keywords: kw.keywords,
      platforms: platforms
    });
    const btn = $("nrProfileSaveBtn");
    btn.disabled = true;
    api.commit(function (st) {
      st.niche = next;
      st.settings = api.sanitizeSettings(Object.assign({}, api.getSettings(), { watchlist: comp.handles }));
    }).then(function () {
      api.mirrorSettings();
      closeSheet("nrProfileModal");
      api.core().showToast("Niche saved.");
    }).catch(function (e2) { err.textContent = api.describeDataError(e2); })
      .then(function () { btn.disabled = false; });
  }

  function openFindModal(id, openerId) {
    ui.editingFindId = id || null;
    const f = id ? finds().find(function (x) { return x.id === id; }) : null;
    $("nrFindModalTitle").textContent = f ? "Edit saved post" : "Save a post";
    $("nrFindUrl").value = f ? f.url : "";
    $("nrFindCreator").value = f ? f.creator || "" : "";
    $("nrFindDesc").value = f ? f.description : "";
    $("nrFindDate").value = f ? f.postedAt || "" : "";
    $("nrFindViews").value = f && typeof f.views === "number" ? String(f.views) : "";
    $("nrFindLikes").value = f && typeof f.likes === "number" ? String(f.likes) : "";
    $("nrFindComments").value = f && typeof f.comments === "number" ? String(f.comments) : "";
    $("nrFindFormat").value = f ? f.format || "" : "";
    $("nrFindHook").value = f ? f.hook || "" : "";
    $("nrFindNote").value = f ? f.note || "" : "";
    $("nrFindError").textContent = "";
    $("nrFindDate").max = todayIso();
    openSheet("nrFindModal", openerId || "nrAddFindBtn");
    $("nrFindUrl").focus();
  }

  function saveFind(e) {
    e.preventDefault();
    const err = $("nrFindError");
    const link = normalizeSourceUrl($("nrFindUrl").value);
    if (!link.ok) { err.textContent = link.error; return; }
    const desc = clean($("nrFindDesc").value, 200);
    if (!desc) { err.textContent = "Describe the video in a few words."; return; }
    const date = $("nrFindDate").value;
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayIso())) { err.textContent = "The posted date can't be in the future."; return; }
    const counts = {};
    const bad = [["views", "Views", "nrFindViews"], ["likes", "Likes", "nrFindLikes"], ["comments", "Comments", "nrFindComments"]].filter(function (c) {
      const v = parseCount($(c[2]).value);
      counts[c[0]] = v;
      return v === undefined;
    });
    if (bad.length) { err.textContent = bad[0][1] + " must be a number like 1284 or 12.5K."; return; }
    const dupe = finds().find(function (x) {
      const k = normalizeSourceUrl(x.url);
      return k.ok && k.key === link.key && x.id !== ui.editingFindId;
    });
    if (dupe) { err.textContent = "You've already saved this video."; return; }
    if (!ui.editingFindId && finds().length >= MAX_FINDS) { err.textContent = "You've saved " + MAX_FINDS + " posts, the most Marketing keeps. Delete some old ones first."; return; }

    const record = {
      platform: link.platform,
      url: link.url,
      creator: clean($("nrFindCreator").value, 60),
      description: desc,
      postedAt: date || "",
      views: counts.views,
      likes: counts.likes,
      comments: counts.comments,
      format: FORMATS.some(function (f) { return f.value === $("nrFindFormat").value; }) ? $("nrFindFormat").value : "",
      hook: clean($("nrFindHook").value, 200),
      note: clean($("nrFindNote").value, 400),
      source: "manual"
    };
    const editing = ui.editingFindId;
    const btn = $("nrFindSaveBtn");
    btn.disabled = true;
    api.commit(function (st) {
      if (editing) {
        const i = st.finds.findIndex(function (x) { return x.id === editing; });
        if (i !== -1) st.finds[i] = Object.assign({}, st.finds[i], record, { updatedAt: new Date().toISOString() });
      } else {
        st.finds.push(Object.assign({ id: api.core().uid("find"), savedAt: new Date().toISOString() }, record));
      }
    }).then(function () {
      closeSheet("nrFindModal");
      api.core().showToast(editing ? "Post updated." : "Post saved.");
    }).catch(function (e2) { err.textContent = api.describeDataError(e2); })
      .then(function () { btn.disabled = false; });
  }

  function onKeydown(e) {
    if (e.key !== "Escape") return;
    ["nrProfileModal", "nrFindModal"].forEach(function (id) {
      const m = $(id);
      if (m && !m.classList.contains("hidden")) closeSheet(id);
    });
  }

  /* ---------------- wiring ---------------- */

  function render() {
    if (!api || !api.getStore() || !$("nrResearchBtn")) return;
    renderHero();
    renderStatusStrip();
    renderOverview();
    renderSummary();
    renderAnalysis();
    renderResearchControls();
    renderSources();
    renderDiscoveries();
    renderBookmarks();
    renderFinds();
    renderOpportunities();
    renderDaily();
    renderHistory();
    maybeLoadLibrary();
  }

  // Filters apply as they change; typing in the search box waits a moment so each keystroke doesn't redraw the list.
  function wireLibraryControls() {
    let timer = null;
    const changed = function () { ui.libShown = LIB_PAGE; renderDiscoveries(); };
    $("nrLibSearch").addEventListener("input", function () {
      ui.f.search = $("nrLibSearch").value.slice(0, 80);
      clearTimeout(timer);
      timer = setTimeout(changed, 150);
    });
    $("nrLibSort").addEventListener("change", function () { ui.sort = $("nrLibSort").value; changed(); });
    $("nrLibDays").addEventListener("change", function () { ui.f.days = Number($("nrLibDays").value) || 0; changed(); });
    $("nrLibViews").addEventListener("change", function () { ui.f.minViews = Number($("nrLibViews").value) || 0; changed(); });
    $("nrLibRate").addEventListener("change", function () { ui.f.minRate = Number($("nrLibRate").value) || 0; changed(); });
    $("nrLibSession").addEventListener("change", function () { ui.f.session = $("nrLibSession").value; changed(); });
    $("nrLibRelevant").addEventListener("change", function () { ui.f.relevantOnly = $("nrLibRelevant").checked; changed(); });
    $("nrLibBookmarked").addEventListener("change", function () { ui.f.bookmarkedOnly = $("nrLibBookmarked").checked; changed(); });
    $("nrLibDupes").addEventListener("change", function () { ui.f.hideDupes = $("nrLibDupes").checked; changed(); });
    $("nrLibResetBtn").addEventListener("click", resetFilters);
    // The library loads when Discover or Saved Library opens, not on every app start.
    ["mktSubNavDiscover", "mktSubNavLibrary"].forEach(function (id) {
      const b = $(id);
      if (b) b.addEventListener("click", function () { setTimeout(maybeLoadLibrary, 0); });
    });
  }

  function init(a) {
    api = a;
    if (!$("nrResearchBtn")) return;
    FORMATS.forEach(function (f) { const o = el("option", "", f.label); o.value = f.value; $("nrFindFormat").appendChild(o); });
    $("nrResearchBtn").addEventListener("click", function () { handleResearch("overview"); });
    $("nrResearchBtn2").addEventListener("click", function () { handleResearch("discover"); });
    $("nrModeSwitchBtn").addEventListener("click", function () { handleResearch("discover", otherMode(suggestedMode())); });
    wireLibraryControls();
    $("nrSeeAllBtn").addEventListener("click", function () { api.showTab("mktSubNavDiscover"); });
    $("nrAnalysisGoBtn").addEventListener("click", function () { api.showTab("mktSubNavDiscover"); });
    $("nrEditNicheBtn").addEventListener("click", openProfileModal);
    $("nrProfileForm").addEventListener("submit", saveProfile);
    $("nrProfileCloseBtn").addEventListener("click", function () { closeSheet("nrProfileModal"); });
    $("nrProfileCancelBtn").addEventListener("click", function () { closeSheet("nrProfileModal"); });
    $("nrAddFindBtn").addEventListener("click", function () { openFindModal(null, "nrAddFindBtn"); });
    $("nrAddFindBtn2").addEventListener("click", function () { openFindModal(null, "nrAddFindBtn2"); });
    $("nrFindForm").addEventListener("submit", saveFind);
    $("nrFindCloseBtn").addEventListener("click", function () { closeSheet("nrFindModal"); });
    $("nrFindCancelBtn").addEventListener("click", function () { closeSheet("nrFindModal"); });
    ["nrProfileModal", "nrFindModal"].forEach(function (id) {
      $(id).addEventListener("click", function (e) { if (e.target === $(id)) closeSheet(id); });
    });
    document.addEventListener("keydown", onKeydown);
    render();
  }

  window.JarvisNicheResearch = {
    init: init,
    render: render,
    helpers: {
      sanitizeNiche: sanitizeNiche, parseKeywords: parseKeywords, parseHandles: parseHandles, hashtagOf: hashtagOf,
      normalizeSourceUrl: normalizeSourceUrl, parseCount: parseCount, formatCompact: formatCompact, themeCounts: themeCounts,
      collectDiscoveries: collectDiscoveries, cleanLibraryPost: cleanLibraryPost, DEFAULT_NICHE: DEFAULT_NICHE
    }
  };
})();
