/* ==========================================================================
   JARVIS — Video Lab: the rules (pure functions, no page or network access, so they can be tested outside the
   browser).

   The Video Lab follows each video from plan to results: PLAN -> EVALUATE -> PUBLISH -> MEASURE -> DIAGNOSE ->
   IMPROVE -> LEARN. This file holds the part every later step stands on: what a video is, how it is identified,
   how it is linked to the Idea Library and to a campaign, and what is checked before anything is saved.

   Storage: one key, jarvisVideoIntel, in the merge-based cloud backup (see backup-logic.js), shaped
     { version, settings, videos[], campaigns[], evaluations[], snapshots[], curves[], reports[], experiments[], recommendations[] }
   The lists after campaigns are empty until the steps that fill them exist; they are part of the shape now so a
   later update never has to move anything. Every record has a string id and numeric createdAt / updatedAt (ms).

   Deleting is a "tombstone": the record stays, with deletedAt set and updatedAt bumped, so a delete made on one
   device wins over an older copy on another, and Undo is just clearing deletedAt. Tombstones are dropped after
   TOMBSTONE_DAYS.

   A video is one post on one platform. The same piece of work posted on Instagram, TikTok and YouTube Shorts is
   three videos that share a workId (and an ideaId when it came from the Idea Library), because each platform
   reports its own numbers.

   Nothing here invents anything. A number or date that is not known is empty (null or ""), never zero.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisVideoIntel = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KEY = "jarvisVideoIntel";
  const VERSION = 1;
  const TOMBSTONE_DAYS = 90;
  const DAY_MS = 864e5;

  const PLATFORMS = [
    { value: "instagram", label: "Instagram Reels", short: "Instagram" },
    { value: "tiktok", label: "TikTok", short: "TikTok" },
    { value: "youtube", label: "YouTube Shorts", short: "YouTube" }
  ];
  const OBJECTIVES = [
    { value: "awareness", label: "Brand awareness" },
    { value: "engagement", label: "Engagement" },
    { value: "trust", label: "Building trust" },
    { value: "education", label: "Educating viewers" },
    { value: "traffic", label: "Driving website traffic" },
    { value: "sales", label: "Generating sales" }
  ];
  const STRUCTURES = [
    { value: "pas", label: "PAS (Problem, Agitate, Solution)" },
    { value: "story", label: "Storytelling (beginning, conflict, resolution)" },
    { value: "pas_story", label: "PAS combined with storytelling" },
    { value: "other", label: "Another structure" }
  ];
  const STATUSES = [
    { value: "planned", label: "Planned" },
    { value: "evaluated", label: "Evaluated" },
    { value: "published", label: "Published" },
    { value: "measured", label: "Results in" },
    { value: "analyzed", label: "Analyzed" }
  ];
  // Lists the store holds. Only videos and campaigns have rules in this file; the rest are filled by later steps.
  const LISTS = ["videos", "campaigns", "evaluations", "snapshots", "curves", "reports", "experiments", "recommendations"];

  const LIMITS = {
    title: 120, pillar: 40, pillars: 5, hook: 300, script: 8000, note: 1000, structureNote: 120, url: 500, id: 64,
    campaignName: 60, campaignGoal: 200, secondaryObjectives: 5, durationMin: 1, durationMax: 1800
  };

  /* ---------------- small helpers ---------------- */

  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function str(v, max) { return typeof v === "string" ? v.trim().slice(0, max) : ""; }
  function numOrNull(v) { return typeof v === "number" && isFinite(v) ? v : null; }
  function has(list, value) { return list.some(function (x) { return x.value === value; }); }
  function labelOf(list, value, fallback) { const f = list.filter(function (x) { return x.value === value; })[0]; return f ? f.label : (fallback === undefined ? "" : fallback); }

  function isDate(s) {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const p = s.split("-").map(Number);
    const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }
  function isTime(s) { return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }

  // A new id. The caller can pass ctx.id (a function) so tests are deterministic.
  function newId(prefix, ctx) {
    if (ctx && typeof ctx.id === "function") return ctx.id(prefix);
    return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
  }
  function nowOf(ctx) { return ctx && typeof ctx.now === "number" ? ctx.now : Date.now(); }

  /* ---------------- links to the post ---------------- */

  const YT_HOSTS = ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"];
  const TT_HOSTS = ["tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"];
  const IG_HOSTS = ["instagram.com", "www.instagram.com"];

  // A link to a post -> { platform, key, url } or null. `key` is the id the platform puts in the link when there is one
  // (YouTube's 11-character id, TikTok's numeric id, Instagram's short code); a short link (vm.tiktok.com) is recognised
  // as TikTok but has no key. Only https links are accepted. The key is read from the link text; it is not checked
  // with the platform, and an Instagram short code is not the same as the media id the Instagram API uses.
  function parsePostUrl(input) {
    if (typeof input !== "string") return null;
    let u;
    try { u = new URL(input.trim()); } catch (e) { return null; }
    if (u.protocol !== "https:" || u.username || u.password) return null;
    const host = u.hostname.toLowerCase();
    const parts = u.pathname.split("/").filter(Boolean);
    // The link is returned without tracking parameters (?igsh=..., ?si=...); only a YouTube watch link keeps ?v=.
    const out = function (platform, key, query) { return { platform: platform, key: key, url: u.origin + u.pathname + (query || "") }; };
    if (YT_HOSTS.indexOf(host) !== -1) {
      let id = null;
      if (host === "youtu.be") id = parts[0] || null;
      else if (parts[0] === "shorts") id = parts[1] || null;
      else if (parts[0] === "watch") id = u.searchParams.get("v");
      if (id === null || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
      return out("youtube", id, parts[0] === "watch" ? "?v=" + id : "");
    }
    if (TT_HOSTS.indexOf(host) !== -1) {
      const at = parts.findIndex(function (p) { return p === "video"; });
      if (at !== -1 && /^\d{6,25}$/.test(parts[at + 1] || "")) return out("tiktok", parts[at + 1]);
      if ((host === "vm.tiktok.com" || host === "vt.tiktok.com") && /^[A-Za-z0-9]{4,20}$/.test(parts[0] || "")) return out("tiktok", null);
      return null;
    }
    if (IG_HOSTS.indexOf(host) !== -1) {
      const at = parts.findIndex(function (p) { return p === "reel" || p === "reels" || p === "p"; });
      const code = at !== -1 ? parts[at + 1] : null;
      if (code && /^[A-Za-z0-9_-]{5,20}$/.test(code)) return out("instagram", code);
      return null;
    }
    return null;
  }

  /* ---------------- cleaning what is stored (loose: keeps data, never rejects a record with an id) ---------------- */

  function cleanVideo(v) {
    if (!isObj(v) || typeof v.id !== "string" || !v.id || v.id.length > LIMITS.id) return null;
    const obj = isObj(v.objective) ? v.objective : {};
    return Object.assign({}, v, {
      id: v.id,
      title: str(v.title, LIMITS.title),
      platform: str(v.platform, 20),
      ideaId: typeof v.ideaId === "string" && v.ideaId ? v.ideaId.slice(0, LIMITS.id) : null,
      workId: typeof v.workId === "string" && v.workId ? v.workId.slice(0, LIMITS.id) : v.id,
      campaignId: typeof v.campaignId === "string" && v.campaignId ? v.campaignId.slice(0, LIMITS.id) : null,
      pillars: (Array.isArray(v.pillars) ? v.pillars : []).map(function (p) { return str(p, LIMITS.pillar); }).filter(Boolean).slice(0, LIMITS.pillars),
      objective: {
        primary: str(obj.primary, 20),
        secondary: (Array.isArray(obj.secondary) ? obj.secondary : []).map(function (o) { return str(o, 20); }).filter(Boolean).slice(0, LIMITS.secondaryObjectives)
      },
      structure: str(v.structure, 20),
      structureNote: str(v.structureNote, LIMITS.structureNote),
      hook: str(v.hook, LIMITS.hook),
      script: typeof v.script === "string" ? v.script.slice(0, LIMITS.script) : "",
      durationSec: numOrNull(v.durationSec),
      plannedDate: isDate(v.plannedDate) ? v.plannedDate : "",
      publishedDate: isDate(v.publishedDate) ? v.publishedDate : "",
      publishedTime: isTime(v.publishedTime) ? v.publishedTime : "",
      url: str(v.url, LIMITS.url),
      platformKey: typeof v.platformKey === "string" && v.platformKey ? v.platformKey.slice(0, 40) : null,
      notes: str(v.notes, LIMITS.note),
      createdAt: numOrNull(v.createdAt) || 0,
      updatedAt: numOrNull(v.updatedAt) || numOrNull(v.createdAt) || 0,
      deletedAt: numOrNull(v.deletedAt)
    });
  }

  function cleanCampaign(c) {
    if (!isObj(c) || typeof c.id !== "string" || !c.id || c.id.length > LIMITS.id) return null;
    return Object.assign({}, c, {
      id: c.id,
      name: str(c.name, LIMITS.campaignName),
      goal: str(c.goal, LIMITS.campaignGoal),
      startDate: isDate(c.startDate) ? c.startDate : "",
      endDate: isDate(c.endDate) ? c.endDate : "",
      createdAt: numOrNull(c.createdAt) || 0,
      updatedAt: numOrNull(c.updatedAt) || numOrNull(c.createdAt) || 0,
      deletedAt: numOrNull(c.deletedAt)
    });
  }

  function emptyStore() {
    const s = { version: VERSION, settings: {} };
    LISTS.forEach(function (k) { s[k] = []; });
    return s;
  }

  // Anything stored -> a store of the right shape. Unknown lists and settings from a newer version are kept as they are, so
  // an older copy of the app saving the store back does not lose them. Records without a string id are dropped.
  function normalizeStore(raw) {
    const out = emptyStore();
    if (!isObj(raw)) return out;
    Object.keys(raw).forEach(function (k) { if (LISTS.indexOf(k) === -1 && k !== "settings" && k !== "version") out[k] = raw[k]; });
    out.version = typeof raw.version === "number" && raw.version > VERSION ? raw.version : VERSION;
    out.settings = isObj(raw.settings) ? raw.settings : {};
    LISTS.forEach(function (k) {
      const list = Array.isArray(raw[k]) ? raw[k] : [];
      const seen = {};
      out[k] = list.map(function (x) {
        if (k === "videos") return cleanVideo(x);
        if (k === "campaigns") return cleanCampaign(x);
        return isObj(x) && typeof x.id === "string" && x.id ? x : null;
      }).filter(function (x) { if (!x || seen[x.id]) return false; seen[x.id] = true; return true; });
    });
    return out;
  }

  function live(list) { return (Array.isArray(list) ? list : []).filter(function (x) { return x && !x.deletedAt; }); }
  function videos(store) { return live(store && store.videos); }
  function campaigns(store) { return live(store && store.campaigns); }
  function videoById(store, id) { const f = ((store && store.videos) || []).filter(function (v) { return v.id === id; })[0]; return f && !f.deletedAt ? f : null; }
  function campaignById(store, id) { const f = ((store && store.campaigns) || []).filter(function (c) { return c.id === id; })[0]; return f && !f.deletedAt ? f : null; }

  // Removes tombstones older than the window, and anything that belonged to a removed video. -> a new store
  function purgeTombstones(store, now, days) {
    const cutoff = now - (days || TOMBSTONE_DAYS) * DAY_MS;
    const old = function (x) { return x.deletedAt && x.deletedAt < cutoff; };
    const gone = {};
    const next = Object.assign({}, store);
    next.videos = store.videos.filter(function (v) { if (old(v)) { gone[v.id] = true; return false; } return true; });
    next.campaigns = store.campaigns.filter(function (c) { return !old(c); });
    ["evaluations", "snapshots", "curves", "reports", "experiments", "recommendations"].forEach(function (k) {
      next[k] = (store[k] || []).filter(function (x) { return !(x && x.videoId && gone[x.videoId]); });
    });
    return next;
  }

  /* ---------------- checking what the user typed ---------------- */

  function lengthError(label, value, max) { return typeof value === "string" && value.length > max ? label + " is too long (" + max + " characters at most)." : ""; }

  // input: the form's values. ctx: { now, today ("YYYY-MM-DD"), pillars: [the pillar names in Settings], campaigns: [live campaigns],
  //   existing: the video being edited (so a pillar that was renamed in Settings after it was saved is not suddenly an error) }
  // -> { ok: true, value } with the cleaned fields, or { ok: false, errors: { field: message } }
  function checkVideoInput(input, ctx) {
    const inp = isObj(input) ? input : {};
    const c = ctx || {};
    const errors = {};
    const value = {};
    const existing = c.existing || null;

    value.title = str(inp.title, 10000);
    if (!value.title) errors.title = "Give the video a title.";
    else if (value.title.length > LIMITS.title) errors.title = "The title is too long (" + LIMITS.title + " characters at most).";

    value.platform = str(inp.platform, 20);
    if (!has(PLATFORMS, value.platform)) errors.platform = "Choose a platform.";

    const allowedPillars = Array.isArray(c.pillars) ? c.pillars : [];
    const keepOld = existing && Array.isArray(existing.pillars) ? existing.pillars : [];
    const pillarOk = function (p) { return allowedPillars.indexOf(p) !== -1 || keepOld.indexOf(p) !== -1; };
    const pillars = [];
    (Array.isArray(inp.pillars) ? inp.pillars : []).forEach(function (p) { const t = str(p, 10000); if (t && pillars.indexOf(t) === -1) pillars.push(t); });
    if (!pillars.length) errors.pillars = "Choose the content pillar this video belongs to.";
    else if (pillars.length > LIMITS.pillars) errors.pillars = "Choose at most " + LIMITS.pillars + " pillars.";
    else if (!pillars.every(pillarOk)) errors.pillars = "Choose a pillar from your list in Settings.";
    value.pillars = pillars;

    const obj = isObj(inp.objective) ? inp.objective : {};
    const primary = str(obj.primary, 20);
    const secondary = [];
    (Array.isArray(obj.secondary) ? obj.secondary : []).forEach(function (o) { const t = str(o, 20); if (t && secondary.indexOf(t) === -1) secondary.push(t); });
    if (primary && !has(OBJECTIVES, primary)) errors.objective = "Choose one of the listed purposes.";
    else if (!secondary.every(function (o) { return has(OBJECTIVES, o); })) errors.objective = "Choose only listed purposes.";
    else if (secondary.indexOf(primary) !== -1) errors.objective = "The main purpose can't also be a secondary one.";
    else if (secondary.length && !primary) errors.objective = "Choose a main purpose before adding secondary ones.";
    else if (secondary.length > LIMITS.secondaryObjectives) errors.objective = "Too many secondary purposes.";
    value.objective = { primary: primary, secondary: secondary };

    value.structure = str(inp.structure, 20);
    if (value.structure && !has(STRUCTURES, value.structure)) errors.structure = "Choose one of the listed structures.";
    value.structureNote = str(inp.structureNote, 10000);
    const sn = lengthError("The structure note", value.structureNote, LIMITS.structureNote);
    if (sn) errors.structureNote = sn;

    value.hook = typeof inp.hook === "string" ? inp.hook.trim() : "";
    const he = lengthError("The hook", value.hook, LIMITS.hook);
    if (he) errors.hook = he;
    value.script = typeof inp.script === "string" ? inp.script.replace(/\s+$/, "") : "";
    const se = lengthError("The script", value.script, LIMITS.script);
    if (se) errors.script = se;
    value.notes = typeof inp.notes === "string" ? inp.notes.trim() : "";
    const ne = lengthError("The notes", value.notes, LIMITS.note);
    if (ne) errors.notes = ne;

    const dRaw = inp.durationSec;
    if (dRaw === "" || dRaw === null || dRaw === undefined) value.durationSec = null;
    else {
      const d = Number(dRaw);
      if (!isFinite(d) || d < LIMITS.durationMin || d > LIMITS.durationMax) { errors.durationSec = "Enter the length in seconds, from " + LIMITS.durationMin + " to " + LIMITS.durationMax + "."; value.durationSec = null; }
      else value.durationSec = Math.round(d * 10) / 10;
    }

    value.plannedDate = str(inp.plannedDate, 20);
    if (value.plannedDate && !isDate(value.plannedDate)) errors.plannedDate = "Enter a real date.";
    value.publishedDate = str(inp.publishedDate, 20);
    if (value.publishedDate && !isDate(value.publishedDate)) errors.publishedDate = "Enter a real date.";
    else if (value.publishedDate && c.today && value.publishedDate > c.today) errors.publishedDate = "A published date can't be in the future. Use the planned date for a post that isn't out yet.";
    value.publishedTime = str(inp.publishedTime, 10);
    if (value.publishedTime && !isTime(value.publishedTime)) errors.publishedTime = "Enter a time like 18:30.";
    else if (value.publishedTime && !value.publishedDate) errors.publishedTime = "Add the published date too.";

    value.url = str(inp.url, 10000);
    value.platformKey = null;
    if (value.url) {
      const parsed = parsePostUrl(value.url);
      const pf = labelOf(PLATFORMS, value.platform, "that platform");
      if (value.url.length > LIMITS.url) errors.url = "That link is too long.";
      else if (!parsed) errors.url = "That doesn't look like a link to a post. Paste the https link from " + pf + ".";
      else if (value.platform && parsed.platform !== value.platform) errors.url = "That link is for " + labelOf(PLATFORMS, parsed.platform) + ", not " + pf + ".";
      else { value.platformKey = parsed.key; value.url = parsed.url; }
    }

    value.campaignId = typeof inp.campaignId === "string" && inp.campaignId ? inp.campaignId : null;
    if (value.campaignId) {
      const known = (Array.isArray(c.campaigns) ? c.campaigns : []).some(function (x) { return x.id === value.campaignId && !x.deletedAt; });
      const same = existing && existing.campaignId === value.campaignId;
      if (!known && !same) errors.campaignId = "That campaign no longer exists.";
    }

    value.ideaId = typeof inp.ideaId === "string" && inp.ideaId ? inp.ideaId : null;
    return Object.keys(errors).length ? { ok: false, errors: errors } : { ok: true, value: value };
  }

  /* ---------------- videos ---------------- */

  // Makes one video per platform from one form. A link and a published date belong to a single post, so they can only be
  // given when one platform is chosen. -> { ok: true, videos } | { ok: false, errors }
  function makeVideos(input, platforms, ctx) {
    const list = (Array.isArray(platforms) ? platforms : []).filter(function (p, i, a) { return a.indexOf(p) === i; });
    const base = isObj(input) ? input : {};
    // Every problem is reported at once, so one save shows everything to fix (not one problem per try).
    const errors = {};
    if (!list.length) errors.platform = "Choose at least one platform.";
    if (list.length > 1 && (str(base.url, 10000) || str(base.publishedDate, 20) || str(base.publishedTime, 10))) {
      errors.url = "Add the link and the published date to each video separately, after it is out.";
    }
    const first = checkVideoInput(Object.assign({}, base, { platform: list[0] || "" }), ctx);
    if (!first.ok) Object.keys(first.errors).forEach(function (k) { if (!(k in errors) && !(k === "platform" && !list.length)) errors[k] = first.errors[k]; });
    if (Object.keys(errors).length) return { ok: false, errors: errors };
    const now = nowOf(ctx);
    const out = [];
    let workId = null;
    for (let i = 0; i < list.length; i++) {
      const res = checkVideoInput(Object.assign({}, base, { platform: list[i] }), ctx);
      if (!res.ok) return res;
      const id = newId("vid", ctx);
      if (!workId) workId = typeof base.workId === "string" && base.workId ? base.workId : (res.value.ideaId || id);
      out.push(cleanVideo(Object.assign({}, res.value, { id: id, workId: workId, createdAt: now, updatedAt: now, deletedAt: null })));
    }
    return { ok: true, videos: out };
  }

  function addVideos(store, newVideos) {
    const next = Object.assign({}, store);
    next.videos = store.videos.concat(newVideos);
    return next;
  }

  // Changes one video. The platform of a saved video can't change (its numbers belong to that platform). -> { ok, store, video } | { ok: false, errors }
  function updateVideo(store, id, input, ctx) {
    const cur = videoById(store, id);
    if (!cur) return { ok: false, errors: { _: "That video no longer exists." } };
    const c = Object.assign({}, ctx, { existing: cur });
    const res = checkVideoInput(Object.assign({}, input, { platform: cur.platform }), c);
    if (!res.ok) return res;
    const video = cleanVideo(Object.assign({}, cur, res.value, { id: cur.id, workId: cur.workId, ideaId: res.value.ideaId || cur.ideaId, createdAt: cur.createdAt, updatedAt: nowOf(ctx), deletedAt: null }));
    const next = Object.assign({}, store);
    next.videos = store.videos.map(function (v) { return v.id === id ? video : v; });
    return { ok: true, store: next, video: video };
  }

  function setDeleted(list, id, now, deleted) {
    return list.map(function (x) {
      if (x.id !== id) return x;
      return Object.assign({}, x, { deletedAt: deleted ? now : null, updatedAt: Math.max(now, (x.updatedAt || 0) + 1) });
    });
  }
  function removeVideo(store, id, now) { return Object.assign({}, store, { videos: setDeleted(store.videos, id, now, true) }); }
  function restoreVideo(store, id, now) { return Object.assign({}, store, { videos: setDeleted(store.videos, id, now, false) }); }

  // Where a video stands. It moves forward only when the data for the next stage exists; nothing is assumed.
  function statusOf(video, store) {
    const mine = function (list) { return (store && store[list] || []).some(function (x) { return x && x.videoId === video.id && !x.deletedAt; }); };
    if (mine("reports")) return "analyzed";
    if (video.publishedDate && mine("snapshots")) return "measured";
    if (video.publishedDate) return "published";
    if (mine("evaluations")) return "evaluated";
    return "planned";
  }

  // Whole days from a date to another (b - a), both "YYYY-MM-DD".
  function daysBetween(a, b) {
    const pa = a.split("-").map(Number), pb = b.split("-").map(Number);
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / DAY_MS);
  }
  // How long a video has been out, as of `today`: whole days, or null when it has no published date.
  function ageDays(video, today) {
    return video && video.publishedDate && isDate(today) ? Math.max(0, daysBetween(video.publishedDate, today)) : null;
  }
  function ageText(video, today) {
    const d = ageDays(video, today);
    if (d === null) return "";
    return d === 0 ? "out today" : d === 1 ? "out 1 day" : "out " + d + " days";
  }

  /* ---------------- campaigns ---------------- */

  function checkCampaignInput(input, ctx) {
    const inp = isObj(input) ? input : {};
    const c = ctx || {};
    const errors = {};
    const value = { name: str(inp.name, 10000), goal: typeof inp.goal === "string" ? inp.goal.trim() : "", startDate: str(inp.startDate, 20), endDate: str(inp.endDate, 20) };
    if (!value.name) errors.name = "Give the campaign a name.";
    else if (value.name.length > LIMITS.campaignName) errors.name = "The name is too long (" + LIMITS.campaignName + " characters at most).";
    else {
      const same = (Array.isArray(c.campaigns) ? c.campaigns : []).some(function (x) { return !x.deletedAt && x.id !== (c.existingId || "") && x.name.toLowerCase() === value.name.toLowerCase(); });
      if (same) errors.name = "You already have a campaign with that name.";
    }
    const ge = lengthError("The goal", value.goal, LIMITS.campaignGoal);
    if (ge) errors.goal = ge;
    if (value.startDate && !isDate(value.startDate)) errors.startDate = "Enter a real date.";
    if (value.endDate && !isDate(value.endDate)) errors.endDate = "Enter a real date.";
    if (!errors.startDate && !errors.endDate && value.startDate && value.endDate && value.endDate < value.startDate) errors.endDate = "The end can't be before the start.";
    return Object.keys(errors).length ? { ok: false, errors: errors } : { ok: true, value: value };
  }

  function addCampaign(store, input, ctx) {
    const res = checkCampaignInput(input, { campaigns: store.campaigns });
    if (!res.ok) return res;
    const now = nowOf(ctx);
    const camp = cleanCampaign(Object.assign({}, res.value, { id: newId("cmp", ctx), createdAt: now, updatedAt: now, deletedAt: null }));
    return { ok: true, store: Object.assign({}, store, { campaigns: store.campaigns.concat([camp]) }), campaign: camp };
  }
  function updateCampaign(store, id, input, ctx) {
    const cur = campaignById(store, id);
    if (!cur) return { ok: false, errors: { _: "That campaign no longer exists." } };
    const res = checkCampaignInput(input, { campaigns: store.campaigns, existingId: id });
    if (!res.ok) return res;
    const camp = cleanCampaign(Object.assign({}, cur, res.value, { updatedAt: Math.max(nowOf(ctx), (cur.updatedAt || 0) + 1) }));
    return { ok: true, store: Object.assign({}, store, { campaigns: store.campaigns.map(function (x) { return x.id === id ? camp : x; }) }), campaign: camp };
  }
  function removeCampaign(store, id, now) { return Object.assign({}, store, { campaigns: setDeleted(store.campaigns, id, now, true) }); }
  function restoreCampaign(store, id, now) { return Object.assign({}, store, { campaigns: setDeleted(store.campaigns, id, now, false) }); }
  function campaignName(store, id) { const c = campaignById(store, id); return c ? c.name : ""; }
  function videoCountIn(store, campaignId) { return videos(store).filter(function (v) { return v.campaignId === campaignId; }).length; }

  /* ---------------- the Idea Library link ---------------- */

  // The platforms an Idea Library idea is for (its platform setting: instagram, tiktok, youtube or both).
  function platformsForIdea(idea) {
    const p = idea && idea.platform;
    if (p === "both") return ["instagram", "tiktok"];
    return has(PLATFORMS, p) ? [p] : [];
  }
  // Platforms this idea already has a (not deleted) video for.
  function platformsUsed(store, ideaId) {
    return videos(store).filter(function (v) { return v.ideaId === ideaId; }).map(function (v) { return v.platform; });
  }
  // What the Add form starts with for an idea. The pillar is only filled in when it is one of the pillars in Settings.
  function prefillFromIdea(idea, ctx) {
    const pillars = ctx && Array.isArray(ctx.pillars) ? ctx.pillars : [];
    const i = isObj(idea) ? idea : {};
    return {
      ideaId: typeof i.id === "string" ? i.id : null,
      title: str(i.title, LIMITS.title),
      hook: str(i.hook, LIMITS.hook),
      script: typeof i.script === "string" ? i.script.slice(0, LIMITS.script) : "",
      pillars: i.contentPillar && pillars.indexOf(i.contentPillar) !== -1 ? [i.contentPillar] : [],
      plannedDate: isDate(i.plannedDate) ? i.plannedDate : "",
      platforms: platformsForIdea(i)
    };
  }

  /* ---------------- the Library list ---------------- */

  function sortDate(v) { return v.publishedDate || v.plannedDate || ""; }

  // f: { platform, status, campaignId, pillar, query, sort ("recent" | "oldest" | "title") }
  function filterVideos(store, f) {
    const q = f && typeof f.query === "string" ? f.query.trim().toLowerCase() : "";
    const sort = f && f.sort || "recent";
    const out = videos(store).filter(function (v) {
      if (f && f.platform && v.platform !== f.platform) return false;
      if (f && f.status && statusOf(v, store) !== f.status) return false;
      if (f && f.campaignId && v.campaignId !== f.campaignId) return false;
      if (f && f.pillar && v.pillars.indexOf(f.pillar) === -1) return false;
      if (q) {
        const hay = [v.title, v.hook, v.script, v.notes, v.pillars.join(" "), campaignName(store, v.campaignId)].join(" ").toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    out.sort(function (a, b) {
      if (sort === "title") return a.title.toLowerCase() < b.title.toLowerCase() ? -1 : a.title.toLowerCase() > b.title.toLowerCase() ? 1 : 0;
      const da = sortDate(a), db = sortDate(b);
      // a video with no date at all goes last either way, newest-created first among those
      if (!da && !db) return b.createdAt - a.createdAt;
      if (!da) return 1;
      if (!db) return -1;
      if (da !== db) return sort === "oldest" ? (da < db ? -1 : 1) : (da < db ? 1 : -1);
      return b.createdAt - a.createdAt;
    });
    return out;
  }

  return {
    KEY: KEY, VERSION: VERSION, LISTS: LISTS, LIMITS: LIMITS, TOMBSTONE_DAYS: TOMBSTONE_DAYS,
    PLATFORMS: PLATFORMS, OBJECTIVES: OBJECTIVES, STRUCTURES: STRUCTURES, STATUSES: STATUSES,
    isDate: isDate, isTime: isTime, labelOf: labelOf, newId: newId,
    parsePostUrl: parsePostUrl,
    emptyStore: emptyStore, normalizeStore: normalizeStore, purgeTombstones: purgeTombstones,
    videos: videos, campaigns: campaigns, videoById: videoById, campaignById: campaignById,
    checkVideoInput: checkVideoInput, makeVideos: makeVideos, addVideos: addVideos, updateVideo: updateVideo,
    removeVideo: removeVideo, restoreVideo: restoreVideo, statusOf: statusOf, ageDays: ageDays, ageText: ageText, daysBetween: daysBetween,
    checkCampaignInput: checkCampaignInput, addCampaign: addCampaign, updateCampaign: updateCampaign,
    removeCampaign: removeCampaign, restoreCampaign: restoreCampaign, campaignName: campaignName, videoCountIn: videoCountIn,
    platformsForIdea: platformsForIdea, platformsUsed: platformsUsed, prefillFromIdea: prefillFromIdea,
    filterVideos: filterVideos
  };
});
