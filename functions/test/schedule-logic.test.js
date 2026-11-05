"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../../js/calendar-logic.js");
const S = require("../../js/schedule-logic.js");

const NY = "America/New_York", TODAY = "2026-11-04", NOW = 10 * 60 + 20;   // Wednesday, 10:20
let n = 0;
const ctx = () => ({ now: 1000, zone: NY, defaultDuration: 60, makeId: () => "e" + (++n) });
function mk(list) {
  let events = [];
  list.forEach((o) => { const r = C.add(events, Object.assign({ date: TODAY, time: "10:00", endTime: "11:00", category: "work" }, o), ctx()); assert.equal(r.ok, true, r.error); events = r.events; });
  return events;
}
const items = (events, tasks, biz, goals) => C.expand(events, "2026-06-01", "2026-12-31", NY).concat(C.taskItems(tasks || [], "2026-06-01", "2026-12-31"), S.businessItems(biz, goals, "2026-06-01", "2026-12-31"));
const sum = (it, extra) => S.summarize(it, Object.assign({ today: TODAY, nowMin: NOW, weekStart: 1 }, extra || {}));
const titles = (l) => l.map((i) => i.title);

test("Business dates become calendar items, and only dates somebody entered", () => {
  const biz = {
    tasks: [{ id: "t1", text: "Order samples", deadline: "2026-11-06", priority: "High", completed: false }, { id: "t2", text: "No date", deadline: "" }, { id: "t3", text: "Done one", deadline: "2026-11-02", completed: true }, { id: "t4", text: "", deadline: "2026-11-06" }, null],
    goals: [{ id: "g1", title: "Reach $1k", targetDate: "2026-11-30", status: "In Progress", priority: "High" }, { id: "g2", title: "Finished goal", targetDate: "2026-11-20", status: "Complete" }, { id: "g3", title: "No date", targetDate: "" }],
    products: [{ id: "p1", name: "Faith Hoodie", launchDate: "2026-12-01", status: "Designing" }, { id: "p2", name: "Cap", launchDate: "2026-10-20", status: "Live" }, { id: "p3", name: "Idea only", launchDate: "" }],
    profile: { name: "Gratiel", launchDate: "2026-12-15" }
  };
  const goals = [{ id: "pg1", name: "Run a 5k", targetDate: "2026-11-25", completed: false }, { id: "pg2", name: "Nope", targetDate: "bad" }];
  const out = S.businessItems(biz, goals, "2026-10-01", "2026-12-31");
  assert.deepEqual(titles(out).sort(), ["Goal: Finished goal", "Goal: Reach $1k", "Goal: Run a 5k", "Launch: Cap", "Launch: Faith Hoodie", "Launch: Gratiel", "Done one", "Order samples"].sort());
  const t1 = out.find((i) => i.id === "t1");
  assert.deepEqual([t1.source, t1.kind, t1.priority, t1.allDay, t1.point, t1.date, t1.readOnly, t1.key], ["bizTask", "task", "high", true, true, "2026-11-06", false, "biztask:t1"]);
  assert.equal(out.find((i) => i.id === "g2").completed, true, "a Complete goal is done");
  assert.equal(out.find((i) => i.id === "p2").completed, true, "a Live product has launched");
  assert.equal(out.find((i) => i.id === "p1").readOnly, true);
  assert.equal(out.find((i) => i.key === "launch:brand").title, "Launch: Gratiel");
  assert.deepEqual(S.businessItems(biz, goals, "2026-11-10", "2026-11-12"), [], "only dates inside the range");
  assert.deepEqual(S.businessItems(null, null, "2026-10-01", "2026-12-31"), []);
  assert.equal(S.businessItems({ profile: { launchDate: "2026-12-15" } }, [], "2026-10-01", "2026-12-31")[0].title, "Launch: your brand");
});

test("today: events, all-day items and tasks, in order, with what has passed marked", () => {
  const ev = mk([
    { title: "Standup", time: "09:30", endTime: "10:00" },
    { title: "Design review", time: "10:00", endTime: "11:00" },
    { title: "Film", time: "14:00", endTime: "16:00" },
    { title: "Trade show", allDay: true, date: "2026-11-03", endDate: "2026-11-05" },
    { title: "Tomorrow thing", date: "2026-11-05" }
  ]);
  const s = sum(items(ev, [{ id: "k1", date: TODAY, text: "Email supplier", time: "", priority: "high" }]));
  assert.deepEqual(titles(s.today), ["Trade show", "Email supplier", "Standup", "Design review", "Film"]);
  assert.equal(s.today[0].allDay && s.today[1].allDay, true, "all-day items come first");
  const by = {}; s.today.forEach((i) => { by[i.title] = i; });
  assert.equal(by.Standup.passed, true, "9:30-10:00 is over at 10:20");
  assert.equal(by["Design review"].passed, false, "10:00-11:00 is on now");
  assert.equal(by.Film.passed, false);
  assert.equal(s.counts.eventsToday, 4, "events, not tasks (the trade show spans today)");
  assert.equal(s.counts.openToday, 1);
});

test("next up: the event on now, else the next one today, else nothing", () => {
  const ev = mk([{ title: "Standup", time: "09:30", endTime: "10:00" }, { title: "Design review", time: "10:00", endTime: "11:00" }, { title: "Film", time: "14:00", endTime: "16:00" }]);
  let s = sum(items(ev));
  assert.deepEqual([s.nextUp.item.title, s.nextUp.state], ["Design review", "now"]);
  s = sum(items(ev), { nowMin: 11 * 60 + 5 });
  assert.deepEqual([s.nextUp.item.title, s.nextUp.state], ["Film", "next"]);
  s = sum(items(ev), { nowMin: 17 * 60 });
  assert.equal(s.nextUp, null, "nothing left today");
  const ticked = mk([{ title: "Call", kind: "task", time: "12:00" }]);
  assert.equal(sum(items(ticked)).nextUp, null, "a task is not an event: it is never 'next up'");
});

test("overdue: things with a date that passed and were not ticked, not events, not ticked ones", () => {
  const ev = mk([
    { title: "Old task", kind: "task", date: "2026-11-01", time: "" },
    { title: "Old but done", kind: "task", date: "2026-11-01", time: "", completed: true },
    { title: "Old milestone", kind: "milestone", date: "2026-10-30", time: "" },
    { title: "Past event", date: "2026-11-02" },
    { title: "Earlier today", kind: "task", time: "08:00" },
    { title: "Later today", kind: "task", time: "15:00" },
    { title: "Ancient", kind: "task", date: "2026-07-01", time: "" }
  ]);
  const tasks = [{ id: "k1", date: "2026-11-02", text: "Yesterday-ish task", priority: "medium" }, { id: "k2", date: "2026-11-02", text: "Ticked", completed: true }];
  const s = sum(items(ev, tasks));
  assert.deepEqual(titles(s.overdue), ["Old milestone", "Old task", "Yesterday-ish task", "Earlier today"]);
  assert.equal(s.counts.overdue, 4);
  assert.equal(S.isOverdue({ point: true, completed: false, date: TODAY, allDay: true }, TODAY, NOW), false, "an all-day task due today is not late yet");
});

test("next task: the soonest unticked task, never one that is overdue", () => {
  const ev = mk([{ title: "Low one", kind: "task", date: "2026-11-06", time: "", priority: "low" }, { title: "High one", kind: "task", date: "2026-11-06", time: "", priority: "high" }, { title: "Late", kind: "task", date: "2026-11-01", time: "" }]);
  let s = sum(items(ev));
  assert.equal(s.nextTask.title, "High one", "same day: the higher priority first");
  s = sum(items(ev, [{ id: "k1", date: TODAY, text: "Today's task", priority: "low" }]));
  assert.equal(s.nextTask.title, "Today's task", "a task for today comes before later days");
  assert.equal(sum(items([])).nextTask, null);
});

test("deadlines: the next 14 days, soonest first, not today's, not ticked", () => {
  const ev = mk([
    { title: "Printer due", kind: "task", date: "2026-11-06", time: "" },
    { title: "Launch day", kind: "milestone", date: "2026-11-18", time: "" },
    { title: "Too far", kind: "milestone", date: "2026-11-19", time: "" },
    { title: "Done", kind: "task", date: "2026-11-07", time: "", completed: true },
    { title: "Today's", kind: "task", date: TODAY, time: "" }
  ]);
  const biz = { tasks: [{ id: "t1", text: "Pay supplier", deadline: "2026-11-05", priority: "High" }] };
  const s = sum(items(ev, [], biz));
  assert.deepEqual(titles(s.deadlines), ["Pay supplier", "Printer due", "Launch day"]);
  assert.equal(S.whenLabel("2026-11-05", TODAY), "Tomorrow");
  assert.equal(S.whenLabel("2026-11-18", TODAY), "In 14 days");
  assert.equal(S.whenLabel(TODAY, TODAY), "Today");
  assert.equal(S.whenLabel("2026-11-01", TODAY), "3 days ago");
});

test("weekly priorities: high-priority things still to come this week", () => {
  const ev = mk([
    { title: "Big call", time: "15:00", endTime: "16:00", priority: "high" },
    { title: "Over already", time: "08:00", endTime: "09:00", priority: "high" },
    { title: "Friday launch", kind: "milestone", date: "2026-11-06", time: "", priority: "high" },
    { title: "Next week", date: "2026-11-10", priority: "high" },
    { title: "Normal", date: "2026-11-05" },
    { title: "Done", kind: "task", date: "2026-11-05", time: "", priority: "high", completed: true }
  ]);
  const s = sum(items(ev));
  assert.deepEqual(titles(s.priorities), ["Big call", "Friday launch"]);
  assert.equal(sum(items(ev), { weekStart: 0 }).priorities.length, 2);
});

test("a ticked item is never late, and an empty schedule is just empty", () => {
  const s = sum(items([]));
  assert.deepEqual([s.today, s.nextUp, s.nextTask, s.overdue, s.deadlines, s.priorities], [[], null, null, [], [], []]);
  assert.deepEqual(s.counts, { today: 0, eventsToday: 0, openToday: 0, overdue: 0, deadlines: 0, priorities: 0 });
  assert.equal(S.summarize(null, { today: TODAY, nowMin: 0 }).counts.today, 0);
});

test("the briefing line says what is true and nothing else", () => {
  const ev = mk([{ title: "Design review", time: "10:00", endTime: "11:00" }, { title: "Late task", kind: "task", date: "2026-11-01", time: "" }, { title: "Launch", kind: "milestone", date: "2026-11-06", time: "" }]);
  const s = sum(items(ev));
  assert.equal(S.briefingLine(s, TODAY, C.timeLabel), "1 event today · on now: Design review at 10:00 AM · 1 overdue · next deadline: Launch (in 2 days)");
  assert.equal(S.briefingLine(sum(items([])), TODAY, C.timeLabel), "no events today");
});

test("today hour by hour: the day's window, what is folded away, and where each item sits", () => {
  const ev = mk([
    { title: "Standup", time: "09:30", endTime: "10:00" },
    { title: "Design review", time: "10:00", endTime: "12:30" },
    { title: "Film", time: "14:00", endTime: "16:00" },
    { title: "Trade show", allDay: true, date: "2026-11-03", endDate: "2026-11-05" },
    { title: "Night shoot", time: "23:15", endTime: "23:45" }
  ]);
  const today = sum(items(ev, [{ id: "k1", date: TODAY, text: "Call Sam", time: "11:00" }, { id: "k2", date: TODAY, text: "Email supplier", time: "" }])).today;
  const d = S.daySlots(today, { today: TODAY, nowHour: 10 });
  assert.deepEqual(d.allDay.map((i) => i.title), ["Trade show", "Email supplier"], "untimed items are their own group");
  assert.deepEqual([d.slots[0].hour, d.slots[d.slots.length - 1].hour], [9, 23], "from the hour just gone to the last item (a 11:15 PM item stretches the 10 PM end)");
  const by = (h) => d.slots.find((s) => s.hour === h);
  assert.deepEqual(by(9).items.map((i) => i.title), ["Standup"]);
  assert.deepEqual(by(10).items.map((i) => i.title), ["Design review"], "a long event sits in the hour it starts");
  assert.equal(by(11).items.map((i) => i.title).join(), "Call Sam", "a task with a time sits in its hour");
  assert.equal(by(12).items.length, 0, "the hour a long event runs into is just free");
  assert.equal(by(10).isNow, true);
  assert.equal(by(9).isNow, false);
  assert.deepEqual(d.earlier, { hours: 3, items: 0 }, "6, 7 and 8 AM are folded away, with nothing in them");
  assert.equal(d.canCollapse, false);
  const open = S.daySlots(today, { today: TODAY, nowHour: 10, showEarlier: true });
  assert.equal(open.slots[0].hour, 6);
  assert.equal(open.earlier, null);
  assert.equal(open.canCollapse, true, "once expanded it can be folded again");
  // something earlier today is counted in the fold
  const early = sum(items(mk([{ title: "Breakfast", time: "07:00", endTime: "07:30" }]))).today;
  assert.deepEqual(S.daySlots(early, { today: TODAY, nowHour: 15 }).earlier, { hours: 8, items: 1 });
  // early morning and late night stretch the window to include the hour it is now
  assert.equal(S.daySlots([], { today: TODAY, nowHour: 3 }).slots[0].hour, 3);
  assert.equal(S.daySlots([], { today: TODAY, nowHour: 3 }).earlier, null);
  assert.deepEqual([S.daySlots([], { today: TODAY, nowHour: 12 }).slots.length], [12], "an empty day still shows its hours (11 AM to 10 PM) so you can add to them");
  assert.deepEqual(S.daySlots(null, { today: TODAY, nowHour: 12 }).allDay, []);
});

test("an item that began on an earlier day sits at midnight today", () => {
  const ev = mk([{ title: "Overnight", date: "2026-11-03", time: "22:00", endDate: "2026-11-04", endTime: "02:00" }]);
  const today = sum(items(ev)).today;
  assert.equal(today.length, 1);
  const d = S.daySlots(today, { today: TODAY, nowHour: 8, showEarlier: true });
  assert.equal(d.slots.find((s) => s.hour === 0).items[0].title, "Overnight");
});

test("the Business content planner's dated posts show on the schedule, read-only, done when posted", () => {
  const biz = { content: [
    { id: "c1", title: "Hoodie reel", platform: "TikTok", scheduledDate: "2026-11-06", status: "Scheduled" },
    { id: "c2", title: "Old post", platform: "TikTok", scheduledDate: "2026-11-02", status: "Posted" },
    { id: "c3", title: "No date", scheduledDate: "", status: "Idea" }, { id: "c4", title: "", scheduledDate: "2026-11-06" }, null
  ] };
  const out = S.businessItems(biz, [], "2026-11-01", "2026-11-30");
  assert.deepEqual(out.map((i) => i.title).sort(), ["Post: Hoodie reel", "Post: Old post"]);
  const c1 = out.find((i) => i.id === "c1");
  assert.deepEqual([c1.source, c1.kind, c1.category, c1.readOnly, c1.completed, c1.allDay], ["bizContent", "content", "content", true, false, true]);
  assert.equal(out.find((i) => i.id === "c2").completed, true, "a Posted one is done, so never overdue");
});
