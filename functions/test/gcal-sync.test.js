"use strict";
// Google Calendar sync rules. The payloads are shaped like Google's documentation (start.date / start.dateTime, exclusive all-day end,
// recurrence lines, recurringEventId + originalStartTime, status "cancelled", reminders {useDefault, overrides}), written by hand.
// Passing these tests shows the rules are consistent with those shapes. It does NOT show they work against real Google answers.
const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../lib/gcal-sync.js");
const C = require("../../js/calendar-logic.js");      // only to check that what comes in is something JARVIS accepts
const I = require("../../js/ics-logic.js");           // only to check the two repeat readers agree

const ZONE = "America/New_York";
const frozen = (x) => { if (x && typeof x === "object" && !Object.isFrozen(x)) { Object.freeze(x); Object.values(x).forEach(frozen); } return x; };
const T0 = Date.parse("2026-11-04T15:00:00Z");
const upd = (ms) => new Date(ms).toISOString();
const ev = (o) => Object.assign({ id: "ev_1", title: "Client call", description: "", notes: "", kind: "event", category: "work", priority: "medium", allDay: false, date: "2026-11-04", time: "13:00", endDate: "2026-11-04", endTime: "14:30", tz: ZONE, repeat: null, exceptions: [], reminders: [], completed: false, source: "local", externalId: "", createdAt: 1, updatedAt: 1000 }, o);
const gev = (o) => Object.assign({ kind: "calendar#event", id: "g1", status: "confirmed", summary: "Team sync", start: { dateTime: "2026-11-09T10:00:00-05:00", timeZone: ZONE }, end: { dateTime: "2026-11-09T11:00:00-05:00", timeZone: ZONE }, updated: upd(T0) }, o);
const accepted = (input) => { const r = C.check(input, { zone: input.tz, defaultDuration: 60 }); assert.ok(r.ok, "JARVIS refuses it: " + r.error); return r.event; };
const state = (map) => ({ syncToken: "tok1", map: map || {} });

test("ids: only the characters Google allows, 5 to 1024 of them, the same every time, and recognisable as ours", () => {
  for (const id of ["ev_1", "ev_abc123xyz", "a", "café ☕", "x".repeat(80)]) {
    const g = G.idFor(id);
    assert.match(g, /^[0-9a-v]{5,1024}$/, id);
    assert.equal(g, G.idFor(id), "deterministic, so a retried create reuses the id");
    assert.equal(G.jarvisIdOf(g), id, "and it can be read back");
  }
  assert.notEqual(G.idFor("ev_1"), G.idFor("ev_2"));
  assert.equal(G.jarvisIdOf("abc123"), null, "an id Google made itself is not ours");
  assert.equal(G.jarvisIdOf(""), null); assert.equal(G.jarvisIdOf(null), null); assert.equal(G.jarvisIdOf("UPPER"), null);
  const g = G.idFor("ev_1");
  for (let i = 0; i < g.length; i++) {
    const bent = g.slice(0, i) + (g[i] === "0" ? "1" : "0") + g.slice(i + 1);
    assert.equal(G.jarvisIdOf(bent), null, "a damaged id is refused (character " + i + ")");
  }
  assert.equal(G.jarvisIdOf(g.slice(0, -1)), null, "so is a cut-off one");
});

test("JARVIS to Google: a timed event carries its offset and zone; the offset follows the clock change", () => {
  const t = G.toGoogle(ev(), {});
  assert.deepEqual(t.body.start, { dateTime: "2026-11-04T13:00:00-05:00", timeZone: ZONE });
  assert.deepEqual(t.body.end, { dateTime: "2026-11-04T14:30:00-05:00", timeZone: ZONE });
  assert.equal(t.body.summary, "Client call"); assert.equal(t.body.status, "confirmed");
  assert.deepEqual(G.toGoogle(ev({ date: "2026-10-31", endDate: "2026-10-31" }), {}).body.start.dateTime, "2026-10-31T13:00:00-04:00", "daylight time before 1 Nov");
  assert.deepEqual(G.toGoogle(ev({ date: "2026-11-01", endDate: "2026-11-01" }), {}).body.start.dateTime, "2026-11-01T13:00:00-05:00", "standard time after it");
  const night = G.toGoogle(ev({ time: "22:00", endDate: "2026-11-05", endTime: "01:00" }), {}).body.end;
  assert.equal(night.dateTime, "2026-11-05T01:00:00-05:00");
  assert.equal(G.toGoogle(ev({ description: "Agenda", notes: "Bring samples" }), {}).body.description, "Agenda\n\nNotes: Bring samples");
  assert.equal(G.toGoogle(ev({ description: "" }), {}).body.description, undefined);
});

test("JARVIS to Google: all-day ends on the day AFTER; milestones become 15 minutes; tasks and reminders are not sent", () => {
  assert.deepEqual(G.toGoogle(ev({ allDay: true, time: "", endTime: "", date: "2026-11-26", endDate: "2026-11-27" }), {}).body.end, { date: "2026-11-28" });
  assert.deepEqual(G.toGoogle(ev({ allDay: true, time: "", endTime: "", date: "2026-11-26", endDate: "2026-11-26" }), {}).body.start, { date: "2026-11-26" });
  const m = G.toGoogle(ev({ kind: "milestone", endTime: "" }), {});
  assert.equal(m.body.end.dateTime, "2026-11-04T13:15:00-05:00"); assert.match(m.dropped[0], /milestone has no length/);
  assert.deepEqual(G.toGoogle(ev({ kind: "milestone", time: "", endTime: "" }), {}).body.start, { date: "2026-11-04" }, "a milestone with no time is all-day");
  assert.match(G.toGoogle(ev({ kind: "task" }), {}).skip, /no Google Calendar equivalent/);
  assert.match(G.toGoogle(ev({ kind: "reminder" }), {}).skip, /no Google Calendar equivalent/);
  assert.equal(G.syncable(ev({ kind: "block" })), true); assert.equal(G.syncable(ev({ kind: "task" })), false);
});

test("JARVIS to Google: repeats, skipped days and reminders", () => {
  const w = G.toGoogle(ev({ date: "2026-11-02", time: "09:00", endTime: "09:30", repeat: { freq: "weekly", interval: 2, byDay: [1, 3], until: "2026-12-30" }, exceptions: ["2026-11-18", "2026-11-04"], reminders: [30, 10] }), {});
  assert.deepEqual(w.body.recurrence, ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261230T140000Z", "EXDATE;TZID=America/New_York:20261104T090000", "EXDATE;TZID=America/New_York:20261118T090000"]);
  assert.deepEqual(w.body.reminders, { useDefault: false, overrides: [{ method: "popup", minutes: 30 }, { method: "popup", minutes: 10 }] }, "explicit reminders, not Google's defaults");
  assert.deepEqual(G.toGoogle(ev({ repeat: { freq: "monthly", interval: 1, count: 6 } }), {}).body.recurrence, ["RRULE:FREQ=MONTHLY;COUNT=6"]);
  assert.equal(G.toGoogle(ev(), {}).body.recurrence, undefined);
  // all-day: Google counts back from midnight, JARVIS from 9:00 AM that day
  const a = G.toGoogle(ev({ allDay: true, time: "", endTime: "", date: "2026-11-26", endDate: "2026-11-26", reminders: [1440, 600, 540, 0] }), { allDayAt: "09:00" });
  assert.deepEqual(a.body.reminders.overrides.map((r) => r.minutes), [900, 60, 0], "1 day before 9 AM is 900 minutes before midnight; 540 is midnight itself");
  assert.equal(a.dropped.length, 1); assert.match(a.dropped[0], /reminder of 0 minutes can't be expressed/, "9 AM that day is after midnight: Google can't count forward");
  assert.match(G.toGoogle(ev({ reminders: [10080] }), {}).body.reminders.overrides.length === 1 ? "ok" : "no", /ok/);
});

test("Google to JARVIS: timed, with its zone; a time with only an offset is shown in your zone; all-day with the exclusive end", () => {
  const a = G.fromGoogle(gev({ location: "Room 4", description: "Weekly sync" }), { zone: ZONE });
  assert.equal(a.kind, "upsert"); assert.equal(a.externalId, "g1");
  assert.deepEqual([a.input.date, a.input.time, a.input.endDate, a.input.endTime, a.input.tz, a.input.allDay], ["2026-11-09", "10:00", "2026-11-09", "11:00", ZONE, false]);
  assert.equal(a.input.description, "Location: Room 4\nWeekly sync");
  assert.equal(a.meta.updated, T0); assert.equal(a.meta.source, "google");
  const london = G.fromGoogle(gev({ start: { dateTime: "2026-11-09T10:00:00Z", timeZone: "Europe/London" }, end: { dateTime: "2026-11-09T11:00:00Z", timeZone: "Europe/London" } }), { zone: ZONE });
  assert.deepEqual([london.input.time, london.input.tz], ["10:00", "Europe/London"], "the event keeps the zone Google gave it");
  const plain = G.fromGoogle(gev({ start: { dateTime: "2026-11-09T15:00:00Z" }, end: { dateTime: "2026-11-09T16:00:00Z" } }), { zone: ZONE });
  assert.deepEqual([plain.input.time, plain.input.tz], ["10:00", ZONE], "no zone given: the moment is shown in your zone (15:00Z is 10 AM EST)");
  const trip = G.fromGoogle(gev({ start: { date: "2026-11-20" }, end: { date: "2026-11-23" } }), { zone: ZONE });
  assert.deepEqual([trip.input.allDay, trip.input.date, trip.input.endDate], [true, "2026-11-20", "2026-11-22"], "3 nights: Google's end date is the day after the last day");
  assert.equal(G.fromGoogle(gev({ start: { date: "2026-11-20" }, end: { date: "2026-11-21" } }), { zone: ZONE }).input.endDate, "2026-11-20", "one all-day event");
  assert.equal(G.fromGoogle(gev({ summary: "  " }), { zone: ZONE }).input.title, "(no title)");
  assert.match(G.fromGoogle(gev({ end: {} }), { zone: ZONE }).notes.join(" "), /no usable end time/);
});

test("Google to JARVIS: cancelled, changed or cancelled showings of a repeating event, and what can't be read", () => {
  assert.deepEqual(G.fromGoogle(gev({ status: "cancelled" }), {}), { kind: "delete", externalId: "g1" });
  const ex = G.fromGoogle({ id: "g1_20261116T150000Z", status: "cancelled", recurringEventId: "g1", originalStartTime: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: ZONE } }, { zone: ZONE });
  assert.deepEqual([ex.kind, ex.parentId, ex.date], ["exception", "g1", "2026-11-16"], "a cancelled showing becomes a skipped day on the series");
  assert.equal(G.fromGoogle({ id: "x", status: "cancelled", recurringEventId: "g1", originalStartTime: { date: "2026-11-16" } }, {}).date, "2026-11-16");
  const moved = G.fromGoogle(gev({ id: "g1_2", recurringEventId: "g1", originalStartTime: { dateTime: "2026-11-16T10:00:00-05:00" } }), { zone: ZONE });
  assert.equal(moved.kind, "skip"); assert.match(moved.reason, /one changed showing of a repeating event/);
  assert.equal(G.fromGoogle({ summary: "no id" }, {}).kind, "skip");
  assert.match(G.fromGoogle(gev({ start: undefined }), {}).reason, /no start/);
  assert.match(G.fromGoogle(gev({ start: { dateTime: "nonsense" } }), {}).reason, /start time isn't readable/);
  assert.match(G.fromGoogle(gev({ start: { date: "2026-13-45" } }), {}).reason, /start date isn't readable/);
});

test("Google to JARVIS: repeats, skipped days and reminders", () => {
  const r = G.fromGoogle(gev({ recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T045959Z", "EXDATE;TZID=America/New_York:20261111T100000", "EXDATE:20261118T150000Z"] }), { zone: ZONE });
  assert.deepEqual(r.input.repeat, { freq: "weekly", interval: 1, byDay: [1, 3], until: "2026-12-30" }, "UNTIL 04:59 UTC on 31 Dec is still the evening of 30 Dec in New York");
  assert.deepEqual(r.meta.exceptions, ["2026-11-11", "2026-11-18"]);
  const hard = G.fromGoogle(gev({ recurrence: ["RRULE:FREQ=MONTHLY;BYDAY=1MO"] }), { zone: ZONE });
  assert.equal(hard.input.repeat, undefined); assert.match(hard.notes.join(" "), /only its first showing was kept/);
  assert.match(G.fromGoogle(gev({ recurrence: ["RRULE:FREQ=DAILY", "RDATE:20261201T150000Z"] }), { zone: ZONE }).notes.join(" "), /extra dates or exclusion rules were ignored/);
  const rem = G.fromGoogle(gev({ reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 10 }, { method: "email", minutes: 1440 }, { method: "popup", minutes: 10 }, { method: "popup", minutes: 30 }] } }), { zone: ZONE });
  assert.deepEqual(rem.input.reminders, [30, 10], "pop-ups only, no duplicates, longest first");
  assert.match(rem.notes.join(" "), /email reminder was not copied/);
  assert.match(G.fromGoogle(gev({ reminders: { useDefault: true } }), { zone: ZONE }).notes.join(" "), /uses your Google default reminders, which are not copied/);
  const allDay = G.fromGoogle(gev({ start: { date: "2026-11-26" }, end: { date: "2026-11-27" }, reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 900 }] } }), { zone: ZONE, allDayAt: "09:00" });
  assert.deepEqual(allDay.input.reminders, [1440], "900 minutes before midnight is 1 day before 9 AM");
});

test("what comes in is always something JARVIS accepts, and the two repeat readers agree", () => {
  const rules = ["FREQ=DAILY;INTERVAL=3;COUNT=5", "FREQ=WEEKLY;BYDAY=MO,WE,FR", "FREQ=WEEKLY;INTERVAL=2;UNTIL=20261224T150000Z", "FREQ=MONTHLY;COUNT=12", "FREQ=MONTHLY;BYMONTHDAY=4", "FREQ=YEARLY", "FREQ=MONTHLY;BYDAY=1MO", "FREQ=MONTHLY;BYMONTHDAY=15", "FREQ=YEARLY;BYMONTH=6", "FREQ=HOURLY", "FREQ=WEEKLY;BYMONTHDAY=3", "FREQ=DAILY;BYSETPOS=1", "FREQ=DAILY;INTERVAL=0", "INTERVAL=2"];
  rules.forEach((rule) => {
    const g = G.fromGoogle(gev({ start: { dateTime: "2026-11-04T10:00:00-05:00", timeZone: ZONE }, end: { dateTime: "2026-11-04T11:00:00-05:00", timeZone: ZONE }, recurrence: ["RRULE:" + rule] }), { zone: ZONE });
    accepted(g.input);
    const ics = I.parse(["BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART;TZID=America/New_York:20261104T100000", "DTEND;TZID=America/New_York:20261104T110000", "UID:r@x", "SUMMARY:R", "RRULE:" + rule, "END:VEVENT", "END:VCALENDAR"].join("\r\n"), { zone: ZONE }).events[0];
    assert.deepEqual(g.input.repeat || null, ics.input.repeat || null, "the same reading for " + rule);
  });
  [gev(), gev({ start: { date: "2026-11-20" }, end: { date: "2026-11-23" } }), gev({ start: { dateTime: "2026-11-09T15:00:00Z" }, end: { dateTime: "2026-11-09T15:00:00Z" } })].forEach((g) => accepted(G.fromGoogle(g, { zone: ZONE }).input));
});

test("JARVIS to Google and back gives the same event", () => {
  const cases = [
    ev(), ev({ allDay: true, time: "", endTime: "", date: "2026-11-26", endDate: "2026-11-28", reminders: [1440] }),
    ev({ date: "2026-11-02", time: "09:00", endTime: "09:30", repeat: { freq: "weekly", interval: 2, byDay: [1, 3], until: "2026-12-30" }, exceptions: ["2026-11-18"], reminders: [30, 10] }),
    ev({ time: "22:00", endDate: "2026-11-05", endTime: "01:00", tz: "Europe/London", reminders: [60] }), ev({ date: "2026-11-01", repeat: { freq: "monthly", interval: 1, count: 6 } })
  ];
  cases.forEach((e) => {
    const t = G.toGoogle(e, { allDayAt: "09:00" }), back = G.fromGoogle(Object.assign({ id: G.idFor(e.id), updated: upd(T0) }, t.body), { zone: ZONE, allDayAt: "09:00" });
    assert.equal(back.kind, "upsert", e.title);
    const keep = (x) => ({ title: x.title, allDay: !!x.allDay, date: x.date, time: x.time || "", endDate: x.endDate, endTime: x.endTime || "", tz: x.tz, repeat: x.repeat || null, reminders: x.reminders || [] });
    assert.deepEqual(keep(back.input), keep(e), JSON.stringify(e.repeat) + " " + e.date);
    assert.deepEqual(back.meta.exceptions, (e.exceptions || []).slice().sort());
    assert.equal(G.jarvisIdOf(back.externalId), e.id, "and its Google id says which JARVIS event it is");
  });
});

test("pulling: the sync token is held back until the last page, and a 410 means start over", () => {
  const s = state();
  const first = G.planPull(s, { status: 200, items: [gev()], nextPageToken: "p2" }, [], { zone: ZONE });
  assert.equal(first.done, false); assert.equal(first.nextSyncToken, null, "not yet");
  const early = G.planPull(s, { status: 200, items: [], nextPageToken: "p2", nextSyncToken: "tooSoon" }, [], { zone: ZONE });
  assert.equal(early.nextSyncToken, null, "a token that arrives before the last page is not kept: it would skip the pages still to come");
  const last = G.planPull(s, { status: 200, items: [], nextSyncToken: "tok2" }, [], { zone: ZONE });
  assert.deepEqual([last.done, last.nextSyncToken], [true, "tok2"]);
  const reset = G.planPull(s, { status: 410, reason: "fullSyncRequired" }, [], {});
  assert.deepEqual([reset.resetSync, reset.done], [true, true]);
  assert.equal(G.planPull(s, { status: 410, reason: "updatedMinTooLongAgo" }, [], {}).resetSync, true);
  const gone = G.planPull(s, { status: 410, reason: "deleted" }, [], {});
  assert.deepEqual([gone.resetSync, gone.done, gone.upserts.length], [false, true, 0], "an already-deleted event needs nothing");
  assert.match(G.planPull(s, { status: 500 }, [], {}).error, /Google answered 500/);
  assert.match(G.planPull(s, null, [], {}).error, /no answer/);
});

test("pulling: new events, changed events, deletions, skipped showings", () => {
  const map = { ev_1: { googleId: "g1", syncedAt: 1000, googleUpdated: T0 - 5000 }, ev_2: { googleId: "g2", syncedAt: 1000, googleUpdated: T0 - 5000 } };
  const events = [ev({ id: "ev_1", source: "google", externalId: "g1", updatedAt: 1000 }), ev({ id: "ev_2", source: "google", externalId: "g2", updatedAt: 1000 })];
  const r = G.planPull(state(map), { status: 200, items: [
    gev({ id: "g1", summary: "Renamed at Google" }), gev({ id: "g3", summary: "Brand new" }), gev({ id: "g2", status: "cancelled" }),
    { id: "g1_x", status: "cancelled", recurringEventId: "g1", originalStartTime: { date: "2026-11-16" } },
    { id: "g9_x", status: "cancelled", recurringEventId: "g9", originalStartTime: { date: "2026-11-16" } },
    gev({ id: "g1_y", recurringEventId: "g1", originalStartTime: { date: "2026-11-23" } })
  ], nextSyncToken: "tok9" }, events, { zone: ZONE });
  assert.deepEqual(r.upserts.map((u) => [u.googleId, u.jarvisId, u.isNew, u.input.title]), [["g1", "ev_1", false, "Renamed at Google"], ["g3", null, true, "Brand new"]]);
  assert.deepEqual(r.deletes.map((d) => [d.googleId, d.jarvisId]), [["g2", "ev_2"]]);
  assert.deepEqual(r.exceptions, [{ jarvisId: "ev_1", date: "2026-11-16" }], "a cancelled showing becomes a skipped day on the series we have");
  assert.deepEqual(r.skipped.map((s) => s.externalId).sort(), ["g1_y", "g9_x"], "a changed showing, and a showing of a series that isn't here");
  assert.equal(r.nextSyncToken, "tok9"); assert.deepEqual(r.conflicts, []);
  // the same event twice in one page: the later change counts
  const twice = G.planPull(state(), { status: 200, items: [gev({ id: "gd", summary: "Old", updated: upd(T0 - 1000) }), gev({ id: "gd", summary: "Newer", updated: upd(T0) })] }, [], { zone: ZONE });
  assert.deepEqual(twice.upserts.map((u) => u.input.title), ["Newer"]);
});

test("when both sides changed: the newer edit wins, a deletion wins, and every case is reported", () => {
  const map = { ev_1: { googleId: "g1", syncedAt: 1000, googleUpdated: T0 - 5000 } };
  // edited here AFTER Google's edit -> yours is kept
  const mineNewer = G.planPull(state(map), { status: 200, items: [gev({ id: "g1", updated: upd(T0) })] }, [ev({ id: "ev_1", updatedAt: T0 + 60000 })], { zone: ZONE });
  assert.deepEqual(mineNewer.upserts, []); assert.equal(mineNewer.conflicts[0].winner, "jarvis"); assert.match(mineNewer.conflicts[0].why, /newer edit is kept/);
  // edited here BEFORE Google's edit -> Google's replaces it
  const theirsNewer = G.planPull(state(map), { status: 200, items: [gev({ id: "g1", updated: upd(T0) })] }, [ev({ id: "ev_1", updatedAt: T0 - 60000 })], { zone: ZONE });
  assert.equal(theirsNewer.upserts.length, 1); assert.equal(theirsNewer.conflicts[0].winner, "google");
  // not edited here since the last sync: no conflict
  assert.deepEqual(G.planPull(state(map), { status: 200, items: [gev({ id: "g1" })] }, [ev({ id: "ev_1", updatedAt: 1000 })], { zone: ZONE }).conflicts, []);
  // deleted at Google after an edit here: the deletion wins, kept in the 30-day trash, and said so
  const del = G.planPull(state(map), { status: 200, items: [gev({ id: "g1", status: "cancelled" })] }, [ev({ id: "ev_1", updatedAt: 5000 })], { zone: ZONE });
  assert.equal(del.deletes.length, 1); assert.match(del.conflicts[0].why, /deletion wins.*30 days/);
  // already deleted here: nothing to do but forget the link
  const already = G.planPull(state(map), { status: 200, items: [gev({ id: "g1", status: "cancelled" })] }, [ev({ id: "ev_1", deletedAt: 3000, updatedAt: 3000 })], { zone: ZONE });
  assert.deepEqual(already.deletes, [{ googleId: "g1", jarvisId: "ev_1", already: true }]);
});

test("after a full sync, linked events that Google no longer returns were deleted there", () => {
  const map = { ev_1: { googleId: "g1", syncedAt: 1 }, ev_2: { googleId: "g2", syncedAt: 1 }, ev_3: { googleId: "g3", syncedAt: 1 } };
  const r = G.planFullReconcile(state(map), ["g1", "g3"], [ev({ id: "ev_1" }), ev({ id: "ev_2" }), ev({ id: "ev_3" })]);
  assert.deepEqual(r.deletes, [{ googleId: "g2", jarvisId: "ev_2" }]);
  assert.deepEqual(G.planFullReconcile(state(map), ["g1", "g2", "g3"], [ev({ id: "ev_1" }), ev({ id: "ev_2" }), ev({ id: "ev_3" })]).deletes, []);
  assert.deepEqual(G.planFullReconcile(state(map), [], [ev({ id: "ev_2", deletedAt: 5 })]).deletes, [], "one already deleted here is not deleted again");
});

test("pushing: creates, updates, deletes; no echo of what was just pulled; what is left out is said", () => {
  const map = { ev_2: { googleId: "g2", syncedAt: 1000 }, ev_3: { googleId: "g3", syncedAt: 1000 }, ev_4: { googleId: "g4", syncedAt: 1000 } };
  const events = [
    ev({ id: "ev_1", title: "New here" }),
    ev({ id: "ev_2", title: "Edited here", updatedAt: 2000 }),
    ev({ id: "ev_3", title: "Unchanged", updatedAt: 1000 }),
    ev({ id: "ev_4", deletedAt: 3000, updatedAt: 3000 }),
    ev({ id: "ev_5", deletedAt: 3000, updatedAt: 3000 }),
    ev({ id: "ev_6", kind: "task" }),
    ev({ id: "ev_7", source: "google", externalId: "gx" }),
    ev({ id: "ev_8", allDay: true, time: "", endTime: "", reminders: [0] })
  ];
  const r = G.planPush(state(map), events, { allDayAt: "09:00" });
  assert.deepEqual(r.creates.map((c) => c.jarvisId), ["ev_1", "ev_8"]);
  assert.equal(r.creates[0].id, G.idFor("ev_1")); assert.equal(r.creates[0].body.id, G.idFor("ev_1"), "created with our own id, so a retry can't make a second copy");
  assert.deepEqual(r.updates.map((u) => [u.jarvisId, u.googleId, u.body.summary]), [["ev_2", "g2", "Edited here"]]);
  assert.deepEqual(r.deletes, [{ jarvisId: "ev_4", googleId: "g4" }], "deleted here and linked; one deleted here that was never sent needs nothing");
  assert.deepEqual(r.skipped.map((s) => s.jarvisId), ["ev_6", "ev_7"]);
  assert.match(r.skipped[0].reason, /no Google Calendar equivalent/); assert.match(r.skipped[1].reason, /link is missing/);
  assert.equal(r.dropped.length, 1); assert.equal(r.dropped[0].jarvisId, "ev_8");
  // pull an event, save it here, remember it: pushing then has nothing to say about it
  const pulled = G.planPull(state(), { status: 200, items: [gev({ id: "g7" })], nextSyncToken: "t" }, [], { zone: ZONE }).upserts[0];
  const savedAt = 5000, next = G.commit(state(), { pulled: [{ googleId: pulled.googleId, jarvisId: "ev_9", updatedAt: savedAt, googleUpdated: pulled.meta.updated }], syncToken: "t" });
  assert.deepEqual(G.planPush(next, [ev({ id: "ev_9", source: "google", externalId: "g7", updatedAt: savedAt })], {}), { creates: [], updates: [], deletes: [], skipped: [], dropped: [] }, "no echo");
  assert.equal(G.planPush(next, [ev({ id: "ev_9", source: "google", externalId: "g7", updatedAt: savedAt + 1 })], {}).updates.length, 1, "but an edit after that is sent");
});

test("remembering what was done: links, the token, removals, and a reset keeps the links", () => {
  const s = state({ ev_1: { googleId: "g1", syncedAt: 1, googleUpdated: 1 }, ev_2: { googleId: "g2", syncedAt: 1, googleUpdated: 1 } });
  const n = G.commit(s, { pulled: [{ googleId: "g3", jarvisId: "ev_3", updatedAt: 9, googleUpdated: 7 }], pushed: [{ jarvisId: "ev_4", googleId: "g4", updatedAt: 10, googleUpdated: 8 }], removed: ["g1"], deletedHere: ["ev_2"], syncToken: "tok7" });
  assert.deepEqual(Object.keys(n.map).sort(), ["ev_3", "ev_4"]); assert.equal(n.syncToken, "tok7");
  assert.equal(n.map.ev_3.syncedAt, 9);
  assert.equal(G.commit(s, {}).syncToken, "tok1", "no new token: the old one stays");
  const r = G.commit(s, { resetSync: true });
  assert.equal(r.syncToken, ""); assert.deepEqual(Object.keys(r.map).sort(), ["ev_1", "ev_2"], "links are kept through a reset; the full sync that follows delivers everything again onto them");
});

test("nothing here changes what it is given", () => {
  const map = frozen({ ev_1: { googleId: "g1", syncedAt: 1000, googleUpdated: 1 } });
  const events = frozen([ev({ id: "ev_1", updatedAt: 2000, reminders: [10], repeat: { freq: "daily", interval: 1 } })]);
  const st = frozen(state(map));
  G.toGoogle(events[0], {}); G.planPush(st, events, {});
  G.planPull(st, frozen({ status: 200, items: [gev({ id: "g1", recurrence: ["RRULE:FREQ=DAILY"], reminders: { overrides: [{ method: "popup", minutes: 5 }] } })], nextSyncToken: "t" }), events, { zone: ZONE });
  G.planFullReconcile(st, ["g1"], events); G.commit(st, { pulled: [{ googleId: "g2", jarvisId: "ev_2", updatedAt: 1 }] });
});
