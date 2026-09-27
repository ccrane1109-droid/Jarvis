/* ==========================================================================
   JARVIS — Form Check (Beta)

   Takes a photo, runs on-device pose detection (Google's MoveNet, via
   TensorFlow.js — vendored locally in js/vendor/tfjs, Apache-2.0 licensed)
   to find body keypoints, then applies a few simple geometric rules per
   exercise to surface some common form cues.

   Honesty about what this actually is: a single photo shows one frozen
   instant, not tempo, control, or the full range of motion — this can't
   replace a coach watching you move. The geometric checks below are rough,
   commonly-cited coaching cues (e.g. "hip crease at or below the knee" for
   squat depth), not a clinically validated biomechanical assessment, and
   each one only makes sense from the camera angle it's designed for. All
   findings are phrased as observations, not verdicts.

   Nothing here is uploaded anywhere — the photo and the model both run
   entirely in this browser tab.

   The TF.js + pose-detection scripts (~1.5MB combined) are lazy-loaded on
   first use, not on every page load, since most visits to Jarvis won't
   touch this feature. MoveNet's actual model weights are NOT vendored
   (they're several MB and hosted by Google) — they load from the
   library's default remote URL the first time a detector is created,
   same as any other Jarvis feature (Firebase, ffmpeg.wasm) that depends
   on a one-time download from its provider's own infrastructure.
   ========================================================================== */

(function () {
  "use strict";

  const TFJS_URL = "js/vendor/tfjs/tf.min.js";
  const POSE_DETECTION_URL = "js/vendor/tfjs/pose-detection.min.js";
  const MIN_KEYPOINT_SCORE = 0.3;

  const VIDEO_SAMPLE_INTERVAL_SEC = 0.15;
  const VIDEO_MAX_DURATION_SEC = 8;

  let detector = null;
  let detectorPromise = null;
  let currentImage = null; // the HTMLImageElement currently loaded for analysis
  let currentVideo = null; // the HTMLVideoElement currently loaded for analysis

  /* ---------------- geometry helpers (pure functions — unit-testable with synthetic keypoints) ---------------- */

  function dist(a, b) {
    return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
  }

  // Angle at vertex b, formed by points a-b-c, in degrees (0-180).
  function angleAt(a, b, c) {
    const abx = a.x - b.x, aby = a.y - b.y;
    const cbx = c.x - b.x, cby = c.y - b.y;
    const dot = abx * cbx + aby * cby;
    const magAB = Math.sqrt(abx * abx + aby * aby);
    const magCB = Math.sqrt(cbx * cbx + cby * cby);
    if (magAB === 0 || magCB === 0) return null;
    const cos = Math.max(-1, Math.min(1, dot / (magAB * magCB)));
    return Math.acos(cos) * (180 / Math.PI);
  }

  // Angle of the line a->b measured from vertical (0 = perfectly upright, 90 =
  // horizontal) — direction-independent, so it doesn't matter which of a/b is
  // higher on screen or further left/right.
  function angleFromVertical(a, b) {
    const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
    if (dx === 0 && dy === 0) return null;
    return Math.atan2(dx, dy) * (180 / Math.PI);
  }

  function keypointMap(keypoints) {
    const map = {};
    keypoints.forEach(function (k) { map[k.name] = k; });
    return map;
  }

  // Picks whichever side (left/right) is more clearly visible, by average
  // confidence across shoulder/hip/knee/ankle — appropriate for a side-view
  // photo where the far side is partly hidden. Returns null if neither side
  // is confident enough to analyze.
  function pickSide(map) {
    function sideScore(prefix) {
      const names = ["shoulder", "hip", "knee", "ankle"];
      let sum = 0, count = 0;
      names.forEach(function (n) {
        const kp = map[prefix + "_" + n];
        if (kp) { sum += kp.score; count++; }
      });
      return count === names.length ? sum / count : 0;
    }
    const leftScore = sideScore("left");
    const rightScore = sideScore("right");
    const best = leftScore >= rightScore ? "left" : "right";
    const bestScore = Math.max(leftScore, rightScore);
    if (bestScore < MIN_KEYPOINT_SCORE) return null;
    return {
      side: best,
      shoulder: map[best + "_shoulder"],
      hip: map[best + "_hip"],
      knee: map[best + "_knee"],
      ankle: map[best + "_ankle"]
    };
  }

  function bothSidesConfident(map) {
    const names = ["left_knee", "right_knee", "left_ankle", "right_ankle"];
    return names.every(function (n) { return map[n] && map[n].score >= MIN_KEYPOINT_SCORE; });
  }

  function finding(status, label, detail) {
    return { status: status, label: label, detail: detail }; // status: "good" | "info" | "warn"
  }

  /* ---------------- exercise-specific analysis ---------------- */

  function analyzeSquat(keypoints) {
    const map = keypointMap(keypoints);
    const results = [];
    const side = pickSide(map);

    if (!side) {
      results.push(finding("warn", "Couldn't get a clear side-on reading", "Try a full-body photo from directly to the side, with good lighting and nothing blocking your hips/knees/ankles."));
      return results;
    }

    const thighLength = dist(side.hip, side.knee);
    const depthRatio = thighLength > 0 ? (side.hip.y - side.knee.y) / thighLength : 0;
    if (depthRatio >= 0) {
      results.push(finding("good", "Depth: at or below parallel", "Your hip crease looks level with or below the top of your knee in this photo."));
    } else if (depthRatio >= -0.3) {
      results.push(finding("info", "Depth: close to parallel", "Hips look just above knee height here — close, but not quite at parallel."));
    } else {
      results.push(finding("warn", "Depth: above parallel", "Hips look noticeably higher than your knees in this photo. If going deeper fits your goals and mobility, there may be room to sit lower."));
    }

    const kneeAngle = angleAt(side.hip, side.knee, side.ankle);
    if (kneeAngle !== null) {
      results.push(finding("info", "Knee bend: " + Math.round(kneeAngle) + "°", "Measured at the knee joint (180° = straight leg). No single \"correct\" number — just context for the depth reading above."));
    }

    const torsoLean = angleFromVertical(side.hip, side.shoulder);
    if (torsoLean !== null) {
      results.push(finding("info", "Torso lean: " + Math.round(torsoLean) + "° from vertical", "How much your torso is angled forward. Low-bar squats naturally lean further forward than high-bar/front squats — there's no universal target here, just noting it."));
    }

    if (bothSidesConfident(map)) {
      const kneeGap = dist(map.left_knee, map.right_knee);
      const ankleGap = dist(map.left_ankle, map.right_ankle);
      if (ankleGap > 0) {
        const ratio = kneeGap / ankleGap;
        if (ratio < 0.75) {
          results.push(finding("warn", "Knees may be tracking inward", "Your knees look noticeably closer together than your ankles from this angle — a common cue is to think about pushing your knees out over your toes."));
        } else {
          results.push(finding("good", "Knee tracking looks reasonable", "Knee spacing looks roughly in line with your ankle spacing."));
        }
      }
    }

    return results;
  }

  function analyzeDeadlift(keypoints) {
    const map = keypointMap(keypoints);
    const results = [];
    const side = pickSide(map);

    if (!side) {
      results.push(finding("warn", "Couldn't get a clear side-on reading", "Try a full-body photo from directly to the side, with good lighting and nothing blocking your hips/knees/ankles."));
      return results;
    }

    // hip.y - knee.y is positive when the hip is BELOW the knee in the image
    // (larger y = lower on screen), i.e. a low, squat-like hip position;
    // it's negative — more so the further apart they are — when the hip
    // sits well above the knee, i.e. a high, stiff-leg-like hip position.
    const shinLength = dist(side.knee, side.ankle);
    const hipHeightRatio = shinLength > 0 ? (side.hip.y - side.knee.y) / shinLength : 0;
    if (hipHeightRatio > -0.2) {
      results.push(finding("info", "Hips are quite low relative to your knees", "This shifts the pull toward more of a squat pattern. Fine if that's your intended style (e.g. a sumo pull) — worth checking if it's not."));
    } else if (hipHeightRatio < -1.0) {
      results.push(finding("info", "Hips are relatively high relative to your knees", "This shifts toward more of a stiff-leg/RDL pattern. Fine if intended — worth checking if you meant a conventional pull."));
    } else {
      results.push(finding("good", "Hip height looks like a fairly typical starting position", "Roughly in the usual range between knees and hips for this stance."));
    }

    const hipTorsoAngle = angleAt(side.shoulder, side.hip, side.knee);
    if (hipTorsoAngle !== null) {
      results.push(finding("info", "Hip angle (torso-to-thigh): " + Math.round(hipTorsoAngle) + "°", "A very closed angle here can go along with a rounded lower back to compensate — worth double-checking your back stays flat through the pull, ideally by having someone film you from this same angle mid-rep."));
    }

    const backLean = angleFromVertical(side.hip, side.shoulder);
    if (backLean !== null) {
      results.push(finding("info", "Torso angle: " + Math.round(backLean) + "° from vertical", "For context only — conventional and sumo pulls naturally start at different torso angles."));
    }

    return results;
  }

  const ANALYZERS = { squat: analyzeSquat, deadlift: analyzeDeadlift };

  /* ---------------- video: picking the moment to analyze ----------------
     Pure functions, deliberately separated from the actual video-decoding
     loop below so the SELECTION logic (the part most likely to have a
     subtle bug) can be unit-tested with synthetic keypoint sequences,
     without needing a real video file or the ML model. */

  // Higher = a better candidate frame for that exercise; null = not usable
  // (no confident side view). Squat: prefer the deepest point of the rep.
  // Deadlift only has one meaningful moment to check (the setup), so every
  // confident frame scores the same and pickBestFrame just takes the first.
  function scoreFrameForExercise(keypoints, exercise) {
    const map = keypointMap(keypoints);
    const side = pickSide(map);
    if (!side) return null;
    if (exercise === "squat") {
      const thighLength = dist(side.hip, side.knee);
      return thighLength > 0 ? (side.hip.y - side.knee.y) / thighLength : null;
    }
    return 0;
  }

  // samples: [{ time, keypoints }] in chronological order. Returns the
  // chosen { time, keypoints } or null if nothing was usable.
  function pickBestFrame(samples, exercise) {
    const scored = [];
    samples.forEach(function (s) {
      const score = scoreFrameForExercise(s.keypoints, exercise);
      if (score !== null) scored.push({ time: s.time, keypoints: s.keypoints, score: score });
    });
    if (scored.length === 0) return null;
    if (exercise === "squat") {
      return scored.reduce(function (best, s) { return s.score > best.score ? s : best; });
    }
    return scored[0];
  }

  /* ---------------- skeleton drawing ---------------- */

  const SKELETON_CONNECTIONS = [
    ["left_shoulder", "right_shoulder"], ["left_shoulder", "left_hip"], ["right_shoulder", "right_hip"],
    ["left_hip", "right_hip"], ["left_shoulder", "left_elbow"], ["left_elbow", "left_wrist"],
    ["right_shoulder", "right_elbow"], ["right_elbow", "right_wrist"], ["left_hip", "left_knee"],
    ["left_knee", "left_ankle"], ["right_hip", "right_knee"], ["right_knee", "right_ankle"]
  ];

  // source can be an <img> (naturalWidth/Height) or a <canvas> (width/height
  // directly) — the latter is how a chosen video frame gets passed in.
  function drawSkeleton(canvas, source, keypoints) {
    canvas.width = source.naturalWidth || source.width;
    canvas.height = source.naturalHeight || source.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(source, 0, 0);
    const map = keypointMap(keypoints);

    ctx.strokeStyle = "#4ade80";
    ctx.lineWidth = Math.max(2, canvas.width / 250);
    SKELETON_CONNECTIONS.forEach(function (pair) {
      const a = map[pair[0]], b = map[pair[1]];
      if (a && b && a.score >= MIN_KEYPOINT_SCORE && b.score >= MIN_KEYPOINT_SCORE) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    });

    ctx.fillStyle = "#facc15";
    keypoints.forEach(function (k) {
      if (k.score >= MIN_KEYPOINT_SCORE) {
        ctx.beginPath();
        ctx.arc(k.x, k.y, Math.max(3, canvas.width / 150), 0, 2 * Math.PI);
        ctx.fill();
      }
    });
  }

  /* ---------------- lazy library + model loading ---------------- */

  function loadScriptOnce(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[data-form-check-src="' + src + '"]')) { resolve(); return; }
      const el = document.createElement("script");
      el.src = src;
      el.setAttribute("data-form-check-src", src);
      el.onload = function () { resolve(); };
      el.onerror = function () { reject(new Error("Couldn't load " + src)); };
      document.head.appendChild(el);
    });
  }

  function ensureDetector(onStatus) {
    if (detector) return Promise.resolve(detector);
    if (detectorPromise) return detectorPromise;
    onStatus("Loading the body-tracking model… (first time only, a few MB)");
    detectorPromise = loadScriptOnce(TFJS_URL)
      .then(function () { return loadScriptOnce(POSE_DETECTION_URL); })
      .then(function () {
        if (!window.tf || !window.poseDetection) throw new Error("Body-tracking library failed to load.");
        return window.poseDetection.createDetector(window.poseDetection.SupportedModels.MoveNet, {
          modelType: window.poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING
        });
      })
      .then(function (d) {
        detector = d;
        return d;
      })
      .catch(function (err) {
        detectorPromise = null; // allow retry
        throw err;
      });
    return detectorPromise;
  }

  /* ---------------- video: the actual decode/sample loop ---------------- */

  function seekVideoTo(video, time) {
    return new Promise(function (resolve) {
      function onSeeked() { video.removeEventListener("seeked", onSeeked); resolve(); }
      video.addEventListener("seeked", onSeeked);
      video.currentTime = time;
    });
  }

  // Samples the video at a fixed interval (capped to VIDEO_MAX_DURATION_SEC,
  // so a long clip doesn't take forever), runs pose detection on each
  // sampled frame, then hands the collected { time, keypoints } list to the
  // pure pickBestFrame() above. Only re-renders the ONE winning frame at
  // full resolution afterward, rather than holding every sampled frame's
  // pixels in memory at once.
  function sampleVideoFrames(video, exercise, det, onStatus) {
    const duration = Math.min(video.duration || 0, VIDEO_MAX_DURATION_SEC);
    const times = [];
    for (let t = 0; t <= duration; t += VIDEO_SAMPLE_INTERVAL_SEC) times.push(t);

    const scratch = document.createElement("canvas");
    scratch.width = video.videoWidth;
    scratch.height = video.videoHeight;
    const scratchCtx = scratch.getContext("2d");
    const samples = [];

    function processIndex(i) {
      if (i >= times.length) return Promise.resolve(samples);
      onStatus("Scanning your clip… (" + (i + 1) + "/" + times.length + ")");
      return seekVideoTo(video, times[i]).then(function () {
        scratchCtx.drawImage(video, 0, 0, scratch.width, scratch.height);
        return det.estimatePoses(scratch);
      }).then(function (poses) {
        if (poses && poses[0] && poses[0].keypoints) {
          samples.push({ time: times[i], keypoints: poses[0].keypoints });
        }
        return processIndex(i + 1);
      });
    }

    return processIndex(0).then(function () {
      const chosen = pickBestFrame(samples, exercise);
      if (!chosen) return null;
      return seekVideoTo(video, chosen.time).then(function () {
        const finalCanvas = document.createElement("canvas");
        finalCanvas.width = video.videoWidth;
        finalCanvas.height = video.videoHeight;
        finalCanvas.getContext("2d").drawImage(video, 0, 0);
        return { time: chosen.time, keypoints: chosen.keypoints, canvas: finalCanvas, totalSamples: times.length, confidentSamples: samples.length };
      });
    });
  }

  /* ---------------- UI wiring ---------------- */

  function $(id) { return document.getElementById(id); }

  function setStatus(text) {
    $("formCheckStatus").textContent = text || "";
  }

  function renderResults(results) {
    const container = $("formCheckResults");
    if (!results || results.length === 0) {
      container.innerHTML = "";
      return;
    }
    const core = window.JarvisCore;
    container.innerHTML = results.map(function (r) {
      const cls = r.status === "good" ? "badge-green" : r.status === "warn" ? "badge-yellow" : "badge-neutral";
      return (
        '<div class="list-item">' +
          '<span class="badge ' + cls + '">' + core.escapeHtml(r.label) + '</span>' +
          '<p class="field-hint" style="margin-top:6px;">' + core.escapeHtml(r.detail) + '</p>' +
        '</div>'
      );
    }).join("");
  }

  function handleFileChange(e) {
    const file = e.target.files[0];
    $("formCheckAnalyzeBtn").disabled = !file;
    $("formCheckResults").innerHTML = "";
    setStatus("");
    $("formCheckCanvasWrap").classList.add("hidden");
    currentImage = null;
    currentVideo = null;
    if (!file) return;
    if (file.type.indexOf("video/") === 0) {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.onloadedmetadata = function () { currentVideo = video; };
      video.src = URL.createObjectURL(file);
    } else {
      const img = new Image();
      img.onload = function () { currentImage = img; };
      img.src = URL.createObjectURL(file);
    }
  }

  function handleAnalyzeClick() {
    if (!currentImage && !currentVideo) { window.JarvisCore.showToast("Choose a photo or video first."); return; }
    const btn = $("formCheckAnalyzeBtn");
    btn.disabled = true;
    setStatus(currentVideo ? "Preparing…" : "Analyzing…");
    $("formCheckResults").innerHTML = "";
    const exercise = $("formCheckExerciseSelect").value;

    ensureDetector(setStatus).then(function (d) {
      if (currentVideo) {
        return sampleVideoFrames(currentVideo, exercise, d, setStatus).then(function (result) {
          if (!result) return null;
          return {
            keypoints: result.keypoints,
            source: result.canvas,
            note: "Used the frame at " + result.time.toFixed(1) + "s (found a clear reading in " + result.confidentSamples + " of " + result.totalSamples + " sampled frames)."
          };
        });
      }
      setStatus("Analyzing…");
      return d.estimatePoses(currentImage).then(function (poses) {
        if (!poses || !poses[0] || !poses[0].keypoints) return null;
        return { keypoints: poses[0].keypoints, source: currentImage, note: null };
      });
    }).then(function (analysis) {
      btn.disabled = false;
      if (!analysis) {
        setStatus(currentVideo
          ? "Couldn't detect a person clearly in that clip. Try better lighting, a clearer side angle, or trimming to just the rep."
          : "Couldn't detect a person in that photo. Try a clearer, well-lit, full-body shot.");
        return;
      }
      const canvasWrap = $("formCheckCanvasWrap");
      canvasWrap.classList.remove("hidden");
      drawSkeleton($("formCheckCanvas"), analysis.source, analysis.keypoints);

      const analyzer = ANALYZERS[exercise];
      const results = analyzer ? analyzer(analysis.keypoints) : [];
      renderResults(results);
      const baseStatus = results.length ? "" : "Detected a person, but couldn't get confident readings for this check — try a clearer angle.";
      setStatus([analysis.note, baseStatus].filter(Boolean).join(" "));
    }).catch(function (err) {
      btn.disabled = false;
      const message = err && err.message ? err.message : "";
      if (message.indexOf("fetch") !== -1 || message.indexOf("load") !== -1) {
        setStatus("Couldn't reach the body-tracking model (network issue). Check your connection and try again.");
      } else {
        setStatus("Something went wrong: " + (message || "please try again."));
      }
    });
  }

  function init() {
    const photoInput = $("formCheckPhotoInput");
    const analyzeBtn = $("formCheckAnalyzeBtn");
    if (!photoInput || !analyzeBtn) return;
    photoInput.addEventListener("change", handleFileChange);
    analyzeBtn.addEventListener("click", handleAnalyzeClick);
  }

  window.JarvisFormCheck = {
    init: init,
    // exposed for testing only — geometry is pure and independent of the ML model
    _internal: {
      angleAt: angleAt, angleFromVertical: angleFromVertical, dist: dist,
      analyzeSquat: analyzeSquat, analyzeDeadlift: analyzeDeadlift, pickSide: pickSide, keypointMap: keypointMap,
      scoreFrameForExercise: scoreFrameForExercise, pickBestFrame: pickBestFrame
    }
  };
})();
