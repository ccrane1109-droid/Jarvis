"use strict";
// The Video Lab's data (jarvisVideoIntel) in the cloud backup. What these tests protect:
//  - it is backed up, in its own key, and never in the older shared document as well
//  - two devices' videos and campaigns are both kept; a deletion reaches the other device and an undo wins over it
//  - lists and settings from a newer version of the app are kept, not dropped
//  - a phone with nothing gets the data from the cloud; a phone with unsynced videos is not overwritten by an older cloud copy
// The Firestore here is an in-memory stand-in (see fake-firestore.js), not the real thing.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const B = require("../../js/cloud-backup");
const L = require("../../js/backup-logic");
const V = require("../../js/video-intel-logic");
const { createFakeFirestore, createFakeStorage, createFakeClock } = require("./fake-firestore");

const UID = "user-1";
const KEY = "jarvisVideoIntel";
const col = (id) => "users/" + UID + "/appData/" + id;
const settle = () => new Promise((r) => setImmediate(r));

const vid = (id, extra) => Object.assign({ id: id, title: "Video " + id, platform: "instagram", workId: id, pillars: ["Faith"], objective: { primary: "", secondary: [] }, createdAt: 100, updatedAt: 100, deletedAt: null }, extra || {});
const store = (o) => JSON.stringify(Object.assign(V.emptyStore(), o || {}));
const ids = (text, list) => JSON.parse(text)[list || "videos"].map((x) => x.id).sort();
const merged = (a, b) => JSON.parse(L.mergeText(KEY, JSON.stringify(a), JSON.stringify(b)).text);

function setup(opts) {
  opts = opts || {};
  const cloud = opts.cloud || createFakeFirestore();
  const storage = opts.storage || createFakeStorage(opts.local || {});
  const clock = opts.clock || createFakeClock();
  const session = B.create({ fb: cloud.fb, db: {}, uid: UID, storage: storage, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  return { cloud, storage, clock, session };
}
const cloudText = (cloud, key) => {
  const m = cloud.db.store.get(col(key));
  if (!m) return null;
  const parts = {};
  for (let i = 0; i < m.parts; i++) parts[i] = cloud.db.store.get(col(L.partId(key, i))).text;
  const r = L.assemble(m, parts);
  assert.ok(r.ok, "cloud copy must be whole: " + r.reason);
  return r.text;
};

/* ---------------- the rules ---------------- */

test("the Video Lab is backed up in its own key, and not in the older shared document as well", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "js", "auth.js"), "utf8");
  const synced = src.match(/const SYNCED_KEYS = \[([\s\S]*?)\];/)[1].match(/"jarvis[A-Za-z]+"/g).map((s) => s.slice(1, -1));
  assert.ok(L.BACKUP_KEYS.includes(KEY));
  assert.ok(!synced.includes(KEY), "never stored in two places");
  assert.equal(V.KEY, KEY, "the logic module and the backup agree on the key's name");
  assert.equal(typeof L.mergeVideoIntel, "function");
  assert.equal(L.mergeText(KEY, "{}", "{}").ok, true);
});

test("two devices' videos and campaigns are both kept, matched by id, the newer version of one record winning", () => {
  const a = { videos: [vid("v1", { title: "device" }), vid("v2")], campaigns: [{ id: "c1", name: "Fall", createdAt: 1, updatedAt: 1, deletedAt: null }] };
  const b = { videos: [vid("v1", { title: "cloud", updatedAt: 500 }), vid("v3")], campaigns: [{ id: "c2", name: "Spring", createdAt: 2, updatedAt: 2, deletedAt: null }] };
  const m = merged(V.normalizeStore(a), V.normalizeStore(b));
  assert.deepEqual(m.videos.map((v) => v.id).sort(), ["v1", "v2", "v3"]);
  assert.equal(m.videos.find((v) => v.id === "v1").title, "cloud", "the version stamped newer wins");
  assert.deepEqual(m.campaigns.map((c) => c.id).sort(), ["c1", "c2"]);
  const tie = merged(V.normalizeStore({ videos: [vid("v1", { title: "device" })] }), V.normalizeStore({ videos: [vid("v1", { title: "cloud" })] }));
  assert.equal(tie.videos[0].title, "device", "on a tie this device's copy wins");
  assert.deepEqual(m.videos.map((v) => v.id).slice(0, 2), ["v1", "v2"], "this device's order first, then what only the other had");
});

test("a deletion on one device reaches the other, and an undo wins over it", () => {
  const live = V.normalizeStore({ videos: [vid("v1")] });
  const deleted = V.normalizeStore({ videos: [vid("v1", { deletedAt: 500, updatedAt: 500 })] });
  const a = merged(deleted, live);
  assert.equal(a.videos.length, 1);
  assert.equal(a.videos[0].deletedAt, 500, "the delete wins, so the video does not come back");
  assert.equal(V.videos(a).length, 0);
  const b = merged(live, deleted);
  assert.equal(b.videos[0].deletedAt, 500, "whichever copy is 'this device', the later change wins");
  const undone = merged(V.normalizeStore({ videos: [vid("v1", { deletedAt: null, updatedAt: 900 })] }), deleted);
  assert.equal(undone.videos[0].deletedAt, null, "an undo made later wins over the delete");
});

test("lists and settings this version doesn't know are kept, and the higher version number stays", () => {
  const newer = { version: 3, settings: { cap: 5 }, videos: [], mysteryList: [{ id: "m1" }], brandNew: { x: 1 } };
  const older = { version: 1, settings: { other: true }, videos: [vid("v1")], mysteryList: [{ id: "m2" }] };
  const m = merged(newer, older);
  assert.equal(m.version, 3);
  assert.equal(merged(older, newer).version, 3, "whichever copy is this device's, the higher version number stays");
  assert.deepEqual(m.settings, { cap: 5, other: true });
  assert.deepEqual(m.mysteryList.map((x) => x.id).sort(), ["m1", "m2"]);
  assert.deepEqual(m.brandNew, { x: 1 });
  assert.equal(m.videos.length, 1);
  // evaluations, results and reports (later updates) merge by id too
  const e = merged({ evaluations: [{ id: "e1", videoId: "v1", updatedAt: 1 }], snapshots: [{ id: "s1", videoId: "v1", updatedAt: 1 }] },
    { evaluations: [{ id: "e2", videoId: "v1", updatedAt: 2 }], snapshots: [{ id: "s1", videoId: "v1", updatedAt: 9, views: 10 }] });
  assert.deepEqual(e.evaluations.map((x) => x.id).sort(), ["e1", "e2"]);
  assert.equal(e.snapshots[0].views, 10, "the newer version of a snapshot wins");
});

test("unreadable text is handled: the readable copy is used", () => {
  const good = store({ videos: [vid("v1")] });
  assert.deepEqual(ids(L.mergeText(KEY, "{oops", good).text), ["v1"]);
  assert.deepEqual(ids(L.mergeText(KEY, good, "not json").text), ["v1"]);
  assert.equal(L.mergeText(KEY, "{oops", "also bad").ok, false);
});

test("merging never drops a record from either side, whatever the mix", () => {
  const mk = (prefix, n) => V.normalizeStore({ videos: Array.from({ length: n }, (_, i) => vid(prefix + i)), campaigns: Array.from({ length: n }, (_, i) => ({ id: prefix + "c" + i, name: prefix + i, createdAt: 1, updatedAt: 1, deletedAt: null })) });
  for (const [x, y] of [[0, 0], [0, 4], [4, 0], [3, 5], [7, 7]]) {
    const m = merged(mk("a", x), mk("b", y));
    assert.equal(m.videos.length, x + y, x + "+" + y + " videos");
    assert.equal(m.campaigns.length, x + y, x + "+" + y + " campaigns");
  }
});

/* ---------------- through the real backup, two phones ---------------- */

test("a new phone gets the videos from the cloud, and a phone with unsynced videos is not overwritten by an older cloud copy", async () => {
  const cloud = createFakeFirestore();
  const A = setup({ cloud: cloud, local: { [KEY]: store({ videos: [vid("v1"), vid("v2")] }) } });
  await A.session.reconcile();
  assert.equal(A.session.status().state, "ok");
  assert.deepEqual(ids(cloudText(cloud, KEY)), ["v1", "v2"], "uploaded");

  const Bph = setup({ cloud: cloud, local: {} });
  await Bph.session.reconcile();
  assert.equal(Bph.session.status().state, "ok");
  assert.deepEqual(ids(Bph.storage.getItem(KEY)), ["v1", "v2"], "a new phone has them");

  // phone A adds v3 while offline: the upload fails, the video stays on the phone
  cloud.db.offline = true;
  A.storage.setItem(KEY, store({ videos: [vid("v1"), vid("v2"), vid("v3")] }));
  A.session.onSave(KEY); A.clock.advance(2500); await settle(); await A.session.flush();
  assert.equal(A.session.status().state, "offline");
  cloud.db.offline = false; A.session.stop();

  // the same phone opens again: its unsynced v3 is still there and ends up in the cloud
  const A2 = setup({ cloud: cloud, storage: A.storage });
  await A2.session.reconcile();
  assert.deepEqual(ids(A2.storage.getItem(KEY)), ["v1", "v2", "v3"], "nothing lost on the phone");
  assert.deepEqual(ids(cloudText(cloud, KEY)), ["v1", "v2", "v3"], "and it reaches the cloud");
});

test("two phones that each added videos meet: both phones' videos are kept, and a delete on one reaches the other", async () => {
  const cloud = createFakeFirestore();
  const base = store({ videos: [vid("v1")] });
  const A = setup({ cloud: cloud, local: { [KEY]: base } });
  await A.session.reconcile();
  const Bph = setup({ cloud: cloud, local: {} });
  await Bph.session.reconcile();
  A.session.stop(); Bph.session.stop();

  // each phone changes something while apart
  const aText = store({ videos: [vid("v1", { deletedAt: 700, updatedAt: 700 }), vid("vA")] });
  const bText = store({ videos: [vid("v1"), vid("vB")] });
  const A2 = setup({ cloud: cloud, local: { [KEY]: aText } });
  const B2 = setup({ cloud: cloud, local: { [KEY]: bText } });
  await A2.session.reconcile();
  await B2.session.reconcile();
  await A2.session.reconcile();
  const a = JSON.parse(A2.storage.getItem(KEY)), b = JSON.parse(B2.storage.getItem(KEY));
  assert.deepEqual(a.videos.map((v) => v.id).sort(), ["v1", "vA", "vB"]);
  assert.deepEqual(b.videos.map((v) => v.id).sort(), ["v1", "vA", "vB"]);
  assert.ok(a.videos.find((v) => v.id === "v1").deletedAt, "the delete made on phone A holds on both");
  assert.ok(b.videos.find((v) => v.id === "v1").deletedAt);
  assert.equal(V.videos(V.normalizeStore(b)).length, 2, "the deleted video is hidden on phone B too");
});
