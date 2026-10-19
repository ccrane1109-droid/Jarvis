"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const push = require("../lib/push");
const { OWNER, fakeDb, fakeWebPush, deps } = require("./helpers");

const NOW = new Date("2026-10-14T15:00:00Z");
const P256 = "B".repeat(87);
const AUTH = "a".repeat(22);
const APPLE = "https://web.push.apple.com/QOcdd2TmZ1abc";
const sub = (endpoint) => ({ endpoint: endpoint || APPLE, keys: { p256dh: P256, auth: AUTH }, expirationTime: null });
const pdeps = (over, wp) => deps(Object.assign({ now: () => NOW, webpush: wp || fakeWebPush(), vapidPublic: "PUBKEY".padEnd(20, "x"), vapidPrivate: "PRIVKEY".padEnd(20, "y") }, over || {}));
const call = (d, data, uid, queue) => push.handle(uid === undefined ? OWNER : uid, data, d, queue || (async () => {}));
const subDocs = (d) => [...d.db.store.keys()].filter((k) => k.startsWith(`users/${OWNER}/pushSubscriptions/`));

test("only the push services' own addresses are accepted, over https, without look-alikes", () => {
  const ok = [
    "https://web.push.apple.com/abc", "https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://db5p.notify.windows.com/?token=abc", "https://api.push.apple.com/3/device/abc"
  ];
  ok.forEach((e) => assert.equal(push.validateSubscription(sub(e)).ok, true, e));
  const bad = [
    "http://web.push.apple.com/abc", "https://web.push.apple.com.evil.example/abc", "https://evilweb.push.apple.com.example/x",
    "https://fcm.googleapis.com.evil.example/x", "https://notfcm.googleapis.com/x", "https://user:pw@web.push.apple.com/abc",
    "https://169.254.169.254/latest/meta-data", "https://localhost/x", "ftp://web.push.apple.com/x", "javascript:alert(1)", "", "x".repeat(700), 5, null
  ];
  bad.forEach((e) => assert.equal(push.validateSubscription({ endpoint: e, keys: { p256dh: P256, auth: AUTH } }).ok, false, String(e)));
  assert.equal(push.validateSubscription({ endpoint: APPLE, keys: { p256dh: "short", auth: AUTH } }).ok, false);
  assert.equal(push.validateSubscription({ endpoint: APPLE, keys: { p256dh: P256, auth: "bad key!" } }).ok, false);
  assert.equal(push.validateSubscription({ endpoint: APPLE }).ok, false);
  assert.equal(push.validateSubscription(null).ok, false);
  assert.deepEqual(Object.keys(push.validateSubscription(Object.assign(sub(), { evil: 1 })).value).sort(), ["endpoint", "keys"]);
  assert.equal(push.platformOf("web.push.apple.com"), "Apple");
  assert.equal(push.platformOf("fcm.googleapis.com"), "Google");
  assert.equal(push.platformOf("db5p.notify.windows.com"), "Microsoft");
  assert.equal(push.platformOf("api.push.apple.com"), "Apple");
  assert.equal(push.platformOf("updates.push.services.mozilla.com"), "Mozilla");
  assert.equal(push.platformOf("example.com"), "Other");
});

test("the message is small and plain, and the lock screen shows only what you allowed", () => {
  const text = push.buildPayload({ id: "abc_123", kind: "reminder", title: "  Drink   water ", body: "x".repeat(400), ts: "2026-10-14T17:00:00.000Z" });
  const p = JSON.parse(text);
  assert.deepEqual(Object.keys(p).sort(), ["body", "id", "kind", "tag", "title", "ts", "url", "v"]);
  assert.deepEqual([p.v, p.title, p.body.length, p.tag, p.kind, p.url], [1, "Drink water", 160, "abc_123", "reminder", "./index.html?reminder=abc_123"]);
  assert.ok(Buffer.byteLength(text) < 1500);
  assert.equal(JSON.parse(push.buildPayload({ id: "t", kind: "test", title: "" })).title, "JARVIS");

  const plain = push.lockScreenText({ title: "Creatine", notes: "with water", privateText: false }, { label: "Creatine" });
  assert.deepEqual(plain, { title: "Creatine", body: "with water" });
  assert.equal(push.lockScreenText({ title: "Creatine", notes: "", privateText: false }, null).body, "Reminder from JARVIS");
  const hidden = push.lockScreenText({ title: "Lisinopril 10mg", notes: "after breakfast", privateText: true }, { label: "Medication" });
  assert.deepEqual(hidden, { title: "Medication reminder", body: "Open JARVIS to see it." });
  assert.ok(!JSON.stringify(hidden).includes("Lisinopril") && !JSON.stringify(hidden).includes("breakfast"), "a private reminder shows neither its name nor its notes");

  const topic = push.topicFor("reminder_20261014170000000");
  assert.ok(topic.length <= 32 && /^[A-Za-z0-9_-]+$/.test(topic));
  assert.equal(topic, push.topicFor("reminder_20261014170000000"));
  assert.notEqual(topic, push.topicFor("reminder_20261015170000000"));
});

test("push service answers are sorted into gone, worth retrying, and neither", () => {
  const c = (statusCode, body) => push.classifyError(Object.assign(new Error("x"), { statusCode, body }));
  assert.deepEqual([c(410).gone, c(404).gone, c(410).retryable], [true, true, false]);
  [0, 429, 500, 502, 503].forEach((s) => assert.equal(s === 0 ? push.classifyError(new Error("socket hang up")).retryable : c(s).retryable, true, String(s)));
  [400, 401, 403, 413].forEach((s) => assert.deepEqual([c(s).gone, c(s).retryable], [false, false], String(s)));
  assert.match(c(403, "BadJwtToken").message, /403.*BadJwtToken/);
  assert.match(push.classifyError(new Error("ETIMEDOUT")).message, /ETIMEDOUT/);
});

test("turning a phone on stores it once; the address and keys never come back to the page", async () => {
  const d = pdeps();
  const first = await call(d, { action: "subscribe", subscription: sub() });
  assert.deepEqual([first.ok, first.devices, first.platform], [true, 1, "Apple"]);
  const again = await call(d, { action: "subscribe", subscription: sub() });
  assert.equal(again.devices, 1, "the same phone twice is still one phone");
  assert.equal(subDocs(d).length, 1);
  const stored = d.db.store.get(subDocs(d)[0]);
  assert.deepEqual([stored.endpoint, stored.keys.auth, stored.platform, stored.failures], [APPLE, AUTH, "Apple", 0]);

  const cfg = await call(d, { action: "config", endpoint: APPLE });
  assert.deepEqual([cfg.ok, cfg.keysReady, cfg.thisDevice, cfg.devices.length, cfg.devices[0].platform], [true, true, true, 1, "Apple"]);
  assert.equal(cfg.publicKey, "PUBKEY".padEnd(20, "x"));
  const text = JSON.stringify(cfg);
  assert.ok(!text.includes(APPLE) && !text.includes(AUTH) && !text.includes(P256) && !text.includes("PRIVKEY"), "nothing secret is sent to the page");
  assert.equal((await call(d, { action: "config", endpoint: "https://fcm.googleapis.com/other" })).thisDevice, false);
  assert.equal((await call(d, { action: "config" })).thisDevice, null);

  assert.equal((await call(d, { action: "unsubscribe", endpoint: APPLE })).ok, true);
  assert.equal(subDocs(d).length, 0);
  assert.equal((await call(d, { action: "unsubscribe", endpoint: APPLE })).ok, true, "twice is harmless");
});

test("subscribing is checked: owner only, valid address, keys set, ten phones at most", async () => {
  const d = pdeps();
  await assert.rejects(call(d, { action: "subscribe", subscription: sub() }, null), (e) => e.code === "unauthenticated");
  await assert.rejects(call(d, { action: "subscribe", subscription: sub() }, "intruder"), (e) => e.code === "permission-denied");
  await assert.rejects(call(d, { action: "subscribe", subscription: sub("https://evil.example/x") }), (e) => e.code === "invalid-argument" && /isn't one JARVIS sends to/.test(e.message));
  await assert.rejects(call(pdeps({ vapidPrivate: "" }), { action: "subscribe", subscription: sub() }), (e) => e.code === "failed-precondition" && /keys aren't set up/.test(e.message));
  await assert.rejects(call(d, { action: "nope" }), (e) => e.code === "invalid-argument");
  for (let i = 0; i < push.MAX_DEVICES; i++) await call(d, { action: "subscribe", subscription: sub("https://web.push.apple.com/device" + i) });
  await assert.rejects(call(d, { action: "subscribe", subscription: sub("https://web.push.apple.com/one-too-many") }), (e) => e.code === "resource-exhausted");
  assert.equal((await call(d, { action: "subscribe", subscription: sub("https://web.push.apple.com/device3") })).ok, true, "an existing phone can still refresh");
  const noKeys = await call(pdeps({ vapidPublic: "", vapidPrivate: "" }), { action: "config" });
  assert.deepEqual([noKeys.keysReady, noKeys.publicKey], [false, null]);
});

test("an immediate test sends one small message with the right options and records the result", async () => {
  const wp = fakeWebPush();
  const d = pdeps({}, wp);
  await call(d, { action: "subscribe", subscription: sub() });
  const res = await call(d, { action: "test", delaySeconds: 0 });
  assert.deepEqual([res.ok, res.mode, res.devices, res.accepted, res.gone], [true, "now", 1, 1, 0]);
  assert.equal(wp.calls.length, 1);
  const c = wp.calls[0];
  assert.deepEqual(wp.vapid.subject, push.VAPID_SUBJECT);
  assert.ok(wp.vapid.subject.startsWith("https://") && !/@/.test(wp.vapid.subject), "the contact sent to push services is a web address, not an email");
  assert.deepEqual([c.options.TTL, c.options.urgency, c.options.timeout], [3600, "high", 10000]);
  assert.ok(c.options.topic.length <= 32);
  assert.equal(c.subscription.endpoint, APPLE);
  assert.equal(JSON.parse(c.payload).title, "JARVIS test");
  const stored = d.db.store.get(subDocs(d)[0]);
  assert.equal(stored.lastSuccessAt, NOW.toISOString());
  assert.ok(!JSON.stringify(d.logs).includes("PRIVKEY") && !JSON.stringify(res).includes(P256));
});

test("tests are limited to one every 15 seconds, and need a phone and keys", async () => {
  let clock = NOW;
  const d = pdeps({ now: () => clock });
  await assert.rejects(call(d, { action: "test" }), (e) => e.code === "failed-precondition" && /No phone is set up/.test(e.message));
  await call(d, { action: "subscribe", subscription: sub() });
  await call(d, { action: "test" });
  await assert.rejects(call(d, { action: "test" }), (e) => e.code === "resource-exhausted");
  clock = new Date(NOW.getTime() + 16000);
  assert.equal((await call(d, { action: "test" })).ok, true);
  await assert.rejects(call(pdeps({ vapidPublic: "" }), { action: "test" }), (e) => e.code === "failed-precondition");
});

test("a phone the push service has dropped is forgotten; a temporary failure is remembered, not forgotten", async () => {
  const wp = fakeWebPush(() => ({ error: { statusCode: 410 } }));
  const d = pdeps({}, wp);
  await call(d, { action: "subscribe", subscription: sub() });
  const res = await call(d, { action: "test" });
  assert.deepEqual([res.accepted, res.gone, res.devices], [0, 1, 1]);
  assert.equal(subDocs(d).length, 0, "the dead address is deleted");

  const flaky = fakeWebPush(() => ({ error: { statusCode: 503 } }));
  const d2 = pdeps({}, flaky);
  await call(d2, { action: "subscribe", subscription: sub() });
  const r2 = await call(d2, { action: "test" });
  assert.deepEqual([r2.accepted, r2.gone, r2.retryable], [0, 0, true]);
  assert.match(r2.errors[0], /503/);
  const kept = d2.db.store.get(subDocs(d2)[0]);
  assert.deepEqual([kept.failures, /503/.test(kept.lastError)], [1, true]);
});

test("the 90-second test goes through the queue instead of sending now", async () => {
  const wp = fakeWebPush();
  const d = pdeps({}, wp);
  await call(d, { action: "subscribe", subscription: sub() });
  const queued = [];
  const res = await call(d, { action: "test", delaySeconds: 90 }, OWNER, async (uid, dd, ev) => { queued.push(ev); });
  assert.deepEqual([res.mode, res.dueAt, wp.calls.length], ["scheduled", "2026-10-14T15:01:30.000Z", 0]);
  assert.deepEqual([queued[0].kind, queued[0].deliverAt, queued[0].lockTitle, queued[0].reminderId], ["test", res.dueAt, "JARVIS test", null]);
});
