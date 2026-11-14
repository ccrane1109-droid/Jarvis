"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../../js/learning-logic");
const R = require("../../js/learning-reading-logic");

const book = (o) => Object.assign({ id: "b1", title: "Book", status: "reading", totalPages: 400, currentPage: 0, startDate: "", endDate: "", log: [] }, o);
const TODAY = "2026-11-11";   // a Wednesday; its week is Mon 2026-11-09 to Sun 2026-11-15

test("reading sessions: only valid ones are read, and the record keeps its shape", () => {
  const ok = R.read({ id: "rt1", bookId: "b1", day: "2026-11-10", minutes: 25, note: "  commute ", createdAt: 5, updatedAt: 6 });
  assert.deepEqual(ok, { id: "rt1", bookId: "b1", day: "2026-11-10", minutes: 25, note: "commute", createdAt: 5, updatedAt: 6 });
  for (const m of [0, 721, 1.5, "abc", -3, null]) assert.equal(R.read({ id: "x", day: "2026-11-10", minutes: m }), null, "minutes " + m);
  assert.equal(R.read({ id: "x", day: "10/11/2026", minutes: 5 }), null);
  assert.equal(R.read({ minutes: 5, day: "2026-11-10" }), null);
  assert.equal(R.read("junk"), null);
  assert.equal(R.read({ id: "x", day: "2026-11-10", minutes: "30" }).minutes, 30, "a number saved as text is read");
  assert.equal(R.read({ id: "x", day: "2026-11-10", minutes: 5 }).bookId, "", "a session without a book is fine");
  assert.equal(L.PREFIX.sessions, "rt");
});

test("checking a session being saved", () => {
  const ctx = { today: TODAY, books: [{ id: "b1" }] };
  assert.equal(R.check({ minutes: 20, day: "2026-11-11", bookId: "b1" }, ctx).ok, true);
  assert.equal(R.check({ minutes: 20, day: "2026-11-11" }, ctx).value.bookId, "");
  assert.match(R.check({ minutes: 0, day: TODAY }, ctx).errors.minutes, /whole minutes/);
  assert.match(R.check({ minutes: 20.5, day: TODAY }, ctx).errors.minutes, /whole minutes/);
  assert.match(R.check({ minutes: 721, day: TODAY }, ctx).errors.minutes, /720/);
  assert.match(R.check({ minutes: 20, day: "2026-11-12" }, ctx).errors.day, /hasn't happened/);
  assert.match(R.check({ minutes: 20, day: "" }, ctx).errors.day, /Choose the day/);
  assert.match(R.check({ minutes: 20, day: TODAY, bookId: "gone" }, ctx).errors.bookId, /no longer exists/);
  assert.equal(R.check({ minutes: " 20 ", day: TODAY }, ctx).value.minutes, 20);
});

test("the timer counts only while running, and survives a clock set backwards", () => {
  let t = R.timerStart("b1", 1000);
  assert.equal(R.timerRunning(t), true);
  assert.equal(R.timerElapsed(t, 61000), 60000);
  t = R.timerPause(t, 61000);
  assert.equal(R.timerRunning(t), false);
  assert.equal(R.timerElapsed(t, 9999999), 60000, "paused time is not counted");
  t = R.timerResume(t, 100000);
  assert.equal(R.timerElapsed(t, 130000), 90000, "30 s after resuming adds to the 60 s before");
  assert.equal(R.timerElapsed(t, 50000), 60000, "a clock set back never subtracts");
  assert.equal(R.timerPause(R.timerPause(t, 130000), 999999).accumulated, 90000, "pausing twice changes nothing");
  assert.equal(R.timerResume(R.timerStart("b1", 5), 99).runSince, 5, "resuming a running timer changes nothing");
  assert.equal(R.timerElapsed(R.timerStart("", 1), 1 + 30 * 86400000), 7 * 86400000, "capped at a week so a forgotten timer is not absurd");
});

test("a saved timer is read safely", () => {
  assert.equal(R.timerRead(null), null);
  assert.equal(R.timerRead({ startedAt: "x" }), null);
  assert.equal(R.timerRead({ startedAt: -5 }), null);
  assert.deepEqual(R.timerRead({ bookId: "b1", startedAt: 10, accumulated: -4, runSince: "no" }), { bookId: "b1", startedAt: 10, accumulated: 0, runSince: 0 });
});

test("minutes to offer, and the clock text", () => {
  assert.equal(R.minutesFrom(29999), 0, "under half a minute is nothing");
  assert.equal(R.minutesFrom(30000), 1);
  assert.equal(R.minutesFrom(89000), 1);
  assert.equal(R.minutesFrom(90000), 2);
  assert.equal(R.minutesFrom(100 * 3600000), 720, "never above the largest session");
  assert.equal(R.clock(0), "0:00");
  assert.equal(R.clock(65000), "1:05");
  assert.equal(R.clock(3725000), "1:02:05");
  assert.equal(R.clock(-5), "0:00");
  assert.equal(R.minutesText(45), "45 min");
  assert.equal(R.minutesText(65), "1 h 5 min");
  assert.equal(R.minutesText(120), "2 h");
});

test("pages are counted once, even when a page number is corrected", () => {
  // 100 -> 120 -> corrected to 110 -> 130: 30 pages in total, not 40
  const b = book({ log: [{ d: "2026-11-02", p: 100 }, { d: "2026-11-09", p: 120 }, { d: "2026-11-10", p: 110 }, { d: "2026-11-11", p: 130 }] });
  assert.deepEqual(R.pageDays([b]), { "2026-11-09": 20, "2026-11-11": 10 });
  const t = R.totals([b], [], "2026-11-01", "2026-11-30");
  assert.equal(t.pages, 30);
  assert.equal(t.activeDays, 2, "the correction day added nothing so it is not a reading day");
});

test("reading time adds minutes but never pages, and a day with both is one reading day", () => {
  const b = book({ log: [{ d: "2026-11-08", p: 10 }, { d: "2026-11-10", p: 40 }] });
  const s = [{ id: "a", bookId: "b1", day: "2026-11-10", minutes: 30 }, { id: "b", bookId: "b1", day: "2026-11-10", minutes: 15 }, { id: "c", bookId: "", day: "2026-11-05", minutes: 10 }];
  const t = R.totals([b], s, "2026-11-01", "2026-11-30");
  assert.deepEqual([t.pages, t.minutes, t.activeDays], [30, 55, 2]);
  assert.deepEqual(R.minuteDays(s), { "2026-11-10": 45, "2026-11-05": 10 });
  const gone = [Object.assign({}, s[0], { deletedAt: 5 })];
  assert.equal(R.totals([b], gone, "2026-11-01", "2026-11-30").minutes, 0, "a deleted session is not counted");
  assert.equal(R.totals([Object.assign({}, b, { deletedAt: 1 })], [], "2026-11-01", "2026-11-30").pages, 0, "nor a deleted book");
});

test("today, this week (Monday to Sunday), this month and this year", () => {
  const b = book({ log: [{ d: "2026-10-31", p: 0 }, { d: "2026-11-01", p: 20 }, { d: "2026-11-08", p: 50 }, { d: "2026-11-09", p: 60 }, { d: "2026-11-11", p: 90 }] });
  const o = R.overview([b], [{ id: "a", bookId: "b1", day: "2026-11-11", minutes: 25 }, { id: "b", bookId: "b1", day: "2026-11-08", minutes: 40 }], TODAY);
  assert.deepEqual([o.today.pages, o.today.minutes], [30, 25]);
  assert.deepEqual([o.week.from, o.week.to], ["2026-11-09", "2026-11-15"]);
  assert.deepEqual([o.week.pages, o.week.minutes], [40, 25], "Sunday 8 Nov belongs to last week");
  assert.deepEqual([o.month.pages, o.month.minutes], [90, 65]);
  assert.equal(o.year.pages, 90);
});

test("books finished this year use the date each was finished", () => {
  const books = [
    book({ id: "a", status: "completed", endDate: "2026-02-03" }), book({ id: "b", status: "completed", endDate: "2025-12-31" }),
    book({ id: "c", status: "completed", endDate: "" }), book({ id: "d", status: "reading" }), book({ id: "e", status: "completed", endDate: "2026-11-01", deletedAt: 1 })
  ];
  assert.deepEqual(R.booksFinished(books, "2026"), { count: 1, undated: 1 });
  assert.deepEqual(R.booksFinished(books, 2025), { count: 1, undated: 1 });
});

test("average pages per session: a session is one book on one day with pages gained", () => {
  const a = book({ id: "a", log: [{ d: "2026-11-01", p: 0 }, { d: "2026-11-10", p: 30 }, { d: "2026-11-11", p: 40 }] });
  const b = book({ id: "b", log: [{ d: "2026-11-01", p: 0 }, { d: "2026-11-11", p: 20 }] });
  const o = R.overview([a, b], [], TODAY);
  assert.deepEqual(o.avgPages.last30, { sessions: 3, avg: 20 }, "(30 + 10 + 20) / 3");
  assert.equal(R.pageSessions([a, b]).length, 3);
  assert.equal(R.overview([], [], TODAY).avgPages.last30, null, "no data: no average, not zero");
  assert.equal(R.overview([], [], TODAY).avgMinutes.all, null);
  const old = book({ log: [{ d: "2026-01-01", p: 0 }, { d: "2026-01-02", p: 50 }] });
  const o2 = R.overview([old], [{ id: "x", bookId: "", day: "2026-01-02", minutes: 30 }], TODAY);
  assert.equal(o2.avgPages.last30, null, "nothing in the last 30 days");
  assert.deepEqual(o2.avgPages.all, { sessions: 1, avg: 50 }, "but it is in the all-time figure");
  assert.deepEqual(o2.avgMinutes.all, { sessions: 1, avg: 30 });
});

test("streaks: the current one survives until the day is over", () => {
  const log = (days) => ({ log: [{ d: "2026-10-01", p: 0 }].concat(days.map((d, i) => ({ d: d, p: (i + 1) * 10 }))) });
  const s = R.streaks([book(log(["2026-11-08", "2026-11-09", "2026-11-10"]))], [], TODAY);
  assert.deepEqual([s.current, s.longest, s.lastRead], [3, 3, "2026-11-10"], "read up to yesterday: still alive");
  const s2 = R.streaks([book(log(["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11"]))], [], TODAY);
  assert.equal(s2.current, 4, "including today");
  const s3 = R.streaks([book(log(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-09"]))], [], TODAY);
  assert.deepEqual([s3.current, s3.longest], [0, 4], "a gap breaks it; the best run is kept");
  const s4 = R.streaks([], [{ id: "a", bookId: "", day: TODAY, minutes: 5 }, { id: "b", bookId: "", day: "2026-11-10", minutes: 5 }], TODAY);
  assert.equal(s4.current, 2, "reading time counts too");
  assert.deepEqual(R.streaks([], [], TODAY), { current: 0, longest: 0, lastRead: "", totalDays: 0 });
});

test("the history series", () => {
  const b = book({ log: [{ d: "2026-10-01", p: 0 }, { d: "2026-11-03", p: 30 }, { d: "2026-11-11", p: 50 }] });
  const days = R.series([b], [], "days", TODAY);
  assert.equal(days.length, 14);
  assert.deepEqual([days[13].from, days[13].pages, days[0].from], ["2026-11-11", 20, "2026-10-29"]);
  assert.equal(days[13].label, "11");
  assert.equal(days[13].title, "Nov 11: 20 pages, 0 minutes");
  const weeks = R.series([b], [{ id: "a", bookId: "", day: "2026-11-04", minutes: 1 }], "weeks", TODAY);
  assert.equal(weeks.length, 12);
  assert.deepEqual([weeks[11].from, weeks[11].to, weeks[11].pages], ["2026-11-09", "2026-11-15", 20]);
  assert.deepEqual([weeks[10].from, weeks[10].pages, weeks[10].minutes], ["2026-11-02", 30, 1]);
  assert.equal(weeks[10].title, "Week of Nov 2: 30 pages, 1 minute");
  const months = R.series([b], [], "months", TODAY);
  assert.equal(months.length, 12);
  assert.deepEqual([months[11].from, months[11].to, months[11].pages, months[11].label], ["2026-11-01", "2026-11-30", 50, "Nov"]);
  assert.equal(months[0].from, "2025-12-01");
  assert.equal(R.series([b], [], "months", "2026-01-15")[0].from, "2025-02-01", "months cross the year boundary");
  assert.equal(R.series([], [], "days", TODAY).every((x) => x.pages === 0 && x.minutes === 0), true);
});

test("the consistency calendar", () => {
  const b = book({ log: [{ d: "2026-10-01", p: 0 }, { d: "2026-11-03", p: 30 }, { d: "2026-11-11", p: 50 }] });
  const c = R.calendar([b], [{ id: "a", bookId: "", day: "2026-11-03", minutes: 20 }, { id: "b", bookId: "", day: "2026-11-30", minutes: 5 }], "2026-11", TODAY);
  assert.equal(c.title, "November 2026");
  assert.equal(c.weeks.length, 6, "1 Nov 2026 is a Sunday: six Monday-first rows");
  assert.deepEqual(c.weeks[0].map((x) => x && x.day), [null, null, null, null, null, null, 1]);
  assert.deepEqual(c.weeks[5].map((x) => x && x.day), [30, null, null, null, null, null, null]);
  const flat = [].concat.apply([], c.weeks).filter(Boolean);
  assert.equal(flat.length, 30);
  assert.deepEqual(flat.filter((x) => x.read).map((x) => x.day), [3, 11, 30]);
  assert.equal(c.activeDays, 3);
  assert.deepEqual(flat.find((x) => x.day === 3), { d: "2026-11-03", day: 3, pages: 30, minutes: 20, read: true, today: false, future: false });
  assert.equal(flat.find((x) => x.day === 11).today, true);
  assert.equal(flat.find((x) => x.day === 12).future, true);
  assert.deepEqual([c.prev, c.next, c.canNext], ["2026-10", "2026-12", false]);
  const oct = R.calendar([b], [], "2026-10", TODAY);
  assert.deepEqual([oct.prev, oct.next, oct.canNext], ["2026-09", "2026-11", true]);
  assert.equal(R.calendar([], [], "2026-01", TODAY).prev, "2025-12", "back across a year");
  assert.equal(R.calendar([], [], "2026-12", "2026-12-05").next, "2027-01");
  assert.equal(R.calendar([], [], "2024-02", TODAY).weeks.length > 0 && [].concat.apply([], R.calendar([], [], "2024-02", TODAY).weeks).filter(Boolean).length, 29, "a leap February");
});

test("recent sessions and a book's total time", () => {
  const s = [
    { id: "a", bookId: "b1", day: "2026-11-09", minutes: 10, createdAt: 1 }, { id: "b", bookId: "b1", day: "2026-11-10", minutes: 20, createdAt: 2 },
    { id: "c", bookId: "b2", day: "2026-11-10", minutes: 5, createdAt: 3 }, { id: "d", bookId: "b1", day: "2026-11-01", minutes: 99, createdAt: 4, deletedAt: 9 }
  ];
  assert.deepEqual(R.recentSessions(s, 10).map((x) => x.id), ["c", "b", "a"], "newest day first, then newest saved; deleted left out");
  assert.equal(R.recentSessions(s, 2).length, 2);
  assert.equal(R.bookMinutes(s, "b1"), 30);
  assert.equal(R.bookMinutes(s, "zzz"), 0);
});
