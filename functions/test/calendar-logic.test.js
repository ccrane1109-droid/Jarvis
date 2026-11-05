"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../../js/calendar-logic.js");

const NY = "America/New_York";
let n = 0;
const ctx = (extra) => Object.assign({ now: 1000000, zone: NY, defaultDuration: 60, makeId: () => "ev" + (++n) }, extra || {});
const base = (o) => Object.assign({ title: "Meeting", date: "2026-11-04", time: "10:00", endTime: "11:00", category: "work" }, o || {});
const made = (o, extra) => { const r = C.add([], base(o), ctx(extra)); assert.equal(r.ok, true, r.error); return r; };

test("dates: real calendar days only, and plain date arithmetic", () => {
  assert.equal(C.isDate("2026-02-29"), false);
  assert.equal(C.isDate("2028-02-29"), true);
  assert.equal(C.isDate("2026-13-01"), false);
  assert.equal(C.isTime("24:00"), false);
  assert.equal(C.isTime("9:00"), false);
  assert.equal(C.isTime("09:05"), true);
  assert.equal(C.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(C.addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(C.addMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(C.addMonths("2026-11-15", -11), "2025-12-15");
  assert.equal(C.diffDays("2026-11-04", "2026-11-09"), 5);
  assert.equal(C.weekday("2026-11-04"), 3); // Wednesday
});

test("time zones: wall time to instant and back, including both clock changes", () => {
  assert.equal(C.isValidZone("America/New_York"), true);
  assert.equal(C.isValidZone("Mars/Base"), false);
  const t = C.wallToInstant("2026-11-04", "10:20", NY);
  assert.equal(new Date(t).toISOString(), "2026-11-04T15:20:00.000Z"); // EST, UTC-5
  assert.deepEqual(C.instantToWall(t, NY), { date: "2026-11-04", time: "10:20" });
  assert.deepEqual(C.instantToWall(t, "Europe/London"), { date: "2026-11-04", time: "15:20" });
  assert.deepEqual(C.instantToWall(t, "Asia/Tokyo"), { date: "2026-11-05", time: "00:20" });
  // clocks go forward 2 AM -> 3 AM on 8 March 2026: 2:30 does not exist and lands after the jump
  assert.equal(new Date(C.wallToInstant("2026-03-08", "02:30", NY)).toISOString(), "2026-03-08T07:30:00.000Z");
  // clocks go back 2 AM -> 1 AM on 1 November 2026: 1:30 happens twice; the first one
  assert.equal(new Date(C.wallToInstant("2026-11-01", "01:30", NY)).toISOString(), "2026-11-01T05:30:00.000Z");
  // an ordinary time is exact in summer too
  assert.equal(new Date(C.wallToInstant("2026-07-04", "09:00", NY)).toISOString(), "2026-07-04T13:00:00.000Z");
});

test("checking an event: what is refused, with a reason", () => {
  const bad = (o) => C.check(base(o), ctx());
  assert.match(bad({ title: "   " }).errors.title, /title/i);
  assert.match(bad({ title: "x".repeat(141) }).errors.title, /140/);
  assert.match(bad({ date: "2026-02-30" }).errors.date, /date/i);
  assert.match(bad({ time: "" }).errors.time, /start time/i);
  assert.match(bad({ time: "25:00" }).errors.time, /start time/i);
  assert.match(bad({ endTime: "09:30" }).errors.endTime, /after the start/);
  assert.match(bad({ endTime: "10:00" }).errors.endTime, /after the start/);
  assert.match(bad({ repeat: { freq: "hourly" } }).errors.repeat, /how often/);
  assert.match(bad({ repeat: { freq: "daily", interval: 0 } }).errors.repeat, /1 to 99/);
  assert.match(bad({ repeat: { freq: "daily", until: "2026-11-01" } }).errors.repeat, /on or after/);
  assert.match(bad({ reminders: [99999] }).errors.reminders, /week/);
  assert.match(bad({ reminders: [0, 5, 10, 30, 60, 1440] }).errors.reminders, /Up to 5/);
  assert.match(bad({ allDay: true, endDate: "2026-11-02" }).errors.endDate, /can't be before/);
  assert.match(bad({ allDay: true, endDate: "2027-03-01" }).errors.endDate, /31 days/);
  assert.equal(bad({ description: "d".repeat(2001) }).ok, false);
});

test("checking an event: tidy results, sensible defaults", () => {
  const r = C.check({ title: "  Film   the drop ", date: "2026-11-04", time: "14:00", kind: "nope", category: "nope", priority: "nope", reminders: [10, 10, 60] }, ctx());
  assert.equal(r.ok, true);
  assert.equal(r.event.title, "Film the drop");
  assert.equal(r.event.kind, "event");
  assert.equal(r.event.category, "other");
  assert.equal(r.event.priority, "medium");
  assert.equal(r.event.endTime, "15:00");            // default length: an hour
  assert.deepEqual(r.event.reminders, [60, 10]);     // no repeats, longest first
  assert.equal(r.event.tz, NY);
  // a default length that runs past midnight ends the next day
  const late = C.check({ title: "Late", date: "2026-11-04", time: "23:30" }, ctx());
  assert.equal(late.event.endDate, "2026-11-05");
  assert.equal(late.event.endTime, "00:30");
  // tasks and reminders are a point in time: the time is optional
  const t = C.check({ title: "Pay supplier", kind: "task", date: "2026-11-06" }, ctx());
  assert.equal(t.ok, true);
  assert.equal(t.event.time, "");
  assert.equal(t.event.endTime, "");
  // weekly with no days repeats on the start's weekday
  const w = C.check(base({ repeat: { freq: "weekly" } }), ctx());
  assert.deepEqual(w.event.repeat, { freq: "weekly", interval: 1, byDay: [3] });
});

test("add, edit, duplicate: one list, nothing mutated", () => {
  const a = made();
  const before = JSON.stringify(a.events);
  const e = C.edit(a.events, a.event.id, { title: "Standup", time: "09:00", endTime: "09:15" }, ctx({ now: 2000000 }));
  assert.equal(e.ok, true);
  assert.equal(JSON.stringify(a.events), before, "the list that went in is untouched");
  assert.equal(e.event.title, "Standup");
  assert.equal(e.event.updatedAt, 2000000);
  assert.equal(e.event.createdAt, 1000000);
  assert.equal(C.edit(a.events, a.event.id, { endTime: "08:00" }, ctx()).ok, false, "an end before the start is refused and nothing changes");
  assert.equal(C.edit(a.events, "nope", { title: "x" }, ctx()).ok, false);
  const d = C.duplicate(a.events, a.event.id, ctx({ now: 3000000 }));
  assert.equal(d.events.length, 2);
  assert.notEqual(d.event.id, a.event.id);
  assert.equal(d.event.title, "Meeting");
  assert.equal(d.event.createdAt, 3000000);
  const bad = C.add([], { title: "", date: "2026-11-04", time: "10:00" }, ctx());
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.events, []);
});

test("delete only marks the event, can be undone, and is dropped after 30 days", () => {
  const a = made();
  const r = C.remove(a.events, a.event.id, ctx({ now: 5000000 }));
  assert.equal(r.ok, true);
  assert.equal(r.events.length, 1, "kept as a marker so the deletion can sync");
  assert.equal(C.live(r.events).length, 0);
  assert.equal(C.expand(r.events, "2026-11-01", "2026-11-30", NY).length, 0, "and it no longer shows");
  assert.equal(C.byId(r.events, a.event.id), null);
  const back = C.restore(r.events, a.event.id, ctx({ now: 6000000 }));
  assert.equal(back.ok, true);
  assert.equal(C.live(back.events).length, 1);
  assert.equal(back.event.deletedAt, undefined);
  assert.equal(back.event.updatedAt, 6000000, "newer than the deletion, so the undo wins a merge");
  assert.equal(C.purge(r.events, 5000000 + 29 * 86400000).length, 1);
  assert.equal(C.purge(r.events, 5000000 + 31 * 86400000).length, 0);
});

test("reading storage: keeps what is usable, drops what is not", () => {
  const list = C.sanitizeList([
    { id: "a", title: "Good", date: "2026-11-04", time: "10:00", endTime: "11:00", tz: NY, exceptions: ["2026-11-11", "junk"], source: "weird" },
    { id: "a", title: "Duplicate id", date: "2026-11-04", time: "10:00" },
    { id: "b", title: "", date: "2026-11-04", time: "10:00" },
    { title: "No id", date: "2026-11-04", time: "10:00" },
    { id: "c", title: "Bad date", date: "nope", time: "10:00" },
    null, 7, "x"
  ]);
  assert.deepEqual(list.map((e) => e.id), ["a"]);
  assert.deepEqual(list[0].exceptions, ["2026-11-11"]);
  assert.equal(list[0].source, "local");
  assert.deepEqual(C.sanitizeList("nope"), []);
});

test("repeating: daily, weekly on chosen days, monthly, yearly", () => {
  const ev = (o) => Object.assign(made(o).event);
  const daily = ev({ repeat: { freq: "daily", interval: 2 } });
  assert.deepEqual(C.repeatDates(daily, "2026-11-04", "2026-11-12"), ["2026-11-04", "2026-11-06", "2026-11-08", "2026-11-10", "2026-11-12"]);
  const weekly = ev({ repeat: { freq: "weekly", byDay: [1, 3, 5] } }); // Mon Wed Fri, starting Wed 4 Nov
  assert.deepEqual(C.repeatDates(weekly, "2026-11-01", "2026-11-14"), ["2026-11-04", "2026-11-06", "2026-11-09", "2026-11-11", "2026-11-13"]);
  const everyOther = ev({ repeat: { freq: "weekly", interval: 2 } });
  assert.deepEqual(C.repeatDates(everyOther, "2026-11-01", "2026-12-10"), ["2026-11-04", "2026-11-18", "2026-12-02"]);
  const monthly = ev({ date: "2026-01-31", repeat: { freq: "monthly" } });
  assert.deepEqual(C.repeatDates(monthly, "2026-01-01", "2026-04-30"), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  const yearly = ev({ date: "2028-02-29", repeat: { freq: "yearly" } });
  assert.deepEqual(C.repeatDates(yearly, "2028-01-01", "2031-12-31"), ["2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28"]);
});

test("repeating: until, count, skipped days, and a range far from the start", () => {
  const until = made({ repeat: { freq: "daily", until: "2026-11-06" } }).event;
  assert.deepEqual(C.repeatDates(until, "2026-11-01", "2026-12-01"), ["2026-11-04", "2026-11-05", "2026-11-06"]);
  const count = made({ repeat: { freq: "weekly", count: 3 } }).event;
  assert.deepEqual(C.repeatDates(count, "2026-11-01", "2027-06-01"), ["2026-11-04", "2026-11-11", "2026-11-18"]);
  const late = C.repeatDates(count, "2026-11-12", "2027-06-01");
  assert.deepEqual(late, ["2026-11-18"], "a count is counted from the start, not from the window");
  const skip = Object.assign({}, made({ repeat: { freq: "daily" } }).event, { exceptions: ["2026-11-05"] });
  assert.deepEqual(C.repeatDates(skip, "2026-11-04", "2026-11-06"), ["2026-11-04", "2026-11-06"]);
  const far = made({ date: "2020-01-01", repeat: { freq: "daily", interval: 3 } }).event;
  const d = C.repeatDates(far, "2026-11-04", "2026-11-10");
  assert.equal(d.length >= 2, true);
  d.forEach((x) => assert.equal(C.diffDays("2020-01-01", x) % 3, 0));
});

test("what shows: converted to the zone you view in, multi-day spans, all-day dates stay put", () => {
  const ev = made({ date: "2026-11-04", time: "22:30", endTime: "23:30", tz: NY }).event;
  const tokyo = C.expand([ev], "2026-11-04", "2026-11-06", "Asia/Tokyo");
  assert.equal(tokyo.length, 1);
  assert.equal(tokyo[0].date, "2026-11-05");
  assert.equal(tokyo[0].time, "12:30");
  assert.equal(tokyo[0].endTime, "13:30");
  const ny = C.expand([ev], "2026-11-04", "2026-11-04", NY);
  assert.equal(ny[0].startMin, 22 * 60 + 30);
  const trip = made({ allDay: true, date: "2026-11-10", endDate: "2026-11-12", tz: NY }).event;
  const t1 = C.expand([trip], "2026-11-11", "2026-11-11", "Asia/Tokyo");
  assert.equal(t1.length, 1, "a span that began earlier still shows on a later day");
  assert.equal(t1[0].date, "2026-11-10");
  assert.equal(t1[0].allDay, true);
  assert.equal(C.allDayFor(C.expand([trip], "2026-11-09", "2026-11-13", NY), "2026-11-12").length, 1);
  assert.equal(C.allDayFor(C.expand([trip], "2026-11-09", "2026-11-13", NY), "2026-11-13").length, 0);
  // the same weekly 9 AM stays 9 AM across the clock change
  const weekly = made({ date: "2026-10-28", time: "09:00", endTime: "10:00", repeat: { freq: "weekly" } }).event;
  const items = C.expand([weekly], "2026-10-28", "2026-11-11", NY);
  assert.deepEqual(items.map((i) => i.time), ["09:00", "09:00", "09:00"]);
  assert.equal(new Date(items[0].startMs).toISOString(), "2026-10-28T13:00:00.000Z");
  assert.equal(new Date(items[2].startMs).toISOString(), "2026-11-11T14:00:00.000Z");
});

test("tasks from the To-Do list show as items; a timed one is drawn as half an hour", () => {
  const tasks = [
    { id: "t1", date: "2026-11-04", text: "Email supplier", time: "", completed: false, priority: "high" },
    { id: "t2", date: "2026-11-04", text: "Study", time: "09:30", completed: true },
    { id: "t3", date: "2026-11-09", text: "Later", time: "" },
    { id: "t4", date: "bad", text: "x" }, null
  ];
  const items = C.taskItems(tasks, "2026-11-01", "2026-11-08");
  assert.deepEqual(items.map((i) => i.id), ["t1", "t2"]);
  assert.equal(items[0].allDay, true);
  assert.equal(items[0].priority, "high");
  assert.equal(items[1].startMin, 570);
  assert.equal(items[1].endMin, 600);
  assert.equal(items[1].completed, true);
  assert.equal(items[1].source, "task");
});

test("laying out a day: overlapping items share the width, the rest do not", () => {
  const mk = (id, a, b) => ({ key: id, id, allDay: false, date: "2026-11-04", endDate: "2026-11-04", startMin: a, endMin: b, source: "event", point: false, title: id });
  const L = C.layoutDay([mk("a", 540, 600), mk("b", 570, 630), mk("c", 600, 660), mk("d", 900, 960)], "2026-11-04");
  const by = {}; L.forEach((x) => { by[x.item.id] = x; });
  assert.deepEqual([by.a.col, by.b.col, by.c.col], [0, 1, 0]);
  assert.equal(by.a.cols, 2);
  assert.equal(by.c.cols, 2);
  assert.equal(by.d.cols, 1);
  const short = C.layoutDay([mk("e", 600, 605)], "2026-11-04")[0];
  assert.equal(short.endMin - short.startMin, 30, "a very short one is still tall enough to tap");
  // a late-night item that runs into the next day is clipped on both days
  const night = { key: "n", id: "n", allDay: false, date: "2026-11-04", endDate: "2026-11-05", startMin: 1380, endMin: 60, source: "event", point: false };
  assert.equal(C.layoutDay([night], "2026-11-04")[0].endMin, 1440);
  assert.equal(C.layoutDay([night], "2026-11-05")[0].startMin, 0);
});

test("conflicts: events with a length that overlap, and nothing else", () => {
  const a = made({ title: "A", time: "10:00", endTime: "11:00" }).event;
  const b = made({ title: "B", time: "10:30", endTime: "11:30" }).event;
  const c = made({ title: "C", time: "11:30", endTime: "12:00" }).event;
  const t = made({ title: "T", kind: "task", time: "10:15" }).event;
  const items = C.expand([a, b, c, t], "2026-11-04", "2026-11-04", NY);
  const found = C.findConflicts(items);
  assert.equal(found.length, 1);
  assert.deepEqual([found[0].a.title, found[0].b.title, found[0].minutes], ["A", "B", 30]);
  const s = C.wallToInstant("2026-11-04", "11:15", NY), e = C.wallToInstant("2026-11-04", "11:45", NY);
  assert.deepEqual(C.conflictsWith(items, s, e).map((i) => i.title).sort(), ["B", "C"]);
  assert.equal(C.conflictsWith(items, s, e, "x").length, 2);
});

test("search and filters", () => {
  const items = [
    { title: "Film the drop", description: "TikTok", category: "content", kind: "content", completed: false },
    { title: "Pay supplier", description: "", category: "business", kind: "task", completed: true },
    { title: "Gym", description: "legs", category: "health", kind: "event", completed: false }
  ];
  assert.equal(C.filterItems(items, { q: "tiktok" }).length, 1);
  assert.equal(C.filterItems(items, { q: "  GYM " }).length, 1);
  assert.equal(C.filterItems(items, { categories: ["business", "health"] }).length, 2);
  assert.equal(C.filterItems(items, { kinds: ["task"] }).length, 1);
  assert.equal(C.filterItems(items, { hideDone: true }).length, 2);
  assert.equal(C.filterItems(items, {}).length, 3);
  assert.equal(C.matchesSearch({ title: "A", description: "", notes: "secret note" }, "secret"), true);
});

test("looking around: month grid, week range, moving between views, titles", () => {
  const g = C.monthGrid("2026-11-15", 1);
  assert.equal(g.from, "2026-10-26"); // Monday before 1 Nov (a Sunday)
  assert.equal(g.weeks.length, 6);
  assert.equal(g.weeks[0].length, 7);
  assert.equal(g.to, "2026-12-06");
  assert.equal(C.monthGrid("2026-11-15", 0).from, "2026-11-01");
  assert.deepEqual(C.rangeFor("week", "2026-11-04", 1), { from: "2026-11-02", to: "2026-11-08" });
  assert.deepEqual(C.rangeFor("week", "2026-11-04", 0), { from: "2026-11-01", to: "2026-11-07" });
  assert.deepEqual(C.rangeFor("day", "2026-11-04", 1), { from: "2026-11-04", to: "2026-11-04" });
  assert.deepEqual(C.rangeFor("agenda", "2026-11-04", 1), { from: "2026-11-04", to: "2026-12-03" });
  assert.equal(C.shiftAnchor("month", "2026-01-31", 1), "2026-02-01");
  assert.equal(C.shiftAnchor("week", "2026-11-04", -1), "2026-10-28");
  assert.equal(C.viewTitle("month", "2026-11-04", 1), "November 2026");
  assert.equal(C.viewTitle("day", "2026-11-04", 1), "Wednesday, November 4");
  assert.equal(C.viewTitle("week", "2026-11-04", 1), "Nov 2 – 8, 2026");
  assert.equal(C.viewTitle("week", "2026-10-28", 1), "Oct 26 – Nov 1, 2026");
  assert.equal(C.timeLabel("00:05"), "12:05 AM");
  assert.equal(C.timeLabel("13:30"), "1:30 PM");
  assert.equal(C.hourLabel(0), "12 AM");
  assert.equal(C.hourLabel(12), "12 PM");
});

test("agenda: days with something, in time order, a span listed on each of its days", () => {
  const a = made({ title: "Late", time: "15:00", endTime: "16:00" }).event;
  const b = made({ title: "Early", time: "08:00", endTime: "09:00" }).event;
  const c = made({ title: "Trip", allDay: true, date: "2026-11-05", endDate: "2026-11-06" }).event;
  const items = C.expand([a, b, c], "2026-11-04", "2026-11-10", NY);
  const ag = C.agenda(items, "2026-11-04", "2026-11-10");
  assert.deepEqual(ag.map((d) => d.date), ["2026-11-04", "2026-11-05", "2026-11-06"]);
  assert.deepEqual(ag[0].items.map((i) => i.title), ["Early", "Late"]);
  assert.deepEqual(ag[1].items.map((i) => i.title), ["Trip"]);
});

test("moving: a timed event keeps its length, and a repeating one can move one day or all", () => {
  const a = made({ time: "10:00", endTime: "11:30" });
  const m = C.moveTo(a.events, a.event.id, "2026-11-04", { date: "2026-11-06", time: "14:15" }, "all", ctx({ now: 9 }));
  assert.equal(m.ok, true);
  assert.deepEqual([m.event.date, m.event.time, m.event.endDate, m.event.endTime], ["2026-11-06", "14:15", "2026-11-06", "15:45"]);
  assert.equal(m.event.updatedAt, 9);
  // across midnight
  const late = C.moveTo(a.events, a.event.id, "2026-11-04", { date: "2026-11-04", time: "23:00" }, "all", ctx());
  assert.deepEqual([late.event.endDate, late.event.endTime], ["2026-11-05", "00:30"]);
  // all-day
  const d = made({ allDay: true, date: "2026-11-10", endDate: "2026-11-12" });
  const dm = C.moveTo(d.events, d.event.id, "2026-11-10", { date: "2026-11-17" }, "all", ctx());
  assert.deepEqual([dm.event.date, dm.event.endDate], ["2026-11-17", "2026-11-19"]);
  // a task with no time dropped on a time gets the time
  const t = made({ kind: "task", time: "", title: "Call" });
  const tm = C.moveTo(t.events, t.event.id, "2026-11-04", { date: "2026-11-05", time: "16:00" }, "all", ctx());
  assert.deepEqual([tm.event.date, tm.event.time], ["2026-11-05", "16:00"]);
  assert.equal(C.moveTo(a.events, a.event.id, "2026-11-04", { date: "2026-11-06" }, "all", ctx()).ok, false, "a timed event needs a time");
  assert.equal(C.moveTo(a.events, "nope", "2026-11-04", { date: "2026-11-06", time: "10:00" }, "all", ctx()).ok, false);
  // repeating
  const r = made({ repeat: { freq: "weekly", byDay: [3] } });
  const one = C.moveTo(r.events, r.event.id, "2026-11-11", { date: "2026-11-12", time: "09:00" }, "this", ctx());
  assert.equal(one.ok, true);
  assert.equal(one.events.length, 2);
  const series = one.events.filter((e) => e.id === r.event.id)[0];
  assert.deepEqual(series.exceptions, ["2026-11-11"]);
  const items = C.expand(one.events, "2026-11-04", "2026-11-18", NY);
  assert.deepEqual(items.map((i) => i.date + " " + i.time), ["2026-11-04 10:00", "2026-11-12 09:00", "2026-11-18 10:00"]);
  const all = C.moveTo(r.events, r.event.id, "2026-11-11", { date: "2026-11-12", time: "10:00" }, "all", ctx());
  assert.deepEqual(all.event.repeat.byDay, [4], "the series moves to Thursdays");
  assert.equal(all.event.date, "2026-11-05");
});

test("moving across zones: dropped on the view zone's clock, stored on the event's own", () => {
  const a = made({ time: "10:00", endTime: "11:00", tz: NY });
  // viewing in London, drop it at 18:00 London on the 4th = 13:00 New York
  const m = C.moveTo(a.events, a.event.id, "2026-11-04", { date: "2026-11-04", time: "18:00" }, "all", ctx({ zone: "Europe/London" }));
  assert.deepEqual([m.event.date, m.event.time, m.event.endTime, m.event.tz], ["2026-11-04", "13:00", "14:00", NY]);
});

test("resizing: the end changes, never before the start", () => {
  const a = made({ time: "10:00", endTime: "11:00" });
  const r = C.resizeTo(a.events, a.event.id, "2026-11-04", { date: "2026-11-04", time: "12:30" }, ctx());
  assert.equal(r.ok, true);
  assert.equal(r.event.endTime, "12:30");
  assert.equal(C.resizeTo(a.events, a.event.id, "2026-11-04", { date: "2026-11-04", time: "09:00" }, ctx()).ok, false);
  const t = made({ kind: "task", time: "10:00" });
  assert.equal(C.resizeTo(t.events, t.event.id, "2026-11-04", { date: "2026-11-04", time: "11:00" }, ctx()).ok, false);
});

test("repeating events: change or delete just one day, finish a day of a series", () => {
  const r = made({ repeat: { freq: "daily" } });
  const e = C.editOccurrence(r.events, r.event.id, "2026-11-06", { title: "Different" }, "this", ctx());
  assert.equal(e.ok, true);
  assert.equal(e.event.title, "Different");
  assert.equal(e.event.repeat, null);
  assert.equal(e.event.date, "2026-11-04", "the one-off keeps the series' start unless told otherwise");
  const titles = C.expand(e.events, "2026-11-05", "2026-11-07", NY).map((i) => i.title);
  assert.equal(titles.filter((x) => x === "Meeting").length >= 2, true);
  const rm = C.removeOccurrence(r.events, r.event.id, "2026-11-05", ctx());
  assert.deepEqual(C.expand(rm.events, "2026-11-04", "2026-11-06", NY).map((i) => i.date), ["2026-11-04", "2026-11-06"]);
  const un = C.unremoveOccurrence(rm.events, r.event.id, "2026-11-05", ctx());
  assert.equal(C.expand(un.events, "2026-11-04", "2026-11-06", NY).length, 3);
  const done = C.setDone(r.events, r.event.id, "2026-11-05", true, ctx());
  const items = C.expand(done.events, "2026-11-04", "2026-11-06", NY);
  assert.deepEqual(items.map((i) => i.completed), [false, true, false], "a repeating task is done one day at a time");
  const one = made({ kind: "task", time: "" });
  assert.equal(C.setDone(one.events, one.event.id, "2026-11-04", true, ctx()).event.completed, true);
});

test("settings: unusable values fall back to defaults", () => {
  assert.deepEqual(C.settings(null), { weekStart: 1, timeZone: "", defaultView: "", defaultDuration: 60, defaultReminder: -1, plan: C.DEFAULT_PLAN, updatedAt: 0 });
  const s = C.settings({ weekStart: 0, timeZone: "Europe/London", defaultView: "agenda", defaultDuration: 45, defaultReminder: 10, updatedAt: 5 });
  assert.deepEqual([s.weekStart, s.timeZone, s.defaultView, s.defaultDuration, s.defaultReminder], [0, "Europe/London", "agenda", 45, 10]);
  const bad = C.settings({ weekStart: 5, timeZone: "Nope/Zone", defaultView: "year", defaultDuration: 5, defaultReminder: -9 });
  assert.deepEqual([bad.weekStart, bad.timeZone, bad.defaultView, bad.defaultDuration, bad.defaultReminder], [1, "", "", 60, -1]);
  assert.equal(C.viewZone({ timeZone: "Asia/Tokyo" }), "Asia/Tokyo");
});

test("the calendar has a size limit and says so", () => {
  const events = [];
  for (let i = 0; i < C.MAX_EVENTS; i++) events.push({ id: "e" + i, title: "x", date: "2026-11-04" });
  const r = C.add(events, base(), ctx());
  assert.equal(r.ok, false);
  assert.match(r.error, /full/);
});
