"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../../js/calendar-logic.js");
const A = require("../../js/assistant-logic.js");

const ZONE = "America/New_York";
const TODAY = "2026-11-04";                     // a Wednesday
const NOW = { date: TODAY, min: 10 * 60 + 20 };  // 10:20
let seq = 0;
const ctx = () => ({ now: 1, zone: ZONE, defaultDuration: 60, makeId: () => "e" + (++seq) });

function build(list) {
  let events = [];
  list.forEach((o) => {
    const r = C.add(events, Object.assign({ title: "Thing", kind: "event", category: "work", priority: "medium", endDate: o.date, tz: ZONE }, o), ctx());
    assert.ok(r.ok, "fixture: " + r.error);
    events = r.events;
  });
  return events;
}
const ev = (title, date, time, endTime, extra) => Object.assign({ title, date, time, endTime }, extra || {});
const itemsOf = (events, from, to) => C.expand(events, from || "2026-11-01", to || "2026-12-15", ZONE);
const plan = (o) => C.planSettings(o);
const frozen = (x) => { if (x && typeof x === "object" && !Object.isFrozen(x)) { Object.freeze(x); Object.values(x).forEach(frozen); } return x; };

test("planning settings: starting values, and anything odd falls back instead of breaking", () => {
  const d = C.planSettings(null);
  assert.deepEqual(d, C.DEFAULT_PLAN);
  assert.deepEqual(d.days, [1, 2, 3, 4, 5]);
  assert.deepEqual(d.goals, { content: 0, marketing: 0, research: 0, bizdev: 0 }, "no weekly goals until you set them");
  const odd = C.planSettings({ start: "7pm", end: "08:00", days: [9, "x", 2, 2, 0], session: 7, perDay: 99, goals: { content: -5, marketing: 130, research: "abc", bizdev: 99999 } });
  assert.equal(odd.start, "09:00"); assert.equal(odd.end, "17:00");
  assert.deepEqual(odd.days, [0, 2]);
  assert.equal(odd.session, 90); assert.equal(odd.perDay, 4);
  assert.deepEqual(odd.goals, { content: 0, marketing: 135, research: 0, bizdev: 0 }, "goals are whole quarter hours, between 0 and 40 hours");
  assert.deepEqual(C.planSettings({ start: "10:00", end: "10:30" }).start, "09:00", "less than an hour of room is no room");
  assert.deepEqual(C.planSettings({ days: [] }).days, [1, 2, 3, 4, 5], "no days at all falls back to the weekdays");
  assert.deepEqual(C.settings({ plan: { start: "08:00", end: "12:00", days: [6] } }).plan.days, [6], "and it is kept inside the calendar settings");
});

test("free time: events, timed tasks, planning hours, planning days and 'now' are all respected", () => {
  const events = build([
    ev("Meeting", TODAY, "11:00", "12:00"),
    ev("Done thing", TODAY, "14:00", "15:00", { completed: true }),
    ev("Milestone", TODAY, "13:00", "", { kind: "milestone" }),
    ev("Holiday", TODAY, "", "", { allDay: true })
  ]);
  const items = itemsOf(events).concat(C.taskItems([{ id: "t1", date: TODAY, text: "Call", time: "15:30", completed: false }], TODAY, TODAY));
  const b = A.board(items, plan(), NOW);
  const slots = b.free(TODAY, 30).map((g) => [g.start, g.end]);
  assert.deepEqual(slots, [[10 * 60 + 30, 11 * 60], [12 * 60, 15 * 60 + 30], [16 * 60, 17 * 60]], "after now, around the meeting, a timed task takes 30 minutes; done items, milestones and all-day items take none");
  assert.deepEqual(b.free("2026-11-07", 30), [], "Saturday is not a planning day");
  assert.equal(b.free("2026-11-05", 30)[0].start, 9 * 60, "tomorrow starts at the start of the planning hours");
  assert.deepEqual(A.board(items, plan(), NOW).free("2026-11-03", 30), [], "yesterday is gone");
  assert.equal(b.free("2026-11-07", 30, { anyDay: true }).length, 1, "unless asked for any day");
  assert.deepEqual(b.free(TODAY, 4 * 60), [{ start: 12 * 60, end: 15 * 60 + 30 }].slice(0, 0), "nothing is offered that is too short");
  b.take(TODAY, 12 * 60, 13 * 60);
  assert.deepEqual(b.free(TODAY, 30).map((g) => [g.start, g.end]), [[10 * 60 + 30, 11 * 60], [13 * 60, 15 * 60 + 30], [16 * 60, 17 * 60]], "taking a slot on the working copy changes the working copy");
  assert.equal(A.board(items, plan(), NOW).free(TODAY, 30).length, 3, "and not the next board");
});

test("find a time: the earliest openings, two a day at most, and clear errors", () => {
  const events = build([ev("Meeting", "2026-11-05", "09:00", "16:00")]);
  const r = A.suggestTimes(itemsOf(events), { minutes: 60, from: TODAY, to: "2026-11-06", plan: plan(), now: NOW });
  assert.ok(r.ok);
  assert.deepEqual(r.slots.map((s) => [s.date, s.start]), [[TODAY, 10 * 60 + 30], ["2026-11-05", 16 * 60], ["2026-11-06", 9 * 60]]);
  assert.equal(r.slots[0].end, 11 * 60 + 30);
  assert.match(r.slots[1].reason, /Free from 4:00 PM to 5:00 PM/);
  assert.equal(A.suggestTimes([], { minutes: 5, from: TODAY, to: TODAY, plan: plan(), now: NOW }).ok, false);
  assert.equal(A.suggestTimes([], { minutes: 60, from: TODAY, to: "2027-06-01", plan: plan(), now: NOW }).ok, false);
  assert.equal(A.suggestTimes([], { minutes: 60, from: "nope", to: TODAY, plan: plan(), now: NOW }).ok, false);
  const none = A.suggestTimes(itemsOf(build([ev("All day", TODAY, "09:00", "17:00")])), { minutes: 60, from: "2026-11-07", to: "2026-11-08", plan: plan(), now: NOW });
  assert.deepEqual(none.slots, [], "a weekend with no planning days has no openings, and says so by being empty");
  const many = A.suggestTimes([], { minutes: 30, from: TODAY, to: "2026-11-30", plan: plan(), now: NOW, limit: 4 });
  assert.equal(many.slots.length, 4);
});

test("clashes: the lower priority one moves to the nearest free time; the other stays", () => {
  const events = build([
    ev("Client call", TODAY, "13:00", "14:00", { priority: "high" }),
    ev("Edit video", TODAY, "13:30", "14:30", { kind: "block", priority: "low" })
  ]);
  const items = itemsOf(events);
  const r = A.fixClashes(items, { plan: plan(), now: NOW });
  assert.equal(r.count, 1);
  assert.equal(r.proposals.length, 1);
  const p = r.proposals[0];
  assert.equal(p.kind, "move"); assert.equal(p.title, "Edit video");
  assert.deepEqual(p.move.from, { date: TODAY, time: "13:30" });
  assert.deepEqual(p.move.to, { date: TODAY, time: "14:00" }, "the nearest free stretch, right after the call");
  assert.equal(p.detail, "Wed, Nov 4 · 1:30 PM → 2:00 PM – 3:00 PM", "a same-day move reads as one line");
  assert.match(p.reason, /overlaps .Client call. for 30 minutes/);
  assert.match(p.reason, /lower priority/);
  // same priority: the later one moves
  const same = A.fixClashes(itemsOf(build([ev("A", TODAY, "13:00", "14:00"), ev("B", TODAY, "13:30", "14:30")])), { plan: plan(), now: NOW });
  assert.equal(same.proposals[0].title, "B");
  assert.match(same.proposals[0].reason, /same priority/);
  // nothing overlapping: nothing to do
  assert.deepEqual(A.fixClashes(itemsOf(build([ev("A", TODAY, "13:00", "14:00"), ev("B", TODAY, "14:00", "15:00")])), { plan: plan(), now: NOW }).proposals, []);
});

test("clashes: repeating events are never moved, and what can't be fixed is said", () => {
  const rep = { repeat: { freq: "daily", interval: 1 } };
  const one = A.fixClashes(itemsOf(build([ev("Standup", TODAY, "13:00", "14:00", rep), ev("Lunch talk", TODAY, "13:15", "13:45", { priority: "high" })]), TODAY, TODAY), { plan: plan(), now: NOW });
  assert.equal(one.proposals.length, 1);
  assert.equal(one.proposals[0].title, "Lunch talk", "the one that repeats stays even though it is lower priority... the single one moves");
  assert.match(one.proposals[0].reason, /repeats, so this one moves/);
  const both = A.fixClashes(itemsOf(build([ev("Standup", TODAY, "13:00", "14:00", rep), ev("Sync", TODAY, "13:15", "13:45", rep)]), TODAY, TODAY), { plan: plan(), now: NOW });
  assert.equal(both.proposals.length, 0);
  assert.equal(both.unfixed.length, 1);
  assert.match(both.unfixed[0].why, /Both repeat/);
  // a day with no room anywhere in the next two weeks inside the planning hours
  const full = build(Array.from({ length: 16 }, (_, i) => ev("Booked " + i, C.addDays(TODAY, i), "09:00", "17:00", { priority: "high" })).concat([ev("Extra", TODAY, "10:30", "11:30", { priority: "low" })]));
  const noRoom = A.fixClashes(itemsOf(full, TODAY, "2026-12-10"), { plan: plan(), now: NOW });
  assert.equal(noRoom.proposals.length, 0);
  assert.match(noRoom.unfixed[0].why, /couldn't find a free 60-minute/);
});

test("clashes: three in a row are settled one move at a time and the moves don't land on each other", () => {
  const events = build([ev("A", TODAY, "13:00", "14:00", { priority: "high" }), ev("B", TODAY, "13:00", "14:00", { priority: "medium" }), ev("C", TODAY, "13:00", "14:00", { priority: "low" })]);
  const r = A.fixClashes(itemsOf(events), { plan: plan(), now: NOW });
  assert.equal(r.proposals.length, 2);
  const slots = r.proposals.map((p) => p.move.to.date + " " + p.move.to.time);
  assert.equal(new Set(slots).size, 2, "different places: " + slots.join(", "));
  const res = A.apply(events, r.proposals, r.proposals.map((p) => p.id), ctx());
  assert.equal(res.applied.length, 2);
  assert.equal(C.findConflicts(itemsOf(res.events)).length, 0, "after applying, nothing overlaps");
});

test("focus time: only the minutes you asked for, in even sessions, on different days, in free time", () => {
  const none = A.focusBlocks([], { plan: plan(), now: NOW, weekFrom: "2026-11-02" });
  assert.deepEqual(none.proposals, [], "with no weekly hours set, nothing is proposed");
  const p = plan({ goals: { content: 300, marketing: 60 } });   // 5 h and 1 h
  const events = build([ev("Meeting", "2026-11-05", "09:00", "17:00")]);
  const r = A.focusBlocks(itemsOf(events), { plan: p, now: NOW, weekFrom: "2026-11-02" });
  const content = r.proposals.filter((x) => x.add.input.linked.id === "content");
  assert.equal(content.length, 4, "300 minutes in sessions of at most 90 is 4 sessions");
  assert.deepEqual(content.map((x) => mins(x.add.input.endTime) - mins(x.add.input.time)), [75, 75, 75, 75], "of equal length, adding up to exactly 5 hours");
  assert.deepEqual([...new Set(content.map((x) => x.add.input.date))].sort(), [TODAY, "2026-11-06"], "Thursday is booked, so the two days left that week share the four sessions, two each");
  assert.ok(content.every((x) => x.add.input.date >= TODAY && x.add.input.date !== "2026-11-05"), "never in the past, never on the booked day");
  assert.equal(r.proposals.filter((x) => x.add.input.linked.id === "marketing").length, 1);
  const first = content[0].add.input;
  assert.equal(first.kind, "block"); assert.equal(first.category, "content"); assert.equal(first.title, "Focus: Content creation");
  assert.deepEqual(first.linked, { type: "assistant", id: "content" });
  assert.match(content[0].reason, /5 h of content creation a week and 0 h are planned/);
  // the whole set clears the checker, and none of it overlaps
  const res = A.apply(events, r.proposals, r.proposals.map((x) => x.id), ctx());
  assert.equal(res.applied.length, r.proposals.length); assert.deepEqual(res.skipped, []);
  assert.equal(C.findConflicts(itemsOf(res.events)).length, 0);
  // run it again on the result: it has already planned what you asked for, so there is nothing more to add
  const again = A.focusBlocks(itemsOf(res.events), { plan: p, now: NOW, weekFrom: "2026-11-02" });
  assert.deepEqual(again.proposals, [], "planned time counts toward the goal");
  assert.equal(again.status.find((s) => s.area === "content").planned, 300);
});

test("focus time: only blocks the assistant planned count toward a goal, never your own look-alikes", () => {
  const p = plan({ goals: { content: 90 } });
  const own = build([
    ev("Content creation", TODAY, "14:00", "15:30", { kind: "block", category: "content" }),
    ev("Film: teaser", "2026-11-05", "14:00", "15:30", { kind: "block", category: "content", linked: { type: "batch", id: "content" } })
  ]);
  const r = A.focusBlocks(itemsOf(own), { plan: p, now: NOW, weekFrom: "2026-11-02" });
  assert.equal(r.proposals.length, 1, "it can't tell your own blocks are the same thing, so it still plans the 90 minutes");
  assert.equal(r.status.find((s) => s.area === "content").planned, 0);
});

test("focus time: a small shortfall is left alone, and what doesn't fit is reported, not squeezed in", () => {
  const p = plan({ goals: { research: 120 } });
  const have = build([ev("Focus: Research", TODAY, "14:00", "15:45", { kind: "block", linked: { type: "assistant", id: "research" } })]);
  assert.deepEqual(A.focusBlocks(itemsOf(have), { plan: p, now: NOW, weekFrom: "2026-11-02" }).proposals, [], "105 of 120 minutes is close enough: under 30 minutes short");
  const busy = build(["2026-11-04", "2026-11-05", "2026-11-06"].map((d) => ev("Booked", d, "09:00", "17:00")));
  const r = A.focusBlocks(itemsOf(busy), { plan: plan({ goals: { bizdev: 240 } }), now: NOW, weekFrom: "2026-11-02" });
  assert.deepEqual(r.proposals, []);
  assert.equal(r.unplaced[0].area, "bizdev"); assert.equal(r.unplaced[0].minutes, 240, "exactly the minutes asked for, not more");
});

test("catching up: highest priority first, oldest first, a limit per day, none on days off", () => {
  const tasks = [
    { id: "a", date: "2026-11-02", text: "Low old", priority: "low", completed: false },
    { id: "b", date: "2026-11-03", text: "High newer", priority: "high", completed: false },
    { id: "c", date: "2026-11-01", text: "High oldest", priority: "high", completed: false },
    { id: "d", date: "2026-11-02", text: "Done", priority: "high", completed: true },
    { id: "e", date: "2026-11-04", text: "Today, not late", priority: "high", completed: false },
    { id: "f", date: "2026-11-02", text: "Medium", priority: "medium", completed: false }
  ];
  const r = A.catchUp({ tasks, plan: plan({ perDay: 2 }), now: NOW });
  assert.deepEqual(r.proposals.map((p) => p.title), ["High oldest", "High newer", "Medium", "Low old"], "high (oldest first), then medium, then low");
  assert.deepEqual(r.proposals.map((p) => p.move.to.date), [TODAY, "2026-11-05", "2026-11-05", "2026-11-06"], "today already has one task and the limit is 2, so one fits today, then two a day");
});

test("catching up: the per-day limit counts what is already there; weekends are skipped; late in the day starts tomorrow", () => {
  const mk = (n, date, prio) => ({ id: "t" + n, date, text: "Task " + n, priority: prio || "medium", completed: false });
  const late = [mk(1, "2026-11-02"), mk(2, "2026-11-02"), mk(3, "2026-11-02"), mk(4, "2026-11-02")];
  const today = [mk(9, TODAY)];
  const r = A.catchUp({ tasks: late.concat(today), plan: plan({ perDay: 2 }), now: NOW });
  const days = r.proposals.map((p) => p.move.to.date);
  assert.deepEqual(days, [TODAY, "2026-11-05", "2026-11-05", "2026-11-06"], "today has one already, so one more fits");
  const evening = A.catchUp({ tasks: late, plan: plan({ perDay: 2 }), now: { date: TODAY, min: 16 * 60 + 30 } });
  assert.equal(evening.proposals[0].move.to.date, "2026-11-05", "it is too late to start something new today");
  const friday = A.catchUp({ tasks: late, plan: plan({ perDay: 2 }), now: { date: "2026-11-06", min: 16 * 60 + 30 } });
  assert.equal(friday.proposals[0].move.to.date, "2026-11-09", "Friday evening: the next planning day is Monday");
  const crowded = A.catchUp({ tasks: late, plan: plan({ perDay: 1, days: [3] }), now: NOW });
  assert.equal(crowded.proposals.length, 3, "one a day on Wednesdays only: three Wednesdays fit in the two-week window");
  assert.equal(crowded.unplaced, 1, "and the one that doesn't fit is counted, not squeezed in");
});

test("catching up: old tasks are counted, not moved; Business deadlines and calendar tasks are included", () => {
  const events = build([ev("Send invoice", "2026-11-02", "", "", { kind: "task", allDay: true })]);
  const r = A.catchUp({
    tasks: [{ id: "ancient", date: "2026-08-01", text: "From the summer", priority: "high", completed: false }],
    bizTasks: [{ id: "b1", text: "Order samples", deadline: "2026-11-03", priority: "High", completed: false }, { id: "b2", text: "No date", deadline: "", priority: "High", completed: false }],
    items: itemsOf(events), plan: plan(), now: NOW
  });
  assert.equal(r.older, 1);
  assert.deepEqual(r.proposals.map((p) => [p.title, p.move.source]), [["Order samples", "bizTask"], ["Send invoice", "event"]]);
  assert.match(r.proposals[0].reason, /Business task, due 1 day ago. The due date moves/);
  assert.match(r.proposals[0].reason, /High priority goes first/);
});

test("catching up: a calendar task with a time keeps its time, and being moved next to a meeting is not a clash", () => {
  const events = build([
    ev("Call the printer", "2026-11-03", "15:00", "", { kind: "task" }),
    ev("Long meeting", "2026-11-04", "14:00", "16:00")
  ]);
  const items = itemsOf(events);
  const r = A.catchUp({ items, plan: plan(), now: NOW });
  assert.equal(r.proposals.length, 1);
  const p = r.proposals[0];
  assert.deepEqual([p.move.source, p.move.from, p.move.to], ["event", { date: "2026-11-03", time: "15:00" }, { date: TODAY, time: "15:00" }], "the same time of day on the new day");
  const res = A.apply(events, r.proposals, [p.id], ctx());
  assert.deepEqual(res.skipped, [], "a task has no length, so it isn't blocked by a meeting that covers 15:00");
  const moved = C.byId(res.events, events[0].id);
  assert.deepEqual([moved.date, moved.time], [TODAY, "15:00"]);
  // a task with no time still moves by date only
  const plain = build([ev("Send invoice", "2026-11-03", "", "", { kind: "task", allDay: true })]);
  const q = A.catchUp({ items: itemsOf(plain), plan: plan(), now: NOW }).proposals[0];
  assert.deepEqual(q.move.to, { date: TODAY });
  assert.deepEqual(A.apply(plain, [q], [q.id], ctx()).skipped, []);
});

test("splitting a project: even sessions, spread out, finished before the deadline, short of room is said", () => {
  const r = A.splitProject([], { title: "Lookbook", minutes: 360, deadline: "2026-11-20", plan: plan(), now: NOW });
  assert.ok(r.ok);
  assert.equal(r.sessions, 4); assert.equal(r.size, 90);
  assert.equal(r.proposals.length, 4);
  assert.deepEqual(r.proposals.map((p) => p.title), ["Lookbook (1/4)", "Lookbook (2/4)", "Lookbook (3/4)", "Lookbook (4/4)"]);
  const dates = r.proposals.map((p) => p.add.input.date);
  assert.deepEqual(dates, dates.slice().sort(), "in order");
  assert.equal(new Set(dates).size, 4, "on four different days");
  assert.ok(dates[3] < "2026-11-20", "the last one lands before the deadline, not on it, because there were days to spare");
  assert.equal(dates[0], TODAY, "starting today");
  assert.ok(r.proposals.every((p) => p.add.input.linked.type === "assistant" && p.add.input.linked.id === "project:lookbook"));
  assert.equal(r.unplacedMinutes, 0);
  // not enough room before a close deadline
  const booked = itemsOf(build(["2026-11-05", "2026-11-06"].map((d) => ev("Booked", d, "09:00", "17:00"))));
  const tight = A.splitProject(booked, { title: "Lookbook", minutes: 360, deadline: "2026-11-06", plan: plan(), now: { date: TODAY, min: 15 * 60 } });
  assert.ok(tight.ok);
  assert.ok(tight.unplacedMinutes > 0, "it says what didn't fit: " + tight.unplacedMinutes);
  assert.ok(tight.proposals.length < tight.sessions);
  assert.equal(A.splitProject([], { title: "", minutes: 60, deadline: "2026-11-20", plan: plan(), now: NOW }).ok, false);
  assert.equal(A.splitProject([], { title: "X", minutes: 10, deadline: "2026-11-20", plan: plan(), now: NOW }).ok, false);
  assert.equal(A.splitProject([], { title: "X", minutes: 60, deadline: "2026-11-01", plan: plan(), now: NOW }).ok, false, "a deadline in the past");
  assert.equal(A.splitProject([], { title: "X", minutes: 60, deadline: "", plan: plan(), now: NOW }).ok, false);
});

test("taking planned blocks back off: only ones the assistant made, still ahead, not done", () => {
  const events = build([
    ev("Focus: Research", "2026-11-05", "10:00", "11:00", { kind: "block", linked: { type: "assistant", id: "research" } }),
    ev("Focus: Research", "2026-11-02", "10:00", "11:00", { kind: "block", linked: { type: "assistant", id: "research" } }),
    ev("Focus: Content", "2026-11-06", "10:00", "11:00", { kind: "block", completed: true, linked: { type: "assistant", id: "content" } }),
    ev("My own block", "2026-11-05", "13:00", "14:00", { kind: "block" }),
    ev("Batch filming", "2026-11-05", "15:00", "16:00", { kind: "block", linked: { type: "batch", id: "i1" } })
  ]);
  const r = A.clearPlanned(itemsOf(events), { now: NOW });
  assert.deepEqual(r.proposals.map((p) => p.title), ["Focus: Research"]);
  assert.equal(r.proposals[0].kind, "delete");
  assert.deepEqual(r.proposals[0].detail.split(" · ")[0], "Thu, Nov 5");
});

test("preview: later suggestions in the same sitting work around earlier ones, and the real items are untouched", () => {
  const events = build([ev("Client call", TODAY, "13:00", "14:00", { priority: "high" }), ev("Edit", TODAY, "13:30", "14:30", { kind: "block", priority: "low" })]);
  const items = frozen(itemsOf(events));
  const fix = A.fixClashes(items, { plan: plan(), now: NOW });
  const after = A.preview(items, fix.proposals, ZONE);
  assert.equal(C.findConflicts(after).length, 0, "with the move applied nothing overlaps");
  assert.equal(C.findConflicts(items).length, 1, "and the original items still do");
  const edit = after.find((i) => i.title === "Edit");
  assert.deepEqual([edit.date, edit.time, edit.endTime], [fix.proposals[0].move.to.date, fix.proposals[0].move.to.time, C.timeOf(C.minutesOf(fix.proposals[0].move.to.time) + 60)]);
  // a focus block proposed afterwards doesn't land on the moved event
  const foc = A.focusBlocks(after, { plan: plan({ goals: { content: 300 } }), now: NOW, weekFrom: "2026-11-02" });
  const all = fix.proposals.concat(foc.proposals);
  const res = A.apply(events, all, all.map((p) => p.id), ctx());
  assert.deepEqual(res.skipped, [], "nothing is skipped as taken: the plan was made around its own moves");
  assert.equal(C.findConflicts(itemsOf(res.events)).length, 0);
  const added = A.preview([], foc.proposals, ZONE);
  assert.equal(added.length, foc.proposals.length);
  assert.ok(added.every((i) => i.source === "event" && i.endMin > i.startMin && !i.point));
  const gone = A.preview(items, [{ id: "d1", kind: "delete", del: { id: events[0].id } }]);
  assert.equal(gone.filter((i) => i.id === events[0].id).length, 0);
});

test("the numbers on the front page", () => {
  const events = build([ev("A", TODAY, "13:00", "14:00"), ev("B", TODAY, "13:30", "14:30"), ev("Focus: Research", "2026-11-05", "10:00", "11:00", { kind: "block", linked: { type: "assistant", id: "research" } })]);
  const o = A.overview(itemsOf(events), { tasks: [{ id: "t", date: "2026-11-02", text: "x", completed: false }], bizTasks: [{ id: "b", deadline: "2026-11-01", text: "y", completed: false }], plan: plan({ goals: { research: 180 } }), now: NOW, weekFrom: "2026-11-02" });
  assert.equal(o.clashes, 1); assert.equal(o.late, 2);
  assert.deepEqual(o.focus, [{ area: "research", label: "Research", goal: 180, planned: 60 }]);
  assert.equal(A.overview([], { plan: plan(), now: NOW, weekFrom: "2026-11-02" }).anyGoal, false);
});

/* ---------------- the approval gate ---------------- */

test("the gate: with nothing approved, nothing changes, whatever was proposed", () => {
  const events = build([ev("Client call", TODAY, "13:00", "14:00", { priority: "high" }), ev("Edit", TODAY, "13:30", "14:30", { kind: "block", priority: "low" }), ev("Focus: Research", "2026-11-06", "10:00", "11:00", { kind: "block", linked: { type: "assistant", id: "research" } })]);
  const items = itemsOf(events);
  const all = [].concat(
    A.fixClashes(items, { plan: plan(), now: NOW }).proposals,
    A.focusBlocks(items, { plan: plan({ goals: { content: 120 } }), now: NOW, weekFrom: "2026-11-02" }).proposals,
    A.clearPlanned(items, { now: NOW }).proposals,
    A.splitProject(items, { title: "Big", minutes: 120, deadline: "2026-11-12", plan: plan(), now: NOW }).proposals
  );
  assert.ok(all.length >= 4 && new Set(all.map((p) => p.id)).size === all.length, "proposals exist and have distinct ids even from different helpers");
  assert.ok(new Set(all.map((p) => p.kind)).size === 3, "all three kinds were proposed");
  for (const approved of [undefined, null, [], ["nope"], [42], "all"]) {
    const res = A.apply(events, all, approved, ctx());
    assert.equal(res.events, events, "the very same list, untouched: " + JSON.stringify(approved));
    assert.deepEqual(res.applied, []); assert.equal(res.changed, false);
  }
  assert.deepEqual(A.select(all, []), []);
  const tasks = [{ id: "t", date: "2026-11-02", text: "x", completed: false }];
  const cu = A.catchUp({ tasks, plan: plan(), now: NOW }).proposals;
  assert.equal(A.applyTasks(tasks, cu, []).tasks, tasks);
});

test("the gate: only the approved ones are applied", () => {
  const events = build([]);
  const r = A.focusBlocks([], { plan: plan({ goals: { content: 270 } }), now: NOW, weekFrom: "2026-11-02" });
  assert.equal(r.proposals.length, 3);
  const res = A.apply(events, r.proposals, [r.proposals[1].id], ctx());
  assert.deepEqual(res.applied, [r.proposals[1].id]);
  assert.equal(C.live(res.events).length, 1);
  assert.equal(res.events.length, 1);
  assert.equal(C.live(res.events)[0].date, r.proposals[1].add.input.date);
  const dup = A.apply(events, r.proposals, [r.proposals[0].id, r.proposals[0].id], ctx());
  assert.equal(C.live(dup.events).length, 1, "approving the same id twice applies it once");
});

test("the gate: what changed since the proposal is checked again at the moment you approve", () => {
  const events = build([]);
  const r = A.focusBlocks([], { plan: plan({ goals: { content: 90 } }), now: NOW, weekFrom: "2026-11-02" });
  const p = r.proposals[0].add.input;
  // the slot gets taken before you press Apply
  const taken = build([ev("Dentist", p.date, p.time, p.endTime)]);
  const res = A.apply(taken, r.proposals, [r.proposals[0].id], ctx());
  assert.deepEqual(res.applied, []);
  assert.equal(res.skipped[0].error, "That time is taken now.");
  assert.equal(res.events, taken);
  // a move whose event was moved by someone else in the meantime
  const clash = build([ev("Client call", TODAY, "13:00", "14:00", { priority: "high" }), ev("Edit", TODAY, "13:30", "14:30", { kind: "block", priority: "low" })]);
  const fix = A.fixClashes(itemsOf(clash), { plan: plan(), now: NOW });
  const mv = clash.find((e) => e.title === "Edit");
  const moved = C.moveTo(clash, mv.id, TODAY, { date: "2026-11-06", time: "09:00" }, "all", ctx()).events;
  const stale = A.apply(moved, fix.proposals, [fix.proposals[0].id], ctx());
  assert.deepEqual(stale.applied, []);
  assert.equal(stale.skipped[0].error, "It was moved since I looked.");
  // an event that is gone
  const gone = A.apply(C.remove(clash, mv.id, ctx()).events, fix.proposals, [fix.proposals[0].id], ctx());
  assert.equal(gone.skipped[0].error, "That event isn't there any more.");
  assert.equal(events.length, 0);
});

test("the gate: the assistant can only delete what it planned itself", () => {
  const events = build([ev("Focus: Research", "2026-11-05", "10:00", "11:00", { kind: "block", linked: { type: "assistant", id: "research" } }), ev("My own", "2026-11-05", "13:00", "14:00", { kind: "block" })]);
  const own = events.find((e) => e.title === "My own"), mine = events.find((e) => e.title === "Focus: Research");
  const forged = [{ id: "x1", kind: "delete", del: { id: own.id } }, { id: "x2", kind: "delete", del: { id: mine.id } }];
  const res = A.apply(events, forged, ["x1", "x2"], ctx());
  assert.deepEqual(res.applied, ["x2"]);
  assert.equal(res.skipped[0].error, "I only remove blocks I planned.");
  assert.ok(C.byId(res.events, own.id), "your own block is still there");
  assert.equal(C.byId(res.events, mine.id), null);
  assert.ok(res.events.find((e) => e.id === mine.id).deletedAt, "removed the way every deletion is: kept 30 days so Undo works");
});

test("the gate: task moves go through applyTasks, only approved, and a task that changed is left alone", () => {
  const tasks = [{ id: "a", date: "2026-11-02", text: "One", priority: "high", completed: false }, { id: "b", date: "2026-11-02", text: "Two", priority: "low", completed: false }, { id: "c", date: "2026-11-02", text: "Three", priority: "low", completed: false }];
  const cu = A.catchUp({ tasks, plan: plan(), now: NOW });
  const byTitle = (t) => cu.proposals.find((p) => p.title === t).id;
  const changed = tasks.map((t) => t.id === "c" ? Object.assign({}, t, { completed: true }) : t.id === "b" ? Object.assign({}, t, { date: "2026-11-03" }) : t);
  const res = A.applyTasks(changed, cu.proposals, [byTitle("One"), byTitle("Two"), byTitle("Three")]);
  assert.deepEqual(res.applied, [byTitle("One")]);
  assert.deepEqual(res.skipped.map((s) => s.error).sort(), ["That task is done now.", "That task was moved since I looked."]);
  assert.equal(res.tasks.find((t) => t.id === "a").date, TODAY);
  assert.equal(res.tasks.find((t) => t.id === "b").date, "2026-11-03");
  assert.equal(tasks[0].date, "2026-11-02", "the original list is not changed");
  // calendar events are not touched by applyTasks, and task moves are not touched by apply
  assert.equal(A.apply([], cu.proposals, cu.proposals.map((p) => p.id), ctx()).applied.length, 0);
});

test("nothing here changes what it is given", () => {
  const events = frozen(build([ev("Client call", TODAY, "13:00", "14:00", { priority: "high" }), ev("Edit", TODAY, "13:30", "14:30", { kind: "block", priority: "low" })]));
  const items = frozen(itemsOf(events));
  const tasks = frozen([{ id: "a", date: "2026-11-02", text: "One", priority: "high", completed: false }]);
  const pl = frozen(plan({ goals: { content: 120 } }));
  const fix = A.fixClashes(items, { plan: pl, now: frozen(Object.assign({}, NOW)) });
  A.focusBlocks(items, { plan: pl, now: NOW, weekFrom: "2026-11-02" });
  A.catchUp({ tasks, plan: pl, now: NOW });
  A.splitProject(items, { title: "Big", minutes: 120, deadline: "2026-11-12", plan: pl, now: NOW });
  A.suggestTimes(items, { minutes: 60, from: TODAY, to: "2026-11-10", plan: pl, now: NOW });
  A.clearPlanned(items, { now: NOW });
  A.overview(items, { tasks, plan: pl, now: NOW, weekFrom: "2026-11-02" });
  A.apply(events, fix.proposals, fix.proposals.map((p) => p.id), ctx());
  A.applyTasks(tasks, [], []);
});

function mins(t) { return C.minutesOf(t); }
