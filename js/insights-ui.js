/* ==========================================================================
   JARVIS — Workout: the training assistant's screens.

   Two places show it, both optional and both explaining themselves:
     - Progress: a "What I noticed" card (cardHtml), with a Why under every note, a way to hide a
       note, and switches to turn the notes off.
     - The logger: a short line under an exercise when the routine you are doing says you are ready for
       a little more weight (loggerNote), and "Swap for something similar" in the exercise menu.

   It is a handful of plain rules (insights-logic.js) applied to your own saved workouts. It is not an
   AI model. It never changes a weight on its own: a suggested weight is applied only when you tap
   "Use", only to sets you have not finished, and the undo bar puts it back. Swapping an exercise is
   only offered before any set of it is done, changes only today's workout, and can be undone too.

   Settings and hidden notes: jarvisInsightPrefs { cards, logger, dismissed } (in the cloud backup).
   ========================================================================== */

(function () {
  "use strict";

  const IL = window.JarvisInsightsLogic;
  const WL = window.JarvisWorkoutLogic;
  const LS = "jarvisInsightPrefs";
  const SHOWN = 4;

  let prefs = null;
  let started = false;
  let showAll = false;
  let settingsOpen = false;   // the Settings box stays open while you flip its switches

  function core() { return window.JarvisCore; }
  function esc(v) { return core().escapeHtml(v === undefined || v === null ? "" : String(v)); }
  function api() { return window.JarvisWorkout.api; }
  function kit() { return window.JarvisWorkoutUI && window.JarvisWorkoutUI.kit; }
  function JE() { return window.JarvisExercises; }
  function plural(n, one, many) { return n === 1 ? one : (many || one + "s"); }
  function today() { return WL.dayKey(Date.now()); }
  function exName(id) { const e = JE().getExerciseById(id); return e ? e.name : "Unknown exercise"; }
  function fmt(n) { return String(Math.round(Number(n) * 100) / 100); }
  function ready() { return !!(IL && WL && window.JarvisWorkout && window.JarvisWorkout.api && window.JarvisExercises && window.JarvisCore); }

  /* ---------------- settings ---------------- */

  function loadPrefs() { prefs = IL.prune(IL.sanitizePrefs(core().loadJSON(LS, null)), today()); }
  function getPrefs() { if (!prefs) loadPrefs(); return prefs; }
  function savePrefs() { core().saveJSON(LS, prefs); }

  function context() {
    const a = api();
    return {
      workouts: a.getWorkouts(), routines: a.activeRoutines ? a.activeRoutines() : a.getRoutines(), todayKey: today(),
      lookup: function (id) { return JE().getFineMuscleTargets(id); },
      label: function (m) { return a.muscleName ? a.muscleName(m) : IL.defaultLabel(m); },
      nameOf: exName, prefs: getPrefs()
    };
  }

  /* ---------------- Progress: the "What I noticed" card ---------------- */

  function itemHtml(n) {
    return '<li class="pg-in-item pg-in-' + esc(n.tone) + '">' +
      '<p class="pg-in-kicker">' + esc(n.kicker) + '</p>' +
      '<h3 class="pg-in-title">' + esc(n.title) + '</h3>' +
      '<p class="pg-in-text">' + esc(n.text) + '</p>' +
      '<details class="pg-in-why"><summary>Why</summary><ul class="pg-plain">' + n.why.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join("") + '</ul></details>' +
      '<button type="button" class="wk-link pg-in-hide" data-in="card-hide" data-key="' + esc(n.key) + '">Hide this note</button></li>';
  }

  function readinessHtml(r) {
    return '<ul class="pg-in-ready" aria-label="What each kind of note needs">' + r.lines.map(function (l) {
      return '<li><strong>' + esc(l.label) + ':</strong> ' + (l.ok ? 'enough history, nothing to point out right now.' : 'needs ' + esc(l.need) + '.') + '</li>';
    }).join("") + '</ul>';
  }

  function settingsHtml(p) {
    return '<details class="pg-in-settings"' + (settingsOpen ? " open" : "") + '><summary>Settings</summary>' +
      '<label class="wk-check-row"><input type="checkbox" id="inCards"' + (p.cards ? " checked" : "") + '> <span>Show these notes here</span></label>' +
      '<label class="wk-check-row"><input type="checkbox" id="inLogger"' + (p.logger ? " checked" : "") + '> <span>Suggest a weight while I train</span></label>' +
      '<p class="field-hint">A suggested weight is only a suggestion. It is applied when you tap Use, never before.</p></details>';
  }

  function cardHtml() {
    if (!ready()) return "";
    try {
      const p = getPrefs();
      const head = '<h2 class="card-title" id="pgInsightsH" tabindex="-1">What I noticed</h2>' +
        '<p class="field-hint">Plain rules applied to your own workout log. This is not an AI and not medical advice. Open Why on a note to see the numbers and the rule. These notes look at fixed stretches of time, written in each Why, not at the period picked above.</p>';
      if (!p.cards) {
        return '<section class="card pg-sec pg-in" id="pgInsights" aria-labelledby="pgInsightsH">' + head +
          '<p class="pg-in-off">The notes are turned off.</p><button type="button" class="btn btn-secondary" data-in="card-on">Turn them on</button>' + settingsHtml(p) + '</section>';
      }
      const out = IL.buildInsights(context());
      const shown = showAll ? out.items : out.items.slice(0, SHOWN);
      let body;
      if (out.items.length) {
        body = '<ul class="pg-in-list">' + shown.map(itemHtml).join("") + '</ul>' +
          (out.items.length > shown.length ? '<button type="button" class="btn btn-secondary pg-more" data-in="card-more">Show ' + (out.items.length - shown.length) + ' more</button>' : "");
      } else {
        body = '<p class="pg-in-none">' + (out.readiness.workouts ? 'Nothing to point out right now.' : 'Nothing yet. Notes appear after you have saved some workouts.') + '</p>' + readinessHtml(out.readiness);
      }
      const hidden = out.hidden
        ? '<p class="pg-in-hidden">' + out.hidden + ' hidden ' + plural(out.hidden, "note") + '. <button type="button" class="wk-link" data-in="card-restore">Show ' + (out.hidden === 1 ? "it" : "them") + ' again</button></p>' : "";
      return '<section class="card pg-sec pg-in" id="pgInsights" aria-labelledby="pgInsightsH">' + head + body + hidden + settingsHtml(p) + '</section>';
    } catch (e) {
      return "";
    }
  }

  function rerenderProgress(focusHeading) {
    if (window.JarvisProgressUI) window.JarvisProgressUI.render();
    if (focusHeading) { const h = document.getElementById("pgInsightsH"); if (h) h.focus({ preventScroll: true }); }
  }

  /* ---------------- the logger: a suggestion line, a Why sheet, a swap ---------------- */

  function findEx(sessionExId) {
    const d = api().getDraft();
    for (let i = 0; i < d.exercises.length; i++) if (d.exercises[i].sessionExId === sessionExId) return { se: d.exercises[i], idx: i, d: d };
    return null;
  }

  // The plan this exercise has in the routine being done (nothing for a free workout or an exercise added on the spot).
  function planFor(d, exerciseId) {
    if (!d.routineId) return null;
    const r = api().routineById(d.routineId);
    const re = r ? (r.exercises || []).filter(function (x) { return x.exerciseId === exerciseId; })[0] : null;
    return re ? WL.plannedSetsOf(re) : null;
  }

  function suggestionFor(d, se) {
    const plan = planFor(d, se.exerciseId);
    if (!plan) return null;
    return IL.progressionFor(api().getWorkouts(), se.exerciseId, { plan: plan, todayKey: today(), name: exName(se.exerciseId) });
  }

  // The line under "Last time:" for one exercise in the logger. Empty when there is nothing to say, when you turned it off,
  // or once you have started the exercise (a new weight halfway through the sets would only be confusing).
  function loggerNote(d, se) {
    try {
      if (!ready() || !getPrefs().logger || !IL.canSwap(se)) return "";
      const s = suggestionFor(d, se);
      if (!s || (s.kind !== "increase" && s.kind !== "hold")) return "";
      if (s.kind === "increase") {
        const open = se.sets.filter(function (x) { return !x.completed && !x.warmup && !x.dropset && !(Number(x.weight) === s.to); });
        if (!open.length) return "";
        return '<div class="wk-sugg" role="group" aria-label="Suggestion for ' + esc(exName(se.exerciseId)) + '">' +
          '<p class="wk-sugg-text"><strong>' + esc(s.title) + '.</strong> ' + esc(s.text) + ' Your sets are still at ' + esc(fmt(s.from)) + ' until you tap Use.</p>' +
          '<div class="wk-sugg-actions"><button type="button" class="btn btn-primary" data-in="use" data-ex="' + esc(se.sessionExId) + '" data-w="' + esc(s.to) + '" aria-label="Use ' + esc(fmt(s.to)) + ' lb for ' + esc(exName(se.exerciseId)) + '">Use ' + esc(fmt(s.to)) + ' lb</button>' +
          '<button type="button" class="btn btn-secondary" data-in="why" data-ex="' + esc(se.sessionExId) + '">Why?</button></div></div>';
      }
      return '<div class="wk-sugg wk-sugg-hold" role="group" aria-label="Note for ' + esc(exName(se.exerciseId)) + '">' +
        '<p class="wk-sugg-text"><strong>' + esc(s.title) + '.</strong> ' + esc(s.text) + '</p>' +
        '<div class="wk-sugg-actions"><button type="button" class="btn btn-secondary" data-in="why" data-ex="' + esc(se.sessionExId) + '">Why?</button></div></div>';
    } catch (e) {
      return "";
    }
  }

  // The exercise menu's swap entry (disabled with the reason once a set is done).
  function swapMenuItem(se) {
    if (!ready()) return "";
    if (!IL.canSwap(se)) return '<button type="button" class="wk-menu-item" disabled aria-describedby="inSwapWhy">Swap for something similar</button><p class="field-hint" id="inSwapWhy">Not available after a set is done in this exercise.</p>';
    return '<button type="button" class="wk-menu-item" data-in="swap-open" data-ex="' + esc(se.sessionExId) + '">Swap for something similar</button>';
  }

  function openWhy(sessionExId) {
    const f = findEx(sessionExId), k = kit();
    if (!f || !k) return;
    const s = suggestionFor(f.d, f.se);
    if (!s || !s.why) return;
    const name = exName(f.se.exerciseId);
    k.openSheet(s.kind === "increase" ? "Why " + fmt(s.to) + " lb?" : "Why " + fmt(s.from) + " lb?",
      '<p class="wk-sheet-sub">' + esc(name) + '</p><ul class="pg-plain">' + s.why.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join("") + '</ul>' +
      '<p class="field-hint">These are plain rules applied to your own workouts, not an AI. They can be wrong for you.</p>' +
      '<div class="wk-sheet-actions">' +
        (s.kind === "increase" ? '<button type="button" class="btn btn-primary wk-big-btn" data-in="use" data-ex="' + esc(sessionExId) + '" data-w="' + esc(s.to) + '">Use ' + esc(fmt(s.to)) + ' lb</button>' : "") +
        '<button type="button" class="btn btn-secondary wk-big-btn" data-wk="sheet-close">Keep ' + esc(fmt(s.from)) + ' lb</button>' +
        '<button type="button" class="wk-link" data-in="logger-off">Stop suggesting weights while I train</button></div>');
  }

  function useWeight(sessionExId, weight) {
    const f = findEx(sessionExId), k = kit();
    if (!f || !k) return;
    const res = IL.applyWeight(f.se, Number(weight));
    if (!res.changed.length) { k.closeSheet(true); return; }
    k.pushUndo("Set " + res.changed.length + " " + plural(res.changed.length, "set") + " to " + fmt(weight) + " lb.");   // the undo bar keeps the workout as it was
    f.d.exercises[f.idx] = res.exercise;
    api().saveDraft();
    k.closeSheet(true);
    if (window.JarvisWorkoutUI.render) window.JarvisWorkoutUI.render();
    k.announce("Set " + res.changed.length + " " + plural(res.changed.length, "set") + " to " + fmt(weight) + " pounds. Nothing is marked done.");
    k.focusSoon('[data-ex-card="' + sessionExId + '"] .wk-ex-toggle', false);
  }

  function swapCardHtml(sessionExId, c) {
    return '<li class="in-swap-item"><button type="button" class="btn btn-secondary in-swap-pick" data-in="swap-pick" data-ex="' + esc(sessionExId) + '" data-id="' + esc(c.exerciseId) + '">' +
      '<span class="in-swap-name">' + esc(c.name) + '</span><span class="in-swap-sub">' + esc([c.muscleGroup, c.equipment].filter(Boolean).join(" · ")) + (c.lastText ? " · last " + esc(c.lastText) : "") + '</span></button>' +
      '<details class="pg-in-why"><summary>Why this one</summary><ul class="pg-plain">' + c.why.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join("") + '</ul></details></li>';
  }

  function openSwap(sessionExId) {
    const f = findEx(sessionExId), k = kit();
    if (!f || !k) return;
    const name = exName(f.se.exerciseId);
    const inWorkout = f.d.exercises.map(function (e) { return e.exerciseId; });
    const c = context();
    const res = IL.substitutes(f.se.exerciseId, { library: JE().getExercises(), lookup: c.lookup, workouts: c.workouts, exclude: inWorkout, label: c.label, todayKey: c.todayKey, limit: 6 });
    let body;
    if (!IL.canSwap(f.se)) body = '<p class="wk-sheet-text">A set in this exercise is already done, so it can\'t be swapped. Remove the exercise from its menu and add another instead.</p>';
    else if (!res.items.length) body = '<p class="wk-sheet-text">' + (res.reason === "no-muscles" ? 'JARVIS has no muscle information for ' + esc(name) + ', so it can\'t match anything to it.' : 'Nothing else in your exercise list works the same main muscle.') + ' You can still remove it from its menu and add another exercise.</p>';
    else body = '<p class="wk-sheet-text">Same main muscle as ' + esc(name) + ', best match first. Only today\'s workout changes; your routine stays as it is. Your set count and rep targets carry over. Weights come from your own history of the new exercise, or stay blank.</p>' +
      '<ul class="in-swap-list">' + res.items.map(function (x) { return swapCardHtml(sessionExId, x); }).join("") + '</ul>' +
      '<p class="field-hint">Matched by the muscle tags in JARVIS\'s exercise list and by the name. It can\'t tell what is safe if something hurts; for that, ask someone qualified.</p>';
    k.openSheet("Swap " + name, body);
  }

  function doSwap(sessionExId, newId) {
    const f = findEx(sessionExId), k = kit();
    if (!f || !k || !IL.canSwap(f.se)) return;
    const from = exName(f.se.exerciseId), to = exName(newId);
    k.pushUndo("Swapped " + from + " for " + to + ".");
    f.d.exercises[f.idx] = IL.swapExercise(f.se, newId, api().getWorkouts());
    api().saveDraft();
    k.closeSheet(true);
    if (window.JarvisWorkoutUI.render) window.JarvisWorkoutUI.render();
    k.announce("Swapped " + from + " for " + to + ". Nothing is marked done.");
    k.focusSoon('[data-ex-card="' + sessionExId + '"] .wk-ex-toggle', false);
  }

  /* ---------------- events ---------------- */

  function onClick(e) {
    const el = e.target.closest && e.target.closest("[data-in]");
    if (!el || !ready()) return;
    const act = el.getAttribute("data-in");
    const p = getPrefs();
    settingsOpen = false;
    switch (act) {
      case "card-hide": {
        const key = el.getAttribute("data-key");
        prefs = IL.dismiss(p, key, today()); savePrefs();
        const k = kit();
        if (k) k.pushUndo("Hid a note.", null, function () { const q = getPrefs(); delete q.dismissed[key]; savePrefs(); rerenderProgress(false); });
        rerenderProgress(true);
        break;
      }
      case "card-restore": prefs = IL.clearDismissed(p); savePrefs(); rerenderProgress(true); break;
      case "card-more": showAll = true; rerenderProgress(false); break;
      case "card-on": prefs = Object.assign({}, p, { cards: true }); savePrefs(); rerenderProgress(true); break;
      case "why": openWhy(el.getAttribute("data-ex")); break;
      case "use": useWeight(el.getAttribute("data-ex"), el.getAttribute("data-w")); break;
      case "swap-open": openSwap(el.getAttribute("data-ex")); break;
      case "swap-pick": doSwap(el.getAttribute("data-ex"), el.getAttribute("data-id")); break;
      case "logger-off": {
        prefs = Object.assign({}, p, { logger: false }); savePrefs();
        const k = kit(); if (k) k.closeSheet(true);
        if (window.JarvisWorkoutUI && window.JarvisWorkoutUI.render) window.JarvisWorkoutUI.render();
        core().showToast("Weight suggestions are off. You can turn them on under Progress, What I noticed, Settings.");
        break;
      }
      default: break;
    }
  }

  function onChange(e) {
    const t = e.target;
    if (!t || (t.id !== "inCards" && t.id !== "inLogger") || !ready()) return;
    const p = getPrefs();
    prefs = Object.assign({}, p, t.id === "inCards" ? { cards: t.checked } : { logger: t.checked });
    savePrefs();
    settingsOpen = true;
    if (t.id === "inCards") { rerenderProgress(false); const box = document.getElementById("inCards"); if (box) box.focus({ preventScroll: true }); }
    else if (window.JarvisWorkoutUI && window.JarvisWorkoutUI.render) window.JarvisWorkoutUI.render();
  }

  function init() {
    if (started || !ready()) return;
    started = true;
    loadPrefs();
    document.addEventListener("click", onClick);
    document.addEventListener("change", onChange);
  }

  window.JarvisInsights = { init: init, cardHtml: cardHtml, loggerNote: loggerNote, swapMenuItem: swapMenuItem, prefs: getPrefs };
})();
