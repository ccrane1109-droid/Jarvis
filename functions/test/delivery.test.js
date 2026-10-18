"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { DateTime } = require("luxon");
const delivery = require("../lib/delivery");
const reminders = require("../lib/reminders");
const push = require("../lib/push");
const { OWNER, fakeDb, fakeWebPush, deps } = require("./helpers");

const P256 = "B".repeat(87);
const AUTH = "a".repeat(22);
const APPLE = "https://web.push.apple.com/phone-one";
const eventsOf = (d) => [...d.db.store.entries()].filter(([k]) => k.startsWith(`users/${OWNER}/reminderEvents/`)).map(([k, v]) => Object.assign({ key: k }, v));
const reminderDoc = (d, id) => d.db.store.get(`users/${OWNER}/reminders/${id}`);

// A world with a movable clock, a fake push service, and (by default) one phone turned on.
async function world(opts) {
  opts = opts || {};
  const state = { now: new Date(opts.start || "2026-10-14T11:00:00Z") };
  const wp = fakeWebPush(opts.answer);
  const d = deps({
    now: () => state.now, webpush: wp, vapidPublic: opts.noKeys ? "" : "PUBKEY".padEnd(20, "x"), vapidPrivate: opts.noKeys ? "" : "PRIVKEY".padEnd(20, "y"),
    db: opts.db || fakeDb()
  });
  if (opts.phone !== false) await push.handle(OWNER, { action: "subscribe", subscription: { endpoint: APPLE, keys: { p256dh: P256, auth: AUTH } } }, d, async () => {});
  const tick = () => delivery.runTick(OWNER, d);
  const at = (iso) => { state.now = new Date(iso); };
  const make = async (over) => (await reminders.handle(OWNER, { action: "create", reminder: Object.assign({
    title: "Creatine", category: "creatine", notes: "", schedule: { type: "daily", times: ["08:00"], days: [], date: null }
  }, over || {}) }, d)).reminder;
  return { d, wp, state, tick, at, make };
}
const sentTitles = (wp) => wp.calls.map((c) => JSON.parse(c.payload).title);

test("a reminder that has come due is claimed, sent once, and moved on to its next moment", async () => {
  const w = await world({ start: "2026-10-14T11:00:00Z" }); // 7:00 AM in New York
  const r = await w.make({ schedule: { type: "daily", times: ["08:00"], days: [], date: null }, notes: "with water" });
  assert.equal(r.nextFireAt, "2026-10-14T12:00:00.000Z");

  w.at("2026-10-14T11:59:30Z");
  assert.deepEqual(await w.tick(), { claimed: 0, sent: 0, missed: 0, retry: 0, failed: 0, noDevice: 0 });
  assert.equal(w.wp.calls.length, 0, "not due yet");

  w.at("2026-10-14T12:00:05Z");
  const s = await w.tick();
  assert.deepEqual([s.claimed, s.sent], [1, 1]);
  assert.equal(w.wp.calls.length, 1);
  const p = JSON.parse(w.wp.calls[0].payload);
  assert.deepEqual([p.title, p.body, p.kind, p.tag], ["Creatine", "with water", "reminder", p.id]);
  assert.equal(p.id, delivery.eventIdFor(r.id, "2026-10-14T12:00:00.000Z"));
  assert.equal(w.wp.calls[0].options.topic, push.topicFor(p.id));

  const doc = reminderDoc(w.d, r.id);
  assert.deepEqual([doc.nextFireAt, doc.lastFiredAt], ["2026-10-15T12:00:00.000Z", "2026-10-14T12:00:00.000Z"]);
  const ev = eventsOf(w.d);
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].status, ev[0].accepted, ev[0].devices, ev[0].attempts, ev[0].sendDue, ev[0].sentAt, ev[0].title, ev[0].reminderId],
    ["sent", 1, 1, 1, null, "2026-10-14T12:00:05.000Z", "Creatine", r.id]);

  // The same minute again, and the minutes after: nothing more is sent.
  await w.tick();
  w.at("2026-10-14T12:01:05Z");
  await w.tick();
  assert.equal(w.wp.calls.length, 1);
  assert.equal(eventsOf(w.d).length, 1);
});

test("two runs at the same instant send it once", async () => {
  const w = await world();
  await w.make();
  w.at("2026-10-14T12:00:02Z");
  const results = await Promise.all([w.tick(), w.tick(), w.tick()]);
  assert.equal(w.wp.calls.length, 1, "one push, however many runs overlap");
  assert.equal(results.reduce((n, r) => n + r.claimed, 0), 1);
  assert.equal(eventsOf(w.d).length, 1);
});

test("if a run died after recording the moment but before sending, the next run still sends it, once", async () => {
  const w = await world();
  const r = await w.make();
  // Simulate: the event exists and is queued, but the reminder was not moved on.
  const id = delivery.eventIdFor(r.id, r.nextFireAt);
  w.d.db.store.set(`users/${OWNER}/reminderEvents/${id}`, {
    kind: "reminder", reminderId: r.id, category: "creatine", title: "Creatine", lockTitle: "Creatine", lockBody: "Reminder from JARVIS",
    scheduledFor: r.nextFireAt, deliverAt: r.nextFireAt, sendDue: r.nextFireAt, status: "queued", attempts: 0, createdAt: r.nextFireAt
  });
  w.at("2026-10-14T12:00:20Z");
  const s = await w.tick();
  assert.deepEqual([s.claimed, s.sent, w.wp.calls.length], [1, 1, 1]);
  assert.equal(eventsOf(w.d).length, 1, "no second event for the same moment");
  assert.equal(reminderDoc(w.d, r.id).nextFireAt, "2026-10-15T12:00:00.000Z");
  w.at("2026-10-14T12:05:00Z");
  await w.tick();
  assert.equal(w.wp.calls.length, 1);
});

test("a moment that was already sent is never sent again, even if the reminder is still marked due", async () => {
  const w = await world();
  const r = await w.make();
  const id = delivery.eventIdFor(r.id, r.nextFireAt);
  w.d.db.store.set(`users/${OWNER}/reminderEvents/${id}`, { kind: "reminder", reminderId: r.id, status: "sent", sendDue: null, scheduledFor: r.nextFireAt, deliverAt: r.nextFireAt });
  w.at("2026-10-14T12:00:20Z");
  const s = await w.tick();
  assert.deepEqual([s.claimed, s.sent, w.wp.calls.length], [1, 0, 0]);
  assert.equal(reminderDoc(w.d, r.id).nextFireAt, "2026-10-15T12:00:00.000Z", "it is still moved on");
});

test("a reminder more than 30 minutes late is marked missed, not sent, and the next one is still scheduled", async () => {
  const w = await world();
  const r = await w.make();
  w.at("2026-10-14T13:00:00Z"); // an hour after 8:00, say the server was down
  const s = await w.tick();
  assert.deepEqual([s.claimed, s.missed, s.sent, w.wp.calls.length], [1, 1, 0, 0]);
  const ev = eventsOf(w.d)[0];
  assert.deepEqual([ev.status, ev.sendDue], ["missed", null]);
  assert.match(ev.lastError, /30 minutes late/);
  assert.equal(reminderDoc(w.d, r.id).nextFireAt, "2026-10-15T12:00:00.000Z");

  // 29 minutes late is still sent.
  const w2 = await world();
  await w2.make();
  w2.at("2026-10-14T12:29:00Z");
  assert.equal((await w2.tick()).sent, 1);
});

test("a long outage doesn't make up a backlog: each reminder is claimed once and the rest wait their turn", async () => {
  const w = await world();
  const r = await w.make({ schedule: { type: "daily", times: ["08:00", "12:00", "16:00"], days: [], date: null } });
  w.at("2026-10-17T20:00:00Z"); // three days later
  const s = await w.tick();
  assert.deepEqual([s.claimed, s.missed, s.sent], [1, 1, 0]);
  assert.equal(reminderDoc(w.d, r.id).nextFireAt, "2026-10-18T12:00:00.000Z", "next is tomorrow's 8:00 AM, not three days of catching up");
});

test("a one-time reminder fires once and then has nothing left", async () => {
  const w = await world();
  const r = await w.make({ title: "Call supplier", category: "business", schedule: { type: "once", times: ["09:00"], days: [], date: "2026-10-14" } });
  w.at("2026-10-14T13:00:30Z");
  assert.equal((await w.tick()).sent, 1);
  assert.equal(reminderDoc(w.d, r.id).nextFireAt, null);
  w.at("2026-10-15T13:00:30Z");
  await w.tick();
  assert.equal(w.wp.calls.length, 1);
});

test("turned-off reminders never fire, and turning one back on doesn't replay the past", async () => {
  const w = await world();
  const r = await w.make();
  await reminders.handle(OWNER, { action: "setEnabled", id: r.id, enabled: false }, w.d);
  w.at("2026-10-14T12:00:30Z");
  assert.equal((await w.tick()).claimed, 0);
  w.at("2026-10-14T20:00:00Z");
  await reminders.handle(OWNER, { action: "setEnabled", id: r.id, enabled: true }, w.d);
  assert.equal(reminderDoc(w.d, r.id).nextFireAt, "2026-10-15T12:00:00.000Z");
  await w.tick();
  assert.equal(w.wp.calls.length, 0);
});

test("with no phone set up, it is recorded as such and the reminder still moves on", async () => {
  const w = await world({ phone: false });
  const r = await w.make();
  w.at("2026-10-14T12:00:05Z");
  const s = await w.tick();
  assert.deepEqual([s.claimed, s.noDevice, s.sent], [1, 1, 0]);
  const ev = eventsOf(w.d)[0];
  assert.deepEqual([ev.status, ev.devices], ["no-device", 0]);
  assert.match(ev.lastError, /No phone was set up/);
  assert.equal(reminderDoc(w.d, r.id).nextFireAt, "2026-10-15T12:00:00.000Z");
});

test("a push service hiccup is retried after 2 minutes, up to 3 tries, then recorded as failed", async () => {
  const w = await world({ answer: () => ({ error: { statusCode: 503 } }) });
  await w.make();
  w.at("2026-10-14T12:00:05Z");
  let s = await w.tick();
  assert.deepEqual([s.sent, s.retry], [0, 1]);
  let ev = eventsOf(w.d)[0];
  assert.deepEqual([ev.status, ev.attempts, ev.sendDue], ["queued", 1, "2026-10-14T12:02:05.000Z"]);
  assert.match(ev.lastError, /503/);

  w.at("2026-10-14T12:01:05Z");
  assert.equal((await w.tick()).retry, 0, "not before the retry time");
  w.at("2026-10-14T12:02:06Z");
  s = await w.tick();
  assert.equal(s.retry, 1);
  w.at("2026-10-14T12:04:10Z");
  s = await w.tick();
  assert.deepEqual([s.failed, s.retry], [1, 0]);
  ev = eventsOf(w.d)[0];
  assert.deepEqual([ev.status, ev.attempts, ev.sendDue], ["failed", 3, null]);
  assert.equal(w.wp.calls.length, 3);
});

test("a retry that succeeds is recorded as sent, once", async () => {
  const answers = [{ error: { statusCode: 500 } }, { statusCode: 201 }];
  const w = await world({ answer: answers });
  await w.make();
  w.at("2026-10-14T12:00:05Z");
  await w.tick();
  w.at("2026-10-14T12:02:10Z");
  const s = await w.tick();
  assert.equal(s.sent, 1);
  assert.deepEqual([eventsOf(w.d)[0].status, eventsOf(w.d)[0].attempts, eventsOf(w.d)[0].lastError], ["sent", 2, null]);
  w.at("2026-10-14T12:10:00Z");
  await w.tick();
  assert.equal(w.wp.calls.length, 2);
});

test("a phone that has gone away is forgotten and the reminder is recorded as failed, not retried forever", async () => {
  const w = await world({ answer: () => ({ error: { statusCode: 410 } }) });
  await w.make();
  w.at("2026-10-14T12:00:05Z");
  const s = await w.tick();
  assert.deepEqual([s.failed, s.retry], [1, 0]);
  assert.match(eventsOf(w.d)[0].lastError, /permission has gone away/);
  assert.equal((await push.listSubscriptions(w.d, OWNER)).length, 0);
});

test("with two phones, one accepting is enough; the dead one is dropped", async () => {
  const w = await world({ answer: (s) => (s.endpoint.endsWith("old") ? { error: { statusCode: 410 } } : { statusCode: 201 }) });
  await push.handle(OWNER, { action: "subscribe", subscription: { endpoint: "https://web.push.apple.com/old", keys: { p256dh: P256, auth: AUTH } } }, w.d, async () => {});
  await w.make();
  w.at("2026-10-14T12:00:05Z");
  assert.equal((await w.tick()).sent, 1);
  const ev = eventsOf(w.d)[0];
  assert.deepEqual([ev.devices, ev.accepted, ev.status], [2, 1, "sent"]);
  assert.deepEqual((await push.listSubscriptions(w.d, OWNER)).map((s) => s.endpoint), [APPLE]);
});

test("a reminder with a private name shows only its category on the lock screen", async () => {
  const w = await world();
  await w.make({ title: "Lisinopril 10mg", category: "medication", notes: "after breakfast" });
  w.at("2026-10-14T12:00:05Z");
  await w.tick();
  const p = JSON.parse(w.wp.calls[0].payload);
  assert.deepEqual([p.title, p.body], ["Medication reminder", "Open JARVIS to see it."]);
  assert.ok(!w.wp.calls[0].payload.includes("Lisinopril") && !w.wp.calls[0].payload.includes("breakfast"));
  assert.equal(eventsOf(w.d)[0].title, "Lisinopril 10mg", "the real name is kept for the history in the app");
});

test("quiet hours hold only the reminders that opted in, until quiet hours end", async () => {
  const w = await world({ start: "2026-10-14T20:00:00Z" });
  await reminders.handle(OWNER, { action: "saveSettings", settings: { timezone: "America/New_York", quiet: { enabled: true, start: "22:00", end: "07:00" } } }, w.d);
  await w.make({ title: "Opted in", respectQuietHours: true, schedule: { type: "daily", times: ["23:30"], days: [], date: null } });
  await w.make({ title: "Everything sends", schedule: { type: "daily", times: ["23:30"], days: [], date: null } });
  await w.make({ title: "Morning meds", category: "medication", schedule: { type: "daily", times: ["23:30"], days: [], date: null } });
  w.at("2026-10-15T03:30:05Z"); // 11:30 PM in New York
  const s = await w.tick();
  assert.deepEqual([s.claimed, s.sent], [3, 2]);
  assert.deepEqual(sentTitles(w.wp).sort(), ["Everything sends", "Medication reminder"]);
  const held = eventsOf(w.d).find((e) => e.title === "Opted in");
  assert.deepEqual([held.status, held.deliverAt, held.sendDue], ["queued", "2026-10-15T11:00:00.000Z", "2026-10-15T11:00:00.000Z"]); // 7:00 AM
  w.at("2026-10-15T10:59:00Z");
  await w.tick();
  assert.equal(w.wp.calls.length, 2, "still held at 6:59 AM");
  w.at("2026-10-15T11:00:10Z");
  assert.equal((await w.tick()).sent, 1);
  assert.equal(sentTitles(w.wp).pop(), "Opted in");
});

test("without the notification keys nothing is claimed, so no moment is used up", async () => {
  const w = await world({ noKeys: true, phone: false });
  const r = await w.make();
  w.at("2026-10-14T12:00:05Z");
  const s = await w.tick();
  assert.match(s.skipped, /keys aren't set up/);
  assert.equal(reminderDoc(w.d, r.id).nextFireAt, "2026-10-14T12:00:00.000Z");
  assert.equal(eventsOf(w.d).length, 0);
});

test("the 90-second test goes through the real queue and the real run", async () => {
  const w = await world({ start: "2026-10-14T15:00:00Z" });
  const res = await push.handle(OWNER, { action: "test", delaySeconds: 90 }, w.d, delivery.queueEvent);
  assert.equal(res.mode, "scheduled");
  const ev = eventsOf(w.d)[0];
  assert.deepEqual([ev.kind, ev.status, ev.sendDue, ev.reminderId, ev.lockTitle], ["test", "queued", "2026-10-14T15:01:30.000Z", null, "JARVIS test"]);
  assert.ok(!("id" in ev), "no undefined or extra fields are stored");
  w.at("2026-10-14T15:01:00Z");
  await w.tick();
  assert.equal(w.wp.calls.length, 0);
  w.at("2026-10-14T15:01:31Z");
  assert.equal((await w.tick()).sent, 1);
  assert.equal(JSON.parse(w.wp.calls[0].payload).kind, "test");
  assert.equal(eventsOf(w.d)[0].status, "sent");
});

test("only 25 are handled per run; the rest are picked up on the next one", async () => {
  const w = await world();
  for (let i = 0; i < 30; i++) await w.make({ title: "R" + i });
  w.at("2026-10-14T12:00:05Z");
  let s = await w.tick();
  assert.deepEqual([s.claimed, s.sent], [25, 25]);
  w.at("2026-10-14T12:01:05Z");
  s = await w.tick();
  assert.deepEqual([s.claimed, s.sent], [5, 5]);
  assert.equal(w.wp.calls.length, 30);
});

test("nothing secret is ever stored, logged or returned", async () => {
  const w = await world();
  await w.make();
  w.at("2026-10-14T12:00:05Z");
  await w.tick();
  const text = JSON.stringify([...w.d.db.store.entries()].filter(([k]) => !k.includes("pushSubscriptions"))) + JSON.stringify(w.d.logs);
  assert.ok(!text.includes("PRIVKEY") && !text.includes(AUTH) && !text.includes(P256));
});

/* ---------------- minute by minute across the clock changes ---------------- */

// Runs the once-a-minute job for every minute in a window and returns when each reminder was sent.
async function simulate(zone, fromLocal, hours, specs) {
  const w = await world({ start: DateTime.fromISO(fromLocal, { zone }).minus({ minutes: 5 }).toUTC().toISO() });
  const created = [];
  for (const s of specs) created.push(await w.make(Object.assign({ timezone: zone }, s)));
  const sends = {};
  let t = DateTime.fromISO(fromLocal, { zone }).toUTC();
  const end = t.plus({ hours: hours });
  while (t < end) {
    w.at(t.toISO());
    const before = w.wp.calls.length;
    await w.tick();
    for (let i = before; i < w.wp.calls.length; i++) {
      const title = JSON.parse(w.wp.calls[i].payload).title;
      (sends[title] = sends[title] || []).push(t.toISO());
    }
    t = t.plus({ minutes: 1 });
  }
  return { sends, w, created };
}
const daily = (title, time) => ({ title, schedule: { type: "daily", times: [time], days: [], date: null } });

test("across the spring clock change in New York every reminder fires exactly once a day, at the right moment", async () => {
  const { sends } = await simulate("America/New_York", "2026-03-07T00:00:00", 72, [daily("Early", "01:30"), daily("Gap", "02:30"), daily("Morning", "08:00"), daily("Evening", "20:00")]);
  assert.deepEqual(sends.Early, ["2026-03-07T06:30:00.000Z", "2026-03-08T06:30:00.000Z", "2026-03-09T05:30:00.000Z"]);
  assert.deepEqual(sends.Gap, ["2026-03-07T07:30:00.000Z", "2026-03-08T07:30:00.000Z", "2026-03-09T06:30:00.000Z"], "2:30 AM doesn't exist on the 8th: it goes at 3:30 AM");
  assert.deepEqual(sends.Morning, ["2026-03-07T13:00:00.000Z", "2026-03-08T12:00:00.000Z", "2026-03-09T12:00:00.000Z"]);
  assert.deepEqual(sends.Evening, ["2026-03-08T01:00:00.000Z", "2026-03-09T00:00:00.000Z", "2026-03-10T00:00:00.000Z"]);
});

test("across the autumn clock change a time that happens twice fires once, and nothing is missed", async () => {
  const { sends } = await simulate("America/New_York", "2026-10-31T00:00:00", 72, [daily("Twice", "01:30"), daily("Morning", "08:00")]);
  assert.deepEqual(sends.Twice, ["2026-10-31T05:30:00.000Z", "2026-11-01T05:30:00.000Z", "2026-11-02T06:30:00.000Z"], "1:30 AM on the 1st is sent at its first occurrence only");
  assert.deepEqual(sends.Morning, ["2026-10-31T12:00:00.000Z", "2026-11-01T13:00:00.000Z", "2026-11-02T13:00:00.000Z"]);
});

test("weekly and one-time reminders hold up across a clock change too, in another country", async () => {
  const { sends } = await simulate("Europe/London", "2026-03-27T00:00:00", 96, [
    { title: "Sat-Sun", schedule: { type: "weekly", times: ["09:00"], days: [0, 6], date: null } },
    { title: "Once", category: "business", schedule: { type: "once", times: ["09:00"], days: [], date: "2026-03-29" } }
  ]);
  assert.deepEqual(sends["Sat-Sun"], ["2026-03-28T09:00:00.000Z", "2026-03-29T08:00:00.000Z"], "UK clocks change on the 29th: 9:00 is 08:00 UTC after it");
  assert.deepEqual(sends.Once, ["2026-03-29T08:00:00.000Z"]);
});
