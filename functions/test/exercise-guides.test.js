"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../../js/exercise-guides");

// The built-in list lives in a browser file that needs window.JarvisCore; give it a stand-in just long enough to read the list.
function builtIns() {
  const had = Object.prototype.hasOwnProperty.call(global, "window");
  const saved = global.window;
  global.window = { JarvisCore: { loadJSON: (k, d) => d, saveJSON() {}, escapeHtml: (s) => s, uid: (p) => p + "_x" } };
  try {
    delete require.cache[require.resolve("../../js/exercises.js")];
    require("../../js/exercises.js");
    return global.window.JarvisExercises.getExercises().slice();
  } finally {
    if (had) global.window = saved; else delete global.window;
    delete require.cache[require.resolve("../../js/exercises.js")];
  }
}

test("every built-in exercise has a guide, and every guide belongs to a built-in exercise", () => {
  const list = builtIns();
  assert.ok(list.length >= 180, "the library has " + list.length + " exercises");
  const missing = list.filter((e) => !G.get(e.id)).map((e) => e.id);
  assert.deepEqual(missing, [], "exercises with no guide");
  const known = new Set(list.map((e) => e.id));
  assert.deepEqual(G.ids().filter((id) => !known.has(id)), [], "guides for ids that are not in the library");
});

test("a guide is three plain sentences: set up, move, watch for", () => {
  G.ids().forEach((id) => {
    const g = G.get(id);
    ["setup", "move", "watch"].forEach((part) => {
      const t = g[part];
      assert.equal(typeof t, "string", id + " " + part);
      assert.ok(t.length >= 30 && t.length <= 300, id + " " + part + " is " + t.length + " characters");
      assert.match(t, /[.]$/, id + " " + part + " ends with a full stop");
      assert.doesNotMatch(t, /\p{Extended_Pictographic}/u, id + " " + part + " has an emoji");
      assert.doesNotMatch(t, /  |\t|\n/, id + " " + part + " has stray whitespace");
    });
  });
  assert.equal(G.get("not-an-exercise"), null);
});

test("guides never promise safety, results or medical outcomes", () => {
  const all = G.ids().map((id) => Object.values(G.get(id)).join(" ")).join("\n");
  assert.doesNotMatch(all, /\b(guarantee|guaranteed|safe technique|cure|heal|treat|diagnos|prevent injur|rehab|burn fat|lose weight|build muscle fast)\b/i);
});

test("the technical Olympic lifts say they are best learned with a coach", () => {
  ["power-clean", "hang-clean", "clean-and-jerk", "snatch"].forEach((id) => {
    const g = G.get(id);
    assert.match(g.setup + " " + g.watch, /coach/i, id);
  });
});
