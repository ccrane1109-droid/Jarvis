/* ==========================================================================
   JARVIS — Learning & Research Hub: the weekly review's figures and week-to-week comparison (pure rules).

   Every figure is counted from the records, never typed in:
     pages            pages read (each page once; see learning-reading-logic.js)
     minutes          reading time saved
     books            books finished that week (by finish date)
     research         research projects completed that week (by completion date)
     lessons          scheduled reviews of lessons (notes on a review schedule) done that week
     cards            flashcard answers that week (scheduled and practice) and how many were recalled
     goals            goal tries whose target was reached that week
     ideas            actions marked Implemented that week
   A figure with nothing behind it is shown as "no data", not as 0%.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./learning-logic"), require("./learning-srs"), require("./learning-goals-logic"));
  else root.JarvisLearningWeekly = factory(root.JarvisLearningLogic, root.JarvisLearningSRS, root.JarvisLearningGoals);
})(typeof self !== "undefined" ? self : this, function (L, SRS, G) {
  "use strict";

  const BOXES = [
    { key: "reflection", label: "What was your biggest lesson this week?" },
    { key: "struggled", label: "What did you struggle to understand?" },
    { key: "applied", label: "What did you apply in real life?" },
    { key: "focusNext", label: "What do you want to improve next week?" }
  ];

  // state: { books, research, notes, cards, actions, goals, sessions, reviews }; week: the Monday.
  function summary(state, week, today) {
    const from = week, to = L.addDays(week, 6);
    const base = L.weeklyReview(state, week, today);
    const sessions = L.live(state && state.sessions).filter(function (s) { return L.isDate(s.day) && s.day >= from && s.day <= to; });
    const minutes = sessions.reduce(function (n, s) { return n + (s.minutes || 0); }, 0);
    const notes = L.live(state && state.notes), cards = L.live(state && state.cards);
    const lessons = SRS.count(notes, from, to, { practice: false });
    const answered = SRS.accuracy(cards, from, to);
    const practice = SRS.count(cards, from, to, { practice: true });
    const goals = G.achievedBetween(state && state.goals, state || {}, from, to);
    return {
      week: base.week, base: base, goals: goals,
      figures: {
        pages: base.reading.pages, minutes: minutes, books: base.reading.finished.length, research: base.research.completed.length,
        lessons: lessons, cards: answered.total, cardsPct: answered.pct, cardsPractice: practice, goals: goals.length, ideas: base.implemented.length
      },
      empty: base.empty && !minutes && !lessons && !answered.total && !goals.length
    };
  }

  const ROWS = [
    { key: "pages", label: "Pages read", unit: "page" },
    { key: "minutes", label: "Minutes read", unit: "minute" },
    { key: "books", label: "Books finished", unit: "book" },
    { key: "research", label: "Research completed", unit: "project" },
    { key: "lessons", label: "Lessons reviewed", unit: "review" },
    { key: "cards", label: "Flashcard answers", unit: "answer" },
    { key: "cardsPct", label: "Flashcards recalled", unit: "%" },
    { key: "goals", label: "Goals achieved", unit: "goal" },
    { key: "ideas", label: "Ideas implemented", unit: "idea" }
  ];

  // This week against another week: [{ key, label, unit, now, before, change, dir }]
  //   dir "up" | "down" | "same" | "none" ("none" when either side has nothing to measure, e.g. no flashcard answers).
  function compare(now, before) {
    return ROWS.map(function (r) {
      const a = now.figures[r.key], b = before.figures[r.key];
      if (a === null || a === undefined || b === null || b === undefined) return { key: r.key, label: r.label, unit: r.unit, now: a === undefined ? null : a, before: b === undefined ? null : b, change: null, dir: "none" };
      return { key: r.key, label: r.label, unit: r.unit, now: a, before: b, change: a - b, dir: a > b ? "up" : a < b ? "down" : "same" };
    });
  }

  // The saved review for a week, or null.
  function reviewOf(state, week) { return L.live(state && state.reviews).filter(function (r) { return r.weekStart === week; })[0] || null; }
  function written(r) { return r ? BOXES.filter(function (b) { return r[b.key]; }).length : 0; }

  // What I said last time I wanted to improve (the review of the week before), if I wrote anything.
  function lastIntention(state, week) {
    const r = reviewOf(state, L.addDays(week, -7));
    return r && r.focusNext ? { week: r.weekStart, text: r.focusNext } : null;
  }

  // Weeks that have a saved review with something written in it, newest first.
  function pastReviews(state, limit) {
    return L.live(state && state.reviews).filter(function (r) { return written(r) > 0; })
      .sort(function (a, b) { return a.weekStart < b.weekStart ? 1 : a.weekStart > b.weekStart ? -1 : 0; })
      .slice(0, limit || 12).map(function (r) { return { week: r.weekStart, boxes: written(r), review: r }; });
  }

  return { BOXES: BOXES, ROWS: ROWS, summary: summary, compare: compare, reviewOf: reviewOf, written: written, lastIntention: lastIntention, pastReviews: pastReviews };
});
