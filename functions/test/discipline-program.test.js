"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../../js/discipline-logic");
const P = require("../../js/discipline-program");

const morning = (o) => Object.assign({
  priorities: [{ text: "Homework", done: false }, { text: "", done: false }, { text: "", done: false }],
  keyTask: { text: "Essay", done: false }, distraction: "", plan: ""
}, o || {});
const review = (o) => Object.assign({
  screenHours: 3, phoneLimit: 5,
  items: { school: "done", gratiel: "done", bedOnTime: "done", phoneOut: "done", training: "done", phone: null },
  focus: 4, time: 4, procrastinated: "abc", distractions: "abc", wentWell: "abc", improve: "abc", rules: []
}, o || {});
const ctx = (days, o) => Object.assign({ date: "2026-10-22", days: days, rules: [], manualDone: [] }, o || {});

test("there are exactly 30 days, each with a full lesson and its own title", () => {
  assert.equal(P.DAYS.length, 30);
  assert.deepEqual(P.DAYS.map((d) => d.day), Array.from({ length: 30 }, (_, i) => i + 1));
  assert.equal(new Set(P.DAYS.map((d) => d.title)).size, 30, "no two days share a title");
  P.DAYS.forEach((d) => {
    ["title", "principle", "why", "example", "apply"].forEach((f) => assert.ok(typeof d[f] === "string" && d[f].length >= (f === "title" ? 4 : 40), "day " + d.day + " " + f));
  });
});

test("every day has 2 or 3 missions with words, and automatic ones use a known check", () => {
  P.DAYS.forEach((d) => {
    assert.ok(d.missions.length >= 2 && d.missions.length <= 3, "day " + d.day + " has " + d.missions.length);
    d.missions.forEach((m) => {
      assert.ok(m.t && m.t.length > 8, "day " + d.day + " mission text");
      if (m.a) assert.ok(P.AUTO_KINDS.includes(m.a), "day " + d.day + ": " + m.a);
    });
    assert.equal(new Set(d.missions.map((m) => m.t)).size, d.missions.length, "day " + d.day + " has no repeated mission");
  });
  assert.ok(P.DAYS.every((d) => d.missions.some((m) => m.a)), "every day has at least one mission checked against real data");
});

test("the lessons don't invent statistics or promise results", () => {
  const all = P.DAYS.map((d) => [d.principle, d.why, d.example, d.apply].join(" ")).join(" ");
  assert.doesNotMatch(all, /%/, "no percentages");
  assert.doesNotMatch(all, /\b(proven|guarantee[ds]?|scientists agree|always works|studies show that)\b/i);
  assert.doesNotMatch(all, /\b\d+ (times|x) (more|better|faster)\b/i, "no multipliers");
});

test("examples are pictured scenarios, not claims about real people", () => {
  P.DAYS.forEach((d) => assert.doesNotMatch(d.example, /\b(my|I met|a study of|in 19\d\d|in 20\d\d)\b.*\b(studied|found|showed)\b/i, "day " + d.day));
  assert.equal(P.DAYS.filter((d) => /^(Picture|Compare|“|A slot|Instead|Wish|Maybe|Keep:)/.test(d.example)).length, 30, "each example opens as an imagined scenario or a plain illustration");
});

test("the weeks cover days 1-30 exactly once, and the phone target only steps down", () => {
  assert.deepEqual([P.weekOf(1).n, P.weekOf(7).n, P.weekOf(8).n, P.weekOf(14).n, P.weekOf(15).n, P.weekOf(21).n, P.weekOf(22).n, P.weekOf(28).n, P.weekOf(29).n, P.weekOf(30).n], [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.deepEqual([1, 8, 15, 22, 29].map(P.phoneTarget), [5, 4, 3.5, 3, 3]);
  for (let n = 2; n <= 30; n++) assert.ok(P.phoneTarget(n) <= P.phoneTarget(n - 1), "day " + n);
  const covered = [];
  P.WEEKS.forEach((w) => { for (let n = w.days[0]; n <= w.days[1]; n++) covered.push(n); });
  assert.deepEqual(covered, Array.from({ length: 30 }, (_, i) => i + 1));
});

test("where today is in the program", () => {
  assert.deepEqual(P.programDay(null, "2026-10-22"), { status: "notStarted", day: 0 });
  assert.deepEqual(P.programDay("2026-10-23", "2026-10-22"), { status: "notStarted", day: 0 }, "a start in the future");
  assert.deepEqual(P.programDay("2026-10-22", "2026-10-22"), { status: "active", day: 1 });
  assert.deepEqual(P.programDay("2026-10-22", "2026-11-20"), { status: "active", day: 30 });
  assert.deepEqual(P.programDay("2026-10-22", "2026-11-21"), { status: "complete", day: 31 });
  assert.equal(P.programDay("2026-10-22", "2026-12-31").status, "complete");
  assert.equal(P.dateOfDay("2026-10-22", 1), "2026-10-22");
  assert.equal(P.dateOfDay("2026-10-22", 30), "2026-11-20");
});

test("mission text names that week's phone target", () => {
  const m = { t: "Stay under {target} hours of screen time", a: "phoneTarget" };
  assert.equal(P.missionText(m, 3), "Stay under 5 hours of screen time");
  assert.equal(P.missionText(m, 10), "Stay under 4 hours of screen time");
  assert.equal(P.missionText(m, 16), "Stay under 3.5 hours of screen time");
});

test("automatic missions look at what was entered, and nothing else", () => {
  const done = (a, days, o) => P.missionDone({ t: "x", a: a }, 0, ctx(days, o || { dayNumber: 1 }));
  const empty = {};
  ["plan", "ifThen", "keyDone", "review", "tomorrow", "rule1", "rulesAnswered", "phoneTarget"].forEach((a) => assert.equal(done(a, empty, { dayNumber: 1 }), false, a + " is not done with nothing entered"));

  const planned = { "2026-10-22": { type: "normal", morning: morning(), review: null } };
  assert.equal(done("plan", planned), true);
  assert.equal(done("ifThen", planned), false, "no if-then written");
  assert.equal(done("keyDone", planned), false);

  const withIf = { "2026-10-22": { type: "normal", morning: morning({ plan: "If I get home then phone on charger", keyTask: { text: "Essay", done: true } }), review: null } };
  assert.equal(done("ifThen", withIf), true);
  assert.equal(done("keyDone", withIf), true);
  assert.equal(done("review", withIf), false, "planned is not reviewed");

  const scored = { "2026-10-22": { type: "normal", morning: morning(), review: review() } };
  assert.equal(done("review", scored), true);
  assert.equal(done("phoneTarget", scored, { dayNumber: 1 }), true, "3h is under the week-1 target of 5h");
  assert.equal(done("phoneTarget", { "2026-10-22": { type: "normal", morning: morning(), review: review({ screenHours: 4.5 }) } }, { dayNumber: 16 }), false, "4.5h is over the week-3 target of 3.5h");
  assert.equal(done("phoneTarget", { "2026-10-22": { type: "normal", morning: morning(), review: review({ screenHours: 4.5 }) } }, { dayNumber: 1 }), true, "...but under week 1's 5h");
  const excused = { "2026-10-22": { type: "sick", morning: morning(), review: review({ screenHours: null, items: { school: "done", gratiel: "na", bedOnTime: "done", phoneOut: "done", training: "na", phone: "na" } }) } };
  assert.equal(done("phoneTarget", excused, { dayNumber: 1 }), false, "a day with phone time excused doesn't count as meeting the target");

  const tomorrow = { "2026-10-23": { type: "normal", morning: morning(), review: null } };
  assert.equal(done("tomorrow", tomorrow), true);
  assert.equal(done("tomorrow", planned), false, "today's plan is not tomorrow's");

  assert.equal(done("rule1", empty, { dayNumber: 1, rules: [{ id: "a", text: "x" }] }), true);
  const answered = { "2026-10-22": { type: "normal", morning: morning(), review: review({ rules: [{ id: "a", text: "Rule", state: "not" }] }) } };
  assert.equal(done("rulesAnswered", answered), true);
  const skipped = { "2026-10-22": { type: "normal", morning: morning(), review: review({ rules: [{ id: "a", text: "Rule", state: "na" }, { id: "b", text: "Rule2", state: null }] }) } };
  assert.equal(done("rulesAnswered", skipped), false, "'not today' and blank don't count as answering");
});

test("hand-ticked missions follow the ticks, by position", () => {
  const m = { t: "Do the thing" };
  assert.equal(P.missionDone(m, 1, ctx({}, { manualDone: [1] })), true);
  assert.equal(P.missionDone(m, 0, ctx({}, { manualDone: [1] })), false);
  assert.equal(P.missionDone(m, 0, ctx({}, { manualDone: [] })), false);
});

test("a day's progress counts the missions, with their words and whether each is automatic", () => {
  const days = { "2026-10-22": { type: "normal", morning: morning({ plan: "If I get home then phone on charger" }), review: null } };
  const p = P.dayProgress(1, ctx(days, { manualDone: [1] }));
  assert.equal(p.total, 3);
  assert.deepEqual(p.items.map((i) => [i.auto, i.done]), [[true, true], [false, true], [false, false]]);
  assert.equal(p.done, 2);
  assert.match(p.items[0].text, /Lock in today's plan with an if-then plan/);
  const w2 = P.dayProgress(10, ctx(days, { date: "2026-10-22" }));
  assert.ok(w2.items.some((i) => /under 4 hours/.test(i.text)), "day 10's phone mission names week 2's target");
});
