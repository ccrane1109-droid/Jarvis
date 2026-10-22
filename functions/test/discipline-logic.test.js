"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../../js/discipline-logic");

const morning = (o) => Object.assign({
  priorities: [{ text: "Homework", done: true }, { text: "Gym", done: true }, { text: "Design call", done: true }],
  keyTask: { text: "Send the text", done: true }, distraction: "phone", plan: "if home then homework"
}, o || {});
const review = (o) => Object.assign({
  screenHours: 4, phoneLimit: 5,
  items: { school: "done", gratiel: "done", bedOnTime: "done", phoneOut: "done", training: "done", phone: null },
  focus: 5, time: 5,
  procrastinated: "a bit after school", distractions: "instagram feed", wentWell: "homework first", improve: "start earlier"
}, o || {});
const day = (m, r, type) => ({ type: type || "normal", morning: m === null ? null : morning(m), review: r === null ? null : review(r) });
const cat = (result, key) => result.categories.filter((c) => c.key === key)[0];

test("a perfect day is exactly 100, and the categories add up to the published points", () => {
  const r = D.scoreDay(day());
  assert.equal(r.complete, true);
  assert.equal(r.score, 100);
  assert.deepEqual(r.categories.map((c) => [c.key, c.max, c.earned, c.possible]), [
    ["followThrough", 30, 30, 30], ["focus", 20, 20, 20], ["time", 15, 15, 15],
    ["consistency", 15, 15, 15], ["routines", 10, 10, 10], ["reflection", 10, 10, 10]
  ]);
  assert.deepEqual(r.excused, []);
  assert.equal(r.gap, null, "nothing to improve when everything is full marks");
});

test("a worked example, by hand", () => {
  // key task done (2) + 1 of 3 priorities (1) = 3 of 5 -> 18. focus 3 -> 5; phone 6h on a 5h limit -> 8.
  // time 4 -> 11.25. school done 7, business not 0. bed 4, phone out not 0, trained 3. plan 4 + 2 of 4 notes 3.
  const r = D.scoreDay(day(
    { priorities: [{ text: "A", done: true }, { text: "B", done: false }, { text: "C", done: false }] },
    { focus: 3, time: 4, screenHours: 6, items: { school: "done", gratiel: "not", bedOnTime: "done", phoneOut: "not", training: "done", phone: null }, wentWell: "", improve: "" }
  ));
  assert.equal(cat(r, "followThrough").earned, 18);
  assert.equal(cat(r, "focus").earned, 13);
  assert.equal(cat(r, "time").earned, 11.3, "11.25 shown to one decimal");
  assert.equal(cat(r, "consistency").earned, 7);
  assert.equal(cat(r, "routines").earned, 7);
  assert.equal(cat(r, "reflection").earned, 7);
  assert.equal(r.score, 63, "63.25 rounds to 63");
  assert.equal(r.detail.prioritiesDone, 1);
  assert.equal(r.detail.prioritiesTotal, 3);
});

test("the one task that makes the day a win counts double", () => {
  const onlyKey = D.scoreDay(day({ keyTask: { text: "Key", done: true }, priorities: [{ text: "A", done: false }, { text: "", done: false }, { text: "", done: false }] }));
  const onlyOther = D.scoreDay(day({ keyTask: { text: "Key", done: false }, priorities: [{ text: "A", done: true }, { text: "", done: false }, { text: "", done: false }] }));
  assert.equal(cat(onlyKey, "followThrough").earned, 20, "2 of 3 weight");
  assert.equal(cat(onlyOther, "followThrough").earned, 10, "1 of 3 weight");
});

test("with no plan there is nothing to follow through on, and the plan points are lost: not an invented score", () => {
  const r = D.scoreDay(day(null));
  assert.equal(cat(r, "followThrough").earned, 0);
  assert.equal(cat(r, "followThrough").possible, 30);
  assert.equal(cat(r, "reflection").earned, 6, "only the evening questions count");
  assert.equal(r.score, 100 - 30 - 4);
});

test("phone time is scored against the limit stored with that day's review", () => {
  const phone = (hours, lim) => cat(D.scoreDay(day({}, { screenHours: hours, phoneLimit: lim })), "focus").earned - 10;
  assert.equal(phone(3, 5), 10, "under the limit: full marks");
  assert.equal(phone(5, 5), 10, "at the limit: full marks");
  assert.equal(phone(6, 5), 8);
  assert.equal(phone(7.5, 5), 5);
  assert.equal(phone(10, 5), 0, "double the limit earns nothing");
  assert.equal(phone(20, 5), 0, "never negative");
  assert.equal(phone(4, 4), 10, "a different limit applies as stored");
});

test("items marked 'not today' leave both what was earned and what was possible", () => {
  const sick = D.scoreDay(day({}, { items: { school: "done", gratiel: "na", bedOnTime: "done", phoneOut: "done", training: "na", phone: "na" }, screenHours: null }, "sick"));
  assert.equal(sick.score, 100, "everything attainable was done");
  assert.equal(cat(sick, "focus").possible, 10);
  assert.equal(cat(sick, "consistency").possible, 7);
  assert.equal(cat(sick, "routines").possible, 7);
  assert.equal(sick.possible, 100 - 10 - 8 - 3);
  assert.deepEqual(sick.excused, ["Phone time", "Business block that made something", "Trained or rested as planned"]);
  const half = D.scoreDay(day({}, { items: { school: "not", gratiel: "na", bedOnTime: "done", phoneOut: "done", training: "done", phone: null } }));
  assert.equal(half.excused.length, 1);
  assert.ok(half.score < 100 && half.score > 85);
});

test("a day isn't scored until every item is answered, and it says which are missing", () => {
  assert.deepEqual(D.scoreDay(day({}, null)).missing, ["review"]);
  const r = D.scoreDay(day({}, { focus: null, items: { school: null, gratiel: "done", bedOnTime: "done", phoneOut: "done", training: "done", phone: null }, screenHours: null }));
  assert.equal(r.complete, false);
  assert.equal(r.score, null);
  assert.deepEqual(r.missing, ["focus", "phone", "school"]);
  assert.equal(D.scoreDay(day({}, { screenHours: null, items: { school: "done", gratiel: "done", bedOnTime: "done", phoneOut: "done", training: "done", phone: "na" } })).complete, true, "phone excused counts as answered");
});

test("reflection counts the evening questions that have a real answer (3+ characters)", () => {
  const r = (o) => cat(D.scoreDay(day({}, o)), "reflection").earned;
  assert.equal(r({}), 10);
  assert.equal(r({ procrastinated: "", distractions: "  " }), 7);
  assert.equal(r({ procrastinated: "ok", distractions: "yt", wentWell: "", improve: "" }), 4, "'ok' and 'yt' are too short; no notes at all, just the plan");
  assert.equal(r({ procrastinated: "", distractions: "", wentWell: "", improve: "" }), 4);
});

test("what to improve is the lowest category by share of its possible points; strong ones are 90%+", () => {
  const r = D.scoreDay(day({ priorities: [{ text: "A", done: false }, { text: "", done: false }, { text: "", done: false }], keyTask: { text: "K", done: false } }));
  assert.equal(r.gap.key, "followThrough");
  assert.equal(r.gap.earned, 0);
  assert.equal(r.gap.possible, 30);
  assert.ok(r.strong.includes("Time management") && !r.strong.includes("Following through"));
});

test("typed text is cleaned and capped, ratings and states must be valid, a done box needs text", () => {
  const d = D.sanitizeDay({
    type: "nonsense",
    morning: { priorities: [{ text: "  a\n\n  b  ", done: true }, { text: "", done: true }, null, { text: "fourth", done: true }], keyTask: { text: "x".repeat(500), done: "yes" }, distraction: "d".repeat(999), plan: 5 },
    review: { screenHours: "abc", phoneLimit: -3, items: { school: "maybe", gratiel: "done", phone: "na" }, focus: 9, time: "3", wentWell: "w".repeat(999) }
  });
  assert.equal(d.type, "normal");
  assert.equal(d.morning.priorities.length, 3, "always three slots");
  assert.equal(d.morning.priorities[0].text, "a b");
  assert.equal(d.morning.priorities[1].done, false, "an empty priority can't be done");
  assert.equal(d.morning.keyTask.text.length, D.PRIORITY_MAX);
  assert.equal(d.morning.keyTask.done, false, "only true counts");
  assert.equal(d.morning.distraction.length, D.NOTE_MAX);
  assert.equal(d.morning.plan, "5");
  assert.equal(d.review.screenHours, null);
  assert.equal(d.review.phoneLimit, D.DEFAULT_PHONE_LIMIT);
  assert.equal(d.review.items.school, null);
  assert.equal(d.review.items.gratiel, "done");
  assert.equal(d.review.items.phone, "na");
  assert.equal(d.review.focus, null, "9 is not a rating");
  assert.equal(d.review.time, 3);
  assert.equal(d.review.wentWell.length, D.NOTE_MAX);
  assert.equal(D.sanitizeDay(null).morning, null);
  assert.equal(D.sanitizeDay(undefined).review, null);
});

test("hours are kept to one decimal and must be a real number of hours in a day", () => {
  const h = (v) => D.sanitizeDay({ review: { screenHours: v } }).review.screenHours;
  assert.equal(h("4.26"), 4.3);
  assert.equal(h(0), 0, "zero hours is a real answer");
  assert.equal(h(""), null);
  assert.equal(h(25), null);
  assert.equal(h(-1), null);
});

test("the saved store drops bad dates and junk, keeps real days, and defaults the phone limit", () => {
  const s = D.sanitizeStore({
    settings: { phoneLimit: "abc" },
    days: { "2026-10-21": day(), "2026-13-45": day(), "nope": day(), "2026-10-20": {}, "2026-10-19": { type: "sick" } }
  });
  assert.deepEqual(Object.keys(s.days).sort(), ["2026-10-19", "2026-10-21"]);
  assert.equal(s.settings.phoneLimit, D.DEFAULT_PHONE_LIMIT);
  assert.equal(D.sanitizeStore({ settings: { phoneLimit: 3.5 } }).settings.phoneLimit, 3.5);
  assert.deepEqual(D.sanitizeStore(null), { settings: { phoneLimit: D.DEFAULT_PHONE_LIMIT }, days: {} });
  assert.deepEqual(D.sanitizeStore("garbage").days, {});
});

test("day types start with sensible excused items that can still be changed", () => {
  assert.deepEqual(D.excusedFor("normal"), []);
  assert.deepEqual(D.excusedFor("sick"), ["gratiel", "training", "phone"]);
  assert.deepEqual(D.excusedFor("rest"), ["training"]);
  assert.deepEqual(D.excusedFor("unknown"), []);
  assert.equal(D.excusedFor("sick").concat("x").length, 4, "returns a copy");
  assert.deepEqual(D.excusedFor("sick"), ["gratiel", "training", "phone"]);
});

test("date helpers work in plain calendar days, across months, years and clock changes", () => {
  assert.equal(D.addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(D.addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(D.addDays("2026-03-08", 1), "2026-03-09", "across the spring clock change");
  assert.equal(D.addDays("2026-11-01", 1), "2026-11-02", "across the autumn clock change");
  assert.equal(D.addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(D.weekdayOf("2026-10-22"), 4, "a Thursday");
  assert.equal(D.daysBetween("2026-10-01", "2026-10-22"), 21);
  assert.equal(D.isISODate("2026-02-30"), false);
  assert.equal(D.isISODate("2026-10-22"), true);
  assert.equal(D.isISODate(20261022), false);
});

const TODAY = "2026-10-22";
const scoredDay = (o) => day({}, o || {});

test("the review streak counts back from today, or from yesterday while today isn't scored yet", () => {
  const d = (n) => D.addDays(TODAY, -n);
  assert.equal(D.reviewStreak({}, TODAY), 0);
  assert.equal(D.reviewStreak({ [d(1)]: scoredDay(), [d(2)]: scoredDay() }, TODAY), 2, "today not yet scored: the streak is still alive");
  assert.equal(D.reviewStreak({ [TODAY]: scoredDay(), [d(1)]: scoredDay(), [d(2)]: scoredDay() }, TODAY), 3);
  assert.equal(D.reviewStreak({ [d(2)]: scoredDay(), [d(3)]: scoredDay() }, TODAY), 0, "yesterday missed and today not done");
  assert.equal(D.reviewStreak({ [TODAY]: scoredDay(), [d(2)]: scoredDay() }, TODAY), 1, "a gap ends it");
  assert.equal(D.reviewStreak({ [d(1)]: day({}, { focus: null }) }, TODAY), 0, "an unscored review isn't a streak day");
});

test("the last scored day is found, and later days are ignored", () => {
  const d = (n) => D.addDays(TODAY, -n);
  assert.equal(D.lastScored({}, TODAY), null);
  const days = { [d(5)]: scoredDay(), [d(2)]: scoredDay({ focus: 1 }), [d(1)]: day({}, null), "2026-10-30": scoredDay() };
  const last = D.lastScored(days, TODAY);
  assert.equal(last.date, d(2));
  assert.equal(last.score, D.scoreDay(days[d(2)]).score);
});

test("trends say 'not enough data' rather than averaging one or two days", () => {
  const d = (n) => D.addDays(TODAY, -n);
  const t = D.trendSummary({ [d(1)]: scoredDay(), [d(2)]: scoredDay() }, TODAY, 7);
  assert.equal(t.scoredDays, 2);
  assert.equal(t.enough, false);
  assert.equal(t.average, null);
  assert.equal(t.categories, null);
  assert.equal(t.weakest, null);
  assert.equal(t.weekdays, null);
  assert.equal(t.daily.length, 7);
  assert.equal(t.daily[6].date, TODAY);
  assert.equal(t.daily[0].date, d(6));
});

test("trends: average, best and worst, categories, phone, excused days and missed reviews, all from real days", () => {
  const d = (n) => D.addDays(TODAY, -n);
  const days = {
    [d(6)]: scoredDay({ focus: 1, time: 1, screenHours: 9 }),
    [d(5)]: scoredDay(),
    [d(4)]: scoredDay({ screenHours: 6 }),
    [d(3)]: day({}, null),                       // planned, never reviewed
    // d(2): nothing at all
    [d(1)]: scoredDay({ items: { school: "done", gratiel: "na", bedOnTime: "done", phoneOut: "done", training: "done", phone: null } })
  };
  const t = D.trendSummary(days, TODAY, 7);
  assert.equal(t.scoredDays, 4);
  assert.equal(t.enough, true);
  const scores = [d(6), d(5), d(4), d(1)].map((x) => D.scoreDay(days[x]).score);
  assert.equal(t.average, Math.round(scores.reduce((a, b) => a + b, 0) / 4));
  assert.equal(t.best.score, Math.max.apply(null, scores));
  assert.equal(t.worst.score, Math.min.apply(null, scores));
  assert.equal(t.worst.date, d(6));
  assert.equal(t.missed, 2, "d(3) planned without a review and d(2) empty; today and before first use don't count");
  assert.equal(t.excusedDays, 1);
  assert.equal(t.phone.days, 4);
  assert.equal(t.phone.averageHours, 5.8, "(9 + 4 + 6 + 4) / 4 = 5.75 shown to one decimal");
  assert.equal(t.phone.overLimit, 2, "9h and 6h against a 5h limit");
  assert.equal(t.categories.length, 6);
  assert.equal(t.weakest.key, "focus", "the low-focus, high-phone day pulls focus lowest");
  assert.deepEqual(t.daily.map((x) => [x.planned, x.reviewed]).slice(2, 5), [[true, true], [true, false], [false, false]]);
});

test("days before the first thing ever logged are never counted as missed", () => {
  const t = D.trendSummary({ [TODAY]: scoredDay() }, TODAY, 30);
  assert.equal(t.missed, 0);
  const t2 = D.trendSummary({}, TODAY, 30);
  assert.equal(t2.missed, 0);
  assert.equal(t2.scoredDays, 0);
});

test("weekday patterns need at least 14 scored days, and name a weekday only with 2+ days behind it", () => {
  const days = {};
  for (let i = 0; i < 28; i++) {
    const date = D.addDays(TODAY, -i);
    // Mondays go badly.
    days[date] = D.weekdayOf(date) === 1 ? scoredDay({ focus: 1, time: 1, screenHours: 12, items: { school: "not", gratiel: "not", bedOnTime: "not", phoneOut: "not", training: "not", phone: null } }) : scoredDay();
  }
  const t = D.trendSummary(days, TODAY, 28);
  assert.equal(t.scoredDays, 28);
  assert.equal(t.weekdays.length, 7);
  assert.equal(t.weakestWeekday.weekday, 1);
  assert.ok(t.weakestWeekday.days >= 2);
  const short = D.trendSummary(days, TODAY, 7);
  assert.equal(short.weekdays, null, "7 days is too few");
});

test("a plan remembers when its priorities last changed, defaulting to when it was saved", () => {
  const m = D.sanitizeDay({ morning: { priorities: [], keyTask: { text: "k" }, savedAt: 1000 } }).morning;
  assert.equal(m.savedAt, 1000);
  assert.equal(m.editedAt, 1000, "never edited: same as saved");
  const edited = D.sanitizeDay({ morning: { priorities: [], keyTask: { text: "k" }, savedAt: 1000, editedAt: 5000 } }).morning;
  assert.equal(edited.editedAt, 5000);
  assert.equal(D.scoreDay(day({ savedAt: 1000, editedAt: 9999 })).score, 100, "it is only a flag: the score itself does not depend on it");
});
