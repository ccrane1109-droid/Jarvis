/* ==========================================================================
   Web Push (owner only, server side): remembers the phones you turned
   notifications on for, and sends them messages through the browser makers'
   push services (Apple's, Google's, Mozilla's, Microsoft's). No money and no
   third party beyond those services.

   Keys: the VAPID key pair identifies this server to the push services. The
   private key is a Firebase secret; the public key goes to the browser so it
   can subscribe. Neither is ever stored in Firestore or logged.

   Firestore (written only by the server):
     users/{uid}/pushSubscriptions/{id}   { endpoint, keys, platform, createdAt, lastSeenAt, lastSuccessAt, lastError, failures }
     users/{uid}/reminderState/push       { lastTestAt }

   A subscription's endpoint is an address anyone holding it can send to, so
   it never leaves the server, and only addresses on the known push services
   are accepted (the server will make a request to whatever it is given).

   "Accepted by the push service" is the most this code can know. Whether the
   phone then showed the notification can only be seen on the phone.
   ========================================================================== */

"use strict";

const crypto = require("node:crypto");
const insight = require("./insight");

const MAX_DEVICES = 10;
const PAYLOAD_MAX_BYTES = 1500;
const TTL_SECONDS = 3600; // a push the phone can't take within an hour is dropped, not delivered late
const SEND_TIMEOUT_MS = 10000;
const TEST_MIN_GAP_SECONDS = 15;
const TEST_DELAY_SECONDS = 90;
// Contact for the push services, as the VAPID standard asks. A web address, so no personal details go to anyone.
const VAPID_SUBJECT = "https://ccrane1109-droid.github.io/Jarvis/";

const EXACT_HOSTS = ["web.push.apple.com", "fcm.googleapis.com", "updates.push.services.mozilla.com"];
const HOST_SUFFIXES = [".push.apple.com", ".push.services.mozilla.com", ".notify.windows.com"];

const subsPath = (uid) => "users/" + uid + "/pushSubscriptions";
const statePath = (uid) => "users/" + uid + "/reminderState/push";

function fail(code, message) { return new insight.InsightError(code, message); }

function hostAllowed(host) {
  const h = String(host || "").toLowerCase();
  return EXACT_HOSTS.indexOf(h) !== -1 || HOST_SUFFIXES.some(function (s) { return h.length > s.length && h.endsWith(s); });
}

function platformOf(host) {
  const h = String(host || "").toLowerCase();
  if (h.endsWith(".push.apple.com")) return "Apple";
  if (h === "fcm.googleapis.com") return "Google";
  if (h === "updates.push.services.mozilla.com" || h.endsWith(".push.services.mozilla.com")) return "Mozilla";
  if (h.endsWith(".notify.windows.com")) return "Microsoft";
  return "Other";
}

function subscriptionId(endpoint) {
  return crypto.createHash("sha256").update(String(endpoint)).digest("hex").slice(0, 32);
}

const KEY_RE = /^[A-Za-z0-9_-]{16,200}$/;

// -> { ok: true, value: { endpoint, keys: { p256dh, auth } } } | { ok: false, error }
function validateSubscription(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const endpoint = typeof r.endpoint === "string" ? r.endpoint.trim() : "";
  if (!endpoint || endpoint.length > 600) return { ok: false, error: "That isn't a valid push address." };
  let u;
  try { u = new URL(endpoint); } catch (e) { return { ok: false, error: "That isn't a valid push address." }; }
  if (u.protocol !== "https:" || u.username || u.password) return { ok: false, error: "That isn't a valid push address." };
  if (!hostAllowed(u.hostname)) return { ok: false, error: "That push service isn't one JARVIS sends to (" + u.hostname + ")." };
  const keys = r.keys && typeof r.keys === "object" ? r.keys : {};
  if (!KEY_RE.test(keys.p256dh || "") || !KEY_RE.test(keys.auth || "")) return { ok: false, error: "The phone's push keys look wrong. Turn notifications off and on again." };
  return { ok: true, value: { endpoint: endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } } };
}

function clip(v, max) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max); }

// The message the phone gets. Small, plain, and with nothing in it but what is shown.
function buildPayload(item) {
  const payload = {
    v: 1,
    id: clip(item.id, 80),
    kind: item.kind === "test" ? "test" : "reminder",
    title: clip(item.title, 80) || "JARVIS",
    body: clip(item.body, 160),
    tag: clip(item.tag || item.id, 80),
    url: "./index.html?reminder=" + encodeURIComponent(clip(item.id, 80)),
    ts: item.ts || null
  };
  const text = JSON.stringify(payload);
  if (Buffer.byteLength(text) > PAYLOAD_MAX_BYTES) throw new Error("push payload too large");
  return text;
}

// What the lock screen shows for a reminder: your own words, or only the category when you've asked to keep the name private.
function lockScreenText(reminder, category) {
  if (reminder.privateText === true) {
    return { title: (category ? category.label : "Reminder") + " reminder", body: "Open JARVIS to see it." };
  }
  return { title: clip(reminder.title, 80), body: clip(reminder.notes, 160) || "Reminder from JARVIS" };
}

// A topic lets the push service replace a still-waiting message for the same reminder instead of delivering both.
function topicFor(id) {
  return crypto.createHash("sha256").update(String(id)).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 32);
}

function classifyError(err) {
  const status = err && typeof err.statusCode === "number" ? err.statusCode : 0;
  return {
    status: status,
    gone: status === 404 || status === 410,
    // No answer at all, or the service asking us to slow down or having a bad moment, is worth another try.
    retryable: status === 0 || status === 429 || status >= 500,
    message: clip(status ? "Push service answered " + status + (err.body ? ": " + err.body : "") : (err && err.message) || "No answer from the push service.", 200)
  };
}

async function sendOne(deps, sub, payloadText, topic) {
  try {
    const res = await deps.webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payloadText, {
      TTL: TTL_SECONDS, urgency: "high", topic: topic, timeout: SEND_TIMEOUT_MS
    });
    return { ok: true, status: res && res.statusCode ? res.statusCode : 201 };
  } catch (err) {
    return Object.assign({ ok: false }, classifyError(err));
  }
}

async function listSubscriptions(deps, uid) {
  const snap = await deps.db.collection(subsPath(uid)).get();
  return snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
}

// Sends one payload to every phone. Phones the push service says are gone are forgotten.
// -> { devices, accepted, gone, retryable, errors[] }
async function sendToAll(deps, uid, payloadText, topic) {
  const subs = await listSubscriptions(deps, uid);
  const now = deps.now().toISOString();
  const results = await Promise.all(subs.map(async function (s) {
    const r = await sendOne(deps, s, payloadText, topic);
    const ref = deps.db.doc(subsPath(uid) + "/" + s.id);
    if (r.ok) {
      await ref.set({ lastSuccessAt: now, lastError: null, failures: 0 }, { merge: true });
    } else if (r.gone) {
      await ref.delete();
    } else {
      await ref.set({ lastError: r.message, failures: (s.failures || 0) + 1, lastFailureAt: now }, { merge: true });
    }
    return r;
  }));
  const accepted = results.filter(function (r) { return r.ok; }).length;
  const gone = results.filter(function (r) { return r.gone; }).length;
  const failures = results.filter(function (r) { return !r.ok && !r.gone; });
  return {
    devices: subs.length, accepted: accepted, gone: gone,
    // Worth retrying only if nothing got through and at least one failure may be temporary.
    retryable: accepted === 0 && failures.some(function (r) { return r.retryable; }),
    errors: failures.map(function (r) { return r.message; }).slice(0, 3)
  };
}

function requireKeys(deps) {
  if (!deps.webpush || !deps.vapidPublic || !deps.vapidPrivate) {
    throw fail("failed-precondition", "The notification keys aren't set up on your server yet.");
  }
}

function configure(deps) {
  requireKeys(deps);
  deps.webpush.setVapidDetails(VAPID_SUBJECT, String(deps.vapidPublic).trim(), String(deps.vapidPrivate).trim());
}

/* ---------------- the `notifications` function ---------------- */

async function config(uid, deps, data) {
  const subs = await listSubscriptions(deps, uid);
  const endpoint = typeof data.endpoint === "string" ? data.endpoint : "";
  return {
    ok: true,
    keysReady: !!(deps.vapidPublic && deps.vapidPrivate),
    publicKey: deps.vapidPublic ? String(deps.vapidPublic).trim() : null,
    devices: subs.map(function (s) {
      return { id: s.id, platform: s.platform || "Other", createdAt: s.createdAt || null, lastSuccessAt: s.lastSuccessAt || null, lastError: s.lastError || null, failures: s.failures || 0 };
    }),
    thisDevice: endpoint ? subs.some(function (s) { return s.endpoint === endpoint; }) : null,
    serverNow: deps.now().toISOString()
  };
}

async function subscribe(uid, deps, data) {
  requireKeys(deps);
  const v = validateSubscription(data.subscription);
  if (!v.ok) throw fail("invalid-argument", v.error);
  const id = subscriptionId(v.value.endpoint);
  const ref = deps.db.doc(subsPath(uid) + "/" + id);
  const [existing, all] = await Promise.all([ref.get(), listSubscriptions(deps, uid)]);
  if (!existing.exists && all.length >= MAX_DEVICES) throw fail("resource-exhausted", "You have " + MAX_DEVICES + " phones set up, the most JARVIS keeps. Turn one off first.");
  const now = deps.now().toISOString();
  const prev = existing.exists ? existing.data() : {};
  await ref.set({
    endpoint: v.value.endpoint, keys: v.value.keys, platform: platformOf(new URL(v.value.endpoint).hostname),
    createdAt: prev.createdAt || now, lastSeenAt: now, lastSuccessAt: prev.lastSuccessAt || null, lastError: null, failures: 0
  });
  return { ok: true, id: id, devices: existing.exists ? all.length : all.length + 1, platform: platformOf(new URL(v.value.endpoint).hostname) };
}

async function unsubscribe(uid, deps, data) {
  const endpoint = typeof data.endpoint === "string" ? data.endpoint.trim() : "";
  if (!endpoint) throw fail("invalid-argument", "That isn't a valid push address.");
  await deps.db.doc(subsPath(uid) + "/" + subscriptionId(endpoint)).delete();
  return { ok: true };
}

// A test: either right now (checks the keys and the push service) or in about 90 seconds through the
// real scheduler (checks everything, including that it works with JARVIS closed).
async function test(uid, deps, data, queueEvent) {
  requireKeys(deps);
  const now = deps.now();
  const stateRef = deps.db.doc(statePath(uid));
  const snap = await stateRef.get();
  const last = snap.exists && snap.data().lastTestAt ? new Date(snap.data().lastTestAt).getTime() : 0;
  if (now.getTime() - last < TEST_MIN_GAP_SECONDS * 1000) throw fail("resource-exhausted", "Wait a few seconds between tests.");
  const subs = await listSubscriptions(deps, uid);
  if (!subs.length) throw fail("failed-precondition", "No phone is set up for notifications yet. Turn them on first.");
  await stateRef.set({ lastTestAt: now.toISOString() });
  const id = "test_" + now.getTime().toString(36) + crypto.randomBytes(3).toString("hex");

  if (Number(data.delaySeconds) === TEST_DELAY_SECONDS) {
    const dueAt = new Date(now.getTime() + TEST_DELAY_SECONDS * 1000).toISOString();
    await queueEvent(uid, deps, {
      id: id, kind: "test", reminderId: null, category: "custom", title: "JARVIS test", lockTitle: "JARVIS test",
      lockBody: "This test went through the real scheduler.", scheduledFor: dueAt, deliverAt: dueAt
    });
    return { ok: true, mode: "scheduled", dueAt: dueAt, devices: subs.length };
  }
  configure(deps);
  const text = buildPayload({ id: id, kind: "test", title: "JARVIS test", body: "Notifications work on this phone.", ts: now.toISOString() });
  const res = await sendToAll(deps, uid, text, topicFor(id));
  return Object.assign({ ok: true, mode: "now" }, res);
}

async function handle(uid, data, deps, queueEvent) {
  insight.requireOwner(uid, deps);
  const d = data && typeof data === "object" ? data : {};
  switch (d.action) {
    case "config": return config(uid, deps, d);
    case "subscribe": return subscribe(uid, deps, d);
    case "unsubscribe": return unsubscribe(uid, deps, d);
    case "test": return test(uid, deps, d, queueEvent);
    default: throw fail("invalid-argument", "Unknown notifications action.");
  }
}

module.exports = {
  MAX_DEVICES, TTL_SECONDS, TEST_DELAY_SECONDS, TEST_MIN_GAP_SECONDS, VAPID_SUBJECT,
  hostAllowed, platformOf, subscriptionId, validateSubscription, buildPayload, lockScreenText, topicFor, classifyError,
  listSubscriptions, sendToAll, configure, requireKeys, handle
};
