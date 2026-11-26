"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../../js/habit-schedule-logic");

const TODAY = "2026-11-18";            // a Wednesday
const MON = "2026-11-16";
const ms = (d) => new Date(d + "T12:00:00").getTime();
const habit = (id, o) => Object.assign({ id, name: id, targetDays: 7, dailyTarget: 1, completions: {}, createdAt: ms("2026-10-01") }, o || {});
const done = (days) => days.reduce((m, d) => Object.assign(m, { [d]: 1 }), {});

test("what a habit is for: chosen weekdays, every day, or N days a week with no chosen days", () => {
  assert.deepEqual(S.scheduleOf(habit("a", { planDays: [1, 3, 5], targetDays: 3 })), { mode: "days", days: [1, 3, 5], time: "", perWeek: 3 });
  assert.equal(S.scheduleOf(habit("b")).mode, "daily");
  assert.equal(S.scheduleOf(habit("c", { targetDays: 3 })).mode, "flexible");
  assert.equal(S.scheduleOf(habit("d", { targetDays: 3, planDays: [0, 1, 2, 3, 4, 5, 6] })).mode, "daily", "all seven days chosen is every day");
  assert.equal(S.scheduleOf(habit("e", { planTime: "05:10", planDays: [1], targetDays: 1 })).time, "05:10");
});

test("a day is scheduled only on its weekdays, after it began, before it was archived, and not while paused", () => {
  const h = habit("a", { planDays: [1, 3, 5], targetDays: 3, createdAt: ms("2026-11-10") });
  assert.equal(S.scheduledOn(h, TODAY), true, "Wednesday");
  assert.equal(S.scheduledOn(h, "2026-11-17"), false, "Tuesday");
  assert.equal(S.scheduledOn(h, "2026-11-09"), false, "before it was made");
  assert.equal(S.scheduledOn(Object.assign({}, h, { archivedAt: ms("2026-11-16") }), TODAY), false, "after it was archived");
  assert.equal(S.scheduledOn(Object.assign({}, h, { pauses: [{ from: "2026-11-17", until: "" }] }), TODAY), false, "while paused");
  assert.equal(S.scheduledOn(habit("c", { targetDays: 3 }), TODAY), false, "a flexible habit has no single day it is for");
});

test("day states: done, skipped, missed, pending, upcoming, paused, unscheduled; the future is never a miss", () => {
  const h = habit("a", { planDays: [1, 3, 5], targetDays: 3, createdAt: ms("2026-11-01"), completions: done(["2026-11-16"]), skips: { "2026-11-13": true }, pauses: [{ from: "2026-11-06", until: "2026-11-08" }] });
  const st = (d) => S.dayState(h, d, TODAY);
  assert.equal(st("2026-11-16"), "done");
  assert.equal(st("2026-11-13"), "skipped");
  assert.equal(st("2026-11-11"), "missed", "a scheduled Wednesday that passed without being done");
  assert.equal(st("2026-11-06"), "paused");
  assert.equal(st("2026-11-17"), "unscheduled", "Tuesday is not one of its days: not a miss");
  assert.equal(st(TODAY), "pending");
  assert.equal(st("2026-11-20"), "upcoming", "a day that has not happened is never a miss");
  assert.equal(st("2026-10-30"), "unscheduled", "before it began");
  assert.equal(S.dayState(habit("x", { completions: done(["2026-11-17"]), planDays: [1], targetDays: 1 }), "2026-11-17", TODAY), "done", "an extra day that was done is done");
  assert.equal(S.dayState(null, TODAY, TODAY), "unscheduled");
});

test("part of the day comes from the planner time; no time is anytime", () => {
  assert.equal(S.partOfDay(habit("a", { planTime: "05:10", planDays: [3], targetDays: 1 }), TODAY), "morning");
  assert.equal(S.partOfDay(habit("a", { planTime: "12:00", planDays: [3], targetDays: 1 }), TODAY), "afternoon");
  assert.equal(S.partOfDay(habit("a", { planTime: "17:00", planDays: [3], targetDays: 1 }), TODAY), "evening");
  assert.equal(S.partOfDay(habit("a"), TODAY), "anytime");
});

test("today: scheduled habits are grouped and counted; flexible, paused and archived ones are kept out of the count", () => {
  const habits = [
    habit("cold", { planTime: "05:10" }),
    habit("lift", { planTime: "18:00", planDays: [1, 3, 5], targetDays: 3 }),
    habit("tue", { planDays: [2], targetDays: 1 }),
    habit("read", { targetDays: 3 }),
    habit("old", { archivedAt: ms("2026-11-01") }),
    habit("rest", { pauses: [{ from: "2026-11-10", until: "" }] }),
    habit("water", { dailyTarget: 3, completions: { [TODAY]: 3 } }),
    habit("skipme", { skips: { [TODAY]: true } })
  ];
  habits[0].completions[TODAY] = 1;
  const t = S.today(habits, TODAY, TODAY);
  assert.deepEqual(t.groups.morning.map((r) => r.habit.id), ["cold"]);
  assert.deepEqual(t.groups.evening.map((r) => r.habit.id), ["lift"]);
  assert.deepEqual(t.groups.anytime.map((r) => r.habit.id).sort(), ["skipme", "water"]);
  assert.deepEqual(t.flexible.map((r) => r.habit.id), ["read"], "a 3-days-a-week habit is in its own optional list");
  assert.deepEqual(t.paused.map((r) => r.habit.id), ["rest"]);
  assert.equal([].concat(t.groups.morning, t.groups.afternoon, t.groups.evening, t.groups.anytime).some((r) => r.habit.id === "old" || r.habit.id === "tue"), false, "archived and not-today habits are not listed");
  assert.deepEqual(t.counts, { done: 2, total: 3, skipped: 1 }, "cold and water done of cold, lift, water; the skipped one is neither");
  assert.equal(t.groups.anytime.filter((r) => r.habit.id === "skipme")[0].skipped, true);
});

test("a week of a habit: days done against days it is for; a flexible habit against its target; upcoming days are not misses", () => {
  const lift = habit("lift", { planDays: [1, 3, 5], targetDays: 3, createdAt: ms("2026-10-01"), completions: done([MON]) });
  const w = S.weekProgress(lift, MON, TODAY);
  assert.deepEqual([w.done, w.target, w.missed, w.mode], [1, 3, 0, "days"], "Mon done, Wed pending, Fri upcoming: none missed");
  const rd = habit("read", { targetDays: 3, completions: done([MON, "2026-11-17", TODAY]) });
  const f = S.weekProgress(rd, MON, TODAY);
  assert.deepEqual([f.done, f.target, f.missed, f.mode], [3, 3, 0, "flexible"]);
  assert.equal(S.weekProgress(habit("r2", { targetDays: 2, completions: done([MON, "2026-11-17", TODAY]) }), MON, TODAY).extra, 1, "a third day is an extra, not a bonus to the target");
});

test("consistency counts only the chances that passed; skipped and paused days are not chances; nothing to measure is null, not 0", () => {
  const h = habit("lift", { planDays: [1, 3, 5], targetDays: 3, createdAt: ms("2026-11-01"), completions: done(["2026-11-02", "2026-11-04", "2026-11-09", "2026-11-11", "2026-11-16"]), skips: { "2026-11-06": true } });
  // Mon/Wed/Fri from Nov 2 to Nov 17: 2,4,6(skip),9,11,13,16 -> chances 6 (not 6), done 5 (13 was missed)
  const c = S.consistency(h, "2026-11-02", "2026-11-17", TODAY);
  assert.deepEqual([c.chances, c.done, c.skipped, c.missed], [6, 5, 1, 1]);
  assert.ok(Math.abs(c.rate - 5 / 6) < 1e-9);
  // through today: Wednesday today is pending, not a miss
  assert.deepEqual(S.consistency(h, "2026-11-16", TODAY, TODAY).chances, 1);
  assert.equal(S.consistency(h, "2026-11-19", "2026-11-30", TODAY).rate, null, "future days: nothing to measure");
  assert.equal(S.consistency(habit("new", { createdAt: ms("2026-11-18") }), "2026-11-01", TODAY, TODAY).chances, 0, "days before it began are not chances");
  const rd = habit("read", { targetDays: 3, createdAt: ms("2026-10-01"), completions: done(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-09"]) });
  const f = S.consistency(rd, "2026-11-02", "2026-11-15", TODAY);
  assert.deepEqual([f.mode, f.chances, f.done, f.rate], ["flexible", 6, 4, 4 / 6], "two finished weeks of 3: 3 done then 1 done");
  assert.equal(S.consistency(rd, "2026-11-16", TODAY, TODAY).chances, 0, "this week is not over, so it is not counted yet");
});

test("a mismatch between the chosen weekdays and the weekly target is pointed out", () => {
  assert.match(S.mismatch(habit("a", { planDays: [1, 2, 3, 4, 5], targetDays: 3 })).text, /5 days chosen, but the target is 3 a week/);
  assert.equal(S.mismatch(habit("a", { planDays: [1, 3, 5], targetDays: 3 })), null);
  assert.equal(S.mismatch(habit("a", { targetDays: 3 })), null, "no chosen days: nothing to compare");
});

test("skip, pause, resume, archive never touch completions and leave the input alone", () => {
  const habits = [habit("a", { planDays: [1, 3, 5], targetDays: 3, completions: done([MON]) })];
  const sk = S.skip(habits, "a", TODAY, true, TODAY);
  assert.equal(sk.habits[0].skips[TODAY], true);
  assert.equal(habits[0].skips, undefined);
  assert.equal(S.skip(sk.habits, "a", TODAY, false, TODAY).habits[0].skips, undefined, "unskipping removes the field");
  assert.equal(S.skip(habits, "a", MON, true, TODAY).ok, false, "a done day cannot be skipped");
  assert.equal(S.skip(habits, "a", "2026-11-17", true, TODAY).ok, false, "not one of its days");
  assert.equal(S.skip(habits, "nope", TODAY, true, TODAY).ok, false);
  const pa = S.pause(habits, "a", "2026-11-19", "");
  assert.deepEqual(pa.habits[0].pauses, [{ from: "2026-11-19", until: "" }]);
  assert.equal(S.dayState(pa.habits[0], "2026-11-20", TODAY), "paused");
  const re = S.resume(pa.habits, "a", "2026-11-22");
  assert.deepEqual(re.habits[0].pauses, [{ from: "2026-11-19", until: "2026-11-21" }], "the days paused stay paused; history is not rewritten");
  assert.equal(S.resume(S.pause(habits, "a", "2026-11-22", "").habits, "a", "2026-11-22").habits[0].pauses, undefined, "a pause that began today and ends today leaves nothing");
  assert.equal(S.pause(habits, "a", "2026-11-20", "2026-11-19").ok, false);
  const ar = S.archive(habits, "a", 123456);
  assert.equal(ar.habits[0].archivedAt, 123456);
  assert.deepEqual(ar.habits[0].completions, habits[0].completions, "every completion is kept");
  assert.equal(S.unarchive(ar.habits, "a").habits[0].archivedAt, undefined);
});

test("fields keeps only valid schedule data", () => {
  assert.deepEqual(S.fields({ skips: { "2026-11-18": true, nope: true, "2026-11-19": false }, pauses: [{ from: "2026-11-01", until: "" }, { from: "bad" }, { from: "2026-11-05", until: "2026-11-01" }], archivedAt: 5 }),
    { skips: { "2026-11-18": true }, pauses: [{ from: "2026-11-01", until: "" }], archivedAt: 5 });
  assert.deepEqual(S.fields(null), {});
  assert.deepEqual(S.fields({ archivedAt: -1 }), {});
});
