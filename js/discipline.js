/* ==========================================================================
   JARVIS — Discipline tracker (screens). The rules live in discipline-logic.js.

   localStorage key:
     jarvisDiscipline — { settings: { phoneLimit, times: { planBy, afterSchool, review } },
                          rules: [ { id, text } ],                      your own if-then rules
                          avoid: [ { at, date, task, reason, excuse, outcome } ],   "I'm avoiding it" log
                          timer: { task, taskId, reason, excuse, entryAt, startedAt, minutes, endsAt } | null,
                          days: { "<YYYY-MM-DD>": {
                            type, morning: { keyTask, priorities[3] (each { text, done, due, category }), distraction, response,
                                             plan, savedAt, editedAt } | null,
                            review: { screenHours, phoneLimit, items{}, extras{ routine, managed }, focus, time, rules[], blocker,
                                      notes..., rubric, scored{}, savedAt } | null } } }
   Saved on this device, and backed up to your own account by js/cloud-backup.js
   once that is switched on (it is not in the older cloud-sync list). Nothing
   else leaves the phone unless you tap Share. A day's score is worked out
   from its answers each time, under the scoring-model version the review was
   saved with, and each review also keeps what it came to when it was saved and
   the phone limit it was scored against, so changing the limit or the model
   later never rewrites a past day (see discipline-logic.js).
   A plan or review that is typed but not saved yet is kept under its own key,
   jarvisDisciplineDrafts ({ "<YYYY-MM-DD>": { morning, review } }), so a refresh,
   a switch to another screen, the phone locking or midnight passing never loses
   it. It stays on this phone (it is not part of the backup) and goes when the
   plan or review is saved.
   The advice text is fixed wording keyed to what you pick. It is not AI.
   ========================================================================== */

(function () {
  "use strict";

  const LS_KEY = "jarvisDiscipline";
  const LS_DRAFTS = "jarvisDisciplineDrafts";
  const L = window.JarvisDisciplineLogic;
  const P = window.JarvisDisciplineProgram || null; // the 30-day program; the tracker still works without it
  const H = window.JarvisDisciplineHabits || null;  // reads the routine kept in Habits; the tracker still works without it
  const IN = window.JarvisDisciplineInsights || null; // what the saved days add up to (Trends and the weekly review)
  const CH = window.JarvisDisciplineCharts || null;   // draws the Trends charts
  const LS_HABITS = "jarvisHabits";                  // owned by habits.js: Discipline only ever reads it
  const LS_TASKS = "jarvisTasks";

  const ITEM_QUESTIONS = {
    school: "Did you complete your school responsibilities?",
    gratiel: "Did you make meaningful progress on your business (Gratiel)? Something made, not just research.",
    bedOnTime: "Were you in bed on time last night?",
    phoneOut: "Was your phone out of the bedroom last night?",
    training: "Did you complete your planned training or rest?"
  };
  const EXTRA_QUESTIONS = { routine: "Did you follow your planned routine?", managed: "Did you manage your distractions?" };
  // Which review section each required answer lives in, so a missing answer can take you to it.
  const REVIEW_SECTION = { focus: 1, time: 1, school: 1, gratiel: 1, phone: 2, bedOnTime: 2, phoneOut: 2, training: 2 };
  const PLAN_STEPS = ["Main win", "Supporting priorities", "Distraction", "If-then plan"];
  const TEXT_IDS = ["dcKeyTask", "dcPriority1", "dcPriority2", "dcPriority3"];
  const DUE_IDS = ["dcKeyDue", "dcDue1", "dcDue2", "dcDue3"];
  const CAT_IDS = ["dcKeyCat", "dcCat1", "dcCat2", "dcCat3"];
  const MISSING_TEXT = { focus: "your focus rating", time: "your plan rating", phone: "your screen time (or mark it Not today)" };
  const ANSWER_LABELS = { done: "Yes", not: "No", na: "Not today" };
  const NOTE_INPUTS = { dcOutput: "output", dcProcrastinated: "procrastinated", dcDistractions: "distractions", dcWentWell: "wentWell", dcImprove: "improve" };
  const RUBRIC_DETAIL = {
    followThrough: "The one task that makes the day a win counts double; each other priority counts once.",
    focus: "Focus rating 10, phone time against your limit 10.",
    time: "How closely you kept your plan, rated 1 to 5.",
    consistency: "School work 7, a Gratiel block that made something 8.",
    routines: "Bed on time 4, phone out of the bedroom 3, trained or rested as planned 3.",
    reflection: "A morning plan saved 4, the four evening questions answered 6."
  };
  const ACTION_LABELS = { plan: "Plan my day", scoreYesterday: "Score yesterday", start: "Start 2 minutes", avoid: "I'm avoiding it", review: "Open the review", planTomorrow: "Plan tomorrow", mission: "See today's missions", routine: "Open my habits" };
  const DAY_PREFIX = { today: "Today · ", yesterday: "Yesterday · ", tomorrow: "Tomorrow · " };
  const NUDGES = [
    { key: "plan", title: "Lock in today's plan", timeKey: "planBy", type: "daily" },
    { key: "school", title: "Phone on the charger. Homework first.", timeKey: "afterSchool", type: "weekly", days: [1, 2, 3, 4, 5] },
    { key: "review", title: "Evening review: score your day", timeKey: "review", type: "daily" }
  ];

  let store = emptyStore();
  let selected = "today";        // "today" | "yesterday" | "tomorrow"
  let trendWindow = 7;
  let editingMorning = false;
  let planStep = 1;              // which of the four planning steps is showing
  let reviewStep = 1;            // which of the three review sections is showing
  let editingReview = false;     // a saved review reopened for changes
  let reviewOpened = false;      // the review was opened by hand (it opens by itself in the evening)
  let reordering = false;        // the saved plan is showing its move buttons
  let renderedDate = "";         // the date the review form was last loaded for
  let morningDate = "";          // the date the morning form is showing, "" when it isn't
  let draftTimer = null;
  let flow = null;               // the "I'm avoiding it" steps: { step, taskId, taskText, reason, excuse }
  let tickHandle = null;
  let weeklyEdited = false; // the shared text was edited by hand: it is kept until you rebuild it or the day changes
  let weeklyDate = "";
  let lessonOpen = false;
  let draft = newDraft(null);    // the review form's button answers while it's being filled in

  function emptyStore() { return L.sanitizeStore(null); }
  function $(id) { return document.getElementById(id); }
  function core() { return window.JarvisCore; }
  function esc(v) { return core().escapeHtml(v); }
  function tidy(v) { return String(v === undefined || v === null ? "" : v).replace(/\s+/g, " ").trim(); }
  function reduceMotion() { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
  function bringIntoView(id) { const el = $(id); if (el) el.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" }); }
  function reasonOf(key) { return L.REASONS.filter(function (r) { return r.key === key; })[0] || null; }
  function excuseOf(key) { return L.EXCUSES.filter(function (e) { return e.key === key; })[0] || null; }

  /* ---------------- data ---------------- */

  function load() {
    store = L.sanitizeStore(core().loadJSON(LS_KEY, null));
    store.drafts = L.sanitizeDrafts(core().loadJSON(LS_DRAFTS, null));
    if (L.backfillSnapshots(store) > 0) save(); // reviews saved before snapshots existed get one (what they score right now)
  }
  function save() {
    const kept = Object.assign({}, store);
    delete kept.drafts; // drafts have their own key
    if (!core().saveJSON(LS_KEY, kept)) core().showToast("Couldn't save. This browser's storage may be full or blocked.");
  }
  function ensureDay(date) {
    if (!store.days[date]) store.days[date] = L.sanitizeDay({});
    return store.days[date];
  }
  function todayISO() { return core().todayISODate(); }
  function selectedDate() {
    const t = todayISO();
    return selected === "yesterday" ? L.addDays(t, -1) : selected === "tomorrow" ? L.addDays(t, 1) : t;
  }
  function prettyDate(iso, long) {
    const p = iso.split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString("en-US", long ? { weekday: "long", month: "long", day: "numeric" } : { weekday: "short", month: "short", day: "numeric" });
  }
  function nowMinutes() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }

  function newDraft(day) {
    const r = day && day.review;
    const items = {};
    Object.keys(L.ITEMS).concat(["phone"]).forEach(function (k) { items[k] = r ? r.items[k] : null; });
    if (!r) L.excusedFor(day ? day.type : "normal").forEach(function (k) { items[k] = "na"; });
    const rules = {};
    if (r) r.rules.forEach(function (x) { if (x.state) rules[x.id] = x.state; });
    const extras = { routine: r ? r.extras.routine : null, managed: r ? r.extras.managed : null };
    return { items: items, extras: extras, focus: r ? r.focus : null, time: r ? r.time : null, rules: rules };
  }

  function selectDay(which) {
    selected = which;
    editingMorning = false;
    editingReview = false;
    reviewOpened = false;
    reordering = false;
    planStep = 1;
    reviewStep = 1;
    loadReviewForm();
    renderAllToday();
  }

  /* ---------------- drafts: nothing typed is lost ---------------- */

  // A plan or review that is typed but not saved is kept in store.drafts on every keystroke (in memory at once, written
  // to jarvisDisciplineDrafts a moment later and straight away when the app goes to the background), under the date its
  // form was showing. It is dropped when it matches what is saved or when the form is saved.
  function canon(v) {
    return JSON.stringify(v, function (k, x) {
      if (typeof x === "string") return tidy(x);
      if (x && typeof x === "object" && !Array.isArray(x)) { const o = {}; Object.keys(x).sort().forEach(function (kk) { o[kk] = x[kk]; }); return o; }
      return x;
    });
  }
  function hasDraft(date) { const d = store.drafts[date]; return !!d && !!(d.morning || d.review); }
  function setDraft(date, part, value) {
    if (value === null) {
      if (!store.drafts[date]) return;
      delete store.drafts[date][part];
      if (!Object.keys(store.drafts[date]).length) delete store.drafts[date];
    } else {
      store.drafts[date] = store.drafts[date] || {};
      store.drafts[date][part] = value;
    }
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(flushDrafts, 600);
  }
  function flushDrafts() {
    if (draftTimer === null) return;
    window.clearTimeout(draftTimer);
    draftTimer = null;
    core().saveJSON(LS_DRAFTS, store.drafts);
  }
  function setValue(id, v) { const el = $(id); if (el.value !== v) el.value = v; }

  function morningFormValues() {
    return {
      key: $("dcKeyTask").value, p: [$("dcPriority1").value, $("dcPriority2").value, $("dcPriority3").value],
      d: DUE_IDS.map(function (id) { return $(id).value; }), c: CAT_IDS.map(function (id) { return $(id).value; }),
      distraction: $("dcDistraction").value, response: $("dcResponse").value, plan: $("dcPlan").value
    };
  }
  function morningBaseline(day) {
    const m = day && day.morning;
    if (!m) return { key: "", p: ["", "", ""], d: ["", "", "", ""], c: ["", "", "", ""], distraction: "", response: "", plan: "" };
    const all = [m.keyTask].concat(m.priorities);
    return {
      key: m.keyTask.text, p: m.priorities.map(function (x) { return x.text; }),
      d: all.map(function (x) { return x.due; }), c: all.map(function (x) { return x.category; }),
      distraction: m.distraction, response: m.response, plan: m.plan
    };
  }
  function captureMorningDraft() {
    if (!morningDate || $("dcMorningForm").classList.contains("hidden")) return;
    const cur = morningFormValues();
    setDraft(morningDate, "morning", canon(cur) === canon(morningBaseline(store.days[morningDate])) ? null : Object.assign({ at: Date.now() }, cur));
    renderDraftNotes();
  }

  function reviewFormValues() {
    const notes = {};
    Object.keys(NOTE_INPUTS).forEach(function (id) { notes[NOTE_INPUTS[id]] = $(id).value; });
    return { items: Object.assign({}, draft.items), extras: Object.assign({}, draft.extras), focus: draft.focus, time: draft.time, rules: Object.assign({}, draft.rules), screenHours: $("dcScreenHours").value, notes: notes };
  }
  function reviewBaseline(day) {
    const base = newDraft(day || null);
    const r = day && day.review;
    const notes = {};
    Object.keys(NOTE_INPUTS).forEach(function (id) { notes[NOTE_INPUTS[id]] = r ? r[NOTE_INPUTS[id]] : ""; });
    return { items: base.items, extras: base.extras, focus: base.focus, time: base.time, rules: base.rules, screenHours: r && r.screenHours !== null ? String(r.screenHours) : "", notes: notes };
  }
  function captureReviewDraft() {
    if (!renderedDate) return;
    const cur = reviewFormValues();
    setDraft(renderedDate, "review", canon(cur) === canon(reviewBaseline(store.days[renderedDate])) ? null : Object.assign({ at: Date.now() }, cur));
    renderDraftNotes();
  }

  function renderDraftNotes() {
    const m = morningDate && store.drafts[morningDate] && store.drafts[morningDate].morning;
    const r = renderedDate && store.drafts[renderedDate] && store.drafts[renderedDate].review;
    $("dcMorningDraftNote").classList.toggle("hidden", !m);
    $("dcReviewDraftNote").classList.toggle("hidden", !r);
  }

  /* ---------------- Today: header ---------------- */

  function renderHeader() {
    const date = selectedDate();
    const day = store.days[date];
    $("dcDateTitle").textContent = DAY_PREFIX[selected] + prettyDate(date);
    ["today", "yesterday", "tomorrow"].forEach(function (k) {
      const b = $("dcDay" + k.charAt(0).toUpperCase() + k.slice(1));
      b.classList.toggle("active", selected === k);
      b.setAttribute("aria-selected", String(selected === k));
    });
    const streak = L.reviewStreak(store.days, todayISO());
    $("dcStreakBadge").textContent = streak ? streak + " day streak" : "No streak yet";
    const limit = day && day.review ? day.review.phoneLimit : store.settings.phoneLimit;
    $("dcLimitBadge").textContent = "Phone limit " + limit + "h";
  }

  /* ---------------- Today: next up ---------------- */

  // Today's program missions that only a tick can complete (the automatic ones tick themselves).
  /* ---------------- paired with Habits: read-only ---------------- */

  function routineOn(date) {
    if (!H) return null;
    const habits = H.normalizeHabits(core().loadJSON(LS_HABITS, []));
    return { habits: habits, routine: H.routineFor(habits, date) };
  }

  function openHabitsTab() {
    $("navBtnHabits").click();
    $("habitsSubNavToday").click();
    const nav = $("navBtnHabits");
    if (nav && nav.scrollIntoView) window.scrollTo(0, 0);
  }

  function routineLine(routine) {
    const open = routine.items.filter(function (i) { return i.state === "open"; }).map(function (i) { return i.name; });
    return open.slice(0, 3).join(", ") + (open.length > 3 ? " and " + (open.length - 3) + " more" : "") + ".";
  }

  function routineForNext() {
    const r = routineOn(todayISO());
    return r && r.routine.total ? { open: r.routine.open, text: routineLine(r.routine) } : null;
  }

  function stateLabel(i) { return i.state === "done" ? "Done" : i.state === "met" ? "Week's target met" : "To do"; }

  function renderRoutineCard() {
    const card = $("dcRoutineCard");
    if (!H || selected !== "today") { card.classList.add("hidden"); return; }
    const r = routineOn(todayISO());
    const c = H.coach(r.habits, r.routine, todayISO());
    card.classList.remove("hidden");
    $("dcCoachText").textContent = c.text;
    $("dcCoachLeft").textContent = c.left;
    $("dcCoachLeft").classList.toggle("hidden", !c.left);
    $("dcOpenHabits").textContent = r.habits.length ? "Open Habits" : "Add habits";
    const shown = r.routine.items.slice(0, 6);
    $("dcRoutineList").innerHTML = shown.map(function (i) {
      const meta = [];
      if (i.dailyTarget > 1) meta.push(i.count + " of " + i.dailyTarget + " today");
      if (i.daily && i.streak >= 2) meta.push(i.streak + "-day streak");
      meta.push(i.weekDone + " of " + i.weekTarget + " this week");
      return '<div class="dc-routine-row ' + i.state + '"><span class="dc-box" aria-hidden="true">' + (i.state === "done" ? "✓" : i.state === "met" ? "•" : "") + '</span>' +
        '<span class="dc-routine-name">' + esc(i.name) + '</span><span class="dc-routine-meta">' + esc(stateLabel(i)) + '<br>' + esc(meta.join(" · ")) + '</span></div>';
    }).join("") + (r.routine.items.length > shown.length ? '<div class="dc-routine-more">+ ' + (r.routine.items.length - shown.length) + ' more in Habits</div>' : "");
  }

  // The same routine as it stood on the day being reviewed, with a button that copies Habits' answer into the review.
  function renderRoutineReview() {
    const box = $("dcRoutineReview");
    const r = routineOn(renderedDate || selectedDate());
    if (!r || !r.routine.total) { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    const rt = r.routine;
    const left = rt.items.filter(function (i) { return i.state === "open"; }).map(function (i) { return i.name; });
    $("dcRoutineReviewBody").innerHTML = '<span><strong>' + (rt.done + rt.met) + ' of ' + rt.total + '</strong> habits kept' + (left.length ? " · still open: " + esc(left.slice(0, 4).join(", ")) : " · nothing open") + '</span>' +
      '<span class="field-hint">Read from Habits. You decide the answer below.</span>';
  }

  // The Habits tab's own check-in: the coach line and where today's plan and review stand.
  function renderHabitsStrip() {
    const card = $("habitsDisciplineCard");
    if (!card) return;
    if (!H) { card.classList.add("hidden"); return; }
    const today = todayISO();
    const r = routineOn(today);
    const c = H.coach(r.habits, r.routine, today);
    const day = store.days[today];
    const m = day && day.morning;
    const rs = reviewStatus(today);
    card.classList.remove("hidden");
    $("habitsCoachText").textContent = c.text;
    $("habitsCoachLeft").textContent = c.left;
    $("habitsCoachLeft").classList.toggle("hidden", !c.left);
    const planText = m && m.keyTask.text ? "Main win: " + m.keyTask.text + (m.keyTask.done ? " (done)" : " (not done yet)") : m ? "Today's plan is saved" : "No plan for today yet";
    $("habitsDisciplinePlan").textContent = planText + ". Review: " + rs.text.toLowerCase() + ".";
  }

  // Unfinished Habits to-do items for the day being planned, offered as priorities (copied, never linked or changed).
  let importList = [];
  function renderImport() {
    const box = $("dcImport");
    if (!H || !morningDate || planStep !== 2) { box.classList.add("hidden"); return; }
    const have = TEXT_IDS.map(function (id) { return tidy($(id).value).toLowerCase(); });
    importList = H.openTasks(core().loadJSON(LS_TASKS, []), morningDate, 8).filter(function (t) { return have.indexOf(t.text.toLowerCase()) === -1; }).slice(0, 5);
    box.classList.toggle("hidden", !importList.length);
    $("dcImportChips").innerHTML = importList.map(function (t, i) {
      return '<button type="button" class="dc-chip" data-import="' + i + '">+ ' + esc(t.text) + (t.due ? ' <small>(' + esc(timeLabel(t.due)) + ')</small>' : "") + '</button>';
    }).join("");
  }

  function importTask(i) {
    const t = importList[i];
    if (!t) return;
    const slot = TEXT_IDS.findIndex(function (id) { return tidy($(id).value) === ""; });
    if (slot === -1) { core().showToast("All four slots are filled. Clear one to add this."); return; }
    $(TEXT_IDS[slot]).value = t.text;
    if (t.due && !$(DUE_IDS[slot]).value) $(DUE_IDS[slot]).value = t.due;
    if (t.category && !$(CAT_IDS[slot]).value) $(CAT_IDS[slot]).value = t.category;
    captureMorningDraft();
    renderImport();
    core().showToast(slot === 0 ? "Added as your main win." : "Added as priority " + slot + ".");
  }

  function manualMissions() {
    if (!P) return null;
    const pd = P.programDay(store.program.start, todayISO());
    if (pd.status !== "active") return null;
    const manual = P.dayProgress(pd.day, programContext(pd.day)).items.filter(function (m) { return !m.auto; });
    if (!manual.length) return null;
    const open = manual.filter(function (m) { return !m.done; });
    return { total: manual.length, done: manual.length - open.length, nextText: open.length ? open[0].text : "" };
  }

  function actionButton(a, task, primary) {
    return '<button type="button" class="btn ' + (primary && a !== "avoid" ? "btn-primary" : "btn-secondary") + '" data-act="' + a + '"' + (task ? ' data-task="' + esc(task.id) + '"' : "") + '>' + ACTION_LABELS[a] + '</button>';
  }

  function renderNextUp() {
    const card = $("dcNextCard");
    if (selected !== "today" || store.timer || flow) { card.classList.add("hidden"); card.removeAttribute("data-sig"); return; }
    const n = L.nextUp({ todayISO: todayISO(), minutes: nowMinutes(), days: store.days, settings: store.settings, missions: manualMissions(), routine: routineForNext() });
    // Redrawing the same card would drop focus from its buttons; this also runs on a timer.
    const sig = JSON.stringify([n.kind, n.title, n.text, n.why, n.actions, n.more, n.task ? n.task.id : ""]);
    if (card.getAttribute("data-sig") === sig && !card.classList.contains("hidden")) return;
    card.setAttribute("data-sig", sig);
    card.classList.remove("hidden");
    card.setAttribute("data-kind", n.kind);
    $("dcNextTitle").textContent = n.title;
    $("dcNextText").textContent = n.text;
    $("dcNextWhy").textContent = n.why || "";
    $("dcNextWhy").classList.toggle("hidden", !n.why);
    $("dcNextActions").innerHTML = n.actions.map(function (a) { return actionButton(a, n.task, true); }).join("");
    $("dcNextMoreActions").innerHTML = n.more.map(function (a) { return actionButton(a, null, false); }).join("");
    $("dcNextMore").classList.toggle("hidden", !n.more.length);
  }

  function handleNextAction(e) {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.getAttribute("data-act");
    const taskId = btn.getAttribute("data-task") || "";
    if (act === "plan") { bringIntoView("dcMorningCard"); if (!$("dcMorningForm").classList.contains("hidden")) showPlanStep(1, true); }
    else if (act === "scoreYesterday") { selectDay("yesterday"); bringIntoView("dcReviewCard"); }
    else if (act === "review") { reviewOpened = true; renderReviewMode(); renderReviewHint(); bringIntoView("dcReviewCard"); }
    else if (act === "planTomorrow") { selectDay("tomorrow"); bringIntoView("dcMorningCard"); }
    else if (act === "start") startTimer({ task: planItemText(taskId), taskId: taskId, reason: "", excuse: "", entryAt: 0, minutes: L.START_MINUTES });
    else if (act === "avoid") openFlow(taskId);
    else if (act === "mission") $("disciplineSubNavProgram").click();
    else if (act === "routine") openHabitsTab();
  }

  function planItemText(taskId) {
    const day = store.days[todayISO()];
    const m = day && day.morning;
    if (!m || !taskId) return "";
    return taskId === "key" ? m.keyTask.text : (m.priorities[Number(taskId.slice(1))] || { text: "" }).text;
  }
  function openPlanItems() {
    const day = store.days[todayISO()];
    const m = day && day.morning;
    const out = [];
    if (!m) return out;
    if (m.keyTask.text && !m.keyTask.done) out.push({ id: "key", text: m.keyTask.text });
    m.priorities.forEach(function (p, i) { if (p.text && !p.done) out.push({ id: "p" + i, text: p.text }); });
    return out;
  }

  /* ---------------- Today: "I'm avoiding it" and the start timer ---------------- */

  function openFlow(taskId) {
    const text = taskId ? planItemText(taskId) : "";
    flow = text ? { step: "reason", taskId: taskId, taskText: text, reason: "", excuse: "" } : { step: "task", taskId: "", taskText: "", reason: "", excuse: "" };
    renderAllToday();
    bringIntoView("dcFlowCard");
  }

  function chipHtml(attr, value, label, on) {
    return '<button type="button" class="dc-chip' + (on ? " on" : "") + '" ' + attr + '="' + esc(value) + '" aria-pressed="' + !!on + '">' + esc(label) + '</button>';
  }

  function flowHtml() {
    if (flow.step === "task") {
      const items = openPlanItems();
      return '<h2 class="card-title">What are you avoiding?</h2>' +
        (items.length ? '<div class="dc-chips">' + items.map(function (i) { return chipHtml("data-flow-task", i.id, i.text, false); }).join("") + '</div>' : "") +
        '<div class="form-row"><label for="dcFlowTask">' + (items.length ? "Or something else" : "Type what you are avoiding") + '</label>' +
        '<input type="text" id="dcFlowTask" maxlength="100" autocomplete="off" placeholder="e.g. Start the history project"></div>' +
        '<div class="form-actions"><button type="button" class="btn btn-primary" data-flow="task-next">Next</button><button type="button" class="btn btn-secondary" data-flow="cancel">Cancel</button></div>';
    }
    if (flow.step === "reason") {
      return '<h2 class="card-title">Why are you avoiding it?</h2><p class="dc-line"><strong>' + esc(flow.taskText) + '</strong></p>' +
        '<div class="dc-chips">' + L.REASONS.map(function (r) { return chipHtml("data-flow-reason", r.key, r.label, false); }).join("") + '</div>' +
        '<div class="form-actions"><button type="button" class="btn btn-secondary" data-flow="cancel">Cancel</button></div>';
    }
    const reason = reasonOf(flow.reason);
    const excuse = excuseOf(flow.excuse);
    return '<h2 class="card-title">Do this now</h2><p class="dc-line"><strong>' + esc(flow.taskText) + '</strong></p>' +
      '<p class="dc-do">' + esc(reason.first) + '</p>' +
      '<h3 class="checklist-title">What are you telling yourself? <small>(optional)</small></h3>' +
      '<div class="dc-chips">' + L.EXCUSES.map(function (x) { return chipHtml("data-flow-excuse", x.key, x.label, flow.excuse === x.key); }).join("") + '</div>' +
      (excuse ? '<p class="dc-challenge">' + esc(excuse.challenge) + '</p>' : "") +
      '<div class="form-actions"><button type="button" class="btn btn-primary" data-flow="start">Start the 2-minute timer</button><button type="button" class="btn btn-secondary" data-flow="cancel">Not now</button></div>' +
      '<p class="field-hint">You only owe two minutes. This advice is fixed wording, not AI.</p>';
  }

  function clock(ms) {
    const total = Math.ceil(ms / 1000);
    return String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
  }

  function timerHtml(t) {
    const st = L.timerState(t, Date.now());
    const reason = reasonOf(t.reason);
    const head = '<div class="dc-next-kicker">' + (t.minutes === L.START_MINUTES ? "Two-minute start" : t.minutes + "-minute block") + '</div><div class="dc-next-title">' + esc(t.task || "Your task") + '</div>';
    if (st.finished) {
      return head + '<div class="dc-timer-clock" id="dcClock" role="timer">00:00</div>' +
        '<p class="dc-do"><strong>Time.</strong> What now?</p>' +
        '<div class="dc-next-actions"><button type="button" class="btn btn-primary" data-timer="more">Keep going: 10 more minutes</button>' +
        (t.taskId ? '<button type="button" class="btn btn-secondary" data-timer="done">I finished it</button>' : "") +
        '<button type="button" class="btn btn-secondary" data-timer="enough">Enough for now</button></div>' +
        '<p class="field-hint">JARVIS can\'t see what you did. These buttons are your word.</p>';
    }
    const pct = Math.round(100 * (1 - st.remainingMs / (t.minutes * 60000)));
    return head + '<div class="dc-timer-clock" id="dcClock" role="timer">' + clock(st.remainingMs) + '</div>' +
      '<div class="dc-track"><div class="dc-fill" id="dcTimerFill" style="width:' + pct + '%"></div></div>' +
      '<p class="field-hint">' + (reason ? "Do this: " + esc(reason.first) : "Phone away. Just work until it hits zero.") + ' Keep JARVIS open, or come back: the timer keeps its own time.</p>' +
      '<div class="dc-next-actions"><button type="button" class="btn btn-secondary" data-timer="stop">Stop</button></div>';
  }

  function renderFlow() {
    const card = $("dcFlowCard");
    const box = $("dcFlow");
    if (selected !== "today" || (!store.timer && !flow)) {
      card.classList.add("hidden");
      box.innerHTML = "";
      return;
    }
    card.classList.remove("hidden");
    box.innerHTML = store.timer ? timerHtml(store.timer) : flowHtml();
  }

  function startTimer(o) {
    store.timer = L.sanitizeTimer({ task: o.task, taskId: o.taskId, reason: o.reason, excuse: o.excuse, entryAt: o.entryAt, startedAt: Date.now(), minutes: o.minutes });
    flow = null;
    save();
    renderAllToday();
    ensureTicking();
    bringIntoView("dcFlowCard");
  }

  function setOutcome(entryAt, outcome) {
    store.avoid.forEach(function (a) { if (entryAt && a.at === entryAt) a.outcome = outcome; });
  }

  function handleTimerClick(e) {
    const btn = e.target.closest("[data-timer]");
    const t = store.timer;
    if (!btn || !t) return;
    const what = btn.getAttribute("data-timer");
    if (what === "stop") { setOutcome(t.entryAt, "dropped"); store.timer = null; core().showToast("Stopped. Try again when you can."); }
    else if (what === "more") {
      setOutcome(t.entryAt, "started");
      store.timer = L.sanitizeTimer({ task: t.task, taskId: t.taskId, reason: t.reason, excuse: t.excuse, entryAt: t.entryAt, startedAt: Date.now(), minutes: 10 });
    } else {
      setOutcome(t.entryAt, "started");
      if (what === "done" && t.taskId) {
        const m = (store.days[todayISO()] || {}).morning;
        const item = m && (t.taskId === "key" ? m.keyTask : m.priorities[Number(t.taskId.slice(1))]);
        if (item) item.done = true;
      }
      store.timer = null;
      core().showToast(what === "done" ? "Ticked off." : "Good. You started.");
    }
    save();
    renderAllToday();
    ensureTicking();
  }

  function handleFlowClick(e) {
    const chip = e.target.closest("[data-flow-task], [data-flow-reason], [data-flow-excuse]");
    const act = e.target.closest("[data-flow]");
    if (!flow) return;
    if (chip && chip.hasAttribute("data-flow-task")) {
      const id = chip.getAttribute("data-flow-task");
      flow = { step: "reason", taskId: id, taskText: planItemText(id), reason: "", excuse: "" };
    } else if (chip && chip.hasAttribute("data-flow-reason")) {
      flow.reason = chip.getAttribute("data-flow-reason");
      flow.step = "result";
    } else if (chip && chip.hasAttribute("data-flow-excuse")) {
      const key = chip.getAttribute("data-flow-excuse");
      flow.excuse = flow.excuse === key ? "" : key;
    } else if (act) {
      const what = act.getAttribute("data-flow");
      if (what === "cancel") flow = null;
      else if (what === "task-next") {
        const text = tidy($("dcFlowTask").value);
        if (!text) { core().showToast("Type what you are avoiding, or pick one above."); return; }
        flow = { step: "reason", taskId: "", taskText: text.slice(0, 100), reason: "", excuse: "" };
      } else if (what === "start") {
        const at = Date.now();
        store.avoid.push({ at: at, date: todayISO(), task: flow.taskText, reason: flow.reason, excuse: flow.excuse, outcome: null });
        store.avoid = L.sanitizeAvoid(store.avoid);
        startTimer({ task: flow.taskText, taskId: flow.taskId, reason: flow.reason, excuse: flow.excuse, entryAt: at, minutes: L.START_MINUTES });
        return;
      }
    } else return;
    renderAllToday();
  }

  // Keeps the clock moving while a timer exists; the time left always comes from the clock, never from counting ticks.
  function ensureTicking() {
    if (store.timer && !tickHandle) tickHandle = window.setInterval(updateClock, 500);
    if (!store.timer && tickHandle) { window.clearInterval(tickHandle); tickHandle = null; }
  }
  function updateClock() {
    const t = store.timer;
    if (!t) { ensureTicking(); return; }
    const st = L.timerState(t, Date.now());
    const display = $("dcClock");
    if (st.finished) {
      if (display && !display.closest(".dc-flow").querySelector("[data-timer='more']")) renderFlow();
      return;
    }
    if (display) display.textContent = clock(st.remainingMs);
    const fill = $("dcTimerFill");
    if (fill) fill.style.width = Math.round(100 * (1 - st.remainingMs / (t.minutes * 60000))) + "%";
  }

  /* ---------------- Today: morning plan ---------------- */

  function timeLabel(hhmm) {
    const p = String(hhmm).split(":").map(Number);
    return new Date(2000, 0, 1, p[0], p[1]).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  function categoryLabel(key) {
    const c = L.TASK_CATEGORIES.filter(function (x) { return x.key === key; })[0];
    return c ? c.label : "";
  }

  // Which planning step is showing, with its progress, buttons and (on the last step) the example if-then plans.
  function showPlanStep(n, focus) {
    planStep = Math.max(1, Math.min(4, n));
    Array.prototype.forEach.call($("dcMorningForm").querySelectorAll(".dc-step"), function (sec) {
      sec.classList.toggle("hidden", Number(sec.getAttribute("data-step")) !== planStep);
    });
    Array.prototype.forEach.call($("dcMorningPips").children, function (pip, i) { pip.classList.toggle("on", i < planStep); });
    $("dcMorningStepLabel").textContent = "Step " + planStep + " of 4 · " + PLAN_STEPS[planStep - 1];
    $("dcStepBack").classList.toggle("hidden", planStep === 1);
    $("dcStepNext").classList.toggle("hidden", planStep === 4);
    $("dcMorningSaveBtn").classList.toggle("btn-primary", planStep === 4);
    $("dcMorningSaveBtn").classList.toggle("btn-secondary", planStep !== 4);
    renderExamples();
    renderImport();
    if (focus) {
      const first = $("dcMorningForm").querySelector('.dc-step[data-step="' + planStep + '"] input[type="text"], .dc-step[data-step="' + planStep + '"] textarea');
      if (first) first.focus();
    }
  }

  // Example if-then plans are offered only while the box is empty, so they can never replace what was typed.
  function renderExamples() {
    $("dcExamples").classList.toggle("hidden", planStep !== 4 || tidy($("dcPlan").value) !== "");
  }

  function taskRow(id, item, isKey, locked, idx) {
    const meta = [];
    if (item.due) meta.push('<span class="dc-tag">Due ' + esc(timeLabel(item.due)) + '</span>');
    if (item.category) meta.push('<span class="dc-tag">' + esc(categoryLabel(item.category)) + '</span>');
    const label = esc(item.text);
    const tools = reordering && !isKey
      ? '<div class="dc-task-tools"><button type="button" class="btn-icon" data-sum-move="up" data-row="' + idx + '"' + (idx === 0 ? " disabled" : "") + ' aria-label="Move up: ' + label + '">↑</button>' +
        '<button type="button" class="btn-icon" data-sum-move="down" data-row="' + idx + '"' + (idx === 2 ? " disabled" : "") + ' aria-label="Move down: ' + label + '">↓</button>' +
        '<button type="button" class="btn-icon" data-sum-promote="' + idx + '" aria-label="Make this the main win: ' + label + '">★ Make main win</button></div>'
      : "";
    return '<div class="dc-task-row">' + checkRow(id, (isKey ? "★ " : "") + item.text, item.done, isKey, locked) +
      (meta.length ? '<div class="dc-task-meta">' + meta.join("") + '</div>' : "") + tools + '</div>';
  }

  function renderMorning() {
    const day = store.days[selectedDate()];
    const m = day && day.morning;
    const showForm = !m || editingMorning;
    const tomorrow = selected === "tomorrow";
    $("dcMorningTitle").textContent = showForm ? (tomorrow ? "Plan for tomorrow" : "Morning plan") : (tomorrow ? "Tomorrow's priorities" : "Priorities");
    $("dcMorningForm").classList.toggle("hidden", !showForm);
    $("dcMorningSummary").classList.toggle("hidden", showForm);
    $("dcMorningEditBtn").classList.toggle("hidden", showForm);
    $("dcMorningReorderBtn").classList.toggle("hidden", showForm || !m || m.priorities.filter(function (p) { return !!p.text; }).length < 1);
    $("dcMorningReorderBtn").textContent = reordering ? "Done" : "Reorder";
    $("dcMorningReorderBtn").setAttribute("aria-pressed", String(reordering));
    $("dcMorningSaveBtn").textContent = m ? "Save changes" : "Lock in the plan";
    if (showForm) {
      morningDate = selectedDate();
      const dr = store.drafts[morningDate] && store.drafts[morningDate].morning;
      const v = dr || morningBaseline(day);
      TEXT_IDS.forEach(function (id, i) { setValue(id, i === 0 ? v.key : v.p[i - 1]); });
      DUE_IDS.forEach(function (id, i) { setValue(id, v.d[i] || ""); });
      CAT_IDS.forEach(function (id, i) { setValue(id, v.c[i] || ""); });
      setValue("dcDistraction", v.distraction);
      setValue("dcResponse", v.response || "");
      setValue("dcPlan", v.plan);
      renderDraftNotes();
      showPlanStep(planStep, false);
      return;
    }
    morningDate = "";
    renderDraftNotes();
    const rows = [];
    if (m.keyTask.text) rows.push(taskRow("key", m.keyTask, true, tomorrow, -1));
    m.priorities.forEach(function (p, i) { if (p.text) rows.push(taskRow("p" + i, p, false, tomorrow, i)); });
    $("dcMorningSummary").innerHTML =
      '<p class="field-hint">' + (tomorrow ? "You can tick these off tomorrow." : "Tap each one as you finish it.") + '</p>' +
      '<div class="dc-checklist">' + rows.join("") + '</div>' +
      '<div class="dc-plan-extra">' +
      (m.distraction ? '<p class="dc-line"><strong>Distraction to watch:</strong> ' + esc(m.distraction) + (m.response ? " <strong>→</strong> " + esc(m.response) : "") + '</p>' : "") +
      (m.plan ? '<p class="dc-line"><strong>Your plan:</strong> ' + esc(m.plan) + '</p>' : "") + '</div>';
  }

  function checkRow(id, text, done, key, locked) {
    return '<button type="button" class="dc-check' + (done ? " done" : "") + (key ? " key" : "") + '" role="checkbox" aria-checked="' + done + '" data-check="' + id + '"' + (locked ? " disabled" : "") + '>' +
      '<span class="dc-box" aria-hidden="true">' + (done ? "✓" : "") + '</span><span class="dc-check-text">' + esc(text) + '</span></button>';
  }

  function handleMorningSubmit(e) {
    e.preventDefault();
    const date = morningDate || selectedDate(); // the day the form is showing, even if midnight has just passed
    const day = ensureDay(date);
    const old = day.morning;
    const v = morningFormValues();
    const keyText = tidy(v.key);
    const texts = v.p.map(tidy);
    if (!keyText && !texts.some(function (t) { return t; })) {
      core().showToast("Add at least one priority.");
      showPlanStep(1, true);
      return;
    }
    // A tick follows the item by its words, so reordering the list in the form never loses one.
    const wasDone = function (text) {
      if (!old || !text) return false;
      if (old.keyTask.text === text) return old.keyTask.done;
      const hit = old.priorities.filter(function (p) { return p.text === text; })[0];
      return !!hit && hit.done;
    };
    const raw = {
      keyTask: { text: keyText, done: wasDone(keyText), due: v.d[0], category: v.c[0] },
      priorities: texts.map(function (t, i) { return { text: t, done: wasDone(t), due: v.d[i + 1], category: v.c[i + 1] }; }),
      distraction: v.distraction, response: v.response, plan: v.plan,
      savedAt: old ? old.savedAt : Date.now()
    };
    // Only a different key task or a different set of priorities counts as editing the plan (not just their order).
    const sameSet = !!old && old.keyTask.text === keyText &&
      old.priorities.map(function (p) { return p.text; }).filter(Boolean).sort().join("\u0001") === texts.filter(Boolean).sort().join("\u0001");
    raw.editedAt = !old || !sameSet ? Date.now() : old.editedAt;
    day.morning = L.sanitizeDay({ morning: raw }).morning;
    editingMorning = false;
    planStep = 1;
    setDraft(date, "morning", null);
    flushDrafts();
    save();
    renderAllToday();
    core().showToast(old ? "Plan updated." : (selected === "tomorrow" ? "Tomorrow is planned." : "Plan locked in."));
  }

  // Swaps two of the four planning rows (0 = main win, 1-3 = supporting) in the form, tick-free, before anything is saved.
  function swapPlanRows(a, b) {
    [TEXT_IDS, DUE_IDS, CAT_IDS].forEach(function (ids) {
      const x = $(ids[a]), y = $(ids[b]);
      const t = x.value; x.value = y.value; y.value = t;
    });
    captureMorningDraft();
  }

  function handleMorningFormClick(e) {
    const mv = e.target.closest("[data-move]");
    const pr = e.target.closest("[data-promote]");
    const resp = e.target.closest("[data-resp]");
    const ex = e.target.closest("[data-example]");
    const imp = e.target.closest("[data-import]");
    if (imp) { importTask(Number(imp.getAttribute("data-import"))); return; }
    if (mv) {
      const row = Number(mv.getAttribute("data-row"));
      const other = mv.getAttribute("data-move") === "up" ? row - 1 : row + 1;
      if (other < 0 || other > 2) return;
      swapPlanRows(row + 1, other + 1);
      core().showToast(mv.getAttribute("data-move") === "up" ? "Moved up." : "Moved down.");
    } else if (pr) {
      swapPlanRows(0, Number(pr.getAttribute("data-promote")) + 1);
      core().showToast("That is now your main win.");
    } else if (resp) {
      const box = $("dcResponse");
      const chosen = L.DISTRACTION_RESPONSES[Number(resp.getAttribute("data-resp"))];
      if (tidy(box.value) !== "" && L.DISTRACTION_RESPONSES.indexOf(tidy(box.value)) === -1) { core().showToast("Your own wording is kept. Clear the box to use a suggestion."); return; }
      box.value = chosen;
      captureMorningDraft();
    } else if (ex) {
      const box = $("dcPlan");
      if (tidy(box.value) !== "") return; // never over what was typed
      box.value = L.IF_THEN_EXAMPLES[Number(ex.getAttribute("data-example"))];
      captureMorningDraft();
      renderExamples();
      box.focus();
    }
  }

  function startEditing(step) {
    editingMorning = true;
    reordering = false;
    planStep = step;
    renderMorning();
    showPlanStep(step, true);
  }

  function handleMorningSummaryClick(e) {
    const day = store.days[selectedDate()];
    if (!day || !day.morning) return;
    const edit = e.target.closest("[data-edit-step]");
    const move = e.target.closest("[data-sum-move]");
    const promote = e.target.closest("[data-sum-promote]");
    if (edit) { startEditing(Number(edit.getAttribute("data-edit-step"))); return; }
    if (move && !move.disabled) {
      const row = Number(move.getAttribute("data-row"));
      const dir = move.getAttribute("data-sum-move") === "up" ? -1 : 1;
      day.morning = L.moveTask(day.morning, row, dir);
      save();
      refreshPlanViews();
      const again = $("dcMorningSummary").querySelector('[data-sum-move="' + move.getAttribute("data-sum-move") + '"][data-row="' + (row + dir) + '"]:not([disabled])')
        || $("dcMorningSummary").querySelector('[data-sum-move][data-row="' + (row + dir) + '"]:not([disabled])');
      if (again) again.focus();
      return;
    }
    if (promote) {
      day.morning = L.promoteTask(day.morning, Number(promote.getAttribute("data-sum-promote")));
      save();
      refreshPlanViews();
      core().showToast("That is now your main win.");
      return;
    }
    const btn = e.target.closest(".dc-check");
    if (!btn || btn.disabled) return;
    const id = btn.getAttribute("data-check");
    const item = id === "key" ? day.morning.keyTask : day.morning.priorities[Number(id.slice(1))];
    if (!item) return;
    item.done = !item.done;
    save();
    refreshPlanViews();
    // keep the keyboard on the item that was just ticked
    const same = $("dcMorningSummary").querySelector('.dc-check[data-check="' + id + '"]');
    if (same && document.activeElement === document.body) same.focus();
  }

  // Everything that shows the plan, after it changed without leaving the page.
  function refreshPlanViews() {
    renderMorning();
    renderOverview();
    renderProgressCard();
    renderResult();
    renderPlanResults();
    renderNextUp();
  }

  /* ---------------- Today: evening review ---------------- */

  function segButtons(values, current, labelFor) {
    return values.map(function (v) {
      return '<button type="button" class="segmented-btn' + (current === v ? " active" : "") + '" data-value="' + v + '" aria-pressed="' + (current === v) + '">' + labelFor(v) + '</button>';
    }).join("");
  }

  function itemHtml(k) {
    return '<div class="dc-q"><span class="dc-q-label">' + esc(ITEM_QUESTIONS[k]) + '</span>' +
      '<div class="segmented-control dc-seg" data-item="' + k + '" role="group" aria-label="' + esc(L.ITEMS[k].label) + '">' +
      segButtons(["done", "not", "na"], draft.items[k], function (v) { return ANSWER_LABELS[v]; }) + '</div></div>';
  }

  function renderReviewControls() {
    $("dcFocus").innerHTML = segButtons([1, 2, 3, 4, 5], draft.focus, String);
    $("dcTime").innerHTML = segButtons([1, 2, 3, 4, 5], draft.time, String);
    $("dcPhoneNa").innerHTML = segButtons(["", "na"], draft.items.phone === "na" ? "na" : "", function (v) { return v ? "Not today" : "Count it"; });
    $("dcScreenHours").disabled = draft.items.phone === "na";
    const day = store.days[renderedDate || selectedDate()];
    $("dcPhoneTarget").textContent = "(your limit: " + (day && day.review ? day.review.phoneLimit : store.settings.phoneLimit) + " h)";
    $("dcItemsA").innerHTML = ["school", "gratiel"].map(itemHtml).join("");
    $("dcItemsB").innerHTML = ["bedOnTime", "phoneOut", "training"].map(itemHtml).join("");
    $("dcExtras").innerHTML = Object.keys(L.EXTRA_ITEMS).map(function (k) {
      return '<div class="dc-q"><span class="dc-q-label">' + esc(EXTRA_QUESTIONS[k]) + '</span>' +
        '<div class="segmented-control dc-seg" data-extra="' + k + '" role="group" aria-label="' + esc(L.EXTRA_ITEMS[k].label) + '">' +
        segButtons(["done", "not", "na"], draft.extras[k], function (v) { return ANSWER_LABELS[v]; }) + '</div></div>';
    }).join("");
    $("dcRulesQ").classList.toggle("hidden", !store.rules.length);
    $("dcRules").innerHTML = store.rules.map(function (r) {
      return '<div class="dc-q"><span class="dc-q-label">' + esc(r.text) + '</span>' +
        '<div class="segmented-control dc-seg" data-rule="' + esc(r.id) + '" role="group" aria-label="' + esc(r.text) + '">' +
        segButtons(["done", "not", "na"], draft.rules[r.id] || null, function (v) { return ANSWER_LABELS[v]; }) + '</div></div>';
    }).join("");
    renderPlanResults();
    renderRoutineReview();
    updateReviewProgress();
  }

  // What the plan says about the day under review: read from the plan, never asked twice.
  function renderPlanResults() {
    const day = store.days[renderedDate || selectedDate()];
    const m = day && day.morning;
    const box = $("dcPlanResults");
    if (!m || !L.hasPlanItems(m)) {
      box.innerHTML = '<span>No plan was saved for this day, so Following through has nothing to earn. You can still score the day.</span>';
      return;
    }
    const sup = m.priorities.filter(function (p) { return !!p.text; });
    const rows = [];
    if (m.keyTask.text) rows.push('<span><strong>Main win:</strong> ' + esc(m.keyTask.text) + ' · ' + (m.keyTask.done ? "done ✓" : "not done") + '</span>');
    if (sup.length) rows.push('<span><strong>Supporting priorities:</strong> ' + sup.filter(function (p) { return p.done; }).length + ' of ' + sup.length + ' done</span>');
    rows.push('<span class="field-hint">Tick things off in your plan above; this follows it.</span>');
    box.innerHTML = rows.join("");
  }

  // Which required answers are still missing, read from the form as it stands.
  function formMissing() {
    const raw = $("dcScreenHours").value;
    const n = raw === "" ? null : Number(raw);
    return L.unanswered({ focus: draft.focus, time: draft.time, screenHours: n !== null && isFinite(n) && n >= 0 && n <= 24 ? n : null, items: draft.items });
  }

  function updateReviewProgress() {
    const missing = formMissing();
    const total = 3 + Object.keys(L.ITEMS).length;
    const answered = total - missing.length;
    $("dcReviewFill").style.width = Math.round(100 * answered / total) + "%";
    $("dcReviewBar").setAttribute("aria-valuemax", String(total));
    $("dcReviewBar").setAttribute("aria-valuenow", String(answered));
    $("dcReviewCount").textContent = answered + " of " + total + " answered";
    const wrote = Object.keys(NOTE_INPUTS).some(function (id) { return tidy($(id).value) !== ""; });
    Array.prototype.forEach.call($("dcReviewTabs").querySelectorAll(".dc-rtab"), function (tab) {
      const n = Number(tab.getAttribute("data-rstep"));
      const done = n === 3 ? wrote : !missing.some(function (k) { return REVIEW_SECTION[k] === n; });
      tab.classList.toggle("done", done);
      tab.querySelector(".dc-rtab-n").textContent = done ? "✓" : String(n);
    });
  }

  // Which of the three review sections is showing (all three stay in the form, so nothing is lost moving between them).
  function showReviewStep(n, focus) {
    reviewStep = Math.max(1, Math.min(3, n));
    Array.prototype.forEach.call($("dcReviewForm").querySelectorAll(".dc-step"), function (sec) {
      sec.classList.toggle("hidden", Number(sec.getAttribute("data-rstep")) !== reviewStep);
    });
    Array.prototype.forEach.call($("dcReviewTabs").querySelectorAll(".dc-rtab"), function (tab) {
      const on = Number(tab.getAttribute("data-rstep")) === reviewStep;
      tab.classList.toggle("active", on);
      tab.setAttribute("aria-pressed", String(on));
    });
    $("dcReviewBack").classList.toggle("hidden", reviewStep === 1);
    $("dcReviewNext").classList.toggle("hidden", reviewStep === 3);
    $("dcReviewSaveBtn").classList.toggle("btn-primary", reviewStep === 3);
    $("dcReviewSaveBtn").classList.toggle("btn-secondary", reviewStep !== 3);
    if (focus) {
      const first = $("dcReviewForm").querySelector('.dc-step[data-rstep="' + reviewStep + '"] .segmented-btn, .dc-step[data-rstep="' + reviewStep + '"] input, .dc-step[data-rstep="' + reviewStep + '"] textarea');
      if (first) first.focus({ preventScroll: false });
    }
  }

  // A scored day shows its result and an Edit button; the form comes back when it is reopened.
  // The review opens by itself in the evening, for a past day, or once something is typed; before that it waits behind a
  // button so the morning screen isn't a wall of forms. A scored day shows its result and an Edit button instead.
  function reviewAutoOpen() {
    if (selected !== "today") return true;
    const d = store.drafts[selectedDate()];
    return nowMinutes() >= L.minutesOf(store.settings.times.review) || !!(d && d.review);
  }

  function renderReviewMode() {
    const day = store.days[selectedDate()];
    const scored = !!day && L.scoreDay(day).complete;
    const open = scored ? editingReview : (reviewOpened || reviewAutoOpen());
    $("dcReviewWrap").classList.toggle("hidden", !open);
    $("dcReviewCollapsed").classList.toggle("hidden", open || scored);
    $("dcReviewEditBtn").classList.toggle("hidden", open || !scored);
    $("dcReviewHint").classList.toggle("hidden", !open && !scored);
    $("dcReviewCollapsedText").textContent = "Best done in the evening, from " + timeLabel(store.settings.times.review) + ". Start it now if today is already done.";
  }

  function loadReviewForm() {
    const date = selectedDate();
    const day = store.days[date] || null;
    draft = newDraft(day);
    const r = day && day.review;
    $("dcScreenHours").value = r && r.screenHours !== null ? r.screenHours : "";
    Object.keys(NOTE_INPUTS).forEach(function (id) { $(id).value = r ? r[NOTE_INPUTS[id]] : ""; });
    const dr = store.drafts[date] && store.drafts[date].review;
    if (dr) {
      Object.keys(dr.items).forEach(function (k) { draft.items[k] = dr.items[k]; });
      draft.extras = Object.assign({}, dr.extras);
      draft.focus = dr.focus;
      draft.time = dr.time;
      draft.rules = Object.assign({}, dr.rules);
      $("dcScreenHours").value = dr.screenHours;
      Object.keys(NOTE_INPUTS).forEach(function (id) { $(id).value = dr.notes[NOTE_INPUTS[id]] || ""; });
    }
    $("dcDayType").value = day ? day.type : "normal";
    $("dcMissing").classList.add("hidden");
    renderedDate = date;
    renderReviewControls();
    renderDraftNotes();
    showReviewStep(reviewStep, false);
  }

  function handleReviewClick(e) {
    const btn = e.target.closest(".dc-seg .segmented-btn");
    if (!btn) return;
    const group = btn.closest(".dc-seg");
    const raw = btn.getAttribute("data-value");
    let current;
    if (group.hasAttribute("data-rating")) { draft[group.getAttribute("data-rating")] = Number(raw); current = Number(raw); }
    else if (group.hasAttribute("data-rule")) { draft.rules[group.getAttribute("data-rule")] = raw; current = raw; }
    else if (group.hasAttribute("data-extra")) { draft.extras[group.getAttribute("data-extra")] = raw; current = raw; }
    else if (group.getAttribute("data-item") === "phone") { draft.items.phone = raw === "na" ? "na" : null; current = raw; }
    else { draft.items[group.getAttribute("data-item")] = raw; current = raw; }
    $("dcMissing").classList.add("hidden");
    // Update the buttons in place (rebuilding them would drop keyboard focus).
    Array.prototype.forEach.call(group.querySelectorAll(".segmented-btn"), function (b) {
      const on = b.getAttribute("data-value") === String(current);
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    $("dcScreenHours").disabled = draft.items.phone === "na";
    updateReviewProgress();
    captureReviewDraft();
  }

  function handleDayTypeChange() {
    const day = ensureDay(selectedDate());
    L.excusedFor(day.type).forEach(function (k) { if (draft.items[k] === "na") draft.items[k] = null; });
    const type = $("dcDayType").value;
    day.type = L.DAY_TYPES[type] ? type : "normal";
    L.excusedFor(day.type).forEach(function (k) { if (draft.items[k] === null) draft.items[k] = "na"; });
    save();
    renderReviewControls();
    renderHeader();
    captureReviewDraft();
  }

  function handleReviewSubmit(e) {
    e.preventDefault();
    const date = renderedDate || selectedDate(); // the day the form is showing, even if midnight has just passed
    const day = ensureDay(date);
    const raw = {
      screenHours: draft.items.phone === "na" ? null : $("dcScreenHours").value,
      phoneLimit: day.review ? day.review.phoneLimit : store.settings.phoneLimit,
      items: draft.items, extras: draft.extras, focus: draft.focus, time: draft.time,
      habits: (function () { const r = routineOn(date); return r ? H.snapshot(r.routine) : null; })(),
      rules: store.rules.map(function (r) { return { id: r.id, text: r.text, state: draft.rules[r.id] || null }; }),
      blocker: day.review ? day.review.blocker : "",
      savedAt: Date.now() // each time the day is scored
    };
    Object.keys(NOTE_INPUTS).forEach(function (id) { raw[NOTE_INPUTS[id]] = $(id).value; });
    const candidate = L.sanitizeDay({ type: day.type, morning: day.morning, review: raw });
    const check = L.scoreDay(candidate);
    if (!check.complete) {
      const names = check.missing.map(function (k) { return MISSING_TEXT[k] || (L.ITEMS[k] ? L.ITEMS[k].label.toLowerCase() : k); });
      $("dcMissing").textContent = "Answer these first: " + names.join(", ") + ".";
      $("dcMissing").classList.remove("hidden");
      showReviewStep(Math.min.apply(null, check.missing.map(function (k) { return REVIEW_SECTION[k] || 1; })), false);
      return;
    }
    $("dcMissing").classList.add("hidden");
    candidate.review.rubric = L.RUBRIC_VERSION;
    candidate.review.scored = L.scoreSnapshot(check); // what it came to, kept with the review
    day.review = candidate.review;
    editingReview = false;
    reviewStep = 1;
    setDraft(date, "review", null);
    flushDrafts();
    save();
    renderAllToday();
    core().showToast("Scored: " + check.score + " / 100.");
    bringIntoView("dcResult");
  }

  function missedSomething(day, r) {
    return !!day.morning && r.detail.planned && (r.detail.prioritiesDone < r.detail.prioritiesTotal || (r.detail.keyTaskSet && !r.detail.keyTaskDone));
  }

  function fixHtml(day) {
    const picked = reasonOf(day.review.blocker);
    const have = store.rules.some(function (x) { return picked && x.text.toLowerCase() === picked.rule.toLowerCase(); });
    return '<div class="dc-fix"><h3 class="checklist-title">What got in the way?</h3>' +
      '<div class="dc-chips">' + L.REASONS.map(function (r) { return chipHtml("data-fix", r.key, r.label, picked && picked.key === r.key); }).join("") + '</div>' +
      (picked ? '<p class="dc-do"><strong>Try this:</strong> ' + esc(picked.rule) + '</p>' +
        '<div class="form-actions"><button type="button" class="btn btn-secondary" data-fix-add="' + picked.key + '"' + (have || store.rules.length >= L.MAX_RULES ? " disabled" : "") + '>' +
        (have ? "Already one of your rules" : store.rules.length >= L.MAX_RULES ? "You have 5 rules; remove one in Setup" : "Add it as one of my rules") + '</button></div>' : "") +
      '</div>';
  }

  function renderResult() {
    const date = selectedDate();
    const day = store.days[date];
    const box = $("dcResult");
    const r = day ? L.scoreDay(day) : null;
    box.classList.toggle("hidden", !r || !r.complete);
    if (!r || !r.complete) return;

    const lines = [];
    if (r.gap) lines.push("Biggest gap: " + esc(r.gap.label) + " (" + r.gap.earned + " of " + r.gap.possible + " points).");
    else lines.push("Every point available today was earned.");
    const m = day.morning;
    if (m && r.detail.planned) {
      lines.push((r.detail.keyTaskSet ? "Key task " + (r.detail.keyTaskDone ? "done" : "not done") + "; " : "") + r.detail.prioritiesDone + " of " + r.detail.prioritiesTotal + " other priorities done.");
    } else lines.push("No morning plan was saved, so there was nothing to follow through on.");
    if (day.review.items.phone !== "na") lines.push("Phone: " + day.review.screenHours + "h against your " + day.review.phoneLimit + "h limit.");
    if (r.strong.length) lines.push("Strongest: " + esc(r.strong.join(", ")) + ".");
    else {
      const best = r.categories.filter(function (c) { return c.possible; }).sort(function (a, b) { return b.earned / b.possible - a.earned / a.possible; })[0];
      if (best) lines.push("Strongest area: " + esc(best.label) + " (" + best.earned + " of " + best.possible + " points).");
    }
    if (r.gap && L.AREA_RULES[r.gap.key]) lines.push("Most useful improvement: " + esc(r.gap.label) + ". One rule to try: “" + esc(L.AREA_RULES[r.gap.key]) + "”");
    const saved = day.review.scored;
    const drifted = !!saved && saved.score !== r.score;
    if ((m && m.editedAt > day.review.savedAt) || drifted) lines.push("The plan was changed after this day was scored, so this score reflects the changed plan" + (drifted ? " (it was " + saved.score + " when you saved the review)" : "") + ". Score the day again to clear this note.");
    if (day.review.improve) lines.push("Your note for tomorrow: “" + esc(day.review.improve) + "”");

    const prev = L.lastScored(store.days, L.addDays(date, -1));
    const compare = prev ? (r.score - prev.score === 0 ? "Same as the last scored day" : (r.score > prev.score ? "Up " : "Down ") + Math.abs(r.score - prev.score) + " from the last scored day") + " (" + prev.score + " on " + prettyDate(prev.date) + ")." : "";
    const recent = L.trendSummary(store.days, L.addDays(date, -1), 7);
    const average = recent.enough ? "Your average over the last " + recent.scoredDays + " scored days is " + recent.average + "; this day is " + (r.score >= recent.average ? "+" : "−") + Math.abs(Math.round(r.score - recent.average)) + " from it." : "";
    const excused = r.excused.length ? "Not counted today: " + esc(r.excused.join(", ")) + ". Scored out of " + r.possible + " attainable points." : "";
    const when = new Date(day.review.savedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

    box.innerHTML =
      '<div class="dc-result-saved" role="status">Review saved · ' + esc(when) + '</div>' +
      '<div class="dc-score-row"><div class="dc-score-num">' + r.score + '<small>/100</small></div>' +
      '<div class="dc-score-side"><div class="dc-score-label">Discipline score</div>' +
      (compare ? '<div class="field-hint">' + compare + '</div>' : "") +
      (average ? '<div class="field-hint">' + average + '</div>' : "") +
      (excused ? '<div class="field-hint">' + excused + '</div>' : "") + '</div></div>' +
      '<p class="dc-breakdown">How it adds up: ' + r.earned + ' of ' + r.possible + ' attainable points, which is ' + r.score + ' out of 100.</p>' +
      '<div class="dc-cats">' + r.categories.map(function (c) {
        const pct = c.possible ? Math.round(100 * c.earned / c.possible) : 0;
        const note = c.key === "followThrough" && !(m && r.detail.planned) ? " · no plan saved" : "";
        return '<div class="dc-cat"><div class="dc-cat-head"><span>' + esc(c.label) + '</span><span>' + (c.possible ? c.earned + " / " + c.possible + note : "not counted") + '</span></div>' +
          '<div class="dc-track"><div class="dc-fill" style="width:' + pct + '%"></div></div></div>';
      }).join("") + '</div>' +
      '<ul class="dc-lines">' + lines.map(function (l) { return "<li>" + l + "</li>"; }).join("") + '</ul>' +
      (missedSomething(day, r) ? fixHtml(day) : "") +
      '<p class="field-hint">Built from your answers only. This is not AI, and it is feedback, not a grade on you.</p>';
  }

  function handleResultClick(e) {
    const day = store.days[selectedDate()];
    if (!day || !day.review) return;
    const fix = e.target.closest("[data-fix]");
    const add = e.target.closest("[data-fix-add]");
    if (fix) {
      const key = fix.getAttribute("data-fix");
      day.review.blocker = day.review.blocker === key ? "" : key;
      save();
      renderResult();
    } else if (add && !add.disabled) {
      const reason = reasonOf(add.getAttribute("data-fix-add"));
      if (reason && addRule(reason.rule)) core().showToast("Added to your rules.");
    }
  }

  function renderReviewHint() {
    const day = store.days[selectedDate()];
    const scored = !!day && L.scoreDay(day).complete;
    let msg;
    if (scored && editingReview) msg = "Editing a saved review. Change any answer, then score the day again.";
    else if (scored) msg = "Scored. You can edit this review any time.";
    else if (selected === "today" && new Date().getHours() < 17) msg = "Best filled in this evening, but you can score the day any time. “Not today” leaves an item out.";
    else msg = "Three short sections. “Not today” leaves an item out of the score.";
    $("dcReviewHint").textContent = msg;
  }

  // Refreshes everything on Today except the review form itself, so typed answers are never wiped.
  /* ---------------- Today: overview and progress ---------------- */

  function chip(text, kind) { return '<span class="dc-ov-chip' + (kind ? " " + kind : "") + '">' + esc(text) + '</span>'; }

  function programToday() {
    if (!P) return null;
    const pd = P.programDay(store.program.start, todayISO());
    if (pd.status !== "active") return null;
    return { day: pd.day, progress: P.dayProgress(pd.day, programContext(pd.day)) };
  }

  function reviewStatus(date) {
    const day = store.days[date];
    const r = day ? L.scoreDay(day) : null;
    if (r && r.complete) return { state: "scored", text: "Scored " + r.score + " / 100" };
    const d = store.drafts[date] && store.drafts[date].review;
    if (d) return { state: "partial", text: "In progress, not scored yet" };
    return { state: "missing", text: "Not scored yet" };
  }

  function renderOverview() {
    const date = selectedDate();
    const day = store.days[date];
    const m = day && day.morning;
    const items = [];
    if (m) { if (m.keyTask.text) items.push(m.keyTask); m.priorities.forEach(function (p) { if (p.text) items.push(p); }); }
    const done = items.filter(function (i) { return i.done; }).length;
    $("dcOverviewKicker").textContent = (selected === "today" ? "Today's" : selected === "yesterday" ? "Yesterday's" : "Tomorrow's") + " main win";
    const title = $("dcOverviewTitle");
    if (m && m.keyTask.text) { title.textContent = m.keyTask.text; title.classList.remove("empty"); }
    else if (items.length) { title.textContent = "No main win chosen yet. First on the list: " + items[0].text; title.classList.add("empty"); }
    else { title.textContent = "Not planned yet"; title.classList.add("empty"); }
    $("dcOverviewCount").textContent = done + " of " + items.length + " done";
    $("dcOverviewBar").parentNode.classList.toggle("hidden", !items.length);
    $("dcOverviewFill").style.width = items.length ? Math.round(100 * done / items.length) + "%" : "0%";
    $("dcOverviewBar").setAttribute("aria-valuemax", String(Math.max(1, items.length)));
    $("dcOverviewBar").setAttribute("aria-valuenow", String(done));
    const chips = [m ? chip("Plan saved", "ok") : chip("No plan yet", "todo")];
    if (selected !== "tomorrow") { const rs = reviewStatus(date); chips.push(chip(rs.state === "scored" ? rs.text : "Review: " + rs.text.toLowerCase(), rs.state === "scored" ? "ok" : "")); }
    if (selected !== "tomorrow") {
      const rr = routineOn(date);
      if (rr && rr.routine.total) chips.push(chip("Routine " + (rr.routine.done + rr.routine.met) + "/" + rr.routine.total, rr.routine.open === 0 ? "ok" : ""));
    }
    const prog = selected === "today" ? programToday() : null;
    if (prog) {
      chips.push(chip("Program day " + prog.day + " of 30"));
      chips.push(chip("Missions " + prog.progress.done + "/" + prog.progress.total, prog.progress.done === prog.progress.total ? "ok" : ""));
    }
    $("dcOverviewChips").innerHTML = chips.join("");
  }

  function progressRow(label, value, pct) {
    return '<div class="dc-progress-row"><div class="dc-cat-head"><span>' + esc(label) + '</span><span>' + esc(value) + '</span></div>' +
      (pct === null ? "" : '<div class="dc-track"><div class="dc-fill" style="width:' + pct + '%"></div></div>') + '</div>';
  }

  function renderProgressCard() {
    const card = $("dcProgressCard");
    if (selected !== "today") { card.classList.add("hidden"); return; }
    card.classList.remove("hidden");
    const prog = programToday();
    const rs = reviewStatus(todayISO());
    const rows = [];
    if (prog) {
      rows.push(progressRow("Today's missions", prog.progress.done + " of " + prog.progress.total, prog.progress.total ? Math.round(100 * prog.progress.done / prog.progress.total) : 0));
      rows.push(progressRow("30-day program", "Day " + prog.day + " of 30", Math.round(100 * prog.day / 30)));
    }
    const rr = routineOn(todayISO());
    if (rr && rr.routine.total) rows.push(progressRow("Routine (from Habits)", (rr.routine.done + rr.routine.met) + " of " + rr.routine.total + " kept", Math.round(100 * (rr.routine.done + rr.routine.met) / rr.routine.total)));
    rows.push(progressRow("Daily review", rs.text, null));
    $("dcProgressBody").innerHTML = rows.join("");
  }

  function renderAllToday() {
    renderHeader();
    renderOverview();
    renderNextUp();
    renderRoutineCard();
    renderHabitsStrip();
    renderFlow();
    renderLessonCard();
    renderMorning();
    $("dcReviewCard").classList.toggle("hidden", selected === "tomorrow");
    renderReviewMode();
    renderReviewHint();
    renderPlanResults();
    renderResult();
    renderProgressCard();
  }

  /* ---------------- rules ---------------- */

  // Returns false (with a message) when the rule can't be added.
  function addRule(text) {
    const t = tidy(text).slice(0, L.RULE_MAX);
    if (!t) { core().showToast("Type the rule first."); return false; }
    if (store.rules.some(function (r) { return r.text.toLowerCase() === t.toLowerCase(); })) { core().showToast("You already have that rule."); return false; }
    if (store.rules.length >= L.MAX_RULES) { core().showToast("You have " + L.MAX_RULES + " rules. Remove one in Setup first."); return false; }
    store.rules = L.sanitizeRules(store.rules.concat([{ id: "r" + Date.now().toString(36), text: t }]));
    save();
    renderReviewControls();
    renderResult();
    renderSetup();
    renderTrends();
    return true;
  }

  function renderRulesManager() {
    $("dcRulesManager").innerHTML = store.rules.length
      ? '<div class="dc-rule-list">' + store.rules.map(function (r) {
        return '<div class="dc-rule-row"><span>' + esc(r.text) + '</span><button type="button" class="btn-icon danger" data-rule-del="' + esc(r.id) + '" aria-label="Remove rule: ' + esc(r.text) + '">Remove</button></div>';
      }).join("") + '</div><p class="field-hint">' + store.rules.length + ' of ' + L.MAX_RULES + ' rules.</p>'
      : '<div class="empty-state">No rules yet. Add one below, or pick one from the Weekly review in Trends.</div>';
  }

  function handleRulesManagerClick(e) {
    const del = e.target.closest("[data-rule-del]");
    if (!del) return;
    const id = del.getAttribute("data-rule-del");
    store.rules = store.rules.filter(function (r) { return r.id !== id; });
    delete draft.rules[id];
    save();
    renderReviewControls();
    captureReviewDraft();
    renderSetup();
    renderResult();
    core().showToast("Rule removed. Past answers stay in your history.");
  }

  /* ---------------- Trends ---------------- */

  function listRows(rows) {
    return '<div class="dc-cats">' + rows.map(function (r) {
      return '<div class="dc-cat"><div class="dc-cat-head"><span>' + esc(r.label) + '</span><span>' + esc(r.value) + '</span></div>' +
        (r.pct === undefined || r.pct === null ? "" : '<div class="dc-track"><div class="dc-fill" style="width:' + r.pct + '%"></div></div>') + '</div>';
    }).join("") + '</div>';
  }

  function plural(n, one, many) { return n + " " + (n === 1 ? one : many || one + "s"); }
  function change(d, unit) { return d === 0 ? "no change" : (d > 0 ? "up " : "down ") + Math.abs(d) + (unit || ""); }

  function trendStatsHtml(ov) {
    const cur = ov.cur, w = trendWindow;
    const box = function (value, label, sub) {
      return '<div class="stat-box"><span class="stat-value">' + esc(value) + '</span><span class="stat-label">' + esc(label) + '</span>' + (sub ? '<span class="stat-sub">' + esc(sub) + '</span>' : "") + '</div>';
    };
    const averageSub = ov.delta !== null
      ? (ov.delta === 0 ? "same as the " + w + " days before" : change(ov.delta) + " from the " + w + " days before")
      : cur.enough ? "" : "needs " + IN.MIN_SCORED + " scored days";
    return box(cur.enough ? cur.average : "—", "Average score", averageSub) +
      box(cur.best ? cur.best.score : "—", "Best day", cur.best ? prettyDate(cur.best.date) : "") +
      box(cur.worst ? cur.worst.score : "—", "Lowest day", cur.worst ? prettyDate(cur.worst.date) : "") +
      box(ov.streak, "Day streak", "scored days in a row") +
      box(cur.reviewed.of ? cur.reviewed.done + " of " + cur.reviewed.of : "—", "Days reviewed", "today counts once scored") +
      box(cur.plans.of ? cur.plans.done + " of " + cur.plans.of : "—", "Days planned", "with a saved plan") +
      box(cur.keyTask.of ? cur.keyTask.done + " of " + cur.keyTask.of : "—", "Main win finished", cur.keyTask.of ? cur.keyTask.rate + "% of days with one" : "no main win set") +
      box(cur.phone.days ? cur.phone.averageHours + "h" : "—", "Screen time a day", cur.phone.days ? "over your limit on " + cur.phone.overLimit + " of " + cur.phone.days : "none logged");
  }

  function renderTrendNotes(cur) {
    const notes = [];
    if (!cur.enough) notes.push("Needs " + IN.MIN_SCORED + " scored days for averages. You have " + cur.scoredDays + " in this window.");
    notes.push("Only days you scored are averaged. A day with no review is never counted as zero.");
    if (cur.excusedDays) notes.push(plural(cur.excusedDays, "scored day") + " had items marked “not today”, which are left out of those days' scores.");
    $("dcTrendNote").textContent = notes.join("\n");
  }

  function renderCategories(ov) {
    const cur = ov.cur, prev = ov.prev;
    if (!cur.categories) {
      $("dcCategories").innerHTML = '<div class="empty-state">Needs ' + IN.MIN_SCORED + ' scored days in this window.</div>';
      $("dcCategoriesNote").textContent = "";
      return;
    }
    $("dcCategories").innerHTML = '<div class="dc-cats">' + cur.categories.map(function (c) {
      const before = prev.categories ? prev.categories.filter(function (x) { return x.key === c.key; })[0] : null;
      const d = before && before.pct !== null && c.pct !== null ? c.pct - before.pct : null;
      const weak = !!cur.weakest && cur.weakest.key === c.key;
      return '<div class="dc-cat' + (weak ? " weak" : "") + '"><div class="dc-cat-head"><span>' + esc(c.label) + (weak ? ' <small class="dc-weak-tag">weakest</small>' : "") + '</span>' +
        '<span>' + (c.pct === null ? "—" : c.pct + "%") + (d !== null ? ' <small class="dc-delta ' + (d > 0 ? "up" : d < 0 ? "down" : "") + '">' + (d === 0 ? "no change" : (d > 0 ? "▲ up " : "▼ down ") + Math.abs(d) + (Math.abs(d) === 1 ? " pt" : " pts")) + '</small>' : "") + '</span></div>' +
        '<div class="dc-track"><div class="dc-fill" style="width:' + (c.pct || 0) + '%"></div></div></div>';
    }).join("") + '</div>';
    const notes = ["Each bar is the share of attainable points earned, averaged over your scored days." + (prev.categories ? " The change is against the " + trendWindow + " days before." : "")];
    if (cur.noPlanDays) notes.push(plural(cur.noPlanDays, "scored day") + " had no plan saved. Those count as 0 for Following through.");
    $("dcCategoriesNote").textContent = notes.join(" ");
  }

  function renderCompare() {
    const c = IN.weekCompare(store.days, todayISO());
    $("dcCompare").innerHTML = '<table class="dc-compare"><thead><tr><th scope="col"><span class="visually-hidden">Measure</span></th><th scope="col">Last 7 days</th><th scope="col">The 7 before</th><th scope="col">Change</th></tr></thead><tbody>' +
      c.rows.map(function (r) {
        return '<tr><th scope="row">' + esc(r.label) + '</th><td>' + esc(r.cur) + '</td><td>' + esc(r.prev) + '</td><td>' + (r.change ? esc(r.change) : "") + '</td></tr>';
      }).join("") + '</tbody></table>' +
      '<p class="field-hint">' + (c.comparable ? "A change is shown when both weeks have at least " + IN.MIN_SCORED + " scored days." : "A change needs at least " + IN.MIN_SCORED + " scored days in both weeks, so none is shown yet.") + ' A dash means there was nothing to count.</p>';
  }

  function renderConsistency(ov) {
    const cur = ov.cur, prev = ov.prev;
    let html = '<h3 class="checklist-title">Habits</h3>';
    html += cur.habits.days
      ? '<p class="dc-line">You finished all your Habits on <strong>' + cur.habits.allDone + ' of ' + cur.habits.days + '</strong> days you scored, and on average <strong>' + cur.habits.avgPct + '%</strong> of them.</p>' +
        listRows([{ label: "Habits done, on average", value: cur.habits.avgPct + "%", pct: cur.habits.avgPct }]) +
        '<p class="field-hint">Counted from what Habits showed when you saved each review. Habits itself is never changed from here.</p>'
      : '<div class="empty-state">No Habits were counted when you scored these days. Add habits in Habits and they show up here after your next review.</div>';

    html += '<h3 class="checklist-title">Your routine and distractions</h3>';
    const rows = [];
    if (cur.routine.answered) rows.push({ label: "Followed your planned routine", value: cur.routine.yes + " of " + cur.routine.answered + " (" + cur.routine.rate + "%)", pct: cur.routine.rate });
    if (cur.managed.answered) rows.push({ label: "Managed your distractions", value: cur.managed.yes + " of " + cur.managed.answered + " (" + cur.managed.rate + "%)", pct: cur.managed.rate });
    html += rows.length ? listRows(rows) + '<p class="field-hint">Yes answers out of the days you answered. These two questions are recorded but are not part of your score.</p>'
      : '<div class="empty-state">Not answered yet. They are the last two questions in the evening review.</div>';

    html += '<h3 class="checklist-title">Your rules</h3>';
    const rs = cur.rules;
    html += rs.answered
      ? '<p class="dc-line">You kept your rules <strong>' + rs.rate + '%</strong> of the time (' + rs.kept + ' of ' + rs.answered + ' answers)' + (prev.rules.answered ? '. The ' + trendWindow + ' days before: ' + prev.rules.rate + '%' : "") + '.</p>' +
        listRows(rs.byRule.map(function (r) { return { label: r.text, value: r.kept + " of " + r.answered, pct: Math.round(100 * r.kept / r.answered) }; }))
      : '<div class="empty-state">' + (store.rules.length ? "Answer your rules in tonight’s review and they show up here." : "Add a rule in Setup, then answer it each evening.") + '</div>';
    $("dcConsistency").innerHTML = html;
  }

  function renderInsights() {
    const r = IN.insights(store.days, store.avoid, store.rules, todayISO());
    $("dcInsights").innerHTML = r.items.length
      ? '<ul class="dc-insight-list">' + r.items.map(function (i) { return '<li><div>' + esc(i.text) + '</div><div class="field-hint">' + esc(i.basis) + '</div></li>'; }).join("") + '</ul>' +
        '<p class="field-hint">Patterns in your own entries over the last ' + IN.INSIGHT_DAYS + ' days, whichever window is showing above. They show what went together, not what caused what. Plain rules over your numbers, not AI.</p>'
      : '<div class="empty-state">' + esc(r.needs) + '</div>';
  }

  function renderAvoidCard() {
    const today = todayISO();
    const av = L.avoidSummary(store.avoid, today, trendWindow);
    const bl = L.blockerSummary(store.days, today, trendWindow);
    let avoidHtml = "";
    if (av.total) {
      avoidHtml += '<p class="dc-line">You tapped “I\'m avoiding it” <strong>' + av.total + '</strong> time' + (av.total === 1 ? "" : "s") + '.' +
        (av.startRate !== null ? ' You started anyway <strong>' + av.started + ' of ' + (av.started + av.dropped) + '</strong> times (' + av.startRate + '%).' : "") + '</p>' +
        listRows(av.reasons.map(function (r) { return { label: r.label, value: r.count + "×" }; }));
    }
    if (bl.length) {
      avoidHtml += '<h3 class="checklist-title">What got in the way on days a priority was missed</h3>' + listRows(bl.map(function (r) { return { label: r.label, value: r.count + (r.count === 1 ? " day" : " days") }; }));
    }
    $("dcAvoidStats").innerHTML = avoidHtml || '<div class="empty-state">Nothing yet. When you tap “I\'m avoiding it” or say what got in the way, the reasons show up here.</div>';
  }

  /* ---------------- the weekly review ---------------- */

  const SHARE_HINT = "Numbers only, unless you tick “in my own words”. Task names, reflections and notes are never included. Edit it however you like first.";
  const SHARE_HINT_EDITED = "You've edited the text, so the options above won't change it. Tap “Rebuild from my choices” to apply them (that replaces your edits).";
  let shareOptions = null; // { scores, phone, habits, rules, avoid, wording }: what to include in the shared text
  function shareChoices() {
    if (!shareOptions) {
      shareOptions = {};
      IN.SHARE_SECTIONS.forEach(function (s) { shareOptions[s.key] = s.on; });
    }
    return shareOptions;
  }
  function weeklyReport() { return IN.weeklyReport({ days: store.days, avoid: store.avoid, rules: store.rules, today: todayISO() }); }
  function bullets(list, empty) {
    return list.length ? '<ul class="dc-lines">' + list.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + "</ul>" : '<p class="field-hint">' + esc(empty) + "</p>";
  }

  function renderWeekly() {
    const rep = weeklyReport();
    const cur = rep.cur;
    const head = !cur.scoredDays
      ? "No scored days in the last 7 days yet."
      : "You scored " + cur.scoredDays + " of the last 7 days" + (cur.enough ? ", averaging " + cur.average : "") +
        (rep.comparable ? (rep.delta === 0 ? ", the same as the week before (" + rep.prev.average + ")." : ", " + change(rep.delta) + " from the week before (" + rep.prev.average + ").") : ".");
    $("dcWeeklyReport").innerHTML = '<p class="dc-line">' + esc(head) + '</p>' +
      '<h3 class="checklist-title">What went well</h3>' + bullets(rep.went, "Nothing stands out yet. It fills in as you score more days.") +
      '<h3 class="checklist-title">To improve</h3>' + bullets(rep.improve, cur.enough ? "Nothing needs fixing this week." : "Needs " + IN.MIN_SCORED + " scored days in the last 7.") +
      (rep.tracking.length ? '<h3 class="checklist-title">Rules you are tracking</h3>' + bullets(rep.tracking.map(function (t) {
        return t.answered ? t.text + ": kept " + t.kept + " of " + t.answered + " this week." : t.text + ": no answers yet this week.";
      }), "") : "");

    const full = store.rules.length >= L.MAX_RULES;
    $("dcWeeklySuggestions").innerHTML = rep.recommendations.length ? rep.recommendations.map(function (s, i) {
      return '<div class="dc-sugg"><div><strong>' + esc(s.text) + '</strong><div class="field-hint">' + esc(s.why) + '</div></div>' +
        '<button type="button" class="btn btn-secondary" data-sugg="' + i + '"' + (full ? " disabled" : "") + '>Track as a rule</button></div>';
    }).join("") + '<p class="field-hint">' + (full ? "You have " + L.MAX_RULES + " rules. Remove one in Setup to add another. " : "") + 'A rule you track shows up in your evening review, and its results show up here and in Trends. Nothing is added unless you tap.</p>'
      : '<div class="empty-state">Nothing new to suggest right now.</div>';
    $("dcWeeklySuggestions").setAttribute("data-texts", JSON.stringify(rep.recommendations.map(function (s) { return s.text; })));

    const opts = shareChoices();
    const box = $("dcShareOptions");
    box.innerHTML = '<legend class="field-hint">Include</legend>' + IN.SHARE_SECTIONS.map(function (s) {
      return '<label class="dc-opt"><input type="checkbox" data-share="' + s.key + '"' + (opts[s.key] ? " checked" : "") + '><span>' + esc(s.label) + '</span></label>';
    }).join("");
    if (weeklyEdited && weeklyDate !== todayISO()) weeklyEdited = false; // an edit from an earlier day is about an earlier week
    if (!weeklyEdited) $("dcWeeklyText").value = IN.shareText(rep, opts);
    $("dcRebuildBtn").classList.toggle("hidden", !weeklyEdited);
    $("dcShareHint").textContent = weeklyEdited ? SHARE_HINT_EDITED : SHARE_HINT;
  }

  function handleShareOption(e) {
    const box = e.target.closest("[data-share]");
    if (!box) return;
    shareChoices()[box.getAttribute("data-share")] = box.checked;
    renderWeekly();
  }

  function handleRebuild() {
    weeklyEdited = false;
    renderWeekly();
    core().showToast("Rebuilt from your choices.");
  }

  function renderTrends() {
    if (!IN || !CH) { $("dcStats").innerHTML = '<div class="empty-state">Trends aren\'t available right now.</div>'; return; }
    const today = todayISO();
    const ov = IN.overview(store.days, today, trendWindow);
    $("dcWindow7").classList.toggle("active", trendWindow === 7);
    $("dcWindow30").classList.toggle("active", trendWindow === 30);
    $("dcStats").innerHTML = trendStatsHtml(ov);
    renderTrendNotes(ov.cur);

    const series = IN.series(store.days, today, trendWindow);
    $("dcChart").innerHTML = CH.lineChart(series, today);
    $("dcChartList").innerHTML = CH.chartList(series);
    renderCategories(ov);
    $("dcHeatmap").innerHTML = CH.heatmap(IN.calendar(store.days, today, trendWindow), today);
    renderCompare();
    renderConsistency(ov);
    renderInsights();
    renderAvoidCard();
    renderWeekly();

    const dates = Object.keys(store.days).filter(function (d) { return store.days[d].morning || store.days[d].review; }).sort().reverse().slice(0, 14);
    $("dcRecent").innerHTML = dates.length ? dates.map(function (date) {
      const day = store.days[date];
      const r = L.scoreDay(day);
      const status = r.complete ? '<span class="dc-recent-score">' + r.score + '</span>' : '<span class="field-hint">' + (day.morning ? "Plan only, no score" : "No score") + '</span>';
      return '<div class="dc-recent-row"><div><strong>' + esc(prettyDate(date)) + '</strong> <span class="field-hint">' + esc(L.DAY_TYPES[day.type].label) + '</span>' +
        (day.review && day.review.improve ? '<div class="field-hint">Note for next day: ' + esc(day.review.improve) + '</div>' : "") + '</div>' + status + '</div>';
    }).join("") : '<div class="empty-state">Nothing logged yet. Lock in a morning plan on the Today tab to begin.</div>';
  }

  function handleWeeklyClick(e) {
    const add = e.target.closest("[data-sugg]");
    if (!add || add.disabled) return;
    let texts = [];
    try { texts = JSON.parse($("dcWeeklySuggestions").getAttribute("data-texts") || "[]"); } catch (err) { texts = []; }
    const text = texts[Number(add.getAttribute("data-sugg"))];
    if (text && addRule(text)) core().showToast("Now tracked. You'll answer it each evening.");
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      const ta = $("dcWeeklyText");
      ta.select();
      try { document.execCommand("copy") ? resolve() : reject(new Error("copy failed")); } catch (err) { reject(err); }
    });
  }

  function handleShare() {
    const text = $("dcWeeklyText").value.trim();
    if (!text) { core().showToast("There is nothing to share yet."); return; }
    if (navigator.share) {
      navigator.share({ text: text }).catch(function () { /* closed without sharing: nothing to do */ });
      return;
    }
    copyText(text).then(function () { core().showToast("Copied. Paste it into a message."); }, function () { core().showToast("Couldn't copy. Select the text and copy it by hand."); });
  }

  function handleCopy() {
    const text = $("dcWeeklyText").value.trim();
    if (!text) { core().showToast("There is nothing to copy yet."); return; }
    copyText(text).then(function () { core().showToast("Copied."); }, function () { core().showToast("Couldn't copy. Select the text and copy it by hand."); });
  }

  /* ---------------- Setup ---------------- */

  function renderSetup() {
    $("dcPhoneLimit").value = store.settings.phoneLimit;
    const times = store.settings.times;
    $("dcTimePlan").value = times.planBy;
    $("dcTimeSchool").value = times.afterSchool;
    $("dcTimeReview").value = times.review;
    $("dcNudges").innerHTML = NUDGES.map(function (n) {
      return '<div class="dc-nudge-row"><div><strong>' + esc(n.title) + '</strong><div class="field-hint">' + (n.type === "weekly" ? "Weekdays" : "Every day") + " at " + esc(times[n.timeKey]) + '</div></div>' +
        '<button type="button" class="btn btn-secondary" data-nudge="' + n.key + '">Add reminder</button></div>';
    }).join("");
    renderRulesManager();
    $("dcRubric").innerHTML = '<ul class="dc-lines">' + L.CATEGORIES.map(function (c) {
      return "<li><strong>" + esc(c.label) + " — " + c.max + "</strong><br><span class=\"field-hint\">" + esc(RUBRIC_DETAIL[c.key]) + "</span></li>";
    }).join("") + "</ul>";
  }

  function handleSetupSubmit(e) {
    e.preventDefault();
    const n = Number($("dcPhoneLimit").value);
    if (!(isFinite(n) && n >= 0.5 && n <= 24)) { core().showToast("Enter a limit between 0.5 and 24 hours."); return; }
    store.settings.phoneLimit = Math.round(n * 10) / 10;
    save();
    renderHeader();
    core().showToast("Phone limit saved: " + store.settings.phoneLimit + "h.");
  }

  function handleTimesSubmit(e) {
    e.preventDefault();
    const entered = { planBy: $("dcTimePlan").value, afterSchool: $("dcTimeSchool").value, review: $("dcTimeReview").value };
    if (!entered.planBy || !entered.afterSchool || !entered.review) { core().showToast("Set all three times."); return; }
    store.settings.times = L.sanitizeTimes(entered);
    save();
    renderSetup();
    renderNextUp();
    core().showToast("Times saved.");
  }

  function handleRuleSubmit(e) {
    e.preventDefault();
    if (addRule($("dcRuleInput").value)) $("dcRuleInput").value = "";
  }

  function handleNudgeClick(e) {
    const btn = e.target.closest("[data-nudge]");
    if (!btn) return;
    const n = NUDGES.filter(function (x) { return x.key === btn.getAttribute("data-nudge"); })[0];
    const reminders = window.JarvisReminders;
    if (!n || !reminders || typeof reminders.openNew !== "function") { core().showToast("Reminders aren't available right now."); return; }
    reminders.openNew({ title: n.title, times: [store.settings.times[n.timeKey]], type: n.type, days: n.days || null });
  }

  /* ---------------- the 30-day program ---------------- */

  let progOpen = {};      // days opened in the list ({ "3": true }), kept when the page redraws
  let progConfirm = null; // "restart" while the restart question shows; { remove: day } while a reflection's removal does

  function programContext(dayNumber) {
    return { date: P.dateOfDay(store.program.start, dayNumber), days: store.days, rules: store.rules, avoid: store.avoid, manualDone: store.program.done[String(dayNumber)] || [] };
  }
  function savedReflection(n) { return store.program.reflections[String(n)] || ""; }
  function reflectDraft(n) {
    const d = store.drafts[P.dateOfDay(store.program.start, n)];
    return d && typeof d.reflect === "string" ? d.reflect : null;
  }
  function daysWord(n) { return n + (n === 1 ? " day" : " days"); }

  // "Unlocks Fri, Oct 30 (tomorrow)" for a lesson that has not opened yet.
  function unlockText(n) {
    const u = P.unlock(store.program.start, n, todayISO());
    return "Unlocks " + prettyDate(u.date) + (u.inDays === 1 ? " (tomorrow)" : u.inDays > 1 && u.inDays <= 6 ? " (in " + daysWord(u.inDays) + ")" : "");
  }

  function reflectionHtml(n, entry) {
    const saved = savedReflection(n);
    const draft = reflectDraft(n);
    const value = draft !== null ? draft : saved;
    const id = "dcReflect" + n;
    const removing = !!progConfirm && progConfirm.remove === n;
    return '<section class="dc-lesson-sec dc-reflect" data-reflect-day="' + n + '">' +
      '<h3 class="dc-lesson-h">Reflection <small>optional · private</small></h3>' +
      '<p class="dc-lesson-p" id="' + id + 'Q">' + esc(entry.reflect) + '</p>' +
      '<textarea id="' + id + '" class="dc-reflect-input" rows="3" maxlength="' + L.REFLECT_MAX + '" data-day="' + n + '" aria-labelledby="' + id + 'Q" aria-describedby="' + id + 'S" placeholder="A sentence or two is plenty.">' + esc(value) + '</textarea>' +
      '<div class="dc-reflect-foot"><span class="field-hint" id="' + id + 'S" aria-live="polite"></span><span class="field-hint" id="' + id + 'C"></span></div>' +
      (removing
        ? '<div class="dc-reflect-confirm" role="group" aria-label="Remove this reflection"><p class="dc-line"><strong>Remove this reflection?</strong> The text is deleted from this device. This can\'t be undone.</p>' +
          '<div class="form-actions"><button type="button" class="btn btn-danger" data-reflect-remove-yes="' + n + '">Yes, remove it</button><button type="button" class="btn btn-secondary" data-reflect-remove-no="' + n + '">Keep it</button></div></div>'
        : '<div class="form-actions"><button type="button" class="btn btn-secondary" data-reflect-save="' + n + '">Save reflection</button>' +
          '<button type="button" class="btn-icon danger' + (saved ? "" : " hidden") + '" data-reflect-remove="' + n + '">Remove</button></div>') +
      '</section>';
  }

  // The lesson in its five parts. mode "field" adds a box for the reflection; otherwise the question is just shown.
  function lessonHtml(entry, mode) {
    return P.SECTIONS.map(function (sec) {
      if (sec.key === "reflect" && mode === "field") return reflectionHtml(entry.day, entry);
      return '<section class="dc-lesson-sec' + (sec.key === "apply" ? " dc-do" : "") + '"><h3 class="dc-lesson-h">' + esc(sec.label) + (sec.key === "reflect" ? ' <small>optional</small>' : "") + '</h3>' +
        '<p class="dc-lesson-p">' + esc(entry[sec.key]) + '</p>' + (sec.key === "reflect" ? '<p class="field-hint">Answer it in the Program tab. Your answer stays private.</p>' : "") + '</section>';
    }).join("");
  }

  // Updates a reflection's status line, counter and buttons from what is in its box (no redraw, so typing is never interrupted).
  function syncReflection(n) {
    const box = $("dcReflect" + n);
    if (!box) return;
    const text = tidy(box.value).slice(0, L.REFLECT_MAX);
    const saved = savedReflection(n);
    $("dcReflect" + n + "S").textContent = text && text === saved ? "Saved" : text ? "Not saved yet" : saved ? "Your saved reflection is kept. Tap Remove to delete it." : "";
    $("dcReflect" + n + "C").textContent = text.length + "/" + L.REFLECT_MAX;
    const save = document.querySelector('[data-reflect-save="' + n + '"]');
    if (save) save.disabled = !text || text === saved;
    const rm = document.querySelector('[data-reflect-remove="' + n + '"]');
    if (rm) rm.classList.toggle("hidden", !saved);
  }

  function missionRows(progress, n) {
    return '<div class="dc-checklist">' + progress.items.map(function (m, i) {
      const how = "dcHow" + n + "x" + i;
      const body = '<span class="dc-box" aria-hidden="true">' + (m.done ? "✓" : "") + '</span><span class="dc-check-body"><span class="dc-check-text">' + esc(m.text) + '</span><span class="dc-kind">' + (m.auto ? "Auto-checked" : "You tick it") + '</span></span>';
      const control = m.auto
        ? '<div class="dc-check auto' + (m.done ? " done" : "") + '" role="checkbox" aria-checked="' + m.done + '" aria-disabled="true" aria-describedby="' + how + '">' + body + '</div>'
        : '<button type="button" class="dc-check' + (m.done ? " done" : "") + '" role="checkbox" aria-checked="' + m.done + '" data-mission="' + i + '" data-day="' + n + '" aria-describedby="' + how + '">' + body + '</button>';
      return '<div class="dc-mission">' + control + '<p class="dc-how" id="' + how + '">' + esc(m.how) + '</p>' + (m.needs ? '<p class="dc-needs">' + esc(m.needs) + '</p>' : "") + '</div>';
    }).join("") + '</div>';
  }

  function renderLessonCard() {
    const card = $("dcLessonCard");
    if (!P) { card.classList.add("hidden"); return; }
    const pd = P.programDay(store.program.start, todayISO());
    if (selected !== "today" || pd.status !== "active") { card.classList.add("hidden"); return; }
    const entry = P.DAYS[pd.day - 1];
    const progress = P.dayProgress(pd.day, programContext(pd.day));
    card.classList.remove("hidden");
    $("dcLessonKicker").textContent = "Day " + pd.day + " of 30 · Today's principle";
    $("dcLessonTitle").textContent = entry.title;
    $("dcLessonBody").innerHTML = lessonOpen ? lessonHtml(entry, "read") : "";
    $("dcLessonBody").classList.toggle("hidden", !lessonOpen);
    $("dcLessonToggle").textContent = lessonOpen ? "Hide the lesson" : "Read the lesson";
    $("dcLessonToggle").setAttribute("aria-expanded", String(lessonOpen));
    $("dcLessonMissions").textContent = "Missions today: " + progress.done + " of " + progress.total + " done.";
  }

  function programIntroHtml(future) {
    return '<h2 class="card-title">30-day discipline program</h2>' +
      (future
        ? '<p class="dc-line">Your program is set to start on <strong>' + esc(prettyDate(store.program.start, true)) + '</strong>, which is later than this device\'s date. Day 1 opens then. If you changed time zone or the clock, this is why.</p>'
        : '<p class="dc-line">One short lesson and two or three missions a day, for 30 days. A lesson has five parts: the principle, why it works, an everyday example, one thing to do today, and an optional question to reflect on.</p>') +
      '<ul class="dc-lines"><li><strong>Auto-checked</strong> missions tick themselves when what you entered in JARVIS shows it, and say what they look at.</li>' +
      '<li><strong>You tick it</strong> missions are on your word: JARVIS can\'t see your phone or your day, only what you type here.</li>' +
      '<li>Each day opens at midnight on this device\'s calendar. Later lessons stay locked.</li></ul>' +
      '<ul class="dc-lines">' + P.WEEKS.map(function (w) { return "<li><strong>Days " + w.days[0] + "-" + w.days[1] + ": " + esc(w.name) + "</strong><br><span class=\"field-hint\">" + esc(w.focus) + " Phone target: " + w.phone + "h.</span></li>"; }).join("") + '</ul>' +
      (future
        ? '<p class="field-hint">To begin on today\'s date instead, use “Start over from today” in Program settings below.</p>'
        : '<div class="form-actions"><button type="button" class="btn btn-primary" data-prog="start">Start today as day 1</button></div><p class="field-hint">You can restart any time, and it asks first. Nothing here changes your plans, reviews or rules.</p>');
  }

  function statHtml(label, value) { return '<div class="dc-stat"><dt>' + esc(label) + '</dt><dd>' + value + '</dd></div>'; }

  function renderProgram() {
    if (!P) { $("dcProgHead").innerHTML = '<div class="empty-state">The program isn\'t available right now.</div>'; return; }
    const open = document.activeElement;
    const focusKey = open && $("discipline-program").contains(open) ? focusKeyOf(open) : "";
    const today = todayISO();
    const ov = P.overview(store.program, today, programContext);
    const head = $("dcProgHead"), missions = $("dcProgMissions"), lesson = $("dcProgLesson"), manage = $("dcProgManage");
    const started = ov.status !== "notStarted";
    missions.classList.toggle("hidden", ov.status !== "active");
    lesson.classList.toggle("hidden", ov.status !== "active");
    if (ov.status !== "active") { missions.innerHTML = ""; lesson.innerHTML = ""; } // nothing stale left behind to share ids with the list
    manage.classList.toggle("hidden", !started && !store.program.start);

    if (ov.status === "notStarted") {
      head.innerHTML = programIntroHtml(!!store.program.start);
    } else if (ov.status === "complete") {
      const end = P.dateOfDay(store.program.start, 30);
      const t = L.trendSummary(store.days, end, 30);
      head.innerHTML = '<h2 class="card-title">Program complete</h2>' +
        '<p class="dc-line">You reached the end of day 30. Over those 30 days you scored <strong>' + t.scoredDays + '</strong> days' + (t.enough ? ', averaging <strong>' + t.average + '</strong>' : '') + ' and completed <strong>' + ov.missionsDone + ' of ' + ov.missionsTotal + '</strong> missions.</p>' +
        '<dl class="dc-stats-grid">' + statHtml("Days with every mission done", ov.finished + " of 30") + statHtml("Reflections written", String(ov.reflections)) + '</dl>' +
        '<p class="field-hint">Those are your own numbers. Keep what worked; your rules, plans and history are unchanged. Every lesson below stays open to read.</p>';
    } else {
      const week = ov.week;
      const target = P.phoneTarget(ov.day);
      const t = ov.today;
      head.innerHTML = '<div class="card-title-row"><h2 class="card-title">Day ' + ov.day + ' of 30</h2><span class="badge badge-accent">Week ' + week.n + ' of ' + P.WEEKS.length + '</span></div>' +
        '<p class="dc-line"><strong>' + esc(week.name) + '.</strong> ' + esc(week.focus) + '</p>' +
        '<div class="dc-ov-progress"><div class="dc-track" role="progressbar" aria-label="Program progress" aria-valuemin="0" aria-valuemax="30" aria-valuenow="' + ov.day + '"><div class="dc-fill" style="width:' + Math.round(100 * ov.day / 30) + '%"></div></div><span class="dc-ov-count">Day ' + ov.day + ' of 30</span></div>' +
        '<dl class="dc-stats-grid">' + statHtml("Today's principle", esc(ov.title)) + statHtml("Missions today", t.done + " of " + t.total) +
        statHtml("Completed days", ov.finished + " of " + ov.unlocked) + statHtml("Reflections", ov.reflections + " written") + '</dl>' +
        '<p class="field-hint">A day is completed when every one of its missions is done.</p>' +
        '<p class="dc-line">This week\'s phone target: <strong>' + target + 'h</strong> a day. Your limit is ' + store.settings.phoneLimit + 'h.</p>' +
        (store.settings.phoneLimit !== target ? '<div class="form-actions"><button type="button" class="btn btn-secondary" data-prog="target">Use ' + target + 'h as my limit</button></div>' : "") +
        (ov.upcoming.length ? '<h3 class="dc-lesson-h dc-coming">Coming up</h3><ul class="dc-lines dc-coming-list">' + ov.upcoming.map(function (u) {
          return "<li><strong>Day " + u.day + ": " + esc(u.title) + "</strong><br><span class=\"field-hint\">" + esc(unlockText(u.day)) + "</span></li>";
        }).join("") + '</ul>' : "");
      const progress = ov.today;
      missions.innerHTML = '<h2 class="card-title">Today\'s missions (' + progress.done + ' of ' + progress.total + ')</h2>' +
        '<div class="dc-track" role="progressbar" aria-label="Missions done today" aria-valuemin="0" aria-valuemax="' + progress.total + '" aria-valuenow="' + progress.done + '"><div class="dc-fill" style="width:' + Math.round(100 * progress.done / progress.total) + '%"></div></div>' +
        missionRows(progress, ov.day);
      const entry = P.DAYS[ov.day - 1];
      lesson.innerHTML = '<div class="dc-next-kicker">Day ' + ov.day + ' · Today\'s lesson</div><h2 class="card-title">' + esc(entry.title) + '</h2>' + lessonHtml(entry, "field") +
        '<p class="field-hint">Fixed wording, not AI. Researchers are named only where the finding is well known, and examples are imagined situations, not stories about real people.</p>';
    }

    $("dcProgDaysHint").textContent = ov.status === "notStarted"
      ? (store.program.start ? "Each day opens on its date, at midnight on this device's calendar." : "Each day opens at midnight on this device's calendar once you start.")
      : "Open any day to read it again. Each later day opens at midnight on this device's calendar.";
    $("dcProgDays").innerHTML = P.WEEKS.map(function (w) {
      const current = ov.status === "active" && ov.week && ov.week.n === w.n;
      return '<section class="dc-week"><h3 class="dc-week-h">Week ' + w.n + ': ' + esc(w.name) + ' <small>Days ' + w.days[0] + '-' + w.days[1] + (current ? ' · this week' : '') + '</small></h3>' +
        P.DAYS.filter(function (d) { return d.day >= w.days[0] && d.day <= w.days[1]; }).map(function (entry) { return dayRowHtml(entry, ov); }).join("") + '</section>';
    }).join("");

    renderManage(ov);
    restoreFocus(focusKey);
    P.DAYS.forEach(function (d) { if ($("dcReflect" + d.day)) syncReflection(d.day); });
  }

  function dayRowHtml(entry, ov) {
    const n = entry.day;
    const isToday = ov.status === "active" && n === ov.day;
    if (ov.status === "notStarted" || (ov.status === "active" && n > ov.day)) {
      return '<div class="dc-day locked"><span class="dc-day-name">Day ' + n + ' · ' + esc(entry.title) + '</span><span class="dc-day-state">Locked · ' + (ov.status === "notStarted" && !store.program.start ? "opens on day " + n : esc(unlockText(n))) + '</span></div>';
    }
    const p = P.dayProgress(n, programContext(n));
    const state = (isToday ? "Today · " : p.done === p.total ? "Done · " : "") + p.done + ' of ' + p.total;
    if (isToday) return '<div class="dc-day today"><span class="dc-day-name">Day ' + n + ' · ' + esc(entry.title) + '</span><span class="dc-day-state">' + state + '</span></div>';
    return '<details class="dc-day' + (p.done === p.total ? " complete" : "") + '" data-day="' + n + '"' + (progOpen[String(n)] ? " open" : "") + '><summary><span class="dc-day-name">Day ' + n + ' · ' + esc(entry.title) + '</span><span class="dc-day-state">' + state + '</span></summary>' +
      lessonHtml(entry, "field") + '<h3 class="dc-lesson-h">Missions</h3>' + missionRows(p, n) + '</details>';
  }

  // The bottom card: when the program began and ended, and the restart (which always asks first, and says what it resets).
  function renderManage(ov) {
    const box = $("dcProgManage");
    if (!store.program.start) { box.innerHTML = ""; return; }
    const doneTicks = Object.keys(store.program.done).reduce(function (n, k) { return n + store.program.done[k].length; }, 0);
    const reflections = Object.keys(store.program.reflections).length;
    const today = todayISO();
    if (progConfirm === "restart") {
      box.innerHTML = '<h2 class="card-title" id="dcRestartTitle" tabindex="-1">Restart the program from today?</h2>' +
        '<div class="dc-restart" role="group" aria-labelledby="dcRestartTitle">' +
        '<h3 class="dc-lesson-h">This resets</h3><ul class="dc-lines">' +
        '<li>' + (ov.status === "active" ? 'Where you are: day ' + ov.day + ' goes back to <strong>day 1 on ' + esc(prettyDate(today)) + '</strong>.'
          : ov.status === "complete" ? 'The finished program begins again, with <strong>day 1 on ' + esc(prettyDate(today)) + '</strong>.'
          : 'Your start date (' + esc(prettyDate(store.program.start)) + ') moves to today: <strong>day 1 is ' + esc(prettyDate(today)) + '</strong>.') + '</li>' +
        '<li>The missions you ticked yourself: <strong>' + doneTicks + '</strong> ' + (doneTicks === 1 ? 'tick' : 'ticks') + '.</li>' +
        '<li>Your program reflections: <strong>' + reflections + '</strong> written' + (reflections ? ' (they will be deleted)' : '') + '.</li></ul>' +
        '<h3 class="dc-lesson-h">This stays exactly as it is</h3><ul class="dc-lines">' +
        '<li>Your plans, evening reviews and scores, with their history.</li><li>Your rules, your “I\'m avoiding it” log, your Habits and your settings.</li></ul>' +
        '<p class="field-hint">Missions JARVIS checks for you will look at your entries on the new dates, so an entry you already made today can count toward day 1.</p>' +
        (reflections ? '<div class="form-actions"><button type="button" class="btn btn-secondary" data-prog="copy">Copy my reflections first</button></div>' : "") +
        '<div class="form-actions"><button type="button" class="btn btn-danger" data-prog="restart-yes">Yes, restart from today</button><button type="button" class="btn btn-secondary" data-prog="restart-no">Keep my progress</button></div></div>';
      return;
    }
    const end = P.dateOfDay(store.program.start, 30);
    box.innerHTML = '<h2 class="card-title">Program settings</h2>' +
      '<p class="dc-line">' + (ov.status === "notStarted" ? 'Set to start on ' : 'Started ') + '<strong>' + esc(prettyDate(store.program.start)) + '</strong>. Day 30 ' + (end < today ? 'was ' : 'is ') + '<strong>' + esc(prettyDate(end)) + '</strong>.</p>' +
      '<div class="form-actions"><button type="button" class="btn btn-secondary" id="dcProgRestartBtn" data-prog="restart">' + (ov.status === "complete" ? "Start the program again…" : ov.status === "notStarted" ? "Start over from today…" : "Restart the program…") + '</button></div>' +
      '<p class="field-hint">Restarting asks first and shows exactly what it resets.</p>';
  }

  // Redrawing the page replaces its buttons; this puts the keyboard back on the one that was in use.
  function focusKeyOf(el) {
    if (el.hasAttribute("data-mission")) return '[data-mission="' + el.getAttribute("data-mission") + '"][data-day="' + el.getAttribute("data-day") + '"]';
    if (el.id && /^dcReflect\d+$/.test(el.id)) return "#" + el.id;
    const keys = ["data-reflect-save", "data-reflect-remove", "data-reflect-remove-yes", "data-reflect-remove-no", "data-prog"];
    for (let i = 0; i < keys.length; i++) if (el.hasAttribute(keys[i])) return "[" + keys[i] + '="' + el.getAttribute(keys[i]) + '"]';
    return "";
  }
  function restoreFocus(sel) {
    if (!sel) return;
    const el = document.querySelector("#discipline-program " + sel);
    if (el && !el.disabled) el.focus({ preventScroll: true });
  }

  function reflectionsText() {
    const lines = [];
    P.DAYS.forEach(function (d) {
      const t = savedReflection(d.day);
      if (t) lines.push("Day " + d.day + ": " + d.title + "\n" + d.reflect + "\n" + t);
    });
    return lines.join("\n\n");
  }

  function saveProgram() { store.program = L.sanitizeProgram(store.program); save(); }

  function startProgram(today) {
    store.program = { start: today, done: {}, reflections: {} };
    Object.keys(store.drafts).forEach(function (d) { setDraft(d, "reflect", null); });
    flushDrafts();
    saveProgram();
  }

  function handleMissionTick(btn) {
    const pd = P.programDay(store.program.start, todayISO());
    const n = Number(btn.getAttribute("data-day")), i = Number(btn.getAttribute("data-mission"));
    const entry = P.DAYS[n - 1];
    // only a mission the person ticks, on a day that has opened
    if (pd.status === "notStarted" || !entry || n > Math.min(pd.day, 30) || !entry.missions[i] || entry.missions[i].a) return;
    const key = String(n);
    const list = (store.program.done[key] || []).slice();
    const at = list.indexOf(i);
    if (at === -1) list.push(i); else list.splice(at, 1);
    store.program.done[key] = list.sort();
    if (!list.length) delete store.program.done[key];
    saveProgram();
    renderProgram();
    renderLessonCard();
    renderNextUp();
  }

  // Which reflection button was pressed: { act: "save" | "remove" | "remove-yes" | "remove-no", n } or null.
  function reflectAction(e) {
    const acts = ["save", "remove", "remove-yes", "remove-no"];
    for (let i = 0; i < acts.length; i++) {
      const el = e.target.closest("[data-reflect-" + acts[i] + "]");
      if (el) return { act: acts[i], n: Number(el.getAttribute("data-reflect-" + acts[i])) };
    }
    return null;
  }

  function handleReflectionClick(e) {
    const a = reflectAction(e);
    if (!a) return false;
    const n = a.n;
    const pd = P.programDay(store.program.start, todayISO());
    if (pd.status === "notStarted" || !P.DAYS[n - 1] || n > Math.min(pd.day, 30)) return true;
    const date = P.dateOfDay(store.program.start, n);
    if (a.act === "save") {
      const box = $("dcReflect" + n);
      const text = tidy(box ? box.value : "").slice(0, L.REFLECT_MAX);
      if (!text) return true;
      store.program.reflections[String(n)] = text;
      setDraft(date, "reflect", null);
      flushDrafts();
      saveProgram();
      renderProgram(); // the overview counts reflections too
      const field = $("dcReflect" + n);
      if (field) field.focus({ preventScroll: true });
      core().showToast("Reflection saved.");
    } else if (a.act === "remove") {
      progConfirm = { remove: n };
      renderProgram();
      const keep = document.querySelector('[data-reflect-remove-no="' + n + '"]');
      if (keep) keep.focus({ preventScroll: true });
    } else if (a.act === "remove-yes") {
      delete store.program.reflections[String(n)];
      setDraft(date, "reflect", null);
      flushDrafts();
      progConfirm = null;
      saveProgram();
      renderProgram();
      core().showToast("Reflection removed.");
    } else {
      progConfirm = null;
      renderProgram();
      const rm = document.querySelector('[data-reflect-remove="' + n + '"]');
      if (rm) rm.focus({ preventScroll: true });
    }
    return true;
  }

  function handleProgramClick(e) {
    if (!P) return;
    const mission = e.target.closest("[data-mission]");
    if (mission) { handleMissionTick(mission); return; }
    if (handleReflectionClick(e)) return;
    const act = e.target.closest("[data-prog]");
    if (!act) return;
    const today = todayISO();
    const what = act.getAttribute("data-prog");
    if (what === "start") {
      startProgram(today);
      core().showToast("Day 1 starts today.");
    } else if (what === "restart") {
      progConfirm = "restart";
      renderProgram();
      const t = $("dcRestartTitle");
      if (t) { t.focus({ preventScroll: true }); bringIntoView("dcProgManage"); }
      return;
    } else if (what === "restart-no") {
      progConfirm = null;
      renderProgram();
      const b = $("dcProgRestartBtn");
      if (b) b.focus({ preventScroll: true });
      return;
    } else if (what === "restart-yes") {
      progConfirm = null;
      progOpen = {};
      startProgram(today);
      renderProgram();
      renderLessonCard();
      renderNextUp();
      const h = document.querySelector("#dcProgHead h2");
      if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); bringIntoView("dcProgHead"); }
      core().showToast("Restarted. Today is day 1.");
      return;
    } else if (what === "copy") {
      const text = reflectionsText();
      const clip = navigator.clipboard;
      if (!text) { core().showToast("There is nothing to copy."); return; }
      if (!clip || typeof clip.writeText !== "function") { core().showToast("Copying isn't available here. Select your reflections and copy them yourself."); return; }
      clip.writeText(text).then(function () { core().showToast("Your reflections are copied."); }, function () { core().showToast("Couldn't copy. Nothing was changed."); });
      return;
    } else if (what === "target") {
      const target = P.phoneTarget(P.programDay(store.program.start, today).day);
      store.settings.phoneLimit = target;
      save();
      renderHeader();
      renderSetup();
      core().showToast("Phone limit is now " + target + "h.");
    }
    renderProgram();
    renderLessonCard();
    renderNextUp();
  }

  // Typing in a reflection: kept as a draft on every keystroke, and the status updates without redrawing the page.
  function handleProgramInput(e) {
    const box = e.target.closest(".dc-reflect-input");
    if (!box || !P) return;
    const n = Number(box.getAttribute("data-day"));
    const date = P.dateOfDay(store.program.start, n);
    const text = tidy(box.value).slice(0, L.REFLECT_MAX);
    setDraft(date, "reflect", text === savedReflection(n) && box.value === text ? null : box.value.slice(0, L.REFLECT_MAX));
    syncReflection(n);
  }

  function handleProgramKey(e) {
    if (e.key === "Escape" && progConfirm) {
      const was = progConfirm;
      progConfirm = null;
      renderProgram();
      const back = was === "restart" ? $("dcProgRestartBtn") : document.querySelector('[data-reflect-remove="' + was.remove + '"]');
      if (back) back.focus({ preventScroll: true });
    }
  }

  /* ---------------- wiring ---------------- */

  function renderEverything() {
    loadReviewForm();
    renderAllToday();
    renderProgram();
    renderTrends();
    renderSetup();
  }

  function onSubTabChange(targetId) {
    if (targetId === "discipline-today") { if (selectedDate() !== renderedDate) loadReviewForm(); renderAllToday(); }
    if (targetId === "discipline-program") renderProgram();
    if (targetId === "discipline-trends") renderTrends();
    if (targetId === "discipline-setup") renderSetup();
  }

  // For the Daily Briefing: has a plan been set today, the streak, and the last scored day.
  function getSummary() {
    const today = todayISO();
    const day = store.days[today];
    const last = L.lastScored(store.days, today);
    let when = "";
    if (last) {
      const n = L.daysBetween(last.date, today);
      when = n === 0 ? "today" : n === 1 ? "yesterday" : n + " days ago";
    }
    return {
      hasData: !!L.firstUseDate(store.days),
      plannedToday: !!(day && day.morning),
      reviewedToday: !!(day && L.scoreDay(day).complete),
      streak: L.reviewStreak(store.days, today),
      programDay: P && P.programDay(store.program.start, today).status === "active" ? P.programDay(store.program.start, today).day : 0,
      last: last ? { score: last.score, when: when } : null
    };
  }

  function refreshForClock() {
    if (document.visibilityState !== "visible") return;
    const t = todayISO();
    if (selectedDate() === renderedDate) { renderNextUp(); updateClock(); renderReviewMode(); renderRoutineCard(); renderHabitsStrip(); return; }
    // Midnight passed (or the app came back the next day). Someone part-way through a plan or review stays on the day
    // they were filling in, which is now "Yesterday"; otherwise the screen moves on to the new today.
    const old = renderedDate;
    const stay = hasDraft(old);
    if (stay) {
      if (old === t) selected = "today";
      else if (old === L.addDays(t, -1)) selected = "yesterday";
      else if (old === L.addDays(t, 1)) selected = "tomorrow";
    } else { editingMorning = false; editingReview = false; reviewOpened = false; reordering = false; planStep = 1; reviewStep = 1; }
    renderEverything();
    if (stay && selectedDate() === old) core().showToast("It's a new day, but you're still on " + prettyDate(old) + " because it has unsaved changes.");
  }

  function init() {
    load();
    $("dcDayType").innerHTML = Object.keys(L.DAY_TYPES).map(function (k) { return '<option value="' + k + '">' + esc(L.DAY_TYPES[k].label) + '</option>'; }).join("");

    $("dcDayPills").addEventListener("click", function (e) {
      const btn = e.target.closest("[data-day]");
      if (!btn) return;
      const which = btn.getAttribute("data-day");
      selectDay(which === "yesterday" || which === "tomorrow" ? which : "today");
    });
    $("dcNextActions").addEventListener("click", handleNextAction);
    $("dcNextMoreActions").addEventListener("click", handleNextAction);

    // Paired with Habits: open each from the other, and refresh whenever the routine may have changed (switching to
    // Discipline, ticking a habit or a task in Habits). Discipline reads Habits' own saved data and never writes it.
    $("dcOpenHabits").addEventListener("click", openHabitsTab);
    $("habitsOpenDiscipline").addEventListener("click", function () { $("navBtnDiscipline").click(); $("disciplineSubNavToday").click(); window.scrollTo(0, 0); });
    $("dcRoutineUse").addEventListener("click", function () {
      const r = routineOn(renderedDate || selectedDate());
      const answer = r && H.suggestAnswer(r.routine);
      if (!answer) return;
      draft.extras.routine = answer;
      renderReviewControls();
      captureReviewDraft();
      core().showToast("Filled in from Habits: " + ANSWER_LABELS[answer] + ". You can change it.");
    });
    $("navBtnDiscipline").addEventListener("click", function () { renderOverview(); renderNextUp(); renderRoutineCard(); renderProgressCard(); renderRoutineReview(); });
    ["navBtnHabits", "habitsSubNavToday"].forEach(function (id) { $(id).addEventListener("click", renderHabitsStrip); });
    // On the lists themselves, so this runs after Habits has handled the tap and redrawn (its own handler is registered first).
    ["todayHabitsList", "taskList"].forEach(function (id) { $(id).addEventListener("click", renderHabitsStrip); });
    TEXT_IDS.forEach(function (id) { $(id).addEventListener("input", renderImport); });
    $("dcSeeTrends").addEventListener("click", function () { $("disciplineSubNavTrends").click(); });

    // Planning steps: options for the category selects, the suggestion buttons, and moving between steps.
    const categoryOptions = '<option value="">None</option>' + L.TASK_CATEGORIES.map(function (c) { return '<option value="' + c.key + '">' + esc(c.label) + '</option>'; }).join("");
    CAT_IDS.forEach(function (id) { $(id).innerHTML = categoryOptions; });
    $("dcResponseChips").innerHTML = L.DISTRACTION_RESPONSES.map(function (t, i) { return '<button type="button" class="dc-chip" data-resp="' + i + '">' + esc(t) + '</button>'; }).join("");
    $("dcExampleChips").innerHTML = L.IF_THEN_EXAMPLES.map(function (t, i) { return '<button type="button" class="dc-chip" data-example="' + i + '">' + esc(t) + '</button>'; }).join("");
    $("dcMorningForm").addEventListener("click", handleMorningFormClick);
    $("dcStepNext").addEventListener("click", function () { showPlanStep(planStep + 1, true); });
    $("dcStepBack").addEventListener("click", function () { showPlanStep(planStep - 1, true); });
    // Enter in a one-line field moves to the next step instead of saving a half-made plan.
    $("dcMorningForm").addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || planStep === 4 || !e.target.matches('input[type="text"], input[type="time"]')) return;
      e.preventDefault();
      showPlanStep(planStep + 1, true);
    });
    $("dcPlan").addEventListener("input", renderExamples);

    // Review sections.
    $("dcReviewTabs").addEventListener("click", function (e) {
      const tab = e.target.closest("[data-rstep]");
      if (tab) showReviewStep(Number(tab.getAttribute("data-rstep")), false);
    });
    $("dcReviewNext").addEventListener("click", function () { showReviewStep(reviewStep + 1, true); });
    $("dcReviewBack").addEventListener("click", function () { showReviewStep(reviewStep - 1, true); });
    $("dcReviewOpenBtn").addEventListener("click", function () { reviewOpened = true; renderReviewMode(); renderReviewHint(); showReviewStep(1, true); });
    $("dcReviewEditBtn").addEventListener("click", function () { editingReview = true; renderReviewMode(); renderReviewHint(); showReviewStep(1, true); });
    $("dcReviewForm").addEventListener("input", updateReviewProgress);
    $("dcFlow").addEventListener("click", function (e) { if (store.timer) handleTimerClick(e); else handleFlowClick(e); });
    $("dcMorningForm").addEventListener("submit", handleMorningSubmit);
    $("dcMorningEditBtn").addEventListener("click", function () { startEditing(1); });
    $("dcMorningReorderBtn").addEventListener("click", function () { reordering = !reordering; renderMorning(); });
    $("dcMorningSummary").addEventListener("click", handleMorningSummaryClick);
    $("dcReviewForm").addEventListener("click", handleReviewClick);
    $("dcReviewForm").addEventListener("submit", handleReviewSubmit);
    $("dcResult").addEventListener("click", handleResultClick);
    $("dcDayType").addEventListener("change", handleDayTypeChange);
    $("dcWindowPills").addEventListener("click", function (e) {
      const btn = e.target.closest("[data-window]");
      if (!btn) return;
      trendWindow = btn.getAttribute("data-window") === "30" ? 30 : 7;
      renderTrends();
    });
    $("dcWeeklySuggestions").addEventListener("click", handleWeeklyClick);
    $("dcWeeklyText").addEventListener("input", function () { weeklyEdited = true; weeklyDate = todayISO(); $("dcRebuildBtn").classList.remove("hidden"); $("dcShareHint").textContent = SHARE_HINT_EDITED; });
    $("dcShareOptions").addEventListener("change", handleShareOption);
    $("dcRebuildBtn").addEventListener("click", handleRebuild);
    $("dcShareBtn").addEventListener("click", handleShare);
    $("dcCopyBtn").addEventListener("click", handleCopy);
    $("dcSetupForm").addEventListener("submit", handleSetupSubmit);
    $("dcTimesForm").addEventListener("submit", handleTimesSubmit);
    $("dcRuleForm").addEventListener("submit", handleRuleSubmit);
    $("dcRulesManager").addEventListener("click", handleRulesManagerClick);
    $("dcNudges").addEventListener("click", handleNudgeClick);
    $("discipline-program").addEventListener("click", handleProgramClick);
    $("discipline-program").addEventListener("input", handleProgramInput);
    $("discipline-program").addEventListener("keydown", handleProgramKey);
    // <details> doesn't bubble "toggle", so listen on the way down: opened days stay open when the page redraws.
    $("dcProgDays").addEventListener("toggle", function (e) {
      const d = e.target;
      if (!d || !d.matches || !d.matches("details[data-day]")) return;
      if (d.open) progOpen[d.getAttribute("data-day")] = true; else delete progOpen[d.getAttribute("data-day")];
    }, true);
    $("dcLessonToggle").addEventListener("click", function () { lessonOpen = !lessonOpen; renderLessonCard(); });
    $("dcLessonGo").addEventListener("click", function () { $("disciplineSubNavProgram").click(); });

    // The screen follows the clock: past midnight it rolls over to the new day (checked every 30 seconds while the
    // app is open, and when it comes back to the front), "Next up" changes with the time of day, and a timer that
    // ran out in the background is shown as finished. Anything typed but unsaved is kept (see drafts).
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") { flushDrafts(); return; }
      refreshForClock();
    });
    window.addEventListener("pagehide", flushDrafts);
    $("dcMorningForm").addEventListener("input", captureMorningDraft);
    $("dcMorningForm").addEventListener("change", captureMorningDraft); // selects and time fields
    $("dcReviewForm").addEventListener("input", captureReviewDraft);
    window.setInterval(refreshForClock, 30000);

    renderEverything();
    ensureTicking();
  }

  window.JarvisDiscipline = { init: init, getSummary: getSummary, onSubTabChange: onSubTabChange };
})();
