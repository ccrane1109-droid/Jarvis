"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../../js/calendar-logic.js");
const I = require("../../js/ics-logic.js");

const ZONE = "America/New_York";
let seq = 0;
const ctx = () => ({ now: 1, zone: ZONE, defaultDuration: 60, makeId: () => "e" + (++seq) });
function build(list) {
  let events = [];
  list.forEach((o) => { const r = C.add(events, Object.assign({ title: "Thing", kind: "event", category: "work", priority: "medium", endDate: o.date, tz: ZONE }, o), ctx()); assert.ok(r.ok, r.error); events = r.events; });
  return events;
}
const ev = (title, date, time, endTime, extra) => Object.assign({ title, date, time, endTime }, extra || {});
const frozen = (x) => { if (x && typeof x === "object" && !Object.isFrozen(x)) { Object.freeze(x); Object.values(x).forEach(frozen); } return x; };
const NOW = Date.UTC(2026, 10, 4, 15, 20);
const lines = (txt) => I.unfold(txt).filter(Boolean);
const importAll = (text, existing, o) => { const parsed = I.parse(text, Object.assign({ zone: ZONE }, o)); const planned = I.plan(existing || [], parsed, { defaultDuration: 60 }); return { parsed, planned, res: I.apply(existing || [], planned, ctx()) }; };
const shape = (e) => ({ title: e.title, description: e.description, kind: e.kind, priority: e.priority, allDay: e.allDay, date: e.date, time: e.time, endDate: e.endDate, endTime: e.endTime, tz: e.tz, repeat: e.repeat, reminders: e.reminders });

test("lines are folded at 75 bytes (even with accents and emoji) and unfold back exactly", () => {
  const long = "DESCRIPTION:" + "Café ☕ meeting notes, with commas; and more. ".repeat(12);
  const folded = I.fold(long);
  const enc = new TextEncoder();
  folded.split("\r\n").forEach((l, i) => assert.ok(enc.encode(l).length <= 75, "line " + i + " is " + enc.encode(l).length + " bytes"));
  assert.ok(folded.includes("\r\n "), "it was folded");
  assert.equal(I.unfold(folded)[0], long);
  assert.deepEqual(I.unfold("A:1\r\nB:2\r\n  continued\r\nC:3"), ["A:1", "B:2 continued", "C:3"], "a line starting with a space continues the one before");
});

test("writing a file: the parts a calendar needs, with the right dates", () => {
  const events = build([
    ev("Client call", "2026-11-04", "13:00", "14:30", { priority: "high", description: "Agenda, items; two\nlines", notes: "Bring samples", reminders: [30, 1440], category: "business" }),
    ev("Holiday", "2026-11-26", "", "", { allDay: true, endDate: "2026-11-27" }),
    ev("Send invoice", "2026-11-05", "", "", { kind: "task" }),
    ev("Call back", "2026-11-05", "16:00", "", { kind: "task" })
  ]);
  const txt = I.toICS(events, { now: NOW });
  assert.ok(txt.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n") && txt.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(txt), "every line ends with CRLF");
  const L = lines(txt);
  assert.ok(L.includes("DTSTART;TZID=America/New_York:20261104T130000") && L.includes("DTEND;TZID=America/New_York:20261104T143000"));
  assert.ok(L.includes("DTSTART;VALUE=DATE:20261126") && L.includes("DTEND;VALUE=DATE:20261128"), "an all-day event's end is the day AFTER its last day");
  assert.ok(L.includes("DTSTART;VALUE=DATE:20261105"), "a task with no time is an all-day entry");
  assert.ok(L.includes("DTSTART;TZID=America/New_York:20261105T160000") && L.filter((l) => l.startsWith("DTEND")).length === 3, "a timed task has a start and no end");
  assert.ok(L.includes("SUMMARY:Client call") && L.includes("PRIORITY:1") && L.includes("CATEGORIES:Business") && L.includes("X-JARVIS-KIND:event") && L.includes("X-JARVIS-KIND:task"));
  assert.ok(L.includes("DESCRIPTION:Agenda\\, items\\; two\\nlines\\n\\nNotes: Bring samples"), "commas, semicolons and line breaks are escaped");
  assert.ok(L.includes("TRIGGER:-PT1440M") && L.includes("TRIGGER:-PT30M") && L.filter((l) => l === "BEGIN:VALARM").length === 2);
  assert.ok(L.includes("UID:e1@jarvis") && L.includes("DTSTAMP:20261104T152000Z"));
  const gone = C.remove(events, events[0].id, ctx()).events;
  assert.ok(!I.toICS(gone, { now: NOW }).includes("Client call"), "deleted events are left out");
});

test("repeats, skipped dates and the all-day reminder rule are written correctly", () => {
  const events = build([
    ev("Standup", "2026-11-02", "09:00", "09:30", { repeat: { freq: "weekly", interval: 2, byDay: [1, 3], until: "2026-12-30" } }),
    ev("Rent", "2026-11-01", "", "", { allDay: true, repeat: { freq: "monthly", interval: 1, count: 6 }, reminders: [0, 1440] })
  ]);
  events[0] = Object.assign({}, events[0], { exceptions: ["2026-11-18", "2026-11-04"] });
  const L = lines(I.toICS(events, { now: NOW, allDayAt: "09:00" }));
  assert.ok(L.includes("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261230T140000Z"), "UNTIL is the last start in UTC (9 AM EST = 14:00Z): " + L.find((l) => l.startsWith("RRULE:FREQ=WEEKLY")));
  assert.deepEqual(L.filter((l) => l.startsWith("EXDATE")), ["EXDATE;TZID=America/New_York:20261104T090000", "EXDATE;TZID=America/New_York:20261118T090000"]);
  assert.ok(L.includes("RRULE:FREQ=MONTHLY;COUNT=6"));
  assert.ok(L.includes("TRIGGER:PT540M") && L.includes("TRIGGER:-PT900M"), "all-day: 9:00 AM that day is 540 minutes after midnight, and 1 day before that is 900 minutes before midnight");
});

test("reading a file written by JARVIS gives the same events back", () => {
  const events = build([
    ev("Client call", "2026-11-04", "13:00", "14:30", { priority: "high", description: "Agenda, items; two\nlines", reminders: [30, 1440], category: "business" }),
    ev("Holiday", "2026-11-26", "", "", { allDay: true, endDate: "2026-11-28", reminders: [0] }),
    ev("Send invoice", "2026-11-05", "", "", { kind: "task", priority: "low" }),
    ev("Call back", "2026-11-05", "16:00", "", { kind: "task" }),
    ev("Standup", "2026-11-02", "09:00", "09:30", { repeat: { freq: "weekly", interval: 2, byDay: [1, 3], until: "2026-12-30" }, tz: "Europe/London" }),
    ev("Overnight", "2026-11-06", "22:00", "01:00", { endDate: "2026-11-07" }),
    ev("Rent", "2026-11-01", "", "", { allDay: true, repeat: { freq: "monthly", interval: 1, count: 6 } }),
    ev("Birthday é☕", "2026-12-01", "", "", { allDay: true, repeat: { freq: "yearly", interval: 1 } })
  ]);
  events[4] = Object.assign({}, events[4], { exceptions: ["2026-11-18"] });
  const txt = I.toICS(events, { now: NOW });
  const { parsed, planned, res } = importAll(txt, []);
  assert.equal(parsed.total, 8); assert.deepEqual(parsed.skipped, []); assert.deepEqual(planned.skipped, []);
  assert.equal(res.added, 8);
  const by = Object.fromEntries(res.events.map((e) => [e.title, e]));
  events.forEach((o) => assert.deepEqual(shape(by[o.title]), shape(o), o.title));
  assert.deepEqual(by.Standup.exceptions, ["2026-11-18"]);
  assert.ok(res.events.every((e) => e.source === "ics" && e.externalId.endsWith("@jarvis")), "they remember where they came from");
  // the same file again, into the calendar that already has these events: nothing new
  const again = importAll(txt, events);
  assert.equal(again.planned.add.length, 0); assert.equal(again.planned.duplicates.length, 8, "its own events are never brought back");
  // and into a calendar that already imported it
  const twice = importAll(txt, res.events);
  assert.equal(twice.planned.add.length, 0); assert.equal(twice.planned.duplicates.length, 8);
});

const GOOGLEISH = [
  "BEGIN:VCALENDAR", "PRODID:-//Google Inc//Google Calendar 70.9054//EN", "VERSION:2.0", "CALSCALE:GREGORIAN", "X-WR-TIMEZONE:America/New_York",
  "BEGIN:VTIMEZONE", "TZID:America/New_York", "BEGIN:STANDARD", "DTSTART:19701101T020000", "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "END:STANDARD", "END:VTIMEZONE",
  "BEGIN:VEVENT", "DTSTART;TZID=America/New_York:20261109T100000", "DTEND;TZID=America/New_York:20261109T110000", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T045959Z",
  "EXDATE;TZID=America/New_York:20261111T100000", "UID:abc123@google.com", "SUMMARY:Team sync", "LOCATION:Room 4\\, Floor 2", "DESCRIPTION:Weekly sync.\\nBring the \\\\ budget\; notes",
  "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT10M", "DESCRIPTION:This is an event reminder", "END:VALARM", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART:20261110T180000Z", "DTEND:20261110T190000Z", "UID:utc1@x", "SUMMARY:Evening call", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261120", "DTEND;VALUE=DATE:20261123", "UID:allday1@x", "SUMMARY:Trip", "BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY", "END:VALARM", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART:20261112T130000", "DURATION:PT90M", "UID:dur@x", "SUMMARY:Floating with duration", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART;TZID=Eastern Standard Time:20261113T090000", "UID:tz@x", "SUMMARY:Outlook zone", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART;TZID=America/New_York:20261114T090000", "DTEND;TZID=America/New_York:20261114T100000", "UID:cx@x", "SUMMARY:Called off", "STATUS:CANCELLED", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART;TZID=America/New_York:20261116T090000", "RECURRENCE-ID;TZID=America/New_York:20261116T080000", "UID:abc123@google.com", "SUMMARY:Moved showing", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART;TZID=America/New_York:20261102T090000", "DTEND;TZID=America/New_York:20261102T093000", "RRULE:FREQ=MONTHLY;BYDAY=1MO", "UID:m1@x", "SUMMARY:First Monday", "END:VEVENT",
  "BEGIN:VTODO", "UID:todo@x", "SUMMARY:A to-do", "END:VTODO",
  "END:VCALENDAR"
].join("\r\n");

test("reading a file from another calendar: what comes in, what is changed, and what is said about it", () => {
  const { parsed, planned, res } = importAll(GOOGLEISH, []);
  assert.equal(parsed.total, 8);
  assert.equal(parsed.other, 1, "the to-do is counted as something not imported");
  assert.deepEqual(parsed.skipped.map((s) => [s.title, s.reason]), [["Called off", "it was cancelled"], ["Moved showing", "it is one changed showing of a repeating event, which I can’t import yet"]]);
  const by = Object.fromEntries(res.events.map((e) => [e.title, e]));
  const sync = by["Team sync"];
  assert.deepEqual([sync.date, sync.time, sync.endTime, sync.tz], ["2026-11-09", "10:00", "11:00", ZONE]);
  assert.deepEqual(sync.repeat, { freq: "weekly", interval: 1, byDay: [1, 3], until: "2026-12-30" }, "the UNTIL in UTC is read as the last day in the event's zone (4:59 AM UTC on 31 Dec is still 30 Dec evening)");
  assert.deepEqual(sync.exceptions, ["2026-11-11"]);
  assert.deepEqual(sync.reminders, [10]);
  assert.equal(sync.description, "Location: Room 4, Floor 2\nWeekly sync.\nBring the \\ budget; notes", "place, escapes and line breaks");
  assert.equal(sync.externalId, "abc123@google.com");
  const utc = by["Evening call"];
  assert.deepEqual([utc.date, utc.time, utc.endTime, utc.tz], ["2026-11-10", "13:00", "14:00", ZONE], "UTC times are shown in your zone (18:00Z is 1 PM EST)");
  const trip = by.Trip;
  assert.deepEqual([trip.allDay, trip.date, trip.endDate, trip.reminders], [true, "2026-11-20", "2026-11-22", [1980]], "a 3-night trip ends the day before the file's end date; a trigger of 1 day before midnight is 33 hours before 9 AM");
  const dur = by["Floating with duration"];
  assert.deepEqual([dur.time, dur.endTime], ["13:00", "14:30"], "DURATION gives the end");
  const out = by["Outlook zone"];
  assert.equal(out.tz, ZONE); assert.ok(parsed.events.find((e) => e.input.title === "Outlook zone").notes.some((n) => /Eastern Standard Time.*isn’t one I know/.test(n)), "an unknown time zone name is said, and your zone is used");
  assert.ok(parsed.events.find((e) => e.input.title === "Outlook zone").notes.some((n) => /no end time/.test(n)), "and a missing end time is said");
  const first = by["First Monday"];
  assert.equal(first.repeat, null, "a repeat it can't show is imported once");
  assert.ok(parsed.events.find((e) => e.input.title === "First Monday").notes.some((n) => /Only its first showing was imported/.test(n)));
  assert.equal(res.added, 6);
  assert.equal(planned.add.length, 6);
});

test("an all-day event's reminders survive a round trip through a file", () => {
  const events = build([ev("Holiday", "2026-11-26", "", "", { allDay: true, reminders: [1440, 0] })]);
  const { res } = importAll(I.toICS(events, { now: NOW, allDayAt: "09:00" }), [], { allDayAt: "09:00" });
  assert.deepEqual(res.events[0].reminders, [1440, 0]);
  const other = importAll(I.toICS(events, { now: NOW, allDayAt: "18:30" }), [], { allDayAt: "18:30" });
  assert.deepEqual(other.res.events[0].reminders, [1440, 0], "with another all-day time too");
});

test("things that can't be imported are said, not silently dropped", () => {
  assert.equal(I.parse("hello", { zone: ZONE }).problem, "This doesn’t look like a calendar file (.ics).");
  assert.equal(I.parse("", { zone: ZONE }).problem.length > 0, true);
  const long = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261101\r\nDTEND;VALUE=DATE:20270101\r\nUID:long@x\r\nSUMMARY:Two months\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  const r = importAll(long, []);
  assert.equal(r.res.added, 0);
  assert.match(r.planned.skipped[0].reason, /31 days or fewer/, "an event longer than the calendar allows is skipped with the calendar's own reason");
  const noStart = I.parse("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:No start\r\nEND:VEVENT\r\nEND:VCALENDAR", { zone: ZONE });
  assert.deepEqual(noStart.skipped, [{ title: "No start", reason: "it has no start" }]);
  const bad = I.parse("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261301T100000\r\nSUMMARY:Month 13\r\nEND:VEVENT\r\nEND:VCALENDAR", { zone: ZONE });
  assert.match(bad.skipped[0].reason, /isn.t a date I can read/);
  // too many reminders and out-of-range ones
  const many = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART;TZID=America/New_York:20261104T100000", "DTEND;TZID=America/New_York:20261104T110000", "UID:al@x", "SUMMARY:Alarms"]
    .concat([5, 10, 15, 20, 30, 45, 60].flatMap((m) => ["BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT" + m + "M", "END:VALARM"]))
    .concat(["BEGIN:VALARM", "TRIGGER:PT15M", "END:VALARM", "BEGIN:VALARM", "TRIGGER;VALUE=DATE-TIME:20261104T090000Z", "END:VALARM", "BEGIN:VALARM", "TRIGGER;RELATED=END:-PT5M", "END:VALARM", "END:VEVENT", "END:VCALENDAR"]).join("\r\n");
  const p = I.parse(many, { zone: ZONE });
  assert.deepEqual(p.events[0].input.reminders, [60, 45, 30, 20, 15], "five at most, the longest first");
  assert.match(p.events[0].notes.join(" "), /5 reminders couldn.t be imported/, "the two extra, the one after the start, the absolute one and the 'before the end' one are reported: " + p.events[0].notes.join(" | "));
});

test("reminders that can't be kept are reported one by one, not hidden by the limit of five", () => {
  const f = (alarms) => ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART;TZID=America/New_York:20261104T100000", "DTEND;TZID=America/New_York:20261104T110000", "UID:a@x", "SUMMARY:A"].concat(alarms).concat(["END:VEVENT", "END:VCALENDAR"]).join("\r\n");
  const al = (trigger) => ["BEGIN:VALARM", "ACTION:DISPLAY", trigger, "END:VALARM"];
  const one = (trigger) => I.parse(f(al(trigger)), { zone: ZONE }).events[0];
  assert.deepEqual(one("TRIGGER:-PT15M").input.reminders, [15]);
  assert.deepEqual(one("TRIGGER:PT15M").input.reminders, [], "after the start");
  assert.deepEqual(one("TRIGGER:-P8D").input.reminders, [], "more than a week before");
  assert.deepEqual(one("TRIGGER;VALUE=DATE-TIME:20261104T090000Z").input.reminders, [], "a fixed moment");
  assert.deepEqual(one("TRIGGER;RELATED=END:-PT5M").input.reminders, [], "before the END");
  assert.deepEqual(one("TRIGGER:soon").input.reminders, [], "unreadable");
  assert.match(one("TRIGGER:PT15M").notes.join(" "), /1 reminder couldn.t be imported/);
  assert.deepEqual(I.parse(f(al("TRIGGER:-PT10M").concat(al("TRIGGER:-PT10M"), al("TRIGGER:-PT30M"))), { zone: ZONE }).events[0].input.reminders, [30, 10], "the same reminder twice is one");
});

test("a repeat of a kind it can't show (hourly, or no frequency) is imported once, with the reason", () => {
  const f = (rule) => ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART;TZID=America/New_York:20261104T100000", "DTEND;TZID=America/New_York:20261104T110000", "UID:r@x", "SUMMARY:R", "RRULE:" + rule, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const hourly = I.parse(f("FREQ=HOURLY;INTERVAL=2"), { zone: ZONE }).events[0];
  assert.equal(hourly.input.repeat, undefined);
  assert.match(hourly.notes.join(" "), /Only its first showing was imported: it repeats hourly, which I can.t show/);
  assert.match(I.parse(f("INTERVAL=2"), { zone: ZONE }).events[0].notes.join(" "), /repeat rule I can.t show/);
  assert.equal(I.parse(f("FREQ=DAILY;INTERVAL=3;COUNT=5"), { zone: ZONE }).events[0].input.repeat.count, 5, "and a plain one is kept");
});

test("importing: nothing twice, a cap per file, and nothing changes until it is applied", () => {
  const existing = build([ev("Team sync", "2026-11-09", "10:00", "11:00")]);
  existing[0] = Object.assign({}, existing[0], { source: "ics", externalId: "abc123@google.com" });
  const parsed = I.parse(GOOGLEISH, { zone: ZONE });
  const planned = I.plan(existing, parsed, {});
  assert.ok(planned.duplicates.includes("Team sync"), "the same UID is already here");
  assert.equal(planned.add.length, 5);
  assert.equal(existing.length, 1, "planning changed nothing");
  // two copies of one UID in the same file: one is added
  const dup = "BEGIN:VCALENDAR\r\n" + ["A", "B"].map((t) => "BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261101\r\nUID:same@x\r\nSUMMARY:" + t + "\r\nEND:VEVENT\r\n").join("") + "END:VCALENDAR\r\n";
  const d = importAll(dup, []);
  assert.equal(d.res.added, 1);
  // a cap
  const big = "BEGIN:VCALENDAR\r\n" + Array.from({ length: 520 }, (_, i) => "BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261101\r\nUID:u" + i + "@x\r\nSUMMARY:E" + i + "\r\nEND:VEVENT\r\n").join("") + "END:VCALENDAR\r\n";
  const b = importAll(big, []);
  assert.equal(b.res.added, 500); assert.equal(b.planned.capped, 20);
  // soft-deleted events don't count as already here
  const removed = C.remove(existing, existing[0].id, ctx()).events;
  assert.ok(!I.plan(removed, parsed, {}).duplicates.includes("Team sync"));
});

test("the calendar keeps imported events across a reload, and refuses what is invalid", () => {
  const r = C.addImported([], { title: "Imported", date: "2026-11-04", time: "10:00", endTime: "11:00", tz: ZONE }, { source: "ics", externalId: "x@y", exceptions: ["2026-11-10", "nope", "2026-11-10"] }, ctx());
  assert.ok(r.ok);
  assert.deepEqual([r.event.source, r.event.externalId, r.event.exceptions], ["ics", "x@y", ["2026-11-10"]]);
  const back = C.sanitizeList(JSON.parse(JSON.stringify(r.events)));
  assert.deepEqual([back[0].source, back[0].externalId], ["ics", "x@y"], "still an imported event after being saved and read again");
  assert.equal(C.addImported([], { title: "", date: "2026-11-04" }, {}, ctx()).ok, false);
  assert.equal(C.addImported([], { title: "Odd source", date: "2026-11-04", time: "10:00" }, { source: "pigeon" }, ctx()).event.source, "local");
  assert.equal(C.sanitizeList([Object.assign({}, r.events[0], { source: "pigeon" })])[0].source, "local");
});

test("nothing here changes what it is given", () => {
  const events = frozen(build([ev("Client call", "2026-11-04", "13:00", "14:30", { reminders: [30], repeat: { freq: "daily", interval: 1 } })]));
  const txt = I.toICS(events, { now: NOW });
  const parsed = frozen(I.parse(txt, { zone: ZONE }));
  const planned = I.plan(events, parsed, {});
  I.apply(events, planned, ctx());
});
