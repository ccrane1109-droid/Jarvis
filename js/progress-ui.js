/* ==========================================================================
   JARVIS — Progress: what your saved workouts add up to. The Progress tab of Workout.

   Everything here is worked out from the workouts you saved (rules in progress-logic.js,
   drawing in charts.js). If there is not enough to say something, it says so.
   There is no strength score, level or recovery percentage on this screen, on purpose:
   those need standards and formulas this app cannot back up with your own logs.

   One period at the top (4 weeks ... all time) scopes everything below it, and every total is
   compared with the period of the same length right before it.
   Body weight and measurements are the same cards as before, in a section at the bottom.
   ========================================================================== */

(function () {
  "use strict";

  const PL = window.JarvisProgressLogic;
  const WL = window.JarvisWorkoutLogic;
  const RL = window.JarvisRoutineLogic;
  const CH = window.JarvisCharts;

  let started = false;
  const state = { range: PL ? PL.DEFAULT_RANGE : "3m", exerciseId: "", metric: "e1rm", half: false, side: "front", muscle: null, lifts: 5, records: 5, muscles: 6 };
  let drawn = [];   // the chart builders for what is on screen, so a resize can redraw them at the new width

  function $(id) { return document.getElementById(id); }
  function core() { return window.JarvisCore; }
  function esc(v) { return core().escapeHtml(v === undefined || v === null ? "" : String(v)); }
  function api() { return window.JarvisWorkout.api; }
  function plural(n, one, many) { return n === 1 ? one : (many || one + "s"); }
  function num(n) { return Number(n).toLocaleString("en-US"); }
  function exInfo(id) { return window.JarvisExercises.getExerciseById(id) || { id: id, name: "Unknown exercise", muscleGroup: "", equipment: "" }; }
  function dateOf(key) { const p = String(key).split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function shortDate(key, withYear) { return dateOf(key).toLocaleDateString("en-US", withYear ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" }); }
  function dayDate(key) { return dateOf(key).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); }
  function rangeText(a, b) { const y = a.slice(0, 4) !== b.slice(0, 4); return shortDate(a, y) + " – " + shortDate(b, y); }
  function minutesText(min) { return min >= 60 ? Math.floor(min / 60) + " h" + (min % 60 ? " " + String(min % 60).padStart(2, "0") + " min" : "") : min + " min"; }
  function signed(n, unit) { return (n > 0 ? "+" : n < 0 ? "−" : "") + num(Math.abs(Math.round(n * 10) / 10)) + (unit || ""); }

  /* ---------------- what to look at ---------------- */

  function model() {
    const a = api(), all = a.getWorkouts(), sessions = WL.sessionsOf(all), today = WL.dayKey(Date.now());
    const b = PL.rangeBounds(state.range, today, all);
    const cur = PL.inRange(sessions, b.start, b.end);
    const prev = b.hasPrev ? PL.inRange(sessions, b.prevStart, b.prevEnd) : [];
    const spanDays = b.days || Math.max(1, Math.round((Date.parse(b.end + "T00:00:00Z") - Date.parse(b.start + "T00:00:00Z")) / 86400000) + 1);
    return {
      all: all, sessions: sessions, today: today, b: b, cur: cur, prev: prev, spanDays: spanDays,
      sumCur: PL.summarize(cur), sumPrev: PL.summarize(prev),
      records: PL.recordsBetween(sessions, b.start, b.end), prevRecords: b.hasPrev ? PL.recordsBetween(sessions, b.prevStart, b.prevEnd) : [],
      plan: RL ? RL.plannedDayCount(a.getRoutines()) : 0
    };
  }

  function prevLabel(m) { const info = PL.rangeInfo(m.b.key); return "the previous " + info.label; }

  // "+2 (+20%) vs the previous 3 months", or why there is nothing to compare with.
  function deltaText(m, field, unit, fmt) {
    if (!m.b.hasPrev) return "All of your history";
    const c = PL.compare(m.sumCur, m.sumPrev, field);
    if (c.trend === null) return "Nothing in " + prevLabel(m) + " to compare with";
    if (c.trend === "same") return "Same as " + prevLabel(m);
    const f = fmt || function (n) { return signed(n, unit); };
    return f(c.delta) + (c.pct !== null ? " (" + (c.pct > 0 ? "+" : "−") + Math.abs(c.pct) + "%)" : "") + " vs " + prevLabel(m);
  }

  /* ---------------- sections ---------------- */

  function tile(label, value, note) {
    return '<li class="pg-tile"><span class="pg-tile-label">' + esc(label) + '</span><strong class="pg-tile-value">' + value + '</strong><span class="pg-tile-note">' + esc(note) + '</span></li>';
  }

  function periodHtml(m) {
    const b = m.b;
    return '<div class="pg-period" role="group" aria-label="Period">' + PL.RANGES.map(function (r) {
      return '<button type="button" class="pg-range' + (r.key === b.key ? " is-on" : "") + '" data-pg="range" data-range="' + r.key + '" aria-pressed="' + (r.key === b.key) + '" aria-label="' + esc(r.label) + '">' + esc(r.short) + '</button>';
    }).join("") + '</div><p class="pg-dates">' + esc(rangeText(b.from, b.end)) + (b.from > b.start ? ' (from your first workout)' : '') + (b.hasPrev ? ' &middot; compared with ' + esc(rangeText(b.prevStart, b.prevEnd)) : '') + '</p>';
  }

  function tilesHtml(m) {
    const s = m.sumCur;
    const avg = s.avgMinutes !== null ? minutesText(s.avgMinutes) : "–";
    const avgNote = s.avgMinutes === null ? "No workout in this period has a saved time" : (m.b.hasPrev && m.sumPrev.avgMinutes !== null ? deltaText(m, "avgMinutes", " min") : "Average per workout");
    return '<ul class="pg-tiles">' +
      tile("Workouts", num(s.workouts), deltaText(m, "workouts", "")) +
      tile("Volume", num(s.volume) + ' <span class="pg-unit">lb</span>', deltaText(m, "volume", " lb")) +
      tile("Average workout", avg, avgNote) +
      tile("Records", num(m.records.length), m.b.hasPrev ? (m.prevRecords.length ? signed(m.records.length - m.prevRecords.length, "") + " vs " + prevLabel(m) : "None in " + prevLabel(m)) : "All of your history") + '</ul>';
  }

  function weeklyItems(weekly, valueOf, textOf) {
    return weekly.map(function (w) {
      const part = w.partial ? " (this week so far)" : w.clipped ? " (only the days inside the period)" : "";
      return { label: shortDate(w.start), title: shortDate(w.start) + " – " + shortDate(w.end) + part, value: valueOf(w), valueText: textOf(w), state: w.partial || w.clipped ? "soft" : "" };
    });
  }

  function weekTable(weekly, head, valueText) {
    return { caption: head + " by week", headers: ["Week starting", head], rows: weekly.map(function (w) { return [shortDate(w.start) + (w.partial ? " (so far)" : w.clipped ? " (part)" : ""), valueText(w)]; }) };
  }

  function consistencyHtml(m) {
    const weeks = PL.weeksFor(m.b.key, m.today, m.sessions);
    const weekly = PL.weeklySeries(m.cur, m.today, weeks, m.b.from);
    const c = PL.consistency(weekly, m.plan);
    const gap = PL.gaps(m.cur, m.today), lastAll = PL.gaps(m.sessions, m.today);
    const facts = [];
    if (c.weeks > 0) facts.push('<strong>' + c.avgPerWeek + '</strong> workouts a week on average (over ' + c.weeks + ' full ' + plural(c.weeks, "week") + ')');
    else facts.push('No full week in this period yet, so no weekly average.');
    if (m.plan > 0 && c.weeks > 0) facts.push('Your routines are planned for ' + m.plan + ' ' + plural(m.plan, "day") + ' a week. You did that in <strong>' + c.metTarget + ' of ' + c.weeks + '</strong> full weeks.');
    if (c.weeks > 0) facts.push('Weeks in a row with ' + (m.plan > 0 ? 'your planned ' + m.plan : 'at least 1') + ' ' + plural(c.runNeed, "workout") + ': <strong>' + c.run + '</strong>.');
    if (lastAll.daysSinceLast !== null) facts.push('Last workout: ' + (lastAll.daysSinceLast === 0 ? 'today' : lastAll.daysSinceLast + ' ' + plural(lastAll.daysSinceLast, "day") + ' ago') + (gap.longestGap !== null ? '. Longest break in this period: ' + gap.longestGap + ' ' + plural(gap.longestGap, "day") + '.' : '.'));
    const items = weeklyItems(weekly, function (w) { return w.workouts; }, function (w) { return w.workouts + " " + plural(w.workouts, "workout"); });
    drawn.push({ id: "weekly", build: function (w) { return CH.columns(items, { width: w, height: 170, ariaLabel: "Workouts per week, " + PL.rangeInfo(m.b.key).label, caption: "Weeks run Monday to Sunday. Lighter columns are part weeks, so they look short.", table: weekTable(weekly, "Workouts", function (x) { return String(x.workouts); }) }); } });
    return section("Consistency", "pgConsistency", '<div class="pg-chart" data-pg-chart="weekly"></div><ul class="pg-facts">' + facts.map(function (f) { return '<li>' + f + '</li>'; }).join("") + '</ul>');
  }

  function section(title, id, body, hint) {
    return '<section class="card pg-sec" id="' + id + '" aria-labelledby="' + id + 'H"><h2 class="card-title" id="' + id + 'H">' + esc(title) + '</h2>' + (hint ? '<p class="field-hint">' + hint + '</p>' : '') + body + '</section>';
  }

  /* ---- strength ---- */

  function metricInfo(metric) {
    if (metric === "heaviest") return { key: "topWeight", label: "Heaviest set", text: function (p) { return num(p.topWeight) + " lb × " + p.topReps; }, title: "Heaviest set" };
    if (metric === "volume") return { key: "volume", label: "Volume", text: function (p) { return num(p.volume) + " lb"; }, title: "Volume per workout" };
    return { key: "e1rm", label: "Est. 1RM", text: function (p) { return Math.round(p.e1rm) + " lb est. 1RM"; }, title: "Estimated 1RM" };
  }

  function strengthHtml(m) {
    const list = PL.exerciseList(m.sessions);
    if (!list.length) return section("Strength", "pgStrength", '<p class="wk-empty">Log a few workouts and your lifts show up here.</p>');
    const inRange = {};
    PL.exerciseList(m.cur).forEach(function (e) { inRange[e.exerciseId] = e.sessions; });
    const ordered = list.slice().sort(function (a, b) { return (inRange[b.exerciseId] || 0) - (inRange[a.exerciseId] || 0) || b.sessions - a.sessions; });
    if (!state.exerciseId || !list.some(function (e) { return e.exerciseId === state.exerciseId; })) state.exerciseId = ordered[0].exerciseId;
    const id = state.exerciseId, info = exInfo(id), mi = metricInfo(state.metric);
    const pts = PL.exerciseSeries(m.sessions, id, m.b.start, m.b.end);
    const sum = PL.exerciseSummary(m.sessions, id);
    const change = PL.seriesChange(pts, "e1rm");
    const select = '<div class="form-row"><label for="pgExercise">Exercise</label><select id="pgExercise">' + ordered.map(function (e) { return '<option value="' + esc(e.exerciseId) + '"' + (e.exerciseId === id ? " selected" : "") + '>' + esc(exInfo(e.exerciseId).name) + ' (' + (inRange[e.exerciseId] || 0) + ' in period)</option>'; }).join("") + '</select></div>';
    const metrics = '<div class="pg-metrics" role="group" aria-label="What to chart">' + [["e1rm", "Est. 1RM"], ["heaviest", "Heaviest"], ["volume", "Volume"]].map(function (x) { return '<button type="button" class="pg-metric' + (state.metric === x[0] ? " is-on" : "") + '" data-pg="metric" data-metric="' + x[0] + '" aria-pressed="' + (state.metric === x[0]) + '">' + x[1] + '</button>'; }).join("") + '</div>';
    let chart;
    if (pts.length >= 2) {
      const points = pts.map(function (p) { return { x: p.date, y: p[mi.key], label: shortDate(p.date), title: dayDate(p.date), valueText: mi.text(p) }; });
      drawn.push({ id: "lift", build: function (w) { return CH.line(points, { width: w, height: 190, ariaLabel: info.name + ", " + mi.title + ", " + pts.length + " sessions", caption: state.metric === "e1rm" ? "Estimated 1RM is worked out from weight and reps (Epley). It is not a tested max." : state.metric === "heaviest" ? "The heaviest working set of each workout." : "Weight × reps over working sets, per workout.", table: { caption: info.name + " " + mi.title, headers: ["Date", "Est. 1RM (lb)", "Heaviest set", "Volume (lb)"], rows: pts.map(function (p) { return [dayDate(p.date), String(Math.round(p.e1rm)), num(p.topWeight) + " × " + p.topReps, num(p.volume)]; }) } }); } });
      chart = '<div class="pg-chart" data-pg-chart="lift"></div>';
    } else if (pts.length === 1) {
      chart = '<p class="wk-empty">One session in this period (' + esc(dayDate(pts[0].date)) + '): ' + esc(mi.text(pts[0])) + '. A line needs two sessions.</p>';
    } else {
      chart = '<p class="wk-empty">No sessions of this exercise in this period.' + (m.b.key !== "all" ? ' Try a longer period.' : '') + '</p>';
    }
    const facts = [];
    if (change) facts.push('In this period: est. 1RM <strong>' + Math.round(change.first) + ' → ' + Math.round(change.last) + ' lb</strong> (' + signed(change.delta, " lb") + (change.pct !== null ? ', ' + (change.pct > 0 ? "+" : change.pct < 0 ? "−" : "") + Math.abs(change.pct) + '%' : '') + ') over ' + change.sessions + ' sessions.');
    if (sum) {
      if (sum.bestE1rm) facts.push('Best est. 1RM ever: <strong>' + Math.round(sum.bestE1rm.value) + ' lb</strong> (' + num(sum.bestE1rm.weight) + ' × ' + sum.bestE1rm.reps + ' on ' + esc(shortDate(sum.bestE1rm.date, true)) + ').');
      if (sum.heaviest) facts.push('Heaviest set ever: <strong>' + num(sum.heaviest.weight) + ' × ' + sum.heaviest.reps + '</strong> (' + esc(shortDate(sum.heaviest.date, true)) + ').');
      facts.push(sum.sessions + ' ' + plural(sum.sessions, "session") + ' saved, ' + sum.sets + ' working ' + plural(sum.sets, "set") + ', last on ' + esc(shortDate(sum.lastDate, true)) + '.');
    }
    const recs = m.records.filter(function (r) { return r.exerciseId === id; }).slice(0, 5);
    const recHtml = recs.length ? '<h3 class="pg-sub">Records for ' + esc(info.name) + '</h3><ul class="pg-plain">' + recs.map(function (r) { return '<li>' + esc(dayDate(r.date)) + ': ' + num(r.weight) + ' × ' + r.reps + ', est. 1RM ' + Math.round(r.e1rm) + ' (was ' + Math.round(r.previousE1rm) + ')</li>'; }).join("") + '</ul>' : "";
    const top = PL.topLifts(m.sessions, m.b.start, m.b.end, state.lifts + 1);
    const shownTop = top.slice(0, state.lifts);
    const topHtml = shownTop.length ? '<h3 class="pg-sub">All lifts in this period</h3><ul class="pg-lifts">' + shownTop.map(function (t) {
      const ch = t.change ? signed(t.change.delta, " lb") + (t.change.pct !== null ? " (" + (t.change.pct > 0 ? "+" : t.change.pct < 0 ? "−" : "") + Math.abs(t.change.pct) + "%)" : "") : "1 session";
      return '<li><button type="button" class="pg-lift' + (t.exerciseId === id ? " is-on" : "") + '" data-pg="lift" data-id="' + esc(t.exerciseId) + '"><span class="pg-lift-name">' + esc(exInfo(t.exerciseId).name) + '</span><span class="pg-lift-val">' + Math.round(t.last) + ' lb</span><span class="pg-lift-ch">' + esc(ch) + '</span></button></li>';
    }).join("") + '</ul>' + (top.length > state.lifts ? '<button type="button" class="btn btn-secondary pg-more" data-pg="more-lifts">Show more lifts</button>' : '') +
      '<p class="field-hint">Last est. 1RM in the period, and how it changed from the first session in it. Tap one to chart it.</p>' : "";
    return section("Strength", "pgStrength", select + metrics + chart + '<ul class="pg-facts">' + facts.map(function (f) { return '<li>' + f + '</li>'; }).join("") + '</ul>' + recHtml + topHtml);
  }

  /* ---- volume and time ---- */

  function volumeHtml(m) {
    const weeks = PL.weeksFor(m.b.key, m.today, m.sessions);
    const weekly = PL.weeklySeries(m.cur, m.today, weeks, m.b.from);
    const items = weeklyItems(weekly, function (w) { return w.volume; }, function (w) { return num(w.volume) + " lb"; });
    drawn.push({ id: "volume", build: function (w) { return CH.columns(items, { width: w, height: 170, ariaLabel: "Volume per week, " + PL.rangeInfo(m.b.key).label, caption: "Volume is weight × reps over working sets; warm-ups are not counted. Lighter columns are part weeks.", table: weekTable(weekly, "Volume (lb)", function (x) { return num(x.volume); }) }); } });
    const s = m.sumCur;
    const facts = s.workouts ? ['<strong>' + num(s.volume) + ' lb</strong> in total over ' + s.workouts + ' ' + plural(s.workouts, "workout") + ', ' + num(s.workingSets) + ' working ' + plural(s.workingSets, "set") + '.', 'About ' + num(Math.round(s.volume / s.workouts)) + ' lb per workout.'] : ['No workouts in this period.'];
    return section("Volume", "pgVolume", '<div class="pg-chart" data-pg-chart="volume"></div><ul class="pg-facts">' + facts.map(function (f) { return '<li>' + f + '</li>'; }).join("") + '</ul>');
  }

  function timeHtml(m) {
    const s = m.sumCur;
    if (!s.timed) return section("Time", "pgTime", '<p class="wk-empty">No workout in this period has a saved time. The logger saves one when you finish a workout.</p>');
    const weeks = PL.weeksFor(m.b.key, m.today, m.sessions);
    const weekly = PL.weeklySeries(m.cur, m.today, weeks, m.b.from);
    const items = weeklyItems(weekly, function (w) { return w.minutes; }, function (w) { return minutesText(w.minutes); });
    drawn.push({ id: "time", build: function (w) { return CH.columns(items, { width: w, height: 160, ariaLabel: "Time trained per week, " + PL.rangeInfo(m.b.key).label, caption: "Only workouts with a saved time are counted. Lighter columns are part weeks.", table: weekTable(weekly, "Minutes", function (x) { return String(x.minutes); }) }); } });
    const longest = PL.durationPoints(m.cur).reduce(function (mx, p) { return Math.max(mx, p.minutes); }, 0);
    const facts = ['<strong>' + minutesText(s.minutes) + '</strong> in total across ' + s.timed + ' timed ' + plural(s.timed, "workout") + '.', 'Average ' + minutesText(s.avgMinutes) + ', longest ' + minutesText(longest) + '.'];
    return section("Time", "pgTime", '<div class="pg-chart" data-pg-chart="time"></div><ul class="pg-facts">' + facts.map(function (f) { return '<li>' + f + '</li>'; }).join("") + '</ul>');
  }

  /* ---- muscles ---- */

  function fineLookup(id) { const t = window.JarvisExercises.getFineMuscleTargets(id); return t && t.primary.length ? t : null; }

  function muscleModel(m) {
    const t = PL.muscleTotals(m.sessions, m.b.start, m.b.end, fineLookup, { secondaryHalf: state.half });
    const weeksF = Math.max(1, m.spanDays / 7);   // "about N a week" is never worked out over less than a week
    const rows = PL.muscleRows(t.byMuscle, weeksF);
    const max = rows.length ? rows[0].sets : 0;
    return { totals: t, rows: rows, max: max, last: PL.lastTrained(m.sessions, m.today, fineLookup), weeks: weeksF };
  }

  function mapHtml(m, mm) {
    const colors = {};
    api().fineMuscles.forEach(function (name) { colors[name] = CH.heatColor(mm.totals.byMuscle[name] || 0, mm.max); });
    const svg = api().bodyMapSvg(state.side, colors, state.muscle).replace(/id="bodyShade"/g, 'id="pgShade"').replace(/id="heatBlur"/g, 'id="pgBlur"').replace(/url\(#bodyShade\)/g, "url(#pgShade)");
    const bands = mm.max > 0 ? CH.heatBands(mm.max) : [];
    const legend = '<ul class="pg-legend" aria-label="Colour scale, sets in this period"><li><span class="pg-swatch pg-swatch-none"></span>0 sets</li>' + bands.map(function (b) { return '<li><span class="pg-swatch" style="background:' + b.color + '"></span>' + (b.from === b.to ? b.from : b.from + "–" + b.to) + ' ' + plural(b.to, "set") + '</li>'; }).join("") + '</ul>';
    const sides = '<div class="pg-metrics pg-sides" role="group" aria-label="Which side of the body">' + [["front", "Front"], ["back", "Back"]].map(function (x) { return '<button type="button" class="pg-metric' + (state.side === x[0] ? " is-on" : "") + '" data-pg="side" data-side="' + x[0] + '" aria-pressed="' + (state.side === x[0]) + '">' + x[1] + '</button>'; }).join("") + '</div>';
    return sides + '<div class="pg-map" data-pg-map>' + svg + '</div>' + legend + '<div id="pgMuscleInfo" class="pg-muscle-info" aria-live="polite">' + muscleInfoHtml(m, mm) + '</div>';
  }

  function muscleInfoHtml(m, mm) {
    const name = state.muscle;
    if (!name) return '<p class="field-hint">Tap a muscle on the body for its sets, when you last trained it, and which exercises counted.</p>';
    const label = api().muscleName(name);
    const sets = mm.totals.byMuscle[name] || 0;
    const byEx = {};
    m.cur.forEach(function (w) {
      w.exercises.forEach(function (se) {
        const n = WL.working(se.sets).length;
        if (!n) return;
        const t = fineLookup(se.exerciseId);
        if (!t) return;
        if (t.primary.indexOf(name) !== -1) byEx[se.exerciseId] = (byEx[se.exerciseId] || 0) + n;
        else if (state.half && t.secondary.indexOf(name) !== -1) byEx[se.exerciseId] = (byEx[se.exerciseId] || 0) + n * 0.5;
      });
    });
    const exList = Object.keys(byEx).sort(function (a, b) { return byEx[b] - byEx[a]; }).slice(0, 5).map(function (id) { return esc(exInfo(id).name) + " (" + (Math.round(byEx[id] * 10) / 10) + ")"; });
    const ago = mm.last[name];
    return '<div class="pg-muscle-card"><div class="pg-muscle-head"><strong>' + esc(label) + '</strong><button type="button" class="wk-link" data-pg="muscle-close">Close</button></div>' +
      '<p>' + (sets ? '<strong>' + (Math.round(sets * 10) / 10) + '</strong> ' + plural(sets, "set") + ' in this period, about ' + (Math.round(sets / mm.weeks * 10) / 10) + ' a week.' : 'No sets in this period.') + (ago !== undefined ? ' Last trained ' + (ago === 0 ? 'today' : ago + ' ' + plural(ago, "day") + ' ago') + '.' : ' Never trained as a main muscle.') + '</p>' +
      (exList.length ? '<p class="pg-muted">From: ' + exList.join(", ") + '</p>' : '') + '</div>';
  }

  function musclesHtml(m) {
    if (!m.cur.length) return section("Muscles", "pgMuscles", '<p class="wk-empty">No workouts in this period.</p>');
    const mm = muscleModel(m);
    const rows = mm.rows.slice(0, state.muscles).map(function (r) {
      const ago = mm.last[r.muscle];
      return { label: api().muscleName(r.muscle), value: r.sets, valueText: r.sets + " " + plural(r.sets, "set"), note: "about " + r.perWeek + " a week" + (ago !== undefined ? " · last trained " + (ago === 0 ? "today" : ago + "d ago") : "") };
    });
    const untrained = api().fineMuscles.filter(function (n) { return !mm.totals.byMuscle[n]; }).map(function (n) { return api().muscleName(n); });
    const notes = [];
    if (untrained.length) notes.push('No sets in this period for: ' + esc(untrained.join(", ")) + '.');
    if (mm.totals.unknownSets) notes.push(num(mm.totals.unknownSets) + ' ' + plural(mm.totals.unknownSets, "set") + ' ' + plural(mm.totals.unknownSets, "is", "are") + ' for exercises with no muscle on record, so ' + plural(mm.totals.unknownSets, "it is", "they are") + ' not counted here.');
    const half = '<label class="wk-check-row pg-half"><input type="checkbox" id="pgHalf"' + (state.half ? " checked" : "") + '> <span>Count helping muscles as half a set</span></label>';
    return section("Muscles", "pgMuscles", half + mapHtml(m, mm) + '<h3 class="pg-sub">Sets by muscle</h3>' + (rows.length ? CH.rankedBars(rows, { ariaLabel: "Working sets per muscle, " + PL.rangeInfo(m.b.key).label }) : '<p class="wk-empty">No sets counted.</p>') +
      (mm.rows.length > rows.length ? '<button type="button" class="btn btn-secondary pg-more" data-pg="more-muscles">Show all ' + mm.rows.length + ' muscles</button>' : '') +
      (notes.length ? '<ul class="pg-facts">' + notes.map(function (n) { return '<li>' + n + '</li>'; }).join("") + '</ul>' : '') +
      '<p class="field-hint">Each working set counts for the exercise\'s main muscle' + (state.half ? ', and half a set for the muscles that help' : '') + '. It is a simple count of sets, not a measure of how hard a muscle worked.</p>');
  }

  /* ---- records ---- */

  function recordsHtml(m) {
    const list = m.records;
    if (!list.length) return section("Records", "pgRecords", '<p class="wk-empty">No records in this period. A record is a heavier working set, or a higher estimated 1RM, than anything you saved before.</p>');
    const shown = list.slice(0, state.records);
    return section("Records", "pgRecords", '<ul class="pg-records">' + shown.map(function (r) {
      return '<li><span class="pg-rec-name">' + esc(exInfo(r.exerciseId).name) + '</span><span class="pg-rec-set">' + num(r.weight) + ' × ' + r.reps + '</span><span class="pg-rec-meta">' + esc(dayDate(r.date)) + ' &middot; est. 1RM ' + Math.round(r.e1rm) + ' (was ' + Math.round(r.previousE1rm) + ')</span></li>';
    }).join("") + '</ul>' + (list.length > shown.length ? '<button type="button" class="btn btn-secondary pg-more" data-pg="more-records">Show ' + (list.length - shown.length) + ' more</button>' : '') +
      '<p class="field-hint">A record beats everything you saved before it. Your very first time doing an exercise is a starting point, not a record.</p>');
  }

  function aboutHtml() {
    return '<details class="card pg-about"><summary>How these numbers are worked out</summary><ul class="pg-plain">' +
      '<li><strong>Working set:</strong> any set not marked warm-up.</li>' +
      '<li><strong>Volume:</strong> weight × reps, added up over working sets.</li>' +
      '<li><strong>Est. 1RM:</strong> weight × (1 + reps ÷ 30), the best working set of the day. An estimate, not a tested max.</li>' +
      '<li><strong>Weeks:</strong> Monday to Sunday. This week so far is left out of averages.</li>' +
      '<li><strong>Compared with:</strong> the period of the same length right before the one you picked.</li>' +
      '<li><strong>Muscles:</strong> working sets counted for each exercise\'s main muscle.</li>' +
      '<li><strong>Not shown:</strong> JARVIS used to show an overall strength score, strength levels and a muscle readiness percentage. They came from population tables and an invented recovery formula, so they are gone. Only numbers your own workouts can back up are shown.</li></ul></details>';
  }

  /* ---------------- drawing ---------------- */

  function render() {
    const root = $("pgRoot");
    if (!root) return;
    const keep = window.scrollY;
    const focusId = document.activeElement && document.activeElement.id && root.contains(document.activeElement) ? document.activeElement.id : null;
    drawn = [];
    if (!api().getWorkouts().some(function (w) { return w && typeof w.date === "string"; })) {
      root.innerHTML = '<section class="wk-block"><p class="wk-empty">Nothing to show yet. After your first workout, this screen shows how often you train, how your lifts change, your records and which muscles you work.</p><button type="button" class="btn btn-primary wk-big-btn" data-wk-go="wk-home">Back to Home</button></section>';
      return;
    }
    const m = model();
    const sections = consistencyHtml(m) + strengthHtml(m) + volumeHtml(m) + timeHtml(m) + musclesHtml(m) + recordsHtml(m);
    root.innerHTML = periodHtml(m) + tilesHtml(m) + jumpHtml(sections) + insightsHtml() + sections + aboutHtml();
    drawCharts();
    window.scrollTo(0, keep);
    if (focusId) { const f = $(focusId); if (f) f.focus({ preventScroll: true }); }
  }

  // Progress is a long page, so a row of buttons gets you to a section in one tap. Only the sections that are on the page are listed.
  function jumpHtml(sectionsHtml) {
    const items = [["pgConsistency", "Consistency"], ["pgStrength", "Strength"], ["pgVolume", "Volume"], ["pgTime", "Time"], ["pgMuscles", "Muscles"], ["pgRecords", "Records"]]
      .filter(function (i) { return sectionsHtml.indexOf('id="' + i[0] + '"') !== -1; });
    if (items.length < 2) return "";
    return '<nav class="pg-jump" aria-label="Jump to a section"><span class="pg-jump-label">Jump to</span>' + items.map(function (i) {
      return '<button type="button" class="pg-jump-btn" data-pg="jump" data-target="' + i[0] + '">' + esc(i[1]) + '</button>';
    }).join("") + '</nav>';
  }

  // The "What I noticed" card (insights-ui.js). If that file failed to load, Progress simply has no card.
  function insightsHtml() { try { return window.JarvisInsights ? window.JarvisInsights.cardHtml() : ""; } catch (e) { return ""; } }

  function drawCharts() {
    const root = $("pgRoot");
    if (!root) return;
    drawn.forEach(function (d) {
      const el = root.querySelector('[data-pg-chart="' + d.id + '"]');
      if (!el) return;
      const w = Math.floor(el.clientWidth);
      if (w < 120) return;   // the tab isn't showing; it draws when it is
      el.innerHTML = d.build(w);
      el._built = true;
    });
  }

  /* ---------------- chart reading: tooltip, crosshair, arrow keys ---------------- */

  function chartData(wrap) { if (!wrap._d) { try { wrap._d = JSON.parse(wrap.getAttribute("data-chart")); } catch (e) { wrap._d = { xs: [], tips: [], kind: "" }; } } return wrap._d; }

  function showPoint(wrap, idx, announce) {
    const d = chartData(wrap), n = d.xs.length;
    if (!n) return;
    idx = Math.max(0, Math.min(n - 1, idx));
    const tip = wrap.querySelector(".ch-tip");
    tip.querySelector(".ch-tip-value").textContent = d.tips[idx].v;
    tip.querySelector(".ch-tip-label").textContent = d.tips[idx].t;
    tip.hidden = false;
    const w = wrap.clientWidth, tw = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(w - tw, d.xs[idx] - tw / 2)) + "px";
    wrap.querySelectorAll(".ch-bar.is-hot").forEach(function (b) { b.classList.remove("is-hot"); });
    if (d.kind === "columns") { const bar = wrap.querySelector('.ch-bar[data-i="' + idx + '"]'); if (bar) bar.classList.add("is-hot"); }
    else if (d.kind === "line") {
      const cross = wrap.querySelector(".ch-cross"), hot = wrap.querySelector(".ch-hot");
      if (cross) { cross.setAttribute("x1", d.xs[idx]); cross.setAttribute("x2", d.xs[idx]); cross.setAttribute("visibility", "visible"); }
      if (hot) { hot.setAttribute("cx", d.xs[idx]); hot.setAttribute("cy", d.ys[idx]); hot.setAttribute("visibility", "visible"); }
    }
    wrap._idx = idx;
    if (announce) { const live = wrap.querySelector(".ch-live"); if (live) live.textContent = d.tips[idx].l; }
  }

  function hidePoint(wrap) {
    const tip = wrap.querySelector(".ch-tip");
    if (tip) tip.hidden = true;
    wrap.querySelectorAll(".ch-bar.is-hot").forEach(function (b) { b.classList.remove("is-hot"); });
    const cross = wrap.querySelector(".ch-cross"), hot = wrap.querySelector(".ch-hot");
    if (cross) cross.setAttribute("visibility", "hidden");
    if (hot) hot.setAttribute("visibility", "hidden");
  }

  function nearest(d, x) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < d.xs.length; i++) { const dist = Math.abs(d.xs[i] - x); if (dist < bd) { bd = dist; best = i; } }
    return best;
  }

  function onPointer(e) {
    const wrap = e.target.closest && e.target.closest(".ch");
    if (!wrap) return;
    if (e.type === "pointermove" && e.pointerType === "touch" && !(e.buttons & 1) && e.pressure === 0) return;
    wrap._ptr = Date.now();
    const rect = wrap.getBoundingClientRect();
    showPoint(wrap, nearest(chartData(wrap), e.clientX - rect.left), false);
  }

  function onKey(e) {
    const wrap = e.target.closest && e.target.closest(".ch");
    if (!wrap || e.target !== wrap) return;
    const d = chartData(wrap), cur = wrap._idx === undefined ? d.xs.length - 1 : wrap._idx;
    let next = null;
    if (e.key === "ArrowLeft") next = cur - 1; else if (e.key === "ArrowRight") next = cur + 1; else if (e.key === "Home") next = 0; else if (e.key === "End") next = d.xs.length - 1;
    if (next === null) return;
    e.preventDefault();
    showPoint(wrap, next, true);
  }

  /* ---------------- the body map ---------------- */

  function mapTap(e) {
    const box = e.target.closest("[data-pg-map]");
    if (!box) return false;
    let el = e.target.closest("[data-muscle]");
    if (!el) {
      const svg = box.querySelector("svg");
      const ctm = svg && svg.getScreenCTM();
      if (ctm) {
        const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
        const p = pt.matrixTransform(ctm.inverse());
        let best = null, bd = Infinity;
        svg.querySelectorAll("[data-muscle]").forEach(function (r) { const bb = r.getBBox(), d = Math.hypot(p.x - (bb.x + bb.width / 2), p.y - (bb.y + bb.height / 2)); if (d < bd) { bd = d; best = r; } });
        if (best && bd < 40) el = best;
      }
    }
    if (!el) return true;
    const name = el.getAttribute("data-muscle");
    state.muscle = state.muscle === name ? null : name;
    render();
    return true;
  }

  /* ---------------- events ---------------- */

  function onClick(e) {
    if (!$("pgRoot") || !$("pgRoot").contains(e.target)) return;
    if (mapTap(e)) return;
    const el = e.target.closest("[data-pg]");
    if (!el) return;
    const act = el.getAttribute("data-pg");
    switch (act) {
      case "jump": { const t = $(el.getAttribute("data-target")), h = t && $(el.getAttribute("data-target") + "H"); if (t) { t.scrollIntoView({ block: "start" }); if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); } } break; }
      case "range": state.range = el.getAttribute("data-range"); render(); break;
      case "metric": state.metric = el.getAttribute("data-metric"); render(); break;
      case "side": state.side = el.getAttribute("data-side"); render(); break;
      case "lift": state.exerciseId = el.getAttribute("data-id"); render(); { const s = $("pgStrengthH"); if (s) { s.setAttribute("tabindex", "-1"); s.scrollIntoView({ block: "start" }); s.focus({ preventScroll: true }); } } break;
      case "more-lifts": state.lifts += 10; render(); break;
      case "more-records": state.records += 10; render(); break;
      case "more-muscles": state.muscles = 99; render(); break;
      case "muscle-close": state.muscle = null; render(); break;
      default: break;
    }
  }

  function onChange(e) {
    if (e.target.id === "pgExercise") { state.exerciseId = e.target.value; render(); }
    else if (e.target.id === "pgHalf") { state.half = e.target.checked; render(); }
  }

  function init() {
    if (started) return;
    if (!PL || !WL || !CH || !$("pgRoot") || !window.JarvisWorkout || !window.JarvisWorkout.api) { const l = $("pgLegacy"), m = $("pgRoot"); if (l) l.hidden = false; if (m) m.hidden = true; return; }
    started = true;
    const panel = $("workout-progress");
    panel.addEventListener("click", onClick);
    panel.addEventListener("change", onChange);
    panel.addEventListener("pointermove", onPointer);
    panel.addEventListener("pointerdown", onPointer);
    panel.addEventListener("keydown", onKey);
    // Focusing a chart with the keyboard shows its newest point. A tap or click also focuses it, but then the point you touched stays.
    panel.addEventListener("focusin", function (e) { const w = e.target.classList && e.target.classList.contains("ch") ? e.target : null; if (w && Date.now() - (w._ptr || 0) > 500) showPoint(w, chartData(w).xs.length - 1, true); });
    panel.addEventListener("focusout", function (e) { const w = e.target.classList && e.target.classList.contains("ch") ? e.target : null; if (w) hidePoint(w); });
    panel.addEventListener("pointerout", function (e) { if (e.pointerType !== "mouse") return; const w = e.target.closest && e.target.closest(".ch"); if (w && !(e.relatedTarget && w.contains(e.relatedTarget))) hidePoint(w); });
    document.addEventListener("pointerdown", function (e) { if (!e.target.closest || !e.target.closest(".ch")) panel.querySelectorAll(".ch").forEach(hidePoint); });
    document.addEventListener("jarvis-workout-changed", function () { if (!(document.activeElement && document.activeElement.id === "pgExercise")) render(); });
    let timer = null;
    window.addEventListener("resize", function () { window.clearTimeout(timer); timer = window.setTimeout(function () { if (panel.classList.contains("active")) drawCharts(); }, 150); });
    const tab = $("workoutSubNavProgress");
    if (tab) tab.addEventListener("click", function () { window.setTimeout(render, 0); });
    render();
  }

  window.JarvisProgressUI = { init: init, render: render };
})();
