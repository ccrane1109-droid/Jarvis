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
      "Christian streetwear", "Faith-based clothing", "Christian fashion", "Minimalist Christian apparel",
      "Premium streetwear", "Christian lifestyle content", "Clothing brand marketing"
    ],
    platforms: ["instagram", "tiktok"]
  };

  let api = null;
  const DISCOVERY_PREVIEW = 6;
  const ui = {
    filter: "all", showAllFinds: false, showAllKeywords: false, editingFindId: null, lastAttempt: null, openerId: null,
    running: false, run: null, discFilter: "all", showAllDisc: false
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

  function renderTiles() {
    const S = statsLib();
    const st = currentStats();
    const server = api.getStatus();
    const box = $("nrTiles");
    box.textContent = "";
    const none = "No research yet";
    box.appendChild(tile("Posts found", st ? st.posts.toLocaleString() : "—", st ? "in your latest research" : none));
    box.appendChild(tile("Engagement rate", st && st.rated ? S.formatRate(st.avgRate) : "—",
      st ? (st.rated ? "average of " + st.rated + " posts with views" : "needs posts that report views") : none));
    box.appendChild(tile("Posted in 30 days", st && st.dated ? st.fresh + " of " + st.dated : "—",
      st ? (st.dated ? "posts that include a date" : "no dates reported") : none));
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
    $("nrTilesNote").textContent = "Relevant-post counts and emerging themes are added in later updates. They need more research history than JARVIS keeps today.";
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

  function planFor(n) {
    const sp = spec();
    return sp ? sp.planSearches({ keywords: n.keywords, platforms: n.platforms }) : { steps: [], credits: 0, omitted: { tiktok: 0, instagram: 0 } };
  }

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
    const plan = planFor(n);
    const rows = n.platforms.map(function (p) {
      const name = platformLabel(p) + " search";
      if (ui.running) return { name: name, status: "running", detail: "Searching through InsightSocial…" };
      const mine = run ? run.sources.filter(function (s) { return s.platform === p; }) : [];
      if (mine.length) return summarizePlatform(name, mine);
      if (blocker) return { name: name, status: "unavailable", detail: blocker };
      const steps = plan.steps.filter(function (s) { return s.platform === p; });
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
      const changed = !!run && !ui.running && run.sources.map(function (s) { return s.id; }).sort().join("|") !== planFor(n).steps.map(function (s) { return s.id; }).sort().join("|");
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

  // The button, and the sentence under it that says what pressing it will do and cost.
  function renderResearchControls() {
    ["nrResearchBtn", "nrResearchBtn2"].forEach(function (id) {
      const btn = $(id);
      if (!btn) return;
      btn.disabled = ui.running;
      btn.textContent = ui.running ? "Researching…" : "Research My Niche";
      btn.setAttribute("aria-busy", ui.running ? "true" : "false");
    });
    const hint = $("nrResearchHint");
    const blocker = researchBlocker();
    const n = niche();
    if (blocker) {
      hint.textContent = blocker + " Until then this opens your research kit: searches to run yourself and a place to save what you find.";
      return;
    }
    const plan = planFor(n);
    if (!plan.steps.length) { hint.textContent = "Add research keywords and pick a platform in Edit niche to search."; return; }
    const server = api.getStatus();
    const used = server.usage && typeof server.usage.creditsUsed === "number" ? server.usage.creditsUsed : 0;
    const names = n.platforms.map(platformLabel).join(" and ");
    hint.textContent = "Searches " + names + " through InsightSocial: " + plan.steps.length + (plan.steps.length === 1 ? " search" : " searches") +
      ", up to " + plan.credits + " credits (this month: " + used.toLocaleString() + " of " + (server.monthlyCreditCap || 0).toLocaleString() +
      " used; each run is limited to " + (server.researchRunCreditCap || 0).toLocaleString() + "). Results are saved for " + spec().RESULT_TTL_HOURS +
      " hours, so pressing it again costs nothing." + (plan.credits > (server.researchRunCreditCap || 0) ? " Some searches will be skipped by the run limit." : "");
  }

  function runSummaryLine(run) {
    return (run.summary || []).join(" ");
  }

  // The same message shows on Overview and Discover so it's seen wherever the button was pressed.
  function setStatus(text) {
    ["nrResearchStatus", "nrResearchStatus2"].forEach(function (id) { if ($(id)) $(id).textContent = text; });
  }

  function handleResearch(origin) {
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
    if (!planFor(n).steps.length) {
      setStatus("Add research keywords and pick a platform in Edit niche first.");
      return;
    }
    ui.running = true;
    setStatus("Searching " + n.platforms.map(platformLabel).join(" and ") + " through InsightSocial. This can take up to a minute.");
    render();
    if (origin === "discover") scrollToCard("nrSourcesCard");
    api.callServer("researchNiche", { niche: { keywords: n.keywords, platforms: n.platforms } }, { timeout: 300000 }).then(function (res) {
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
      ui.discFilter = "all";
      ui.showAllDisc = false;
      render();
      return api.refreshStatus();
    }).then(function () {
      render();
      if (ui.run) scrollToCard(origin === "discover" ? "nrDiscCard" : "nrSummaryTitle");
    });
  }

  /* ---------------- search results (what InsightSocial found) ---------------- */

  function collectDiscoveries(run) {
    const S = statsLib();
    const out = S ? S.uniquePosts(run) : [];
    out.sort(function (a, b) {
      return (typeof b.item.views === "number" ? b.item.views : -1) - (typeof a.item.views === "number" ? a.item.views : -1);
    });
    return out;
  }

  function discoveryCard(d) {
    const it = d.item;
    const card = el("article", "nr-find");
    const top = el("div", "nr-find-top");
    top.appendChild(el("span", "nr-chip nr-chip-" + d.platform, platformLabel(d.platform)));
    top.appendChild(el("span", "nr-chip nr-chip-plain", "Found by " + d.via));
    card.appendChild(top);
    card.appendChild(el("h3", "nr-find-title nr-find-caption" + (it.text ? "" : " nr-muted"), it.text || "No caption provided"));
    const meta = [];
    if (typeof it.author === "string" && it.author) meta.push("by @" + it.author);
    if (typeof it.publishedAt === "string" && it.publishedAt) meta.push("posted " + formatDay(it.publishedAt));
    if (meta.length) card.appendChild(el("p", "nr-find-meta", meta.join(" · ")));

    const stats = el("dl", "nr-stats");
    [["Views", it.views], ["Likes", it.likes], ["Comments", it.comments], ["Shares", it.shares]].forEach(function (pair) {
      if (typeof pair[1] === "number") stats.appendChild(statItem(pair[0], pair[1]));
    });
    if (stats.childNodes.length) card.appendChild(stats);

    const foot = el("div", "nr-find-foot");
    // Only a link on the right site, over https, is ever shown as a link.
    const link = typeof it.url === "string" ? normalizeSourceUrl(it.url) : { ok: false };
    if (link.ok && link.platform === d.platform) {
      let host = "";
      try { host = new URL(link.url).hostname.replace(/^www\./, ""); } catch (e) { host = "source"; }
      foot.appendChild(externalLink(link.url, "Open on " + host + " ↗", "nr-link", "Open the original " + platformLabel(d.platform) + " post"));
    } else {
      foot.appendChild(el("span", "nr-muted", "No link provided"));
    }
    card.appendChild(foot);
    card.appendChild(el("p", "nr-provenance", "Reported by InsightSocial · not verified by JARVIS"));
    return card;
  }

  function renderDiscoveries() {
    const run = currentRun();
    const hint = $("nrDiscHint");
    const filters = $("nrDiscFilters");
    const box = $("nrDisc");
    filters.textContent = "";
    box.textContent = "";
    if (!run) {
      hint.textContent = "No search results yet. Press Research My Niche to search Instagram and TikTok. Posts appear here with links to the originals.";
      filters.classList.add("hidden");
      return;
    }
    const all = collectDiscoveries(run);
    const when = timeText(run.finishedAt);
    hint.textContent = "From the search" + (when ? " on " + when : "") + ". Every post, number and link here is what InsightSocial returned for your keywords, shown as received. " +
      "JARVIS hasn't verified or analyzed them yet; that comes in a later update.";
    const counts = { all: all.length, instagram: 0, tiktok: 0 };
    all.forEach(function (d) { if (counts[d.platform] !== undefined) counts[d.platform]++; });
    filters.classList.toggle("hidden", !all.length);
    [["all", "All"], ["instagram", "Instagram"], ["tiktok", "TikTok"]].forEach(function (pair) {
      const b = el("button", "nr-filter" + (ui.discFilter === pair[0] ? " active" : ""), pair[1] + " (" + counts[pair[0]] + ")");
      b.type = "button";
      b.setAttribute("aria-pressed", ui.discFilter === pair[0] ? "true" : "false");
      b.addEventListener("click", function () { ui.discFilter = pair[0]; ui.showAllDisc = false; renderDiscoveries(); });
      filters.appendChild(b);
    });
    if (!all.length) {
      box.appendChild(el("p", "nr-empty", run.ok
        ? "The searches ran but returned no posts for your keywords. Try broader keywords in Edit niche."
        : "No results came back. The Research sources card above says what happened with each search."));
      return;
    }
    const list = ui.discFilter === "all" ? all : all.filter(function (d) { return d.platform === ui.discFilter; });
    if (!list.length) { box.appendChild(el("p", "nr-empty", "No " + platformLabel(ui.discFilter) + " results in this run.")); return; }
    const shown = ui.showAllDisc ? list : list.slice(0, DISCOVERY_PREVIEW);
    shown.forEach(function (d) { box.appendChild(discoveryCard(d)); });
    if (list.length > DISCOVERY_PREVIEW) {
      const more = el("button", "nr-btn nr-btn-ghost", ui.showAllDisc ? "Show fewer" : "Show all " + list.length);
      more.type = "button";
      more.addEventListener("click", function () { ui.showAllDisc = !ui.showAllDisc; renderDiscoveries(); });
      box.appendChild(more);
    }
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

  function renderHistory() {
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
      ["Started by", st.trigger === "scheduled" ? "the daily schedule" : "you"],
      ["Searches", st.searches.ok + " of " + st.searches.total + " returned results"],
      ["Posts found", st.posts.toLocaleString()],
      ["Credits used", st.creditsUsed.toLocaleString() + (run.runCreditCap ? " (limit " + run.runCreditCap.toLocaleString() + ")" : "")],
      ["Reused saved results", cached + (cached === 1 ? " search" : " searches")]
    ];
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
    renderFinds();
    renderOpportunities();
    renderDaily();
    renderHistory();
  }

  function init(a) {
    api = a;
    if (!$("nrResearchBtn")) return;
    FORMATS.forEach(function (f) { const o = el("option", "", f.label); o.value = f.value; $("nrFindFormat").appendChild(o); });
    $("nrResearchBtn").addEventListener("click", function () { handleResearch("overview"); });
    $("nrResearchBtn2").addEventListener("click", function () { handleResearch("discover"); });
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
      collectDiscoveries: collectDiscoveries, DEFAULT_NICHE: DEFAULT_NICHE
    }
  };
})();
