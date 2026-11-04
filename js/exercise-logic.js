/* ==========================================================================
   JARVIS — Workout: the rules behind the Exercise Library (pure functions, no page access,
   so they can be tested outside the browser).

   What lives here:
     - Names: reading "DB Bench Press", "Bench Press" and "Barbell Bench Press" so duplicates are
       caught however they are typed (case, hyphens, plurals, word order, common abbreviations).
     - Search and filters: every word you type has to match the name, the muscle group or the
       equipment; plus a muscle group, an equipment type, favorites.
     - Custom exercises: what is allowed, and where one is used (so one that is already in your
       history or a routine is never deleted out from under it).
     - Your own extras per exercise: a note and a demo link you saved. Links must be https.

   Nothing here invents instructions or muscle data. The guides are in exercise-guides.js; the
   muscles come from exercises.js.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisExerciseLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const NAME_MAX = 60, NOTE_MAX = 500, URL_MAX = 300, EXTRAS_MAX = 400;
  const ALIASES = { db: "dumbbell", dumbell: "dumbbell", dumbells: "dumbbell", bb: "barbell", kb: "kettlebell", rdl: "romanian deadlift", ohp: "overhead press", bw: "bodyweight" };
  const JOINS = [["pull down", "pulldown"], ["push down", "pushdown"], ["pull up", "pullup"], ["chin up", "chinup"], ["push up", "pushup"], ["sit up", "situp"], ["step up", "stepup"],
    ["pull over", "pullover"], ["cross over", "crossover"], ["kick back", "kickback"], ["dead lift", "deadlift"], ["t bar", "tbar"], ["ez bar", "ez"], ["skull crusher", "skullcrusher"], ["pull through", "pullthrough"]];
  const EQUIP_WORDS = ["barbell", "dumbbell", "machine", "cable", "smith", "ez", "bar", "kettlebell", "bodyweight", "weighted", "band"];
  // Short or informal words people search with, mapped to the word the library uses (both in their plain, singular form).
  const SEARCH_SYNONYMS = { pec: "chest", delt: "shoulder", bi: "bicep", tri: "tricep", hammie: "hamstring" };

  function stem(t) { return /sses$/.test(t) ? t.slice(0, -2) : /[^s]s$/.test(t) ? t.slice(0, -1) : t; }
  function keyOf(name) { return String(name || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim(); }

  // The words of a name in a plain, comparable form: lower case, abbreviations spelled out, "push up" -> "pushup", plurals removed.
  function tokens(name) {
    let s = " " + keyOf(name).split(" ").filter(Boolean).map(stem).join(" ") + " ";
    Object.keys(ALIASES).forEach(function (a) { s = s.replace(new RegExp(" " + a + " ", "g"), " " + ALIASES[a] + " "); });
    JOINS.forEach(function (j) { s = s.replace(new RegExp(" " + j[0] + " ", "g"), " " + j[1] + " "); });
    return s.trim().split(/\s+/).filter(Boolean);
  }

  function parts(name) {
    const all = tokens(name);
    const core = all.filter(function (t) { return EQUIP_WORDS.indexOf(t) === -1; });
    const equip = all.filter(function (t) { return EQUIP_WORDS.indexOf(t) !== -1; });
    return { flat: all.join(""), sorted: all.slice().sort().join(" "), core: core.slice().sort().join(" "), equip: equip.slice().sort().join(" ") };
  }

  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = [], cur = [];
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      cur = [i];
      let rowMin = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  /* ---------------- duplicates ---------------- */

  // The same lift written two ways: "Bench Press" next to "Barbell Bench Press", "Press, Bench"... but not "Dumbbell Bench Press"
  // next to "Barbell Bench Press" (different equipment words), and not "Incline Bench Press" next to "Bench Press".
  // a, b: { name, equipment? }
  function sameLift(a, b) {
    const x = parts(a.name), y = parts(b.name);
    if (!x.core || x.core !== y.core) return false;
    if (a.equipment && b.equipment && a.equipment !== b.equipment) return false;
    return !x.equip || !y.equip || x.equip === y.equip;
  }

  // What already exists that this name would duplicate. exact: the same exercise (word order, hyphens, case and plurals ignored).
  // similar: the same lift written another way, or a one-letter typo of an existing name. Each similar entry says why.
  //   -> { exact: exercise | null, similar: [{ exercise, reason }] }
  function findSimilar(name, equipment, list) {
    const want = parts(name);
    const out = { exact: null, similar: [] };
    if (!want.flat) return out;
    (list || []).forEach(function (e) {
      if (out.exact) return;
      const have = parts(e.name);
      if (have.flat === want.flat || have.sorted === want.sorted) { out.exact = e; return; }
      if (sameLift({ name: name, equipment: equipment }, e)) { out.similar.push({ exercise: e, reason: "It looks like the same exercise written differently." }); return; }
      if (want.flat.length >= 8 && editDistance(want.flat, have.flat, 1) <= 1) out.similar.push({ exercise: e, reason: "The name is one letter away from it." });
    });
    if (out.exact) out.similar = [];
    out.similar = out.similar.slice(0, 3);
    return out;
  }

  /* ---------------- search and filters ---------------- */

  function queryTokens(q) {
    return tokens(q).map(function (t) { return SEARCH_SYNONYMS[t] || t; });
  }

  function haystack(e) { return tokens(e.name).concat(tokens(e.muscleGroup || ""), tokens(e.equipment || "")); }

  function matchesQuery(e, qt) {
    if (!qt.length) return true;
    const hay = haystack(e);
    return qt.every(function (t) { return hay.some(function (h) { return h.indexOf(t) === 0 || (t.length >= 3 && h.indexOf(t) !== -1); }); });
  }

  // f: { query, muscle, equipment, favoritesOnly, favoriteIds, customOnly }. Best matches first (name starts with what you typed), then A to Z.
  function filterExercises(list, f) {
    const o = f || {};
    const qt = queryTokens(o.query || "");
    const raw = keyOf(o.query || "");
    const fav = {}; (o.favoriteIds || []).forEach(function (id) { fav[id] = true; });
    const out = (list || []).filter(function (e) {
      if (o.muscle && e.muscleGroup !== o.muscle) return false;
      if (o.equipment && e.equipment !== o.equipment) return false;
      if (o.favoritesOnly && !fav[e.id]) return false;
      if (o.customOnly && !e.custom) return false;
      return matchesQuery(e, qt);
    });
    const rank = function (e) { const n = keyOf(e.name); return raw && n.indexOf(raw) === 0 ? 0 : raw && n.indexOf(raw) !== -1 ? 1 : 2; };
    return out.sort(function (a, b) { return rank(a) - rank(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); });
  }

  // [{ group, items }] in the order of `order`, then any group not listed; empty groups left out.
  function groupBy(list, field, order) {
    const map = {};
    (list || []).forEach(function (e) { const g = e[field] || "Other"; (map[g] = map[g] || []).push(e); });
    const keys = (order || []).filter(function (g) { return map[g]; }).concat(Object.keys(map).filter(function (g) { return (order || []).indexOf(g) === -1; }).sort());
    return keys.map(function (g) { return { group: g, items: map[g] }; });
  }

  // How many of each muscle group / equipment type, for the filter menus: { name: count }.
  function counts(list, field) {
    const out = {};
    (list || []).forEach(function (e) { const g = e[field]; if (g) out[g] = (out[g] || 0) + 1; });
    return out;
  }

  /* ---------------- custom exercises ---------------- */

  function cleanName(name) { return String(name === undefined || name === null ? "" : name).replace(/\s+/g, " ").trim(); }

  // -> { ok, error, value: { name, muscleGroup, equipment } }
  function sanitizeCustom(data, groups, equipment) {
    const d = data || {};
    const name = cleanName(d.name);
    if (!name) return { ok: false, error: "Give it a name." };
    if (name.length > NAME_MAX) return { ok: false, error: "Keep the name to " + NAME_MAX + " characters or fewer." };
    if (!/[a-z0-9]/i.test(name)) return { ok: false, error: "Use letters or numbers in the name." };
    if ((groups || []).indexOf(d.muscleGroup) === -1) return { ok: false, error: "Pick a muscle group." };
    if ((equipment || []).indexOf(d.equipment) === -1) return { ok: false, error: "Pick the equipment." };
    return { ok: true, value: { name: name, muscleGroup: d.muscleGroup, equipment: d.equipment } };
  }

  // Where an exercise is used: saved workouts, routines (archived ones too) and the workout in progress.
  // ctx: { workouts, routines, draft }  -> { sessions, routines, inDraft, total }
  function usage(id, ctx) {
    const c = ctx || {};
    const sessions = (Array.isArray(c.workouts) ? c.workouts : []).filter(function (w) { return w && w.schema === 2 && Array.isArray(w.exercises) && w.exercises.some(function (x) { return x && x.exerciseId === id; }); }).length;
    const routines = (Array.isArray(c.routines) ? c.routines : []).filter(function (r) { return r && Array.isArray(r.exercises) && r.exercises.some(function (x) { return x && x.exerciseId === id; }); }).length;
    const inDraft = !!(c.draft && Array.isArray(c.draft.exercises) && c.draft.exercises.some(function (x) { return x && x.exerciseId === id; }));
    return { sessions: sessions, routines: routines, inDraft: inDraft, total: sessions + routines + (inDraft ? 1 : 0) };
  }

  function usageText(u) {
    const bits = [];
    if (u.sessions) bits.push(u.sessions + (u.sessions === 1 ? " saved workout" : " saved workouts"));
    if (u.routines) bits.push(u.routines + (u.routines === 1 ? " routine" : " routines"));
    if (u.inDraft) bits.push("the workout you are doing now");
    return bits.join(", ").replace(/, ([^,]*)$/, " and $1");
  }

  /* ---------------- your own note and demo link ---------------- */

  // An https link, trimmed, or null.
  function validVideoUrl(raw) {
    const s = String(raw === undefined || raw === null ? "" : raw).trim();
    if (!s || s.length > URL_MAX || /\s/.test(s)) return null;
    let u;
    try { u = new URL(s); } catch (e) { return null; }
    if (u.protocol !== "https:" || !u.hostname || u.hostname.indexOf(".") === -1 || u.username || u.password) return null;
    return u.href;
  }

  function demoSearchUrl(name) { return "https://www.youtube.com/results?search_query=" + encodeURIComponent(cleanName(name) + " exercise how to"); }

  function sanitizeExtras(raw) {
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    Object.keys(raw).slice(0, EXTRAS_MAX).forEach(function (id) {
      const e = raw[id];
      if (!e || typeof e !== "object") return;
      const note = typeof e.note === "string" ? e.note.slice(0, NOTE_MAX).trim() : "";
      const video = validVideoUrl(e.video);
      if (!note && !video) return;
      const item = {};
      if (note) item.note = note;
      if (video) item.video = video;
      if (isFinite(Number(e.updatedAt))) item.updatedAt = Number(e.updatedAt);
      out[id] = item;
    });
    return out;
  }

  function putExtra(extras, id, field, value, now) {
    const next = sanitizeExtras(extras);
    const cur = Object.assign({}, next[id] || {});
    if (value) cur[field] = value; else delete cur[field];
    cur.updatedAt = now || Date.now();
    if (!cur.note && !cur.video) delete next[id]; else next[id] = cur;
    return next;
  }
  // -> { ok, extras, error }
  function setNote(extras, id, text, now) {
    const t = String(text === undefined || text === null ? "" : text).trim();
    if (t.length > NOTE_MAX) return { ok: false, error: "Keep the note to " + NOTE_MAX + " characters or fewer.", extras: sanitizeExtras(extras) };
    return { ok: true, extras: putExtra(extras, id, "note", t, now) };
  }
  function setVideo(extras, id, url, now) {
    const raw = String(url === undefined || url === null ? "" : url).trim();
    if (!raw) return { ok: true, extras: putExtra(extras, id, "video", "", now) };
    const v = validVideoUrl(raw);
    if (!v) return { ok: false, error: "Paste a full link that starts with https://", extras: sanitizeExtras(extras) };
    return { ok: true, extras: putExtra(extras, id, "video", v, now) };
  }

  // Where a link goes, in words (no tracking of it): "youtube.com".
  function linkHost(url) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; } }

  /* ---------------- Form Check links ---------------- */

  // The exercises Form Check has a check for, by library id.
  const FORM_CHECK = {
    "back-squat-barbell": "squat", "bodyweight-squat": "squat", "deadlift-barbell": "deadlift", "walking-lunge": "lunge", "push-up": "pushup",
    "bench-press-barbell": "benchpress", "overhead-press-barbell": "overheadpress", "lat-pulldown": "latpulldown", "barbell-row": "row",
    "barbell-curl": "bicepcurl", "dumbbell-curl": "bicepcurl", "preacher-curl-barbell": "preachercurl", "overhead-triceps-extension": "tricepextension", "plank": "plank"
  };
  function formCheckKey(id) { return FORM_CHECK[id] || null; }

  return {
    NAME_MAX: NAME_MAX, NOTE_MAX: NOTE_MAX, EQUIP_WORDS: EQUIP_WORDS,
    tokens: tokens, parts: parts, sameLift: sameLift, findSimilar: findSimilar, editDistance: editDistance,
    queryTokens: queryTokens, filterExercises: filterExercises, groupBy: groupBy, counts: counts,
    cleanName: cleanName, sanitizeCustom: sanitizeCustom, usage: usage, usageText: usageText,
    validVideoUrl: validVideoUrl, demoSearchUrl: demoSearchUrl, sanitizeExtras: sanitizeExtras, setNote: setNote, setVideo: setVideo, linkHost: linkHost,
    formCheckKey: formCheckKey
  };
});
