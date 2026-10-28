"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../../js/discipline-charts");
const I = require("../../js/discipline-insights");

const D0 = "2026-10-22"; // a Thursday
const add = (n) => new Date(Date.UTC(2026, 9, 22 + n)).toISOString().slice(0, 10);
const pts = (scores, planned) => scores.map((s, i) => ({ date: add(i), score: s, planned: planned ? planned[i] : s !== null }));
const count = (str, re) => (str.match(re) || []).length;

test("the line chart draws a line only between scored days that are next to each other", () => {
  const svg = C.lineChart(pts([80, null, 60, 70, 70, null, 90]), add(6));
  assert.equal(count(svg, /<path class="dc-line"/g), 1, "one run of three days is the only line");
  assert.equal(count(svg, /<circle class="dc-dot/g), 5, "every scored day is a dot");
  assert.match(svg, /<path class="dc-line" d="M[\d. ]+ [\d. ]+ L[\d. ]+ [\d. ]+ L[\d. ]+ [\d. ]+"\/>/);
  assert.equal(count(svg, /class="dc-dot today"/g), 1, "today is marked");
  assert.match(svg, /^<svg class="dc-linechart" viewBox="0 0 320 176" role="img"/);
});

test("a day with no review is a gap, not a zero: it is not on the line or the 0 mark", () => {
  const svg = C.lineChart(pts([80, null, 80], [true, false, false]), add(2));
  assert.equal(count(svg, /<path/g), 0, "a gap breaks the line, so two lone days draw no line at all");
  assert.equal(count(svg, /<circle class="dc-dot/g), 2);
  assert.equal(count(svg, /dc-plan-dot/g), 0, "a day with nothing saved has no marker");
  const planned = C.lineChart(pts([80, null, 80], [true, true, true]), add(2));
  assert.equal(count(planned, /dc-plan-dot/g), 1, "a plan with no review is a small marker on the baseline");
  assert.match(planned, /Sat, Oct 24: 80 out of 100/);
  assert.match(planned, /<title>Fri, Oct 23: plan saved, no review<\/title>/);
});

test("the scale is always 0 to 100, so 100 is at the top and 0 at the bottom of the plot", () => {
  const svg = C.lineChart(pts([100, 0, 50]), add(2));
  const cy = (s) => Number(new RegExp('<circle class="dc-dot"? ?[^>]*cy="([\\d.]+)"[^>]*><title>[^<]*: ' + s + ' out of 100').exec(svg)[1]);
  assert.equal(cy(100), 12);
  assert.equal(cy(0), 150);
  assert.equal(cy(50), 81);
  assert.match(svg, />100<\/text>/);
  assert.match(svg, />50<\/text>/);
  assert.match(svg, />0<\/text>/);
});

test("the chart says in words what it shows, including when there is nothing", () => {
  assert.match(C.lineChart(pts([80, null, 60]), add(2)), /aria-label="Daily discipline scores for the last 3 days\. 2 scored days, from 60 to 80 out of 100\."/);
  assert.match(C.lineChart(pts([null, null]), add(1)), /No scored days yet\./);
  assert.match(C.lineChart(pts([70]), add(0)), /1 scored day, from 70 to 70/);
  const one = C.lineChart(pts([70]), add(0));
  assert.equal(count(one, /<path/g), 0);
  assert.match(one, /cx="170"/, "a single day sits in the middle of the plot");
  assert.match(one, /scores for the last day\. 1 scored day/);
  assert.equal(count(C.lineChart([{ date: add(0), score: null, planned: false }], add(0)), /<circle/g), 0);
});

test("the days along the bottom: a letter per day for a week, three dates for a month", () => {
  const week = C.lineChart(pts([1, 2, 3, 4, 5, 6, 7].map((n) => n * 10)), add(6));
  assert.equal(count(week, /text-anchor="middle">[A-Z]<\/text>/g), 7);
  const month = C.lineChart(pts(Array.from({ length: 30 }, (_, i) => 40 + i)), add(29));
  assert.match(month, /text-anchor="start">Oct 22<\/text>/);
  assert.match(month, /text-anchor="end">Nov 20<\/text>/);
  assert.match(month, /text-anchor="middle">Nov 5<\/text>/);
  assert.equal(count(month, /<circle class="dc-dot/g), 30);
});

test("the same numbers come as a list, newest first, in words", () => {
  const list = C.chartList(pts([80, null, 60], [true, true, true]));
  const items = list.match(/<li>[^<]*<\/li>/g);
  assert.deepEqual(items, ["<li>Sat, Oct 24: 60 out of 100</li>", "<li>Fri, Oct 23: plan saved, no review</li>", "<li>Thu, Oct 22: 80 out of 100</li>"]);
  assert.match(C.chartList(pts([null], [false])), /no entry/);
});

test("escaping", () => {
  assert.equal(C.esc('<b>"x" & \'y\'</b>'), "&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;");
});

const L = require("../../js/discipline-logic");
const day = (score) => ({ type: "normal", morning: { keyTask: { text: "x", done: true }, priorities: [{ text: "" }, { text: "" }, { text: "" }], plan: "" }, review: { screenHours: 3, phoneLimit: 5, items: { school: "done", gratiel: "done", bedOnTime: "done", phoneOut: "done", training: "done", phone: null }, focus: score, time: score, procrastinated: "abc", distractions: "abc", wentWell: "abc", improve: "abc", rules: [] } });

test("the calendar names every day in words, hides days outside the window, and counts what was scored", () => {
  const today = "2026-10-28";
  const days = { "2026-10-28": day(5), "2026-10-27": day(1), "2026-10-26": { type: "normal", morning: { keyTask: { text: "x", done: false }, priorities: [{ text: "" }, { text: "" }, { text: "" }], plan: "" }, review: null } };
  const html = C.heatmap(I.calendar(days, today, 7), today);
  assert.match(html, /^<div class="dc-heat" role="list" aria-label="Calendar of the last days: 2 scored of 7 days shown\.">/);
  assert.equal(count(html, /role="listitem"/g), 7, "the seven days of the window");
  assert.match(html, /aria-label="Wed, Oct 28: 100 out of 100"/);
  assert.match(html, /aria-label="Tue, Oct 27: \d+ out of 100"/);
  assert.match(html, /aria-label="Mon, Oct 26: plan saved, no review"/);
  assert.match(html, /aria-label="Sun, Oct 25: no entry"/);
  assert.equal(count(html, /class="dc-heat-cell s-(future|outside)" aria-hidden="true"/g), 7, "days outside the window are decoration only");
  assert.equal(count(html, /dc-heat-cell s-scored b\d today/g), 1, "today is marked");
  assert.match(html, /<span class="dc-heat-n" aria-hidden="true">100<\/span>/, "the score is written in the square, not only coloured");
  assert.match(html, /<span class="dc-heat-n" aria-hidden="true">·<\/span>/, "a plan with no review shows a dot");
  assert.match(html, /80–100/);
  assert.match(html, /plan only/);
  assert.match(html, /no entry/);
});

test("the calendar shows all five weeks for a month and Monday comes first", () => {
  const html = C.heatmap(I.calendar({}, "2026-10-28", 30), "2026-10-28");
  assert.equal(count(html, /class="dc-heat-row"/g), 5);
  assert.match(html, /<span>Mon<\/span><span>Tue<\/span>/);
  assert.match(html, /Calendar of the last days: 0 scored of 30 days shown\./);
});
