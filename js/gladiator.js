/* ==========================================================================
   JARVIS — Gladiator Mode
   A focused-execution overlay, not a theme switch: entering it hides the
   normal nav and fills the screen with exactly one mission — Training,
   Business, Habits, Study, or Deep Work — drawn from JARVIS's real data via
   the small `.gladiator` sub-objects each domain module exports
   (window.JarvisWorkout.gladiator / JarvisHabits.gladiator /
   JarvisBusiness.gladiator). This file owns no domain data of its own; it
   only orchestrates those reads/writes plus two small additive keys:

     jarvisGladiatorSessions — array, one entry per finished/abandoned
                               mission run (for "how many missions this
                               week" across types — never per-set detail,
                               that still lives in the owning domain).
     jarvisGladiatorState    — single object, lets a killed/reopened PWA
                               resume mid-mission for Study/Deep Work/Habits
                               (Training already resumes for free via the
                               real jarvisWorkoutDraft).

   Design spec: docs/gladiator-mode-design.md
   ========================================================================== */

(function () {
  "use strict";

  const LS_SESSIONS = "jarvisGladiatorSessions";
  const LS_STATE = "jarvisGladiatorState";

  function core() { return window.JarvisCore; }

  function loadSessions() { return core().loadJSON(LS_SESSIONS, []); }
  function saveSessions(v) { core().saveJSON(LS_SESSIONS, v); }

  function defaultState() {
    return {
      activeSessionId: null, type: null, startedAt: null, objective: null,
      endsAt: null, label: null,
      habitsQueue: null, habitsQueueIndex: 0,
      studyQueue: null, studyQueueIndex: 0
    };
  }
  function loadState() { return core().loadJSON(LS_STATE, defaultState()); }
  function saveState(v) { core().saveJSON(LS_STATE, v); }

  function hapticPulse(pattern) {
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) { /* unsupported */ } }
  }

  /* ---------------- transient in-memory mission state ---------------- */

  let state = loadState();
  let overlayEl = null;
  let tickInterval = null;
  let restEndsAt = null; // absolute ms timestamp, or null when not resting
  let habitsQueueCache = null; // [{id,name,dailyTarget,countToday,streak}] frozen at mission start
  let studyQueueCache = null;  // [{id,text,category,time}] frozen at mission start

  function fmtMMSS(sec) {
    sec = Math.max(0, Math.round(sec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function fmtDate(iso) {
    try {
      const c = core();
      if (c && c.formatDate) return c.formatDate(iso);
    } catch (e) { /* fall through */ }
    return iso;
  }

  function escapeHtml(s) {
    return core().escapeHtml(String(s == null ? "" : s));
  }

  /* ==========================================================================
     The Lineup — the one structural shape every mission type renders with.
     An ordered list where exactly one item is "current" (rendered large, as
     the hero) and the rest are "done"/"pending" (rendered small). One
     render function, reused by every mission and by the debrief's receipt.
     ========================================================================== */

  function renderLineup(items, heroHtml, opts) {
    opts = opts || {};
    if (!items || items.length === 0) return heroHtml || "";
    const nonCurrent = items.filter(function (it) { return it.state !== "current"; });
    const density = nonCurrent.length > 4 ? "pill" : "line";
    const rows = items.map(function (it, i) {
      if (it.state === "current") {
        return '<div class="lineup-row is-hero" data-lineup-id="' + escapeHtml(it.id) + '">' + (heroHtml || "") + "</div>";
      }
      const glyph = it.state === "done" ? '<span class="lineup-glyph lineup-glyph-done">&#10003;</span>' : '<span class="lineup-glyph lineup-glyph-pending"></span>';
      const jumpable = opts.onJumpAttr && it.state !== "current";
      const label = density === "pill" ? escapeHtml(it.label).slice(0, 4).toUpperCase() : escapeHtml(it.label);
      const meta = density === "line" && it.meta ? '<span class="lineup-meta">' + escapeHtml(it.meta) + "</span>" : "";
      return (
        '<div class="lineup-row" data-density="' + density + '" data-state="' + it.state + '"' +
        (jumpable ? ' data-' + opts.onJumpAttr + '="' + i + '"' : "") + ">" +
        glyph + '<span class="lineup-label">' + label + "</span>" + meta +
        "</div>"
      );
    });
    return '<div class="lineup lineup-density-' + density + '">' + rows.join("") + "</div>";
  }

  /* ---------------- shell chrome ---------------- */

  function missionTypeLabel(type) {
    return { training: "TRAINING", business: "BUSINESS", habits: "HABITS", study: "STUDY", deepwork: "DEEP WORK" }[type] || "";
  }

  function elapsedLabel() {
    if (!state.startedAt) return "";
    return fmtMMSS((Date.now() - state.startedAt) / 1000);
  }

  function topBarHtml(showTimer) {
    return (
      '<div class="gladiator-topbar">' +
        '<button type="button" class="gladiator-exit-btn" id="gladiatorExitBtn" aria-label="Exit Gladiator Mode">&#10005;</button>' +
        '<span class="gladiator-topbar-title">' + escapeHtml(missionTypeLabel(state.type)) + "</span>" +
        '<span class="gladiator-topbar-timer" id="gladiatorElapsed">' + (showTimer ? elapsedLabel() : "") + "</span>" +
      "</div>"
    );
  }

  function render(html) {
    if (!overlayEl) return;
    overlayEl.innerHTML = html;
    wireScreen();
  }

  /* ==========================================================================
     Mission-select screen
     ========================================================================== */

  function gladiatorHasAnyMissionAvailable() {
    try {
      if (window.JarvisWorkout && window.JarvisWorkout.gladiator.getCandidate()) return true;
      if (window.JarvisBusiness && window.JarvisBusiness.gladiator.getTopTask()) return true;
      if (window.JarvisHabits && window.JarvisHabits.gladiator.getRemainingToday().length > 0) return true;
    } catch (e) { /* a module not yet initialized — treat as unavailable */ }
    return false;
  }

  function refreshEntryButton() {
    const btn = document.getElementById("gladiatorEntryBtn");
    if (!btn) return;
    btn.classList.toggle("has-mission", gladiatorHasAnyMissionAvailable());
  }

  function cardShell(eyebrow, bodyHtml, enterLabel, enterAttrs) {
    return (
      '<div class="gladiator-card" ' + (enterAttrs.cardAttrs || "") + '>' +
        '<div class="gladiator-card-eyebrow">' + escapeHtml(eyebrow) + "</div>" +
        bodyHtml +
        '<button type="button" class="gladiator-card-enter-btn" ' + (enterAttrs.btnAttrs || "") + ">" + escapeHtml(enterLabel) + " &#9656;</button>" +
      "</div>"
    );
  }

  function trainingCardHtml() {
    const JW = window.JarvisWorkout;
    const candidate = JW ? JW.gladiator.getCandidate() : null;
    if (!candidate) {
      return cardShell("TRAINING",
        '<div class="gladiator-card-empty">No routine queued — build one in Workout &rarr; Routines</div>',
        "OPEN ROUTINES", { btnAttrs: 'data-gladiator-action="open-routines"' });
    }
    const body =
      (candidate.resume ? '<div class="gladiator-card-eyebrow">RESUME</div>' : "") +
      '<div class="gladiator-card-title">' + escapeHtml(candidate.label) + "</div>" +
      '<div class="gladiator-card-meta">' + escapeHtml(candidate.meta) + "</div>";
    return cardShell("TRAINING", body, "ENTER", {
      cardAttrs: 'data-gladiator-enter="training"',
      btnAttrs: 'data-gladiator-enter="training"'
    });
  }

  function businessCardHtml() {
    const JB = window.JarvisBusiness;
    const task = JB ? JB.gladiator.getTopTask() : null;
    if (!task) {
      return cardShell("BUSINESS", '<div class="gladiator-card-empty">No open tasks in Business &rarr; Tasks</div>', "OPEN TASKS", { btnAttrs: 'data-gladiator-action="open-tasks"' });
    }
    const priorityLabel = task.priority ? (task.priority.charAt(0).toUpperCase() + task.priority.slice(1)) : "";
    const meta = priorityLabel + " priority" + (task.deadline ? " · due " + fmtDate(task.deadline) : "");
    const body =
      '<div class="gladiator-card-title">' + escapeHtml(task.text) + "</div>" +
      '<div class="gladiator-card-meta">' + escapeHtml(meta) + "</div>";
    return cardShell("BUSINESS", body, "ENTER", { cardAttrs: 'data-gladiator-enter="business"', btnAttrs: 'data-gladiator-enter="business"' });
  }

  function habitsCardHtml() {
    const JH = window.JarvisHabits;
    const remaining = JH ? JH.gladiator.getRemainingToday() : [];
    if (remaining.length === 0) {
      return (
        '<div class="gladiator-card">' +
          '<div class="gladiator-card-eyebrow">HABITS</div>' +
          '<div class="gladiator-card-title gladiator-text-green">All habits complete today</div>' +
        "</div>"
      );
    }
    const preview = remaining.slice(0, 3).map(function (h) {
      return '<div class="lineup-row" data-density="line" data-state="pending"><span class="lineup-glyph lineup-glyph-pending"></span><span class="lineup-label">' + escapeHtml(h.name) + "</span></div>";
    }).join("") + (remaining.length > 3 ? '<div class="lineup-row" data-density="line" data-state="pending"><span class="lineup-label gladiator-text-faint">+' + (remaining.length - 3) + " more</span></div>" : "");
    const body =
      '<div class="gladiator-card-title">' + remaining.length + " habit" + (remaining.length === 1 ? "" : "s") + " remaining today</div>" +
      '<div class="lineup lineup-density-line">' + preview + "</div>";
    return cardShell("HABITS", body, "ENTER", { cardAttrs: 'data-gladiator-enter="habits"', btnAttrs: 'data-gladiator-enter="habits"' });
  }

  function studyCardHtml() {
    const JH = window.JarvisHabits;
    const candidates = JH ? JH.gladiator.getStudyCandidates() : [];
    if (candidates.length === 0) {
      return cardShell("STUDY", '<div class="gladiator-card-empty">No tasks tagged \'Study\' — add one in Habits &rarr; Tasks, or run Deep Work instead</div>', "GO TO DEEP WORK", { btnAttrs: 'data-gladiator-action="goto-deepwork"' });
    }
    const suffix = candidates.length > 1 ? " <span class=\"gladiator-text-faint\">+" + (candidates.length - 1) + " more</span>" : "";
    const body = '<div class="gladiator-card-title">' + escapeHtml(candidates[0].text) + suffix + "</div>";
    return cardShell("STUDY", body, "ENTER", { cardAttrs: 'data-gladiator-enter="study"', btnAttrs: 'data-gladiator-enter="study"' });
  }

  function deepWorkCardHtml() {
    const body =
      '<div class="gladiator-card-title">Pick a focus block</div>' +
      '<div class="gladiator-deepwork-chips">' +
        [25, 45, 60, 90].map(function (m) { return '<button type="button" class="gladiator-chip" data-gladiator-deepwork-min="' + m + '">' + m + "m</button>"; }).join("") +
        '<button type="button" class="gladiator-chip" data-gladiator-deepwork-custom="1">Custom</button>' +
      "</div>";
    return '<div class="gladiator-card"><div class="gladiator-card-eyebrow">DEEP WORK</div>' + body + "</div>";
  }

  function renderMissionSelect() {
    state = defaultState();
    const html =
      '<div class="gladiator-select-screen">' +
        topBarHtml(false) +
        '<div class="gladiator-select-heading">GLADIATOR MODE</div>' +
        '<div class="gladiator-card-list">' +
          trainingCardHtml() + businessCardHtml() + habitsCardHtml() + studyCardHtml() + deepWorkCardHtml() +
        "</div>" +
      "</div>";
    render(html);
  }

  /* ==========================================================================
     Training execution
     ========================================================================== */

  function trainingCoachLine(view) {
    if (!view) return "";
    if (view.target && view.prefillWeight) {
      return "Last time you hit " + view.prefillWeight + "×" + Math.round(view.prefillReps || 0) + " here — beat it or match it.";
    }
    return "First logged set for " + view.name + " — today sets the baseline.";
  }

  function renderTrainingExecution() {
    const JW = window.JarvisWorkout.gladiator;
    const outer = JW.getExerciseLineup();
    const view = JW.getActiveView();
    if (!view) { renderMissionSelect(); return; }

    const resting = restEndsAt !== null;
    const heroBody =
      '<div class="gladiator-exercise-name">' + escapeHtml(view.name) + "</div>" +
      '<div class="gladiator-exercise-sub">' + escapeHtml(view.muscleGroup || "") + "</div>" +
      '<div class="gladiator-inner-lineup">' + renderLineup(view.setsLineup, null, {}) + "</div>" +
      '<div class="gladiator-set-heading">SET ' + view.setNumber + (view.totalPlanned ? " OF " + view.totalPlanned : "") + "</div>" +
      (view.target ? '<div class="gladiator-set-target">Target: ' + view.target.reps + " reps</div>" : "");

    const bodyHtml = resting
      ? (
          '<div class="gladiator-rest-block">' +
            '<div class="gladiator-rest-label">RESTING — <span id="gladiatorRestClock">' + fmtMMSS((restEndsAt - Date.now()) / 1000) + "</span></div>" +
            '<button type="button" class="gladiator-ghost-btn" id="gladiatorSkipRestBtn">Skip Rest</button>' +
          "</div>"
        )
      : (
          '<div class="gladiator-stepper-row">' +
            '<button type="button" class="gladiator-stepper-btn" data-gladiator-step="weight" data-gladiator-delta="-5">&minus;</button>' +
            '<input type="number" inputmode="decimal" class="gladiator-stepper-value" id="gladiatorWeightInput" value="' + escapeHtml(view.prefillWeight || "") + '">' +
            '<button type="button" class="gladiator-stepper-btn" data-gladiator-step="weight" data-gladiator-delta="5">+</button>' +
          "</div>" +
          '<div class="gladiator-stepper-row">' +
            '<button type="button" class="gladiator-stepper-btn" data-gladiator-step="reps" data-gladiator-delta="-1">&minus;</button>' +
            '<input type="number" inputmode="numeric" class="gladiator-stepper-value" id="gladiatorRepsInput" value="' + escapeHtml(view.prefillReps || "") + '">' +
            '<button type="button" class="gladiator-stepper-btn" data-gladiator-step="reps" data-gladiator-delta="1">+</button>' +
          "</div>" +
          '<div class="gladiator-segmented" id="gladiatorSetTypeSeg">' +
            ["normal", "warmup", "dropset"].map(function (t) {
              return '<button type="button" class="gladiator-seg-btn' + (view.setType === t ? " active" : "") + '" data-gladiator-settype="' + t + '">' + (t === "normal" ? "Normal" : t === "warmup" ? "Warm-up" : "Drop set") + "</button>";
            }).join("") +
          "</div>" +
          '<button type="button" class="gladiator-primary-btn" id="gladiatorLogSetBtn">LOG SET</button>'
        );

    const html =
      '<div class="gladiator-execution-screen">' +
        topBarHtml(true) +
        renderLineup(outer, heroBody, { onJumpAttr: "gladiator-jump" }) +
        '<div class="gladiator-coach-line" id="gladiatorCoachLine">' + escapeHtml(trainingCoachLine(view)) + "</div>" +
        '<div class="gladiator-body">' + bodyHtml + "</div>" +
        '<div class="gladiator-footer-row">' +
          '<button type="button" class="gladiator-ghost-btn" id="gladiatorPrevBtn">&lsaquo; Prev</button>' +
          '<button type="button" class="gladiator-ghost-btn" id="gladiatorFinishBtn">Finish Mission</button>' +
        "</div>" +
      "</div>";
    render(html);
  }

  function handleTrainingLogSet() {
    const JW = window.JarvisWorkout.gladiator;
    const weightEl = document.getElementById("gladiatorWeightInput");
    const repsEl = document.getElementById("gladiatorRepsInput");
    const segBtn = overlayEl.querySelector(".gladiator-seg-btn.active");
    const type = segBtn ? segBtn.getAttribute("data-gladiator-settype") : "normal";
    const viewBeforeLog = JW.getActiveView();
    const wasLastPlannedSet = !!(viewBeforeLog && viewBeforeLog.isLastSet && viewBeforeLog.target);
    const result = JW.logSet(weightEl.value, repsEl.value, type);
    if (!result.ok) return;
    if (result.isPr) {
      hapticPulse(30);
      const line = document.getElementById("gladiatorCoachLine");
      if (line) {
        line.textContent = "New e1RM PR — " + result.newE1rm + " lb (prev " + result.prevE1rm + ").";
        line.classList.add("gladiator-text-purple");
      }
    }
    if (wasLastPlannedSet) {
      // Exercise complete — brief pause on the finished state, then auto-advance.
      restEndsAt = null;
      renderTrainingExecution();
      setTimeout(function () {
        const outer = JW.getExerciseLineup();
        if (outer.some(function (o) { return o.state === "pending"; })) JW.nextExercise();
        renderTrainingExecution();
        startTick();
      }, 1200);
      return;
    }
    const freshView = JW.getActiveView();
    restEndsAt = Date.now() + JW.getRestSeconds(freshView ? freshView.isLastSet : false) * 1000;
    renderTrainingExecution();
    startTick();
  }

  function handleTrainingFinish(force) {
    const JW = window.JarvisWorkout.gladiator;
    const openCount = JW.countUntouchedExercises();
    if (openCount > 0 && !force) {
      core().showToast(openCount + " exercise(s) still open. Hold Finish to end anyway.");
      return;
    }
    const result = JW.finish();
    if (!result) {
      core().showToast("Add at least one set (with a weight and reps filled in) before finishing.");
      return;
    }
    const endedAt = Date.now();
    const startedAt = state.startedAt;
    logGladiatorSession({
      type: "training", label: result.label, startedAt: startedAt, endedAt: endedAt,
      durationSec: Math.round((endedAt - startedAt) / 1000), completed: true, result: result
    });
    renderTrainingDebrief(result, startedAt, endedAt);
  }

  function renderTrainingDebrief(result, startedAt, endedAt) {
    hapticPulse(result.prCount > 0 ? [20, 40, 20] : [20]);
    const JW = window.JarvisWorkout.gladiator;
    const outer = JW.getExerciseLineup().map(function (o) { return Object.assign({}, o, { state: o.state === "pending" ? "pending" : "done" }); });
    const minutes = Math.round((endedAt - startedAt) / 60000);
    let comparisonHtml;
    if (result.prevVolume === null) {
      comparisonHtml = '<div class="gladiator-debrief-line">No prior ' + escapeHtml(result.label) + " session to compare — this is the first.</div>";
    } else {
      const pct = result.prevVolume > 0 ? Math.round(((result.volume - result.prevVolume) / result.prevVolume) * 100) : 0;
      comparisonHtml = '<div class="gladiator-debrief-line">Compared with last ' + escapeHtml(result.label) + ": Volume " + (pct >= 0 ? "&uarr;" : "&darr;") + Math.abs(pct) + "%</div>";
    }
    let takeaway;
    if (result.prCount > 0) takeaway = "New e1RM PR this session — " + result.prCount + " exercise(s) hit a new best.";
    else if (result.volume > (result.prevVolume || 0)) takeaway = "Volume beat your last " + result.label + " session.";
    else if (result.prevVolume === null) takeaway = "First logged " + result.label + " — today's numbers are the baseline to beat next time.";
    else takeaway = result.streak + "-day training streak — showing up is the stat that compounds.";

    const html =
      '<div class="gladiator-debrief-screen">' +
        '<div class="gladiator-debrief-eyebrow">MISSION COMPLETE</div>' +
        '<div class="gladiator-debrief-title">' + escapeHtml(result.label) + " — " + minutes + " min</div>" +
        renderLineup(outer, null, {}) +
        '<div class="gladiator-debrief-stats">' +
          '<div class="gladiator-debrief-stat"><span>Exercises</span><span>' + result.exercisesCompleted + " / " + result.exercisesTotal + "</span></div>" +
          '<div class="gladiator-debrief-stat"><span>Working Sets</span><span>' + result.workingSets + "</span></div>" +
          '<div class="gladiator-debrief-stat"><span>PRs</span><span>' + result.prCount + "</span></div>" +
          '<div class="gladiator-debrief-stat"><span>Total Volume</span><span>' + result.volume.toLocaleString() + " lb</span></div>" +
        "</div>" +
        comparisonHtml +
        '<div class="gladiator-coach-line">' + escapeHtml(takeaway) + "</div>" +
        '<button type="button" class="gladiator-primary-btn" id="gladiatorDebriefFinishBtn">FINISH</button>' +
      "</div>";
    render(html);
  }

  /* ==========================================================================
     Business mission
     ========================================================================== */

  function renderBusinessExecution() {
    const JB = window.JarvisBusiness.gladiator;
    const items = JB.getOpenTasksRanked(3);
    if (items.length === 0) { renderMissionSelect(); return; }
    const task = items[0];
    const lineupItems = items.map(function (t, i) { return { id: t.id, label: t.text, state: i === 0 ? "current" : "pending" }; });
    const priorityLabel = task.priority ? (task.priority.charAt(0).toUpperCase() + task.priority.slice(1)) : "";
    const heroBody =
      '<div class="gladiator-exercise-name">' + escapeHtml(task.text) + "</div>" +
      '<div class="gladiator-exercise-sub">' + escapeHtml(priorityLabel) + " priority" + (task.deadline ? " · due " + fmtDate(task.deadline) : "") + "</div>" +
      (task.notes ? '<div class="gladiator-task-notes">' + escapeHtml(task.notes) + "</div>" : "");
    const html =
      '<div class="gladiator-execution-screen">' +
        topBarHtml(true) +
        renderLineup(lineupItems, heroBody, {}) +
        '<div class="gladiator-body">' +
          '<button type="button" class="gladiator-primary-btn" id="gladiatorBizCompleteBtn" data-task-id="' + escapeHtml(task.id) + '">MARK TASK COMPLETE</button>' +
          '<button type="button" class="gladiator-ghost-btn" id="gladiatorBizEndBtn">Not done yet — end session</button>' +
        "</div>" +
      "</div>";
    render(html);
  }

  function finishBusiness(taskId, completed) {
    const JB = window.JarvisBusiness.gladiator;
    const task = JB.getOpenTasksRanked(50).find(function (t) { return t.id === taskId; }) || { text: "Task", id: taskId };
    if (completed) JB.completeTask(taskId);
    const endedAt = Date.now();
    logGladiatorSession({
      type: "business", label: task.text, startedAt: state.startedAt, endedAt: endedAt,
      durationSec: Math.round((endedAt - state.startedAt) / 1000), completed: completed, result: { taskText: task.text, completed: completed }
    });
    hapticPulse([20]);
    const remainingOpen = JB.getOpenTasksRanked(999).length;
    const takeaway = remainingOpen === 0 ? "Task list is clear." : (remainingOpen + " task(s) still open — Gladiator again when you're ready for the next one.");
    const html =
      '<div class="gladiator-debrief-screen">' +
        '<div class="gladiator-debrief-eyebrow">MISSION COMPLETE</div>' +
        '<div class="gladiator-debrief-line">' + (completed ? "&#10003; " : "") + escapeHtml(task.text) + "</div>" +
        '<div class="gladiator-debrief-line">Status: ' + (completed ? "Completed" : "Not finished — ended early") + "</div>" +
        '<div class="gladiator-coach-line">' + escapeHtml(takeaway) + "</div>" +
        '<button type="button" class="gladiator-primary-btn" id="gladiatorDebriefFinishBtn">FINISH</button>' +
      "</div>";
    render(html);
  }

  /* ==========================================================================
     Habits mission
     ========================================================================== */

  function renderHabitsExecution() {
    if (!habitsQueueCache) {
      habitsQueueCache = window.JarvisHabits.gladiator.getRemainingToday();
      state.habitsQueue = habitsQueueCache.map(function (h) { return h.id; });
      state.habitsQueueIndex = 0;
      saveState(state);
    }
    if (state.habitsQueueIndex >= habitsQueueCache.length) { finishHabits(); return; }
    const current = habitsQueueCache[state.habitsQueueIndex];
    const lineupItems = habitsQueueCache.map(function (h, i) {
      return { id: h.id, label: h.name, state: i < state.habitsQueueIndex ? "done" : (i === state.habitsQueueIndex ? "current" : "pending") };
    });
    const heroBody =
      '<div class="gladiator-exercise-name">' + escapeHtml(current.name) + "</div>" +
      (current.dailyTarget > 1 ? '<div class="gladiator-exercise-sub">' + current.countToday + " of " + current.dailyTarget + " today</div>" : "");
    const html =
      '<div class="gladiator-execution-screen">' +
        topBarHtml(true) +
        renderLineup(lineupItems, heroBody, {}) +
        '<div class="gladiator-body">' +
          '<button type="button" class="gladiator-big-circle-btn" id="gladiatorHabitDoneBtn">' + (current.dailyTarget > 1 ? "LOG REP" : "MARK DONE") + "</button>" +
        "</div>" +
      "</div>";
    render(html);
  }

  function handleHabitDone() {
    const current = habitsQueueCache[state.habitsQueueIndex];
    const result = window.JarvisHabits.gladiator.incrementHabit(current.id);
    hapticPulse([15]);
    if (!result || result.done) {
      state.habitsQueueIndex++;
      saveState(state);
      setTimeout(renderHabitsExecution, 300);
    } else {
      // Count-habit not yet at target — stay on it, just re-render for fresh count.
      current.countToday = result.count;
      renderHabitsExecution();
    }
  }

  function finishHabits() {
    const endedAt = Date.now();
    const startedAt = state.startedAt;
    const doneCount = habitsQueueCache.length; // every item in queue was marked done to reach here
    const rows = habitsQueueCache.map(function (h) { return { id: h.id, label: h.name, state: "done", meta: null }; });
    logGladiatorSession({
      type: "habits", label: doneCount + " habits", startedAt: startedAt, endedAt: endedAt,
      durationSec: Math.round((endedAt - startedAt) / 1000), completed: true, result: { count: doneCount }
    });
    hapticPulse([20]);
    const html =
      '<div class="gladiator-debrief-screen">' +
        '<div class="gladiator-debrief-eyebrow">MISSION COMPLETE</div>' +
        '<div class="gladiator-debrief-title">' + doneCount + "/" + doneCount + " habits — " + fmtMMSS((endedAt - startedAt) / 1000) + "</div>" +
        renderLineup(rows, null, {}) +
        '<div class="gladiator-coach-line">All ' + doneCount + " habits complete today.</div>" +
        '<button type="button" class="gladiator-primary-btn" id="gladiatorDebriefFinishBtn">FINISH</button>' +
      "</div>";
    render(html);
  }

  /* ==========================================================================
     Study mission (same queue mechanism as Habits)
     ========================================================================== */

  function renderStudyExecution() {
    if (!studyQueueCache) {
      studyQueueCache = window.JarvisHabits.gladiator.getStudyCandidates();
      state.studyQueue = studyQueueCache.map(function (t) { return t.id; });
      state.studyQueueIndex = 0;
      saveState(state);
    }
    if (studyQueueCache.length === 0) { renderMissionSelect(); return; }
    if (state.studyQueueIndex >= studyQueueCache.length) { finishStudy(); return; }
    const current = studyQueueCache[state.studyQueueIndex];
    const lineupItems = studyQueueCache.map(function (t, i) {
      return { id: t.id, label: t.text, state: i < state.studyQueueIndex ? "done" : (i === state.studyQueueIndex ? "current" : "pending") };
    });
    const heroBody = '<div class="gladiator-exercise-name">' + escapeHtml(current.text) + "</div>";
    const html =
      '<div class="gladiator-execution-screen">' +
        topBarHtml(true) +
        renderLineup(lineupItems, heroBody, {}) +
        '<div class="gladiator-body">' +
          '<button type="button" class="gladiator-primary-btn" id="gladiatorStudyCompleteBtn">MARK COMPLETE</button>' +
          '<button type="button" class="gladiator-ghost-btn" id="gladiatorStudyEndBtn">End Session</button>' +
        "</div>" +
      "</div>";
    render(html);
  }

  function handleStudyComplete() {
    const current = studyQueueCache[state.studyQueueIndex];
    window.JarvisHabits.gladiator.completeTask(current.id);
    hapticPulse([15]);
    state.studyQueueIndex++;
    saveState(state);
    renderStudyExecution();
  }

  function finishStudy() {
    const endedAt = Date.now();
    const sessionsThisWeek = loadSessions().filter(function (s) {
      return s.type === "study" && isThisIsoWeek(s.startedAt);
    }).length + 1;
    logGladiatorSession({
      type: "study", label: "Study session", startedAt: state.startedAt, endedAt: endedAt,
      durationSec: Math.round((endedAt - state.startedAt) / 1000), completed: true, result: { count: studyQueueCache.length }
    });
    hapticPulse([20]);
    const rows = studyQueueCache.map(function (t) { return { id: t.id, label: t.text, state: "done" }; });
    const html =
      '<div class="gladiator-debrief-screen">' +
        '<div class="gladiator-debrief-eyebrow">MISSION COMPLETE</div>' +
        renderLineup(rows, null, {}) +
        '<div class="gladiator-debrief-line">Status: Completed</div>' +
        '<div class="gladiator-coach-line">This is your ' + ordinal(sessionsThisWeek) + " Study session logged this week.</div>" +
        '<button type="button" class="gladiator-primary-btn" id="gladiatorDebriefFinishBtn">FINISH</button>' +
      "</div>";
    render(html);
  }

  /* ==========================================================================
     Deep Work mission
     ========================================================================== */

  function startDeepWork(minutes, label) {
    state = defaultState();
    state.type = "deepwork";
    state.startedAt = Date.now();
    state.endsAt = state.startedAt + minutes * 60000;
    state.label = label || "Deep Work Session";
    saveState(state);
    enterChrome();
    renderDeepWorkExecution();
    startTick();
  }

  function renderDeepWorkExecution() {
    const remaining = Math.max(0, state.endsAt - Date.now());
    const html =
      '<div class="gladiator-execution-screen">' +
        topBarHtml(false) +
        '<div class="gladiator-body gladiator-deepwork-body">' +
          (state.label && state.label !== "Deep Work Session" ? '<div class="gladiator-exercise-sub">' + escapeHtml(state.label) + "</div>" : "") +
          '<div class="gladiator-countdown" id="gladiatorCountdown">' + fmtMMSS(remaining / 1000) + "</div>" +
          '<button type="button" class="gladiator-ghost-btn" id="gladiatorDeepWorkEndBtn">End Early</button>' +
        "</div>" +
      "</div>";
    render(html);
  }

  function finishDeepWork() {
    const endedAt = Date.now();
    const startedAt = state.startedAt;
    const label = state.label;
    const plannedMin = Math.round((state.endsAt - startedAt) / 60000);
    const actualMin = Math.round((endedAt - startedAt) / 60000);
    logGladiatorSession({
      type: "deepwork", label: label, startedAt: startedAt, endedAt: endedAt,
      durationSec: Math.round((endedAt - startedAt) / 1000), completed: true, result: { plannedMin: plannedMin, actualMin: actualMin }
    });
    hapticPulse([20]);
    const weekSessions = loadSessions().filter(function (s) { return s.type === "deepwork" && isThisIsoWeek(s.startedAt); });
    const totalMin = weekSessions.reduce(function (sum, s) { return sum + Math.round((s.durationSec || 0) / 60); }, 0);
    const html =
      '<div class="gladiator-debrief-screen">' +
        '<div class="gladiator-debrief-eyebrow">MISSION COMPLETE</div>' +
        '<div class="gladiator-debrief-title">' + escapeHtml(label) + " — " + plannedMin + " min planned, " + actualMin + " min run</div>" +
        '<div class="gladiator-coach-line">' + weekSessions.length + " Deep Work session" + (weekSessions.length === 1 ? "" : "s") + " this week, " + totalMin + " min total.</div>" +
        '<button type="button" class="gladiator-primary-btn" id="gladiatorDebriefFinishBtn">FINISH</button>' +
      "</div>";
    render(html);
  }

  /* ---------------- shared helpers ---------------- */

  function ordinal(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function isThisIsoWeek(ts) {
    const d = new Date(ts);
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    start.setHours(0, 0, 0, 0);
    return d >= start;
  }

  function logGladiatorSession(entry) {
    entry.id = core().uid("glad");
    const sessions = loadSessions();
    sessions.push(entry);
    saveSessions(sessions);
    state = defaultState();
    saveState(state);
    habitsQueueCache = null;
    studyQueueCache = null;
    restEndsAt = null;
    stopTick();
  }

  /* ---------------- timer tick (absolute-timestamp based) ---------------- */

  function startTick() {
    stopTick();
    tickInterval = setInterval(onTick, 1000);
    onTick();
  }
  function stopTick() {
    if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
  }
  function onTick() {
    if (!overlayEl || overlayEl.classList.contains("hidden")) { stopTick(); return; }
    const timerEl = document.getElementById("gladiatorElapsed");
    if (timerEl && state.startedAt) timerEl.textContent = elapsedLabel();
    if (restEndsAt !== null) {
      const remaining = restEndsAt - Date.now();
      const clock = document.getElementById("gladiatorRestClock");
      if (remaining <= 0) {
        hapticPulse(15);
        restEndsAt = null;
        if (state.type === "training") renderTrainingExecution();
      } else if (clock) {
        clock.textContent = fmtMMSS(remaining / 1000);
      }
    }
    if (state.type === "deepwork" && state.endsAt) {
      const remaining = state.endsAt - Date.now();
      const cd = document.getElementById("gladiatorCountdown");
      if (remaining <= 0) {
        finishDeepWork();
      } else if (cd) {
        cd.textContent = fmtMMSS(remaining / 1000);
      }
    }
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") onTick();
  });

  /* ---------------- navigation chrome ---------------- */

  function enterChrome() {
    document.body.classList.add("gladiator-active");
  }
  function exitChrome() {
    document.body.classList.remove("gladiator-active");
    stopTick();
  }

  function open(opts) {
    opts = opts || {};
    enterChrome();
    if (!overlayEl) overlayEl = document.getElementById("gladiatorOverlay");
    overlayEl.classList.remove("hidden");
    overlayEl.setAttribute("aria-hidden", "false");
    if (opts.preselect === "training") enterMission("training");
    else renderMissionSelect();
  }

  function close() {
    exitChrome();
    if (overlayEl) { overlayEl.classList.add("hidden"); overlayEl.setAttribute("aria-hidden", "true"); }
    refreshEntryButton();
  }

  function enterMission(type, source) {
    habitsQueueCache = null;
    studyQueueCache = null;
    restEndsAt = null;
    state = defaultState();
    state.type = type;
    state.startedAt = Date.now();
    saveState(state);
    if (type === "training") {
      window.JarvisWorkout.gladiator.start(source || null);
      renderTrainingExecution();
    } else if (type === "business") {
      renderBusinessExecution();
    } else if (type === "habits") {
      renderHabitsExecution();
    } else if (type === "study") {
      renderStudyExecution();
    }
    startTick();
  }

  /* ---------------- event wiring (delegated, re-bound on every render) ---------------- */

  let finishHoldTimer = null;

  function wireScreen() {
    if (!overlayEl) return;

    const exitBtn = document.getElementById("gladiatorExitBtn");
    if (exitBtn) exitBtn.addEventListener("click", handleExitTap);

    overlayEl.querySelectorAll("[data-gladiator-enter]").forEach(function (el) {
      el.addEventListener("click", function () {
        const type = el.getAttribute("data-gladiator-enter");
        if (type === "training") {
          const candidate = window.JarvisWorkout.gladiator.getCandidate();
          enterMission("training", candidate && !candidate.resume ? candidate.source : null);
        } else {
          enterMission(type);
        }
      });
    });

    overlayEl.querySelectorAll("[data-gladiator-action]").forEach(function (el) {
      el.addEventListener("click", function () {
        const action = el.getAttribute("data-gladiator-action");
        if (action === "open-routines") { close(); navigateTo("panel-workout", "workout-routines"); }
        else if (action === "open-tasks") { close(); navigateTo("panel-business", "biz-tasks"); }
        else if (action === "goto-deepwork") { /* stay on mission select, no-op scroll target in this simplified build */ }
      });
    });

    overlayEl.querySelectorAll("[data-gladiator-deepwork-min]").forEach(function (el) {
      el.addEventListener("click", function () { startDeepWork(Number(el.getAttribute("data-gladiator-deepwork-min")), ""); });
    });
    const customBtn = overlayEl.querySelector("[data-gladiator-deepwork-custom]");
    if (customBtn) {
      customBtn.addEventListener("click", function () {
        const input = window.prompt("Focus block length in minutes (5–180):", "30");
        if (input === null) return;
        const minutes = Math.min(180, Math.max(5, Math.round(Number(input) || 0)));
        if (minutes < 5) { core().showToast("Enter at least 5 minutes."); return; }
        startDeepWork(minutes, "");
      });
    }

    // Training execution
    overlayEl.querySelectorAll("[data-gladiator-jump]").forEach(function (el) {
      el.addEventListener("click", function () { window.JarvisWorkout.gladiator.jumpToExercise(Number(el.getAttribute("data-gladiator-jump"))); renderTrainingExecution(); });
    });
    const logSetBtn = document.getElementById("gladiatorLogSetBtn");
    if (logSetBtn) logSetBtn.addEventListener("click", handleTrainingLogSet);
    const skipRestBtn = document.getElementById("gladiatorSkipRestBtn");
    if (skipRestBtn) skipRestBtn.addEventListener("click", function () { restEndsAt = null; renderTrainingExecution(); });
    overlayEl.querySelectorAll("[data-gladiator-step]").forEach(function (el) {
      el.addEventListener("click", function () {
        const field = el.getAttribute("data-gladiator-step");
        const delta = Number(el.getAttribute("data-gladiator-delta"));
        const input = document.getElementById(field === "weight" ? "gladiatorWeightInput" : "gladiatorRepsInput");
        input.value = Math.max(0, (Number(input.value) || 0) + delta);
      });
    });
    overlayEl.querySelectorAll("[data-gladiator-settype]").forEach(function (el) {
      el.addEventListener("click", function () {
        overlayEl.querySelectorAll(".gladiator-seg-btn").forEach(function (b) { b.classList.remove("active"); });
        el.classList.add("active");
      });
    });
    const prevBtn = document.getElementById("gladiatorPrevBtn");
    if (prevBtn) prevBtn.addEventListener("click", function () { window.JarvisWorkout.gladiator.prevExercise(); restEndsAt = null; renderTrainingExecution(); });
    const finishBtn = document.getElementById("gladiatorFinishBtn");
    if (finishBtn) {
      finishBtn.addEventListener("click", function () { handleTrainingFinish(false); });
      finishBtn.addEventListener("mousedown", function () { finishHoldTimer = setTimeout(function () { handleTrainingFinish(true); }, 600); });
      finishBtn.addEventListener("touchstart", function () { finishHoldTimer = setTimeout(function () { handleTrainingFinish(true); }, 600); }, { passive: true });
      ["mouseup", "mouseleave", "touchend"].forEach(function (evt) {
        finishBtn.addEventListener(evt, function () { if (finishHoldTimer) { clearTimeout(finishHoldTimer); finishHoldTimer = null; } });
      });
    }

    // Business
    const bizCompleteBtn = document.getElementById("gladiatorBizCompleteBtn");
    if (bizCompleteBtn) bizCompleteBtn.addEventListener("click", function () { finishBusiness(bizCompleteBtn.getAttribute("data-task-id"), true); });
    const bizEndBtn = document.getElementById("gladiatorBizEndBtn");
    if (bizEndBtn) bizEndBtn.addEventListener("click", function () {
      const task = window.JarvisBusiness.gladiator.getOpenTasksRanked(1)[0];
      finishBusiness(task ? task.id : null, false);
    });

    // Habits
    const habitDoneBtn = document.getElementById("gladiatorHabitDoneBtn");
    if (habitDoneBtn) habitDoneBtn.addEventListener("click", handleHabitDone);

    // Study
    const studyCompleteBtn = document.getElementById("gladiatorStudyCompleteBtn");
    if (studyCompleteBtn) studyCompleteBtn.addEventListener("click", handleStudyComplete);
    const studyEndBtn = document.getElementById("gladiatorStudyEndBtn");
    if (studyEndBtn) studyEndBtn.addEventListener("click", function () {
      const endedAt = Date.now();
      logGladiatorSession({
        type: "study", label: "Study session", startedAt: state.startedAt, endedAt: endedAt,
        durationSec: Math.round((endedAt - state.startedAt) / 1000), completed: false, result: { count: state.studyQueueIndex }
      });
      close();
    });

    // Deep Work
    const dwEndBtn = document.getElementById("gladiatorDeepWorkEndBtn");
    if (dwEndBtn) dwEndBtn.addEventListener("click", finishDeepWork);

    // Debrief
    const debriefFinishBtn = document.getElementById("gladiatorDebriefFinishBtn");
    if (debriefFinishBtn) debriefFinishBtn.addEventListener("click", close);
  }

  function handleExitTap() {
    if (state.type === "training") {
      const summary = window.JarvisWorkout.gladiator.getDraftSummary();
      if (summary.sets === 0) {
        if (!confirm("Exit without logging anything?")) return;
      }
      close();
      return;
    }
    close();
  }

  function navigateTo(panelId, subTargetId) {
    const navBtn = document.querySelector('.main-nav-btn[data-target="' + panelId + '"]');
    if (navBtn) navBtn.click();
    if (subTargetId) {
      setTimeout(function () {
        const subBtn = document.querySelector('[data-subtarget="' + subTargetId + '"]');
        if (subBtn) subBtn.click();
      }, 50);
    }
  }

  /* ---------------- boot ---------------- */

  function init() {
    overlayEl = document.getElementById("gladiatorOverlay");
    const entryBtn = document.getElementById("gladiatorEntryBtn");
    if (entryBtn) entryBtn.addEventListener("click", function () { open({}); });
    refreshEntryButton();

    // Resume mid-mission after a killed/reopened PWA (Training resumes for
    // free via jarvisWorkoutDraft itself; this covers Habits/Study/Deep Work).
    if (state.activeSessionId === null && state.type) {
      // state.type set but no activeSessionId means a stale partial write;
      // ignore and fall through to a clean mission-select on next open().
    }
    if (state.type === "deepwork" && state.endsAt) {
      if (Date.now() >= state.endsAt) {
        enterChrome();
        overlayEl.classList.remove("hidden");
        finishDeepWork();
      } else {
        enterChrome();
        overlayEl.classList.remove("hidden");
        renderDeepWorkExecution();
        startTick();
      }
    } else if (state.type === "habits" && state.habitsQueue) {
      enterChrome();
      overlayEl.classList.remove("hidden");
      habitsQueueCache = state.habitsQueue.map(function (id) {
        return window.JarvisHabits.gladiator.getRemainingToday().find(function (h) { return h.id === id; }) || { id: id, name: "Habit", dailyTarget: 1, countToday: 0, streak: 0 };
      });
      renderHabitsExecution();
      startTick();
    } else if (state.type === "study" && state.studyQueue) {
      enterChrome();
      overlayEl.classList.remove("hidden");
      studyQueueCache = window.JarvisHabits.gladiator.getStudyCandidates().filter(function (t) { return state.studyQueue.indexOf(t.id) !== -1; });
      renderStudyExecution();
      startTick();
    }
  }

  document.addEventListener("DOMContentLoaded", init);

  window.JarvisGladiator = { open: open, close: close, refreshEntryButton: refreshEntryButton };
})();
