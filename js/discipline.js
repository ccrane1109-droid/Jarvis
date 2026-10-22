/* ==========================================================================
   JARVIS — Discipline tracker (screens). The rules live in discipline-logic.js.

   localStorage key:
     jarvisDiscipline — { settings: { phoneLimit, times: { planBy, afterSchool, review } },
                          rules: [ { id, text } ],                      your own if-then rules
                          avoid: [ { at, date, task, reason, excuse, outcome } ],   "I'm avoiding it" log
                          timer: { task, taskId, reason, excuse, entryAt, startedAt, minutes, endsAt } | null,
                          days: { "<YYYY-MM-DD>": {
                            type, morning: { priorities[3], keyTask, distraction, plan, savedAt, editedAt } | null,
                            review: { screenHours, phoneLimit, items{}, focus, time, rules[], blocker, notes..., savedAt } | null } } }
   Saved on this device only (it is not in the cloud-sync list), so nothing
   here leaves the phone unless you tap Share. A day's score is never stored:
   it is worked out from the answers each time, except the phone limit, which
   is kept with the review so changing the limit later never rewrites a past
   day. The advice text is fixed wording keyed to what you pick. It is not AI.
   ========================================================================== */

(function () {
  "use strict";

  const LS_KEY = "jarvisDiscipline";
  const L = window.JarvisDisciplineLogic;

  const ITEM_QUESTIONS = {
    school: "Did you finish your school work?",
    gratiel: "Did you do a Gratiel block that made something (not just research)?",
    bedOnTime: "Were you in bed on time last night?",
    phoneOut: "Was your phone out of the bedroom last night?",
    training: "Did you train or rest as planned today?"
  };
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
  const ACTION_LABELS = { plan: "Plan my day", scoreYesterday: "Score yesterday", start: "Start 2 minutes", avoid: "I'm avoiding it", review: "Open the review", planTomorrow: "Plan tomorrow" };
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
  let renderedDate = "";
  let flow = null;               // the "I'm avoiding it" steps: { step, taskId, taskText, reason, excuse }
  let tickHandle = null;
  let weeklyEdited = false;
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

  function load() { store = L.sanitizeStore(core().loadJSON(LS_KEY, null)); }
  function save() {
    if (!core().saveJSON(LS_KEY, store)) core().showToast("Couldn't save. This browser's storage may be full or blocked.");
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
    return { items: items, focus: r ? r.focus : null, time: r ? r.time : null, rules: rules };
  }

  function selectDay(which) {
    selected = which;
    editingMorning = false;
    loadReviewForm();
    renderAllToday();
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

  function renderNextUp() {
    const card = $("dcNextCard");
    if (selected !== "today" || store.timer || flow) { card.classList.add("hidden"); return; }
    const n = L.nextUp({ todayISO: todayISO(), minutes: nowMinutes(), days: store.days, settings: store.settings });
    card.classList.remove("hidden");
    card.setAttribute("data-kind", n.kind);
    $("dcNextTitle").textContent = n.title;
    $("dcNextText").textContent = n.text;
    $("dcNextActions").innerHTML = n.actions.map(function (a) {
      return '<button type="button" class="btn ' + (a === "avoid" ? "btn-secondary" : "btn-primary") + '" data-act="' + a + '"' + (n.task ? ' data-task="' + esc(n.task.id) + '"' : "") + '>' + ACTION_LABELS[a] + '</button>';
    }).join("");
  }

  function handleNextAction(e) {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.getAttribute("data-act");
    const taskId = btn.getAttribute("data-task") || "";
    if (act === "plan") { bringIntoView("dcMorningCard"); if (!$("dcMorningForm").classList.contains("hidden")) $("dcKeyTask").focus({ preventScroll: true }); }
    else if (act === "scoreYesterday") { selectDay("yesterday"); bringIntoView("dcReviewCard"); }
    else if (act === "review") bringIntoView("dcReviewCard");
    else if (act === "planTomorrow") { selectDay("tomorrow"); bringIntoView("dcMorningCard"); }
    else if (act === "start") startTimer({ task: planItemText(taskId), taskId: taskId, reason: "", excuse: "", entryAt: 0, minutes: L.START_MINUTES });
    else if (act === "avoid") openFlow(taskId);
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

  function renderMorning() {
    const day = store.days[selectedDate()];
    const m = day && day.morning;
    const showForm = !m || editingMorning;
    $("dcMorningTitle").textContent = selected === "tomorrow" ? "Plan for tomorrow" : "Morning plan";
    $("dcMorningForm").classList.toggle("hidden", !showForm);
    $("dcMorningSummary").classList.toggle("hidden", showForm);
    $("dcMorningEditBtn").classList.toggle("hidden", showForm);
    $("dcMorningSaveBtn").textContent = m ? "Save changes" : "Lock in the plan";
    if (showForm) {
      $("dcKeyTask").value = m ? m.keyTask.text : "";
      [0, 1, 2].forEach(function (i) { $("dcPriority" + (i + 1)).value = m ? m.priorities[i].text : ""; });
      $("dcDistraction").value = m ? m.distraction : "";
      $("dcPlan").value = m ? m.plan : "";
      return;
    }
    const rows = [];
    const locked = selected === "tomorrow";
    if (m.keyTask.text) rows.push(checkRow("key", "★ " + m.keyTask.text, m.keyTask.done, true, locked));
    m.priorities.forEach(function (p, i) { if (p.text) rows.push(checkRow("p" + i, p.text, p.done, false, locked)); });
    $("dcMorningSummary").innerHTML =
      '<p class="field-hint">' + (locked ? "You can tick these off tomorrow." : "Tap each one as you finish it.") + '</p>' +
      '<div class="dc-checklist">' + rows.join("") + '</div>' +
      (m.distraction ? '<p class="dc-line"><strong>Distraction to watch:</strong> ' + esc(m.distraction) + '</p>' : "") +
      (m.plan ? '<p class="dc-line"><strong>Your plan:</strong> ' + esc(m.plan) + '</p>' : "");
  }

  function checkRow(id, text, done, key, locked) {
    return '<button type="button" class="dc-check' + (done ? " done" : "") + (key ? " key" : "") + '" role="checkbox" aria-checked="' + done + '" data-check="' + id + '"' + (locked ? " disabled" : "") + '>' +
      '<span class="dc-box" aria-hidden="true">' + (done ? "✓" : "") + '</span><span class="dc-check-text">' + esc(text) + '</span></button>';
  }

  function handleMorningSubmit(e) {
    e.preventDefault();
    const date = selectedDate();
    const day = ensureDay(date);
    const old = day.morning;
    const keyText = tidy($("dcKeyTask").value);
    const texts = [1, 2, 3].map(function (i) { return tidy($("dcPriority" + i).value); });
    if (!keyText && !texts.some(function (t) { return t; })) {
      core().showToast("Add at least one priority.");
      $("dcKeyTask").focus();
      return;
    }
    const raw = {
      keyTask: { text: keyText, done: !!old && old.keyTask.text === tidy(keyText) && old.keyTask.done },
      priorities: texts.map(function (t, i) { return { text: t, done: !!old && old.priorities[i].text === tidy(t) && old.priorities[i].done }; }),
      distraction: $("dcDistraction").value, plan: $("dcPlan").value,
      savedAt: old ? old.savedAt : Date.now()
    };
    // Only a change to the key task or priorities counts as editing the plan.
    const changed = !!old && (old.keyTask.text !== keyText || old.priorities.some(function (p, i) { return p.text !== texts[i]; }));
    raw.editedAt = !old || changed ? Date.now() : old.editedAt;
    day.morning = L.sanitizeDay({ morning: raw }).morning;
    editingMorning = false;
    save();
    renderAllToday();
    core().showToast(old ? "Plan updated." : (selected === "tomorrow" ? "Tomorrow is planned." : "Plan locked in."));
  }

  function handleMorningSummaryClick(e) {
    const btn = e.target.closest(".dc-check");
    if (!btn || btn.disabled) return;
    const day = store.days[selectedDate()];
    if (!day || !day.morning) return;
    const id = btn.getAttribute("data-check");
    const item = id === "key" ? day.morning.keyTask : day.morning.priorities[Number(id.slice(1))];
    if (!item) return;
    item.done = !item.done;
    save();
    renderMorning();
    renderResult();
    renderNextUp();
  }

  /* ---------------- Today: evening review ---------------- */

  function segButtons(values, current, labelFor) {
    return values.map(function (v) {
      return '<button type="button" class="segmented-btn' + (current === v ? " active" : "") + '" data-value="' + v + '" aria-pressed="' + (current === v) + '">' + labelFor(v) + '</button>';
    }).join("");
  }

  function renderReviewControls() {
    $("dcFocus").innerHTML = segButtons([1, 2, 3, 4, 5], draft.focus, String);
    $("dcTime").innerHTML = segButtons([1, 2, 3, 4, 5], draft.time, String);
    $("dcPhoneNa").innerHTML = segButtons(["", "na"], draft.items.phone === "na" ? "na" : "", function (v) { return v ? "Not today" : "Count it"; });
    $("dcScreenHours").disabled = draft.items.phone === "na";
    $("dcItems").innerHTML = Object.keys(L.ITEMS).map(function (k) {
      return '<div class="dc-q"><span class="dc-q-label">' + esc(ITEM_QUESTIONS[k]) + '</span>' +
        '<div class="segmented-control dc-seg" data-item="' + k + '" role="group" aria-label="' + esc(L.ITEMS[k].label) + '">' +
        segButtons(["done", "not", "na"], draft.items[k], function (v) { return ANSWER_LABELS[v]; }) + '</div></div>';
    }).join("");
    $("dcRulesQ").classList.toggle("hidden", !store.rules.length);
    $("dcRules").innerHTML = store.rules.map(function (r) {
      return '<div class="dc-q"><span class="dc-q-label">' + esc(r.text) + '</span>' +
        '<div class="segmented-control dc-seg" data-rule="' + esc(r.id) + '" role="group" aria-label="' + esc(r.text) + '">' +
        segButtons(["done", "not", "na"], draft.rules[r.id] || null, function (v) { return ANSWER_LABELS[v]; }) + '</div></div>';
    }).join("");
  }

  function loadReviewForm() {
    const date = selectedDate();
    const day = store.days[date] || null;
    draft = newDraft(day);
    const r = day && day.review;
    $("dcScreenHours").value = r && r.screenHours !== null ? r.screenHours : "";
    Object.keys(NOTE_INPUTS).forEach(function (id) { $(id).value = r ? r[NOTE_INPUTS[id]] : ""; });
    $("dcDayType").value = day ? day.type : "normal";
    $("dcMissing").classList.add("hidden");
    renderReviewControls();
    renderedDate = date;
  }

  function handleReviewClick(e) {
    const btn = e.target.closest(".dc-seg .segmented-btn");
    if (!btn) return;
    const group = btn.closest(".dc-seg");
    const raw = btn.getAttribute("data-value");
    let current;
    if (group.hasAttribute("data-rating")) { draft[group.getAttribute("data-rating")] = Number(raw); current = Number(raw); }
    else if (group.hasAttribute("data-rule")) { draft.rules[group.getAttribute("data-rule")] = raw; current = raw; }
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
  }

  function handleReviewSubmit(e) {
    e.preventDefault();
    const date = selectedDate();
    const day = ensureDay(date);
    const raw = {
      screenHours: draft.items.phone === "na" ? null : $("dcScreenHours").value,
      phoneLimit: day.review ? day.review.phoneLimit : store.settings.phoneLimit,
      items: draft.items, focus: draft.focus, time: draft.time,
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
      return;
    }
    $("dcMissing").classList.add("hidden");
    day.review = candidate.review;
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
    if (m && m.editedAt > day.review.savedAt) lines.push("The plan was changed after this day was scored, so this score reflects the changed plan. Score the day again to clear this note.");
    if (day.review.improve) lines.push("Your note for tomorrow: “" + esc(day.review.improve) + "”");

    const prev = L.lastScored(store.days, L.addDays(date, -1));
    const compare = prev ? (r.score - prev.score === 0 ? "Same as the last scored day" : (r.score > prev.score ? "Up " : "Down ") + Math.abs(r.score - prev.score) + " from the last scored day") + " (" + prev.score + " on " + prettyDate(prev.date) + ")." : "";
    const excused = r.excused.length ? "Not counted today: " + esc(r.excused.join(", ")) + ". Scored out of " + r.possible + " attainable points." : "";

    box.innerHTML =
      '<div class="dc-score-row"><div class="dc-score-num">' + r.score + '<small>/100</small></div>' +
      '<div class="dc-score-side"><div class="dc-score-label">Discipline score</div>' +
      (compare ? '<div class="field-hint">' + compare + '</div>' : "") +
      (excused ? '<div class="field-hint">' + excused + '</div>' : "") + '</div></div>' +
      '<div class="dc-cats">' + r.categories.map(function (c) {
        const pct = c.possible ? Math.round(100 * c.earned / c.possible) : 0;
        return '<div class="dc-cat"><div class="dc-cat-head"><span>' + esc(c.label) + '</span><span>' + (c.possible ? c.earned + " / " + c.possible : "not counted") + '</span></div>' +
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
    if (scored) msg = "Scored. You can change any answer and score again.";
    else if (selected === "today" && new Date().getHours() < 17) msg = "Best filled in this evening, but you can score the day any time. Answer every item; “Not today” leaves an item out.";
    else msg = "Answer every item to get your score. “Not today” leaves an item out.";
    $("dcReviewHint").textContent = msg;
  }

  // Refreshes everything on Today except the review form itself, so typed answers are never wiped.
  function renderAllToday() {
    renderHeader();
    renderNextUp();
    renderFlow();
    renderMorning();
    $("dcReviewCard").classList.toggle("hidden", selected === "tomorrow");
    renderReviewHint();
    renderResult();
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
    weeklyEdited = false;
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
    weeklyEdited = false;
    renderReviewControls();
    renderSetup();
    renderResult();
    core().showToast("Rule removed. Past answers stay in your history.");
  }

  /* ---------------- Trends ---------------- */

  function listRows(rows) {
    return '<div class="dc-cats">' + rows.map(function (r) {
      return '<div class="dc-cat"><div class="dc-cat-head"><span>' + esc(r.label) + '</span><span>' + esc(r.value) + '</span></div>' +
        (r.pct === undefined ? "" : '<div class="dc-track"><div class="dc-fill" style="width:' + r.pct + '%"></div></div>') + '</div>';
    }).join("") + '</div>';
  }

  function renderWeekly() {
    const today = todayISO();
    const sugg = L.suggestRules(L.trendSummary(store.days, today, 30), store.rules);
    $("dcWeeklySuggestions").innerHTML = sugg.length ? sugg.map(function (s, i) {
      return '<div class="dc-sugg"><div><strong>' + esc(s.text) + '</strong><div class="field-hint">' + esc(s.why) + '</div></div>' +
        '<button type="button" class="btn btn-secondary" data-sugg="' + i + '"' + (store.rules.length >= L.MAX_RULES ? " disabled" : "") + '>Add as a rule</button></div>';
    }).join("") : '<div class="empty-state">Nothing new to suggest right now.</div>';
    $("dcWeeklySuggestions").setAttribute("data-texts", JSON.stringify(sugg.map(function (s) { return s.text; })));
    if (!weeklyEdited) $("dcWeeklyText").value = L.weeklyText({ todayISO: today, days: store.days, avoid: store.avoid, rules: store.rules });
  }

  function renderTrends() {
    const today = todayISO();
    const t = L.trendSummary(store.days, today, trendWindow);
    $("dcWindow7").classList.toggle("active", trendWindow === 7);
    $("dcWindow30").classList.toggle("active", trendWindow === 30);
    const box = function (value, label) { return '<div class="stat-box"><span class="stat-value">' + value + '</span><span class="stat-label">' + label + '</span></div>'; };
    $("dcStats").innerHTML =
      box(t.enough ? t.average : "—", "Average score") +
      box(t.best ? t.best.score : "—", "Best day") +
      box(t.worst ? t.worst.score : "—", "Lowest day") +
      box(L.reviewStreak(store.days, today), "Day streak") +
      box(t.missed, "Days without a review") +
      box(t.excusedDays, "Days with items “not today”");

    const notes = [];
    if (!t.enough) notes.push("Needs " + L.MIN_DAYS_FOR_AVERAGES + " scored days for averages. You have " + t.scoredDays + " in this window.");
    else {
      if (t.weakest) notes.push("Weakest area: " + t.weakest.label + " (" + t.weakest.pct + "% of what was attainable, on average).");
      if (t.phone.days) notes.push("Phone: averaged " + t.phone.averageHours + "h over " + t.phone.days + " days; over the limit on " + t.phone.overLimit + ".");
      if (t.weakestWeekday) notes.push("Lowest weekday: " + ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"][t.weakestWeekday.weekday] + " (average " + t.weakestWeekday.average + " over " + t.weakestWeekday.days + " days).");
      else notes.push("Weekday patterns need " + L.MIN_DAYS_FOR_WEEKDAYS + " scored days in the window.");
    }
    notes.push("Only days you scored are averaged; a day with no review is never counted as zero.");
    $("dcTrendNote").textContent = notes.join("\n");

    // Bars: one column per day, empty where there is no score.
    $("dcChart").innerHTML = t.daily.map(function (d) {
      const label = prettyDate(d.date) + ": " + (d.score === null ? (d.planned ? "plan only, no review" : "no entry") : d.score + " / 100");
      return '<div class="dc-col' + (d.score === null ? " empty" : "") + (d.planned && d.score === null ? " planned" : "") + (d.date === today ? " today" : "") + '" title="' + esc(label) + '" aria-label="' + esc(label) + '">' +
        (d.score === null ? "" : (trendWindow === 7 ? '<span class="dc-bar-num">' + d.score + '</span>' : "") + '<div class="dc-bar" style="height:' + Math.max(d.score, 2) + '%"></div>') + '</div>';
    }).join("");
    const first = t.daily[0].date, last = t.daily[t.daily.length - 1].date;
    $("dcChartAxis").innerHTML = trendWindow === 7
      ? t.daily.map(function (d) { return "<span>" + ["S", "M", "T", "W", "T", "F", "S"][L.weekdayOf(d.date)] + "</span>"; }).join("")
      : "<span>" + esc(prettyDate(first)) + "</span><span>" + esc(prettyDate(last)) + "</span>";

    $("dcCategories").innerHTML = t.categories
      ? t.categories.map(function (c) {
        return '<div class="dc-cat"><div class="dc-cat-head"><span>' + esc(c.label) + '</span><span>' + (c.pct === null ? "—" : c.pct + "%") + '</span></div>' +
          '<div class="dc-track"><div class="dc-fill" style="width:' + (c.pct || 0) + '%"></div></div></div>';
      }).join("")
      : '<div class="empty-state">Needs ' + L.MIN_DAYS_FOR_AVERAGES + ' scored days in this window.</div>';

    // Avoiding: why, and how often you started anyway.
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

    // Your rules.
    const rs = L.ruleSummary(store.days, today, trendWindow);
    $("dcRuleStats").innerHTML = rs.answered
      ? '<p class="dc-line">You kept your rules <strong>' + rs.rate + '%</strong> of the time (' + rs.kept + ' of ' + rs.answered + ' answers).</p>' +
        listRows(rs.byRule.map(function (r) { return { label: r.text, value: r.kept + " of " + r.answered, pct: Math.round(100 * r.kept / r.answered) }; }))
      : '<div class="empty-state">' + (store.rules.length ? "Answer your rules in tonight’s review and they show up here." : "Add a rule in Setup, then answer it each evening.") + '</div>';

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
    if (text && addRule(text)) core().showToast("Added to your rules. You'll answer it each evening.");
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

  /* ---------------- wiring ---------------- */

  function renderEverything() {
    loadReviewForm();
    renderAllToday();
    renderTrends();
    renderSetup();
  }

  function onSubTabChange(targetId) {
    if (targetId === "discipline-today") { if (selectedDate() !== renderedDate) loadReviewForm(); renderAllToday(); }
    if (targetId === "discipline-trends") { weeklyEdited = false; renderTrends(); }
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
      last: last ? { score: last.score, when: when } : null
    };
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
    $("dcFlow").addEventListener("click", function (e) { if (store.timer) handleTimerClick(e); else handleFlowClick(e); });
    $("dcMorningForm").addEventListener("submit", handleMorningSubmit);
    $("dcMorningEditBtn").addEventListener("click", function () { editingMorning = true; renderMorning(); $("dcKeyTask").focus(); });
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
    $("dcWeeklyText").addEventListener("input", function () { weeklyEdited = true; });
    $("dcShareBtn").addEventListener("click", handleShare);
    $("dcCopyBtn").addEventListener("click", handleCopy);
    $("dcSetupForm").addEventListener("submit", handleSetupSubmit);
    $("dcTimesForm").addEventListener("submit", handleTimesSubmit);
    $("dcRuleForm").addEventListener("submit", handleRuleSubmit);
    $("dcRulesManager").addEventListener("click", handleRulesManagerClick);
    $("dcNudges").addEventListener("click", handleNudgeClick);

    // An app left open past midnight should roll over to the new day when it comes back to the front;
    // a timer that ran out while the app was in the background is shown as finished.
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") return;
      if (selectedDate() !== renderedDate) {
        editingMorning = false;
        renderEverything();
      } else {
        renderNextUp();
        updateClock();
      }
    });

    renderEverything();
    ensureTicking();
  }

  window.JarvisDiscipline = { init: init, getSummary: getSummary, onSubTabChange: onSubTabChange };
})();
