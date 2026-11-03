"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../../js/charts");

const items = (vals, extra) => vals.map((v, i) => Object.assign({ label: "W" + i, title: "Week " + i, value: v, valueText: v + " workouts", state: "" }, extra && extra[i] || {}));
const count = (html, re) => (html.match(re) || []).length;

test("round axis numbers: a step of 1, 2, 5 or 10 times a power of ten", () => {
  assert.deepEqual(C.niceScale(0, 7, 4), { min: 0, max: 8, step: 2, ticks: [0, 2, 4, 6, 8] });
  assert.deepEqual(C.niceScale(0, 3, 4).ticks, [0, 1, 2, 3]);
  assert.deepEqual(C.niceScale(0, 12840, 4).ticks, [0, 5000, 10000, 15000]);
  assert.deepEqual(C.niceScale(142, 188, 4).ticks, [140, 160, 180, 200]);
  const flat = C.niceScale(5, 5, 4);
  assert.ok(flat.max > flat.min && flat.ticks.length >= 2, "a flat series still gets a scale");
  assert.ok(C.niceScale(NaN, 3, 4).max > 0, "nonsense in, a usable scale out");
  const swapped = C.niceScale(9, 2, 3);
  assert.ok(swapped.min <= 2 && swapped.max >= 9, "swapped ends are put right");
});

test("axis numbers are written in full under 10,000 and as 12K once the axis reaches it", () => {
  assert.equal(C.axisFormatter(8000)(6500), "6500");
  assert.equal(C.axisFormatter(20000)(15000), "15K");
  assert.equal(C.axisFormatter(20000)(12500), "12.5K");
  assert.equal(C.axisFormatter(20000)(0), "0K".replace("0K", "0K"));
});

test("which x labels to print: the first, the last, and evenly between while they fit", () => {
  assert.deepEqual(C.xLabelIndexes(1, 300, 60), [0]);
  assert.deepEqual(C.xLabelIndexes(2, 300, 60), [0, 1]);
  const idx = C.xLabelIndexes(14, 300, 60);
  assert.equal(idx[0], 0); assert.equal(idx[idx.length - 1], 13);
  assert.ok(idx.length <= 5, "no more than fit side by side");
  assert.deepEqual(C.xLabelIndexes(0, 300, 60), []);
});

test("columns: one per item, at most 24px wide, rounded 4px on top, nothing drawn for zero", () => {
  const html = C.columns(items([2, 0, 3, 1, 3]), { width: 320, ariaLabel: "Workouts per week" });
  assert.equal(count(html, /class="ch-bar/g), 4, "the zero week has no bar");
  const paths = [...html.matchAll(/class="ch-bar[^"]*" data-i="\d+" d="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(paths.length, 4);
  const widthOf = (d) => { const first = Number(/^M([\d.]+),/.exec(d)[1]); const xs = [...d.matchAll(/L([\d.]+),/g)].map((m) => Number(m[1])); return xs[xs.length - 1] - first; };
  paths.forEach((d) => { assert.ok(widthOf(d) > 0 && widthOf(d) <= 24 + 0.01, "never wider than 24px: " + widthOf(d)); assert.match(d, /A4,4 0 0 1/, "4px round corners at the top"); assert.match(d, /Z$/, "closed shape"); });
  assert.match(html, /<svg[^>]*aria-hidden="true"/, "the picture is hidden from screen readers; the group and the table carry the words");
  assert.match(html, /role="group" aria-label="Workouts per week\. Use the left and right arrow keys/);
  assert.match(html, /tabindex="0"/);
});

test("columns: a part week is drawn lighter, and each column's words are in the data for the tooltip", () => {
  const html = C.columns(items([2, 3, 1], [{}, {}, { state: "soft" }]), { width: 320 });
  assert.equal(count(html, /is-soft/g), 1);
  const data = JSON.parse(html.match(/data-chart="([^"]+)"/)[1].replace(/&quot;/g, '"'));
  assert.equal(data.kind, "columns");
  assert.equal(data.tips.length, 3);
  assert.deepEqual(data.tips[2], { t: "Week 2", v: "1 workouts", l: "Week 2: 1 workouts" });
  assert.equal(data.xs.length, 3);
  assert.ok(data.xs[0] < data.xs[1] && data.xs[1] < data.xs[2]);
});

test("many weeks stay inside the box: 104 thin columns, none wider than their slot", () => {
  const html = C.columns(items(Array.from({ length: 104 }, (_, i) => i % 4)), { width: 300 });
  assert.equal(count(html, /class="ch-bar/g), 78);
  const data = JSON.parse(html.match(/data-chart="([^"]+)"/)[1].replace(/&quot;/g, '"'));
  assert.ok(data.band < 3, "slots are narrow");
  assert.ok(data.xs[103] <= 300 - 8, "the last column ends inside the chart");
});

test("columns with no data at all still draw an empty frame, not an error", () => {
  const html = C.columns(items([0, 0, 0]), { width: 320 });
  assert.equal(count(html, /class="ch-bar/g), 0);
  assert.match(html, /ch-grid/);
  assert.doesNotThrow(() => C.columns([], { width: 320 }));
});

test("a line: 2px path, an area wash, markers, the newest value labelled, and a crosshair for the tooltip", () => {
  const pts = [150, 155, 153, 160, 171].map((y, i) => ({ x: "2026-10-" + String(6 + i * 7).padStart(2, "0"), y: y, label: "Oct " + (6 + i * 7), title: "Oct " + (6 + i * 7), valueText: y + " lb est. 1RM" }));
  const html = C.line(pts, { width: 320, ariaLabel: "Bench est. 1RM" });
  assert.equal(count(html, /class="ch-line"/g), 1);
  assert.equal(count(html, /class="ch-area"/g), 1);
  assert.equal(count(html, /class="ch-dot"/g), 5);
  assert.match(html, /<text class="ch-point-text"[^>]*>171<\/text>/, "the newest value, in muted text");
  assert.match(html, /ch-cross/);
  assert.match(html, /<circle class="ch-hot" r="5"/);
  assert.equal(count(html, /class="ch-point-text"/g), 1, "the best point is the newest, so only one label");
  const data = JSON.parse(html.match(/data-chart="([^"]+)"/)[1].replace(/&quot;/g, '"'));
  assert.equal(data.kind, "line"); assert.equal(data.tips.length, 5);
  assert.ok(data.ys[4] < data.ys[0], "higher values are drawn higher (smaller y)");
  const peak = C.line([100, 190, 150].map((y, i) => ({ x: "2026-10-0" + (1 + i * 3), y: y, label: "d" + i, title: "t" + i, valueText: y + " lb" })), { width: 320 });
  assert.equal(count(peak, /class="ch-point-text"/g), 2, "the best point and the newest are both labelled when they are apart");
});

test("a line spaces points by the days between them, and shows only the last marker when there are many", () => {
  const pts = [{ x: "2026-10-01", y: 100 }, { x: "2026-10-02", y: 101 }, { x: "2026-10-31", y: 110 }].map((p) => Object.assign(p, { label: p.x, title: p.x, valueText: p.y + " lb" }));
  const data = JSON.parse(C.line(pts, { width: 320 }).match(/data-chart="([^"]+)"/)[1].replace(/&quot;/g, '"'));
  assert.ok(data.xs[1] - data.xs[0] < (data.xs[2] - data.xs[1]) / 10, "one day apart is much closer than 29 days apart");
  const many = Array.from({ length: 60 }, (_, i) => ({ x: "2026-01-" + String(1 + i % 28).padStart(2, "0"), y: 100 + i, label: "l", title: "t", valueText: "1" }));
  many.forEach((p, i) => { const d = new Date(Date.UTC(2026, 0, 1 + i)); p.x = d.toISOString().slice(0, 10); });
  assert.equal(count(C.line(many, { width: 320 }), /class="ch-dot"/g), 1, "no wall of dots");
});

test("ranked bars: values at the tip, bars at most as wide as the biggest, readable as a list", () => {
  const html = C.rankedBars([{ label: "Chest", value: 24, valueText: "24 sets", note: "+4 vs before" }, { label: "Back", value: 12, valueText: "12 sets" }, { label: "Legs", value: 0.1, valueText: "0.1 sets" }], { ariaLabel: "Sets per muscle" });
  assert.match(html, /<ul class="ch-rows" aria-label="Sets per muscle">/);
  assert.equal(count(html, /<li class="ch-row">/g), 3);
  assert.match(html, /style="width:100%"/);
  assert.match(html, /style="width:50%"/);
  assert.match(html, /style="width:2%"/, "a tiny value still shows a sliver");
  assert.match(html, /<span class="ch-row-note">\+4 vs before<\/span>/);
  assert.match(html, /aria-hidden="true"><span class="ch-row-fill"/, "the bar is decoration: the words carry the number");
  assert.equal(C.rankedBars([], {}).includes("<li"), false);
});

test("the heat colouring: five steps of one hue, zero stays uncoloured, bands are whole set counts", () => {
  assert.equal(C.HEAT_RAMP.length, 5);
  assert.deepEqual(C.heatBands(20).map((b) => [b.from, b.to]), [[1, 4], [5, 8], [9, 12], [13, 16], [17, 20]]);
  assert.deepEqual(C.heatBands(7).map((b) => [b.from, b.to]), [[1, 2], [3, 4], [5, 6], [7, 7]]);
  assert.deepEqual(C.heatBands(1).map((b) => [b.from, b.to]), [[1, 1]]);
  assert.equal(C.heatColor(0, 20), null);
  assert.equal(C.heatColor(1, 20), C.HEAT_RAMP[0]);
  assert.equal(C.heatColor(20, 20), C.HEAT_RAMP[4]);
  assert.equal(C.heatColor(9, 20), C.HEAT_RAMP[2]);
  assert.equal(C.heatColor(2.5, 8), C.HEAT_RAMP[1]);
});

test("everything that came from your data is escaped, in labels, titles, tooltips and the table", () => {
  const evil = '<img src=x onerror=alert(1)> "q" & \'s\'';
  const html = C.columns(items([1, 2], [{ label: evil, title: evil }, {}]), { width: 320, ariaLabel: evil, caption: evil, table: { caption: evil, headers: [evil, "n"], rows: [[evil, "1"]] } });
  assert.equal(html.includes("<img"), false);
  assert.equal(html.includes('onerror=alert(1)>'), false);
  assert.match(html, /&lt;img/);
  assert.equal(C.esc(null), "");
  assert.equal(C.esc(5), "5");
});

test("the table twin lists every number with proper headers", () => {
  const t = C.tableView({ caption: "Workouts per week", headers: ["Week", "Workouts"], rows: [["Oct 26", "3"], ["Nov 2", "1"]] });
  assert.match(t, /<details class="ch-table"><summary>Show the numbers<\/summary>/);
  assert.equal(count(t, /<th scope="col">/g), 2);
  assert.equal(count(t, /<th scope="row">/g), 2);
  assert.equal(count(t, /<td>/g), 2);
  assert.match(t, /<caption class="visually-hidden">Workouts per week<\/caption>/);
});

test("a chart with a caption and a table carries both after the picture", () => {
  const html = C.columns(items([1, 2]), { width: 320, caption: "Lighter columns are part weeks.", table: { caption: "c", headers: ["W", "N"], rows: [["a", "1"]] } });
  assert.ok(html.indexOf("ch-caption") > html.indexOf("</svg>") && html.indexOf("ch-table") > html.indexOf("ch-caption"));
});

test("the wrapper's class never matches a mark's class (a line chart's wrapper once inherited the line's stroke and smeared every label)", () => {
  const pts = [150, 155].map((y, i) => ({ x: "2026-10-0" + (1 + i), y: y, label: "d", title: "t", valueText: y + " lb" }));
  const html = C.line(pts, { width: 320 }) + C.columns(items([1, 2]), { width: 320 });
  const wrappers = [...html.matchAll(/<div class="ch ([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(wrappers, ["ch-kind-line", "ch-kind-columns"]);
  const marks = ["ch-line", "ch-area", "ch-bar", "ch-dot", "ch-hot", "ch-grid", "ch-cross"];
  wrappers.forEach((w) => assert.equal(marks.includes(w), false));
});
