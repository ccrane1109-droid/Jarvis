/* ==========================================================================
   JARVIS — Workout: the training assistant's rules (pure functions, no page access, so they
   can be tested outside the browser).

   This is NOT an AI model and it does not learn. It is a short list of plain rules applied to
   the workouts you saved, and every note it produces carries the numbers and the rule behind it
   (the "why" lines). If your history is too short for a rule, the rule says nothing: there is no
   filler and no guessing. Anything that is general training advice rather than something in
   your own log is labelled that way.

   It never changes a weight by itself. A suggested weight is only shown; the logger changes a set
   only when you tap "Use". Sets you already finished are never touched.

   The rules and their thresholds (all written here so they can be checked):
     Ready to progress  Your plan for an exercise has the same rep target on every working set. In your last
                        two sessions of it you did at least as many sets as planned, at the same heaviest
                        weight, each reaching the rep target. Then: that weight + a small step (5 lb, or 2.5 lb
                        under 30 lb). Held back when a set at that weight was rated RPE 9.5 or more, or when it
                        has been more than 28 days since you did the exercise. Never for bodyweight-only work.
     Plateau            Your best estimated 1RM for an exercise is at least 4 sessions and 21 days old, nothing
                        since has beaten it, and you are still doing the exercise (last time within 42 days).
     Improvement        Over the last 90 days, an exercise with 3+ sessions over 14+ days whose estimated 1RM rose
                        3% or more (best of the first sessions against best of the latest ones).
     Volume             The last 4 weeks against the 4 weeks before: volume changed 20% or more, the earlier
                        4 weeks had 3+ workouts, and your history covers all of the earlier 4 weeks.
     Muscles            Same two windows: a muscle with 8+ working sets in the earlier window that fell 40% or
                        more, or rose 50% or more.
     Recovery notes     Only facts from your log: 4+ training days in a row, the same main muscle hit on two days
                        in a row (3+ sets each), 14+ days since your last workout. There is no sleep, soreness or
                        heart-rate data here, so it cannot tell you how recovered you are.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./workout-logic"), require("./progress-logic"));
  else root.JarvisInsightsLogic = factory(root.JarvisWorkoutLogic, root.JarvisProgressLogic);
})(typeof self !== "undefined" ? self : this, function (WL, PL) {
  "use strict";

  const RULES = {
    stepBig: 5, stepSmall: 2.5, smallBelow: 30, rpeHard: 9.5, goneDays: 28,
    plateauSessions: 4, plateauDays: 21, plateauActiveDays: 42,
    improveWindowDays: 90, improveMinSessions: 3, improveMinSpanDays: 14, improveMinPct: 3,
    compareDays: 28, volumeMinPct: 20, volumeMinPrevWorkouts: 3,
    muscleMinPrevSets: 8, muscleDropPct: 40, muscleRisePct: 50,
    streakDays: 4, backToBackSets: 3, breakDays: 14,
    keepDismissedDays: 120, maxDismissed: 200
  };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MOVEMENTS = ["press", "row", "curl", "extension", "raise", "fly", "squat", "lunge", "deadlift", "pulldown", "pullup", "chinup", "dip", "thrust", "crunch", "shrug", "kickback", "pushdown", "twist", "bridge", "carry"];
  const DEFAULT_PREFS = { cards: true, logger: true, dismissed: {} };

  function isNum(v) { return v !== "" && v !== null && v !== undefined && isFinite(Number(v)); }
  function round1(n) { return Math.round(n * 10) / 10; }
  function plural(n, one, many) { return n === 1 ? one : (many || one + "s"); }
  function fmt(n) { return String(Math.round(Number(n) * 100) / 100); }
  function thousands(n) { return String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function same(a, b) { return Math.abs(Number(a) - Number(b)) < 0.001; }
  function daysBetween(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000); }
  function shortDate(key, todayKey) {
    const p = String(key).split("-").map(Number);
    const sameYear = !todayKey || String(todayKey).slice(0, 4) === String(key).slice(0, 4);
    return MONTHS[p[1] - 1] + " " + p[2] + (sameYear ? "" : ", " + p[0]);
  }
  function byTime(a, b) { return a.dateTime < b.dateTime ? -1 : a.dateTime > b.dateTime ? 1 : (a.createdAt || 0) - (b.createdAt || 0); }
  function defaultLabel(m) { return String(m).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, function (c) { return c.toUpperCase(); }).replace(/ ([A-Z])/g, function (x) { return x.toLowerCase(); }); }
  function none(reason) { return { kind: "none", reason: reason }; }

  /* ---------------- one exercise's history ---------------- */

  // Oldest first: one entry per saved session that has working sets of this exercise.
  function historyOf(workouts, exerciseId) {
    const out = [];
    WL.sessionsOf(workouts).slice().sort(byTime).forEach(function (w) {
      const se = (w.exercises || []).filter(function (x) { return x.exerciseId === exerciseId && Array.isArray(x.sets); })[0];
      if (!se) return;
      const sets = WL.working(se.sets);
      if (!sets.length) return;
      out.push({ id: w.id, date: w.date, dateTime: w.dateTime, sets: sets });
    });
    return out;
  }

  /* ---------------- progression ---------------- */

  // plan: [{ reps, type }] as routines store it. Returns { ok, reps, need } or { ok:false, reason }.
  function planInfo(plan) {
    if (!Array.isArray(plan) || !plan.length) return { ok: false, reason: "no-plan" };
    const normal = plan.filter(function (p) { return (p.type || "normal") === "normal"; });
    if (!normal.length) return { ok: false, reason: "no-working-sets" };
    const reps = Number(normal[0].reps);
    if (!(reps > 0) || normal.some(function (p) { return Number(p.reps) !== reps; })) return { ok: false, reason: "mixed-reps" };
    return { ok: true, reps: reps, need: normal.length };
  }

  function stepFor(weight) { return weight < RULES.smallBelow ? RULES.stepSmall : RULES.stepBig; }

  function repsText(sets) { return sets.map(function (s) { return Number(s.reps); }).join(", "); }

  // Should the next session of this exercise try a little more weight?
  //   opts: { plan: [{reps,type}], todayKey, name }
  //   -> { kind: "increase", from, to, ... why[] } | { kind: "hold", reason, why[] } | { kind: "none", reason }
  function progressionFor(workouts, exerciseId, opts) {
    const o = opts || {};
    const today = o.todayKey || WL.dayKey(Date.now());
    const name = o.name || "this exercise";
    const hist = historyOf(workouts, exerciseId);
    if (hist.length < 2) return none("history");
    const plan = planInfo(o.plan);
    if (!plan.ok) return none(plan.reason);
    const last = hist[hist.length - 1], before = hist[hist.length - 2];
    const straight = function (h) { return h.sets.filter(function (s) { return !s.dropset; }); };
    const lastStraight = straight(last);
    if (!lastStraight.length) return none("drop-only");
    const W = lastStraight.reduce(function (m, s) { return Math.max(m, Number(s.weight)); }, 0);
    if (!(W > 0)) return none("bodyweight");
    const hits = function (h) { return straight(h).filter(function (s) { return same(s.weight, W) && Number(s.reps) >= plan.reps; }); };
    const a = hits(before), b = hits(last);
    if (a.length < plan.need || b.length < plan.need) return none("not-yet");
    const sinceLast = daysBetween(last.date, today);
    if (sinceLast > RULES.goneDays) {
      return { kind: "hold", reason: "gap", exerciseId: exerciseId, from: W, days: sinceLast, title: "Start where you left off",
        text: "It has been " + sinceLast + " days since you did " + name + ".",
        why: ["Your last session of " + name + " was " + shortDate(last.date, today) + ", " + sinceLast + " days ago.",
          "Rule: no weight increase is suggested after more than " + RULES.goneDays + " days away from an exercise.",
          "Starting from the same weight is a common way to ease back in. That is general advice, not something your log can confirm. It is your call."] };
    }
    const hard = b.filter(function (s) { return isNum(s.rpe) && Number(s.rpe) >= RULES.rpeHard; });
    if (hard.length) {
      return { kind: "hold", reason: "rpe", exerciseId: exerciseId, from: W, title: "Repeat " + fmt(W) + " lb",
        text: "A set at " + fmt(W) + " lb last time felt very hard.",
        why: ["On " + shortDate(last.date, today) + " you rated a set at " + fmt(W) + " lb as RPE " + fmt(Number(hard[0].rpe)) + " (RPE is how hard a set felt, 10 is all you had).",
          "Rule: no increase is suggested when a set at that weight was rated " + fmt(RULES.rpeHard) + " or higher.",
          "You did reach " + plan.need + " × " + plan.reps + " at " + fmt(W) + " lb in your last two sessions, so the next one could be the one to step up."] };
    }
    const inc = stepFor(W), to = round1(W + inc);
    const rated = b.concat(a).filter(function (s) { return isNum(s.rpe); });
    const why = [
      "Your plan for " + name + " is " + plan.need + " × " + plan.reps + ".",
      shortDate(before.date, today) + ": " + fmt(W) + " lb for " + repsText(a) + " reps. " + shortDate(last.date, today) + ": " + fmt(W) + " lb for " + repsText(b) + " reps.",
      "That meets the plan on every set, at the same weight, two sessions in a row. The rule then suggests a small step: " + fmt(W) + " → " + fmt(to) + " lb.",
      "The step is " + fmt(inc) + " lb (" + fmt(RULES.stepSmall) + " lb when the weight is under " + RULES.smallBelow + "). Your plates may not match, so you can type any weight you like."
    ];
    if (rated.length) why.push("RPE you logged on those sets: " + rated.map(function (s) { return fmt(Number(s.rpe)); }).join(", ") + ". None was " + fmt(RULES.rpeHard) + " or higher.");
    why.push("Nothing changes until you tap Use " + fmt(to) + ".");
    return { kind: "increase", exerciseId: exerciseId, from: W, to: to, increment: inc, target: plan.reps, need: plan.need, dates: [before.date, last.date],
      title: "Ready for " + fmt(to) + " lb", text: "You did " + plan.need + " × " + plan.reps + " at " + fmt(W) + " lb in your last two sessions.", why: why };
  }

  /* ---------------- plateau ---------------- */

  function plateauFor(workouts, exerciseId, todayKey, name) {
    const today = todayKey || WL.dayKey(Date.now());
    const pts = PL.exerciseSeries(workouts, exerciseId);
    if (pts.length < RULES.plateauSessions + 1) return null;
    let bestIdx = 0;
    pts.forEach(function (p, i) { if (p.e1rm > pts[bestIdx].e1rm + 0.05) bestIdx = i; });
    const since = pts.length - 1 - bestIdx;
    const lastDate = pts[pts.length - 1].date, best = pts[bestIdx];
    const days = daysBetween(best.date, lastDate);
    if (since < RULES.plateauSessions || days < RULES.plateauDays) return null;
    if (daysBetween(lastDate, today) > RULES.plateauActiveDays) return null;
    const after = pts.slice(bestIdx + 1).map(function (p) { return p.e1rm; });
    const lo = Math.min.apply(null, after), hi = Math.max.apply(null, after);
    const nm = name || "this exercise";
    return { kind: "plateau", exerciseId: exerciseId, best: best.e1rm, bestDate: best.date, bestSet: best.topWeight + " × " + best.topReps, sessionsSince: since, daysSince: days, range: [lo, hi],
      title: nm + ": no new best in " + days + " days",
      text: "Best est. 1RM " + Math.round(best.e1rm) + " lb on " + shortDate(best.date, today) + ". " + since + " sessions since, none higher.",
      why: ["Your best estimated 1RM for " + nm + " is " + Math.round(best.e1rm) + " lb, from " + shortDate(best.date, today) + " (top set that day: " + best.topWeight + " × " + best.topReps + ").",
        "Since then you logged it " + since + " more times over " + days + " days. Those sessions estimate between " + Math.round(lo) + " and " + Math.round(hi) + " lb.",
        "Rule: at least " + RULES.plateauSessions + " sessions and " + RULES.plateauDays + " days without beating your best, and you are still doing the exercise.",
        "This is a description, not a diagnosis. An estimated 1RM is worked out from weight and reps, so it moves with rep range and with an off day.",
        "General ideas people try (not based on your data): add a rep before adding weight, repeat a weight until every set hits its target, or take an easier week."] };
  }

  /* ---------------- improvements ---------------- */

  function improvements(workouts, todayKey, nameOf) {
    const today = todayKey || WL.dayKey(Date.now());
    const start = WL.addDays(today, -(RULES.improveWindowDays - 1));
    const sessions = WL.sessionsOf(workouts);
    const out = [];
    PL.exerciseList(PL.inRange(sessions, start, today)).forEach(function (e) {
      const pts = PL.exerciseSeries(sessions, e.exerciseId, start, today);
      if (pts.length < RULES.improveMinSessions) return;
      if (daysBetween(pts[0].date, pts[pts.length - 1].date) < RULES.improveMinSpanDays) return;
      const k = Math.min(2, Math.floor(pts.length / 2));
      const early = pts.slice(0, k), late = pts.slice(-k);
      const bestOf = function (list) { return list.reduce(function (m, p) { return p.e1rm > m.e1rm ? p : m; }, list[0]); };
      const ea = bestOf(early), la = bestOf(late);
      const a = ea.e1rm, b = la.e1rm;
      if (!(a > 0)) return;
      const pct = Math.round((b - a) / a * 100);
      if (pct < RULES.improveMinPct) return;
      const nm = nameOf ? nameOf(e.exerciseId) : e.exerciseId;
      out.push({ kind: "improvement", exerciseId: e.exerciseId, from: round1(a), to: round1(b), pct: pct, sessions: pts.length, firstDate: pts[0].date, lastDate: pts[pts.length - 1].date,
        title: nm + " is up " + pct + "%",
        text: "Est. 1RM " + Math.round(a) + " → " + Math.round(b) + " lb across " + pts.length + " sessions (" + shortDate(pts[0].date, today) + " – " + shortDate(pts[pts.length - 1].date, today) + ").",
        why: ["Looked at " + nm + " over the last " + RULES.improveWindowDays + " days: " + pts.length + " sessions from " + shortDate(pts[0].date, today) + " to " + shortDate(pts[pts.length - 1].date, today) + ".",
          "Compared the best estimated 1RM of the first " + k + " " + plural(k, "session") + " (" + Math.round(a) + " lb) with the best of the latest " + k + " (" + Math.round(b) + " lb): " + (b - a >= 0 ? "+" : "") + round1(b - a) + " lb, " + pct + "%.",
          "The sets behind those two numbers: " + fmt(ea.topWeight) + " × " + ea.topReps + " then " + fmt(la.topWeight) + " × " + la.topReps + " (heaviest set of each session).",
          "Rule: 3+ sessions over 14+ days and a rise of " + RULES.improveMinPct + "% or more.",
          "Estimated 1RM = weight × (1 + reps ÷ 30). It is an estimate, not a tested max." + (ea.topReps > 10 || la.topReps > 10 ? " Estimates from sets of more than 10 reps are rougher than from heavier, lower-rep sets." : "")] });
    });
    return out.sort(function (x, y) { return y.pct - x.pct || (x.exerciseId < y.exerciseId ? -1 : 1); });
  }

  /* ---------------- volume and muscles ---------------- */

  function firstDate(workouts) {
    const ds = WL.sessionsOf(workouts).map(function (w) { return w.date; }).sort();
    return ds[0] || null;
  }

  // The last 4 weeks and the 4 weeks before them, or null when your history doesn't cover both.
  function windows(workouts, today) {
    const first = firstDate(workouts);
    if (!first) return null;
    const curStart = WL.addDays(today, -(RULES.compareDays - 1)), prevEnd = WL.addDays(curStart, -1), prevStart = WL.addDays(prevEnd, -(RULES.compareDays - 1));
    if (first > prevStart) return null;
    return { curStart: curStart, curEnd: today, prevStart: prevStart, prevEnd: prevEnd };
  }

  function volumeChange(workouts, todayKey) {
    const today = todayKey || WL.dayKey(Date.now());
    const w = windows(workouts, today);
    if (!w) return null;
    const sessions = WL.sessionsOf(workouts);
    const cur = PL.summarize(PL.inRange(sessions, w.curStart, w.curEnd)), prev = PL.summarize(PL.inRange(sessions, w.prevStart, w.prevEnd));
    if (prev.workouts < RULES.volumeMinPrevWorkouts || !(prev.volume > 0)) return null;
    const pct = Math.round((cur.volume - prev.volume) / prev.volume * 100);
    if (Math.abs(pct) < RULES.volumeMinPct) return null;
    const up = pct > 0;
    return { kind: "volume", direction: up ? "up" : "down", pct: pct, cur: cur, prev: prev, windows: w,
      title: "Training volume is " + (up ? "up " : "down ") + Math.abs(pct) + "%",
      text: "Last 4 weeks: " + thousands(cur.volume) + " lb over " + cur.workouts + " " + plural(cur.workouts, "workout") + ". The 4 weeks before: " + thousands(prev.volume) + " lb over " + prev.workouts + ".",
      why: ["Compared " + shortDate(w.curStart, today) + " – " + shortDate(w.curEnd, today) + " with " + shortDate(w.prevStart, today) + " – " + shortDate(w.prevEnd, today) + ".",
        "Volume is weight × reps added up over working sets (warm-ups left out): " + thousands(prev.volume) + " → " + thousands(cur.volume) + " lb.",
        "Workouts: " + prev.workouts + " → " + cur.workouts + ". Working sets: " + prev.workingSets + " → " + cur.workingSets + ".",
        "Rule: shown when volume changes " + RULES.volumeMinPct + "% or more, the earlier 4 weeks had " + RULES.volumeMinPrevWorkouts + "+ workouts, and your history covers all of them.",
        up ? "A big rise is worth keeping an eye on how you feel. JARVIS has no way to measure fatigue." : "A drop can be a planned lighter stretch or a busy few weeks. The log can't tell which."] };
  }

  // lookup(exerciseId) -> { primary: [fine muscle] }. label(muscle) -> display name.
  function muscleShifts(workouts, todayKey, lookup, label) {
    const today = todayKey || WL.dayKey(Date.now());
    const w = windows(workouts, today);
    if (!w || !lookup) return [];
    const sessions = WL.sessionsOf(workouts);
    const lab = label || defaultLabel;
    const cur = PL.muscleTotals(sessions, w.curStart, w.curEnd, lookup).byMuscle, prev = PL.muscleTotals(sessions, w.prevStart, w.prevEnd, lookup).byMuscle;
    const out = [];
    Object.keys(prev).forEach(function (m) {
      const a = prev[m], b = cur[m] || 0;
      if (a < RULES.muscleMinPrevSets) return;
      const pct = Math.round((b - a) / a * 100);
      const down = pct <= -RULES.muscleDropPct, up = pct >= RULES.muscleRisePct;
      if (!down && !up) return;
      const nm = lab(m);
      out.push({ kind: "muscle", muscle: m, direction: down ? "down" : "up", pct: pct, cur: b, prev: a, windows: w,
        title: nm + " sets are " + (down ? "down " : "up ") + Math.abs(pct) + "%",
        text: b === 0 ? "No working sets for " + nm.toLowerCase() + " in the last 4 weeks, after " + a + " in the 4 weeks before." : a + " working sets in the earlier 4 weeks, " + b + " in the last 4.",
        why: ["Counted working sets whose main muscle is " + nm.toLowerCase() + ": " + a + " (" + shortDate(w.prevStart, today) + " – " + shortDate(w.prevEnd, today) + ") then " + b + " (" + shortDate(w.curStart, today) + " – " + shortDate(w.curEnd, today) + ").",
          "Only each exercise's main muscle is counted, not the helping muscles.",
          "Rule: shown when a muscle had " + RULES.muscleMinPrevSets + "+ sets in the earlier window and it fell " + RULES.muscleDropPct + "% or more, or rose " + RULES.muscleRisePct + "% or more.",
          down ? "That may be on purpose. JARVIS doesn't know your goals." : "More sets than before is only a fact, not a verdict on whether it is the right amount."] });
    });
    return out.sort(function (x, y) { return Math.abs(y.cur - y.prev) - Math.abs(x.cur - x.prev) || (x.muscle < y.muscle ? -1 : 1); });
  }

  /* ---------------- recovery ---------------- */

  function recoveryNotes(workouts, todayKey, lookup, label) {
    const today = todayKey || WL.dayKey(Date.now());
    const sessions = WL.sessionsOf(workouts);
    const out = [];
    if (!sessions.length) return out;
    const dates = {};
    sessions.forEach(function (w) { dates[w.date] = true; });
    const latest = Object.keys(dates).sort().pop();
    const sinceLast = daysBetween(latest, today);

    // days in a row, counting back from the latest training day (only while it is today or yesterday)
    if (sinceLast <= 1) {
      let n = 0, k = latest;
      while (dates[k]) { n++; k = WL.addDays(k, -1); }
      if (n >= RULES.streakDays) {
        const from = WL.addDays(latest, -(n - 1));
        out.push({ kind: "recovery", type: "streak", signature: latest, title: "You trained " + n + " days in a row",
          text: shortDate(from, today) + " – " + shortDate(latest, today) + ". A day off is a normal part of a plan.",
          why: ["Your log has a workout on each of the " + n + " days from " + shortDate(from, today) + " to " + shortDate(latest, today) + ".",
            "Rule: shown at " + RULES.streakDays + " or more training days in a row.",
            "JARVIS has no sleep, soreness or heart-rate data, so it can't tell whether you need a rest day. This is only a count from your log."] });
      }
    }

    // the same main muscle on two days in a row, in the last 7 days
    if (lookup) {
      const lab = label || defaultLabel;
      const perDay = {};
      sessions.forEach(function (w) {
        if (daysBetween(w.date, today) > 6 || daysBetween(w.date, today) < 0) return;
        w.exercises.forEach(function (se) {
          const n = WL.working(se.sets).length;
          if (!n) return;
          const t = lookup(se.exerciseId);
          ((t && t.primary) || []).forEach(function (m) { (perDay[w.date] = perDay[w.date] || {})[m] = ((perDay[w.date] || {})[m] || 0) + n; });
        });
      });
      const hits = [];
      Object.keys(perDay).sort().forEach(function (d) {
        const nx = WL.addDays(d, 1);
        if (!perDay[nx]) return;
        Object.keys(perDay[d]).forEach(function (m) { if (perDay[d][m] >= RULES.backToBackSets && perDay[nx][m] >= RULES.backToBackSets) hits.push({ muscle: m, a: d, b: nx, sa: perDay[d][m], sb: perDay[nx][m] }); });
      });
      if (hits.length) {
        const h = hits.sort(function (x, y) { return x.b < y.b ? 1 : x.b > y.b ? -1 : (y.sa + y.sb) - (x.sa + x.sb); })[0];
        const nm = lab(h.muscle);
        out.push({ kind: "recovery", type: "back-to-back", signature: h.muscle + ":" + h.b, title: nm + " two days in a row",
          text: nm + " was a main target on " + shortDate(h.a, today) + " (" + h.sa + " sets) and " + shortDate(h.b, today) + " (" + h.sb + " sets).",
          why: ["Working sets whose main muscle is " + nm.toLowerCase() + ": " + h.sa + " on " + shortDate(h.a, today) + ", " + h.sb + " on " + shortDate(h.b, today) + ".",
            "Rule: shown when the same main muscle gets " + RULES.backToBackSets + "+ working sets on two days in a row within the last 7 days.",
            "Many programs leave a gap between hard sessions for the same muscle, and some deliberately don't. JARVIS can't measure whether you were recovered."] });
      }
    }

    if (sinceLast >= RULES.breakDays) {
      out.push({ kind: "recovery", type: "break", signature: latest, title: "It has been " + sinceLast + " days since your last workout",
        text: "Your last one was " + shortDate(latest, today) + ".",
        why: ["Your last saved workout was on " + shortDate(latest, today) + ", " + sinceLast + " days ago.",
          "Rule: shown after " + RULES.breakDays + " or more days without a workout. Weight increases are also paused for any exercise you haven't done in " + RULES.goneDays + " days.",
          "Starting a little lighter than your old weights is a common way to ease back in. That is general advice, not something your log can confirm."] });
    }
    return out;
  }

  /* ---------------- swapping an exercise ---------------- */

  function stem(t) { return /sses$/.test(t) ? t.slice(0, -2) : /[^s]s$/.test(t) ? t.slice(0, -1) : t; }
  // The kind of movement named in an exercise's name ("press", "row", "curl"...), or "".
  function movementOf(name) {
    const joined = WL.nameKey(name).replace(/pull up/g, "pullup").replace(/chin up/g, "chinup").replace(/push down/g, "pushdown").replace(/pull down/g, "pulldown");
    const words = joined.split(" ").map(stem);
    for (let i = 0; i < MOVEMENTS.length; i++) if (words.indexOf(MOVEMENTS[i]) !== -1) return MOVEMENTS[i];
    return "";
  }

  // The name without the equipment words: "Barbell Bench Press" and "Bench Press" share "bench press".
  const EQUIPMENT_WORDS = ["barbell", "dumbbell", "db", "bb", "machine", "cable", "smith", "ez", "bar", "kettlebell", "kb", "bodyweight", "weighted", "free", "weight"];
  function coreName(name) { return WL.nameKey(name).split(" ").filter(function (t) { return EQUIPMENT_WORDS.indexOf(t) === -1; }).map(stem).join(" "); }
  function equipWords(name) { return WL.nameKey(name).split(" ").filter(function (t) { return EQUIPMENT_WORDS.indexOf(t) !== -1; }).sort().join(" "); }
  // "Bench Press" next to "Barbell Bench Press" is the same lift written twice. "Dumbbell Bench Press" is a different one.
  function sameLift(a, b) {
    if (a.equipment !== b.equipment || !coreName(a.name) || coreName(a.name) !== coreName(b.name)) return false;
    const x = equipWords(a.name), y = equipWords(b.name);
    return !x || !y || x === y;
  }

  function loggedMap(workouts) {
    const map = {};
    WL.sessionsOf(workouts).slice().sort(byTime).forEach(function (w) {
      w.exercises.forEach(function (se) {
        const sets = WL.working(se.sets);
        if (!sets.length) return;
        const m = map[se.exerciseId] || (map[se.exerciseId] = { count: 0, last: null });
        m.count++; m.last = { date: w.date, sets: sets };
      });
    });
    return map;
  }

  // Other exercises that work the same main muscle, best match first, each with the reasons.
  //   ctx: { library: [{id,name,muscleGroup,equipment}], lookup(id) -> {primary,secondary}, workouts, exclude: [ids], label, limit, todayKey }
  function substitutes(exerciseId, ctx) {
    const c = ctx || {};
    const lib = c.library || [], lookup = c.lookup, lab = c.label || defaultLabel;
    const src = lib.filter(function (e) { return e.id === exerciseId; })[0];
    if (!src || !lookup) return { source: src || null, items: [], reason: "unknown" };
    const srcPrimary = (lookup(src.id) || {}).primary || [];
    if (!srcPrimary.length) return { source: src, items: [], reason: "no-muscles" };
    const srcMove = movementOf(src.name);
    const skip = {}; (c.exclude || []).forEach(function (id) { skip[id] = true; }); skip[src.id] = true;
    const logged = loggedMap(c.workouts || []);
    const today = c.todayKey || WL.dayKey(Date.now());
    const scored = [];
    lib.forEach(function (e) {
      if (skip[e.id] || e.muscleGroup === "Cardio") return;
      if (WL.findDuplicate(e.name, [src])) return;
      if (sameLift(e, src)) return;   // the same lift under another name is not an alternative
      const prim = (lookup(e.id) || {}).primary || [];
      const shared = prim.filter(function (m) { return srcPrimary.indexOf(m) !== -1; });
      if (!shared.length) return;
      const union = srcPrimary.concat(prim.filter(function (m) { return srcPrimary.indexOf(m) === -1; })).length;
      const move = movementOf(e.name);
      const sameMove = !!srcMove && move === srcMove;
      const hist = logged[e.id] || null;
      const sameCore = !!coreName(e.name) && coreName(e.name) === coreName(src.name);   // e.g. dumbbell and barbell versions of one lift
      const score = shared.length / union * 6 + (sameMove ? 2 : 0) + (sameCore ? 2 : 0) + (e.muscleGroup === src.muscleGroup ? 1 : 0) + (hist ? 1 : 0);
      const why = [];
      why.push(shared.length === srcPrimary.length && prim.length === srcPrimary.length
        ? "Works the same main " + plural(shared.length, "muscle") + ": " + shared.map(lab).join(", ") + "."
        : "Shares the main muscle " + shared.map(lab).join(", ") + (prim.length > shared.length ? " and also works " + prim.filter(function (m) { return shared.indexOf(m) === -1; }).map(lab).join(", ") : "") + ".");
      if (sameCore) why.push("The same lift (" + coreName(src.name) + ") with different equipment.");
      else if (sameMove) why.push("Same kind of movement (" + srcMove + ").");
      why.push(e.equipment === src.equipment ? "Same equipment type (" + e.equipment + ")." : "Equipment: " + (e.equipment || "not listed") + ", where " + src.name + " uses " + (src.equipment || "not listed") + ".");
      if (hist) why.push("You have logged it " + hist.count + " " + plural(hist.count, "time") + ". Last on " + shortDate(hist.last.date, today) + ": " + WL.lastTimeText({ sets: hist.last.sets }) + ".");
      else why.push("You haven't logged it yet, so there is no weight to start from.");
      scored.push({ exerciseId: e.id, name: e.name, muscleGroup: e.muscleGroup, equipment: e.equipment, score: score, shared: shared, sameMovement: sameMove, timesLogged: hist ? hist.count : 0,
        lastText: hist ? WL.lastTimeText({ sets: hist.last.sets }) : "", why: why });
    });
    scored.sort(function (x, y) { return y.score - x.score || (x.name < y.name ? -1 : 1); });
    return { source: src, items: scored.slice(0, c.limit || 6), reason: scored.length ? "" : "none-found" };
  }

  // A swap is only offered while nothing in the exercise has been finished.
  function canSwap(se) { return !!se && Array.isArray(se.sets) && !se.sets.some(function (s) { return s.completed; }); }

  // The exercise as it would look after the swap: same number and kind of sets, same rep targets, weights only from
  // what you logged for the new exercise. Does not change the input.
  function swapExercise(se, newExerciseId, workouts) {
    const types = se.sets.map(function (s) { return s.warmup ? "warmup" : s.dropset ? "dropset" : "normal"; });
    const prev = WL.previousPerformance(workouts || [], newExerciseId);
    const sugg = WL.suggestForPlan(types, prev ? prev.sets : []);
    return Object.assign({}, se, {
      exerciseId: newExerciseId,
      sets: se.sets.map(function (s, i) { return WL.newSet({ weight: sugg[i] ? sugg[i].weight : "", reps: s.reps, warmup: !!s.warmup, dropset: !!s.dropset }); })
    });
  }

  // Put a suggested weight on the sets that are still to do. Finished sets, warm-ups and drop sets are never touched.
  // Does not change the input. -> { exercise, changed: [set ids] }
  function applyWeight(se, weight) {
    const w = Number(weight);
    const changed = [];
    const sets = se.sets.map(function (s) {
      if (!(w >= 0) || s.completed || s.warmup || s.dropset) return s;
      changed.push(s.id);
      return Object.assign({}, s, { weight: w });
    });
    return { exercise: Object.assign({}, se, { sets: sets }), changed: changed };
  }

  /* ---------------- settings and hidden notes ---------------- */

  function sanitizePrefs(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const dismissed = {};
    if (r.dismissed && typeof r.dismissed === "object") {
      Object.keys(r.dismissed).forEach(function (k) { if (typeof k === "string" && k && /^\d{4}-\d{2}-\d{2}$/.test(String(r.dismissed[k]))) dismissed[k] = r.dismissed[k]; });
    }
    return { cards: r.cards !== false, logger: r.logger !== false, dismissed: capDismissed(dismissed) };
  }
  function capDismissed(map) {
    const keys = Object.keys(map);
    if (keys.length <= RULES.maxDismissed) return map;
    const out = {};
    keys.sort(function (a, b) { return map[a] < map[b] ? 1 : map[a] > map[b] ? -1 : 0; }).slice(0, RULES.maxDismissed).forEach(function (k) { out[k] = map[k]; });
    return out;
  }
  function dismiss(prefs, key, todayKey) {
    const p = sanitizePrefs(prefs);
    p.dismissed[key] = todayKey;
    p.dismissed = capDismissed(p.dismissed);
    return p;
  }
  function isHidden(prefs, key) { return !!(prefs && prefs.dismissed && prefs.dismissed[key]); }
  function clearDismissed(prefs) { const p = sanitizePrefs(prefs); p.dismissed = {}; return p; }
  // Drops hidden-note records old enough that the note they hid would be about something else by now.
  function prune(prefs, todayKey) {
    const p = sanitizePrefs(prefs);
    Object.keys(p.dismissed).forEach(function (k) { if (daysBetween(p.dismissed[k], todayKey) > RULES.keepDismissedDays) delete p.dismissed[k]; });
    return p;
  }

  /* ---------------- everything for the Progress screen ---------------- */

  // What each kind of note needs before it can appear, and whether your history has it yet.
  function readiness(workouts, routines, todayKey) {
    const sessions = WL.sessionsOf(workouts);
    const list = PL.exerciseList(sessions);
    const inRoutine = {};
    (routines || []).forEach(function (r) { (r.exercises || []).forEach(function (re) { inRoutine[re.exerciseId] = true; }); });
    const twice = list.some(function (e) { return e.sessions >= 2 && inRoutine[e.exerciseId]; });
    const plateauable = list.some(function (e) { const pts = PL.exerciseSeries(sessions, e.exerciseId); return pts.length >= RULES.plateauSessions + 1 && daysBetween(pts[0].date, pts[pts.length - 1].date) >= RULES.plateauDays; });
    const covered = !!windows(workouts, todayKey || WL.dayKey(Date.now()));
    return {
      workouts: sessions.length,
      lines: [
        { label: "Ready to progress", ok: twice, need: "an exercise in one of your routines, logged in 2 sessions" },
        { label: "Improvements", ok: list.some(function (e) { return e.sessions >= RULES.improveMinSessions; }), need: "an exercise logged in 3 sessions over 2 weeks" },
        { label: "Plateaus", ok: plateauable, need: "an exercise logged in 5 sessions over 3 weeks" },
        { label: "Volume and muscle changes", ok: covered, need: "workouts going back 8 weeks" }
      ]
    };
  }

  // ctx: { workouts, routines (active), todayKey, lookup, label, nameOf, prefs }
  // -> { items, hidden, readiness }. Each item: { key, kind, kicker, tone, title, text, why[], exerciseId? }
  function buildInsights(ctx) {
    const c = ctx || {};
    const today = c.todayKey || WL.dayKey(Date.now());
    const nameOf = c.nameOf || function (id) { return id; };
    const prefs = sanitizePrefs(c.prefs);
    const sessions = WL.sessionsOf(c.workouts);
    const items = [];
    const wkStart = WL.weekStart(today);
    const add = function (kicker, tone, key, n) { items.push(Object.assign({}, n, { key: key, kicker: kicker, tone: tone })); };

    // 1. progression for exercises in your routines
    const seen = {};
    (c.routines || []).forEach(function (r) {
      (r.exercises || []).forEach(function (re) {
        if (seen[re.exerciseId]) return;
        const nm = nameOf(re.exerciseId);
        const p = progressionFor(c.workouts, re.exerciseId, { plan: WL.plannedSetsOf(re), todayKey: today, name: nm });
        if (p.kind !== "increase") return;
        seen[re.exerciseId] = true;
        const last = p.dates[1];
        add("Ready to progress", "good", "progress:" + re.exerciseId + ":" + last, Object.assign({}, p, { title: nm + ": try " + fmt(p.to) + " lb", text: p.text + " From your " + r.name + " routine.",
          why: p.why.concat(["You will see it as a suggestion when you start this routine."]) }));
      });
    });
    // 2. improvements
    improvements(c.workouts, today, nameOf).slice(0, 3).forEach(function (n) { add("Improvement", "good", "improve:" + n.exerciseId + ":" + n.lastDate, n); });
    // 3. plateaus
    PL.exerciseList(sessions).forEach(function (e) {
      const p = plateauFor(c.workouts, e.exerciseId, today, nameOf(e.exerciseId));
      if (p) add("Plateau", "watch", "plateau:" + e.exerciseId + ":" + p.bestDate, p);
    });
    // 4. volume, muscles
    const v = volumeChange(c.workouts, today);
    if (v) add("Volume", v.direction === "up" ? "neutral" : "watch", "volume:" + wkStart, v);
    muscleShifts(c.workouts, today, c.lookup, c.label).slice(0, 2).forEach(function (n) { add("Muscles", n.direction === "down" ? "watch" : "neutral", "muscle:" + n.muscle + ":" + wkStart, n); });
    // 5. recovery
    recoveryNotes(c.workouts, today, c.lookup, c.label).forEach(function (n) { add("Recovery", "watch", "recovery:" + n.type + ":" + n.signature, n); });

    const shown = items.filter(function (n) { return !isHidden(prefs, n.key); });
    return { items: shown, hidden: items.length - shown.length, readiness: readiness(c.workouts, c.routines, today) };
  }

  return {
    RULES: RULES, DEFAULT_PREFS: DEFAULT_PREFS,
    historyOf: historyOf, planInfo: planInfo, stepFor: stepFor, progressionFor: progressionFor, plateauFor: plateauFor, improvements: improvements,
    volumeChange: volumeChange, muscleShifts: muscleShifts, recoveryNotes: recoveryNotes, windows: windows,
    movementOf: movementOf, substitutes: substitutes, canSwap: canSwap, swapExercise: swapExercise, applyWeight: applyWeight,
    sanitizePrefs: sanitizePrefs, dismiss: dismiss, isHidden: isHidden, clearDismissed: clearDismissed, prune: prune,
    readiness: readiness, buildInsights: buildInsights, defaultLabel: defaultLabel, shortDate: shortDate
  };
});
