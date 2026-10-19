/* ==========================================================================
   Reminder delivery: what runs once a minute (owner only, server side).

   Each run does two things:
   1. CLAIM. Finds reminders whose nextFireAt has arrived. For each one, in a
      single transaction: re-checks it is still due, writes an "event" record
      for that exact moment, and moves the reminder on to its next moment.
      Because the check and the move happen together, and the event has a
      fixed name (reminderId + moment), two overlapping runs, a retry or a
      crash can never produce two events for the same moment.
   2. SEND. Finds events whose sendDue has arrived, takes a short lease on each
      (so another run leaves it alone), and sends it to your phones.

   Firestore (written only by the server):
     users/{uid}/reminderEvents/{reminderId}_{moment}
        { kind, reminderId, category, title, lockTitle, lockBody, scheduledFor, deliverAt,
          sendDue, status, attempts, devices, accepted, createdAt, sentAt, finishedAt, lastError }
     status: queued -> sent | missed | failed | no-device

   A reminder more than 30 minutes past its time is marked "missed" and not
   sent: a stale "take it now" is worse than none. Everything is recorded, so
   the history shows what happened and why.

   "sent" means the push service accepted it. It can't tell whether the phone
   then showed it.
   ========================================================================== */

"use strict";

const reminders = require("./reminders");
const time = require("./reminder-time");
const spec = require("./reminder-spec");
const push = require("./push");

const MAX_PER_RUN = 25;
const MAX_LATE_MS = 30 * 60 * 1000;
const LEASE_MS = 3 * 60 * 1000;
const RETRY_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 3;

const remindersPath = (uid) => "users/" + uid + "/reminders";
const eventsPath = (uid) => "users/" + uid + "/reminderEvents";

function eventIdFor(reminderId, momentIso) {
  return reminderId + "_" + momentIso.replace(/[^0-9]/g, "");
}

function isoPlus(date, ms) { return new Date(date.getTime() + ms).toISOString(); }

function newEvent(fields, now) {
  return Object.assign({
    kind: "reminder", reminderId: null, category: "custom", title: "", lockTitle: "", lockBody: "",
    scheduledFor: null, deliverAt: null, sendDue: null, status: "queued", attempts: 0, devices: 0, accepted: 0,
    createdAt: now.toISOString(), sentAt: null, finishedAt: null, lastError: null
  }, fields);
}

// Puts an event in the queue (used for the 90-second test).
async function queueEvent(uid, deps, fields) {
  const now = deps.now();
  const rest = Object.assign({}, fields);
  delete rest.id;
  await deps.db.doc(eventsPath(uid) + "/" + fields.id).create(newEvent(Object.assign({ sendDue: fields.deliverAt }, rest), now));
  return fields.id;
}

// Step 1 for one reminder. Returns "claimed" or "skipped".
async function claim(uid, deps, reminderId, scheduledFor, settings, now) {
  const refReminder = deps.db.doc(remindersPath(uid) + "/" + reminderId);
  const id = eventIdFor(reminderId, scheduledFor);
  const refEvent = deps.db.doc(eventsPath(uid) + "/" + id);
  return deps.db.runTransaction(async function (tx) {
    const [rSnap, eSnap] = await Promise.all([tx.get(refReminder), tx.get(refEvent)]);
    if (!rSnap.exists) return "skipped";
    const r = rSnap.data();
    // Someone else already dealt with this moment (or the reminder changed).
    if (r.enabled === false || r.nextFireAt !== scheduledFor) return "skipped";
    const zone = time.isValidZone(r.timezone) ? r.timezone : spec.DEFAULT_TIMEZONE;
    const next = time.nextOccurrence(r.schedule, zone, now);
    if (!eSnap.exists) {
      const due = new Date(scheduledFor);
      // Reminders that opted in to quiet hours wait until quiet hours end.
      const held = r.respectQuietHours === true && time.inQuietHours(due, settings.quiet, zone);
      const deliverAt = held ? time.quietEndAfter(due, settings.quiet, zone).toISOString() : scheduledFor;
      const lock = push.lockScreenText(r, spec.categoryOf(r.category));
      tx.create(refEvent, newEvent({
        kind: "reminder", reminderId: reminderId, category: r.category, title: r.title, lockTitle: lock.title, lockBody: lock.body,
        scheduledFor: scheduledFor, deliverAt: deliverAt, sendDue: deliverAt
      }, now));
    }
    tx.update(refReminder, { nextFireAt: next ? next.toISOString() : null, lastFiredAt: scheduledFor });
    return "claimed";
  });
}

// Step 2 for one event. Returns what happened.
async function deliver(uid, deps, eventId, now) {
  const ref = deps.db.doc(eventsPath(uid) + "/" + eventId);
  const leased = await deps.db.runTransaction(async function (tx) {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const e = snap.data();
    if (e.status !== "queued" || !e.sendDue || e.sendDue > now.toISOString()) return null;
    if (now.getTime() - new Date(e.deliverAt).getTime() > MAX_LATE_MS) {
      tx.update(ref, { status: "missed", sendDue: null, finishedAt: now.toISOString(), lastError: "More than 30 minutes late, so it wasn't sent." });
      return { missed: true };
    }
    tx.update(ref, { sendDue: isoPlus(now, LEASE_MS), attempts: (e.attempts || 0) + 1 });
    return { event: e, attempts: (e.attempts || 0) + 1 };
  });
  if (!leased) return "skipped";
  if (leased.missed) return "missed";

  const e = leased.event;
  let result;
  try {
    const text = push.buildPayload({ id: eventId, kind: e.kind, title: e.lockTitle, body: e.lockBody, ts: e.scheduledFor });
    result = await push.sendToAll(deps, uid, text, push.topicFor(eventId));
  } catch (err) {
    result = { devices: 1, accepted: 0, gone: 0, retryable: true, errors: [String(err && err.message ? err.message : err).slice(0, 200)] };
  }

  const done = now.toISOString();
  if (result.devices === 0) {
    await ref.update({ status: "no-device", sendDue: null, finishedAt: done, devices: 0, lastError: "No phone was set up for notifications." });
    return "no-device";
  }
  if (result.accepted > 0) {
    await ref.update({ status: "sent", sendDue: null, sentAt: done, finishedAt: done, devices: result.devices, accepted: result.accepted, lastError: null });
    return "sent";
  }
  const error = result.errors[0] || (result.gone ? "The phone's notification permission has gone away." : "The push service didn't accept it.");
  if (result.retryable && leased.attempts < MAX_ATTEMPTS) {
    await ref.update({ sendDue: isoPlus(now, RETRY_MS), devices: result.devices, lastError: error });
    return "retry";
  }
  await ref.update({ status: "failed", sendDue: null, finishedAt: done, devices: result.devices, lastError: error });
  return "failed";
}

// One run. Safe to run twice at once, and safe to run late.
async function runTick(uid, deps) {
  const now = deps.now();
  const nowIso = now.toISOString();
  const summary = { claimed: 0, sent: 0, missed: 0, retry: 0, failed: 0, noDevice: 0 };
  // Without the push keys nothing can be sent, so don't use up reminders' moments.
  if (!deps.webpush || !deps.vapidPublic || !deps.vapidPrivate) return Object.assign(summary, { skipped: "The notification keys aren't set up." });

  const due = await deps.db.collection(remindersPath(uid)).where("nextFireAt", "<=", nowIso).orderBy("nextFireAt").limit(MAX_PER_RUN).get();
  if (due.docs.length) {
    const settings = await reminders.readSettings(deps, uid);
    for (const d of due.docs) {
      const r = await claim(uid, deps, d.id, d.data().nextFireAt, settings, now);
      if (r === "claimed") summary.claimed++;
    }
  }

  const ready = await deps.db.collection(eventsPath(uid)).where("sendDue", "<=", nowIso).orderBy("sendDue").limit(MAX_PER_RUN).get();
  if (ready.docs.length) {
    push.configure(deps);
    for (const d of ready.docs) {
      const r = await deliver(uid, deps, d.id, now);
      if (r === "sent") summary.sent++;
      else if (r === "missed") summary.missed++;
      else if (r === "retry") summary.retry++;
      else if (r === "failed") summary.failed++;
      else if (r === "no-device") summary.noDevice++;
    }
  }
  return summary;
}

module.exports = { MAX_LATE_MS, MAX_ATTEMPTS, LEASE_MS, RETRY_MS, eventIdFor, queueEvent, runTick };
