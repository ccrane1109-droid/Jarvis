/* ==========================================================================
   Reminder answers and history (owner only, server side).

   What you do about a reminder: mark it done, skip it, snooze it, or undo
   that. Also the records the page uses for "today's progress" and the
   notification history.

   Everything here happens because you tapped something. Nothing on the
   server ever marks a reminder done or skipped by itself, and medication is
   no exception: JARVIS never marks medication as taken.

   Records: users/{uid}/reminderEvents/{reminderId}_{moment} (see
   reminder-events.js and delivery.js). A snooze puts the same record back in
   the delivery queue for a later time, so the once-a-minute run sends it
   again and the new notification replaces the one still on the lock screen.

   "Done" before the time comes (you took it early) writes the record ahead
   of time, as cancelled, so the reminder doesn't go off. Undoing that while
   the time is still ahead removes the record and the reminder is back to
   normal.
   ========================================================================== */

"use strict";

const insight = require("./insight");
const spec = require("./reminder-spec");
const time = require("./reminder-time");
const events = require("./reminder-events");
const delivery = require("./delivery");
const push = require("./push");

const MAX_EVENTS = 400;
const DEFAULT_DAYS = 14;
const MAX_DAYS = 60;
const FUTURE_MOMENTS = 3;

const remindersPath = (uid) => "users/" + uid + "/reminders";
const eventsPath = (uid) => "users/" + uid + "/reminderEvents";

function fail(code, message) { return new insight.InsightError(code, message); }

// The browser-facing copy of a record. Real titles are fine here: this is you, signed in,
// in the app. (The lock screen is where private reminders hide their names.)
function publicEvent(id, d, now) {
  return {
    id: id, kind: d.kind === "test" ? "test" : "reminder", reminderId: d.reminderId || null, category: d.category || "custom",
    title: d.title || "", timezone: d.timezone || null, scheduledFor: d.scheduledFor || null, deliverAt: d.deliverAt || null,
    status: d.status || "queued", outcome: d.outcome === "done" || d.outcome === "skipped" ? d.outcome : null, outcomeAt: d.outcomeAt || null,
    snoozedUntil: d.snoozedUntil || null, snoozeCount: d.snoozeCount || 0, sentAt: d.sentAt || null, lastError: d.lastError || null,
    state: events.stateOf(d, now.getTime())
  };
}

function targetOf(d) {
  if (typeof d.eventId === "string") {
    const reminderId = events.reminderIdOf(d.eventId);
    const scheduledFor = events.momentOf(d.eventId);
    if (!reminderId || !scheduledFor) {
      throw fail("invalid-argument", d.eventId.indexOf("test_") === 0 ? "That was a test notification, so there is nothing to mark." : "That isn't a reminder moment.");
    }
    return { id: d.eventId, reminderId: reminderId, scheduledFor: scheduledFor };
  }
  if (typeof d.reminderId !== "string" || !spec.ID_RE.test(d.reminderId) || !events.isMomentIso(d.scheduledFor)) throw fail("invalid-argument", "That isn't a reminder moment.");
  return { id: events.eventIdFor(d.reminderId, d.scheduledFor), reminderId: d.reminderId, scheduledFor: d.scheduledFor };
}

const isoPlusMinutes = (now, m) => new Date(now.getTime() + m * 60000).toISOString();

// What a choice changes on a record that already exists. Returns { patch } or { remove: true }.
function changeFor(e, choice, minutes, now) {
  const nowIso = now.toISOString();
  if (choice === "done" || choice === "skip") {
    const patch = { outcome: choice === "done" ? "done" : "skipped", outcomeAt: nowIso, snoozedUntil: null };
    // Still waiting to be sent (or snoozed): stop it. Already sent: the status stays as it was.
    if (e.status === "queued") Object.assign(patch, { status: "cancelled", sendDue: null, finishedAt: nowIso, lastError: null });
    return { patch: patch };
  }
  if (choice === "snooze") {
    if (e.outcome === "done" || e.outcome === "skipped") throw fail("failed-precondition", "It's already marked " + (e.outcome === "done" ? "done" : "skipped") + ". Undo that first if you want to snooze it.");
    if (events.SNOOZE_MINUTES.indexOf(minutes) === -1) throw fail("invalid-argument", "Pick 5, 10, 15, 30 or 60 minutes.");
    if ((e.snoozeCount || 0) >= events.MAX_SNOOZES) throw fail("resource-exhausted", "You've snoozed this " + events.MAX_SNOOZES + " times. Mark it done or skip it.");
    const until = isoPlusMinutes(now, minutes);
    return { patch: { status: "queued", sendDue: until, deliverAt: until, snoozedUntil: until, snoozeCount: (e.snoozeCount || 0) + 1, attempts: 0, finishedAt: null, lastError: null } };
  }
  // undo
  if (!e.outcome) throw fail("failed-precondition", "There's nothing to undo.");
  if (e.status === "cancelled" && e.scheduledFor > nowIso && !e.sentAt) return { remove: true };
  return { patch: { outcome: null, outcomeAt: null } };
}

// A moment that has no record yet can still be marked done or skipped (you took it before the time came,
// or the delivery run hasn't reached it), but only if it really is one of this reminder's moments.
function checkMoment(r, scheduledFor, now) {
  if (!r) throw fail("not-found", "That reminder doesn't exist any more.");
  if (r.enabled === false) throw fail("failed-precondition", "That reminder is turned off.");
  const zone = time.isValidZone(r.timezone) ? r.timezone : spec.DEFAULT_TIMEZONE;
  const valid = time.todayOccurrences(r.schedule, zone, now).concat(time.upcoming(r.schedule, zone, now, FUTURE_MOMENTS)).map(function (x) { return x.toISOString(); });
  if (r.nextFireAt) valid.push(r.nextFireAt);
  if (valid.indexOf(scheduledFor) === -1) throw fail("failed-precondition", "That isn't a moment JARVIS has on record for this reminder.");
  return zone;
}

async function act(uid, deps, d) {
  const choice = d.choice;
  if (["done", "skip", "snooze", "undo"].indexOf(choice) === -1) throw fail("invalid-argument", "Say whether to mark it done, skip it, snooze it or undo.");
  const t = targetOf(d);
  const minutes = Number(d.minutes);
  const now = deps.now();
  const nowIso = now.toISOString();
  const refEvent = deps.db.doc(eventsPath(uid) + "/" + t.id);
  const refReminder = deps.db.doc(remindersPath(uid) + "/" + t.reminderId);

  return deps.db.runTransaction(async function (tx) {
    const [eSnap, rSnap] = await Promise.all([tx.get(refEvent), tx.get(refReminder)]);

    if (eSnap.exists) {
      const e = eSnap.data();
      if (e.kind === "test") throw fail("invalid-argument", "That was a test notification, so there is nothing to mark.");
      const change = changeFor(e, choice, minutes, now);
      if (change.remove) { tx.delete(refEvent); return { ok: true, event: null, removed: true }; }
      tx.update(refEvent, change.patch);
      return { ok: true, event: publicEvent(t.id, Object.assign({}, e, change.patch), now), removed: false };
    }

    if (choice === "undo") throw fail("failed-precondition", "There's nothing to undo.");
    if (choice === "snooze") throw fail("failed-precondition", "That reminder hasn't gone off yet, so there is nothing to snooze.");
    const r = rSnap.exists ? rSnap.data() : null;
    const zone = checkMoment(r, t.scheduledFor, now);
    const lock = push.lockScreenText(r, spec.categoryOf(r.category));
    const doc = delivery.newEvent({
      kind: "reminder", reminderId: t.reminderId, category: r.category, title: r.title, timezone: zone, lockTitle: lock.title, lockBody: lock.body,
      scheduledFor: t.scheduledFor, deliverAt: t.scheduledFor, sendDue: null, status: "cancelled", finishedAt: nowIso,
      outcome: choice === "done" ? "done" : "skipped", outcomeAt: nowIso
    }, now);
    tx.create(refEvent, doc);
    return { ok: true, event: publicEvent(t.id, doc, now), removed: false };
  });
}

async function one(uid, deps, d) {
  const id = typeof d.eventId === "string" && events.reminderIdOf(d.eventId) ? d.eventId : null;
  if (!id) throw fail("invalid-argument", "That isn't a reminder moment.");
  const now = deps.now();
  const snap = await deps.db.doc(eventsPath(uid) + "/" + id).get();
  return { ok: true, event: snap.exists ? publicEvent(id, snap.data(), now) : null, serverNow: now.toISOString() };
}

// Recent records, newest first. The page asks for 2 days to work out today's progress
// and 14 for the history, so it never reads more than it shows.
async function recent(uid, deps, d) {
  const now = deps.now();
  const days = Math.min(MAX_DAYS, Math.max(1, Math.floor(Number(d.days)) || DEFAULT_DAYS));
  const since = new Date(now.getTime() - days * 86400000).toISOString();
  const snap = await deps.db.collection(eventsPath(uid)).where("scheduledFor", ">=", since).orderBy("scheduledFor", "desc").limit(MAX_EVENTS).get();
  return {
    ok: true, days: days, truncated: snap.docs.length >= MAX_EVENTS, serverNow: now.toISOString(),
    events: snap.docs.map(function (x) { return publicEvent(x.id, x.data(), now); })
  };
}

// The `reminders` function's answer-and-history actions: { action: "act" | "event" | "events", ... }.
async function handle(uid, data, deps) {
  insight.requireOwner(uid, deps);
  const d = data && typeof data === "object" ? data : {};
  switch (d.action) {
    case "act": return act(uid, deps, d);
    case "event": return one(uid, deps, d);
    case "events": return recent(uid, deps, d);
    default: throw fail("invalid-argument", "Unknown reminders action.");
  }
}

const ACTIONS = ["act", "event", "events"];

module.exports = { ACTIONS, MAX_EVENTS, publicEvent, handle, act, one, recent };
