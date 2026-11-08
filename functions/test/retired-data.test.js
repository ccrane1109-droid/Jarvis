"use strict";
// Erasing what the retired sections (Business, Marketing, Trading, AI Video) left behind. What these tests protect:
//  - ONLY the listed places are touched: other keys, other documents, and the account's other fields (such as the two-step
//    sign-in secret) are never read for deletion or deleted
//  - nothing that still-running code uses is on the lists
//  - Nutrition's AI connection is kept; the other AI connections (API keys for video, image and voice services) go
//  - a failure is reported, never hidden; erasing twice is harmless; the account is checked again after erasing
// The Firestore here is an in-memory stand-in (see fake-firestore.js), not the real thing.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const R = require("../../js/retired-data");
const { createFakeFirestore, createFakeStorage } = require("./fake-firestore");

const ROOT = path.join(__dirname, "..", "..");
const UID = "u1";
const KEPT_LOCAL = ["jarvisWorkouts", "jarvisRoutines", "jarvisNutritionLog", "jarvisNutritionRecipes", "jarvisHabits", "jarvisTasks", "jarvisGoals", "jarvisCalories",
  "jarvisCalendarEvents", "jarvisCalendarSettings", "jarvisDiscipline", "jarvisWakeCheck", "jarvisGroceryList", "jarvisBackupMeta", "jarvisBackupDevice", "jarvisLastBriefingDate"];
const conn = (id, kind) => ({ id: id, kind: kind, name: id, endpointUrl: "https://x.example", apiKey: "SECRET-" + id });

/* ---------------- the lists themselves ---------------- */

test("nothing the app still uses is on an erase list, and the retired keys are gone from the code that stays", () => {
  const used = {};
  fs.readdirSync(path.join(ROOT, "js")).filter((f) => f.endsWith(".js") && f !== "retired-data.js").forEach((f) => {
    (fs.readFileSync(path.join(ROOT, "js", f), "utf8").match(/"jarvis[A-Za-z]+"/g) || []).forEach((m) => { (used[m.slice(1, -1)] = used[m.slice(1, -1)] || []).push(f); });
  });
  R.LOCAL_KEYS.concat(R.SYNCED_FIELDS, [R.BACKUP_DOC]).forEach((k) => assert.equal(used[k], undefined, k + " is still used by " + (used[k] || []).join(", ")));
  assert.ok(used.jarvisVideoConnections, "Nutrition still uses the connections key, which is why it is not erased as a whole");
  assert.ok(!R.LOCAL_KEYS.includes(R.CONNECTIONS_KEY));
  assert.deepEqual(R.KEEP_CONNECTION_KINDS, ["nutrition"]);
  KEPT_LOCAL.forEach((k) => assert.ok(!R.LOCAL_KEYS.includes(k) && !R.SYNCED_FIELDS.includes(k), k + " must never be erased"));
  // the shared-document list and the backup list no longer include the retired keys
  const auth = fs.readFileSync(path.join(ROOT, "js", "auth.js"), "utf8").match(/const SYNCED_KEYS = \[([\s\S]*?)\];/)[1].match(/"jarvis[A-Za-z]+"/g).map((s) => s.slice(1, -1));
  assert.deepEqual(auth.sort(), ["jarvisCalories", "jarvisHabits"], "the original sync keeps only what is left");
  const L = require("../../js/backup-logic");
  R.LOCAL_KEYS.concat([R.BACKUP_DOC]).forEach((k) => assert.ok(!L.BACKUP_KEYS.includes(k), k + " is not backed up any more"));
  assert.ok(R.SERVER_COLLECTIONS.every((c) => !R.OWNER_COLLECTIONS.includes(c)), "a collection is either erasable from the app or reported, never both");
});

/* ---------------- this device ---------------- */

test("finding what is on the device: retired keys, and AI connections other than Nutrition's", () => {
  const none = R.scanLocal(createFakeStorage({ jarvisWorkouts: "[]", jarvisVideoConnections: JSON.stringify([conn("n1", "nutrition")]) }));
  assert.deepEqual(none, { keys: [], connections: 0, any: false });
  const some = R.scanLocal(createFakeStorage({ jarvisBusiness: "{}", jarvisPaperTrades: "[]", jarvisInsightSocialKey: "x", jarvisWorkouts: "[]",
    jarvisVideoConnections: JSON.stringify([conn("n1", "nutrition"), conn("s1", "script"), conn("v1", "clipVideo")]) }));
  assert.deepEqual(some.keys, ["jarvisBusiness", "jarvisPaperTrades", "jarvisInsightSocialKey"]);
  assert.equal(some.connections, 2);
  assert.equal(some.any, true);
  assert.equal(R.scanLocal(createFakeStorage({ jarvisVideoConnections: JSON.stringify([conn("s1", "voiceover")]) })).any, true, "a lone retired connection counts");
  assert.equal(R.scanLocal(createFakeStorage({ jarvisVideoConnections: "{not json" })).any, false, "an unreadable list is not counted, so it is never touched");
});

test("erasing on the device removes exactly the retired keys and the retired connections", () => {
  const initial = { jarvisBusiness: "{}", jarvisMarketing: "{}", jarvisMarketingLastSync: "1", jarvisInsightSocialKey: "KEY", jarvisTradingWatchlist: "[]", jarvisPaperTrades: "[]",
    jarvisTradingJournal: "[]", jarvisTradingSettings: "{}", jarvisVideo: "{}", jarvisVideoStudio: "{}", jarvisVideoIntel: "{}",
    jarvisVideoConnections: JSON.stringify([conn("s1", "script"), conn("n1", "nutrition"), conn("i1", "image"), conn("n2", "nutrition")]) };
  KEPT_LOCAL.forEach((k) => { initial[k] = JSON.stringify({ keep: k }); });
  const st = createFakeStorage(initial);
  const r = R.eraseLocal(st);
  assert.equal(r.ok, true);
  assert.deepEqual(r.removed.sort(), R.LOCAL_KEYS.slice().sort());
  assert.equal(r.connectionsRemoved, 2);
  R.LOCAL_KEYS.forEach((k) => assert.equal(st.getItem(k), null, k + " is gone"));
  KEPT_LOCAL.forEach((k) => assert.equal(st.getItem(k), JSON.stringify({ keep: k }), k + " is untouched, byte for byte"));
  const left = JSON.parse(st.getItem("jarvisVideoConnections"));
  assert.deepEqual(left.map((c) => c.id), ["n1", "n2"], "both Nutrition connections stay, with their keys");
  assert.equal(left[0].apiKey, "SECRET-n1");
  const again = R.eraseLocal(st);
  assert.deepEqual([again.ok, again.removed, again.connectionsRemoved], [true, [], 0], "erasing twice is harmless");
  assert.equal(R.scanLocal(st).any, false);
});

test("a key the phone will not remove is reported, the rest are still removed, and an unreadable connections list is left alone", () => {
  const st = createFakeStorage({ jarvisBusiness: "{}", jarvisVideo: "{}", jarvisVideoConnections: "{not json" });
  const orig = st.removeItem;
  st.removeItem = (k) => { if (k === "jarvisBusiness") throw new Error("nope"); return orig(k); };
  const r = R.eraseLocal(st);
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, ["jarvisBusiness"]);
  assert.deepEqual(r.removed, ["jarvisVideo"]);
  assert.equal(st.getItem("jarvisVideoConnections"), "{not json", "what can't be read is not rewritten");
  // a remove that silently does nothing is caught too
  const st2 = createFakeStorage({ jarvisBusiness: "{}" });
  st2.removeItem = () => {};
  assert.deepEqual(R.eraseLocal(st2).errors, ["jarvisBusiness"]);
  // saving the shorter connections list fails
  const st3 = createFakeStorage({ jarvisVideoConnections: JSON.stringify([conn("s1", "script"), conn("n1", "nutrition")]) });
  st3.setItem = () => { throw new Error("quota"); };
  const r3 = R.eraseLocal(st3);
  assert.deepEqual(r3.errors, ["jarvisVideoConnections"]);
  assert.equal(r3.connectionsRemoved, 0);
});

test("the AI Video files database is deleted, and every way that can go wrong is reported rather than hanging", async () => {
  const idb = (mode) => ({ deleteDatabase: (name) => { const req = {}; setImmediate(() => { if (mode === "ok") req.onsuccess(); else if (mode === "error") req.onerror(); else req.onblocked(); }); req.name = name; return req; } });
  assert.deepEqual(await R.eraseIndexedDb(idb("ok")), { ok: true, deleted: ["jarvisVideoBlobs"], errors: [] });
  assert.deepEqual(await R.eraseIndexedDb(idb("error")), { ok: false, deleted: [], errors: ["jarvisVideoBlobs"] });
  assert.deepEqual(await R.eraseIndexedDb(idb("blocked")), { ok: false, deleted: [], errors: ["jarvisVideoBlobs"] });
  assert.equal((await R.eraseIndexedDb({ deleteDatabase() { throw new Error("denied"); } })).ok, false);
  assert.equal((await R.eraseIndexedDb(undefined)).ok, true, "no browser database support: nothing to erase");
});

test("the remembered progress is read back safely", () => {
  const st = createFakeStorage({});
  assert.deepEqual(R.readState(st), { localDone: false, cloudDone: false });
  assert.equal(R.writeState(st, { localDone: true, cloudDone: false }), true);
  assert.deepEqual(R.readState(st), { localDone: true, cloudDone: false });
  st.setItem(R.STATE_KEY, "{oops");
  assert.deepEqual(R.readState(st), { localDone: false, cloudDone: false });
  const full = createFakeStorage({}, 5);
  assert.equal(R.writeState(full, { localDone: true, cloudDone: true }), false, "a full phone reports it could not remember");
});

/* ---------------- the account ---------------- */

const path_ = (...s) => ["users", UID].concat(s).join("/");
function seededAccount() {
  const cloud = createFakeFirestore();
  const set = (p, v) => cloud.db.store.set(p, v);
  set("users/" + UID, { totpSecret: "KEEP-2FA", store: { jarvisHabits: [{ id: "h1" }], jarvisCalories: { a: 1 }, jarvisBusiness: { p: 1 }, jarvisTradingWatchlist: [1], jarvisPaperTrades: [2],
    jarvisTradingJournal: [3], jarvisTradingSettings: { s: 1 }, jarvisVideo: { g: [] }, jarvisVideoStudio: { projects: [] }, jarvisMarketing: { ideas: [] } } });
  set(path_("appData", "jarvisVideoIntel"), { parts: 2, chars: 10, hash: "h" });
  set(path_("appData", "jarvisVideoIntel~0"), { text: "aaa" });
  set(path_("appData", "jarvisVideoIntel~1"), { text: "bbb" });
  set(path_("appData", "jarvisWorkouts"), { parts: 1, chars: 3, hash: "w" });
  set(path_("appData", "jarvisWorkouts~0"), { text: "[1]" });
  set(path_("appData", "jarvisNutritionLog"), { parts: 1, chars: 2, hash: "n" });
  set(path_("marketing", "settings"), { monthlyBudgetUsd: 20 });
  set(path_("marketingIdeas", "i1"), { title: "x" });
  set(path_("marketingIdeas", "i2"), { title: "y" });
  set(path_("marketingFindings", "f1"), { note: "z" });
  set(path_("marketingSnapshots", "h1"), { latest: {} });     // written only by the old server: cannot be erased from the app
  set(path_("marketingUsage", "2026-10"), { creditsUsed: 5 });
  set(path_("reminders", "r1"), { text: "unrelated" });
  set("users/other-user", { store: { jarvisBusiness: { theirs: true } } });
  set("users/other-user/marketingIdeas/o1", { title: "someone else's" });
  return cloud;
}
const deps = (cloud) => ({ fb: cloud.fb, db: {}, uid: UID });
const snapshotOf = (cloud) => JSON.stringify(Array.from(cloud.db.store.entries()).sort());

test("finding what is in the account reads only, and reports each place", async () => {
  const cloud = seededAccount();
  const before = snapshotOf(cloud);
  const r = await R.scanCloud(deps(cloud));
  assert.deepEqual(r.fields.sort(), R.SYNCED_FIELDS.slice().sort());
  assert.equal(r.backup, true);
  assert.deepEqual(r.docs, { marketing: ["settings"], marketingIdeas: ["i1", "i2"], marketingFindings: ["f1"] });
  assert.equal(r.any, true);
  assert.equal(snapshotOf(cloud), before, "scanning changes nothing");
  assert.equal(cloud.db.writes.length, 0);
  const clean = await R.scanCloud(deps(createFakeFirestore()));
  assert.deepEqual([clean.fields, clean.backup, clean.any], [[], false, false], "an account with none of it");
});

test("erasing from the account removes the retired data and nothing else", async () => {
  const cloud = seededAccount();
  const r = await R.eraseCloud(deps(cloud));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.erased, { fields: 8, backupParts: 2, docs: 4 });
  assert.deepEqual(r.leftBehind, R.SERVER_COLLECTIONS, "the server-written records are reported, not touched");
  const doc = cloud.db.store.get("users/" + UID);
  assert.deepEqual(Object.keys(doc.store).sort(), ["jarvisCalories", "jarvisHabits"], "only the retired fields left the shared document");
  assert.deepEqual(doc.store.jarvisHabits, [{ id: "h1" }]);
  assert.equal(doc.totpSecret, "KEEP-2FA", "the two-step sign-in secret is untouched");
  ["jarvisVideoIntel", "jarvisVideoIntel~0", "jarvisVideoIntel~1"].forEach((id) => assert.equal(cloud.db.store.has(path_("appData", id)), false, id));
  ["jarvisWorkouts", "jarvisWorkouts~0", "jarvisNutritionLog"].forEach((id) => assert.equal(cloud.db.store.has(path_("appData", id)), true, "other backups stay: " + id));
  ["marketing/settings", "marketingIdeas/i1", "marketingIdeas/i2", "marketingFindings/f1"].forEach((p) => assert.equal(cloud.db.store.has(path_(...p.split("/"))), false, p));
  assert.equal(cloud.db.store.has(path_("marketingSnapshots", "h1")), true, "a record only the server may write is not attempted");
  assert.equal(cloud.db.store.has(path_("marketingUsage", "2026-10")), true);
  assert.equal(cloud.db.store.has(path_("reminders", "r1")), true, "unrelated data stays");
  assert.deepEqual(cloud.db.store.get("users/other-user"), { store: { jarvisBusiness: { theirs: true } } }, "another account is never touched");
  assert.equal(cloud.db.store.has("users/other-user/marketingIdeas/o1"), true);
  // every single write went to an allowed place
  const allowed = [(p) => p === "users/" + UID, (p) => p.startsWith(path_("appData", "jarvisVideoIntel")), (p) => /\/(marketing|marketingIdeas|marketingFindings)\//.test(p)];
  cloud.db.writes.forEach((w) => assert.ok(allowed.some((f) => f(w.path)), "unexpected write: " + w.op + " " + w.path));
  assert.ok(cloud.db.writes.filter((w) => w.op === "set").every((w) => w.merge && w.path === "users/" + UID), "the only write is a merge into the shared document");
  assert.equal((await R.scanCloud(deps(cloud))).any, false, "and a fresh look finds nothing");
});

test("erasing an account that has nothing makes no writes, and erasing twice is harmless", async () => {
  const empty = createFakeFirestore();
  const r = await R.eraseCloud(deps(empty));
  assert.deepEqual([r.ok, r.erased], [true, { fields: 0, backupParts: 0, docs: 0 }]);
  assert.equal(empty.db.writes.length, 0, "no document is created just to erase nothing");
  const cloud = seededAccount();
  await R.eraseCloud(deps(cloud));
  const writes = cloud.db.writes.length;
  const again = await R.eraseCloud(deps(cloud));
  assert.equal(again.ok, true);
  assert.equal(cloud.db.writes.length, writes, "the second time there is nothing to do");
});

test("a backup that claims a strange number of parts only ever deletes its own parts", async () => {
  const cloud = createFakeFirestore();
  cloud.db.store.set(path_("appData", "jarvisVideoIntel"), { parts: 99999 });
  cloud.db.store.set(path_("appData", "jarvisVideoIntel~0"), { text: "a" });
  cloud.db.store.set(path_("appData", "jarvisWorkouts~0"), { text: "keep" });
  const r = await R.eraseCloud(deps(cloud));
  assert.equal(r.erased.backupParts, 0, "a nonsense part count is not trusted");
  assert.equal(cloud.db.store.has(path_("appData", "jarvisVideoIntel")), false, "the manifest still goes");
  assert.equal(cloud.db.store.has(path_("appData", "jarvisWorkouts~0")), true);
  cloud.db.writes.forEach((w) => assert.ok(w.path.startsWith(path_("appData", "jarvisVideoIntel")), w.path));
});

test("when the account can't be reached or a delete fails, it says so and stops, leaving the rest alone", async () => {
  const offline = seededAccount();
  offline.db.offline = true;
  const r = await R.eraseCloud(deps(offline));
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /Couldn't erase it from your account \(unavailable\)/);
  assert.equal(offline.db.writes.length, 0);
  assert.equal(offline.db.store.has(path_("marketingIdeas", "i1")), true, "nothing was deleted");

  const partial = seededAccount();
  const realDelete = partial.fb.deleteDoc;
  partial.fb.deleteDoc = (ref) => (ref.path === path_("marketingIdeas", "i2") ? Promise.reject(Object.assign(new Error("denied"), { code: "permission-denied" })) : realDelete(ref));
  const p = await R.eraseCloud(deps(partial));
  assert.equal(p.ok, false);
  assert.match(p.errors[0], /permission-denied/);
  assert.equal(partial.db.store.has(path_("marketingIdeas", "i2")), true, "the one that failed is still there, honestly reported");
  assert.equal(partial.db.store.has(path_("marketingFindings", "f1")), true, "and it stopped there, so the later ones were not attempted");

  // a delete that claims success but leaves the data: caught by looking again
  const liar = seededAccount();
  liar.fb.deleteDoc = () => Promise.resolve();
  const l = await R.eraseCloud(deps(liar));
  assert.equal(l.ok, false);
  assert.match(l.errors[0], /still there/);
});

test("the sentence about what is still stored names the right removed sections, in a fixed order, each once", () => {
  assert.deepEqual(R.areasOf(["jarvisVideoIntel", "jarvisBusiness", "jarvisPaperTrades", "jarvisVideoConnections", "jarvisWorkouts"]), ["Business", "Marketing", "Trading", "AI Video"]);
  assert.deepEqual(R.areasOf(["jarvisVideo", "jarvisVideoStudio"]), ["AI Video"]);
  assert.deepEqual(R.areasOf(["jarvisMarketing", "jarvisMarketingLastSync", "jarvisInsightSocialKey"]), ["Marketing"]);
  assert.deepEqual(R.areasOf(["jarvisTradingJournal", "jarvisTradingWatchlist"]), ["Trading"]);
  assert.deepEqual(R.areasOf([]), []);
  assert.deepEqual(R.areasOf(undefined), []);
  assert.equal(R.areaOf("jarvisWorkouts"), "", "something that isn't a removed section's key names no section");
  R.LOCAL_KEYS.forEach((k) => assert.ok(R.areaOf(k), k + " belongs to a removed section"));
  R.SYNCED_FIELDS.forEach((k) => assert.ok(R.areaOf(k), k + " belongs to a removed section"));
});
