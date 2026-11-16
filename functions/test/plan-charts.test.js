"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../../js/plan-charts");

const money = (v) => "$" + Math.round(v).toLocaleString("en-US");
const base = { title: "Revenue and spending", summary: "Revenue and spending by month", labels: ["Sep", "Oct", "Nov"], format: money,
  series: [{ name: "Revenue", color: "#3987e5", values: [1000, 5400, 3100] }, { name: "Spending", color: "#d95926", values: [null, 1300, 900] }] };

test("axis: a clean top and ticks starting at zero", () => {
  assert.deepEqual(C.niceScale(5400).ticks, [0, 2000, 4000, 6000]);
  assert.deepEqual(C.niceScale(100).ticks, [0, 25, 50, 75, 100]);
  assert.equal(C.niceScale(0).max, 1, "nothing to scale: a harmless 0 to 1 axis");
  assert.equal(C.niceScale(NaN).max, 1);
  const s = C.niceScale(8500);
  assert.ok(s.max >= 8500 && s.ticks[0] === 0 && s.ticks.length <= 6, JSON.stringify(s));
});

test("bars: a column for each known value, none for an unknown one, never NaN", () => {
  const html = C.bars(base);
  assert.ok(!/NaN|undefined|Infinity/.test(html), "no NaN in the drawing");
  assert.equal((html.match(/class="viz-bar"/g) || []).length, 5, "5 known values: 3 revenue + 2 spending; September's unknown spending draws nothing");
  assert.equal((html.match(/class="viz-col"/g) || []).length, 3, "one hover/focus target per month");
  assert.ok(html.includes('class="viz-legend"'), "two series: a legend");
  assert.ok(html.includes("Show the numbers"), "and a table view");
  assert.ok(/not tracked/.test(html), "the unknown value is called not tracked, never $0");
});

test("bars: heights are in proportion, columns stop at 24 px, the top is rounded and the base square", () => {
  const html = C.bars({ title: "One", labels: ["a", "b"], series: [{ name: "Only", color: "#3987e5", values: [50, 100] }], format: String, height: 180 });
  assert.ok(!html.includes("viz-legend"), "a single series is named by its title, no legend box");
  const boxes = Array.from(html.matchAll(/class="viz-bar" d="([^"]+)"/g)).map((m) => {
    const nums = m[1].match(/-?\d+(\.\d+)?/g).map(Number), xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
    return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  });
  assert.equal(boxes.length, 2);
  assert.ok(boxes.every((b) => b.w <= 24.1), "no column is wider than 24 px: " + JSON.stringify(boxes));
  assert.ok(Math.abs(boxes[1].h / boxes[0].h - 2) < 0.02, "100 is twice as tall as 50: " + JSON.stringify(boxes));
  assert.equal(C.colPath(10, 20, 24, 60), "M10,80 L10,24 Q10,20 14,20 L30,20 Q34,20 34,24 L34,80 Z", "4 px rounded at the top, square at the baseline");
  assert.equal(C.colPath(10, 20, 24, 0), "", "a zero-height column draws nothing");
  assert.equal(C.colPath(10, 78, 24, 2), "M10,80 L10,80 Q10,78 12,78 L32,78 Q34,78 34,80 L34,80 Z", "a very short column shrinks its corner instead of overshooting");
});

test("bars: nothing known means an honest empty state, not a flat chart", () => {
  const html = C.bars({ title: "Spending", labels: ["a", "b"], series: [{ name: "Spending", color: "#d95926", values: [null, null] }], emptyText: "No spending entered yet." });
  assert.ok(html.includes("No spending entered yet.") && !html.includes("<svg"), html);
});

test("line: an unknown value breaks the line; a lone point is still drawn; the end has a dot", () => {
  const html = C.line({ title: "Completion", labels: ["w1", "w2", "w3", "w4", "w5"], format: (v) => v + "%", series: [{ name: "Done", color: "#3987e5", values: [40, 60, null, 80, null] }] });
  assert.ok(!/NaN|undefined/.test(html));
  assert.equal((html.match(/class="viz-line"/g) || []).length, 1, "w1-w2 is one line");
  assert.equal((html.match(/class="viz-dot"/g) || []).length, 1, "w4 stands alone: it is drawn as a dot, not dropped");
  assert.equal((html.match(/class="viz-end"/g) || []).length, 1, "the last known value carries the end dot");
  assert.equal((html.match(/class="viz-col"/g) || []).length, 5);
  assert.ok(/w3: Done not tracked/.test(html), "the unknown week says so for screen readers");
});

test("line: a reference line is labelled, and the axis reaches it", () => {
  const html = C.line({ title: "Revenue", labels: ["a", "b"], format: money, reference: { value: 20000, label: "Target" }, series: [{ name: "Revenue", color: "#3987e5", values: [5000, 8000] }] });
  assert.ok(html.includes('class="viz-ref"') && html.includes("Target $20,000"), "labelled");
  assert.ok(html.includes("$20,000</text>") || html.includes("$20,000"), "the axis goes up to the target");
});

test("labels from your own data are escaped", () => {
  const html = C.bars({ title: "<img src=x onerror=alert(1)>", labels: ['"><script>x</script>', "b"], series: [{ name: "<b>s</b>", color: "#3987e5", values: [1, 2] }, { name: "t", color: "#d95926", values: [1, 2] }] });
  assert.ok(!/<script>|<img |<b>/.test(html), "no raw markup from labels");
});
