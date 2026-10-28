/* ==========================================================================
   JARVIS — Discipline: what the saved days add up to (pure functions, no page
   access, so they can be tested outside the browser).

   Everything here is arithmetic over what was entered: the plans, the scored
   reviews, the rules answers, the "I'm avoiding it" log, and the counts kept
   from Habits when a review was saved. It is not AI and it invents nothing.

   Rules it keeps to:
   - A day with no review is never counted as a zero. Averages use scored days only.
   - A comparison needs enough scored days on BOTH sides (MIN_SCORED), or it says so.
   - A "pattern" (what went together with better focus) needs MIN_SPLIT days on each
     side of the question and a gap big enough to matter. It reports what went
     together, never what caused what, and it says how many days it rests on.
   - The numbers are the ones the review card shows (the live score of each saved
     review), so Trends and Today never disagree.
   The thresholds are design choices, not statistical tests: they only decide when
   it is better to say "not enough data yet" than to show a number.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./discipline-logic"));
  else root.JarvisDisciplineInsights = factory(root.JarvisDisciplineLogic);
})(typeof self !== "undefined" ? self : this, function (L) {
  "use strict";

  const MIN_SCORED = L.MIN_DAYS_FOR_AVERAGES; // scored days before an average or a comparison is shown
  const MIN_SPLIT = 5;                         // days needed on each side of a question before a pattern is shown
  const MIN_RULE_ANSWERS = 4;                  // answers before a single rule is called kept or struggling
  const INSIGHT_DAYS = 30;                     // patterns look at the last 30 days whichever window is showing
  const FOCUS_GAP = 0.5;                       // rating points (out of 5) a difference in focus has to reach
  const DONE_GAP = 0.2;                        // 20 percentage points of main wins finished

  const WEEKDAY_PLURAL = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
  function planned(m) { return L.hasPlanItems(m); }
  function pct(n, d) { return d ? Math.round(100 * n / d) : null; }
  function mean(list) { return list.length ? list.reduce(function (s, x) { return s + x; }, 0) / list.length : null; }
  function round1(x) { return Math.round(x * 10) / 10; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many || one + "s"); }

  // Each date from..to: what was saved, and whether it scored.
  function dayList(days, from, to) {
    const out = [];
    for (let d = from; d <= to; d = L.addDays(d, 1)) {
      const raw = days[d];
      const day = raw ? L.sanitizeDay(raw) : null;
      const result = day ? L.scoreDay(day) : null;
      out.push({ date: d, day: day, planned: !!day && planned(day.morning), scored: !!result && result.complete, result: result });
    }
    return out;
  }

  /* ---------------- one window of days ---------------- */

  // Everything Trends shows about the `len` days ending on endISO. `today` decides what is still open: today is not counted
  // against you until it is reviewed, and nothing before your first logged day is.
  function stats(days, today, endISO, len) {
    const from = L.addDays(endISO, -(len - 1));
    const first = L.firstUseDate(days);
    const list = dayList(days, from, endISO);
    const scored = list.filter(function (x) { return x.scored; });
    const trend = L.trendSummary(days, endISO, len);
    const open = function (x) { return !!first && x.date >= first && x.date <= today; };
    const due = list.filter(function (x) { return open(x) && (x.date < today || x.scored); });
    const planDue = list.filter(function (x) { return open(x) && (x.date < today || x.planned); });

    let keyTotal = 0, keyDone = 0;
    list.forEach(function (x) {
      const m = x.day && x.day.morning;
      if (!m || !m.keyTask.text || !(x.date < today || x.scored)) return;
      keyTotal++;
      if (m.keyTask.done) keyDone++;
    });

    const habitDays = scored.filter(function (x) { return !!x.day.review.habits; });
    const habitsPctSum = habitDays.reduce(function (s, x) { return s + x.day.review.habits.done / x.day.review.habits.total; }, 0);
    const extra = function (key) {
      let yes = 0, no = 0;
      scored.forEach(function (x) { const v = x.day.review.extras[key]; if (v === "done") yes++; else if (v === "not") no++; });
      return { yes: yes, no: no, answered: yes + no, rate: pct(yes, yes + no) };
    };
    const rules = L.ruleSummary(days, endISO, len);

    return {
      from: from, to: endISO, length: len,
      scoredDays: scored.length, enough: scored.length >= MIN_SCORED, average: trend.average,
      best: trend.best, worst: trend.worst, categories: trend.categories, weakest: trend.weakest, weakestWeekday: trend.weakestWeekday,
      noPlanDays: scored.filter(function (x) { return !x.planned; }).length,
      reviewed: { done: scored.length, of: due.length },
      plans: { done: planDue.filter(function (x) { return x.planned; }).length, of: planDue.length },
      keyTask: { done: keyDone, of: keyTotal, rate: pct(keyDone, keyTotal) },
      phone: trend.phone,
      rules: rules,
      habits: { days: habitDays.length, allDone: habitDays.filter(function (x) { return x.day.review.habits.open === 0; }).length, avgPct: habitDays.length ? Math.round(100 * habitsPctSum / habitDays.length) : null },
      routine: extra("routine"), managed: extra("managed"),
      excusedDays: trend.excusedDays, missed: due.length - scored.length
    };
  }

  // The window ending today, the one before it, and the change in average score (only when both have enough days).
  function overview(days, today, len) {
    const cur = stats(days, today, today, len);
    const prev = stats(days, today, L.addDays(today, -len), len);
    return { cur: cur, prev: prev, delta: cur.enough && prev.enough ? cur.average - prev.average : null, streak: L.reviewStreak(days, today) };
  }

  /* ---------------- the chart and the calendar ---------------- */

  // One point per day, oldest first. score is null for a day with no scored review.
  function series(days, today, len) {
    return L.trendSummary(days, today, len).daily;
  }

  function bucket(score) { return score >= 80 ? 4 : score >= 60 ? 3 : score >= 40 ? 2 : 1; }

  // Weeks as rows (Monday first) covering the window, so the pattern of days shows.
  //   cell: { date, state: "scored" | "planned" | "none" | "future" | "outside", score, bucket, today }
  function calendar(days, today, len) {
    const start = L.addDays(today, -(len - 1));
    const gridStart = L.addDays(start, -((L.weekdayOf(start) + 6) % 7));
    const gridEnd = L.addDays(today, (7 - L.weekdayOf(today)) % 7);
    const rows = [];
    let row = [];
    for (let d = gridStart; d <= gridEnd; d = L.addDays(d, 1)) {
      const cell = { date: d, state: "none", score: null, bucket: 0, today: d === today };
      if (d > today) cell.state = "future";
      else if (d < start) cell.state = "outside";
      else if (days[d]) {
        const r = L.scoreDay(days[d]);
        if (r.complete) { cell.state = "scored"; cell.score = r.score; cell.bucket = bucket(r.score); }
        else if (planned(L.sanitizeDay(days[d]).morning)) cell.state = "planned";
      }
      row.push(cell);
      if (row.length === 7) { rows.push(row); row = []; }
    }
    return rows;
  }

  /* ---------------- this week against last week ---------------- */

  function signed(n, unit) { return (n > 0 ? "up " : "down ") + Math.abs(n) + (unit || ""); }

  // Rows for a side-by-side of the last 7 days and the 7 before them. A value is "—" when there is nothing to show, and a
  // change is only given when both weeks have enough scored days.
  function weekCompare(days, today) {
    const cur = stats(days, today, today, 7);
    const prev = stats(days, today, L.addDays(today, -7), 7);
    const comparable = cur.enough && prev.enough;
    const dash = "—";
    const rate = function (x) { return x.rate === null ? dash : x.rate + "%"; };
    const rows = [
      { key: "scored", label: "Scored days", cur: cur.scoredDays + " of 7", prev: prev.scoredDays + " of 7", change: null },
      { key: "average", label: "Average score", cur: cur.enough ? String(cur.average) : dash, prev: prev.enough ? String(prev.average) : dash, change: comparable ? (cur.average === prev.average ? "same" : signed(cur.average - prev.average)) : null },
      { key: "keyTask", label: "Main win finished", cur: cur.keyTask.of ? cur.keyTask.done + " of " + cur.keyTask.of : dash, prev: prev.keyTask.of ? prev.keyTask.done + " of " + prev.keyTask.of : dash, change: null },
      { key: "phone", label: "Screen time a day", cur: cur.phone.days ? cur.phone.averageHours + "h" : dash, prev: prev.phone.days ? prev.phone.averageHours + "h" : dash,
        change: cur.phone.days && prev.phone.days ? (cur.phone.averageHours === prev.phone.averageHours ? "same" : signed(round1(cur.phone.averageHours - prev.phone.averageHours), "h")) : null },
      { key: "rules", label: "Rules kept", cur: rate(cur.rules), prev: rate(prev.rules), change: null },
      { key: "habits", label: "All Habits done", cur: cur.habits.days ? cur.habits.allDone + " of " + cur.habits.days : dash, prev: prev.habits.days ? prev.habits.allDone + " of " + prev.habits.days : dash, change: null }
    ];
    return { cur: cur, prev: prev, comparable: comparable, rows: rows };
  }

  /* ---------------- patterns: what went together ---------------- */

  // Questions with a yes/no answer for a scored day, or null when that day can't be placed on either side.
  const PREDICTORS = [
    { key: "bed", yes: "were in bed on time", no: "weren't", of: function (x) { const v = x.day.review.items.bedOnTime; return v === "done" ? true : v === "not" ? false : null; } },
    { key: "phoneOut", yes: "kept your phone out of the bedroom", no: "didn't", of: function (x) { const v = x.day.review.items.phoneOut; return v === "done" ? true : v === "not" ? false : null; } },
    { key: "ifThen", yes: "wrote an if-then plan", no: "didn't", of: function (x) { return x.day.morning ? L.hasIfThen(x.day.morning.plan) : null; } },
    { key: "habits", yes: "finished all your Habits", no: "left some Habits open", of: function (x) { const h = x.day.review.habits; return h ? h.open === 0 : null; } },
    { key: "routine", yes: "followed your planned routine", no: "didn't", of: function (x) { const v = x.day.review.extras.routine; return v === "done" ? true : v === "not" ? false : null; } },
    { key: "phoneUnder", yes: "stayed under your phone limit", no: "went over it", of: function (x) {
      const r = x.day.review;
      return r.items.phone === "na" || r.screenHours === null ? null : r.screenHours <= r.phoneLimit;
    } }
  ];
  // What is measured on each side. Neither is part of the question it is compared with.
  const OUTCOMES = [
    { key: "focus", gap: FOCUS_GAP, scale: 4, of: function (x) { return x.day.review.focus; },
      say: function (vals) { return "your focus rating averaged " + round1(mean(vals)) + " out of 5"; }, value: function (vals) { return mean(vals); } },
    { key: "keyTask", gap: DONE_GAP, scale: 1, of: function (x) { const m = x.day.morning; return m && m.keyTask.text ? (m.keyTask.done ? 1 : 0) : null; },
      say: function (vals) { const d = vals.filter(function (v) { return v === 1; }).length; return "you finished your main win on " + d + " of " + vals.length + " days"; }, value: function (vals) { return mean(vals); } }
  ];

  function patterns(days, today) {
    const from = L.addDays(today, -(INSIGHT_DAYS - 1));
    const scored = dayList(days, from, today).filter(function (x) { return x.scored; });
    const found = [];
    PREDICTORS.forEach(function (p) {
      let best = null;
      OUTCOMES.forEach(function (o) {
        const yes = [], no = [];
        scored.forEach(function (x) {
          const side = p.of(x), v = o.of(x);
          if (side === null || v === null || v === undefined) return;
          (side ? yes : no).push(v);
        });
        if (yes.length < MIN_SPLIT || no.length < MIN_SPLIT) return;
        const diff = o.value(yes) - o.value(no);
        if (Math.abs(diff) < o.gap - 1e-9) return;
        const effect = Math.abs(diff) / o.scale;
        if (!best || effect > best.effect) best = { predictor: p, outcome: o, yes: yes, no: no, diff: diff, effect: effect };
      });
      if (best) found.push(best);
    });
    return found.sort(function (a, b) { return b.effect - a.effect; }).slice(0, 2).map(function (f) {
      return {
        id: "pattern-" + f.predictor.key + "-" + f.outcome.key, kind: "pattern",
        text: "On the " + f.yes.length + " days you " + f.predictor.yes + ", " + f.outcome.say(f.yes) + ". On the " + f.no.length + " days you " + f.predictor.no + ", " + f.outcome.say(f.no) + ".",
        basis: "Your last " + INSIGHT_DAYS + " days of saved reviews. This shows what went together. It doesn't show what caused what."
      };
    });
  }

  /* ---------------- insights ---------------- */

  // What the last 30 days say, each with the days it rests on. -> { items: [{ id, kind, text, basis }], scoredDays, needs }
  // `needs` is a sentence about what is missing when there is nothing to show, else "".
  function insights(days, avoid, rules, today) {
    const cur = stats(days, today, today, INSIGHT_DAYS);
    const items = [];
    if (!cur.enough) {
      return { items: [], scoredDays: cur.scoredDays, needs: "Needs " + MIN_SCORED + " scored days in the last " + INSIGHT_DAYS + ". You have " + cur.scoredDays + "." };
    }
    const week = weekCompare(days, today);
    if (week.comparable) {
      const d = week.cur.average - week.prev.average;
      items.push({ id: "week", kind: "trend",
        text: "Your average this week is " + week.cur.average + " (" + plural(week.cur.scoredDays, "scored day") + "), " + (Math.abs(d) < 2 ? "about the same as" : (d > 0 ? "up " : "down ") + Math.abs(d) + " from") + " " + week.prev.average + " the week before (" + plural(week.prev.scoredDays, "scored day") + ").",
        basis: "The last 7 days against the 7 before them." });
    }
    if (cur.weakest) {
      const noPlan = cur.weakest.key === "followThrough" && cur.noPlanDays ? " " + cur.noPlanDays + " of those days had no plan saved, and a day with no plan counts as 0 for this area." : "";
      items.push({ id: "weakest", kind: "weakest", text: "Your weakest area is " + cur.weakest.label + ", averaging " + cur.weakest.pct + "% of what was attainable." + noPlan,
        basis: "Averaged over " + plural(cur.scoredDays, "scored day") + " in the last " + INSIGHT_DAYS + "." });
    }
    items.push.apply(items, patterns(days, today));
    if (cur.weakestWeekday) {
      const w = cur.weakestWeekday;
      items.push({ id: "weekday", kind: "weekday", text: "Your lowest weekday is " + WEEKDAY_PLURAL[w.weekday] + ", averaging " + w.average + " over " + plural(w.days, "scored day") + ".",
        basis: "Weekday patterns need " + L.MIN_DAYS_FOR_WEEKDAYS + " scored days in the last " + INSIGHT_DAYS + ", and at least 2 of that weekday." });
    }
    const struggling = cur.rules.byRule.filter(function (r) { return r.answered >= MIN_RULE_ANSWERS && r.kept / r.answered < 0.5; })[0];
    const steady = cur.rules.byRule.filter(function (r) { return r.answered >= MIN_RULE_ANSWERS && r.kept / r.answered >= 0.8; })[0];
    if (struggling) items.push({ id: "rule-struggling", kind: "rule", text: "“" + struggling.text + "” was kept " + struggling.kept + " of " + struggling.answered + " times. A smaller version of it may be easier to keep.", basis: "Your answers to this rule in the last " + INSIGHT_DAYS + " days." });
    else if (steady) items.push({ id: "rule-steady", kind: "rule", text: "“" + steady.text + "” was kept " + steady.kept + " of " + steady.answered + " times. That is a rule you can lean on.", basis: "Your answers to this rule in the last " + INSIGHT_DAYS + " days." });
    const av = L.avoidSummary(avoid || [], today, INSIGHT_DAYS);
    if (av.total >= MIN_SCORED && av.reasons.length) {
      const top = av.reasons[0];
      items.push({ id: "avoid", kind: "avoid", text: "You tapped “I'm avoiding it” " + av.total + " times. The most common reason was “" + top.label + "” (" + top.count + ")." + (av.startRate !== null ? " You started anyway " + av.started + " of " + (av.started + av.dropped) + " times." : ""),
        basis: "Your “I'm avoiding it” log for the last " + INSIGHT_DAYS + " days." });
    }
    return { items: items, scoredDays: cur.scoredDays, needs: items.length ? "" : "Nothing stands out yet. Patterns need at least " + MIN_SPLIT + " days on each side of a question, and a clear difference." };
  }

  /* ---------------- the weekly review ---------------- */

  const SHARE_SECTIONS = [
    { key: "scores", label: "Scores and review streak", on: true },
    { key: "phone", label: "Phone time", on: true },
    { key: "habits", label: "Habits routine", on: true },
    { key: "rules", label: "How often I kept my rules (numbers only)", on: true },
    { key: "avoid", label: "How often I started what I was avoiding", on: true },
    { key: "wording", label: "My rules and next step, in my own words", on: false }
  ];

  // The last 7 days as a report: what the numbers were, what went well, what to improve, and up to two rules worth trying.
  //   input: { days, avoid, rules, today }
  function weeklyReport(input) {
    const today = input.today, days = input.days;
    const allRules = input.rules || [];              // every rule, turned on or off: none is offered twice
    const rules = L.activeRules(allRules);           // the ones being asked and tracked now
    const cmp = weekCompare(days, today);
    const cur = cmp.cur, prev = cmp.prev;
    const av = L.avoidSummary(input.avoid || [], today, 7);
    const streak = L.reviewStreak(days, today);
    const went = [], improve = [];

    if (cur.scoredDays >= 2 && cur.best) went.push("Your best day was " + L.shortDate(cur.best.date) + " (" + cur.best.score + ").");
    if (cur.enough && cur.categories) {
      const top = cur.categories.filter(function (c) { return c.pct !== null; }).sort(function (a, b) { return b.pct - a.pct; })[0];
      if (top && top.pct >= 80) went.push("Strongest area: " + top.label + ", averaging " + top.pct + "% of what was attainable.");
    }
    if (cur.keyTask.of >= MIN_SCORED && cur.keyTask.done / cur.keyTask.of >= 0.6) went.push("You finished your main win on " + cur.keyTask.done + " of " + cur.keyTask.of + " days.");
    if (cur.rules.answered >= MIN_SCORED && cur.rules.rate >= 80) went.push("You kept your rules on " + cur.rules.kept + " of " + cur.rules.answered + " answers.");
    if (av.started + av.dropped >= 2 && av.started / (av.started + av.dropped) >= 0.5) went.push("When you avoided something, you started anyway " + av.started + " of " + (av.started + av.dropped) + " times.");
    if (cur.phone.days >= MIN_SCORED && cur.phone.overLimit === 0) went.push("You stayed within your phone limit on all " + cur.phone.days + " days with a screen-time number.");
    if (cur.habits.days >= MIN_SCORED && cur.habits.allDone / cur.habits.days >= 0.6) went.push("You finished all your Habits on " + cur.habits.allDone + " of " + cur.habits.days + " reviewed days.");
    if (streak >= 3) went.push("Your review streak is " + streak + " days.");

    if (cur.enough && cur.weakest) improve.push("Weakest area: " + cur.weakest.label + ", averaging " + cur.weakest.pct + "% of what was attainable." + (cur.weakest.key === "followThrough" && cur.noPlanDays ? " " + plural(cur.noPlanDays, "scored day") + " had no plan saved, and a day with no plan counts as 0 here." : ""));
    if (cur.phone.days && cur.phone.overLimit > 0) improve.push("You went over your phone limit on " + cur.phone.overLimit + " of " + cur.phone.days + " days with a screen-time number.");
    if (cur.missed > 0) improve.push(plural(cur.missed, "day") + " passed without a review.");
    if (cur.rules.answered >= MIN_RULE_ANSWERS && cur.rules.rate < 50) improve.push("Your rules were kept on " + cur.rules.kept + " of " + cur.rules.answered + " answers. A smaller rule may be easier to keep.");

    // Up to two rules to try, each with the reason taken from the week's own numbers. Rules you already have are not offered again.
    const recs = [];
    const have = function (text) { return allRules.some(function (r) { return L.ruleKey(r.text) === L.ruleKey(text); }); };
    const base = cur.enough ? cur : stats(days, today, today, INSIGHT_DAYS);
    L.suggestRules({ categories: base.categories }, allRules).slice(0, 2).forEach(function (s) { recs.push({ text: s.text, why: s.why + (cur.enough || s.starter ? "" : " (last " + INSIGHT_DAYS + " days)"), source: s.starter ? "starter" : "weakest" }); });
    if (av.total >= MIN_SCORED && av.reasons.length && av.reasons[0].count >= 2) {
      const reason = L.REASONS.filter(function (r) { return r.key === av.reasons[0].key; })[0];
      if (reason && !have(reason.rule) && !recs.some(function (r) { return r.text === reason.rule; })) {
        recs.unshift({ text: reason.rule, why: "You tapped “I'm avoiding it” " + av.total + " times this week, most often because “" + reason.label + "” (" + av.reasons[0].count + ").", source: "avoid" });
      }
    }
    const recommendations = recs.slice(0, 2);
    // The rules already being tracked, and how they went this week (answered in the evening review).
    const tracking = rules.map(function (r) {
      const b = cur.rules.byRule.filter(function (x) { return L.ruleKey(x.text) === L.ruleKey(r.text); })[0];
      return { text: r.text, kept: b ? b.kept : 0, answered: b ? b.answered : 0 };
    });

    return { from: cur.from, to: cur.to, cur: cur, prev: prev, comparable: cmp.comparable, delta: cmp.comparable ? cur.average - prev.average : null,
      streak: streak, avoid: av, went: went, improve: improve, recommendations: recommendations, tracking: tracking, rules: rules.map(function (r) { return r.text; }) };
  }

  // Plain text to send to someone you answer to. Only the sections you pick, numbers only unless you pick "in my own words".
  // Task names, reflections and review notes are never included.
  //   options: { scores, phone, habits, rules, avoid, wording } (true / false each; missing means the section's default)
  function shareText(report, options) {
    const on = function (key) {
      if (options && typeof options[key] === "boolean") return options[key];
      return SHARE_SECTIONS.filter(function (s) { return s.key === key; })[0].on;
    };
    const cur = report.cur;
    const lines = ["My week on JARVIS Discipline (" + L.shortDate(report.from) + " to " + L.shortDate(report.to) + "):"];
    if (on("scores")) {
      if (!cur.scoredDays) lines.push("No scored days this week.");
      else {
        lines.push("Scored days: " + cur.scoredDays + " of 7." + (cur.enough ? " Average score: " + cur.average + "." : "") + (cur.scoredDays >= 2 && cur.best ? " Best: " + cur.best.score + "." : ""));
        if (report.comparable) lines.push("Last week's average was " + report.prev.average + (report.delta === 0 ? " (same)." : " (" + (report.delta > 0 ? "up " : "down ") + Math.abs(report.delta) + ")."));
        lines.push("Review streak: " + plural(report.streak, "day") + ".");
      }
    }
    if (on("phone") && cur.phone.days) lines.push("Phone: averaged " + cur.phone.averageHours + "h a day, over my limit on " + cur.phone.overLimit + " of " + cur.phone.days + " days.");
    if (on("habits") && cur.habits.days) lines.push("Habits: finished all of them on " + cur.habits.allDone + " of " + cur.habits.days + " reviewed days.");
    if (on("rules") && cur.rules.answered) lines.push("Rules kept: " + cur.rules.kept + " of " + cur.rules.answered + " answers.");
    if (on("avoid") && report.avoid.started + report.avoid.dropped) lines.push("When I avoided something, I started anyway " + report.avoid.started + " of " + (report.avoid.started + report.avoid.dropped) + " times.");
    if (on("wording")) {
      if (report.rules.length) lines.push("What I'm working on: " + report.rules.slice(0, 3).join(" "));
      if (report.recommendations.length) lines.push("Next I want to try: " + report.recommendations[0].text);
    }
    return lines.join("\n");
  }

  return {
    MIN_SCORED: MIN_SCORED, MIN_SPLIT: MIN_SPLIT, MIN_RULE_ANSWERS: MIN_RULE_ANSWERS, INSIGHT_DAYS: INSIGHT_DAYS, FOCUS_GAP: FOCUS_GAP, DONE_GAP: DONE_GAP,
    SHARE_SECTIONS: SHARE_SECTIONS, stats: stats, overview: overview, series: series, calendar: calendar, bucket: bucket,
    weekCompare: weekCompare, patterns: patterns, insights: insights, weeklyReport: weeklyReport, shareText: shareText
  };
});
