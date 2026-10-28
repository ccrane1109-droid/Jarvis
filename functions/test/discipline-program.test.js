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
    ["title", "principle", "why", "example", "apply", "reflect"].forEach((f) => assert.ok(typeof d[f] === "string" && d[f].length >= (f === "title" ? 4 : f === "reflect" ? 25 : 40), "day " + d.day + " " + f));
  });
});

test("every lesson has the same five parts, in order, and the reflection is one question", () => {
  assert.deepEqual(P.SECTIONS.map((s) => s.key), ["principle", "why", "example", "apply", "reflect"]);
  assert.deepEqual(P.SECTIONS.map((s) => s.label), ["The principle", "Why it works", "Everyday example", "Apply it today", "Reflection"]);
  P.SECTIONS.forEach((sec) => P.DAYS.forEach((d) => assert.ok(typeof d[sec.key] === "string" && d[sec.key].trim(), "day " + d.day + " " + sec.key)));
  P.DAYS.forEach((d) => {
    assert.equal((d.reflect.match(/\?/g) || []).length, 1, "day " + d.day + " asks one question");
    assert.ok(d.reflect.endsWith("?") && d.reflect.length <= 160, "day " + d.day + " reflection is short and ends on the question");
    assert.ok(d.apply.length <= 260, "day " + d.day + " has one practical action, not an essay");
  });
  assert.equal(new Set(P.DAYS.map((d) => d.reflect)).size, 30, "no two days ask the same thing");
});

test("the lessons make no claim about how apps are built or how long an urge lasts", () => {
  const all = P.DAYS.map((d) => [d.principle, d.why, d.example].join(" ")).join(" ");
  assert.doesNotMatch(all, /designed (this way|to)|built to (make|keep)|often within minutes|within minutes/i);
  assert.match(P.DAYS[12].principle, /Skinner/, "the feeds lesson names the research it rests on");
  assert.match(P.DAYS[12].principle, /A feed has that shape/, "and says a feed has that shape rather than that anyone built it so");
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
  const all = P.DAYS.map((d) => [d.principle, d.why, d.example, d.apply, d.reflect].join(" ")).join(" ");
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
  P.AUTO_KINDS.forEach((a) => assert.equal(done(a, empty, { dayNumber: 1 }), false, a + " is not done with nothing entered"));

  const planned = { "2026-10-22": { type: "normal", morning: morning(), review: null } };
  assert.equal(done("plan", planned), true);
  assert.equal(done("ifThen", planned), false, "no if-then written");
  assert.equal(done("keyDone", planned), false);

  const withIf = { "2026-10-22": { type: "normal", morning: morning({ plan: "If I get home then phone on charger", keyTask: { text: "Essay", done: true } }), review: null } };
  assert.equal(done("ifThen", withIf), true);
  const plan = (text) => ({ "2026-10-22": { type: "normal", morning: morning({ plan: text }), review: null } });
  [["If I get home, I will put my phone away.", true], ["When it is 4pm then I start.", true], ["After dinner I'll plan tomorrow.", true], ["Whenever I reach for it, then two minutes first", true],
    ["abc", false], ["I should really do more homework", false], ["Phone on the charger", false], ["If I get home", false], ["then I do it", false], ["", false], ["notifying the gift", false]]
    .forEach(([text, want]) => assert.equal(done("ifThen", plan(text)), want, JSON.stringify(text)));
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

  const idAt = (y, mo, d, h) => "r" + new Date(y, mo - 1, d, h, 0).getTime().toString(36);
  assert.equal(done("rule1", empty, { dayNumber: 1, rules: [{ id: idAt(2026, 10, 22, 9), text: "x" }] }), true, "a rule added on this day");
  assert.equal(done("rule1", empty, { dayNumber: 1, rules: [{ id: idAt(2026, 10, 21, 22), text: "x" }] }), false, "a rule added the day before is not this day's mission");
  assert.equal(done("rule1", empty, { dayNumber: 1, rules: [{ id: idAt(2026, 10, 23, 1), text: "x" }] }), false, "nor one added later");
  assert.equal(done("rule1", empty, { dayNumber: 1, rules: [{ id: "a", text: "x" }] }), false, "nor a rule whose id says nothing about when");
  assert.equal(done("rule1", empty, { dayNumber: 1, rules: [{ id: idAt(2026, 10, 1, 9), text: "old" }, { id: idAt(2026, 10, 22, 9), text: "new" }] }), true, "one new rule among old ones counts");

  const timed = (items) => ({ "2026-10-22": { type: "normal", morning: morning(items), review: null } });
  assert.equal(done("timed", timed({ keyTask: { text: "Essay", done: false, due: "16:00" }, priorities: [{ text: "Homework", done: false, due: "17:00" }, { text: "", done: false }, { text: "", done: false }] })), true, "every filled task has a time");
  assert.equal(done("timed", timed({ keyTask: { text: "Essay", done: false, due: "16:00" }, priorities: [{ text: "Homework", done: false }, { text: "", done: false }, { text: "", done: false }] })), false, "one task without a time");
  assert.equal(done("timed", timed({ keyTask: { text: "", done: false }, priorities: [{ text: "", done: false, due: "16:00" }, { text: "", done: false }, { text: "", done: false }] })), false, "a time with no task is nothing");
  assert.equal(done("timed", timed({ keyTask: { text: "", done: false }, priorities: [{ text: "Homework", done: false, due: "17:00" }, { text: "", done: false }, { text: "", done: false }] })), true, "no key task is fine if the others are timed");
  assert.equal(done("timed", planned), false, "a plan with no times");

  const avoid = [{ at: 5, date: "2026-10-21", task: "x" }];
  assert.equal(done("avoidUsed", empty, { dayNumber: 1, avoid: avoid }), false, "an entry from another day");
  assert.equal(done("avoidUsed", empty, { dayNumber: 1, avoid: avoid.concat([{ at: 6, date: "2026-10-22", task: "y" }]) }), true, "an entry on this day");
  assert.equal(done("avoidUsed", empty, { dayNumber: 1 }), false, "no log at all");
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
  assert.ok(p.items.every((i) => typeof i.how === "string" && i.how.length > 20), "every mission says how it is checked");
  assert.equal(p.total, 3);
  assert.deepEqual(p.items.map((i) => [i.auto, i.done]), [[true, true], [false, true], [false, false]]);
  assert.equal(p.done, 2);
  assert.match(p.items[0].text, /Lock in today's plan with an if-then plan/);
  const w2 = P.dayProgress(10, ctx(days, { date: "2026-10-22" }));
  assert.ok(w2.items.some((i) => /under 4 hours/.test(i.text)), "day 10's phone mission names week 2's target");
});

test("each mission says whether JARVIS checks it or you do, and what it looks at", () => {
  P.AUTO_KINDS.forEach((k) => assert.ok(P.HOW[k] && P.HOW[k].length > 20, k + " has an explanation"));
  assert.deepEqual(Object.keys(P.HOW).sort(), P.AUTO_KINDS.slice().sort(), "and nothing is explained that is not a check");
  const p = P.dayProgress(1, ctx({}, {}));
  assert.deepEqual(p.items.map((i) => i.auto), [true, false, false]);
  assert.match(p.items[0].how, /“if” or “when” trigger/);
  assert.equal(p.items[1].how, P.HOW_MANUAL);
  assert.match(P.HOW_MANUAL, /can't see it/);
  const phone = P.dayProgress(10, ctx({}, {})).items.filter((i) => i.kind === "phoneTarget")[0] || P.dayProgress(12, ctx({}, {})).items.filter((i) => i.kind === "phoneTarget")[0];
  assert.match(phone.how, /can't see your phone/, "the phone check says it only knows what you type");
  assert.match(phone.how, /4 hours or less/, "and names that week's target");
  P.DAYS.forEach((d) => d.missions.filter((m) => m.a).forEach((m) => assert.doesNotMatch(P.missionHow(m, d.day), /\{target\}/, "day " + d.day)));
});

test("a mission that can never tick without something else says what that is", () => {
  const withRule = ctx({}, { rules: [{ id: "a", text: "Rule" }] });
  const ans = P.DAYS.findIndex((d) => d.missions.some((m) => m.a === "rulesAnswered")) + 1;
  assert.ok(ans > 0);
  const none = P.dayProgress(ans, ctx({}, {})).items.filter((i) => i.kind === "rulesAnswered")[0];
  assert.match(none.needs, /Needs a rule that is turned on\. Add one in Setup/);
  const paused = P.dayProgress(ans, ctx({}, { rules: [{ id: "a", text: "Rule", enabled: false }] })).items.filter((i) => i.kind === "rulesAnswered")[0];
  assert.match(paused.needs, /turned on/, "a rule that is turned off can't be answered, so it doesn't count");
  assert.equal(P.dayProgress(ans, withRule).items.filter((i) => i.kind === "rulesAnswered")[0].needs, "", "nothing missing once there is a rule");
  P.dayProgress(1, ctx({}, {})).items.forEach((i) => assert.equal(i.needs, "", "other missions need nothing"));
  const answered = { "2026-10-22": { type: "normal", morning: morning(), review: review({ rules: [{ id: "a", text: "Rule", state: "done" }] }) } };
  const done = P.dayProgress(ans, ctx(answered, { rules: [{ id: "a", text: "Rule" }] })).items.filter((i) => i.kind === "rulesAnswered")[0];
  assert.equal(done.done, true);
  assert.equal(done.needs, "", "no reminder on a finished mission");
});

test("a lesson opens on the date it is due, in the calendar, whatever the clock does", () => {
  assert.deepEqual(P.unlock("2026-10-22", 1, "2026-10-22"), { date: "2026-10-22", inDays: 0 });
  assert.deepEqual(P.unlock("2026-10-22", 2, "2026-10-22"), { date: "2026-10-23", inDays: 1 });
  assert.deepEqual(P.unlock("2026-10-22", 30, "2026-10-22"), { date: "2026-11-20", inDays: 29 });
  assert.equal(P.unlock("2026-10-22", 3, "2026-10-26").inDays, -2, "negative once it is open");
  // clocks go back on 2026-11-01 in New York: a start before it still lands on the right calendar dates
  assert.equal(P.unlock("2026-10-30", 3, "2026-10-30").date, "2026-11-01");
  assert.equal(P.unlock("2026-10-30", 4, "2026-10-30").date, "2026-11-02");
  assert.equal(P.unlock("2026-03-05", 6, "2026-03-05").date, "2026-03-10", "and across the spring change");
  assert.equal(P.unlock("2028-02-27", 3, "2028-02-27").date, "2028-02-29", "and a leap day");
});

test("the overview counts only days that have opened, and never reveals a later lesson", () => {
  const ctxFor = (days, ticks) => (n) => ({ date: P.dateOfDay("2026-10-22", n), days: days, rules: [], manualDone: (ticks && ticks[String(n)]) || [] });
  const day = (extra) => ({ type: "normal", morning: morning(extra), review: review() });
  // days 1 and 2 fully planned and scored (day 2's plan note has no if-then, but its missions are plan/review/manual)
  const days = { "2026-10-22": day({ plan: "If I get home then phone on charger" }), "2026-10-23": day() };
  const none = P.overview({ start: null, done: {}, reflections: {} }, "2026-10-22", ctxFor({}));
  assert.deepEqual([none.status, none.day, none.unlocked, none.upcoming.length, none.today], ["notStarted", 0, 0, 0, null]);

  const done = { "1": [1, 2], "2": [1, 2] };
  const o = P.overview({ start: "2026-10-22", done: done, reflections: { "1": "a", "2": "b" } }, "2026-10-24", ctxFor(days, done));
  assert.equal(o.status, "active");
  assert.equal(o.day, 3);
  assert.equal(o.week.n, 1);
  assert.equal(o.title, "Environment beats willpower");
  assert.equal(o.unlocked, 3);
  assert.equal(o.finished, 2, "days 1 and 2 have every mission done; today (day 3) has not");
  assert.equal(o.missionsTotal, 9, "three missions on each of three open days");
  assert.equal(o.reflections, 2);
  assert.deepEqual(o.upcoming.map((u) => [u.day, u.date, u.inDays]), [[4, "2026-10-25", 1], [5, "2026-10-26", 2], [6, "2026-10-27", 3]]);
  assert.deepEqual(Object.keys(o.upcoming[0]).sort(), ["date", "day", "inDays", "title"], "an upcoming day is a title and a date, nothing of the lesson");
  assert.equal(o.today.total, 3);

  const last = P.overview({ start: "2026-10-22", done: {}, reflections: {} }, "2026-11-20", ctxFor({}));
  assert.equal(last.day, 30);
  assert.deepEqual(last.upcoming, [], "nothing after day 30");
  assert.equal(last.unlocked, 30);
  const over = P.overview({ start: "2026-10-22", done: {}, reflections: {} }, "2026-11-25", ctxFor({}));
  assert.equal(over.status, "complete");
  assert.equal(over.unlocked, 30);
  assert.equal(over.today, null);
});
