/* ==========================================================================
   JARVIS — Workout: the rules behind the Home screen, the live logger and the
   finish summary (pure functions, no page access, so they can be tested outside
   the browser).

   Saved sessions (jarvisWorkouts, schema 2) are only ever read here, never
   rewritten. A set in a session: { weight, reps, warmup, dropset, rpe? }.
   A set in the unsaved draft adds { id, completed, doneAt } and may carry a
   weight and reps that are only SUGGESTIONS (from last time) until it is done.

   Definitions used on screen, so every number can be explained:
     - Working sets: every set that is not marked warm-up.
     - Volume: weight x reps added up over working sets. Warm-ups are not counted.
     - Estimated 1RM: weight x (1 + reps / 30) (Epley), or the weight for one rep.
       An estimate, not a measured max.
     - A personal record: a working set that beats everything you logged for that
       exercise before this session, by heaviest weight or by estimated 1RM. The
       first time you ever log an exercise sets the baseline and is not a record.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisWorkoutLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const REST_MIN = 15, REST_MAX = 600;
  const DEFAULT_PREFS = { restSeconds: 90, restAuto: true, restSound: true };

  function isNum(v) { return v !== "" && v !== null && v !== undefined && isFinite(Number(v)); }

  /* ---------------- numbers ---------------- */

  function e1rm(weight, reps) {
    const w = Number(weight), r = Number(reps);
    if (!isFinite(w) || !isFinite(r) || w < 0 || r <= 0) return 0;
    if (r === 1) return w;
    return w * (1 + r / 30);
  }

  function round1(n) { return Math.round(n * 10) / 10; }
  function validSet(s) { return !!s && isNum(s.weight) && Number(s.weight) >= 0 && isNum(s.reps) && Number(s.reps) > 0; }
  function working(sets) { return (sets || []).filter(function (s) { return !s.warmup && validSet(s); }); }
  function volumeOf(sets) { return working(sets).reduce(function (t, s) { return t + Number(s.weight) * Number(s.reps); }, 0); }

  /* ---------------- dates (local day keys, DST-safe) ---------------- */

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dayKey(ms) { const d = new Date(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function addDays(k, n) {
    const p = String(k).split("-").map(Number);
    const u = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return u.getUTCFullYear() + "-" + pad(u.getUTCMonth() + 1) + "-" + pad(u.getUTCDate());
  }
  function weekdayOf(k) { const p = String(k).split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); }
  // Monday-first index, 0 = Monday ... 6 = Sunday (the same convention the routine schedule uses)
  function mondayIndex(k) { return (weekdayOf(k) + 6) % 7; }
  function weekStart(k) { return addDays(k, -mondayIndex(k)); }

  /* ---------------- reading saved sessions ---------------- */

  function sessionsOf(workouts) {
    return (Array.isArray(workouts) ? workouts : []).filter(function (w) {
      return w && w.schema === 2 && Array.isArray(w.exercises) && typeof w.dateTime === "string";
    });
  }
  function byTime(a, b) { return a.dateTime < b.dateTime ? -1 : a.dateTime > b.dateTime ? 1 : (a.createdAt || 0) - (b.createdAt || 0); }
  function entryFor(session, exerciseId) {
    return session.exercises.filter(function (x) { return x.exerciseId === exerciseId && Array.isArray(x.sets) && x.sets.length; })[0] || null;
  }

  // The most recent saved session that includes this exercise -> { dateTime, date, routineId, sets } or null.
  function previousPerformance(workouts, exerciseId, beforeDateTime) {
    let best = null;
    sessionsOf(workouts).forEach(function (w) {
      if (beforeDateTime && !(w.dateTime < beforeDateTime)) return;
      const se = entryFor(w, exerciseId);
      if (!se) return;
      if (!best || byTime(best.w, w) < 0) best = { w: w, se: se };
    });
    return best ? { dateTime: best.w.dateTime, date: best.w.date, routineId: best.w.routineId || null, sets: best.se.sets } : null;
  }

  // "135 x 8, 150 x 6": last time's working sets, for the line under an exercise name.
  function lastTimeText(prev) {
    if (!prev) return "";
    const sets = working(prev.sets);
    if (!sets.length) return "";
    return sets.map(function (s) { return Number(s.weight) + " × " + Number(s.reps); }).join(", ");
  }

  // For each planned set (types "normal" | "warmup" | "dropset") pick last time's matching set, or null.
  // Warm-ups line up with last time's warm-ups, working sets with working sets, in order; past the end, the last one.
  function suggestForPlan(types, prevSets) {
    const prev = prevSets || [];
    const warm = prev.filter(function (s) { return s.warmup && validSet(s); });
    const drops = prev.filter(function (s) { return !s.warmup && s.dropset && validSet(s); });
    const normal = prev.filter(function (s) { return !s.warmup && !s.dropset && validSet(s); });
    const used = { warmup: 0, dropset: 0, normal: 0 };
    return types.map(function (t) {
      const key = t === "warmup" ? "warmup" : t === "dropset" ? "dropset" : "normal";
      let pool = key === "warmup" ? warm : key === "dropset" ? drops : normal;
      if (key === "dropset" && !pool.length) pool = normal;
      const s = pool[Math.min(used[key], pool.length - 1)] || null;
      used[key]++;
      return s ? { weight: Number(s.weight), reps: Math.round(Number(s.reps)) } : null;
    });
  }

  // A routine exercise's planned sets: [{ reps, type }]. Same rules the Routines tab uses.
  function plannedSetsOf(re) {
    if (re && Array.isArray(re.plannedSets) && re.plannedSets.length) return re.plannedSets.map(function (p) { return { reps: Number(p.reps) || 10, type: p.type || "normal" }; });
    const out = [];
    const count = Math.max(1, Math.min(20, Number(re && re.targetSets) || 1));
    for (let i = 0; i < count; i++) {
      const r = re && re.repsPerSet && re.repsPerSet[i] !== undefined ? re.repsPerSet[i] : (re && re.targetReps) || 10;
      out.push({ reps: Number(r) || 10, type: "normal" });
    }
    return out;
  }

  /* ---------------- records ---------------- */

  function bestSets(workouts, exerciseId, beforeDateTime) {
    let heaviest = null, best = null;
    sessionsOf(workouts).forEach(function (w) {
      if (beforeDateTime && !(w.dateTime < beforeDateTime)) return;
      const se = entryFor(w, exerciseId);
      if (!se) return;
      working(se.sets).forEach(function (s) {
        const weight = Number(s.weight), reps = Number(s.reps), est = e1rm(weight, reps);
        if (!heaviest || weight > heaviest.weight || (weight === heaviest.weight && reps > heaviest.reps)) heaviest = { weight: weight, reps: reps, date: w.date };
        if (!best || est > best.value) best = { value: est, weight: weight, reps: reps, date: w.date };
      });
    });
    return { heaviest: heaviest, e1rm: best };
  }

  function prFor(se, before) {
    const prior = bestSets(before, se.exerciseId);
    if (!prior.heaviest) return null;
    const mine = bestSets([{ schema: 2, id: "_", dateTime: "9999", date: "", exercises: [se] }], se.exerciseId);
    if (!mine.heaviest) return null;
    const kinds = [];
    if (mine.heaviest.weight > prior.heaviest.weight) kinds.push("weight");
    if (mine.e1rm.value > prior.e1rm.value + 0.05) kinds.push("e1rm");
    if (!kinds.length) return null;
    const shown = kinds.indexOf("e1rm") !== -1 ? mine.e1rm : mine.heaviest;
    return { exerciseId: se.exerciseId, kinds: kinds, weight: shown.weight, reps: shown.reps, e1rm: round1(mine.e1rm.value), previousE1rm: round1(prior.e1rm.value), previousHeaviest: prior.heaviest.weight };
  }

  // Records set by this session, against everything saved before it.
  function sessionPRs(workouts, session) {
    const before = sessionsOf(workouts).filter(function (w) { return w.id !== session.id && byTime(w, session) < 0; });
    return session.exercises.map(function (se) { return prFor(se, before); }).filter(Boolean);
  }

  // Newest first: every record across your history, oldest session first so each is judged on what came before it.
  function recentPRs(workouts, opts) {
    const o = opts || {};
    const sorted = sessionsOf(workouts).slice().sort(byTime);
    const seen = {};
    const events = [];
    sorted.forEach(function (w) {
      w.exercises.forEach(function (se) {
        const sets = working(se.sets);
        if (!sets.length) return;
        const st = seen[se.exerciseId];
        let heavy = 0, est = 0, hr = 0, hw = 0, bw = 0, br = 0;
        sets.forEach(function (s) {
          const wt = Number(s.weight), r = Number(s.reps), e = e1rm(wt, r);
          if (wt > heavy) { heavy = wt; hr = r; }
          if (e > est) { est = e; bw = wt; br = r; }
        });
        if (st) {
          const kinds = [];
          if (heavy > st.heavy) kinds.push("weight");
          if (est > st.est + 0.05) kinds.push("e1rm");
          if (kinds.length) {
            const showE = kinds.indexOf("e1rm") !== -1;
            events.push({ date: w.date, sessionId: w.id, exerciseId: se.exerciseId, kinds: kinds, weight: showE ? bw : heavy, reps: showE ? br : hr, e1rm: round1(est), previousE1rm: round1(st.est) });
          }
        }
        seen[se.exerciseId] = { heavy: Math.max(heavy, st ? st.heavy : 0), est: Math.max(est, st ? st.est : 0) };
      });
    });
    events.reverse();
    const since = o.sinceDate || null;
    const list = since ? events.filter(function (e) { return e.date >= since; }) : events;
    return o.limit ? list.slice(0, o.limit) : list;
  }

  /* ---------------- one session ---------------- */

  function sessionStats(session) {
    let exercises = 0, workingSets = 0, warmupSets = 0, volume = 0;
    (session.exercises || []).forEach(function (se) {
      const done = (se.sets || []).filter(validSet);
      if (!done.length) return;
      exercises++;
      done.forEach(function (s) { if (s.warmup) warmupSets++; else workingSets++; });
      volume += volumeOf(done);
    });
    return { exercises: exercises, workingSets: workingSets, warmupSets: warmupSets, volume: Math.round(volume), durationMin: isNum(session.duration) ? Number(session.duration) : null };
  }

  // Against the last time you did the same routine. null when there is nothing fair to compare with.
  function compareToPrevious(workouts, session) {
    if (!session.routineId) return null;
    const prev = sessionsOf(workouts).filter(function (w) { return w.id !== session.id && w.routineId === session.routineId && byTime(w, session) < 0; }).sort(byTime).pop();
    if (!prev) return null;
    const a = sessionStats(session), b = sessionStats(prev);
    return {
      date: prev.date,
      volumePct: b.volume > 0 ? Math.round((a.volume - b.volume) / b.volume * 100) : null,
      volumeDelta: a.volume - b.volume,
      durationDelta: a.durationMin !== null && b.durationMin !== null ? a.durationMin - b.durationMin : null,
      setsDelta: a.workingSets - b.workingSets
    };
  }

  /* ---------------- the week ---------------- */

  // Monday to Sunday of the week containing `now`: which days had a session, how many, how long.
  function weekSummary(workouts, nowMs, target) {
    const today = dayKey(nowMs), start = weekStart(today), lastStart = addDays(start, -7);
    const all = sessionsOf(workouts);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const k = addDays(start, i);
      days.push({ date: k, trained: all.some(function (w) { return w.date === k; }), today: k === today, future: k > today });
    }
    const inWeek = all.filter(function (w) { return w.date >= start && w.date <= addDays(start, 6); });
    const lastWeek = all.filter(function (w) { return w.date >= lastStart && w.date < start; });
    return {
      start: start, days: days, count: inWeek.length, lastWeekCount: lastWeek.length,
      minutes: inWeek.reduce(function (t, w) { return t + (isNum(w.duration) ? Number(w.duration) : 0); }, 0),
      volume: Math.round(inWeek.reduce(function (t, w) { return t + sessionStats(w).volume; }, 0)),
      target: target > 0 ? target : null
    };
  }

  // Routines, the one used most recently first; routines never used follow in their saved order.
  function recentRoutines(workouts, routines) {
    const last = {};
    sessionsOf(workouts).forEach(function (w) { if (w.routineId && (!last[w.routineId] || w.dateTime > last[w.routineId])) last[w.routineId] = w.dateTime; });
    return (routines || []).map(function (r, i) { return { routine: r, lastUsed: last[r.id] || null, order: i }; })
      .sort(function (a, b) { if (a.lastUsed && b.lastUsed) return a.lastUsed < b.lastUsed ? 1 : -1; if (a.lastUsed) return -1; if (b.lastUsed) return 1; return a.order - b.order; });
  }

  // What "repeat last workout" would load: the newest saved session's exercises and sets, as plain numbers.
  function lastWorkoutPlan(workouts) {
    const last = sessionsOf(workouts).slice().sort(byTime).pop();
    if (!last) return null;
    return {
      date: last.date, routineId: last.routineId || null,
      exercises: last.exercises.filter(function (se) { return se.sets && se.sets.length; }).map(function (se) {
        return { exerciseId: se.exerciseId, sets: se.sets.map(function (s) { return { weight: Number(s.weight), reps: Math.round(Number(s.reps)), warmup: !!s.warmup, dropset: !!s.dropset }; }) };
      })
    };
  }

  /* ---------------- the unsaved draft ---------------- */

  let idCounter = 0;
  function makeId(prefix) { idCounter++; return prefix + "_" + Date.now().toString(36) + "_" + idCounter.toString(36) + Math.random().toString(36).slice(2, 6); }

  function numOrBlank(v) { return isNum(v) ? Number(v) : ""; }

  function newSet(o) {
    const s = o || {};
    return { id: s.id || makeId("set"), weight: numOrBlank(s.weight), reps: isNum(s.reps) ? Math.round(Number(s.reps)) : "", rpe: numOrBlank(s.rpe), completed: !!s.completed, warmup: !!s.warmup, dropset: !!s.dropset, doneAt: isNum(s.doneAt) ? Number(s.doneAt) : null };
  }

  function emptyDraft(dateTime) {
    return { dateTime: dateTime || "", routineId: "", notes: "", exercises: [], programId: "", programDayId: "", activeIndex: 0, startedAt: null, restEndsAt: null, uiVersion: 1 };
  }

  // Makes an older or half-written draft usable by the new logger without losing anything in it. Safe to run twice.
  function migrateDraft(d) {
    const draft = d && typeof d === "object" ? d : emptyDraft("");
    if (!Array.isArray(draft.exercises)) draft.exercises = [];
    draft.exercises = draft.exercises.filter(function (se) { return se && typeof se === "object" && se.exerciseId; }).map(function (se) {
      const sets = Array.isArray(se.sets) ? se.sets.filter(function (s) { return s && typeof s === "object"; }).map(function (s) { return Object.assign({}, s, newSet(s)); }) : [];
      return Object.assign({}, se, { sessionExId: se.sessionExId || makeId("sesx"), sets: sets, supersetGroup: se.supersetGroup || null });
    });
    draft.restEndsAt = isNum(draft.restEndsAt) ? Number(draft.restEndsAt) : null;
    draft.activeIndex = Math.max(0, Math.min(Number(draft.activeIndex) || 0, Math.max(0, draft.exercises.length - 1)));
    draft.uiVersion = 1;
    return draft;
  }

  function cloneDraft(d) { return JSON.parse(JSON.stringify(d)); }

  // Build draft exercises for a routine: weights come from last time (as suggestions), reps from the plan.
  function exercisesFromRoutine(routine, workouts) {
    return (routine.exercises || []).map(function (re) {
      const planned = plannedSetsOf(re);
      const prev = previousPerformance(workouts, re.exerciseId);
      const sugg = suggestForPlan(planned.map(function (p) { return p.type; }), prev ? prev.sets : []);
      return {
        sessionExId: makeId("sesx"), exerciseId: re.exerciseId, supersetGroup: re.supersetGroup || null,
        sets: planned.map(function (p, i) { return newSet({ weight: sugg[i] ? sugg[i].weight : "", reps: p.reps, warmup: p.type === "warmup", dropset: p.type === "dropset" }); })
      };
    });
  }

  function exercisesFromLastWorkout(workouts) {
    const plan = lastWorkoutPlan(workouts);
    if (!plan) return null;
    return plan.exercises.map(function (e) {
      return { sessionExId: makeId("sesx"), exerciseId: e.exerciseId, supersetGroup: null, sets: e.sets.map(function (s) { return newSet(s); }) };
    });
  }

  // A fresh exercise added on the spot: three sets, filled from last time if there is a last time.
  function exerciseFromHistory(exerciseId, workouts) {
    const prev = previousPerformance(workouts, exerciseId);
    const types = prev && working(prev.sets).length ? working(prev.sets).map(function () { return "normal"; }) : ["normal", "normal", "normal"];
    const sugg = suggestForPlan(types, prev ? prev.sets : []);
    return { sessionExId: makeId("sesx"), exerciseId: exerciseId, supersetGroup: null, sets: types.slice(0, 5).map(function (t, i) { return newSet({ weight: sugg[i] ? sugg[i].weight : "", reps: sugg[i] ? sugg[i].reps : "" }); }) };
  }

  function pendingSets(draft) {
    let total = 0, done = 0;
    draft.exercises.forEach(function (se) { se.sets.forEach(function (s) { total++; if (s.completed && validSet(s)) done++; }); });
    return { total: total, done: done, open: total - done };
  }

  // After a set is marked done: where does attention go, and does the rest timer start?
  //   Inside a superset the next exercise of the group comes next with no rest, and rest starts after the last one.
  function afterComplete(draft, exIdx, setIdx) {
    const ex = draft.exercises[exIdx];
    const open = function (i, from) {
      const sets = draft.exercises[i].sets;
      for (let j = from || 0; j < sets.length; j++) if (!sets[j].completed) return j;
      return -1;
    };
    const group = ex.supersetGroup ? draft.exercises.map(function (e, i) { return e.supersetGroup === ex.supersetGroup ? i : -1; }).filter(function (i) { return i >= 0; }) : [];
    if (group.length > 1) {
      const pos = group.indexOf(exIdx);
      for (let p = pos + 1; p < group.length; p++) {
        const j = open(group[p], 0);
        if (j !== -1 && j <= setIdx + 1) return { focus: { exIdx: group[p], setIdx: j }, rest: false };
      }
      for (let p = 0; p < group.length; p++) {
        const j = open(group[p], 0);
        if (j !== -1) return { focus: { exIdx: group[p], setIdx: j }, rest: true };
      }
    } else {
      const j = open(exIdx, setIdx + 1);
      if (j !== -1) return { focus: { exIdx: exIdx, setIdx: j }, rest: true };
      const k = open(exIdx, 0);
      if (k !== -1) return { focus: { exIdx: exIdx, setIdx: k }, rest: true };
    }
    for (let step = 1; step <= draft.exercises.length; step++) {
      const i = (exIdx + step) % draft.exercises.length;
      if (i === exIdx) break;
      const j = open(i, 0);
      if (j !== -1) return { focus: { exIdx: i, setIdx: j }, rest: true };
    }
    return { focus: null, rest: false };
  }

  // The session to save, from what is done in the draft. Unfinished sets are left out. null when nothing is done.
  function buildSession(draft, opts) {
    const o = opts || {};
    const now = o.now || Date.now();
    const exercises = draft.exercises.map(function (se) {
      const done = se.sets.filter(function (s) { return s.completed && validSet(s); });
      return { exerciseId: se.exerciseId, sets: done.map(function (s) {
        const out = { weight: Number(s.weight), reps: Math.round(Number(s.reps)), warmup: !!s.warmup, dropset: !!s.dropset };
        if (isNum(s.rpe)) out.rpe = Number(s.rpe);
        return out;
      }) };
    }).filter(function (x) { return x.sets.length; });
    if (!exercises.length) return null;
    const dateTime = draft.dateTime || (dayKey(now) + "T" + pad(new Date(now).getHours()) + ":" + pad(new Date(now).getMinutes()));
    const elapsed = draft.startedAt ? Math.max(0, now - draft.startedAt) : 0;
    return {
      id: o.id || makeId("workout"), schema: 2, dateTime: dateTime, date: dateTime.slice(0, 10),
      routineId: draft.routineId || null, programId: draft.programId || null, programDayId: draft.programDayId || null,
      notes: String(draft.notes || "").trim(), duration: elapsed > 0 ? Math.max(1, Math.round(elapsed / 60000)) : null,
      exercises: exercises, createdAt: now
    };
  }

  /* ---------------- rest timer (an end time, so it survives the screen locking) ---------------- */

  function clampRest(seconds) { const n = Math.round(Number(seconds)); return isFinite(n) ? Math.max(REST_MIN, Math.min(REST_MAX, n)) : DEFAULT_PREFS.restSeconds; }
  function restRemainingMs(endsAt, nowMs) { return isNum(endsAt) ? Math.max(0, Number(endsAt) - nowMs) : 0; }
  function startRest(nowMs, seconds) { return nowMs + clampRest(seconds) * 1000; }
  // +/- seconds on a running timer. Going to zero or below ends it (null).
  function adjustRest(endsAt, deltaSeconds, nowMs) {
    if (!isNum(endsAt) || Number(endsAt) <= nowMs) return null;
    const next = Number(endsAt) + deltaSeconds * 1000;
    return next <= nowMs ? null : next;
  }
  function formatClock(ms) {
    const sec = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h > 0 ? h + ":" + pad(m) + ":" + pad(s) : m + ":" + pad(s);
  }
  function sanitizePrefs(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    return { restSeconds: clampRest(r.restSeconds === undefined ? DEFAULT_PREFS.restSeconds : r.restSeconds), restAuto: r.restAuto !== false, restSound: r.restSound !== false };
  }

  /* ---------------- exercise names ---------------- */

  function nameKey(name) { return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
  function singular(w) { return /sses$/.test(w) ? w.slice(0, -2) : /[^s]s$/.test(w) ? w.slice(0, -1) : w; }
  function flatName(name) { return nameKey(name).split(" ").map(singular).join(""); }
  // An exercise that already exists under (nearly) the same name, or null. Case, punctuation, spaces and a plural s don't matter.
  function findDuplicate(name, exercises) {
    const want = flatName(name);
    if (!want) return null;
    return (exercises || []).filter(function (e) { return flatName(e.name) === want; })[0] || null;
  }

  return {
    DEFAULT_PREFS: DEFAULT_PREFS, REST_MIN: REST_MIN, REST_MAX: REST_MAX,
    e1rm: e1rm, validSet: validSet, working: working, volumeOf: volumeOf,
    dayKey: dayKey, addDays: addDays, weekStart: weekStart, mondayIndex: mondayIndex,
    sessionsOf: sessionsOf, previousPerformance: previousPerformance, lastTimeText: lastTimeText, suggestForPlan: suggestForPlan, plannedSetsOf: plannedSetsOf,
    bestSets: bestSets, sessionPRs: sessionPRs, recentPRs: recentPRs, sessionStats: sessionStats, compareToPrevious: compareToPrevious,
    weekSummary: weekSummary, recentRoutines: recentRoutines, lastWorkoutPlan: lastWorkoutPlan,
    makeId: makeId, newSet: newSet, emptyDraft: emptyDraft, migrateDraft: migrateDraft, cloneDraft: cloneDraft,
    exercisesFromRoutine: exercisesFromRoutine, exercisesFromLastWorkout: exercisesFromLastWorkout, exerciseFromHistory: exerciseFromHistory,
    pendingSets: pendingSets, afterComplete: afterComplete, buildSession: buildSession,
    clampRest: clampRest, restRemainingMs: restRemainingMs, startRest: startRest, adjustRest: adjustRest, formatClock: formatClock, sanitizePrefs: sanitizePrefs,
    nameKey: nameKey, findDuplicate: findDuplicate
  };
});
