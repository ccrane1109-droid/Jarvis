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
  assert.deepEqual(D.sanitizeStore(null), {
    settings: { phoneLimit: D.DEFAULT_PHONE_LIMIT, times: D.DEFAULT_TIMES }, rules: [], avoid: [], timer: null, days: {}
  });
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

/* ---------------- accountability ---------------- */

test("times of day are tidied and fall back to the defaults when they aren't real times", () => {
  assert.deepEqual(D.sanitizeTimes({ planBy: "6:30", afterSchool: "25:00", review: "9:05" }), { planBy: "06:30", afterSchool: "15:45", review: "09:05" });
  assert.deepEqual(D.sanitizeTimes(null), D.DEFAULT_TIMES);
  assert.equal(D.minutesOf("20:30"), 1230);
});

test("rules are capped, trimmed, unique ignoring case, and never blank", () => {
  const r = D.sanitizeRules([{ id: "a1", text: "  Phone on the charger  " }, { id: "a2", text: "phone ON the charger" }, { text: "" }, null,
    { id: "bad id!", text: "Homework first" }, { id: "a1", text: "Plan tomorrow" }, { text: "x".repeat(500) }, { text: "Five" }, { text: "Six" }, { text: "Seven" }]);
  assert.equal(r.length, D.MAX_RULES);
  assert.equal(r[0].text, "Phone on the charger");
  assert.ok(r.every((x) => /^[A-Za-z0-9_-]{1,40}$/.test(x.id)), "every rule has a usable id");
  assert.equal(new Set(r.map((x) => x.id)).size, r.length, "ids are unique");
  assert.equal(r.filter((x) => x.text.length > D.RULE_MAX).length, 0);
  assert.deepEqual(D.sanitizeRules("junk"), []);
});

test("avoid entries need a real date, only known reasons and excuses are kept, and only the newest 300 stay", () => {
  const list = D.sanitizeAvoid([
    { at: 5, date: "2026-10-22", task: "Essay", reason: "afraid", excuse: "tomorrow", outcome: "started" },
    { date: "2026-13-01", task: "x" }, null, { date: "2026-10-22", reason: "made up", excuse: "nope", outcome: "maybe" }
  ]);
  assert.equal(list.length, 2);
  assert.deepEqual([list[0].reason, list[0].excuse, list[0].outcome], ["afraid", "tomorrow", "started"]);
  assert.deepEqual([list[1].reason, list[1].excuse, list[1].outcome], ["", "", null]);
  const many = [];
  for (let i = 0; i < 350; i++) many.push({ at: i + 1, date: "2026-10-22", task: "t" + i });
  const kept = D.sanitizeAvoid(many);
  assert.equal(kept.length, 300);
  assert.equal(kept[299].task, "t349", "the newest are kept");
});

test("the start timer works out when it ends from when it began, and rejects nonsense", () => {
  const t = D.sanitizeTimer({ task: "Essay", reason: "big", startedAt: 1000, minutes: 2 });
  assert.equal(t.endsAt, 1000 + 120000);
  assert.deepEqual([D.timerState(t, 1000).finished, D.timerState(t, 60000).remainingMs, D.timerState(t, 121000).finished, D.timerState(t, 99999999).remainingMs], [false, 61000, true, 0]);
  assert.equal(D.sanitizeTimer({ startedAt: 1000, minutes: 0 }), null);
  assert.equal(D.sanitizeTimer({ startedAt: 1000, minutes: 90 }), null);
  assert.equal(D.sanitizeTimer({ startedAt: -5, minutes: 2 }), null);
  assert.equal(D.sanitizeTimer(null), null);
  assert.equal(D.timerState(null, 5), null);
});

test("a review keeps your rule answers (with the rule's words) and what got in the way", () => {
  const r = D.sanitizeDay({ review: review({ blocker: "phone", rules: [{ id: "a", text: " Phone on the charger ", state: "done" }, { id: "b", text: "Homework first", state: "maybe" }, { text: "" }] }) }).review;
  assert.equal(r.blocker, "phone");
  assert.deepEqual(r.rules.map((x) => [x.text, x.state]), [["Phone on the charger", "done"], ["Homework first", null]]);
  assert.equal(D.sanitizeDay({ review: review({ blocker: "nonsense" }) }).review.blocker, "");
  assert.deepEqual(D.sanitizeDay({ review: review() }).review.rules, []);
  assert.equal(D.scoreDay(day({}, { rules: [{ text: "x", state: "not" }] })).score, 100, "rules are tracked but never change the score");
});

const SETTINGS = { times: D.DEFAULT_TIMES };
const NOON = 12 * 60, FOUR = 16 * 60, NINE = 21 * 60;
const up = (days, minutes, settings) => D.nextUp({ todayISO: TODAY, minutes: minutes, days: days, settings: settings || SETTINGS });
const planned = (o) => ({ type: "normal", morning: morning(o), review: null });
const dminus = (n) => D.addDays(TODAY, -n);

test("what to do next: first use, then a missed yesterday, then the plan", () => {
  assert.equal(up({}, NOON).kind, "plan");
  assert.match(up({}, NOON).title, /Start with a morning plan/);
  const missed = up({ [dminus(2)]: scoredDay() }, NOON);
  assert.deepEqual([missed.kind, missed.actions], ["missed", ["scoreYesterday"]]);
  assert.equal(up({ [TODAY]: planned({ keyTask: { text: "k", done: false } }) }, NOON).kind, "win", "first used today: yesterday isn't a miss");
  assert.equal(up({ [dminus(1)]: scoredDay() }, NOON).kind, "plan", "yesterday done, no plan yet today");
});

test("what to do next, through the day", () => {
  const base = { [dminus(1)]: scoredDay() };
  const k = (o) => Object.assign({}, base, { [TODAY]: planned(o) });
  const key = { keyTask: { text: "Finish the essay", done: false }, priorities: [{ text: "Homework", done: false }, { text: "Lift", done: false }, { text: "", done: false }] };
  const win = up(k(key), NOON);
  assert.deepEqual([win.kind, win.title, win.task, win.actions], ["win", "Finish the essay", { id: "key", text: "Finish the essay" }, ["start", "avoid"]]);
  assert.doesNotMatch(win.text, /before anything else/);
  assert.match(up(k(key), FOUR).text, /before anything else/, "after school it presses harder");
  const keyDone = Object.assign({}, key, { keyTask: { text: "Finish the essay", done: true }, priorities: [{ text: "Homework", done: true }, { text: "Lift", done: false }, { text: "", done: false }] });
  const next = up(k(keyDone), FOUR);
  assert.deepEqual([next.kind, next.title, next.task.id], ["next", "Lift", "p1"]);
  const all = Object.assign({}, keyDone, { priorities: [{ text: "Homework", done: true }, { text: "Lift", done: true }, { text: "", done: false }] });
  const done = up(k(all), FOUR);
  assert.equal(done.kind, "allDone");
  assert.match(done.text, /20:30/);
  assert.deepEqual(done.actions, []);
  assert.equal(up(k(key), NINE).kind, "review", "evening: review first, even with things undone");
  assert.equal(up(base, 7 * 60).kind, "plan", "no plan yet and it's before the review time");
});

test("with no plan by the evening, the answer is to review honestly", () => {
  const r = up({ [dminus(1)]: scoredDay() }, NINE);
  assert.deepEqual([r.kind, r.actions], ["review", ["review"]]);
});

test("once today is scored, the next thing is to plan tomorrow, then it's done", () => {
  const scored = { [dminus(1)]: scoredDay(), [TODAY]: scoredDay() };
  assert.equal(up(scored, NINE).kind, "planTomorrow");
  const withTomorrow = Object.assign({}, scored, { [D.addDays(TODAY, 1)]: planned() });
  const d = up(withTomorrow, NINE);
  assert.deepEqual([d.kind, d.actions], ["done", []]);
});

test("your own times move the thresholds", () => {
  const key = { keyTask: { text: "k", done: false }, priorities: [{ text: "", done: false }, { text: "", done: false }, { text: "", done: false }] };
  const days = { [dminus(1)]: scoredDay(), [TODAY]: planned(key) };
  assert.equal(up(days, 19 * 60, { times: { planBy: "06:30", afterSchool: "15:45", review: "18:00" } }).kind, "review");
  assert.equal(up(days, 19 * 60, { times: { planBy: "06:30", afterSchool: "15:45", review: "22:00" } }).kind, "win");
});

test("avoiding is summarised for the window: why, and how often you started anyway", () => {
  const avoid = D.sanitizeAvoid([
    { at: 1, date: TODAY, task: "a", reason: "afraid", outcome: "started" },
    { at: 2, date: TODAY, task: "b", reason: "afraid", outcome: "dropped" },
    { at: 3, date: dminus(1), task: "c", reason: "phone", outcome: "started" },
    { at: 4, date: dminus(2), task: "d", reason: "phone", outcome: "started" },
    { at: 5, date: dminus(3), task: "e", reason: "phone", outcome: null },
    { at: 6, date: dminus(20), task: "old", reason: "tired", outcome: "dropped" }
  ]);
  const s = D.avoidSummary(avoid, TODAY, 7);
  assert.deepEqual([s.total, s.started, s.dropped, s.open, s.startRate], [5, 3, 1, 1, 75]);
  assert.deepEqual(s.reasons.map((r) => [r.key, r.count]), [["phone", 3], ["afraid", 2]], "most common first; the old one is outside the window");
  assert.equal(s.reasons[0].label, "My phone keeps pulling me");
  assert.equal(D.avoidSummary(avoid, TODAY, 30).total, 6);
  assert.deepEqual(D.avoidSummary([], TODAY, 7), { total: 0, started: 0, dropped: 0, open: 0, startRate: null, reasons: [] });
});

test("what got in the way, and how often your rules were kept, from scored days", () => {
  const rules = (a, b) => [{ id: "1", text: "Phone on the charger", state: a }, { id: "2", text: "phone ON the charger", state: b }, { id: "3", text: "Homework first", state: "na" }];
  const days = {
    [TODAY]: day({}, { blocker: "phone", rules: rules("done", null) }),
    [dminus(1)]: day({}, { blocker: "phone", rules: rules("not", "done") }),
    [dminus(2)]: day({}, { blocker: "tired", rules: rules("done", null) }),
    [dminus(15)]: day({}, { blocker: "big", rules: rules("not", null) })
  };
  assert.deepEqual(D.blockerSummary(days, TODAY, 7).map((b) => [b.key, b.count]), [["phone", 2], ["tired", 1]]);
  const r = D.ruleSummary(days, TODAY, 7);
  // today: 1 answered (done); yesterday: 2 (not, done); two days ago: 1 (done) = 4 answered, 3 kept. The "na" and blank ones are left out.
  assert.deepEqual([r.answered, r.kept, r.rate], [4, 3, 75], "'not today' answers are left out; same words in any case are one rule");
  assert.deepEqual(r.byRule.map((x) => [x.text, x.answered, x.kept]), [["Phone on the charger", 4, 3]]);
  assert.deepEqual(D.ruleSummary({}, TODAY, 7), { answered: 0, kept: 0, rate: null, byRule: [] });
});

test("rule suggestions aim at the weakest areas once there is data, and never repeat a rule you already have", () => {
  const trend = { categories: [
    { key: "followThrough", label: "Following through", pct: 90 }, { key: "focus", label: "Focus and phone", pct: 40 },
    { key: "time", label: "Time management", pct: 70 }, { key: "consistency", label: "School and business", pct: 100 },
    { key: "routines", label: "Healthy routines", pct: 55 }, { key: "reflection", label: "Reflection", pct: null }
  ] };
  const s = D.suggestRules(trend, []);
  assert.deepEqual(s.map((x) => x.text), [D.AREA_RULES.focus, D.AREA_RULES.routines, D.AREA_RULES.time]);
  assert.equal(s[0].starter, false);
  assert.match(s[0].why, /Focus and phone averaged 40%/);
  const without = D.suggestRules(trend, [{ text: D.AREA_RULES.focus.toUpperCase() }]);
  assert.ok(!without.some((x) => x.text === D.AREA_RULES.focus), "an existing rule is not offered again, ignoring case");
  const starters = D.suggestRules(null, []);
  assert.equal(starters.length, 3);
  assert.ok(starters.every((x) => x.starter === true), "with no data they say so");
  assert.match(starters[0].why, /isn't enough scored data/);
  assert.equal(D.suggestRules({ categories: trend.categories.map((c) => Object.assign({}, c, { pct: 100 })) }, []).every((x) => x.starter), true);
});

test("the weekly text has numbers and rules, no private reflections, and is honest when there is nothing", () => {
  const days = {
    [TODAY]: day({}, { screenHours: 6, improve: "PRIVATE-NOTE-ONE", procrastinated: "PRIVATE-NOTE-TWO", rules: [{ id: "1", text: "Homework first", state: "done" }] }),
    [dminus(1)]: scoredDay({ screenHours: 4 }), [dminus(2)]: scoredDay({ screenHours: 3 })
  };
  const avoid = D.sanitizeAvoid([{ at: 1, date: TODAY, task: "PRIVATE-TASK", reason: "big", outcome: "started" }, { at: 2, date: TODAY, task: "x", reason: "big", outcome: "dropped" }]);
  const text = D.weeklyText({ todayISO: TODAY, days: days, avoid: avoid, rules: [{ id: "1", text: "Homework first" }, { id: "2", text: "Phone on the charger." }] });
  assert.match(text, /^My week on JARVIS Discipline \(Oct 16 to Oct 22\):/);
  assert.match(text, /Scored days: 3 of 7\. Average score: \d+\. Best: \d+\./);
  assert.match(text, /Review streak: 3 days\./);
  assert.match(text, /Phone: averaged 4\.3h a day, over my limit on 1 of 3 days\./);
  assert.match(text, /Rules kept: 1 of 1 answers\./);
  assert.match(text, /started anyway 1 of 2 times/);
  assert.match(text, /What I'm working on: Homework first Phone on the charger\./);
  assert.doesNotMatch(text, /PRIVATE/, "reflections and task names never leave");
  const empty = D.weeklyText({ todayISO: TODAY, days: {}, avoid: [], rules: [] });
  assert.equal(empty, "My week on JARVIS Discipline (Oct 16 to Oct 22):\nNo scored days yet this week.");
});

test("the advice text is complete: every reason and excuse has words for it", () => {
  assert.equal(D.REASONS.length, 6);
  D.REASONS.forEach((r) => assert.ok(r.key && r.label && r.first.length > 20 && r.rule.length > 20, r.key));
  D.EXCUSES.forEach((e) => assert.ok(e.key && e.label && e.challenge.length > 20, e.key));
  assert.equal(new Set(D.REASONS.map((r) => r.key)).size, D.REASONS.length);
  assert.equal(new Set(D.EXCUSES.map((e) => e.key)).size, D.EXCUSES.length);
  Object.keys(D.AREA_RULES).forEach((k) => assert.ok(D.CATEGORIES.some((c) => c.key === k), "rule for a real scoring area: " + k));
});

test("a timer never shows more than the time it was set for, even if the clock moves back", () => {
  const t = D.sanitizeTimer({ startedAt: 1000000, minutes: 2 });
  assert.equal(D.timerState(t, 1000000 - 5 * 60000).remainingMs, 120000);
  assert.equal(D.timerState(t, 1000000).remainingMs, 120000);
});

test("a timer remembers its task and avoid-log entry, and ignores a task id that isn't one", () => {
  const t = D.sanitizeTimer({ startedAt: 1000, minutes: 2, taskId: "p1", entryAt: 777, task: "Lift" });
  assert.deepEqual([t.taskId, t.entryAt, t.task], ["p1", 777, "Lift"]);
  assert.equal(D.sanitizeTimer({ startedAt: 1000, minutes: 2, taskId: "p9" }).taskId, "");
  assert.equal(D.sanitizeTimer({ startedAt: 1000, minutes: 2 }).entryAt, 0);
});
