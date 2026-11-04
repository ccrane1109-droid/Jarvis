/* ==========================================================================
   JARVIS — Form Check: the wording and the honesty rules (pure functions, no page access, so
   they can be tested outside the browser).

   Form Check estimates where your joints are in one photo, or in a few frames of a short video, using
   a body-tracking model that runs on your phone, then applies a few rough geometric rules. It can be
   wrong, and it cannot tell you that your technique is safe or replace a qualified coach. So:

     - Nothing is called "good". A reading is "Looks typical here", "For context" or "Worth a closer look".
     - Every result says how sure the tracker was (Clear, Fair or Low). On a Low reading nothing is
       called typical or worth a look: everything is shown as context, with a note to try again.
     - The joints a check used are named, so the picture can show them.

   Reading quality is the tracker's own confidence in where the joints are (0 to 1 per joint, the
   better side of the body, only the joints that check uses). It is not a score for your form.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisFormCheckLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MIN_SCORE = 0.3;      // below this a joint is treated as not found (the analyzers use the same line)
  const CLEAR_SCORE = 0.6;    // at or above: clear
  const FAIR_SCORE = 0.4;     // at or above: fair; below: low
  const CLEAR_FRAMES = 0.6, FAIR_FRAMES = 0.3;   // for a video: the share of sampled frames with a usable reading

  const LOWER = ["shoulder", "hip", "knee", "ankle"], ARM = ["shoulder", "elbow", "wrist"];
  const SIDE = "Film from the side with your whole body in frame.";

  // One entry per check: the key the analyzers use, what to call it, where to put the camera, whether it needs a video,
  // and the joints (per side of the body) it looks at.
  const CHECKS = [
    { key: "squat", label: "Squat", tip: SIDE, video: false, joints: LOWER },
    { key: "deadlift", label: "Deadlift", tip: SIDE, video: false, joints: LOWER },
    { key: "lunge", label: "Lunge", tip: SIDE, video: false, joints: LOWER },
    { key: "pushup", label: "Push-Up", tip: SIDE, video: false, joints: LOWER },
    { key: "benchpress", label: "Bench Press", tip: "Film from the feet end, looking up the body, with both shoulders and elbows in view.", video: false, joints: ARM },
    { key: "overheadpress", label: "Overhead Press", tip: SIDE, video: false, joints: ARM },
    { key: "latpulldown", label: "Lat Pulldown", tip: SIDE, video: false, joints: ["shoulder", "hip"] },
    { key: "row", label: "Row", tip: SIDE + " Use a video: the check compares frames.", video: true, joints: ARM },
    { key: "bicepcurl", label: "Bicep Curl", tip: SIDE + " Use a video: the check compares frames.", video: true, joints: ARM },
    { key: "preachercurl", label: "Preacher Curl", tip: SIDE + " Use a video: the check compares frames.", video: true, joints: ARM },
    { key: "tricepextension", label: "Overhead Tricep Extension", tip: SIDE, video: false, joints: ARM },
    { key: "plank", label: "Plank", tip: SIDE + " Use a video: the check compares frames.", video: true, joints: ["shoulder", "hip", "ankle"] }
  ];

  function checkFor(key) { return CHECKS.filter(function (c) { return c.key === key; })[0] || null; }

  /* ---------------- how sure was the tracker? ---------------- */

  function round2(n) { return Math.round(n * 100) / 100; }

  // The better side of the body for these joints: { side, score, joints, missing } (score = mean confidence of the joints on that side;
  // missing = joints on that side below MIN_SCORE or not reported). keypoints: [{ name, x, y, score }] with names like "left_knee".
  function bestSide(keypoints, jointNames) {
    const map = {};
    (keypoints || []).forEach(function (k) { if (k && k.name) map[k.name] = k; });
    let best = null;
    ["left", "right"].forEach(function (side) {
      let sum = 0;
      const joints = {}, missing = [];
      jointNames.forEach(function (n) {
        const kp = map[side + "_" + n];
        const s = kp && isFinite(Number(kp.score)) ? Number(kp.score) : 0;
        sum += s;
        if (kp) joints[n] = kp;
        if (s < MIN_SCORE) missing.push(n);
      });
      const score = jointNames.length ? sum / jointNames.length : 0;
      if (!best || score > best.score) best = { side: side, score: score, joints: joints, missing: missing };
    });
    return best;
  }

  // -> { level: "clear" | "fair" | "low", score, frames, missing, side }
  //   frames: for a video { confident, total } so that a clip where most frames were unusable is not called clear.
  function readingQuality(keypoints, jointNames, frames) {
    const b = bestSide(keypoints, jointNames);
    let level = b.missing.length ? "low" : b.score >= CLEAR_SCORE ? "clear" : b.score >= FAIR_SCORE ? "fair" : "low";
    let share = null;
    if (frames && frames.total > 0) {
      share = frames.confident / frames.total;
      const byFrames = share >= CLEAR_FRAMES ? "clear" : share >= FAIR_FRAMES ? "fair" : "low";
      const rank = { low: 0, fair: 1, clear: 2 };
      if (rank[byFrames] < rank[level]) level = byFrames;
    }
    return { level: level, score: round2(b.score), side: b.side, missing: b.missing, frameShare: share === null ? null : round2(share) };
  }

  const LEVEL_TEXT = {
    clear: "The tracker found your joints clearly in this frame.",
    fair: "The tracker was fairly sure where your joints were, but some may be a little off.",
    low: "The tracker wasn't sure where your joints were, so these readings may be wrong. Try again with better light, a clear view of the whole body and the camera angle suggested for this exercise."
  };
  const LEVEL_LABEL = { clear: "Clear", fair: "Fair", low: "Low" };

  function qualityLine(q) {
    let t = LEVEL_TEXT[q.level];
    if (q.frameShare !== null && q.level !== "clear") t += " Only " + Math.round(q.frameShare * 100) + "% of the frames in the clip gave a usable reading.";
    return t;
  }

  /* ---------------- wording ---------------- */

  // status from the analyzers: "good" | "info" | "warn". Shown as words, never as a verdict.
  const TAGS = { good: "Looks typical here", info: "For context", warn: "Worth a closer look" };
  function tagFor(status) { return TAGS[status] || TAGS.info; }

  // On a Low reading every finding is only context: the tracker was not sure enough to call anything typical or worth a look.
  function adjustForQuality(results, level) {
    return (results || []).map(function (r) { return level === "low" ? { status: "info", label: r.label, detail: r.detail } : { status: r.status, label: r.label, detail: r.detail }; });
  }

  // "2 worth a closer look · 1 looked typical · 3 for context"
  function summaryLine(results) {
    if (!results || !results.length) return "";
    let typical = 0, look = 0, ctx = 0;
    results.forEach(function (r) { if (r.status === "good") typical++; else if (r.status === "warn") look++; else ctx++; });
    const parts = [];
    if (look) parts.push(look + " worth a closer look");
    if (typical) parts.push(typical + " looked typical");
    if (ctx) parts.push(ctx + " for context");
    return parts.join(" · ");
  }

  const DISCLAIMER = "These readings come from one frame, or a few frames of a clip, from one camera angle, and the body-tracking model can be wrong. They don't tell you whether your technique is safe and they are no substitute for a qualified coach. If something hurts, stop and ask a professional.";

  // The joints to ring on the picture for this check: ["left_hip", ...] on the side the tracker was surest about.
  function ringedJoints(key, keypoints) {
    const c = checkFor(key);
    if (!c) return [];
    const b = bestSide(keypoints, c.joints);
    return c.joints.map(function (n) { return b.side + "_" + n; });
  }

  // A joint is drawn filled when the tracker was clear about it, hollow when it was not.
  function jointState(score) { return Number(score) >= 0.5 ? "clear" : Number(score) >= MIN_SCORE ? "unsure" : "missing"; }

  function fileText(file) {
    if (!file) return "";
    const kind = String(file.type || "").indexOf("video/") === 0 ? "Video" : "Photo";
    const mb = file.size > 0 ? file.size / 1048576 : 0;
    const size = mb >= 1 ? mb.toFixed(1) + " MB" : Math.max(1, Math.round((file.size || 0) / 1024)) + " KB";
    return kind + ": " + (file.name || "chosen file") + " (" + size + ")";
  }

  return {
    MIN_SCORE: MIN_SCORE, CHECKS: CHECKS, TAGS: TAGS, DISCLAIMER: DISCLAIMER, LEVEL_LABEL: LEVEL_LABEL,
    checkFor: checkFor, bestSide: bestSide, readingQuality: readingQuality, qualityLine: qualityLine,
    tagFor: tagFor, adjustForQuality: adjustForQuality, summaryLine: summaryLine, ringedJoints: ringedJoints, jointState: jointState, fileText: fileText
  };
});
