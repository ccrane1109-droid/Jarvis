"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../../js/discipline-logic");
const I = require("../../js/discipline-insights");

const TODAY = "2026-10-28"; // a Wednesday
const back = (n) => L.addDays(TODAY, -n);

const rev = (o) => Object.assign({
  screenHours: 3, phoneLimit: 5,
  items: { school: "done", gratiel: "done", bedOnTime: "done", phoneOut: "done", training: "done", phone: null },
  extras: { routine: null, managed: null }, habits: null,
  focus: 4, time: 4, procrastinated: "abc", distractions: "abc", wentWell: "abc", improve: "abc", rules: [], savedAt: 5
}, o || {});
const task = (text, done) => ({ text: text, done: !!done, due: "", category: "" });
const morn = (o) => Object.assign({ keyTask: task("Essay", true), priorities: [task(""), task(""), task("")], distraction: "", response: "", plan: "", savedAt: 1, editedAt: 1 }, o || {});
// a saved day: morning and review default to a normal planned, scored day (a perfect-ish 94)
const day = (o) => { const x = o || {}; return { type: "normal", morning: x.morning === undefined ? morn() : x.morning, review: x.review === undefined ? rev() : x.review }; };
const planOnly = () => day({ review: null });
const scoreOf = (d) => L.scoreDay(d).score;

// scored days on each of the given offsets back from today
function week(offsets, make) {
  const days = {};
  offsets.forEach((n, i) => { days[back(n)] = make ? make(n, i) : day(); });
  return days;
}

test("a plain scored day is 94, so the numbers below can be checked by hand", () => {
  assert.equal(scoreOf(day()), 94);
});

test("stats: only scored days are averaged, today is not counted against you, and a day with no review is not a zero", () => {
  const days = week([6, 5, 4, 3, 2, 1]);
  days[TODAY] = planOnly();
  const s = I.stats(days, TODAY, TODAY, 7);
  assert.equal(s.scoredDays, 6);
  assert.equal(s.average, 94);
  assert.deepEqual(s.reviewed, { done: 6, of: 6 }, "today is still open, so it isn't a missed review");
  assert.deepEqual(s.plans, { done: 7, of: 7 });
  assert.deepEqual(s.keyTask, { done: 6, of: 6, rate: 100 }, "today's unfinished main win is not counted yet");

  const gap = Object.assign({}, days); gap[back(3)] = planOnly();
  const g = I.stats(gap, TODAY, TODAY, 7);
  assert.equal(g.scoredDays, 5);
  assert.equal(g.average, 94, "the missed day doesn't drag the average down");
  assert.deepEqual(g.reviewed, { done: 5, of: 6 });
  assert.equal(g.missed, 1);
  assert.deepEqual(g.keyTask, { done: 6, of: 6, rate: 100 }, "a planned day that was never scored still shows its main win");

  const early = I.stats(days, TODAY, TODAY, 9);
  assert.equal(early.reviewed.of, 6, "days before your first logged day are never counted as missed");
});

test("stats: not enough scored days gives no average and no category percentages", () => {
  const s = I.stats(week([2, 1]), TODAY, TODAY, 7);
  assert.equal(s.enough, false);
  assert.equal(s.average, null);
  assert.equal(s.categories, null);
  assert.equal(s.weakest, null);
  assert.equal(s.scoredDays, 2);
  assert.equal(I.stats({}, TODAY, TODAY, 7).scoredDays, 0);
});

test("stats: phone, key task, habits and the two extra review questions come from what was saved", () => {
  const days = week([5, 4, 3, 2, 1], (n) => day({
    morning: morn({ keyTask: task("Essay", n !== 4) }),
    review: rev({
      screenHours: n === 2 ? 6 : 3,
      extras: { routine: n % 2 ? "done" : "not", managed: n === 3 ? "na" : "done" },
      habits: n >= 4 ? { done: 3, open: 1, total: 4 } : { done: 4, open: 0, total: 4 }
    })
  }));
  const s = I.stats(days, TODAY, TODAY, 7);
  assert.deepEqual([s.phone.days, s.phone.overLimit], [5, 1]);
  assert.equal(s.phone.averageHours, 3.6);
  assert.deepEqual(s.keyTask, { done: 4, of: 5, rate: 80 });
  assert.deepEqual(s.habits, { days: 5, allDone: 3, avgPct: 90 }, "all done on 3 of 5 reviewed days; on average 90% of habits");
  assert.deepEqual(s.routine, { yes: 3, no: 2, answered: 5, rate: 60 });
  assert.deepEqual(s.managed, { yes: 4, no: 0, answered: 4, rate: 100 }, "'not today' answers are left out");
  const none = I.stats(week([2, 1, 3]), TODAY, TODAY, 7);
  assert.deepEqual(none.habits, { days: 0, allDone: 0, avgPct: null }, "reviews saved with no Habits kept have no habit numbers");
  assert.equal(none.routine.rate, null);
});

test("stats: a day with no plan is shown as such, not hidden", () => {
  const days = week([3, 2, 1], (n) => n === 2 ? day({ morning: null }) : day());
  const s = I.stats(days, TODAY, TODAY, 7);
  assert.equal(s.noPlanDays, 1);
  assert.deepEqual(s.plans, { done: 2, of: 3 });
});

test("overview: the change in average only appears when both windows have enough scored days", () => {
  const worse = (n) => day({ review: rev({ focus: 2, time: 2 }) });
  const days = Object.assign(week([13, 12, 11, 10], worse), week([3, 2, 1]));
  const o = I.overview(days, TODAY, 7);
  assert.equal(o.cur.average, 94);
  assert.equal(o.prev.scoredDays, 4);
  assert.equal(o.prev.average, scoreOf(worse()));
  assert.equal(o.delta, 94 - scoreOf(worse()));
  const thin = I.overview(Object.assign(week([13, 12], worse), week([3, 2, 1])), TODAY, 7);
  assert.equal(thin.delta, null, "two scored days before is not enough to compare");
  assert.equal(thin.prev.average, null);
  assert.equal(o.streak, 3);
});

test("series: one point per day, oldest first, null where there was no scored review", () => {
  const days = week([2, 0]);
  days[back(1)] = planOnly();
  const s = I.series(days, TODAY, 3);
  assert.deepEqual(s.map((p) => p.date), [back(2), back(1), back(0)]);
  assert.deepEqual(s.map((p) => p.score), [94, null, 94]);
  assert.deepEqual(s.map((p) => p.planned), [true, true, true]);
});

test("calendar: weeks run Monday to Sunday and mark what each day was", () => {
  const days = week([6, 5, 3, 0]);
  days[back(4)] = planOnly();
  const rows = I.calendar(days, TODAY, 7);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.length === 7));
  assert.equal(L.weekdayOf(rows[0][0].date), 1, "starts on a Monday");
  assert.equal(L.weekdayOf(rows[1][6].date), 0, "ends on a Sunday");
  const flat = [].concat.apply([], rows);
  const by = (d) => flat.filter((c) => c.date === d)[0];
  assert.deepEqual(rows[0].map((c) => c.state), ["outside", "outside", "outside", "scored", "scored", "planned", "scored"]);
  assert.equal(by(back(0)).state, "scored");
  assert.equal(by(back(0)).today, true);
  assert.equal(by(back(0)).score, 94);
  assert.equal(by(back(0)).bucket, 4);
  assert.equal(by(L.addDays(TODAY, 1)).state, "future");
  assert.equal(by(back(1)).state, "none", "a day with nothing saved");
  assert.equal(I.calendar({}, TODAY, 30).length, 5, "thirty days cover five weeks here");
  assert.equal(I.bucket(80), 4); assert.equal(I.bucket(79), 3); assert.equal(I.bucket(60), 3); assert.equal(I.bucket(59), 2); assert.equal(I.bucket(40), 2); assert.equal(I.bucket(39), 1); assert.equal(I.bucket(0), 1);
});

test("weekCompare: rows for this week against last, with a change only when both weeks have enough days", () => {
  const worse = () => day({ review: rev({ screenHours: 6 }), morning: morn({ keyTask: task("Essay", false) }) });
  const days = Object.assign(week([13, 12, 11], worse), week([3, 2, 1, 0]));
  const c = I.weekCompare(days, TODAY);
  assert.equal(c.comparable, true);
  const row = (k) => c.rows.filter((r) => r.key === k)[0];
  assert.deepEqual([row("scored").cur, row("scored").prev], ["4 of 7", "3 of 7"]);
  assert.equal(row("average").cur, "94");
  assert.equal(row("average").change, "up " + (94 - scoreOf(worse())));
  assert.deepEqual([row("phone").cur, row("phone").prev, row("phone").change], ["3h", "6h", "down 3h"]);
  assert.deepEqual([row("keyTask").cur, row("keyTask").prev], ["4 of 4", "0 of 3"]);
  assert.deepEqual([row("rules").cur, row("habits").cur], ["—", "—"], "nothing to show is a dash, not a zero");

  const thin = I.weekCompare(Object.assign(week([13, 12], worse), week([3, 2, 1])), TODAY);
  assert.equal(thin.comparable, false);
  assert.equal(thin.rows.filter((r) => r.key === "average")[0].change, null);
  assert.equal(thin.rows.filter((r) => r.key === "average")[0].prev, "—");
  const same = I.weekCompare(Object.assign(week([13, 12, 11]), week([3, 2, 1])), TODAY);
  assert.equal(same.rows.filter((r) => r.key === "average")[0].change, "same");
});

// twelve scored days, the first six answering the question one way and the rest the other
function split(over) {
  const days = {};
  for (let i = 0; i < 12; i++) {
    const first = i < 6;
    days[back(i + 1)] = day(over(first, i));
  }
  return days;
}

test("patterns: a clear difference over enough days on each side is reported, with the days it rests on", () => {
  const days = split((first) => ({ review: rev({ items: { school: "done", gratiel: "done", bedOnTime: first ? "done" : "not", phoneOut: "done", training: "done", phone: null }, focus: first ? 5 : 3 }) }));
  const p = I.patterns(days, TODAY);
  assert.equal(p.length, 1);
  assert.equal(p[0].id, "pattern-bed-focus");
  assert.equal(p[0].text, "On the 6 days you were in bed on time, your focus rating averaged 5 out of 5. On the 6 days you weren't, your focus rating averaged 3 out of 5.");
  assert.match(p[0].basis, /last 30 days/);
  assert.match(p[0].basis, /doesn't show what caused what/);
});

test("patterns: nothing is reported when a side is too small, the gap is small, or the answer was 'not today'", () => {
  const lopsided = {};
  for (let i = 0; i < 12; i++) lopsided[back(i + 1)] = day({ review: rev({ items: { school: "done", gratiel: "done", bedOnTime: i < 4 ? "done" : "not", phoneOut: "done", training: "done", phone: null }, focus: i < 4 ? 5 : 3 }) });
  assert.deepEqual(I.patterns(lopsided, TODAY), [], "4 days on one side is under the minimum of " + I.MIN_SPLIT);
  const close = split((first) => ({ review: rev({ items: { school: "done", gratiel: "done", bedOnTime: first ? "done" : "not", phoneOut: "done", training: "done", phone: null }, focus: first ? 4 : 4 }) }));
  assert.deepEqual(I.patterns(close, TODAY), [], "no difference in focus");
  const na = split((first) => ({ review: rev({ items: { school: "done", gratiel: "done", bedOnTime: first ? "done" : "na", phoneOut: "done", training: "done", phone: null }, focus: first ? 5 : 3 }) }));
  assert.deepEqual(I.patterns(na, TODAY), [], "'not today' answers are on neither side");
  assert.deepEqual(I.patterns({}, TODAY), []);
});

test("patterns: main-win results, Habits and if-then plans are compared too, and at most two are shown", () => {
  const habits = split((first) => ({ review: rev({ habits: first ? { done: 4, open: 0, total: 4 } : { done: 1, open: 3, total: 4 } }), morning: morn({ keyTask: task("Essay", first) }) }));
  const p = I.patterns(habits, TODAY);
  assert.equal(p.length, 1);
  assert.equal(p[0].id, "pattern-habits-keyTask");
  assert.match(p[0].text, /On the 6 days you finished all your Habits, you finished your main win on 6 of 6 days\. On the 6 days you left some Habits open, you finished your main win on 0 of 6 days\./);

  const many = split((first) => ({
    review: rev({ items: { school: "done", gratiel: "done", bedOnTime: first ? "done" : "not", phoneOut: first ? "done" : "not", training: "done", phone: null }, habits: first ? { done: 4, open: 0, total: 4 } : { done: 1, open: 3, total: 4 }, focus: first ? 5 : 2 }),
    morning: morn({ plan: first ? "If I get home, then I start." : "" })
  }));
  assert.equal(I.patterns(many, TODAY).length, 2, "never more than two");
  const ifThen = split((first) => ({ morning: morn({ plan: first ? "When I get home I will start homework" : "later", keyTask: task("Essay", first) }) }));
  assert.equal(I.patterns(ifThen, TODAY)[0].id, "pattern-ifThen-keyTask");
});

test("insights: says what is missing when there are too few scored days", () => {
  const r = I.insights(week([2, 1]), [], [], TODAY);
  assert.deepEqual(r.items, []);
  assert.equal(r.needs, "Needs 3 scored days in the last 30. You have 2.");
  assert.equal(r.scoredDays, 2);
});

test("insights: each one states the days it rests on, and none is invented", () => {
  const days = Object.assign(week([13, 12, 11], (n) => day({ review: rev({ focus: 1, time: 1 }) })), week([3, 2, 1, 0], (n, i) => day({
    morning: i === 1 ? null : morn(),
    review: rev({ rules: [{ id: "a", text: "Phone on the charger", state: i === 0 ? "done" : "not" }, { id: "b", text: "Homework first", state: "done" }] })
  })));
  const avoid = [1, 2, 3].map((n) => ({ at: n, date: back(n), task: "x", reason: "phone", excuse: "", outcome: n === 1 ? "dropped" : "started" }));
  const r = I.insights(days, avoid, [], TODAY);
  const byId = (id) => r.items.filter((i) => i.id === id)[0];
  assert.ok(r.items.length >= 4);
  assert.equal(r.needs, "");
  assert.match(byId("week").text, /^Your average this week is 86 \(4 scored days\), up 11 from 75 the week before \(3 scored days\)\.$/);
  assert.match(byId("weakest").text, /^Your weakest area is .+, averaging \d+% of what was attainable\./);
  assert.match(byId("rule-struggling").text, /^“Phone on the charger” was kept 1 of 4 times\./, "a rule with enough answers and a low rate");
  assert.equal(byId("rule-steady"), undefined, "one rule note at a time");
  assert.match(byId("avoid").text, /You tapped “I'm avoiding it” 3 times\. The most common reason was “My phone keeps pulling me” \(3\)\. You started anyway 2 of 3 times\./);
  r.items.forEach((i) => { assert.ok(i.basis.length > 20, i.id + " has a basis"); assert.ok(i.text.length > 20); });
});

test("insights: the weakest area names the no-plan days when Following through is the weak one", () => {
  const days = week([5, 4, 3, 2, 1], (n) => day({ morning: n <= 3 ? null : morn() }));
  const r = I.insights(days, [], [], TODAY);
  const w = r.items.filter((i) => i.id === "weakest")[0];
  assert.match(w.text, /Following through/);
  assert.match(w.text, /3 of those days had no plan saved, and a day with no plan counts as 0 for this area\./);
});

test("insights: the lowest weekday is named once there are 14 scored days, and not before", () => {
  const many = {};
  for (let i = 1; i <= 20; i++) many[back(i)] = day({ review: rev({ focus: L.weekdayOf(back(i)) === 1 ? 1 : 5, time: L.weekdayOf(back(i)) === 1 ? 1 : 5 }) });
  const w = I.insights(many, [], [], TODAY).items.filter((i) => i.id === "weekday")[0];
  assert.match(w.text, /^Your lowest weekday is Mondays, averaging \d+ over [23] scored days\.$/);
  assert.match(w.basis, /14 scored days/);
  const few = {};
  for (let i = 1; i <= 10; i++) few[back(i)] = many[back(i)];
  assert.equal(I.insights(few, [], [], TODAY).items.filter((i) => i.id === "weekday").length, 0, "ten scored days is not enough for weekday patterns");
});

test("insights: a steady rule is named when none is struggling", () => {
  const days = week([5, 4, 3, 2, 1], () => day({ review: rev({ rules: [{ id: "b", text: "Homework first", state: "done" }] }) }));
  const r = I.insights(days, [], [], TODAY);
  assert.match(r.items.filter((i) => i.id === "rule-steady")[0].text, /^“Homework first” was kept 5 of 5 times\./);
});

test("weeklyReport: what went well and what to improve come from the week's own numbers", () => {
  const days = week([6, 5, 4, 3, 2, 1, 0], (n) => day({ review: rev({ screenHours: n === 5 ? 7 : 3, focus: n === 3 ? 2 : 5, rules: [{ id: "a", text: "Homework first", state: n === 2 ? "not" : "done" }] }) }));
  const avoid = [{ at: 1, date: back(2), task: "x", reason: "tired", excuse: "", outcome: "started" }, { at: 2, date: back(1), task: "y", reason: "tired", excuse: "", outcome: "started" }, { at: 3, date: back(0), task: "z", reason: "tired", excuse: "", outcome: "dropped" }];
  const r = I.weeklyReport({ days: days, avoid: avoid, rules: [{ id: "a", text: "Homework first" }], today: TODAY });
  assert.equal(r.cur.scoredDays, 7);
  assert.equal(r.streak, 7);
  assert.ok(r.went.some((l) => /^Your best day was /.test(l)));
  assert.ok(r.went.includes("You finished your main win on 7 of 7 days."));
  assert.ok(r.went.includes("You kept your rules on 6 of 7 answers."));
  assert.ok(r.went.includes("When you avoided something, you started anyway 2 of 3 times."));
  assert.ok(r.went.includes("Your review streak is 7 days."));
  assert.ok(r.improve.includes("You went over your phone limit on 1 of 7 days with a screen-time number."));
  assert.ok(r.improve.some((l) => /^Weakest area: /.test(l)));
  assert.ok(!r.went.some((l) => /phone limit on all/.test(l)), "not 'within your limit' with one day over");
  assert.ok(r.recommendations.length >= 1 && r.recommendations.length <= 2);
  assert.equal(r.recommendations[0].source, "avoid", "the reason you avoided most is aimed at first");
  assert.equal(r.recommendations[0].text, L.REASONS.filter((x) => x.key === "tired")[0].rule);
  assert.match(r.recommendations[0].why, /3 times this week, most often because “I'm tired or low on energy” \(3\)/);
  assert.deepEqual(r.tracking, [{ text: "Homework first", kept: 6, answered: 7 }], "the rule you already track, and how it went this week");
});

test("weeklyReport: with little data it says so and offers starting ideas, labelled as such", () => {
  const r = I.weeklyReport({ days: week([1]), avoid: [], rules: [], today: TODAY });
  assert.deepEqual(r.went, []);
  assert.deepEqual(r.improve, []);
  assert.ok(r.recommendations.length > 0 && r.recommendations.every((x) => x.source === "starter" && /starting idea/.test(x.why)));
  assert.equal(r.comparable, false);
  assert.equal(r.delta, null);
});

test("weeklyReport: a rule you already track is not offered again, and its week is reported", () => {
  const days = week([5, 4, 3, 2, 1], () => day({ review: rev({ focus: 1, time: 1 }) }));
  const first = I.weeklyReport({ days: days, avoid: [], rules: [], today: TODAY });
  const text = first.recommendations[0].text;
  const again = I.weeklyReport({ days: days, avoid: [], rules: [{ id: "x", text: text.toUpperCase() }], today: TODAY });
  assert.ok(!again.recommendations.some((r) => r.text === text), "a rule with the same words (any case) is not suggested again");
  assert.deepEqual(first.tracking, []);
  assert.deepEqual(again.tracking, [{ text: text.toUpperCase(), kept: 0, answered: 0 }], "tracked, with no answers yet");
  const avoid = [1, 2, 3].map((n) => ({ at: n, date: back(n), task: "x", reason: "phone", excuse: "", outcome: "started" }));
  const withAvoid = I.weeklyReport({ days: days, avoid: avoid, rules: [{ id: "x", text: L.REASONS.filter((x) => x.key === "phone")[0].rule }], today: TODAY });
  assert.ok(!withAvoid.recommendations.some((r) => r.source === "avoid"), "the avoidance rule you already have is not offered either");
});

test("weeklyReport: a week with a gap in last week's days has no comparison, and a real one says up or down", () => {
  const prevWorse = (n) => day({ review: rev({ focus: 2, time: 2 }) });
  const days = Object.assign(week([13, 12, 11], prevWorse), week([3, 2, 1]));
  const r = I.weeklyReport({ days: days, avoid: [], rules: [], today: TODAY });
  assert.equal(r.comparable, true);
  assert.equal(r.delta, 94 - scoreOf(prevWorse()));
  assert.equal(I.weeklyReport({ days: week([3, 2, 1]), avoid: [], rules: [], today: TODAY }).comparable, false);
});

const SECRET_DAYS = (() => {
  const d = week([5, 4, 3, 2, 1], () => day({
    morning: morn({ keyTask: task("SECRET TASK NAME", true), plan: "SECRET PLAN" }),
    review: rev({ improve: "SECRET NOTE", wentWell: "SECRET WIN", habits: { done: 3, open: 1, total: 4 }, rules: [{ id: "a", text: "SECRET RULE", state: "done" }] })
  }));
  return d;
})();

test("shareText: numbers only by default; never a task name, plan, reflection or note; rule wording only if chosen", () => {
  const report = I.weeklyReport({ days: SECRET_DAYS, avoid: [{ at: 1, date: back(1), task: "SECRET AVOID", reason: "tired", excuse: "", outcome: "started" }], rules: [{ id: "a", text: "SECRET RULE" }], today: TODAY });
  const text = I.shareText(report);
  assert.match(text, /^My week on JARVIS Discipline \(Oct 22 to Oct 28\):/);
  assert.match(text, /Scored days: 5 of 7\. Average score: 94\. Best: 94\./);
  assert.match(text, /Review streak: 5 days\./);
  assert.match(text, /Phone: averaged 3h a day, over my limit on 0 of 5 days\./);
  assert.match(text, /Habits: finished all of them on 0 of 5 reviewed days\./);
  assert.match(text, /Rules kept: 5 of 5 answers\./);
  assert.match(text, /When I avoided something, I started anyway 1 of 1 times\./);
  assert.doesNotMatch(text, /SECRET/, "none of the private text, and not even the rule's wording, by default");
  const worded = I.shareText(report, { wording: true });
  assert.match(worded, /What I'm working on: SECRET RULE/);
  assert.doesNotMatch(worded.replace("SECRET RULE", ""), /SECRET/, "only the rule wording was added");
  assert.match(worded, /Next I want to try: /);
});

test("shareText: each section can be left out, and nothing selected leaves only the heading", () => {
  const report = I.weeklyReport({ days: SECRET_DAYS, avoid: [], rules: [], today: TODAY });
  const some = I.shareText(report, { scores: false, phone: false, habits: false, rules: false, avoid: false, wording: false });
  assert.equal(some.split("\n").length, 1);
  const phoneOnly = I.shareText(report, { scores: false, habits: false, rules: false, avoid: false });
  assert.match(phoneOnly, /Phone: /);
  assert.doesNotMatch(phoneOnly, /Scored days|Habits|Rules kept/);
  assert.deepEqual(I.SHARE_SECTIONS.map((s) => s.key), ["scores", "phone", "habits", "rules", "avoid", "wording"]);
  assert.deepEqual(I.SHARE_SECTIONS.filter((s) => s.on).map((s) => s.key), ["scores", "phone", "habits", "rules", "avoid"], "the wording of your rules is off unless you turn it on");
  const empty = I.shareText(I.weeklyReport({ days: {}, avoid: [], rules: [], today: TODAY }));
  assert.match(empty, /No scored days this week\./);
});
