"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../../js/learning-logic");
const G = require("../../js/learning-goals-logic");
const W = require("../../js/learning-weekly-logic");

const THIS = "2026-11-09", LAST = "2026-11-02", TODAY = "2026-11-11";   // Mondays; a Wednesday
const state = () => ({
  books: [
    { id: "b1", title: "Atomic Habits", status: "reading", totalPages: 300, currentPage: 60, startDate: "2026-10-26", endDate: "", log: [{ d: "2026-10-26", p: 0 }, { d: "2026-11-03", p: 10 }, { d: "2026-11-09", p: 30 }, { d: "2026-11-10", p: 60 }] },
    { id: "b2", title: "Influence", status: "completed", totalPages: 200, currentPage: 200, startDate: "2026-09-01", endDate: "2026-11-10", log: [] }
  ],
  research: [{ id: "r1", title: "Sleep", status: "completed", completedAt: "2026-11-09", sources: [] }, { id: "r2", title: "Old", status: "completed", completedAt: "2026-10-01", sources: [] }],
  notes: [{ id: "n1", type: "takeaway", text: "x", day: "2026-11-10", createdAt: 5, srs: { on: true, reviews: [{ d: "2026-11-10", g: "good" }, { d: "2026-11-10", g: "easy", p: 1 }, { d: "2026-11-03", g: "good" }] } }],
  cards: [{ id: "c1", question: "q", answer: "a", srs: { on: true, reviews: [{ d: "2026-11-09", g: "good" }, { d: "2026-11-09", g: "forgot" }, { d: "2026-11-10", g: "hard", p: 1 }] } }],
  actions: [{ id: "a1", lesson: "Do it", status: "done", implementedAt: "2026-11-11" }, { id: "a2", lesson: "Not yet", status: "todo" }],
  sessions: [{ id: "s1", bookId: "b1", day: "2026-11-10", minutes: 30 }, { id: "s2", bookId: "b1", day: "2026-11-03", minutes: 20 }, { id: "s3", bookId: "b1", day: "2026-11-10", minutes: 5, deletedAt: 9 }],
  goals: [G.read({ id: "g1", metric: "pages", target: 40, period: "week", startDate: "2026-10-26", status: "active", createdAt: 1, updatedAt: 1 })],
  reviews: [{ id: "wk_2026-11-02", weekStart: LAST, reflection: "Habits stack", struggled: "", applied: "", focusNext: "Read before bed", createdAt: 1, updatedAt: 1 }]
});

test("this week's figures are all counted from the records", () => {
  const s = W.summary(state(), THIS, TODAY);
  assert.deepEqual(s.figures, { pages: 50, minutes: 30, books: 1, research: 1, lessons: 1, cards: 3, cardsPct: 67, cardsPractice: 1, goals: 1, ideas: 1 });
  assert.deepEqual([s.week.start, s.week.end], [THIS, "2026-11-15"]);
  assert.equal(s.goals[0].goal.id, "g1");
  assert.equal(s.goals[0].on, "2026-11-10", "the day the weekly target was reached");
  assert.equal(s.empty, false);
});

test("last week, with no flashcard answers, has no percentage rather than 0%", () => {
  const s = W.summary(state(), LAST, TODAY);
  assert.deepEqual(s.figures, { pages: 10, minutes: 20, books: 0, research: 0, lessons: 1, cards: 0, cardsPct: null, cardsPractice: 0, goals: 0, ideas: 0 });
});

test("lessons count scheduled reviews only; practice answers are separate", () => {
  const s = W.summary(state(), THIS, TODAY);
  assert.equal(s.figures.lessons, 1, "the practice answer on the lesson is not a scheduled review");
  assert.equal(s.figures.cards, 3, "flashcard answers include practice");
  assert.equal(s.figures.cardsPractice, 1);
});

test("a week with nothing in it is empty, and nothing is invented", () => {
  const s = W.summary({ books: [], research: [], notes: [], cards: [], actions: [], sessions: [], goals: [], reviews: [] }, THIS, TODAY);
  assert.equal(s.empty, true);
  assert.deepEqual(s.figures, { pages: 0, minutes: 0, books: 0, research: 0, lessons: 0, cards: 0, cardsPct: null, cardsPractice: 0, goals: 0, ideas: 0 });
  assert.equal(W.summary({}, THIS, TODAY).empty, true, "missing lists are fine");
});

test("deleted records are not counted", () => {
  const st = state();
  st.sessions.forEach((x) => { x.deletedAt = 5; });
  st.actions[0].deletedAt = 5;
  st.books[1].deletedAt = 5;
  const f = W.summary(st, THIS, TODAY).figures;
  assert.deepEqual([f.minutes, f.ideas, f.books], [0, 0, 0]);
});

test("comparing a week with the one before", () => {
  const st = state();
  const rows = W.compare(W.summary(st, THIS, TODAY), W.summary(st, LAST, TODAY));
  const by = (k) => rows.find((r) => r.key === k);
  assert.deepEqual([by("pages").now, by("pages").before, by("pages").change, by("pages").dir], [50, 10, 40, "up"]);
  assert.deepEqual([by("minutes").change, by("minutes").dir], [10, "up"]);
  assert.deepEqual([by("lessons").change, by("lessons").dir], [0, "same"]);
  assert.deepEqual([by("books").change, by("goals").dir], [1, "up"]);
  assert.deepEqual([by("cardsPct").now, by("cardsPct").before, by("cardsPct").change, by("cardsPct").dir], [67, null, null, "none"], "no flashcards last week: nothing to compare");
  const back = W.compare(W.summary(st, LAST, TODAY), W.summary(st, THIS, TODAY));
  assert.equal(back.find((r) => r.key === "pages").dir, "down");
  assert.equal(rows.length, 9);
});

test("last week's intention, the four boxes and the past reviews", () => {
  const st = state();
  assert.deepEqual(W.lastIntention(st, THIS), { week: LAST, text: "Read before bed" });
  assert.equal(W.lastIntention(st, LAST), null, "no review the week before that");
  st.reviews[0].focusNext = "";
  assert.equal(W.lastIntention(st, THIS), null, "nothing written, nothing shown");
  assert.deepEqual(W.BOXES.map((b) => b.key), ["reflection", "struggled", "applied", "focusNext"]);
  assert.equal(W.written(st.reviews[0]), 1);
  st.reviews.push({ id: "wk_2026-11-09", weekStart: THIS, reflection: "a", struggled: "b", applied: "c", focusNext: "d", createdAt: 2, updatedAt: 2 });
  st.reviews.push({ id: "wk_empty", weekStart: "2026-10-26", reflection: "", struggled: "", applied: "", focusNext: "", createdAt: 3, updatedAt: 3 });
  st.reviews.push({ id: "wk_gone", weekStart: "2026-10-19", reflection: "zzz", deletedAt: 4, createdAt: 3, updatedAt: 3 });
  const past = W.pastReviews(st);
  assert.deepEqual(past.map((p) => [p.week, p.boxes]), [[THIS, 4], [LAST, 1]], "newest first; empty and deleted reviews are left out");
  assert.equal(W.reviewOf(st, THIS).reflection, "a");
  assert.equal(W.reviewOf(st, "2026-01-05"), null);
});

test("the review record keeps all four written boxes", () => {
  const r = L.checkReview({ weekStart: THIS, reflection: " lesson ", struggled: "hard", applied: "did it", focusNext: "more" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { weekStart: THIS, reflection: "lesson", struggled: "hard", applied: "did it", focusNext: "more" });
  assert.equal(L.checkReview({ weekStart: "2026-11-10" }).ok, false, "a review belongs to a Monday");
  const old = L.readReview({ id: "wk_x", weekStart: THIS, reflection: "old", focusNext: "old next" });
  assert.deepEqual([old.struggled, old.applied], ["", ""], "a review saved before the new boxes simply has them empty");
});
