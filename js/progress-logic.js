/* ==========================================================================
   JARVIS — Workout: the numbers behind History and Progress (pure functions, no page
   access, so they can be tested outside the browser).

   Every number here is worked out from the workouts you saved, and nothing else. If
   there is not enough to say something (one session, an empty earlier period), the answer
   is null and the screen says "not enough data" instead of guessing. There are no ratings,
   levels, scores or recovery estimates: those would need rules this app cannot back up.

   Definitions used on screen:
     - Working set: a set that is not marked warm-up.
     - Volume: weight x reps added up over working sets.
     - Estimated 1RM (est. 1RM): weight x (1 + reps / 30) (Epley). An estimate, not a tested max.
       For an exercise on one day, the best of its working sets.
     - Weeks run Monday to Sunday. The current week is "so far" and is left out of averages.
     - A period is compared with the period of the same length right before it.
     - Muscle sets: working sets counted for the exercise's main muscle. Optionally the helping
       muscles get half a set per set (an assumption, so it is off unless chosen).
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./workout-logic"));
  else root.JarvisProgressLogic = factory(root.JarvisWorkoutLogic);
})(typeof self !== "undefined" ? self : this, function (WL) {
  "use strict";

  const RANGES = [
    { key: "4w", label: "4 weeks", short: "4W", days: 28 },
    { key: "3m", label: "3 months", short: "3M", days: 90 },
    { key: "6m", label: "6 months", short: "6M", days: 180 },
    { key: "1y", label: "1 year", short: "1Y", days: 365 },
    { key: "all", label: "All time", short: "All", days: null }
  ];
  const DEFAULT_RANGE = "3m";
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function isNum(v) { return v !== "" && v !== null && v !== undefined && isFinite(Number(v)); }
  function round1(n) { return Math.round(n * 10) / 10; }
  function rangeInfo(key) { return RANGES.filter(function (r) { return r.key === key; })[0] || RANGES.filter(function (r) { return r.key === DEFAULT_RANGE; })[0]; }
  function datesOf(workouts) { return (Array.isArray(workouts) ? workouts : []).filter(function (w) { return w && typeof w.date === "string"; }); }

  /* ---------------- periods ---------------- */

  // The window to look at, and the same-length window right before it (null for "all time").
  // from: where the numbers really begin: the window's start, or the day of your first workout when that is later,
  // so a period that begins before you started training is not padded with empty weeks.
  function rangeBounds(key, todayKey, workouts) {
    const info = rangeInfo(key);
    const first = datesOf(workouts).map(function (w) { return w.date; }).sort()[0] || todayKey;
    if (info.days === null) {
      const start = first < todayKey ? first : todayKey;
      return { key: info.key, start: start, from: start, end: todayKey, prevStart: null, prevEnd: null, days: null, hasPrev: false };
    }
    const start = WL.addDays(todayKey, -(info.days - 1));
    const prevEnd = WL.addDays(start, -1);
    return { key: info.key, start: start, from: first > start ? (first < todayKey ? first : todayKey) : start, end: todayKey, prevStart: WL.addDays(prevEnd, -(info.days - 1)), prevEnd: prevEnd, days: info.days, hasPrev: true };
  }

  function inRange(items, start, end) {
    return (items || []).filter(function (w) { return w && typeof w.date === "string" && w.date >= start && w.date <= end; });
  }

  /* ---------------- totals and comparisons ---------------- */

  function summarize(sessions) {
    let sets = 0, volume = 0, minutes = 0, timed = 0;
    const exercises = {}, days = {};
    (sessions || []).forEach(function (w) {
      const st = WL.sessionStats(w);
      sets += st.workingSets; volume += st.volume;
      if (st.durationMin !== null && st.durationMin > 0) { minutes += st.durationMin; timed++; }
      days[w.date] = true;
      (w.exercises || []).forEach(function (se) { if (WL.working(se.sets).length) exercises[se.exerciseId] = true; });
    });
    return {
      workouts: (sessions || []).length, workingSets: sets, volume: Math.round(volume), minutes: minutes, timed: timed,
      avgMinutes: timed ? Math.round(minutes / timed) : null,
      exercises: Object.keys(exercises).length, activeDays: Object.keys(days).length
    };
  }

  // This period against the one before it, for one number. trend is null when there is nothing before to compare with.
  function compare(cur, prev, field) {
    const a = cur ? cur[field] : null, b = prev ? prev[field] : null;
    const usable = prev && prev.workouts > 0 && isNum(a) && isNum(b);
    if (!usable) return { value: isNum(a) ? Number(a) : null, prev: null, delta: null, pct: null, trend: null };
    const delta = Number(a) - Number(b);
    return { value: Number(a), prev: Number(b), delta: delta, pct: Number(b) > 0 ? Math.round(delta / Number(b) * 100) : null, trend: delta > 0 ? "up" : delta < 0 ? "down" : "same" };
  }

  /* ---------------- weeks ---------------- */

  function weekSpan(fromKey, toKey) {
    return Math.round((Date.parse(WL.weekStart(toKey) + "T00:00:00Z") - Date.parse(WL.weekStart(fromKey) + "T00:00:00Z")) / (7 * 86400000)) + 1;
  }

  // How many Monday-to-Sunday weeks the period touches, counting from where your numbers begin (never more than two years).
  function weeksFor(key, todayKey, workouts) {
    return Math.max(1, Math.min(104, weekSpan(rangeBounds(key, todayKey, workouts).from, todayKey)));
  }

  // Oldest week first; the last one is the current week (partial until Sunday). windowStart: the first day of the period,
  // so a first week that starts before it is marked clipped (it only counts the days inside the period).
  function weeklySeries(sessions, todayKey, weeks, windowStart) {
    const thisStart = WL.weekStart(todayKey), out = [];
    for (let i = weeks - 1; i >= 0; i--) {
      const start = WL.addDays(thisStart, -7 * i), end = WL.addDays(start, 6);
      out.push({ start: start, end: end, workouts: 0, sets: 0, volume: 0, minutes: 0, partial: end > todayKey, clipped: !!windowStart && windowStart > start });
    }
    (sessions || []).forEach(function (w) {
      const wk = out.filter(function (x) { return w.date >= x.start && w.date <= x.end; })[0];
      if (!wk) return;
      const st = WL.sessionStats(w);
      wk.workouts++; wk.sets += st.workingSets; wk.volume += st.volume; if (st.durationMin) wk.minutes += st.durationMin;
    });
    return out;
  }

  // How steady training has been, over complete weeks only (not this week so far, not a week cut off by the period's start). target = workouts per week you plan (or 0 for none).
  function consistency(weekly, target) {
    const done = weekly.filter(function (w) { return !w.partial && !w.clipped; });
    const need = target > 0 ? target : 1;
    let run = 0;
    for (let i = done.length - 1; i >= 0 && done[i].workouts >= need; i--) run++;
    const current = weekly.filter(function (w) { return w.partial; })[0] || null;
    return {
      weeks: done.length,
      avgPerWeek: done.length ? round1(done.reduce(function (t, w) { return t + w.workouts; }, 0) / done.length) : null,
      trainedWeeks: done.filter(function (w) { return w.workouts > 0; }).length,
      metTarget: target > 0 ? done.filter(function (w) { return w.workouts >= target; }).length : null,
      run: run, runNeed: need,
      bestWeek: done.reduce(function (m, w) { return Math.max(m, w.workouts); }, 0),
      thisWeek: current ? current.workouts : null
    };
  }

  // Whole days since the last workout (null when there is none), and the longest gap between two workouts in the period.
  function gaps(sessions, todayKey) {
    const days = Object.keys((sessions || []).reduce(function (o, w) { o[w.date] = true; return o; }, {})).sort();
    if (!days.length) return { daysSinceLast: null, longestGap: null };
    const diff = function (a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000); };
    let longest = 0;
    for (let i = 1; i < days.length; i++) longest = Math.max(longest, diff(days[i - 1], days[i]) - 1);
    return { daysSinceLast: Math.max(0, diff(days[days.length - 1], todayKey)), longestGap: days.length > 1 ? longest : null };
  }

  /* ---------------- the calendar ---------------- */

  function shiftMonth(year, month0, delta) {
    const t = year * 12 + month0 + delta;
    return { year: Math.floor(t / 12), month: ((t % 12) + 12) % 12 };
  }

  // A Monday-first grid for one month. Each day: how many workouts. workouts: anything with a .date (older entries too).
  function calendarMonth(workouts, year, month0, todayKey) {
    const first = year + "-" + String(month0 + 1).padStart(2, "0") + "-01";
    const offset = WL.mondayIndex(first);
    const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
    const rows = Math.ceil((offset + daysInMonth) / 7);
    const counts = {};
    datesOf(workouts).forEach(function (w) { counts[w.date] = (counts[w.date] || 0) + 1; });
    const weeks = [];
    let k = WL.weekStart(first), total = 0;
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < 7; c++) {
        const inMonth = k.slice(0, 7) === first.slice(0, 7);
        const n = counts[k] || 0;
        if (inMonth) total += n;
        row.push({ date: k, day: Number(k.slice(8)), inMonth: inMonth, count: n, today: k === todayKey, future: k > todayKey });
        k = WL.addDays(k, 1);
      }
      weeks.push(row);
    }
    return { year: year, month: month0, title: MONTHS[month0] + " " + year, weeks: weeks, total: total };
  }

  /* ---------------- one exercise ---------------- */

  function entryOf(w, id) { return (w.exercises || []).filter(function (x) { return x.exerciseId === id && Array.isArray(x.sets); })[0] || null; }

  // One point per day you did it: the best estimated 1RM of that day's working sets, the heaviest set, the volume.
  function exerciseSeries(sessions, exerciseId, start, end) {
    const pts = [];
    WL.sessionsOf(sessions).slice().sort(function (a, b) { return a.dateTime < b.dateTime ? -1 : a.dateTime > b.dateTime ? 1 : 0; }).forEach(function (w) {
      if ((start && w.date < start) || (end && w.date > end)) return;
      const se = entryOf(w, exerciseId);
      if (!se) return;
      const sets = WL.working(se.sets);
      if (!sets.length) return;
      let est = 0, top = null;
      sets.forEach(function (s) {
        const wt = Number(s.weight), r = Number(s.reps), e = WL.e1rm(wt, r);
        if (e > est) est = e;
        if (!top || wt > top.weight || (wt === top.weight && r > top.reps)) top = { weight: wt, reps: r };
      });
      pts.push({ date: w.date, sessionId: w.id, e1rm: round1(est), topWeight: top.weight, topReps: top.reps, volume: Math.round(WL.volumeOf(sets)), sets: sets.length });
    });
    return pts;
  }

  // Start to end of a series. null with fewer than two points: one session shows no change.
  function seriesChange(points, field) {
    if (!points || points.length < 2) return null;
    const a = points[0][field], b = points[points.length - 1][field];
    return { first: a, last: b, delta: round1(b - a), pct: a > 0 ? Math.round((b - a) / a * 100) : null, sessions: points.length };
  }

  function exerciseSummary(sessions, exerciseId) {
    const pts = exerciseSeries(sessions, exerciseId);
    if (!pts.length) return null;
    const best = WL.bestSets(sessions, exerciseId);
    let sets = 0, reps = 0, volume = 0;
    WL.sessionsOf(sessions).forEach(function (w) {
      const se = entryOf(w, exerciseId);
      if (!se) return;
      const ws = WL.working(se.sets);
      sets += ws.length; ws.forEach(function (s) { reps += Number(s.reps); }); volume += WL.volumeOf(ws);
    });
    return {
      sessions: pts.length, sets: sets, reps: reps, volume: Math.round(volume), firstDate: pts[0].date, lastDate: pts[pts.length - 1].date,
      bestE1rm: best.e1rm ? { value: round1(best.e1rm.value), weight: best.e1rm.weight, reps: best.e1rm.reps, date: best.e1rm.date } : null,
      heaviest: best.heaviest
    };
  }

  // Every exercise you have logged, the most-done first: [{ exerciseId, sessions, lastDate }].
  function exerciseList(sessions) {
    const map = {};
    WL.sessionsOf(sessions).forEach(function (w) {
      w.exercises.forEach(function (se) {
        if (!WL.working(se.sets).length) return;
        const m = map[se.exerciseId] || (map[se.exerciseId] = { exerciseId: se.exerciseId, sessions: 0, lastDate: "" });
        m.sessions++; if (w.date > m.lastDate) m.lastDate = w.date;
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return b.sessions - a.sessions || (a.lastDate < b.lastDate ? 1 : -1) || (a.exerciseId < b.exerciseId ? -1 : 1); });
  }

  // Each exercise's est. 1RM change across a period (null change with a single session).
  function topLifts(sessions, start, end, limit) {
    const list = exerciseList(inRange(WL.sessionsOf(sessions), start, end));
    return list.slice(0, limit || 8).map(function (e) {
      const pts = exerciseSeries(sessions, e.exerciseId, start, end);
      return { exerciseId: e.exerciseId, sessions: e.sessions, lastDate: e.lastDate, last: pts[pts.length - 1].e1rm, change: seriesChange(pts, "e1rm") };
    });
  }

  /* ---------------- records ---------------- */

  function recordsBetween(workouts, start, end, limit) {
    const all = WL.recentPRs(workouts, { sinceDate: start });
    const list = all.filter(function (e) { return e.date <= end; });
    return limit ? list.slice(0, limit) : list;
  }

  function recordCountBySession(workouts) {
    const out = {};
    WL.recentPRs(workouts, {}).forEach(function (e) { out[e.sessionId] = (out[e.sessionId] || 0) + 1; });
    return out;
  }

  /* ---------------- muscles ---------------- */

  // lookup(exerciseId) -> { primary: [name], secondary: [name] } or null. Working sets only.
  function muscleTotals(sessions, start, end, lookup, opts) {
    const half = !!(opts && opts.secondaryHalf);
    const by = {};
    let unknown = 0;
    inRange(WL.sessionsOf(sessions), start, end).forEach(function (w) {
      w.exercises.forEach(function (se) {
        const n = WL.working(se.sets).length;
        if (!n) return;
        const t = lookup(se.exerciseId);
        if (!t || !t.primary || !t.primary.length) { unknown += n; return; }
        t.primary.forEach(function (m) { by[m] = (by[m] || 0) + n; });
        if (half) (t.secondary || []).forEach(function (m) { by[m] = (by[m] || 0) + n * 0.5; });
      });
    });
    return { byMuscle: by, unknownSets: unknown };
  }

  // Ranked rows with sets per week over the period's complete weeks. weeks > 0.
  function muscleRows(byMuscle, weeks) {
    const rows = Object.keys(byMuscle).map(function (m) { return { muscle: m, sets: round1(byMuscle[m]) }; }).filter(function (r) { return r.sets > 0; })
      .sort(function (a, b) { return b.sets - a.sets || (a.muscle < b.muscle ? -1 : 1); });
    const max = rows.length ? rows[0].sets : 0;
    return rows.map(function (r) { return { muscle: r.muscle, sets: r.sets, perWeek: weeks > 0 ? round1(r.sets / weeks) : null, share: max > 0 ? r.sets / max : 0 }; });
  }

  // Whole days since each muscle was last the main target of a working set.
  function lastTrained(sessions, todayKey, lookup) {
    const last = {};
    WL.sessionsOf(sessions).forEach(function (w) {
      w.exercises.forEach(function (se) {
        if (!WL.working(se.sets).length) return;
        const t = lookup(se.exerciseId);
        if (!t) return;
        (t.primary || []).forEach(function (m) { if (!last[m] || w.date > last[m]) last[m] = w.date; });
      });
    });
    const out = {};
    Object.keys(last).forEach(function (m) { out[m] = Math.max(0, Math.round((Date.parse(todayKey + "T00:00:00Z") - Date.parse(last[m] + "T00:00:00Z")) / 86400000)); });
    return out;
  }

  /* ---------------- time spent ---------------- */

  function durationPoints(sessions) {
    return WL.sessionsOf(sessions).filter(function (w) { return isNum(w.duration) && Number(w.duration) > 0; })
      .map(function (w) { return { date: w.date, minutes: Number(w.duration) }; }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }

  /* ---------------- History ---------------- */

  function timeLabel(dateTime) {
    const m = /T(\d{2}):(\d{2})/.exec(String(dateTime || ""));
    if (!m) return "";
    const h = Number(m[1]);
    return ((h + 11) % 12 + 1) + ":" + m[2] + " " + (h < 12 ? "AM" : "PM");
  }

  function sortNewest(workouts) {
    return datesOf(workouts).slice().sort(function (a, b) {
      const x = String(a.dateTime || a.date), y = String(b.dateTime || b.date);
      return x < y ? 1 : x > y ? -1 : (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  // ctx: { label(workout) -> the routine's name, programText(workout) -> "PPL · Day 1" or "", exerciseName(id) }.
  function historyItem(w, ctx, prCounts) {
    if (w.schema !== 2 || !Array.isArray(w.exercises)) {
      return { id: w.id, kind: "legacy", title: w.name || "Workout", sub: w.category || "", date: w.date, time: "", minutes: isNum(w.duration) ? Number(w.duration) : null, sets: null, volume: null, exercises: [], moreCount: 0, prs: 0, notes: w.notes || "", program: "" };
    }
    const st = WL.sessionStats(w);
    const lines = w.exercises.filter(function (se) { return WL.working(se.sets).length; }).map(function (se) {
      const sets = WL.working(se.sets);
      let best = null;
      sets.forEach(function (s) { const wt = Number(s.weight), r = Number(s.reps); if (!best || wt > best.weight || (wt === best.weight && r > best.reps)) best = { weight: wt, reps: r }; });
      return { exerciseId: se.exerciseId, name: ctx.exerciseName(se.exerciseId), sets: sets.length, best: best };
    });
    return {
      id: w.id, kind: "session", title: ctx.label(w) || "Workout", sub: "", date: w.date, time: timeLabel(w.dateTime), minutes: st.durationMin, sets: st.workingSets,
      volume: st.volume, exercises: lines, moreCount: 0, prs: (prCounts && prCounts[w.id]) || 0, notes: w.notes || "", program: ctx.programText ? ctx.programText(w) : ""
    };
  }

  // Words must all appear in the title, the notes or an exercise name. day: only that date. routine: "" (all), "free" or a routine key.
  function filterHistory(workouts, f, ctx) {
    const words = String((f && f.query) || "").toLowerCase().split(/\s+/).filter(Boolean);
    return sortNewest(workouts).filter(function (w) {
      if (f && f.day && w.date !== f.day) return false;
      if (f && f.routine) {
        const key = routineKey(w, ctx);
        if (key !== f.routine) return false;
      }
      if (!words.length) return true;
      const hay = [w.schema === 2 ? ctx.label(w) : w.name, w.category || "", w.notes || ""].concat((w.exercises || []).map(function (se) { return ctx.exerciseName(se.exerciseId); })).join(" ").toLowerCase();
      return words.every(function (x) { return hay.indexOf(x) !== -1; });
    });
  }

  function routineKey(w, ctx) {
    if (w.schema !== 2) return "free";
    return w.routineId ? "r:" + w.routineId : "free";
  }

  // The routines to filter by: [{ key, label, count }], most workouts first; "free" for ones without a routine.
  function routineOptions(workouts, ctx) {
    const map = {};
    datesOf(workouts).forEach(function (w) {
      const key = routineKey(w, ctx);
      const label = key === "free" ? "No routine" : (ctx.label(w) || "Workout");
      const m = map[key] || (map[key] = { key: key, label: label, count: 0 });
      m.count++;
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return b.count - a.count || (a.label < b.label ? -1 : 1); });
  }

  return {
    RANGES: RANGES, DEFAULT_RANGE: DEFAULT_RANGE, rangeInfo: rangeInfo, rangeBounds: rangeBounds, inRange: inRange,
    summarize: summarize, compare: compare, weeksFor: weeksFor, weeklySeries: weeklySeries, consistency: consistency, gaps: gaps,
    shiftMonth: shiftMonth, calendarMonth: calendarMonth,
    exerciseSeries: exerciseSeries, seriesChange: seriesChange, exerciseSummary: exerciseSummary, exerciseList: exerciseList, topLifts: topLifts,
    recordsBetween: recordsBetween, recordCountBySession: recordCountBySession,
    muscleTotals: muscleTotals, muscleRows: muscleRows, lastTrained: lastTrained, durationPoints: durationPoints,
    timeLabel: timeLabel, sortNewest: sortNewest, historyItem: historyItem, filterHistory: filterHistory, routineOptions: routineOptions
  };
});
