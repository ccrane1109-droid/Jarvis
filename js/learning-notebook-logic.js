/* ==========================================================================
   JARVIS — Learning & Research Hub: a notebook for every book (pure rules: no page, storage or network, so they can be tested
   outside the browser).

   Every book has one permanent notebook. The notebook is made of READING SESSIONS, each its own record that points at its book:

     entries   jarvisLearnBookNotes   { id, bookId, day, pages, chapter, notes, takeaways, lessons, quotes, pinned,
                                        createdAt, updatedAt, deletedAt? }

       day        the date you read (today by default, changeable)
       pages      free text, for example "45-62" (never feeds the page log or the reading charts: pages read each week are
                  still counted from page updates only, so nothing is counted twice)
       chapter    chapter or section, free text
       notes      main notes
       takeaways  key takeaways, one per line
       lessons    actionable lessons, one per line
       quotes     quotes worth keeping, one per line
       pinned     an important session, shown first

   Adding notes always makes a NEW session and editing changes only that one, so an earlier session can never be overwritten by
   a later one. Notes saved before this existed (jarvisLearnNotes, linked to a book through bookIds) are not moved or changed:
   the notebook simply shows them, by date, next to the sessions, so everything written about a book is in one place.

   Nothing is invented: every count, list and "last read" date is worked out from the records.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./learning-logic"));
  else root.JarvisLearningNotebook = factory(root.JarvisLearningLogic);
})(typeof self !== "undefined" ? self : this, function (L) {
  "use strict";

  const KEY = "jarvisLearnBookNotes";
  const LIMIT = { pages: 40, chapter: 120, notes: 20000, takeaways: 10000, lessons: 10000, quotes: 10000 };
  const TEXT_FIELDS = ["notes", "takeaways", "lessons", "quotes"];

  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }
  function line(v, max) { return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : ""; }
  function para(v, max) { return typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, "").replace(/[ \t]+\n/g, "\n").trim().slice(0, max) : ""; }
  function undef(o) { Object.keys(o).forEach(function (k) { if (o[k] === undefined) delete o[k]; }); return o; }

  /* ---------------- the record ---------------- */

  // A stored record -> a clean one, or null when it can't be one (no id, no book, no date). Records with no text are kept: they
  // are the person's, and the notebook shows them as an empty session rather than losing them.
  function read(raw) {
    if (!isObj(raw) || typeof raw.id !== "string" || !raw.id) return null;
    if (typeof raw.bookId !== "string" || !raw.bookId || raw.bookId.length > 80 || !L.isDate(raw.day)) return null;
    return undef({
      id: raw.id, createdAt: num(raw.createdAt), updatedAt: num(raw.updatedAt), deletedAt: num(raw.deletedAt) || undefined,
      bookId: raw.bookId, day: raw.day, pages: line(raw.pages, LIMIT.pages), chapter: line(raw.chapter, LIMIT.chapter),
      notes: para(raw.notes, LIMIT.notes), takeaways: para(raw.takeaways, LIMIT.takeaways), lessons: para(raw.lessons, LIMIT.lessons), quotes: para(raw.quotes, LIMIT.quotes),
      pinned: raw.pinned === true ? true : undefined
    });
  }
  L.registerKind({ kind: "entries", key: KEY, prefix: "bn", read: read });

  // Typed values -> the values to save. ctx: { today, books } (the live books, to check the one chosen still exists).
  // -> { ok: true, value } or { ok: false, errors }. Whether there is anything to save yet is isEmpty(value).
  function check(input, ctx) {
    const c = ctx || {}, i = input || {}, e = {};
    const bookId = typeof i.bookId === "string" ? i.bookId : "";
    if (!bookId) e.bookId = "Choose the book.";
    else if (c.books && !c.books.some(function (b) { return b && b.id === bookId && !b.deletedAt; })) e.bookId = "That book no longer exists.";
    const day = typeof i.day === "string" ? i.day : "";
    if (!L.isDate(day)) e.day = "Choose the day you read.";
    else if (c.today && day > c.today) e.day = "That day hasn't happened yet.";
    if (Object.keys(e).length) return { ok: false, errors: e };
    return {
      ok: true,
      value: { bookId: bookId, day: day, pages: line(i.pages, LIMIT.pages), chapter: line(i.chapter, LIMIT.chapter), notes: para(i.notes, LIMIT.notes), takeaways: para(i.takeaways, LIMIT.takeaways), lessons: para(i.lessons, LIMIT.lessons), quotes: para(i.quotes, LIMIT.quotes) }
    };
  }
  // Nothing written yet (the date alone is not something to save).
  function isEmpty(v) { const x = v || {}; return !(x.pages || x.chapter || x.notes || x.takeaways || x.lessons || x.quotes); }
  function same(a, b) { return ["bookId", "day", "pages", "chapter", "notes", "takeaways", "lessons", "quotes"].every(function (k) { return (a && a[k] || "") === (b && b[k] || ""); }); }

  /* ---------------- reading the text ---------------- */

  // "- one\n2) two\n\nthree" -> ["one", "two", "three"]. One idea per line, bullets and numbers stripped.
  function items(text) {
    return String(text || "").split(/\r?\n/).map(function (s) { return s.replace(/^\s*(?:[-*•–—]|\d{1,3}[.)])\s+/, "").trim(); }).filter(Boolean);
  }
  function firstLine(text) { const t = items(text)[0] || ""; return t; }
  // One line to show when a session is folded: the first of its notes, takeaways, lessons or quotes.
  function preview(entry, max) {
    const e = entry || {}, t = firstLine(e.notes) || firstLine(e.takeaways) || firstLine(e.lessons) || firstLine(e.quotes) || "";
    const n = max || 110;
    return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
  }
  function norm(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); }

  /* ---------------- one book's notebook ---------------- */

  function dayOfNote(n) { return L.isDate(n && n.day) ? n.day : (n && n.createdAt ? L.localDate(n.createdAt) : ""); }
  // The chapter an older note belongs to: its "page or chapter" when that has words in it ("Chapter 3"), not when it is only a number.
  function noteChapter(n) { const p = line(n && n.page, 40); return /[A-Za-zÀ-￿]/.test(p) ? p : ""; }
  function byTime(a, b) { return a.day < b.day ? -1 : a.day > b.day ? 1 : (a.at || 0) - (b.at || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }

  // The sessions of one book, oldest first (the order a notebook is read in).
  function forBook(entries, bookId) {
    return L.live(entries).filter(function (x) { return x.bookId === bookId; }).sort(function (a, b) { return byTime({ day: a.day, at: a.createdAt, id: a.id }, { day: b.day, at: b.createdAt, id: b.id }); });
  }

  function words(q) { return norm(q).split(" ").filter(Boolean); }
  function hay(item) {
    const r = item.record;
    return norm(item.kind === "session"
      ? [r.chapter, r.pages, r.notes, r.takeaways, r.lessons, r.quotes, r.day].join(" ")
      : [r.title, r.text, r.evidence, r.page, (r.tags || []).join(" "), r.day].join(" "));
  }
  // Every word typed must be somewhere in the session or note.
  function matches(item, q) { const w = words(q); if (!w.length) return true; const h = hay(item); return w.every(function (x) { return h.indexOf(x) !== -1; }); }
  function textHas(text, q) { const w = words(q); if (!w.length) return true; const h = norm(text); return w.every(function (x) { return h.indexOf(x) !== -1; }); }

  // state: { entries, notes, actions } (the Learning store's lists). opts: { q, view: "date" | "chapter" }.
  // -> everything the book page draws. The counts of what is listed follow the search; totalSessions does not.
  function notebook(book, state, opts) {
    const o = opts || {}, S = state || {}, id = book && book.id, q = o.q || "";
    const sessions = forBook(S.entries, id);
    const oldNotes = L.notesFor(S.notes, "book", id);
    let all = sessions.map(function (x) { return { kind: "session", id: x.id, day: x.day, at: x.createdAt, chapter: x.chapter, pinned: !!x.pinned, record: x }; })
      .concat(oldNotes.map(function (n) { return { kind: "note", id: n.id, day: dayOfNote(n), at: n.createdAt, chapter: noteChapter(n), pinned: !!n.important, record: n }; }));
    all.sort(byTime);
    const timeline = all.filter(function (it) { return matches(it, q); });

    // What was learned, from the sessions' own lines and from older notes of the matching kind.
    const lessons = [], quotes = [], ideas = [];
    const acts = L.actionsFor(S.actions, "book", id);
    const tracked = {};
    acts.forEach(function (a) { tracked[norm(String(a.lesson || "").slice(0, 500))] = true; });
    all.forEach(function (it) {
      const r = it.record;
      if (it.kind === "session") {
        items(r.takeaways).forEach(function (t) { if (textHas(t + " " + r.chapter, q)) lessons.push({ from: it.id, kind: "session", day: it.day, chapter: it.chapter, text: t }); });
        items(r.quotes).forEach(function (t) { if (textHas(t + " " + r.chapter, q)) quotes.push({ from: it.id, kind: "session", day: it.day, chapter: it.chapter, text: t }); });
        items(r.lessons).forEach(function (t) { if (textHas(t + " " + r.chapter, q)) ideas.push({ from: it.id, kind: "session", day: it.day, chapter: it.chapter, text: t, tracked: !!tracked[norm(t.slice(0, 500))] }); });
      } else if (r.type === "takeaway") {
        if (textHas((r.title || "") + " " + r.text, q)) lessons.push({ from: it.id, kind: "note", day: it.day, chapter: it.chapter, text: r.title ? r.title + " — " + r.text : r.text });
      } else if (r.type === "quote") {
        if (textHas(r.text, q)) quotes.push({ from: it.id, kind: "note", day: it.day, chapter: it.chapter, text: r.text });
      }
    });
    const planned = ideas.filter(function (x) { return !x.tracked; });
    const actions = acts.filter(function (a) { return textHas((a.lesson || "") + " " + (a.plan || ""), q); });

    const pinned = timeline.filter(function (it) { return it.pinned; });
    const rest = timeline.filter(function (it) { return !it.pinned; });
    const groups = o.view === "chapter" ? byChapter(rest) : byDate(rest);

    let last = "";
    sessions.forEach(function (x) { if (x.day > last) last = x.day; });
    const logged = L.lastLogged(book);
    if (logged > last) last = logged;

    return {
      bookId: id, totalSessions: sessions.length, totalNotes: oldNotes.length, lastDay: last,
      timeline: timeline, pinned: pinned, groups: groups,
      lessons: lessons, quotes: quotes, ideas: planned, actions: actions,
      counts: { notebook: timeline.length, lessons: lessons.length, quotes: quotes.length, actions: planned.length + actions.length }
    };
  }

  function byDate(list) {
    const out = [], idx = {};
    list.forEach(function (it) {
      const k = it.day || "";
      if (!(k in idx)) { idx[k] = out.length; out.push({ key: k, kind: "date", label: k, items: [] }); }
      out[idx[k]].items.push(it);
    });
    return out;       // the list is already oldest first
  }
  function byChapter(list) {
    const out = [], idx = {};
    list.forEach(function (it) {
      const k = norm(it.chapter);
      if (!(k in idx)) { idx[k] = out.length; out.push({ key: k, kind: k ? "chapter" : "none", label: k ? it.chapter : "No chapter", items: [] }); }
      out[idx[k]].items.push(it);
    });
    out.sort(function (a, b) {
      if (!a.key !== !b.key) return a.key ? -1 : 1;          // "No chapter" last
      return String(a.label).localeCompare(String(b.label), undefined, { numeric: true, sensitivity: "base" });
    });
    return out;
  }

  return {
    KEY: KEY, LIMIT: LIMIT, TEXT_FIELDS: TEXT_FIELDS,
    read: read, check: check, isEmpty: isEmpty, same: same, items: items, preview: preview, forBook: forBook, matches: matches, notebook: notebook, noteChapter: noteChapter, dayOfNote: dayOfNote
  };
});
