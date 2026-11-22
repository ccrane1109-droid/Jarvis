/* ==========================================================================
   JARVIS — Meal Prep › Weekly Plan.

   Seven days, four meals a day (breakfast, lunch, dinner, snacks). Each planned meal shows its name, calories and protein / carbs /
   fat, portion and preparation time, and what state it is in (to prep, prepped, eaten); open it for the ingredients scaled to the
   portion. Meals can be dragged to another day, or moved from a menu, and the same meal can be put on several days at once.

   The plan is the one Groceries already keeps (jarvisGroceryMealPlan), so adding a recipe here is what builds the grocery list. Below the
   week: planned against logged nutrition for a day and a seven-day chart, and ideas drawn from your own recipes and pantry.

   "Eaten" adds one line to the food log with the numbers as they are now (so a recipe edited later never changes what you ate), uses a
   prepared portion if you have one, and otherwise takes the ingredients out of the pantry estimate. Undo reverses all of it.
   ========================================================================== */

(function () {
  "use strict";

  const MP = window.JarvisMealPrep;
  if (!MP) return;
  const k = MP.kit, L = k.L, esc = k.esc;
  const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const METRICS = [["calories", "Calories", "kcal"], ["protein", "Protein", "g"], ["carbs", "Carbs", "g"], ["fat", "Fat", "g"]];
  const st = { start: "", sel: "", metric: "calories" };

  function weekStart() { if (!st.start) st.start = L.mondayOf(k.today()); return st.start; }
  function dates() { return L.weekDates(weekStart()); }
  function selected() { const d = dates(); if (!st.sel || d.indexOf(st.sel) === -1) st.sel = d.indexOf(k.today()) !== -1 ? k.today() : d[0]; return st.sel; }
  function dayShort(date) { return k.prettyDay(date, { weekday: "short" }); }
  function dayNum(date) { return Number(date.slice(8)); }
  function rangeTitle() { const d = dates(); return k.prettyDay(d[0], { month: "short", day: "numeric" }) + " – " + k.prettyDay(d[6], d[0].slice(5, 7) === d[6].slice(5, 7) ? { day: "numeric" } : { month: "short", day: "numeric" }); }
  function nums(n) { return n ? (n.calories ? k.num(n.calories) : "0") + " kcal · P " + Math.round(n.protein) + " · C " + Math.round(n.carbs) + " · F " + Math.round(n.fat) : ""; }
  function est(source) { return source === "estimated" || source === "mixed" ? ' <em class="mp-est" title="Some of these numbers are estimates">est.</em>' : ""; }
  function minutesText(m) { return m >= 60 ? Math.floor(m / 60) + " h" + (m % 60 ? " " + (m % 60) + " min" : "") : m + " min"; }
  function servingsText(n) { const v = Number(n) || 1; return (Math.round(v * 100) / 100) + " " + (v === 1 ? "serving" : "servings"); }

  /* ---------------- drawing ---------------- */

  const ICON_BELL = '<svg class="mp-ico" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path d="M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function mealHtml(it, batches, today) {
    const e = it.entry, rec = it.recipe, status = L.status(it, batches, today);
    const name = rec ? rec.name : (e.recipeName || "Meal");
    const mins = rec ? L.totalMinutes(rec) : 0;
    const key = it.key;
    let body = '<div class="mp-meal-body">';
    if (it.nutrition) body += '<p class="mp-meal-line">' + esc(nums(it.nutrition)) + est(it.source) + '</p>';
    else body += '<p class="mp-meal-line mp-dim">' + (rec ? 'This recipe has no nutrition numbers yet. Add them in Recipes.' : 'No nutrition numbers for this meal.') + '</p>';
    body += '<p class="mp-meal-line mp-dim">Portion: ' + esc(servingsText(e.servings)) + (mins ? ' · ' + esc(minutesText(mins)) + ' to prepare' : '') + (it.frozen ? ' · numbers as eaten' : '') + '</p>';
    if (status.batch) body += '<p class="mp-meal-line mp-dim">From a prepared batch (' + status.batch.remaining + ' ' + k.plural(status.batch.remaining, 'portion') + ' left).</p>';
    if (rec) {
      const ing = L.scaledIngredients(rec, e.servings);
      body += '<h4 class="mp-h5">Ingredients for this portion</h4><ul class="mp-ings">' + ing.map(function (i) { return '<li><span>' + esc(i.name) + '</span><span>' + esc(i.text) + '</span></li>'; }).join("") + '</ul>';
    } else if (e.isRestaurant) body += '<p class="mp-meal-line mp-dim">Eating out: nothing to buy or prepare.</p>';
    body += '<div class="mp-actions">';
    if (it.eaten) body += '<button type="button" class="btn btn-secondary" data-mp="plan:uneat" data-id="' + esc(e.id) + '" data-date="' + it.date + '">Not eaten</button>';
    else {
      body += '<button type="button" class="btn btn-primary" data-mp="plan:eat" data-id="' + esc(e.id) + '" data-date="' + it.date + '">Mark eaten</button>';
      if (rec && !status.batch) body += '<button type="button" class="btn btn-secondary" data-mp="plan:prepped" data-id="' + esc(e.id) + '" data-date="' + it.date + '" aria-pressed="' + (status.code === "prepped") + '">' + (status.code === "prepped" ? "Prepped ✓" : "Mark prepped") + '</button>';
    }
    body += '<button type="button" class="btn btn-secondary" data-mp="plan:move" data-id="' + esc(e.id) + '" data-date="' + it.date + '">Move</button>' +
      '<button type="button" class="btn btn-secondary" data-mp="plan:edit" data-id="' + esc(e.id) + '" data-date="' + it.date + '">Edit</button>' +
      '<button type="button" class="btn btn-secondary danger" data-mp="plan:remove" data-id="' + esc(e.id) + '" data-date="' + it.date + '">Remove</button></div></div>';
    return '<details class="mp-meal is-' + status.code + '" data-open-key="meal:' + esc(key) + '" data-key="' + esc(key) + '" data-id="' + esc(e.id) + '" data-date="' + it.date + '"' + k.openAttr("meal:" + key, false) + '>' +
      '<summary class="mp-meal-sum">' +
      '<span class="mp-meal-top"><span class="mp-meal-name">' + esc(name) + (it.recurring ? ' <span class="mp-rep" title="Repeats weekly">↻</span>' : '') + '</span><span class="mp-chip mp-st-' + status.code + '">' + esc(status.label) + '</span></span>' +
      '<span class="mp-meal-sub">' + (it.nutrition ? esc(it.nutrition.calories + " kcal · P " + Math.round(it.nutrition.protein) + " g · C " + Math.round(it.nutrition.carbs) + " g · F " + Math.round(it.nutrition.fat) + " g") + est(it.source) : '<span class="mp-dim">No numbers yet</span>') +
      '<span class="mp-dim"> · ' + esc(servingsText(e.servings)) + (mins ? ' · ' + esc(minutesText(mins)) : '') + '</span></span></summary>' + body + '</details>';
  }

  function dayHtml(date, plan, recipes, batches, training, today) {
    const dp = L.dayPlan(plan, recipes, date), isToday = date === today, work = training[date];
    const tot = dp.items.length ? esc(nums(dp.totals)) + (dp.anyEstimated ? ' <em class="mp-est">est.</em>' : '') + (dp.withoutNumbers ? ' <span class="mp-dim">(' + dp.withoutNumbers + ' without numbers)</span>' : '') : '<span class="mp-dim">Nothing planned</span>';
    let body = '';
    if (work) body += '<p class="mp-train">' + ICON_BELL + 'Training day: ' + esc(work) + '. Plan protein and carbs around it. Nothing here limits how much you eat.</p>';
    L.MEALS.forEach(function (meal) {
      const items = dp.items.filter(function (i) { return i.meal === meal; });
      body += '<div class="mp-group"><div class="mp-group-h"><h3>' + esc(L.MEAL_LABELS[meal]) + '</h3><button type="button" class="mp-add" data-mp="plan:add" data-date="' + date + '" data-meal="' + meal + '" aria-label="' + esc("Add to " + L.MEAL_LABELS[meal] + " on " + k.prettyDay(date)) + '">+ Add</button></div>' +
        (items.length ? items.map(function (i) { return mealHtml(i, batches, today); }).join("") : '<p class="mp-empty">Nothing planned</p>') + '</div>';
    });
    return '<details class="mp-day" data-open-key="day:' + date + '" data-date="' + date + '"' + k.openAttr("day:" + date, isToday) + '>' +
      '<summary class="mp-day-sum"><span class="mp-day-name">' + esc(dayShort(date)) + ' <b>' + dayNum(date) + '</b>' + (isToday ? ' <span class="mp-chip mp-st-today">Today</span>' : '') + (work ? ' <span class="mp-chip mp-st-train">' + ICON_BELL + esc(work) + '</span>' : '') + '</span><span class="mp-day-tot">' + tot + '</span></summary>' +
      '<div class="mp-day-body">' + body + '</div></details>';
  }

  /* ---- planned against logged ---- */

  function barRow(label, unit, planned, logged, target) {
    const max = Math.max(planned, logged, target || 0, 1);
    const pw = Math.min(100, planned / max * 100), lw = Math.min(100, logged / max * 100);
    const diff = logged - planned;
    const desc = label + ": planned " + k.num(planned) + " " + unit + ", logged " + k.num(logged) + " " + unit + (target > 0 ? ", target " + k.num(target) + " " + unit : "");
    return '<div class="mp-bar-row"><div class="mp-bar-h"><span>' + esc(label) + '</span><span class="mp-dim">planned ' + k.num(planned) + ' · logged ' + k.num(logged) + (target > 0 ? ' · target ' + k.num(target) : '') + ' ' + unit + '</span></div>' +
      '<div class="mp-bar" role="img" aria-label="' + esc(desc) + '"><span class="mp-bar-logged" style="width:' + lw.toFixed(1) + '%"></span><span class="mp-bar-plan" style="left:' + pw.toFixed(1) + '%"></span></div>' +
      '<div class="mp-bar-d mp-dim">' + (planned || logged ? (diff === 0 ? 'Logged matches the plan.' : 'Logged is ' + k.num(Math.abs(diff)) + ' ' + unit + (diff < 0 ? ' less than' : ' more than') + ' planned.') : 'Nothing planned or logged.') + '</div></div>';
  }

  function chartSvg(days, metric, tg) {
    const narrow = window.innerWidth < 700, W = narrow ? 360 : 700, H = narrow ? 200 : 170, padL = 8, padB = 24, padT = 10, bw = narrow ? 14 : 26, gap = narrow ? 4 : 6;
    const vals = days.map(function (d) { return { d: d.date, p: d.plan.totals[metric], l: d.logged ? d.logged[metric] || 0 : 0 }; });
    const t = tg && tg[metric] > 0 ? tg[metric] : 0;
    const max = Math.max(1, t, Math.max.apply(null, vals.map(function (v) { return Math.max(v.p, v.l); }))) * 1.08;
    const ch = H - padB - padT, colW = (W - padL * 2) / 7;
    let out = '<svg class="mp-chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="' + esc("Planned and logged " + metric + " for each day of the week") + '">';
    out += '<line x1="' + padL + '" y1="' + (H - padB) + '" x2="' + (W - padL) + '" y2="' + (H - padB) + '" class="mp-ax"/>';
    if (t) { const y = H - padB - t / max * ch; out += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padL) + '" y2="' + y.toFixed(1) + '" class="mp-tgt"/>'; }
    vals.forEach(function (v, i) {
      const cx = padL + colW * i + colW / 2, ph = v.p / max * ch, lh = v.l / max * ch;
      out += '<g><title>' + esc(k.prettyDay(v.d) + ": planned " + k.num(v.p) + ", logged " + k.num(v.l)) + '</title>' +
        '<rect x="' + (cx - bw - gap / 2).toFixed(1) + '" y="' + (H - padB - ph).toFixed(1) + '" width="' + bw + '" height="' + Math.max(0, ph).toFixed(1) + '" rx="4" class="mp-b-plan"/>' +
        '<rect x="' + (cx + gap / 2).toFixed(1) + '" y="' + (H - padB - lh).toFixed(1) + '" width="' + bw + '" height="' + Math.max(0, lh).toFixed(1) + '" rx="4" class="mp-b-log"/>' +
        '<text x="' + cx.toFixed(1) + '" y="' + (H - 7) + '" text-anchor="middle" class="mp-ax-t">' + esc(dayShort(v.d)) + '</text></g>';
    });
    return out + '</svg>';
  }

  function overviewCard(plan, recipes, training) {
    const ds = dates(), sel = selected(), today = k.today(), tg = k.targets();
    const days = ds.map(function (d) { return { date: d, plan: L.dayPlan(plan, recipes, d), logged: d <= today ? k.logged(d) : null }; });
    const cur = days.filter(function (d) { return d.date === sel; })[0], lg = cur.logged || { calories: 0, protein: 0, carbs: 0, fat: 0 };
    const items = cur.plan.items, doneItems = items.filter(function (i) { return i.eaten; }), upcoming = items.filter(function (i) { return !i.eaten; });
    let h = '<details class="card mp-card" data-open-key="overview" ' + (k.isOpen("overview", true) ? "open" : "") + '><summary class="mp-card-sum"><span class="mp-card-title">Nutrition overview</span><span class="mp-dim">planned and logged</span></summary><div class="mp-card-body">';
    h += '<div class="mp-pills" role="group" aria-label="Choose a day">' + ds.map(function (d) { return '<button type="button" class="mp-pill' + (d === sel ? ' is-on' : '') + '" aria-pressed="' + (d === sel) + '" data-mp="plan:sel" data-date="' + d + '">' + esc(dayShort(d)) + ' ' + dayNum(d) + '</button>'; }).join("") + '</div>';
    h += '<p class="mp-dim mp-ov-day">' + esc(k.prettyDay(sel, { weekday: "long", month: "long", day: "numeric" })) + (cur.logged ? '' : ' (no food logged yet for a day that has not come)') + '</p>';
    METRICS.forEach(function (m) { h += barRow(m[1], m[2], Math.round(cur.plan.totals[m[0]]), Math.round(lg[m[0]] || 0), tg ? tg[m[0]] : 0); });
    h += '<p class="mp-ov-meals"><strong>Completed:</strong> ' + (doneItems.length ? doneItems.map(function (i) { return esc(L.MEAL_LABELS[i.meal]); }).join(", ") : 'none yet') + '. <strong>Upcoming:</strong> ' + (upcoming.length ? upcoming.map(function (i) { return esc(L.MEAL_LABELS[i.meal]); }).join(", ") : 'none') + '.</p>';
    // gentle fueling notes: never a "cut back", only "you may want more"
    const notes = [];
    if (tg && tg.calories > 0 && items.length && !cur.plan.withoutNumbers && cur.plan.totals.calories < tg.calories * 0.75) notes.push('The plan for this day is well under your calorie target. If you are training or hungry, add a snack or a bigger portion.');
    if (training[sel]) notes.push('Training day (' + esc(training[sel]) + '): protein and carbs in the meal after training help recovery.');
    if (cur.plan.anyEstimated) notes.push('Some planned numbers are estimates from a typical-values list, not a label. Treat them as approximate.');
    if (cur.plan.withoutNumbers) notes.push(cur.plan.withoutNumbers + ' planned ' + k.plural(cur.plan.withoutNumbers, 'meal has', 'meals have') + ' no nutrition numbers, so ' + k.plural(cur.plan.withoutNumbers, 'it is', 'they are') + ' not in the totals.');
    if (notes.length) h += '<ul class="mp-notes">' + notes.map(function (n) { return '<li>' + n + '</li>'; }).join("") + '</ul>';
    // the week
    h += '<h3 class="mp-h3">This week</h3><div class="mp-pills" role="group" aria-label="What to chart">' + METRICS.map(function (m) { return '<button type="button" class="mp-pill' + (st.metric === m[0] ? ' is-on' : '') + '" aria-pressed="' + (st.metric === m[0]) + '" data-mp="plan:metric" data-metric="' + m[0] + '">' + m[1] + '</button>'; }).join("") + '</div>';
    h += chartSvg(days, st.metric, tg);
    h += '<p class="mp-legend"><span class="mp-key mp-key-plan"></span> Planned <span class="mp-key mp-key-log"></span> Logged' + (tg && tg[st.metric] > 0 ? ' <span class="mp-key mp-key-tgt"></span> Your target' : '') + '</p>';
    h += '<details class="mp-tbl" data-open-key="chart-table"' + k.openAttr("chart-table", false) + '><summary>Show as a table</summary><table><thead><tr><th scope="col">Day</th><th scope="col">Planned</th><th scope="col">Logged</th></tr></thead><tbody>' +
      days.map(function (d) { return '<tr><th scope="row">' + esc(k.prettyDay(d.date)) + '</th><td>' + k.num(Math.round(d.plan.totals[st.metric])) + '</td><td>' + (d.logged ? k.num(Math.round(d.logged[st.metric] || 0)) : '—') + '</td></tr>'; }).join("") + '</tbody></table></details>';
    h += '<p class="mp-foot">Planned numbers come from your recipes (per serving × portions). Logged numbers are what you added to your food log. Estimates are marked "est.".</p>';
    return h + '</div></details>';
  }

  /* ---- ideas ---- */

  function ideasCard(plan, recipes, training) {
    const ds = dates(), today = k.today();
    const future = ds.filter(function (d) { return d >= today; });
    const fills = L.fillSuggestions({ dates: future, plan: plan, recipes: recipes, training: training }).slice(0, 6);
    const rec = L.recoveryRecipes(recipes).slice(0, 4);
    const g = k.G(), pantry = g ? g.pantry() : {};
    const match = L.pantryMatches(recipes, pantry).slice(0, 3);
    let h = '<details class="card mp-card" data-open-key="ideas"' + k.openAttr("ideas", false) + '><summary class="mp-card-sum"><span class="mp-card-title">Ideas from your recipes</span><span class="mp-dim">suggestions, not rules</span></summary><div class="mp-card-body">';
    if (!recipes.length) h += '<p class="mp-dim">Save a few recipes and JARVIS will suggest meals for empty slots here.</p>';
    if (fills.length) {
      h += '<h3 class="mp-h3">Fill empty meals</h3><ul class="mp-list">' + fills.map(function (s, i) {
        return '<li><span><strong>' + esc(k.prettyDay(s.date, { weekday: "short" }) + " " + L.MEAL_LABELS[s.meal]) + '</strong> · ' + esc(s.recipe.name) + '<span class="mp-dim"> · ' + esc(s.why) + '</span></span><button type="button" class="btn btn-secondary" data-mp="plan:fill" data-i="' + i + '" aria-label="' + esc("Add " + s.recipe.name + " to " + L.MEAL_LABELS[s.meal] + " on " + k.prettyDay(s.date)) + '">Add</button></li>';
      }).join("") + '</ul>';
    }
    if (rec.length) {
      h += '<h3 class="mp-h3">Good for recovery</h3><p class="mp-dim">Meals with at least ' + L.RECOVERY_PROTEIN_G + ' g protein and ' + L.RECOVERY_CARBS_G + ' g carbs per serving.</p><ul class="mp-list">' + rec.map(function (r) { const p = L.recipePer(r); return '<li><span>' + esc(r.name) + '<span class="mp-dim"> · ' + Math.round(p.protein) + ' g protein · ' + Math.round(p.carbs) + ' g carbs</span></span><button type="button" class="btn btn-secondary" data-mp="plan:addrecipe" data-id="' + esc(r.id) + '">Add to plan</button></li>'; }).join("") + '</ul>';
    }
    if (match.length) {
      h += '<h3 class="mp-h3">Cook with what you have</h3><ul class="mp-list">' + match.map(function (m) {
        return '<li><span>' + esc(m.recipe.name) + '<span class="mp-dim"> · you have ' + m.have + ' of ' + m.total + ' ingredients' + (m.missing.length ? ' (need ' + esc(m.missing.slice(0, 3).join(", ")) + (m.missing.length > 3 ? ", …" : "") + ')' : '') + '</span></span><button type="button" class="btn btn-secondary" data-mp="plan:addrecipe" data-id="' + esc(m.recipe.id) + '">Add to plan</button></li>';
      }).join("") + '</ul>';
    }
    if (recipes.length && !fills.length && !rec.length && !match.length) h += '<p class="mp-dim">Nothing to suggest right now. Tag recipes as Breakfast, Lunch, Dinner or Snacks, and keep your pantry up to date in the Grocery List tab.</p>';
    return h + '</div></details>';
  }

  /* ---------------- the pane ---------------- */

  function render() {
    const p = k.plan(), recs = k.recipes(), batches = k.batches.all(), ds = dates(), today = k.today(), training = L.trainingDays(k.routines(), ds);
    let h = '<div class="mp-week-head"><button type="button" class="btn-icon mp-nav" data-mp="plan:prev" aria-label="Previous week">&larr;</button><h2 class="mp-week-title" aria-live="polite">' + esc(rangeTitle()) + '</h2><button type="button" class="btn-icon mp-nav" data-mp="plan:next" aria-label="Next week">&rarr;</button></div>' +
      '<div class="mp-toolbar">' + (weekStart() !== L.mondayOf(today) ? '<button type="button" class="btn btn-secondary" data-mp="plan:today">This week</button>' : '') + '<button type="button" class="btn btn-primary" data-mp="plan:add" data-date="' + (selected()) + '">+ Add meal</button></div>';
    h += '<div class="mp-days">' + ds.map(function (d) { return dayHtml(d, p, recs, batches, training, today); }).join("") + '</div>';
    h += overviewCard(p, recs, training) + ideasCard(p, recs, training);
    h += '<p class="mp-foot">Drag a meal onto another day, or use Move. Tap a meal to see its ingredients.</p>';
    return h;
  }

  /* ---------------- changing the plan ---------------- */

  function entryOf(id) { return k.plan().filter(function (e) { return e.id === id; })[0] || null; }
  function day(date) { return k.prettyDay(date, { weekday: "short", month: "short", day: "numeric" }); }

  function eat(id, date) {
    const plan = k.plan(), e = plan.filter(function (x) { return x.id === id; })[0];
    if (!e) return;
    if (date > k.today()) { k.toast("That day hasn't happened yet. You can mark it eaten on the day."); return; }
    const recs = k.recipes(), rec = L.recipeOf(e, recs), n = L.entryNutrition(e, recs, date), N = k.N(), t = k.now();
    let itemId = "";
    if (n.nutrition && N && N.log) {
      const r = N.log.add({ date: date, meal: e.meal, name: (rec ? rec.name : e.recipeName) + " (" + servingsText(e.servings) + ")", serving: servingsText(e.servings), calories: n.nutrition.calories, protein: n.nutrition.protein, carbs: n.nutrition.carbs, fat: n.nutrition.fat });
      if (!r.ok) { k.toast(r.error); return; }
      itemId = r.id;
    }
    const batchesBefore = k.batches.raw();
    let used = [];
    if (rec) {
      const u = L.useFromBatches(batchesBefore, rec.id, e.servings, date, t);
      used = u.used;
      if (used.length && !k.commitBatches(u.batches)) { if (itemId) N.log.remove(date, e.meal, itemId); return; }
    }
    const next = L.markEaten(plan, id, date, { nutrition: n.nutrition, name: rec ? rec.name : e.recipeName, source: n.source, itemId: itemId, batches: used }, t);
    const r = k.commitPlan(next);
    if (!r.ok) { if (used.length) k.commitBatches(batchesBefore); if (itemId) N.log.remove(date, e.meal, itemId); return; }
    if (rec && !used.length && k.G()) k.G().consume(rec.ingredients, (Number(e.servings) || 1) / L.servingsOf(rec));
    if (k.habitTick && e.meal === "breakfast") k.habitTick("breakfast", date);
    k.render({ keepScroll: true });
    k.undo("Marked eaten: " + (rec ? rec.name : e.recipeName) + (used.length ? ". Used a prepared portion." : "."), function () { uneat(id, date, true); });
  }
  function uneat(id, date, quiet) {
    const plan = k.plan(), e = plan.filter(function (x) { return x.id === id; })[0];
    if (!e) return;
    const N = k.N(), itemId = e.loggedItems && e.loggedItems[date], used = e.fromBatch && e.fromBatch[date] || [], rec = L.recipeOf(e, k.recipes());
    if (itemId && N) N.log.remove(date, e.meal, itemId);
    if (used.length) {
      let list = k.batches.raw();
      used.forEach(function (u) { list = L.restorePortions(list, u.batchId, u.n, date, k.now()); });
      k.commitBatches(list);
    }
    const r = k.commitPlan(L.unmarkEaten(plan, id, date, k.now()));
    if (!r.ok) return;
    if (rec && !used.length && k.G()) k.G().consume(rec.ingredients, -(Number(e.servings) || 1) / L.servingsOf(rec));
    k.render({ keepScroll: true });
    if (!quiet) k.say("Marked as not eaten.");
  }
  function togglePrepped(id, date) {
    const e = entryOf(id); if (!e) return;
    const on = (e.preppedDates || []).indexOf(date) === -1;
    if (k.commitPlan(L.setPrepped(k.plan(), id, date, on, k.now())).ok) {
      if (on && k.habitTick && e.meal === "lunch") k.habitTick("lunchPrep", date);
      k.render({ keepScroll: true, focus: '[data-mp="plan:prepped"][data-id="' + id + '"][data-date="' + date + '"]' });
      k.say(on ? "Marked prepped." : "Marked not prepped.");
    }
  }
  function remove(id, date) {
    const before = k.plan(), e = entryOf(id);
    if (!e) return;
    const finish = function (next, label) {
      if (!k.commitPlan(next).ok) return;
      k.render({ keepScroll: true });
      k.undo(label, function () { if (k.commitPlan(before).ok) k.render({ keepScroll: true }); });
    };
    if (e.type === "recurring") { finish(L.removeOccurrence(before, id, date, k.now()), "Removed “" + e.recipeName + "” from " + day(date) + " only. It still repeats on other days."); return; }
    if (e.group && before.filter(function (x) { return x.group === e.group; }).length > 1) {
      window.JarvisMenu.open({ title: "Remove “" + e.recipeName + "”", opener: document.activeElement, rows: [{ key: "one", label: "Just this day" }, { key: "all", label: "All the days I repeated it on", sub: "Removes every copy made together" }],
        onPick: function (key) { finish(L.removeEntry(before, id, key === "all"), key === "all" ? "Removed all repeats of “" + e.recipeName + "”." : "Removed “" + e.recipeName + "”."); } });
      return;
    }
    finish(L.removeEntry(before, id, false), "Removed “" + e.recipeName + "”.");
  }
  function moveTo(id, from, to) {
    const before = k.plan(), e = entryOf(id);
    if (!e) return false;
    const r = L.moveOccurrence(before, id, from, to, k.uid("plan"), k.now());
    if (r.error) { k.toast(r.error); return false; }
    if (r.same) return false;
    if (!k.commitPlan(r.plan).ok) return false;
    k.render({ keepScroll: true });
    k.undo("Moved “" + e.recipeName + "” to " + day(to) + (e.type === "recurring" ? " (just that day)." : "."), function () { if (k.commitPlan(before).ok) k.render({ keepScroll: true }); });
    return true;
  }
  function openMove(id, date, opener) {
    const rows = dates().filter(function (d) { return d !== date; }).map(function (d) { return { key: d, label: day(d) }; });
    rows.push({ key: "other", label: "Another date…" });
    window.JarvisMenu.open({
      title: "Move to", opener: opener, rows: rows,
      onPick: function (key) {
        if (key !== "other") { moveTo(id, date, key); return; }
        const A = k.A(); if (!A) return;
        A.openSheet({ title: "Move to another date", body: A.fText("date", "Date", date, { type: "date" }), submit: "Move", focus: '[name="date"]',
          onSubmit: function (v) { if (!L.isDate(v.date)) return { ok: false, errors: { date: "Choose a day." } }; moveTo(id, date, v.date); return { ok: true }; } });
      }
    });
  }

  /* ---------------- the add / edit sheet ---------------- */

  function recipeOptions() { return [["", "Quick meal (no recipe)"]].concat(k.recipes().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (r) { return [r.id, r.name]; })); }
  function repeatChips(date, checked) {
    const wk = L.weekDates(L.mondayOf(date));
    return '<div class="cal-chips">' + wk.map(function (d, i) {
      return '<label class="cal-chip-btn hb-daychip"><input type="checkbox" data-multi name="repeat" value="' + d + '"' + (checked.indexOf(d) !== -1 && d !== date ? " checked" : "") + (d === date ? " disabled" : "") + '> ' + DAY_LABELS[i] + ' ' + dayNum(d) + '</label>';
    }).join("") + '</div>';
  }
  // o: { id, date, meal, recipeId, servings }
  function openMealSheet(o) {
    const A = k.A();
    if (!A) { k.toast("Meals can't be added here right now."); return; }
    const op = o || {}, e = op.id ? entryOf(op.id) : null;
    if (op.id && !e) { k.toast("That meal isn't there any more."); return; }
    const recurring = !!(e && e.type === "recurring");
    const date = e && !recurring ? e.date : (op.date || k.today());
    const meal = e ? e.meal : (op.meal || (op.recipeId && (k.recipeById(op.recipeId) || {}).cats ? ((k.recipeById(op.recipeId).cats || [])[0] || "dinner") : "dinner"));
    const recId = e ? (e.recipeId || "") : (op.recipeId || "");
    const quick = e && !e.recipeId ? e : null;
    let body = A.fSelect("meal", "Meal", L.MEALS.map(function (m) { return [m, L.MEAL_LABELS[m]]; }), meal);
    if (recurring) {
      body += '<div class="form-row"><fieldset class="cdp-days"><legend>Repeats on</legend><div class="cal-chips">' + [1, 2, 3, 4, 5, 6, 0].map(function (d) { return '<label class="cal-chip-btn hb-daychip"><input type="checkbox" data-multi name="days" value="' + d + '"' + ((e.days || []).indexOf(d) !== -1 ? " checked" : "") + '> ' + ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d] + '</label>'; }).join("") + '</div><p class="sp-err hidden" data-err="days" role="alert"></p></fieldset></div>';
    } else body += A.fText("date", "Day", date, { type: "date" });
    body += A.fSelect("recipe", "Recipe", recipeOptions(), recId, { hint: k.recipes().length ? "" : "You have no recipes yet. Add one in the Recipes tab, or use a quick meal." });
    body += A.row("servings", "Portion (servings)", '<input type="number" id="spf_servings" name="servings" min="0.25" max="50" step="0.25" value="' + esc(e ? e.servings : (op.servings || 1)) + '">', {});
    body += '<div data-quick>' + A.fText("qname", "Meal name", quick ? quick.recipeName : "", { max: 80, placeholder: "e.g. Greek yogurt and fruit" }) +
      '<div class="form-row two-col"><div>' + A.fText("qcal", "Calories (optional)", quick && quick.macros ? quick.macros.calories : "", { type: "number" }) + '</div><div>' + A.fText("qpro", "Protein g", quick && quick.macros ? quick.macros.protein : "", { type: "number" }) + '</div></div>' +
      '<div class="form-row two-col"><div>' + A.fText("qcarb", "Carbs g", quick && quick.macros ? quick.macros.carbs : "", { type: "number" }) + '</div><div>' + A.fText("qfat", "Fat g", quick && quick.macros ? quick.macros.fat : "", { type: "number" }) + '</div></div>' +
      '<p class="field-hint">Numbers are per serving and are yours (typed), so they are not marked as estimates.</p></div>';
    body += '<label class="cal-check mp-eatout"><input type="checkbox" name="out"' + (e && e.isRestaurant ? " checked" : "") + '> Eating out or takeout (nothing to buy or prepare)</label>';
    if (!e) body += '<div class="form-row"><fieldset class="cdp-days"><legend>Repeat the same meal on</legend><div data-repeat>' + repeatChips(date, []) + '</div><p class="field-hint">Each day gets its own copy, so you can still move, edit or eat each one separately.</p></fieldset></div>';
    function sync(root) {
      const has = !!root.querySelector('[name="recipe"]').value;
      root.querySelector("[data-quick]").classList.toggle("hidden", has);
    }
    A.openSheet({
      title: e ? (recurring ? "Edit repeating meal" : "Edit meal") : "Add a meal", body: body, submit: e ? "Save" : "Add to plan", focus: '[name="recipe"]',
      onOpen: sync,
      onChange: function (el, root) {
        if (el.name === "recipe") { sync(root); const r = k.recipeById(el.value); if (r && !e && r.cats && r.cats.length && r.cats.indexOf(root.querySelector('[name="meal"]').value) === -1) root.querySelector('[name="meal"]').value = r.cats[0]; }
        if (el.name === "date" && L.isDate(el.value)) { const box = root.querySelector("[data-repeat]"); if (box) { const on = Array.prototype.slice.call(root.querySelectorAll('[name="repeat"]:checked')).map(function (c) { return c.value; }); box.innerHTML = repeatChips(el.value, on); } }
      },
      onSubmit: function (v) { return saveMeal(v, e); }
    });
  }
  function saveMeal(v, e) {
    const recurring = !!(e && e.type === "recurring");
    const rec = v.recipe ? k.recipeById(v.recipe) : null;
    const servings = Math.round((Number(v.servings) || 0) * 100) / 100;
    const errors = {};
    if (!(servings > 0)) errors.servings = "Enter a portion above 0.";
    if (!recurring && !L.isDate(v.date)) errors.date = "Choose a day.";
    if (recurring && !(v.days || []).length) errors.days = "Choose at least one day.";
    const name = String(v.qname || "").replace(/\s+/g, " ").trim();
    if (!rec && !name) errors.qname = "Name the meal, or choose a recipe.";
    if (Object.keys(errors).length) return { ok: false, errors: errors };
    const macros = { calories: Number(v.qcal) || 0, protein: Number(v.qpro) || 0, carbs: Number(v.qcarb) || 0, fat: Number(v.qfat) || 0 };
    const hasMacros = !rec && (macros.calories || macros.protein || macros.carbs || macros.fat);
    const t = k.now(), before = k.plan();
    const fields = { meal: v.meal, recipeId: rec ? rec.id : null, recipeName: rec ? rec.name : name, servings: servings, isRestaurant: !!v.out, includeInGroceries: false, updatedAt: t };
    let next;
    if (e) {
      next = before.map(function (x) {
        if (x.id !== e.id) return x;
        const o = Object.assign({}, x, fields, recurring ? { days: (v.days || []).map(Number) } : { date: v.date });
        if (hasMacros) o.macros = macros; else delete o.macros;
        return o;
      });
    } else {
      const base = Object.assign({ id: k.uid("plan"), type: "single", date: v.date, days: null, completedDates: [], createdAt: t }, fields);
      if (hasMacros) base.macros = macros;
      const more = (v.repeat || []).filter(function (d) { return d !== v.date; });
      const group = more.length ? k.uid("grp") : "";
      if (group) base.group = group;
      const copies = L.repeatEntries(base, more, function () { return k.uid("plan"); }, group, t);
      next = before.concat([base], copies);
    }
    if (!k.commitPlan(next).ok) return { ok: false, message: "That couldn't be saved." };
    if (!e) { st.start = L.mondayOf(v.date); st.sel = v.date; }
    k.render({ keepScroll: true });
    k.undo(e ? "Saved “" + fields.recipeName + "”." : "Added “" + fields.recipeName + "”" + ((v.repeat || []).filter(function (d) { return d !== v.date; }).length ? " to " + (1 + (v.repeat || []).filter(function (d) { return d !== v.date; }).length) + " days." : " to " + day(v.date) + "."), function () { if (k.commitPlan(before).ok) k.render({ keepScroll: true }); });
    return { ok: true };
  }

  /* ---------------- dragging a meal to another day ---------------- */

  let drag = null;
  function dayAt(x, y) { const el = document.elementFromPoint(x, y); const d = el && el.closest ? el.closest(".mp-day") : null; return d; }
  function startDrag() {
    if (!drag || drag.active) return;
    drag.active = true;
    drag.el.classList.add("is-dragging");
    const g = document.createElement("div"); g.className = "mp-ghost"; g.setAttribute("aria-hidden", "true"); g.textContent = drag.name; document.body.appendChild(g); drag.ghost = g;
    drag.auto = window.setInterval(function () { if (!drag) return; if (drag.y < 70) window.scrollBy(0, -14); else if (drag.y > window.innerHeight - 70) window.scrollBy(0, 14); updateDrag(); }, 40);
    if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) { /* not supported */ } }
    updateDrag();
  }
  function updateDrag() {
    if (!drag || !drag.active) return;
    drag.ghost.style.left = Math.min(window.innerWidth - 160, drag.x + 12) + "px"; drag.ghost.style.top = (drag.y + 12) + "px";
    Array.prototype.forEach.call(document.querySelectorAll(".mp-day.is-drop"), function (n) { n.classList.remove("is-drop"); });
    const d = dayAt(drag.x, drag.y);
    drag.target = d ? d.getAttribute("data-date") : null;
    if (d && drag.target !== drag.from) d.classList.add("is-drop");
    drag.ghost.textContent = drag.target && drag.target !== drag.from ? drag.name + " → " + day(drag.target) : drag.name;
  }
  function endDrag(cancel) {
    if (!drag) return;
    const d = drag;
    if (d.timer) window.clearTimeout(d.timer);
    if (d.auto) window.clearInterval(d.auto);
    if (d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
    if (d.el) d.el.classList.remove("is-dragging");
    Array.prototype.forEach.call(document.querySelectorAll(".mp-day.is-drop"), function (n) { n.classList.remove("is-drop"); });
    document.removeEventListener("pointermove", onMove); document.removeEventListener("pointerup", onUp); document.removeEventListener("pointercancel", onCancel);
    drag = null;
    if (d.active) {
      k.suppressClicks(200);
      if (!cancel && d.target && d.target !== d.from) moveTo(d.id, d.from, d.target);
    }
  }
  function onMove(e) {
    if (!drag) return;
    drag.x = e.clientX; drag.y = e.clientY;
    if (!drag.active) {
      const moved = Math.hypot(drag.x - drag.sx, drag.y - drag.sy);
      if (drag.touch) { if (moved > 10) endDrag(true); return; }
      if (moved > 6) startDrag(); else return;
    }
    e.preventDefault(); updateDrag();
  }
  function onUp() { endDrag(false); }
  function onCancel() { endDrag(true); }
  function onDown(e) {
    const sum = e.target.closest ? e.target.closest(".mp-meal-sum") : null;
    if (!sum || (e.pointerType === "mouse" && e.button !== 0) || e.target.closest("button, a, input, select")) return;
    const m = sum.closest(".mp-meal");
    endDrag(true);
    drag = { id: m.getAttribute("data-id"), from: m.getAttribute("data-date"), el: m, name: (m.querySelector(".mp-meal-name") || { textContent: "Meal" }).textContent.trim(), sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, touch: e.pointerType === "touch" || e.pointerType === "pen", active: false, timer: null, target: null };
    if (drag.touch) drag.timer = window.setTimeout(startDrag, 380);
    document.addEventListener("pointermove", onMove, { passive: false }); document.addEventListener("pointerup", onUp); document.addEventListener("pointercancel", onCancel);
  }

  /* ---------------- taps ---------------- */

  function click(act, el) {
    const id = el.getAttribute("data-id"), date = el.getAttribute("data-date");
    if (act === "prev") { st.start = L.addDays(weekStart(), -7); st.sel = ""; k.render({ keepScroll: true }); return; }
    if (act === "next") { st.start = L.addDays(weekStart(), 7); st.sel = ""; k.render({ keepScroll: true }); return; }
    if (act === "today") { st.start = L.mondayOf(k.today()); st.sel = ""; k.render({ keepScroll: true }); return; }
    if (act === "sel") { st.sel = date; k.render({ keepScroll: true, focus: '[data-mp="plan:sel"][data-date="' + date + '"]' }); return; }
    if (act === "metric") { st.metric = el.getAttribute("data-metric"); k.render({ keepScroll: true, focus: '[data-mp="plan:metric"][data-metric="' + st.metric + '"]' }); return; }
    if (act === "add") { openMealSheet({ date: date, meal: el.getAttribute("data-meal") || "" }); return; }
    if (act === "eat") { eat(id, date); return; }
    if (act === "uneat") { uneat(id, date); return; }
    if (act === "prepped") { togglePrepped(id, date); return; }
    if (act === "move") { openMove(id, date, el); return; }
    if (act === "edit") { openMealSheet({ id: id }); return; }
    if (act === "remove") { remove(id, date); return; }
    if (act === "addrecipe") { openMealSheet({ recipeId: id, date: selected() }); return; }
    if (act === "fill") {
      const ds = dates(), today = k.today(), training = L.trainingDays(k.routines(), ds);
      const s = L.fillSuggestions({ dates: ds.filter(function (d) { return d >= today; }), plan: k.plan(), recipes: k.recipes(), training: training })[Number(el.getAttribute("data-i"))];
      if (!s) return;
      const before = k.plan(), t = k.now();
      const entry = { id: k.uid("plan"), type: "single", date: s.date, days: null, meal: s.meal, recipeId: s.recipe.id, recipeName: s.recipe.name, servings: 1, isRestaurant: false, includeInGroceries: false, completedDates: [], createdAt: t, updatedAt: t };
      if (k.commitPlan(before.concat([entry])).ok) { k.render({ keepScroll: true }); k.undo("Added “" + s.recipe.name + "” to " + L.MEAL_LABELS[s.meal].toLowerCase() + " on " + day(s.date) + ".", function () { if (k.commitPlan(before).ok) k.render({ keepScroll: true }); }); }
    }
  }

  k.openMealSheet = openMealSheet;
  k.planApi = { moveTo: moveTo };

  MP.register("plan", {
    render: render, click: click,
    init: function () { document.getElementById("mpRoot").addEventListener("pointerdown", onDown); document.getElementById("mpRoot").addEventListener("touchmove", function (e) { if (drag && drag.active && e.cancelable) e.preventDefault(); }, { passive: false }); }
  });
})();
