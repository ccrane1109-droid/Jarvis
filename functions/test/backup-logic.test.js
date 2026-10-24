"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const B = require("../../js/backup-logic");

const ROOT = path.join(__dirname, "..", "..");
// Keys the original sync already covers, read from the real file so this can't drift.
const SYNCED = (function () {
  const src = fs.readFileSync(path.join(ROOT, "js", "auth.js"), "utf8");
  const block = src.match(/const SYNCED_KEYS = \[([\s\S]*?)\];/)[1];
  return block.match(/"jarvis[A-Za-z]+"/g).map((s) => s.slice(1, -1));
})();
// Keys that stay on the device on purpose: secrets, flags, caches, one-level undo, the backup's own bookkeeping.
const DEVICE_ONLY = ["jarvisNutritionMigrated", "jarvisPushCheck", "jarvisRemindersCache", "jarvisMarketingLastSync", "jarvisLastBriefingDate",
  "jarvisVideoConnections", "jarvisInsightSocialKey", "jarvisVideoBlobs", "jarvisGroceryChangelog",
  "jarvisBackupMeta", "jarvisBackupSafety", "jarvisBackupDevice",
  "jarvisDisciplineDrafts"]; // unsaved typing in the Discipline forms; stays on the phone

test("every storage key the app uses is synced, backed up, or deliberately device-only", () => {
  const used = new Set();
  fs.readdirSync(path.join(ROOT, "js")).filter((f) => f.endsWith(".js")).forEach((f) => {
    (fs.readFileSync(path.join(ROOT, "js", f), "utf8").match(/"jarvis[A-Z][A-Za-z]+"/g) || []).forEach((s) => used.add(s.slice(1, -1)));
  });
  const covered = new Set(SYNCED.concat(B.BACKUP_KEYS, DEVICE_ONLY));
  const loose = Array.from(used).filter((k) => !covered.has(k) && !/^jarvis(Backup|Sync)/.test(k)).sort();
  assert.deepEqual(loose, [], "these keys have no cloud copy and aren't marked device-only: " + loose.join(", "));
});

test("the backup list overlaps neither the original sync nor the secrets", () => {
  assert.equal(new Set(B.BACKUP_KEYS).size, B.BACKUP_KEYS.length, "no repeats");
  assert.deepEqual(B.BACKUP_KEYS.filter((k) => SYNCED.includes(k)), [], "no key is stored in two places");
  assert.deepEqual(B.BACKUP_KEYS.filter((k) => /Connections|SocialKey|Blobs/.test(k)), [], "no secrets");
  ["jarvisNutritionLog", "jarvisNutritionSavedFoods", "jarvisTasks", "jarvisGoals", "jarvisDiscipline", "jarvisGroceryPantry"].forEach((k) => assert.ok(B.BACKUP_KEYS.includes(k), k));
});

test("every backed-up key has a merge rule that fits its shape", () => {
  B.BACKUP_KEYS.forEach((k) => {
    const r = B.mergeText(k, "{}", "{}");
    assert.equal(r.ok, true, k);
  });
});

test("the fingerprint tells changes apart and carries the length", () => {
  const h = B.hashText("hello");
  assert.equal(h, B.hashText("hello"));
  assert.notEqual(h, B.hashText("hellp"));
  assert.notEqual(B.hashText("ab"), B.hashText("ba"));
  assert.match(h, /^[0-9a-f]+-5$/);
  assert.notEqual(B.hashText("é✓😀"), B.hashText("e✓😀"));
  assert.equal(B.hashText(""), B.hashText(""));
});

test("text is cut into chunks under the limit and put back together exactly, whatever it contains", () => {
  const text = JSON.stringify({ a: "x".repeat(600000), emoji: "😀✓é".repeat(1000) });
  const chunks = B.chunkText(text);
  assert.ok(chunks.length >= 3 && chunks.every((c) => c.length <= B.CHUNK_CHARS));
  assert.equal(chunks.join(""), text);
  assert.deepEqual(B.chunkText(""), [""]);
  assert.deepEqual(B.chunkText("abc", 2), ["ab", "c"]);
  assert.equal(B.partId("jarvisTasks", 2), "jarvisTasks~2");
  // Worst case for Firestore's byte limit: every character 3 bytes.
  assert.ok(Buffer.byteLength("€".repeat(B.CHUNK_CHARS)) < 1048576 - 4096, "a full chunk stays under 1 MiB even in 3-byte characters");
});

test("a stored value is checked when it is put back together", () => {
  const text = JSON.stringify({ k: "v".repeat(1000) });
  const parts = B.chunkText(text, 400);
  const manifest = { parts: parts.length, chars: text.length, hash: B.hashText(text) };
  assert.deepEqual(B.assemble(manifest, parts), { ok: true, text: text });
  assert.equal(B.assemble(manifest, [parts[0], parts[1]]).ok, false, "a missing part");
  assert.match(B.assemble(manifest, [parts[0], parts[1]]).reason, /missing part 2/);
  assert.equal(B.assemble(manifest, [parts[0], "X" + parts[1].slice(1), parts[2]]).ok, false, "altered content");
  assert.equal(B.assemble(Object.assign({}, manifest, { chars: 5 }), parts).ok, false, "wrong length");
  assert.equal(B.assemble(null, parts).ok, false);
  assert.equal(B.assemble({ parts: 0 }, []).ok, false);
});

test("what counts as no data", () => {
  ["", "  ", "null", "[]", "{}", "[ ]", " {} ", null, undefined].forEach((t) => assert.equal(B.isEmptyText(t), true, JSON.stringify(t)));
  ["[1]", "{\"a\":1}", "0", "false", "\"x\"", "not json"].forEach((t) => assert.equal(B.isEmptyText(t), false, t));
});

const CLOUD = (text, rev) => ({ hash: B.hashText(text), rev: rev === undefined ? 100 : rev });
const D = (o) => B.decide(o);

test("the sign-in decision, case by case", () => {
  const a = "[1]", b = "[1,2]", c = "[1,2,3]";
  // nothing in the cloud
  assert.equal(D({ cloud: null, localText: a, meta: null }), "push", "first backup");
  assert.equal(D({ cloud: null, localText: "[]", meta: null }), "none", "nothing to back up");
  assert.equal(D({ cloud: null, localText: null, meta: null }), "none");
  // a device with no data
  assert.equal(D({ cloud: CLOUD(a), localText: null, meta: null }), "pull", "a new phone");
  assert.equal(D({ cloud: CLOUD(a), localText: "[]", meta: null }), "pull", "storage cleared and re-created empty");
  assert.equal(D({ cloud: CLOUD(a), localText: "", meta: { rev: 100, hash: "x" } }), "pull");
  // same
  assert.equal(D({ cloud: CLOUD(a), localText: a, meta: null }), "same");
  // one side changed
  const meta = { rev: 100, hash: B.hashText(a), pendingHash: null };
  assert.equal(D({ cloud: CLOUD(b, 200), localText: a, meta: meta }), "pull", "this device unchanged; the cloud moved on");
  assert.equal(D({ cloud: CLOUD(a, 100), localText: b, meta: meta }), "push", "the cloud unchanged; this device changed");
  assert.equal(D({ cloud: CLOUD(b, 200), localText: c, meta: meta }), "merge", "both changed");
  // an earlier write whose acknowledgement was lost
  const lost = { rev: 100, hash: B.hashText(a), pendingHash: B.hashText(b) };
  assert.equal(D({ cloud: CLOUD(b, 300), localText: c, meta: lost }), "push", "the cloud holds this device's own earlier write");
  // two devices meeting with different data
  assert.equal(D({ cloud: CLOUD(b), localText: c, meta: null }), "merge", "no shared history, both have data");
  assert.equal(D({ cloud: CLOUD("[]"), localText: c, meta: null }), "merge", "the cloud copy is empty: merging keeps everything");
  // emptied on purpose
  assert.equal(D({ cloud: CLOUD(a, 100), localText: "[]", meta: meta }), "push", "emptied on this device, the cloud unchanged: that is a real change");
});

const item = (id, extra) => Object.assign({ id: id }, extra || {});
const ids = (list) => list.map((x) => x.id);

test("lists of records keep everything; the newer version of one record wins, and this device wins a tie", () => {
  const local = [item("a", { v: "local", updatedAt: 5 }), item("b", { v: "local-only" }), item("t", { v: "tie-local", createdAt: 7 })];
  const cloud = [item("a", { v: "cloud", updatedAt: 9 }), item("c", { v: "cloud-only" }), item("t", { v: "tie-cloud", createdAt: 7 })];
  const m = B.mergeById(local, cloud);
  assert.deepEqual(ids(m), ["a", "b", "t", "c"], "this device's order, then what only the cloud had");
  assert.equal(m[0].v, "cloud", "the newer one");
  assert.equal(m[2].v, "tie-local", "a tie goes to this device");
  assert.equal(B.mergeById([1, 2], [2, 3]).length, 3, "records without ids match by content");
  assert.deepEqual(B.mergeById(null, [item("x")]), [item("x")]);
  assert.deepEqual(B.mergeById([item("x")], "junk"), [item("x")]);
  assert.deepEqual(B.mergeById([], []), []);
});

test("merging never drops a record from either side", () => {
  for (let trial = 0; trial < 50; trial++) {
    const pick = () => Array.from({ length: Math.floor(Math.random() * 8) }, () => item("r" + Math.floor(Math.random() * 12), { updatedAt: Math.floor(Math.random() * 5) }));
    const l = pick(), c = pick();
    const merged = ids(B.mergeById(l, c));
    new Set(ids(l).concat(ids(c))).forEach((id) => assert.ok(merged.includes(id), "lost " + id));
  }
});

test("the food log: days match by date, meals by item id, water takes the larger count", () => {
  const local = { "2026-10-22": { water: 2, meals: { breakfast: [item("f1")], lunch: [item("f2")] } }, "2026-10-20": { water: 1, meals: { dinner: [item("only-local")] } } };
  const cloud = { "2026-10-22": { water: 5, meals: { breakfast: [item("f1"), item("f3")], snacks: [item("f4")] } }, "2026-10-21": { water: 3, meals: { lunch: [item("only-cloud")] } } };
  const m = B.mergeDateMeals(local, cloud);
  assert.deepEqual(Object.keys(m).sort(), ["2026-10-20", "2026-10-21", "2026-10-22"]);
  assert.equal(m["2026-10-22"].water, 5);
  assert.deepEqual(ids(m["2026-10-22"].meals.breakfast), ["f1", "f3"]);
  assert.deepEqual(ids(m["2026-10-22"].meals.lunch), ["f2"]);
  assert.deepEqual(ids(m["2026-10-22"].meals.snacks), ["f4"]);
  assert.deepEqual(ids(m["2026-10-20"].meals.dinner), ["only-local"]);
  assert.deepEqual(ids(m["2026-10-21"].meals.lunch), ["only-cloud"]);
});

test("the pantry, the calculator profile and settings merge sensibly", () => {
  const pantry = B.mergeMapNewest({ rice: { quantity: 1, updatedAt: 5 }, oats: { quantity: 2, updatedAt: 9 } }, { rice: { quantity: 4, updatedAt: 8 }, oats: { quantity: 9, updatedAt: 1 }, eggs: { quantity: 6, updatedAt: 1 } });
  assert.deepEqual([pantry.rice.quantity, pantry.oats.quantity, pantry.eggs.quantity], [4, 2, 6], "the newer record per item, and nothing dropped");
  assert.equal(B.mergeNewest({ w: 1, lastCalculatedAt: 5 }, { w: 2, lastCalculatedAt: 9 }).w, 2);
  assert.equal(B.mergeNewest({ w: 1, lastCalculatedAt: 9 }, { w: 2, lastCalculatedAt: 5 }).w, 1);
  assert.equal(B.mergeNewest({ w: 1 }, { w: 2 }).w, 1, "a tie goes to this device");
  const goals = B.mergeObjects({ mode: "bulking", cutting: { calories: 2000 } }, { mode: "cutting", cutting: { calories: 1800, protein: 150 }, bulking: { calories: 3000 } });
  assert.equal(goals.mode, "bulking", "this device's setting wins where both have one");
  assert.deepEqual(goals.cutting, { calories: 2000, protein: 150 }, "and settings only the cloud had are kept");
  assert.deepEqual(goals.bulking, { calories: 3000 });
});

test("the Discipline store merges rules, the avoiding log, days and program progress", () => {
  const day = (savedAt, text) => ({ type: "normal", morning: { keyTask: { text: text, done: false }, savedAt: 1, editedAt: 1 }, review: savedAt ? { savedAt: savedAt } : null });
  const local = {
    settings: { phoneLimit: 4 }, timer: { startedAt: 5 },
    rules: [{ id: "a", text: "Phone on the charger" }, { id: "b", text: "Homework first" }],
    avoid: [{ at: 30, date: "2026-10-22" }, { at: 10, date: "2026-10-21" }],
    program: { start: "2026-10-22", done: { "1": [2], "2": [0] } },
    days: { "2026-10-22": day(50, "local"), "2026-10-21": day(10, "local-old") }
  };
  const cloud = {
    settings: { phoneLimit: 5 }, timer: null,
    rules: [{ id: "x", text: "phone on the CHARGER" }, { id: "c", text: "In bed by 9" }],
    avoid: [{ at: 20, date: "2026-10-21" }, { at: 10, date: "2026-10-21" }],
    program: { start: "2026-10-20", done: { "1": [0], "3": [1] } },
    days: { "2026-10-22": day(40, "cloud-older"), "2026-10-21": day(99, "cloud-newer"), "2026-10-19": day(5, "cloud-only") }
  };
  const m = B.mergeDiscipline(local, cloud);
  assert.deepEqual(m.rules.map((r) => r.text), ["Phone on the charger", "Homework first", "In bed by 9"], "rules by text, ignoring case");
  assert.deepEqual(m.avoid.map((a) => a.at), [10, 20, 30], "the avoiding log by time, no repeats, in order");
  assert.deepEqual(m.settings, { phoneLimit: 4 }, "this device's settings");
  assert.deepEqual(m.timer, { startedAt: 5 }, "this device's running timer");
  assert.equal(m.program.start, "2026-10-22");
  assert.deepEqual(m.program.done, { "1": [0, 2], "2": [0], "3": [1] }, "ticked missions from both");
  assert.equal(m.days["2026-10-22"].morning.keyTask.text, "local", "the day touched last wins: this device's");
  assert.equal(m.days["2026-10-21"].morning.keyTask.text, "cloud-newer", "...or the cloud's");
  assert.ok(m.days["2026-10-19"], "a day only the cloud had is kept");
  const many = B.mergeDiscipline({ rules: [1, 2, 3].map((n) => ({ text: "l" + n })) }, { rules: [1, 2, 3].map((n) => ({ text: "c" + n })) });
  assert.equal(many.rules.length, 5, "never more than 5 rules");
});

test("merging two stored copies: unreadable text is handled, and nothing is dropped", () => {
  assert.equal(B.mergeText("jarvisTasks", "not json", "also not").ok, false);
  assert.equal(B.mergeText("jarvisTasks", "not json", "[{\"id\":\"c\"}]").text, "[{\"id\":\"c\"}]", "an unreadable device copy gives way to the cloud's");
  assert.equal(B.mergeText("jarvisTasks", "[{\"id\":\"l\"}]", "{{").text, "[{\"id\":\"l\"}]", "and the other way round");
  const r = B.mergeText("jarvisTasks", "[{\"id\":\"l\"}]", "[{\"id\":\"c\"}]");
  assert.deepEqual(JSON.parse(r.text).map((x) => x.id), ["l", "c"]);
  assert.equal(B.mergeText("jarvisSomethingNew", "{\"a\":1}", "{\"b\":2}").text, "{\"b\":2,\"a\":1}".replace("{\"b\":2,\"a\":1}", JSON.stringify({ b: 2, a: 1 })), "an unknown key still merges as settings, keeping both");
});
