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

test("a repeated wall-clock time is always its FIRST occurrence, with exact moments, in zones with different rules", () => {
  const ms = (isoDate, t, zone) => new Date(time.localInstant(isoDate, t, zone)).toISOString();
  // New York, 2026-11-01: 2:00 EDT -> 1:00 EST. 1:30 happens at 05:30Z (EDT) and again at 06:30Z (EST).
  assert.equal(ms("2026-11-01", "01:30", NY), "2026-11-01T05:30:00.000Z");
  assert.equal(ms("2026-11-01", "01:00", NY), "2026-11-01T05:00:00.000Z");
  assert.equal(ms("2026-11-01", "01:59", NY), "2026-11-01T05:59:00.000Z");
  // Either side of the repeated hour is unambiguous.
  assert.equal(ms("2026-11-01", "00:59", NY), "2026-11-01T04:59:00.000Z");
  assert.equal(ms("2026-11-01", "02:00", NY), "2026-11-01T07:00:00.000Z");
  assert.equal(ms("2026-11-01", "02:30", NY), "2026-11-01T07:30:00.000Z");
  // London, 2026-10-25: 2:00 BST -> 1:00 GMT. 1:30 happens at 00:30Z (BST) and again at 01:30Z (GMT).
  assert.equal(ms("2026-10-25", "01:30", "Europe/London"), "2026-10-25T00:30:00.000Z");
  assert.equal(ms("2026-10-25", "02:00", "Europe/London"), "2026-10-25T02:00:00.000Z");
  // Lord Howe Island, 2026-04-05: 2:00 (+11:00) -> 1:30 (+10:30), a 30-minute change. 1:45 happens at 14:45Z and 15:15Z on Apr 4.
  assert.equal(ms("2026-04-05", "01:45", "Australia/Lord_Howe"), "2026-04-04T14:45:00.000Z");
  assert.equal(ms("2026-04-05", "01:15", "Australia/Lord_Howe"), "2026-04-04T14:15:00.000Z");
  // Sydney, 2026-04-05: 3:00 AEDT -> 2:00 AEST. 2:30 happens at 15:30Z (Apr 4) and 16:30Z.
  assert.equal(ms("2026-04-05", "02:30", "Australia/Sydney"), "2026-04-04T15:30:00.000Z");
});

test("a time that doesn't exist is still shifted forward by the gap, and ordinary times are untouched", () => {
  const ms = (isoDate, t, zone) => new Date(time.localInstant(isoDate, t, zone)).toISOString();
  assert.equal(ms("2026-03-08", "02:30", NY), "2026-03-08T07:30:00.000Z"); // 3:30 AM EDT
  assert.equal(ms("2026-03-08", "02:00", NY), "2026-03-08T07:00:00.000Z"); // 3:00 AM EDT
  assert.equal(ms("2026-03-08", "01:59", NY), "2026-03-08T06:59:00.000Z");
  assert.equal(ms("2026-03-29", "01:30", "Europe/London"), "2026-03-29T01:30:00.000Z"); // 1:30 GMT doesn't exist: 2:30 BST
  assert.equal(ms("2026-06-15", "01:30", NY), "2026-06-15T05:30:00.000Z");
  assert.equal(ms("2026-01-15", "13:45", NY), "2026-01-15T18:45:00.000Z");
  assert.ok(isNaN(time.localInstant("2026-02-30", "09:00", NY)), "an impossible date is not a moment");
  assert.ok(isNaN(time.localInstant("2026-02-10", "25:00", NY)), "an impossible time is not a moment");
});

test("checked against a brute-force scan: around every clock change, every quarter hour resolves to the earliest matching moment", () => {
  const zones = ["America/New_York", "Europe/London", "Australia/Sydney", "Australia/Lord_Howe", "Pacific/Auckland", "America/Santiago", "America/Havana", "Europe/Berlin"];
  const wall = (instant, zone) => DateTime.fromMillis(instant, { zone }).toFormat("yyyy-MM-dd HH:mm");
  let ambiguous = 0;
  let gaps = 0;
  for (const zone of zones) {
    let day = DateTime.fromISO("2026-01-01", { zone: "utc" });
    for (let i = 0; i < 365; i++, day = day.plus({ days: 1 })) {
      // Only days near a clock change: skip a day when the offset is the same at UTC midnight two days either side.
      const offsetAt = (d) => DateTime.fromMillis(d.toMillis(), { zone }).offset;
      const here = offsetAt(day);
      if ([-2, -1, 1, 2].every((n) => offsetAt(day.plus({ days: n })) === here)) continue;
      for (let q = 0; q < 96; q++) {
        const t = String(Math.floor(q / 4)).padStart(2, "0") + ":" + String((q % 4) * 15).padStart(2, "0");
        const target = day.toISODate() + " " + t;
        const asIfUtc = DateTime.fromISO(day.toISODate() + "T" + t, { zone: "utc" }).toMillis();
        const matches = [];
        for (let m = asIfUtc - 15 * 3600000; m <= asIfUtc + 15 * 3600000; m += 15 * 60000) if (wall(m, zone) === target) matches.push(m);
        const got = time.localInstant(day.toISODate(), t, zone);
        if (matches.length === 0) {
          gaps++;
          assert.equal(got, DateTime.fromISO(day.toISODate() + "T" + t, { zone }).toMillis(), zone + " " + target + " (doesn't exist: the library's shifted-forward result)");
        } else {
          if (matches.length > 1) ambiguous++;
          assert.equal(got, matches[0], zone + " " + target + " (" + matches.length + " matching moment(s))");
        }
      }
    }
  }
  assert.ok(ambiguous >= 30 && gaps >= 30, "the scan really covered both kinds of odd time (" + ambiguous + " repeated, " + gaps + " missing)");
});

test("quiet hours that end at a repeated time end at its first occurrence", () => {
  const quiet = { enabled: true, start: "22:00", end: "01:30" };
  // Midnight EDT on the day the clocks go back: quiet hours end at the first 1:30 (05:30Z), not the second.
  assert.equal(time.quietEndAfter(at("2026-11-01T04:00:00Z"), quiet, NY).toISOString(), "2026-11-01T05:30:00.000Z");
  // Once the first 1:30 has passed, the next end is the following night's.
  assert.equal(time.quietEndAfter(at("2026-11-01T05:45:00Z"), quiet, NY).toISOString(), "2026-11-02T06:30:00.000Z");
  // An ordinary quiet-hours end is unchanged.
  assert.equal(time.quietEndAfter(at("2026-10-14T03:00:00Z"), { enabled: true, start: "22:00", end: "07:00" }, NY).toISOString(), "2026-10-14T11:00:00.000Z");
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
