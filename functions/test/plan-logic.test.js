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
  // the task COUNTS (done/total) are over every task under the item, each once; the PERCENTAGE is the weighted average of its parts:
  // the priority = the milestone (50%) and its own linked task (100%), counted equally = 75%; the objective = the priority (75%) and its own task (0%) = 38%
  assert.deepEqual([md.progress(p.node.id).done, md.progress(p.node.id).total, md.progress(p.node.id).pct], [2, 3, 75]);
  assert.deepEqual([md.progress(o.node.id).done, md.progress(o.node.id).total, md.progress(o.node.id).pct], [2, 4, 38]);
  assert.equal(md.progress(o.node.id).note, "0 of 1 milestone done · 2 of 4 tasks done");
  assert.deepEqual(md.progress(p.node.id).parts.map((x) => [x.kind, x.weight, x.pct]), [["node", 1, 50], ["tasks", 1, 100]], "the parts are listed, so the figure can be explained");
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
  assert.equal(model({ nodes: o.nodes, links, tasks }).progress(o.node.id).note, "No tasks or milestones yet");
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

test("a milestone with no tasks is a tick-off; it is one part of its priority; a hand-marked milestone stays complete", () => {
  const o = add([], obj()), p = add(o.nodes, pri({ parentId: o.node.id })), m1 = add(p.nodes, mil({ parentId: p.node.id })), m2 = add(m1.nodes, mil({ title: "B", parentId: p.node.id }));
  const nodes = m2.nodes;
  let md = model({ nodes });
  assert.equal(md.progress(m1.node.id).pct, 0);
  assert.equal(md.progress(m1.node.id).note, "Not ticked off yet");
  assert.equal(md.canMarkDone(m1.node.id), true);
  assert.equal(md.progress(p.node.id).pct, 0, "two tick-off milestones, neither done");
  let ns = P.setDoneAt(nodes, m1.node.id, true, ctx()).nodes;
  md = model({ nodes: ns });
  assert.equal(md.progress(m1.node.id).pct, 100);
  assert.equal(md.progress(m1.node.id).note, "Marked complete");
  assert.equal(md.progress(p.node.id).pct, 50);
  assert.equal(md.progress(p.node.id).note, "1 of 2 milestones done");
  assert.equal(md.progress(o.node.id).pct, 50);
  // a linked task that is still open does not undo a milestone you marked complete (its criteria were met); it is mentioned, though
  const links = link([], "t1", m1.node.id);
  md = model({ nodes: ns, links, tasks: [task("t1", false)] });
  assert.equal(md.progress(m1.node.id).pct, 100);
  assert.equal(md.progress(m1.node.id).note, "Marked complete (1 linked task still open)");
  assert.equal(md.canMarkDone(m1.node.id), true);
  // reopened, the tasks decide again
  ns = P.setDoneAt(ns, m1.node.id, false, ctx()).nodes;
  md = model({ nodes: ns, links, tasks: [task("t1", false)] });
  assert.equal(md.progress(m1.node.id).pct, 0);
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

test("weights: a milestone with more weight moves its priority more; equal weights are a plain average", () => {
  const o = add([], obj()), p = add(o.nodes, pri({ parentId: o.node.id })), a = add(p.nodes, mil({ title: "Big", parentId: p.node.id, weight: 3 })), b = add(a.nodes, mil({ title: "Small", parentId: p.node.id }));
  const nodes = P.setDoneAt(b.nodes, a.node.id, true, ctx()).nodes;           // Big is done (weight 3), Small is not (weight 1)
  const md = model({ nodes });
  assert.equal(md.progress(p.node.id).pct, 75, "(3 x 100 + 1 x 0) / 4");
  assert.deepEqual(md.progress(p.node.id).parts.map((x) => [x.label, x.weight, x.pct]), [["Big", 3, 100], ["Small", 1, 0]]);
  const equal = model({ nodes: P.editNode(nodes, a.node.id, { weight: 1 }, ctx()).nodes });
  assert.equal(equal.progress(p.node.id).pct, 50);
  assert.ok(P.checkNode(mil({ weight: 9 }), ctx()).errors.weight);
  assert.ok(P.checkNode(mil({ weight: 0 }), ctx()).errors.weight);
  assert.equal(P.checkNode(mil({}), ctx()).node.weight, 1, "weight 1 unless you choose");
});

test("a part with nothing to measure yet is left out of the average, never counted as 0%", () => {
  const o = add([], obj()), p1 = add(o.nodes, pri({ parentId: o.node.id })), p2 = add(p1.nodes, pri({ title: "Empty one", parentId: o.node.id }));
  const links = link([], "t1", p1.node.id);
  const md = model({ nodes: p2.nodes, links, tasks: [task("t1", true)] });
  assert.equal(md.progress(p2.node.id).pct, null, "a priority with no tasks and no milestones has no figure");
  assert.equal(md.progress(o.node.id).pct, 100, "so the objective is the one priority that has something");
  // money measures stay separate from task progress
  const rev = add(p2.nodes, pri({ title: "Revenue", parentId: o.node.id, measure: "revenue", target: 1000 }));
  assert.equal(model({ nodes: rev.nodes, links, tasks: [task("t1", true)] }).progress(o.node.id).pct, 100, "a revenue priority is not averaged into a task-based objective");
});

test("status in plain words: not started, on track, at risk, completed", () => {
  const p = add([], pri()), nodes = p.nodes;
  let links = [], tasks = [];
  for (let i = 1; i <= 10; i++) { links = link(links, "t" + i, p.node.id); tasks.push(task("t" + i, false)); }
  const at = (today, done) => P.model({ nodes, links, tasks: tasks.map((t, i) => Object.assign({}, t, { completed: i < done })), today }).statusOf(p.node.id);
  assert.equal(at("2026-10-02", 0), "notstarted", "nothing done yet and the quarter has just begun");
  assert.equal(at("2026-11-15", 5), "ontrack");
  assert.equal(at("2026-12-10", 4), "atrisk");
  assert.equal(at("2026-11-15", 10), "completed");
  assert.equal(at("2027-01-05", 3), "atrisk", "overdue counts as at risk");
  assert.equal(P.model({ nodes: P.setStatus(nodes, p.node.id, "paused", ctx()).nodes, today: "2026-11-15" }).statusOf(p.node.id), "paused");
  assert.equal(P.STATUS_LABEL.atrisk, "At risk");
});

test("days left, the chain above a task, and counting a branch's tasks once", () => {
  const o = add([], obj()), p = add(o.nodes, pri({ parentId: o.node.id, due: "2026-11-10" })), m = add(p.nodes, mil({ parentId: p.node.id }));
  const links = link(link([], "t1", m.node.id), "t2", p.node.id);
  const md = model({ nodes: m.nodes, links, tasks: [task("t1"), task("t2")] });
  assert.equal(md.daysLeft(p.node.id), 6);
  assert.equal(md.daysLeft(m.node.id), 26, "the end of November when no date was set");
  assert.deepEqual(md.chainOfTask("t1").map((n) => n.type), ["objective", "priority", "milestone"]);
  assert.deepEqual(md.chainOfTask("t2").map((n) => n.type), ["objective", "priority"]);
  assert.deepEqual(md.chainOfTask("zzz"), []);
  assert.deepEqual(md.subtreeTasks(o.node.id).map((t) => t.id).sort(), ["t1", "t2"]);
  assert.deepEqual(md.subtreeMilestones(o.node.id).map((n) => n.id), [m.node.id]);
});

test("your own templates: add, refuse duplicates, remove, restore", () => {
  const o = add([], obj({ title: "Year goal" })), p = add(o.nodes, pri({ title: "Q goal", parentId: o.node.id }));
  const m = add(p.nodes, mil({ title: "Checkpoint", parentId: p.node.id }));
  const md = model({ nodes: m.nodes, today: "2026-11-04" });
  const tpl = P.templateFromObjective(md, o.node.id, "My year", ctx());
  assert.equal(tpl.tree.priorities.length, 1);
  assert.equal(tpl.tree.priorities[0].milestones.length, 1);
  assert.ok(!JSON.stringify(tpl).includes("taskId"), "no tasks in a template");
  const a = P.addTemplate([], tpl, ctx());
  assert.equal(a.ok, true);
  assert.equal(P.addTemplate(a.templates, Object.assign({}, tpl, { id: "x" , name: "my YEAR" }), ctx()).ok, false, "the same name again is refused, ignoring case");
  assert.equal(P.addTemplate([], { name: "", tree: {} }, ctx()).ok, false, "a name is required");
  const r = P.removeTemplate(a.templates, a.template.id, ctx());
  assert.equal(r.ok, true);
  assert.equal(r.templates.filter((t) => !t.deletedAt).length, 0, "removed (kept as a marker for sync)");
  assert.equal(r.templates.length, 1);
  const back = P.restoreTemplate(r.templates, a.template.id, ctx());
  assert.equal(back.templates.filter((t) => !t.deletedAt).length, 1, "and Undo brings it back");
  assert.equal(P.removeTemplate(a.templates, "nope", ctx()).ok, false);
  // a saved template builds again in another year
  const again = P.applyTemplate(m.nodes, a.template, { year: 2027, quarter: 2 }, Object.assign(ctx(), { nodes: m.nodes }));
  assert.equal(again.ok, true);
  assert.equal(again.created.length, 3);
});

test("planned against actual: how much time has passed next to how much is done", () => {
  const p = add([], pri({ due: "2026-10-31" })), id = p.node.id;           // Q4 starts 2026-10-01: a 30-day window
  let links = [], tasks = [];
  for (let i = 1; i <= 4; i++) { links = link(links, "t" + i, id); tasks.push(task("t" + i, i <= 1)); }
  const at = (today) => P.model({ nodes: p.nodes, links, tasks, today }).pace(id);
  const mid = at("2026-10-16");
  assert.deepEqual([mid.expected, mid.actual, mid.gap, mid.state], [50, 25, -25, "during"], "halfway through, a quarter done: 25 points behind the pace");
  assert.deepEqual([at("2026-09-20").expected, at("2026-09-20").state], [0, "before"], "before it starts nothing is expected");
  assert.deepEqual([at("2026-11-20").expected, at("2026-11-20").state], [100, "after"], "after the deadline everything is expected");
  const none = P.model({ nodes: p.nodes, links: [], tasks: [], today: "2026-10-16" }).pace(id);
  assert.deepEqual([none.actual, none.gap], [null, null], "no tasks yet: no figure, never 0");
  assert.equal(P.model({ nodes: p.nodes, links, tasks }).pace(id), null, "no date known: nothing to compare");
  assert.equal(P.model({ nodes: P.setStatus(p.nodes, id, "paused", ctx()).nodes, links, tasks, today: "2026-10-16" }).pace(id), null, "paused: nothing to compare");
});

test("the new fields: description, success metric, completion criteria, supporting habits", () => {
  const r = P.checkNode(pri({ description: "  Get the first drop out  ", successMetric: "Sell 50 units", criteria: "Samples approved and pre-orders open", habitIds: ["h1", "h1", "h2", 5, ""] }), ctx());
  assert.equal(r.ok, true);
  assert.deepEqual([r.node.description, r.node.successMetric, r.node.criteria, r.node.habitIds], ["Get the first drop out", "Sell 50 units", "Samples approved and pre-orders open", ["h1", "h2"]]);
  assert.ok(P.checkNode(pri({ description: "x".repeat(501) }), ctx()).errors.description);
  assert.ok(P.checkNode(pri({ successMetric: "x".repeat(141) }), ctx()).errors.successMetric);
  // old records without the fields read as before
  const old = P.readNodes([{ id: "a", type: "objective", title: "Old", year: 2026 }]).items[0];
  assert.deepEqual([old.description, old.successMetric, old.criteria, old.weight, old.habitIds], ["", "", "", 1, []]);
});

test("putting a task away (archiving) is a note in the plan, keeps its link and estimate, and is undone by the same call", () => {
  const o = add([], obj());
  let links = P.setLink([], "t1", o.node.id, ctx({ nodes: o.nodes })).links;
  links = P.setArchived(links, "t1", true, ctx()).links;
  assert.equal(P.isArchived(links, "t1"), true);
  assert.equal(P.linkOf(links, "t1").nodeId, o.node.id, "still linked");
  links = P.setArchived(links, "t1", false, ctx()).links;
  assert.equal(P.isArchived(links, "t1"), false);
  // an unlinked task can be archived too; unlinking an archived task does not lose the note
  let l2 = P.setArchived([], "t2", true, ctx()).links;
  assert.equal(l2.length, 1);
  l2 = P.setLink(l2, "t2", "", ctx()).links;
  assert.equal(P.isArchived(l2, "t2"), true, "the archive note survives an unlink");
  l2 = P.setEstimate(l2, "t2", "", ctx()).links;
  assert.equal(P.isArchived(l2, "t2"), true);
  assert.equal(P.setArchived([], "t3", false, ctx()).links.length, 0, "nothing to un-archive: nothing is created");
});

test("settings carry a theme per year, the dismissed onboarding flag and dismissed suggestions", () => {
  const s = P.settings({ themes: { "2026": " Launch ", "2027": "", bad: "x", "2028": "y".repeat(200) }, onboardingDismissed: true, dismissed: { "p:1": 123, "p:2": "no", "p:3": -5 } }, TODAY);
  assert.deepEqual(s.themes, { "2026": "Launch", "2028": "y".repeat(80) });
  assert.equal(s.onboardingDismissed, true);
  assert.deepEqual(s.dismissed, { "p:1": 123 });
  const d = P.settings(null, TODAY);
  assert.deepEqual([d.themes, d.onboardingDismissed, d.dismissed], [{}, false, {}]);
});


/* ---------------- goal templates ---------------- */

test("a built-in template builds a whole breakdown, linked, in the quarter you choose", () => {
  const tpl = P.BUILTIN_TEMPLATES.find((t) => t.id === "tpl_clothing_drop");
  const r = P.applyTemplate([], tpl, { year: 2026, quarter: 4 }, ctx());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const md = P.model({ nodes: r.nodes, today: TODAY });
  assert.equal(r.objective.title, "Launch Gratiel and establish consistent sales");
  const pris = md.prioritiesOf(2026, 4);
  assert.deepEqual(pris.map((p) => p.title), ["Prepare the first clothing drop", "Get the first customers"]);
  assert.ok(pris.every((p) => p.parentId === r.objective.id), "priorities are linked to the objective");
  assert.deepEqual(md.milestonesOf(pris[0].id).map((m) => [m.title, m.month]), [["Finalize manufacturer and product samples", "2026-10"], ["Photoshoot and product pages ready", "2026-11"], ["Drop goes live", "2026-12"]]);
  assert.equal(md.milestonesOf(pris[0].id)[0].criteria, "A manufacturer is chosen and approved samples are in hand");
  assert.equal(pris[0].successMetric, "First drop ready to sell");
  assert.equal(r.created.length, 7);
  // in another quarter the months follow
  const q1 = P.applyTemplate([], tpl, { year: 2027, quarter: 1 }, ctx());
  assert.equal(P.model({ nodes: q1.nodes, today: TODAY }).milestonesOf(P.model({ nodes: q1.nodes, today: TODAY }).prioritiesOf(2027, 1)[0].id)[2].month, "2027-03");
});

test("applying a template is all-or-nothing and respects the three-to-a-slot rule", () => {
  const tpl = P.BUILTIN_TEMPLATES[0];
  let nodes = [];
  for (let i = 0; i < 3; i++) nodes = add(nodes, obj({ title: "O" + i })).nodes;
  const full = P.applyTemplate(nodes, tpl, { year: 2026, quarter: 4 }, ctx());
  assert.equal(full.ok, false);
  assert.match(full.errors.title, /holds 3 objectives/);
  assert.equal(nodes.length, 3, "nothing was added");
  // a quarter that already has two priorities cannot take a template with two more
  const o1 = add([], obj({ year: 2027 })), p1 = add(o1.nodes, pri({ year: 2027, quarter: 2, title: "A" })), p2 = add(p1.nodes, pri({ year: 2027, quarter: 2, title: "B" }));
  const tight = P.applyTemplate(p2.nodes, tpl, { year: 2027, quarter: 2 }, ctx());
  assert.equal(tight.ok, false);
  assert.equal(p2.nodes.length, 3);
  assert.equal(P.applyTemplate([], tpl, { year: "x", quarter: 9 }, ctx()).ok, false);
  assert.equal(P.applyTemplate([], null, { year: 2026, quarter: 1 }, ctx()).ok, false);
});

test("saving an objective as a template keeps its shape (priorities and milestones), not tasks, money or dates", () => {
  const o = add([], obj({ title: "Launch", description: "d" })), p = add(o.nodes, pri({ parentId: o.node.id, quarter: 3, title: "Drop", successMetric: "50 units", weight: 2 }));
  const m1 = add(p.nodes, mil({ title: "Samples", month: "2026-08", parentId: p.node.id, criteria: "Approved" })), m2 = add(m1.nodes, mil({ title: "Live", month: "2026-09", parentId: p.node.id }));
  const md = P.model({ nodes: m2.nodes, today: TODAY });
  const t = P.templateFromObjective(md, o.node.id, "My launch", ctx());
  assert.equal(t.name, "My launch");
  assert.deepEqual(t.tree.priorities[0].milestones.map((x) => [x.title, x.monthOffset, x.criteria]), [["Samples", 1, "Approved"], ["Live", 2, ""]], "August is the second month of Q3");
  assert.equal(t.tree.priorities[0].successMetric, "50 units");
  assert.equal(t.tree.priorities[0].weight, 2);
  assert.equal(P.templateFromObjective(md, p.node.id, "x", ctx()), null, "only objectives");
  // and it can be used again, in another year
  const again = P.applyTemplate([], t, { year: 2028, quarter: 1 }, ctx());
  assert.equal(again.ok, true);
  assert.deepEqual(P.model({ nodes: again.nodes, today: TODAY }).all("milestone").map((n) => n.month), ["2028-02", "2028-03"]);
});
