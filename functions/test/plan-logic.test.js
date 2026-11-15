"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../../js/plan-logic");

const TODAY = "2026-11-04";
const NOW = Date.parse("2026-11-04T15:00:00Z");
let seq = 0;
const ctx = (o) => Object.assign({ now: NOW, today: TODAY, makeId: (p) => p + "_" + (++seq) }, o || {});

// build a tree quickly: returns { nodes, ids }
function add(nodes, input, c) {
  const r = P.addNode(nodes, input, ctx(c));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r;
}
const obj = (o) => Object.assign({ type: "objective", title: "Reach $120k in sales", year: 2026, measure: "tasks" }, o);
const pri = (o) => Object.assign({ type: "priority", title: "Launch the winter drop", year: 2026, quarter: 4, measure: "tasks" }, o);
const mil = (o) => Object.assign({ type: "milestone", title: "Samples approved", month: "2026-11", measure: "tasks" }, o);
const task = (id, completed) => ({ id: id, date: TODAY, text: "Task " + id, priority: "medium", completed: !!completed });
const link = (links, taskId, nodeId) => P.setLink(links, taskId, nodeId, ctx()).links;
const model = (o) => P.model(Object.assign({ nodes: [], links: [], tasks: [], periods: [], settings: {}, goals: [], today: TODAY }, o));

/* ---------------- dates ---------------- */

test("dates: months, quarters, years", () => {
  assert.equal(P.isMonth("2026-11"), true);
  ["2026-13", "2026-00", "26-11", "2026-1", "", null].forEach((m) => assert.equal(P.isMonth(m), false, String(m)));
  assert.deepEqual(P.quarterMonths(2026, 4), ["2026-10", "2026-11", "2026-12"]);
  assert.equal(P.quarterOfDate("2026-03-31"), 1);
  assert.equal(P.quarterOfDate("2026-04-01"), 2);
  assert.equal(P.quarterOfDate("2026-12-31"), 4);
  assert.deepEqual(P.quarterRange(2026, 1), { start: "2026-01-01", end: "2026-03-31" });
  assert.deepEqual(P.quarterRange(2024, 1), { start: "2024-01-01", end: "2024-03-31" });
  assert.equal(P.monthEnd("2024-02"), "2024-02-29");
  assert.equal(P.monthEnd("2026-02"), "2026-02-28");
  assert.deepEqual(P.yearRange(2027), { start: "2027-01-01", end: "2027-12-31" });
  assert.equal(P.yearMonths(2026).length, 12);
});

/* ---------------- settings ---------------- */

test("settings: sensible defaults, sales (not MRR) for revenue, three plan years", () => {
  const s = P.settings(null, TODAY);
  assert.equal(s.startYear, 2026);
  assert.equal(s.revenueMetric, "sales");
  assert.equal(s.interval, 30);
  assert.deepEqual(P.planYears(s), [2026, 2027, 2028]);
  assert.equal(P.settings({ revenueMetric: "mrr", interval: 60, startYear: 2027 }, TODAY).revenueMetric, "mrr");
  assert.equal(P.settings({ revenueMetric: "weird", interval: 15 }, TODAY).revenueMetric, "sales");
  assert.equal(P.settings({ revenueMetric: "weird", interval: 15 }, TODAY).interval, 30);
  // a day that ends before it starts is ignored
  assert.equal(P.settings({ dayStart: "20:00", dayEnd: "08:00" }, TODAY).dayStart, "06:00");
  assert.equal(P.settings({ dayStart: "07:30", dayEnd: "21:00" }, TODAY).dayStart, "07:30");
  assert.equal(P.settings({}, TODAY).dailyLimitHours, 10);
  assert.equal(P.settings({ dailyLimitHours: 8.5 }, TODAY).dailyLimitHours, 8.5);
  [2, 17, 8.3, "x", null].forEach((v) => assert.equal(P.settings({ dailyLimitHours: v }, TODAY).dailyLimitHours, 10, String(v)));
});

/* ---------------- making and editing nodes ---------------- */

test("a yearly objective needs a title and a year", () => {
  assert.equal(P.checkNode(obj({ title: "  " }), ctx()).errors.title, "Give it a title.");
  assert.ok(P.checkNode(obj({ year: "" }), ctx()).errors.year);
  assert.ok(P.checkNode({ title: "x" }, ctx()).errors.type);
  const r = add([], obj({ title: "  Reach   $120k  ", notes: "why" }));
  assert.equal(r.node.title, "Reach $120k");
  assert.equal(r.node.year, 2026);
  assert.equal(r.node.parentId, "");
  assert.equal(r.node.status, "active");
  assert.equal(r.node.createdAt, NOW);
});

test("a title longer than 140 characters is refused, not cut", () => {
  assert.ok(P.checkNode(obj({ title: "x".repeat(141) }), ctx()).errors.title);
  assert.equal(P.checkNode(obj({ title: "x".repeat(140) }), ctx()).ok, true);
});

test("three objectives to a year, three priorities to a quarter; dropped ones don't take a place", () => {
  let nodes = [];
  for (let i = 0; i < 3; i++) nodes = add(nodes, obj({ title: "O" + i })).nodes;
  const fourth = P.addNode(nodes, obj({ title: "O3" }), ctx());
  assert.equal(fourth.ok, false);
  assert.match(fourth.errors.title, /holds 3 objectives/);
  // another year is fine
  assert.equal(P.addNode(nodes, obj({ title: "O3", year: 2027 }), ctx()).ok, true);
  // dropping one frees the place
  const dropped = P.setStatus(nodes, nodes[0].id, "dropped", ctx());
  assert.equal(dropped.ok, true);
  assert.equal(P.addNode(dropped.nodes, obj({ title: "O3" }), ctx()).ok, true);
  // deleting frees it too
  const gone = P.removeNode(nodes, nodes[1].id, ctx());
  assert.equal(P.addNode(gone.nodes, obj({ title: "O3" }), ctx()).ok, true);
  // priorities: per quarter
  let ps = [];
  for (let i = 0; i < 3; i++) ps = add(ps, pri({ title: "P" + i })).nodes;
  assert.equal(P.addNode(ps, pri({ title: "P3" }), ctx()).ok, false);
  assert.equal(P.addNode(ps, pri({ title: "P3", quarter: 1 }), ctx()).ok, true);
});

test("editing an objective in a full year is allowed (it isn't counted against itself)", () => {
  let nodes = [];
  for (let i = 0; i < 3; i++) nodes = add(nodes, obj({ title: "O" + i })).nodes;
  const r = P.editNode(nodes, nodes[0].id, { title: "Renamed" }, ctx({ now: NOW + 1000 }));
  assert.equal(r.ok, true);
  assert.equal(r.node.title, "Renamed");
  assert.equal(r.node.updatedAt, NOW + 1000);
  assert.equal(r.node.createdAt, NOW);
  assert.equal(r.node.type, "objective");
  // moving it into a full year is refused
  const full = nodes.concat(add(nodes, obj({ year: 2027, title: "Z" })).nodes.slice(3));
  assert.equal(P.editNode(full, full[3].id, { year: 2026 }, ctx()).ok, false);
});

test("a priority links to an objective of the same year only", () => {
  const o26 = add([], obj({ year: 2026 })), nodes = add(o26.nodes, obj({ year: 2027, title: "Next year" })).nodes;
  const o27 = nodes[1];
  assert.equal(P.addNode(nodes, pri({ parentId: o26.node.id }), ctx()).ok, true);
  const bad = P.addNode(nodes, pri({ parentId: o27.id }), ctx());
  assert.equal(bad.ok, false);
  assert.match(bad.errors.parentId, /2027, not 2026/);
  assert.ok(P.addNode(nodes, pri({ parentId: "nope" }), ctx()).errors.parentId);
  // a priority cannot sit under a priority
  const p = add(nodes, pri()).node;
  assert.ok(P.addNode(nodes.concat([p]), pri({ title: "Other", parentId: p.id }), ctx()).errors.parentId);
});

test("a milestone: month required; its year and quarter come from the month; parent must match", () => {
  const o = add([], obj()), p = add(o.nodes, pri({ parentId: o.node.id }));
  assert.ok(P.checkNode(mil({ month: "" }), ctx()).errors.month);
  const m = add(p.nodes, mil({ parentId: p.node.id })).node;
  assert.equal(m.year, 2026); assert.equal(m.quarter, 4); assert.equal(m.month, "2026-11");
  // a month outside the priority's quarter
  const bad = P.addNode(p.nodes, mil({ month: "2026-02", parentId: p.node.id }), ctx());
  assert.equal(bad.ok, false);
  assert.match(bad.errors.parentId, /Q4/);
  // directly under an objective is fine (any month of that year)
  assert.equal(P.addNode(p.nodes, mil({ month: "2026-02", parentId: o.node.id }), ctx()).ok, true);
  // not under another milestone
  const nodes = p.nodes.concat([m]);
  assert.ok(P.addNode(nodes, mil({ title: "B", parentId: m.id }), ctx()).errors.parentId);
});

test("deadlines: a real date or nothing", () => {
  assert.ok(P.checkNode(obj({ due: "2026-02-30" }), ctx()).errors.due);
  assert.equal(P.checkNode(obj({ due: "2026-12-01" }), ctx()).node.due, "2026-12-01");
  assert.equal(P.checkNode(obj({ due: "" }), ctx()).node.due, "");
});

test("measures: each needs what it needs", () => {
  assert.ok(P.checkNode(obj({ measure: "revenue" }), ctx()).errors.target);
  assert.ok(P.checkNode(obj({ measure: "revenue", target: "0" }), ctx()).errors.target);
  assert.ok(P.checkNode(obj({ measure: "revenue", target: "abc" }), ctx()).errors.target);
  const rev = P.checkNode(obj({ measure: "revenue", target: "$120,000" }), ctx());
  assert.equal(rev.ok, true); assert.equal(rev.node.target, 120000);
  assert.ok(P.checkNode(obj({ measure: "budget" }), ctx()).errors.target);
  assert.equal(P.checkNode(obj({ measure: "number", target: 2, current: "", unit: "hires" }), ctx()).node.current, 0);
  assert.ok(P.checkNode(obj({ measure: "number", target: 2, current: "-1" }), ctx()).errors.current);
  assert.ok(P.checkNode(obj({ measure: "goal" }), ctx()).errors.goalId);
  assert.ok(P.checkNode(obj({ measure: "goal", goalId: "g9" }), ctx({ goals: [{ id: "g1" }] })).errors.goalId);
  assert.equal(P.checkNode(obj({ measure: "goal", goalId: "g1" }), ctx({ goals: [{ id: "g1" }] })).ok, true);
  // an unknown measure falls back to tasks
  assert.equal(P.checkNode(obj({ measure: "vibes" }), ctx()).node.measure, "tasks");
  // fields that don't belong to a measure are not kept
  const t = P.checkNode(obj({ measure: "tasks", target: 5, goalId: "g1", unit: "x" }), ctx()).node;
  assert.equal(t.target, null); assert.equal(t.goalId, ""); assert.equal(t.unit, "");
});

test("deleting keeps a tombstone; undo brings it back; the 30 days pass", () => {
  const a = add([], obj());
  const gone = P.removeNode(a.nodes, a.node.id, ctx({ now: NOW + 5 }));
  assert.equal(gone.nodes[0].deletedAt, NOW + 5);
  assert.equal(P.liveNodes(gone.nodes).length, 0);
  assert.equal(P.byId(gone.nodes, a.node.id), null);
  const back = P.restoreNode(gone.nodes, a.node.id, ctx({ now: NOW + 9 }));
  assert.equal(back.nodes[0].deletedAt, undefined);
  assert.equal(back.nodes[0].updatedAt, NOW + 9);
  assert.equal(P.purge(gone.nodes, NOW + 29 * 86400000).length, 1);
  assert.equal(P.purge(gone.nodes, NOW + 31 * 86400000).length, 0);
});

test("reading what's stored: unknown records are kept aside, damaged fields are cleaned", () => {
  const r = P.readNodes([
    { id: "a", type: "objective", title: "  Fine ", year: 2026, measure: "weird", status: "weird", target: "x" },
    { id: "b", type: "future-kind", title: "A newer version's record", year: 2026 },
    { id: "c", type: "priority", title: "No year" },
    "junk", null
  ]);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].title, "Fine");
  assert.equal(r.items[0].measure, "tasks");
  assert.equal(r.items[0].status, "active");
  assert.equal(r.items[0].target, null);
  assert.equal(r.kept.length, 4);
});

test("moving up and down within a slot", () => {
  let nodes = [];
  for (let i = 0; i < 3; i++) nodes = add(nodes, obj({ title: "O" + i })).nodes;
  const order = (ns) => P.model({ nodes: ns, today: TODAY }).objectivesOf(2026).map((n) => n.title);
  assert.deepEqual(order(nodes), ["O0", "O1", "O2"]);
  nodes = P.move(nodes, nodes[2].id, -1, ctx());
  assert.deepEqual(order(nodes), ["O0", "O2", "O1"]);
  nodes = P.move(nodes, nodes[0].id, -1, ctx());      // already first: nothing changes
  assert.deepEqual(order(nodes), ["O0", "O2", "O1"]);
  nodes = P.move(nodes, nodes[0].id, 1, ctx());
  assert.deepEqual(order(nodes), ["O2", "O0", "O1"]);
});

/* ---------------- money: periods ---------------- */

test("periods: amounts are checked; empty clears; year/quarter hold hiring but months do not", () => {
  let periods = [];
  let r = P.setPeriod(periods, "month", "2026-11", { revenue: "$4,250.50", spend: "1200" }, ctx());
  assert.equal(r.ok, true);
  assert.equal(r.period.revenue, 4250.5); assert.equal(r.period.spend, 1200);
  periods = r.periods;
  assert.equal(P.setPeriod(periods, "month", "2026-11", { revenue: "abc" }, ctx()).ok, false);
  assert.equal(P.setPeriod(periods, "month", "2026-11", { revenue: "-5" }, ctx()).ok, false);
  assert.equal(P.setPeriod(periods, "month", "2026-13", { revenue: 5 }, ctx()).ok, false);
  r = P.setPeriod(periods, "month", "2026-11", { spend: "" }, ctx());
  assert.equal(r.period.spend, null); assert.equal(r.period.revenue, 4250.5);
  assert.equal(r.periods.length, 1, "the same record is updated, not duplicated");
  // hiring only on year and quarter
  r = P.setPeriod(periods, "quarter", "2026-Q4", { hiresPlanned: "2", hiresMade: 1, hiringNote: "A packer, a designer" }, ctx());
  assert.equal(r.ok, true); assert.equal(r.period.hiresPlanned, 2);
  assert.equal(P.setPeriod(periods, "quarter", "2026-Q4", { hiresPlanned: "1.5" }, ctx()).ok, false);
  r = P.setPeriod(periods, "month", "2026-10", { hiresPlanned: 4 }, ctx());
  assert.equal(r.period.hiresPlanned, undefined, "hiring is not tracked per month");
});

test("sales revenue adds up the months; MRR is the latest month entered", () => {
  let periods = [];
  [["2026-10", 3000], ["2026-11", 5000], ["2026-12", ""]].forEach(([m, v]) => { periods = P.setPeriod(periods, "month", m, { revenue: v }, ctx()).periods; });
  periods = P.setPeriod(periods, "quarter", "2026-Q4", { revenueTarget: 12000, budget: 4000 }, ctx()).periods;
  periods = P.setPeriod(periods, "month", "2026-10", { spend: 900 }, ctx()).periods;
  periods = P.setPeriod(periods, "month", "2026-11", { spend: 1100 }, ctx()).periods;
  const sales = P.periodSummary(periods, "quarter", "2026-Q4", "sales");
  assert.equal(sales.revenueActual, 8000);
  assert.equal(sales.revenuePct, 67);
  assert.equal(sales.spendActual, 2000);
  assert.equal(sales.spendPct, 50);
  assert.equal(sales.overBudget, false);
  assert.equal(sales.monthsEntered, 2);
  const mrr = P.periodSummary(periods, "quarter", "2026-Q4", "mrr");
  assert.equal(mrr.revenueActual, 5000, "the latest month with a number");
  assert.equal(mrr.metric, "mrr");
  // nothing entered: unknown, not zero
  const none = P.periodSummary([], "quarter", "2026-Q1", "sales");
  assert.equal(none.revenueActual, null); assert.equal(none.revenuePct, null); assert.equal(none.spendActual, null);
});

test("year totals come from the twelve months; the quarter targets are compared with the year target", () => {
  let periods = [];
  periods = P.setPeriod(periods, "year", "2026", { revenueTarget: 100000 }, ctx()).periods;
  [1, 2, 3, 4].forEach((q) => { periods = P.setPeriod(periods, "quarter", "2026-Q" + q, { revenueTarget: 20000 }, ctx()).periods; });
  periods = P.setPeriod(periods, "month", "2026-01", { revenue: 1500 }, ctx()).periods;
  periods = P.setPeriod(periods, "month", "2026-11", { revenue: 2500 }, ctx()).periods;
  const y = P.periodSummary(periods, "year", "2026", "sales");
  assert.equal(y.revenueActual, 4000);
  assert.equal(y.childTargets, 80000);
  assert.equal(y.childTargetsDiffer, true, "the four quarters add to 80,000, not 100,000");
  periods = P.setPeriod(periods, "quarter", "2026-Q1", { revenueTarget: 40000 }, ctx()).periods;
  assert.equal(P.periodSummary(periods, "year", "2026", "sales").childTargetsDiffer, false);
});

test("over budget is flagged only on real figures", () => {
  let periods = P.setPeriod([], "quarter", "2026-Q4", { budget: 1000 }, ctx()).periods;
  assert.equal(P.periodSummary(periods, "quarter", "2026-Q4", "sales").overBudget, false);
  periods = P.setPeriod(periods, "month", "2026-10", { spend: 1500 }, ctx()).periods;
  assert.equal(P.periodSummary(periods, "quarter", "2026-Q4", "sales").overBudget, true);
});

/* ---------------- links ---------------- */

test("a task links to one node; linking again moves it; the task record is never touched", () => {
  const o = add([], obj()), p = add(o.nodes, pri());
  const nodes = p.nodes;
  let links = [];
  let r = P.setLink(links, "t1", o.node.id, ctx({ nodes }));
  assert.equal(r.ok, true); links = r.links;
  assert.equal(links.length, 1);
  r = P.setLink(links, "t1", p.node.id, ctx({ nodes }));
  assert.equal(r.links.length, 1, "still one record for the task");
  assert.equal(r.links[0].nodeId, p.node.id);
  assert.equal(P.setLink(links, "t1", "ghost", ctx({ nodes })).ok, false);
  assert.equal(P.setLink(links, "", p.node.id, ctx({ nodes })).ok, false);
});

test("unlinking keeps an estimate; with nothing to keep it leaves a tombstone, and linking again revives it", () => {
  const o = add([], obj());
  let links = P.setLink([], "t1", o.node.id, ctx()).links;
  links = P.setEstimate(links, "t1", 45, ctx()).links;
  let un = P.setLink(links, "t1", "", ctx());
  assert.equal(un.links[0].nodeId, ""); assert.equal(un.links[0].estMin, 45); assert.equal(un.links[0].deletedAt, undefined);
  links = P.setEstimate(un.links, "t1", "", ctx()).links;
  assert.equal(links[0].deletedAt, NOW, "nothing left to keep");
  assert.equal(P.linkOf(links, "t1"), null);
  links = P.setLink(links, "t1", o.node.id, ctx({ now: NOW + 5 })).links;
  assert.equal(links.length, 1);
  assert.equal(links[0].deletedAt, undefined);
  assert.equal(P.linkOf(links, "t1").nodeId, o.node.id);
  assert.equal(P.setEstimate(links, "t1", "ninety", ctx()).ok, false);
  assert.equal(P.setEstimate(links, "t1", 1441, ctx()).ok, false);
});

test("old links for tasks that are gone are dropped only after 30 days", () => {
  const links = [{ id: "t1", nodeId: "n", estMin: 0, updatedAt: NOW - 40 * 86400000 }, { id: "t2", nodeId: "n", estMin: 0, updatedAt: NOW - 5 * 86400000 }, { id: "t3", nodeId: "n", estMin: 0, updatedAt: NOW - 90 * 86400000 }];
  const kept = P.purgeLinks(links, ["t3"], NOW).map((l) => l.id);
  assert.deepEqual(kept, ["t2", "t3"]);
});

/* ---------------- progress: tasks, counted once ---------------- */

test("task progress rolls up through the whole chain and counts each task once", () => {
  let nodes = [];
  const o = add(nodes, obj()); nodes = o.nodes;
  const p = add(nodes, pri({ parentId: o.node.id })); nodes = p.nodes;
  const m = add(nodes, mil({ parentId: p.node.id })); nodes = m.nodes;
  let links = [];
  links = link(links, "t1", m.node.id);       // under the milestone
  links = link(links, "t2", m.node.id);
  links = link(links, "t3", p.node.id);       // straight on the priority
  links = link(links, "t4", o.node.id);       // straight on the objective
  const tasks = [task("t1", true), task("t2", false), task("t3", true), task("t4", false), task("t5", true)];   // t5 is not linked
  const md = model({ nodes, links, tasks });
  assert.deepEqual([md.progress(m.node.id).done, md.progress(m.node.id).total, md.progress(m.node.id).pct], [1, 2, 50]);
  assert.deepEqual([md.progress(p.node.id).done, md.progress(p.node.id).total, md.progress(p.node.id).pct], [2, 3, 67]);
  assert.deepEqual([md.progress(o.node.id).done, md.progress(o.node.id).total, md.progress(o.node.id).pct], [2, 4, 50]);
  assert.equal(md.progress(o.node.id).note, "2 of 4 tasks done");
  // completing the open ones moves every level
  const done = model({ nodes, links, tasks: tasks.map((t) => Object.assign({}, t, { completed: true })) });
  assert.equal(done.progress(m.node.id).pct, 100);
  assert.equal(done.progress(p.node.id).pct, 100);
  assert.equal(done.progress(o.node.id).pct, 100);
  assert.equal(done.health(o.node.id), "done");
});

test("no double counting: a task linked twice (a stale record) or sitting under two paths is one task", () => {
  const o = add([], obj()), p = add(o.nodes, pri({ parentId: o.node.id })), nodes = p.nodes;
  // two link records for the same task id (as a bad merge could leave): only the first counts
  const links = [{ id: "t1", nodeId: p.node.id, estMin: 0, createdAt: 1, updatedAt: 1 }];
  const md = model({ nodes, links, tasks: [task("t1", true)] });
  assert.equal(md.progress(o.node.id).total, 1);
  assert.equal(md.progress(p.node.id).total, 1);
  // the same task id appearing twice in the task list (never expected, but never counted twice)
  const dup = model({ nodes, links, tasks: [task("t1", true), task("t1", true)] });
  assert.equal(dup.progress(o.node.id).total, 1);
});

test("unlinked tasks and tasks of deleted nodes count nowhere, and the tasks themselves are untouched", () => {
  const o = add([], obj());
  let links = link([], "t1", o.node.id);
  const tasks = [task("t1", true)];
  assert.equal(model({ nodes: o.nodes, links, tasks }).progress(o.node.id).pct, 100);
  links = P.setLink(links, "t1", "", ctx()).links;
  assert.equal(model({ nodes: o.nodes, links, tasks }).progress(o.node.id).pct, null, "no tasks: unknown, not 0");
  assert.equal(model({ nodes: o.nodes, links, tasks }).progress(o.node.id).note, "No tasks yet");
  assert.equal(tasks[0].completed, true);
  // the node is deleted: the task is simply not linked to anything
  links = link(links, "t1", o.node.id);
  const gone = P.removeNode(o.nodes, o.node.id, ctx()).nodes;
  const md = model({ nodes: gone, links, tasks });
  assert.equal(md.nodeOfTask("t1"), null);
  // undo: the link comes back by itself
  const back = P.restoreNode(gone, o.node.id, ctx()).nodes;
  assert.equal(model({ nodes: back, links, tasks }).nodeOfTask("t1").id, o.node.id);
});

test("a task that no longer exists isn't counted", () => {
  const o = add([], obj());
  const links = link(link([], "t1", o.node.id), "t2", o.node.id);
  const md = model({ nodes: o.nodes, links, tasks: [task("t1", true)] });
  assert.equal(md.progress(o.node.id).total, 1);
});

test("deleting an objective leaves its priorities in place, just not linked to it", () => {
  const o = add([], obj()), p = add(o.nodes, pri({ parentId: o.node.id }));
  const gone = P.removeNode(p.nodes, o.node.id, ctx()).nodes;
  const md = model({ nodes: gone });
  assert.equal(md.prioritiesOf(2026, 4).length, 1);
  assert.equal(md.parentOf(md.node(p.node.id)), null);
  assert.deepEqual(md.path(p.node.id), []);
  const back = model({ nodes: P.restoreNode(gone, o.node.id, ctx()).nodes });
  assert.deepEqual(back.path(p.node.id), ["Reach $120k in sales"]);
});

test("a milestone with no tasks is a tick-off; it counts as one item toward its parents", () => {
  const o = add([], obj()), p = add(o.nodes, pri({ parentId: o.node.id })), m1 = add(p.nodes, mil({ parentId: p.node.id })), m2 = add(m1.nodes, mil({ title: "B", parentId: p.node.id }));
  const nodes = m2.nodes;
  let md = model({ nodes });
  assert.equal(md.progress(m1.node.id).pct, 0);
  assert.equal(md.progress(m1.node.id).note, "Not ticked off yet");
  assert.equal(md.canMarkDone(m1.node.id), true);
  assert.equal(md.progress(p.node.id).total, 2);
  let ns = P.setDoneAt(nodes, m1.node.id, true, ctx()).nodes;
  md = model({ nodes: ns });
  assert.equal(md.progress(m1.node.id).pct, 100);
  assert.equal(md.progress(m1.node.id).note, "Marked done");
  assert.equal(md.progress(p.node.id).pct, 50);
  assert.equal(md.progress(p.node.id).note, "1 of 2 milestones done");
  assert.equal(md.progress(o.node.id).pct, 50);
  // a task under m1 now decides: the tick no longer counts and the box is not offered
  const links = link([], "t1", m1.node.id);
  md = model({ nodes: ns, links, tasks: [task("t1", false)] });
  assert.equal(md.canMarkDone(m1.node.id), false);
  assert.equal(md.progress(m1.node.id).pct, 0);
  assert.equal(md.progress(p.node.id).total, 2, "t1 and the still-empty second milestone");
  assert.equal(md.progress(p.node.id).pct, 0);
});

test("dropped nodes leave their parents' progress; paused ones stay in", () => {
  const o = add([], obj()), a = add(o.nodes, pri({ parentId: o.node.id })), b = add(a.nodes, pri({ title: "B", parentId: o.node.id }));
  let nodes = b.nodes;
  let links = link(link([], "t1", a.node.id), "t2", b.node.id);
  const tasks = [task("t1", true), task("t2", false)];
  assert.equal(model({ nodes, links, tasks }).progress(o.node.id).pct, 50);
  const dropped = P.setStatus(nodes, b.node.id, "dropped", ctx()).nodes;
  assert.equal(model({ nodes: dropped, links, tasks }).progress(o.node.id).pct, 100);
  assert.equal(model({ nodes: dropped, links, tasks }).progress(b.node.id).pct, 0, "its own progress is still shown");
  const paused = P.setStatus(nodes, b.node.id, "paused", ctx()).nodes;
  assert.equal(model({ nodes: paused, links, tasks }).progress(o.node.id).pct, 50);
  assert.equal(model({ nodes: paused, links, tasks }).health(b.node.id), "paused");
});

/* ---------------- progress: money, numbers, goals ---------------- */

test("revenue progress uses the revenue entered, never task completion", () => {
  const o = add([], obj({ measure: "revenue", target: 100000 })), nodes = o.nodes;
  let periods = [];
  [["2026-01", 10000], ["2026-02", 15000], ["2026-11", 5000]].forEach(([m, v]) => { periods = P.setPeriod(periods, "month", m, { revenue: v }, ctx()).periods; });
  // lots of finished tasks make no difference to it
  const links = link(link([], "t1", o.node.id), "t2", o.node.id);
  const md = model({ nodes, periods, links, tasks: [task("t1", true), task("t2", true)] });
  const pr = md.progress(o.node.id);
  assert.equal(pr.actual, 30000); assert.equal(pr.pct, 30); assert.equal(pr.total, 0);
  assert.equal(pr.note, "$30,000 of $100,000 in sales");
  // nothing entered: unknown
  assert.equal(model({ nodes, periods: [] }).progress(o.node.id).pct, null);
  assert.equal(model({ nodes, periods: [] }).progress(o.node.id).note, "No revenue entered yet");
  // reaching the target completes it
  periods = P.setPeriod(periods, "month", "2026-12", { revenue: 70000 }, ctx()).periods;
  assert.equal(model({ nodes, periods }).progress(o.node.id).complete, true);
  assert.equal(model({ nodes, periods }).health(o.node.id), "done");
});

test("a quarterly revenue priority counts only its own quarter's months; MRR uses the latest", () => {
  const p = add([], pri({ measure: "revenue", target: 20000 })), nodes = p.nodes;
  let periods = [];
  [["2026-07", 99999], ["2026-10", 6000], ["2026-11", 9000]].forEach(([m, v]) => { periods = P.setPeriod(periods, "month", m, { revenue: v }, ctx()).periods; });
  assert.equal(model({ nodes, periods }).progress(p.node.id).actual, 15000);
  assert.equal(model({ nodes, periods }).progress(p.node.id).pct, 75);
  const mrr = model({ nodes, periods, settings: { revenueMetric: "mrr" } }).progress(p.node.id);
  assert.equal(mrr.actual, 9000); assert.equal(mrr.pct, 45);
  assert.match(mrr.note, /MRR/);
});

test("budget progress is how much of the limit is spent, from what was entered; over is flagged", () => {
  const p = add([], pri({ measure: "budget", target: 2000 })), nodes = p.nodes;
  let periods = P.setPeriod([], "month", "2026-10", { spend: 800 }, ctx()).periods;
  let md = model({ nodes, periods });
  assert.equal(md.progress(p.node.id).pct, 40);
  assert.equal(md.progress(p.node.id).over, false);
  assert.equal(md.progress(p.node.id).complete, false, "spending the limit is not an achievement");
  periods = P.setPeriod(periods, "month", "2026-11", { spend: 1500 }, ctx()).periods;
  md = model({ nodes, periods });
  assert.equal(md.progress(p.node.id).pct, 115);
  assert.equal(md.progress(p.node.id).over, true);
  assert.equal(md.health(p.node.id), "over");
  assert.match(md.progress(p.node.id).note, /over/);
});

test("a number you track, and setting it", () => {
  const o = add([], obj({ title: "Hire two people", measure: "number", target: 2, current: 1, unit: "hires" }));
  let md = model({ nodes: o.nodes });
  assert.equal(md.progress(o.node.id).pct, 50);
  assert.equal(md.progress(o.node.id).note, "1 of 2 hires");
  const r = P.setCurrent(o.nodes, o.node.id, "2", ctx());
  assert.equal(r.ok, true);
  md = model({ nodes: r.nodes });
  assert.equal(md.progress(o.node.id).complete, true);
  assert.equal(P.setCurrent(o.nodes, o.node.id, "x", ctx()).ok, false);
  const t = add([], obj());
  assert.equal(P.setCurrent(t.nodes, t.node.id, 3, ctx()).ok, false);
});

test("a node can follow one of the existing Goals", () => {
  const o = add([], obj({ measure: "goal", goalId: "g1" }), { goals: [{ id: "g1" }] });
  const goals = [{ id: "g1", name: "Lose 10 lb", hasNumericTarget: true, currentValue: 4, targetValue: 10 }];
  assert.equal(model({ nodes: o.nodes, goals }).progress(o.node.id).pct, 40);
  assert.equal(model({ nodes: o.nodes, goals: [Object.assign({}, goals[0], { completed: true })] }).progress(o.node.id).pct, 100);
  assert.equal(model({ nodes: o.nodes, goals: [{ id: "g1", name: "x", manualProgressPct: 25 }] }).progress(o.node.id).pct, 25);
  const gone = model({ nodes: o.nodes, goals: [] });
  assert.equal(gone.progress(o.node.id).pct, null);
  assert.equal(gone.progress(o.node.id).note, "That goal was deleted");
});

/* ---------------- health and overdue ---------------- */

test("health compares progress with how much of the time has passed", () => {
  // a quarter priority for Q4 2026 (Oct 1 - Dec 31); "today" moves
  const p = add([], pri()), nodes = p.nodes;
  const tasks = []; let links = [];
  for (let i = 1; i <= 10; i++) { links = link(links, "t" + i, p.node.id); tasks.push(task("t" + i, i <= 5)); }   // 50% done
  const at = (today, extra) => P.model(Object.assign({ nodes, links, tasks, periods: [], settings: {}, goals: [], today: today }, extra || {})).health(p.node.id);
  assert.equal(at("2026-09-15"), "upcoming");
  assert.equal(at("2026-10-01"), "ontrack");
  assert.equal(at("2026-11-15"), "ontrack", "about half the quarter gone, half done");
  assert.equal(at("2026-12-10"), "behind", "85% of the time gone");
  assert.equal(at("2027-01-02"), "overdue");
  const none = add([], pri()).nodes;
  assert.equal(P.model({ nodes: none, today: "2026-11-15" }).health(none[0].id), "nodata");
});

test("health: late but nearly done is 'at risk', the deadline you set beats the end of the quarter", () => {
  const p = add([], pri({ due: "2026-11-15" })), nodes = p.nodes;
  let links = [], tasks = [];
  for (let i = 1; i <= 10; i++) { links = link(links, "t" + i, p.node.id); tasks.push(task("t" + i, i <= 8)); }
  const md = (today) => P.model({ nodes, links, tasks, periods: [], settings: {}, goals: [], today: today });
  assert.equal(md("2026-11-14").deadline(md("2026-11-14").node(p.node.id)), "2026-11-15");
  assert.equal(md("2026-11-14").health(p.node.id), "atrisk");
  assert.equal(md("2026-11-16").health(p.node.id), "overdue");
  assert.equal(md("2026-11-15").health(p.node.id), "atrisk", "the due day itself is not yet overdue");
});

test("overdue milestones are found, and a done one is not overdue", () => {
  const o = add([], obj()), a = add(o.nodes, mil({ title: "Old", month: "2026-09", parentId: o.node.id })), b = add(a.nodes, mil({ title: "Soon", month: "2026-11", parentId: o.node.id })), c = add(b.nodes, mil({ title: "Old but done", month: "2026-08", parentId: o.node.id }));
  const nodes = P.setDoneAt(c.nodes, c.node.id, true, ctx()).nodes;
  const md = model({ nodes });
  assert.deepEqual(md.overdueMilestones().map((n) => n.title), ["Old"]);
  assert.equal(md.overdue(a.node.id), true);
  assert.equal(md.health(c.node.id), "done");
  // a paused one raises no alarm
  const paused = P.setStatus(nodes, a.node.id, "paused", ctx()).nodes;
  assert.deepEqual(model({ nodes: paused }).overdueMilestones(), []);
});

test("ancestors and path", () => {
  const o = add([], obj()), p = add(o.nodes, pri({ parentId: o.node.id })), m = add(p.nodes, mil({ parentId: p.node.id }));
  const md = model({ nodes: m.nodes });
  assert.deepEqual(md.ancestors(m.node.id).map((n) => n.id), [p.node.id, o.node.id]);
  assert.deepEqual(md.path(m.node.id), ["Reach $120k in sales", "Launch the winter drop"]);
  assert.deepEqual(md.milestonesOf(p.node.id).map((n) => n.id), [m.node.id]);
  assert.deepEqual(md.milestonesIn("2026-11").map((n) => n.id), [m.node.id]);
});

test("a parent loop (from a bad merge) does not hang", () => {
  const nodes = [
    { id: "a", type: "priority", title: "A", year: 2026, quarter: 4, parentId: "b", measure: "tasks", status: "active", order: 1, createdAt: 1, updatedAt: 1 },
    { id: "b", type: "priority", title: "B", year: 2026, quarter: 4, parentId: "a", measure: "tasks", status: "active", order: 2, createdAt: 1, updatedAt: 1 }
  ];
  const md = model({ nodes, links: link([], "t1", "a"), tasks: [task("t1", true)] });
  assert.equal(md.progress("a").total, 1);
  assert.ok(md.ancestors("a").length <= 6);
});

test("completing a task changes every level at once (the whole chain, one task)", () => {
  // the user's scenario at the logic level: a three-year goal, a quarterly priority under it, a task, completed
  let nodes = [];
  const y3 = add(nodes, obj({ title: "Build Gratiel to $500k", year: 2028 })); nodes = y3.nodes;
  const y1 = add(nodes, obj({ title: "First $100k", year: 2026 })); nodes = y1.nodes;
  const q = add(nodes, pri({ title: "Winter drop", year: 2026, quarter: 4, parentId: y1.node.id })); nodes = q.nodes;
  const ms = add(nodes, mil({ title: "Samples", month: "2026-11", parentId: q.node.id })); nodes = ms.nodes;
  let links = link([], "t1", ms.node.id);
  let md = model({ nodes, links, tasks: [task("t1", false)] });
  assert.deepEqual([ms.node, q.node, y1.node].map((n) => md.progress(n.id).pct), [0, 0, 0]);
  assert.equal(md.progress(y3.node.id).pct, null, "the other year has nothing yet");
  md = model({ nodes, links, tasks: [task("t1", true)] });
  assert.deepEqual([ms.node, q.node, y1.node].map((n) => md.progress(n.id).pct), [100, 100, 100]);
  assert.equal(md.progress(y3.node.id).pct, null, "an unrelated objective is not touched");
});
