"use strict";

// Keeps the Workout section as it was polished in phase 6: no emoji in its screens, and the pieces that stop a phone from scrolling sideways.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "../..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const emojiLines = (text) => text.split("\n").map((l, i) => ({ n: i + 1, l: l, m: l.match(/\p{Extended_Pictographic}/gu) })).filter((x) => x.m).map((x) => x.n + ": " + x.m.join("") + "  " + x.l.trim().slice(0, 80));

test("no emoji in the Workout screens' code", () => {
  ["js/workout.js", "js/workout-ui.js", "js/routines-ui.js", "js/history-ui.js", "js/progress-ui.js", "js/library-ui.js", "js/insights-ui.js", "js/form-check.js",
    "js/exercises.js", "js/exercise-guides.js", "js/exercise-logic.js", "js/insights-logic.js", "js/formcheck-logic.js", "js/charts.js"].forEach((f) => {
    assert.deepEqual(emojiLines(read(f)), [], f + " has emoji");
  });
});

test("no emoji in the Workout screens' markup (the old Home screen that is no longer reachable is not counted)", () => {
  const html = read("index.html");
  const a = html.indexOf('id="panel-workout"'), b = html.indexOf('id="panel-nutrition"');
  assert.ok(a > 0 && b > a);
  const legacyStart = html.indexOf('<div id="workout-home"'), legacyEnd = html.indexOf('<div id="workout-log"');
  assert.ok(legacyStart > a && legacyEnd > legacyStart, "found the old Home block");
  const seg = html.slice(a, legacyStart) + html.slice(legacyEnd, b);
  assert.deepEqual(emojiLines(seg), []);
});

test("muscle groups no longer carry an icon", () => {
  const had = Object.prototype.hasOwnProperty.call(global, "window");
  const saved = global.window;
  global.window = { JarvisCore: { loadJSON: (k, d) => d, saveJSON() {}, escapeHtml: (s) => s, uid: (p) => p + "_x" } };
  try {
    delete require.cache[require.resolve("../../js/exercises.js")];
    require("../../js/exercises.js");
    const JE = global.window.JarvisExercises;
    JE.MUSCLE_GROUPS.concat(["Nothing"]).forEach((g) => assert.equal(JE.iconForMuscleGroup(g), ""));
  } finally {
    if (had) global.window = saved; else delete global.window;
    delete require.cache[require.resolve("../../js/exercises.js")];
  }
});

test("a card grid column is never wider than the screen, and the classic pill bar wraps instead of scrolling sideways", () => {
  const css = read("style.css");
  assert.match(css, /\.card-grid \{ grid-template-columns: repeat\(auto-fit, minmax\(min\(320px, 100%\), 1fr\)\); \}/);
  assert.match(css, /\.exercise-pill-nav \{ flex-wrap: wrap; overflow: visible; \}/);
});

test("the Progress screen offers a jump to each section", () => {
  const src = read("js/progress-ui.js");
  assert.match(src, /function jumpHtml\(sectionsHtml\)/);
  ["pgConsistency", "pgStrength", "pgVolume", "pgTime", "pgMuscles", "pgRecords"].forEach((id) => assert.ok(src.indexOf('"' + id + '"') !== -1, id));
});
