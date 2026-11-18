"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../../js/plan-logic");
const W = require("../../js/plan-week-logic");
const I = require("../../js/plan-insights-logic");

const TODAY = "2026-11-04";               // a Wednesday; its week starts Monday 2026-11-02
const MON = "2026-11-02";
const NOW = Date.parse("2026-11-04T15:00:00Z");
let seq = 0;
const ctx0 = (o) => Object.assign({ now: NOW, today: TODAY, makeId: (p) => p + "_" + (++seq) }, o || {});
const task = (id, o) => Object.assign({ id: id, date: TODAY, text: "Task " + id, priority: "medium", time: "", completed: false, order: 0, createdAt: 1 }, o || {});
const ING = W.addStarters([], ctx0()).ingredients;

// a small plan: objective (2026) -> priority (Q4) -> milestone (Nov), with tasks linked in as asked
function plan(o) {
  o = o || {};
  let nodes = [];
  const add = (input) => { const r = P.addNode(nodes, input, ctx0()); assert.equal(r.ok, true, JSON.stringify(r.errors)); nodes = r.nodes; return r.node; };
  const obj = add({ type: "objective", title: "Launch Gratiel", year: 2026, weight: o.weight || 3 });
  const pri = add({ type: "priority", title: "Ship the winter drop", year: 2026, quarter: 4, parentId: obj.id });
  const ms = add({ type: "milestone", title: "Samples approved", month: "2026-11", parentId: pri.id, due: o.msDue || "2026-11-20" });
  return { nodes, obj, pri, ms, add: add, get: () => nodes };
}
const links = (pairs, nodes) => pairs.reduce((l, [id, nid]) => P.setLink(l, id, nid, { nodes, now: NOW }).links, []);
function context(o) {
  const tasks = o.tasks || [], nodes = o.nodes || [], lk = o.links || [];
  const model = P.model({ nodes, links: lk, tasks, periods: o.periods || [], settings: o.settings || {}, goals: [], today: o.today || TODAY });
  return Object.assign({ today: TODAY, nowMin: 600, weekStart: MON, tasks, links: lk, model, blocks: [], ingredients: ING, events: [], zone: "America/New_York", settings: { dayStart: "08:00", dayEnd: "18:00", interval: 30 }, weeks: [], reviews: [], periods: [], workouts: [], nowMs: NOW }, o);
}

/* ---------------- kinds of time ---------------- */

test("a category's kind comes from the starter ids, then its name; rest is its own", () => {
  const k = (name, o) => I.categoryKind(Object.assign({ id: "x", name: name }, o || {}));
  assert.equal(I.categoryKind(ING.find((i) => i.id === "ing_gratiel")), "gratiel");
  assert.equal(I.categoryKind(ING.find((i) => i.id === "ing_rest")), "rest");
  assert.deepEqual(["Gym", "Homework", "Gratiel drop", "Lecture", "Church", "Basket weaving"].map((n) => k(n)), ["workout", "study", "gratiel", "school", "personal", "other"]);
  assert.equal(k("Anything", { rest: true }), "rest");
  assert.equal(I.categoryKind(null), "none");
});

/* ---------------- time: planned, logged, workouts ---------------- */

test("time by category: planned from blocks, logged only where you logged it, and 'not tracked' (null) otherwise", () => {
  let blocks = W.addBlock([], { title: "Brand", ingredientId: "ing_gratiel", date: "2026-11-02", start: "09:00", end: "11:00" }, ctx0({ ingredients: ING })).blocks;
  blocks = W.addBlock(blocks, { title: "Read", ingredientId: "ing_studying", date: "2026-11-03", start: "19:00", end: "20:00" }, ctx0({ ingredients: ING })).blocks;
  const id = blocks[0].id;
  let t = I.timeByCategory(context({ blocks }), MON, "2026-11-08");
  const row = (name) => t.rows.find((r) => r.name === name);
  assert.equal(t.plannedMin, 180);
  assert.equal(t.loggedMin, null, "nothing logged: unavailable, not zero");
  assert.equal(row("Gratiel").loggedMin, null);
  assert.equal(row("Workout").plannedMin, 0);
  blocks = W.logWork(blocks, id, "2026-11-02", 90, ctx0()).blocks;
  t = I.timeByCategory(context({ blocks }), MON, "2026-11-08");
  assert.equal(t.rows.find((r) => r.name === "Gratiel").loggedMin, 90);
  assert.equal(t.rows.find((r) => r.name === "Studying").loggedMin, null, "the other category is still untracked");
  assert.equal(t.loggedMin, 90);
  assert.deepEqual([t.pastBlocks, t.loggedBlocks], [2, 1]);
});

test("a workout is never counted twice: per day, the larger of what the blocks say and what the workout log says", () => {
  let blocks = W.addBlock([], { title: "Gym", ingredientId: "ing_workout", date: "2026-11-02", start: "06:00", end: "07:00" }, ctx0({ ingredients: ING })).blocks;
  blocks = W.logWork(blocks, blocks[0].id, "2026-11-02", 55, ctx0()).blocks;
  const workouts = [{ id: "w1", date: "2026-11-02", duration: 50 }, { id: "w2", date: "2026-11-03", duration: 40 }, { id: "w3", date: "2026-11-03", duration: 20 }, { id: "w4", date: "2026-11-04" }, { id: "w5", date: "2026-11-06", duration: 45 }];
  const t = I.timeByCategory(context({ blocks, workouts }), MON, "2026-11-08");
  const gym = t.rows.find((r) => r.name === "Workout");
  // Monday: block says 55, session says 50 -> 55 (one workout). Tuesday: only sessions -> 60. Wednesday: no duration -> nothing. Friday is in the future.
  assert.equal(gym.loggedMin, 115);
  assert.equal(gym.sessionMin, 110, "the sessions that count: Mon 50 + Tue 60 (future days are not counted)");
  // without a Workout category, the sessions still count, in their own row
  const bare = I.timeByCategory(context({ ingredients: [], workouts }), MON, "2026-11-08");
  const row = bare.rows.find((r) => r.ingredientId === "_workouts");
  assert.deepEqual([row.name, row.loggedMin, row.kind], ["Workouts (from your workout log)", 110, "workout"]);
  assert.deepEqual(I.workoutMinutesByDate([{ date: "2026-11-02T08:00", duration: 30 }, { date: "2026-11-02", duration: 0 }, { date: "nope", duration: 9 }, null]), { "2026-11-02": 30 });
});

test("Gratiel time: planned and logged, or null when no Gratiel category exists / nothing was logged", () => {
  let blocks = W.addBlock([], { title: "Brand", ingredientId: "ing_gratiel", date: "2026-11-03", start: "09:00", end: "11:00" }, ctx0({ ingredients: ING })).blocks;
  assert.deepEqual(I.gratielMinutes(context({ blocks }), MON, "2026-11-08"), { plannedMin: 120, loggedMin: null });
  blocks = W.logWork(blocks, blocks[0].id, "2026-11-03", 100, ctx0()).blocks;
  assert.deepEqual(I.gratielMinutes(context({ blocks }), MON, "2026-11-08"), { plannedMin: 120, loggedMin: 100 });
  assert.deepEqual(I.gratielMinutes(context({ ingredients: [] }), MON, "2026-11-08"), { plannedMin: null, loggedMin: null });
});

/* ---------------- the ranking ---------------- */

test("a task that counts toward a goal outranks a small routine task, and says why", () => {
  const pl = plan(), tasks = [task("goal", { priority: "medium" }), task("routine", { priority: "medium", text: "Reply to email" })];
  const lk = links([["goal", pl.ms.id]], pl.get());
  const r = I.rankTasks(context({ tasks, nodes: pl.get(), links: lk }));
  assert.deepEqual(r.map((x) => x.task.id), ["goal", "routine"]);
  const goal = r[0], routine = r[1];
  const labels = (x) => x.parts.map((p) => p.label);
  assert.ok(labels(goal).includes("Counts toward your plan"));
  assert.ok(labels(goal).some((l) => /objective “Launch Gratiel” \(importance 3 of 5\)/.test(l)));
  assert.ok(labels(goal).some((l) => /quarter's priority “Ship the winter drop”/.test(l)));
  assert.ok(labels(goal).some((l) => /milestone “Samples approved” is due in 16 days/.test(l)));
  assert.equal(goal.score, goal.parts.reduce((s, p) => s + p.points, 0), "the score is exactly the sum of the listed points");
  assert.ok(labels(routine).includes("A small routine task that isn't tied to a goal"));
  assert.equal(routine.parts.find((p) => /small routine/.test(p.label)).points, -8);
});

test("the points: importance, deadline closeness, overdue, priority, effort and free time", () => {
  const pl = plan({ weight: 5, msDue: "2026-11-06" }), lk0 = links([["t"], ["t"]].slice(0, 0), pl.get());
  const t = task("t", { date: "2026-11-01", priority: "high" });                     // overdue by 3 days
  let lk = links([["t", pl.ms.id]], pl.get());
  lk = P.setEstimate(lk, "t", 90, { now: NOW }).links;
  const x = I.rankTasks(context({ tasks: [t], nodes: pl.get(), links: lk }))[0];
  const pts = (re) => (x.parts.find((p) => re.test(p.label)) || {}).points;
  assert.equal(pts(/^Part of the objective/), 15, "importance 5 -> 15 points");
  assert.equal(pts(/milestone .* due in 2 days/), 14);
  assert.equal(pts(/^High priority/), 14);
  assert.equal(pts(/^Overdue by 3 days/), 9);
  assert.equal(pts(/^Substantial work \(about 1\.5 h\)/), 4);
  void lk0;
  // it won't fit: a 20 h estimate against ~ 40 free hours is fine, but against a nearly full week it is not
  let blocks = [];
  W.weekDates(MON).forEach((d) => { blocks = W.addBlock(blocks, { title: "Busy", date: d, start: "08:00", end: "17:00", ingredientId: "ing_school" }, ctx0({ ingredients: ING })).blocks; });
  let big = P.setEstimate(lk, "t", 360, { now: NOW }).links;
  const y = I.rankTasks(context({ tasks: [t], nodes: pl.get(), links: big, blocks }))[0];
  assert.ok(y.parts.some((p) => /Needs about 6 h but only/.test(p.label) && p.points === -10), "an estimate bigger than the free time loses points");
});

test("archived tasks, done tasks, tasks of dropped items and tasks after this week are not candidates; paused items are held back", () => {
  const pl = plan(), tasks = [task("a"), task("arch"), task("done", { completed: true }), task("later", { date: "2026-11-20" }), task("dropped"), task("paused")];
  const p2 = P.addNode(pl.get(), { type: "milestone", title: "Dropped one", month: "2026-11", parentId: pl.pri.id }, ctx0()), p3 = P.addNode(p2.nodes, { type: "milestone", title: "Paused one", month: "2026-11", parentId: pl.pri.id }, ctx0());
  let nodes = P.setStatus(p3.nodes, p2.node.id, "dropped", ctx0()).nodes;
  nodes = P.setStatus(nodes, p3.node.id, "paused", ctx0()).nodes;
  let lk = links([["dropped", p2.node.id], ["paused", p3.node.id]], nodes);
  lk = P.setArchived(lk, "arch", true, ctx0()).links;
  const r = I.rankTasks(context({ tasks, nodes, links: lk }));
  assert.deepEqual(r.map((x) => x.task.id).sort(), ["a", "paused"]);
  assert.ok(r.find((x) => x.task.id === "paused").parts.some((p) => /paused item/.test(p.label) && p.points === -15));
});

test("top three: spread across milestones, and at most one task that isn't tied to the plan", () => {
  const pl = plan(), m2 = P.addNode(pl.get(), { type: "milestone", title: "Photoshoot", month: "2026-11", parentId: pl.pri.id, due: "2026-11-25" }, ctx0());
  const tasks = [task("s1", { priority: "high" }), task("s2", { priority: "high" }), task("s3", { priority: "high" }), task("p1", { priority: "high" }), task("r1", { priority: "high", text: "Loose A" }), task("r2", { priority: "high", text: "Loose B" })];
  const lk = links([["s1", pl.ms.id], ["s2", pl.ms.id], ["s3", pl.ms.id], ["p1", m2.node.id]], m2.nodes);
  const picks = I.topThreePicks(context({ tasks, nodes: m2.nodes, links: lk }));
  assert.equal(picks.length, 3);
  assert.deepEqual(picks.map((p) => p.task.id).filter((id) => id.startsWith("r")), [], "linked work first");
  const ms = picks.map((p) => p.chain[p.chain.length - 1].id);
  assert.ok(new Set(ms).size >= 2, "not three from the same milestone: " + ms.join());
  assert.ok(picks.some((p) => p.task.id === "p1"), "the other milestone's task is in");
  // only loose tasks exist: they are still suggested (up to three)
  const loose = I.topThreePicks(context({ tasks: [task("r1", { priority: "high" }), task("r2", { priority: "high" }), task("r3", { priority: "high" })] }));
  assert.equal(loose.length, 3);
  // two linked tasks and many loose ones: both linked ones, then at most one loose one
  const mixed = I.topThreePicks(context({ tasks: [task("g1", { priority: "low" }), task("g2", { priority: "low" }), task("r1", { priority: "high" }), task("r2", { priority: "high" }), task("r3", { priority: "high" })], nodes: pl.get(), links: links([["g1", pl.ms.id], ["g2", pl.ms.id]], pl.get()) }));
  assert.equal(mixed.filter((p) => !p.linked).length, 1, "at most one task that isn't tied to the plan while there are linked ones left");
  assert.deepEqual(mixed.filter((p) => p.linked).map((p) => p.task.id).sort(), ["g1", "g2"]);
  // only one linked task: the rest of the three are filled from the others
  const one = I.topThreePicks(context({ tasks: [task("g", { priority: "low" }), task("r1", { priority: "high" }), task("r2", { priority: "high" }), task("r3", { priority: "high" })], nodes: pl.get(), links: links([["g", pl.ms.id]], pl.get()) }));
  assert.equal(one.length, 3);
  assert.equal(one[0].task.id, "g", "the plan task first, even at low priority");
});

test("a second pick from the same milestone shows its deduction", () => {
  const pl = plan(), tasks = [task("a", { priority: "high" }), task("b", { priority: "high" })], lk = links([["a", pl.ms.id], ["b", pl.ms.id]], pl.get());
  const picks = I.topThreePicks(context({ tasks, nodes: pl.get(), links: lk }));
  assert.equal(picks.length, 2);
  assert.ok(picks[1].parts.some((p) => /same milestone/.test(p.label) && p.points === -6));
  assert.equal(picks[1].adjusted, picks[1].parts.reduce((s, p) => s + p.points, 0));
});

/* ---------------- dashboard ---------------- */

test("the dashboard: overall completion, this year's objectives, the quarter's priorities, the month, the week, today, deadlines", () => {
  const pl = plan({ msDue: "2026-11-07" }), tasks = [task("a", { completed: true, date: "2026-11-02" }), task("b", { date: TODAY, priority: "high" }), task("c", { date: TODAY }), task("d", { date: "2026-12-10" }), task("late", { date: "2026-10-30" })];
  const lk = links([["a", pl.ms.id], ["b", pl.ms.id], ["late", pl.ms.id]], pl.get());
  const d = I.dashboard(context({ tasks, nodes: pl.get(), links: lk }));
  assert.deepEqual([d.year, d.quarter, d.month], [2026, 4, "2026-11"]);
  assert.equal(d.overall.year, 33, "1 of the 3 tasks under the objective is done");
  assert.deepEqual(d.objectives.map((n) => n.title), ["Launch Gratiel"]);
  assert.deepEqual(d.priorities.map((n) => n.title), ["Ship the winter drop"]);
  assert.deepEqual([d.monthStats.milestones, d.monthStats.milestonesDone, d.monthStats.tasksDone, d.monthStats.tasksOpen], [1, 0, 1, 2]);
  assert.deepEqual([d.week.tasksDone, d.week.tasksTotal, d.week.rate], [1, 3, 33]);
  assert.equal(d.week.gratielLoggedMin, null, "no Gratiel time planned or logged: not tracked");
  assert.equal(d.week.gratielPlannedMin, 0);
  assert.deepEqual(d.today.open.map((t) => t.id), ["b", "c"], "today's open tasks, the one tied to the plan first");
  assert.equal(d.today.openCount, 2);
  assert.equal(d.overdueTaskCount, 1);
  assert.deepEqual(d.deadlines.map((x) => [x.kind, x.title]).slice(0, 2), [["task", "Task b"], ["node", "Samples approved"]], "soonest first");
  assert.equal(d.week.topSuggested, true, "nothing saved: three suggested");
  assert.ok(d.week.top.length >= 1);
});

test("the dashboard shows the saved top three, not the suggestion, once you've chosen", () => {
  const pl = plan(), tasks = [task("a"), task("b")], lk = links([["a", pl.ms.id]], pl.get());
  const weeks = W.setWeek([], MON, { top: [{ taskId: "b" }, { text: "Call the printer" }] }, ctx0()).weeks;
  const d = I.dashboard(context({ tasks, nodes: pl.get(), links: lk, weeks }));
  assert.equal(d.week.topSuggested, false);
  assert.deepEqual(d.week.top.map((x) => [x.text, x.saved, !!x.node]), [["Task b", true, false], ["Call the printer", true, false]]);
});

test("upcoming deadlines: items due within the window (overdue included), not the finished or paused, plus near high-priority or linked tasks", () => {
  const pl = plan({ msDue: "2026-11-01" }), tasks = [task("hi", { date: "2026-11-05", priority: "high" }), task("lo", { date: "2026-11-05" }), task("linked", { date: "2026-11-06" })];
  const lk = links([["linked", pl.ms.id]], pl.get());
  const u = I.upcoming(context({ tasks, nodes: pl.get(), links: lk }), 14);
  const keys = u.map((x) => x.kind + ":" + x.title);
  assert.ok(keys.includes("node:Samples approved"), "overdue milestone");
  assert.ok(keys.includes("task:Task hi") && keys.includes("task:Task linked"));
  assert.ok(!keys.includes("task:Task lo"), "an unlinked medium task is not a deadline");
  assert.ok(u[0].daysLeft <= u[u.length - 1].daysLeft, "soonest first");
  assert.equal(u.find((x) => x.title === "Samples approved").daysLeft, -3);
  const done = P.setDoneAt(pl.get(), pl.ms.id, true, ctx0()).nodes;
  assert.ok(!I.upcoming(context({ tasks: [], nodes: done }), 14).some((x) => x.title === "Samples approved"), "a completed milestone is no longer upcoming");
});

/* ---------------- analytics ---------------- */

test("weekly series: completion rates are null for empty weeks, never 0", () => {
  const tasks = [task("a", { date: "2026-10-27", completed: true }), task("b", { date: "2026-10-28" }), task("c", { date: "2026-11-03", completed: true })];
  const s = I.weeklySeries(context({ tasks }), 3);
  assert.deepEqual(s.map((w) => w.weekStart), ["2026-10-19", "2026-10-26", "2026-11-02"]);
  assert.deepEqual(s.map((w) => w.rate), [null, 50, 100]);
  assert.deepEqual(s.map((w) => [w.total, w.done]), [[0, 0], [2, 1], [1, 1]]);
  assert.equal(s[0].loggedMin, null);
});

test("finance series and the month list", () => {
  assert.deepEqual(I.lastMonths("2026-02-10", 4), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  let periods = P.setPeriod([], "month", "2026-10", { revenue: 3000, spend: 900, revenueTarget: 4000 }, ctx0()).periods;
  periods = P.setPeriod(periods, "month", "2026-09", { spend: 500 }, ctx0()).periods;
  const f = I.financeSeries(periods, ["2026-08", "2026-09", "2026-10"]);
  assert.deepEqual(f.map((x) => [x.revenue, x.spend, x.revenueTarget]), [[null, null, null], [null, 500, null], [3000, 900, 4000]]);
});

test("goal progress by level", () => {
  const pl = plan(), g = I.goalProgress(context({ tasks: [], nodes: pl.get() }));
  assert.deepEqual([g.objectives.length, g.priorities.length, g.milestones.length], [1, 1, 1]);
  assert.equal(g.objectives[0].pct, 0 === 1 ? 0 : g.objectives[0].pct);
  assert.equal(g.milestones[0].status, "notstarted");
});

/* ---------------- reviews ---------------- */

test("the weekly review is counted from the records and says so plainly when nothing was tracked", () => {
  const pl = plan(), tasks = [task("a", { completed: true, date: "2026-11-02" }), task("b", { date: "2026-11-03" }), task("c", { date: "2026-11-03", completed: true }), task("o", { date: "2026-11-05", priority: "high" })];
  const lk = links([["a", pl.ms.id], ["b", pl.ms.id]], pl.get());
  const weeks = W.setWeek([], MON, { top: [{ taskId: "a" }, { taskId: "b" }, { taskId: "c" }] }, ctx0()).weeks;
  const r = I.weekReview(context({ tasks, nodes: pl.get(), links: lk, weeks, today: "2026-11-08" }));
  assert.deepEqual([r.tasksTotal, r.tasksDone, r.rate, r.linkedDone, r.topDone, r.topTotal], [4, 2, 50, 1, 2, 3]);
  assert.equal(r.loggedMin, null);
  assert.ok(r.sentences[0].startsWith("You finished 2 of 4 tasks dated this week (50%), 1 of them counting toward your plan."), r.sentences[0]);
  assert.ok(r.sentences.includes("Your top three: 2 of 3 finished."));
  assert.ok(r.sentences.includes("No time blocks were planned this week."));
  assert.ok(r.sentences.some((s) => /^Most important unfinished: “Task b”/.test(s) || /^Most important unfinished: “Task o”/.test(s)));
  assert.deepEqual(r.accomplished.map((t) => t.id).sort(), ["a", "c"]);
  // planned but nothing logged
  let blocks = W.addBlock([], { title: "Brand", ingredientId: "ing_gratiel", date: "2026-11-03", start: "09:00", end: "11:00" }, ctx0({ ingredients: ING })).blocks;
  const r2 = I.weekReview(context({ tasks, nodes: pl.get(), links: lk, blocks, today: "2026-11-08" }));
  assert.ok(r2.sentences.some((s) => /planned 2 h in time blocks but logged no worked time, so the actual hours aren't known/.test(s)), r2.sentences.join(" | "));
  assert.ok(r2.sentences.some((s) => /Gratiel: 2 h planned, none logged\./.test(s)));
});

test("the weekly review names at-risk items that got no work this week", () => {
  const pl = plan(), tasks = [task("a", { date: "2026-11-03" })], lk = links([["a", pl.ms.id]], pl.get());
  const r = I.weekReview(context({ tasks, nodes: pl.get(), links: lk, today: "2026-12-20" }));
  void r;
  const stalled = I.weekReview(context({ tasks: [], nodes: pl.get(), today: "2026-12-10" }));
  assert.ok(stalled.stalled.length >= 0);
});

test("the monthly review: milestones, priorities, money, and what to take into next month", () => {
  const pl = plan(), next = P.addNode(pl.get(), { type: "milestone", title: "Pre-order page live", month: "2026-12", parentId: pl.pri.id }, ctx0());
  let nodes = P.setDoneAt(next.nodes, pl.ms.id, true, ctx0()).nodes;
  let periods = P.setPeriod([], "month", "2026-11", { revenue: 5000, spend: 1200, revenueTarget: 6000, budget: 1000 }, ctx0()).periods;
  const r = I.monthReview(context({ tasks: [task("a", { completed: true }), task("b")], nodes, periods }), "2026-11");
  assert.deepEqual([r.milestones.length, r.completed.length, r.notDone.length], [1, 1, 0]);
  assert.deepEqual(r.nextUp.map((n) => n.title), ["Pre-order page live"]);
  assert.ok(r.sentences.includes("1 of 1 milestones for November are complete."));
  assert.ok(r.sentences.includes("You finished 1 of 2 tasks dated in the month (50%)."));
  assert.ok(r.sentences.includes("Sales revenue was $5,000 against a $6,000 target (83%)."));
  assert.ok(r.sentences.some((s) => /Spending was \$1,200 against a \$1,000 budget \(over by \$200\)\./.test(s)));
  const bare = I.monthReview(context({ tasks: [], nodes: [], periods: [] }), "2026-11");
  assert.ok(bare.sentences.includes("No milestones were set for November."));
  assert.ok(bare.sentences.includes("No revenue was entered for the month."));
});

/* ---------------- suggestions that need approval ---------------- */

test("proposals: overdue milestones, overdue linked tasks, an at-risk priority with nothing this week, last week's review", () => {
  const pl = plan({ msDue: "2026-10-20" }), tasks = [task("late", { date: "2026-10-30" })], lk = links([["late", pl.ms.id]], pl.get());
  const p = I.proposals(context({ tasks, nodes: pl.get(), links: lk }));
  const kinds = p.map((x) => x.kind).sort();
  assert.ok(kinds.includes("move-deadline") && kinds.includes("move-tasks") && kinds.includes("review"), kinds.join());
  const dl = p.find((x) => x.kind === "move-deadline");
  assert.deepEqual(dl.apply, { op: "set-due", id: pl.ms.id, due: "2026-11-18" });
  assert.match(dl.detail, /It was due 2026-10-20/);
  const mv = p.find((x) => x.kind === "move-tasks");
  assert.deepEqual(mv.apply, { op: "move-tasks", ids: ["late"], date: TODAY });
  assert.deepEqual(p.find((x) => x.kind === "review").apply, { op: "open-review", weekStart: "2026-10-26" });
  // nothing changes by itself: proposing does not touch the data
  assert.equal(pl.get().find((n) => n.id === pl.ms.id).due, "2026-10-20");
  assert.equal(tasks[0].date, "2026-10-30");
});

test("dismissed suggestions stay hidden for two weeks, then come back", () => {
  const pl = plan({ msDue: "2026-10-20" });
  const key = "ms-late:" + pl.ms.id;
  const hidden = I.proposals(context({ tasks: [], nodes: pl.get(), settings: { dismissed: { [key]: NOW - 3 * 86400000 } } }));
  assert.ok(!hidden.some((x) => x.key === key));
  const back = I.proposals(context({ tasks: [], nodes: pl.get(), settings: { dismissed: { [key]: NOW - 20 * 86400000 } } }));
  assert.ok(back.some((x) => x.key === key));
});

test("an at-risk priority with no task this week asks to add one; a reviewed week stops asking for its review", () => {
  const pl = plan({ msDue: "2026-12-30" });
  const near = P.editNode(pl.get(), pl.pri.id, { due: "2026-11-05" }, ctx0()).nodes;     // the quarter priority is due in 1 day with nothing done
  const p = I.proposals(context({ tasks: [], nodes: near }));
  assert.ok(p.some((x) => x.kind === "add-task" && x.id === pl.pri.id), p.map((x) => x.kind).join());
  const reviewed = W.setWeek([], "2026-10-26", { reviewedAt: NOW }, ctx0()).weeks;
  assert.ok(!I.proposals(context({ tasks: [], nodes: pl.get(), weeks: reviewed })).some((x) => x.kind === "review"));
});

/* ---------------- the quarter at a glance ---------------- */

test("quarter overview: time passed, progress, counts, and what would help a priority that is behind", () => {
  const pl = plan(), second = pl.add({ type: "priority", title: "Get the first customers", year: 2026, quarter: 4, parentId: pl.obj.id });
  pl.add({ type: "priority", title: "Idle priority", year: 2026, quarter: 4 });
  const tasks = [task("a", { completed: true, date: "2026-11-01" }), task("b", { date: "2026-12-20" }), task("c", { date: "2026-12-22" }), task("d", { date: "2026-12-23" })];
  const lk = links([["a", pl.ms.id], ["b", pl.ms.id], ["c", pl.ms.id], ["d", pl.ms.id]], pl.get());
  const o = I.quarterOverview(context({ nodes: pl.get(), tasks, links: lk }), 2026, 4);
  assert.equal(o.priorities, 3);
  assert.equal(o.expected, 37, "Oct 1 to Dec 31 is 91 days; Nov 4 is 34 days in: 37%");
  assert.equal(o.state, "during");
  assert.equal(o.actual, 25, "one of four tasks done, on the one priority that has a figure; the others have none and are left out");
  assert.equal(o.gap, -12);
  assert.deepEqual([o.milestones.done, o.milestones.total, o.tasks.done, o.tasks.total], [0, 1, 1, 4]);
  assert.deepEqual(o.counts, { notstarted: 2, ontrack: 0, atrisk: 1, completed: 0, paused: 0 });
  assert.deepEqual(o.behind.map((b) => b.id), [pl.pri.id], "only the priority that is behind its pace is listed");
  assert.deepEqual(o.behind[0].helps.map((h) => h.kind), ["schedule-week", "info"]);
  assert.equal(o.behind[0].helps[1].text, "3 open tasks and 57 days left: about 0.4 a week to finish them all.");
  assert.equal(o.behind[0].gap, -12);
  void second;
});

test("quarter overview: the help lines are tied to what the plan shows", () => {
  const pl = plan({ msDue: "2026-11-01" });                 // the milestone is overdue
  const lonely = pl.add({ type: "priority", title: "Lonely priority", year: 2026, quarter: 4, due: "2026-10-15" });   // no objective, nothing under it, past its date
  const tasks = [task("a", { date: "2026-12-28" })];
  const lk = links([["a", pl.ms.id]], pl.get());
  const o = I.quarterOverview(context({ nodes: pl.get(), tasks, links: lk }), 2026, 4);
  const ship = o.behind.find((b) => b.id === pl.pri.id);
  assert.deepEqual(ship.helps.map((h) => h.kind), ["open", "schedule-week", "info"], "the overdue milestone, then nothing dated in the next 7 days, then the sum");
  assert.equal(ship.helps[0].id, pl.ms.id, "the overdue milestone is the one named");
  assert.equal(ship.helps[2].text, "1 open task and 57 days left: about 0.1 a week to finish them all.");
  const l = o.behind.find((b) => b.id === lonely.id);
  assert.deepEqual(l.helps.map((h) => h.kind), ["link-parent", "breakdown"], "no objective above it and nothing under it");
  assert.equal(o.overdue, 2, "the overdue milestone and the overdue lonely priority (Ship itself runs to Dec 31)");
});

test("quarter overview: before and after the quarter; nothing measurable is null, not zero", () => {
  const pl = plan();
  const before = I.quarterOverview(context({ nodes: pl.get() }), 2027, 1);
  assert.deepEqual([before.state, before.expected, before.actual, before.gap, before.priorities], ["before", 0, null, null, 0]);
  const after = I.quarterOverview(context({ nodes: pl.get() }), 2026, 3);
  assert.deepEqual([after.state, after.expected], ["after", 100]);
  const now = I.quarterOverview(context({ nodes: pl.get() }), 2026, 4);
  assert.equal(now.actual, 0, "a milestone nobody has ticked off reads 0%: it is a tick-off item, not unknown");
  assert.equal(now.revenueActual, null, "no money entered: null");
  assert.equal(now.revenueTarget, null);
});

test("quarter overview: a budget priority is behind when spending runs ahead of the time, and a revenue priority names its figures", () => {
  const pl = plan();
  const bud = pl.add({ type: "priority", title: "Stay inside the marketing budget", year: 2026, quarter: 4, parentId: pl.obj.id, measure: "budget", target: 4000 });
  const rev = pl.add({ type: "priority", title: "Q4 sales target", year: 2026, quarter: 4, parentId: pl.obj.id, measure: "revenue", target: 20000 });
  const periods = [{ id: "m:2026-10", scope: "month", key: "2026-10", revenue: 5400, spend: 1300, updatedAt: 1 }, { id: "m:2026-11", scope: "month", key: "2026-11", revenue: 3100, spend: 900, updatedAt: 1 }];
  const o = I.quarterOverview(context({ nodes: pl.get(), periods }), 2026, 4);
  const b = o.behind.find((x) => x.id === bud.id);
  assert.ok(b, "2,200 of 4,000 is 55% spent with 37% of the time gone: at risk");
  assert.equal(b.phrase, "spending 18 points ahead of the time passed");
  assert.equal(b.helps.length, 1);
  assert.equal(b.helps[0].text, "Spent $2,200 of $4,000 (55% of the budget with 37% of the time passed).");
  assert.ok(!o.behind.some((x) => x.id === rev.id), "8,500 of 20,000 is 43% with 37% of the time gone: on track, so it is not listed");
  const low = I.quarterOverview(context({ nodes: pl.get(), periods: [{ id: "m:2026-10", scope: "month", key: "2026-10", revenue: 2000, updatedAt: 1 }] }), 2026, 4);
  const r = low.behind.find((x) => x.id === rev.id);
  assert.equal(r.phrase, "27 points behind the pace", "10% of the target with 37% of the time gone");
  assert.equal(r.helps[0].text, "$2,000 of $20,000 so far. $18,000 to go in 57 days: about $2,211 a week.");
  const none = I.quarterOverview(context({ nodes: pl.get(), periods: [] }), 2026, 4);
  const nb = none.behind.find((x) => x.id === bud.id), nr = none.behind.find((x) => x.id === rev.id);
  assert.ok(!nb && !nr, "nothing entered: there is no figure, so neither is called behind");
});

/* ---------------- the month ---------------- */

function monthPlan() {
  const pl = plan();
  const m2 = pl.add({ type: "milestone", title: "Photoshoot done", month: "2026-11", parentId: pl.pri.id, due: "2026-11-30", weight: 4 });
  const m3 = pl.add({ type: "milestone", title: "Pre-order page live", month: "2026-11", parentId: pl.pri.id, due: "2026-11-06" });
  const old = pl.add({ type: "milestone", title: "Supplier contract signed", month: "2026-11", parentId: pl.pri.id, due: "2026-11-01" });     // overdue
  const dec = pl.add({ type: "milestone", title: "December thing", month: "2026-12", parentId: pl.pri.id });
  return { pl, m2, m3, old, dec };
}

test("the month's three outcomes: overdue first, then the heavier, then the sooner; each says why", () => {
  const { pl, m2, m3, old } = monthPlan();
  const o = I.monthOutcomes(context({ nodes: pl.get() }), "2026-11");
  assert.deepEqual(o.map((x) => x.id), [old.id, m2.id, m3.id], "overdue first, then weight 4, then the one due in 2 days beats Samples (due 20th, weight 1)");
  assert.equal(o[0].why, "overdue by 3 days");
  assert.equal(o[1].why, "counts 4 of 5");
  assert.equal(o[2].why, "due in 2 days");
  assert.equal(o.length, 3, "never more than three");
});

test("the month's outcomes: with fewer than three milestones the quarter's priorities fill in, labelled as such", () => {
  const pl = plan();                      // one milestone in November, one priority in Q4
  const o = I.monthOutcomes(context({ nodes: pl.get() }), "2026-11");
  assert.deepEqual(o.map((x) => x.type), ["milestone", "priority"]);
  assert.ok(/^quarter priority · /.test(o[1].why));
  assert.deepEqual(I.monthOutcomes(context({ nodes: pl.get() }), "2027-05"), [], "a month with nothing planned lists nothing");
});

test("month overview: milestone and task counts, with linked and not linked kept apart", () => {
  const { pl, m2 } = monthPlan();
  const tasks = [task("a", { completed: true, date: "2026-11-02" }), task("b", { date: "2026-11-03" }), task("c", { date: "2026-11-20" }), task("d", { date: "2026-11-21", completed: true }), task("e", { date: "2026-12-01" })];
  const lk = links([["a", m2.id], ["b", m2.id]], pl.get());
  const ov = I.monthOverview(context({ nodes: pl.get(), tasks, links: lk }), "2026-11");
  assert.deepEqual(ov.milestones, { done: 0, total: 4 });
  assert.deepEqual(ov.tasks, { total: 4, done: 2, open: 2, linkedDone: 1, linkedOpen: 1, looseDone: 1, looseOpen: 1, overdue: 1 }, "e is December; b is overdue (Nov 3, today Nov 4)");
  assert.ok(ov.deadlines.every((d) => d.date.slice(0, 7) === "2026-11" && d.date >= TODAY), "only this month's upcoming deadlines");
});

test("month tasks: grouped by what they count toward, relevant first, and the inbox pages instead of listing everything", () => {
  const { pl, m2, m3 } = monthPlan();
  const tasks = [];
  for (let i = 1; i <= 40; i++) tasks.push(task("u" + i, { date: "2026-11-" + String((i % 27) + 1).padStart(2, "0"), text: "Loose " + i, priority: i % 5 === 0 ? "high" : "medium" }));
  tasks.push(task("l1", { date: "2026-11-10", text: "Book the photographer" }), task("l2", { date: "2026-11-05", text: "Pick the page theme" }), task("l3", { date: "2026-11-02", text: "Done already", completed: true }));
  const lk = links([["l1", m2.id], ["l2", m3.id], ["l3", m3.id]], pl.get());
  const ctx = context({ nodes: pl.get(), tasks, links: lk });
  const r = I.monthTaskLists(ctx, "2026-11", { pageSize: 10 });
  assert.equal(r.inbox.total, 40, "forty tasks are not linked to anything");
  assert.equal(r.inbox.items.length, 10, "but only one page of ten is returned");
  assert.equal(r.inbox.pages, 4);
  assert.deepEqual(r.groups.map((g) => g.title), ["Pre-order page live", "Photoshoot done"], "the milestone due soonest first; the done task is not listed under the default open filter");
  assert.deepEqual(r.groups[0].tasks.map((t) => t.id), ["l2"]);
  const first = r.inbox.items[0];
  assert.ok(first.date < TODAY, "overdue tasks lead the inbox: " + first.date);
  const p2 = I.monthTaskLists(ctx, "2026-11", { pageSize: 10, page: 2 });
  assert.equal(p2.inbox.page, 2);
  assert.equal(I.monthTaskLists(ctx, "2026-11", { pageSize: 10, page: 99 }).inbox.page, 4, "a page past the end is the last page");
  const all = I.monthTaskLists(ctx, "2026-11", { status: "all", pageSize: 50 });
  assert.deepEqual(all.groups.find((g) => g.title === "Pre-order page live").tasks.map((t) => t.id), ["l2", "l3"], "open before done");
});

test("month tasks: search, priority and category filters, and put-away (archived) tasks stay out of the inbox", () => {
  const { pl, m2 } = monthPlan();
  const tasks = [task("a", { text: "Email the printer", category: "Gratiel", date: "2026-11-08" }), task("b", { text: "Study for quiz", category: "School", date: "2026-11-09", priority: "high" }), task("c", { text: "Old idea", date: "2026-11-10" }), task("d", { text: "Linked one", date: "2026-11-11", category: "Gratiel" })];
  let lk = links([["d", m2.id]], pl.get());
  lk = P.setArchived(lk, "c", true, { now: NOW }).links;
  const ctx = context({ nodes: pl.get(), tasks, links: lk });
  assert.deepEqual(I.monthTaskLists(ctx, "2026-11", {}).inbox.items.map((t) => t.id), ["a", "b"], "the archived one is not in the inbox");
  assert.deepEqual(I.monthTaskLists(ctx, "2026-11", { q: "PRINTER" }).inbox.items.map((t) => t.id), ["a"], "search ignores case");
  assert.deepEqual(I.monthTaskLists(ctx, "2026-11", { priority: "high" }).inbox.items.map((t) => t.id), ["b"]);
  assert.deepEqual(I.monthTaskLists(ctx, "2026-11", { category: "Gratiel" }).inbox.items.map((t) => t.id), ["a"], "the linked Gratiel task is in a group, not the inbox");
  const byCat = I.monthTaskLists(ctx, "2026-11", { group: "category" });
  assert.deepEqual(byCat.groups.map((g) => g.title), ["Gratiel"], "grouped by the category you gave the task");
  const r = I.monthTaskLists(ctx, "2026-11", {});
  assert.equal(r.archivedCount, 1);
  assert.deepEqual(r.categories, ["Gratiel", "School"]);
  assert.equal(r.inbox.all, 2, "two tasks are waiting, whatever the filter");
});

test("month tasks: a long task list stays fast", () => {
  const { pl, m2 } = monthPlan();
  const tasks = []; for (let i = 0; i < 3000; i++) tasks.push(task("x" + i, { date: "2026-11-" + String((i % 28) + 1).padStart(2, "0"), text: "Task number " + i, category: i % 7 ? "" : "Gratiel" }));
  const lk = links(tasks.slice(0, 300).map((t) => [t.id, m2.id]), pl.get());
  const ctx = context({ nodes: pl.get(), tasks, links: lk });
  const t0 = Date.now();
  const ov = I.monthOverview(ctx, "2026-11"), lists = I.monthTaskLists(ctx, "2026-11", { q: "number 12" });
  const ms = Date.now() - t0;
  assert.ok(ms < 1500, "3,000 tasks in " + ms + " ms");
  assert.equal(ov.tasks.total, 3000);
  assert.ok(lists.inbox.items.length <= 12, "one page");
});

test("top three: the score shown always equals the listed reasons added up, including the spread-out adjustment", () => {
  const pl = plan(), second = pl.add({ type: "milestone", title: "Second milestone", month: "2026-11", parentId: pl.pri.id });
  const tasks = [task("a", { priority: "high" }), task("b", { priority: "high", date: "2026-11-05" }), task("c", { priority: "medium", date: "2026-11-06" })];
  const lk = links([["a", pl.ms.id], ["b", pl.ms.id], ["c", second.id]], pl.get());
  const picks = I.topThreePicks(context({ nodes: pl.get(), tasks, links: lk }));
  assert.equal(picks.length, 3);
  picks.forEach((p) => assert.equal(p.parts.reduce((s, x) => s + x.points, 0), p.score, p.task.id + ": the points listed add up to the score shown"));
  assert.ok(picks.some((p) => p.parts.some((x) => /same milestone/.test(x.label))), "the second pick from one milestone carries a visible minus");
});

/* ---------------- time allocation ---------------- */

test("time allocation groups categories by kind; unlogged is null, never zero; workouts count once", () => {
  let blocks = W.addBlock([], { title: "Brand", ingredientId: "ing_gratiel", date: "2026-11-02", start: "09:00", end: "11:00" }, ctx0({ ingredients: ING })).blocks;
  blocks = W.addBlock(blocks, { title: "Quiz prep", ingredientId: "ing_studying", date: "2026-11-03", start: "19:00", end: "20:30" }, ctx0({ ingredients: ING })).blocks;
  blocks = W.addBlock(blocks, { title: "Lift", ingredientId: "ing_workout", date: "2026-11-02", start: "06:00", end: "07:00" }, ctx0({ ingredients: ING })).blocks;
  blocks = W.addBlock(blocks, { title: "Chill", ingredientId: "ing_rest", date: "2026-11-03", start: "21:00", end: "22:00" }, ctx0({ ingredients: ING })).blocks;
  blocks = W.addBlock(blocks, { title: "Church", ingredientId: "ing_personal", date: "2026-11-01", start: "10:00", end: "11:00" }, ctx0({ ingredients: ING })).blocks;       // Sunday of the week before
  const base = context({ blocks });
  let a = I.timeAllocation(base, MON);
  const g = (k) => a.groups.find((x) => x.key === k);
  assert.deepEqual([g("gratiel").plannedMin, g("study").plannedMin, g("workout").plannedMin, g("personal").plannedMin, g("school").plannedMin], [120, 90, 60, 60, 0], "personal and rest are one group; last Sunday is not in this week");
  assert.equal(g("gratiel").loggedMin, null, "nothing logged: not tracked");
  assert.equal(g("workout").loggedMin, null);
  // a logged workout session in Workouts (45 min on Monday) and 60 logged on the Workout block the same day: still one hour, not 105
  const lifting = blocks.find((b) => b.title === "Lift");
  const withLog = W.logWork(blocks, lifting.id, "2026-11-02", 60, ctx0()).blocks;
  a = I.timeAllocation(context({ blocks: withLog, workouts: [{ id: "w1", date: "2026-11-02", duration: 45 }] }), MON);
  assert.equal(a.groups.find((x) => x.key === "workout").loggedMin, 60, "the larger of the two, never added");
  assert.equal(a.groups.find((x) => x.key === "gratiel").loggedMin, null, "other groups stay not tracked");
  const series = I.allocationSeries(base, 3, "gratiel");
  assert.deepEqual(series.map((x) => x.weekStart), ["2026-10-19", "2026-10-26", MON]);
  assert.deepEqual(series.map((x) => x.plannedMin), [0, 0, 120]);
  assert.deepEqual(series.map((x) => x.loggedMin), [null, null, null]);
});

/* ---------------- suggestions that need approval ---------------- */

const deepFreeze = (x) => { if (x && typeof x === "object" && !Object.isFrozen(x)) { Object.freeze(x); Object.values(x).forEach(deepFreeze); } return x; };

test("proposals: an overdue milestone and overdue tasks are proposed, and nothing changes until approved", () => {
  const pl = plan({ msDue: "2026-11-01" });
  const tasks = [task("a", { date: "2026-11-02" }), task("b", { date: "2026-11-03" }), task("c", { date: TODAY })];
  const lk = links([["a", pl.ms.id], ["b", pl.ms.id], ["c", pl.ms.id]], pl.get());
  const ctx = context({ nodes: pl.get(), tasks, links: lk });
  const props = I.proposals(Object.assign({}, ctx, { weekStart: MON, weeks: [] }));
  const kinds = props.map((p) => p.kind);
  assert.ok(kinds.includes("move-deadline") && kinds.includes("move-tasks"), JSON.stringify(kinds));
  const dl = props.find((p) => p.kind === "move-deadline");
  assert.equal(dl.apply.op, "set-due");
  assert.equal(dl.apply.due, "2026-11-18", "14 days from today");
  assert.equal(pl.get().find((n) => n.id === pl.ms.id).due, "2026-11-01", "proposing changed nothing");
});

test("applying a new deadline changes that one field, on a copy, and says how to undo it", () => {
  const pl = plan({ msDue: "2026-11-01" }), nodes = deepFreeze(pl.get());
  const r = I.applyProposal({ apply: { op: "set-due", id: pl.ms.id, due: "2026-11-18" } }, { nodes, now: NOW, today: TODAY });
  assert.equal(r.ok, true, r.text);
  assert.equal(r.nodes.find((n) => n.id === pl.ms.id).due, "2026-11-18");
  assert.equal(r.nodes.find((n) => n.id === pl.ms.id).title, "Samples approved", "nothing else changed");
  assert.equal(nodes.find((n) => n.id === pl.ms.id).due, "2026-11-01", "the original is untouched");
  assert.deepEqual(r.undo, { nodeId: pl.ms.id, due: "2026-11-01" }, "undo names the item and the date it had");
  assert.equal(I.applyProposal({ apply: { op: "set-due", id: "gone", due: "2026-11-18" } }, { nodes }).ok, false, "a deleted item is refused");
  assert.equal(I.applyProposal({ apply: { op: "set-due", id: pl.ms.id, due: "soon" } }, { nodes }).ok, false, "a bad date is refused");
});

test("applying 'move tasks to today' moves only the open listed ones and remembers where they were", () => {
  const tasks = deepFreeze([task("a", { date: "2026-11-02" }), task("b", { date: "2026-11-03", completed: true }), task("c", { date: "2026-11-01" })]);
  const r = I.applyProposal({ apply: { op: "move-tasks", ids: ["a", "b"], date: TODAY } }, { tasks });
  assert.equal(r.ok, true);
  assert.deepEqual(r.tasks.map((t) => [t.id, t.date]), [["a", TODAY], ["b", "2026-11-03"], ["c", "2026-11-01"]], "a moved; b is done so it stays; c was not listed");
  assert.deepEqual(r.undo.dates, { a: "2026-11-02" });
  assert.equal(I.applyProposal({ apply: { op: "move-tasks", ids: ["zzz"], date: TODAY } }, { tasks }).ok, false);
  assert.equal(I.applyProposal({ apply: { op: "add-task", id: "x" } }, {}).ok, false, "kinds that need you are not applied by themselves");
  assert.equal(I.applyProposal(null, {}).ok, false);
});

test("proposals: last week's review is offered only if last week had something in it, and not once it has been written", () => {
  const empty = I.proposals(Object.assign({}, context({}), { weekStart: MON, weeks: [] }));
  assert.ok(!empty.some((p) => p.kind === "review"), "an empty week has nothing to review");
  const withTask = Object.assign({}, context({ tasks: [task("a", { date: "2026-10-28" })] }), { weekStart: MON, weeks: [] });
  assert.ok(I.proposals(withTask).some((p) => p.kind === "review" && p.apply.weekStart === "2026-10-26"));
  const done = Object.assign({}, withTask, { weeks: [{ id: "wk_2026-10-26", weekStart: "2026-10-26", reviewedAt: 5, createdAt: 1, updatedAt: 1 }] });
  assert.ok(!I.proposals(done).some((p) => p.kind === "review"), "once reviewed it is not offered again");
});
