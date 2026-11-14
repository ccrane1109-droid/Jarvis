/* ==========================================================================
   JARVIS — Learning & Research Hub: connecting ideas (pure rules).

   Three simple, explainable ways to relate things; there is no AI, no embeddings and nothing leaves this device:
     1. links you make between notes (note.linkIds), which count in both directions;
     2. topics: notes that share a #topic tag;
     3. wording: notes that use several of the same meaningful words (common words like "the" and "with" are ignored).
   Every related note comes with the reasons it was matched, so you can see why it appears.

   Collections gather knowledge around a subject:
     { id, name, description, tag, noteIds[], bookIds[], researchIds[], createdAt, updatedAt, deletedAt? }
   A collection's notes are the ones you added plus, if it has a topic, every note tagged with it.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./learning-logic"));
  else root.JarvisLearningLinks = factory(root.JarvisLearningLogic);
})(typeof self !== "undefined" ? self : this, function (L) {
  "use strict";

  const KEY = "jarvisLearnCollections";
  const STOP = ("about above after again against also always among because been before being below between both cannot could does doing done down during each either else even ever every from further have having here hers herself himself into itself just like make many more most much must myself never only other ought ours ourselves over same should since some such than that their theirs them themselves then there these they this those through under until upon very want well were what when where which while who whom whose will with within without would yours yourself yourselves your really thing things people need needs good great".split(/\s+/)).reduce(function (m, w) { m[w] = true; return m; }, {});

  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function line(v, max) { return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : ""; }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }
  function idList(v) { const out = []; (Array.isArray(v) ? v : []).forEach(function (x) { if (typeof x === "string" && x && x.length <= 80 && out.indexOf(x) === -1 && out.length < 500) out.push(x); }); return out; }
  function undef(o) { Object.keys(o).forEach(function (k) { if (o[k] === undefined) delete o[k]; }); return o; }

  /* ---------------- wording ---------------- */

  // The meaningful words of a text: lower case, 4+ letters, not a common word, plurals folded ("habits" ~ "habit"). Each once.
  function keywords(text) {
    const seen = {}, out = [];
    String(text || "").toLowerCase().replace(/[^a-z0-9À-￿]+/g, " ").split(" ").forEach(function (w) {
      if (w.length < 4 || STOP[w]) return;
      if (w.length > 4 && /s$/.test(w) && !/ss$/.test(w)) w = w.slice(0, -1);
      if (STOP[w] || seen[w]) return;
      seen[w] = true; out.push(w);
    });
    return out;
  }
  const cache = {};
  function wordsOf(n) {
    const k = n.id + ":" + (n.updatedAt || 0) + ":" + (n.text ? n.text.length : 0);
    return cache[k] || (cache[k] = keywords([n.title, n.text, n.evidence].join(" ")));
  }
  function shared(a, b) { const set = {}; a.forEach(function (w) { set[w] = true; }); return b.filter(function (w) { return set[w]; }); }

  /* ---------------- related notes ---------------- */

  // The notes related to `note`, best first: [{ note, score, reasons: [{ kind: "link" | "topic" | "words", detail }] }].
  // state.notes are all the notes; deleted ones and the note itself are left out.
  function related(note, state, limit) {
    const mine = wordsOf(note), tags = note.tags || [], out = [];
    L.live(state && state.notes).forEach(function (o) {
      if (o.id === note.id) return;
      const reasons = []; let score = 0;
      if ((note.linkIds || []).indexOf(o.id) !== -1 || (o.linkIds || []).indexOf(note.id) !== -1) { reasons.push({ kind: "link", detail: (note.linkIds || []).indexOf(o.id) !== -1 ? "Linked by you" : "Links back to this" }); score += 100; }
      const commonTags = (o.tags || []).filter(function (t) { return tags.indexOf(t) !== -1; });
      if (commonTags.length) { reasons.push({ kind: "topic", detail: commonTags.map(function (t) { return "#" + t; }).join(" ") }); score += 10 * commonTags.length; }
      const theirs = wordsOf(o), common = shared(mine, theirs), need = Math.min(mine.length, theirs.length) <= 8 ? 2 : 3;
      if (common.length >= need) { reasons.push({ kind: "words", detail: common.slice(0, 4).join(", ") }); score += common.length; }
      if (reasons.length) out.push({ note: o, score: score, reasons: reasons });
    });
    out.sort(function (a, b) { return b.score - a.score || num(b.note.createdAt) - num(a.note.createdAt); });
    return limit ? out.slice(0, limit) : out;
  }

  // Other books whose notes are related to this note: [{ book, notes: n }], the most related notes first.
  function booksDiscussing(note, state) {
    const mine = {};
    (note.bookIds || []).forEach(function (id) { mine[id] = true; });
    const count = {};
    related(note, state).forEach(function (r) { (r.note.bookIds || []).forEach(function (id) { if (!mine[id]) count[id] = (count[id] || 0) + 1; }); });
    const out = [];
    L.live(state && state.books).forEach(function (b) { if (count[b.id]) out.push({ book: b, notes: count[b.id] }); });
    return out.sort(function (a, b) { return b.notes - a.notes || (a.book.title < b.book.title ? -1 : 1); });
  }

  /* ---------------- topics ---------------- */

  // Every topic tag in use, with what it touches: [{ tag, notes, cards, books: [book], research: [project] }], most notes first.
  function topics(state) {
    const by = {};
    const slot = function (t) { return by[t] || (by[t] = { tag: t, notes: 0, cards: 0, bookIds: {}, researchIds: {} }); };
    L.live(state && state.notes).forEach(function (n) { (n.tags || []).forEach(function (t) { const s = slot(t); s.notes++; (n.bookIds || []).forEach(function (id) { s.bookIds[id] = true; }); (n.researchIds || []).forEach(function (id) { s.researchIds[id] = true; }); }); });
    L.live(state && state.cards).forEach(function (c) { (c.tags || []).forEach(function (t) { const s = slot(t); s.cards++; (c.bookIds || []).forEach(function (id) { s.bookIds[id] = true; }); (c.researchIds || []).forEach(function (id) { s.researchIds[id] = true; }); }); });
    const books = L.live(state && state.books), research = L.live(state && state.research);
    return Object.keys(by).map(function (t) {
      const s = by[t];
      return { tag: t, notes: s.notes, cards: s.cards, books: books.filter(function (b) { return s.bookIds[b.id]; }), research: research.filter(function (r) { return s.researchIds[r.id]; }) };
    }).sort(function (a, b) { return (b.notes + b.cards) - (a.notes + a.cards) || (a.tag < b.tag ? -1 : 1); });
  }

  // Renaming (or merging into an existing) topic: the records that change, with the new tags. Pure: nothing is saved here.
  function renameTag(records, from, to) {
    const target = L.parseTags([to])[0];
    if (!target || target === from) return [];
    const out = [];
    (records || []).forEach(function (r) {
      if (r.deletedAt || (r.tags || []).indexOf(from) === -1) return;
      const tags = [];
      r.tags.forEach(function (t) { const x = t === from ? target : t; if (tags.indexOf(x) === -1) tags.push(x); });
      out.push({ before: r, after: Object.assign({}, r, { tags: tags }) });
    });
    return out;
  }

  /* ---------------- collections ---------------- */

  function read(raw) {
    if (!isObj(raw) || typeof raw.id !== "string" || !raw.id) return null;
    const name = line(raw.name, 80);
    if (!name) return null;
    return undef({
      id: raw.id, createdAt: num(raw.createdAt), updatedAt: num(raw.updatedAt), deletedAt: num(raw.deletedAt) || undefined,
      name: name, description: line(raw.description, 300), tag: L.parseTags([raw.tag])[0] || "",
      noteIds: idList(raw.noteIds), bookIds: idList(raw.bookIds), researchIds: idList(raw.researchIds)
    });
  }
  L.registerKind({ kind: "collections", key: KEY, prefix: "cl", read: read });

  // ctx: { notes, books, research } (live lists, to check what is added still exists)
  function check(input, ctx) {
    const c = ctx || {}, i = input || {}, e = {};
    const name = line(i.name, 80);
    if (!name) e.name = "Give the collection a name.";
    const noteIds = idList(i.noteIds), bookIds = idList(i.bookIds), researchIds = idList(i.researchIds);
    const has = function (list, id) { return list.some(function (x) { return x.id === id; }); };
    if (c.notes && noteIds.some(function (x) { return !has(c.notes, x); })) e.noteIds = "One of those notes no longer exists.";
    if (c.books && bookIds.some(function (x) { return !has(c.books, x); })) e.bookIds = "One of those books no longer exists.";
    if (c.research && researchIds.some(function (x) { return !has(c.research, x); })) e.researchIds = "One of those research projects no longer exists.";
    if (Object.keys(e).length) return { ok: false, errors: e };
    return { ok: true, value: { name: name, description: line(i.description, 300), tag: L.parseTags([i.tag])[0] || "", noteIds: noteIds, bookIds: bookIds, researchIds: researchIds } };
  }

  // What is in a collection: { notes: [{ note, via: "added" | "topic" }], books, research, cards (those with its topic) }.
  function contents(coll, state) {
    const live = L.live, byId = function (list) { const m = {}; live(list).forEach(function (x) { m[x.id] = x; }); return m; };
    const notes = byId(state && state.notes), books = byId(state && state.books), research = byId(state && state.research);
    const out = { notes: [], books: [], research: [], cards: [] }, seen = {};
    (coll.noteIds || []).forEach(function (id) { if (notes[id]) { seen[id] = true; out.notes.push({ note: notes[id], via: "added" }); } });
    if (coll.tag) {
      live(state && state.notes).forEach(function (n) { if (!seen[n.id] && (n.tags || []).indexOf(coll.tag) !== -1) { seen[n.id] = true; out.notes.push({ note: n, via: "topic" }); } });
      live(state && state.cards).forEach(function (c) { if ((c.tags || []).indexOf(coll.tag) !== -1) out.cards.push(c); });
    }
    out.notes.sort(function (a, b) { return num(b.note.createdAt) - num(a.note.createdAt); });
    (coll.bookIds || []).forEach(function (id) { if (books[id]) out.books.push(books[id]); });
    (coll.researchIds || []).forEach(function (id) { if (research[id]) out.research.push(research[id]); });
    return out;
  }
  function withMember(coll, kind, id, member, now) {
    const field = kind === "notes" ? "noteIds" : kind === "books" ? "bookIds" : "researchIds";
    const list = (coll[field] || []).filter(function (x) { return x !== id; });
    if (member) list.push(id);
    const next = Object.assign({}, coll, { updatedAt: now });
    next[field] = list;
    return next;
  }
  // Which collections hold a note (added by hand, or by its topic).
  function collectionsOf(note, collections) {
    return L.live(collections).filter(function (c) { return (c.noteIds || []).indexOf(note.id) !== -1 || (c.tag && (note.tags || []).indexOf(c.tag) !== -1); });
  }

  return { KEY: KEY, keywords: keywords, shared: shared, related: related, booksDiscussing: booksDiscussing, topics: topics, renameTag: renameTag, read: read, check: check, contents: contents, withMember: withMember, collectionsOf: collectionsOf };
});
