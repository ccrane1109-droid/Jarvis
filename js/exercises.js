/* ==========================================================================
   JARVIS — exercise library + strength standards
   Pure data/helpers, no DOM access. Exposes window.JarvisExercises.

   Strength standards note: the ratios below are approximate, commonly
   referenced bodyweight-ratio benchmarks (the same style of numbers used by
   sites like ExRx.net and StrengthLevel.com) for five well-studied lifts.
   They are general context for motivation, not a precise or scientific
   measurement — different sources disagree by a fair margin. Every other
   exercise in the library gets personal progress tracking (estimated 1RM
   and trend) instead of a population comparison, since no reliable
   standard exists for most accessory movements.
   ========================================================================== */

(function () {
  "use strict";

  const MUSCLE_GROUPS = [
    "Chest", "Back", "Shoulders", "Biceps", "Triceps",
    "Quadriceps", "Hamstrings", "Glutes", "Calves",
    "Abs / Core", "Forearms", "Traps"
  ];

  const EQUIPMENT_TYPES = ["Free Weight", "Machine", "Cable", "Bodyweight"];

  // benchmarkKey links an exercise to STRENGTH_STANDARDS below.
  const EXERCISES = [
    // Chest
    { id: "bench-press-barbell", name: "Barbell Bench Press", muscleGroup: "Chest", equipment: "Free Weight", benchmarkKey: "bench" },
    { id: "bench-press-dumbbell", name: "Dumbbell Bench Press", muscleGroup: "Chest", equipment: "Free Weight" },
    { id: "incline-bench-barbell", name: "Incline Barbell Bench Press", muscleGroup: "Chest", equipment: "Free Weight" },
    { id: "incline-bench-dumbbell", name: "Incline Dumbbell Press", muscleGroup: "Chest", equipment: "Free Weight" },
    { id: "chest-press-machine", name: "Chest Press Machine", muscleGroup: "Chest", equipment: "Machine" },
    { id: "pec-deck", name: "Pec Deck / Chest Fly Machine", muscleGroup: "Chest", equipment: "Machine" },
    { id: "cable-crossover", name: "Cable Crossover", muscleGroup: "Chest", equipment: "Cable" },
    { id: "push-up", name: "Push-Up", muscleGroup: "Chest", equipment: "Bodyweight" },
    { id: "dip-chest", name: "Dip", muscleGroup: "Chest", equipment: "Bodyweight" },

    // Back
    { id: "deadlift-barbell", name: "Barbell Deadlift", muscleGroup: "Back", equipment: "Free Weight", benchmarkKey: "deadlift" },
    { id: "barbell-row", name: "Barbell Row", muscleGroup: "Back", equipment: "Free Weight" },
    { id: "dumbbell-row", name: "Single-Arm Dumbbell Row", muscleGroup: "Back", equipment: "Free Weight" },
    { id: "lat-pulldown", name: "Lat Pulldown", muscleGroup: "Back", equipment: "Cable" },
    { id: "seated-cable-row", name: "Seated Cable Row", muscleGroup: "Back", equipment: "Cable" },
    { id: "t-bar-row", name: "T-Bar Row", muscleGroup: "Back", equipment: "Machine" },
    { id: "pull-up", name: "Pull-Up", muscleGroup: "Back", equipment: "Bodyweight", benchmarkKey: "pullup" },
    { id: "chin-up", name: "Chin-Up", muscleGroup: "Back", equipment: "Bodyweight" },
    { id: "back-extension", name: "Back Extension", muscleGroup: "Back", equipment: "Bodyweight" },

    // Shoulders
    { id: "overhead-press-barbell", name: "Barbell Overhead Press", muscleGroup: "Shoulders", equipment: "Free Weight", benchmarkKey: "ohp" },
    { id: "shoulder-press-dumbbell", name: "Dumbbell Shoulder Press", muscleGroup: "Shoulders", equipment: "Free Weight" },
    { id: "shoulder-press-machine", name: "Machine Shoulder Press", muscleGroup: "Shoulders", equipment: "Machine" },
    { id: "lateral-raise-dumbbell", name: "Dumbbell Lateral Raise", muscleGroup: "Shoulders", equipment: "Free Weight" },
    { id: "lateral-raise-cable", name: "Cable Lateral Raise", muscleGroup: "Shoulders", equipment: "Cable" },
    { id: "front-raise", name: "Front Raise", muscleGroup: "Shoulders", equipment: "Free Weight" },
    { id: "rear-delt-fly", name: "Rear Delt Fly", muscleGroup: "Shoulders", equipment: "Machine" },
    { id: "arnold-press", name: "Arnold Press", muscleGroup: "Shoulders", equipment: "Free Weight" },

    // Biceps
    { id: "barbell-curl", name: "Barbell Curl", muscleGroup: "Biceps", equipment: "Free Weight" },
    { id: "dumbbell-curl", name: "Dumbbell Curl", muscleGroup: "Biceps", equipment: "Free Weight" },
    { id: "hammer-curl", name: "Hammer Curl", muscleGroup: "Biceps", equipment: "Free Weight" },
    { id: "cable-curl", name: "Cable Curl", muscleGroup: "Biceps", equipment: "Cable" },
    { id: "preacher-curl-machine", name: "Preacher Curl Machine", muscleGroup: "Biceps", equipment: "Machine" },
    { id: "concentration-curl", name: "Concentration Curl", muscleGroup: "Biceps", equipment: "Free Weight" },

    // Triceps
    { id: "close-grip-bench", name: "Close-Grip Bench Press", muscleGroup: "Triceps", equipment: "Free Weight" },
    { id: "triceps-pushdown", name: "Triceps Pushdown", muscleGroup: "Triceps", equipment: "Cable" },
    { id: "overhead-triceps-extension", name: "Overhead Triceps Extension", muscleGroup: "Triceps", equipment: "Free Weight" },
    { id: "triceps-dip-machine", name: "Triceps Dip Machine", muscleGroup: "Triceps", equipment: "Machine" },
    { id: "skull-crusher", name: "Skull Crusher", muscleGroup: "Triceps", equipment: "Free Weight" },
    { id: "dip-triceps", name: "Bodyweight Triceps Dip", muscleGroup: "Triceps", equipment: "Bodyweight" },

    // Quadriceps
    { id: "back-squat-barbell", name: "Barbell Back Squat", muscleGroup: "Quadriceps", equipment: "Free Weight", benchmarkKey: "squat" },
    { id: "front-squat-barbell", name: "Barbell Front Squat", muscleGroup: "Quadriceps", equipment: "Free Weight" },
    { id: "leg-press", name: "Leg Press", muscleGroup: "Quadriceps", equipment: "Machine" },
    { id: "leg-extension", name: "Leg Extension", muscleGroup: "Quadriceps", equipment: "Machine" },
    { id: "bulgarian-split-squat", name: "Bulgarian Split Squat", muscleGroup: "Quadriceps", equipment: "Free Weight" },
    { id: "walking-lunge", name: "Walking Lunge", muscleGroup: "Quadriceps", equipment: "Free Weight" },
    { id: "hack-squat-machine", name: "Hack Squat Machine", muscleGroup: "Quadriceps", equipment: "Machine" },
    { id: "bodyweight-squat", name: "Bodyweight Squat", muscleGroup: "Quadriceps", equipment: "Bodyweight" },

    // Hamstrings
    { id: "romanian-deadlift", name: "Romanian Deadlift", muscleGroup: "Hamstrings", equipment: "Free Weight" },
    { id: "leg-curl-machine", name: "Leg Curl Machine", muscleGroup: "Hamstrings", equipment: "Machine" },
    { id: "good-morning", name: "Good Morning", muscleGroup: "Hamstrings", equipment: "Free Weight" },
    { id: "glute-ham-raise", name: "Glute-Ham Raise", muscleGroup: "Hamstrings", equipment: "Bodyweight" },
    { id: "nordic-curl", name: "Nordic Curl", muscleGroup: "Hamstrings", equipment: "Bodyweight" },

    // Glutes
    { id: "hip-thrust", name: "Barbell Hip Thrust", muscleGroup: "Glutes", equipment: "Free Weight" },
    { id: "glute-bridge", name: "Glute Bridge", muscleGroup: "Glutes", equipment: "Bodyweight" },
    { id: "cable-kickback", name: "Cable Glute Kickback", muscleGroup: "Glutes", equipment: "Cable" },
    { id: "step-up", name: "Step-Up", muscleGroup: "Glutes", equipment: "Free Weight" },
    { id: "hip-abduction-machine", name: "Hip Abduction Machine", muscleGroup: "Glutes", equipment: "Machine" },

    // Calves
    { id: "standing-calf-raise-machine", name: "Standing Calf Raise Machine", muscleGroup: "Calves", equipment: "Machine" },
    { id: "seated-calf-raise-machine", name: "Seated Calf Raise Machine", muscleGroup: "Calves", equipment: "Machine" },
    { id: "calf-raise-dumbbell", name: "Dumbbell Calf Raise", muscleGroup: "Calves", equipment: "Free Weight" },
    { id: "calf-raise-bodyweight", name: "Bodyweight Calf Raise", muscleGroup: "Calves", equipment: "Bodyweight" },

    // Abs / Core
    { id: "plank", name: "Plank", muscleGroup: "Abs / Core", equipment: "Bodyweight" },
    { id: "hanging-leg-raise", name: "Hanging Leg Raise", muscleGroup: "Abs / Core", equipment: "Bodyweight" },
    { id: "cable-crunch", name: "Cable Crunch", muscleGroup: "Abs / Core", equipment: "Cable" },
    { id: "ab-crunch-machine", name: "Ab Crunch Machine", muscleGroup: "Abs / Core", equipment: "Machine" },
    { id: "russian-twist", name: "Russian Twist", muscleGroup: "Abs / Core", equipment: "Bodyweight" },
    { id: "sit-up", name: "Sit-Up", muscleGroup: "Abs / Core", equipment: "Bodyweight" },

    // Forearms
    { id: "wrist-curl", name: "Wrist Curl", muscleGroup: "Forearms", equipment: "Free Weight" },
    { id: "reverse-wrist-curl", name: "Reverse Wrist Curl", muscleGroup: "Forearms", equipment: "Free Weight" },
    { id: "farmers-carry", name: "Farmer's Carry", muscleGroup: "Forearms", equipment: "Free Weight" },

    // Traps
    { id: "barbell-shrug", name: "Barbell Shrug", muscleGroup: "Traps", equipment: "Free Weight" },
    { id: "dumbbell-shrug", name: "Dumbbell Shrug", muscleGroup: "Traps", equipment: "Free Weight" },
    { id: "cable-shrug", name: "Cable Shrug", muscleGroup: "Traps", equipment: "Cable" }
  ];

  // Approximate bodyweight-ratio standards (load / bodyweight). See file header.
  // Order: [Beginner, Novice, Intermediate, Advanced, Elite]
  const STRENGTH_STANDARDS = {
    squat: {
      label: "Barbell Back Squat",
      male: [0.5, 0.75, 1.25, 1.75, 2.25],
      female: [0.4, 0.6, 0.9, 1.25, 1.6]
    },
    bench: {
      label: "Barbell Bench Press",
      male: [0.5, 0.75, 1.0, 1.5, 2.0],
      female: [0.25, 0.4, 0.6, 0.9, 1.25]
    },
    deadlift: {
      label: "Barbell Deadlift",
      male: [0.75, 1.25, 1.75, 2.25, 2.75],
      female: [0.6, 1.0, 1.4, 1.8, 2.25]
    },
    ohp: {
      label: "Barbell Overhead Press",
      male: [0.35, 0.55, 0.8, 1.1, 1.4],
      female: [0.2, 0.35, 0.5, 0.7, 0.9]
    },
    pullup: {
      label: "Pull-Up",
      male: [1.0, 1.15, 1.35, 1.6, 2.0],
      female: [0.85, 1.0, 1.15, 1.35, 1.6]
    }
  };

  const LEVEL_LABELS = ["Beginner", "Novice", "Intermediate", "Advanced", "Elite"];

  function getExercises() {
    return EXERCISES.slice();
  }

  function getExerciseById(id) {
    return EXERCISES.find(function (e) { return e.id === id; }) || null;
  }

  function getBenchmarkExercises() {
    return EXERCISES.filter(function (e) { return !!e.benchmarkKey; });
  }

  // Epley formula: a standard, widely-used estimate — most reliable under ~12 reps.
  function estimateOneRepMax(weight, reps) {
    const w = Number(weight), r = Number(reps);
    if (!isFinite(w) || !isFinite(r) || w < 0 || r <= 0) return 0;
    if (r === 1) return w;
    return w * (1 + r / 30);
  }

  // Returns { score: 0-100, level: 'Beginner'..'Elite', ratio } or null if ratio is 0/invalid.
  function scoreForRatio(ratio, thresholds) {
    if (!isFinite(ratio) || ratio <= 0) return { score: 0, level: null, ratio: 0 };
    const bounds = [0].concat(thresholds); // 6 points -> 5 bands, scores 0/20/40/60/80/100
    if (ratio >= bounds[5]) return { score: 100, level: "Elite", ratio: ratio };
    for (let i = 0; i < 5; i++) {
      const lo = bounds[i], hi = bounds[i + 1];
      if (ratio >= lo && ratio < hi) {
        const bandScore = i * 20;
        const frac = (ratio - lo) / (hi - lo);
        const score = bandScore + frac * 20;
        const level = i === 0 ? null : LEVEL_LABELS[i - 1];
        return { score: score, level: level, ratio: ratio };
      }
    }
    return { score: 0, level: null, ratio: ratio };
  }

  // sex: 'male' | 'female'. Returns null if the benchmarkKey/sex combo is unknown.
  function getStandard(benchmarkKey, sex) {
    const s = STRENGTH_STANDARDS[benchmarkKey];
    if (!s) return null;
    const thresholds = sex === "female" ? s.female : s.male;
    return { label: s.label, thresholds: thresholds };
  }

  window.JarvisExercises = {
    MUSCLE_GROUPS: MUSCLE_GROUPS,
    EQUIPMENT_TYPES: EQUIPMENT_TYPES,
    LEVEL_LABELS: LEVEL_LABELS,
    getExercises: getExercises,
    getExerciseById: getExerciseById,
    getBenchmarkExercises: getBenchmarkExercises,
    estimateOneRepMax: estimateOneRepMax,
    scoreForRatio: scoreForRatio,
    getStandard: getStandard
  };
})();
