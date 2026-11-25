"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const O = require("../../js/planning-overview-logic");

const TODAY = "2026-11-18";
const item = (key, source, title, start, o) => Object.assign({ key, source, title, date: TODAY, allDay: start === null, startMin: start === null ? undefined : start, endMin: start === null ? undefined : start + 30, point: false, completed: false, scheduled: true }, o || {});
const at = (h, m) => h * 60 + (m || 0);

test("layouts: balanced by default; the three layouts show what they promise; unknown names fall back", () => {
  assert.deepEqual(O.sectionsFor(null), ["stats", "next", "heads", "top", "habits", "remaining", "strategy"]);
  assert.deepEqual(O.sectionsFor({ layout: "simple" }), ["next", "top", "remaining"]);
  assert.equal(O.sectionsFor({ layout: "advanced" }).length, O.SECTIONS.length);
  assert.ok(O.sectionsFor({ layout: "advanced" }).includes("deadlines"));
  assert.equal(O.cleanPrefs({ layout: "weird" }).layout, "balanced");
  assert.deepEqual(O.cleanPrefs({ layout: "custom", order: ["top", "nope", "top", "next"], hidden: ["next", "zzz"] }).order.slice(0, 2), ["top", "next"]);
  assert.equal(O.cleanPrefs({ layout: "custom", order: ["top"] }).order.length, O.SECTIONS.length, "sections left out of the saved order are added back");
});

test("customizing: hide, show and reorder start from what is showing; the layout becomes my own", () => {
  let p = O.toggle({ layout: "simple" }, "habits", 5);
  assert.equal(p.layout, "custom");
  assert.deepEqual(O.sectionsFor(p), ["next", "top", "remaining", "habits"], "habits added to the simple layout");
  p = O.toggle(p, "next", 6);
  assert.deepEqual(O.sectionsFor(p), ["top", "remaining", "habits"]);
  p = O.move(p, "habits", -1, 7);
  assert.deepEqual(O.sectionsFor(p), ["top", "habits", "remaining"]);
  assert.deepEqual(O.sectionsFor(O.move(p, "top", -1)), ["top", "habits", "remaining"], "the first cannot go up");
  assert.deepEqual(O.sectionsFor(O.move(p, "remaining", 1)), ["top", "habits", "remaining"], "the last cannot go down");
  assert.equal(O.setLayout(p, "advanced", 9).layout, "advanced");
  assert.equal(O.setLayout(p, "nonsense").layout, "balanced");
  assert.equal(O.toggle({ layout: "simple" }, "bogus").layout, "simple", "unknown id changes nothing");
});

test("the four numbers: tasks and week exclude tasks that stand for a habit; habits and free time come as given", () => {
  const tasks = [
    { id: "a", text: "A", date: TODAY, completed: true }, { id: "b", text: "B", date: TODAY, completed: false },
    { id: "c", text: "Cold shower", date: TODAY, completed: true, habitId: "h1" },
    { id: "d", text: "D", date: "2026-11-19", completed: false }, { id: "e", text: "E", date: "2026-11-10", completed: true }
  ];
  const s = O.stats({ today: TODAY, weekDates: ["2026-11-16", "2026-11-17", TODAY, "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"], tasks, habitIds: { h1: true }, habits: { done: 2, total: 3 }, freeMin: 185.4 });
  assert.deepEqual(s.tasks, { done: 1, total: 2 }, "the linked task is one of the habits, not also a task");
  assert.deepEqual(s.habits, { done: 2, total: 3 });
  assert.equal(s.freeMin, 185);
  assert.deepEqual(s.week, { done: 1, total: 3, pct: 33 });
  assert.equal(O.stats({ today: TODAY, weekDates: [], tasks: [] }).week.pct, null, "no tasks is not 0%");
  assert.equal(O.stats({}).freeMin, null);
  assert.equal(O.stats({ today: TODAY, tasks: [{ id: "x", text: "X", date: TODAY, habitId: "gone" }], habitIds: {} }).tasks.total, 1, "a task pointing at a habit that is gone is an ordinary task");
});

test("up next: what is in progress, else what starts next, else something from earlier today that is still open", () => {
  const items = [
    item("t1", "task", "Email", at(9)), item("t2", "task", "Research manufacturers", at(14)), item("h1", "habit", "Lift", at(18), { point: true }),
    item("e1", "event", "Soccer game", at(16)), item("t3", "task", "Done already", at(11), { completed: true }), item("t4", "task", "No time", null)
  ];
  let n = O.upNext(items, at(14, 10));
  assert.deepEqual([n.item.key, n.state], ["t2", "now"], "Research started at 2:00 and is within its half hour");
  n = O.upNext(items, at(10));
  assert.deepEqual([n.item.key, n.state, n.minutes], ["t2", "next", 240], "events are not actionable, so the next thing to do is the research, not the game");
  n = O.upNext(items, at(15, 30));
  assert.deepEqual([n.item.key, n.state], ["h1", "next"]);
  n = O.upNext(items, at(19));
  assert.deepEqual([n.item.key, n.state], ["h1", "earlier"], "a scheduled thing that was not done stays; it is not overdue, just open");
  assert.equal(O.upNext([item("t3", "task", "x", at(9), { completed: true })], at(10)), null);
  assert.equal(O.upNext([], 600), null);
  assert.equal(O.upNext(null, 600), null);
});

test("remaining: open things in time order with earlier ones marked, events still to come, anytime tasks; done ones kept apart", () => {
  const items = [
    item("t1", "task", "Email", at(9)), item("t2", "task", "Research", at(14)), item("e1", "event", "Soccer game", at(16)), item("e0", "event", "Dentist", at(8)),
    item("t3", "task", "Done", at(11), { completed: true }), item("t4", "task", "No time", null), item("h1", "habit", "Lift", at(18), { point: true }), item("ad", "event", "Birthday", null)
  ];
  const r = O.remaining(items, at(13));
  assert.deepEqual(r.open.map((x) => x.item.key + ":" + x.when), ["t1:earlier", "t2:later", "e1:later", "h1:later"], "Dentist already ended; the birthday is all-day and is not here");
  assert.deepEqual(r.done.map((x) => x.key), ["t3"]);
  assert.deepEqual(r.anytime.map((x) => x.key), ["t4"]);
  assert.deepEqual(O.remaining([], 600), { open: [], done: [], anytime: [] });
});

test("deadlines: deadline tasks and goal dates first, single events next, repeating ones grouped once; habits, plan blocks and done things left out", () => {
  const d = (n) => "2026-11-" + String(18 + n);
  const items = [];
  for (let i = 0; i < 7; i++) items.push({ key: "w" + i, source: "event", title: "Wake up", date: d(i), time: "05:00", recurring: true, kind: "event" });
  items.push({ key: "dl", source: "task", title: "Send the invoice", date: d(3), scheduled: false });
  items.push({ key: "planned", source: "task", title: "Planned for a day", date: d(2), scheduled: true });
  items.push({ key: "g", source: "goal", title: "Q4 launch milestone", date: d(5), allDay: true });
  items.push({ key: "ev", source: "event", title: "Supplier call", date: d(1), time: "10:00", recurring: false, kind: "appointment" });
  items.push({ key: "h", source: "habit", title: "Lift", date: d(1) });
  items.push({ key: "b", source: "plan", title: "Block", date: d(1) });
  items.push({ key: "done", source: "task", title: "Done deadline", date: d(1), scheduled: false, completed: true });
  items.push({ key: "far", source: "event", title: "Next month", date: "2026-12-30", recurring: false });
  items.push({ key: "past", source: "event", title: "Yesterday", date: "2026-11-17", recurring: false });
  const out = O.deadlines(items, TODAY, { limit: 10 });
  assert.deepEqual(out.map((x) => x.kind + ":" + x.title), ["deadline:Send the invoice", "deadline:Q4 launch milestone", "event:Supplier call", "repeats:Wake up"]);
  assert.equal(out[3].count, 7, "seven wake-ups are one line that says how many");
  assert.equal(O.deadlines(items, TODAY, { limit: 2 }).length, 2);
  assert.deepEqual(O.deadlines(null, TODAY), []);
});

test("hm words", () => {
  assert.equal(O.hm(185), "3 h 5 min");
  assert.equal(O.hm(60), "1 h");
  assert.equal(O.hm(25), "25 min");
  assert.equal(O.hm(-4), "0 min");
});

/* ---------------- heads up ---------------- */

test("heads up: overlaps, an overloaded day, tasks with no time, a deadline in the next two days, things still open from earlier; it only reads", () => {
  const items = [
    { key: "a", source: "event", title: "A", date: TODAY, startMin: 600, endMin: 660, completed: false, conflict: true },
    { key: "b", source: "event", title: "B", date: TODAY, startMin: 630, endMin: 690, completed: false, conflict: true },
    { key: "t1", source: "task", title: "T1", date: TODAY, allDay: true, scheduled: true, completed: false },
    { key: "t2", source: "task", title: "T2", date: TODAY, allDay: true, scheduled: true, completed: false },
    { key: "tdone", source: "task", title: "Done", date: TODAY, allDay: true, scheduled: true, completed: true },
    { key: "th", source: "task", title: "Habit task", date: TODAY, allDay: true, scheduled: true, habitId: "h1", completed: false },
    { key: "p", source: "plan", title: "Block", date: TODAY, startMin: 420, endMin: 480, completed: false }
  ];
  const before = JSON.stringify(items);
  const soon = [{ key: "d", source: "task", title: "Report", date: "2026-11-19", allDay: true, scheduled: false, completed: false }];
  const out = O.headsUp({ items, soon, today: TODAY, nowMin: 620, overbooked: "Over your daily limit by 1 h" });
  assert.deepEqual(out.map((x) => x.kind), ["overlap", "overload", "notime", "deadline", "earlier"]);
  assert.equal(out[0].text, "2 things overlap each other today");
  assert.equal(out[2].count, 2, "a done task and a habit's task are not counted");
  assert.match(out[3].text, /“Report” is due tomorrow/);
  assert.equal(out[4].text, "1 thing from earlier today is still open");
  assert.equal(JSON.stringify(items), before, "reading changes nothing");
  assert.deepEqual(O.headsUp({ items: [], soon: [], today: TODAY, nowMin: 600 }), [], "nothing to say when there is nothing");
});
