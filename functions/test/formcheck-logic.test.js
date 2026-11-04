"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const F = require("../../js/formcheck-logic");

const kp = (name, x, y, score) => ({ name: name, x: x, y: y, score: score === undefined ? 0.9 : score });
// A body seen from the left: shoulder, hip, knee, ankle (and arm) with the same confidence on every joint.
function body(score, o) {
  const s = score, hipY = o && o.hipY !== undefined ? o.hipY : 150;
  return [kp("left_shoulder", 100, 50, s), kp("left_elbow", 110, 90, s), kp("left_wrist", 120, 130, s), kp("left_hip", 100, hipY, s), kp("left_knee", 140, 160, s), kp("left_ankle", 140, 250, s),
    kp("right_shoulder", 105, 50, o && o.rightScore !== undefined ? o.rightScore : 0.1), kp("right_hip", 105, hipY, o && o.rightScore !== undefined ? o.rightScore : 0.1), kp("right_knee", 145, 160, 0.1), kp("right_ankle", 145, 250, 0.1)];
}

test("every check has what the screen needs", () => {
  const keys = F.CHECKS.map((c) => c.key);
  assert.equal(new Set(keys).size, 12, "twelve distinct checks");
  F.CHECKS.forEach((c) => {
    assert.ok(c.label && c.tip && c.joints.length >= 2, c.key);
    assert.doesNotMatch(c.label + c.tip, /\p{Extended_Pictographic}/u);
  });
  assert.deepEqual(F.CHECKS.filter((c) => c.video).map((c) => c.key).sort(), ["bicepcurl", "plank", "preachercurl", "row"], "the four that compare frames need a video");
  assert.equal(F.checkFor("squat").label, "Squat");
  assert.equal(F.checkFor("nope"), null);
});

test("the checks match the analyzers in form-check.js", () => {
  const src = fs.readFileSync(path.join(__dirname, "../../js/form-check.js"), "utf8");
  const ctx = { window: {} };
  vm.runInNewContext(src, ctx);
  const analyzers = ["squat", "deadlift", "pushup", "benchpress", "latpulldown", "tricepextension", "preachercurl", "row", "overheadpress", "bicepcurl", "lunge", "plank"];
  assert.deepEqual(F.CHECKS.map((c) => c.key).sort(), analyzers.slice().sort());
  const html = fs.readFileSync(path.join(__dirname, "../../index.html"), "utf8");
  analyzers.forEach((k) => assert.match(html, new RegExp('<option value="' + k + '">'), "the select offers " + k));
});

test("reading quality is the tracker's confidence on the better side, for the joints the check uses", () => {
  const joints = ["shoulder", "hip", "knee", "ankle"];
  assert.deepEqual([F.readingQuality(body(0.9), joints).level, F.readingQuality(body(0.9), joints).score], ["clear", 0.9]);
  assert.equal(F.readingQuality(body(0.5), joints).level, "fair");
  assert.equal(F.readingQuality(body(0.35), joints).level, "low", "found, but not sure");
  assert.equal(F.readingQuality(body(0.1), joints).level, "low");
  assert.equal(F.readingQuality(body(0.9), joints).side, "left", "the clearer side is used");
  const oneJointLost = body(0.9); oneJointLost[5] = kp("left_ankle", 140, 250, 0.1);
  const q = F.readingQuality(oneJointLost, joints);
  assert.deepEqual([q.level, q.missing], ["low", ["ankle"]], "a joint the check needs that was not found makes it low, however clear the rest");
  assert.equal(F.readingQuality(body(0.9), ["shoulder", "elbow", "wrist"]).level, "clear", "only this check's joints count: the unseen right leg doesn't matter");
  assert.equal(F.readingQuality([], joints).level, "low");
  assert.equal(F.readingQuality(null, joints).level, "low");
  const right = [kp("right_shoulder", 1, 1, 0.8), kp("right_hip", 1, 2, 0.8), kp("right_knee", 1, 3, 0.8), kp("right_ankle", 1, 4, 0.8), kp("left_shoulder", 1, 1, 0.2), kp("left_hip", 1, 2, 0.2), kp("left_knee", 1, 3, 0.2), kp("left_ankle", 1, 4, 0.2)];
  assert.equal(F.readingQuality(right, joints).side, "right");
});

test("a clip where most frames were unusable is not called clear", () => {
  const joints = ["shoulder", "hip", "knee", "ankle"];
  assert.equal(F.readingQuality(body(0.9), joints, { confident: 9, total: 10 }).level, "clear");
  assert.equal(F.readingQuality(body(0.9), joints, { confident: 4, total: 10 }).level, "fair");
  assert.equal(F.readingQuality(body(0.9), joints, { confident: 1, total: 10 }).level, "low");
  assert.equal(F.readingQuality(body(0.5), joints, { confident: 10, total: 10 }).level, "fair", "the weaker of the two decides");
  assert.equal(F.readingQuality(body(0.9), joints, { confident: 4, total: 10 }).frameShare, 0.4);
  assert.match(F.qualityLine(F.readingQuality(body(0.9), joints, { confident: 4, total: 10 })), /Only 40% of the frames in the clip gave a usable reading/);
  assert.doesNotMatch(F.qualityLine(F.readingQuality(body(0.9), joints)), /Only/);
});

test("nothing is called good, and a low reading calls nothing typical or worth a look", () => {
  assert.deepEqual(Object.values(F.TAGS), ["Looks typical here", "For context", "Worth a closer look"]);
  assert.doesNotMatch(Object.values(F.TAGS).join(" ") + F.DISCLAIMER + Object.values(F.LEVEL_LABEL).join(" "), /\bgood\b|\bperfect\b|\bcorrect\b|\bsafe form\b/i);
  assert.equal(F.tagFor("good"), "Looks typical here");
  assert.equal(F.tagFor("warn"), "Worth a closer look");
  assert.equal(F.tagFor("whatever"), "For context");
  const results = [{ status: "good", label: "Depth", detail: "d" }, { status: "warn", label: "Knees", detail: "k" }, { status: "info", label: "Angle", detail: "a" }];
  assert.deepEqual(F.adjustForQuality(results, "low").map((r) => r.status), ["info", "info", "info"]);
  assert.deepEqual(F.adjustForQuality(results, "fair").map((r) => r.status), ["good", "warn", "info"]);
  assert.deepEqual(F.adjustForQuality(results, "clear").map((r) => r.status), ["good", "warn", "info"]);
  assert.equal(results[0].status, "good", "the original is not changed");
  assert.equal(F.summaryLine(results), "1 worth a closer look · 1 looked typical · 1 for context");
  assert.equal(F.summaryLine([{ status: "info" }, { status: "info" }]), "2 for context");
  assert.equal(F.summaryLine([]), "");
});

test("the disclaimer says what the check cannot do", () => {
  assert.match(F.DISCLAIMER, /one frame/);
  assert.match(F.DISCLAIMER, /can be wrong/);
  assert.match(F.DISCLAIMER, /don't tell you whether your technique is safe/);
  assert.match(F.DISCLAIMER, /no substitute for a qualified coach/);
  assert.match(F.DISCLAIMER, /If something hurts, stop/);
});

test("the joints to ring on the picture, and how a joint is drawn", () => {
  assert.deepEqual(F.ringedJoints("squat", body(0.9)), ["left_shoulder", "left_hip", "left_knee", "left_ankle"]);
  assert.deepEqual(F.ringedJoints("bicepcurl", body(0.9)), ["left_shoulder", "left_elbow", "left_wrist"]);
  assert.deepEqual(F.ringedJoints("nope", body(0.9)), []);
  assert.equal(F.jointState(0.9), "clear");
  assert.equal(F.jointState(0.5), "clear");
  assert.equal(F.jointState(0.4), "unsure");
  assert.equal(F.jointState(0.3), "unsure");
  assert.equal(F.jointState(0.29), "missing");
  assert.equal(F.jointState(undefined), "missing");
});

test("the chosen file is described in plain words", () => {
  assert.equal(F.fileText({ type: "video/quicktime", name: "squat.mov", size: 4400000 }), "Video: squat.mov (4.2 MB)");
  assert.equal(F.fileText({ type: "image/jpeg", name: "IMG_1.jpg", size: 200000 }), "Photo: IMG_1.jpg (195 KB)");
  assert.equal(F.fileText({ type: "image/jpeg", name: "", size: 0 }), "Photo: chosen file (1 KB)");
  assert.equal(F.fileText(null), "");
});

/* The analyzers themselves had no tests. These pin what they say today on synthetic joints, so the wording work can't change them by accident. */
function analyzers() {
  const src = fs.readFileSync(path.join(__dirname, "../../js/form-check.js"), "utf8");
  const ctx = { window: {} };
  vm.runInNewContext(src, ctx);
  return ctx.window.JarvisFormCheck._internal;
}

test("squat: depth is read from the hip against the knee, and a shaky reading says so instead of guessing", () => {
  const A = analyzers();
  const deep = A.analyzeSquat(body(0.9, { hipY: 175 }));
  assert.equal(deep[0].status, "good");
  assert.match(deep[0].label, /at or below parallel/);
  const shallow = A.analyzeSquat(body(0.9, { hipY: 100 }));
  assert.equal(shallow[0].status, "warn");
  assert.match(shallow[0].label, /above parallel/);
  const lost = A.analyzeSquat(body(0.1));
  assert.equal(lost.length, 1);
  assert.equal(lost[0].status, "warn");
  assert.match(lost[0].label, /Couldn't get a clear/);
  assert.ok(A.analyzeSquat(body(0.9)).every((r) => ["good", "info", "warn"].indexOf(r.status) !== -1));
});

test("choosing the moment in a video: the deepest squat frame wins, and frames with no clear reading are skipped", () => {
  const A = analyzers();
  const samples = [{ time: 0.1, keypoints: body(0.9, { hipY: 120 }) }, { time: 0.4, keypoints: body(0.9, { hipY: 178 }) }, { time: 0.7, keypoints: body(0.1, { hipY: 200 }) }, { time: 1.0, keypoints: body(0.9, { hipY: 140 }) }];
  assert.equal(A.pickBestFrame(samples, "squat").time, 0.4);
  assert.equal(A.pickBestFrame([{ time: 0, keypoints: body(0.1) }], "squat"), null);
});

test("plank: a straight body reads as in line, a sagging hip does not", () => {
  const A = analyzers();
  const straight = [kp("left_shoulder", 50, 100), kp("left_hip", 150, 100), kp("left_ankle", 250, 100), kp("right_shoulder", 50, 100, 0.1), kp("right_hip", 150, 100, 0.1), kp("right_ankle", 250, 100, 0.1)];
  const sag = [kp("left_shoulder", 50, 100), kp("left_hip", 150, 140), kp("left_ankle", 250, 100), kp("right_shoulder", 50, 100, 0.1), kp("right_hip", 150, 140, 0.1), kp("right_ankle", 250, 100, 0.1)];
  assert.ok(Math.abs(A.plankHipDeviation({ x: 50, y: 100 }, { x: 150, y: 100 }, { x: 250, y: 100 })) < 1e-9);
  assert.ok(Math.abs(A.plankHipDeviation({ x: 50, y: 100 }, { x: 150, y: 140 }, { x: 250, y: 100 })) > 0.1);
  assert.ok(A.analyzePlank(straight).length >= 1 && A.analyzePlank(sag).length >= 1);
});
