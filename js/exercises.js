/* ==========================================================================
   JARVIS — exercise library + strength standards
   Pure data/helpers, no DOM access. Exposes window.JarvisExercises.

   localStorage keys:
     jarvisCustomExercises  — user-added exercises, merged into the library
     jarvisFavoriteExercises — starred exercise ids (built-in or custom)

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

  const LS_CUSTOM = "jarvisCustomExercises";
  const LS_FAVORITES = "jarvisFavoriteExercises";

  const MUSCLE_GROUPS = [
    "Chest", "Back", "Shoulders", "Biceps", "Triceps",
    "Quadriceps", "Hamstrings", "Glutes", "Calves",
    "Abs / Core", "Forearms", "Traps", "Full Body", "Cardio"
  ];

  const EQUIPMENT_TYPES = ["Free Weight", "Machine", "Cable", "Bodyweight", "Cardio Equipment"];

  // benchmarkKey links an exercise to STRENGTH_STANDARDS below.
  const EXERCISES = [
    // Chest
    { id: "bench-press-barbell", name: "Barbell Bench Press", muscleGroup: "Chest", equipment: "Free Weight", benchmarkKey: "bench" },
    { id: "bench-press-dumbbell", name: "Dumbbell Bench Press", muscleGroup: "Chest", equipment: "Free Weight" },
    { id: "incline-bench-barbell", name: "Incline Barbell Bench Press", muscleGroup: "Chest", equipment: "Free Weight" },
    { id: "incline-bench-dumbbell", name: "Incline Dumbbell Press", muscleGroup: "Chest", equipment: "Free Weight" },
    { id: "decline-bench-barbell", name: "Decline Barbell Bench Press", muscleGroup: "Chest", equipment: "Free Weight" },
    { id: "decline-bench-dumbbell", name: "Decline Dumbbell Press", muscleGroup: "Chest", equipment: "Free Weight" },
    { id: "dumbbell-fly", name: "Dumbbell Fly", muscleGroup: "Chest", equipment: "Free Weight" },
    { id: "incline-cable-fly", name: "Incline Cable Fly", muscleGroup: "Chest", equipment: "Cable" },
    { id: "low-cable-fly", name: "Low-to-High Cable Fly", muscleGroup: "Chest", equipment: "Cable" },
    { id: "chest-press-machine", name: "Chest Press Machine", muscleGroup: "Chest", equipment: "Machine" },
    { id: "pec-deck", name: "Pec Deck / Chest Fly Machine", muscleGroup: "Chest", equipment: "Machine" },
    { id: "cable-crossover", name: "Cable Crossover", muscleGroup: "Chest", equipment: "Cable" },
    { id: "svend-press", name: "Svend Press", muscleGroup: "Chest", equipment: "Free Weight" },
    { id: "push-up", name: "Push-Up", muscleGroup: "Chest", equipment: "Bodyweight" },
    { id: "dip-chest", name: "Dip", muscleGroup: "Chest", equipment: "Bodyweight" },

    // Back
    { id: "deadlift-barbell", name: "Barbell Deadlift", muscleGroup: "Back", equipment: "Free Weight", benchmarkKey: "deadlift" },
    { id: "sumo-deadlift", name: "Sumo Deadlift", muscleGroup: "Back", equipment: "Free Weight" },
    { id: "deficit-deadlift", name: "Deficit Deadlift", muscleGroup: "Back", equipment: "Free Weight" },
    { id: "rack-pull", name: "Rack Pull", muscleGroup: "Back", equipment: "Free Weight" },
    { id: "barbell-row", name: "Barbell Row", muscleGroup: "Back", equipment: "Free Weight" },
    { id: "pendlay-row", name: "Pendlay Row", muscleGroup: "Back", equipment: "Free Weight" },
    { id: "meadows-row", name: "Meadows Row", muscleGroup: "Back", equipment: "Free Weight" },
    { id: "dumbbell-row", name: "Single-Arm Dumbbell Row", muscleGroup: "Back", equipment: "Free Weight" },
    { id: "chest-supported-row", name: "Chest-Supported Row", muscleGroup: "Back", equipment: "Machine" },
    { id: "lat-pulldown", name: "Lat Pulldown", muscleGroup: "Back", equipment: "Cable" },
    { id: "straight-arm-pulldown", name: "Straight-Arm Pulldown", muscleGroup: "Back", equipment: "Cable" },
    { id: "cable-pullover", name: "Cable Pullover", muscleGroup: "Back", equipment: "Cable" },
    { id: "seated-cable-row", name: "Seated Cable Row", muscleGroup: "Back", equipment: "Cable" },
    { id: "t-bar-row", name: "T-Bar Row", muscleGroup: "Back", equipment: "Machine" },
    { id: "landmine-row", name: "Landmine Row", muscleGroup: "Back", equipment: "Free Weight" },
    { id: "pull-up", name: "Pull-Up", muscleGroup: "Back", equipment: "Bodyweight", benchmarkKey: "pullup" },
    { id: "chin-up", name: "Chin-Up", muscleGroup: "Back", equipment: "Bodyweight" },
    { id: "inverted-row", name: "Inverted Row", muscleGroup: "Back", equipment: "Bodyweight" },
    { id: "back-extension", name: "Back Extension", muscleGroup: "Back", equipment: "Bodyweight" },

    // Shoulders
    { id: "overhead-press-barbell", name: "Barbell Overhead Press", muscleGroup: "Shoulders", equipment: "Free Weight", benchmarkKey: "ohp" },
    { id: "shoulder-press-dumbbell", name: "Dumbbell Shoulder Press", muscleGroup: "Shoulders", equipment: "Free Weight" },
    { id: "behind-neck-press", name: "Behind-the-Neck Press", muscleGroup: "Shoulders", equipment: "Free Weight" },
    { id: "landmine-press", name: "Landmine Press", muscleGroup: "Shoulders", equipment: "Free Weight" },
    { id: "shoulder-press-machine", name: "Machine Shoulder Press", muscleGroup: "Shoulders", equipment: "Machine" },
    { id: "lateral-raise-dumbbell", name: "Dumbbell Lateral Raise", muscleGroup: "Shoulders", equipment: "Free Weight" },
    { id: "lateral-raise-cable", name: "Cable Lateral Raise", muscleGroup: "Shoulders", equipment: "Cable" },
    { id: "lateral-raise-machine", name: "Machine Lateral Raise", muscleGroup: "Shoulders", equipment: "Machine" },
    { id: "front-raise", name: "Front Raise", muscleGroup: "Shoulders", equipment: "Free Weight" },
    { id: "cable-front-raise", name: "Cable Front Raise", muscleGroup: "Shoulders", equipment: "Cable" },
    { id: "rear-delt-fly", name: "Rear Delt Fly", muscleGroup: "Shoulders", equipment: "Machine" },
    { id: "cable-rear-delt-fly", name: "Cable Rear Delt Fly", muscleGroup: "Shoulders", equipment: "Cable" },
    { id: "face-pull", name: "Face Pull", muscleGroup: "Shoulders", equipment: "Cable" },
    { id: "upright-row-barbell", name: "Barbell Upright Row", muscleGroup: "Shoulders", equipment: "Free Weight" },
    { id: "upright-row-cable", name: "Cable Upright Row", muscleGroup: "Shoulders", equipment: "Cable" },
    { id: "arnold-press", name: "Arnold Press", muscleGroup: "Shoulders", equipment: "Free Weight" },

    // Biceps
    { id: "barbell-curl", name: "Barbell Curl", muscleGroup: "Biceps", equipment: "Free Weight" },
    { id: "ez-bar-curl", name: "EZ-Bar Curl", muscleGroup: "Biceps", equipment: "Free Weight" },
    { id: "dumbbell-curl", name: "Dumbbell Curl", muscleGroup: "Biceps", equipment: "Free Weight" },
    { id: "incline-dumbbell-curl", name: "Incline Dumbbell Curl", muscleGroup: "Biceps", equipment: "Free Weight" },
    { id: "hammer-curl", name: "Hammer Curl", muscleGroup: "Biceps", equipment: "Free Weight" },
    { id: "spider-curl", name: "Spider Curl", muscleGroup: "Biceps", equipment: "Free Weight" },
    { id: "drag-curl", name: "Drag Curl", muscleGroup: "Biceps", equipment: "Free Weight" },
    { id: "zottman-curl", name: "Zottman Curl", muscleGroup: "Biceps", equipment: "Free Weight" },
    { id: "cable-curl", name: "Cable Curl", muscleGroup: "Biceps", equipment: "Cable" },
    { id: "cable-rope-curl", name: "Cable Rope Hammer Curl", muscleGroup: "Biceps", equipment: "Cable" },
    { id: "reverse-curl", name: "Reverse Curl", muscleGroup: "Biceps", equipment: "Free Weight" },
    { id: "preacher-curl-machine", name: "Preacher Curl Machine", muscleGroup: "Biceps", equipment: "Machine" },
    { id: "concentration-curl", name: "Concentration Curl", muscleGroup: "Biceps", equipment: "Free Weight" },

    // Triceps
    { id: "close-grip-bench", name: "Close-Grip Bench Press", muscleGroup: "Triceps", equipment: "Free Weight" },
    { id: "jm-press", name: "JM Press", muscleGroup: "Triceps", equipment: "Free Weight" },
    { id: "triceps-pushdown", name: "Triceps Pushdown", muscleGroup: "Triceps", equipment: "Cable" },
    { id: "rope-pushdown", name: "Rope Pushdown", muscleGroup: "Triceps", equipment: "Cable" },
    { id: "single-arm-pushdown", name: "Single-Arm Pushdown", muscleGroup: "Triceps", equipment: "Cable" },
    { id: "overhead-triceps-extension", name: "Overhead Triceps Extension", muscleGroup: "Triceps", equipment: "Free Weight" },
    { id: "triceps-dip-machine", name: "Triceps Dip Machine", muscleGroup: "Triceps", equipment: "Machine" },
    { id: "skull-crusher", name: "Skull Crusher", muscleGroup: "Triceps", equipment: "Free Weight" },
    { id: "tricep-kickback", name: "Triceps Kickback", muscleGroup: "Triceps", equipment: "Free Weight" },
    { id: "dip-triceps", name: "Bodyweight Triceps Dip", muscleGroup: "Triceps", equipment: "Bodyweight" },
    { id: "bench-dip", name: "Bench Dip", muscleGroup: "Triceps", equipment: "Bodyweight" },

    // Quadriceps
    { id: "back-squat-barbell", name: "Barbell Back Squat", muscleGroup: "Quadriceps", equipment: "Free Weight", benchmarkKey: "squat" },
    { id: "front-squat-barbell", name: "Barbell Front Squat", muscleGroup: "Quadriceps", equipment: "Free Weight" },
    { id: "box-squat", name: "Box Squat", muscleGroup: "Quadriceps", equipment: "Free Weight" },
    { id: "zercher-squat", name: "Zercher Squat", muscleGroup: "Quadriceps", equipment: "Free Weight" },
    { id: "goblet-squat", name: "Goblet Squat", muscleGroup: "Quadriceps", equipment: "Free Weight" },
    { id: "smith-machine-squat", name: "Smith Machine Squat", muscleGroup: "Quadriceps", equipment: "Machine" },
    { id: "leg-press", name: "Leg Press", muscleGroup: "Quadriceps", equipment: "Machine" },
    { id: "single-leg-press", name: "Single-Leg Press", muscleGroup: "Quadriceps", equipment: "Machine" },
    { id: "leg-extension", name: "Leg Extension", muscleGroup: "Quadriceps", equipment: "Machine" },
    { id: "hack-squat-machine", name: "Hack Squat Machine", muscleGroup: "Quadriceps", equipment: "Machine" },
    { id: "bulgarian-split-squat", name: "Bulgarian Split Squat", muscleGroup: "Quadriceps", equipment: "Free Weight" },
    { id: "walking-lunge", name: "Walking Lunge", muscleGroup: "Quadriceps", equipment: "Free Weight" },
    { id: "bodyweight-squat", name: "Bodyweight Squat", muscleGroup: "Quadriceps", equipment: "Bodyweight" },
    { id: "pistol-squat", name: "Pistol Squat", muscleGroup: "Quadriceps", equipment: "Bodyweight" },
    { id: "sissy-squat", name: "Sissy Squat", muscleGroup: "Quadriceps", equipment: "Bodyweight" },

    // Hamstrings
    { id: "romanian-deadlift", name: "Romanian Deadlift", muscleGroup: "Hamstrings", equipment: "Free Weight" },
    { id: "single-leg-rdl", name: "Single-Leg Romanian Deadlift", muscleGroup: "Hamstrings", equipment: "Free Weight" },
    { id: "leg-curl-machine", name: "Lying Leg Curl Machine", muscleGroup: "Hamstrings", equipment: "Machine" },
    { id: "seated-leg-curl-machine", name: "Seated Leg Curl Machine", muscleGroup: "Hamstrings", equipment: "Machine" },
    { id: "good-morning", name: "Good Morning", muscleGroup: "Hamstrings", equipment: "Free Weight" },
    { id: "cable-pull-through", name: "Cable Pull-Through", muscleGroup: "Hamstrings", equipment: "Cable" },
    { id: "glute-ham-raise", name: "Glute-Ham Raise", muscleGroup: "Hamstrings", equipment: "Bodyweight" },
    { id: "nordic-curl", name: "Nordic Curl", muscleGroup: "Hamstrings", equipment: "Bodyweight" },

    // Glutes
    { id: "hip-thrust", name: "Barbell Hip Thrust", muscleGroup: "Glutes", equipment: "Free Weight" },
    { id: "hip-thrust-machine", name: "Hip Thrust Machine", muscleGroup: "Glutes", equipment: "Machine" },
    { id: "single-leg-hip-thrust", name: "Single-Leg Hip Thrust", muscleGroup: "Glutes", equipment: "Bodyweight" },
    { id: "glute-bridge", name: "Glute Bridge", muscleGroup: "Glutes", equipment: "Bodyweight" },
    { id: "frog-pump", name: "Frog Pump", muscleGroup: "Glutes", equipment: "Bodyweight" },
    { id: "donkey-kick", name: "Donkey Kick", muscleGroup: "Glutes", equipment: "Bodyweight" },
    { id: "cable-kickback", name: "Cable Glute Kickback", muscleGroup: "Glutes", equipment: "Cable" },
    { id: "step-up", name: "Step-Up", muscleGroup: "Glutes", equipment: "Free Weight" },
    { id: "hip-abduction-machine", name: "Hip Abduction Machine", muscleGroup: "Glutes", equipment: "Machine" },

    // Calves
    { id: "standing-calf-raise-machine", name: "Standing Calf Raise Machine", muscleGroup: "Calves", equipment: "Machine" },
    { id: "seated-calf-raise-machine", name: "Seated Calf Raise Machine", muscleGroup: "Calves", equipment: "Machine" },
    { id: "leg-press-calf-raise", name: "Leg Press Calf Raise", muscleGroup: "Calves", equipment: "Machine" },
    { id: "calf-raise-dumbbell", name: "Dumbbell Calf Raise", muscleGroup: "Calves", equipment: "Free Weight" },
    { id: "calf-raise-bodyweight", name: "Bodyweight Calf Raise", muscleGroup: "Calves", equipment: "Bodyweight" },
    { id: "single-leg-calf-raise", name: "Single-Leg Calf Raise", muscleGroup: "Calves", equipment: "Bodyweight" },

    // Abs / Core
    { id: "plank", name: "Plank", muscleGroup: "Abs / Core", equipment: "Bodyweight" },
    { id: "side-plank", name: "Side Plank", muscleGroup: "Abs / Core", equipment: "Bodyweight" },
    { id: "hanging-leg-raise", name: "Hanging Leg Raise", muscleGroup: "Abs / Core", equipment: "Bodyweight" },
    { id: "cable-crunch", name: "Cable Crunch", muscleGroup: "Abs / Core", equipment: "Cable" },
    { id: "cable-woodchop", name: "Cable Woodchop", muscleGroup: "Abs / Core", equipment: "Cable" },
    { id: "pallof-press", name: "Pallof Press", muscleGroup: "Abs / Core", equipment: "Cable" },
    { id: "ab-crunch-machine", name: "Ab Crunch Machine", muscleGroup: "Abs / Core", equipment: "Machine" },
    { id: "ab-wheel-rollout", name: "Ab Wheel Rollout", muscleGroup: "Abs / Core", equipment: "Bodyweight" },
    { id: "russian-twist", name: "Russian Twist", muscleGroup: "Abs / Core", equipment: "Bodyweight" },
    { id: "sit-up", name: "Sit-Up", muscleGroup: "Abs / Core", equipment: "Bodyweight" },
    { id: "decline-sit-up", name: "Decline Sit-Up", muscleGroup: "Abs / Core", equipment: "Bodyweight" },
    { id: "bicycle-crunch", name: "Bicycle Crunch", muscleGroup: "Abs / Core", equipment: "Bodyweight" },
    { id: "v-up", name: "V-Up", muscleGroup: "Abs / Core", equipment: "Bodyweight" },

    // Forearms
    { id: "wrist-curl", name: "Wrist Curl", muscleGroup: "Forearms", equipment: "Free Weight" },
    { id: "reverse-wrist-curl", name: "Reverse Wrist Curl", muscleGroup: "Forearms", equipment: "Free Weight" },
    { id: "behind-back-wrist-curl", name: "Behind-the-Back Wrist Curl", muscleGroup: "Forearms", equipment: "Free Weight" },
    { id: "plate-pinch", name: "Plate Pinch Hold", muscleGroup: "Forearms", equipment: "Free Weight" },
    { id: "farmers-carry", name: "Farmer's Carry", muscleGroup: "Forearms", equipment: "Free Weight" },

    // Traps
    { id: "barbell-shrug", name: "Barbell Shrug", muscleGroup: "Traps", equipment: "Free Weight" },
    { id: "dumbbell-shrug", name: "Dumbbell Shrug", muscleGroup: "Traps", equipment: "Free Weight" },
    { id: "cable-shrug", name: "Cable Shrug", muscleGroup: "Traps", equipment: "Cable" },
    { id: "snatch-grip-shrug", name: "Snatch-Grip Shrug", muscleGroup: "Traps", equipment: "Free Weight" },

    // Full Body
    { id: "power-clean", name: "Power Clean", muscleGroup: "Full Body", equipment: "Free Weight" },
    { id: "hang-clean", name: "Hang Clean", muscleGroup: "Full Body", equipment: "Free Weight" },
    { id: "clean-and-jerk", name: "Clean and Jerk", muscleGroup: "Full Body", equipment: "Free Weight" },
    { id: "snatch", name: "Snatch", muscleGroup: "Full Body", equipment: "Free Weight" },
    { id: "thruster", name: "Thruster", muscleGroup: "Full Body", equipment: "Free Weight" },
    { id: "kettlebell-swing", name: "Kettlebell Swing", muscleGroup: "Full Body", equipment: "Free Weight" },
    { id: "turkish-get-up", name: "Turkish Get-Up", muscleGroup: "Full Body", equipment: "Free Weight" },
    { id: "wall-ball", name: "Wall Ball Shot", muscleGroup: "Full Body", equipment: "Free Weight" },

    // Cardio
    { id: "treadmill-run", name: "Treadmill Run", muscleGroup: "Cardio", equipment: "Cardio Equipment" },
    { id: "stationary-bike", name: "Stationary Bike", muscleGroup: "Cardio", equipment: "Cardio Equipment" },
    { id: "rowing-machine", name: "Rowing Machine", muscleGroup: "Cardio", equipment: "Cardio Equipment" },
    { id: "stairmaster", name: "StairMaster", muscleGroup: "Cardio", equipment: "Cardio Equipment" },
    { id: "elliptical", name: "Elliptical", muscleGroup: "Cardio", equipment: "Cardio Equipment" },
    { id: "battle-ropes", name: "Battle Ropes", muscleGroup: "Cardio", equipment: "Cardio Equipment" },
    { id: "jump-rope", name: "Jump Rope", muscleGroup: "Cardio", equipment: "Bodyweight" },
    { id: "burpee", name: "Burpee", muscleGroup: "Cardio", equipment: "Bodyweight" },
    { id: "mountain-climber", name: "Mountain Climber", muscleGroup: "Cardio", equipment: "Bodyweight" },
    { id: "sprint-intervals", name: "Sprint Intervals", muscleGroup: "Cardio", equipment: "Bodyweight" }
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

  /* ---------------- custom exercises ---------------- */

  function loadCustomExercises() {
    const core = window.JarvisCore;
    const loaded = core.loadJSON(LS_CUSTOM, []);
    return Array.isArray(loaded) ? loaded : [];
  }

  function saveCustomExercises(list) {
    window.JarvisCore.saveJSON(LS_CUSTOM, list);
  }

  function addCustomExercise(data) {
    const core = window.JarvisCore;
    const list = loadCustomExercises();
    const exercise = {
      id: core.uid("custom"),
      name: data.name,
      muscleGroup: data.muscleGroup,
      equipment: data.equipment,
      custom: true
    };
    list.push(exercise);
    saveCustomExercises(list);
    return exercise;
  }

  function deleteCustomExercise(id) {
    const list = loadCustomExercises().filter(function (e) { return e.id !== id; });
    saveCustomExercises(list);
  }

  /* ---------------- favorites ---------------- */

  function loadFavoriteIds() {
    const loaded = window.JarvisCore.loadJSON(LS_FAVORITES, []);
    return Array.isArray(loaded) ? loaded : [];
  }

  function saveFavoriteIds(ids) {
    window.JarvisCore.saveJSON(LS_FAVORITES, ids);
  }

  function isFavorite(id) {
    return loadFavoriteIds().indexOf(id) !== -1;
  }

  function toggleFavorite(id) {
    const ids = loadFavoriteIds();
    const index = ids.indexOf(id);
    if (index === -1) ids.push(id); else ids.splice(index, 1);
    saveFavoriteIds(ids);
    return index === -1; // true if now favorited
  }

  /* ---------------- lookups ---------------- */

  function getExercises() {
    return EXERCISES.concat(loadCustomExercises());
  }

  function getExerciseById(id) {
    return getExercises().find(function (e) { return e.id === id; }) || null;
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
    getStandard: getStandard,
    addCustomExercise: addCustomExercise,
    deleteCustomExercise: deleteCustomExercise,
    loadCustomExercises: loadCustomExercises,
    isFavorite: isFavorite,
    toggleFavorite: toggleFavorite,
    loadFavoriteIds: loadFavoriteIds
  };
})();
