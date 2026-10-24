"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../../js/discipline-logic");

const morning = () => ({ priorities: [{ text: "Homework", done: true }, { text: "Gym", done: false }, { text: "", done: false }], keyTask: { text: "Essay", done: true }, distraction: "", plan: "" });
const review = (o) => Object.assign({
  screenHours: 3, phoneLimit: 5,
  items: { school: "done", gratiel: "na", bedOnTime: "done", phoneOut: "not", training: "done", phone: null },
  focus: 4, time: 3, wentWell: "homework first", improve: "start earlier"
}, o || {});
const store = (days) => D.sanitizeStore({ days: days });

test("a saved review remembers which scoring model version it was scored under", () => {
  const s = store({ "2026-10-20": { morning: morning(), review: review() } });
  assert.equal(s.days["2026-10-20"].review.rubric, D.RUBRIC_VERSION);
  assert.equal(D.RUBRIC_VERSION, 1);
  // a version written by a future app survives a round trip untouched
  const future = store({ "2026-10-20": { morning: morning(), review: review({ rubric: 7 }) } });
  assert.equal(future.days["2026-10-20"].review.rubric, 7);
  assert.equal(D.sanitizeStore(JSON.parse(JSON.stringify(future))).days["2026-10-20"].review.rubric, 7);
});

test("the snapshot keeps the score, the attainable points, what was left out and each category", () => {
  const s = store({ "2026-10-20": { morning: morning(), review: review() } });
  const r = D.scoreDay(s.days["2026-10-20"]);
  const snap = D.scoreSnapshot(r);
  assert.equal(snap.score, r.score);
  assert.equal(snap.possible, r.possible);
  assert.ok(snap.possible < 100, "a not-today item shrinks the denominator");
  assert.deepEqual(snap.excused, ["Business block that made something"]);
  assert.equal(snap.categories.length, 6);
  assert.equal(snap.categories.find((c) => c.key === "consistency").possible, 7);
  assert.ok(Math.abs(snap.categories.reduce((a, c) => a + c.earned, 0) - snap.earned) < 0.31, "categories add up to the total (to within rounding)");
});

test("older reviews are stamped once with exactly what the app already showed for them", () => {
  const s = store({
    "2026-10-20": { morning: morning(), review: review() },
    "2026-10-21": { morning: morning(), review: review({ items: { school: "done", gratiel: null, bedOnTime: "done", phoneOut: "done", training: "done", phone: null } }) }, // not complete
    "2026-10-22": { morning: morning() }                                                                                                                                   // no review at all
  });
  const shown = D.scoreDay(s.days["2026-10-20"]).score;
  assert.equal(D.backfillSnapshots(s), 1, "only the complete review is stamped");
  assert.equal(s.days["2026-10-20"].review.scored.score, shown);
  assert.equal(s.days["2026-10-20"].review.scored.at, s.days["2026-10-20"].review.savedAt, "stamped with when it was saved, not when it was migrated");
  assert.equal(s.days["2026-10-21"].review.scored, null, "an incomplete review is not given a score");
  assert.equal(D.backfillSnapshots(s), 0, "running it again changes nothing");
  const round = D.sanitizeStore(JSON.parse(JSON.stringify(s)));
  assert.equal(round.days["2026-10-20"].review.scored.score, shown);
});

test("changing the phone limit or the day's plan after scoring leaves the stored result alone", () => {
  const s = store({ "2026-10-20": { morning: morning(), review: review() } });
  D.backfillSnapshots(s);
  const saved = s.days["2026-10-20"].review.scored.score;
  s.settings.phoneLimit = 1;                                      // a later setting change
  assert.equal(D.scoreDay(s.days["2026-10-20"]).score, saved, "the review still scores against the limit it was saved with");
  assert.equal(s.days["2026-10-20"].review.scored.score, saved);
  s.days["2026-10-20"].morning.priorities[1].done = true;         // the plan itself is edited
  assert.notEqual(D.scoreDay(s.days["2026-10-20"]).score, saved, "an edit to the day's own data does change what it scores now");
  assert.equal(s.days["2026-10-20"].review.scored.score, saved, "but the stored result still says what it was when saved");
});

test("an unreviewed day is never a scored zero, and a partly answered one is not scored either", () => {
  const s = store({ "2026-10-20": { morning: morning() }, "2026-10-21": { morning: morning(), review: review({ focus: null }) } });
  const none = D.scoreDay(s.days["2026-10-20"]);
  assert.equal(none.complete, false); assert.equal(none.score, null); assert.deepEqual(none.missing, ["review"]);
  const part = D.scoreDay(s.days["2026-10-21"]);
  assert.equal(part.complete, false); assert.equal(part.score, null); assert.deepEqual(part.missing, ["focus"]);
  assert.equal(D.reviewStreak(s.days, "2026-10-22"), 0);
});

test("drafts: kept per date, cleaned, and only the newest few dates survive", () => {
  const raw = {};
  for (let i = 1; i <= 14; i++) raw["2026-10-" + String(i).padStart(2, "0")] = { morning: { key: "k" + i, p: ["a", "b", "c"] } };
  raw["not-a-date"] = { morning: { key: "x" } };
  raw["2026-10-20"] = { morning: { key: "  Essay  ", p: ["one", 5, null, "four"], distraction: "d".repeat(500), plan: 7 }, review: { focus: 9, time: 3, items: { school: "done", gratiel: "maybe" }, rules: { r1: "done", r2: "bogus" }, screenHours: "3.5", notes: { output: "made a post", wentWell: "x".repeat(500) } } };
  const d = D.sanitizeDrafts(raw);
  const dates = Object.keys(d);
  assert.equal(dates.length, 10);
  assert.ok(!("not-a-date" in d));
  assert.ok(dates.includes("2026-10-20") && !dates.includes("2026-10-01"));
  assert.equal(d["2026-10-20"].morning.key, "Essay");
  assert.deepEqual(d["2026-10-20"].morning.p, ["one", "5", ""]);
  assert.equal(d["2026-10-20"].morning.distraction.length, D.NOTE_MAX);
  assert.equal(d["2026-10-20"].review.focus, null, "an out-of-range rating is dropped");
  assert.equal(d["2026-10-20"].review.time, 3);
  assert.equal(d["2026-10-20"].review.items.school, "done");
  assert.equal(d["2026-10-20"].review.items.gratiel, null);
  assert.deepEqual(d["2026-10-20"].review.rules, { r1: "done" });
  assert.equal(d["2026-10-20"].review.screenHours, "3.5");
  assert.equal(d["2026-10-20"].review.notes.output, "made a post");
  assert.equal(d["2026-10-20"].review.notes.wentWell.length, D.NOTE_MAX);
});

test("drafts survive the same save/load as the rest of the store, and junk never crashes it", () => {
  const s = D.sanitizeStore({ drafts: { "2026-10-22": { review: { focus: 4, items: { school: "done" }, notes: { improve: "earlier" } } } } });
  const round = D.sanitizeStore(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(round.drafts, s.drafts);
  [null, [], "x", 5, { "2026-10-22": null }, { "2026-10-22": { morning: "nope", review: [] } }].forEach((junk) => {
    assert.doesNotThrow(() => D.sanitizeStore({ drafts: junk }));
    assert.deepEqual(D.sanitizeStore({ drafts: junk }).drafts, {});
  });
  assert.deepEqual(D.sanitizeStore(null).drafts, {});
});
