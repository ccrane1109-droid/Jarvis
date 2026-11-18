"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../../js/intentions-logic");

const MON = "2026-11-02";          // a Monday
const WED = "2026-11-04";          // the Wednesday of that week
const NEXT_MON = "2026-11-09";
const PREV_MON = "2026-10-26";
const NOW = Date.parse("2026-11-04T15:00:00Z");
const ctx = (today, now) => ({ today: today || WED, now: now || NOW });
const apply = (records, week, change, today, now) => {
  const r = L.update(records, week, change, ctx(today, now));
  assert.equal(r.ok, true, JSON.stringify(change) + " -> " + r.error);
  return r.records;
};

test("a week always has exactly three 'do' slots and three 'stop' slots, whatever was saved", () => {
  const empty = L.read(null);
  assert.equal(empty.doItems.length, 3);
  assert.equal(empty.stopItems.length, 3);
  assert.ok(empty.stopItems.every((s) => s.days.length === 7 && s.days.every((d) => d === false)));
  // too many, too few, wrong types, long and messy text
  const odd = L.read({ doItems: [{ text: "  Read   every\nmorning ", done: true }, "junk", { text: "x".repeat(500), done: "yes" }, { text: "fourth", done: true }], stopItems: [{ text: "Scrolling", days: [true, 1, true] }, null], wentWell: 5, improve: undefined });
  assert.equal(odd.doItems.length, 3);
  assert.deepEqual(odd.doItems[0], { text: "Read every morning", done: true });
  assert.deepEqual(odd.doItems[1], { text: "", done: false });
  assert.equal(odd.doItems[2].text.length, L.TEXT_MAX);
  assert.equal(odd.doItems[2].done, false, "only a real true counts");
  assert.deepEqual(odd.stopItems[0].days, [true, false, true, false, false, false, false], "only a real true counts, and there are seven days");
  assert.equal(odd.stopItems.length, 3);
  assert.equal(odd.wentWell, "5");
  assert.equal(odd.improve, "");
});

test("writing, ticking and marking days saves into one record for the week, and keeps what else is on it", () => {
  let r = [];
  r = apply(r, MON, { type: "doText", index: 0, text: "Read every morning" });
  r = apply(r, MON, { type: "doDone", index: 0, done: true });
  r = apply(r, MON, { type: "stopText", index: 1, text: "Excessive scrolling" });
  r = apply(r, MON, { type: "stopDay", index: 1, day: 0, value: true });
  r = apply(r, MON, { type: "stopDay", index: 1, day: 2, value: true });
  r = apply(r, MON, { type: "reflection", field: "wentWell", text: "Kept the reading going" });
  assert.equal(r.length, 1);
  assert.equal(r[0].id, "wi_" + MON);
  assert.equal(r[0].weekStart, MON);
  const v = L.view(r, MON, WED);
  assert.equal(v.saved, true);
  assert.deepEqual(v.doItems[0], { text: "Read every morning", done: true });
  assert.deepEqual(v.stopItems[1].days, [true, false, true, false, false, false, false]);
  assert.equal(v.wentWell, "Kept the reading going");
  assert.equal(v.improve, "");
  // un-marking a day works, and fields this version doesn't know are kept
  r = r.map((x) => Object.assign({}, x, { somethingNew: 7 }));
  r = apply(r, MON, { type: "stopDay", index: 1, day: 0, value: false });
  assert.equal(L.view(r, MON, WED).stopItems[1].days[0], false);
  assert.equal(r[0].somethingNew, 7);
  assert.equal(r[0].createdAt, NOW);
});

test("a box can only be ticked on a slot with words, and a day only marked on a slot with words and a day that has happened", () => {
  const empty = L.update([], MON, { type: "doDone", index: 0, done: true }, ctx());
  assert.equal(empty.ok, false);
  assert.match(empty.error, /Write what you want to do/);
  assert.deepEqual(empty.records, []);
  const noWords = L.update([], MON, { type: "stopDay", index: 0, day: 0, value: true }, ctx());
  assert.equal(noWords.ok, false);
  let r = apply([], MON, { type: "stopText", index: 0, text: "Staying up late" });
  // Monday and today (Wednesday) can be marked, Thursday can't
  r = apply(r, MON, { type: "stopDay", index: 0, day: 2, value: true });
  const future = L.update(r, MON, { type: "stopDay", index: 0, day: 3, value: true }, ctx());
  assert.equal(future.ok, false);
  assert.match(future.error, /hasn't happened/);
  assert.equal(future.records, r, "the list comes back untouched");
  // a past week can be marked in full; a future week can't be marked at all
  const pastWeek = apply(apply([], PREV_MON, { type: "stopText", index: 0, text: "x" }), PREV_MON, { type: "stopDay", index: 0, day: 6, value: true });
  assert.equal(L.view(pastWeek, PREV_MON, WED).stopItems[0].days[6], true);
  const w = apply([], NEXT_MON, { type: "stopText", index: 0, text: "x" });
  assert.equal(L.update(w, NEXT_MON, { type: "stopDay", index: 0, day: 0, value: true }, ctx()).ok, false);
  // bad input
  assert.equal(L.update([], WED, { type: "doText", index: 0, text: "x" }, ctx()).ok, false, "a week starts on a Monday");
  assert.equal(L.update([], MON, { type: "doText", index: 3, text: "x" }, ctx()).ok, false, "there are three slots");
  assert.equal(L.update([], MON, { type: "stopDay", index: 0, day: 7, value: true }, ctx()).ok, false);
  assert.equal(L.update([], MON, { type: "reflection", field: "other", text: "x" }, ctx()).ok, false);
  assert.equal(L.update([], MON, { type: "nope" }, ctx()).ok, false);
  assert.equal(L.update([], MON, null, ctx()).ok, false);
});

test("emptying a slot keeps its ticks (so a pause while retyping never loses them), but empty slots are not counted", () => {
  let r = apply([], MON, { type: "doText", index: 0, text: "Read" });
  r = apply(r, MON, { type: "doDone", index: 0, done: true });
  r = apply(r, MON, { type: "doText", index: 0, text: "" });
  assert.deepEqual(L.view(r, MON, WED).progress.doFilled, 0, "an empty slot isn't counted");
  assert.equal(L.view(r, MON, WED).progress.doDone, 0);
  r = apply(r, MON, { type: "doText", index: 0, text: "Read a chapter" });
  assert.deepEqual(L.view(r, MON, WED).doItems[0], { text: "Read a chapter", done: true }, "retyping brings the tick back");
});

test("progress is just 'x of y' over the slots that have words", () => {
  assert.deepEqual(L.view([], MON, WED).progress, { doFilled: 0, doDone: 0, doPct: null, stopFilled: 0, stopMarked: 0, stopTotal: 0, stopPct: null });
  let r = [];
  ["Read", "Business", "Routine"].forEach((t, i) => { r = apply(r, MON, { type: "doText", index: i, text: t }); });
  r = apply(r, MON, { type: "doDone", index: 0, done: true });
  r = apply(r, MON, { type: "doDone", index: 2, done: true });
  r = apply(r, MON, { type: "stopText", index: 0, text: "Scrolling" });
  r = apply(r, MON, { type: "stopText", index: 1, text: "Procrastinating" });
  [0, 1, 2].forEach((d) => { r = apply(r, MON, { type: "stopDay", index: 0, day: d, value: true }); });
  r = apply(r, MON, { type: "stopDay", index: 1, day: 0, value: true });
  const p = L.view(r, MON, WED).progress;
  assert.deepEqual([p.doFilled, p.doDone, p.doPct], [3, 2, 67]);
  assert.deepEqual([p.stopFilled, p.stopMarked, p.stopTotal, p.stopPct], [2, 4, 14, 29], "two slots with words: 4 of 14 days");
});

test("a new week starts clean: ticks and marked days are not carried, but the words are, as a starting point only", () => {
  let r = [];
  r = apply(r, MON, { type: "doText", index: 0, text: "Read every morning" });
  r = apply(r, MON, { type: "doDone", index: 0, done: true });
  r = apply(r, MON, { type: "stopText", index: 0, text: "Excessive scrolling" });
  r = apply(r, MON, { type: "stopDay", index: 0, day: 1, value: true });
  r = apply(r, MON, { type: "reflection", field: "improve", text: "Go to bed earlier" });
  const next = L.view(r, NEXT_MON, NEXT_MON);
  assert.equal(next.saved, false, "nothing is saved for the new week until something changes");
  assert.equal(next.carriedFrom, MON);
  assert.deepEqual(next.doItems[0], { text: "Read every morning", done: false });
  assert.deepEqual(next.stopItems[0], { text: "Excessive scrolling", days: [false, false, false, false, false, false, false] });
  assert.equal(next.wentWell, "");
  assert.equal(next.improve, "", "the reflection is the week's own");
  assert.deepEqual([next.progress.doDone, next.progress.stopMarked], [0, 0]);
  assert.equal(r.length, 1, "viewing a week writes nothing");
  // last week is exactly as it was
  const last = L.view(r, MON, NEXT_MON);
  assert.deepEqual(last.doItems[0], { text: "Read every morning", done: true });
  assert.equal(last.stopItems[0].days[1], true);
  assert.equal(last.improve, "Go to bed earlier");
  // the first change in the new week saves it with the carried words and the one change; last week is untouched
  r = apply(r, NEXT_MON, { type: "doDone", index: 0, done: true }, NEXT_MON);
  assert.equal(r.length, 2);
  const now2 = L.view(r, NEXT_MON, NEXT_MON);
  assert.deepEqual(now2.doItems[0], { text: "Read every morning", done: true });
  assert.equal(now2.stopItems[0].text, "Excessive scrolling");
  assert.equal(L.view(r, MON, NEXT_MON).stopItems[0].days[1], true);
  // editing the words in the new week doesn't change last week's
  r = apply(r, NEXT_MON, { type: "doText", index: 0, text: "Read for 20 minutes" }, NEXT_MON);
  assert.equal(L.view(r, MON, NEXT_MON).doItems[0].text, "Read every morning");
});

test("words come from the latest earlier week that has any, skipping weeks left empty; a past week never filled in stays empty", () => {
  let r = apply([], PREV_MON, { type: "doText", index: 2, text: "Follow my routine" });
  r = r.concat([{ id: "wi_" + MON, weekStart: MON, wentWell: "Only a reflection this week", createdAt: 1, updatedAt: 1 }]);     // a week with no slot words
  const v = L.view(r, NEXT_MON, NEXT_MON);
  assert.equal(v.carriedFrom, PREV_MON);
  assert.equal(v.doItems[2].text, "Follow my routine");
  // looking back at a week nobody filled in does not borrow words from an earlier one
  const old = L.view(apply([], PREV_MON, { type: "doText", index: 0, text: "Old" }), "2026-10-12", WED);
  assert.equal(old.carriedFrom, null);
  assert.deepEqual(old.doItems.map((x) => x.text), ["", "", ""]);
  // ...and a past week that comes after a filled one doesn't either
  const gap = L.view(apply([], PREV_MON, { type: "doText", index: 0, text: "Old" }), MON, NEXT_MON);
  assert.equal(gap.carriedFrom, null);
  assert.equal(gap.doItems[0].text, "");
});

test("history lists earlier weeks that have something in them, newest first, and never the current week", () => {
  let r = [];
  r = apply(r, "2026-10-12", { type: "doText", index: 0, text: "A" });
  r = apply(r, PREV_MON, { type: "stopText", index: 0, text: "B" });
  r = apply(r, PREV_MON, { type: "stopDay", index: 0, day: 0, value: true });
  r = apply(r, MON, { type: "doText", index: 0, text: "This week" });
  r = apply(r, NEXT_MON, { type: "doText", index: 0, text: "Next week" });
  // a week whose record is empty (everything cleared) is not history
  r = apply(r, "2026-10-19", { type: "doText", index: 0, text: "x" });
  r = apply(r, "2026-10-19", { type: "doText", index: 0, text: "" });
  const h = L.history(r, WED);
  assert.deepEqual(h.map((w) => w.weekStart), [PREV_MON, "2026-10-12"]);
  assert.deepEqual([h[0].progress.stopMarked, h[0].progress.stopTotal], [1, 7]);
  assert.equal(L.history(r, WED, 1).length, 1);
  // on Monday the week that just ended moves into the history
  assert.deepEqual(L.history(r, NEXT_MON).map((w) => w.weekStart), [MON, PREV_MON, "2026-10-12"]);
  assert.deepEqual(L.history([], WED), []);
  assert.deepEqual(L.history(null, WED), []);
});

test("deleted and damaged records are ignored; a record that is brought back by a change loses its deletedAt", () => {
  const good = apply([], MON, { type: "doText", index: 0, text: "Read" });
  const gone = good.map((x) => Object.assign({}, x, { deletedAt: 5 }));
  assert.equal(L.view(gone, MON, WED).saved, false);
  assert.deepEqual(L.history(gone, NEXT_MON), []);
  const back = apply(gone, MON, { type: "doText", index: 1, text: "Write" });
  assert.equal(back.length, 1);
  assert.equal(back[0].deletedAt, undefined);
  assert.equal(L.view(back, MON, WED).doItems[1].text, "Write");
  // junk in the list doesn't break reading
  assert.doesNotThrow(() => L.view([null, 5, "x", { id: 3 }, { id: "wi_x", weekStart: "nope" }].concat(good), MON, WED));
  assert.equal(L.view([null, 5].concat(good), MON, WED).doItems[0].text, "Read");
  assert.equal(L.update(null, MON, { type: "doText", index: 0, text: "x" }, ctx()).records.length, 1);
});

test("the week is found by its Monday, and weeks don't mix at the month and year ends", () => {
  assert.equal(L.mondayOf("2027-01-01"), "2026-12-28");
  assert.equal(L.mondayOf("2026-11-08"), MON, "a Sunday belongs to the week that started the Monday before");
  assert.equal(L.weekId("2026-12-28"), "wi_2026-12-28");
  let r = apply([], "2026-12-28", { type: "stopText", index: 0, text: "x" }, "2027-01-03");
  r = apply(r, "2026-12-28", { type: "stopDay", index: 0, day: 6, value: true }, "2027-01-03");     // Sunday 2027-01-03
  assert.equal(L.view(r, "2026-12-28", "2027-01-03").stopItems[0].days[6], true);
  assert.equal(L.update(r, "2026-12-28", { type: "stopDay", index: 0, day: 6, value: true }, ctx("2027-01-02")).ok, false, "Sunday hasn't happened on Saturday");
});
