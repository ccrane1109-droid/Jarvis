"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { DateTime } = require("luxon");
const time = require("../lib/reminder-time");

const NY = "America/New_York";
const iso = (list) => list.map((d) => d.toISOString());
const daily = (...times) => ({ type: "daily", times: times, days: [], date: null });
const weekly = (days, ...times) => ({ type: "weekly", times: times, days: days, date: null });
const once = (date, t) => ({ type: "once", times: [t], days: [], date: date });
const at = (s) => new Date(s);

test("daily: the next time today, or the first time tomorrow", () => {
  const s = daily("09:00", "13:00");
  assert.equal(time.nextOccurrence(s, NY, at("2026-10-14T15:00:00Z")).toISOString(), "2026-10-14T17:00:00.000Z"); // 11 AM -> 1 PM
  assert.equal(time.nextOccurrence(s, NY, at("2026-10-14T17:00:00Z")).toISOString(), "2026-10-15T13:00:00.000Z", "strictly after: a moment that is exactly now is not next");
  assert.equal(time.nextOccurrence(s, NY, at("2026-10-14T21:00:00Z")).toISOString(), "2026-10-15T13:00:00.000Z"); // 5 PM -> 9 AM tomorrow
});

test("weekly: only the chosen days, Sunday is 0", () => {
  const mwf = weekly([1, 3, 5], "18:00");
  assert.deepEqual(iso(time.upcoming(mwf, NY, at("2026-10-15T16:00:00Z"), 3)), // Thursday noon
    ["2026-10-16T22:00:00.000Z", "2026-10-19T22:00:00.000Z", "2026-10-21T22:00:00.000Z"]);
  const sunday = weekly([0], "08:00");
  assert.equal(time.nextOccurrence(sunday, NY, at("2026-10-17T12:00:00Z")).toISOString(), "2026-10-18T12:00:00.000Z"); // Sat -> Sun 8 AM EDT
  assert.equal(time.nextOccurrence(weekly([6], "08:00"), NY, at("2026-10-17T12:00:00Z")).toISOString(), "2026-10-24T12:00:00.000Z", "8 AM Saturday has passed, so next week");
});

test("one time: fires once and never again", () => {
  const s = once("2026-10-20", "09:00");
  assert.equal(time.nextOccurrence(s, NY, at("2026-10-14T15:00:00Z")).toISOString(), "2026-10-20T13:00:00.000Z");
  assert.equal(time.nextOccurrence(s, NY, at("2026-10-20T13:00:00Z")), null);
  assert.equal(time.nextOccurrence(s, NY, at("2026-11-20T00:00:00Z")), null);
});

test("clocks spring forward: a time that doesn't exist is shifted forward by the gap, once", () => {
  const s = daily("02:30");
  assert.deepEqual(iso(time.upcoming(s, NY, at("2026-03-06T12:00:00Z"), 4)), [
    "2026-03-07T07:30:00.000Z", // 2:30 AM EST
    "2026-03-08T07:30:00.000Z", // 2:30 doesn't exist: 3:30 AM EDT
    "2026-03-09T06:30:00.000Z", // 2:30 AM EDT
    "2026-03-10T06:30:00.000Z"
  ]);
  // An ordinary morning time keeps its wall-clock hour while the UTC time moves.
  assert.deepEqual(iso(time.upcoming(daily("08:00"), NY, at("2026-03-07T00:00:00Z"), 3)),
    ["2026-03-07T13:00:00.000Z", "2026-03-08T12:00:00.000Z", "2026-03-09T12:00:00.000Z"]);
});

test("clocks fall back: a time that happens twice fires once, at its first occurrence", () => {
  const s = daily("01:30");
  const got = time.upcoming(s, NY, at("2026-10-31T12:00:00Z"), 3);
  assert.deepEqual(iso(got), ["2026-11-01T05:30:00.000Z", "2026-11-02T06:30:00.000Z", "2026-11-03T06:30:00.000Z"]);
  assert.equal(time.occurrencesOnDate(s, NY, "2026-11-01").length, 1);
  assert.equal((got[1] - got[0]) / 3600000, 25, "that day is 25 hours long");
  // Two reminders that land on the same moment on the gap day count once.
  assert.equal(time.occurrencesOnDate(daily("02:30", "03:30"), NY, "2026-03-08").length, 1);
});

test("every day of the year, in several zones: one occurrence at the right wall-clock time", () => {
  const zones = ["America/New_York", "America/Los_Angeles", "Europe/London", "Australia/Sydney", "Australia/Lord_Howe", "Asia/Kolkata", "Pacific/Auckland"];
  for (const zone of zones) {
    for (const t of ["00:00", "09:00", "12:15", "23:59"]) {
      let day = DateTime.fromISO("2026-01-01", { zone: "utc" });
      for (let i = 0; i < 365; i++, day = day.plus({ days: 1 })) {
        const got = time.occurrencesOnDate(daily(t), zone, day.toISODate());
        assert.equal(got.length, 1, zone + " " + t + " " + day.toISODate());
        const local = DateTime.fromJSDate(got[0], { zone });
        assert.equal(local.toISODate() + " " + local.toFormat("HH:mm"), day.toISODate() + " " + t, zone + " " + day.toISODate());
      }
    }
  }
});

test("the next moment is always after the one before it, across a whole year", () => {
  for (const zone of ["America/New_York", "Europe/London", "Australia/Sydney"]) {
    const s = daily("01:30", "02:30", "09:00", "21:45");
    let cursor = at("2026-01-01T00:00:00Z");
    for (let i = 0; i < 365 * 4; i++) {
      const next = time.nextOccurrence(s, zone, cursor);
      assert.ok(next > cursor, zone + " step " + i);
      assert.ok(next - cursor <= 26 * 3600000, zone + " step " + i + ": no gap longer than a day");
      cursor = next;
    }
  }
});

test("today's moments follow the reminder's zone, not the server's", () => {
  const s = daily("07:30", "21:00");
  // 11 PM on Oct 14 in New York is already Oct 15 in UTC.
  assert.deepEqual(iso(time.todayOccurrences(s, NY, at("2026-10-15T03:00:00Z"))), ["2026-10-14T11:30:00.000Z", "2026-10-15T01:00:00.000Z"]);
  assert.deepEqual(iso(time.todayOccurrences(s, "Asia/Kolkata", at("2026-10-15T03:00:00Z"))), ["2026-10-15T02:00:00.000Z", "2026-10-15T15:30:00.000Z"]);
  assert.deepEqual(time.todayOccurrences(weekly([1], "09:00"), NY, at("2026-10-14T15:00:00Z")), [], "Wednesday isn't Monday");
});

test("quiet hours: start inclusive, end exclusive, may cross midnight", () => {
  const q = { enabled: true, start: "22:00", end: "07:00" };
  assert.equal(time.inQuietHours(at("2026-10-15T02:00:00Z"), q, NY), true); // 10 PM EDT
  assert.equal(time.inQuietHours(at("2026-10-15T01:59:00Z"), q, NY), false); // 9:59 PM
  assert.equal(time.inQuietHours(at("2026-10-15T10:59:00Z"), q, NY), true); // 6:59 AM
  assert.equal(time.inQuietHours(at("2026-10-15T11:00:00Z"), q, NY), false); // 7:00 AM
  const day = { enabled: true, start: "13:00", end: "15:00" };
  assert.equal(time.inQuietHours(at("2026-10-14T17:00:00Z"), day, NY), true);
  assert.equal(time.inQuietHours(at("2026-10-14T19:00:00Z"), day, NY), false);
  assert.equal(time.inQuietHours(at("2026-10-15T02:00:00Z"), { enabled: false, start: "22:00", end: "07:00" }, NY), false);
  assert.equal(time.inQuietHours(at("2026-10-15T02:00:00Z"), { enabled: true, start: "08:00", end: "08:00" }, NY), false, "an empty window is off");
  assert.equal(time.inQuietHours(at("2026-10-15T02:00:00Z"), q, "Not/AZone"), false);
});

test("bad input gives null or nothing, never a wrong time", () => {
  assert.equal(time.nextOccurrence(daily("09:00"), "Not/AZone", at("2026-10-14T15:00:00Z")), null);
  assert.equal(time.nextOccurrence(daily("09:00"), NY, new Date("nope")), null);
  assert.equal(time.nextOccurrence(null, NY, at("2026-10-14T15:00:00Z")), null);
  assert.equal(time.nextOccurrence(weekly([], "09:00"), NY, at("2026-10-14T15:00:00Z")), null);
  assert.equal(time.isValidZone("America/New_York"), true);
  assert.equal(time.isValidZone("Mars/Base"), false);
  assert.equal(time.isValidZone(""), false);
  assert.equal(time.isValidZone(5), false);
});
