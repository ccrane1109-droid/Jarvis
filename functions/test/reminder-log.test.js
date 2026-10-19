"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const events = require("../lib/reminder-events");
const log = require("../lib/reminder-log");
const delivery = require("../lib/delivery");
const reminders = require("../lib/reminders");
const push = require("../lib/push");
const { OWNER, fakeDb, fakeWebPush, deps } = require("./helpers");

const P256 = "B".repeat(87);
const AUTH = "a".repeat(22);
const APPLE = "https://web.push.apple.com/phone-one";
const eventDocs = (d) => [...d.db.store.entries()].filter(([k]) => k.startsWith(`users/${OWNER}/reminderEvents/`)).map(([k, v]) => Object.assign({ key: k }, v));

async function world(start) {
  const state = { now: new Date(start || "2026-10-14T11:00:00Z") }; // 7:00 AM in New York
  const wp = fakeWebPush();
  const d = deps({ now: () => state.now, webpush: wp, vapidPublic: "PUBKEY".padEnd(20, "x"), vapidPrivate: "PRIVKEY".padEnd(20, "y"), db: fakeDb() });
  await push.handle(OWNER, { action: "subscribe", subscription: { endpoint: APPLE, keys: { p256dh: P256, auth: AUTH } } }, d, async () => {});
  const at = (iso) => { state.now = new Date(iso); };
  const tick = () => delivery.runTick(OWNER, d);
  const make = async (over) => (await reminders.handle(OWNER, { action: "create", reminder: Object.assign({
    title: "Creatine", category: "creatine", notes: "", schedule: { type: "daily", times: ["08:00"], days: [], date: null }
  }, over || {}) }, d)).reminder;
  const act = (data) => log.handle(OWNER, Object.assign({ action: "act" }, data), d);
  const recent = (days) => log.handle(OWNER, { action: "events", days }, d);
  return { d, wp, state, at, tick, make, act, recent };
}
const idOf = (r, iso) => events.eventIdFor(r.id, iso);
const sends = (wp) => wp.calls.map((c) => JSON.parse(c.payload));
const rejects = (p, code, re) => assert.rejects(p, (e) => (!code || e.code === code) && (!re || re.test(e.message)));

/* ---------------- the shared rules ---------------- */

test("an event name can be turned back into its moment", () => {
  const id = events.eventIdFor("0123456789abcdef", "2026-10-14T12:00:00.000Z");
  assert.equal(id, "0123456789abcdef_20261014120000000");
  assert.equal(events.reminderIdOf(id), "0123456789abcdef");
  assert.equal(events.momentOf(id), "2026-10-14T12:00:00.000Z");
  for (const bad of ["", null, 5, "test_abc", "0123456789abcdef_2026", "0123456789abcdeg_20261014120000000", "0123456789abcdef_20261399120000000"]) {
    assert.equal(events.momentOf(bad), null, String(bad));
  }
  assert.equal(events.isMomentIso("2026-10-14T12:00:00.000Z"), true);
  assert.equal(events.isMomentIso("2026-10-14T12:00:00Z"), false);
  assert.equal(events.isMomentIso("2026-10-14"), false);
});

test("stateOf names where each record stands", () => {
  const now = Date.parse("2026-10-14T12:30:00Z");
  const s = (e) => events.stateOf(Object.assign({ kind: "reminder", status: "sent", outcome: null, snoozedUntil: null }, e), now);
  assert.equal(s({}), "awaiting");
  assert.equal(s({ outcome: "done" }), "done");
  assert.equal(s({ outcome: "skipped", status: "cancelled" }), "skipped");
  assert.equal(s({ outcome: "done", snoozedUntil: "2026-10-14T13:00:00.000Z", status: "queued" }), "done", "an answer beats everything");
  assert.equal(s({ status: "queued", snoozedUntil: "2026-10-14T12:40:00.000Z" }), "snoozed");
  assert.equal(s({ status: "queued", snoozedUntil: "2026-10-14T12:10:00.000Z" }), "sending", "a snooze that has come due is just waiting to be sent");
  assert.equal(s({ status: "queued" }), "sending");
  for (const st of ["missed", "failed", "no-device", "cancelled"]) assert.equal(s({ status: st }), st);
  assert.equal(s({ kind: "test" }), "test");
  assert.equal(events.stateOf(null, now), "none");
});

test("dayView counts what is done, skipped, snoozed, open and still to come", () => {
  const now = Date.parse("2026-10-14T16:00:00Z"); // noon in New York
  const mk = (id, title, times, over) => Object.assign({ id, title, category: "custom", timezone: "America/New_York", enabled: true, updatedAt: "2026-10-01T00:00:00.000Z", today: times }, over || {});
  const A = "aaaaaaaaaaaaaaaa", B = "bbbbbbbbbbbbbbbb", C = "cccccccccccccccc", D = "dddddddddddddddd";
  const rs = [
    mk(A, "Creatine", ["2026-10-14T12:00:00.000Z"]),
    mk(B, "Water", ["2026-10-14T13:00:00.000Z", "2026-10-14T15:00:00.000Z", "2026-10-14T17:00:00.000Z", "2026-10-14T21:00:00.000Z"]),
    mk(C, "Off", ["2026-10-14T13:00:00.000Z"], { enabled: false }),
    mk(D, "New today", ["2026-10-14T10:00:00.000Z", "2026-10-14T20:00:00.000Z"], { updatedAt: "2026-10-14T14:00:00.000Z" })
  ];
  const ev = (r, iso, over) => Object.assign({ id: idOf(r, iso), kind: "reminder", reminderId: r.id, status: "sent", outcome: null, scheduledFor: iso }, over);
  const evs = [
    ev({ id: A }, "2026-10-14T12:00:00.000Z", { outcome: "done", outcomeAt: "2026-10-14T12:03:00.000Z" }),
    ev({ id: B }, "2026-10-14T13:00:00.000Z", { outcome: "skipped" }),
    ev({ id: B }, "2026-10-14T15:00:00.000Z", { status: "queued", snoozedUntil: "2026-10-14T16:15:00.000Z" }),
    { id: "test_x", kind: "test", status: "sent", scheduledFor: "2026-10-14T15:30:00.000Z" }
  ];
  const v = events.dayView(rs, evs, now);
  assert.deepEqual(v.items.map((i) => [i.title, i.state]), [
    ["Creatine", "done"], ["Water", "skipped"], ["Water", "snoozed"], ["Water", "upcoming"], ["New today", "upcoming"], ["Water", "upcoming"]
  ]);
  assert.deepEqual(v.items.map((i) => i.scheduledFor), [
    "2026-10-14T12:00:00.000Z", "2026-10-14T13:00:00.000Z", "2026-10-14T15:00:00.000Z", "2026-10-14T17:00:00.000Z", "2026-10-14T20:00:00.000Z", "2026-10-14T21:00:00.000Z"
  ], "soonest first; the turned-off reminder, the test and the moment before the reminder was made are all left out");
  assert.deepEqual(v.counts, { done: 1, skipped: 1, snoozed: 1, open: 0, upcoming: 3, total: 6 });
  assert.equal(v.percent, 20, "done out of what wasn't deliberately skipped: 1 of 5");
  assert.deepEqual(v.open, []);
});

test("a passed moment with no answer is open, whether it was sent, missed, or not sent yet", () => {
  const now = Date.parse("2026-10-14T20:00:00Z");
  const r = { id: "aaaaaaaaaaaaaaaa", title: "Water", category: "water", timezone: "America/New_York", enabled: true, updatedAt: "2026-10-01T00:00:00.000Z",
    today: ["2026-10-14T13:00:00.000Z", "2026-10-14T15:00:00.000Z", "2026-10-14T17:00:00.000Z", "2026-10-14T19:59:30.000Z"] };
  const evs = [
    { id: idOf(r, r.today[0]), kind: "reminder", reminderId: r.id, status: "sent", outcome: null, scheduledFor: r.today[0] },
    { id: idOf(r, r.today[1]), kind: "reminder", reminderId: r.id, status: "missed", outcome: null, scheduledFor: r.today[1] }
  ];
  const v = events.dayView([r], evs, now);
  assert.deepEqual(v.items.map((i) => i.state), ["awaiting", "missed", "due", "due"]);
  assert.equal(v.counts.open, 4);
  assert.equal(v.percent, 0);
  assert.equal(v.open.length, 4);
  assert.equal(events.dayView([], [], now).percent, null, "nothing to measure is not 0%");
  assert.equal(events.dayView([{ id: "aaaaaaaaaaaaaaaa", title: "x", enabled: true, today: ["2026-10-14T23:00:00.000Z"] }], [{ id: idOf({ id: "aaaaaaaaaaaaaaaa" }, "2026-10-14T23:00:00.000Z"), kind: "reminder", status: "cancelled", outcome: "skipped" }], now).percent, null, "everything skipped: nothing left to measure");
});

test("summarize counts each reminder over the window and leaves out tests and fresh unanswered ones", () => {
  const now = Date.parse("2026-10-14T20:00:00Z");
  const e = (rid, iso, over) => Object.assign({ id: rid + "_" + iso, kind: "reminder", reminderId: rid, title: rid === "a".repeat(16) ? "Creatine" : "Water", category: "custom", status: "sent", outcome: null, scheduledFor: iso }, over);
  const A = "a".repeat(16), B = "b".repeat(16);
  const evs = [
    e(A, "2026-10-12T12:00:00.000Z", { outcome: "done" }), e(A, "2026-10-13T12:00:00.000Z", { outcome: "done" }), e(A, "2026-10-14T12:00:00.000Z"),
    e(B, "2026-10-13T15:00:00.000Z", { outcome: "skipped" }), e(B, "2026-10-14T19:45:00.000Z"), e(B, "2026-10-14T15:00:00.000Z", { status: "missed" }),
    e(B, "2026-10-14T21:00:00.000Z", { status: "queued", snoozedUntil: "2026-10-14T21:00:00.000Z" }),
    { id: "test_1", kind: "test", reminderId: null, status: "sent", scheduledFor: "2026-10-14T19:00:00.000Z" }
  ];
  const s = events.summarize(evs, now);
  const by = Object.fromEntries(s.reminders.map((x) => [x.title, x]));
  assert.deepEqual([by.Creatine.done, by.Creatine.open, by.Creatine.pending, by.Creatine.skipped, by.Creatine.percent], [2, 1, 0, 0, 67]);
  assert.deepEqual([by.Water.done, by.Water.open, by.Water.pending, by.Water.skipped, by.Water.percent], [0, 1, 1, 1, 0], "the 7:45 one went out 15 minutes ago, so it is pending, not open");
  assert.deepEqual(s.all, { done: 2, skipped: 1, open: 2, pending: 1, total: 6, percent: 50 });
});

/* ---------------- done, skip, undo ---------------- */

test("marking a sent reminder done records your answer and nothing else changes", async () => {
  const w = await world();
  const r = await w.make();
  w.at("2026-10-14T12:00:05Z");
  await w.tick();
  const id = idOf(r, "2026-10-14T12:00:00.000Z");
  assert.equal(eventDocs(w.d)[0].outcome, null, "sending a reminder never answers it");

  w.at("2026-10-14T12:03:00Z");
  const res = await w.act({ eventId: id, choice: "done" });
  assert.deepEqual([res.ok, res.removed, res.event.outcome, res.event.state, res.event.status, res.event.outcomeAt], [true, false, "done", "done", "sent", "2026-10-14T12:03:00.000Z"]);
  assert.deepEqual(w.wp.calls.length, 1, "no extra notification");

  // Done twice is fine; skipping afterwards changes your answer.
  assert.equal((await w.act({ eventId: id, choice: "done" })).event.state, "done");
  assert.equal((await w.act({ eventId: id, choice: "skip" })).event.state, "skipped");

  const undone = await w.act({ eventId: id, choice: "undo" });
  assert.deepEqual([undone.event.outcome, undone.event.outcomeAt, undone.event.state], [null, null, "awaiting"]);
  await rejects(w.act({ eventId: id, choice: "undo" }), "failed-precondition", /nothing to undo/);
});

test("the delivery run never marks anything done, medication included", async () => {
  const w = await world();
  await w.make({ title: "Morning pill", category: "medication", privateText: true, schedule: { type: "daily", times: ["08:00", "20:00"], days: [], date: null } });
  await w.make({ title: "Water", category: "water", schedule: { type: "daily", times: ["09:00"], days: [], date: null } });
  for (const iso of ["2026-10-14T12:00:30Z", "2026-10-14T13:00:30Z", "2026-10-15T00:00:30Z", "2026-10-15T12:00:30Z"]) { w.at(iso); await w.tick(); }
  const docs = eventDocs(w.d);
  assert.equal(docs.length, 4);
  for (const e of docs) assert.deepEqual([e.outcome, e.outcomeAt, e.snoozeCount, e.snoozedUntil], [null, null, 0, null], e.key);
  const meds = sends(w.wp).filter((p) => p.title === "Medication reminder");
  assert.equal(meds.length, 3);
  assert.ok(meds.every((p) => p.body === "Open JARVIS to see it."), "the lock screen stays generic");
});

test("done on a reminder that is waiting to be sent stops it from being sent", async () => {
  const w = await world();
  const r = await w.make();
  // Quiet hours hold the 8:00 reminder until 9:00; marking it done before then cancels it.
  await reminders.handle(OWNER, { action: "saveSettings", settings: { timezone: "America/New_York", quiet: { enabled: true, start: "07:30", end: "09:00" } } }, w.d);
  await reminders.handle(OWNER, { action: "update", id: r.id, reminder: { title: "Creatine", category: "creatine", schedule: r.schedule, respectQuietHours: true } }, w.d);
  w.at("2026-10-14T12:00:10Z");
  await w.tick();
  assert.equal(w.wp.calls.length, 0, "held");
  const id = idOf(r, "2026-10-14T12:00:00.000Z");
  assert.equal(eventDocs(w.d)[0].status, "queued");
  const res = await w.act({ eventId: id, choice: "done" });
  assert.deepEqual([res.event.state, res.event.status], ["done", "cancelled"]);
  w.at("2026-10-14T13:05:00Z");
  await w.tick();
  assert.equal(w.wp.calls.length, 0, "nothing sent after it was marked done");
});

/* ---------------- snooze ---------------- */

test("snooze sends the same reminder again later, replacing the first", async () => {
  const w = await world();
  const r = await w.make();
  w.at("2026-10-14T12:00:05Z");
  await w.tick();
  const id = idOf(r, "2026-10-14T12:00:00.000Z");
  w.at("2026-10-14T12:05:00Z");
  const res = await w.act({ eventId: id, choice: "snooze", minutes: 10 });
  assert.deepEqual([res.event.state, res.event.status, res.event.snoozedUntil, res.event.snoozeCount], ["snoozed", "queued", "2026-10-14T12:15:00.000Z", 1]);

  w.at("2026-10-14T12:14:30Z");
  await w.tick();
  assert.equal(w.wp.calls.length, 1, "not yet");
  w.at("2026-10-14T12:15:20Z");
  const s = await w.tick();
  assert.equal(s.sent, 1);
  const [first, second] = sends(w.wp);
  assert.deepEqual([second.title, second.tag, second.id], [first.title, first.tag, first.id], "same tag, so the new one replaces the old on the lock screen");
  const e = eventDocs(w.d)[0];
  assert.deepEqual([e.status, e.sendDue, e.snoozeCount, e.attempts, e.outcome], ["sent", null, 1, 1, null]);
  assert.equal((await log.handle(OWNER, { action: "event", eventId: id }, w.d)).event.state, "awaiting", "after the snooze goes off it waits for your answer again");

  // It can be snoozed again, and finally answered.
  assert.equal((await w.act({ eventId: id, choice: "snooze", minutes: 5 })).event.snoozeCount, 2);
  assert.equal((await w.act({ eventId: id, choice: "done" })).event.state, "done");
  w.at("2026-10-14T12:30:00Z");
  await w.tick();
  assert.equal(w.wp.calls.length, 2, "a done reminder is never sent again, even if it was snoozed");
});

test("snooze only accepts the offered lengths, stops after six, and won't override an answer", async () => {
  const w = await world();
  const r = await w.make();
  w.at("2026-10-14T12:00:05Z");
  await w.tick();
  const id = idOf(r, "2026-10-14T12:00:00.000Z");
  for (const bad of [0, 1, 7, 61, 120, -5, "ten", null, undefined, NaN]) await rejects(w.act({ eventId: id, choice: "snooze", minutes: bad }), "invalid-argument", /5, 10, 15, 30 or 60/);
  for (let i = 0; i < events.MAX_SNOOZES; i++) await w.act({ eventId: id, choice: "snooze", minutes: events.SNOOZE_MINUTES[i % 5] });
  await rejects(w.act({ eventId: id, choice: "snooze", minutes: 5 }), "resource-exhausted", /snoozed this 6 times/);
  await w.act({ eventId: id, choice: "done" });
  await rejects(w.act({ eventId: id, choice: "snooze", minutes: 5 }), "failed-precondition", /already marked done/);
});

test("a snooze that is later than the 30-minute limit is still sent on time", async () => {
  const w = await world();
  const r = await w.make();
  w.at("2026-10-14T12:00:05Z");
  await w.tick();
  const id = idOf(r, "2026-10-14T12:00:00.000Z");
  await w.act({ eventId: id, choice: "snooze", minutes: 60 });
  w.at("2026-10-14T13:00:40Z");
  const s = await w.tick();
  assert.deepEqual([s.sent, s.missed], [1, 0], "lateness is measured from the snooze time, not the original time");
});

test("a missed reminder can be snoozed to try again", async () => {
  const w = await world();
  const r = await w.make();
  w.at("2026-10-14T12:00:00Z");
  w.wp.sendNotification = async () => { throw Object.assign(new Error("down"), { statusCode: 503 }); };
  for (let i = 0; i < 4; i++) { await w.tick(); w.at(new Date(w.state.now.getTime() + 150000).toISOString()); }
  const id = idOf(r, "2026-10-14T12:00:00.000Z");
  assert.equal(eventDocs(w.d)[0].status, "failed");
  w.wp.sendNotification = async (sub, payload, options) => { w.wp.calls.push({ payload, options }); return { statusCode: 201 }; };
  const res = await w.act({ eventId: id, choice: "snooze", minutes: 5 });
  assert.equal(res.event.state, "snoozed");
  w.at(new Date(w.state.now.getTime() + 6 * 60000).toISOString());
  assert.equal((await w.tick()).sent, 1);
  assert.equal(eventDocs(w.d)[0].status, "sent");
});

/* ---------------- done before the time ---------------- */

test("done early: the reminder doesn't go off, and the day after is normal", async () => {
  const w = await world("2026-10-14T11:30:00Z");
  const r = await w.make();
  const moment = "2026-10-14T12:00:00.000Z";
  const res = await w.act({ reminderId: r.id, scheduledFor: moment, choice: "done" });
  assert.deepEqual([res.event.state, res.event.status, res.event.outcome, res.removed], ["done", "cancelled", "done", false]);
  assert.equal(res.event.id, idOf(r, moment));

  w.at("2026-10-14T12:00:10Z");
  const s = await w.tick();
  assert.deepEqual([s.claimed, s.sent], [1, 0], "the moment is used up, but nothing is sent");
  assert.equal(w.wp.calls.length, 0);
  assert.equal(eventDocs(w.d).length, 1, "still one record for that moment");
  assert.equal(w.d.db.store.get(`users/${OWNER}/reminders/${r.id}`).nextFireAt, "2026-10-15T12:00:00.000Z");

  w.at("2026-10-15T12:00:10Z");
  assert.equal((await w.tick()).sent, 1, "tomorrow's reminder is unaffected");
});

test("undoing an early done before the time puts the reminder back to normal", async () => {
  const w = await world("2026-10-14T11:30:00Z");
  const r = await w.make();
  const moment = "2026-10-14T12:00:00.000Z";
  await w.act({ reminderId: r.id, scheduledFor: moment, choice: "done" });
  const undone = await w.act({ eventId: idOf(r, moment), choice: "undo" });
  assert.deepEqual([undone.event, undone.removed], [null, true]);
  assert.equal(eventDocs(w.d).length, 0);
  w.at("2026-10-14T12:00:10Z");
  assert.equal((await w.tick()).sent, 1);
});

test("skip early works the same way, and only real moments of an enabled reminder are accepted", async () => {
  const w = await world("2026-10-14T11:30:00Z");
  const r = await w.make({ schedule: { type: "daily", times: ["08:00", "20:00"], days: [], date: null } });
  const skipped = await w.act({ reminderId: r.id, scheduledFor: "2026-10-15T00:00:00.000Z", choice: "skip" });
  assert.deepEqual([skipped.event.state, skipped.event.outcome], ["skipped", "skipped"]);
  await rejects(w.act({ reminderId: r.id, scheduledFor: "2026-10-14T12:05:00.000Z", choice: "done" }), "failed-precondition", /isn't a moment/);
  await rejects(w.act({ reminderId: r.id, scheduledFor: "2026-10-10T12:00:00.000Z", choice: "done" }), "failed-precondition", /isn't a moment/);
  await rejects(w.act({ reminderId: r.id, scheduledFor: "2026-10-20T12:00:00.000Z", choice: "done" }), "failed-precondition", /isn't a moment/);
  await rejects(w.act({ reminderId: "f".repeat(16), scheduledFor: "2026-10-14T12:00:00.000Z", choice: "done" }), "not-found");
  await reminders.handle(OWNER, { action: "setEnabled", id: r.id, enabled: false }, w.d);
  await rejects(w.act({ reminderId: r.id, scheduledFor: "2026-10-14T12:00:00.000Z", choice: "done" }), "failed-precondition", /turned off/);
  await rejects(w.act({ reminderId: r.id, scheduledFor: "2026-10-14T12:00:00.000Z", choice: "snooze", minutes: 5 }), "failed-precondition");
});

test("a moment the delivery run hasn't reached yet can be marked done, and the run then leaves it alone", async () => {
  const w = await world("2026-10-14T11:30:00Z");
  const r = await w.make();
  w.at("2026-10-14T12:00:20Z"); // 8:00 has come, but the once-a-minute run hasn't looked yet
  const res = await w.act({ reminderId: r.id, scheduledFor: "2026-10-14T12:00:00.000Z", choice: "done" });
  assert.deepEqual([res.event.state, res.event.status], ["done", "cancelled"]);
  const s = await w.tick();
  assert.deepEqual([s.claimed, s.sent], [1, 0]);
  assert.equal(w.wp.calls.length, 0);
  assert.equal(w.d.db.store.get(`users/${OWNER}/reminders/${r.id}`).nextFireAt, "2026-10-15T12:00:00.000Z");
});

test("marking done while the delivery run claims the same moment never sends twice or loses the answer", async () => {
  for (const order of ["act-first", "tick-first", "together"]) {
    const w = await world("2026-10-14T11:59:50Z");
    const r = await w.make();
    const moment = "2026-10-14T12:00:00.000Z";
    const doAct = () => w.act({ reminderId: r.id, scheduledFor: moment, choice: "done" });
    if (order === "act-first") { await doAct(); w.at("2026-10-14T12:00:05Z"); await w.tick(); }
    else if (order === "tick-first") { w.at("2026-10-14T12:00:05Z"); await w.tick(); await doAct(); }
    else { w.at("2026-10-14T12:00:05Z"); await Promise.all([doAct().catch(() => null), w.tick()]); }
    const docs = eventDocs(w.d);
    assert.equal(docs.length, 1, order);
    assert.ok(w.wp.calls.length <= 1, order);
    if (order !== "together") assert.equal(docs[0].outcome, "done", order);
  }
});

/* ---------------- reading, and who may call ---------------- */

test("events returns the recent records newest first, including ones scheduled ahead", async () => {
  const w = await world("2026-10-14T11:30:00Z");
  const r = await w.make({ schedule: { type: "daily", times: ["08:00", "20:00"], days: [], date: null } });
  w.at("2026-10-14T12:00:05Z"); await w.tick();
  w.at("2026-10-14T23:00:00Z"); await w.act({ reminderId: r.id, scheduledFor: "2026-10-15T00:00:00.000Z", choice: "done" });
  const res = await w.recent();
  assert.equal(res.ok, true);
  assert.deepEqual(res.events.map((e) => e.scheduledFor), ["2026-10-15T00:00:00.000Z", "2026-10-14T12:00:00.000Z"]);
  assert.deepEqual(res.events.map((e) => e.state), ["done", "awaiting"]);
  assert.equal(res.events[1].title, "Creatine");
  assert.equal(res.days, 14);
  assert.equal(res.truncated, false);

  assert.equal((await w.recent(1)).events.length, 2);
  assert.equal((await w.recent(0)).days, 14, "an unusable number falls back to the default");
  assert.equal((await w.recent(9999)).days, 60, "and a huge one is capped");
  const old = idOf(r, "2026-09-01T12:00:00.000Z");
  w.d.db.store.set(`users/${OWNER}/reminderEvents/${old}`, { kind: "reminder", reminderId: r.id, title: "Old", scheduledFor: "2026-09-01T12:00:00.000Z", status: "sent" });
  assert.equal((await w.recent(14)).events.length, 2, "older than the window is not returned");
  assert.equal((await w.recent(60)).events.length, 3);
});

test("a record's browser copy carries only what the page needs and never the push details", async () => {
  const w = await world();
  const r = await w.make({ title: "Pill", category: "medication", privateText: true });
  w.at("2026-10-14T12:00:05Z"); await w.tick();
  const e = (await w.recent()).events[0];
  assert.equal(e.title, "Pill", "in the app the real name shows, even when the lock screen's is hidden");
  assert.deepEqual(Object.keys(e).sort(), ["category", "deliverAt", "id", "kind", "lastError", "outcome", "outcomeAt", "reminderId", "scheduledFor", "sentAt", "snoozeCount", "snoozedUntil", "state", "status", "timezone", "title"]);
  assert.ok(!JSON.stringify(e).includes("endpoint") && !JSON.stringify(e).includes("lockBody"));
});

test("event looks up one record, and says null when there isn't one", async () => {
  const w = await world();
  const r = await w.make();
  w.at("2026-10-14T12:00:05Z"); await w.tick();
  const id = idOf(r, "2026-10-14T12:00:00.000Z");
  assert.equal((await log.handle(OWNER, { action: "event", eventId: id }, w.d)).event.title, "Creatine");
  assert.equal((await log.handle(OWNER, { action: "event", eventId: idOf(r, "2026-10-15T12:00:00.000Z") }, w.d)).event, null);
  await rejects(log.handle(OWNER, { action: "event", eventId: "nope" }, w.d), "invalid-argument");
});

test("test notifications can't be answered, bad input is refused, and only the owner may call", async () => {
  const w = await world();
  await w.make();
  await push.handle(OWNER, { action: "test", delaySeconds: 90 }, w.d, delivery.queueEvent);
  const testId = eventDocs(w.d)[0].key.split("/").pop();
  assert.match(testId, /^test_/);
  await rejects(w.act({ eventId: testId, choice: "done" }), "invalid-argument", /test notification/);
  for (const bad of [{}, { choice: "done" }, { eventId: 5, choice: "done" }, { eventId: "x_y", choice: "done" }, { reminderId: "zz", scheduledFor: "2026-10-14T12:00:00.000Z", choice: "done" },
    { reminderId: "a".repeat(16), scheduledFor: "2026-10-14", choice: "done" }, { eventId: idOf({ id: "a".repeat(16) }, "2026-10-14T12:00:00.000Z"), choice: "erase" }, { eventId: idOf({ id: "a".repeat(16) }, "2026-10-14T12:00:00.000Z") }]) {
    await rejects(w.act(bad), "invalid-argument");
  }
  await rejects(log.handle("someone-else", { action: "events" }, w.d), "permission-denied");
  await rejects(log.handle(undefined, { action: "events" }, w.d), "unauthenticated");
  await rejects(log.handle(OWNER, { action: "wipe" }, w.d), "invalid-argument");
  await rejects(log.handle(OWNER, null, w.d), "invalid-argument");
});

test("the reminders function routes answer actions here and storage actions to the storage module", () => {
  assert.deepEqual(log.ACTIONS, ["act", "event", "events"]);
});
