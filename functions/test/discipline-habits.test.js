"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../../js/discipline-logic");
const H = require("../../js/discipline-habits");

// Thursday 22 Oct 2026; the week started Monday the 19th.
const THU = "2026-10-22";
const days = (...d) => { const o = {}; d.forEach((x) => { o[x] = 1; }); return o; };
const habit = (name, o) => Object.assign({ id: name, name: name, targetDays: 7, dailyTarget: 1, completions: {} }, o || {});

test("habits are read as stored; old ones that kept dates still count; junk is dropped", () => {
  const raw = [
    { id: "a", name: "  Run  ", targetDays: 99, dailyTarget: 0, completions: { "2026-10-21": 1, "nope": 4, "2026-10-20": -3 } },
    { id: "b", name: "Read", completedDates: ["2026-10-20", "bad"] },
    { name: "" }, null, "x", { id: "c" }
  ];
  const h = H.normalizeHabits(raw);
  assert.equal(h.length, 2);
  assert.deepEqual(h[0], { id: "a", name: "Run", targetDays: 7, dailyTarget: 1, completions: { "2026-10-21": 1 } });
  assert.deepEqual(h[1].completions, { "2026-10-20": 1 });
  assert.deepEqual(H.normalizeHabits(null), []);
});

test("done, met and open follow the daily and weekly targets, never hindsight", () => {
  const h = H.normalizeHabits([
    habit("Daily", { completions: days("2026-10-22") }),                                   // done today
    habit("Daily undone"),                                                                 // open
    habit("Three a week", { targetDays: 3, completions: days("2026-10-19", "2026-10-20", "2026-10-21") }), // week already met
    habit("Three a week, short", { targetDays: 3, completions: days("2026-10-19") }),      // still needs two
    habit("Twice a day", { dailyTarget: 2, completions: { "2026-10-22": 1 } })             // 1 of 2 today: not done
  ]);
  const r = H.routineFor(h, THU);
  assert.deepEqual(r.items.map((i) => i.state), ["done", "open", "met", "open", "open"]);
  assert.deepEqual([r.total, r.done, r.met, r.open], [5, 1, 1, 3]);
  const mon = H.routineFor(h, "2026-10-19");
  assert.ok(mon.items.every((i) => i.state === "open" || i.state === "done"), "on Monday nothing can be 'met' yet");
  const wed = H.routineFor(h, "2026-10-21");
  assert.equal(wed.items[2].state, "done", "Wednesday's own tick makes it done");
  const wedBefore = H.routineFor(H.normalizeHabits([habit("Three", { targetDays: 3, completions: days("2026-10-19", "2026-10-20") })]), "2026-10-21");
  assert.equal(wedBefore.items[0].state, "open", "with only two done before Wednesday it is still needed");
  assert.equal(r.weekTarget, 7 + 7 + 3 + 3 + 14);
});

test("a streak counts back from today if today is done, otherwise from yesterday, and stops at the first gap", () => {
  const h = H.normalizeHabits([habit("Run", { completions: days("2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21") })])[0];
  assert.equal(H.streak(h, THU), 4, "today not done yet: the run through yesterday still stands");
  h.completions["2026-10-22"] = 1;
  assert.equal(H.streak(h, THU), 5);
  assert.equal(H.streak(H.normalizeHabits([habit("x", { completions: days("2026-10-20") })])[0], THU), 0, "yesterday missed: nothing running");
  assert.equal(H.weekStart(THU), "2026-10-19");
  assert.equal(H.weekStart("2026-10-25"), "2026-10-19", "Sunday belongs to the week that started Monday");
  assert.equal(H.weekStart("2026-10-19"), "2026-10-19");
});

test("the review's routine answer is only ever a suggestion, from counts, and absent without habits", () => {
  assert.equal(H.suggestAnswer(H.routineFor([], THU)), null);
  const all = H.routineFor(H.normalizeHabits([habit("A", { completions: days(THU) }), habit("B", { targetDays: 1, completions: days("2026-10-19") })]), THU);
  assert.equal(H.suggestAnswer(all), "done", "done plus already-met counts as a kept routine");
  const some = H.routineFor(H.normalizeHabits([habit("A", { completions: days(THU) }), habit("B")]), THU);
  assert.equal(H.suggestAnswer(some), "not");
  assert.deepEqual(H.snapshot(all), { done: 2, open: 0, total: 2 });
  assert.deepEqual(H.snapshot(some), { done: 1, open: 1, total: 2 });
  assert.equal(H.snapshot(H.routineFor([], THU)), null);
  assert.equal(Object.keys(H.snapshot(all)).join(), "done,open,total", "counts only, no names");
});

test("the coach speaks from the record: right kind, right numbers, never invented", () => {
  const routine = (hs) => H.routineFor(hs, THU);
  const c0 = H.coach([], routine([]), THU);
  assert.equal(c0.kind, "setup"); assert.match(c0.text, /Add the habits/);

  const done = H.normalizeHabits([habit("Run", { completions: days(THU) }), habit("Read", { completions: days(THU) })]);
  const cDone = H.coach(done, routine(done), THU);
  assert.equal(cDone.kind, "done"); assert.match(cDone.text, /2 of 2 checked off/); assert.equal(cDone.left, "");

  const metOnly = H.normalizeHabits([habit("Gym", { targetDays: 1, completions: days("2026-10-20") })]);
  assert.equal(H.coach(metOnly, routine(metOnly), THU).kind, "met");

  // a daily habit with a 4-day run that ended two days ago, and yesterday was missed
  const lost = H.normalizeHabits([habit("Run", { completions: days("2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20") })]);
  const cLost = H.coach(lost, routine(lost), THU);
  assert.equal(cLost.kind, "recover");
  assert.match(cLost.text, /Run ran 4 days in a row, then yesterday was missed/);
  assert.match(cLost.left, /Left today: Run\./);

  const alive = H.normalizeHabits([habit("Run", { completions: days("2026-10-19", "2026-10-20", "2026-10-21") }), habit("Read")]);
  const cAlive = H.coach(alive, routine(alive), THU);
  assert.equal(cAlive.kind, "streak");
  assert.match(cAlive.text, /Run: 3 days in a row\. Today makes 4\./);
  assert.match(cAlive.left, /Left today: Run and Read\./);

  const weekly = H.normalizeHabits([habit("Gym", { targetDays: 3, completions: days("2026-10-19") }), habit("Read", { targetDays: 3 })]);
  const cWeek = H.coach(weekly, routine(weekly), THU);
  assert.equal(cWeek.kind, "week"); assert.match(cWeek.text, /This week so far: 1 of 6 habit check-ins done/);

  const fresh = H.normalizeHabits([habit("Gym", { targetDays: 3 })]);
  assert.equal(H.coach(fresh, H.routineFor(fresh, "2026-10-19"), "2026-10-19").kind, "start");
});

test("only daily habits get a streak line, so a three-a-week habit is never told it broke a run", () => {
  const h = H.normalizeHabits([habit("Gym", { targetDays: 3, completions: days("2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21") })]);
  const c = H.coach(h, H.routineFor(h, THU), THU);
  assert.notEqual(c.kind, "recover"); assert.notEqual(c.kind, "streak");
});

test("every coach line is plain, kind and short, and names no habit that isn't in the data", () => {
  const habits = H.normalizeHabits([habit("Run", { completions: days("2026-10-20", "2026-10-21") }), habit("Read")]);
  const names = ["Run", "Read"];
  const c = H.coach(habits, H.routineFor(habits, THU), THU);
  assert.ok(c.text.length < 160);
  (c.text + " " + c.left).replace(/[A-Z][a-z]+/g, (w) => w).split(/[ .:,]/).filter((w) => /^[A-Z][a-z]+$/.test(w) && !["Today", "Left", "Run", "Read", "Do", "One", "Rest", "This", "Add", "Start", "You", "A", "Routine", "Doing"].includes(w)).forEach((w) => assert.ok(names.includes(w), w));
  ["failure", "lazy", "worthless", "!"].forEach((bad) => assert.ok(!c.text.includes(bad), bad));
});

test("Habits tasks for a day are offered most important first, only if unfinished, with their time and category", () => {
  const tasks = [
    { id: "1", date: THU, text: "Email supplier", priority: "low", completed: false, order: 0 },
    { id: "2", date: THU, text: "Finish essay", priority: "high", completed: false, time: "15:30", category: "School", order: 1 },
    { id: "3", date: THU, text: "Done thing", priority: "high", completed: true },
    { id: "4", date: "2026-10-23", text: "Tomorrow thing", priority: "high", completed: false },
    { id: "5", date: THU, text: "   ", priority: "high", completed: false },
    { id: "6", date: THU, text: "Gym", priority: "medium", completed: false, time: "25:99", category: "made up", order: 2 }
  ];
  const out = H.openTasks(tasks, THU, 5);
  assert.deepEqual(out.map((t) => t.text), ["Finish essay", "Gym", "Email supplier"]);
  assert.deepEqual([out[0].due, out[0].category], ["15:30", "school"]);
  assert.deepEqual([out[1].due, out[1].category], ["", ""], "a bad time or unknown category is dropped, not guessed");
  assert.equal(H.openTasks(tasks, THU, 1).length, 1);
  assert.deepEqual(H.openTasks(null, THU), []);
});

test("a saved review keeps only counts of the routine, and bad ones are dropped", () => {
  const r = (h) => L.sanitizeDay({ review: { screenHours: 1, items: {}, habits: h } }).review.habits;
  assert.deepEqual(r({ done: 3, open: 1, total: 4 }), { done: 3, open: 1, total: 4 });
  assert.equal(r({ done: 3, open: 2, total: 4 }), null, "counts must add up");
  assert.equal(r({ done: -1, open: 1, total: 0 }), null);
  assert.equal(r({ done: 1, open: 0, total: 1, names: ["secret"] }).names, undefined, "no names are kept");
  assert.equal(r("x"), null);
});

test("Next up points at open habits once the plan is done, after open priorities and before missions, and never ahead of the review", () => {
  const plan = (done) => L.sanitizeDay({ morning: { keyTask: { text: "Essay", done: done }, priorities: [] } }).morning;
  const next = (done, minutes, extra) => L.nextUp(Object.assign({ todayISO: THU, minutes: minutes, days: { [THU]: { morning: plan(done) } }, settings: {} }, extra || {}));
  const routine = { open: 2, text: "Run and Read." };
  assert.equal(next(false, 600, { routine: routine }).kind, "win", "an open priority still comes first");
  const n = next(true, 600, { routine: routine, missions: { total: 1, done: 0, nextText: "m" } });
  assert.equal(n.kind, "routine");
  assert.equal(n.title, "2 habits left today");
  assert.equal(n.text, "Run and Read.");
  assert.deepEqual(n.actions, ["routine"]);
  assert.equal(next(true, 600, { routine: { open: 1, text: "Run." } }).title, "One habit left today");
  assert.equal(next(true, 1300, { routine: routine }).kind, "review");
  assert.equal(next(true, 600, { routine: { open: 0, text: "" } }).kind, "allDone");
  assert.ok(next(false, 600, { routine: routine }).more.includes("routine"), "and it is always one tap away from the other suggestions");
});
