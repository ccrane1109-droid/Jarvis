/* ==========================================================================
   JARVIS — Discipline tracker (screens). The rules live in discipline-logic.js.

   localStorage key:
     jarvisDiscipline — { settings: { phoneLimit }, days: { "<YYYY-MM-DD>": {
                            type, morning: { priorities[3], keyTask, distraction, plan, savedAt } | null,
                            review: { screenHours, phoneLimit, items{}, focus, time, notes..., savedAt } | null } } }
   Saved on this device only (it is not in the cloud-sync list), so nothing
   here leaves the phone. A day's score is never stored: it is worked out from
   the answers each time, except the phone limit, which is kept with the
   review so changing the limit later never rewrites a past day.
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

  let store = { settings: { phoneLimit: L.DEFAULT_PHONE_LIMIT }, days: {} };
  let selected = "today";        // "today" | "yesterday"
  let trendWindow = 7;
  let editingMorning = false;
  let renderedDate = "";
  let draft = newDraft(null);    // the review form's button answers while it's being filled in

  function $(id) { return document.getElementById(id); }
  function core() { return window.JarvisCore; }
  function esc(v) { return core().escapeHtml(v); }
  function tidy(v) { return String(v === undefined || v === null ? "" : v).replace(/\s+/g, " ").trim(); }

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
  function selectedDate() { return selected === "today" ? todayISO() : L.addDays(todayISO(), -1); }
  function prettyDate(iso, long) {
    const p = iso.split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString("en-US", long ? { weekday: "long", month: "long", day: "numeric" } : { weekday: "short", month: "short", day: "numeric" });
  }
  function firstUseDate() {
    const dates = Object.keys(store.days).filter(function (d) { return store.days[d].morning || store.days[d].review; }).sort();
    return dates.length ? dates[0] : null;
  }

  function newDraft(day) {
    const r = day && day.review;
    const items = {};
    Object.keys(L.ITEMS).concat(["phone"]).forEach(function (k) { items[k] = r ? r.items[k] : null; });
    if (!r) L.excusedFor(day ? day.type : "normal").forEach(function (k) { items[k] = "na"; });
    return { items: items, focus: r ? r.focus : null, time: r ? r.time : null };
  }

  /* ---------------- Today: header and nudges ---------------- */

  function renderHeader() {
    const date = selectedDate();
    const day = store.days[date];
    $("dcDateTitle").textContent = (selected === "today" ? "Today · " : "Yesterday · ") + prettyDate(date);
    $("dcDayToday").classList.toggle("active", selected === "today");
    $("dcDayYesterday").classList.toggle("active", selected === "yesterday");
    $("dcDayToday").setAttribute("aria-selected", String(selected === "today"));
    $("dcDayYesterday").setAttribute("aria-selected", String(selected === "yesterday"));
    const streak = L.reviewStreak(store.days, todayISO());
    $("dcStreakBadge").textContent = streak ? streak + " day streak" : "No streak yet";
    const limit = day && day.review ? day.review.phoneLimit : store.settings.phoneLimit;
    $("dcLimitBadge").textContent = "Phone limit " + limit + "h";

    // Never miss twice: one missed review is data, two in a row is a pattern.
    let msg = "";
    const first = firstUseDate();
    const yday = L.addDays(todayISO(), -1);
    if (!first) msg = "Start with a morning plan. It takes about two minutes.";
    else if (selected === "today" && yday >= first && !L.scoreDay(store.days[yday] || {}).complete) {
      msg = "Yesterday has no review. One miss is data, two is a pattern. Tap Yesterday and score it now.";
    }
    $("dcNudge").textContent = msg;
    $("dcNudge").classList.toggle("hidden", !msg);
  }

  /* ---------------- Today: morning plan ---------------- */

  function renderMorning() {
    const day = store.days[selectedDate()];
    const m = day && day.morning;
    const showForm = !m || editingMorning;
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
    if (m.keyTask.text) rows.push(checkRow("key", "★ " + m.keyTask.text, m.keyTask.done, true));
    m.priorities.forEach(function (p, i) { if (p.text) rows.push(checkRow("p" + i, p.text, p.done, false)); });
    $("dcMorningSummary").innerHTML =
      '<p class="field-hint">Tap each one as you finish it.</p>' +
      '<div class="dc-checklist">' + rows.join("") + '</div>' +
      (m.distraction ? '<p class="dc-line"><strong>Distraction to watch:</strong> ' + esc(m.distraction) + '</p>' : "") +
      (m.plan ? '<p class="dc-line"><strong>Your plan:</strong> ' + esc(m.plan) + '</p>' : "");
  }

  function checkRow(id, text, done, key) {
    return '<button type="button" class="dc-check' + (done ? " done" : "") + (key ? " key" : "") + '" role="checkbox" aria-checked="' + done + '" data-check="' + id + '">' +
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
    core().showToast(old ? "Plan updated." : "Plan locked in.");
  }

  function handleMorningSummaryClick(e) {
    const btn = e.target.closest(".dc-check");
    if (!btn) return;
    const day = store.days[selectedDate()];
    if (!day || !day.morning) return;
    const id = btn.getAttribute("data-check");
    const item = id === "key" ? day.morning.keyTask : day.morning.priorities[Number(id.slice(1))];
    if (!item) return;
    item.done = !item.done;
    save();
    renderMorning();
    renderResult();
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
    if (group.hasAttribute("data-rating")) draft[group.getAttribute("data-rating")] = Number(raw);
    else if (group.getAttribute("data-item") === "phone") draft.items.phone = raw === "na" ? "na" : null;
    else draft.items[group.getAttribute("data-item")] = raw;
    $("dcMissing").classList.add("hidden");
    // Update the buttons in place (rebuilding them would drop keyboard focus).
    const current = group.hasAttribute("data-rating") ? draft[group.getAttribute("data-rating")] : group.getAttribute("data-item") === "phone" ? (draft.items.phone === "na" ? "na" : "") : draft.items[group.getAttribute("data-item")];
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
    // Bring the score into view; no animation for people who've asked their device to reduce motion.
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    $("dcResult").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
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
      '<p class="field-hint">Built from your answers only. This is not AI, and it is feedback, not a grade on you.</p>';
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
    renderMorning();
    renderReviewHint();
    renderResult();
  }

  /* ---------------- Trends ---------------- */

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

    const dates = Object.keys(store.days).filter(function (d) { return store.days[d].morning || store.days[d].review; }).sort().reverse().slice(0, 14);
    $("dcRecent").innerHTML = dates.length ? dates.map(function (date) {
      const day = store.days[date];
      const r = L.scoreDay(day);
      const status = r.complete ? '<span class="dc-recent-score">' + r.score + '</span>' : '<span class="field-hint">' + (day.morning ? "Plan only, no score" : "No score") + '</span>';
      return '<div class="dc-recent-row"><div><strong>' + esc(prettyDate(date)) + '</strong> <span class="field-hint">' + esc(L.DAY_TYPES[day.type].label) + '</span>' +
        (day.review && day.review.improve ? '<div class="field-hint">Note for next day: ' + esc(day.review.improve) + '</div>' : "") + '</div>' + status + '</div>';
    }).join("") : '<div class="empty-state">Nothing logged yet. Lock in a morning plan on the Today tab to begin.</div>';
  }

  /* ---------------- Setup ---------------- */

  function renderSetup() {
    $("dcPhoneLimit").value = store.settings.phoneLimit;
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

  /* ---------------- wiring ---------------- */

  function renderEverything() {
    loadReviewForm();
    renderAllToday();
    renderTrends();
    renderSetup();
  }

  function onSubTabChange(targetId) {
    if (targetId === "discipline-today") { if (selectedDate() !== renderedDate) loadReviewForm(); renderAllToday(); }
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
      hasData: !!firstUseDate(),
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
      selected = btn.getAttribute("data-day") === "yesterday" ? "yesterday" : "today";
      editingMorning = false;
      loadReviewForm();
      renderAllToday();
    });
    $("dcMorningForm").addEventListener("submit", handleMorningSubmit);
    $("dcMorningEditBtn").addEventListener("click", function () { editingMorning = true; renderMorning(); $("dcKeyTask").focus(); });
    $("dcMorningSummary").addEventListener("click", handleMorningSummaryClick);
    $("dcReviewForm").addEventListener("click", handleReviewClick);
    $("dcReviewForm").addEventListener("submit", handleReviewSubmit);
    $("dcDayType").addEventListener("change", handleDayTypeChange);
    $("dcWindowPills").addEventListener("click", function (e) {
      const btn = e.target.closest("[data-window]");
      if (!btn) return;
      trendWindow = btn.getAttribute("data-window") === "30" ? 30 : 7;
      renderTrends();
    });
    $("dcSetupForm").addEventListener("submit", handleSetupSubmit);

    // An app left open past midnight should roll over to the new day when it comes back to the front.
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && selectedDate() !== renderedDate) {
        editingMorning = false;
        renderEverything();
      }
    });

    renderEverything();
  }

  window.JarvisDiscipline = { init: init, getSummary: getSummary, onSubTabChange: onSubTabChange };
})();
