"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../../js/learning-logic");
const S = require("../../js/learning-srs");
const G = require("../../js/learning-goals-logic");

const TODAY = "2026-11-11";                     // a Wednesday; its week is Mon Nov 9 - Sun Nov 15
const NOW = Date.parse("2026-11-11T15:00:00Z");
const goal = (o) => G.read(Object.assign({ id: "g1", metric: "pages", target: 50, period: "week", startDate: "2026-10-26", status: "active", createdAt: 1, updatedAt: 1 }, o));
const book = (o) => L.readBook(Object.assign({ id: "b1", title: "Atomic Habits", totalPages: 300, currentPage: 0, status: "reading", createdAt: 1, updatedAt: 1, log: [] }, o));
const log = (...p) => p.map(([d, pg]) => ({ d, p: pg }));

test("a goal needs something to count, a way to repeat, a whole-number target and a start day", () => {
  assert.equal(L.KEYS.goals, "jarvisLearnGoals");
  assert.equal(L.PREFIX.goals, "gl");
  assert.ok(goal({}));
  [{ metric: "magic" }, { period: "yearly" }, { target: 0 }, { target: 2.5 }, { target: "lots" }, { startDate: "2026-02-30" }, { id: "" }].forEach((o) => assert.equal(goal(o), null, JSON.stringify(o)));
  const r = L.readList("goals", [goal({}), { id: "x", metric: "pages" }, "junk"]);
  assert.deepEqual([r.items.length, r.kept.length], [1, 2], "unreadable goals are kept as they were");
  assert.equal(goal({ period: "week", deadline: "2026-12-01" }).deadline, "", "a repeating goal has no deadline of its own");
  assert.equal(goal({ period: "range", deadline: "2026-10-01" }).deadline, "", "a deadline before the start is dropped");
});

test("goal form: checks, an automatic title, and one-time goals with an optional deadline", () => {
  const ctx = { today: TODAY, books: [{ id: "b1", title: "Atomic Habits" }] };
  assert.deepEqual(G.check({}, ctx).errors, { metric: "Choose what to count.", period: "Choose how often.", target: "Enter a whole number of at least 1." });
  assert.equal(G.check({ metric: "pages", period: "week", target: "0" }, ctx).errors.target, "Enter a whole number of at least 1.");
  assert.equal(G.check({ metric: "pages", period: "range", target: "10", startDate: "2026-11-01", deadline: "2026-10-31" }, ctx).errors.deadline, "The deadline can't be before the start date.");
  assert.equal(G.check({ metric: "finishBook", period: "range" }, ctx).errors.bookId, "Choose the book.");
  assert.equal(G.check({ metric: "pages", period: "week", target: "10", bookId: "gone" }, ctx).errors.bookId, "That book no longer exists.");
  const w = G.check({ metric: "pages", period: "week", target: "50" }, ctx).value;
  assert.deepEqual([w.title, w.startDate, w.deadline, w.status], ["Read 50 pages each week", TODAY, "", "active"]);
  assert.equal(G.check({ metric: "pages", period: "week", target: "50", title: "  My own words " }, ctx).value.title, "My own words", "a title you write is kept");
  const fb = G.check({ metric: "finishBook", period: "range", bookId: "b1", deadline: "2026-12-01" }, ctx).value;
  assert.deepEqual([fb.title, fb.target, fb.deadline], ["Finish Atomic Habits by Dec 1, 2026", 1, "2026-12-01"], "finishing a book is always 1");
  assert.equal(G.check({ metric: "implemented", period: "range", target: "3" }, ctx).value.title, "Implement 3 ideas", "no deadline is fine");
  assert.equal(G.check({ metric: "research", period: "month", target: "2" }, ctx).value.title, "Complete 2 research projects each month");
  assert.equal(G.check({ metric: "reviews", period: "day", target: "1" }, ctx).value.title, "Review 1 lesson each day");
  assert.equal(G.check({ metric: "minutes", period: "day", target: "30" }, ctx).value.title, "Read for 30 minutes each day");
  assert.equal(G.check({ metric: "pages", period: "range", target: "100", bookId: "b1" }, ctx).value.title, "Read 100 pages of Atomic Habits");
  assert.equal(G.check({ metric: "books", period: "month", target: "1", bookId: "b1" }, ctx).value.bookId, "", "a book only matters for pages, minutes and finishing one");
  assert.equal(G.EXAMPLES.length, 6);
  G.EXAMPLES.forEach((e) => assert.ok(G.check({ metric: e.metric, period: e.period, target: String(e.target), bookId: "b1" }, ctx).ok, e.label));
});

test("the periods: a day, Monday to Sunday, a calendar month, or the span you set", () => {
  assert.deepEqual(G.windowAt(goal({ period: "day" }), TODAY), { from: TODAY, to: TODAY });
  assert.deepEqual(G.windowAt(goal({ period: "week" }), TODAY), { from: "2026-11-09", to: "2026-11-15" });
  assert.deepEqual(G.windowAt(goal({ period: "week" }), "2026-11-15"), { from: "2026-11-09", to: "2026-11-15" }, "Sunday is the end of the week");
  assert.deepEqual(G.windowAt(goal({ period: "month" }), TODAY), { from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual(G.windowAt(goal({ period: "month" }), "2028-02-10"), { from: "2028-02-01", to: "2028-02-29" }, "a leap February");
  assert.deepEqual(G.windowAt(goal({ period: "range", startDate: "2026-11-01", deadline: "2026-12-01" }), TODAY), { from: "2026-11-01", to: "2026-12-01" });
  assert.deepEqual(G.windowAt(goal({ period: "range", startDate: "2026-11-01" }), TODAY), { from: "2026-11-01", to: "" }, "no deadline: no end");
});

test("progress is counted from the records, never typed in: pages (each counted once)", () => {
  const b = book({ log: log(["2026-11-02", 100], ["2026-11-09", 130], ["2026-11-10", 120], ["2026-11-11", 150]) });   // week of Nov 9: +30, correction, +20 (to 150 from high 130)
  const s = G.summarize(goal({}), { books: [b] }, TODAY);
  assert.deepEqual([s.now.value, s.now.target, s.now.pct, s.now.met, s.state, s.daysLeft], [50, 50, 100, true, "achieved", 4], "130-100 = 30 on the 9th; 120 is a correction (0); 150-130 = 20 on the 11th: 50 in all, not 60");
  assert.equal(G.summarize(goal({ target: 80 }), { books: [b] }, TODAY).now.pct, 63);
  assert.equal(G.summarize(goal({ bookId: "other" }), { books: [b] }, TODAY).now.value, 0, "limited to one book");
  assert.equal(G.summarize(goal({ bookId: "b1" }), { books: [b] }, TODAY).now.value, 50);
  assert.equal(G.summarize(goal({}), {}, TODAY).now.value, 0, "no records: zero, not an error");
  const del = Object.assign({}, b, { deletedAt: 5 });
  assert.equal(G.summarize(goal({}), { books: [del] }, TODAY).now.value, 0, "a deleted book counts for nothing");
});

test("the other things that can be counted", () => {
  const st = {
    books: [book({ id: "a", status: "completed", endDate: "2026-11-10" }), book({ id: "b", status: "completed", endDate: "2026-10-30" }), book({ id: "c", status: "reading" })],
    research: [L.readResearch({ id: "r1", title: "T", status: "completed", completedAt: "2026-11-12", createdAt: 1, updatedAt: 1 }), L.readResearch({ id: "r2", title: "U", status: "researching", createdAt: 1, updatedAt: 1 })],
    notes: [L.readNote({ id: "n1", type: "takeaway", text: "t", day: "2026-11-10", createdAt: 1, updatedAt: 1, srs: S.grade(S.grade(S.start("2026-11-01"), "good", "2026-11-09"), "good", "2026-11-11") }), L.readNote({ id: "n2", type: "quote", text: "q", day: "2026-11-10", createdAt: 1, updatedAt: 1 })],
    cards: [{ id: "c1", srs: S.practice(S.grade(S.start("2026-11-01"), "forgot", "2026-11-10"), "good", "2026-11-10") }],
    actions: [L.readAction({ id: "a1", lesson: "x", status: "done", implementedAt: "2026-11-11", createdAt: 1, updatedAt: 1 }), L.readAction({ id: "a2", lesson: "y", status: "doing", createdAt: 1, updatedAt: 1 })],
    sessions: [{ id: "s1", bookId: "a", day: "2026-11-10", minutes: 25 }, { id: "s2", bookId: "c", day: "2026-11-11", minutes: 40 }, { id: "s3", bookId: "a", day: "2026-10-20", minutes: 99 }]
  };
  const v = (o) => G.summarize(goal(Object.assign({ target: 99 }, o)), st, TODAY).now.value;
  assert.equal(v({ metric: "books" }), 1, "books finished this week (the Oct 30 one is last week)");
  assert.equal(v({ metric: "research" }), 1, "research completed this week");
  assert.equal(v({ metric: "takeaways" }), 1, "takeaways recorded on days this week: one (a quote is not a takeaway)");
  assert.equal(v({ metric: "implemented" }), 1, "ideas implemented this week");
  assert.equal(v({ metric: "reviews" }), 3, "scheduled reviews this week (2 on the lesson, 1 on the card); the practice answer is not counted");
  assert.equal(v({ metric: "minutes" }), 65, "minutes read this week, from reading sessions");
  assert.equal(v({ metric: "minutes", bookId: "a" }), 25, "limited to one book");
  assert.equal(v({ metric: "reviews", period: "day" }), 1, "today only");
});

test("finishing one book: only by finishing it (and on time, if there is a deadline)", () => {
  const g = goal({ id: "f", metric: "finishBook", target: 1, period: "range", startDate: "2026-11-01", deadline: "2026-11-30", bookId: "b1" });
  let s = G.summarize(g, { books: [book({ currentPage: 150 })] }, TODAY);
  assert.deepEqual([s.state, s.now.met, s.bookPct, s.daysLeft], ["active", false, 50, 19], "half way through: not done, and the book's own progress is shown");
  s = G.summarize(g, { books: [book({ status: "completed", endDate: "2026-11-08", currentPage: 300 })] }, TODAY);
  assert.deepEqual([s.state, s.now.achievedOn, s.bookPct], ["achieved", "2026-11-08", 100]);
  s = G.summarize(g, { books: [book({ status: "completed", endDate: "2026-12-05", currentPage: 300 })] }, "2026-12-06");
  assert.deepEqual([s.state, s.late], ["overdue", "2026-12-05"], "finished after the deadline: not met, and says when it was finished");
  s = G.summarize(g, { books: [book({ status: "completed", endDate: "2026-10-01", currentPage: 300 })] }, TODAY);
  assert.equal(s.now.met, false, "finished before the goal began: does not count");
  s = G.summarize(g, { books: [] }, TODAY);
  assert.deepEqual([s.book, s.now.met], [null, false], "the book was deleted: the goal just stays unmet");
});

test("one-time goals: deadline passed, no deadline, and not started yet", () => {
  const g = goal({ metric: "implemented", target: 3, period: "range", startDate: "2026-11-01", deadline: "2026-11-10" });
  const acts = [L.readAction({ id: "a", lesson: "x", status: "done", implementedAt: "2026-11-05", createdAt: 1, updatedAt: 1 })];
  let s = G.summarize(g, { actions: acts }, TODAY);
  assert.deepEqual([s.state, s.now.value, s.daysLeft], ["overdue", 1, 0], "deadline passed with 1 of 3: overdue");
  s = G.summarize(Object.assign({}, g, { deadline: "" }), { actions: acts }, TODAY);
  assert.deepEqual([s.state, s.daysLeft], ["active", null], "no deadline: still going, no days left");
  s = G.summarize(Object.assign({}, g, { startDate: "2026-11-20", deadline: "2026-12-10" }), { actions: acts }, TODAY);
  assert.equal(s.upcoming, true, "a goal that starts in the future says so");
  assert.equal(s.now.value, 0);
  const done = acts.concat([L.readAction({ id: "b", lesson: "y", status: "done", implementedAt: "2026-11-06", createdAt: 1, updatedAt: 1 }), L.readAction({ id: "c", lesson: "z", status: "done", implementedAt: "2026-11-08", createdAt: 1, updatedAt: 1 })]);
  s = G.summarize(g, { actions: done }, TODAY);
  assert.deepEqual([s.state, s.now.achievedOn], ["achieved", "2026-11-08"], "reached on the day the third idea was implemented");
});

test("a repeating goal remembers how each earlier week went", () => {
  const b = book({ log: log(["2026-10-26", 0], ["2026-10-30", 60], ["2026-11-03", 80], ["2026-11-09", 140], ["2026-11-11", 160]) });
  // weeks: Oct 26-Nov 1: +60 (met 50) ; Nov 2-8: +20 (not met); Nov 9-15 (now): +80 (met)
  const s = G.summarize(goal({ startDate: "2026-10-28" }), { books: [b] }, TODAY);
  assert.deepEqual(s.history.map((h) => [h.window.from, h.value, h.met]), [["2026-11-02", 20, false], ["2026-10-26", 60, true]], "newest first; starts with the week the goal began in");
  assert.deepEqual([s.now.value, s.now.met], [80, true]);
  assert.equal(G.streak(s.history), 0, "the most recent past week was missed: no streak");
  assert.equal(G.streak([{ met: true }, { met: true }, { met: false }]), 2);
  const mon = G.summarize(goal({ period: "month", startDate: "2026-09-15" }), { books: [] }, TODAY);
  assert.deepEqual(mon.history.map((h) => h.window.from), ["2026-10-01", "2026-09-01"], "months");
  const day = G.summarize(goal({ period: "day", startDate: "2026-11-08" }), { books: [] }, TODAY);
  assert.deepEqual(day.history.map((h) => h.window.from), ["2026-11-10", "2026-11-09", "2026-11-08"], "days");
  assert.deepEqual(G.summarize(goal({ period: "range", startDate: "2026-11-01" }), {}, TODAY).history, [], "a one-time goal has no past tries");
  assert.deepEqual(G.summarize(goal({ startDate: TODAY }), {}, TODAY).history, [], "a goal that began this week has no past weeks");
});

test("goals achieved in a week (for the weekly review)", () => {
  const b = book({ log: log(["2026-11-02", 100], ["2026-11-10", 160]) });
  const goals = [goal({ id: "w", startDate: "2026-11-01" }), goal({ id: "d", period: "day", target: 5, startDate: "2026-11-08" }), goal({ id: "r", metric: "implemented", target: 1, period: "range", startDate: "2026-11-01" }), goal({ id: "future", startDate: "2026-12-01" }), goal({ id: "gone", deletedAt: 1 })];
  const st = { books: [b], actions: [L.readAction({ id: "a", lesson: "x", status: "done", implementedAt: "2026-11-12", createdAt: 1, updatedAt: 1 })] };
  const got = G.achievedBetween(goals, st, "2026-11-09", "2026-11-15");
  assert.deepEqual(got.map((x) => [x.goal.id, x.on]).sort(), [["d", "2026-11-10"], ["r", "2026-11-12"], ["w", "2026-11-10"]], "the weekly goal (60 pages on the 10th), the daily goal (5+ pages that day) and the one-time goal; not the future or deleted ones");
  assert.deepEqual(G.achievedBetween(goals, st, "2026-11-02", "2026-11-08").map((x) => x.goal.id), [], "an earlier week: nothing was reached");
});

test("archiving writes the result down; reactivating takes it back; the Dashboard orders goals by urgency", () => {
  const g = goal({ metric: "implemented", target: 1, period: "range", startDate: "2026-11-01", deadline: "2026-11-30" });
  const met = G.archive(g, { actions: [L.readAction({ id: "a", lesson: "x", status: "done", implementedAt: "2026-11-05", createdAt: 1, updatedAt: 1 })] }, TODAY, NOW);
  assert.deepEqual([met.status, met.result, met.endedOn, met.finalValue], ["archived", "achieved", TODAY, 1]);
  const missed = G.archive(Object.assign({}, g, { deadline: "2026-11-10" }), {}, TODAY, NOW);
  assert.deepEqual([missed.result, missed.finalValue], ["missed", 0]);
  assert.equal(G.archive(g, {}, TODAY, NOW).result, "archived", "put away early, unmet and before its deadline");
  const back = G.reactivate(met, NOW);
  assert.deepEqual([back.status, back.result, back.endedOn, back.finalValue], ["active", undefined, undefined, undefined]);
  assert.equal(L.readList("goals", [met]).items[0].result, "achieved", "the result survives being stored and read back");
  const list = [goal({ id: "open", metric: "implemented", target: 3, period: "range", startDate: "2026-11-01", createdAt: 3 }), goal({ id: "soon", metric: "implemented", target: 3, period: "range", startDate: "2026-11-01", deadline: "2026-11-13", createdAt: 1 }), goal({ id: "late", metric: "implemented", target: 3, period: "range", startDate: "2026-11-01", deadline: "2026-11-05", createdAt: 2 }), goal({ id: "wk", createdAt: 4 }), met];
  assert.deepEqual(G.active(list, {}, TODAY).map((s) => s.goal.id), ["late", "soon", "wk", "open"], "overdue first, then soonest deadline (a weekly goal ends Sunday), then open-ended; archived ones are not active");
  assert.deepEqual(G.archived(list.concat([Object.assign({}, missed, { id: "m", endedOn: "2026-11-01" })])).map((x) => x.id), ["g1", "m"], "history: most recently ended first");
});
