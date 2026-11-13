/* ==========================================================================
   JARVIS — Learning & Research Hub: Goals (the screen, the form, and the Dashboard card).
   Every figure comes from your records (see learning-goals-logic.js); there is nothing to type in as you go.
   ========================================================================== */

(function () {
  "use strict";

  const A = window.JarvisLearning;
  if (!A) return;
  const L = A.L, store = A.store, esc = A.esc, G = window.JarvisLearningGoals;

  function today() { return store.today(); }
  function plural(n, a, b) { return A.plural(n, a, b); }
  function unitWord(goal, n) { const m = G.metricOf(goal.metric); return n === 1 ? m.unit : m.units; }
  function periodBadge(g) { return g.period === "day" ? "Every day" : g.period === "week" ? "Every week" : g.period === "month" ? "Every month" : (g.deadline ? "By " + A.fmtShort(g.deadline) : "One time"); }
  function perWord(g) { return g.period === "day" ? "today" : g.period === "week" ? "this week" : "this month"; }
  function triesWord(g, n) { return g.period === "day" ? plural(n, "day") : g.period === "week" ? plural(n, "week") : plural(n, "month"); }

  // The line under a goal's bar: how far, and how long is left.
  function statusLine(s) {
    const g = s.goal, d = s.daysLeft;
    if (s.state === "archived") return "";
    if (g.period === "range") {
      if (s.upcoming) return "Starts " + A.fmtDate(g.startDate);
      if (s.state === "achieved") return "Reached on " + A.fmtDate(s.now.achievedOn);
      if (s.state === "overdue") return "Deadline passed (" + A.fmtDate(g.deadline) + ")" + (s.late ? ". Finished " + A.fmtDate(s.late) : "");
      return g.deadline ? (d === 0 ? "Due today" : plural(d, "day") + " left (by " + A.fmtDate(g.deadline) + ")") : "No deadline";
    }
    if (s.state === "achieved") return "Done " + perWord(g);
    const left = g.period === "day" ? "Ends tonight" : d === 0 ? "Last day " + perWord(g) : plural(d, "day") + " left " + perWord(g);
    return left;
  }
  function amountLine(s) {
    const g = s.goal;
    if (g.metric === "finishBook") return s.book ? (s.now.met ? "Finished" : s.bookPct === null ? "Page " + s.book.currentPage + " (no page total set)" : "Page " + s.book.currentPage + " of " + s.book.totalPages + " · " + s.bookPct + "%") : "That book was deleted";
    return s.now.value + " of " + g.target + " " + unitWord(g, g.target);
  }
  function barFor(s) {
    const g = s.goal;
    const pct = g.metric === "finishBook" && s.bookPct !== null && !s.now.met ? s.bookPct : s.now.pct;
    return A.barHtml(pct, g.title + ": " + pct + "%");
  }
  function windowLabel(g, w) {
    if (g.period === "day") return A.fmtDate(w.from);
    if (g.period === "week") return A.fmtShort(w.from) + " – " + A.fmtShort(w.to);
    return new Date(w.from + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  }

  /* ---------------- the form ---------------- */

  function openGoalForm(goal, example) {
    const isNew = !goal, books = store.list("books");
    const ex = example || null;
    const g = goal || { title: "", metric: ex ? ex.metric : "pages", target: ex ? ex.target : 50, period: ex ? ex.period : "week", startDate: today(), deadline: "", bookId: "" };
    const body =
      (isNew ? A.fSelect("example", "Start from an example (optional)", [["", "Choose…"]].concat(G.EXAMPLES.map(function (e, i) { return [String(i), e.label]; })), ex ? String(G.EXAMPLES.indexOf(ex)) : "", {}) : "") +
      A.fSelect("metric", "What to count", G.METRICS.map(function (m) { return [m.key, m.label]; }), g.metric, { required: true }) +
      '<div id="lnGoalTarget">' + A.fText("target", "Target", g.target, { type: "number", mode: "numeric", min: 1, required: true }) + '</div>' +
      A.fSelect("period", "How often", G.PERIODS.map(function (p) { return [p.key, p.label]; }), g.period, { required: true }) +
      '<div id="lnGoalBook">' + A.fSelect("bookId", "Book", [["", "Any book"]].concat(books.map(function (b) { return [b.id, b.title]; })), g.bookId, {}) + '</div>' +
      '<div id="lnGoalDates" class="ln-two">' + A.fText("startDate", "Starts", g.startDate, { type: "date" }) + '<div id="lnGoalDeadline">' + A.fText("deadline", "Deadline (optional)", g.deadline, { type: "date" }) + '</div></div>' +
      A.fText("title", "Name (optional)", g.title, { max: 200, hint: "Leave empty and JARVIS words it for you, like “Read 50 pages each week”." });

    function sync(el) {
      const metric = el.querySelector("#lnf_metric").value, period = el.querySelector("#lnf_period").value;
      el.querySelector("#lnGoalTarget").hidden = metric === "finishBook";
      const bookRow = el.querySelector("#lnGoalBook"), usesBook = metric === "pages" || metric === "minutes" || metric === "finishBook";
      bookRow.hidden = !usesBook;
      bookRow.querySelector("label").firstChild.textContent = metric === "finishBook" ? "Which book" : "Only count one book (optional)";
      el.querySelector("#lnf_bookId").options[0].textContent = metric === "finishBook" ? "Choose a book…" : "Any book";
      el.querySelector("#lnGoalDeadline").hidden = period !== "range";
      el.querySelector("#lnf_startDate").closest(".form-row").querySelector("label").firstChild.textContent = period === "range" ? "Starts" : "Starts counting";
    }
    A.openSheet({
      title: isNew ? "New learning goal" : "Edit goal", body: body, submit: isNew ? "Create goal" : "Save changes", focus: isNew ? "#lnf_example" : "#lnf_target",
      onOpen: sync,
      onChange: function (t, el) {
        if (t.id === "lnf_example" && t.value !== "") {
          const e = G.EXAMPLES[Number(t.value)];
          if (e) { el.querySelector("#lnf_metric").value = e.metric; el.querySelector("#lnf_target").value = e.target; el.querySelector("#lnf_period").value = e.period; }
        }
        if (t.id === "lnf_metric" || t.id === "lnf_period" || t.id === "lnf_example") sync(el);
      },
      onSubmit: function (v) {
        const r = G.check(v, { today: today(), books: books });
        if (!r.ok) return { ok: false, errors: r.errors };
        const value = Object.assign({}, r.value);
        const saved = isNew ? store.add("goals", value) : store.put("goals", Object.assign({}, goal, value, { status: goal.status }));
        if (!saved) { A.saveFailed(); return { ok: false, errors: {}, message: store.error() }; }
        A.say(isNew ? "Goal created." : "Goal updated.");
        A.notice(isNew ? "Goal created: " + saved.title : "Goal updated.", "");
        return { ok: true };
      }
    });
  }

  /* ---------------- actions ---------------- */

  function archiveGoal(id) {
    const g = store.get("goals", id);
    if (!g) return;
    const before = g;
    const next = G.archive(g, store.state(), today(), Date.now());
    if (!store.put("goals", next)) { A.saveFailed(); return; }
    A.notice(next.result === "achieved" ? "Goal achieved and moved to your history." : "Moved to your goal history.", "Undo", function () { store.put("goals", before); });
  }
  function reactivateGoal(id) {
    const g = store.get("goals", id);
    if (g && !store.put("goals", G.reactivate(g, Date.now()))) A.saveFailed();
  }
  function deleteGoal(id) {
    const g = store.get("goals", id);
    if (!g) return;
    if (!store.remove("goals", id)) { A.saveFailed(); return; }
    A.notice("Goal deleted.", "Undo", function () { store.undoRemove("goals", id); });
  }

  /* ---------------- the screen ---------------- */

  function goalCard(s) {
    const g = s.goal, hist = s.history || [], met = hist.filter(function (h) { return h.met; }).length, streak = G.streak(hist);
    const stateBadge = s.state === "achieved" ? A.badge("green", "Achieved") : s.state === "overdue" ? A.badge("red", "Overdue") : s.upcoming ? A.badge("neutral", "Not started") : "";
    let h = '<article class="card ln-card ln-goal" id="lngoal_' + esc(g.id) + '"><div class="ln-badges">' + A.badge("accent", periodBadge(g)) + stateBadge + '</div>' +
      '<h3 class="ln-goal-title">' + esc(g.title || G.titleFor(g, "")) + '</h3>' + barFor(s) +
      '<p class="ln-big ln-goal-amount">' + esc(amountLine(s)) + '</p><p class="ln-item-sub">' + esc(statusLine(s)) + '</p>';
    if (hist.length) {
      h += '<details class="ln-more ln-goal-hist" data-keep="goalhist_' + esc(g.id) + '"' + (A.state.open["goalhist_" + g.id] ? " open" : "") + '><summary>Past ' + esc(g.period === "day" ? "days" : g.period === "week" ? "weeks" : "months") + ': met ' + met + ' of ' + hist.length + (streak > 1 ? ' · ' + streak + ' in a row' : '') + '</summary>' +
        '<ul class="ln-rv-list">' + hist.slice(0, 12).map(function (x) { return '<li class="ln-rv-item"><span>' + esc(windowLabel(g, x.window)) + '</span><span class="ln-item-sub">' + x.value + ' of ' + x.target + ' ' + esc(unitWord(g, x.target)) + '</span>' + (x.met ? A.badge("green", "Met") : A.badge("neutral", "Not met")) + '</li>'; }).join("") + '</ul>' +
        (hist.length > 12 ? '<p class="field-hint">The most recent 12 of ' + hist.length + ' are shown.</p>' : "") + '</details>';
    }
    h += '<div class="ln-item-btns"><button type="button" class="btn btn-secondary" data-act="goal-edit" data-id="' + esc(g.id) + '">Edit</button>' +
      '<button type="button" class="btn ' + (s.state === "achieved" || s.state === "overdue" ? "btn-primary" : "btn-secondary") + '" data-act="goal-archive" data-id="' + esc(g.id) + '">Move to history</button>' +
      '<button type="button" class="btn btn-secondary ln-danger" data-act="goal-delete" data-id="' + esc(g.id) + '">Delete</button></div></article>';
    return h;
  }
  function historyCard(g) {
    const m = G.metricOf(g.metric), value = typeof g.finalValue === "number" ? g.finalValue : 0;
    const badge = g.result === "achieved" ? A.badge("green", "Achieved") : g.result === "missed" ? A.badge("red", "Missed") : A.badge("neutral", "Put away");
    return '<li class="ln-sched-row"><div class="ln-sched-main"><span class="ln-badges">' + badge + A.badge("neutral", periodBadge(g)) + '</span><span class="ln-item-title">' + esc(g.title) + '</span>' +
      '<span class="ln-item-sub">' + esc((g.endedOn ? "Ended " + A.fmtDate(g.endedOn) + " · " : "") + (g.metric === "finishBook" ? (g.result === "achieved" ? "Book finished" : "Book not finished") : value + " of " + g.target + " " + unitWord(g, g.target))) + '</span></div>' +
      '<div class="ln-item-btns"><button type="button" class="btn btn-secondary" data-act="goal-reactivate" data-id="' + esc(g.id) + '">Reactivate</button><button type="button" class="btn btn-secondary ln-danger" data-act="goal-delete" data-id="' + esc(g.id) + '">Delete</button></div></li>';
  }
  function html() {
    const S = store.state(), list = G.active(S.goals, S, today()), old = G.archived(S.goals);
    let h = '<div class="ln-head"><h2 class="ln-h2" data-focus-top>Goals</h2><button type="button" class="btn btn-primary" data-act="goal-add">+ New goal</button></div>';
    if (!list.length) {
      h += '<section class="card ln-card"><p class="ln-big">No goals yet</p><p class="field-hint">Pick a target for something you already track, like pages, books or lessons reviewed. Progress fills in by itself from your records.</p>' +
        '<div class="ln-chips" role="group" aria-label="Start from an example">' + G.EXAMPLES.map(function (e, i) { return '<button type="button" class="ln-chip" data-act="goal-example" data-i="' + i + '">' + esc(e.label) + '</button>'; }).join("") + '</div></section>';
    } else h += list.map(goalCard).join("");
    if (old.length) h += '<details class="ln-more ln-goal-old" data-keep="goalsold"' + (A.state.open.goalsold ? " open" : "") + '><summary>Goal history (' + old.length + ')</summary><ul class="ln-sched">' + old.map(historyCard).join("") + '</ul></details>';
    return h;
  }

  A.register("goals", {
    html: html,
    click: function (act, el) {
      const id = el.getAttribute("data-id");
      if (act === "goal-add") openGoalForm(null);
      else if (act === "goal-example") openGoalForm(null, G.EXAMPLES[Number(el.getAttribute("data-i"))]);
      else if (act === "goal-edit") { const g = store.get("goals", id); if (g) openGoalForm(g); }
      else if (act === "goal-archive") archiveGoal(id);
      else if (act === "goal-reactivate") reactivateGoal(id);
      else if (act === "goal-delete") deleteGoal(id);
    }
  });
  A.quickAdd.goal = function () { openGoalForm(null); };

  /* ---------------- the Dashboard card ---------------- */

  A.dashTop.push(function (S) {
    const list = G.active(S.goals, S, today());
    let h = '<section class="card ln-card" aria-labelledby="lnDashGoals"><div class="card-title-row"><h2 class="card-title" id="lnDashGoals">Learning goals</h2><button type="button" class="btn-icon" data-go="goals">' + (list.length ? "All goals" : "Set a goal") + '</button></div>';
    if (!list.length) return h + '<p class="empty-state-compact">No goals yet. Set a target for pages, books, lessons reviewed or ideas implemented, and watch it fill in from your records.</p></section>';
    h += '<div class="ln-list">' + list.slice(0, 4).map(function (s) {
      return '<button type="button" class="ln-item ln-item-open ln-item-flat" data-go="goals"><span class="ln-item-main"><span class="ln-item-title">' + esc(s.goal.title || "") + '</span>' + barFor(s) +
        '<span class="ln-item-sub">' + esc(amountLine(s) + (statusLine(s) ? " · " + statusLine(s) : "")) + '</span></span></button>';
    }).join("") + '</div>' + (list.length > 4 ? '<p class="field-hint">Showing 4 of ' + list.length + ' active goals.</p>' : "");
    return h + '</section>';
  });
})();
