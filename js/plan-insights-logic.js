/* ==========================================================================
   JARVIS — Strategic Planning Center: the rules behind the dashboard, "Top three" recommendations, analytics, reviews and the
   suggestions that need your approval (pure functions; no page, storage or network, so they can be tested outside the browser).

   Principles
     - Every figure is counted from your own records (tasks, links, blocks, money you entered, workouts you logged). If something
       hasn't been tracked, the figure is null ("not tracked"), never 0.
     - Recommendations are RULES with visible points: each pick lists why it was chosen, as a list of reasons that add up to its score.
     - Nothing here changes anything. proposals() only describes a change; the screen applies it after you approve.
     - Time is never double counted: for workouts, a day's "actual" is the larger of the time you logged on Workout blocks and the
       sessions you logged in Workouts (one workout recorded in both places is still one workout).

   Context object (ctx), assembled by the screens:
     { today, nowMin, weekStart, tasks, links, model (PlanLogic.model), blocks, ingredients, events, zone, settings,
       weeks, reviews, periods, workouts, habits }
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./plan-logic"), require("./plan-week-logic"), require("./task-kind-logic"));
  else root.JarvisPlanInsights = factory(root.JarvisPlanLogic, root.JarvisPlanWeekLogic, root.JarvisTaskKind);
})(typeof self !== "undefined" ? self : this, function (PL, W, TK) {
  "use strict";

  /* ---------------- small helpers ---------------- */
  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function pct(n, d) { return d > 0 ? Math.round(100 * n / d) : null; }
  function hours(min) { return min === null || min === undefined ? null : Math.round(min / 6) / 10; }
  function arr(v) { return Array.isArray(v) ? v : []; }

  // Overdue means a DEADLINE task (made in the Tasks section or in Strategy, or an older one tied to a Strategy item) whose day has passed.
  // A task you scheduled for a day in the Day Planner is an activity, so it is never overdue (task-kind-logic.js).
  function lateTask(t, ctx) {
    if (!ctx._linked) ctx._linked = TK.linkedTo(ctx.links);
    return TK.isOverdue(t, ctx.today, { linked: ctx._linked });
  }
  function dateOf(ms) { return new Date(ms).toISOString().slice(0, 10); }
  const PRIO = { high: 3, medium: 2, low: 1 };

  /* ---------------- what kind of time a category is ---------------- */
  const KIND_RES = [["workout", /workout|exercise|gym|training|fitness|lift/i], ["study", /stud(y|ying)|homework|revis|learn/i], ["gratiel", /gratiel|business|brand|clothing/i], ["school", /school|class|lecture|college|univers/i], ["personal", /personal|family|friend|social|church/i]];
  function categoryKind(ing) {
    if (!ing) return "none";
    if (ing.rest) return "rest";
    if (ing.id === "ing_gratiel") return "gratiel";
    if (ing.id === "ing_workout") return "workout";
    if (ing.id === "ing_studying") return "study";
    if (ing.id === "ing_school") return "school";
    if (ing.id === "ing_personal") return "personal";
    for (let i = 0; i < KIND_RES.length; i++) if (KIND_RES[i][1].test(ing.name || "")) return KIND_RES[i][0];
    return "other";
  }

  /* ---------------- time: planned, logged, workouts ---------------- */
  function workoutMinutesByDate(workouts) {
    const out = {};
    arr(workouts).forEach(function (w) {
      if (!isObj(w)) return;
      const d = typeof w.date === "string" ? w.date.slice(0, 10) : "";
      if (PL.isDate(d) && isNum(w.duration) && w.duration > 0) out[d] = (out[d] || 0) + Math.round(w.duration);
    });
    return out;
  }

  // Planned and logged time per category between two dates. actualMin is null when nothing was tracked for that category.
  // Returns { rows, plannedMin, loggedMin, pastBlocks, loggedBlocks, doneBlockMin }
  function timeByCategory(ctx, from, to) {
    const ings = W.liveIngredients(ctx.ingredients), occ = W.occurrences(ctx.blocks, from, to), today = ctx.today || "";
    const wk = workoutMinutesByDate(ctx.workouts);
    const rows = {}, order = [];
    const row = function (id) {
      if (rows[id] !== undefined) return rows[id];
      const ing = id ? W.ingredientById(ctx.ingredients, id) : null;
      rows[id] = { ingredientId: id, name: ing ? ing.name : "No category", color: ing ? ing.color : "#94a3b8", kind: categoryKind(ing), plannedMin: 0, loggedMin: null, blocks: 0, loggedBlocks: 0, sessionMin: null };
      order.push(id);
      return rows[id];
    };
    ings.forEach(function (i) { row(i.id); });
    const dayWorkoutBlocks = {};          // day -> minutes logged on workout-kind blocks
    let plannedMin = 0, pastBlocks = 0, loggedBlocks = 0, doneBlockMin = 0;
    occ.forEach(function (o) {
      const ing = W.ingredientById(ctx.ingredients, o.ingredientId), r = row(ing ? o.ingredientId : ""), len = o.endMin - o.startMin;
      r.plannedMin += len; r.blocks++; plannedMin += len;
      const past = o.date < today || (o.date === today && typeof ctx.nowMin === "number" && o.endMin <= ctx.nowMin);
      if (past) pastBlocks++;
      if (o.workedMin !== null) {
        r.loggedMin = (r.loggedMin || 0) + o.workedMin; r.loggedBlocks++; if (past) loggedBlocks++;
        if (r.kind === "workout") dayWorkoutBlocks[o.date] = (dayWorkoutBlocks[o.date] || 0) + o.workedMin;
      }
      const t = o.taskId ? arr(ctx.tasks).filter(function (x) { return x && x.id === o.taskId; })[0] : null;
      if (past && (t ? t.completed : o.done)) doneBlockMin += len;
    });
    // workouts you logged in Workouts count too, but never twice: per day, the larger of what Workout blocks say and what sessions say
    const wkRow = ings.filter(function (i) { return categoryKind(i) === "workout"; })[0] || null;
    const days = Object.keys(wk).filter(function (d) { return d >= from && d <= to && d <= (today || to); });
    if (days.length) {
      const extra = days.reduce(function (s, d) { return s + Math.max(0, wk[d] - (dayWorkoutBlocks[d] || 0)); }, 0);
      const home = wkRow ? row(wkRow.id) : row("_workouts");
      if (!wkRow) { home.name = "Workouts (from your workout log)"; home.kind = "workout"; home.color = "#33d17a"; }
      home.sessionMin = days.reduce(function (s, d) { return s + wk[d]; }, 0);
      if (extra > 0) home.loggedMin = (home.loggedMin || 0) + extra;
    }
    const list = order.map(function (id) { return rows[id]; });
    const logged = list.filter(function (r) { return r.loggedMin !== null; });
    return {
      rows: list, plannedMin: plannedMin, loggedMin: logged.length ? logged.reduce(function (s, r) { return s + r.loggedMin; }, 0) : null,
      pastBlocks: pastBlocks, loggedBlocks: loggedBlocks, doneBlockMin: doneBlockMin
    };
  }

  function gratielMinutes(ctx, from, to) {
    const t = timeByCategory(ctx, from, to), rows = t.rows.filter(function (r) { return r.kind === "gratiel"; });
    if (!rows.length) return { plannedMin: null, loggedMin: null };
    return { plannedMin: rows.reduce(function (s, r) { return s + r.plannedMin; }, 0), loggedMin: rows.some(function (r) { return r.loggedMin !== null; }) ? rows.reduce(function (s, r) { return s + (r.loggedMin || 0); }, 0) : null };
  }

  /* ---------------- how much of the week is free (for "will it fit?") ---------------- */
  function freeMinutes(ctx) {
    const dates = W.weekDates(ctx.weekStart), today = ctx.today || "";
    return dates.filter(function (d) { return d >= today; }).reduce(function (sum, d) { return sum + W.freeSlots(d, ctx, 15, []).reduce(function (s, x) { return s + x.end - x.start; }, 0); }, 0);
  }

  /* ---------------- "Top three": a transparent, rule-based ranking ---------------- */
  // Points (all visible in the reasons):
  //   linked to the plan 15 · importance of its objective 3 per weight point (up to 15) · that objective at risk 10 / on track 4
  //   supports THIS quarter's priority 10 (+5 if at risk) · milestone deadline: overdue 16, within a week 14, two weeks 9, a month 4
  //   task priority high 14 / medium 6 · overdue task 3 + 2 per day (up to 12) · substantial work (60+ min estimate) 4
  //   minus: a small routine task not tied to a goal 8 · will not fit in the time left this week 10 · under a finished milestone 12 · paused item 15
  function explain(task, ctx, free) {
    const m = ctx.model, today = ctx.today || "", parts = [];
    const add = function (label, points) { if (points) parts.push({ label: label, points: points }); };
    const chain = m ? m.chainOfTask(task.id) : [];
    const obj = chain.filter(function (n) { return n.type === "objective"; })[0] || null, pri = chain.filter(function (n) { return n.type === "priority"; })[0] || null, ms = chain.filter(function (n) { return n.type === "milestone"; })[0] || null;
    const link = PL.linkOf(ctx.links, task.id), est = link && link.estMin ? link.estMin : 0;
    const curY = Number(today.slice(0, 4)), curQ = today ? PL.quarterOfDate(today) : 0;
    const linked = chain.length > 0;
    if (linked) add("Counts toward your plan", 15);
    if (obj) {
      add("Part of the objective “" + obj.title + "” (importance " + (obj.weight || 1) + " of 5)", Math.min(15, 3 * (obj.weight || 1)));
      const st = m.statusOf(obj.id);
      if (st === "atrisk") add("…which is at risk", 10); else if (st === "ontrack") add("…which is on track", 4);
    }
    if (pri && pri.year === curY && pri.quarter === curQ) {
      add("Supports this quarter's priority “" + pri.title + "”", 10);
      if (m.statusOf(pri.id) === "atrisk") add("…which is at risk", 5);
    }
    if (ms) {
      const left = m.daysLeft(ms.id);
      if (left !== null && m.statusOf(ms.id) !== "completed") {
        if (left < 0) add("Its milestone “" + ms.title + "” is " + (-left) + " day" + (left === -1 ? "" : "s") + " overdue", 16);
        else if (left <= 7) add("Its milestone “" + ms.title + "” is due in " + left + " day" + (left === 1 ? "" : "s"), 14);
        else if (left <= 14) add("Its milestone “" + ms.title + "” is due in " + left + " days", 9);
        else if (left <= 30) add("Its milestone “" + ms.title + "” is due in " + left + " days", 4);
      }
      if (m.statusOf(ms.id) === "completed") add("Its milestone is already complete", -12);
      if (ms.status === "paused" || (pri && pri.status === "paused") || (obj && obj.status === "paused")) add("It belongs to a paused item", -15);
    }
    if (task.priority === "high") add("High priority", 14); else if (task.priority !== "low") add("Medium priority", 6);
    if (lateTask(task, ctx)) {
      const late = PL.diffDays(task.date, today);
      add("Overdue by " + late + " day" + (late === 1 ? "" : "s"), Math.min(12, 3 + 2 * late));
    }
    if (est >= 60) add("Substantial work (about " + (Math.round(est / 6) / 10) + " h)", 4);
    if (!linked && task.priority !== "high" && (!est || est <= 30)) add("A small routine task that isn't tied to a goal", -8);
    if (est && free !== null && est > free) add("Needs about " + (Math.round(est / 6) / 10) + " h but only " + (Math.round(free / 6) / 10) + " h is free this week", -10);
    // Is there anything real to rank it by? A task with only the default priority and nothing else (no goal, deadline, lateness or estimate) is
    // not ranked by guesswork: it says so.
    const enough = linked || task.priority === "high" || task.priority === "low" || lateTask(task, ctx) || est > 0;
    return { parts: parts, score: parts.reduce(function (s, p) { return s + p.points; }, 0), linked: linked, chain: chain, estMin: est, category: categoryOf(task, chain), enough: enough };
  }

  /* ---------------- what kind of thing a task is ---------------- */
  // From the words in the category you gave it (a task has no category until you give one). A task that stands for a habit is a routine; a task
  // tied to your plan and with no other category is strategic; anything else with a category is personal. "" means no category is set.
  const CATEGORIES = { strategic: "Strategic", school: "School", business: "Business", personal: "Personal", routine: "Routine", leisure: "Leisure", rest: "Rest" };
  const CATEGORY_WORDS = [
    ["rest", /\b(rest|sleep|nap|relax|recover)/],
    ["leisure", /\b(leisure|fun|game|gaming|friends|movie|party|hang ?out|hobby)/],
    ["school", /\b(school|homework|study|class|exam|test|quiz|essay|assignment|lab)/],
    ["business", /\b(business|gratiel|client|order|invoice|shipping|customer|sales|marketing|inventory|supplier)/]
  ];
  function categoryOf(task, chain) {
    if (task && task.habitId) return "routine";
    const text = String((task && task.category) || "").toLowerCase();
    for (let i = 0; i < CATEGORY_WORDS.length; i++) if (CATEGORY_WORDS[i][1].test(text)) return CATEGORY_WORDS[i][0];
    if (chain && chain.length) return "strategic";
    return text.trim() ? "personal" : "";
  }
  // Rest and leisure are protected: they are not something to push to the top of a to-do list, so they are not ranked unless asked for.
  function isProtected(cat) { return cat === "rest" || cat === "leisure"; }

  function candidates(ctx) {
    const dates = W.weekDates(ctx.weekStart), end = dates[6];
    return arr(ctx.tasks).filter(function (t) { return t && !t.completed && PL.isDate(t.date) && t.date <= end && (t.date >= ctx.today || lateTask(t, ctx)) && t.text && !PL.isArchived(ctx.links, t.id) && !(ctx.model && ctx.model.nodeOfTask(t.id) && ctx.model.nodeOfTask(t.id).status === "dropped") && !t.habitId && (ctx.includeProtected || !isProtected(categoryOf(t, ctx.model ? ctx.model.chainOfTask(t.id) : []))); });
  }
  // Every candidate, best first, each with its reasons. Ties are settled the same way every time: the earlier day, then the higher priority, then the
  // shorter estimate (an unknown one last), then your own order, then when it was made, then its id.
  function shortReason(e) {
    if (!e.enough) return "Not enough information to rank it";
    const top = e.parts.filter(function (p) { return p.points > 0; }).sort(function (a, b) { return b.points - a.points; }).slice(0, 2).map(function (p) { return p.label; });
    return top.length ? top.join(", ") : "Medium priority";
  }
  function rankTasks(ctx) {
    if (ctx._rank) return ctx._rank;                       // worked out once per context (a screen asks several times)
    const free = ctx.freeMin !== undefined ? ctx.freeMin : freeMinutes(ctx);
    ctx._rank = candidates(ctx).map(function (t) { const e = explain(t, ctx, free); return { task: t, score: e.score, parts: e.parts, linked: e.linked, chain: e.chain, estMin: e.estMin, category: e.category, enough: e.enough, short: shortReason(e) }; })
      .sort(function (a, b) {
        return b.score - a.score || (a.task.date < b.task.date ? -1 : a.task.date > b.task.date ? 1 : 0) || (PRIO[b.task.priority] || 2) - (PRIO[a.task.priority] || 2) ||
          (a.estMin || 1e9) - (b.estMin || 1e9) || (a.task.order || 0) - (b.task.order || 0) || (a.task.createdAt || 0) - (b.task.createdAt || 0) || (a.task.id < b.task.id ? -1 : a.task.id > b.task.id ? 1 : 0);
      });
    return ctx._rank;
  }
  // The full "Why?" for one ranked task, as lines of text: its kind, each reason with its points, the total, and how ties are settled.
  function whyLines(r) {
    const lines = [r.category ? "Kind: " + CATEGORIES[r.category] : "Kind: not set (give it a category to say what it is for)"];
    if (!r.enough) lines.push("Not enough information to rank it: it has no goal, no deadline, no estimate and only the usual priority.");
    r.parts.forEach(function (p) { lines.push(p.label + " (" + (p.points > 0 ? "+" : "") + p.points + ")"); });
    lines.push("Total: " + r.score + " points. Equal scores go to the earlier day, then the higher priority, then the shorter estimate.");
    return lines;
  }
  // Three picks. They are spread out (a second pick from the same milestone loses 6 points), and at most one is a task that isn't tied to
  // the plan unless there aren't enough that are.
  function topThreePicks(ctx) {
    const ranked = rankTasks(ctx), picks = [], taken = {};
    const msOf = function (r) { const m = r.chain[r.chain.length - 1]; return m ? m.id : ""; };
    for (let n = 0; n < 3; n++) {
      let best = null, bestScore = -Infinity;
      const linkedLeft = ranked.some(function (r) { return !taken[r.task.id] && r.linked; });
      ranked.forEach(function (r) {
        if (taken[r.task.id]) return;
        if (!r.linked && linkedLeft && picks.some(function (p) { return !p.linked; })) return;
        let sc = r.score;
        if (picks.some(function (p) { return msOf(p) && msOf(p) === msOf(r); })) sc -= 6;
        if (sc > bestScore) { best = r; bestScore = sc; }
      });
      if (!best) break;
      taken[best.task.id] = true;
      const pick = Object.assign({}, best, { adjusted: bestScore, score: bestScore });   // the score shown is the one the listed reasons add up to
      if (bestScore !== best.score) pick.parts = best.parts.concat([{ label: "Another pick comes from the same milestone", points: bestScore - best.score }]);
      picks.push(pick);
    }
    return picks;
  }

  /* ---------------- deadlines and the dashboard ---------------- */
  function upcoming(ctx, days) {
    const m = ctx.model, today = ctx.today || "", span = days || 14, out = [];
    ["milestone", "priority", "objective"].forEach(function (type) {
      m.all(type).forEach(function (n) {
        const st = m.statusOf(n.id);
        if (st === "completed" || st === "paused" || st === "dropped") return;
        const left = m.daysLeft(n.id);
        if (left === null || left > span) return;
        out.push({ kind: "node", id: n.id, type: n.type, title: n.title, date: m.deadline(n), daysLeft: left, status: st, pct: m.progress(n.id).pct });
      });
    });
    arr(ctx.tasks).forEach(function (t) {
      if (!t || t.completed || !PL.isDate(t.date) || PL.isArchived(ctx.links, t.id)) return;
      const left = PL.diffDays(today, t.date), n = m.nodeOfTask(t.id);
      if (left >= 0 && left <= 3 && (n || t.priority === "high")) out.push({ kind: "task", id: t.id, type: "task", title: t.text, date: t.date, daysLeft: left, status: t.priority === "high" ? "high" : "", pct: null, node: n ? n.title : "" });
    });
    return out.sort(function (a, b) { return a.daysLeft - b.daysLeft || (a.title < b.title ? -1 : 1); });
  }

  function avgPct(m, nodes) {
    const known = nodes.filter(function (n) { return n.status !== "dropped"; }).map(function (n) { return m.progress(n.id).pct; }).filter(function (p) { return p !== null; });
    return known.length ? Math.round(known.reduce(function (s, p) { return s + Math.min(100, p); }, 0) / known.length) : null;
  }

  // Everything the dashboard shows, from the top of the chain to today.
  function dashboard(ctx) {
    const m = ctx.model, today = ctx.today, y = Number(today.slice(0, 4)), q = PL.quarterOfDate(today), mk = PL.monthOfDate(today), ws = ctx.weekStart;
    const live = function (list) { return list.filter(function (n) { return n.status !== "dropped"; }); };
    const years = PL.planYears(m.settings), yearNodes = years.map(function (yr) { return m.objectivesOf(yr); });
    const objectives = live(m.objectivesOf(y)), priorities = live(m.prioritiesOf(y, q)), milestones = live(m.milestonesIn(mk));
    const msDone = milestones.filter(function (n) { return m.statusOf(n.id) === "completed"; }).length;
    const dates = W.weekDates(ws), tasks = arr(ctx.tasks);
    const weekTasks = tasks.filter(function (t) { return t && dates.indexOf(t.date) !== -1 && !PL.isArchived(ctx.links, t.id); });
    const monthTasks = tasks.filter(function (t) { return t && typeof t.date === "string" && t.date.slice(0, 7) === mk && !PL.isArchived(ctx.links, t.id); });
    const wk = W.weekOf(ctx.weeks, ws), saved = wk ? W.readWeek(wk).top : [];
    let top = saved.map(function (x) {
      const t = x.taskId ? tasks.filter(function (k) { return k.id === x.taskId; })[0] : null;
      return { task: t, text: t ? t.text : x.text, done: !!(t && t.completed), node: t ? m.nodeOfTask(t.id) : null, saved: true };
    }).filter(function (x) { return x.text; });
    let suggested = false;
    if (!top.length) { top = topThreePicks(ctx).map(function (p) { return { task: p.task, text: p.task.text, done: false, node: p.chain[p.chain.length - 1] || null, saved: false, score: p.score }; }); suggested = top.length > 0; }
    const gr = gratielMinutes(ctx, ws, dates[6]), rank = rankTasks(ctx);
    const todayOpen = tasks.filter(function (t) { return t && !t.completed && t.date === today && !PL.isArchived(ctx.links, t.id); });
    const order = {}; rank.forEach(function (r, i) { order[r.task.id] = i; });
    todayOpen.sort(function (a, b) { return (order[a.id] === undefined ? 1e6 : order[a.id]) - (order[b.id] === undefined ? 1e6 : order[b.id]) || (a.order || 0) - (b.order || 0); });
    const overdueTasks = tasks.filter(function (t) { return lateTask(t, ctx) && !PL.isArchived(ctx.links, t.id); });
    return {
      year: y, quarter: q, month: mk, weekStart: ws,
      overall: { year: avgPct(m, objectives), threeYear: avgPct(m, [].concat.apply([], yearNodes)) },
      objectives: objectives, priorities: priorities, milestones: milestones,
      monthStats: { milestones: milestones.length, milestonesDone: msDone, milestonePct: milestones.length ? avgPct(m, milestones) : null, tasksDone: monthTasks.filter(function (t) { return t.completed; }).length, tasksOpen: monthTasks.filter(function (t) { return !t.completed; }).length },
      week: { tasksDone: weekTasks.filter(function (t) { return t.completed; }).length, tasksTotal: weekTasks.length, rate: pct(weekTasks.filter(function (t) { return t.completed; }).length, weekTasks.length), top: top, topSuggested: suggested, gratielLoggedMin: gr.loggedMin, gratielPlannedMin: gr.plannedMin },
      today: { open: todayOpen.slice(0, 5), openCount: todayOpen.length, done: tasks.filter(function (t) { return t && t.completed && t.date === today; }).length },
      deadlines: upcoming(ctx, 14).slice(0, 6), overdueTaskCount: overdueTasks.length
    };
  }

  /* ---------------- analytics ---------------- */
  function weekTotals(ctx, ws) {
    const dates = W.weekDates(ws), tasks = arr(ctx.tasks).filter(function (t) { return t && dates.indexOf(t.date) !== -1 && !PL.isArchived(ctx.links, t.id); });
    const done = tasks.filter(function (t) { return t.completed; }).length, tm = timeByCategory(ctx, ws, dates[6]);
    return { weekStart: ws, total: tasks.length, done: done, rate: pct(done, tasks.length), plannedMin: tm.plannedMin, loggedMin: tm.loggedMin, future: ws > (ctx.today || "") };
  }
  // The last n weeks (oldest first, ending with the week of today).
  function weeklySeries(ctx, n) {
    const out = [], cur = W.mondayOf(ctx.today);
    for (let i = (n || 8) - 1; i >= 0; i--) out.push(weekTotals(ctx, PL.addDays(cur, -7 * i)));
    return out;
  }
  // Money by month for the given month keys: null where you entered nothing.
  // Time by kind of use, for one week: Gratiel, studying, exercise, school, personal and rest, everything else. loggedMin is null (not tracked) when
  // none of the categories in the group has any time logged: never 0 for "we didn't write it down". Workout sessions you logged in Workouts are
  // included once (see timeByCategory).
  const KIND_GROUPS = [["gratiel", "Gratiel", ["gratiel"]], ["study", "Studying", ["study"]], ["workout", "Exercise", ["workout"]], ["school", "School", ["school"]], ["personal", "Personal and rest", ["personal", "rest"]], ["other", "Everything else", ["other", "none"]]];
  function timeAllocation(ctx, ws) {
    const tm = timeByCategory(ctx, ws, PL.addDays(ws, 6));
    const groups = KIND_GROUPS.map(function (g) {
      const rows = tm.rows.filter(function (r) { return g[2].indexOf(r.kind) !== -1; });
      const logged = rows.filter(function (r) { return r.loggedMin !== null; });
      return { key: g[0], label: g[1], plannedMin: rows.reduce(function (sum, r) { return sum + r.plannedMin; }, 0), loggedMin: logged.length ? logged.reduce(function (sum, r) { return sum + r.loggedMin; }, 0) : null };
    });
    return { weekStart: ws, groups: groups, plannedMin: tm.plannedMin, loggedMin: tm.loggedMin };
  }
  // One group's planned and logged minutes for each of the last n weeks (oldest first).
  function allocationSeries(ctx, n, key) {
    const out = [], cur = W.mondayOf(ctx.today);
    for (let i = (n || 8) - 1; i >= 0; i--) {
      const ws = PL.addDays(cur, -7 * i), a = timeAllocation(ctx, ws), g = a.groups.filter(function (x) { return x.key === key; })[0] || { plannedMin: 0, loggedMin: null };
      out.push({ weekStart: ws, plannedMin: g.plannedMin, loggedMin: g.loggedMin });
    }
    return out;
  }
  function financeSeries(periods, months) {
    return months.map(function (mk) {
      const p = PL.periodOf(periods, "month", mk) || {};
      const g = function (k) { return p[k] === undefined || p[k] === null ? null : p[k]; };
      return { month: mk, revenue: g("revenue"), spend: g("spend"), revenueTarget: g("revenueTarget"), budget: g("budget") };
    });
  }
  function lastMonths(today, n) {
    const out = []; let y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
    for (let i = 0; i < n; i++) { out.unshift(PL.monthKey(y, m)); m--; if (m < 1) { m = 12; y--; } }
    return out;
  }
  function goalProgress(ctx) {
    const m = ctx.model, today = ctx.today, y = Number(today.slice(0, 4)), q = PL.quarterOfDate(today), mk = PL.monthOfDate(today);
    const row = function (n) { return { id: n.id, title: n.title, pct: m.progress(n.id).pct, status: m.statusOf(n.id), note: m.progress(n.id).note }; };
    const live = function (l) { return l.filter(function (n) { return n.status !== "dropped"; }); };
    return { objectives: live(m.objectivesOf(y)).map(row), priorities: live(m.prioritiesOf(y, q)).map(row), milestones: live(m.milestonesIn(mk)).map(row) };
  }
  function overdueCount(ctx) { return arr(ctx.tasks).filter(function (t) { return lateTask(t, ctx) && !PL.isArchived(ctx.links, t.id); }).length; }

  /* ---------------- reviews ---------------- */
  function hrs(min) { return (Math.round(min / 6) / 10) + " h"; }
  function weekReview(ctx) {
    const ws = ctx.weekStart, dates = W.weekDates(ws), tasks = arr(ctx.tasks), m = ctx.model;
    const inWeek = tasks.filter(function (t) { return t && dates.indexOf(t.date) !== -1 && !PL.isArchived(ctx.links, t.id); });
    const done = inWeek.filter(function (t) { return t.completed; }), open = inWeek.filter(function (t) { return !t.completed; });
    const linkedDone = done.filter(function (t) { return m.nodeOfTask(t.id); });
    const tm = timeByCategory(ctx, ws, dates[6]), gr = gratielMinutes(ctx, ws, dates[6]);
    const wk = W.weekOf(ctx.weeks, ws), top = wk ? W.readWeek(wk).top : [];
    const topDone = top.filter(function (x) { const t = x.taskId ? tasks.filter(function (k) { return k.id === x.taskId; })[0] : null; return t && t.completed; }).length;
    const unfinished = rankTasks(Object.assign({}, ctx, { weekStart: ws, _rank: undefined, freeMin: undefined })).filter(function (r) { return !r.task.completed; }).slice(0, 5);
    const sentences = [];
    if (inWeek.length) sentences.push("You finished " + done.length + " of " + inWeek.length + " tasks dated this week (" + pct(done.length, inWeek.length) + "%)" + (done.length ? ", " + linkedDone.length + " of them counting toward your plan." : "."));
    else sentences.push("No tasks were dated this week.");
    if (top.length) sentences.push("Your top three: " + topDone + " of " + top.length + " finished.");
    if (tm.plannedMin) sentences.push("You planned " + hrs(tm.plannedMin) + " in time blocks" + (tm.loggedMin !== null ? " and logged " + hrs(tm.loggedMin) + " of work (on " + tm.loggedBlocks + " of " + tm.pastBlocks + " finished blocks)." : " but logged no worked time, so the actual hours aren't known."));
    else sentences.push("No time blocks were planned this week.");
    if (gr.plannedMin !== null && gr.plannedMin > 0) sentences.push("Gratiel: " + hrs(gr.plannedMin) + " planned" + (gr.loggedMin !== null ? ", " + hrs(gr.loggedMin) + " logged." : ", none logged."));
    else if (gr.plannedMin !== null) sentences.push("No Gratiel time was planned this week.");
    if (unfinished.length) sentences.push("Most important unfinished: " + unfinished.slice(0, 3).map(function (r) { return "“" + r.task.text + "”"; }).join(", ") + ".");
    const behind = m.all("priority").concat(m.all("objective")).filter(function (n) { return m.statusOf(n.id) === "atrisk" && n.status === "active"; });
    const moved = {}; done.forEach(function (t) { const n = m.nodeOfTask(t.id); if (n) m.chainOfTask(t.id).forEach(function (x) { moved[x.id] = true; }); });
    const stalled = behind.filter(function (n) { return !moved[n.id]; });
    if (stalled.length) sentences.push("At risk with no progress this week: " + stalled.slice(0, 3).map(function (n) { return "“" + n.title + "”"; }).join(", ") + ".");
    return { weekStart: ws, tasksTotal: inWeek.length, tasksDone: done.length, rate: pct(done.length, inWeek.length), linkedDone: linkedDone.length, accomplished: done, unfinished: unfinished, open: open, overdueCount: overdueCount(ctx), topTotal: top.length, topDone: topDone, plannedMin: tm.plannedMin, loggedMin: tm.loggedMin, gratielPlannedMin: gr.plannedMin, gratielLoggedMin: gr.loggedMin, stalled: stalled, sentences: sentences, allocation: tm.rows };
  }
  function monthReview(ctx, mk) {
    const m = ctx.model, y = Number(mk.slice(0, 4)), q = PL.quarterOfMonth(Number(mk.slice(5))), sentences = [];
    const ms = m.milestonesIn(mk).filter(function (n) { return n.status !== "dropped"; });
    const completed = ms.filter(function (n) { return m.statusOf(n.id) === "completed"; }), notDone = ms.filter(function (n) { return m.statusOf(n.id) !== "completed" && m.statusOf(n.id) !== "paused"; });
    const priorities = m.prioritiesOf(y, q).filter(function (n) { return n.status !== "dropped"; });
    const behind = priorities.concat(m.objectivesOf(y)).filter(function (n) { return n.status === "active" && m.statusOf(n.id) === "atrisk"; });
    const fin = PL.periodSummary(ctx.periods, "month", mk, m.settings.revenueMetric);
    const tasks = arr(ctx.tasks).filter(function (t) { return t && typeof t.date === "string" && t.date.slice(0, 7) === mk && !PL.isArchived(ctx.links, t.id); });
    const tdone = tasks.filter(function (t) { return t.completed; }).length;
    if (ms.length) sentences.push(completed.length + " of " + ms.length + " milestones for " + PL.monthName(mk, true) + " are complete.");
    else sentences.push("No milestones were set for " + PL.monthName(mk, true) + ".");
    if (tasks.length) sentences.push("You finished " + tdone + " of " + tasks.length + " tasks dated in the month (" + pct(tdone, tasks.length) + "%).");
    priorities.forEach(function (p) { const pr = m.progress(p.id); sentences.push("“" + p.title + "”: " + (pr.pct === null ? "no progress to show yet" : pr.pct + "% (" + PL.STATUS_LABEL[m.statusOf(p.id)].toLowerCase() + ")") + "."); });
    if (fin.revenueActual !== null) sentences.push((m.settings.revenueMetric === "mrr" ? "MRR was $" : "Sales revenue was $") + PL.fmt(fin.revenueActual) + (fin.revenueTarget ? " against a $" + PL.fmt(fin.revenueTarget) + " target (" + Math.round(100 * fin.revenueActual / fin.revenueTarget) + "%)." : "."));
    else sentences.push("No revenue was entered for the month.");
    if (fin.spendActual !== null) sentences.push("Spending was $" + PL.fmt(fin.spendActual) + (fin.budget ? " against a $" + PL.fmt(fin.budget) + " budget" + (fin.spendActual > fin.budget ? " (over by $" + PL.fmt(fin.spendActual - fin.budget) + ")." : " ($" + PL.fmt(fin.budget - fin.spendActual) + " left).") : "."));
    const next = PL.monthKey(mk.slice(5) === "12" ? y + 1 : y, mk.slice(5) === "12" ? 1 : Number(mk.slice(5)) + 1);
    const nextUp = notDone.concat(m.milestonesIn(next).filter(function (n) { return n.status === "active"; }));
    return { month: mk, milestones: ms, completed: completed, notDone: notDone, priorities: priorities.map(function (p) { return { id: p.id, title: p.title, pct: m.progress(p.id).pct, status: m.statusOf(p.id) }; }), behind: behind, finance: fin, tasksTotal: tasks.length, tasksDone: tdone, nextUp: nextUp.slice(0, 5), sentences: sentences };
  }

  /* ---------------- suggestions that need your approval ---------------- */
  // Each proposal describes a change and what applying it would do. Dismissed ones (settings.dismissed[key], within 14 days) stay hidden.
  /* ---------------- the quarter at a glance, and what would help the ones that are behind ---------------- */
  // Every figure is a count or a date taken from the plan. The "what would help" lines are fixed rules, each one tied to something it can
  // see (no milestones yet, an overdue milestone, a milestone with no tasks, nothing dated in the next 7 days, a workload sum); none is a forecast.
  function money(n) { return "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 }); }
  function helpFor(ctx, p) {
    const m = ctx.model, today = ctx.today, out = [];
    if (p.measure !== "tasks") return helpForMeasure(ctx, p);
    const open = m.subtreeTasks(p.id).filter(function (t) { return !t.completed; });
    if (!m.parentOf(p)) out.push({ kind: "link-parent", id: p.id, text: "It isn't under a yearly objective, so it doesn't count toward your year. Link it to one." });
    const ms = m.milestonesOf(p.id).filter(function (k) { return k.status !== "dropped"; });
    if (!ms.length && !m.tasksDirect(p.id).length) out.push({ kind: "breakdown", id: p.id, text: "It has no milestones or tasks yet, so nothing can move. Break it into monthly milestones." });
    ms.filter(function (k) { return m.health(k.id) === "overdue"; }).slice(0, 2).forEach(function (k) { out.push({ kind: "open", id: k.id, text: "“" + k.title + "” was due " + m.deadline(k) + ". Finish it, or move its deadline." }); });
    ms.filter(function (k) { return k.month <= today.slice(0, 7) && !m.subtreeTasks(k.id).length && m.progress(k.id).pct !== 100; }).slice(0, 2).forEach(function (k) { out.push({ kind: "link-tasks", id: k.id, text: "“" + k.title + "” has no tasks. Add the first one." }); });
    const dates = W.weekDates(W.mondayOf(today)), next7 = PL.addDays(today, 7);
    if (open.length && !open.some(function (t) { return PL.isDate(t.date) && t.date >= today && t.date <= next7; })) out.push({ kind: "schedule-week", id: p.id, text: "Nothing from it is dated in the next 7 days. Schedule one of its " + open.length + " open " + (open.length === 1 ? "task" : "tasks") + "." });
    const left = m.daysLeft(p.id);
    if (open.length && left !== null && left > 0) out.push({ kind: "info", id: p.id, text: open.length + " open " + (open.length === 1 ? "task" : "tasks") + " and " + left + (left === 1 ? " day" : " days") + " left: about " + (Math.round(10 * open.length / Math.max(1, left / 7)) / 10) + " a week to finish them all." });
    else if (open.length && left !== null && left <= 0) out.push({ kind: "info", id: p.id, text: open.length + " open " + (open.length === 1 ? "task is" : "tasks are") + " left after its deadline." });
    void dates;
    return out.slice(0, 4);
  }
  // A priority measured by money or a number has no tasks to chase: the help is the figure itself, and where to enter it.
  function helpForMeasure(ctx, p) {
    const m = ctx.model, pr = m.progress(p.id), left = m.daysLeft(p.id), pc = m.pace(p.id), out = [];
    const firstMonth = PL.quarterMonths(p.year, p.quarter)[0];
    if (p.measure === "revenue" || p.measure === "budget") {
      const label = p.measure === "revenue" ? "revenue" : "spending";
      if (pr.actual === null) { out.push({ kind: "enter-money", id: firstMonth, text: "No " + label + " has been entered for this quarter's months yet. Enter it so this can be measured." }); return out; }
      if (p.measure === "revenue") {
        const remaining = Math.max(0, p.target - pr.actual);
        if (remaining > 0 && left !== null && left > 0) out.push({ kind: "info", id: p.id, text: money(pr.actual) + " of " + money(p.target) + " so far. " + money(remaining) + " to go in " + left + (left === 1 ? " day" : " days") + ": about " + money(remaining / Math.max(1, left / 7)) + " a week." });
        else if (remaining > 0) out.push({ kind: "info", id: p.id, text: money(pr.actual) + " of " + money(p.target) + ": " + money(remaining) + " short of the target." });
      } else {
        out.push({ kind: "info", id: p.id, text: "Spent " + money(pr.actual) + " of " + money(p.target) + " (" + pr.pct + "% of the budget" + (pc ? " with " + pc.expected + "% of the time passed" : "") + ")." + (pr.over ? " That is over budget by " + money(pr.actual - p.target) + "." : "") });
      }
    } else if (p.measure === "number") {
      out.push({ kind: "info", id: p.id, text: pr.note + (left !== null && left > 0 ? ", " + left + (left === 1 ? " day" : " days") + " left." : ".") });
    } else if (p.measure === "goal") out.push({ kind: "open", id: p.id, text: pr.note + ". Update that goal in Habits to move this." });
    return out;
  }
  // How far behind, in words that fit the measure: spending is "behind" when it runs ahead of the time passed.
  function behindPhrase(p, pc) {
    if (!pc || pc.gap === null) return "";
    if (p.measure === "budget") return pc.gap > 0 ? "spending " + pc.gap + " points ahead of the time passed" : "";
    return pc.gap < 0 ? (-pc.gap) + " points behind the pace" : "";
  }
  function quarterOverview(ctx, year, quarter) {
    const m = ctx.model, today = ctx.today;
    const pris = m.prioritiesOf(year, quarter).filter(function (p) { return p.status !== "dropped"; });
    const months = PL.quarterMonths(year, quarter), start = PL.monthStart(months[0]), end = PL.monthEnd(months[2]);
    const state = today < start ? "before" : today > end ? "after" : "during";
    const expected = state === "before" ? 0 : state === "after" ? 100 : Math.round(100 * PL.diffDays(start, today) / Math.max(1, PL.diffDays(start, end)));
    const known = pris.map(function (p) { return m.progress(p.id).pct; }).filter(function (v) { return v !== null; });
    const actual = known.length ? Math.round(known.reduce(function (sum, v) { return sum + Math.min(100, v); }, 0) / known.length) : null;
    const counts = { notstarted: 0, ontrack: 0, atrisk: 0, completed: 0, paused: 0 };
    pris.forEach(function (p) { const st = m.statusOf(p.id); if (counts[st] !== undefined) counts[st]++; });
    const taskSeen = {}, tasks = []; pris.forEach(function (p) { m.subtreeTasks(p.id).forEach(function (t) { if (!taskSeen[t.id]) { taskSeen[t.id] = true; tasks.push(t); } }); });
    const msSeen = {}, mss = [];
    pris.forEach(function (p) { m.subtreeMilestones(p.id).forEach(function (k) { if (!msSeen[k.id]) { msSeen[k.id] = true; mss.push(k); } }); });
    months.forEach(function (mk) { m.milestonesIn(mk).forEach(function (k) { if (!msSeen[k.id] && k.status !== "dropped") { msSeen[k.id] = true; mss.push(k); } }); });
    const msDone = mss.filter(function (k) { return m.progress(k.id).pct === 100; }).length;
    const late = pris.filter(function (p) { return m.health(p.id) === "overdue"; }).length + mss.filter(function (k) { return m.health(k.id) === "overdue"; }).length;
    const money = m.periods("quarter", PL.quarterKey(year, quarter));
    const behind = pris.filter(function (p) { return p.status === "active" && m.statusOf(p.id) === "atrisk"; }).map(function (p) {
      const pc = m.pace(p.id);
      return { id: p.id, title: p.title, measure: p.measure, gap: pc ? pc.gap : null, phrase: behindPhrase(p, pc), helps: helpFor(ctx, p) };
    });
    return { year: year, quarter: quarter, start: start, end: end, state: state, expected: expected, actual: actual, gap: actual === null ? null : actual - expected,
      priorities: pris.length, counts: counts, milestones: { done: msDone, total: mss.length }, tasks: { done: tasks.filter(function (t) { return t.completed; }).length, total: tasks.length },
      overdue: late, revenueTarget: money.revenueTarget, revenueActual: money.revenueActual, revenuePct: money.revenuePct, budget: money.budget, spendActual: money.spendActual, behind: behind };
  }

  /* ---------------- the month: the three outcomes that matter, and the month's tasks ---------------- */
  // The three most important outcomes of a month. Open milestones first: overdue ones, then the heavier ones (weight), then the sooner
  // deadline. If the month has fewer than three, the quarter's open priorities fill the rest. Each says why it is listed.
  function monthOutcomes(ctx, mk) {
    const m = ctx.model, today = ctx.today, open = function (n) { return n.status === "active" && m.statusOf(n.id) !== "completed"; };
    const rank = function (a, b) {
      const la = m.health(a.id) === "overdue" ? 0 : 1, lb = m.health(b.id) === "overdue" ? 0 : 1;
      return la - lb || (b.weight || 1) - (a.weight || 1) || (m.deadline(a) < m.deadline(b) ? -1 : m.deadline(a) > m.deadline(b) ? 1 : 0) || (a.order - b.order);
    };
    const row = function (n) {
      const left = m.daysLeft(n.id), why = m.health(n.id) === "overdue" ? "overdue by " + (-left) + (left === -1 ? " day" : " days") : left !== null && left <= 7 ? "due " + (left === 0 ? "today" : left === 1 ? "tomorrow" : "in " + left + " days") : (n.weight || 1) > 1 ? "counts " + n.weight + " of 5" : "due " + m.deadline(n);
      return { id: n.id, type: n.type, title: n.title, pct: m.progress(n.id).pct, status: m.statusOf(n.id), daysLeft: left, weight: n.weight || 1, why: why };
    };
    const picks = m.milestonesIn(mk).filter(open).sort(rank).slice(0, 3).map(row);
    if (picks.length < 3) {
      const year = Number(mk.slice(0, 4)), q = PL.quarterOfMonth(Number(mk.slice(5)));
      m.prioritiesOf(year, q).filter(open).sort(rank).slice(0, 3 - picks.length).forEach(function (p) { picks.push(Object.assign(row(p), { why: "quarter priority · " + row(p).why })); });
    }
    void today;
    return picks;
  }
  function monthTasksAll(ctx, mk) {
    return arr(ctx.tasks).filter(function (t) { return t && typeof t.id === "string" && typeof t.date === "string" && t.date.slice(0, 7) === mk && !PL.isArchived(ctx.links, t.id); });
  }
  function monthOverview(ctx, mk) {
    const m = ctx.model, today = ctx.today, ms = m.milestonesIn(mk).filter(function (n) { return n.status !== "dropped"; });
    const tasks = monthTasksAll(ctx, mk), linked = tasks.filter(function (t) { return m.nodeOfTask(t.id); }), loose = tasks.filter(function (t) { return !m.nodeOfTask(t.id); });
    const done = function (l) { return l.filter(function (t) { return t.completed; }).length; };
    const deadlines = upcoming(ctx, 45).filter(function (d) { return d.date.slice(0, 7) === mk && d.date >= today; }).slice(0, 6);
    return {
      month: mk, outcomes: monthOutcomes(ctx, mk),
      milestones: { done: ms.filter(function (n) { return m.progress(n.id).pct === 100; }).length, total: ms.length },
      tasks: { total: tasks.length, done: done(tasks), open: tasks.length - done(tasks), linkedDone: done(linked), linkedOpen: linked.length - done(linked), looseDone: done(loose), looseOpen: loose.length - done(loose),
        overdue: tasks.filter(function (t) { return lateTask(t, ctx); }).length },
      deadlines: deadlines
    };
  }
  // The month's tasks, relevant ones first. Linked tasks are grouped (by milestone, by priority, or by the category you gave the task);
  // tasks not linked to anything go to the inbox, one page at a time, so a long list never has to be drawn in full.
  // f: { q, status: open|done|all, category, priority, group: milestone|priority|category, page, pageSize }
  function monthTaskLists(ctx, mk, f) {
    f = f || {};
    const m = ctx.model, today = ctx.today, status = f.status === "done" || f.status === "all" ? f.status : "open", q = String(f.q || "").trim().toLowerCase();
    const group = f.group === "priority" || f.group === "category" ? f.group : "milestone", size = Math.max(1, Math.min(50, Number(f.pageSize) || 12));
    const keep = function (t) {
      if (status === "open" && t.completed) return false;
      if (status === "done" && !t.completed) return false;
      if (f.category && (t.category || "") !== f.category) return false;
      if (f.priority && (t.priority || "medium") !== f.priority) return false;
      if (q && String(t.text || "").toLowerCase().indexOf(q) === -1 && String(t.category || "").toLowerCase().indexOf(q) === -1) return false;
      return true;
    };
    const all = monthTasksAll(ctx, mk), mine = all.filter(keep);
    const order = function (a, b) { return (a.completed ? 1 : 0) - (b.completed ? 1 : 0) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (PRIO[b.priority] || 2) - (PRIO[a.priority] || 2) || (a.order || 0) - (b.order || 0); };
    const linked = mine.filter(function (t) { return m.nodeOfTask(t.id); }), loose = mine.filter(function (t) { return !m.nodeOfTask(t.id); });
    const groups = {}, list = [];
    linked.forEach(function (t) {
      const chain = m.chainOfTask(t.id), node = chain[chain.length - 1];
      let key, node2 = node, title;
      if (group === "category") { key = "c:" + (t.category || ""); title = t.category || "No category"; node2 = null; }
      else if (group === "priority") { node2 = chain.filter(function (n) { return n.type === "priority"; })[0] || chain[0] || node; key = "n:" + node2.id; title = node2.title; }
      else { key = "n:" + node.id; title = node.title; }
      if (!groups[key]) { groups[key] = { key: key, title: title, node: node2 ? { id: node2.id, type: node2.type, pct: m.progress(node2.id).pct, deadline: m.deadline(node2), late: m.health(node2.id) === "overdue" } : null, tasks: [] }; list.push(groups[key]); }
      groups[key].tasks.push(t);
    });
    list.forEach(function (g) { g.tasks.sort(order); g.open = g.tasks.filter(function (t) { return !t.completed; }).length; });
    list.sort(function (a, b) {
      const ao = a.open ? 0 : 1, bo = b.open ? 0 : 1;
      if (ao !== bo) return ao - bo;
      if (a.node && b.node) return (a.node.late ? 0 : 1) - (b.node.late ? 0 : 1) || (a.node.deadline < b.node.deadline ? -1 : a.node.deadline > b.node.deadline ? 1 : 0);
      return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
    });
    // the inbox: overdue first, then higher priority, then the date
    loose.sort(function (a, b) { const la = lateTask(a, ctx) ? 0 : 1, lb = lateTask(b, ctx) ? 0 : 1; return la - lb || order(a, b); });
    const pages = Math.max(1, Math.ceil(loose.length / size)), page = Math.max(1, Math.min(pages, Number(f.page) || 1));
    const cats = {}; all.forEach(function (t) { if (t.category) cats[t.category] = true; });
    const archived = arr(ctx.tasks).filter(function (t) { return t && typeof t.date === "string" && t.date.slice(0, 7) === mk && PL.isArchived(ctx.links, t.id); });
    return { groups: list, linkedCount: linked.length, inbox: { total: loose.length, items: loose.slice((page - 1) * size, page * size), page: page, pages: pages, size: size, all: all.filter(function (t) { return !m.nodeOfTask(t.id); }).length }, categories: Object.keys(cats).sort(), archived: archived.slice(0, 30), archivedCount: archived.length, matching: mine.length, total: all.length };
  }

  function proposals(ctx) {
    const m = ctx.model, today = ctx.today, out = [], dismissed = (m.settings && m.settings.dismissed) || {}, nowMs = ctx.nowMs || Date.now();
    const hidden = function (key) { return dismissed[key] && nowMs - dismissed[key] < 14 * 86400000; };
    const push = function (p) { if (!hidden(p.key)) out.push(p); };
    m.overdueMilestones().forEach(function (n) {
      if (n.status !== "active") return;
      const nextEnd = PL.addDays(today, 14);
      push({ key: "ms-late:" + n.id, kind: "move-deadline", id: n.id, title: "“" + n.title + "” is overdue", detail: "It was due " + m.deadline(n) + ". Move its deadline to " + nextEnd + "?", apply: { op: "set-due", id: n.id, due: nextEnd } });
    });
    const late = arr(ctx.tasks).filter(function (t) { return lateTask(t, ctx) && m.nodeOfTask(t.id) && !PL.isArchived(ctx.links, t.id); });
    if (late.length) push({ key: "tasks-late:" + today.slice(0, 7) + ":" + late.length, kind: "move-tasks", title: late.length + " overdue task" + (late.length === 1 ? "" : "s") + " linked to your plan", detail: "Move " + (late.length === 1 ? "it" : "them") + " to today so " + (late.length === 1 ? "it" : "they") + " show on your list again?", apply: { op: "move-tasks", ids: late.map(function (t) { return t.id; }), date: today } });
    const ws = ctx.weekStart, dates = W.weekDates(ws);
    m.prioritiesOf(Number(today.slice(0, 4)), PL.quarterOfDate(today)).forEach(function (p) {
      if (p.status !== "active" || m.statusOf(p.id) !== "atrisk") return;
      const open = m.subtreeTasks(p.id).filter(function (t) { return !t.completed && dates.indexOf(t.date) !== -1; });
      if (!open.length) push({ key: "pri-idle:" + p.id + ":" + ws, kind: "add-task", id: p.id, title: "“" + p.title + "” is at risk and has nothing planned this week", detail: "Add a task for it this week?", apply: { op: "add-task", id: p.id } });
    });
    const lastWs = PL.addDays(W.mondayOf(today), -7);
    const lw = W.weekOf(ctx.weeks, lastWs);
    const lastEnd = PL.addDays(lastWs, 6), hadWeek = arr(ctx.tasks).some(function (t) { return t && PL.isDate(t.date) && t.date >= lastWs && t.date <= lastEnd; }) || W.occurrences(ctx.blocks, lastWs, lastEnd).length > 0;   // nothing to review in an empty week
    if (hadWeek && today > lastEnd && (!lw || !lw.reviewedAt)) push({ key: "review:" + lastWs, kind: "review", title: "Last week's review is ready", detail: "A summary of " + lastWs + " – " + PL.addDays(lastWs, 6) + " is ready to read and add to.", apply: { op: "open-review", weekStart: lastWs } });
    return out;
  }

  // Applies a proposal the person approved, to copies of the data. -> { ok, nodes?, tasks?, text, undo } where undo says what to change back (as a new edit, so it also wins over a copy synced from another device).
  // Only two kinds change anything by themselves (a new deadline, tasks moved to today); the others open a screen and the person does the work.
  function applyProposal(p, data) {
    const ap = p && p.apply, d = data || {};
    if (!ap) return { ok: false, text: "That suggestion can't be applied." };
    if (ap.op === "set-due") {
      const cur = arr(d.nodes).filter(function (n) { return n && n.id === ap.id && !n.deletedAt; })[0];
      if (!cur) return { ok: false, text: "That isn't there any more." };
      const r = PL.editNode(d.nodes, ap.id, { due: ap.due }, { now: d.now, today: d.today });
      return r.ok ? { ok: true, nodes: r.nodes, text: "Moved the deadline of “" + cur.title + "” to " + ap.due + ".", undo: { nodeId: ap.id, due: cur.due || "" } } : { ok: false, text: "That date can't be used." };
    }
    if (ap.op === "move-tasks") {
      const ids = {}; arr(ap.ids).forEach(function (id) { ids[id] = true; });
      const before = {}, tasks = arr(d.tasks).map(function (t) {
        if (!t || !ids[t.id] || t.completed) return t;
        before[t.id] = t.date;
        return Object.assign({}, t, { date: ap.date });
      });
      const n = Object.keys(before).length;
      return n ? { ok: true, tasks: tasks, text: "Moved " + n + (n === 1 ? " task" : " tasks") + " to " + ap.date + ".", undo: { dates: before } } : { ok: false, text: "Those tasks are already done or gone." };
    }
    return { ok: false, text: "This one needs you: open it and choose." };
  }

  return {
    categoryKind: categoryKind, workoutMinutesByDate: workoutMinutesByDate, timeByCategory: timeByCategory, gratielMinutes: gratielMinutes, freeMinutes: freeMinutes,
    rankTasks: rankTasks, whyLines: whyLines, categoryOf: categoryOf, isProtected: isProtected, CATEGORIES: CATEGORIES, topThreePicks: topThreePicks, upcoming: upcoming, dashboard: dashboard, weekTotals: weekTotals, weeklySeries: weeklySeries,
    financeSeries: financeSeries, lastMonths: lastMonths, timeAllocation: timeAllocation, allocationSeries: allocationSeries, KIND_GROUPS: KIND_GROUPS, goalProgress: goalProgress, overdueCount: overdueCount, weekReview: weekReview, monthReview: monthReview, quarterOverview: quarterOverview, monthOverview: monthOverview, monthOutcomes: monthOutcomes, monthTaskLists: monthTaskLists, applyProposal: applyProposal, proposals: proposals, hours: hours
  };
});
