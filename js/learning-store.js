/* ==========================================================================
   JARVIS — Learning & Research Hub: where the records live (browser storage), on top of the rules in
   learning-logic.js.

   Five lists, each in its own localStorage key (see learning-logic.js KEYS). They are saved with
   JarvisCore.saveJSON, which is also what tells the cloud backup that a backed-up key changed, so nothing
   here talks to the cloud itself.

   Safety:
     - a list that can't be read (damaged JSON) is not shown and is never saved over;
     - records this version doesn't understand are kept exactly as they were and written back with the rest;
     - if the browser refuses to save (storage full or blocked) the change is dropped and the screen says so;
     - deleting keeps a tombstone for 30 days (see the logic file), which is also what makes Undo possible.
   ========================================================================== */

(function () {
  "use strict";

  const L = window.JarvisLearningLogic;
  const KINDS = ["books", "research", "notes", "actions", "reviews"];
  const PREFIX = { books: "bk", research: "rs", notes: "nt", actions: "ac", reviews: "wk" };
  let data = {}, kept = {}, loadError = {}, saveError = "";
  let started = false;
  const listeners = [];

  function core() { return window.JarvisCore; }
  function emit(kind) { listeners.slice().forEach(function (fn) { try { fn(kind); } catch (e) { if (window.console) console.error(e); } }); }

  function load() {
    KINDS.forEach(function (kind) {
      data[kind] = []; kept[kind] = []; loadError[kind] = "";
      let raw = null;
      try { raw = window.localStorage.getItem(L.KEYS[kind]); } catch (e) { loadError[kind] = "This browser is blocking storage, so this can't be saved."; return; }
      if (raw === null) return;
      try {
        const r = L.readList(kind, JSON.parse(raw));
        data[kind] = r.items; kept[kind] = r.kept;
      } catch (e) { loadError[kind] = "Something saved here could not be read, so it isn't shown and nothing will be saved over it."; }
    });
    const now = Date.now();
    KINDS.forEach(function (kind) {
      const purged = L.purge(data[kind], now);
      if (!loadError[kind] && purged.length !== data[kind].length) { data[kind] = purged; write(kind); }
    });
  }

  function write(kind) {
    if (loadError[kind]) { saveError = loadError[kind]; return false; }
    const ok = core().saveJSON(L.KEYS[kind], data[kind].concat(kept[kind]));
    saveError = ok ? "" : "The browser would not save this (storage may be full or blocked). Your last change was not kept.";
    return ok;
  }

  // Replaces one kind's list and saves it; if saving fails the old list is put back.
  function commit(kind, next) {
    const prev = data[kind];
    data[kind] = next;
    if (!write(kind)) { data[kind] = prev; emit(kind); return false; }
    emit(kind);
    return true;
  }

  function today() { return core().todayISODate ? core().todayISODate() : L.localDate(Date.now()); }
  function find(kind, id) { return data[kind].filter(function (r) { return r.id === id; })[0] || null; }

  const api = {
    KINDS: KINDS,
    init: function () { if (started) return; started = true; load(); },
    reload: function () { load(); KINDS.forEach(emit); },
    // Every record of a kind, deleted ones included (the logic functions skip those themselves).
    all: function (kind) { return data[kind] || []; },
    state: function () { return { books: data.books, research: data.research, notes: data.notes, actions: data.actions, reviews: data.reviews }; },
    // Live records only.
    list: function (kind) { return L.live(data[kind]); },
    get: function (kind, id) { const r = find(kind, id); return r && !r.deletedAt ? r : null; },
    today: today,
    error: function () { return saveError; },
    blocked: function (kind) { return loadError[kind] || ""; },
    clearError: function () { saveError = ""; },
    subscribe: function (fn) { listeners.push(fn); return function () { const i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); }; },

    // A new record from checked form values. -> the record, or null if it couldn't be saved.
    add: function (kind, value, extra) {
      const now = Date.now();
      const rec = Object.assign({ id: core().uid(PREFIX[kind]), createdAt: now, updatedAt: now }, value, extra || {});
      return commit(kind, data[kind].concat([rec])) ? rec : null;
    },
    // Replaces a record by id with a whole new version (use after a logic function built it, or with patch values).
    put: function (kind, record) {
      const next = Object.assign({}, record, { updatedAt: Math.max(Date.now(), (record.updatedAt || 0)) });
      return commit(kind, data[kind].map(function (r) { return r.id === record.id ? next : r; })) ? next : null;
    },
    patch: function (kind, id, values) {
      const cur = find(kind, id);
      return cur ? api.put(kind, Object.assign({}, cur, values)) : null;
    },
    // Deleting: returns the deleted record (for Undo), or null.
    remove: function (kind, id) {
      const cur = find(kind, id);
      if (!cur || cur.deletedAt) return null;
      return commit(kind, data[kind].map(function (r) { return r.id === id ? L.tombstone(r, Date.now()) : r; })) ? cur : null;
    },
    undoRemove: function (kind, id) {
      const cur = find(kind, id);
      if (!cur || !cur.deletedAt) return null;
      const back = L.restore(cur, Date.now());
      return commit(kind, data[kind].map(function (r) { return r.id === id ? back : r; })) ? back : null;
    },
    // Deleting a book or research project leaves its notes and actions in the library: this unlinks them so nothing
    // points at something that no longer exists. An action keeps where it was learned as plain text (label).
    // Returns the changes made so Undo can put them back.
    unlinkFrom: function (kind, id, label) {
      const changes = { notes: [], actions: [] };
      const now = Date.now();
      const field = kind === "book" ? "bookIds" : "researchIds";
      const nextNotes = data.notes.map(function (n) {
        if ((n[field] || []).indexOf(id) === -1) return n;
        changes.notes.push(n);
        const c = Object.assign({}, n, { updatedAt: now });
        c[field] = n[field].filter(function (x) { return x !== id; });
        if (field === "researchIds" && !c.researchIds.length) c.sourceId = "";
        return c;
      });
      const nextActions = data.actions.map(function (a) {
        if (a.sourceType !== kind || a.sourceId !== id) return a;
        changes.actions.push(a);
        return Object.assign({}, a, label ? { sourceType: "other", sourceId: "", sourceLabel: label, updatedAt: now } : { sourceType: "none", sourceId: "", updatedAt: now });
      });
      if (changes.notes.length) commit("notes", nextNotes);
      if (changes.actions.length) commit("actions", nextActions);
      return changes;
    },
    relink: function (changes) {
      if (!changes) return;
      const now = Date.now();
      const nByid = {}, aByid = {};
      (changes.notes || []).forEach(function (n) { nByid[n.id] = n; });
      (changes.actions || []).forEach(function (a) { aByid[a.id] = a; });
      if ((changes.notes || []).length) commit("notes", data.notes.map(function (n) { return nByid[n.id] ? Object.assign({}, nByid[n.id], { updatedAt: now }) : n; }));
      if ((changes.actions || []).length) commit("actions", data.actions.map(function (a) { return aByid[a.id] ? Object.assign({}, aByid[a.id], { updatedAt: now }) : a; }));
    }
  };

  window.JarvisLearningStore = api;
})();
