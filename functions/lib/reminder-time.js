/* ==========================================================================
   Reminder time math (server only; uses luxon for time zones and daylight
   saving). Turns a wall-clock schedule plus a time zone into real moments.

   Rules, so nothing is a surprise on the two odd days a year:
   - A time that doesn't exist (clocks spring forward, e.g. 2:30 AM on
     2026-03-08 in New York) fires shifted forward by the length of the gap:
     3:30 AM.
   - A time that happens twice (clocks fall back, e.g. 1:30 AM on 2026-11-01)
     fires once, at its first occurrence.
   - Moments are always compared as exact instants, so the same reminder can
     never be due twice for the same wall-clock slot.
   ========================================================================== */

"use strict";

const { DateTime, IANAZone } = require("luxon");

function isValidZone(zone) {
  return typeof zone === "string" && zone.length > 0 && zone.length <= 64 && IANAZone.isValidZone(zone);
}

// The local calendar date (YYYY-MM-DD) of a moment in a zone.
function localDate(date, zone) {
  return DateTime.fromJSDate(date, { zone: zone }).toISODate();
}

function addDays(isoDate, n) {
  return DateTime.fromISO(isoDate, { zone: "utc" }).plus({ days: n }).toISODate();
}

// The moments on one local calendar day that this schedule fires, earliest first.
function occurrencesOnDate(schedule, zone, isoDate) {
  if (!schedule || !Array.isArray(schedule.times)) return [];
  if (schedule.type === "once" && schedule.date !== isoDate) return [];
  if (schedule.type === "weekly") {
    // luxon weekday: 1 = Monday ... 7 = Sunday; the schedule uses 0 = Sunday ... 6 = Saturday.
    const weekday = DateTime.fromISO(isoDate, { zone: "utc" }).weekday % 7;
    if ((schedule.days || []).indexOf(weekday) === -1) return [];
  }
  const seen = {};
  const out = [];
  schedule.times.forEach(function (time) {
    const dt = DateTime.fromISO(isoDate + "T" + time, { zone: zone });
    if (!dt.isValid) return;
    const ms = dt.toMillis();
    if (!seen[ms]) { seen[ms] = true; out.push(new Date(ms)); }
  });
  return out.sort(function (a, b) { return a - b; });
}

// The first moment strictly after `after` that this schedule fires, or null.
function nextOccurrence(schedule, zone, after) {
  if (!schedule || !isValidZone(zone) || !(after instanceof Date) || isNaN(after.getTime())) return null;
  if (schedule.type === "once") {
    return occurrencesOnDate(schedule, zone, schedule.date).filter(function (d) { return d > after; })[0] || null;
  }
  // Start a day early: the local date of `after` can differ from the date of a nearby moment.
  let day = addDays(localDate(after, zone), -1);
  for (let i = 0; i < 10; i++) {
    const hit = occurrencesOnDate(schedule, zone, day).filter(function (d) { return d > after; })[0];
    if (hit) return hit;
    day = addDays(day, 1);
  }
  return null;
}

// The next n moments after `after`.
function upcoming(schedule, zone, after, n) {
  const out = [];
  let cursor = after;
  for (let i = 0; i < n; i++) {
    const next = nextOccurrence(schedule, zone, cursor);
    if (!next) break;
    out.push(next);
    cursor = next;
  }
  return out;
}

// Moments on the local calendar day that contains `now`.
function todayOccurrences(schedule, zone, now) {
  if (!isValidZone(zone)) return [];
  return occurrencesOnDate(schedule, zone, localDate(now, zone));
}

// Is this moment inside quiet hours? start is inclusive, end exclusive; the
// window may cross midnight (22:00 to 07:00). Compared in the given zone.
function inQuietHours(date, quiet, zone) {
  if (!quiet || quiet.enabled !== true || !isValidZone(zone)) return false;
  const dt = DateTime.fromJSDate(date, { zone: zone });
  const minutes = dt.hour * 60 + dt.minute;
  const toMin = function (t) { return Number(t.slice(0, 2)) * 60 + Number(t.slice(3)); };
  const start = toMin(quiet.start);
  const end = toMin(quiet.end);
  if (start === end) return false;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

module.exports = { isValidZone, localDate, occurrencesOnDate, nextOccurrence, upcoming, todayOccurrences, inQuietHours };
