"use strict";

// The Wake check uses the phone's own clock, so these run in New York time, where the clocks go
// back on Nov 1 2026 and forward on Mar 8 2026.
process.env.TZ = "America/New_York";

const test = require("node:test");
const assert = require("node:assert/strict");
const W = require("../../js/wakecheck-logic");

const at = (m, d, h, mi, s) => new Date(2026, m - 1, d, h || 0, mi || 0, s || 0).getTime();
const isoAt = (m, d, h, mi) => new Date(at(m, d, h, mi)).toISOString();
// An enabled store tracked since Oct 25, 2026 (a Sunday), with default settings (7:00, delay 5, window 10) unless overridden.
const mk = (settings, days) => W.sanitizeStore({ settings: Object.assign({ enabled: true, trackedFrom: isoAt(10, 25, 12, 0) }, settings), days: days || {} });
const done = (m, d) => ({ wake: "07:00", delay: 5, window: 10, first: isoAt(m, d, 7, 1), due: isoAt(m, d, 7, 6), second: isoAt(m, d, 7, 7) });
const missedDay = (m, d) => ({ wake: "07:00", delay: 5, window: 10, first: null, due: null, second: null });

test("the tests run on New York time, so the daylight saving cases below mean something", () => {
  assert.equal(new Date(2026, 9, 31, 7, 0).getTimezoneOffset(), 240);
  assert.equal(new Date(2026, 10, 1, 7, 0).getTimezoneOffset(), 300);
});

/* ---------------- phrases ---------------- */

test("a curly apostrophe and a straight one are the same, so the iPhone keyboard can't lock you out", () => {
  assert.equal(W.phraseMatches("I’m awake", "I'm awake"), true);
  assert.equal(W.phraseMatches("I'm awake", "I’m awake"), true);
  assert.equal(W.phraseMatches("I‘m awake", "I'm awake"), true);
});

test("capitals and extra spaces are forgiven, nothing else is", () => {
  assert.equal(W.phraseMatches("  i'M   AWAKE ", "I'm awake"), true);
  assert.equal(W.phraseMatches("i'm awake", "I'm awake", true), false, "strict capitals when asked");
  assert.equal(W.phraseMatches("I'm awake", "I'm awake", true), true);
  for (const wrong of ["I'm awak", "I am awake", "I'm awake.", "Im awake", "", "   "]) assert.equal(W.phraseMatches(wrong, "I'm awake"), false, JSON.stringify(wrong));
});

test("an empty expected phrase never matches, even an empty answer", () => {
  assert.equal(W.phraseMatches("", ""), false);
  assert.equal(W.phraseMatches("   ", "   "), false);
});

/* ---------------- settings ---------------- */

const form = (o) => Object.assign({ enabled: true, time: "06:30", days: [1, 2, 3, 4, 5], phrase1: "I'm awake", phrase2: "I'm still awake", delay: 5, window: 10, caseSensitive: false }, o || {});

test("a good form passes and a bad one says which field and why", () => {
  assert.equal(W.validateSettings(form()).ok, true);
  const bad = (o) => W.validateSettings(form(o));
  assert.equal(bad({ time: "" }).field, "time");
  assert.equal(bad({ time: "25:00" }).field, "time");
  assert.equal(bad({ days: [] }).field, "days");
  assert.equal(bad({ phrase1: "  " }).field, "phrase1");
  assert.equal(bad({ phrase1: "x".repeat(61) }).field, "phrase1");
  assert.equal(bad({ phrase2: "" }).field, "phrase2");
  assert.equal(bad({ phrase2: "x".repeat(61) }).field, "phrase2");
  assert.equal(bad({ delay: 0 }).field, "delay");
  assert.equal(bad({ delay: 61 }).field, "delay");
  assert.equal(bad({ delay: 2.5 }).field, "delay");
  assert.equal(bad({ window: 2 }).field, "window");
  assert.equal(bad({ window: 31 }).field, "window");
  assert.equal(bad({ delay: 1, window: 3 }).ok, true, "the smallest allowed values");
  assert.equal(bad({ delay: 60, window: 30 }).ok, true, "the largest allowed values");
  assert.match(bad({ delay: 0 }).error, /between 1 and 60/);
});

test("loading settings repairs anything odd instead of failing", () => {
  const s = W.sanitizeSettings({ enabled: "yes", time: "7am", days: [3, "1", 3, 9, -1, 1.5], phrase1: "  ", phrase2: "y".repeat(100), delay: 500, window: 0, trackedFrom: "nope", updatedAt: 5 });
  assert.equal(s.enabled, false);
  assert.equal(s.time, "07:00");
  assert.deepEqual(s.days, [1, 3]);
  assert.equal(s.phrase1, "I'm awake");
  assert.equal(s.phrase2.length, W.PHRASE_MAX);
  assert.equal(s.delay, 60);
  assert.equal(s.window, 3);
  assert.equal(s.trackedFrom, null);
  assert.equal(s.updatedAt, null);
  assert.deepEqual(W.sanitizeSettings(null).days, [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(W.sanitizeSettings({ days: [] }).days, [0, 1, 2, 3, 4, 5, 6], "no days at all falls back to every day");
});

/* ---------------- dates and text ---------------- */

test("dates: keys, weekdays, adding days across a clock change, and moments on the phone's clock", () => {
  assert.equal(W.dateKey(at(10, 30, 23, 59)), "2026-10-30");
  assert.equal(W.weekdayOf("2026-10-30"), 5, "a Friday");
  assert.equal(W.weekdayOf("2026-11-02"), 1, "a Monday");
  assert.equal(W.dayName("2026-11-01"), "Sunday");
  assert.equal(W.addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(W.addDays("2026-11-01", 1), "2026-11-02");
  assert.equal(W.addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(W.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(W.momentOf("2026-11-02", "07:05"), at(11, 2, 7, 5));
  assert.equal(W.momentOf("2026-11-01", "07:00") - W.momentOf("2026-10-31", "07:00"), 25 * 3600000, "the day the clocks go back is 25 hours long");
});

test("times and countdowns read the way a person says them", () => {
  assert.equal(W.formatHHMM("07:05"), "7:05 AM");
  assert.equal(W.formatHHMM("00:00"), "12:00 AM");
  assert.equal(W.formatHHMM("12:30"), "12:30 PM");
  assert.equal(W.formatHHMM("23:59"), "11:59 PM");
  assert.equal(W.formatMs(at(11, 2, 7, 6)), "7:06 AM");
  assert.equal(W.countdownText(572000), "9:32");
  assert.equal(W.countdownText(3700000), "1:01:40");
  assert.equal(W.countdownText(0), "0:00");
  assert.equal(W.countdownText(-5000), "0:00");
  assert.equal(W.countdownText(500), "0:01", "rounds up, so it never shows 0:00 with time left");
});

/* ---------------- one morning, minute by minute ---------------- */

// Monday Nov 2, 2026. Wake 7:00, answer within 10 minutes, delay 5.
test("before the wake time nothing can be typed", () => {
  const v = W.view(mk(), at(11, 2, 6, 59, 59));
  assert.equal(v.mode, "upcoming");
  assert.equal(v.wake, at(11, 2, 7, 0));
  assert.equal(v.next.wake, at(11, 2, 7, 0));
});

test("the first window is open from 7:00:00 to 7:09:59, then the morning is missed", () => {
  const s = mk();
  assert.deepEqual([W.view(s, at(11, 2, 7, 0)).mode, W.view(s, at(11, 2, 7, 0)).state], ["active", "first"]);
  assert.equal(W.view(s, at(11, 2, 7, 9, 59)).state, "first");
  const late = W.view(s, at(11, 2, 7, 10));
  assert.equal(late.mode, "missed");
  assert.equal(late.reason, "first");
  assert.equal(late.next.dateKey, "2026-11-03");
});

test("typing the first phrase starts the delay, then the check-in window opens and closes", () => {
  const first = W.answer(mk(), "first", "I'm awake", at(11, 2, 7, 1));
  assert.equal(first.ok, true);
  assert.equal(first.state, "waiting");
  const s = first.store;
  assert.deepEqual(s.days["2026-11-02"], { wake: "07:00", delay: 5, window: 10, first: isoAt(11, 2, 7, 1), due: isoAt(11, 2, 7, 6), second: null });
  assert.equal(W.view(s, at(11, 2, 7, 5, 59)).state, "waiting");
  assert.equal(W.view(s, at(11, 2, 7, 6)).state, "second");
  assert.equal(W.view(s, at(11, 2, 7, 15, 59)).state, "second");
  const out = W.view(s, at(11, 2, 7, 16));
  assert.equal(out.mode, "missed");
  assert.equal(out.reason, "second");
});

test("both phrases in time make the morning complete", () => {
  const s1 = W.answer(mk(), "first", "I’m awake", at(11, 2, 7, 1)).store;
  const second = W.answer(s1, "second", "i'm still awake", at(11, 2, 7, 7));
  assert.equal(second.ok, true);
  assert.equal(second.state, "complete");
  const v = W.view(second.store, at(11, 2, 9, 0));
  assert.equal(v.mode, "complete");
  assert.equal(v.next.dateKey, "2026-11-03");
});

test("every refusal says why, and changes nothing", () => {
  const s = mk();
  const f = (store, which, text, t) => W.answer(store, which, text, t);
  assert.deepEqual([f(s, "first", "I'm awake", at(11, 2, 6, 59)).code, f(s, "first", "I'm awake", at(11, 2, 6, 59)).error], ["early", "Not yet. This opens at 7:00 AM."]);
  assert.equal(f(s, "first", "wrong", at(11, 2, 7, 1)).code, "mismatch");
  assert.equal(f(s, "first", "I'm awake", at(11, 2, 7, 10)).code, "late");
  assert.match(f(s, "first", "I'm awake", at(11, 2, 7, 10)).error, /7:10 AM/);
  assert.equal(f(s, "second", "I'm still awake", at(11, 2, 7, 1)).code, "needFirst");
  const waiting = f(s, "first", "I'm awake", at(11, 2, 7, 1)).store;
  assert.equal(f(waiting, "first", "I'm awake", at(11, 2, 7, 2)).code, "done");
  const early = f(waiting, "second", "I'm still awake", at(11, 2, 7, 3));
  assert.deepEqual([early.code, early.error], ["early", "Not yet. The check-in opens at 7:06 AM."]);
  assert.equal(f(waiting, "second", "nope", at(11, 2, 7, 7)).code, "mismatch");
  assert.equal(f(waiting, "second", "I'm still awake", at(11, 2, 7, 16)).code, "late");
  const complete = f(waiting, "second", "I'm still awake", at(11, 2, 7, 7)).store;
  assert.equal(f(complete, "second", "I'm still awake", at(11, 2, 7, 8)).code, "done");
  assert.equal(f(W.emptyStore(), "first", "I'm awake", at(11, 2, 7, 1)).code, "off");
  assert.equal(f(mk({ days: [3] }), "first", "I'm awake", at(11, 2, 7, 1)).code, "none", "nothing is scheduled on a Monday here");
  assert.deepEqual(Object.keys(s.days), [], "a refused phrase leaves the store alone");
});

test("the strict-capitals setting is honoured", () => {
  const s = mk({ caseSensitive: true });
  assert.equal(W.answer(s, "first", "i'm awake", at(11, 2, 7, 1)).code, "mismatch");
  assert.equal(W.answer(s, "first", "I'm awake", at(11, 2, 7, 1)).ok, true);
});

test("a delay of 1 minute and a window of 3 minutes work at the edges", () => {
  const s = mk({ delay: 1, window: 3 });
  assert.equal(W.view(s, at(11, 2, 7, 3)).mode, "missed");
  const s1 = W.answer(s, "first", "I'm awake", at(11, 2, 7, 2, 59)).store;
  assert.equal(W.view(s1, at(11, 2, 7, 3, 58)).state, "waiting");
  assert.equal(W.view(s1, at(11, 2, 7, 3, 59)).state, "second");
  assert.equal(W.view(s1, at(11, 2, 7, 6, 58)).state, "second");
  assert.equal(W.view(s1, at(11, 2, 7, 6, 59)).mode, "missed");
});

test("the morning keeps the schedule it started with, even if the settings change mid-morning", () => {
  const s1 = W.answer(mk(), "first", "I'm awake", at(11, 2, 7, 1)).store;
  const changed = W.applySettings(s1, Object.assign({}, s1.settings, { time: "08:00", window: 20, delay: 30 }), at(11, 2, 7, 3));
  assert.equal(changed.days["2026-11-02"].wake, "07:00");
  const v = W.view(changed, at(11, 2, 7, 6));
  assert.equal(v.mode, "active");
  assert.equal(v.state, "second", "still the 7:06 check-in, not 8:00 or 30 minutes later");
  assert.equal(v.next.wake, at(11, 3, 8, 0), "and tomorrow uses the new time");
});

test("a window that crosses midnight belongs to the day the alarm rang", () => {
  const s = mk({ time: "23:55" });
  const v = W.view(s, at(11, 3, 0, 2));
  assert.equal(v.mode, "active");
  assert.equal(v.dateKey, "2026-11-02");
  const s1 = W.answer(s, "first", "I'm awake", at(11, 3, 0, 2)).store;
  assert.ok(s1.days["2026-11-02"]);
  const v2 = W.view(s1, at(11, 3, 0, 10));
  assert.deepEqual([v2.mode, v2.state, v2.dateKey], ["active", "second", "2026-11-02"]);
  const s2 = W.answer(s1, "second", "I'm still awake", at(11, 3, 0, 10)).store;
  assert.equal(W.streaks(s2, at(11, 3, 0, 11)).current, 1);
});

test("clock changes: the day the clocks go back keeps 7:00, and a time skipped in spring still gives a window", () => {
  const fall = mk({ trackedFrom: isoAt(10, 31, 12, 0) });
  assert.equal(W.view(fall, at(11, 1, 6, 59)).mode, "upcoming");
  assert.equal(W.view(fall, at(11, 1, 7, 0)).state, "first");
  assert.equal(W.view(fall, at(11, 1, 7, 10)).mode, "missed");
  // 2:30 AM doesn't exist on Mar 8 2026. The phone's clock treats it as 3:30, and the window follows.
  const spring = mk({ time: "02:30", trackedFrom: isoAt(3, 7, 12, 0) });
  assert.equal(W.view(spring, at(3, 8, 3, 29)).mode, "upcoming");
  assert.equal(W.view(spring, at(3, 8, 3, 30)).state, "first");
});

/* ---------------- history, streaks, editing ---------------- */

test("a missed morning is written down with the schedule it had", () => {
  const s = mk({ trackedFrom: isoAt(10, 28, 6, 0) });
  const r = W.reconcile(s, at(11, 1, 8, 0));
  assert.deepEqual(Object.keys(r.days), ["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
  assert.deepEqual(r.days["2026-10-30"], missedDay());
  assert.equal(W.reconcile(r, at(11, 1, 8, 0)), r, "doing it twice changes nothing");
  const early = W.reconcile(s, at(11, 1, 6, 0));
  assert.equal(early.days["2026-11-01"], undefined, "today's morning isn't written down before its time has run out");
  assert.equal(W.reconcile(W.emptyStore(), at(11, 1, 8, 0)).days["2026-11-01"], undefined, "nothing happens while it's off");
});

test("streak: complete mornings in a row, a miss ends it, a morning still possible neither counts nor breaks it", () => {
  const days = { "2026-10-26": done(10, 26), "2026-10-27": done(10, 27), "2026-10-28": missedDay(), "2026-10-29": done(10, 29), "2026-10-30": done(10, 30), "2026-10-31": done(10, 31) };
  const s = mk({}, days);
  assert.deepEqual(W.streaks(s, at(11, 1, 6, 0)), { current: 3, best: 3, total: 5, mornings: 7 });
  assert.equal(W.streaks(s, at(11, 1, 7, 5)).current, 3, "today is still possible at 7:05");
  assert.deepEqual(W.streaks(s, at(11, 1, 8, 0)), { current: 0, best: 3, total: 5, mornings: 7 }, "by 8:00 today has been missed");
});

test("days the check isn't scheduled never count for or against the streak", () => {
  const s = mk({ days: [1, 2, 3, 4, 5] }, { "2026-10-30": done(10, 30), "2026-11-02": done(11, 2) });
  const st = W.streaks(s, at(11, 2, 8, 0));
  assert.equal(st.current, 2, "Friday then Monday, the weekend doesn't break it");
  const r = W.recent(s, at(11, 2, 8, 0), 5);
  assert.deepEqual(r.map((d) => [d.dateKey, d.status]), [["2026-10-29", "missed"], ["2026-10-30", "complete"], ["2026-10-31", "rest"], ["2026-11-01", "rest"], ["2026-11-02", "complete"]]);
});

test("recent: the last 14 days, oldest first, today last", () => {
  const r = W.recent(mk(), at(11, 2, 6, 0));
  assert.equal(r.length, 14);
  assert.equal(r[13].dateKey, "2026-11-02");
  assert.equal(r[13].status, "pending");
  assert.equal(r[0].dateKey, "2026-10-20");
  assert.equal(r[0].status, "rest", "before tracking began");
});

test("turning it on starts tracking now; a phrase change doesn't restart anything", () => {
  const on = W.applySettings(W.emptyStore(), form(), at(11, 2, 6, 0));
  assert.equal(on.settings.enabled, true);
  assert.equal(on.settings.trackedFrom, new Date(at(11, 2, 6, 0)).toISOString());
  assert.equal(W.view(on, at(11, 2, 6, 20)).mode, "upcoming", "today still counts, the 6:30 window hasn't opened");
  assert.equal(W.view(on, at(11, 2, 6, 30)).mode, "active", "and it opens on time");
  const phrased = W.applySettings(on, form({ phrase1: "Up and out" }), at(11, 2, 6, 10));
  assert.equal(phrased.settings.trackedFrom, on.settings.trackedFrom);
  assert.equal(phrased.settings.phrase1, "Up and out");
  assert.equal(phrased.settings.updatedAt, new Date(at(11, 2, 6, 10)).toISOString());
  const off = W.applySettings(phrased, form({ enabled: false }), at(11, 2, 6, 20));
  assert.equal(W.view(off, at(11, 2, 7, 0)).mode, "off");
  const again = W.applySettings(off, form(), at(11, 2, 6, 40));
  assert.equal(again.settings.trackedFrom, new Date(at(11, 2, 6, 40)).toISOString(), "turning it back on starts a fresh count from now");
});

test("turning it on after today's window has already closed doesn't count today as missed", () => {
  const on = W.applySettings(W.emptyStore(), form({ time: "07:00" }), at(11, 2, 12, 0));
  assert.equal(W.view(on, at(11, 2, 12, 1)).mode, "rest");
  assert.equal(W.streaks(on, at(11, 2, 12, 1)).mornings, 0);
  assert.equal(W.view(on, at(11, 2, 12, 1)).next.dateKey, "2026-11-03");
});

test("changing the time freezes earlier mornings under the old time, and can't turn today into a miss", () => {
  const s = mk({ trackedFrom: isoAt(10, 28, 6, 0) });
  // Saturday Oct 31... Sunday Nov 1 at 12:00, the old 7:00 mornings have all run out unanswered.
  const edited = W.applySettings(s, form({ time: "05:00", days: [0, 1, 2, 3, 4, 5, 6] }), at(11, 1, 12, 0));
  assert.equal(edited.days["2026-10-30"].wake, "07:00");
  assert.equal(edited.days["2026-11-01"].wake, "07:00");
  assert.equal(edited.settings.time, "05:00");
  // Upcoming morning, edited to a time already past: the new schedule only counts from now.
  const upcoming = mk({ trackedFrom: isoAt(10, 28, 6, 0) });
  const moved = W.applySettings(upcoming, form({ time: "05:30", days: [0, 1, 2, 3, 4, 5, 6] }), at(11, 2, 6, 0));
  assert.equal(W.view(moved, at(11, 2, 6, 1)).mode, "rest", "today's 5:30 had already gone by when it was set");
  assert.equal(W.view(moved, at(11, 2, 6, 1)).next.wake, at(11, 3, 5, 30));
});

/* ---------------- what's kept ---------------- */

test("loading the store drops anything that can't be right", () => {
  const raw = {
    settings: { enabled: true, time: "06:45" },
    days: {
      "2026-11-02": { first: isoAt(11, 2, 7, 1), due: isoAt(11, 2, 7, 6), second: isoAt(11, 2, 7, 7), wake: "07:00", delay: 5, window: 10 },
      "2026-11-03": { first: null, second: isoAt(11, 3, 7, 7), due: isoAt(11, 3, 7, 6) },
      "not-a-day": { first: isoAt(11, 2, 7, 1) },
      "2026-11-04": "nonsense",
      "2026-11-05": { wake: "7am", delay: 999, window: 1, first: "yesterday" }
    }
  };
  const s = W.sanitizeStore(raw);
  assert.deepEqual(Object.keys(s.days), ["2026-11-02", "2026-11-03", "2026-11-05"]);
  assert.equal(s.days["2026-11-02"].second, isoAt(11, 2, 7, 7));
  assert.deepEqual(s.days["2026-11-03"], { wake: null, delay: null, window: null, first: null, due: null, second: null }, "a second phrase with no first one is dropped");
  assert.deepEqual(s.days["2026-11-05"], { wake: null, delay: null, window: null, first: null, due: null, second: null });
  assert.equal(W.sanitizeStore(null).settings.enabled, false);
  assert.deepEqual(W.sanitizeStore("junk").days, {});
});

test("a very long history is trimmed to the newest 1100 days", () => {
  const days = {};
  for (let i = 0; i < 1200; i++) days[W.addDays("2022-01-01", i)] = done(1, 1);
  const s = W.sanitizeStore({ settings: {}, days });
  const keys = Object.keys(s.days);
  assert.equal(keys.length, 1100);
  assert.equal(keys[keys.length - 1], W.addDays("2022-01-01", 1199));
  assert.equal(keys[0], W.addDays("2022-01-01", 100));
});
