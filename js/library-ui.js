/* ==========================================================================
   JARVIS — Workout: the Exercise Library screen (Routines -> Exercise library) and the
   exercise detail sheet that the workout menu and the picker also use.

   Browse every exercise (the built-in ones and yours), search by name, muscle or equipment,
   filter by muscle group and equipment, open one for how to do it, which muscles it works, your own
   history with it, a demo link and your notes. Add, rename and delete your own exercises; a
   near-duplicate ("Bench Press" next to "Barbell Bench Press") is flagged before it is created, and an
   exercise that is already in your history or a routine can be renamed but not deleted.

   The instructions are general guidance in exercise-guides.js. The demo button opens a YouTube search in
   a new tab (JARVIS does not pick or review the videos). Your note and link per exercise are saved in
   jarvisExerciseExtras (in the cloud backup). Rules are in exercise-logic.js.
   ========================================================================== */

(function () {
  "use strict";

  const EL = window.JarvisExerciseLogic;
  const WL = window.JarvisWorkoutLogic;
  const PL = window.JarvisProgressLogic;
  const LS_EXTRAS = "jarvisExerciseExtras";
  const PAGE = 40;

  const state = { query: "", muscle: "", equipment: "", favs: false, mine: false, shown: PAGE };
  let started = false;
  let extras = null;

  function $(id) { return document.getElementById(id); }
  function core() { return window.JarvisCore; }
  function esc(v) { return core().escapeHtml(v === undefined || v === null ? "" : String(v)); }
  function api() { return window.JarvisWorkout.api; }
  function kit() { return window.JarvisWorkoutUI && window.JarvisWorkoutUI.kit; }
  function JE() { return window.JarvisExercises; }
  function plural(n, one, many) { return n === 1 ? one : (many || one + "s"); }
  function all() { return JE().getExercises(); }
  function info(id) { return JE().getExerciseById(id); }
  function muscleLabel(m) { return api().muscleName ? api().muscleName(m) : m; }
  function prettyDate(key) { const p = String(key).split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  function ready() { return !!(EL && WL && window.JarvisWorkout && window.JarvisWorkout.api && window.JarvisExercises && window.JarvisCore && kit()); }

  /* ---------------- your notes and links ---------------- */

  function getExtras() { if (!extras) extras = EL.sanitizeExtras(core().loadJSON(LS_EXTRAS, {})); return extras; }
  function saveExtras(next) { extras = next; core().saveJSON(LS_EXTRAS, next); }

  /* ---------------- the screen ---------------- */

  const STAR = '<svg class="wk-star' + '%ON%' + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.8l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.7l-5.9 3.1 1.2-6.5L2.5 9.7l6.6-.9z"/></svg>';
  function star(on) { return STAR.replace("%ON%", on ? " is-on" : ""); }

  function optionsHtml(label, counts, order, current) {
    return '<option value="">' + esc(label) + '</option>' + order.map(function (g) {
      return '<option value="' + esc(g) + '"' + (g === current ? " selected" : "") + '>' + esc(g) + ' (' + (counts[g] || 0) + ')</option>';
    }).join("");
  }

  function shellHtml() {
    const list = all();
    const mine = list.filter(function (e) { return e.custom; }).length;
    return '<section class="wk-block" aria-labelledby="lbH"><h2 class="wk-block-title" id="lbH" tabindex="-1">Exercise library</h2>' +
      '<p class="field-hint">' + list.length + ' exercises' + (mine ? ', ' + mine + ' of them yours' : '') + '. Search, filter, and tap one to see how to do it.</p></section>' +
      '<div class="card lb-controls">' +
        '<div class="form-row"><label for="lbSearch">Search</label><input id="lbSearch" type="search" placeholder="Name, muscle or equipment" autocomplete="off" autocapitalize="off" enterkeyhint="search" value="' + esc(state.query) + '"></div>' +
        '<div class="form-row two-col"><div><label for="lbMuscle">Muscle group</label><select id="lbMuscle">' + optionsHtml("All", EL.counts(list, "muscleGroup"), JE().MUSCLE_GROUPS, state.muscle) + '</select></div>' +
        '<div><label for="lbEquip">Equipment</label><select id="lbEquip">' + optionsHtml("All", EL.counts(list, "equipment"), JE().EQUIPMENT_TYPES, state.equipment) + '</select></div></div>' +
        '<div class="wk-chips" role="group" aria-label="Show only"><button type="button" class="wk-chip" id="lbFavChip" data-lb="chip-fav" aria-pressed="' + state.favs + '">Favorites</button>' +
        '<button type="button" class="wk-chip" id="lbMineChip" data-lb="chip-mine" aria-pressed="' + state.mine + '">My exercises</button>' +
        '<button type="button" class="wk-link" data-lb="clear">Clear</button></div>' +
      '</div>' +
      '<p class="lb-count" id="lbCount" role="status" aria-live="polite"></p>' +
      '<div id="lbResults" class="lb-results"></div>' +
      '<div class="lb-foot"><button type="button" class="btn btn-secondary wk-big-btn" data-lb="add">Add your own exercise</button></div>';
  }

  function rowHtml(e) {
    const fav = JE().isFavorite(e.id);
    return '<li class="lb-row"><button type="button" class="lb-open" data-lb="open" data-id="' + esc(e.id) + '"><span class="lb-name">' + esc(e.name) + (e.custom ? ' <span class="wk-tag">Yours</span>' : '') + '</span><span class="lb-sub">' + esc([e.muscleGroup, e.equipment].filter(Boolean).join(" · ")) + '</span></button>' +
      '<button type="button" class="wk-icon-btn" data-lb="fav" data-id="' + esc(e.id) + '" aria-pressed="' + fav + '" aria-label="' + (fav ? "Remove " : "Add ") + esc(e.name) + (fav ? " from favorites" : " to favorites") + '">' + star(fav) + '</button></li>';
  }

  function renderResults() {
    const box = $("lbResults");
    if (!box) return;
    const list = EL.filterExercises(all(), { query: state.query, muscle: state.muscle, equipment: state.equipment, favoritesOnly: state.favs, favoriteIds: JE().loadFavoriteIds(), customOnly: state.mine });
    const grouped = !state.query.trim() && !state.muscle;
    // Grouped by muscle: the page of results follows the group order (Chest first), not A to Z across all of them.
    const ordered = grouped ? EL.groupBy(list, "muscleGroup", JE().MUSCLE_GROUPS).reduce(function (a, g) { return a.concat(g.items); }, []) : list;
    const shown = ordered.slice(0, state.shown);
    let html;
    if (!list.length) {
      const q = state.query.trim();
      html = '<p class="wk-empty">' + (state.mine && !all().some(function (e) { return e.custom; }) ? 'You haven\'t added any exercises yet.' : 'Nothing matches.') + '</p>' +
        '<div class="lb-empty-actions"><button type="button" class="btn btn-secondary" data-lb="clear">Clear search and filters</button>' + (q ? '<button type="button" class="btn btn-secondary" data-lb="add" data-name="' + esc(q) + '">Add &ldquo;' + esc(q) + '&rdquo; as your own</button>' : '') + '</div>';
    } else if (grouped) {
      html = EL.groupBy(shown, "muscleGroup", JE().MUSCLE_GROUPS).map(function (g) {
        return '<h3 class="wk-sheet-sub">' + esc(g.group) + '</h3><ul class="lb-list">' + g.items.map(rowHtml).join("") + '</ul>';
      }).join("");
    } else {
      html = '<ul class="lb-list">' + shown.map(rowHtml).join("") + '</ul>';
    }
    if (list.length > shown.length) html += '<button type="button" class="btn btn-secondary lb-more" data-lb="more">Show ' + Math.min(PAGE, list.length - shown.length) + ' more</button>';
    box.innerHTML = html;
    const c = $("lbCount");
    if (c) c.textContent = list.length + " " + plural(list.length, "exercise") + (list.length > shown.length ? ", showing " + shown.length : "");
    const fc = $("lbFavChip"), mc = $("lbMineChip");
    if (fc) fc.setAttribute("aria-pressed", String(state.favs));
    if (mc) mc.setAttribute("aria-pressed", String(state.mine));
  }

  function render(keepFocus) {
    const root = $("lbRoot");
    if (!root) return;
    const focusId = keepFocus && document.activeElement && root.contains(document.activeElement) ? document.activeElement.id : "";
    root.innerHTML = shellHtml();
    renderResults();
    if (focusId) { const f = $(focusId); if (f) f.focus({ preventScroll: true }); }
  }

  /* ---------------- the detail sheet ---------------- */

  function historyHtml(e) {
    const workouts = api().getWorkouts();
    const prev = WL.previousPerformance(workouts, e.id);
    if (!prev) return '<p class="wk-sheet-text">You haven\'t logged this exercise yet.</p>';
    const sum = PL ? PL.exerciseSummary(workouts, e.id) : null;
    const best = sum && sum.bestE1rm ? sum.bestE1rm : null;
    return '<ul class="pg-plain"><li>Logged in <strong>' + (sum ? sum.sessions : 1) + '</strong> ' + plural(sum ? sum.sessions : 1, "workout") + '.</li>' +
      '<li>Last time, ' + esc(prettyDate(prev.date)) + ': ' + esc(WL.lastTimeText(prev) || "no working sets") + '.</li>' +
      (best ? '<li>Best estimated 1RM: <strong>' + Math.round(best.value) + ' lb</strong> (' + esc(String(best.weight)) + ' × ' + best.reps + ', ' + esc(prettyDate(best.date)) + '). An estimate from weight and reps, not a tested max.</li>' : '') + '</ul>';
  }

  function musclesHtml(e) {
    const t = JE().getFineMuscleTargets(e.id);
    if (!t || (!t.primary.length && !t.secondary.length)) return "";
    return '<h3 class="wk-sheet-sub">Muscles</h3><p class="wk-sheet-text">' +
      (t.primary.length ? 'Main: <strong>' + esc(t.primary.map(muscleLabel).join(", ")) + '</strong>.' : '') +
      (t.secondary.length ? ' Helping: ' + esc(t.secondary.map(muscleLabel).join(", ")) + '.' : '') + '</p>';
  }

  function guideHtml(e) {
    const g = window.JarvisExerciseGuides ? window.JarvisExerciseGuides.get(e.id) : null;
    if (!g) return '<h3 class="wk-sheet-sub">How to do it</h3><p class="wk-sheet-text">' + (e.custom ? 'This is your own exercise, so there are no built-in instructions. Add your own notes below.' : 'No instructions for this one yet.') + '</p>';
    return '<h3 class="wk-sheet-sub">How to do it</h3><ol class="lb-steps">' +
      '<li><strong>Set up.</strong> ' + esc(g.setup) + '</li><li><strong>Do the rep.</strong> ' + esc(g.move) + '</li><li><strong>Watch for.</strong> ' + esc(g.watch) + '</li></ol>' +
      '<p class="field-hint">General guidance, not personal coaching. It can\'t see you or know your body. If something hurts, stop and ask a qualified coach or clinician.</p>';
  }

  function demoHtml(e) {
    const x = getExtras()[e.id] || {};
    return '<h3 class="wk-sheet-sub">Demo</h3>' +
      '<p><a class="btn btn-secondary lb-link" href="' + esc(EL.demoSearchUrl(e.name)) + '" target="_blank" rel="noopener noreferrer">Find a demo video<span class="visually-hidden"> (opens YouTube search in a new tab)</span></a></p>' +
      '<p class="field-hint">Opens a YouTube search in a new tab. JARVIS doesn\'t choose or review the videos.</p>' +
      (x.video ? '<p class="lb-mine"><a class="wk-link" href="' + esc(x.video) + '" target="_blank" rel="noopener noreferrer">Your saved demo (' + esc(EL.linkHost(x.video)) + ')<span class="visually-hidden"> (opens in a new tab)</span></a></p>' : '') +
      '<div class="form-row"><label for="lbVideo">Your own demo link</label><input id="lbVideo" type="url" inputmode="url" autocomplete="off" autocapitalize="off" placeholder="https://" value="' + esc(x.video || "") + '"></div>' +
      '<p class="dc-error" id="lbVideoErr" role="alert"></p>' +
      '<button type="button" class="btn btn-secondary" data-lb="save-link" data-id="' + esc(e.id) + '">Save link</button>';
  }

  function notesHtml(e) {
    const x = getExtras()[e.id] || {};
    return '<h3 class="wk-sheet-sub">Your notes</h3><div class="form-row"><label for="lbNote">Cues, seat settings, anything you want to remember</label>' +
      '<textarea id="lbNote" rows="3" maxlength="' + EL.NOTE_MAX + '" data-id="' + esc(e.id) + '">' + esc(x.note || "") + '</textarea></div><p class="field-hint" id="lbNoteState" role="status"></p>';
  }

  function detailHtml(e) {
    const fav = JE().isFavorite(e.id);
    const fcKey = EL.formCheckKey(e.id);
    return '<p class="wk-sheet-text">' + esc([e.muscleGroup, e.equipment].filter(Boolean).join(" · ")) + (e.custom ? ' · yours' : '') + '</p>' +
      '<div class="lb-actions"><button type="button" class="btn btn-secondary" data-lb="fav-sheet" data-id="' + esc(e.id) + '" aria-pressed="' + fav + '">' + (fav ? "Remove from favorites" : "Add to favorites") + '</button>' +
      (fcKey ? '<button type="button" class="btn btn-secondary" data-lb="formcheck" data-key="' + esc(fcKey) + '">Check my form</button>' : '') + '</div>' +
      guideHtml(e) + musclesHtml(e) +
      '<h3 class="wk-sheet-sub">Your history</h3>' + historyHtml(e) +
      demoHtml(e) + notesHtml(e) +
      (e.custom ? '<h3 class="wk-sheet-sub">Your exercise</h3><div class="lb-actions"><button type="button" class="btn btn-secondary" data-lb="edit" data-id="' + esc(e.id) + '">Rename or change details</button><button type="button" class="btn btn-danger" data-lb="delete" data-id="' + esc(e.id) + '">Delete</button></div>' : '');
  }

  function openDetail(id) {
    const e = info(id), k = kit();
    if (!e || !k) return;
    k.openSheet(e.name, detailHtml(e));
  }

  /* ---------------- add / rename / delete your own ---------------- */

  function formSheet(editId, prefillName) {
    const k = kit(), e = editId ? info(editId) : null;
    if (!k || (editId && !e)) return;
    const opt = function (list, cur) { return list.map(function (x) { return '<option' + (x === cur ? " selected" : "") + '>' + esc(x) + '</option>'; }).join(""); };
    k.openSheet(e ? "Change " + e.name : "Add your own exercise",
      '<form id="lbForm" class="stacked-form" novalidate data-edit="' + esc(editId || "") + '">' +
      '<div class="form-row"><label for="lbFormName">Name</label><input id="lbFormName" type="text" maxlength="' + EL.NAME_MAX + '" autocomplete="off" value="' + esc(e ? e.name : (prefillName || "")) + '"></div>' +
      '<div class="form-row two-col"><div><label for="lbFormMuscle">Muscle group</label><select id="lbFormMuscle">' + opt(JE().MUSCLE_GROUPS, e ? e.muscleGroup : "") + '</select></div>' +
      '<div><label for="lbFormEquip">Equipment</label><select id="lbFormEquip">' + opt(JE().EQUIPMENT_TYPES, e ? e.equipment : "") + '</select></div></div>' +
      '<div class="lb-formmsg" id="lbFormMsg" role="alert"></div>' +
      '<div class="wk-sheet-actions"><button type="submit" class="btn btn-primary wk-big-btn" id="lbFormSave">' + (e ? "Save changes" : "Add exercise") + '</button></div></form>', { focus: "#lbFormName" });
  }

  function formMessage(html) { const m = $("lbFormMsg"); if (m) m.innerHTML = html; }

  function submitForm(ev) {
    ev.preventDefault();
    const form = ev.target, editId = form.getAttribute("data-edit") || "";
    const res = EL.sanitizeCustom({ name: $("lbFormName").value, muscleGroup: $("lbFormMuscle").value, equipment: $("lbFormEquip").value }, JE().MUSCLE_GROUPS, JE().EQUIPMENT_TYPES);
    if (!res.ok) { formMessage('<p class="dc-error">' + esc(res.error) + '</p>'); $("lbFormName").focus(); return; }
    const found = EL.findSimilar(res.value.name, res.value.equipment, all().filter(function (x) { return x.id !== editId; }));
    if (found.exact) {
      formMessage('<p class="dc-error">You already have &ldquo;' + esc(found.exact.name) + '&rdquo;. <button type="button" class="wk-link" data-lb="open" data-id="' + esc(found.exact.id) + '">See it</button></p>');
      return;
    }
    const sig = res.value.name.toLowerCase() + "|" + res.value.equipment;
    if (found.similar.length && form.getAttribute("data-ack") !== sig) {
      form.setAttribute("data-ack", sig);
      formMessage('<div class="lb-similar"><p><strong>This looks like an exercise you already have:</strong></p><ul class="pg-plain">' + found.similar.map(function (s) {
        return '<li>' + esc(s.exercise.name) + ' &mdash; ' + esc(s.reason) + ' <button type="button" class="wk-link" data-lb="open" data-id="' + esc(s.exercise.id) + '">See it</button></li>';
      }).join("") + '</ul><p class="field-hint">Using the existing one keeps your history in one place. If yours really is different, tap the button again.</p></div>');
      const b = $("lbFormSave"); if (b) b.textContent = editId ? "Save anyway" : "Add anyway";
      kit().announce("This looks like an exercise you already have. Tap the button again to add it anyway.");
      return;
    }
    const k = kit();
    if (editId) {
      JE().updateCustomExercise(editId, res.value);
      k.closeSheet(true);
      core().showToast("Saved.");
      changed();
      openDetail(editId);
    } else {
      const created = JE().addCustomExercise(res.value);
      k.closeSheet(true);
      core().showToast("Added " + created.name + ".");
      changed();
      openDetail(created.id);
    }
  }

  function changed() { render(true); document.dispatchEvent(new Event("jarvis-workout-changed")); }

  function askDelete(id) {
    const e = info(id), k = kit();
    if (!e || !e.custom || !k) return;
    const u = EL.usage(id, { workouts: api().getWorkouts(), routines: api().getRoutines(), draft: api().getDraft() });
    if (u.total > 0) {
      k.openSheet("Can\'t delete " + e.name,
        '<p class="wk-sheet-text">It is used in ' + esc(EL.usageText(u)) + '. Deleting it would leave those showing an unknown exercise, so JARVIS keeps it.</p><p class="wk-sheet-text">You can rename it instead.</p>' +
        '<div class="wk-sheet-actions"><button type="button" class="btn btn-primary wk-big-btn" data-lb="edit" data-id="' + esc(id) + '">Rename or change details</button><button type="button" class="btn btn-secondary wk-big-btn" data-wk="sheet-close">Keep it</button></div>');
      return;
    }
    k.openSheet("Delete " + e.name + "?",
      '<p class="wk-sheet-text">It isn\'t in any workout or routine, so nothing else changes. You can add it again later.</p>' +
      '<div class="wk-sheet-actions"><button type="button" class="btn btn-danger wk-big-btn" data-lb="delete-confirm" data-id="' + esc(id) + '">Delete</button><button type="button" class="btn btn-secondary wk-big-btn" data-wk="sheet-close">Keep it</button></div>');
  }

  function doDelete(id) {
    const e = info(id), k = kit();
    if (!e || !e.custom) return;
    const u = EL.usage(id, { workouts: api().getWorkouts(), routines: api().getRoutines(), draft: api().getDraft() });
    if (u.total > 0) { askDelete(id); return; }   // used since the question was asked
    JE().deleteCustomExercise(id);
    const x = Object.assign({}, getExtras()); delete x[id]; saveExtras(x);
    k.closeSheet(true);
    core().showToast("Deleted " + e.name + ".");
    changed();
  }

  /* ---------------- events ---------------- */

  function onClick(ev) {
    const el = ev.target.closest && ev.target.closest("[data-lb]");
    if (!el || !ready()) return;
    const act = el.getAttribute("data-lb"), id = el.getAttribute("data-id");
    switch (act) {
      case "open": openDetail(id); break;
      case "fav": {
        const on = JE().toggleFavorite(id), e = info(id);
        if (state.favs) { renderResults(); break; }
        el.setAttribute("aria-pressed", String(on));
        el.setAttribute("aria-label", (on ? "Remove " : "Add ") + (e ? e.name : "it") + (on ? " from favorites" : " to favorites"));
        const s = el.querySelector(".wk-star"); if (s) s.classList.toggle("is-on", on);
        kit().announce((e ? e.name : "Exercise") + (on ? " added to favorites." : " removed from favorites."));
        break;
      }
      case "fav-sheet": {
        const on = JE().toggleFavorite(id);
        el.textContent = on ? "Remove from favorites" : "Add to favorites"; el.setAttribute("aria-pressed", String(on));
        renderResults();
        break;
      }
      case "chip-fav": state.favs = !state.favs; state.shown = PAGE; renderResults(); break;
      case "chip-mine": state.mine = !state.mine; state.shown = PAGE; renderResults(); break;
      case "clear": state.query = ""; state.muscle = ""; state.equipment = ""; state.favs = false; state.mine = false; state.shown = PAGE; render(false); { const s = $("lbSearch"); if (s) s.focus({ preventScroll: true }); } break;
      case "more": state.shown += PAGE; renderResults(); break;
      case "add": formSheet("", el.getAttribute("data-name") || ""); break;
      case "edit": formSheet(id); break;
      case "delete": askDelete(id); break;
      case "delete-confirm": doDelete(id); break;
      case "save-link": {
        const res = EL.setVideo(getExtras(), id, $("lbVideo").value);
        const err = $("lbVideoErr");
        if (!res.ok) { if (err) err.textContent = res.error; $("lbVideo").focus(); break; }
        if (err) err.textContent = "";
        saveExtras(res.extras);
        const e = info(id); if (e) { kit().openSheet(e.name, detailHtml(e)); }
        core().showToast($("lbVideo") && res.extras[id] && res.extras[id].video ? "Link saved." : "Link removed.");
        break;
      }
      case "formcheck": {
        kit().closeSheet(true);
        const sel = $("formCheckExerciseSelect");
        if (sel) { sel.value = el.getAttribute("data-key"); sel.dispatchEvent(new Event("change", { bubbles: true })); }
        kit().goTo("workout-form-check");
        window.scrollTo(0, 0);
        break;
      }
      default: break;
    }
  }

  function onInput(ev) {
    if (ev.target.id === "lbSearch") { state.query = ev.target.value; state.shown = PAGE; renderResults(); }
  }

  function onChange(ev) {
    const t = ev.target;
    if (t.id === "lbMuscle") { state.muscle = t.value; state.shown = PAGE; renderResults(); }
    else if (t.id === "lbEquip") { state.equipment = t.value; state.shown = PAGE; renderResults(); }
    else if (t.id === "lbNote") {
      const id = t.getAttribute("data-id");
      const res = EL.setNote(getExtras(), id, t.value);
      const st = $("lbNoteState");
      if (!res.ok) { if (st) st.textContent = res.error; return; }
      saveExtras(res.extras);
      if (st) st.textContent = "Saved.";
    }
  }

  function onSubmit(ev) { if (ev.target && ev.target.id === "lbForm") submitForm(ev); }

  function init() {
    if (started || !$("lbRoot") || !ready()) return;
    started = true;
    document.addEventListener("click", onClick);
    document.addEventListener("input", onInput);
    document.addEventListener("change", onChange);
    document.addEventListener("submit", onSubmit);
    document.addEventListener("jarvis-workout-changed", function () { const p = $("workout-library"); if (p && p.classList.contains("active")) render(true); });
    const tab = $("workoutSubNavLibrary");
    if (tab) tab.addEventListener("click", function () { window.setTimeout(function () { render(false); }, 0); });
    render(false);
  }

  window.JarvisLibraryUI = { init: init, render: render, openDetail: openDetail };
})();
