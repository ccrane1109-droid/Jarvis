"use strict";
// Moving the workout family (workouts, routines, programs, body weight, measurements, strength settings, your own exercises,
// favourite exercises) from the original shared document into the merge-based backup. What these tests protect:
//  - nothing from the old copy is lost, and nothing on the device is replaced by it: the two are combined, once
//  - the old copy is only ever read
//  - a workout saved on the device that never reached the cloud is not replaced by an older cloud copy
//  - two devices' workouts are both kept
// The Firestore here is an in-memory stand-in (see fake-firestore.js), not the real thing.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const B = require("../../js/cloud-backup");
const L = require("../../js/backup-logic");
const { createFakeFirestore, createFakeStorage, createFakeClock } = require("./fake-firestore");

const UID = "user-1";
const col = (id) => "users/" + UID + "/appData/" + id;
const LEGACY_PATH = "users/" + UID;
const WORKOUT_KEYS = L.LEGACY_KEYS;

const wk = (id, extra) => Object.assign({ id: id, schema: 2, dateTime: "2026-11-0" + (1 + (id.length % 7)) + "T18:00", date: "2026-11-0" + (1 + (id.length % 7)), exercises: [{ exerciseId: "bench", sets: [{ weight: 100, reps: 5, warmup: false, dropset: false }] }], notes: "", createdAt: 1000 + id.length }, extra || {});
const list = (...ids) => JSON.stringify(ids.map((id) => wk(id)));
const ids = (text) => JSON.parse(text).map((x) => (typeof x === "string" ? x : x.id)).sort();
const settle = () => new Promise((r) => setImmediate(r));

function setup(opts) {
  opts = opts || {};
  const cloud = opts.cloud || createFakeFirestore();
  const storage = opts.storage || createFakeStorage(opts.local || {});
  const clock = opts.clock || createFakeClock();
  const session = B.create({ fb: cloud.fb, db: {}, uid: opts.uid || UID, storage: storage, keys: opts.keys, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  return { cloud, storage, clock, session };
}
const legacyDoc = (cloud, store) => cloud.db.store.set(LEGACY_PATH, { store: store });
const legacySnapshot = (cloud) => JSON.stringify(cloud.db.store.get(LEGACY_PATH) || null);
const manifest = (cloud, key) => cloud.db.store.get(col(key));
const cloudText = (cloud, key) => {
  const m = manifest(cloud, key);
  if (!m) return null;
  const parts = {};
  for (let i = 0; i < m.parts; i++) parts[i] = cloud.db.store.get(col(L.partId(key, i))).text;
  const r = L.assemble(m, parts);
  assert.ok(r.ok, "cloud copy of " + key + " must be whole: " + r.reason);
  return r.text;
};

/* ---------------- the rules ---------------- */

test("the workout family is backed up, not in the original shared document, and never in both", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "js", "auth.js"), "utf8");
  const synced = src.match(/const SYNCED_KEYS = \[([\s\S]*?)\];/)[1].match(/"jarvis[A-Za-z]+"/g).map((s) => s.slice(1, -1));
  assert.equal(WORKOUT_KEYS.length, 8);
  WORKOUT_KEYS.forEach((k) => {
    assert.ok(L.BACKUP_KEYS.includes(k), k + " is backed up");
    assert.ok(!synced.includes(k), k + " is no longer in the shared document's list");
  });
  assert.ok(synced.includes("jarvisHabits") && synced.includes("jarvisCalories"), "the other synced keys are untouched");
  assert.equal(L.legacyShapeOk("jarvisWorkouts", []), true); assert.equal(L.legacyShapeOk("jarvisWorkouts", "oops"), false);
  assert.equal(L.legacyShapeOk("jarvisStrengthSettings", { compareSex: "male" }), true); assert.equal(L.legacyShapeOk("jarvisStrengthSettings", []), false);
});

test("two copies of the workout data are combined: every session from both, matched by id, the newer one when both changed", () => {
  const a = JSON.stringify([wk("w1"), wk("w2", { notes: "device" })]);
  const b = JSON.stringify([wk("w2", { notes: "cloud", updatedAt: 99999 }), wk("w3")]);
  const merged = JSON.parse(L.mergeText("jarvisWorkouts", a, b).text);
  assert.deepEqual(merged.map((x) => x.id), ["w1", "w2", "w3"], "this device's order, then what only the other had");
  assert.equal(merged.find((x) => x.id === "w2").notes, "cloud", "the version stamped newer wins");
  const tie = JSON.parse(L.mergeText("jarvisWorkouts", JSON.stringify([wk("w2", { notes: "device" })]), JSON.stringify([wk("w2", { notes: "cloud" })])).text);
  assert.equal(tie[0].notes, "device", "on a tie this device's copy wins");
  // old quick-log entries have no id: matched by their content, so the same entry isn't doubled
  const legacyEntry = { date: "2026-01-05", exercise: "Squat", sets: 3, reps: 5, weight: 135 };
  assert.equal(JSON.parse(L.mergeText("jarvisWorkouts", JSON.stringify([legacyEntry]), JSON.stringify([legacyEntry, { date: "2026-01-06", exercise: "Row", sets: 3, reps: 8, weight: 95 }])).text).length, 2);
});

test("the other workout keys merge to fit their shape", () => {
  const m = (k, a, b) => JSON.parse(L.mergeText(k, JSON.stringify(a), JSON.stringify(b)).text);
  assert.deepEqual(m("jarvisFavoriteExercises", ["bench", "squat"], ["squat", "row"]), ["bench", "squat", "row"], "both devices' stars are kept");
  assert.deepEqual(m("jarvisBodyweight", [{ id: "b1", weight: 180, date: "2026-11-01", createdAt: 1 }], [{ id: "b2", weight: 181, date: "2026-11-02", createdAt: 2 }]).map((x) => x.id), ["b1", "b2"]);
  assert.deepEqual(m("jarvisMeasurements", [{ id: "m1", type: "waist", value: 32, createdAt: 1 }], [{ id: "m1", type: "waist", value: 32, createdAt: 1 }]).length, 1, "the same weigh-in is not doubled");
  assert.deepEqual(m("jarvisRoutines", [{ id: "r1", name: "Push", createdAt: 1 }], [{ id: "r2", name: "Pull", createdAt: 2 }]).map((x) => x.id), ["r1", "r2"]);
  assert.deepEqual(m("jarvisPrograms", [{ id: "p1", name: "PPL", currentIndex: 2, createdAt: 1 }], [{ id: "p1", name: "PPL", currentIndex: 0, createdAt: 1 }])[0].currentIndex, 2, "this device's place in a program on a tie");
  assert.deepEqual(m("jarvisCustomExercises", [{ id: "custom_1", name: "Sled push" }], [{ id: "custom_2", name: "Prowler" }]).map((x) => x.id), ["custom_1", "custom_2"]);
  assert.deepEqual(m("jarvisStrengthSettings", { compareSex: "female" }, { compareSex: "male", extra: 1 }), { compareSex: "female", extra: 1 }, "settings: everything from both, this device's value where both have one");
  // a copy that can't be read doesn't take the other down with it
  assert.equal(L.mergeText("jarvisWorkouts", "{{not json", list("w1")).text, list("w1"));
  assert.equal(L.mergeText("jarvisWorkouts", list("w1"), "{{not json").text, list("w1"));
  assert.equal(L.mergeText("jarvisWorkouts", "{{", "}}").ok, false);
});

test("whatever two devices hold, the combined copy has every session from both", () => {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let round = 0; round < 200; round++) {
    const pool = Array.from({ length: 12 }, (_, i) => "w" + i);
    const pick = () => pool.filter(() => rnd() < 0.5);
    const a = pick(), b = pick();
    const merged = ids(L.mergeText("jarvisWorkouts", list(...a), list(...b)).text);
    const want = Array.from(new Set(a.concat(b))).sort();
    assert.deepEqual(merged, want, "round " + round);
  }
});

/* ---------------- the first sign-in with this version ---------------- */

test("a device whose workouts are already in the old copy: nothing changes, it is backed up, the old copy is untouched", async () => {
  const cloud = createFakeFirestore();
  legacyDoc(cloud, { jarvisWorkouts: JSON.parse(list("w1", "w2")), jarvisRoutines: [{ id: "r1", name: "Push", createdAt: 1 }] });
  const before = legacySnapshot(cloud);
  const t = setup({ cloud, local: { jarvisWorkouts: list("w1", "w2"), jarvisRoutines: JSON.stringify([{ id: "r1", name: "Push", createdAt: 1 }]) } });
  await t.session.reconcile();
  assert.equal(t.session.status().state, "ok");
  assert.deepEqual(ids(t.storage.getItem("jarvisWorkouts")), ["w1", "w2"]);
  assert.deepEqual(ids(cloudText(cloud, "jarvisWorkouts")), ["w1", "w2"], "now in the backup");
  assert.equal(legacySnapshot(cloud), before, "the old copy was only read");
  WORKOUT_KEYS.forEach((k) => assert.ok(t.session._meta().legacy[k], k + " is marked as imported"));
});

test("a new phone gets its workouts from the old copy, and they are then backed up", async () => {
  const cloud = createFakeFirestore();
  legacyDoc(cloud, { jarvisWorkouts: JSON.parse(list("w1", "w2", "w3")), jarvisBodyweight: [{ id: "b1", weight: 180, unit: "lb", date: "2026-11-01", createdAt: 1 }], jarvisStrengthSettings: { compareSex: "female" }, jarvisFavoriteExercises: ["bench"] });
  const before = legacySnapshot(cloud);
  const t = setup({ cloud });
  await t.session.reconcile();
  assert.deepEqual(ids(t.storage.getItem("jarvisWorkouts")), ["w1", "w2", "w3"], "a phone with nothing gets the history");
  assert.deepEqual(JSON.parse(t.storage.getItem("jarvisStrengthSettings")), { compareSex: "female" });
  assert.deepEqual(JSON.parse(t.storage.getItem("jarvisFavoriteExercises")), ["bench"]);
  assert.deepEqual(ids(cloudText(cloud, "jarvisWorkouts")), ["w1", "w2", "w3"]);
  assert.equal(t.storage.getItem("jarvisRoutines"), null, "a key the old copy never had stays unset, not turned into an empty list");
  assert.equal(legacySnapshot(cloud), before);
});

test("workouts on the device AND in the old copy: both are kept, here and in the backup, and the previous local copy is set aside", async () => {
  const cloud = createFakeFirestore();
  legacyDoc(cloud, { jarvisWorkouts: JSON.parse(list("w1", "w2")) });
  const t = setup({ cloud, local: { jarvisWorkouts: list("w2", "w3") } });
  await t.session.reconcile();
  assert.deepEqual(ids(t.storage.getItem("jarvisWorkouts")), ["w1", "w2", "w3"]);
  assert.deepEqual(ids(cloudText(cloud, "jarvisWorkouts")), ["w1", "w2", "w3"]);
  const safety = JSON.parse(t.storage.getItem(B.SAFETY_KEY));
  assert.deepEqual(ids(safety.keys.jarvisWorkouts), ["w2", "w3"], "what the device held before is kept");
});

test("the import happens once: a workout deleted afterwards stays deleted, and the old copy is not read again", async () => {
  const cloud = createFakeFirestore();
  legacyDoc(cloud, { jarvisWorkouts: JSON.parse(list("w1", "w2")) });
  const storage = createFakeStorage({});
  const first = setup({ cloud, storage });
  await first.session.reconcile();
  const readsAfterFirst = cloud.db.counts.reads;
  // delete w2 on the device, back it up
  storage.setItem("jarvisWorkouts", list("w1")); first.session.onSave("jarvisWorkouts"); first.clock.advance(2500); await settle(); await first.session.flush();
  assert.deepEqual(ids(cloudText(cloud, "jarvisWorkouts")), ["w1"]);
  // a later sign-in on the same device
  const next = setup({ cloud, storage });
  await next.session.reconcile();
  assert.deepEqual(ids(storage.getItem("jarvisWorkouts")), ["w1"], "the deleted session did not come back from the old copy");
  assert.ok(cloud.db.counts.reads - readsAfterFirst <= 2, "the old copy was not read again (one list of the backup at most)");
  assert.equal(next.session.status().state, "ok");
});

test("an old copy that is missing, empty, or the wrong kind of value changes nothing and is not imported", async () => {
  for (const store of [null, {}, { jarvisWorkouts: null }, { jarvisWorkouts: "oops", jarvisStrengthSettings: [1, 2] }, { jarvisWorkouts: [] }]) {
    const cloud = createFakeFirestore();
    if (store !== null) legacyDoc(cloud, store);
    const t = setup({ cloud, local: { jarvisWorkouts: list("w1") } });
    await t.session.reconcile();
    assert.deepEqual(ids(t.storage.getItem("jarvisWorkouts")), ["w1"], JSON.stringify(store));
    assert.equal(t.storage.getItem("jarvisStrengthSettings"), null, "garbage is never written into an empty key: " + JSON.stringify(store));
    assert.equal(t.session.status().state, "ok");
  }
});

/* ---------------- the cases that lose data in the old arrangement ---------------- */

test("a workout saved while the cloud couldn't be reached is NOT replaced by the older cloud copy at the next sign-in", async () => {
  const cloud = createFakeFirestore();
  const storage = createFakeStorage({ jarvisWorkouts: list("w1") });
  const t1 = setup({ cloud, storage });
  await t1.session.reconcile();                                   // w1 is backed up
  // at the gym with no signal: w2 is logged, the upload fails
  cloud.db.offline = true;
  storage.setItem("jarvisWorkouts", list("w1", "w2")); t1.session.onSave("jarvisWorkouts"); t1.clock.advance(2500); await settle(); await t1.session.flush();
  assert.equal(t1.session.status().state, "offline", "the upload failed and the status says so");
  assert.deepEqual(ids(cloudText(cloud, "jarvisWorkouts")), ["w1"], "the cloud still has only w1");
  cloud.db.offline = false; t1.session.stop();
  // the app is opened again: sign-in compares this device with the cloud
  const t2 = setup({ cloud, storage });
  await t2.session.reconcile();
  assert.deepEqual(ids(storage.getItem("jarvisWorkouts")), ["w1", "w2"], "the device keeps w2");
  assert.deepEqual(ids(cloudText(cloud, "jarvisWorkouts")), ["w1", "w2"], "and it is now in the cloud");
});

test("two devices log different workouts: when they meet, both sessions are kept on both", async () => {
  const cloud = createFakeFirestore();
  const sa = createFakeStorage({ jarvisWorkouts: list("w1") }), sb = createFakeStorage({});
  const a1 = setup({ cloud, storage: sa });
  await a1.session.reconcile();                                    // phone A backs up w1
  const b1 = setup({ cloud, storage: sb });
  await b1.session.reconcile();                                    // phone B (new) gets w1
  assert.deepEqual(ids(sb.getItem("jarvisWorkouts")), ["w1"]);
  // each logs a workout the other hasn't seen
  sa.setItem("jarvisWorkouts", list("w1", "wA")); a1.session.onSave("jarvisWorkouts"); a1.clock.advance(2500); await settle(); await a1.session.flush();
  sb.setItem("jarvisWorkouts", list("w1", "wBB")); b1.session.onSave("jarvisWorkouts"); b1.clock.advance(2500); await settle(); await b1.session.flush();
  // B's upload found A's change: it must not overwrite it; B waits to combine
  assert.ok(ids(cloudText(cloud, "jarvisWorkouts")).includes("wA"), "A's workout is still in the cloud");
  // the next sign-in on B combines
  b1.session.stop();
  const b2 = setup({ cloud, storage: sb });
  await b2.session.reconcile();
  assert.deepEqual(ids(sb.getItem("jarvisWorkouts")), ["w1", "wA", "wBB"]);
  assert.deepEqual(ids(cloudText(cloud, "jarvisWorkouts")), ["w1", "wA", "wBB"]);
  a1.session.stop();
  const a2 = setup({ cloud, storage: sa });
  await a2.session.reconcile();
  assert.deepEqual(ids(sa.getItem("jarvisWorkouts")), ["w1", "wA", "wBB"], "and A gets B's");
});

test("a long history is cut into pieces under Firestore's size limit instead of failing", async () => {
  const cloud = createFakeFirestore();
  const many = Array.from({ length: 2600 }, (_, i) => wk("w" + i, { notes: "n".repeat(500) }));
  const big = JSON.stringify(many);
  assert.ok(big.length > 1500000, "bigger than the whole shared document may be: " + big.length);
  const t = setup({ cloud, local: { jarvisWorkouts: big } });
  await t.session.reconcile();
  assert.equal(t.session.status().state, "ok");
  assert.ok(manifest(cloud, "jarvisWorkouts").parts >= 6);
  assert.equal(ids(cloudText(cloud, "jarvisWorkouts")).length, 2600);
});

/* ---------------- when the old copy can't be read, or the app is already running ---------------- */

test("the old copy can't be read: the workout keys are left alone (nothing pushed, nothing lost), the other keys carry on, and a later round imports", async () => {
  const cloud = createFakeFirestore();
  legacyDoc(cloud, { jarvisWorkouts: JSON.parse(list("w1", "w2")) });
  const tasks = JSON.stringify([{ id: "t1", text: "x", completed: false }]);
  const t = setup({ cloud, local: { jarvisTasks: tasks, jarvisWorkouts: list("w3") } });
  cloud.db.failNext = [];                       // the list of the backup works; the read of the old copy is made to fail
  const realGet = cloud.fb.getDocFromServer;
  cloud.fb.getDocFromServer = () => Promise.reject(Object.assign(new Error("unavailable"), { code: "unavailable" }));
  await t.session.reconcile();
  assert.equal(t.session.status().state, "offline");
  assert.deepEqual(ids(t.storage.getItem("jarvisWorkouts")), ["w3"], "the device's workouts are as they were");
  assert.equal(manifest(cloud, "jarvisWorkouts"), undefined, "and nothing was pushed for them");
  assert.ok(manifest(cloud, "jarvisTasks"), "other keys were still backed up");
  cloud.fb.getDocFromServer = realGet;
  await t.session.retryNow();
  assert.equal(t.session.status().state, "ok");
  assert.deepEqual(ids(t.storage.getItem("jarvisWorkouts")), ["w1", "w2", "w3"], "combined once it could be read");
});

test("an answer for the old copy that only came from a cache is treated as 'couldn't read it', not as 'it has nothing'", async () => {
  const cloud = createFakeFirestore();
  legacyDoc(cloud, { jarvisWorkouts: JSON.parse(list("w1", "w2")) });
  const real = cloud.fb.getDocFromServer;
  cloud.fb.getDocFromServer = (ref) => real(ref).then((snap) => Object.assign(snap, { metadata: { fromCache: true } }));
  const t = setup({ cloud });                                    // a new phone: nothing local
  await t.session.reconcile();
  assert.equal(t.session.status().state, "offline");
  assert.equal(t.storage.getItem("jarvisWorkouts"), null, "nothing was imported from a stale answer");
  assert.ok(!t.session._meta().legacy.jarvisWorkouts, "and it was not marked as done");
  cloud.fb.getDocFromServer = real;
  await t.session.retryNow();
  assert.deepEqual(ids(t.storage.getItem("jarvisWorkouts")), ["w1", "w2"], "the real answer is imported later");
});

test("once the app is running, the old copy is not mixed into this session's data: it waits for the next start", async () => {
  const cloud = createFakeFirestore();
  legacyDoc(cloud, { jarvisWorkouts: JSON.parse(list("w1", "w2")) });
  const storage = createFakeStorage({ jarvisWorkouts: list("w3") });
  const t = setup({ cloud, storage });
  t.session.markAppStarted();
  await t.session.reconcile();
  assert.deepEqual(ids(storage.getItem("jarvisWorkouts")), ["w3"], "this session's data is not changed under it");
  assert.equal(t.session.status().state, "reload");
  assert.deepEqual(t.session.status().reload.includes("jarvisWorkouts"), true);
  t.session.stop();
  const next = setup({ cloud, storage });
  await next.session.reconcile();
  assert.deepEqual(ids(storage.getItem("jarvisWorkouts")), ["w1", "w2", "w3"], "the next start combines them");
  assert.equal(next.session.status().state, "ok");
});

test("a full phone: the import is reported for that key and nothing is half-written", async () => {
  const cloud = createFakeFirestore();
  legacyDoc(cloud, { jarvisWorkouts: JSON.parse(list("w1", "w2")) });
  const storage = createFakeStorage({ jarvisWorkouts: list("w3") }, 40);      // room for almost nothing more
  const t = setup({ cloud, storage });
  await t.session.reconcile();
  assert.notEqual(t.session.status().state, "ok", "it says something is wrong");
  assert.deepEqual(ids(storage.getItem("jarvisWorkouts")), ["w3"], "the device's data is as it was");
  assert.ok(!t.session._meta().legacy.jarvisWorkouts, "and it will try again next time");
});

test("a different account's backup on this device pauses the import too", async () => {
  const cloud = createFakeFirestore();
  legacyDoc(cloud, { jarvisWorkouts: JSON.parse(list("w1")) });
  const storage = createFakeStorage({ jarvisWorkouts: list("w9"), [B.META_KEY]: JSON.stringify({ uid: "someone-else", keys: {}, lastOkAt: 1 }) });
  const t = setup({ cloud, storage });
  await t.session.reconcile();
  assert.equal(t.session.status().state, "mismatch");
  assert.deepEqual(ids(storage.getItem("jarvisWorkouts")), ["w9"], "nothing from this account's old copy was mixed in");
});
