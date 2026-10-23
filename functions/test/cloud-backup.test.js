"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("../../js/cloud-backup");
const L = require("../../js/backup-logic");
const { createFakeFirestore, createFakeStorage, createFakeClock } = require("./fake-firestore");

const UID = "user-1";
const col = (id) => "users/" + UID + "/appData/" + id;

const tasks = (...ids) => JSON.stringify(ids.map((id) => ({ id: id, text: "task " + id, completed: false })));
const settle = () => new Promise((r) => setImmediate(r));

function setup(opts) {
  opts = opts || {};
  const cloud = opts.cloud || createFakeFirestore();
  const storage = opts.storage || createFakeStorage(opts.local || {});
  const clock = opts.clock || createFakeClock();
  const session = B.create({
    fb: cloud.fb, db: {}, uid: opts.uid || UID, storage: storage, keys: opts.keys,
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer
  });
  return { cloud, storage, clock, session };
}
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

test("first sign-in: this device's data goes up, then the status says backed up with a time", async () => {
  const { cloud, storage, session, clock } = setup({ local: { jarvisTasks: tasks("a", "b"), jarvisGoals: "[]" } });
  await session.reconcile();
  assert.equal(cloudText(cloud, "jarvisTasks"), tasks("a", "b"));
  assert.equal(manifest(cloud, "jarvisGoals"), undefined, "an empty list isn't worth a document");
  const s = session.status();
  assert.equal(s.state, "ok");
  assert.equal(s.lastOkAt, clock.now());
  assert.equal(storage.getItem("jarvisTasks"), tasks("a", "b"), "the device's copy is untouched");
  assert.equal(JSON.parse(storage.getItem(B.META_KEY)).uid, UID);
});

test("a new phone (or cleared storage) gets everything back from the cloud", async () => {
  const first = setup({ local: { jarvisTasks: tasks("a", "b"), jarvisNutritionLog: JSON.stringify({ "2026-10-20": { water: 2, meals: { lunch: [{ id: "f1", name: "Rice" }] } } }) } });
  await first.session.reconcile();
  const fresh = setup({ cloud: first.cloud });
  await fresh.session.reconcile();
  assert.equal(fresh.storage.getItem("jarvisTasks"), tasks("a", "b"));
  assert.equal(JSON.parse(fresh.storage.getItem("jarvisNutritionLog"))["2026-10-20"].meals.lunch[0].name, "Rice");
  assert.equal(fresh.session.status().state, "ok");
});

test("saves are uploaded together a couple of seconds later, and the status goes pending -> ok", async () => {
  const t = setup({ local: { jarvisTasks: tasks("a") } });
  await t.session.reconcile();
  const seen = [];
  t.session.subscribe((s) => seen.push(s.state));
  t.storage.setItem("jarvisTasks", tasks("a", "b"));
  t.session.onSave("jarvisTasks");
  t.storage.setItem("jarvisTasks", tasks("a", "b", "c"));
  t.session.onSave("jarvisTasks");
  assert.equal(t.session.status().state, "pending");
  assert.equal(t.session.status().waiting, 1);
  const commitsBefore = t.cloud.db.counts.commits;
  await t.clock.tick(1500);
  assert.equal(t.cloud.db.counts.commits, commitsBefore, "not yet");
  await t.clock.tick(600);
  assert.equal(t.cloud.db.counts.commits, commitsBefore + 1, "one upload for both saves");
  assert.equal(cloudText(t.cloud, "jarvisTasks"), tasks("a", "b", "c"));
  assert.equal(t.session.status().state, "ok");
  assert.deepEqual(seen.filter((x, i) => x !== seen[i - 1]), ["ok", "pending", "ok"]);
});

test("keys that aren't on the backup list are ignored", async () => {
  const t = setup({ local: { jarvisTasks: tasks("a") } });
  await t.session.reconcile();
  t.session.onSave("jarvisWorkouts");
  t.session.onSave("jarvisVideoConnections");
  assert.equal(t.session.status().waiting, 0);
  assert.equal(t.clock.pending(), 0);
});

test("a save that changed nothing isn't uploaded again", async () => {
  const t = setup({ local: { jarvisTasks: tasks("a") } });
  await t.session.reconcile();
  const c = t.cloud.db.counts.commits;
  t.session.onSave("jarvisTasks");
  await t.clock.tick(2100);
  assert.equal(t.cloud.db.counts.commits, c);
  assert.equal(t.session.status().state, "ok");
});

test("sign-in with both sides changed: everything from both is kept, on the device and in the cloud", async () => {
  const cloud = createFakeFirestore();
  const a = setup({ cloud, local: { jarvisTasks: tasks("a", "shared") } });
  await a.session.reconcile();                                     // device A syncs
  const b = setup({ cloud, local: { jarvisTasks: tasks("shared") } });
  await b.session.reconcile();                                     // device B meets the cloud for the first time -> merge
  assert.deepEqual(JSON.parse(b.storage.getItem("jarvisTasks")).map((x) => x.id).sort(), ["a", "shared"]);
  // A's open session doesn't know B merged; its next save is held back (not uploaded over B's copy)
  a.storage.setItem("jarvisTasks", tasks("a", "shared", "from-a"));
  a.session.onSave("jarvisTasks");
  await a.clock.tick(2100);
  assert.equal(a.session.status().state, "reload");
  // A reopens the app (its from-a change is still on the device); B changes too while apart
  const a1 = setup({ cloud, storage: a.storage });
  await a1.session.reconcile();
  assert.ok(JSON.parse(cloudText(cloud, "jarvisTasks")).some((x) => x.id === "from-a"));
  b.storage.setItem("jarvisTasks", tasks("a", "shared", "from-b"));
  const b2 = setup({ cloud, storage: b.storage });                 // B opens the app again
  await b2.session.reconcile();
  const ids = JSON.parse(b.storage.getItem("jarvisTasks")).map((x) => x.id).sort();
  assert.deepEqual(ids, ["a", "from-a", "from-b", "shared"]);
  assert.deepEqual(JSON.parse(cloudText(cloud, "jarvisTasks")).map((x) => x.id).sort(), ids, "the cloud has the combined copy too");
  assert.ok(JSON.parse(b.storage.getItem("jarvisBackupSafety")).keys.jarvisTasks, "the copy that was replaced is kept");
  // and device A picks it all up the next time it opens
  const a2 = setup({ cloud, storage: a.storage });
  await a2.session.reconcile();
  assert.deepEqual(JSON.parse(a.storage.getItem("jarvisTasks")).map((x) => x.id).sort(), ids);
});

test("only the cloud changed since this device last synced: the device just takes it", async () => {
  const cloud = createFakeFirestore();
  const a = setup({ cloud, local: { jarvisGoals: JSON.stringify([{ id: "g1", name: "Squat 315" }]) } });
  await a.session.reconcile();
  const b = setup({ cloud });
  await b.session.reconcile();
  b.storage.setItem("jarvisGoals", JSON.stringify([{ id: "g1", name: "Squat 315" }, { id: "g2", name: "GPA 4.5" }]));
  b.session.onSave("jarvisGoals");
  await b.clock.tick(2100);
  const a2 = setup({ cloud, storage: a.storage });
  await a2.session.reconcile();
  assert.equal(JSON.parse(a.storage.getItem("jarvisGoals")).length, 2);
  assert.equal(a.storage.getItem("jarvisBackupSafety"), null, "nothing of this device's was replaced");
});

test("once the app has started, a newer cloud copy is NOT written over the device; the key waits for a reload", async () => {
  const cloud = createFakeFirestore();
  const a = setup({ cloud, local: { jarvisTasks: tasks("a") } });
  await a.session.reconcile();
  const b = setup({ cloud });
  await b.session.reconcile();
  b.storage.setItem("jarvisTasks", tasks("a", "from-b"));
  b.session.onSave("jarvisTasks");
  await b.clock.tick(2100);

  const a2 = setup({ cloud, storage: a.storage });
  a2.session.markAppStarted();                                     // the app was slow to hear from the cloud and started anyway
  await a2.session.reconcile();
  assert.equal(a.storage.getItem("jarvisTasks"), tasks("a"), "device data untouched");
  assert.equal(a2.session.status().state, "reload");
  assert.deepEqual(a2.session.status().reload, ["jarvisTasks"]);
  // later saves from the stale session must not overwrite the newer cloud copy
  a.storage.setItem("jarvisTasks", tasks("a", "late"));
  a2.session.onSave("jarvisTasks");
  await a2.clock.tick(2100);
  assert.deepEqual(JSON.parse(cloudText(cloud, "jarvisTasks")).map((x) => x.id), ["a", "from-b"]);
  // after a reload (a new session) everything is combined
  const a3 = setup({ cloud, storage: a.storage });
  await a3.session.reconcile();
  assert.deepEqual(JSON.parse(a.storage.getItem("jarvisTasks")).map((x) => x.id).sort(), ["a", "from-b", "late"]);
});

test("a late merge uploads the combined copy but leaves the device alone, and the next start takes it", async () => {
  const cloud = createFakeFirestore();
  const a = setup({ cloud, local: { jarvisTasks: tasks("a") } });
  await a.session.reconcile();
  const b = setup({ cloud });
  await b.session.reconcile();
  b.storage.setItem("jarvisTasks", tasks("a", "from-b")); b.session.onSave("jarvisTasks"); await b.clock.tick(2100);
  a.storage.setItem("jarvisTasks", tasks("a", "from-a"));          // both changed
  const a2 = setup({ cloud, storage: a.storage });
  a2.session.markAppStarted();
  await a2.session.reconcile();
  assert.equal(a.storage.getItem("jarvisTasks"), tasks("a", "from-a"), "device untouched");
  assert.equal(a2.session.status().state, "reload");
  assert.deepEqual(JSON.parse(cloudText(cloud, "jarvisTasks")).map((x) => x.id).sort(), ["a", "from-a", "from-b"]);
  const a3 = setup({ cloud, storage: a.storage });
  await a3.session.reconcile();
  assert.deepEqual(JSON.parse(a.storage.getItem("jarvisTasks")).map((x) => x.id).sort(), ["a", "from-a", "from-b"]);
  assert.equal(a3.session.status().state, "ok");
});

test("another device uploads in the middle of this one's upload: nothing is overwritten", async () => {
  const cloud = createFakeFirestore();
  const a = setup({ cloud, local: { jarvisTasks: tasks("a") } });
  await a.session.reconcile();
  const b = setup({ cloud });
  await b.session.reconcile();
  // A saves; just before A's upload commits, B's upload lands
  a.storage.setItem("jarvisTasks", tasks("a", "from-a"));
  a.session.onSave("jarvisTasks");
  cloud.db.beforeCommit = () => {
    b.storage.setItem("jarvisTasks", tasks("a", "from-b"));
    const m = manifest(cloud, "jarvisTasks");
    const text = tasks("a", "from-b");
    cloud.db.store.set(col("jarvisTasks~0"), { text: text, rev: m.updatedAt + 5 });
    cloud.db.store.set(col("jarvisTasks"), { parts: 1, chars: text.length, hash: L.hashText(text), updatedAt: m.updatedAt + 5, device: "b" });
  };
  await a.clock.tick(2100);
  assert.deepEqual(JSON.parse(cloudText(cloud, "jarvisTasks")).map((x) => x.id), ["a", "from-b"], "B's upload survived");
  assert.equal(a.session.status().state, "reload", "A is told to reload");
  assert.equal(a.storage.getItem("jarvisTasks"), tasks("a", "from-a"), "A's own change is still on A");
});

test("an upload that went through but whose confirmation was lost is not mistaken for another device", async () => {
  const t = setup({ local: { jarvisTasks: tasks("a") } });
  await t.session.reconcile();
  t.storage.setItem("jarvisTasks", tasks("a", "b"));
  t.session.onSave("jarvisTasks");
  t.cloud.db.dropAckNext = 1;
  await t.clock.tick(2100);
  assert.equal(cloudText(t.cloud, "jarvisTasks"), tasks("a", "b"), "it did arrive");
  assert.equal(t.session.status().state, "offline", "but this device doesn't know that yet");
  t.storage.setItem("jarvisTasks", tasks("a", "b", "c"));         // the user keeps going
  t.session.onSave("jarvisTasks");
  await t.clock.tick(6000);
  assert.equal(cloudText(t.cloud, "jarvisTasks"), tasks("a", "b", "c"));
  assert.equal(t.session.status().state, "ok");
  assert.deepEqual(t.session.status().reload, []);
});

test("the same lost confirmation at sign-in is recognised too (no needless merge)", async () => {
  const t = setup({ local: { jarvisTasks: tasks("a") } });
  t.cloud.db.dropAckNext = 1;
  await t.session.reconcile();                                      // uploads, confirmation lost
  assert.equal(t.session.status().state, "offline");
  t.storage.setItem("jarvisTasks", tasks("a", "b"));
  const again = setup({ cloud: t.cloud, storage: t.storage });
  await again.session.reconcile();
  assert.equal(again.session.status().state, "ok");
  assert.equal(t.storage.getItem("jarvisBackupSafety"), null, "it was a plain push, not a merge");
  assert.equal(cloudText(t.cloud, "jarvisTasks"), tasks("a", "b"));
});

test("a big value is cut into pieces under the size limit, whole when read back, and shrinks cleanly", async () => {
  const big = JSON.stringify(Array.from({ length: 3000 }, (_, i) => ({ id: "t" + i, text: "é".repeat(100) + i })));
  assert.ok(big.length > L.CHUNK_CHARS * 1.1);
  const t = setup({ local: { jarvisTasks: big } });
  await t.session.reconcile();
  const m = manifest(t.cloud, "jarvisTasks");
  assert.ok(m.parts >= 2);
  assert.equal(cloudText(t.cloud, "jarvisTasks"), big);
  const fresh = setup({ cloud: t.cloud });
  await fresh.session.reconcile();
  assert.equal(fresh.storage.getItem("jarvisTasks"), big);
  // shrink: the leftover pieces go away
  t.storage.setItem("jarvisTasks", tasks("only"));
  t.session.onSave("jarvisTasks");
  await t.clock.tick(2100);
  assert.equal(manifest(t.cloud, "jarvisTasks").parts, 1);
  assert.equal(t.cloud.db.store.has(col("jarvisTasks~1")), false);
  assert.equal(cloudText(t.cloud, "jarvisTasks"), tasks("only"));
});

test("a cloud copy that doesn't add up is never trusted: the device's data replaces it, or is left alone if empty", async () => {
  const t = setup({ local: { jarvisTasks: tasks("a", "b") } });
  await t.session.reconcile();
  t.cloud.db.store.delete(col("jarvisTasks~0"));                    // a lost piece
  const fresh = setup({ cloud: t.cloud });                          // a phone with nothing
  await fresh.session.reconcile();
  assert.equal(fresh.storage.getItem("jarvisTasks"), null, "nothing broken was written to the phone");
  const again = setup({ cloud: t.cloud, storage: t.storage });     // the phone that still has the data
  await again.session.reconcile();
  assert.equal(cloudText(t.cloud, "jarvisTasks"), tasks("a", "b"), "repaired from the device");
  assert.equal(again.session.status().state, "ok");
});

test("rules not deployed: the status says so, nothing is lost, and there is no retry storm", async () => {
  const t = setup({ local: { jarvisTasks: tasks("a") } });
  t.cloud.db.denied = true;
  await t.session.reconcile();
  assert.equal(t.session.status().state, "rules");
  assert.equal(t.clock.pending(), 0, "no automatic retries");
  assert.equal(t.storage.getItem("jarvisTasks"), tasks("a"));
  t.session.onSave("jarvisTasks");
  await t.clock.tick(5000);
  assert.equal(t.cloud.db.counts.commits, 0);
  // the owner deploys the rules and taps Try again
  t.cloud.db.denied = false;
  await t.session.retryNow();
  assert.equal(t.session.status().state, "ok");
  assert.equal(cloudText(t.cloud, "jarvisTasks"), tasks("a"));
});

test("offline: the status says so, a retry is scheduled, and it uploads when the connection returns", async () => {
  const t = setup({ local: { jarvisTasks: tasks("a") } });
  t.cloud.db.offline = true;
  await t.session.reconcile();
  assert.equal(t.session.status().state, "offline");
  assert.equal(t.clock.pending(), 1);
  t.cloud.db.offline = false;
  await t.clock.tick(5100);
  assert.equal(t.session.status().state, "ok");
  assert.equal(cloudText(t.cloud, "jarvisTasks"), tasks("a"));
});

test("a cloud call that never answers is given up on, so backup (and its button) never hangs", async () => {
  const t = setup({ local: { jarvisTasks: tasks("a") } });
  t.cloud.db.hang = true;
  const done = t.session.reconcile();
  await settle();
  assert.equal(t.session.status().state, "checking");
  assert.equal(B.describe(t.session.status()).busy, true);
  await t.clock.tick(20100);
  await done;
  assert.equal(t.session.status().state, "offline");
  assert.notEqual(B.describe(t.session.status()).busy, true, "the button is usable again");
  t.cloud.db.hang = false;
  await t.clock.tick(5100);
  assert.equal(t.session.status().state, "ok");
  assert.equal(cloudText(t.cloud, "jarvisTasks"), tasks("a"));
});

test("an answer that only came from a cache is treated as offline, not as 'the cloud is empty'", async () => {
  const t = setup({ local: { jarvisTasks: tasks("a") } });
  t.cloud.db.fromCache = true;
  await t.session.reconcile();
  assert.equal(t.session.status().state, "offline");
  assert.equal(t.cloud.db.counts.commits, 0);
});

test("retries back off and keep going", async () => {
  const t = setup({ local: { jarvisTasks: tasks("a") } });
  t.cloud.db.offline = true;
  await t.session.reconcile();
  await t.clock.tick(5000);   // 1st retry fails
  assert.equal(t.clock.pending(), 1);
  await t.clock.tick(14000);
  assert.equal(t.session.status().state, "offline", "next retry is 15s after the first");
  await t.clock.tick(1500);
  assert.equal(t.clock.pending(), 1, "and it keeps trying");
});

test("a different account's backup on this device pauses everything until the user chooses", async () => {
  const storage = createFakeStorage({ jarvisTasks: tasks("mine"), jarvisBackupMeta: JSON.stringify({ uid: "someone-else", keys: {}, lastOkAt: null }) });
  const t = setup({ storage: storage });
  await t.session.reconcile();
  assert.equal(t.session.status().state, "mismatch");
  assert.equal(t.cloud.db.store.size, 0);
  assert.equal(B.describe(t.session.status()).button, "Use this account");
  await t.session.acceptAccount();
  assert.equal(t.session.status().state, "ok");
  assert.equal(cloudText(t.cloud, "jarvisTasks"), tasks("mine"));
});

test("a key that was never saved isn't treated as 'deleted' and never wipes the cloud", async () => {
  const cloud = createFakeFirestore();
  const a = setup({ cloud, local: { jarvisTasks: tasks("a") } });
  await a.session.reconcile();
  a.storage.removeItem("jarvisTasks");
  a.session.onSave("jarvisTasks");
  await a.clock.tick(2100);
  assert.equal(cloudText(cloud, "jarvisTasks"), tasks("a"));
});

test("clearing a list on purpose does back up the empty list", async () => {
  const t = setup({ local: { jarvisTasks: tasks("a") } });
  await t.session.reconcile();
  t.storage.setItem("jarvisTasks", "[]");
  t.session.onSave("jarvisTasks");
  await t.clock.tick(2100);
  assert.equal(cloudText(t.cloud, "jarvisTasks"), "[]");
});

test("one key failing doesn't stop the others", async () => {
  const t = setup({ local: { jarvisTasks: tasks("a"), jarvisGoals: JSON.stringify([{ id: "g", name: "x" }]) } });
  t.cloud.db.failNext = ["internal"];                              // the first call (the listing) fails
  await t.session.reconcile();
  assert.equal(t.session.status().state, "error");
  await t.clock.tick(5100);
  assert.equal(t.session.status().state, "ok");
  assert.ok(cloudText(t.cloud, "jarvisTasks") && cloudText(t.cloud, "jarvisGoals"));
});

test("a full phone doesn't crash the pull; that key reports an error and the rest carry on", async () => {
  const cloud = createFakeFirestore();
  const a = setup({ cloud, local: { jarvisTasks: tasks("a"), jarvisGoals: JSON.stringify([{ id: "g", name: "x" }]) } });
  await a.session.reconcile();
  const full = createFakeStorage({}, 10);                           // room for almost nothing
  const t = setup({ cloud, storage: full });
  await t.session.reconcile();
  assert.equal(t.session.status().state, "error");
  assert.equal(full.getItem("jarvisTasks"), null);
});

test("what the user is told for every state", () => {
  const base = { detail: "", lastOkAt: null, waiting: 0, reload: [] };
  const states = ["off", "checking", "ok", "pending", "offline", "rules", "mismatch", "reload", "error"];
  states.forEach((s) => {
    const d = B.describe(Object.assign({}, base, { state: s, waiting: 2, lastOkAt: 1700000000000, detail: "internal" }));
    assert.ok(d.text.length > 10, s);
    assert.ok(["ok", "wait", "warn", "off"].includes(d.tone), s);
  });
  assert.match(B.describe(Object.assign({}, base, { state: "ok", lastOkAt: 1700000000000 })).text, /Last confirmed/);
  assert.doesNotMatch(B.describe(Object.assign({}, base, { state: "ok" })).text, /Last confirmed/, "no time is invented");
  assert.match(B.describe(Object.assign({}, base, { state: "pending", waiting: 1 })).text, /1 change is/);
  assert.match(B.describe(Object.assign({}, base, { state: "rules" })).text, /safe on this phone/);
  assert.equal(B.describe(Object.assign({}, base, { state: "off" })).button, "");
});

test("the rules file allows the owner, and only the owner, into appData", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "..", "firestore.rules"), "utf8");
  const m = src.match(/match \/appData\/\{docId\} \{([\s\S]*?)\}/);
  assert.ok(m, "an appData rule exists");
  assert.match(m[1], /allow read, write: if request\.auth != null && request\.auth\.uid == userId;/);
});
