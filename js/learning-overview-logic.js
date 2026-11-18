/* ==========================================================================
   JARVIS — Learning & Research Hub: what the Overview shows (pure rules, no screen).

   Three figures, the book to log reading for, what is due for review, and a short list of recent learning activity.
   Everything is counted from the records you already have: page updates, saved reading time, notes, research,
   finished books, review answers, implemented actions. Nothing is typed in and nothing is estimated.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./learning-logic"), require("./learning-srs"), require("./learning-reading-logic"));
  else root.JarvisLearningOverview = factory(root.JarvisLearningLogic, root.JarvisLearningSRS, root.JarvisLearningReading);
})(typeof self !== "undefined" ? self : this, function (L, SRS, R) {
  "use strict";

  function arr(x) { return Array.isArray(x) ? x : []; }
  function noon(day) { return Date.parse(day + "T12:00:00Z"); }
  function snippet(text, n) { const t = String(text || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t; }

  // The three numbers at the top: books you are reading, pages read today, notes saved. state: { books, notes, sessions }.
  function figures(state, today) {
    const books = L.live(state && state.books), notes = L.live(state && state.notes);
    const t = R.totals(books, L.live(state && state.sessions), today, today);
    return {
      activeBooks: books.filter(function (b) { return b.status === "reading"; }).length,
      pagesToday: t.pages,
      notesSaved: notes.length
    };
  }

  // The book "Log reading" starts with: the one you read in most recently. Books you are reading come first, then paused, then the list to read.
  function logTarget(state) {
    const rank = { reading: 0, paused: 1, want: 2 };
    const list = L.live(state && state.books).filter(function (b) { return rank[b.status] !== undefined; });
    list.sort(function (a, b) { return (rank[a.status] - rank[b.status]) || ((b.updatedAt || 0) - (a.updatedAt || 0)); });
    return list.length ? list[0] : null;
  }

  // Notes and flashcards due for spaced repetition, oldest first. -> { due, overdue, scheduled, nextDue, items: first n [{ kind, id, title }] }
  function review(state, today, n) {
    const notes = L.live(state && state.notes), cards = L.live(state && state.cards), all = notes.concat(cards);
    const sum = SRS.summary(all, today);
    const items = SRS.dueItems(all, today).slice(0, n || 3).map(function (it) {
      const isCard = typeof it.question === "string";
      return { kind: isCard ? "cards" : "notes", id: it.id, title: snippet(isCard ? it.question : (it.title || it.text), 90), card: isCard };
    });
    return { due: sum.due, overdue: sum.overdue, scheduled: sum.scheduled, nextDue: sum.nextDue, items: items };
  }

  /* ---------------- recent activity ---------------- */

  // The latest things you did, newest first. Each: { key, day, ts, kind, text, go: { tab, id } }.
  // kind: pages | finished | note | research | source | review | action.
  function activity(state, today, limit) {
    const out = [];
    const day = function (ts) { return ts ? L.localDate(ts) : ""; };
    const push = function (e) { if (L.isDate(e.day) && e.day <= today) { e.ts = e.ts || noon(e.day); out.push(e); } };

    // Reading: pages and saved minutes for the same book on the same day are one line.
    const reading = {};
    const slot = function (bookId, d) { const k = bookId + "|" + d; return reading[k] || (reading[k] = { bookId: bookId, day: d, pages: 0, minutes: 0 }); };
    const books = L.live(state && state.books), byId = {};
    books.forEach(function (b) {
      byId[b.id] = b;
      L.dailyPages(b).forEach(function (e) { if (e.pages > 0) slot(b.id, e.d).pages += e.pages; });
      if (b.status === "completed" && L.isDate(b.endDate)) push({ key: "fin:" + b.id, day: b.endDate, kind: "finished", text: "Finished " + b.title, go: { tab: "books", id: b.id } });
    });
    L.live(state && state.sessions).forEach(function (s) {
      if (L.isDate(s.day) && s.minutes > 0) slot(s.bookId && byId[s.bookId] ? s.bookId : "", s.day).minutes += s.minutes;
    });
    Object.keys(reading).forEach(function (k) {
      const x = reading[k], b = x.bookId ? byId[x.bookId] : null;
      const text = x.pages > 0
        ? "Read " + x.pages + (x.pages === 1 ? " page" : " pages") + (b ? " of " + b.title : "") + (x.minutes ? " (" + R.minutesText(x.minutes) + ")" : "")
        : "Read for " + R.minutesText(x.minutes) + (b ? " · " + b.title : "");
      push({ key: "rd:" + k, day: x.day, kind: "pages", text: text, go: { tab: "books", id: b ? b.id : "" } });
    });
    L.live(state && state.notes).forEach(function (n) {
      const d = L.isDate(n.day) ? n.day : day(n.createdAt);
      push({ key: "note:" + n.id, day: d, ts: n.createdAt, kind: "note", text: "Saved a " + String(L.labelOf(L.NOTE_TYPE, n.type) || "note").toLowerCase() + ": " + snippet(n.title || n.text, 70), go: { tab: "knowledge", id: n.id } });
    });
    L.live(state && state.research).forEach(function (r) {
      push({ key: "res:" + r.id, day: day(r.createdAt), ts: r.createdAt, kind: "research", text: "Started research: " + snippet(r.title, 70), go: { tab: "research", id: r.id } });
      if (r.status === "completed" && L.isDate(r.completedAt)) push({ key: "resdone:" + r.id, day: r.completedAt, kind: "research", text: "Completed research: " + snippet(r.title, 70), go: { tab: "research", id: r.id } });
      arr(r.sources).forEach(function (s) { if (s && s.addedAt) push({ key: "src:" + s.id, day: day(s.addedAt), ts: s.addedAt, kind: "source", text: "Added a source to " + snippet(r.title, 50), go: { tab: "research", id: r.id } }); });
    });
    L.live(state && state.actions).forEach(function (a) {
      if (a.status === "done" && L.isDate(a.implementedAt)) push({ key: "act:" + a.id, day: a.implementedAt, kind: "action", text: "Put into practice: " + snippet(a.lesson, 70), go: { tab: "actions", id: "" } });
    });
    // review answers, one line per day
    const answers = {};
    SRS.entries(L.live(state && state.notes).concat(L.live(state && state.cards)), "", today).forEach(function (e) { answers[e.d] = (answers[e.d] || 0) + 1; });
    Object.keys(answers).forEach(function (d) { push({ key: "rev:" + d, day: d, ts: noon(d) + 2, kind: "review", text: "Reviewed " + answers[d] + (answers[d] === 1 ? " item" : " items"), go: { tab: "study", id: "" } }); });

    out.sort(function (a, b) { return a.day < b.day ? 1 : a.day > b.day ? -1 : (b.ts - a.ts) || (a.key < b.key ? -1 : 1); });
    return out.slice(0, limit || 6);
  }

  // "Today", "Yesterday", "3 days ago", else "Nov 3" (the screen formats the date; this gives the words that don't need it).
  function whenWords(day, today) {
    const n = L.diffDays(day, today);
    return n === 0 ? "Today" : n === 1 ? "Yesterday" : n > 1 && n < 7 ? n + " days ago" : "";
  }

  return { figures: figures, logTarget: logTarget, review: review, activity: activity, whenWords: whenWords };
});
