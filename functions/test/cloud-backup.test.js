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

test("saves are uploaded together about a second later, and the status goes pending -> ok", async () => {
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
  await t.clock.tick(600);
  assert.equal(t.cloud.db.counts.commits, commitsBefore, "not yet");
  await t.clock.tick(500);
  assert.equal(t.cloud.db.counts.commits, commitsBefore + 1, "one upload for both saves");
  assert.equal(cloudText(t.cloud, "jarvisTasks"), tasks("a", "b", "c"));
  assert.equal(t.session.status().state, "ok");
  assert.deepEqual(seen.filter((x, i) => x !== seen[i - 1]), ["ok", "pending", "ok"]);
});

test("keys that aren't on the backup list are ignored", async () => {
  const t = setup({ local: { jarvisTasks: tasks("a") } });
  await t.session.reconcile();
  t.session.onSave("jarvisHabits");        // kept by the original sync, not this backup
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


/* ---------------- hearing that the other device saved ---------------- */

// Two devices on one cloud: `open` signs one in and starts its app (from then on it never changes its own data).
async function openDevice(cloud, local) {
  const t = setup({ cloud: cloud, local: local });
  const news = [];
  t.session.onRemote((n) => news.push(...n));
  await t.session.reconcile();
  t.session.markAppStarted();
  await settle();
  t.news = news;
  return t;
}
async function savePlan(t, text) {
  t.storage.setItem("jarvisTasks", text);
  t.session.onSave("jarvisTasks");
  await t.clock.tick(1100);
  await settle();
}

test("the other device saves while this one is open: this one is told at once, and nothing on it is changed", async () => {
  const cloud = createFakeFirestore();
  const computer = await openDevice(cloud, { jarvisTasks: tasks("a") });
  const phone = await openDevice(cloud, { jarvisTasks: tasks("a") });
  assert.deepEqual(computer.news, [], "nothing new yet");
  await savePlan(phone, tasks("a", "b"));
  assert.equal(computer.news.length, 1);
  assert.equal(computer.news[0].key, "jarvisTasks");
  assert.equal(computer.news[0].rev, manifest(cloud, "jarvisTasks").updatedAt, "with the revision, so it is acted on once");
  assert.equal(computer.storage.getItem("jarvisTasks"), tasks("a"), "the open app's data is left alone; the refresh combines it on start");
  assert.deepEqual(phone.news, [], "a device is never told about its own upload");
});

test("hearing about it costs no extra reads of the whole backup", async () => {
  const cloud = createFakeFirestore();
  const computer = await openDevice(cloud, { jarvisTasks: tasks("a") });
  const phone = await openDevice(cloud, { jarvisTasks: tasks("a") });
  const reads = cloud.db.counts.reads;
  await savePlan(phone, tasks("a", "b"));
  await savePlan(phone, tasks("a", "b", "c"));
  assert.equal(computer.news.length, 2, "each upload is one piece of news");
  assert.equal(cloud.db.counts.reads, reads, "no list of the whole collection was read to learn it");
});

test("only the small manifests are listened to, never the data chunks", async () => {
  const cloud = createFakeFirestore();
  const computer = await openDevice(cloud, {});
  const phone = await openDevice(cloud, { jarvisTasks: JSON.stringify(Array.from({ length: 4000 }, (_, i) => ({ id: "t" + i, text: "x".repeat(200) }))) });
  await phone.clock.tick(1100); await settle();
  const pieces = Array.from(cloud.db.store.keys()).filter((p) => p.indexOf("/appData/") !== -1 && p.indexOf(L.partId("jarvisTasks", 0).split("/").pop().slice(0, 12)) !== -1).length;
  assert.ok(manifest(cloud, "jarvisTasks").parts > 1 && pieces >= 2, "the big value was stored in more than one piece");
  assert.equal(computer.news.filter((n) => n.key !== "jarvisTasks").length, 0, "yet only the key itself is reported");
  assert.ok(computer.news.length <= 1, "once");
});

test("something this device already holds is not news", async () => {
  const cloud = createFakeFirestore();
  const computer = await openDevice(cloud, { jarvisTasks: tasks("a") });
  const phone = await openDevice(cloud, { jarvisTasks: tasks("a") });
  // the computer gets the same content by another route (another tab, a restore) before the news arrives
  computer.storage.setItem("jarvisTasks", tasks("a", "b"));
  await savePlan(phone, tasks("a", "b"));
  assert.deepEqual(computer.news, []);
});

test("a device that was asleep hears what it missed when it starts listening again", async () => {
  const cloud = createFakeFirestore();
  const computer = await openDevice(cloud, { jarvisTasks: tasks("a") });
  const phone = await openDevice(cloud, { jarvisTasks: tasks("a") });
  computer.session.stop();                                   // the app was frozen in the background
  const woke = setup({ cloud: cloud, storage: computer.storage });
  const news = [];
  woke.session.onRemote((n) => news.push(...n));
  await woke.session.reconcile();                            // first pass after it wakes: nothing newer yet
  woke.session.markAppStarted();
  await settle();
  assert.deepEqual(news, []);
  woke.session.stop();
  const again = setup({ cloud: cloud, storage: computer.storage, clock: woke.clock });
  const news2 = [];
  again.session.onRemote((n) => news2.push(...n));
  await again.session.reconcile(); again.session.markAppStarted();
  await savePlan(phone, tasks("a", "while asleep"));
  await settle();
  assert.equal(news2.length, 1, "told as soon as it is listening");
});

test("the first answer from the cloud already holds something newer: it is reported", async () => {
  const cloud = createFakeFirestore();
  const phone = await openDevice(cloud, { jarvisTasks: tasks("a") });
  const computer = setup({ cloud: cloud, local: { jarvisTasks: tasks("a") } });
  await computer.session.reconcile();
  computer.session.stop();
  await savePlan(phone, tasks("a", "b"));
  const woke = setup({ cloud: cloud, storage: computer.storage });
  const news = [];
  woke.session.onRemote((n) => news.push(...n));
  await woke.session.reconcile();                            // this pass pulls it in at start: not news
  woke.session.markAppStarted();
  await settle();
  assert.deepEqual(news, [], "what start-up already took is not news");
});

test("a listener that fails never breaks backup, and is put back when asked", async () => {
  const cloud = createFakeFirestore();
  cloud.db.snapshotError = "permission-denied";
  const t = await openDevice(cloud, { jarvisTasks: tasks("a") });
  assert.equal(t.session.status().state, "ok", "backup itself is fine");
  const before = cloud.db.counts.listens;
  t.session.watch();
  await settle();
  assert.equal(cloud.db.counts.listens, before + 1, "asking again attaches a new listener");
  const phone = await openDevice(cloud, { jarvisTasks: tasks("a") });
  await savePlan(phone, tasks("a", "b"));
  assert.equal(t.news.length, 1, "and it works");
});

test("no listener is started when backup is refused, offline, or paused for another account", async () => {
  const denied = createFakeFirestore(); denied.db.denied = true;
  const a = setup({ cloud: denied, local: { jarvisTasks: tasks("a") } });
  await a.session.reconcile();
  assert.equal(denied.db.counts.listens, 0);
  const off = createFakeFirestore(); off.db.offline = true;
  const b = setup({ cloud: off, local: { jarvisTasks: tasks("a") } });
  await b.session.reconcile();
  assert.equal(off.db.counts.listens, 0);
  const ok = createFakeFirestore();
  const c = setup({ cloud: ok, local: { jarvisTasks: tasks("a"), [B.META_KEY]: JSON.stringify({ uid: "someone-else", keys: {}, legacy: {}, lastOkAt: null }) } });
  await c.session.reconcile();
  assert.equal(c.session.status().state, "mismatch");
  assert.equal(ok.db.counts.listens, 0);
});

test("stopping a session closes its listener", async () => {
  const cloud = createFakeFirestore();
  const computer = await openDevice(cloud, { jarvisTasks: tasks("a") });
  const phone = await openDevice(cloud, { jarvisTasks: tasks("a") });
  assert.equal(cloud.db.listeners.length, 2);
  computer.session.stop();
  assert.equal(cloud.db.listeners.length, 1);
  await savePlan(phone, tasks("a", "b"));
  assert.deepEqual(computer.news, []);
});

test("a cloud library without listeners (or a stub) leaves backup working as before", async () => {
  const cloud = createFakeFirestore();
  delete cloud.fb.onSnapshot;
  const t = await openDevice(cloud, { jarvisTasks: tasks("a") });
  assert.equal(t.session.status().state, "ok");
  assert.equal(cloud.db.counts.listens, 0);
});

test("an upload that loses to the other device's newer save also reports it, with that revision", async () => {
  const cloud = createFakeFirestore();
  const computer = await openDevice(cloud, { jarvisTasks: tasks("a") });
  const phone = await openDevice(cloud, { jarvisTasks: tasks("a") });
  // both save; the phone's reaches the cloud first, so the computer's upload finds a newer copy and waits
  phone.storage.setItem("jarvisTasks", tasks("a", "phone")); phone.session.onSave("jarvisTasks");
  computer.storage.setItem("jarvisTasks", tasks("a", "computer")); computer.session.onSave("jarvisTasks");
  await phone.clock.tick(1100); await settle();
  await computer.clock.tick(1100); await settle();
  assert.deepEqual(computer.session.status().reload, ["jarvisTasks"], "waits for the refresh that combines them");
  assert.ok(computer.news.length >= 1 && computer.news.every((n) => n.key === "jarvisTasks" && typeof n.rev === "number"));
});
