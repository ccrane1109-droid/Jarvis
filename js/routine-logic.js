/* ==========================================================================
   JARVIS — Routines: the rules behind the Routines screen and its builder
   (pure functions, no page access, so they can be tested outside the browser).

   Nothing here changes what it is given. Every function that "changes" routines
   returns a NEW list, and the screen swaps it in and saves it.

   A routine (jarvisRoutines):
     { id, name, exercises: [{ exerciseId, supersetGroup, plannedSets: [{ reps, type }] }],
       scheduledDays: [0..6, Monday first], createdAt, updatedAt?, archivedAt? }
   Older routines may still have targetSets / targetReps / repsPerSet instead of
   plannedSets; they are read as before and written in the newer shape only when edited.

   Rules this module keeps:
     - Editing a routine never touches saved workouts. A workout stores its own exercises.
     - A routine is ARCHIVED before it can be deleted. An archived routine is hidden from
       lists, the schedule and the pickers, but everything that points at it still resolves.
     - Deleting a routine first stamps its name onto the workouts that used it, so History
       keeps showing "Push Day" and never "routine deleted".
     - One routine per weekday (a day you give to one routine is taken from another).
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisRoutineLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const NAME_MAX = 60, MAX_EXERCISES = 30, MAX_SETS = 12, MAX_REPS = 100, DEFAULT_SETS = 3, DEFAULT_REPS = 10;
  const DAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const SET_TYPES = ["normal", "warmup", "dropset"];
  const NAME_IDEAS = ["Push Day", "Pull Day", "Leg Day", "Upper Body", "Lower Body", "Full Body"];

  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function clampInt(v, lo, hi, dflt) { const n = Math.round(Number(v)); return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt; }

  /* ---------------- names and lists ---------------- */

  function cleanName(s) { return String(s === undefined || s === null ? "" : s).replace(/\s+/g, " ").trim().slice(0, NAME_MAX); }
  function nameKey(s) { return String(s === undefined || s === null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

  function isArchived(r) { return !!(r && r.archivedAt); }
  function active(routines) { return (routines || []).filter(function (r) { return !isArchived(r); }); }
  function archived(routines) { return (routines || []).filter(isArchived); }
  function findById(routines, id) { return (routines || []).filter(function (r) { return r && r.id === id; })[0] || null; }

  // The active routine already using this name (case, spacing and punctuation ignored), or null.
  function nameTaken(name, routines, exceptId) {
    const key = nameKey(name);
    if (!key) return null;
    return active(routines).filter(function (r) { return r.id !== exceptId && nameKey(r.name) === key; })[0] || null;
  }

  // "Push Day" -> "Push Day (copy)" -> "Push Day (copy 2)" ... the first one not already used.
  function uniqueName(base, routines, suffix) {
    const root_ = cleanName(base) || "Routine";
    const tag = suffix || "copy";
    if (!nameTaken(root_, routines)) return root_.slice(0, NAME_MAX);
    for (let i = 1; i < 100; i++) {
      const end = " (" + tag + (i === 1 ? "" : " " + i) + ")";
      const candidate = root_.slice(0, NAME_MAX - end.length) + end;
      if (!nameTaken(candidate, routines)) return candidate;
    }
    return root_.slice(0, NAME_MAX - 6) + " (" + Date.now() % 1000 + ")";
  }

  /* ---------------- planned sets ---------------- */

  // A routine exercise's planned sets as [{ reps, type }], from either stored shape.
  function plannedSetsOf(re) {
    if (re && Array.isArray(re.plannedSets) && re.plannedSets.length) return re.plannedSets.map(function (p) { return { reps: Number(p.reps) || DEFAULT_REPS, type: p.type || "normal" }; });
    const out = [];
    const count = Math.max(1, Math.min(20, Number(re && re.targetSets) || 1));
    for (let i = 0; i < count; i++) {
      const r = re && re.repsPerSet && re.repsPerSet[i] !== undefined ? re.repsPerSet[i] : (re && re.targetReps) || DEFAULT_REPS;
      out.push({ reps: Number(r) || DEFAULT_REPS, type: "normal" });
    }
    return out;
  }

  function uniform(count, reps) {
    const n = clampInt(count, 1, MAX_SETS, DEFAULT_SETS), r = clampInt(reps, 1, MAX_REPS, DEFAULT_REPS);
    const out = [];
    for (let i = 0; i < n; i++) out.push({ reps: r, type: "normal" });
    return out;
  }

  // True when every set is a normal set with the same reps, so "3 sets of 10" says it all.
  function isUniform(planned) {
    return planned.length > 0 && planned.every(function (p) { return p.type === "normal" && p.reps === planned[0].reps; });
  }

  // "3 × 10" for an even plan, "4 sets: 12, 10, 8 (drop set)" otherwise.
  function setsLabel(planned) {
    if (isUniform(planned)) return planned.length + " × " + planned[0].reps;
    const names = { warmup: "warm-up", dropset: "drop set" };
    return planned.length + (planned.length === 1 ? " set: " : " sets: ") + planned.map(function (p) { return p.reps + (p.type !== "normal" && names[p.type] ? " (" + names[p.type] + ")" : ""); }).join(", ");
  }

  function workingSetCount(routine) {
    return (routine.exercises || []).reduce(function (t, re) { return t + plannedSetsOf(re).filter(function (p) { return p.type !== "warmup"; }).length; }, 0);
  }

  // The muscle groups a routine trains, in the order they first appear. lookup(exerciseId) -> { muscleGroup } or null.
  function muscleSummary(routine, lookup) {
    const seen = [];
    (routine.exercises || []).forEach(function (re) {
      const info = lookup ? lookup(re.exerciseId) : null;
      if (info && info.muscleGroup && seen.indexOf(info.muscleGroup) === -1) seen.push(info.muscleGroup);
    });
    return seen;
  }

  // What to plan for an exercise you add: your last working sets (how many, and the usual reps), else 3 x 10.
  // Never invented: "last" is only returned when a saved workout really has that exercise.
  function suggestedPlan(workouts, exerciseId) {
    const sessions = (workouts || []).filter(function (w) { return w && w.schema === 2 && Array.isArray(w.exercises); })
      .slice().sort(function (a, b) { return String(a.dateTime) < String(b.dateTime) ? 1 : -1; });
    for (let i = 0; i < sessions.length; i++) {
      const se = sessions[i].exercises.filter(function (x) { return x.exerciseId === exerciseId; })[0];
      if (!se) continue;
      const work = (se.sets || []).filter(function (s) { return !s.warmup && !s.dropset && Number(s.reps) > 0; });
      if (!work.length) continue;
      const tally = {};
      work.forEach(function (s) { const r = clampInt(s.reps, 1, MAX_REPS, DEFAULT_REPS); tally[r] = (tally[r] || 0) + 1; });
      const usual = Object.keys(tally).map(Number).sort(function (a, b) { return tally[b] - tally[a] || b - a; })[0];
      return { plannedSets: uniform(Math.min(work.length, 6), usual), from: "last" };
    }
    return { plannedSets: uniform(DEFAULT_SETS, DEFAULT_REPS), from: "default" };
  }

  /* ---------------- the builder (the unsaved routine on screen) ---------------- */

  function normalizeExercise(e) {
    return { exerciseId: String(e.exerciseId), supersetGroup: e.supersetGroup || null, plannedSets: plannedSetsOf(e) };
  }

  // A superset has to be at least two exercises in a row; anything else is quietly ungrouped.
  function tidyGroups(exercises) {
    const spans = {};
    exercises.forEach(function (e, i) { if (e.supersetGroup) { const s = spans[e.supersetGroup] || (spans[e.supersetGroup] = { first: i, last: i, n: 0 }); s.last = i; s.n++; } });
    return exercises.map(function (e) {
      const s = e.supersetGroup ? spans[e.supersetGroup] : null;
      return s && s.n >= 2 && s.last - s.first + 1 === s.n ? e : Object.assign({}, e, { supersetGroup: null });
    });
  }

  function stateKey(b) {
    return JSON.stringify({ name: cleanName(b.name), days: uniqueDays(b.days), exercises: b.exercises.map(normalizeExercise) });
  }
  function uniqueDays(days) { return (days || []).filter(function (d, i, a) { return d >= 0 && d <= 6 && Math.floor(d) === d && a.indexOf(d) === i; }).sort(function (a, b) { return a - b; }); }

  function withBase(b) { return Object.assign({}, b, { base: stateKey(b) }); }

  function blankBuilder() { return withBase({ editId: null, name: "", days: [], exercises: [] }); }

  function builderFromRoutine(r) {
    return withBase({ editId: r.id, name: r.name, days: uniqueDays(r.scheduledDays), exercises: (r.exercises || []).map(normalizeExercise) });
  }

  // "Duplicate": a new, unsaved routine with the same exercises, a free name and no days (a day can have one routine).
  function builderFromCopy(r, routines) {
    const b = { editId: null, name: uniqueName(r.name, routines, "copy"), days: [], exercises: (r.exercises || []).map(normalizeExercise) };
    return Object.assign({}, b, { base: "" });   // not saved yet, so it always counts as changed
  }

  function isDirty(b) { return stateKey(b) !== b.base; }

  function setName(b, name) { return Object.assign({}, b, { name: String(name === undefined || name === null ? "" : name).slice(0, NAME_MAX + 20) }); }

  function toggleDay(b, day) {
    const has = b.days.indexOf(day) !== -1;
    return Object.assign({}, b, { days: uniqueDays(has ? b.days.filter(function (d) { return d !== day; }) : b.days.concat([day])) });
  }

  // defs: [{ exerciseId, plannedSets? }]. Exercises already in the routine are skipped. Returns { builder, added, skipped }.
  function addExercises(b, defs) {
    const have = {}; b.exercises.forEach(function (e) { have[e.exerciseId] = true; });
    const next = b.exercises.slice();
    let added = 0, skipped = 0;
    (defs || []).forEach(function (d) {
      if (!d || !d.exerciseId || have[d.exerciseId] || next.length >= MAX_EXERCISES) { skipped++; return; }
      have[d.exerciseId] = true;
      next.push({ exerciseId: String(d.exerciseId), supersetGroup: null, plannedSets: d.plannedSets && d.plannedSets.length ? plannedSetsOf({ plannedSets: d.plannedSets }) : uniform(DEFAULT_SETS, DEFAULT_REPS) });
      added++;
    });
    return { builder: Object.assign({}, b, { exercises: next }), added: added, skipped: skipped };
  }

  function removeExercise(b, i) {
    if (i < 0 || i >= b.exercises.length) return b;
    return Object.assign({}, b, { exercises: tidyGroups(b.exercises.filter(function (_, k) { return k !== i; })) });
  }

  function moveExercise(b, i, dir) {
    const j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || i >= b.exercises.length || j >= b.exercises.length) return b;
    const next = b.exercises.slice();
    const t = next[i]; next[i] = next[j]; next[j] = t;
    return Object.assign({}, b, { exercises: tidyGroups(next) });
  }

  function setPlannedSets(b, i, planned) {
    if (i < 0 || i >= b.exercises.length) return b;
    const next = b.exercises.slice();
    next[i] = Object.assign({}, next[i], { plannedSets: planned.map(function (p) { return { reps: clampInt(p.reps, 1, MAX_REPS, DEFAULT_REPS), type: SET_TYPES.indexOf(p.type) !== -1 ? p.type : "normal" }; }).slice(0, MAX_SETS) });
    return Object.assign({}, b, { exercises: next });
  }

  // "3 sets of 10" steppers. Only meaningful for an even plan; anything else is replaced by an even one.
  function setUniform(b, i, o) {
    if (i < 0 || i >= b.exercises.length) return b;
    const cur = plannedSetsOf(b.exercises[i]);
    return setPlannedSets(b, i, uniform(o.sets === undefined ? cur.length : o.sets, o.reps === undefined ? cur[0].reps : o.reps));
  }

  // Link exercise i with the next one as a superset, or take i out of its superset. newId is used for a new group.
  function toggleSuperset(b, i, newId) {
    if (i < 0 || i >= b.exercises.length) return b;
    const cur = b.exercises[i];
    const next = b.exercises.map(function (e) { return Object.assign({}, e); });
    if (cur.supersetGroup) next[i].supersetGroup = null;
    else if (i + 1 < next.length) { const g = next[i + 1].supersetGroup || newId || ("sg_" + Date.now().toString(36)); next[i].supersetGroup = g; next[i + 1].supersetGroup = g; }
    return Object.assign({}, b, { exercises: tidyGroups(next) });
  }

  // { ok, name?, exercises?, sets: [{ index, message }] } - the first thing wrong, in plain words.
  function validate(b, routines) {
    const out = { ok: true, name: null, exercises: null, sets: [] };
    const name = cleanName(b.name);
    if (!name) { out.name = "Give it a name."; }
    else {
      const other = nameTaken(name, routines, b.editId);
      if (other) out.name = "You already have a routine called “" + other.name + "”. Pick another name, or edit that one.";
    }
    if (!b.exercises.length) out.exercises = "Add at least one exercise.";
    b.exercises.forEach(function (e, index) {
      const p = e.plannedSets || [];
      if (!p.length) out.sets.push({ index: index, message: "Needs at least one set." });
      else if (p.length > MAX_SETS) out.sets.push({ index: index, message: "At most " + MAX_SETS + " sets." });
      else if (p.some(function (s) { return !(Number(s.reps) >= 1) || Number(s.reps) > MAX_REPS || Math.floor(Number(s.reps)) !== Number(s.reps); })) out.sets.push({ index: index, message: "Reps must be a whole number from 1 to " + MAX_REPS + "." });
    });
    out.ok = !out.name && !out.exercises && out.sets.length === 0;
    return out;
  }

  // The active routines that currently hold days this builder wants: [{ day, routine }]. Saving moves them here.
  function dayConflicts(b, routines) {
    const out = [];
    uniqueDays(b.days).forEach(function (d) {
      const r = routineForDay(routines, d);
      if (r && r.id !== b.editId) out.push({ day: d, routine: r });
    });
    return out;
  }

  // The unsaved builder read back from storage: anything that isn't the right shape is dropped, a broken one gives null.
  function sanitizeBuilder(raw) {
    if (!isObj(raw) || !Array.isArray(raw.exercises)) return null;
    const exercises = raw.exercises.filter(function (e) { return isObj(e) && typeof e.exerciseId === "string" && e.exerciseId; })
      .slice(0, MAX_EXERCISES).map(function (e) { return normalizeExercise(e); });
    const b = { editId: typeof raw.editId === "string" && raw.editId ? raw.editId : null, name: typeof raw.name === "string" ? raw.name.slice(0, NAME_MAX + 20) : "", days: uniqueDays(Array.isArray(raw.days) ? raw.days.map(Number) : []), exercises: tidyGroups(exercises) };
    b.base = typeof raw.base === "string" ? raw.base : "";
    return b;
  }

  /* ---------------- saving ---------------- */

  // Turn the builder into a saved routine. Creates one, or updates the routine being edited (same id, same createdAt).
  // Days the routine claims are taken away from other routines. Returns { ok, routines, routine } or { ok:false, reason }.
  function applyBuilder(routines, b, o) {
    const now = o.now;
    const v = validate(b, routines);
    if (!v.ok) return { ok: false, reason: "invalid", problems: v };
    const exercises = tidyGroups(b.exercises.map(normalizeExercise));
    let list = (routines || []).slice();
    let saved;
    if (b.editId) {
      const at = list.findIndex(function (r) { return r.id === b.editId; });
      if (at === -1) return { ok: false, reason: "missing" };
      const days = isArchived(list[at]) ? [] : uniqueDays(b.days);
      saved = Object.assign({}, list[at], { name: cleanName(b.name), exercises: exercises, scheduledDays: days, updatedAt: now });
      list[at] = saved;
    } else {
      saved = { id: o.id, name: cleanName(b.name), exercises: exercises, scheduledDays: uniqueDays(b.days), createdAt: now, updatedAt: now };
      list.push(saved);
    }
    const mine = saved.scheduledDays || [];
    list = list.map(function (r) {
      if (r.id === saved.id || isArchived(r) || !(r.scheduledDays || []).some(function (d) { return mine.indexOf(d) !== -1; })) return r;
      return Object.assign({}, r, { scheduledDays: r.scheduledDays.filter(function (d) { return mine.indexOf(d) === -1; }), updatedAt: now });
    });
    return { ok: true, routines: list, routine: saved };
  }

  /* ---------------- the week ---------------- */

  function routineForDay(routines, day) {
    return active(routines).filter(function (r) { return (r.scheduledDays || []).indexOf(day) !== -1; })[0] || null;
  }

  function weekPlan(routines) {
    return DAY_LABELS.map(function (label, day) { return { day: day, label: label, short: DAY_SHORT[day], routine: routineForDay(routines, day) }; });
  }

  function plannedDayCount(routines) {
    const days = {};
    active(routines).forEach(function (r) { (r.scheduledDays || []).forEach(function (d) { days[d] = true; }); });
    return Object.keys(days).length;
  }

  // Give a day to one routine ("" = rest day). The day is taken from whichever routine had it.
  function assignDay(routines, day, routineId, now) {
    return (routines || []).map(function (r) {
      if (isArchived(r)) return r;
      const days = r.scheduledDays || [];
      const has = days.indexOf(day) !== -1;
      if (r.id === routineId && !has) return Object.assign({}, r, { scheduledDays: uniqueDays(days.concat([day])), updatedAt: now });
      if (r.id !== routineId && has) return Object.assign({}, r, { scheduledDays: days.filter(function (d) { return d !== day; }), updatedAt: now });
      return r;
    });
  }

  function dayText(days) { return uniqueDays(days).map(function (d) { return DAY_SHORT[d]; }).join(" · "); }

  /* ---------------- archive, restore, delete ---------------- */

  function archiveRoutine(routines, id, now) {
    return (routines || []).map(function (r) { return r.id === id && !isArchived(r) ? Object.assign({}, r, { archivedAt: now, scheduledDays: [], updatedAt: now }) : r; });
  }

  // Bring one back. If its name has been used since, it comes back as "Name (restored)". It has no days until you give it some.
  function restoreRoutine(routines, id, now) {
    const r = findById(routines, id);
    if (!r || !isArchived(r)) return routines;
    const others = (routines || []).filter(function (x) { return x.id !== id; });
    const name = nameTaken(r.name, others) ? uniqueName(r.name, others, "restored") : r.name;
    return (routines || []).map(function (x) { if (x.id !== id) return x; const back = Object.assign({}, x, { name: name, updatedAt: now, scheduledDays: [] }); delete back.archivedAt; return back; });
  }

  function usageOf(workouts, routineId) {
    let n = 0, last = null;
    (workouts || []).forEach(function (w) { if (w && w.routineId === routineId) { n++; const d = w.dateTime || w.date || ""; if (!last || d > last) last = d; } });
    return { sessions: n, lastDate: last ? String(last).slice(0, 10) : null };
  }

  function programDaysUsing(programs, routineId) {
    const out = [];
    (programs || []).forEach(function (p) { (p.days || []).forEach(function (d) { if (d.routineId === routineId) out.push({ programId: p.id, programName: p.name, dayId: d.id, dayLabel: d.label }); }); });
    return out;
  }

  // What deleting a routine leaves behind, so the confirmation can say it in words.
  function deleteImpact(routineId, workouts, programs) {
    const u = usageOf(workouts, routineId);
    return { sessions: u.sessions, lastDate: u.lastDate, programDays: programDaysUsing(programs, routineId) };
  }

  // Only an archived routine can be deleted. Anything else is returned untouched.
  function deleteRoutine(routines, id) {
    const r = findById(routines, id);
    if (!r || !isArchived(r)) return routines;
    return routines.filter(function (x) { return x.id !== id; });
  }

  // Write the routine's name onto the saved workouts that used it (only where there is none yet), so History keeps the name.
  // Returns { workouts, changed }; the same array when nothing needed it. Sessions are copied, never edited in place.
  function stampNames(workouts, routine) {
    let changed = 0;
    const out = (workouts || []).map(function (w) {
      if (w && w.routineId === routine.id && !w.routineName) { changed++; return Object.assign({}, w, { routineName: routine.name }); }
      return w;
    });
    return { workouts: changed ? out : workouts, changed: changed };
  }

  // How to label a saved workout: the routine's current name, else the name it had when it was saved, else "".
  function sessionLabel(session, routines) {
    const r = session && session.routineId ? findById(routines, session.routineId) : null;
    return r ? r.name : ((session && session.routineName) || "");
  }

  // A program day's routine, and whether it can be started: "ok", "archived" or "missing".
  function programDayStatus(program, routines) {
    if (!program || !program.days || !program.days.length) return { day: null, routine: null, status: "empty" };
    const day = program.days[((program.currentIndex || 0) % program.days.length + program.days.length) % program.days.length];
    const r = findById(routines, day.routineId);
    return { day: day, routine: r, status: !r ? "missing" : isArchived(r) ? "archived" : "ok" };
  }

  /* ---------------- the list ---------------- */

  // Active routines in a calm order: ones on the schedule first (earliest weekday first), then the rest as created.
  function listOrder(routines) {
    return active(routines).map(function (r, i) { return { r: r, i: i, first: uniqueDays(r.scheduledDays)[0] }; })
      .sort(function (a, b) { const x = a.first === undefined ? 99 : a.first, y = b.first === undefined ? 99 : b.first; return x - y || a.i - b.i; })
      .map(function (x) { return x.r; });
  }

  return {
    NAME_MAX: NAME_MAX, MAX_EXERCISES: MAX_EXERCISES, MAX_SETS: MAX_SETS, MAX_REPS: MAX_REPS, DEFAULT_SETS: DEFAULT_SETS, DEFAULT_REPS: DEFAULT_REPS,
    DAY_LABELS: DAY_LABELS, DAY_SHORT: DAY_SHORT, SET_TYPES: SET_TYPES, NAME_IDEAS: NAME_IDEAS,
    cleanName: cleanName, nameKey: nameKey, isArchived: isArchived, active: active, archived: archived, findById: findById,
    nameTaken: nameTaken, uniqueName: uniqueName,
    plannedSetsOf: plannedSetsOf, uniform: uniform, isUniform: isUniform, setsLabel: setsLabel, workingSetCount: workingSetCount,
    muscleSummary: muscleSummary, suggestedPlan: suggestedPlan,
    blankBuilder: blankBuilder, builderFromRoutine: builderFromRoutine, builderFromCopy: builderFromCopy, isDirty: isDirty,
    setName: setName, toggleDay: toggleDay, addExercises: addExercises, removeExercise: removeExercise, moveExercise: moveExercise,
    setPlannedSets: setPlannedSets, setUniform: setUniform, toggleSuperset: toggleSuperset, validate: validate, dayConflicts: dayConflicts,
    sanitizeBuilder: sanitizeBuilder, applyBuilder: applyBuilder,
    routineForDay: routineForDay, weekPlan: weekPlan, plannedDayCount: plannedDayCount, assignDay: assignDay, dayText: dayText,
    archiveRoutine: archiveRoutine, restoreRoutine: restoreRoutine, usageOf: usageOf, programDaysUsing: programDaysUsing,
    deleteImpact: deleteImpact, deleteRoutine: deleteRoutine, stampNames: stampNames, sessionLabel: sessionLabel, programDayStatus: programDayStatus,
    listOrder: listOrder
  };
});
