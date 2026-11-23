"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const MM = require("../../js/musclemap-art");

// The 17 muscles the workouts are counted for live in exercises.js (a browser file), so it is loaded here with a stub for the one thing it needs.
function fineMuscles() {
  const had = { window: global.window, core: global.JarvisCore, je: global.JarvisExercises };
  global.window = global; global.JarvisCore = { loadJSON: (k, d) => d, saveJSON: () => true };
  try { delete require.cache[require.resolve("../../js/exercises.js")]; require("../../js/exercises.js"); return global.JarvisExercises.FINE_MUSCLES.slice(); }
  finally { global.window = had.window; global.JarvisCore = had.core; global.JarvisExercises = had.je; if (had.window === undefined) delete global.window; if (had.core === undefined) delete global.JarvisCore; if (had.je === undefined) delete global.JarvisExercises; }
}
const FINE = fineMuscles();

function nums(d) { return (d.match(/-?\d*\.?\d+/g) || []).map(Number); }

test("every muscle JARVIS counts sets for has a region on the drawing, and the drawing names no muscle JARVIS doesn't have", () => {
  assert.equal(FINE.length, 17);
  assert.deepEqual(MM.TRACKED.slice().sort(), FINE.slice().sort());
  assert.deepEqual(MM.OTHERS.slice().sort(), ["Hip (tensor fasciae latae)", "Inner thigh", "Lower abdomen and hips", "Neck", "Sartorius"]);
});

test("each figure is made of separate, closed, well-formed regions inside its box", () => {
  const seen = {};
  MM.VIEWS.forEach((view) => {
    const list = MM.regions(view);
    assert.ok(list.length > 70, view + " has many regions: " + list.length);
    list.forEach((r) => {
      assert.ok(!seen[r.id], "ids are unique: " + r.id); seen[r.id] = true;
      assert.ok(["m", "o", "s"].includes(r.kind), r.id + " has a known kind");
      assert.match(r.d, /^M[-\d.\sMLCZ]+Z$/, r.id + " uses only M, L, C and Z");
      assert.ok(!/[^MLCZ\d.\s-]/.test(r.d));
      const v = nums(r.d);
      assert.ok(v.length >= 8 && v.length % 2 === 0, r.id + " has points");
      v.forEach((x, i) => { const max = i % 2 === 0 ? MM.WIDTH : MM.HEIGHT; assert.ok(x >= -1 && x <= max + 1, r.id + " stays in the box: " + x); });
      if (r.kind === "m") assert.ok(FINE.includes(r.muscle), r.id + " is one of the 17 muscles: " + r.muscle);
      if (r.kind === "o") assert.ok(r.name, r.id + " has a name");
    });
  });
});

test("the right half is the left half mirrored, so the figures are exactly symmetrical", () => {
  MM.VIEWS.forEach((view) => {
    const list = MM.regions(view), byId = {};
    list.forEach((r) => { byId[r.id] = r; });
    list.filter((r) => r.side === "l").forEach((l) => {
      const r = byId[l.id + "r"];
      assert.ok(r, l.id + " has a right-hand twin");
      assert.equal(r.kind, l.kind); assert.equal(r.muscle, l.muscle); assert.equal(r.name, l.name);
      const a = nums(l.d), b = nums(r.d);
      assert.equal(a.length, b.length);
      a.forEach((x, i) => { if (i % 2 === 0) assert.ok(Math.abs(b[i] - (MM.WIDTH - x)) < 0.11, l.id + " x mirrors"); else assert.equal(b[i], x, l.id + " y is the same"); });
      assert.ok(Math.max.apply(null, a.filter((_, i) => i % 2 === 0)) <= MM.WIDTH / 2 + 2, l.id + " is on the left half");
    });
    list.filter((r) => r.side === "c").forEach((c) => {
      const xs = nums(c.d).filter((_, i) => i % 2 === 0);
      assert.ok(Math.abs((Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2 - MM.WIDTH / 2) < 3, c.id + " is centred");
    });
    assert.ok(list.some((r) => r.side === "c"), view + " has centre pieces");
  });
  assert.equal(MM.mirrorPath(MM.mirrorPath("M10 20L30.5 40C1 2 3 4 5 6Z")), "M10 20L30.5 40C1 2 3 4 5 6Z", "mirroring twice gives back the path");
});

test("drawing: both figures side by side, a muscle coloured from the colours given, dark when it has none", () => {
  const s = MM.svg({ colors: { Chest: "#c3d6ff", Quads: "#5b8def" } });
  assert.match(s, /^<svg class="mm-svg"/);
  assert.equal((s.match(/class="mm-fig"/g) || []).length, 2, "front and back");
  assert.match(s, new RegExp('viewBox="0 0 ' + (2 * MM.WIDTH + MM.GAP) + " " + MM.HEIGHT + '"'));
  const chest = s.match(/<use [^>]*data-muscle="Chest"[^>]*>/g);
  assert.ok(chest.length >= 2, "the pecs, each its own element");
  chest.forEach((u) => { assert.match(u, /style="fill:#c3d6ff"/); assert.doesNotMatch(u, /is-empty/); });
  const calves = s.match(/<use [^>]*data-muscle="Calves"[^>]*>/g);
  calves.forEach((u) => { assert.match(u, /is-empty/); assert.doesNotMatch(u, /style=/); });
  assert.doesNotMatch(s, /has-sel/);
  assert.equal(MM.svg({ views: ["front"] }).match(/class="mm-fig"/g).length, 1);
  assert.match(MM.svg({ views: ["back"] }), /data-view="back"/);
  assert.equal(MM.svg({ views: ["sideways"] }).match(/class="mm-fig"/g).length, 2, "an unknown view falls back to both");
});

test("drawing: a selected muscle is outlined everywhere it appears and the rest are dimmed; structures are not tappable muscles", () => {
  const s = MM.svg({ selected: "Triceps" });
  assert.match(s, /class="mm-svg has-sel"/);
  const all = s.match(/<use [^>]*data-region="[^"]*"[^>]*>/g);
  const tri = all.filter((u) => /data-muscle="Triceps"/.test(u));
  assert.ok(tri.length >= 8, "triceps on both sides of both figures: " + tri.length);
  tri.forEach((u) => assert.match(u, /is-sel/));
  all.filter((u) => !/data-muscle="Triceps"/.test(u)).forEach((u) => assert.match(u, /is-dim/));
  const other = MM.svg({ other: "Neck" });
  assert.equal((other.match(/is-sel/g) || []).length, 5, "the neck pieces: two on each side and one in the middle");
  assert.match(MM.svg({ focus: "Abs" }), /is-focus/);
  assert.doesNotMatch(MM.svg({}), /data-muscle="[^"]*"[^>]*mm-s/);
  assert.ok(/class="mm-r mm-s"/.test(s), "head, hands and feet are drawn as structures");
  assert.doesNotMatch(s.match(/<use [^>]*class="mm-r mm-s"[^>]*>/)[0], /data-muscle|data-other/);
});

test("drawing: two maps on one page do not share ids, and text is escaped", () => {
  const a = MM.svg({ idPrefix: "one" }), b = MM.svg({ idPrefix: "two" });
  const ids = (s) => (s.match(/ id="[^"]+"/g) || []);
  assert.equal(ids(a).filter((i) => ids(b).includes(i)).length, 0);
  const odd = MM.svg({ idPrefix: 'x"y', label: 'A <b>"map"</b>' });
  assert.doesNotMatch(odd, /<b>/); assert.match(odd, /aria-label="A &lt;b>&quot;map&quot;&lt;\/b>"/);
  assert.deepEqual(MM.partsOf("Chest"), ["Pectoralis major"]);
  assert.deepEqual(MM.partsOf("Quads").sort(), ["Rectus femoris", "Vastus lateralis", "Vastus medialis"]);
  assert.deepEqual(MM.partsOf("Forearms"), [], "no anatomical name is claimed where the drawing isn't sure");
});
