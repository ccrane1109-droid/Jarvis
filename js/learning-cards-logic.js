/* ==========================================================================
   JARVIS — Learning & Research Hub: flashcards (pure rules).

   A card is a question and an answer you wrote yourself, optionally tied to books, a chapter and research projects:
     { id, question, answer, bookIds[], researchIds[], chapter, tags[], noteId, inbox, srs, createdAt, updatedAt, deletedAt? }
   `srs` is the same review schedule a lesson (note) has (see learning-srs.js): cards are scheduled by default, and can be left
   out of the schedule to be used for practice only. Their answers (Easy / Good / Hard / Forgot) build a history from which
   the accuracy is worked out. Nothing here is generated; there are no questions you did not write.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./learning-logic"), require("./learning-srs"));
  else root.JarvisLearningCards = factory(root.JarvisLearningLogic, root.JarvisLearningSRS);
})(typeof self !== "undefined" ? self : this, function (L, S) {
  "use strict";

  const KEY = "jarvisLearnCards";

  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function line(v, max) { return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : ""; }
  function para(v, max) { return typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, "").replace(/[ \t]+\n/g, "\n").trim().slice(0, max) : ""; }
  function idList(v) { const out = []; (Array.isArray(v) ? v : []).forEach(function (x) { if (typeof x === "string" && x && x.length <= 80 && out.indexOf(x) === -1 && out.length < 50) out.push(x); }); return out; }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }
  function undef(o) { Object.keys(o).forEach(function (k) { if (o[k] === undefined) delete o[k]; }); return o; }

  // A card as stored -> a clean card, or null when it can't be one (then it is kept untouched by the store).
  function read(raw) {
    if (!isObj(raw) || typeof raw.id !== "string" || !raw.id) return null;
    const question = para(raw.question, 500), answer = para(raw.answer, 2000);
    if (!question || !answer) return null;
    return undef({
      id: raw.id, createdAt: num(raw.createdAt), updatedAt: num(raw.updatedAt), deletedAt: num(raw.deletedAt) || undefined,
      question: question, answer: answer, bookIds: idList(raw.bookIds), researchIds: idList(raw.researchIds), chapter: line(raw.chapter, 80),
      tags: L.parseTags(raw.tags), noteId: typeof raw.noteId === "string" ? raw.noteId.slice(0, 80) : "", inbox: raw.inbox === true ? true : undefined,
      srs: S.read(raw.srs) || undefined
    });
  }
  L.registerKind({ kind: "cards", key: KEY, prefix: "cd", read: read });

  // ctx: { today, books: [live], research: [live], existingSrs, selfId }
  // input.remember: true puts the card in the review schedule (the default for a new card), false keeps it for practice only.
  function check(input, ctx) {
    const c = ctx || {}, i = input || {}, e = {};
    const question = para(i.question, 500), answer = para(i.answer, 2000);
    if (!question) e.question = "Write the question.";
    if (!answer) e.answer = "Write the answer, so you can check yourself.";
    const bookIds = idList(i.bookIds), researchIds = idList(i.researchIds);
    const bookSet = {}, resSet = {};
    (c.books || []).forEach(function (b) { bookSet[b.id] = true; });
    (c.research || []).forEach(function (r) { resSet[r.id] = true; });
    if (c.books && bookIds.some(function (x) { return !bookSet[x]; })) e.bookIds = "One of the linked books no longer exists.";
    if (c.research && researchIds.some(function (x) { return !resSet[x]; })) e.researchIds = "One of the linked research projects no longer exists.";
    if (Object.keys(e).length) return { ok: false, errors: e };
    let srs = c.existingSrs || null;
    if (typeof i.remember === "boolean") {
      if (i.remember) srs = c.existingSrs && c.existingSrs.on ? c.existingSrs : S.setEnabled(c.existingSrs || null, true, c.today || "");
      else if (c.existingSrs) srs = S.setEnabled(c.existingSrs, false, c.today || "");
    }
    return {
      ok: true,
      value: undef({ question: question, answer: answer, bookIds: bookIds, researchIds: researchIds, chapter: line(i.chapter, 80), tags: L.parseTags(i.tags), noteId: typeof i.noteId === "string" ? i.noteId.slice(0, 80) : "", inbox: i.inbox === true ? true : undefined, srs: srs || undefined })
    };
  }

  // f: { q, tag, bookId, researchId, status: "due" | "scheduled" | "paused" | "practice", sort: "newest" | "due" | "hardest" | "question" }, today
  function filter(cards, state, f, today) {
    f = f || {};
    const names = {};
    L.live(state && state.books).forEach(function (b) { names[b.id] = b.title; });
    L.live(state && state.research).forEach(function (r) { names[r.id] = r.title; });
    const out = L.live(cards).filter(function (cd) {
      if (f.tag && (cd.tags || []).indexOf(f.tag) === -1) return false;
      if (f.bookId && (cd.bookIds || []).indexOf(f.bookId) === -1) return false;
      if (f.researchId && (cd.researchIds || []).indexOf(f.researchId) === -1) return false;
      if (f.inbox && !cd.inbox) return false;
      if (f.status === "due" && !S.isDue(cd.srs, today)) return false;
      if (f.status === "scheduled" && !(cd.srs && cd.srs.on && !cd.srs.paused)) return false;
      if (f.status === "paused" && !(cd.srs && cd.srs.on && cd.srs.paused)) return false;
      if (f.status === "practice" && cd.srs && cd.srs.on) return false;
      if (!f.q) return true;
      const hay = [cd.question, cd.answer, cd.chapter].concat(cd.tags || [], (cd.bookIds || []).concat(cd.researchIds || []).map(function (id) { return names[id]; })).filter(Boolean).join(" \n ").toLowerCase();
      return String(f.q).toLowerCase().split(/\s+/).filter(Boolean).every(function (t) { return hay.indexOf(t) !== -1; });
    });
    const newest = function (a, b) { return num(b.createdAt) - num(a.createdAt); };
    const sorts = {
      newest: newest,
      question: function (a, b) { return a.question.toLowerCase() < b.question.toLowerCase() ? -1 : a.question.toLowerCase() > b.question.toLowerCase() ? 1 : 0; },
      due: function (a, b) {
        // soonest first; paused ones after the active ones, and cards with no schedule at the very end
        const key = function (x) { return x.srs && x.srs.on && x.srs.due ? (x.srs.paused ? "9998" : "") + x.srs.due : "9999"; };
        const ad = key(a), bd = key(b);
        return ad < bd ? -1 : ad > bd ? 1 : newest(a, b);
      },
      hardest: function (a, b) { const pa = accuracy(a), pb = accuracy(b); return (pa === null ? 101 : pa) - (pb === null ? 101 : pb) || newest(a, b); }
    };
    return out.slice().sort(sorts[f.sort] || sorts.newest);
  }

  // How often a card was recalled, 0-100, or null when it has never been answered (never a made-up number).
  function accuracy(card) {
    const r = (card && card.srs && card.srs.reviews) || [];
    return r.length ? Math.round(r.filter(function (x) { return S.isCorrect(x.g); }).length / r.length * 100) : null;
  }

  // Fisher-Yates; `rand` is injectable so a test can be exact (Math.random in the app). Returns a new array.
  function shuffle(list, rand) {
    const a = list.slice(), r = rand || Math.random;
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  // The things to go through in a study session. Each entry: { kind: "notes" | "cards", id }.
  //   mode "due":      everything whose review is due (lessons and cards), the one most overdue first. Answers move the schedule.
  //   mode "practice": cards only, chosen by topic / book / project (opts.tag, bookId, researchId), optionally shuffled and limited.
  //                    Answers are remembered for accuracy but do not move the schedule.
  function queue(state, opts, today, rand) {
    const o = opts || {};
    if (o.mode === "practice") {
      let list = filter(state.cards, state, { tag: o.tag, bookId: o.bookId, researchId: o.researchId, status: o.onlyDue ? "due" : "", sort: "newest" }, today);
      if (o.shuffle !== false) list = shuffle(list, rand);
      if (o.limit > 0) list = list.slice(0, o.limit);
      return list.map(function (cd) { return { kind: "cards", id: cd.id }; });
    }
    const items = S.dueItems(L.live(state.notes).map(function (n) { return Object.assign({ _kind: "notes" }, n); }).concat(L.live(state.cards).map(function (c) { return Object.assign({ _kind: "cards" }, c); })), today);
    let q = items.map(function (it) { return { kind: it._kind, id: it.id }; });
    if (o.limit > 0) q = q.slice(0, o.limit);
    return q;
  }

  return { KEY: KEY, read: read, check: check, filter: filter, accuracy: accuracy, shuffle: shuffle, queue: queue };
});
