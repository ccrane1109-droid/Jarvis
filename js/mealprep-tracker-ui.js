/* ==========================================================================
   JARVIS — Meal Prep › Prep Tracker.

   Three things you do around cooking ahead:

   1. Prepared meals (leftovers). Every batch you cook has the date it was prepared, the portions left, where it is kept (refrigerator or
      freezer), a use-by date from general food-safety guidance (USDA FoodSafety.gov: cooked leftovers 3 to 4 days in the refrigerator, frozen
      for best quality within about 3 months, reheated to 165 F), and reheating instructions. "Ate 1" takes a portion off, adds it to your food
      log, and Undo puts both back. Ideas for using food up are suggested as it nears its date.

   2. Prep sessions: grocery shopping, cooking, portioning and reminders. Each session is saved here AND is exactly one event on your
      Calendar (found again by the session's id, so saving twice or editing never makes a second event). If you also put it on your to-do list,
      that task is shown in the Day plan's task list but not drawn on the Calendar a second time, and ticking either one finishes the session.

   3. Meal habits: Eat breakfast, Prepare lunch and Drink water, made in Habits (nothing here is a separate habit system). Eating a planned
      breakfast and preparing a planned lunch tick them for you.
   ========================================================================== */

(function () {
  "use strict";

  const MP = window.JarvisMealPrep;
  if (!MP) return;
  const k = MP.kit, L = k.L, esc = k.esc;
  const KINDS = [["shopping", "Grocery shopping"], ["cooking", "Cooking session"], ["portioning", "Portioning meals"], ["reminder", "Reminder"]];
  const REMIND = [[-1, "No reminder"], [0, "At the time"], [10, "10 minutes before"], [30, "30 minutes before"], [60, "1 hour before"], [1440, "1 day before"]];
  const HABITS = [{ key: "breakfast", name: "Eat breakfast", help: "Ticks when you mark a planned breakfast as eaten." }, { key: "lunchPrep", name: "Prepare lunch", help: "Ticks when you mark a planned lunch as prepped." }, { key: "water", name: "Drink water", help: "Tick it in Habits, or from here." }];
  const ICON = {
    shopping: '<svg class="mp-ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M4 5h2l2 10h9l2-7H7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="10" cy="19" r="1.3" fill="currentColor"/><circle cx="16" cy="19" r="1.3" fill="currentColor"/></svg>',
    cooking: '<svg class="mp-ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M5 11h14v3a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5zM3 11h18M9 7c0-1.5 1-1.5 1-3M14 7c0-1.5 1-1.5 1-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    portioning: '<svg class="mp-ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><rect x="4" y="6" width="16" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 6v12M4 12h16" stroke="currentColor" stroke-width="2"/></svg>',
    reminder: '<svg class="mp-ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15zM10 21a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  const st = {};

  function cal() { return window.JarvisCalendar && window.JarvisCalendar.getEvents ? window.JarvisCalendar : null; }
  function CL() { return window.JarvisCalendarLogic || null; }
  function H() { return window.JarvisHabits && window.JarvisHabits.getHabits ? window.JarvisHabits : null; }
  function kindLabel(kd) { return (KINDS.filter(function (x) { return x[0] === kd; })[0] || ["", "Prep"])[1]; }
  function pretty(date) { return k.prettyDay(date, { weekday: "short", month: "short", day: "numeric" }); }
  function addMin(time, mins) { const t = Math.min(1439, L.isTime(time) ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + mins : 0); return String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0"); }

  /* ====================================================================== */
  /*  Prepared meals                                                         */
  /* ====================================================================== */

  function batchCardHtml(b, today, recipes) {
    const s = L.batchState(b, today), gone = s.level === "gone", rec = recipes.filter(function (r) { return r.id === b.recipeId; })[0];
    const chipCls = s.level === "past" ? "mp-st-past" : s.level === "today" || s.level === "soon" ? "mp-st-soon" : "mp-st-prepped";
    let body = '<div class="mp-meal-body"><dl class="mp-facts"><div><dt>Prepared</dt><dd>' + esc(pretty(b.preparedOn)) + '</dd></div><div><dt>Kept in</dt><dd>' + (b.place === "freezer" ? "Freezer" : "Refrigerator") + '</dd></div><div><dt>Use by</dt><dd>' + esc(b.useBy ? pretty(b.useBy) : "—") + '</dd></div></dl>';
    if (b.per) body += '<p class="mp-meal-line">Per portion: ' + esc(b.per.calories + " kcal · P " + Math.round(b.per.protein) + " g · C " + Math.round(b.per.carbs) + " g · F " + Math.round(b.per.fat) + " g") + (b.perSource === "estimated" || b.perSource === "mixed" ? ' <em class="mp-est">est.</em>' : '') + '</p>';
    body += '<p class="mp-meal-line"><strong>Reheating:</strong> ' + esc(b.reheat || L.reheatText(b.place)) + '</p>';
    body += '<p class="mp-dim mp-meal-line">' + esc(L.GUIDE[b.place === "freezer" ? "freezer" : "fridge"].rule) + '</p>';
    if (b.notes) body += '<p class="mp-meal-line mp-dim">' + esc(b.notes) + '</p>';
    if (!gone && s.level !== "past") {
      const ideas = L.leftoverIdeas(b, recipes);
      if (ideas.ideas.length || ideas.recipes.length) body += '<h3 class="mp-h5">Ways to use it up</h3><ul class="mp-ideas">' + ideas.ideas.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join("") + ideas.recipes.map(function (r) { return '<li>Your recipe: ' + esc(r.name) + '</li>'; }).join("") + '</ul>';
    }
    body += '<div class="mp-actions">';
    if (!gone) {
      body += '<button type="button" class="btn btn-primary" data-mp="tracker:ate" data-id="' + esc(b.id) + '">Ate 1 portion</button>' +
        '<span class="mp-step" role="group" aria-label="Adjust portions left without logging"><button type="button" class="btn-icon" data-mp="tracker:minus" data-id="' + esc(b.id) + '" aria-label="One fewer portion left">&minus;</button><span class="mp-step-n" aria-live="polite">' + b.remaining + '</span><button type="button" class="btn-icon" data-mp="tracker:plus" data-id="' + esc(b.id) + '" aria-label="One more portion left"' + (b.remaining >= b.portions ? " disabled" : "") + '>+</button></span>' +
        '<button type="button" class="btn btn-secondary" data-mp="tracker:move" data-id="' + esc(b.id) + '">' + (b.place === "freezer" ? "Move to fridge (thawed)" : "Freeze it") + '</button>';
    } else body += '<button type="button" class="btn btn-secondary" data-mp="tracker:plus" data-id="' + esc(b.id) + '">Put a portion back</button>';
    body += '<button type="button" class="btn btn-secondary" data-mp="tracker:editbatch" data-id="' + esc(b.id) + '">Edit</button><button type="button" class="btn btn-secondary danger" data-mp="tracker:delbatch" data-id="' + esc(b.id) + '">Delete</button></div></div>';
    return '<details class="mp-meal mp-batch lv-' + s.level + '" data-open-key="batch:' + esc(b.id) + '"' + k.openAttr("batch:" + b.id, false) + '><summary class="mp-meal-sum"><span class="mp-meal-top"><span class="mp-meal-name">' + esc(b.name) + '</span><span class="mp-chip ' + chipCls + '">' + esc(gone ? "All eaten" : s.level === "past" ? "Past use-by" : s.text) + '</span></span>' +
      '<span class="mp-meal-sub">' + (gone ? "0" : b.remaining) + ' of ' + b.portions + ' portions left <span class="mp-dim">· ' + (b.place === "freezer" ? "Freezer" : "Refrigerator") + '</span></span></summary>' + body + '</details>';
  }

  function batchesHtml(today) {
    const recipes = k.recipes(), all = k.batches.all();
    const live = all.filter(function (b) { return b.remaining > 0; }).sort(function (a, b) { return (a.useBy || "9") < (b.useBy || "9") ? -1 : 1; });
    const done = all.filter(function (b) { return !(b.remaining > 0); }).sort(function (a, b) { return a.updatedAt < b.updatedAt ? 1 : -1; }).slice(0, 10);
    let h = '<section class="mp-sec" aria-labelledby="mpBatchesH"><div class="mp-sec-h"><h2 id="mpBatchesH" class="mp-h2">Prepared meals</h2><button type="button" class="btn btn-primary" data-mp="tracker:newbatch">+ Record a batch</button></div>';
    if (live.some(function (b) { return L.batchState(b, today).level === "past"; })) h += '<p class="mp-warn" role="status">Some food is past its use-by date. When in doubt, throw it out.</p>';
    h += live.length ? live.map(function (b) { return batchCardHtml(b, today, recipes); }).join("") : '<div class="card mp-emptycard"><p>No prepared meals.</p><p class="mp-dim">When you cook ahead, record the batch here to track the portions, where they are kept, and when to eat them by.</p></div>';
    if (done.length) h += '<details class="mp-fin" data-open-key="finished"' + k.openAttr("finished", false) + '><summary>Finished (' + done.length + ')</summary>' + done.map(function (b) { return batchCardHtml(b, today, recipes); }).join("") + '</details>';
    return h + '<p class="mp-foot">Use-by dates follow general food-safety guidance (USDA FoodSafety.gov): refrigerate within 2 hours of cooking, eat within 3 to 4 days, freeze for best quality within about 3 months, reheat to 165 F (74 C). They are guidance, not a guarantee. You can change a date.</p></section>';
  }

  // o: { id } to edit, { recipeId } to start from a recipe
  function openBatchSheet(o) {
    const A = k.A();
    if (!A) { k.toast("Batches can't be recorded here right now."); return; }
    const op = o || {}, b = op.id ? k.batches.find(op.id) : null;
    if (op.id && !b) { k.toast("That batch isn't there any more."); return; }
    const recs = k.recipes().sort(function (a, c) { return a.name.localeCompare(c.name); }), today = k.today();
    const rec = b ? recs.filter(function (r) { return r.id === b.recipeId; })[0] : (op.recipeId ? k.recipeById(op.recipeId) : null);
    const place = b ? b.place : (rec && rec.storage && rec.storage.place === "freezer" ? "freezer" : "fridge"), prepared = b ? b.preparedOn : today;
    let body = A.fSelect("recipe", "Recipe", [["", "Something else (no recipe)"]].concat(recs.map(function (r) { return [r.id, r.name]; })), rec ? rec.id : "");
    body += '<div data-other>' + A.fText("name", "What is it?", b && !b.recipeId ? b.name : "", { max: 80, placeholder: "e.g. Chili" }) + '</div>';
    body += '<div class="form-row two-col"><div>' + A.row("portions", "Portions", '<input type="number" id="spf_portions" name="portions" min="1" max="60" step="1" value="' + esc(b ? b.portions : (rec ? rec.servings : 4)) + '">', {}) + '</div><div>' + A.row("mult", "Times the recipe", '<input type="number" id="spf_mult" name="mult" min="0.1" max="50" step="any" value="1">', { hint: "Each portion is one serving of the recipe. Change this if you cooked more or less (2 if you doubled it)." }) + '</div></div>';
    if (b) body += A.row("remaining", "Portions left", '<input type="number" id="spf_remaining" name="remaining" min="0" max="' + esc(b.portions) + '" step="1" value="' + esc(b.remaining) + '">', {});
    body += A.fText("prepared", "Date prepared", prepared, { type: "date" });
    body += A.fSelect("place", "Kept in", [["fridge", "Refrigerator"], ["freezer", "Freezer"]], place);
    body += A.fText("useBy", "Use by", b ? b.useBy : L.useBy(prepared, place), { type: "date", hint: "Filled in from food-safety guidance: 4 days in the refrigerator, 90 days in the freezer. You can change it." });
    body += A.fText("notes", "Notes (optional)", b ? b.notes : "", { max: 200 });
    if (!b) body += '<label class="cal-check"><input type="checkbox" name="pantry" checked> Take the ingredients out of my pantry estimate</label>';
    A.openSheet({
      title: b ? "Edit batch" : "Record a batch", body: body, submit: b ? "Save" : "Save batch", focus: '[name="portions"]',
      onOpen: function (root) { root.querySelector("[data-other]").classList.toggle("hidden", !!root.querySelector('[name="recipe"]').value); },
      onChange: function (el, root) {
        const q = function (n) { return root.querySelector('[name="' + n + '"]'); };
        if (el.name === "recipe") { const r = k.recipeById(el.value); root.querySelector("[data-other]").classList.toggle("hidden", !!el.value); if (r && !b) { q("portions").value = r.servings; if (r.storage && r.storage.place === "freezer") q("place").value = "freezer"; q("useBy").value = L.useBy(q("prepared").value, q("place").value); } }
        if ((el.name === "prepared" || el.name === "place") && L.isDate(q("prepared").value)) q("useBy").value = L.useBy(q("prepared").value, q("place").value);
        if (el.name === "portions" && !b) { const r = k.recipeById(q("recipe").value), n = Number(el.value); if (r && n >= 1) q("mult").value = String(Math.round(n / L.servingsOf(r) * 100) / 100); }   // a portion is a serving, unless you change it
      },
      onSubmit: function (v) { return saveBatch(v, b); }
    });
  }
  function saveBatch(v, b) {
    const rec = v.recipe ? k.recipeById(v.recipe) : null, name = rec ? rec.name : String(v.name || "").replace(/\s+/g, " ").trim();
    const errors = {}, portions = Math.round(Number(v.portions));
    if (!name) errors.name = "Say what it is, or choose a recipe.";
    if (!(portions >= 1)) errors.portions = "Enter at least 1 portion.";
    if (!L.isDate(v.prepared)) errors.prepared = "Choose the day you made it.";
    if (v.useBy && !L.isDate(v.useBy)) errors.useBy = "Choose a date.";
    if (Object.keys(errors).length) return { ok: false, errors: errors };
    const t = k.now(), before = k.batches.raw();
    let per = null, perSource = "";
    if (rec && L.hasNutrition(rec)) {
      const tot = L.recipeTotals(rec), mult = Number(v.mult) || 1, p = {};
      L.MACROS.forEach(function (m) { p[m] = tot[m] * mult / portions; });
      per = p; perSource = L.recipeSource(rec).kind;
    }
    let next;
    if (b) {
      const remaining = Math.max(0, Math.min(portions, Math.round(Number(v.remaining))));
      next = before.map(function (x) { return x.id === b.id ? Object.assign({}, x, { recipeId: rec ? rec.id : "", name: name, portions: portions, remaining: isFinite(remaining) ? remaining : x.remaining, preparedOn: v.prepared, place: v.place === "freezer" ? "freezer" : "fridge", useBy: v.useBy || L.useBy(v.prepared, v.place), notes: String(v.notes || "").slice(0, 200), per: per || x.per, perSource: perSource || x.perSource, updatedAt: t }) : x; });
    } else {
      const nb = L.newBatch({ recipeId: rec ? rec.id : "", name: name, preparedOn: v.prepared, portions: portions, place: v.place, useBy: v.useBy, reheat: rec && rec.storage ? rec.storage.reheat : "", per: per, perSource: perSource, notes: v.notes }, k.uid("batch"), t);
      next = before.concat([nb]);
    }
    if (!k.commitBatches(next)) return { ok: false, message: "That couldn't be saved." };
    if (!b && rec && v.pantry && k.G()) k.G().consume(rec.ingredients, Number(v.mult) || 1);
    if (!b && rec && (rec.cats || []).indexOf("lunch") !== -1 && k.habitTick) k.habitTick("lunchPrep", v.prepared <= k.today() ? v.prepared : k.today());
    k.render({ keepScroll: true });
    k.undo((b ? "Saved " : "Recorded ") + name + ": " + portions + " " + k.plural(portions, "portion") + ".", function () { if (k.commitBatches(before)) k.render({ keepScroll: true }); });
    return { ok: true };
  }

  // The meal an eaten portion goes under in the food log: by the time of day, or the recipe's own meal if it is not one that fits.
  function mealGuess() { const h = new Date().getHours(); return h < 11 ? "breakfast" : h < 16 ? "lunch" : "dinner"; }
  function mealFor(b) {
    const rec = b.recipeId ? k.recipeById(b.recipeId) : null, g = mealGuess();
    return rec && rec.cats && rec.cats.length ? (rec.cats.indexOf(g) !== -1 ? g : rec.cats[0]) : g;
  }
  function ate(id) {
    const b = k.batches.find(id);
    if (!b) return;
    const today = k.today(), before = k.batches.raw(), r = L.eatPortions(before, id, 1, today, k.now());
    if (!r.used) { k.toast("No portions left."); return; }
    const N = k.N();
    let itemId = "", meal = mealFor(b);
    if (b.per && N && N.log) {
      const lg = N.log.add({ date: today, meal: meal, name: b.name + " (1 portion)", serving: "1 portion", calories: b.per.calories, protein: b.per.protein, carbs: b.per.carbs, fat: b.per.fat });
      if (!lg.ok) { k.toast(lg.error); return; }
      itemId = lg.id;
    }
    if (!k.commitBatches(r.batches)) { if (itemId) N.log.remove(today, meal, itemId); return; }
    k.render({ keepScroll: true, focus: '[data-mp="tracker:ate"][data-id="' + id + '"]' });
    k.undo("Ate 1 portion of " + b.name + ". " + (r.batches.filter(function (x) { return x.id === id; })[0].remaining) + " left" + (itemId ? ", added to your " + meal + " log." : "."), function () {
      if (itemId) N.log.remove(today, meal, itemId);
      k.commitBatches(before); k.render({ keepScroll: true });
    });
  }
  function adjust(id, delta) {
    const b = k.batches.find(id); if (!b) return;
    const n = Math.max(0, Math.min(b.portions, b.remaining + delta));
    if (n === b.remaining) return;
    if (k.commitBatches(k.batches.raw().map(function (x) { return x.id === id ? Object.assign({}, x, { remaining: n, updatedAt: k.now() }) : x; }))) k.render({ keepScroll: true, focus: '[data-mp="tracker:' + (delta < 0 ? "minus" : "plus") + '"][data-id="' + id + '"]' });
  }
  function moveBatch(id) {
    const b = k.batches.find(id); if (!b) return;
    const to = b.place === "freezer" ? "fridge" : "freezer", before = k.batches.raw();
    if (k.commitBatches(L.moveBatch(before, id, to, k.today(), k.now()))) {
      k.render({ keepScroll: true });
      k.undo(to === "freezer" ? "Moved to the freezer. Use by " + pretty(L.useBy(k.today(), "freezer")) + "." : "Moved to the fridge to thaw. Eat within 3 days, and don't refreeze.", function () { if (k.commitBatches(before)) k.render({ keepScroll: true }); });
    }
  }
  function deleteBatch(id) {
    const b = k.batches.find(id); if (!b) return;
    const before = k.batches.raw();
    if (k.batches.markDeleted(id)) { k.render({ keepScroll: true }); k.undo("Deleted " + b.name + ".", function () { if (k.commitBatches(before)) k.render({ keepScroll: true }); }); } else k.toast("That couldn't be saved.");
  }

  /* ====================================================================== */
  /*  Prep sessions: one record here, one Calendar event, optionally one task */
  /* ====================================================================== */

  function eventFor(s) {
    const c = cal(), events = c ? c.getEvents() : [];
    return events.filter(function (e) { return !e.deletedAt && e.linked && e.linked.type === "mealprep" && e.linked.id === s.id; })[0] || null;
  }
  function taskFor(s) { const h = window.JarvisHabits; return h && h.getTasks ? h.getTasks().filter(function (t) { return t.mealPrepId === s.id; })[0] || null : null; }
  function eventInput(s) {
    const point = s.kind === "reminder", recs = (s.recipeIds || []).map(function (id) { return k.recipeById(id); }).filter(Boolean);
    const hasTime = L.isTime(s.time);
    const i = { title: s.title, kind: point ? "reminder" : "block", category: "health", priority: "medium", allDay: !point && !hasTime, date: s.date, time: hasTime ? s.time : "", description: recs.length ? "Recipes: " + recs.map(function (r) { return r.name; }).join(", ") : "", notes: s.notes || "", reminders: s.remind >= 0 && hasTime ? [s.remind] : [], linked: { type: "mealprep", id: s.id, kind: s.kind }, repeat: null };
    if (!point && hasTime) { i.endDate = s.date; i.endTime = addMin(s.time, s.durationMin || 60); }
    return i;
  }
  // Makes the session's Calendar event, or updates it: found by the session's id, so there is never a second one. -> { ok, error }
  function syncEvent(s) {
    const c = cal(), C = CL();
    if (!c || !C) return { ok: false, error: "The Calendar isn't available right now." };
    const events = c.getEvents(), cur = eventFor(s), input = eventInput(s);
    const res = cur ? C.edit(events, cur.id, input, c.ctx()) : C.add(events, input, c.ctx());
    if (!res.ok) return { ok: false, error: res.error || "That couldn't be put on the Calendar." };
    if (!c.commitEvents(res.events)) return { ok: false, error: "The Calendar couldn't be saved. The browser may be full or blocking storage." };
    if (c.refresh) c.refresh();
    return { ok: true, id: res.event.id };
  }
  function removeEvent(s) {
    const c = cal(), C = CL();
    if (!c || !C) return;
    const cur = eventFor(s);
    if (!cur) return;
    const res = C.remove(c.getEvents(), cur.id, c.ctx());
    if (res.ok && c.commitEvents(res.events) && c.refresh) c.refresh();
  }
  function taskText(s) { return s.title + (L.isTime(s.time) ? " (" + k.timeLabel(s.time) + ")" : ""); }
  // The task for the day plan's to-do list. One per session (found by mealPrepId).
  function ensureTask(s) {
    const h = window.JarvisHabits;
    if (!h || !h.addTask) return null;
    const cur = taskFor(s);
    if (cur) {
      h.commitTasks(h.getTasks().map(function (t) { return t.id === cur.id ? Object.assign({}, t, { text: taskText(s), date: s.date }) : t; }));
      return cur.id;
    }
    const t = h.addTask({ text: taskText(s), date: s.date, priority: "medium", kind: "scheduled", mealPrepId: s.id });
    return t ? t.id : null;
  }
  function removeTask(s) {
    const h = window.JarvisHabits, cur = taskFor(s);
    if (h && cur) h.commitTasks(h.getTasks().filter(function (t) { return t.id !== cur.id; }));
  }
  // A task and its session finish together: the task is the one you tick, so it decides.
  function syncDone() {
    const list = k.sessions.all();
    let changed = false;
    const next = list.map(function (s) {
      if (!s.taskId) return s;
      const t = taskFor(s);
      if (!t) return Object.assign({}, s, { taskId: "", updatedAt: k.now() });
      if (t.completed && !s.doneAt) return Object.assign({}, s, { doneAt: k.now(), updatedAt: k.now() });
      if (!t.completed && s.doneAt) { const o = Object.assign({}, s, { updatedAt: k.now() }); delete o.doneAt; return o; }
      return s;
    });
    next.forEach(function (s, i) { if (s !== list[i]) changed = true; });
    if (changed) { const all = k.sessions.raw(); k.sessions.replace(all.map(function (s) { const n = next.filter(function (x) { return x.id === s.id; })[0]; return n || s; })); }
    return changed;
  }

  function upcomingSessions(today) {
    return k.sessions.all().filter(function (s) { return s.date >= L.addDays(today, -3); }).sort(function (a, b) { return (a.date + (a.time || "")) < (b.date + (b.time || "")) ? -1 : 1; });
  }
  function sessionRowHtml(s, today) {
    const ev = eventFor(s), task = taskFor(s), recs = (s.recipeIds || []).map(function (id) { return k.recipeById(id); }).filter(Boolean);
    const late = !s.doneAt && s.date < today;
    return '<li class="mp-sess' + (s.doneAt ? ' is-done' : '') + (late ? ' is-late' : '') + '"><span class="mp-sess-ico">' + (ICON[s.kind] || ICON.reminder) + '</span><div class="mp-sess-main"><span class="mp-sess-t">' + esc(s.title) + '</span>' +
      '<span class="mp-dim">' + esc(pretty(s.date) + (s.time ? " " + k.timeLabel(s.time) : "") + (s.durationMin && s.kind !== "reminder" ? " · " + (s.durationMin >= 60 ? Math.floor(s.durationMin / 60) + " h" + (s.durationMin % 60 ? " " + (s.durationMin % 60) + " min" : "") : s.durationMin + " min") : "")) + (recs.length ? " · " + esc(recs.map(function (r) { return r.name; }).join(", ")) : "") + '</span>' +
      '<span class="mp-sess-chips">' + (ev ? '<span class="mp-chip mp-st-prepped">On your Calendar</span>' : '<button type="button" class="mp-gi-btn" data-mp="tracker:addcal" data-id="' + esc(s.id) + '">Not on the Calendar. Add it</button>') +
      (task ? '<span class="mp-chip">On your to-do list</span>' : '<button type="button" class="mp-gi-btn" data-mp="tracker:addtask" data-id="' + esc(s.id) + '">Add to my day plan</button>') + (late ? '<span class="mp-chip mp-st-soon">Not done</span>' : '') + '</span></div>' +
      '<div class="mp-sess-act"><button type="button" class="btn btn-secondary" data-mp="tracker:done" data-id="' + esc(s.id) + '" aria-pressed="' + !!s.doneAt + '">' + (s.doneAt ? 'Done ✓' : 'Mark done') + '</button><button type="button" class="btn btn-secondary" data-mp="tracker:editsess" data-id="' + esc(s.id) + '">Edit</button><button type="button" class="btn btn-secondary danger" data-mp="tracker:delsess" data-id="' + esc(s.id) + '" aria-label="' + esc("Delete " + s.title) + '">Delete</button></div></li>';
  }

  // What still needs cooking this week, and free times for it, from your plan and your Calendar.
  function prepNeeds(today) {
    const plan = k.plan(), recs = k.recipes(), batches = k.batches.all(), end = L.addDays(today, 6);
    const occ = L.occurrences(plan, today, end).filter(function (o) { return L.status(o, batches, today).code === "to-prep" && o.entry.recipeId; });
    const by = {};
    occ.forEach(function (o) { const e = by[o.entry.recipeId] = by[o.entry.recipeId] || { recipe: L.recipeOf(o.entry, recs), servings: 0, dates: [] }; e.servings += Number(o.entry.servings) || 1; e.dates.push(o.date); });
    const list = Object.keys(by).map(function (id) { return by[id]; }).filter(function (x) { return x.recipe; });
    const load = {}; occ.forEach(function (o) { load[o.date] = (load[o.date] || 0) + 1; });
    return { list: list, load: load, minutes: L.sessionMinutes(list.map(function (x) { return x.recipe; })) };
  }
  function freeRows(today) {
    const c = cal(), D = window.JarvisDayPlannerLogic;
    if (!c || !D || !c.itemsBetween) return [];
    const rows = [];
    try {
      const items = c.itemsBetween(today, L.addDays(today, 6));
      for (let i = 0; i < 7; i++) {
        const d = L.addDays(today, i), day = items.filter(function (it) { return it.date <= d && (it.endDate || it.date) >= d; });
        const tl = D.timeline({ date: d, items: day, window: { start: 540, end: 1200 }, nowMin: d === today ? c.nowMin() : undefined, today: today, minFree: 30 });
        tl.rows.forEach(function (r) { if (r.type === "free") rows.push({ date: d, start: r.start, end: r.end }); });
      }
    } catch (e) { return []; }
    return rows;
  }
  function suggestionsHtml(today) {
    const needs = prepNeeds(today);
    let h = '<details class="card mp-card" data-open-key="prepneeds"' + k.openAttr("prepneeds", true) + '><summary class="mp-card-sum"><span class="mp-card-title">What to prepare</span><span class="mp-dim">from this week’s plan</span></summary><div class="mp-card-body">';
    if (!needs.list.length) return h + '<p class="mp-dim">Nothing in this week’s plan still needs cooking. Plan meals with recipes in the Weekly Plan, and what needs preparing shows up here.</p></div></details>';
    h += '<ul class="mp-list">' + needs.list.map(function (x) { return '<li><span>' + esc(x.recipe.name) + '<span class="mp-dim"> · ' + x.servings + ' ' + k.plural(x.servings, "serving") + ' for ' + esc(x.dates.map(function (d) { return k.prettyDay(d, { weekday: "short" }); }).join(", ")) + '</span></span><button type="button" class="btn btn-secondary" data-mp="tracker:newbatch" data-id="' + esc(x.recipe.id) + '">I cooked it</button></li>'; }).join("") + '</ul>';
    const need = Math.max(45, needs.minutes || 120);
    const slots = L.prepSlots(freeRows(today), need, { today: today, load: needs.load }).slice(0, 3);
    h += '<h3 class="mp-h3">Good times to cook</h3><p class="mp-dim">' + (needs.minutes ? 'About ' + (needs.minutes >= 60 ? Math.floor(needs.minutes / 60) + ' h ' + (needs.minutes % 60 ? needs.minutes % 60 + ' min' : '') : needs.minutes + ' min') + ' for these recipes (prep and cooking time, plus 20 minutes to portion and clean up). ' : 'Some recipes have no times yet, so this uses 2 hours. ') + 'Free time comes from your Calendar.</p>';
    h += slots.length ? '<ul class="mp-list">' + slots.map(function (s, i) { const t = String(Math.floor(s.start / 60)).padStart(2, "0") + ":" + String(s.start % 60).padStart(2, "0"); return '<li><span><strong>' + esc(pretty(s.date)) + '</strong> ' + esc(k.timeLabel(t)) + ' – ' + esc(k.timeLabel(addMin(t, need))) + '<span class="mp-dim"> · ' + Math.round(s.free / 60 * 10) / 10 + ' h free</span></span><button type="button" class="btn btn-secondary" data-mp="tracker:slot" data-date="' + s.date + '" data-time="' + t + '" data-min="' + need + '">Schedule here</button></li>'; }).join("") + '</ul>' : '<p class="mp-dim">No free stretch that long in the next 7 days (between 9 AM and 8 PM). Try a shorter session, or move something on your Calendar.</p>';
    return h + '</div></details>';
  }

  function habitsHtml(today) {
    const h = H(), prefs = k.prefs();
    if (!h) return "";
    const list = h.getHabits();
    let out = '<details class="card mp-card" data-open-key="mealhabits"' + k.openAttr("mealhabits", false) + '><summary class="mp-card-sum"><span class="mp-card-title">Meal habits</span><span class="mp-dim">tracked in Habits</span></summary><div class="mp-card-body"><ul class="mp-list">';
    HABITS.forEach(function (x) {
      const id = prefs.habits && prefs.habits[x.key], rec = id ? list.filter(function (y) { return y.id === id; })[0] : null;
      if (rec) {
        const done = Number(rec.completions && rec.completions[today]) >= (rec.dailyTarget > 1 ? rec.dailyTarget : 1);
        out += '<li><span><strong>' + esc(rec.name) + '</strong><span class="mp-dim"> · ' + esc(x.help) + '</span></span><button type="button" class="btn btn-secondary" data-mp="tracker:habit" data-key="' + x.key + '" aria-pressed="' + done + '"' + (rec.dailyTarget > 1 ? ' disabled title="Count it in Habits"' : '') + '>' + (done ? 'Done today ✓' : (rec.dailyTarget > 1 ? 'Count it in Habits' : 'Mark done')) + '</button></li>';
      } else out += '<li><span><strong>' + esc(x.name) + '</strong><span class="mp-dim"> · ' + esc(x.help) + '</span></span><button type="button" class="btn btn-secondary" data-mp="tracker:addhabit" data-key="' + x.key + '">Track this habit</button></li>';
    });
    return out + '</ul><p class="mp-dim">These are ordinary habits: they show in Habits, with streaks, and you can give them a time on your Day planner there.</p></div></details>';
  }

  function sessionsHtml(today) {
    const list = upcomingSessions(today);
    let h = '<section class="mp-sec" aria-labelledby="mpSessH"><div class="mp-sec-h"><h2 id="mpSessH" class="mp-h2">Prep schedule</h2><button type="button" class="btn btn-primary" data-mp="tracker:newsess">+ Schedule</button></div>';
    h += '<p class="mp-dim mp-sec-sub">Each one is also an event on your Calendar, so it is never entered twice.</p>';
    h += list.length ? '<ul class="mp-sesslist">' + list.map(function (s) { return sessionRowHtml(s, today); }).join("") + '</ul>' : '<div class="card mp-emptycard"><p>Nothing scheduled.</p><p class="mp-dim">Schedule a grocery trip, a cooking session, or a reminder to portion your meals.</p></div>';
    return h + '</section>';
  }

  function render() {
    const today = k.today();
    return batchesHtml(today) + sessionsHtml(today) + suggestionsHtml(today) + habitsHtml(today);
  }

  /* ---- the session sheet ---- */

  function defaultTitle(kind, recIds) {
    const names = (recIds || []).map(function (id) { return (k.recipeById(id) || {}).name; }).filter(Boolean);
    if (kind === "shopping") return "Grocery shopping";
    if (kind === "cooking") return names.length ? "Meal prep: " + names.slice(0, 2).join(" and ") + (names.length > 2 ? " and more" : "") : "Meal prep cooking";
    if (kind === "portioning") return "Portion and pack meals";
    return "Meal prep reminder";
  }
  // o: { id } to edit; { kind, date, time, durationMin, recipeIds } to start
  function openSessionSheet(o) {
    const A = k.A();
    if (!A) { k.toast("Sessions can't be scheduled here right now."); return; }
    const op = o || {}, s = op.id ? k.sessions.find(op.id) : null;
    if (op.id && !s) { k.toast("That session isn't there any more."); return; }
    const kind = s ? s.kind : (op.kind || "cooking"), recIds = s ? s.recipeIds || [] : (op.recipeIds || []);
    const recs = k.recipes().sort(function (a, b) { return a.name.localeCompare(b.name); });
    const g = k.G(), prefs = g ? g.prefs() : {}, today = k.today();
    let date = s ? s.date : (op.date || today);
    if (!s && !op.date && kind === "shopping" && prefs.shoppingDay !== undefined) { for (let i = 0; i < 7; i++) { const d = L.addDays(today, i); if (L.weekday(d) === Number(prefs.shoppingDay)) { date = d; break; } } }
    let body = A.fSelect("kind", "What", KINDS, kind);
    body += A.fText("title", "Title", s ? s.title : defaultTitle(kind, recIds), { required: true, max: 120 });
    body += '<div class="form-row two-col"><div>' + A.fText("date", "Day", date, { type: "date" }) + '</div><div>' + A.fText("time", "Time", s ? s.time : (op.time || "10:00"), { type: "time" }) + '</div></div>';
    body += '<div data-dur>' + A.fSelect("dur", "How long", [[30, "30 minutes"], [45, "45 minutes"], [60, "1 hour"], [90, "1 hour 30 minutes"], [120, "2 hours"], [150, "2 hours 30 minutes"], [180, "3 hours"], [240, "4 hours"]].map(function (x) { return [String(x[0]), x[1]]; }).concat(s && ![30, 45, 60, 90, 120, 150, 180, 240].includes(s.durationMin) ? [[String(s.durationMin), s.durationMin + " minutes"]] : []), String(s ? s.durationMin || 60 : (op.durationMin ? Math.max(30, Math.min(240, Math.round(op.durationMin / 15) * 15)) : (kind === "shopping" ? 60 : 120)))) + '</div>';
    if (recs.length) body += '<div class="form-row" data-recs><fieldset class="cdp-days"><legend>Recipes</legend><div class="cal-chips">' + recs.slice(0, 24).map(function (r) { return '<label class="cal-chip-btn hb-daychip"><input type="checkbox" data-multi name="recipes" value="' + esc(r.id) + '"' + (recIds.indexOf(r.id) !== -1 ? " checked" : "") + '> ' + esc(r.name) + '</label>'; }).join("") + '</div></fieldset></div>';
    body += A.fSelect("remind", "Remind me", REMIND.map(function (x) { return [String(x[0]), x[1]]; }), String(s ? s.remind : 30), { hint: "Shown by JARVIS Calendar reminders." });
    body += A.fArea("notes", "Notes (optional)", s ? s.notes : "", { rows: 2, max: 400 });
    body += '<label class="cal-check"><input type="checkbox" name="task"' + (s && taskFor(s) ? " checked" : "") + '> Also put it on my to-do list for that day</label><p class="field-hint">It is one event on your Calendar either way. The to-do item is for ticking it off in your Day plan.</p>';
    function sync(root) {
      const kd = root.querySelector('[name="kind"]').value;
      root.querySelector("[data-dur]").classList.toggle("hidden", kd === "reminder");
      const rc = root.querySelector("[data-recs]"); if (rc) rc.classList.toggle("hidden", kd !== "cooking" && kd !== "portioning");
    }
    A.openSheet({
      title: s ? "Edit prep session" : "Schedule a prep session", body: body, submit: s ? "Save" : "Add to Calendar", focus: '[name="title"]',
      onOpen: sync,
      onChange: function (el, root) {
        sync(root);
        const q = function (n) { return root.querySelector('[name="' + n + '"]'); };
        if (el.name === "kind" || el.name === "recipes") {
          const cur = q("title").value, ids = Array.prototype.map.call(root.querySelectorAll('[name="recipes"]:checked'), function (c) { return c.value; });
          const was = [defaultTitle(s ? s.kind : kind, recIds), defaultTitle(q("kind").value, recIds)];
          if (!cur || was.indexOf(cur) !== -1 || cur === defaultTitle(kind, []) || /^(Grocery shopping|Meal prep|Portion and pack|Meal prep reminder)/.test(cur)) q("title").value = defaultTitle(q("kind").value, ids);
        }
      },
      onSubmit: function (v) { return saveSession(v, s); }
    });
  }
  function saveSession(v, s) {
    const errors = {}, title = String(v.title || "").replace(/\s+/g, " ").trim();
    if (!title) errors.title = "Give it a title.";
    if (!L.isDate(v.date)) errors.date = "Choose a day.";
    if (v.kind !== "reminder" && !L.isTime(v.time)) errors.time = "Choose a time.";
    if (Object.keys(errors).length) return { ok: false, errors: errors };
    const t = k.now(), before = k.sessions.raw(), beforeTask = s ? taskFor(s) : null;
    const rec = { id: s ? s.id : k.uid("prep"), kind: KINDS.some(function (x) { return x[0] === v.kind; }) ? v.kind : "cooking", title: title.slice(0, 120), date: v.date, time: L.isTime(v.time) ? v.time : "", durationMin: v.kind === "reminder" ? 0 : Number(v.dur) || 60, recipeIds: (v.recipes || []).filter(function (id) { return k.recipeById(id); }), notes: String(v.notes || "").slice(0, 400), remind: Number(v.remind), taskId: s ? s.taskId || "" : "", createdAt: s ? s.createdAt : t, updatedAt: t };
    if (s && s.doneAt) rec.doneAt = s.doneAt;
    const ev = syncEvent(rec);
    if (!ev.ok) return { ok: false, message: ev.error };
    rec.eventId = ev.id;
    if (v.task) { const id = ensureTask(rec); rec.taskId = id || ""; }
    else if (rec.taskId) { removeTask(rec); rec.taskId = ""; }
    const next = s ? before.map(function (x) { return x.id === s.id ? rec : x; }) : before.concat([rec]);
    if (!k.commitSessions(next)) { if (!s) { removeEvent(rec); removeTask(rec); } return { ok: false, message: "That couldn't be saved." }; }
    k.render({ keepScroll: true });
    k.undo((s ? "Saved “" : "Scheduled “") + rec.title + "”. It is on your Calendar" + (rec.taskId ? " and your to-do list" : "") + ".", function () {
      if (s) { k.commitSessions(before); syncEvent(s); if (beforeTask) ensureTask(s); else removeTask(rec); }
      else { removeEvent(rec); removeTask(rec); k.commitSessions(before); }
      k.render({ keepScroll: true });
    });
    return { ok: true };
  }
  function setDone(id) {
    const s = k.sessions.find(id); if (!s) return;
    const on = !s.doneAt, t = k.now(), h = window.JarvisHabits, task = taskFor(s);
    const next = k.sessions.raw().map(function (x) { if (x.id !== id) return x; const o = Object.assign({}, x, { updatedAt: t }); if (on) o.doneAt = t; else delete o.doneAt; return o; });
    if (!k.commitSessions(next)) return;
    if (task && h) h.commitTasks(h.getTasks().map(function (x) { return x.id === task.id ? Object.assign({}, x, { completed: on }) : x; }));
    k.render({ keepScroll: true, focus: '[data-mp="tracker:done"][data-id="' + id + '"]' });
    k.say(on ? "Marked done." : "Marked not done.");
  }
  function deleteSession(id) {
    const s = k.sessions.find(id); if (!s) return;
    const before = k.sessions.raw(), hadTask = !!taskFor(s), doneTask = taskFor(s);
    if (!k.sessions.markDeleted(id)) { k.toast("That couldn't be saved."); return; }
    removeEvent(s); removeTask(s);
    k.render({ keepScroll: true });
    k.undo("Deleted “" + s.title + "” and its Calendar event.", function () {
      if (!k.commitSessions(before)) return;
      syncEvent(s); if (hadTask) { const nid = ensureTask(s); if (doneTask && doneTask.completed && window.JarvisHabits) window.JarvisHabits.commitTasks(window.JarvisHabits.getTasks().map(function (x) { return x.id === nid ? Object.assign({}, x, { completed: true }) : x; })); }
      k.render({ keepScroll: true });
    });
  }
  function addToCalendar(id) {
    const s = k.sessions.find(id); if (!s) return;
    const r = syncEvent(s);
    if (!r.ok) { k.toast(r.error); return; }
    k.sessions.replace(k.sessions.raw().map(function (x) { return x.id === id ? Object.assign({}, x, { eventId: r.id, updatedAt: k.now() }) : x; }));
    k.render({ keepScroll: true }); k.toast("Added to your Calendar.");
  }
  function addToDayPlan(id) {
    const s = k.sessions.find(id); if (!s) return;
    const tid = ensureTask(s);
    if (!tid) { k.toast("Your to-do list isn't available right now."); return; }
    k.sessions.replace(k.sessions.raw().map(function (x) { return x.id === id ? Object.assign({}, x, { taskId: tid, updatedAt: k.now() }) : x; }));
    k.render({ keepScroll: true }); k.toast("Added to your to-do list for " + pretty(s.date) + ".");
  }

  /* ---- habits ---- */

  function habitTick(kind, date) {
    const h = H(), id = k.prefs().habits && k.prefs().habits[kind];
    if (!h || !id || !date || date > k.today()) return;
    if (!h.getHabits().some(function (x) { return x.id === id; })) return;
    h.setHabitDay(id, date, true);
  }
  function addHabit(kind) {
    const h = H(), def = HABITS.filter(function (x) { return x.key === kind; })[0];
    if (!h || !def) return;
    const tg = k.targets(), r = h.addHabit({ name: def.name, targetDays: 7, dailyTarget: kind === "water" ? (tg && tg.water > 0 ? Math.min(50, Math.round(tg.water)) : 8) : 1 });
    if (!r.ok) { k.toast(r.error); return; }
    const hb = Object.assign({}, k.prefs().habits); hb[kind] = r.habit.id;
    if (!k.savePrefs({ habits: hb })) { k.toast("That couldn't be saved."); return; }
    k.render({ keepScroll: true });
    k.toast(r.existed ? "Linked to your existing “" + def.name + "” habit." : "Added “" + def.name + "” to Habits.");
  }
  function tickHabit(kind) {
    const h = H(), id = k.prefs().habits && k.prefs().habits[kind];
    if (!h || !id) return;
    const rec = h.getHabits().filter(function (x) { return x.id === id; })[0]; if (!rec) return;
    const done = Number(rec.completions && rec.completions[k.today()]) >= 1;
    const r = h.setHabitDay(id, k.today(), !done);
    if (!r.ok) { k.toast(r.error); return; }
    k.render({ keepScroll: true, focus: '[data-mp="tracker:habit"][data-key="' + kind + '"]' });
  }

  /* ---------------- taps ---------------- */

  function click(act, el) {
    const id = el.getAttribute("data-id");
    if (act === "newbatch") { openBatchSheet({ recipeId: id || "" }); return; }
    if (act === "editbatch") { openBatchSheet({ id: id }); return; }
    if (act === "delbatch") { deleteBatch(id); return; }
    if (act === "ate") { ate(id); return; }
    if (act === "minus") { adjust(id, -1); return; }
    if (act === "plus") { adjust(id, 1); return; }
    if (act === "move") { moveBatch(id); return; }
    if (act === "newsess") { openSessionSheet({}); return; }
    if (act === "editsess") { openSessionSheet({ id: id }); return; }
    if (act === "delsess") { deleteSession(id); return; }
    if (act === "done") { setDone(id); return; }
    if (act === "addcal") { addToCalendar(id); return; }
    if (act === "addtask") { addToDayPlan(id); return; }
    if (act === "slot") { openSessionSheet({ kind: "cooking", date: el.getAttribute("data-date"), time: el.getAttribute("data-time"), durationMin: Number(el.getAttribute("data-min")), recipeIds: prepNeeds(k.today()).list.map(function (x) { return x.recipe.id; }) }); return; }
    if (act === "addhabit") { addHabit(el.getAttribute("data-key")); return; }
    if (act === "habit") { tickHabit(el.getAttribute("data-key")); return; }
  }

  // The task is the one you tick in the Day plan: a finished task finishes its session.
  function onTasksChanged() { if (syncDone()) k.refresh({ keepScroll: true }); }

  k.openBatchSheet = openBatchSheet;
  k.openSessionSheet = openSessionSheet;
  k.habitTick = habitTick;
  MP.register("tracker", {
    render: render, click: click,
    init: function () { document.addEventListener("jarvis-tasks-changed", onTasksChanged); syncDone(); }
  });
})();
