/* ==========================================================================
   JARVIS — Planning › one Add and one Search for everything in Planning.

   JarvisPlanQuick.openAdd({ date, from, opener })   a task, an event, a time block, a habit, a goal or a milestone. The thing you are looking at
                                                     (from: "overview" | "calendar" | "habits" | "strategy") is offered first, and the day you are
                                                     looking at is already filled in.
   JarvisPlanQuick.openSearch({ opener })            tasks, events, habits, time blocks and goals by name. A result opens the real record in the
                                                     screen that owns it, so an edit there is the one edit.

   Nothing is stored here and nothing is copied: each choice calls the form that already creates that kind of thing.
   ========================================================================== */

(function () {
  "use strict";

  const MAX_PER_KIND = 6;

  function core() { return window.JarvisCore; }
  function esc(s) { return core().escapeHtml(String(s === undefined || s === null ? "" : s)); }
  function app() { return window.JarvisPlanApp || null; }
  function today() { return core().todayISODate(); }
  function isDate(d) { return /^\d{4}-\d{2}-\d{2}$/.test(String(d || "")); }
  function say(text) { try { core().showToast(text); } catch (e) { /* nothing to tell */ } }

  /* ---------------- Add ---------------- */

  const KINDS = {
    task: { label: "Task", sub: "Something to do. Gets a time if you give it one" },
    event: { label: "Event", sub: "An appointment or meeting" },
    block: { label: "Time block", sub: "Set time aside for a kind of work" },
    habit: { label: "Habit", sub: "A new habit to keep up" },
    goal: { label: "Goal", sub: "A big goal for the year" },
    milestone: { label: "Milestone", sub: "A checkpoint for the month" },
    routine: { label: "Routine", sub: "Put a reusable sequence on days" }
  };
  const FIRST = { overview: "task", calendar: "event", habits: "habit", strategy: "goal" };
  const ORDER = ["task", "event", "block", "habit", "goal", "milestone", "routine"];

  function newHabit() {
    core().openScreen("navBtnHabits", "habitsSubNavRoutines");
    const wrap = document.getElementById("habitFormWrap"), btn = document.getElementById("habitAddToggleBtn");
    if (wrap && wrap.hidden && btn) btn.click();
    else { const n = document.getElementById("habitName"); if (n) n.focus(); }
  }

  function make(kind, date) {
    const A = app(), PL = window.JarvisPlanLogic, y = Number(date.slice(0, 4));
    if (kind === "task") {
      const P = window.JarvisCalPlanner;
      if (P && P.openTask) P.openTask({ date: date }); else say("Tasks can't be added here right now.");
    } else if (kind === "event") {
      const c = window.JarvisCalendar;
      if (c && c.openNew) c.openNew({ date: date }); else say("The calendar isn't available right now.");
    } else if (kind === "block") {
      if (A && A.openBlockSheet) A.openBlockSheet({ date: date }); else say("Time blocks aren't available right now.");
    } else if (kind === "habit") {
      newHabit();
    } else if (kind === "goal") {
      if (A && A.openNodeSheet) A.openNodeSheet({ type: "objective", year: y }); else say("Goals aren't available right now.");
    } else if (kind === "routine") {
      core().openScreen("navBtnCalendar");
      if (window.JarvisPlanRoutines) window.JarvisPlanRoutines.openList(); else say("Routines aren't available right now.");
    } else if (kind === "milestone") {
      if (A && A.openNodeSheet && PL) A.openNodeSheet({ type: "milestone", year: y, month: PL.monthOfDate(date) }); else say("Milestones aren't available right now.");
    }
  }

  function openAdd(o) {
    const opts = o || {}, date = isDate(opts.date) ? opts.date : today(), first = FIRST[opts.from] || "task";
    const keys = [first].concat(ORDER.filter(function (k) { return k !== first; }));
    window.JarvisMenu.open({
      title: "Add", opener: opts.opener || document.activeElement,
      rows: keys.map(function (k) { return { key: k, label: KINDS[k].label, sub: KINDS[k].sub }; }),
      onPick: function (key) { make(key, date); }
    });
  }

  /* ---------------- Search ---------------- */

  function has(hay, q) { return String(hay || "").toLowerCase().indexOf(q) !== -1; }

  // What matches q, grouped. Every row knows how to open its record. Nothing is changed by looking.
  function find(query) {
    const q = String(query || "").replace(/\s+/g, " ").trim().toLowerCase();
    const out = { q: q, groups: [] };
    if (!q) return out;
    const H = window.JarvisHabits, A = app(), C = window.JarvisCalendar, CL = window.JarvisCalendarLogic, S = window.JarvisPlanStore, PL = window.JarvisPlanLogic;
    const add = function (id, label, rows) { if (rows.length) out.groups.push({ id: id, label: label, rows: rows.slice(0, MAX_PER_KIND), more: Math.max(0, rows.length - MAX_PER_KIND) }); };
    try {
      const links = S && S.all ? S.all("links") : [];
      add("task", "Tasks", (H && H.getTasks ? H.getTasks() : []).filter(function (t) { return t && t.text && has(t.text, q) && !(PL && PL.isArchived && PL.isArchived(links, t.id)); })
        .sort(function (a, b) { return (a.completed ? 1 : 0) - (b.completed ? 1 : 0) || (b.date > a.date ? 1 : b.date < a.date ? -1 : 0); })
        .map(function (t) { return { kind: "task", id: t.id, title: t.text, sub: (t.date || "") + (t.time ? " " + t.time : "") + (t.completed ? " · done" : "") }; }));
    } catch (e) { /* tasks are not readable */ }
    try {
      add("event", "Events", (C && C.getEvents ? C.getEvents() : []).filter(function (e) { return e && !e.deletedAt && CL && CL.matchesSearch(e, q); })
        .map(function (e) { return { kind: "event", id: e.id, title: e.title, sub: String(e.date || "") + (e.time ? " " + e.time : "") }; }));
    } catch (e) { /* events are not readable */ }
    try {
      add("habit", "Habits", (H && H.getHabits ? H.getHabits() : []).filter(function (h) { return h && h.name && !h.archivedAt && has(h.name, q); })
        .map(function (h) { return { kind: "habit", id: h.id, title: h.name, sub: "Habit" }; }));
    } catch (e) { /* habits are not readable */ }
    try {
      add("block", "Time blocks", (S && S.all ? S.all("blocks") : []).filter(function (b) { return b && !b.deletedAt && has(b.title || b.name, q); })
        .map(function (b) { return { kind: "block", id: b.id, title: b.title || b.name, sub: String(b.date || b.startDate || "") + (b.start ? " " + b.start : "") }; }));
    } catch (e) { /* blocks are not readable */ }
    try {
      const m = A && A.model ? A.model() : null;
      add("goal", "Goals", (m ? m.all() : []).filter(function (n) { return n && n.status !== "dropped" && has([n.title, n.description, n.notes, n.successMetric].join(" "), q); })
        .map(function (n) { return { kind: "goal", id: n.id, title: n.title, sub: A && A.typeLabel ? A.typeLabel(n.type) : "Goal" }; }));
    } catch (e) { /* goals are not readable */ }
    return out;
  }

  // Opens the real record for a result.
  function openResult(kind, id, date) {
    const A = app(), C = window.JarvisCalendar, H = window.JarvisHabits, P = window.JarvisCalPlanner;
    if (kind === "task") { if (P && P.openTask) P.openTask({ id: id }); else if (A && A.openTaskSheet) A.openTaskSheet(id); }
    else if (kind === "event") { if (C && C.openEvent) C.openEvent(id, isDate(date) ? date : undefined); }
    else if (kind === "habit") { if (H && H.editHabit) H.editHabit(id); }
    else if (kind === "block") { if (A && A.openBlockSheet) A.openBlockSheet({ id: id, date: isDate(date) ? date : today() }); }
    else if (kind === "goal") { if (A && A.openDetailSheet) A.openDetailSheet(id); }
  }

  function resultsHtml(r) {
    if (!r.q) return '<p class="sp-dim">Type to search tasks, events, habits, time blocks and goals.</p>';
    if (!r.groups.length) return '<p class="sp-dim">Nothing matches “' + esc(r.q) + '”.</p>';
    return r.groups.map(function (g) {
      return '<h3 class="sp-h4">' + esc(g.label) + '</h3><ul class="sp-kids">' + g.rows.map(function (x) {
        return '<li><button type="button" class="sp-kid" data-sheet-act="open" data-kind="' + esc(x.kind) + '" data-id="' + esc(x.id) + '"><span class="sp-kid-t">' + esc(x.title) + '</span><span class="sp-dim">' + esc(x.sub) + '</span></button></li>';
      }).join("") + '</ul>' + (g.more ? '<p class="sp-dim">' + esc("+" + g.more + " more. Type more to narrow it down.") + '</p>' : "");
    }).join("");
  }

  function openSearch() {
    const A = app();
    if (!A || !A.openSheet) { say("Search isn't available right now."); return; }
    A.openSheet({
      title: "Search Planning",
      body: '<div class="form-row"><label for="spf_pq">Search tasks, events, habits and goals</label><input type="search" id="spf_pq" name="q" autocomplete="off" placeholder="e.g. dentist"></div><div id="spPlanSearchOut" class="sp-search-out" aria-live="polite"></div>',
      focus: "#spf_pq",
      onOpen: function (root) { const out = root.querySelector("#spPlanSearchOut"); if (out) out.innerHTML = resultsHtml(find("")); },
      onInput: function (el, root) { if (el.id === "spf_pq") { const out = root.querySelector("#spPlanSearchOut"); if (out) out.innerHTML = resultsHtml(find(el.value)); } },
      onAct: function (act, el) {
        if (act !== "open") return;
        const kind = el.getAttribute("data-kind"), id = el.getAttribute("data-id");
        A.closeSheet(true);
        window.setTimeout(function () { openResult(kind, id); }, 0);
      }
    });
  }

  window.JarvisPlanQuick = { openAdd: openAdd, openSearch: openSearch, find: find, openResult: openResult };
})();
