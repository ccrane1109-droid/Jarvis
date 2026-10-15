/* ==========================================================================
   JARVIS — Marketing › Niche (AI Niche Research dashboard, Instagram + TikTok)

   What this tab does today, with no server or API key:
   - Holds the niche profile (business, audience, keywords, platforms,
     competitors) that research will be built from.
   - "Research My Niche" shows the honest state of every source and opens a
     manual research kit: one-tap searches for each keyword on Instagram and
     TikTok, plus a form to save what you find.
   - Saved finds, themes, competitors and ideas shown here all come from data
     you entered or JARVIS stored. Nothing on this tab is sample data.

   Automatic search, AI analysis and daily reports arrive in later updates and
   will plug into the same sections. Until then those sections say so.

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
  const ui = { filter: "all", showAllFinds: false, showAllKeywords: false, editingFindId: null, lastAttempt: null, openerId: null };

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

  function tile(label, value) {
    const t = el("div", "nr-tile");
    t.appendChild(el("p", "nr-tile-label", label));
    t.appendChild(el("p", "nr-tile-value", String(value)));
    return t;
  }

  function renderOverview() {
    const n = niche();
    const box = $("nrTiles");
    box.textContent = "";
    box.appendChild(tile("Finds saved", finds().length));
    box.appendChild(tile("Research keywords", n.keywords.length));
    box.appendChild(tile("Competitors tracked", watchlist().length));
    box.appendChild(tile("Ideas in library", api.getIdeas().length));

    const themes = $("nrThemes");
    themes.textContent = "";
    const list = finds();
    if (list.length < 3) {
      themes.appendChild(el("p", "nr-empty", "Themes appear once you've saved 3 or more finds. Save videos you find in the research kit below, and JARVIS counts which formats keep showing up."));
      return;
    }
    const counts = themeCounts(list);
    if (!counts.length) {
      themes.appendChild(el("p", "nr-empty", "None of your finds have a format yet. Add one when you save a find to see which formats keep showing up."));
      return;
    }
    const max = counts[0].count;
    const ul = el("ul", "nr-bars");
    counts.slice(0, 5).forEach(function (c) {
      const li = el("li", "nr-bar-row");
      const head = el("div", "nr-bar-head");
      head.appendChild(el("span", "nr-bar-label", c.label));
      head.appendChild(document.createTextNode(" "));
      head.appendChild(el("span", "nr-bar-value", c.count + (c.count === 1 ? " find" : " finds")));
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

  function sourceRows(n) {
    const server = api.getStatus();
    const rows = n.platforms.map(function (p) {
      return {
        name: platformLabel(p) + " search",
        status: "unavailable",
        detail: server ? "Automatic search isn't available in this version yet."
          : api.isChecking() ? "Checking for your Marketing server…"
          : "Needs the Marketing server, which isn't set up yet."
      };
    });
    rows.push({ name: "Manual research kit", status: "ready", detail: "Open the searches below and save what you find." });
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
  }

  function handleResearch() {
    ui.lastAttempt = new Date();
    const server = api.getStatus();
    const when = ui.lastAttempt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    $("nrResearchStatus").textContent = "Checked at " + when + ": automatic search is unavailable (" +
      (server ? "not built into this version yet" : "it needs the Marketing server, which isn't set up") +
      "). Use the manual research kit below, and save what you find.";
    renderSources();
    $("nrKit").open = true;
    const card = $("nrSourcesCard");
    if (card && card.scrollIntoView) {
      const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      card.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
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
    edit.setAttribute("aria-label", "Edit find: " + f.description.slice(0, 40));
    edit.addEventListener("click", function () { openFindModal(f.id, edit.id); });
    const del = el("button", "nr-btn nr-btn-ghost nr-btn-small nr-btn-danger", "Delete");
    del.type = "button";
    del.setAttribute("aria-label", "Delete find: " + f.description.slice(0, 40));
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
      box.appendChild(el("p", "nr-empty", "No finds yet. Open a search in the research kit, find a video that's doing well, then tap Add a find to save its link and numbers."));
      return;
    }
    if (!list.length) {
      box.appendChild(el("p", "nr-empty", "No " + platformLabel(ui.filter) + " finds yet."));
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
    if (!window.confirm("Delete this find? This can't be undone.")) return;
    api.commit(function (st) { st.finds = st.finds.filter(function (x) { return x.id !== f.id; }); })
      .catch(function (err) { api.core().showToast(api.describeDataError(err)); });
  }

  /* ---------------- competitors ---------------- */

  function renderCompetitors() {
    const list = watchlist();
    $("nrCompCount").textContent = list.length + " of " + api.maxWatchlist + " tracked";
    const ul = $("nrCompList");
    ul.textContent = "";
    if (!list.length) {
      ul.appendChild(el("li", "nr-empty", "No competitors tracked yet. Add an Instagram handle below, or ones you spot in your research."));
    }
    list.forEach(function (h) {
      const li = el("li", "nr-row");
      li.appendChild(externalLink("https://www.instagram.com/" + encodeURIComponent(h) + "/", "@" + h, "nr-link", "Open @" + h + " on Instagram"));
      const actions = el("span", "nr-find-actions");
      const nums = el("button", "nr-btn nr-btn-ghost nr-btn-small", "Numbers");
      nums.type = "button";
      nums.setAttribute("aria-label", "Log or view numbers for @" + h);
      nums.addEventListener("click", function () { api.showTab("mktSubNavCompetitors"); });
      const rm = el("button", "nr-btn nr-btn-ghost nr-btn-small nr-btn-danger", "Remove");
      rm.type = "button";
      rm.setAttribute("aria-label", "Remove @" + h + " from the watchlist");
      rm.addEventListener("click", function () { removeCompetitor(h); });
      actions.appendChild(nums);
      actions.appendChild(rm);
      li.appendChild(actions);
      ul.appendChild(li);
    });
  }

  function addCompetitor(e) {
    e.preventDefault();
    const msg = $("nrCompMsg");
    const parsed = parseHandles($("nrCompInput").value, api.maxWatchlist + 1);
    if (!parsed.handles.length || parsed.invalid.length) {
      msg.textContent = parsed.invalid.length ? "Not a valid Instagram handle: " + parsed.invalid[0] : "Enter an Instagram handle.";
      return;
    }
    const current = watchlist();
    const fresh = parsed.handles.filter(function (h) { return current.indexOf(h) === -1; });
    if (!fresh.length) { msg.textContent = "Already on your watchlist."; return; }
    if (current.length + fresh.length > api.maxWatchlist) { msg.textContent = "The watchlist holds up to " + api.maxWatchlist + " accounts. Remove one first."; return; }
    api.saveSettings({ watchlist: current.concat(fresh) }).then(function () {
      $("nrCompInput").value = "";
      msg.textContent = "Added " + fresh.map(function (h) { return "@" + h; }).join(", ") + ".";
    }).catch(function (err) { msg.textContent = api.describeDataError(err); });
  }

  function removeCompetitor(handle) {
    if (!window.confirm("Stop tracking @" + handle + "? Numbers you logged are kept.")) return;
    api.saveSettings({ watchlist: watchlist().filter(function (h) { return h !== handle; }) }).then(function () {
      $("nrCompMsg").textContent = "Removed @" + handle + ".";
    }).catch(function (err) { $("nrCompMsg").textContent = api.describeDataError(err); });
  }

  /* ---------------- content opportunities ---------------- */

  function renderOpportunities() {
    const box = $("nrOpps");
    box.textContent = "";
    const ideas = api.getIdeas().slice().sort(function (a, b) { return String(b.createdAt || "").localeCompare(String(a.createdAt || "")); }).slice(0, 3);
    if (!ideas.length) {
      box.appendChild(el("p", "nr-empty", "No ideas saved yet. Add your own in the Library, or generate some in AI Ideas once your Marketing server is set up."));
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
    const lib = el("button", "nr-btn nr-btn-ghost", ideas.length ? "Open Library" : "Add an idea");
    lib.type = "button";
    lib.addEventListener("click", function () { api.showTab("mktSubNavLibrary"); });
    const gen = el("button", "nr-btn nr-btn-ghost", "AI Ideas");
    gen.type = "button";
    gen.addEventListener("click", function () { api.showTab("mktSubNavIdeas"); });
    actions.appendChild(lib);
    actions.appendChild(gen);
    box.appendChild(actions);
  }

  /* ---------------- daily intelligence ---------------- */

  function renderDaily() {
    const server = api.getStatus();
    const line = $("nrDailyStatus");
    if (server) {
      line.textContent = "Your Marketing server is connected. Its daily 8:00 AM Eastern run refreshes competitor numbers only; full niche research and reports are added in a later update." +
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
    $("nrFindModalTitle").textContent = f ? "Edit find" : "Add a find";
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
    if (!ui.editingFindId && finds().length >= MAX_FINDS) { err.textContent = "You've saved " + MAX_FINDS + " finds, the most Marketing keeps. Delete some old ones first."; return; }

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
      api.core().showToast(editing ? "Find updated." : "Find saved.");
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
    if (!api || !api.getStore() || !$("mkt-niche")) return;
    renderHero();
    renderOverview();
    renderSources();
    renderFinds();
    renderCompetitors();
    renderOpportunities();
    renderDaily();
  }

  function init(a) {
    api = a;
    if (!$("mkt-niche")) return;
    FORMATS.forEach(function (f) { const o = el("option", "", f.label); o.value = f.value; $("nrFindFormat").appendChild(o); });
    $("nrResearchBtn").addEventListener("click", handleResearch);
    $("nrEditNicheBtn").addEventListener("click", openProfileModal);
    $("nrProfileForm").addEventListener("submit", saveProfile);
    $("nrProfileCloseBtn").addEventListener("click", function () { closeSheet("nrProfileModal"); });
    $("nrProfileCancelBtn").addEventListener("click", function () { closeSheet("nrProfileModal"); });
    $("nrAddFindBtn").addEventListener("click", function () { openFindModal(null, "nrAddFindBtn"); });
    $("nrFindForm").addEventListener("submit", saveFind);
    $("nrFindCloseBtn").addEventListener("click", function () { closeSheet("nrFindModal"); });
    $("nrFindCancelBtn").addEventListener("click", function () { closeSheet("nrFindModal"); });
    $("nrCompForm").addEventListener("submit", addCompetitor);
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
      DEFAULT_NICHE: DEFAULT_NICHE
    }
  };
})();
