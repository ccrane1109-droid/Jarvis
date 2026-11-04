"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../../js/exercise-logic");

function deepFreeze(o) { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.keys(o).forEach((k) => deepFreeze(o[k])); } return o; }
const ex = (id, name, muscleGroup, equipment, o) => Object.assign({ id: id, name: name, muscleGroup: muscleGroup, equipment: equipment }, o || {});
const LIB = deepFreeze([
  ex("bb-bench", "Barbell Bench Press", "Chest", "Free Weight"),
  ex("db-bench", "Dumbbell Bench Press", "Chest", "Free Weight"),
  ex("inc-bb", "Incline Barbell Bench Press", "Chest", "Free Weight"),
  ex("pecdeck", "Pec Deck / Chest Fly Machine", "Chest", "Machine"),
  ex("pushup", "Push-Up", "Chest", "Bodyweight"),
  ex("pulldown", "Lat Pulldown", "Back", "Cable"),
  ex("tbar", "T-Bar Row", "Back", "Machine"),
  ex("ez", "EZ-Bar Curl", "Biceps", "Free Weight"),
  ex("bbcurl", "Barbell Curl", "Biceps", "Free Weight"),
  ex("rdl", "Romanian Deadlift", "Hamstrings", "Free Weight"),
  ex("squat", "Barbell Back Squat", "Quadriceps", "Free Weight"),
  ex("rope", "Cable Rope Hammer Curl", "Biceps", "Cable"),
  ex("mine", "Meadows Row", "Back", "Free Weight", { custom: true })
]);

test("names are read the same way however they are typed", () => {
  assert.deepEqual(E.tokens("DB Bench Press"), ["dumbbell", "bench", "press"]);
  assert.deepEqual(E.tokens("Push-Ups"), ["pushup"]);
  assert.deepEqual(E.tokens("Lat Pull Down"), E.tokens("Lat Pulldown"));
  assert.deepEqual(E.tokens("EZ Bar Curl"), E.tokens("EZ-Bar Curl"));
  assert.deepEqual(E.tokens("RDL"), ["romanian", "deadlift"]);
  assert.equal(E.parts("Barbell Bench Press").core, "bench press");
  assert.equal(E.parts("Barbell Bench Press").equip, "barbell");
  assert.equal(E.parts("Seated Cable Row").sorted, E.parts("Cable Seated Row").sorted, "word order does not matter");
});

test("an exact repeat is caught however it is written", () => {
  ["barbell bench press", "BARBELL  BENCH-PRESS", "Barbell Bench Presses", "Bench Press Barbell", "Barbell Bench Press."].forEach((n) => {
    const r = E.findSimilar(n, "Free Weight", LIB);
    assert.equal(r.exact && r.exact.id, "bb-bench", n);
    assert.deepEqual(r.similar, [], "an exact repeat has nothing else to suggest");
  });
  assert.equal(E.findSimilar("Pushup", "Bodyweight", LIB).exact.id, "pushup");
  assert.equal(E.findSimilar("push up", "Bodyweight", LIB).exact.id, "pushup");
  assert.equal(E.findSimilar("Lat Pull-Down", "Cable", LIB).exact.id, "pulldown");
  assert.equal(E.findSimilar("T Bar Row", "Machine", LIB).exact.id, "tbar");
});

test("the same lift written another way is flagged, a different lift is not", () => {
  const r = E.findSimilar("Bench Press", "Free Weight", LIB);
  assert.equal(r.exact, null);
  assert.deepEqual(r.similar.map((s) => s.exercise.id).sort(), ["bb-bench", "db-bench"], "a plain Bench Press could be the barbell or the dumbbell one, so both are mentioned");
  assert.equal(E.sameLift({ name: "Dumbbell Bench Press" }, { name: "Barbell Bench Press" }), false, "but those two are different lifts");
  assert.match(r.similar[0].reason, /same exercise written differently/);
  assert.equal(E.findSimilar("DB Bench Press", "Free Weight", LIB).exact.id, "db-bench", "an abbreviation is the same exercise");
  assert.deepEqual(E.findSimilar("Incline Bench Press", "Free Weight", LIB).similar.map((s) => s.exercise.id), ["inc-bb"], "incline is its own lift, but it is the incline barbell one written short");
  assert.deepEqual(E.findSimilar("Dumbbell Curl", "Free Weight", LIB).similar.map((s) => s.exercise.id), [], "dumbbell curl is not the barbell or EZ curl");
  assert.deepEqual(E.findSimilar("Bench Press", "Machine", LIB).similar, [], "a machine bench press is not the free-weight one");
  assert.deepEqual(E.findSimilar("Hammer Curl", "Cable", LIB).similar, [], "a different name");
});

test("a one-letter typo is flagged", () => {
  const r = E.findSimilar("Barbel Bench Press", "Free Weight", LIB);
  assert.equal(r.exact, null);
  assert.equal(r.similar[0].exercise.id, "bb-bench");
  assert.match(r.similar[0].reason, /one letter away/);
  assert.deepEqual(E.findSimilar("Pushop", "Bodyweight", LIB), { exact: null, similar: [] }, "names under 8 letters are not matched on typos");
  assert.deepEqual(E.findSimilar("Curl", "Free Weight", LIB).similar.map((s) => s.exercise.id).sort(), ["bbcurl", "ez"], "a bare Curl could be either free-weight curl, not the cable one");
  assert.deepEqual(E.findSimilar("", "Free Weight", LIB), { exact: null, similar: [] });
  assert.deepEqual(E.findSimilar("Zottman Curl", "Free Weight", LIB), { exact: null, similar: [] });
});

test("sameLift needs the same core name and compatible equipment", () => {
  assert.equal(E.sameLift({ name: "Bench Press", equipment: "Free Weight" }, { name: "Barbell Bench Press", equipment: "Free Weight" }), true);
  assert.equal(E.sameLift({ name: "Dumbbell Bench Press" }, { name: "Barbell Bench Press" }), false);
  assert.equal(E.sameLift({ name: "Bench Press", equipment: "Machine" }, { name: "Barbell Bench Press", equipment: "Free Weight" }), false);
  assert.equal(E.sameLift({ name: "Incline Bench Press" }, { name: "Bench Press" }), false);
});

test("search: every word has to match the name, the muscle group or the equipment", () => {
  const names = (f) => E.filterExercises(LIB, f).map((e) => e.id);
  assert.deepEqual(names({ query: "bench" }), ["bb-bench", "db-bench", "inc-bb"], "A to Z by name");
  assert.deepEqual(names({ query: "bench press" }).sort(), ["bb-bench", "db-bench", "inc-bb"].sort());
  assert.deepEqual(names({ query: "db bench" }), ["db-bench"], "abbreviations work in search");
  assert.deepEqual(names({ query: "chest cable" }), [], "chest AND cable: nothing in this list");
  assert.deepEqual(names({ query: "machine" }).sort(), ["pecdeck", "tbar"], "equipment words match");
  assert.deepEqual(names({ query: "pecs" }).sort(), names({ muscle: "Chest" }).sort(), "pecs means chest");
  assert.deepEqual(names({ query: "PUSH UP" }), ["pushup"]);
  assert.deepEqual(names({ query: "pushups" }), ["pushup"]);
  assert.deepEqual(names({ query: "zzz" }), []);
  assert.equal(names({}).length, LIB.length, "no filter shows everything");
});

test("filters combine, favorites and custom narrow, and results are ordered best first then A to Z", () => {
  const names = (f) => E.filterExercises(LIB, f).map((e) => e.id);
  assert.deepEqual(names({ muscle: "Biceps" }), ["bbcurl", "rope", "ez"], "A to Z");
  assert.deepEqual(names({ muscle: "Biceps", equipment: "Cable" }), ["rope"]);
  assert.deepEqual(names({ equipment: "Bodyweight" }), ["pushup"]);
  assert.deepEqual(names({ favoritesOnly: true, favoriteIds: ["rdl", "squat"] }), ["squat", "rdl"], "Barbell Back Squat, then Romanian Deadlift");
  assert.deepEqual(names({ customOnly: true }), ["mine"]);
  const q = E.filterExercises(LIB, { query: "curl" }).map((e) => e.id);
  assert.equal(q[0], "bbcurl", "names starting with the word come before names that only contain it");
  assert.deepEqual(q, ["bbcurl", "rope", "ez"], "then A to Z: Barbell Curl, Cable Rope Hammer Curl, EZ-Bar Curl");
});

test("a name that starts with what you typed comes first", () => {
  const list = [ex("a", "Hammer Curl", "Biceps", "Free Weight"), ex("b", "Curl Variation", "Biceps", "Free Weight"), ex("c", "Alternating Curl", "Biceps", "Free Weight")];
  assert.deepEqual(E.filterExercises(list, { query: "curl" }).map((e) => e.id), ["b", "c", "a"], "starts-with first; then names that only contain it, A to Z");
});

test("grouping and counts", () => {
  const g = E.groupBy(LIB, "muscleGroup", ["Chest", "Back", "Biceps"]);
  assert.deepEqual(g.map((x) => [x.group, x.items.length]), [["Chest", 5], ["Back", 3], ["Biceps", 3], ["Hamstrings", 1], ["Quadriceps", 1]]);
  assert.deepEqual(E.counts(LIB, "equipment"), { "Free Weight": 8, Machine: 2, Bodyweight: 1, Cable: 2 });
});

test("a custom exercise needs a clean name, a muscle group and equipment", () => {
  const groups = ["Chest", "Back"], equip = ["Free Weight", "Cable"];
  assert.deepEqual(E.sanitizeCustom({ name: "  Landmine   Press ", muscleGroup: "Chest", equipment: "Free Weight" }, groups, equip), { ok: true, value: { name: "Landmine Press", muscleGroup: "Chest", equipment: "Free Weight" } });
  assert.equal(E.sanitizeCustom({ name: "", muscleGroup: "Chest", equipment: "Cable" }, groups, equip).error, "Give it a name.");
  assert.match(E.sanitizeCustom({ name: "x".repeat(61), muscleGroup: "Chest", equipment: "Cable" }, groups, equip).error, /60 characters/);
  assert.match(E.sanitizeCustom({ name: "!!!", muscleGroup: "Chest", equipment: "Cable" }, groups, equip).error, /letters or numbers/);
  assert.match(E.sanitizeCustom({ name: "Row", muscleGroup: "Legs", equipment: "Cable" }, groups, equip).error, /muscle group/);
  assert.match(E.sanitizeCustom({ name: "Row", muscleGroup: "Back", equipment: "Jetpack" }, groups, equip).error, /equipment/);
  assert.equal(E.sanitizeCustom(null, groups, equip).ok, false);
});

test("where an exercise is used decides whether it may be deleted", () => {
  const workouts = deepFreeze([
    { id: "w1", schema: 2, exercises: [{ exerciseId: "mine", sets: [] }, { exerciseId: "rdl", sets: [] }] },
    { id: "w2", schema: 2, exercises: [{ exerciseId: "mine", sets: [] }] },
    { id: "old", name: "Chest day", category: "Strength", date: "2026-01-01" }
  ]);
  const routines = deepFreeze([{ id: "r1", exercises: [{ exerciseId: "mine" }] }, { id: "r2", archivedAt: 5, exercises: [{ exerciseId: "mine" }, { exerciseId: "rdl" }] }, { id: "r3", exercises: [] }]);
  const draft = deepFreeze({ exercises: [{ exerciseId: "mine" }] });
  const u = E.usage("mine", { workouts: workouts, routines: routines, draft: draft });
  assert.deepEqual(u, { sessions: 2, routines: 2, inDraft: true, total: 5 });
  assert.equal(E.usageText(u), "2 saved workouts, 2 routines and the workout you are doing now");
  assert.deepEqual(E.usage("nothing", { workouts: workouts, routines: routines, draft: draft }), { sessions: 0, routines: 0, inDraft: false, total: 0 });
  assert.equal(E.usageText({ sessions: 1, routines: 0, inDraft: false }), "1 saved workout");
  assert.deepEqual(E.usage("mine", {}), { sessions: 0, routines: 0, inDraft: false, total: 0 });
});

test("a demo link has to be a full https address, and a search link is built from the name", () => {
  assert.equal(E.validVideoUrl("https://www.youtube.com/watch?v=abc123"), "https://www.youtube.com/watch?v=abc123");
  assert.equal(E.validVideoUrl("  https://youtu.be/abc  "), "https://youtu.be/abc");
  ["http://example.com/a", "javascript:alert(1)", "data:text/html,hi", "ftp://x.com/a", "youtube.com/watch", "https://localhost/x", "https://user:pw@example.com/x", "https://exa mple.com", "", null, undefined, "https://" + "a".repeat(300) + ".com"].forEach((u) => assert.equal(E.validVideoUrl(u), null, String(u)));
  assert.equal(E.demoSearchUrl("Barbell Bench Press"), "https://www.youtube.com/results?search_query=Barbell%20Bench%20Press%20exercise%20how%20to");
  assert.equal(E.demoSearchUrl("A&B <x>"), "https://www.youtube.com/results?search_query=A%26B%20%3Cx%3E%20exercise%20how%20to");
  assert.equal(E.linkHost("https://www.youtube.com/watch?v=1"), "youtube.com");
});

test("your note and link per exercise: saved, cleared, validated, never mutating", () => {
  const empty = deepFreeze({});
  const a = E.setNote(empty, "bb-bench", "  seat at 4, grip on the ring ", 100);
  assert.deepEqual(a.extras, { "bb-bench": { note: "seat at 4, grip on the ring", updatedAt: 100 } });
  const b = E.setVideo(a.extras, "bb-bench", "https://youtu.be/xyz", 200);
  assert.deepEqual(b.extras["bb-bench"], { note: "seat at 4, grip on the ring", video: "https://youtu.be/xyz", updatedAt: 200 });
  const bad = E.setVideo(b.extras, "bb-bench", "not a link", 300);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /starts with https/);
  assert.deepEqual(bad.extras, b.extras, "a bad link changes nothing");
  const c = E.setNote(b.extras, "bb-bench", "", 400);
  assert.deepEqual(c.extras["bb-bench"], { video: "https://youtu.be/xyz", updatedAt: 400 }, "clearing the note keeps the link");
  const d = E.setVideo(c.extras, "bb-bench", "", 500);
  assert.deepEqual(d.extras, {}, "clearing both removes the entry");
  assert.equal(E.setNote(empty, "x", "y".repeat(501)).ok, false);
  assert.deepEqual(empty, {});
  assert.deepEqual(E.sanitizeExtras({ a: { note: "ok" }, b: { note: "" }, c: "nope", d: { video: "http://insecure.com/x" }, e: { video: "https://ok.example.com/v", updatedAt: "x" } }), { a: { note: "ok" }, e: { video: "https://ok.example.com/v" } });
  assert.deepEqual(E.sanitizeExtras(null), {});
  assert.deepEqual(E.sanitizeExtras([1, 2]), {});
});

test("Form Check links exist only for the exercises it has a check for", () => {
  assert.equal(E.formCheckKey("bench-press-barbell"), "benchpress");
  assert.equal(E.formCheckKey("back-squat-barbell"), "squat");
  assert.equal(E.formCheckKey("leg-extension"), null);
});
