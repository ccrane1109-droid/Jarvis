"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../../js/learning-srs");

const TODAY = "2026-11-09";
const note = (id, srs, o) => Object.assign({ id, createdAt: 1, srs }, o);

test("a new schedule starts tomorrow, with the steps you asked for plus two long ones", () => {
  assert.deepEqual(S.STEPS.slice(0, 5), [1, 3, 7, 14, 30]);
  assert.deepEqual(S.STEPS.slice(5), [60, 90]);
  const s = S.start(TODAY);
  assert.deepEqual([s.on, s.step, s.due, s.paused, s.started, s.last, s.lapses, s.reviews], [true, 0, "2026-11-10", false, TODAY, "", 0, []]);
});

test("Good walks the steps: 1, 3, 7, 14, 30, 60, 90 days, then stays at 90", () => {
  let s = S.start("2026-01-01"), day = "2026-01-02";
  const gaps = [];
  for (let i = 0; i < 8; i++) {
    s = S.grade(s, "good", day);
    gaps.push(S.daysUntil(s, day));
    day = s.due;
  }
  assert.deepEqual(gaps, [3, 7, 14, 30, 60, 90, 90, 90]);
  assert.equal(s.reviews.length, 8);
  assert.equal(s.lapses, 0);
});

test("Easy skips a step, Hard comes back sooner on the same step, Forgot starts again tomorrow", () => {
  let s = S.start(TODAY);                                  // step 0
  const easy = S.grade(s, "easy", "2026-11-10");
  assert.deepEqual([easy.step, S.daysUntil(easy, "2026-11-10")], [2, 7], "1 -> 7 days");
  const good = S.grade(S.grade(s, "good", "2026-11-10"), "good", "2026-11-13");   // now waiting 7 (step 2)
  assert.equal(good.step, 2);
  const hard = S.grade(good, "hard", "2026-11-20");
  assert.deepEqual([hard.step, S.daysUntil(hard, "2026-11-20")], [2, 4], "hard on the 7-day step: same step, half the wait (4 days)");
  const hard1 = S.grade(s, "hard", "2026-11-10");
  assert.deepEqual([hard1.step, S.daysUntil(hard1, "2026-11-10")], [0, 1], "hard never goes below 1 day");
  const forgot = S.grade(good, "forgot", "2026-11-20");
  assert.deepEqual([forgot.step, forgot.due, forgot.lapses], [0, "2026-11-21", 1]);
  const top = S.grade(S.grade(S.grade(S.grade(good, "easy", "2026-11-20"), "easy", "2026-12-30"), "easy", "2027-03-01"), "easy", "2027-04-01");
  assert.equal(top.step, S.STEPS.length - 1, "easy stops at the last step");
});

test("the next date is counted from the day you review, not from when it was due", () => {
  const s = Object.assign(S.start("2026-11-01"), { due: "2026-11-02", step: 1 });   // waiting 3 days, was due the 2nd
  const late = S.grade(s, "good", "2026-11-12");                                   // reviewed 10 days late
  assert.deepEqual([late.step, late.due], [2, "2026-11-19"], "7 days from the day you actually reviewed");
});

test("the old record is never changed, an unknown answer changes nothing, and a schedule that is off cannot be graded", () => {
  const s = S.start(TODAY);
  const frozen = JSON.stringify(s);
  S.grade(s, "good", "2026-11-10");
  assert.equal(JSON.stringify(s), frozen);
  assert.equal(S.grade(s, "bogus", "2026-11-10"), s);
  const off = S.setEnabled(s, false, TODAY);
  assert.equal(S.grade(off, "good", "2026-11-10"), off);
});

test("the buttons can say what each answer will do", () => {
  const s = Object.assign(S.start(TODAY), { step: 2, due: TODAY });
  const p = S.preview(s, TODAY);
  assert.deepEqual([p.forgot.days, p.hard.days, p.good.days, p.easy.days], [1, 4, 14, 30], "from the 7-day step: forgot 1, hard 4 (half of 7, rounded), good 14, easy 30");
  assert.equal(p.good.due, "2026-11-23");
  assert.deepEqual(S.preview(null, TODAY).good, { days: 1, due: "2026-11-10" }, "something never scheduled starts at 1 day");
});

test("due, paused and off", () => {
  const s = Object.assign(S.start("2026-11-01"), { due: "2026-11-09" });
  assert.equal(S.isDue(s, "2026-11-08"), false);
  assert.equal(S.isDue(s, "2026-11-09"), true, "due on its day");
  assert.equal(S.isDue(s, "2026-11-20"), true, "and stays due");
  const p = S.pause(s);
  assert.deepEqual([S.isDue(p, "2026-11-20"), S.isActive(p), p.due], [false, false, "2026-11-09"], "a paused one is never due, and keeps its date");
  const r = S.resume(p, "2026-11-20");
  assert.deepEqual([r.paused, r.due, S.isDue(r, "2026-11-20")], [false, "2026-11-20", true], "resuming something overdue makes it due today, not 11 days overdue");
  const later = S.resume(S.pause(Object.assign({}, s, { due: "2026-12-01" })), "2026-11-20");
  assert.equal(later.due, "2026-12-01", "resuming something not yet due keeps its date");
  assert.equal(S.isDue(S.setEnabled(s, false, TODAY), "2026-11-20"), false, "turned off");
  assert.equal(S.isDue(null, TODAY), false);
  assert.deepEqual([S.when(s, "2026-11-12"), S.when(s, "2026-11-09"), S.when(s, "2026-11-05"), S.when(p, "2026-11-09"), S.when(null, TODAY)].map((x) => x.kind + ":" + x.days), ["overdue:3", "today:0", "later:4", "paused:0", "off:null"]);
});

test("turning the schedule on and off keeps what was learned about it", () => {
  const on = S.setEnabled(null, true, TODAY);
  assert.deepEqual([on.on, on.due], [true, "2026-11-10"]);
  const reviewed = S.grade(on, "good", "2026-11-10");
  const off = S.setEnabled(reviewed, false, "2026-11-11");
  assert.deepEqual([off.on, off.reviews.length, off.due], [false, 1, reviewed.due], "off: history and date kept");
  const back = S.setEnabled(off, true, "2026-11-30");
  assert.deepEqual([back.on, back.step, back.due], [true, reviewed.step, "2026-11-30"], "on again: same step; due today if the date had passed");
  const practised = S.practice(S.blank(), "good", TODAY);
  const started = S.setEnabled(practised, true, TODAY);
  assert.deepEqual([started.on, started.step, started.reviews.length], [true, 0, 1], "practice done before the schedule was on is not lost");
});

test("extra practice is remembered but never moves the schedule", () => {
  const s = S.start(TODAY);
  const p = S.practice(s, "forgot", TODAY);
  assert.deepEqual([p.due, p.step, p.lapses], [s.due, s.step, 0]);
  assert.deepEqual(p.reviews, [{ d: TODAY, g: "forgot", p: 1 }]);
  assert.equal(S.practice(null, "good", TODAY).on, false, "an item with no schedule can still be practised");
  assert.equal(S.practice(s, "bogus", TODAY), s);
});

test("what is stored is cleaned; nothing readable is invented", () => {
  assert.equal(S.read(null), null);
  assert.equal(S.read([]), null);
  assert.equal(S.read("x"), null);
  const r = S.read({ on: true, step: 99, due: "not a date", paused: "yes", started: "2026-02-30", last: "2026-11-01", lapses: -4, reviews: [{ d: "2026-11-01", g: "good" }, { d: "bad", g: "good" }, { d: "2026-11-02", g: "nope" }, { d: "2026-11-03", g: "hard", p: true }, 5, null] });
  assert.deepEqual([r.on, r.step, r.due, r.paused, r.started, r.last, r.lapses], [false, 0, "", false, "", "2026-11-01", 0], "no valid due date means it is not scheduled");
  assert.deepEqual(r.reviews, [{ d: "2026-11-01", g: "good" }, { d: "2026-11-03", g: "hard", p: 1 }], "only well-formed reviews are kept");
  const many = S.read({ on: true, step: 1, due: TODAY, reviews: Array.from({ length: 400 }, (_, i) => ({ d: "2026-11-01", g: "good" })) });
  assert.equal(many.reviews.length, S.MAX_REVIEWS, "the history is capped");
});

test("what is due: oldest first, paused and off left out, deleted ignored", () => {
  const mk = (due, o) => Object.assign(S.start("2026-11-01"), { due }, o || {});
  const items = [
    note("a", mk("2026-11-08")), note("b", mk("2026-11-05")), note("c", mk("2026-11-12")), note("d", mk("2026-11-01", { paused: true })),
    note("e", null), note("f", S.setEnabled(mk("2026-11-01"), false, TODAY)), note("g", mk("2026-11-02"), { deletedAt: 5 }), note("h", mk("2026-11-05"), { createdAt: 0 })
  ];
  assert.deepEqual(S.dueItems(items, TODAY).map((i) => i.id), ["h", "b", "a"], "by due date, then by when it was created");
  const sum = S.summary(items, TODAY);
  assert.deepEqual(sum, { due: 3, overdue: 3, dueSoon: 1, paused: 1, scheduled: 5, nextDue: "2026-11-12" });
  assert.deepEqual(S.summary([], TODAY), { due: 0, overdue: 0, dueSoon: 0, paused: 0, scheduled: 0, nextDue: "" });
  assert.deepEqual(S.scheduled(items).map((i) => i.id), ["b", "h", "a", "c", "d"], "everything that is scheduled, soonest first, paused ones last");
});

test("accuracy counts only what happened, and says nothing when nothing did", () => {
  let a = S.start("2026-11-01");
  a = S.grade(a, "good", "2026-11-02"); a = S.grade(a, "forgot", "2026-11-05"); a = S.grade(a, "easy", "2026-11-06");
  a = S.practice(a, "hard", "2026-11-07"); a = S.practice(a, "forgot", "2026-11-08");
  const items = [note("a", a), note("gone", S.grade(S.start("2026-11-01"), "forgot", "2026-11-02"), { deletedAt: 9 }), note("none", null)];
  assert.deepEqual(S.accuracy(items, "2026-11-01", "2026-11-30"), { total: 5, correct: 3, pct: 60 }, "deleted items and items with no history are left out");
  assert.deepEqual(S.accuracy(items, "2026-11-01", "2026-11-30", { practice: false }), { total: 3, correct: 2, pct: 67 }, "scheduled reviews only");
  assert.deepEqual(S.accuracy(items, "2026-11-01", "2026-11-30", { practice: true }), { total: 2, correct: 1, pct: 50 }, "practice only");
  assert.deepEqual(S.accuracy(items, "2026-11-06", "2026-11-06"), { total: 1, correct: 1, pct: 100 }, "one day");
  assert.deepEqual(S.accuracy(items, "2026-12-01", "2026-12-31"), { total: 0, correct: 0, pct: null }, "no reviews: no percentage, not 0%");
  assert.equal(S.count(items, "2026-11-01", "2026-11-30"), 5);
  assert.equal(S.isCorrect("hard"), true);
  assert.equal(S.isCorrect("forgot"), false);
});

test("the cards you miss most need enough reviews to say anything", () => {
  const mk = (grades) => grades.reduce((s, g, i) => S.grade(s, g, "2026-11-" + String(i + 2).padStart(2, "0")), S.start("2026-11-01"));
  const items = [note("often-missed", mk(["forgot", "forgot", "good", "forgot"])), note("solid", mk(["good", "easy", "good"])), note("too-few", mk(["forgot"]))];
  const h = S.hardest(items, 3, 5);
  assert.deepEqual(h.map((r) => [r.item.id, r.pct, r.total]), [["often-missed", 25, 4], ["solid", 100, 3]]);
});
