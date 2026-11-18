/* ==========================================================================
   JARVIS — Strategic Planning Center: where the plan's records live (browser storage), on top of the rules in plan-logic.js
   (and plan-week-logic.js for the weekly planner).

   Lists, each in its own localStorage key (see PlanLogic.KEYS): nodes, periods, links, ingredients, blocks, weeks; and one
   settings object. They are saved with JarvisCore.saveJSON, which is also what tells the cloud backup a backed-up key changed,
   so nothing here talks to the cloud.

   The rules are in the logic modules: they take a list and return the whole new list. This file just keeps the list in
   memory, saves it, and tells the screens. Your existing tasks and goals are NOT stored here: they stay where they were
   (Habits), and the plan only holds links to them.

   Safety (the same as the Learning hub):
     - a list that can't be read (damaged JSON) is not shown and is never saved over;
     - records this version doesn't understand are kept exactly as they were and written back with the rest;
     - if the browser refuses to save (storage full or blocked) the change is dropped and the screen says so.
   ========================================================================== */

(function () {
  "use strict";

  const PL = window.JarvisPlanLogic;
  const KINDS = ["nodes", "periods", "links", "ingredients", "blocks", "weeks", "templates", "reviews", "intentions", "days"];
  const data = {}, kept = {}, loadError = {};
  let settingsRaw = null, settingsErr = "", saveError = "", started = false;
  const listeners = [];

  function core() { return window.JarvisCore; }
  function emit(kind) { listeners.slice().forEach(function (fn) { try { fn(kind); } catch (e) { if (window.console) console.error(e); } }); }
  function weekLogic() { return window.JarvisPlanWeekLogic || null; }

  // Records of a kind that is just "objects with an id": the ones that aren't are kept aside untouched.
  function readGeneric(raw) {
    const items = [], keep = [];
    (Array.isArray(raw) ? raw : []).forEach(function (r) { if (r && typeof r === "object" && !Array.isArray(r) && typeof r.id === "string" && r.id) items.push(r); else keep.push(r); });
    return { items: items, kept: keep };
  }
  function readerFor(kind) {
    if (kind === "nodes") return PL.readNodes;
    if (kind === "links") return PL.readLinks;
    const w = weekLogic();
    if (w && w.readers && w.readers[kind]) return w.readers[kind];
    return readGeneric;
  }

  function load() {
    KINDS.forEach(function (kind) {
      data[kind] = []; kept[kind] = []; loadError[kind] = "";
      let raw = null;
      try { raw = window.localStorage.getItem(PL.KEYS[kind]); } catch (e) { loadError[kind] = "This browser is blocking storage, so this can't be saved."; return; }
      if (raw === null) return;
      try {
        const r = readerFor(kind)(JSON.parse(raw));
        data[kind] = r.items; kept[kind] = r.kept;
      } catch (e) { loadError[kind] = "Something saved here could not be read, so it isn't shown and nothing will be saved over it."; }
    });
    settingsErr = ""; settingsRaw = null;
    try {
      const s = window.localStorage.getItem(PL.KEYS.settings);
      if (s !== null) { const v = JSON.parse(s); settingsRaw = v && typeof v === "object" && !Array.isArray(v) ? v : null; if (settingsRaw === null) settingsErr = "The saved plan settings could not be read, so they won't be changed."; }
    } catch (e) { settingsErr = "The saved plan settings could not be read, so they won't be changed."; }
    const now = Date.now();
    KINDS.forEach(function (kind) {
      if (kind === "periods") return;
      const purged = PL.purge(data[kind], now);
      if (!loadError[kind] && purged.length !== data[kind].length) { data[kind] = purged; write(kind); }
    });
  }

  function write(kind) {
    if (loadError[kind]) { saveError = loadError[kind]; return false; }
    const ok = core().saveJSON(PL.KEYS[kind], data[kind].concat(kept[kind]));
    saveError = ok ? "" : "The browser would not save this (storage may be full or blocked). Your last change was not kept.";
    return ok;
  }

  function today() { return core().todayISODate ? core().todayISODate() : new Date().toISOString().slice(0, 10); }

  const api = {
    KINDS: KINDS,
    init: function () { if (started) return; started = true; load(); },
    reload: function () { load(); KINDS.forEach(emit); emit("settings"); },
    all: function (kind) { return data[kind] || []; },
    list: function (kind) { return PL.live(data[kind]); },
    get: function (kind, id) { return PL.live(data[kind]).filter(function (r) { return r.id === id; })[0] || null; },
    today: today,
    error: function () { return saveError; },
    blocked: function (kind) { return loadError[kind] || ""; },
    clearError: function () { saveError = ""; },
    subscribe: function (fn) { listeners.push(fn); return function () { const i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); }; },

    // Replaces a whole list with the one a logic function returned, and saves it. If saving fails the old list is put back.
    // -> true / false
    replace: function (kind, next) {
      if (KINDS.indexOf(kind) === -1) return false;
      const prev = data[kind];
      data[kind] = Array.isArray(next) ? next : prev;
      if (!write(kind)) { data[kind] = prev; emit(kind); return false; }
      emit(kind);
      return true;
    },
    // Several lists in one go (a change that touches two of them, e.g. a block and its task link). All or nothing.
    replaceMany: function (changes) {
      const kinds = Object.keys(changes).filter(function (k) { return KINDS.indexOf(k) !== -1; });
      const prev = {};
      kinds.forEach(function (k) { prev[k] = data[k]; data[k] = changes[k]; });
      for (let i = 0; i < kinds.length; i++) {
        if (!write(kinds[i])) {
          kinds.forEach(function (k) { data[k] = prev[k]; });
          // what was saved before the failure goes back, too
          for (let j = 0; j < i; j++) write(kinds[j]);
          kinds.forEach(emit);
          return false;
        }
      }
      kinds.forEach(emit);
      return true;
    },

    settings: function () { return PL.settings(settingsRaw, today()); },
    settingsBlocked: function () { return settingsErr; },
    setSettings: function (patch) {
      if (settingsErr) { saveError = settingsErr; return false; }
      const cur = PL.settings(settingsRaw, today());
      const next = PL.settings(Object.assign({}, settingsRaw || {}, cur, patch || {}, { updatedAt: Date.now() }), today());
      const ok = core().saveJSON(PL.KEYS.settings, Object.assign({}, settingsRaw || {}, next));
      saveError = ok ? "" : "The browser would not save this (storage may be full or blocked). Your last change was not kept.";
      if (ok) { settingsRaw = Object.assign({}, settingsRaw || {}, next); emit("settings"); }
      return ok;
    }
  };

  window.JarvisPlanStore = api;
})();
