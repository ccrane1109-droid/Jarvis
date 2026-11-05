/* ==========================================================================
   JARVIS — Content calendar: the rules (pure functions, no page access, so they can be tested outside the browser).

   The Idea Library (Marketing > Content Studio) is where content lives. An idea has a stage, a platform and
   (optionally) a planned date and time. The calendar reads those ideas as items and changes the same fields: nothing
   is copied, so the Idea Library and the calendar can never disagree.

   Stages: Idea, Script, Filming, Editing, Scheduled, Published. Ideas saved before these stages existed keep
   their old value and are shown as the nearest stage until you change them:
     Draft -> Idea, Ready to film -> Filming, Filmed -> Editing, Posted -> Published.

   Nothing here invents anything. "Best times to post" is worked out only from real saved research posts and says
   so when there are not enough of them.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./calendar-logic.js"));
  else root.JarvisContentLogic = factory(root.JarvisCalendarLogic);
})(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";

  const STAGES = [
    { value: "idea", label: "Idea" }, { value: "script", label: "Script" }, { value: "filming", label: "Filming" },
    { value: "editing", label: "Editing" }, { value: "scheduled", label: "Scheduled" }, { value: "published", label: "Published" }
  ];
  const LEGACY = { draft: "idea", ready: "filming", filmed: "editing", posted: "published" };
  const PLATFORMS = [
    { value: "instagram", label: "Instagram" }, { value: "tiktok", label: "TikTok" }, { value: "youtube", label: "YouTube Shorts" }, { value: "both", label: "Instagram + TikTok" }
  ];
  const MIN_POSTS = 30, MIN_PER_WINDOW = 5, MIN_PER_AUTHOR = 3, WINDOW_HOURS = 3;
  const BATCH_MIN = 30, BATCH_MAX = 480, BATCH_MAX_IDEAS = 20;

  function stageOf(status) {
    const s = String(status === undefined || status === null ? "" : status).toLowerCase();
    if (STAGES.some(function (x) { return x.value === s; })) return s;
    return LEGACY[s] || "idea";
  }
  function stageLabel(status) { const s = stageOf(status); return STAGES.filter(function (x) { return x.value === s; })[0].label; }
  function stageRank(status) { const s = stageOf(status); for (let i = 0; i < STAGES.length; i++) if (STAGES[i].value === s) return i; return 0; }
  function platformLabel(p) { const x = PLATFORMS.filter(function (v) { return v.value === p; })[0]; return x ? x.label : "Instagram + TikTok"; }
  function pri(p) { return p === "high" || p === "low" ? p : "medium"; }
  function rank(p) { return p === "high" ? 0 : p === "low" ? 2 : 1; }
  function str(v) { return typeof v === "string" ? v.trim() : ""; }

  /* ---------------- ideas as calendar items ---------------- */

  // Ideas with a planned date from..to, as the items the calendar draws. The time (if any) is a plain wall time, like a task's.
  function ideaItems(ideas, from, to) {
    const out = [];
    (Array.isArray(ideas) ? ideas : []).forEach(function (idea) {
      if (!idea || typeof idea.id !== "string" || !str(idea.title) || !C.isDate(idea.plannedDate) || idea.plannedDate < from || idea.plannedDate > to) return;
      const stage = stageOf(idea.status), timed = C.isTime(idea.plannedTime), startMin = timed ? C.minutesOf(idea.plannedTime) : null;
      out.push({
        key: "idea:" + idea.id, id: idea.id, occDate: idea.plannedDate, source: "idea", title: str(idea.title), description: "", kind: "content", category: "content",
        priority: pri(idea.priority), recurring: false, linked: null, status: stage, reminders: [], completed: stage === "published", point: true, tz: "",
        allDay: !timed, date: idea.plannedDate, endDate: idea.plannedDate, time: timed ? idea.plannedTime : "", endTime: timed ? C.timeOf(Math.min(1439, startMin + 30)) : "",
        startMin: startMin, endMin: timed ? Math.min(1439, startMin + 30) : null, startMs: null, endMs: null, readOnly: false, conflict: false,
        stage: stage, stageLabel: stageLabel(stage), platform: idea.platform || "both", platformLabel: platformLabel(idea.platform)
      });
    });
    return out;
  }

  // How many ideas are at each stage, and which. -> { total, counts: { idea: n, ... }, byStage: { idea: [idea, ...], ... } }
  function pipeline(ideas) {
    const counts = {}, byStage = {};
    STAGES.forEach(function (s) { counts[s.value] = 0; byStage[s.value] = []; });
    let total = 0;
    (Array.isArray(ideas) ? ideas : []).forEach(function (idea) {
      if (!idea || typeof idea.id !== "string" || !str(idea.title)) return;
      const s = stageOf(idea.status); counts[s]++; byStage[s].push(idea); total++;
    });
    return { total: total, counts: counts, byStage: byStage };
  }

  // Ideas that are not published and have no date yet: the furthest along first, then the most important.
  function needsDate(ideas) {
    return (Array.isArray(ideas) ? ideas : []).filter(function (i) { return i && typeof i.id === "string" && str(i.title) && !C.isDate(i.plannedDate) && stageOf(i.status) !== "published"; }).sort(function (a, b) {
      return stageRank(b.status) - stageRank(a.status) || rank(pri(a.priority)) - rank(pri(b.priority)) || (str(a.title) < str(b.title) ? -1 : 1);
    });
  }

  /* ---------------- changing an idea ---------------- */

  // What to save on an idea to give it a day (and a time, and perhaps a new stage). input: { date, time, status }.
  function schedulePatch(input) {
    const i = input || {};
    if (!C.isDate(i.date)) return { ok: false, error: "Pick a day." };
    const time = i.time === undefined || i.time === null ? "" : String(i.time);
    if (time !== "" && !C.isTime(time)) return { ok: false, error: "Pick a time, or leave it empty." };
    const patch = { plannedDate: i.date, plannedTime: time };
    if (i.status !== undefined && i.status !== "") {
      if (!STAGES.some(function (s) { return s.value === i.status; })) return { ok: false, error: "Pick a stage." };
      patch.status = i.status;
    }
    return { ok: true, patch: patch };
  }
  function unschedulePatch() { return { plannedDate: "", plannedTime: "" }; }
  // Where a dragged idea lands. target: { date, time? } (no time keeps the one it has).
  function movePatch(idea, target) {
    if (!target || !C.isDate(target.date)) return { ok: false, error: "Pick a day." };
    const time = target.time === undefined ? (C.isTime(idea && idea.plannedTime) ? idea.plannedTime : "") : target.time;
    return schedulePatch({ date: target.date, time: time });
  }
  // Ticking a content item means it was posted; unticking it puts it back to Scheduled.
  function donePatch(idea, done) { return { status: done ? "published" : (stageOf(idea && idea.status) === "published" ? "scheduled" : stageOf(idea && idea.status)) }; }

  /* ---------------- batch filming ---------------- */

  // The calendar event for a filming session. ideas: the ideas to film. input: { date, time, minutes }.
  // -> { ok, input } where input is what calendar-logic's add() takes, or { ok: false, error }.
  function batchInput(ideas, input) {
    const list = (Array.isArray(ideas) ? ideas : []).filter(function (i) { return i && typeof i.id === "string" && str(i.title); });
    const i = input || {};
    if (!list.length) return { ok: false, error: "Pick at least one idea to film." };
    if (list.length > BATCH_MAX_IDEAS) return { ok: false, error: "Keep a session to " + BATCH_MAX_IDEAS + " ideas or fewer." };
    if (!C.isDate(i.date)) return { ok: false, error: "Pick a day." };
    if (!C.isTime(i.time)) return { ok: false, error: "Pick a start time." };
    const minutes = Number(i.minutes);
    if (!Number.isInteger(minutes) || minutes < BATCH_MIN || minutes > BATCH_MAX) return { ok: false, error: "A session lasts " + BATCH_MIN + " minutes to " + (BATCH_MAX / 60) + " hours." };
    const end = C.minutesOf(i.time) + minutes;
    if (end > 1439) return { ok: false, error: "Keep it within one day: that runs past midnight." };
    const title = list.length === 1 ? "Film: " + str(list[0].title) : "Batch filming (" + list.length + " ideas)";
    return {
      ok: true,
      input: {
        title: title.slice(0, C.TITLE_MAX), kind: "block", category: "content", priority: "medium", date: i.date, time: i.time, endDate: i.date, endTime: C.timeOf(end),
        description: list.map(function (x) { return "• " + str(x.title) + " (" + platformLabel(x.platform) + ")"; }).join("\n").slice(0, C.DESC_MAX),
        linked: { type: "batch", id: list[0].id, ids: list.map(function (x) { return x.id; }) }
      }
    };
  }

  /* ---------------- when to post, from real posts ---------------- */

  function median(list) { const s = list.slice().sort(function (a, b) { return a - b; }), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
  function authorOf(p) { const a = p && p.author; return typeof a === "string" ? a.trim().toLowerCase() : a && typeof a.username === "string" ? a.username.trim().toLowerCase() : ""; }
  function windowLabel(start, end) {
    const h = function (x) { return ((x + 11) % 12 + 1) + (x % 24 < 12 || x === 24 ? " AM" : " PM"); };
    const a = (start + 11) % 12 + 1, b = (end + 11) % 12 + 1, sa = start < 12 ? "AM" : "PM", sb = end % 24 < 12 ? "AM" : "PM";
    return sa === sb ? a + "–" + b + " " + sa : h(start) + " – " + h(end);
  }

  // posts: saved research posts ({ author, platform, views, publishedAt }). opts: { zone, minPosts, minPerWindow }.
  // Each post's views are compared with that same account's typical post (its median), so a huge account does not drown out
  // the small ones. A window is only suggested when enough posts fall in it and they did better than usual.
  // -> { ok: false, reason: "not-enough", have, need } | { ok: true, have, accounts, windows: [{ startHour, endHour, label, posts, lift }], best: [...] }
  function bestPostingTimes(posts, opts) {
    const o = opts || {}, zone = o.zone && C.isValidZone(o.zone) ? o.zone : C.deviceZone();
    const need = Number.isInteger(o.minPosts) ? o.minPosts : MIN_POSTS, perWindow = Number.isInteger(o.minPerWindow) ? o.minPerWindow : MIN_PER_WINDOW;
    const byAuthor = {};
    (Array.isArray(posts) ? posts : []).forEach(function (p) {
      const t = p && typeof p.publishedAt === "string" ? Date.parse(p.publishedAt) : NaN, v = p ? Number(p.views) : NaN, a = authorOf(p);
      if (!a || isNaN(t) || !isFinite(v) || v <= 0) return;
      const key = String(p.platform || "") + "|" + a;
      (byAuthor[key] = byAuthor[key] || []).push({ t: t, v: v });
    });
    const rows = [];
    let accounts = 0;
    Object.keys(byAuthor).forEach(function (k) {
      const list = byAuthor[k];
      if (list.length < MIN_PER_AUTHOR) return;
      accounts++;
      const typical = median(list.map(function (x) { return x.v; }));
      list.forEach(function (x) { rows.push({ hour: Number(C.instantToWall(x.t, zone).time.slice(0, 2)), ratio: x.v / typical }); });
    });
    if (rows.length < need) return { ok: false, reason: "not-enough", have: rows.length, need: need };
    const windows = [];
    for (let start = 0; start < 24; start += WINDOW_HOURS) {
      const inside = rows.filter(function (r) { return r.hour >= start && r.hour < start + WINDOW_HOURS; });
      if (inside.length < perWindow) continue;
      windows.push({ startHour: start, endHour: start + WINDOW_HOURS, label: windowLabel(start, start + WINDOW_HOURS), posts: inside.length, lift: Math.round(median(inside.map(function (r) { return r.ratio; })) * 100) / 100 });
    }
    const best = windows.filter(function (w) { return w.lift > 1; }).sort(function (a, b) { return b.lift - a.lift || b.posts - a.posts; }).slice(0, 2);
    return { ok: true, have: rows.length, accounts: accounts, windows: windows, best: best };
  }

  return {
    STAGES: STAGES, PLATFORMS: PLATFORMS, MIN_POSTS: MIN_POSTS, BATCH_MIN: BATCH_MIN, BATCH_MAX: BATCH_MAX,
    stageOf: stageOf, stageLabel: stageLabel, stageRank: stageRank, platformLabel: platformLabel,
    ideaItems: ideaItems, pipeline: pipeline, needsDate: needsDate,
    schedulePatch: schedulePatch, unschedulePatch: unschedulePatch, movePatch: movePatch, donePatch: donePatch,
    batchInput: batchInput, bestPostingTimes: bestPostingTimes
  };
});
