"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../../js/discipline-logic");

const TODAY = "2026-10-22";
const plan = (o) => D.sanitizeDay({ morning: Object.assign({
  keyTask: { text: "Essay", done: false, due: "15:45", category: "school" },
  priorities: [{ text: "Read", done: true, due: "17:00", category: "school" }, { text: "Gym", done: false, due: "", category: "training" }, { text: "", done: false }],
  distraction: "YouTube", response: "Phone in another room", plan: "If I get home then homework"
}, o || {}) }).morning;
const review = (o) => Object.assign({
  screenHours: 3, phoneLimit: 5, items: { school: "done", gratiel: "done", bedOnTime: "done", phoneOut: "done", training: "done", phone: null }, focus: 4, time: 4
}, o || {});
const next = (days, minutes, extra) => D.nextUp(Object.assign({ todayISO: TODAY, minutes: minutes, days: days, settings: {} }, extra || {}));

test("a planned item keeps its words, tick, due time and category, and bad values are dropped", () => {
  const m = plan();
  assert.deepEqual(m.keyTask, { text: "Essay", done: false, due: "15:45", category: "school" });
  assert.deepEqual(m.priorities[0], { text: "Read", done: true, due: "17:00", category: "school" });
  const bad = D.sanitizeDay({ morning: { keyTask: { text: "x", due: "9:5", category: "nonsense" }, priorities: [{ text: "", due: "10:00", category: "school", done: true }] } }).morning;
  assert.equal(bad.keyTask.due, "", "a time must be HH:MM");
  assert.equal(bad.keyTask.category, "", "a category must be one of the list");
  assert.deepEqual(bad.priorities[0], { text: "", done: false, due: "", category: "" }, "an empty item carries nothing");
  assert.equal(D.sanitizeDay({ morning: { keyTask: { text: "x", due: "7:05" } } }).morning.keyTask.due, "07:05", "single-digit hours are tidied");
});

test("an older plan with no times or categories loads unchanged", () => {
  const old = D.sanitizeDay({ morning: { keyTask: { text: "Essay", done: true }, priorities: [{ text: "A", done: false }], distraction: "d", plan: "p", savedAt: 5, editedAt: 6 } }).morning;
  assert.equal(old.keyTask.done, true);
  assert.equal(old.keyTask.due, ""); assert.equal(old.keyTask.category, ""); assert.equal(old.response, "");
  assert.equal(old.savedAt, 5); assert.equal(old.editedAt, 6);
});

test("moving a supporting priority carries its tick, time and tag, never mutates, and respects the edges", () => {
  const m = plan();
  const down = D.moveTask(m, 0, 1);
  assert.equal(down.priorities[1].text, "Read");
  assert.deepEqual(down.priorities[1], m.priorities[0]);
  assert.equal(down.priorities[0].text, "Gym");
  assert.equal(m.priorities[0].text, "Read", "the original is untouched");
  assert.equal(D.moveTask(m, 0, -1), m, "can't go above the first slot");
  assert.equal(D.moveTask(m, 2, 1), m, "or below the last");
  assert.equal(down.editedAt, m.editedAt, "reordering is not an edit of the plan");
  assert.equal(down.keyTask.text, "Essay");
});

test("making a priority the main win swaps it with the old one, ticks and all", () => {
  const m = plan();
  const p = D.promoteTask(m, 0);
  assert.deepEqual(p.keyTask, m.priorities[0]);
  assert.deepEqual(p.priorities[0], m.keyTask);
  assert.equal(D.promoteTask(m, 2), m, "an empty slot can't be promoted");
  assert.ok(p.editedAt >= m.editedAt);
});

test("every suggestion explains itself, and offers other things that make sense, never the same one twice", () => {
  const days = { [TODAY]: { morning: plan() } };
  const cases = [
    next({}, 600), next(days, 600), next(days, 1260),
    next({ [TODAY]: { morning: plan({ keyTask: { text: "Essay", done: true } }) } }, 600)
  ];
  cases.forEach((n) => {
    assert.ok(n.why && n.why.length > 20, n.kind + " has a reason");
    assert.ok(Array.isArray(n.more));
    n.actions.forEach((a) => assert.ok(!n.more.includes(a), n.kind + ": " + a + " is offered once"));
    assert.equal(new Set(n.more).size, n.more.length);
  });
  const win = next(days, 600);
  assert.equal(win.kind, "win");
  assert.ok(win.more.includes("review") && win.more.includes("planTomorrow"), "someone can always choose to review or plan ahead instead");
  assert.ok(win.more.includes("avoid") === false && win.actions.includes("avoid"), "'avoiding it' is already a main button here");
});

test("the morning, the afternoon, the evening and the finish line each say the right thing", () => {
  assert.equal(next({}, 400).kind, "plan");
  const planned = { [TODAY]: { morning: plan() } };
  assert.equal(next(planned, 600).kind, "win");
  assert.equal(next(planned, 1000).kind, "win");
  assert.match(next(planned, 1000).text, /Start it before anything else/, "after school the nudge gets firmer");
  assert.equal(next(planned, 1250).kind, "review", "past the review time it is the review, whatever is still open");
  const finished = { [TODAY]: { morning: plan({ keyTask: { text: "Essay", done: true }, priorities: [{ text: "Read", done: true }, { text: "Gym", done: true }, { text: "" }] }) } };
  const all = next(finished, 600);
  assert.equal(all.kind, "allDone");
  assert.match(all.text, /Your planned actions are complete/);
  assert.match(all.text, /tomorrow's priorities when you're ready/);
  assert.deepEqual(all.actions, [], "no button nagging once everything is done");
});

test("an open program mission is suggested only after the plan is done, and never ahead of the evening review", () => {
  const finished = { [TODAY]: { morning: plan({ keyTask: { text: "Essay", done: true }, priorities: [{ text: "Read", done: true }, { text: "Gym", done: true }, { text: "" }] }) } };
  const m = { total: 2, done: 1, nextText: "Charge your phone outside your bedroom tonight" };
  const n = next(finished, 600, { missions: m });
  assert.equal(n.kind, "mission");
  assert.equal(n.text, m.nextText);
  assert.deepEqual(n.actions, ["mission"]);
  assert.equal(next({ [TODAY]: { morning: plan() } }, 600, { missions: m }).kind, "win", "open priorities come first");
  assert.equal(next(finished, 1260, { missions: m }).kind, "review", "the evening review comes before a mission");
  assert.equal(next(finished, 600, { missions: { total: 2, done: 2, nextText: "" } }).kind, "allDone", "nothing open means nothing to suggest");
  assert.equal(next(finished, 600).kind, "allDone", "no program means no mission");
});

test("yesterday's missing review is still called out first, with a reason, and scoring today leads to planning tomorrow", () => {
  const days = { "2026-10-20": { morning: plan(), review: review() }, [TODAY]: { morning: plan() } };
  const missed = next(days, 600);
  assert.equal(missed.kind, "missed");
  assert.match(missed.why, /gap in your record/);
  const scored = { "2026-10-21": { morning: plan(), review: review() }, [TODAY]: { morning: plan(), review: review() } };
  const n = next(scored, 1300);
  assert.equal(n.kind, "planTomorrow");
  assert.ok(n.why.length > 10);
});

test("the review's extra questions are kept but are not part of the score", () => {
  const base = D.sanitizeDay({ morning: plan(), review: review() });
  const withExtras = D.sanitizeDay({ morning: plan(), review: review({ extras: { routine: "not", managed: "done" } }) });
  assert.deepEqual(withExtras.review.extras, { routine: "not", managed: "done" });
  assert.deepEqual(base.review.extras, { routine: null, managed: null });
  assert.equal(D.scoreDay(withExtras).score, D.scoreDay(base).score, "same score with or without them");
  assert.equal(D.scoreDay(withExtras).possible, D.scoreDay(base).possible, "same denominator");
  assert.deepEqual(D.unanswered(withExtras.review), [], "and they are never required");
  assert.deepEqual(D.sanitizeDay({ review: review({ extras: { routine: "maybe" } }) }).review.extras.routine, null);
});

test("planning drafts keep times, categories and the chosen response", () => {
  const d = D.sanitizeDrafts({ [TODAY]: { morning: { key: "Essay", p: ["a"], d: ["09:00", "x", "7:30"], c: ["school", "nope"], distraction: "yt", response: "Phone away", plan: "if..." } } });
  assert.deepEqual(d[TODAY].morning.d, ["09:00", "", "07:30", ""]);
  assert.deepEqual(d[TODAY].morning.c, ["school", "", "", ""]);
  assert.equal(d[TODAY].morning.response, "Phone away");
  const r = D.sanitizeDrafts({ [TODAY]: { review: { extras: { routine: "done", managed: "bogus" } } } });
  assert.deepEqual(r[TODAY].review.extras, { routine: "done", managed: null });
});

test("the offered wording fits its boxes, so choosing a suggestion never gets cut off", () => {
  D.IF_THEN_EXAMPLES.forEach((t) => { assert.ok(t.length <= D.NOTE_MAX, t); assert.match(t, /^If .*, then /); });
  D.DISTRACTION_RESPONSES.forEach((t) => assert.ok(t.length <= 120, t));
  assert.equal(new Set(D.TASK_CATEGORIES.map((c) => c.key)).size, D.TASK_CATEGORIES.length);
  assert.equal(D.sanitizeDay({ morning: { keyTask: { text: "x" }, response: "r".repeat(300) } }).morning.response.length, 120);
});
