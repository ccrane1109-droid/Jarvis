"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const spec = require("../lib/reminder-spec");
const reminders = require("../lib/reminders");
const insight = require("../lib/insight");
const { OWNER, fakeDb, deps } = require("./helpers");

const NOW = new Date("2026-10-14T15:00:00Z"); // 11 AM in New York
const base = (over) => Object.assign({
  title: "Drink water", category: "water", notes: "",
  schedule: { type: "daily", times: ["09:00", "13:00", "17:00"], days: [], date: null }
}, over || {});
const call = (d, data, uid) => reminders.handle(uid === undefined ? OWNER : uid, data, d);
const stored = (d) => [...d.db.store.keys()].filter((k) => k.startsWith(`users/${OWNER}/reminders/`));

/* ---------------- rules shared with the page ---------------- */

test("a valid reminder is cleaned and only the editable fields come through", () => {
  const r = spec.sanitizeReminder({
    title: "  Take\u0000   my  <b>creatine</b>\n", category: "creatine", notes: "with water",
    schedule: { type: "daily", times: ["8:05", "20:00", "08:05", "7:30"], days: [3], date: "2026-10-20" },
    id: "evil", nextFireAt: "2030-01-01T00:00:00.000Z", createdAt: "x", lastFiredAt: "y", enabled: false, timezone: " Europe/London "
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    title: "Take my bcreatine/b", category: "creatine", notes: "with water", enabled: false,
    schedule: { type: "daily", times: ["07:30", "08:05", "20:00"], days: [], date: null },
    timezone: "Europe/London", privateText: false, respectQuietHours: false
  });
  assert.ok(!("id" in r.value) && !("nextFireAt" in r.value) && !("createdAt" in r.value) && !("lastFiredAt" in r.value));
});

test("bad reminders are refused with a plain reason", () => {
  const err = (raw) => spec.sanitizeReminder(raw).error;
  assert.match(err(null), /category/);
  assert.match(err({ category: "nope", schedule: {} }), /category/);
  assert.match(err({ category: "custom", title: "   ", schedule: { type: "daily", times: ["09:00"] } }), /name/);
  assert.match(err(base({ schedule: { type: "monthly", times: ["09:00"] } })), /daily, weekly or one time/);
  assert.match(err(base({ schedule: { type: "daily", times: [] } })), /at least one time/);
  assert.match(err(base({ schedule: { type: "daily", times: ["25:00"] } })), /isn't valid/);
  assert.match(err(base({ schedule: { type: "daily", times: ["09:00", "9am"] } })), /isn't valid/);
  assert.match(err(base({ schedule: { type: "daily", times: Array.from({ length: 13 }, (_, i) => ("0" + i).slice(-2) + ":00") } })), /up to 12/);
  assert.match(err(base({ schedule: { type: "weekly", times: ["09:00"], days: [] } })), /day of the week/);
  assert.match(err(base({ schedule: { type: "weekly", times: ["09:00"], days: [7, -1, "1", 1.5] } })), /day of the week/);
  assert.match(err(base({ schedule: { type: "once", times: ["09:00"], date: "2026-02-30" } })), /date/);
  assert.match(err(base({ schedule: { type: "once", times: ["09:00", "10:00"], date: "2026-10-20" } })), /single time/);
});

test("a preset category prefills the title, and medication hides the name on the lock screen by default", () => {
  const water = spec.sanitizeReminder(base({ title: "" }));
  assert.equal(water.value.title, "Drink water");
  const meds = spec.sanitizeReminder({ title: "Morning pills", category: "medication", schedule: { type: "daily", times: ["07:30"] } });
  assert.equal(meds.value.privateText, true);
  assert.equal(spec.sanitizeReminder({ title: "Morning pills", category: "medication", privateText: false, schedule: { type: "daily", times: ["07:30"] } }).value.privateText, false, "your choice wins");
  assert.equal(spec.sanitizeReminder(base()).value.privateText, false);
  assert.equal(spec.sanitizeReminder(base()).value.respectQuietHours, false, "everything sends unless you opt a reminder in");
});

test("settings are cleaned; schedules read in plain English; water times can be generated", () => {
  assert.deepEqual(spec.sanitizeSettings(null), { timezone: "America/New_York", quiet: { enabled: false, start: "22:00", end: "07:00" } });
  assert.deepEqual(spec.sanitizeSettings({ timezone: " Europe/Paris ", quiet: { enabled: true, start: "23:30", end: "bad" } }),
    { timezone: "Europe/Paris", quiet: { enabled: true, start: "23:30", end: "07:00" } });
  assert.equal(spec.describeSchedule({ type: "daily", times: ["07:30", "20:00"] }), "Every day at 7:30 AM and 8:00 PM");
  assert.equal(spec.describeSchedule({ type: "daily", times: ["00:00", "12:00", "13:15"] }), "Every day at 12:00 AM, 12:00 PM and 1:15 PM");
  assert.equal(spec.describeSchedule({ type: "weekly", times: ["18:00"], days: [1, 2, 3, 4, 5] }), "Weekdays at 6:00 PM");
  assert.equal(spec.describeSchedule({ type: "weekly", times: ["18:00"], days: [1, 3] }), "Mon, Wed at 6:00 PM");
  assert.equal(spec.describeSchedule({ type: "once", times: ["09:00"], date: "2026-10-20" }), "Once on 2026-10-20 at 9:00 AM");
  assert.deepEqual(spec.timesEvery("09:00", "19:00", 2), ["09:00", "11:00", "13:00", "15:00", "17:00", "19:00"]);
  assert.deepEqual(spec.timesEvery("09:00", "10:00", 0.5), ["09:00", "09:30", "10:00"]);
  assert.deepEqual(spec.timesEvery("19:00", "09:00", 2), []);
  assert.deepEqual(spec.timesEvery("09:00", "19:00", 0), []);
  assert.equal(spec.timesEvery("00:00", "23:00", 1).length, 12, "never more than the 12-time limit");
});

/* ---------------- storage and management ---------------- */

test("create saves a reminder and works out when it is next due", async () => {
  const d = deps({ now: () => NOW });
  const res = await call(d, { action: "create", reminder: base() });
  assert.equal(res.ok, true);
  const r = res.reminder;
  assert.match(r.id, /^[a-f0-9]{16}$/);
  assert.equal(r.timezone, "America/New_York", "defaults to your saved zone");
  assert.equal(r.nextFireAt, "2026-10-14T17:00:00.000Z"); // 1 PM
  assert.deepEqual(r.upcoming, ["2026-10-14T17:00:00.000Z", "2026-10-14T21:00:00.000Z", "2026-10-15T13:00:00.000Z"]);
  assert.deepEqual(r.today, ["2026-10-14T13:00:00.000Z", "2026-10-14T17:00:00.000Z", "2026-10-14T21:00:00.000Z"]);
  const doc = d.db.store.get(`users/${OWNER}/reminders/${r.id}`);
  assert.deepEqual([doc.enabled, doc.lastFiredAt, doc.createdAt, doc.updatedAt], [true, null, NOW.toISOString(), NOW.toISOString()]);
  assert.equal(doc.nextFireAt, r.nextFireAt);
});

test("list returns everything, soonest first, disabled last, with the server's clock", async () => {
  const d = deps({ now: () => NOW });
  const a = (await call(d, { action: "create", reminder: base({ title: "Later", schedule: { type: "daily", times: ["20:00"] } }) })).reminder;
  const b = (await call(d, { action: "create", reminder: base({ title: "Sooner", schedule: { type: "daily", times: ["12:00"] } }) })).reminder;
  const c = (await call(d, { action: "create", reminder: base({ title: "Off", enabled: false }) })).reminder;
  const res = await call(d, { action: "list" });
  assert.deepEqual(res.reminders.map((r) => r.title), ["Sooner", "Later", "Off"]);
  assert.equal(res.reminders[2].nextFireAt, null);
  assert.deepEqual(res.reminders[2].upcoming, []);
  assert.equal(res.serverNow, NOW.toISOString());
  assert.equal(res.max, 100);
  assert.equal(res.settings.timezone, "America/New_York");
  assert.deepEqual([a.id, b.id, c.id].every((id) => res.reminders.some((r) => r.id === id)), true);
});

test("update changes the reminder, keeps its history fields, and recomputes the next time", async () => {
  let clock = NOW;
  const d = deps({ now: () => clock });
  const made = (await call(d, { action: "create", reminder: base() })).reminder;
  d.db.store.get(`users/${OWNER}/reminders/${made.id}`).lastFiredAt = "2026-10-13T21:00:00.000Z";
  clock = new Date("2026-10-14T16:00:00Z");
  const res = await call(d, { action: "update", id: made.id, reminder: base({ title: "Water bottle", notes: "Big one", schedule: { type: "weekly", times: ["08:00"], days: [3] } }) });
  assert.equal(res.reminder.title, "Water bottle");
  assert.equal(res.reminder.nextFireAt, "2026-10-21T12:00:00.000Z", "Wednesday 8 AM has passed, so next Wednesday");
  const doc = d.db.store.get(`users/${OWNER}/reminders/${made.id}`);
  assert.equal(doc.createdAt, NOW.toISOString());
  assert.equal(doc.updatedAt, clock.toISOString());
  assert.equal(doc.lastFiredAt, "2026-10-13T21:00:00.000Z");
  assert.equal(stored(d).length, 1);
  await assert.rejects(call(d, { action: "update", id: "0123456789abcdef", reminder: base() }), (e) => e.code === "not-found");
});

test("turning a reminder off clears its next time; turning it on works it out again", async () => {
  const d = deps({ now: () => NOW });
  const made = (await call(d, { action: "create", reminder: base() })).reminder;
  const off = await call(d, { action: "setEnabled", id: made.id, enabled: false });
  assert.deepEqual([off.reminder.enabled, off.reminder.nextFireAt], [false, null]);
  assert.equal(d.db.store.get(`users/${OWNER}/reminders/${made.id}`).nextFireAt, null, "a disabled reminder can never be picked up as due");
  const on = await call(d, { action: "setEnabled", id: made.id, enabled: true });
  assert.deepEqual([on.reminder.enabled, on.reminder.nextFireAt], [true, "2026-10-14T17:00:00.000Z"]);
  await assert.rejects(call(d, { action: "setEnabled", id: made.id, enabled: "yes" }), (e) => e.code === "invalid-argument");
});

test("a one-time reminder must be in the future, and can't be switched back on once it has passed", async () => {
  let clock = NOW;
  const d = deps({ now: () => clock });
  const sched = (date, t) => base({ schedule: { type: "once", times: [t], days: [], date: date } });
  await assert.rejects(call(d, { action: "create", reminder: sched("2026-10-14", "10:00") }), (e) => e.code === "invalid-argument" && /already passed/.test(e.message));
  await assert.rejects(call(d, { action: "create", reminder: sched("2026-10-13", "20:00") }), (e) => /already passed/.test(e.message));
  const made = (await call(d, { action: "create", reminder: sched("2026-10-14", "15:00") })).reminder;
  assert.equal(made.nextFireAt, "2026-10-14T19:00:00.000Z");
  await call(d, { action: "setEnabled", id: made.id, enabled: false });
  clock = new Date("2026-10-14T20:00:00Z");
  await assert.rejects(call(d, { action: "setEnabled", id: made.id, enabled: true }), (e) => /already passed/.test(e.message));
  // A disabled one-time reminder in the past can still be saved as disabled.
  const saved = await call(d, { action: "update", id: made.id, reminder: Object.assign(sched("2026-10-14", "15:00"), { enabled: false }) });
  assert.equal(saved.reminder.nextFireAt, null);
});

test("delete removes it, and deleting twice is harmless", async () => {
  const d = deps({ now: () => NOW });
  const made = (await call(d, { action: "create", reminder: base() })).reminder;
  const other = (await call(d, { action: "create", reminder: base({ title: "Keep me" }) })).reminder;
  assert.deepEqual(await call(d, { action: "delete", id: made.id }), { ok: true, id: made.id });
  assert.deepEqual(stored(d), [`users/${OWNER}/reminders/${other.id}`]);
  assert.equal((await call(d, { action: "delete", id: made.id })).ok, true);
  for (const bad of ["../x", "short", 5, null, "ZZZZZZZZZZZZZZZZ"]) {
    await assert.rejects(call(d, { action: "delete", id: bad }), (e) => e.code === "invalid-argument", String(bad));
  }
});

test("a time zone can be set per reminder; an unknown one is refused", async () => {
  const d = deps({ now: () => NOW });
  const london = (await call(d, { action: "create", reminder: base({ timezone: "Europe/London", schedule: { type: "daily", times: ["18:00"] } }) })).reminder;
  assert.equal(london.timezone, "Europe/London");
  assert.equal(london.nextFireAt, "2026-10-14T17:00:00.000Z"); // 6 PM BST
  await assert.rejects(call(d, { action: "create", reminder: base({ timezone: "Mars/Base" }) }), (e) => e.code === "invalid-argument" && /time zone/.test(e.message));
});

test("settings are saved; moving your zone can move every reminder, only when asked", async () => {
  const d = deps({ now: () => NOW });
  const made = (await call(d, { action: "create", reminder: base({ schedule: { type: "daily", times: ["18:00"] } }) })).reminder;
  assert.equal(made.nextFireAt, "2026-10-14T22:00:00.000Z");
  const saved = await call(d, { action: "saveSettings", settings: { timezone: "America/Los_Angeles", quiet: { enabled: true, start: "23:00", end: "06:30" } } });
  assert.deepEqual([saved.moved, saved.settings.timezone, saved.settings.quiet.start], [0, "America/Los_Angeles", "23:00"]);
  assert.equal((await call(d, { action: "list" })).reminders[0].timezone, "America/New_York", "existing reminders stay put by default");
  const moved = await call(d, { action: "saveSettings", settings: saved.settings, applyToAll: true });
  assert.equal(moved.moved, 1);
  const after = (await call(d, { action: "list" })).reminders[0];
  assert.deepEqual([after.timezone, after.nextFireAt], ["America/Los_Angeles", "2026-10-15T01:00:00.000Z"]); // 6 PM PDT
  assert.equal((await call(d, { action: "create", reminder: base() })).reminder.timezone, "America/Los_Angeles", "new reminders use the saved zone");
  await assert.rejects(call(d, { action: "saveSettings", settings: { timezone: "Nowhere/Land" } }), (e) => e.code === "invalid-argument");
});

test("only the owner can use it, and one account's reminders are separate from another's", async () => {
  const d = deps({ now: () => NOW });
  await assert.rejects(call(d, { action: "list" }, null), (e) => e.code === "unauthenticated");
  await assert.rejects(call(d, { action: "list" }, "intruder"), (e) => e.code === "permission-denied");
  await assert.rejects(call(d, { action: "create", reminder: base() }, "intruder"), (e) => e.code === "permission-denied");
  assert.equal(stored(d).length, 0);
  await assert.rejects(call(d, { action: "explode" }), (e) => e instanceof insight.InsightError && e.code === "invalid-argument");
  await assert.rejects(call(d, null), (e) => e.code === "invalid-argument");
});

test("the 100-reminder limit is enforced", async () => {
  const init = {};
  for (let i = 0; i < 100; i++) init[`users/${OWNER}/reminders/${("0000000000000000" + i.toString(16)).slice(-16)}`] = { title: "t" + i, enabled: true };
  const d = deps({ now: () => NOW, db: fakeDb(init) });
  await assert.rejects(call(d, { action: "create", reminder: base() }), (e) => e.code === "resource-exhausted");
});

test("no secrets or sensitive extras are stored", async () => {
  const d = deps({ now: () => NOW });
  await call(d, { action: "create", reminder: base({ category: "medication", title: "Morning pills", apiKey: "isk_live_x", dose: "10mg" }) });
  const text = JSON.stringify([...d.db.store.values()]);
  assert.ok(!text.includes("isk_live_x") && !text.includes("10mg"), "unknown fields are dropped");
});
