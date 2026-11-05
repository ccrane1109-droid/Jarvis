"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../../js/calendar-logic.js");
const R = require("../../js/calendar-reminders-logic.js");

const ZONE = "America/New_York";
const at = (date, time) => C.wallToInstant(date, time, ZONE);
const NOW = at("2026-11-04", "10:20");           // Wednesday, 10:20 AM, after the clocks changed on 1 Nov
const MIN = 60000;
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
const frozen = (x) => { if (x && typeof x === "object" && !Object.isFrozen(x)) { Object.freeze(x); Object.values(x).forEach(frozen); } return x; };
const N = (o) => C.notifySettings(o);

test("notification settings: in-app on, everything else off until you turn it on; odd values fall back", () => {
  assert.deepEqual(C.notifySettings(null), { inApp: true, system: false, hideTitles: false, allDayAt: "09:00", quiet: { enabled: false, start: "22:00", end: "07:00" } });
  const s = C.notifySettings({ inApp: false, system: "yes", hideTitles: 1, allDayAt: "8am", quiet: { enabled: true, start: "23:30", end: "23:30" } });
  assert.equal(s.inApp, false); assert.equal(s.system, false, "only a real true counts"); assert.equal(s.hideTitles, false);
  assert.equal(s.allDayAt, "09:00");
  assert.deepEqual(s.quiet, { enabled: true, start: "22:00", end: "07:00" }, "the same time twice would be no hours or all of them");
  assert.deepEqual(C.notifySettings({ system: true, quiet: { enabled: true, start: "21:00", end: "06:30" } }).quiet, { enabled: true, start: "21:00", end: "06:30" });
  assert.deepEqual(C.settings({ notify: { system: true } }).notify.system, true, "and kept inside the calendar settings");
});

test("when a reminder comes due: timed, all-day, and whole days before", () => {
  const timed = { allDay: false, startMs: at("2026-11-04", "15:00"), endMs: at("2026-11-04", "16:00"), date: "2026-11-04" };
  assert.equal(R.fireAtFor(timed, 30, N(), ZONE), at("2026-11-04", "14:30"));
  assert.equal(R.fireAtFor(timed, 0, N(), ZONE), at("2026-11-04", "15:00"));
  assert.equal(R.fireAtFor(timed, 1440, N(), ZONE), at("2026-11-03", "15:00"), "1 day before is the same time the day before");
  const allDay = { allDay: true, date: "2026-11-06", endDate: "2026-11-06" };
  assert.equal(R.fireAtFor(allDay, 0, N(), ZONE), at("2026-11-06", "09:00"), "all-day: counted from 9 AM, the time you can change");
  assert.equal(R.fireAtFor(allDay, 60, N(), ZONE), at("2026-11-06", "08:00"));
  assert.equal(R.fireAtFor(allDay, 1440, N({ allDayAt: "18:30" }), ZONE), at("2026-11-05", "18:30"));
  assert.equal(R.fireAtFor(allDay, 60, N({ allDayAt: "18:30" }), ZONE), at("2026-11-06", "17:30"), "and an hour before counts from the time you chose, not from 9 AM");
  assert.equal(R.fireAtFor({ allDay: false, startMs: NaN }, 10, N(), ZONE), null, "nothing to count from, no reminder");
  // across the clock change on Sunday 1 Nov 2026 (EDT -> EST): 9 AM the day before is still 9 AM
  const sunday = { allDay: false, startMs: at("2026-11-01", "09:00"), endMs: at("2026-11-01", "10:00"), date: "2026-11-01" };
  assert.equal(R.fireAtFor(sunday, 1440, N(), ZONE), at("2026-10-31", "09:00"));
  assert.notEqual(R.fireAtFor(sunday, 1440, N(), ZONE), sunday.startMs - 1440 * MIN, "not a flat 24 hours, which would be 10 AM");
});

test("quiet hours: held until they end, across midnight, and dropped if the event is over by then", () => {
  const q = N({ quiet: { enabled: true, start: "22:00", end: "07:00" } });
  assert.equal(R.inQuiet(at("2026-11-04", "23:30"), q, ZONE), true);
  assert.equal(R.inQuiet(at("2026-11-05", "06:59"), q, ZONE), true);
  assert.equal(R.inQuiet(at("2026-11-05", "07:00"), q, ZONE), false, "quiet hours end at the end time");
  assert.equal(R.inQuiet(at("2026-11-04", "21:59"), q, ZONE), false);
  assert.equal(R.inQuiet(at("2026-11-04", "23:30"), N(), ZONE), false, "off means off");
  assert.equal(R.quietEnd(at("2026-11-04", "23:30"), q, ZONE), at("2026-11-05", "07:00"), "before midnight: ends tomorrow morning");
  assert.equal(R.quietEnd(at("2026-11-05", "03:00"), q, ZONE), at("2026-11-05", "07:00"), "after midnight: ends this morning");
  const same = N({ quiet: { enabled: true, start: "13:00", end: "15:00" } });
  assert.equal(R.inQuiet(at("2026-11-04", "14:00"), same, ZONE), true);
  assert.equal(R.quietEnd(at("2026-11-04", "14:00"), same, ZONE), at("2026-11-04", "15:00"));
  // an 8 AM event with a 1 hour reminder at 7 isn't held; a 6:30 AM one is held to 7, and is still ongoing then
  const events = build([ev("Early", "2026-11-05", "06:30", "07:30", { reminders: [60] }), ev("Breakfast", "2026-11-05", "08:00", "09:00", { reminders: [60] }), ev("Brief", "2026-11-05", "06:30", "06:45", { reminders: [60] })]);
  const list = R.entries(events, { zone: ZONE, notify: q, from: NOW, to: NOW + 48 * 3600000 });
  const by = Object.fromEntries(list.map((e) => [e.title, e]));
  assert.equal(by.Early.held, true); assert.equal(by.Early.deliverAt, at("2026-11-05", "07:00"));
  assert.equal(by.Early.fireAt, at("2026-11-05", "05:30"), "the original moment is kept");
  assert.equal(by.Breakfast.held, false); assert.equal(by.Breakfast.deliverAt, at("2026-11-05", "07:00"));
  assert.equal(by.Brief, undefined, "over by the time quiet hours end: not shown late");
});

test("the list of reminders: each showing of a repeating event, every offset, never done or deleted ones", () => {
  const events = build([
    ev("Standup", "2026-11-04", "09:00", "09:30", { reminders: [10, 0], repeat: { freq: "daily", interval: 1 } }),
    ev("Done", "2026-11-05", "10:00", "11:00", { reminders: [10], completed: true }),
    ev("No reminders", "2026-11-05", "10:00", "11:00"),
    ev("Holiday", "2026-11-06", "", "", { allDay: true, reminders: [0, 1440] })
  ]);
  const gone = build([ev("Deleted", "2026-11-05", "12:00", "13:00", { reminders: [5] })]);
  const removed = C.remove(gone, gone[0].id, ctx()).events;
  const list = R.entries(events.concat(removed), { zone: ZONE, notify: N(), from: NOW, to: NOW + 3 * 86400000 });
  const order = (s) => s.slice().sort((x, y) => { const k = (q) => q.split("@")[1]; return k(x) < k(y) ? -1 : k(x) > k(y) ? 1 : x < y ? -1 : 1; });
  const names = list.map((e) => e.title + "#" + e.offset + "@" + new Date(e.deliverAt).toISOString().slice(0, 16));
  assert.deepEqual(order(names), order([
    "Holiday#1440@2026-11-05T14:00",    // 9 AM the day before (EST = UTC-5)
    "Standup#10@2026-11-05T13:50", "Standup#0@2026-11-05T14:00",
    "Holiday#0@2026-11-06T14:00",
    "Standup#10@2026-11-06T13:50", "Standup#0@2026-11-06T14:00",
    "Standup#10@2026-11-07T13:50", "Standup#0@2026-11-07T14:00"
  ]), "a repeating event has its own reminders each time; done and deleted ones have none");
  assert.ok(list.every((e, i) => i === 0 || list[i - 1].deliverAt <= e.deliverAt), "in the order they come due");
  assert.ok(list.every((e) => e.deliverAt >= NOW && e.deliverAt <= NOW + 3 * 86400000), "only inside the window asked for");
  assert.equal(list.find((e) => e.title === "Holiday" && e.offset === 0).allDay, true);
});

test("due now, missed while closed, still ahead; seen ones stay quiet; snoozing; expiry", () => {
  const events = build([
    ev("Call", "2026-11-04", "10:30", "11:00", { reminders: [10, 5] }),       // 10:20 (due now) and 10:25
    ev("Missed one", "2026-11-04", "11:30", "12:30", { reminders: [60] }),     // 10:30
    ev("Earlier", "2026-11-04", "09:40", "10:30", { reminders: [30] }),        // 09:10: an hour+ ago, still going on
    ev("Over", "2026-11-04", "08:00", "09:00", { reminders: [15] }),           // 07:45: and it is over
    ev("Tomorrow", "2026-11-05", "09:00", "10:00", { reminders: [0] })
  ]);
  const base = { zone: ZONE, notify: N(), log: {} };
  const p = R.plan(events, Object.assign({ now: NOW }, base));
  assert.deepEqual(p.due.map((e) => e.title + "#" + e.offset), ["Call#10"], "right on time");
  assert.deepEqual(p.missed.map((e) => e.title), ["Earlier"], "came due earlier while JARVIS wasn't open, and the event is still going on");
  assert.deepEqual(p.upcoming.map((e) => e.title + "#" + e.offset), ["Call#5", "Missed one#60", "Tomorrow#0"]);
  assert.equal(p.next, at("2026-11-04", "10:25"));
  assert.equal(p.due.concat(p.missed, p.upcoming).some((e) => e.title === "Over"), false, "nothing for an event that is already over");
  // a minute and a half late is still "due"; three minutes late is "missed"
  assert.equal(R.plan(events, Object.assign({ now: NOW + 90000 }, base)).due.length, 1);
  assert.deepEqual(R.plan(events, Object.assign({ now: NOW + 3 * MIN }, base)).missed.map((e) => e.title + "#" + e.offset), ["Earlier#30", "Call#10"]);
  // shown ones stay quiet
  const call10 = p.due[0];
  let log = R.markShown({}, call10.key, NOW, "app");
  assert.deepEqual(R.plan(events, { now: NOW, zone: ZONE, notify: N(), log }).due, [], "shown once, not shown again");
  // snooze 10 minutes: quiet, then due again
  log = R.snooze({}, call10.key, NOW, 10);
  assert.equal(R.plan(events, { now: NOW + 5 * MIN, zone: ZONE, notify: N(), log }).due.some((e) => e.key === call10.key), false);
  const back = R.plan(events, { now: NOW + 10 * MIN, zone: ZONE, notify: N(), log });
  assert.ok(back.due.some((e) => e.key === call10.key && e.snoozed === true), "due again when the snooze ends, and marked as a snoozed one");
  // after the event itself is over, a snoozed one is dropped
  assert.equal(R.plan(events, { now: at("2026-11-04", "11:05"), zone: ZONE, notify: N(), log: R.snooze({}, call10.key, at("2026-11-04", "10:55"), 5) }).due.length, 0);
});

test("an event saved after its reminder's moment had passed was never 'missed'; a snooze you chose still comes back", () => {
  // made at 10:20 for 10:25 with "10 minutes before" (10:15, already past) and "1 minute before" (10:24, still ahead)
  const made = build([ev("Quick one", "2026-11-04", "10:25", "10:45", { reminders: [10, 1] })]);
  made[0] = Object.assign({}, made[0], { updatedAt: NOW });
  const p = R.plan(made, { now: NOW + 30000, zone: ZONE, notify: N(), log: {} });
  assert.deepEqual([p.due, p.missed], [[], []], "nothing is reported for the 10:15 one: you were in JARVIS when you saved it");
  assert.deepEqual(p.upcoming.map((e) => e.offset), [1], "the one still ahead is kept");
  // the same event saved long before: the 10:15 one came due while JARVIS wasn't open
  const old = build([ev("Quick one", "2026-11-04", "10:25", "10:45", { reminders: [10, 1] })]);
  assert.deepEqual(R.plan(old, { now: NOW + 30000, zone: ZONE, notify: N(), log: {} }).missed.map((e) => e.offset), [10]);
  // a snooze you chose is honoured even on an event saved after the original moment
  const key = made[0].id + "@2026-11-04#10";
  const snoozed = R.plan(made, { now: NOW + 70000, zone: ZONE, notify: N(), log: R.snooze({}, key, NOW, 1) });   // the snooze ended 10 seconds ago
  assert.deepEqual(snoozed.due.concat(snoozed.missed).map((e) => e.offset), [10]);
});

test("the log: shown, snoozed (up to an hour), pruned, and anything damaged is ignored", () => {
  assert.deepEqual(R.markShown({}, "a#0", 100, "system"), { "a#0": { at: 100, via: "system" } });
  assert.deepEqual(R.snooze({}, "a#0", 100, 10, "app"), { "a#0": { at: 100, via: "app", snoozeUntil: 100 + 600000 } });
  const l = { x: { at: 1, via: "app" } };
  assert.equal(R.snooze(l, "x", 5, 0), l, "no zero-minute snooze");
  assert.equal(R.snooze(l, "x", 5, 61), l, "and none over an hour");
  assert.equal(R.snooze(l, "x", 5, "soon"), l);
  const now = 100 * 86400000;
  const big = {}; for (let i = 0; i < 600; i++) big["k" + i] = { at: now - i * 1000, via: "app" };
  big.old = { at: now - 15 * 86400000, via: "app" };
  const kept = R.prune(big, now);
  assert.equal(Object.keys(kept).length, 500, "never more than 500");
  assert.equal(kept.old, undefined, "nothing older than two weeks");
  assert.ok(kept.k0 && !kept.k599, "the newest are kept");
  assert.deepEqual(R.sanitizeLog({ ok: { at: 5, via: "app" }, bad: { at: "x" }, worse: 7, odd: { at: 9, via: "who", snoozeUntil: -3 } }), { ok: { at: 5, via: "app" }, odd: { at: 9, via: "seen" } });
  assert.deepEqual(R.sanitizeLog(null), {}); assert.deepEqual(R.sanitizeLog([1, 2]), {});
});

test("what is said: timing words, and the lock screen can hide the title", () => {
  const e = { title: "Client call", itemKey: "e1@2026-11-04", key: "e1@2026-11-04#30", allDay: false, startMs: at("2026-11-04", "15:00") };
  assert.equal(R.whenLine(e, at("2026-11-04", "14:30"), ZONE), "Starts in 30 minutes · 3:00 PM");
  assert.equal(R.whenLine(e, at("2026-11-04", "14:59"), ZONE), "Starts in 1 minute · 3:00 PM");
  assert.equal(R.whenLine(e, at("2026-11-04", "15:00"), ZONE), "Starting now · 3:00 PM");
  assert.equal(R.whenLine(e, at("2026-11-04", "15:10"), ZONE), "Started 10 minutes ago · 3:00 PM");
  assert.equal(R.whenLine(e, at("2026-11-03", "14:00"), ZONE), "Starts in 1 day · 3:00 PM Wed, Nov 4", "a day ahead says which day");
  const all = { allDay: true, date: "2026-11-05", endDate: "2026-11-05" };
  assert.equal(R.whenLine(all, NOW, ZONE), "All day tomorrow");
  assert.equal(R.whenLine(Object.assign({}, all, { date: "2026-11-04" }), NOW, ZONE), "All day today");
  const n = R.notificationFor(e, N(), at("2026-11-04", "14:30"), ZONE);
  assert.deepEqual([n.title, n.body, n.tag, n.data.kind, n.data.id], ["Client call", "Starts in 30 minutes · 3:00 PM", "cal:e1@2026-11-04#30", "calendar", "e1@2026-11-04"]);
  assert.match(n.data.url, /^\.\/index\.html\?calReminder=e1%402026-11-04$/);
  const hidden = R.notificationFor(e, N({ hideTitles: true }), at("2026-11-04", "14:30"), ZONE);
  assert.deepEqual([hidden.title, hidden.body], ["JARVIS", "You have something coming up."]);
  assert.ok(!JSON.stringify(hidden).includes("Client call"), "the name is nowhere in what is handed to the notification");
});

test("honest status: says what is on and what isn't, and never promises delivery while JARVIS is closed", () => {
  const on = R.status({ supported: true, permission: "granted", ios: false, standalone: false }, N({ system: true }));
  assert.equal(on.system.state, "on"); assert.match(on.system.text, /while JARVIS is open/);
  assert.equal(R.status({ supported: true, permission: "granted" }, N()).system.state, "allowed-off");
  const ask = R.status({ supported: true, permission: "default" }, N());
  assert.equal(ask.system.state, "not-asked"); assert.equal(ask.system.canAsk, true);
  const blocked = R.status({ supported: true, permission: "denied" }, N({ system: true }));
  assert.equal(blocked.system.state, "blocked"); assert.equal(blocked.system.canAsk, false);
  const ios = R.status({ supported: true, permission: "default", ios: true, standalone: false }, N());
  assert.equal(ios.system.state, "needs-home-screen"); assert.equal(ios.system.canAsk, false);
  assert.equal(R.status({ supported: true, permission: "default", ios: true, standalone: true }, N()).system.canAsk, true);
  assert.equal(R.status({ supported: false }, N()).system.state, "unsupported");
  assert.match(on.closed, /only while it is open/); assert.match(on.closed, /missed/); assert.match(on.closed, /not sent to your phone by the server/);
  assert.match(on.closed, /Habits reminders are different/);
  assert.match(R.status({ supported: true, permission: "default" }, N({ inApp: false })).inApp, /^Off/);
  for (const st of [on, ask, blocked, ios]) assert.ok(!/even when (JARVIS|the app) is closed|works when closed/i.test(JSON.stringify(st)), "no promise of closed-app delivery");
});

test("nothing here changes what it is given", () => {
  const events = frozen(build([ev("Call", "2026-11-04", "10:30", "11:00", { reminders: [10, 5] })]));
  const log = frozen({ x: { at: 1, via: "app" } });
  const notify = frozen(N({ quiet: { enabled: true, start: "22:00", end: "07:00" } }));
  const p = R.plan(events, { now: NOW, zone: ZONE, notify, log });
  R.markShown(log, "a", 1, "app"); R.snooze(log, "a", 1, 5); R.prune(log, 5); R.sanitizeLog(log);
  R.notificationFor(p.due[0], notify, NOW, ZONE); R.status({ supported: true }, notify);
});
