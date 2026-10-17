/* ==========================================================================
   Reminders: storage and management (owner only, server side).

   Firestore (written only by the server; the page reads and edits through
   the `reminders` callable, so no Firestore rules are needed):
     users/{uid}/reminders/{id}
        { title, category, notes, enabled, schedule, timezone, privateText,
          respectQuietHours, nextFireAt, lastFiredAt, createdAt, updatedAt }
     users/{uid}/reminderSettings/main
        { timezone, quiet: { enabled, start, end }, updatedAt }

   nextFireAt is the next moment the reminder is due, as an ISO string in UTC
   (null while it is disabled or a one-time reminder has passed). The delivery
   step reads only reminders whose nextFireAt has arrived.

   Nothing here sends a notification; sending is a separate step. Callers can't
   set server fields: only the editable part of a reminder is accepted.
   ========================================================================== */

"use strict";

const crypto = require("node:crypto");
const insight = require("./insight");
const spec = require("./reminder-spec");
const time = require("./reminder-time");

const UPCOMING_SHOWN = 3;

const remindersPath = (uid) => "users/" + uid + "/reminders";
const settingsPath = (uid) => "users/" + uid + "/reminderSettings/main";

function fail(code, message) { return new insight.InsightError(code, message); }

async function readSettings(deps, uid) {
  const snap = await deps.db.doc(settingsPath(uid)).get();
  const settings = spec.sanitizeSettings(snap.exists ? snap.data() : {});
  if (!time.isValidZone(settings.timezone)) settings.timezone = spec.DEFAULT_TIMEZONE;
  return settings;
}

function nextFireFor(reminder, now) {
  if (reminder.enabled === false) return null;
  const next = time.nextOccurrence(reminder.schedule, reminder.timezone, now);
  return next ? next.toISOString() : null;
}

// The browser-facing copy of a stored reminder, with today's and the next few moments worked out.
function publicReminder(id, d, now) {
  const zone = time.isValidZone(d.timezone) ? d.timezone : spec.DEFAULT_TIMEZONE;
  return {
    id: id, title: d.title, category: d.category, notes: d.notes || "", enabled: d.enabled !== false,
    schedule: d.schedule, timezone: zone, privateText: d.privateText === true, respectQuietHours: d.respectQuietHours === true,
    nextFireAt: d.nextFireAt || null, lastFiredAt: d.lastFiredAt || null, createdAt: d.createdAt || null, updatedAt: d.updatedAt || null,
    today: time.todayOccurrences(d.schedule, zone, now).map(function (x) { return x.toISOString(); }),
    upcoming: d.enabled === false ? [] : time.upcoming(d.schedule, zone, now, UPCOMING_SHOWN).map(function (x) { return x.toISOString(); })
  };
}

// Checks that need a clock or a zone, shared by create, update and re-enable.
function checkAgainstClock(reminder, now) {
  if (!time.isValidZone(reminder.timezone)) throw fail("invalid-argument", "That time zone isn't valid.");
  if (reminder.enabled !== false && reminder.schedule.type === "once" && !nextFireFor(reminder, now)) {
    throw fail("invalid-argument", "That date and time have already passed. Pick a later one.");
  }
}

function parseEditable(raw, settings) {
  const res = spec.sanitizeReminder(raw);
  if (!res.ok) throw fail("invalid-argument", res.error);
  const value = res.value;
  value.timezone = value.timezone || settings.timezone;
  return value;
}

function requireId(id) {
  if (typeof id !== "string" || !spec.ID_RE.test(id)) throw fail("invalid-argument", "That isn't a reminder.");
  return id;
}

async function readOne(deps, uid, id) {
  const ref = deps.db.doc(remindersPath(uid) + "/" + requireId(id));
  const snap = await ref.get();
  if (!snap.exists) throw fail("not-found", "That reminder doesn't exist any more.");
  return { ref: ref, data: snap.data() };
}

async function list(uid, deps) {
  const now = deps.now();
  const [snap, settings] = await Promise.all([deps.db.collection(remindersPath(uid)).get(), readSettings(deps, uid)]);
  const reminders = snap.docs.map(function (d) { return publicReminder(d.id, d.data(), now); });
  // Soonest first; disabled and finished ones last.
  reminders.sort(function (a, b) {
    if (!!a.nextFireAt !== !!b.nextFireAt) return a.nextFireAt ? -1 : 1;
    if (a.nextFireAt !== b.nextFireAt) return a.nextFireAt < b.nextFireAt ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
  return { ok: true, reminders: reminders, settings: settings, serverNow: now.toISOString(), max: spec.MAX_REMINDERS };
}

async function create(uid, deps, raw) {
  const now = deps.now();
  const settings = await readSettings(deps, uid);
  const value = parseEditable(raw, settings);
  checkAgainstClock(value, now);
  const existing = await deps.db.collection(remindersPath(uid)).get();
  if (existing.docs.length >= spec.MAX_REMINDERS) {
    throw fail("resource-exhausted", "You have " + spec.MAX_REMINDERS + " reminders, the most JARVIS keeps. Delete one first.");
  }
  const id = crypto.randomBytes(8).toString("hex");
  const doc = Object.assign({}, value, {
    nextFireAt: nextFireFor(value, now), lastFiredAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString()
  });
  await deps.db.doc(remindersPath(uid) + "/" + id).set(doc);
  return { ok: true, reminder: publicReminder(id, doc, now) };
}

async function update(uid, deps, id, raw) {
  const now = deps.now();
  const [current, settings] = await Promise.all([readOne(deps, uid, id), readSettings(deps, uid)]);
  const value = parseEditable(raw, settings);
  checkAgainstClock(value, now);
  const doc = Object.assign({}, current.data, value, { nextFireAt: nextFireFor(value, now), updatedAt: now.toISOString() });
  await current.ref.set(doc);
  return { ok: true, reminder: publicReminder(id, doc, now) };
}

async function remove(uid, deps, id) {
  const ref = deps.db.doc(remindersPath(uid) + "/" + requireId(id));
  await ref.delete();
  return { ok: true, id: id };
}

async function setEnabled(uid, deps, id, enabled) {
  if (typeof enabled !== "boolean") throw fail("invalid-argument", "Say whether the reminder should be on or off.");
  const now = deps.now();
  const current = await readOne(deps, uid, id);
  const next = Object.assign({}, current.data, { enabled: enabled });
  checkAgainstClock(next, now);
  const doc = Object.assign(next, { nextFireAt: nextFireFor(next, now), updatedAt: now.toISOString() });
  await current.ref.set(doc);
  return { ok: true, reminder: publicReminder(id, doc, now) };
}

// applyToAll moves every reminder to the new zone (the same wall-clock times, new zone),
// for when you've moved or are travelling. It is never done silently.
async function saveSettings(uid, deps, raw, applyToAll) {
  const now = deps.now();
  const settings = spec.sanitizeSettings(raw);
  if (!time.isValidZone(settings.timezone)) throw fail("invalid-argument", "That time zone isn't valid.");
  await deps.db.doc(settingsPath(uid)).set(Object.assign({}, settings, { updatedAt: now.toISOString() }));
  let moved = 0;
  if (applyToAll === true) {
    const snap = await deps.db.collection(remindersPath(uid)).get();
    for (const d of snap.docs) {
      const data = d.data();
      const next = Object.assign({}, data, { timezone: settings.timezone });
      // A one-time reminder whose moment has passed in the new zone just stays finished.
      const nextFireAt = nextFireFor(next, now);
      await deps.db.doc(remindersPath(uid) + "/" + d.id).set(Object.assign(next, { nextFireAt: nextFireAt, updatedAt: now.toISOString() }));
      moved++;
    }
  }
  return { ok: true, settings: settings, moved: moved };
}

// The `reminders` callable: { action, ... }.
async function handle(uid, data, deps) {
  insight.requireOwner(uid, deps);
  const d = data && typeof data === "object" ? data : {};
  switch (d.action) {
    case "list": return list(uid, deps);
    case "create": return create(uid, deps, d.reminder);
    case "update": return update(uid, deps, d.id, d.reminder);
    case "delete": return remove(uid, deps, d.id);
    case "setEnabled": return setEnabled(uid, deps, d.id, d.enabled);
    case "saveSettings": return saveSettings(uid, deps, d.settings, d.applyToAll);
    default: throw fail("invalid-argument", "Unknown reminders action.");
  }
}

module.exports = { handle, list, create, update, remove, setEnabled, saveSettings, readSettings, publicReminder, nextFireFor };
