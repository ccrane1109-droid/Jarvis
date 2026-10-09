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

  const VIDEO_SAMPLE_INTERVAL_SEC = 0.15; // only used by the seek-based fallback path
  const VIDEO_MAX_DURATION_SEC = 8;
  const VIDEO_PLAYBACK_RATE = 2; // the fast (non-seeking) path plays through the clip instead of seeking frame by frame

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
  // confidence across the given joint names — appropriate for a side-view
  // photo where the far side is partly hidden. Returns null if neither side
  // is confident enough to analyze. jointNames defaults to the lower-body
  // set used by Squat/Deadlift; pass a different set (e.g. arm joints) for
  // an upper-body check.
  function pickSide(map, jointNames) {
    const names = jointNames || ["shoulder", "hip", "knee", "ankle"];
    function sideScore(prefix) {
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
    const result = { side: best };
    names.forEach(function (n) { result[n] = map[best + "_" + n]; });
    return result;
  }

  function bothSidesConfident(map) {
    const names = ["left_knee", "right_knee", "left_ankle", "right_ankle"];
    return names.every(function (n) { return map[n] && map[n].score >= MIN_KEYPOINT_SCORE; });
  }

  // Pulls out one fixed side's named joints from every video frame's keypoint
  // list — used for range-of-motion / stability checks across a whole rep,
  // not just the single best frame. A frame is skipped (not included in the
  // result) if any of the requested joints on that side aren't confident in
  // it. Fixing the side up front (rather than re-running pickSide per frame)
  // avoids flip-flopping between left/right across frames.
  function jointSeries(allFrames, side, jointNames) {
    const out = [];
    allFrames.forEach(function (frameKeypoints) {
      const map = keypointMap(frameKeypoints);
      const joints = {};
      let ok = true;
      jointNames.forEach(function (n) {
        const kp = map[side + "_" + n];
        if (!kp || kp.score < MIN_KEYPOINT_SCORE) ok = false;
        joints[n] = kp;
      });
      if (ok) out.push(joints);
    });
    return out;
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

  function analyzePushup(keypoints) {
    const map = keypointMap(keypoints);
    const results = [];
    const side = pickSide(map);

    if (!side) {
      results.push(finding("warn", "Couldn't get a clear side-on reading", "Try a full-body photo or video from directly to the side, with good lighting and nothing blocking your shoulder/hip/ankle line."));
      return results;
    }

    // A good push-up keeps shoulder-hip-ankle roughly a straight line. Compare
    // the hip's actual height to where it would sit if it were exactly ON
    // that line, normalized by body length so it doesn't depend on photo
    // scale or distance.
    const bodyLength = dist(side.shoulder, side.ankle);
    const dx = side.ankle.x - side.shoulder.x;
    let deviation = 0;
    if (bodyLength > 0 && dx !== 0) {
      const t = (side.hip.x - side.shoulder.x) / dx;
      const expectedHipY = side.shoulder.y + t * (side.ankle.y - side.shoulder.y);
      deviation = (side.hip.y - expectedHipY) / bodyLength; // >0 = hip sagging down, <0 = hip piked up
    }
    if (deviation > 0.08) {
      results.push(finding("warn", "Hips look like they're sagging", "Your hips look lower than a straight line from shoulder to ankle — a common cue is to squeeze your glutes and brace your core to keep the line straight."));
    } else if (deviation < -0.08) {
      results.push(finding("warn", "Hips look piked up", "Your hips look higher than a straight shoulder-to-ankle line — try lowering them to keep your body in one straight line."));
    } else {
      results.push(finding("good", "Body forms a fairly straight line", "Shoulder, hip, and ankle look close to a straight line in this frame."));
    }

    const elbow = map[side.side + "_elbow"];
    const wrist = map[side.side + "_wrist"];
    if (elbow && wrist && elbow.score >= MIN_KEYPOINT_SCORE && wrist.score >= MIN_KEYPOINT_SCORE) {
      const elbowAngle = angleAt(side.shoulder, elbow, wrist);
      if (elbowAngle !== null) {
        results.push(finding("info", "Elbow bend: " + Math.round(elbowAngle) + "°", "Measured at the elbow (180° = arms straight, as at the top of the rep). Just context — this only makes sense compared against other frames if you're checking a video."));
      }
    }

    return results;
  }

  function analyzeBenchPress(keypoints) {
    const map = keypointMap(keypoints);
    const results = [];
    // Elbow flare is a frontal-plane thing — best judged from a shot roughly
    // from the feet looking up the body, not a pure side profile, so this
    // uses whichever arm is more clearly visible rather than a leg-based side.
    const armSide = pickSide(map, ["shoulder", "elbow", "wrist"]);

    if (!armSide) {
      results.push(finding("warn", "Couldn't get a clear reading on either arm", "Try a shot from roughly the feet looking up the body, with both shoulders and elbows visible and well lit."));
      return results;
    }

    const hip = map[armSide.side + "_hip"];
    if (hip && hip.score >= MIN_KEYPOINT_SCORE) {
      const flareAngle = angleAt(hip, armSide.shoulder, armSide.elbow);
      if (flareAngle !== null) {
        if (flareAngle > 75) {
          results.push(finding("warn", "Elbow looks quite flared", "Your upper arm looks close to straight out from your torso (near 90°). Many lifters aim for something more like 45–75° to ease shoulder strain — this varies by grip width and individual shoulders, so treat it as a prompt to double-check, not a rule."));
        } else if (flareAngle < 30) {
          results.push(finding("info", "Elbow looks quite tucked", "Your upper arm looks close to your torso. Fine for some pressing styles (e.g. close-grip work) — just noting it in case a wider path was intended."));
        } else {
          results.push(finding("good", "Elbow flare looks like a moderate angle", "Roughly in the range many lifters aim for, though the right amount does vary by individual and grip width."));
        }
      }
    } else {
      results.push(finding("info", "Couldn't measure elbow flare precisely", "Need a confident reading on the hip on the same side to compare the elbow angle against — try a clearer full-torso shot."));
    }

    const wrist = map[armSide.side + "_wrist"];
    if (wrist && wrist.score >= MIN_KEYPOINT_SCORE) {
      const elbowBend = angleAt(armSide.shoulder, armSide.elbow, wrist);
      if (elbowBend !== null) {
        results.push(finding("info", "Elbow bend: " + Math.round(elbowBend) + "°", "Measured at the elbow (180° = arms straight/lockout). Just context for where in the rep this frame is."));
      }
    }

    return results;
  }

  function analyzeLatPulldown(keypoints) {
    const map = keypointMap(keypoints);
    const results = [];
    // Only the torso (shoulder-hip) is needed for the main check, so ask for
    // just those two joints — legs are often tucked under machine pads and
    // shouldn't block the analysis.
    const side = pickSide(map, ["shoulder", "hip"]);

    if (!side) {
      results.push(finding("warn", "Couldn't get a clear side-on reading", "Try a side-on shot with your torso and hips clearly visible."));
      return results;
    }

    const torsoLean = angleFromVertical(side.hip, side.shoulder);
    if (torsoLean !== null) {
      if (torsoLean > 35) {
        results.push(finding("warn", "Leaning back quite a bit", "A big backward lean often means momentum is doing some of the work instead of your lats. Try sitting a little more upright and pulling with your elbows rather than rocking back."));
      } else if (torsoLean > 15) {
        results.push(finding("info", "Leaning back somewhat", "A slight backward lean to clear your chin is normal — just worth double-checking it's not turning into a bigger rock."));
      } else {
        results.push(finding("good", "Staying fairly upright", "Torso looks close to vertical in this frame."));
      }
    }

    const elbow = map[side.side + "_elbow"];
    const wrist = map[side.side + "_wrist"];
    if (elbow && wrist && elbow.score >= MIN_KEYPOINT_SCORE && wrist.score >= MIN_KEYPOINT_SCORE) {
      const elbowAngle = angleAt(side.shoulder, elbow, wrist);
      if (elbowAngle !== null) {
        results.push(finding("info", "Elbow bend: " + Math.round(elbowAngle) + "°", "Just context for where in the pull this frame is."));
      }
    }

    return results;
  }

  function analyzeOverheadTricepExtension(keypoints) {
    const map = keypointMap(keypoints);
    const results = [];
    const armSide = pickSide(map, ["shoulder", "elbow", "wrist"]);

    if (!armSide) {
      results.push(finding("warn", "Couldn't get a clear reading on either arm", "Try a side-on shot with your shoulder, elbow, and wrist all visible overhead."));
      return results;
    }

    const elbowAngle = angleAt(armSide.shoulder, armSide.elbow, armSide.wrist);
    if (elbowAngle !== null) {
      results.push(finding("info", "Elbow bend: " + Math.round(elbowAngle) + "°", "Measured at the elbow (180° = arm straight overhead)."));
    }

    const upperArmLean = angleFromVertical(armSide.shoulder, armSide.elbow);
    if (upperArmLean !== null) {
      if (upperArmLean > 30) {
        results.push(finding("warn", "Elbow may be drifting away from vertical", "A common cue is to keep your upper arm pointing straight up — roughly above your shoulder — through the whole movement, rather than letting it drift forward or out to the side."));
      } else if (upperArmLean > 15) {
        results.push(finding("info", "Slight drift from vertical", "Your upper arm looks a bit off vertical here — worth keeping an eye on."));
      } else {
        results.push(finding("good", "Upper arm staying close to vertical", "Elbow looks like it's staying roughly above your shoulder in this frame."));
      }
    }

    return results;
  }

  function analyzePreacherCurl(keypoints, allFrames) {
    const map = keypointMap(keypoints);
    const results = [];
    const armSide = pickSide(map, ["shoulder", "elbow", "wrist"]);

    if (!armSide) {
      results.push(finding("warn", "Couldn't get a clear reading on your arm", "Try a side-on shot with your working arm and the pad clearly visible."));
      return results;
    }

    const elbowAngle = angleAt(armSide.shoulder, armSide.elbow, armSide.wrist);
    if (elbowAngle !== null) {
      results.push(finding("info", "Elbow bend: " + Math.round(elbowAngle) + "°", "Measured at the elbow (180° = fully extended)."));
    }

    // A single frame can't show whether a rep went through its full range —
    // that needs the whole clip, so this only runs when a video was given.
    if (allFrames && allFrames.length > 1) {
      const series = jointSeries(allFrames, armSide.side, ["shoulder", "elbow", "wrist"]);
      const angles = series
        .map(function (j) { return angleAt(j.shoulder, j.elbow, j.wrist); })
        .filter(function (a) { return a !== null; });
      if (angles.length >= 2) {
        const min = Math.min.apply(null, angles), max = Math.max.apply(null, angles);
        const rom = max - min;
        if (rom < 70) {
          results.push(finding("warn", "Range of motion looks limited", "Elbow angle only moved from about " + Math.round(min) + "° to " + Math.round(max) + "° across the clip. A common cue for preacher curls is to fully extend at the bottom and fully squeeze at the top — worth checking whether you're stopping short."));
        } else {
          results.push(finding("good", "Looks like a solid range of motion", "Elbow angle moved from about " + Math.round(min) + "° to " + Math.round(max) + "° across the clip."));
        }
      } else {
        results.push(finding("info", "Couldn't track enough of the rep to check range of motion", "Try a clip with your whole arm visible for the entire movement."));
      }
    } else {
      results.push(finding("info", "Take a video (not just a photo) to check your range of motion", "A single photo can't show whether you're going through the full range of the rep."));
    }

    return results;
  }

  function analyzeRow(keypoints, allFrames) {
    const map = keypointMap(keypoints);
    const results = [];
    const armSide = pickSide(map, ["shoulder", "elbow", "wrist"]);

    if (!armSide) {
      results.push(finding("warn", "Couldn't get a clear reading on either arm", "Try a side-on shot with your pulling arm, shoulder, and hip all visible."));
      return results;
    }

    const elbowAngle = angleAt(armSide.shoulder, armSide.elbow, armSide.wrist);
    if (elbowAngle !== null) {
      results.push(finding("info", "Elbow bend: " + Math.round(elbowAngle) + "°", "Measured at the elbow (180° = arm straight, as at the start of the pull)."));
    }

    const hip = map[armSide.side + "_hip"];
    const hipConfident = hip && hip.score >= MIN_KEYPOINT_SCORE;
    if (hipConfident) {
      const torsoLean = angleFromVertical(hip, armSide.shoulder);
      if (torsoLean !== null) {
        results.push(finding("info", "Torso angle: " + Math.round(torsoLean) + "° from vertical", "Context only — bent-over rows naturally start closer to horizontal than a seated cable row."));
      }
    }

    // Body swing/momentum only shows up across a rep, not in one frame.
    if (allFrames && allFrames.length > 1 && hipConfident) {
      const series = jointSeries(allFrames, armSide.side, ["shoulder", "hip"]);
      const leans = series
        .map(function (j) { return angleFromVertical(j.hip, j.shoulder); })
        .filter(function (a) { return a !== null; });
      if (leans.length >= 2) {
        const swing = Math.max.apply(null, leans) - Math.min.apply(null, leans);
        if (swing > 20) {
          results.push(finding("warn", "Torso looks like it's swinging quite a bit", "Your torso angle changed by about " + Math.round(swing) + "° through the rep — that can mean body momentum is helping move the weight instead of your back and arms. Try keeping your torso still and only moving the arms."));
        } else {
          results.push(finding("good", "Torso looks fairly stable through the rep", "Only about " + Math.round(swing) + "° of change in torso angle across the clip — doesn't look like much swinging."));
        }
      } else {
        results.push(finding("info", "Couldn't track your torso through enough of the clip to check for swinging", "Try a clip with your torso and hips visible for the whole movement."));
      }
    } else if (!allFrames) {
      results.push(finding("info", "Take a video (not just a photo) to check for body swing through the rep", "A single photo can't show whether your torso is rocking during the movement."));
    }

    return results;
  }

  function analyzeOverheadPress(keypoints) {
    const map = keypointMap(keypoints);
    const results = [];
    const armSide = pickSide(map, ["shoulder", "elbow", "wrist"]);

    if (!armSide) {
      results.push(finding("warn", "Couldn't get a clear side-on reading", "Try a side-on shot with your shoulder, elbow, and wrist all visible overhead."));
      return results;
    }

    const elbowAngle = angleAt(armSide.shoulder, armSide.elbow, armSide.wrist);
    if (elbowAngle !== null) {
      results.push(finding("info", "Elbow bend: " + Math.round(elbowAngle) + "°", "Measured at the elbow (180° = arm straight overhead, lockout)."));
    }

    const hip = map[armSide.side + "_hip"];
    if (hip && hip.score >= MIN_KEYPOINT_SCORE) {
      const torsoLean = angleFromVertical(hip, armSide.shoulder);
      if (torsoLean !== null) {
        if (torsoLean > 20) {
          results.push(finding("warn", "Torso may be leaning or arching back", "A big lean or an arched lower back often means the bar is drifting forward and your back is compensating instead of pressing straight overhead. A common cue is to brace your core and keep the bar path close to your face."));
        } else if (torsoLean > 10) {
          results.push(finding("info", "Slight lean or arch", "A small lean is common — just worth double-checking it's not turning into a bigger arch."));
        } else {
          results.push(finding("good", "Torso staying fairly upright", "Torso looks close to vertical in this frame."));
        }
      }

      const torsoLength = dist(armSide.shoulder, hip);
      if (torsoLength > 0) {
        const barOffset = Math.abs(armSide.wrist.x - armSide.shoulder.x) / torsoLength;
        if (barOffset > 0.35) {
          results.push(finding("warn", "Bar/hand looks like it's drifted forward of your shoulder", "A common cue is to keep the bar path close, stacking over your shoulder rather than drifting out in front, which can stress the shoulder more."));
        } else {
          results.push(finding("good", "Hand position looks fairly stacked over your shoulder", "Wrist looks close to directly above your shoulder in this frame."));
        }
      }
    } else {
      results.push(finding("info", "Couldn't measure torso lean or bar path precisely", "Need a confident reading on the hip on the same side — try a clearer full-torso shot."));
    }

    return results;
  }

  function analyzeBicepCurl(keypoints, allFrames) {
    const map = keypointMap(keypoints);
    const results = [];
    const armSide = pickSide(map, ["shoulder", "elbow", "wrist"]);

    if (!armSide) {
      results.push(finding("warn", "Couldn't get a clear reading on your arm", "Try a side-on shot with your working arm fully visible from shoulder to wrist."));
      return results;
    }

    const elbowAngle = angleAt(armSide.shoulder, armSide.elbow, armSide.wrist);
    if (elbowAngle !== null) {
      results.push(finding("info", "Elbow bend: " + Math.round(elbowAngle) + "°", "Measured at the elbow (180° = fully extended)."));
    }

    const hip = map[armSide.side + "_hip"];
    if (hip && hip.score >= MIN_KEYPOINT_SCORE) {
      // Angle at the shoulder between the shoulder->hip direction and the
      // shoulder->elbow direction: near 0° when the upper arm continues
      // straight down in line with the torso (elbow pinned at the side),
      // growing toward 90°+ as the elbow swings forward away from the body.
      const elbowToSideAngle = angleAt(hip, armSide.shoulder, armSide.elbow);
      if (elbowToSideAngle !== null) {
        if (elbowToSideAngle > 55) {
          results.push(finding("warn", "Elbow may be swinging forward", "Your upper arm looks like it's moving away from your torso rather than staying pinned at your side — a common cue for standing curls is to keep your elbow still and close to your ribs, letting only your forearm move."));
        } else {
          results.push(finding("good", "Elbow looks like it's staying close to your side", "Your upper arm looks fairly still relative to your torso in this frame."));
        }
      }
    } else {
      results.push(finding("info", "Couldn't measure elbow drift precisely", "Need a confident reading on the hip on the same side to check whether your elbow is staying pinned — try a clearer full-torso shot."));
    }

    // A single frame can't show whether a rep went through its full range —
    // that needs the whole clip, so this only runs when a video was given.
    if (allFrames && allFrames.length > 1) {
      const series = jointSeries(allFrames, armSide.side, ["shoulder", "elbow", "wrist"]);
      const angles = series
        .map(function (j) { return angleAt(j.shoulder, j.elbow, j.wrist); })
        .filter(function (a) { return a !== null; });
      if (angles.length >= 2) {
        const min = Math.min.apply(null, angles), max = Math.max.apply(null, angles);
        const rom = max - min;
        if (rom < 70) {
          results.push(finding("warn", "Range of motion looks limited", "Elbow angle only moved from about " + Math.round(min) + "° to " + Math.round(max) + "° across the clip. A common cue is to fully extend at the bottom and fully curl at the top — worth checking whether you're stopping short."));
        } else {
          results.push(finding("good", "Looks like a solid range of motion", "Elbow angle moved from about " + Math.round(min) + "° to " + Math.round(max) + "° across the clip."));
        }
      } else {
        results.push(finding("info", "Couldn't track enough of the rep to check range of motion", "Try a clip with your whole arm visible for the entire movement."));
      }
    } else {
      results.push(finding("info", "Take a video (not just a photo) to check your range of motion", "A single photo can't show whether you're going through the full range of the rep."));
    }

    return results;
  }

  function analyzeLunge(keypoints) {
    const map = keypointMap(keypoints);
    const results = [];
    const side = pickSide(map);

    if (!side) {
      results.push(finding("warn", "Couldn't get a clear side-on reading", "Try a full-body photo from directly to the side, with good lighting and nothing blocking your hips/knees/ankles."));
      return results;
    }

    const kneeAngle = angleAt(side.hip, side.knee, side.ankle);
    if (kneeAngle !== null) {
      if (kneeAngle <= 100) {
        results.push(finding("good", "Front knee: solid depth", "Your front knee looks bent to around a right angle or deeper in this frame, which is the usual target for a lunge."));
      } else if (kneeAngle <= 120) {
        results.push(finding("info", "Front knee: close to a right angle", "Getting there — a bit more depth would bring your front knee closer to a 90° bend."));
      } else {
        results.push(finding("warn", "Front knee: looks fairly shallow", "Your front knee doesn't look very bent in this frame. If depth fits your goals and mobility, there may be room to lower your back knee further toward the floor."));
      }
    }

    const shinLength = dist(side.knee, side.ankle);
    if (shinLength > 0) {
      const forwardOffset = Math.abs(side.knee.x - side.ankle.x) / shinLength;
      if (forwardOffset > 0.6) {
        results.push(finding("info", "Front knee is traveling noticeably past your toes", "Not automatically wrong — plenty of lunge styles allow this — but worth double-checking it's intentional and your heel isn't lifting off the ground."));
      } else {
        results.push(finding("good", "Front knee stays close to over your ankle", "Knee looks roughly stacked over your ankle rather than traveling well past your toes."));
      }
    }

    const torsoLean = angleFromVertical(side.hip, side.shoulder);
    if (torsoLean !== null) {
      if (torsoLean > 25) {
        results.push(finding("info", "Torso leaning forward noticeably", "Most lunge variations cue an upright torso, though some (like a forward-reaching split squat) intentionally lean — just noting it in case it wasn't intended."));
      } else {
        results.push(finding("good", "Torso staying fairly upright", "Torso looks close to vertical in this frame."));
      }
    }

    return results;
  }

  // Shared by the live Plank check and its own best-frame scoring below:
  // how far the hip sits off the straight line expected between shoulder and
  // ankle, normalized by body length. >0 = hip sagging down, <0 = piked up.
  function plankHipDeviation(shoulder, hip, ankle) {
    const bodyLength = dist(shoulder, ankle);
    const dx = ankle.x - shoulder.x;
    if (bodyLength === 0 || dx === 0) return 0;
    const t = (hip.x - shoulder.x) / dx;
    const expectedHipY = shoulder.y + t * (ankle.y - shoulder.y);
    return (hip.y - expectedHipY) / bodyLength;
  }

  function analyzePlank(keypoints, allFrames) {
    const map = keypointMap(keypoints);
    const results = [];
    const side = pickSide(map, ["shoulder", "hip", "ankle"]);

    if (!side) {
      results.push(finding("warn", "Couldn't get a clear side-on reading", "Try a full-body shot from directly to the side, with your shoulder, hip, and ankle all visible."));
      return results;
    }

    const deviation = plankHipDeviation(side.shoulder, side.hip, side.ankle);
    if (deviation > 0.08) {
      results.push(finding("warn", "Hips look like they're sagging", "Your hips look lower than a straight line from shoulder to ankle — try bracing your core and squeezing your glutes to flatten out the line."));
    } else if (deviation < -0.08) {
      results.push(finding("warn", "Hips look piked up", "Your hips look higher than a straight shoulder-to-ankle line — try lowering them so your body forms one straight line."));
    } else {
      results.push(finding("good", "Body forms a fairly straight line", "Shoulder, hip, and ankle look close to a straight line in this frame."));
    }

    // Drift over the course of a hold only shows up across a clip, not one frame.
    if (allFrames && allFrames.length > 1) {
      const series = jointSeries(allFrames, side.side, ["shoulder", "hip", "ankle"]);
      const deviations = series.map(function (j) { return plankHipDeviation(j.shoulder, j.hip, j.ankle); });
      if (deviations.length >= 2) {
        const min = Math.min.apply(null, deviations), max = Math.max.apply(null, deviations);
        const drift = max - min;
        if (drift > 0.12) {
          results.push(finding("warn", "Hip position looks like it drifted during the hold", "Your line changed noticeably over the clip — often a sign of fatigue setting in. Might be worth holding for a bit less time with better form rather than longer with more sag."));
        } else {
          results.push(finding("good", "Hip position looks stable through the hold", "Your line didn't change much across the clip."));
        }
      } else {
        results.push(finding("info", "Couldn't track your line through enough of the clip to check for drift", "Try a clip with your shoulder, hip, and ankle visible for the whole hold."));
      }
    } else {
      results.push(finding("info", "Take a video (not just a photo) to check whether your hold stays stable", "A single photo can't show whether your hips drift as the hold goes on."));
    }

    return results;
  }

  const ANALYZERS = {
    squat: analyzeSquat, deadlift: analyzeDeadlift, pushup: analyzePushup, benchpress: analyzeBenchPress,
    latpulldown: analyzeLatPulldown, tricepextension: analyzeOverheadTricepExtension,
    preachercurl: analyzePreacherCurl, row: analyzeRow,
    overheadpress: analyzeOverheadPress, bicepcurl: analyzeBicepCurl, lunge: analyzeLunge, plank: analyzePlank
  };

  /* ---------------- video: picking the moment to analyze ----------------
     Pure functions, deliberately separated from the actual video-decoding
     loop below so the SELECTION logic (the part most likely to have a
     subtle bug) can be unit-tested with synthetic keypoint sequences,
     without needing a real video file or the ML model. */

  // Higher = a better candidate frame for that exercise; null = not usable
  // (no confident reading). Squat: prefer the deepest point of the rep.
  // Push-up/bench press: prefer the most-bent-elbow frame (the bottom of the
  // rep), scored as -elbowAngle so a smaller angle (more bent) wins. Deadlift
  // only has one meaningful moment to check (the setup), so every confident
  // frame scores the same and pickBestFrame just takes the first.
  function scoreFrameForExercise(keypoints, exercise) {
    const map = keypointMap(keypoints);
    if (exercise === "squat") {
      const side = pickSide(map);
      if (!side) return null;
      const thighLength = dist(side.hip, side.knee);
      return thighLength > 0 ? (side.hip.y - side.knee.y) / thighLength : null;
    }
    if (exercise === "pushup") {
      const side = pickSide(map);
      if (!side) return null;
      const elbow = map[side.side + "_elbow"], wrist = map[side.side + "_wrist"];
      if (!elbow || !wrist || elbow.score < MIN_KEYPOINT_SCORE || wrist.score < MIN_KEYPOINT_SCORE) return null;
      const elbowAngle = angleAt(side.shoulder, elbow, wrist);
      return elbowAngle === null ? null : -elbowAngle;
    }
    if (exercise === "benchpress" || exercise === "tricepextension" || exercise === "preachercurl" || exercise === "row" || exercise === "bicepcurl") {
      const armSide = pickSide(map, ["shoulder", "elbow", "wrist"]);
      if (!armSide) return null;
      const elbowAngle = angleAt(armSide.shoulder, armSide.elbow, armSide.wrist);
      return elbowAngle === null ? null : -elbowAngle;
    }
    if (exercise === "latpulldown") {
      const side = pickSide(map, ["shoulder", "hip"]);
      if (!side) return null;
      const lean = angleFromVertical(side.hip, side.shoulder);
      return lean === null ? null : lean;
    }
    // Overhead press: prefer the top of the press (straightest elbow,
    // closest to lockout) — that's where forward bar drift and back-arching
    // compensation are most visible.
    if (exercise === "overheadpress") {
      const armSide = pickSide(map, ["shoulder", "elbow", "wrist"]);
      if (!armSide) return null;
      const elbowAngle = angleAt(armSide.shoulder, armSide.elbow, armSide.wrist);
      return elbowAngle;
    }
    // Lunge: prefer the deepest point (most-bent front knee).
    if (exercise === "lunge") {
      const side = pickSide(map);
      if (!side) return null;
      const kneeAngle = angleAt(side.hip, side.knee, side.ankle);
      return kneeAngle === null ? null : -kneeAngle;
    }
    // Plank: prefer the frame with the most hip sag/pike — the most
    // actionable moment to flag, same logic as scoring a squat's depth.
    if (exercise === "plank") {
      const side = pickSide(map, ["shoulder", "hip", "ankle"]);
      if (!side) return null;
      return Math.abs(plankHipDeviation(side.shoulder, side.hip, side.ankle));
    }
    const side = pickSide(map);
    return side ? 0 : null;
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
    const pickHighestScore = [
      "squat", "pushup", "benchpress", "latpulldown", "tricepextension", "preachercurl", "row",
      "overheadpress", "bicepcurl", "lunge", "plank"
    ];
    if (pickHighestScore.indexOf(exercise) !== -1) {
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

  // Renders the single winning frame at full resolution once the best
  // moment has been picked — shared by both sampling strategies below.
  function finalizeChosenFrame(video, samples, exercise, totalSamples) {
    const chosen = pickBestFrame(samples, exercise);
    if (!chosen) return Promise.resolve(null);
    return seekVideoTo(video, chosen.time).then(function () {
      const finalCanvas = document.createElement("canvas");
      finalCanvas.width = video.videoWidth;
      finalCanvas.height = video.videoHeight;
      finalCanvas.getContext("2d").drawImage(video, 0, 0);
      return {
        time: chosen.time, keypoints: chosen.keypoints, canvas: finalCanvas,
        totalSamples: totalSamples, confidentSamples: samples.length,
        allKeypoints: samples.map(function (s) { return s.keypoints; })
      };
    });
  }

  // FAST PATH: plays the clip through (at VIDEO_PLAYBACK_RATE) and grabs
  // whatever frame the browser is actually about to display via
  // requestVideoFrameCallback, instead of separately seeking to ~50 fixed
  // timestamps. Repeated seeking is the slow part — each one forces the
  // decoder back to a keyframe and forward again — so letting the video
  // decode forward naturally, the way it's built to, is dramatically
  // faster (seconds instead of the 20-30+ seconds the old seek-per-sample
  // approach could take on a real clip, especially on a phone).
  // Needs requestVideoFrameCallback (Chrome/Edge/Android browsers, Safari
  // 15.4+) — sampleVideoFrames() below falls back to seeking without it.
  function sampleVideoFramesByPlayback(video, exercise, det, onStatus) {
    return new Promise(function (resolve, reject) {
      const duration = Math.min(video.duration || 0, VIDEO_MAX_DURATION_SEC);
      const scratch = document.createElement("canvas");
      scratch.width = video.videoWidth;
      scratch.height = video.videoHeight;
      const scratchCtx = scratch.getContext("2d");
      const samples = [];
      let frameCount = 0;
      let done = false;
      let busy = false;

      function finish() {
        if (done) return;
        done = true;
        video.pause();
        video.playbackRate = 1;
        finalizeChosenFrame(video, samples, exercise, frameCount).then(resolve, reject);
      }

      function onFrame(now, metadata) {
        if (done) return;
        if (metadata.mediaTime > duration || video.ended) { finish(); return; }
        if (busy) { video.requestVideoFrameCallback(onFrame); return; } // still processing the previous frame — skip ahead rather than queue up
        busy = true;
        frameCount++;
        onStatus("Scanning your clip… (frame " + frameCount + ")");
        scratchCtx.drawImage(video, 0, 0, scratch.width, scratch.height);
        det.estimatePoses(scratch).then(function (poses) {
          if (poses && poses[0] && poses[0].keypoints) {
            samples.push({ time: metadata.mediaTime, keypoints: poses[0].keypoints });
          }
        }).catch(function () { /* skip this frame, keep going */ }).then(function () {
          busy = false;
          if (!done) video.requestVideoFrameCallback(onFrame);
        });
      }

      video.addEventListener("ended", finish, { once: true });
      video.playbackRate = VIDEO_PLAYBACK_RATE;
      video.currentTime = 0;
      video.play().then(function () {
        video.requestVideoFrameCallback(onFrame);
      }).catch(reject);
    });
  }

  // FALLBACK PATH for browsers without requestVideoFrameCallback: the
  // original fixed-interval seek approach — slower, but works everywhere.
  function sampleVideoFramesBySeeking(video, exercise, det, onStatus) {
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
      return finalizeChosenFrame(video, samples, exercise, times.length);
    });
  }

  function sampleVideoFrames(video, exercise, det, onStatus) {
    if (typeof video.requestVideoFrameCallback === "function") {
      return sampleVideoFramesByPlayback(video, exercise, det, onStatus)
        .catch(function () {
          video.pause();
          video.playbackRate = 1;
          return sampleVideoFramesBySeeking(video, exercise, det, onStatus);
        });
    }
    return sampleVideoFramesBySeeking(video, exercise, det, onStatus);
  }

  /* ---------------- history (saved past checks) ----------------
     Each completed check (with at least one finding) is saved locally so
     progress and recurring issues are visible over time, not just in the
     moment. Only a small resized thumbnail (with the skeleton overlay
     already drawn on it) is kept, not the original photo/video, to keep
     localStorage usage bounded; entries are also capped at
     MAX_HISTORY_ENTRIES, oldest first out. */

  const HISTORY_KEY = "jarvisFormCheckHistory";
  const MAX_HISTORY_ENTRIES = 20;
  const THUMBNAIL_MAX_WIDTH = 160;
  let openHistoryId = null;

  function loadHistory() {
    return window.JarvisCore.loadJSON(HISTORY_KEY, []);
  }

  function saveHistoryList(list) {
    window.JarvisCore.saveJSON(HISTORY_KEY, list);
  }

  function addHistoryEntry(entry) {
    const list = loadHistory();
    list.unshift(entry);
    if (list.length > MAX_HISTORY_ENTRIES) list.length = MAX_HISTORY_ENTRIES;
    saveHistoryList(list);
    renderHistory();
  }

  function deleteHistoryEntry(id) {
    saveHistoryList(loadHistory().filter(function (e) { return e.id !== id; }));
    if (openHistoryId === id) openHistoryId = null;
    renderHistory();
  }

  function clearHistory() {
    saveHistoryList([]);
    openHistoryId = null;
    renderHistory();
  }

  function makeThumbnail(canvas) {
    const scale = Math.min(1, THUMBNAIL_MAX_WIDTH / canvas.width);
    const w = Math.max(1, Math.round(canvas.width * scale));
    const h = Math.max(1, Math.round(canvas.height * scale));
    const thumb = document.createElement("canvas");
    thumb.width = w;
    thumb.height = h;
    thumb.getContext("2d").drawImage(canvas, 0, 0, w, h);
    return thumb.toDataURL("image/jpeg", 0.6);
  }

  function buildSummaryLine(results) {
    if (!results || !results.length) return "";
    let good = 0, warn = 0, info = 0;
    results.forEach(function (r) {
      if (r.status === "good") good++;
      else if (r.status === "warn") warn++;
      else info++;
    });
    const parts = [];
    if (good) parts.push(good + " good");
    if (warn) parts.push(warn + " to look at");
    if (info) parts.push(info + " for context");
    return parts.join(" · ");
  }

  function renderHistoryDetail(entry) {
    const core = window.JarvisCore;
    const summary = buildSummaryLine(entry.results);
    const findingsHtml = (entry.results || []).map(function (r) {
      const cls = r.status === "good" ? "badge-green" : r.status === "warn" ? "badge-yellow" : "badge-neutral";
      return (
        '<div class="list-item" style="margin-top:8px;">' +
          '<span class="badge ' + cls + '">' + core.escapeHtml(r.label) + '</span>' +
          '<p class="field-hint" style="margin-top:6px;">' + core.escapeHtml(r.detail) + '</p>' +
        '</div>'
      );
    }).join("");
    return (
      '<div class="form-check-history-detail">' +
        '<img src="' + entry.thumbnail + '" alt="" style="max-width:100%;border-radius:8px;">' +
        (entry.note ? '<p class="field-hint" style="margin-top:8px;">' + core.escapeHtml(entry.note) + '</p>' : "") +
        (summary ? '<p class="list-item-meta" style="margin-top:8px;">' + core.escapeHtml(summary) + '</p>' : "") +
        findingsHtml +
      '</div>'
    );
  }

  function renderHistory() {
    const container = $("formCheckHistoryList");
    if (!container) return;
    const core = window.JarvisCore;
    const list = loadHistory();
    const clearBtn = $("formCheckClearHistoryBtn");
    if (clearBtn) clearBtn.classList.toggle("hidden", list.length === 0);
    if (list.length === 0) {
      container.innerHTML = '<div class="empty-state">No checks saved yet — run an analysis above and it will show up here.</div>';
      return;
    }
    container.innerHTML = list.map(function (entry) {
      const summary = buildSummaryLine(entry.results);
      return (
        '<div class="list-item">' +
          '<div class="list-item-row">' +
            '<img class="form-check-history-thumb history-toggle-btn" data-id="' + core.escapeHtml(entry.id) + '" src="' + entry.thumbnail + '" alt="">' +
            '<div class="list-item-main history-toggle-btn" data-id="' + core.escapeHtml(entry.id) + '" style="cursor:pointer;">' +
              '<span class="list-item-title">' + core.escapeHtml(entry.exerciseLabel) + '</span>' +
              '<span class="list-item-meta">' + core.escapeHtml(core.formatDateTime(entry.timestamp)) + '</span>' +
              (summary ? '<span class="list-item-meta">' + core.escapeHtml(summary) + '</span>' : "") +
            '</div>' +
            '<div class="list-item-actions">' +
              '<button type="button" class="btn-icon danger history-delete-btn" data-id="' + core.escapeHtml(entry.id) + '">Delete</button>' +
            '</div>' +
          '</div>' +
          (openHistoryId === entry.id ? renderHistoryDetail(entry) : "") +
        '</div>'
      );
    }).join("");
  }

  function handleHistoryListClick(e) {
    const delBtn = e.target.closest(".history-delete-btn");
    if (delBtn) {
      if (window.confirm("Delete this saved check?")) deleteHistoryEntry(delBtn.getAttribute("data-id"));
      return;
    }
    const toggle = e.target.closest(".history-toggle-btn");
    if (toggle) {
      const id = toggle.getAttribute("data-id");
      openHistoryId = openHistoryId === id ? null : id;
      renderHistory();
    }
  }

  function handleClearHistoryClick() {
    if (window.confirm("Clear all saved Form Check history?")) clearHistory();
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
    const summary = buildSummaryLine(results);
    const items = results.map(function (r) {
      const cls = r.status === "good" ? "badge-green" : r.status === "warn" ? "badge-yellow" : "badge-neutral";
      return (
        '<div class="list-item">' +
          '<span class="badge ' + cls + '">' + core.escapeHtml(r.label) + '</span>' +
          '<p class="field-hint" style="margin-top:6px;">' + core.escapeHtml(r.detail) + '</p>' +
        '</div>'
      );
    }).join("");
    container.innerHTML = (summary ? '<p class="list-item-meta" style="margin-bottom:8px;">' + core.escapeHtml(summary) + '</p>' : "") + items;
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
            note: "Used the frame at " + result.time.toFixed(1) + "s (found a clear reading in " + result.confidentSamples + " of " + result.totalSamples + " sampled frames).",
            allFrames: result.allKeypoints
          };
        });
      }
      setStatus("Analyzing…");
      return d.estimatePoses(currentImage).then(function (poses) {
        if (!poses || !poses[0] || !poses[0].keypoints) return null;
        return { keypoints: poses[0].keypoints, source: currentImage, note: null, allFrames: null };
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
      const results = analyzer ? analyzer(analysis.keypoints, analysis.allFrames) : [];
      renderResults(results);
      const baseStatus = results.length ? "" : "Detected a person, but couldn't get confident readings for this check — try a clearer angle.";
      setStatus([analysis.note, baseStatus].filter(Boolean).join(" "));

      if (results.length) {
        const select = $("formCheckExerciseSelect");
        const exerciseLabel = (select && select.selectedOptions[0] && select.selectedOptions[0].textContent) || exercise;
        addHistoryEntry({
          id: window.JarvisCore.uid("formcheck"),
          exercise: exercise,
          exerciseLabel: exerciseLabel,
          timestamp: new Date().toISOString(),
          thumbnail: makeThumbnail($("formCheckCanvas")),
          note: analysis.note || null,
          results: results
        });
      }
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
    const historyList = $("formCheckHistoryList");
    if (historyList) historyList.addEventListener("click", handleHistoryListClick);
    const clearHistoryBtn = $("formCheckClearHistoryBtn");
    if (clearHistoryBtn) clearHistoryBtn.addEventListener("click", handleClearHistoryClick);
    renderHistory();
  }

  window.JarvisFormCheck = {
    init: init,
    // exposed for testing only — geometry is pure and independent of the ML model
    _internal: {
      angleAt: angleAt, angleFromVertical: angleFromVertical, dist: dist,
      analyzeSquat: analyzeSquat, analyzeDeadlift: analyzeDeadlift,
      analyzePushup: analyzePushup, analyzeBenchPress: analyzeBenchPress,
      analyzeLatPulldown: analyzeLatPulldown, analyzeOverheadTricepExtension: analyzeOverheadTricepExtension,
      analyzePreacherCurl: analyzePreacherCurl, analyzeRow: analyzeRow,
      analyzeOverheadPress: analyzeOverheadPress, analyzeBicepCurl: analyzeBicepCurl,
      analyzeLunge: analyzeLunge, analyzePlank: analyzePlank, plankHipDeviation: plankHipDeviation,
      pickSide: pickSide, keypointMap: keypointMap,
      scoreFrameForExercise: scoreFrameForExercise, pickBestFrame: pickBestFrame,
      sampleVideoFrames: sampleVideoFrames, sampleVideoFramesByPlayback: sampleVideoFramesByPlayback,
      sampleVideoFramesBySeeking: sampleVideoFramesBySeeking,
      buildSummaryLine: buildSummaryLine, loadHistory: loadHistory, addHistoryEntry: addHistoryEntry,
      deleteHistoryEntry: deleteHistoryEntry, clearHistory: clearHistory
    }
  };
})();
