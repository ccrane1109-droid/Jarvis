/* ==========================================================================
   JARVIS — Meal Prep › Weekly Plan.

   Plan your regular foods once, then open JARVIS each day and check off what you ate.

   Seven days, each with Breakfast, Lunch, Dinner and Snacks, and as many FOODS under each as you like. Every food has a checkbox. Checking it
   means "I ate this": it goes into Today's food log (and so History) with the numbers it has, once, and it counts toward what you have EATEN.
   Unchecking takes that line out again. What is only planned never counts as eaten, and the plan is saved as you go, so a reload
   keeps every tick.

   A food can be a recipe, a food you saved, or a new one. Each has Replace (what you ate instead, for just that day or for every week
   from then on), Edit and Remove. A food can repeat every day, on chosen days each week (it carries into next week by itself), or on chosen
   days of this week only. A whole meal can be repeated, saved to reuse ("My usual breakfast"), and last week's foods can be copied in.

   The plan is the one Groceries already keeps (jarvisGroceryMealPlan), one entry per food, so adding a recipe still builds the grocery list
   and prepared portions still cover planned meals. Rules for repeating and replacing are in mealprep-logic.js.
   ========================================================================== */

(function () {
  "use strict";

  const MP = window.JarvisMealPrep;
  if (!MP) return;
  const k = MP.kit, L = k.L, esc = k.esc;
  const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const WEEKDAYS = [["1", "Mon"], ["2", "Tue"], ["3", "Wed"], ["4", "Thu"], ["5", "Fri"], ["6", "Sat"], ["0", "Sun"]];
  const METRICS = [["calories", "Calories", "kcal"], ["protein", "Protein", "g"], ["carbs", "Carbs", "g"], ["fat", "Fat", "g"]];
  const st = { start: "", sel: "", metric: "calories" };

  function weekStart() { if (!st.start) st.start = L.mondayOf(k.today()); return st.start; }
  function dates() { return L.weekDates(weekStart()); }
  function selected() { const d = dates(); if (!st.sel || d.indexOf(st.sel) === -1) st.sel = d.indexOf(k.today()) !== -1 ? k.today() : d[0]; return st.sel; }
  function dayShort(date) { return k.prettyDay(date, { weekday: "short" }); }
  function dayNum(date) { return Number(date.slice(8)); }
  function day(date) { return k.prettyDay(date, { weekday: "short", month: "short", day: "numeric" }); }
  function rangeTitle() { const d = dates(); return k.prettyDay(d[0], { month: "short", day: "numeric" }) + " – " + k.prettyDay(d[6], d[0].slice(5, 7) === d[6].slice(5, 7) ? { day: "numeric" } : { month: "short", day: "numeric" }); }
  function numsLine(n) { return n.calories + " kcal · P " + Math.round(n.protein) + " g · C " + Math.round(n.carbs) + " g · F " + Math.round(n.fat) + " g"; }
  function est(source) { return source === "estimated" || source === "mixed" ? ' <em class="mp-est" title="Some of these numbers are estimates">est.</em>' : ""; }
  function minutesText(m) { return m >= 60 ? Math.floor(m / 60) + " h" + (m % 60 ? " " + (m % 60) + " min" : "") : m + " min"; }
  function servingsText(n) { const v = Number(n) || 1; return (Math.round(v * 100) / 100) + " " + (v === 1 ? "serving" : "servings"); }
  function entryOf(id) { return k.plan().filter(function (e) { return e.id === id; })[0] || null; }
  function foodName(e, recipes) { const r = L.recipeOf(e, recipes || k.recipes()); return r ? r.name : (e.recipeName || "Food"); }

  const ICON_BELL = '<svg class="mp-ico" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path d="M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* ---------------- drawing the week ---------------- */

  function foodHtml(it, batches, today) {
    const e = it.entry, rec = it.recipe, status = L.status(it, batches, today);
    const name = rec ? rec.name : (e.recipeName || "Food");
    const mins = rec ? L.totalMinutes(rec) : 0, future = it.date > today, done = it.eaten;
    const key = it.key, ids = 'data-id="' + esc(e.id) + '" data-date="' + it.date + '"';
    let more = '<div class="mp-meal-body">';
    if (it.nutrition) more += '<p class="mp-meal-line">' + esc(numsLine(it.nutrition)) + est(it.source) + '</p>';
    else more += '<p class="mp-meal-line mp-dim">' + (rec ? 'This recipe has no nutrition numbers yet. Add them in Recipes.' : 'No numbers for this food. Edit it to add calories and protein.') + '</p>';
    more += '<p class="mp-meal-line mp-dim">Portion: ' + esc(servingsText(e.servings)) + (e.serving ? ' (' + esc(e.serving) + ' each)' : '') + (mins ? ' · ' + esc(minutesText(mins)) + ' to prepare' : '') + (it.frozen ? ' · numbers as eaten' : '') + '</p>';
    if (status.batch) more += '<p class="mp-meal-line mp-dim">From a prepared batch (' + status.batch.remaining + ' ' + k.plural(status.batch.remaining, 'portion') + ' left).</p>';
    if (rec) {
      const ing = L.scaledIngredients(rec, e.servings);
      more += '<h4 class="mp-h5">Ingredients for this portion</h4><ul class="mp-ings">' + ing.map(function (i) { return '<li><span>' + esc(i.name) + '</span><span>' + esc(i.text) + '</span></li>'; }).join("") + '</ul>';
    } else if (e.isRestaurant) more += '<p class="mp-meal-line mp-dim">Eating out: nothing to buy or prepare.</p>';
    more += '<div class="mp-actions">';
    if (rec && !done && !status.batch) more += '<button type="button" class="btn btn-secondary" data-mp="plan:prepped" ' + ids + ' aria-pressed="' + (status.code === "prepped") + '">' + (status.code === "prepped" ? "Prepped ✓" : "Mark prepped") + '</button>';
    more += '<button type="button" class="btn btn-secondary" data-mp="plan:move" ' + ids + '>Move to another day</button></div></div>';
    const chip = done ? "" : (rec ? '<span class="mp-chip mp-st-' + status.code + '">' + esc(status.label) + '</span>' : (e.isRestaurant ? '<span class="mp-chip">Eating out</span>' : ''));
    return '<div class="mp-food' + (done ? ' is-done' : '') + ' is-' + status.code + '" data-key="' + esc(key) + '" ' + ids + '>' +
      '<div class="mp-food-top"><label class="mp-food-check"><input type="checkbox" data-mp="plan:check" ' + ids + (done ? ' checked' : '') + (future ? ' disabled title="You can check this off on the day"' : '') + ' aria-label="' + esc("Eaten: " + name) + '"></label>' +
      '<div class="mp-food-info"><span class="mp-food-name">' + esc(name) + (it.recurring ? ' <span class="mp-rep" title="Repeats every week">↻</span>' : '') + ' ' + chip + '</span>' +
      '<span class="mp-food-sub">' + (it.nutrition ? esc(numsLine(it.nutrition)) + est(it.source) : '<span class="mp-dim">No numbers yet</span>') + '<span class="mp-dim"> · ' + esc(servingsText(e.servings)) + '</span></span></div></div>' +
      '<div class="mp-food-btns"><button type="button" class="mp-fb" data-mp="plan:replace" ' + ids + ' aria-label="' + esc("Replace " + name) + '">Replace</button>' +
      '<button type="button" class="mp-fb" data-mp="plan:edit" ' + ids + ' aria-label="' + esc("Edit " + name) + '">Edit</button>' +
      '<button type="button" class="mp-fb mp-fb-del" data-mp="plan:remove" ' + ids + ' aria-label="' + esc("Remove " + name) + '">Remove</button></div>' +
      '<details class="mp-food-more" data-open-key="food:' + esc(key) + '"' + k.openAttr("food:" + key, false) + '><summary>Details</summary>' + more + '</details></div>';
  }

  function dayHtml(date, plan, recipes, batches, training, today) {
    const dp = L.dayPlan(plan, recipes, date), isToday = date === today, work = training[date], total = dp.items.length;
    const pct = total ? Math.round(dp.eaten / total * 100) : 0;
    const sums = total ? '<span class="mp-day-prog"><strong>' + dp.eaten + ' of ' + total + '</strong> ' + k.plural(total, "food") + ' eaten · ' + dp.mealsDone + ' of ' + dp.mealsPlanned + ' ' + k.plural(dp.mealsPlanned, "meal") + ' done</span>' +
      '<span class="mp-prog" role="progressbar" aria-label="' + esc("Foods eaten on " + day(date)) + '" aria-valuemin="0" aria-valuemax="' + total + '" aria-valuenow="' + dp.eaten + '"><span style="width:' + pct + '%"></span></span>' +
      '<span class="mp-day-tot">' + esc(k.num(dp.totals.calories) + " kcal planned") + (dp.anyEstimated ? ' <em class="mp-est">est.</em>' : '') + (dp.eaten ? ' · ' + esc(k.num(dp.eatenTotals.calories) + " kcal eaten") : '') + (dp.withoutNumbers ? ' <span class="mp-dim">(' + dp.withoutNumbers + ' without numbers)</span>' : '') + '</span>' : '<span class="mp-day-tot mp-dim">Nothing planned</span>';
    let body = '';
    if (work) body += '<p class="mp-train">' + ICON_BELL + 'Training day: ' + esc(work) + '. Plan protein and carbs around it. Nothing here limits how much you eat.</p>';
    L.MEALS.forEach(function (meal) {
      const items = dp.items.filter(function (i) { return i.meal === meal; }), m = dp.meals[meal];
      body += '<div class="mp-group"><div class="mp-group-h"><h3>' + esc(L.MEAL_LABELS[meal]) + '</h3>' + (m.total ? '<span class="mp-group-prog' + (m.done ? ' is-done' : '') + '">' + m.eaten + ' of ' + m.total + ' eaten</span>' : '') +
        '<span class="mp-group-act"><button type="button" class="mp-add" data-mp="plan:add" data-date="' + date + '" data-meal="' + meal + '" aria-label="' + esc("Add food to " + L.MEAL_LABELS[meal] + " on " + day(date)) + '">+ Add food</button>' +
        '<button type="button" class="mp-add" data-mp="plan:mealmenu" data-date="' + date + '" data-meal="' + meal + '" aria-haspopup="menu" aria-label="' + esc("More for " + L.MEAL_LABELS[meal] + " on " + day(date)) + '">More</button></span></div>' +
        (items.length ? items.map(function (i) { return foodHtml(i, batches, today); }).join("") : '<p class="mp-empty">Nothing planned</p>') + '</div>';
    });
    return '<details class="mp-day' + (total && dp.eaten === total ? ' is-complete' : '') + '" data-open-key="day:' + date + '" data-date="' + date + '"' + k.openAttr("day:" + date, isToday) + '>' +
      '<summary class="mp-day-sum"><span class="mp-day-name">' + esc(dayShort(date)) + ' <b>' + dayNum(date) + '</b>' + (isToday ? ' <span class="mp-chip mp-st-today">Today</span>' : '') + (work ? ' <span class="mp-chip mp-st-train">' + ICON_BELL + esc(work) + '</span>' : '') + '</span>' + sums + '</summary>' +
      '<div class="mp-day-body">' + body + '</div></details>';
  }

  /* ---- planned against eaten ---- */

  function barRow(label, unit, planned, eaten, target) {
    const max = Math.max(planned, eaten, target || 0, 1);
    const pw = Math.min(100, planned / max * 100), lw = Math.min(100, eaten / max * 100), diff = eaten - planned;
    const desc = label + ": planned " + k.num(planned) + " " + unit + ", eaten " + k.num(eaten) + " " + unit + (target > 0 ? ", target " + k.num(target) + " " + unit : "");
    return '<div class="mp-bar-row"><div class="mp-bar-h"><span>' + esc(label) + '</span><span class="mp-dim">planned ' + k.num(planned) + ' · eaten ' + k.num(eaten) + (target > 0 ? ' · target ' + k.num(target) : '') + ' ' + unit + '</span></div>' +
      '<div class="mp-bar" role="img" aria-label="' + esc(desc) + '"><span class="mp-bar-logged" style="width:' + lw.toFixed(1) + '%"></span><span class="mp-bar-plan" style="left:' + pw.toFixed(1) + '%"></span></div>' +
      '<div class="mp-bar-d mp-dim">' + (planned || eaten ? (diff === 0 ? 'Eaten matches the plan.' : 'Eaten is ' + k.num(Math.abs(diff)) + ' ' + unit + (diff < 0 ? ' less than' : ' more than') + ' planned.') : 'Nothing planned or eaten.') + '</div></div>';
  }

  function chartSvg(days, metric, tg) {
    const narrow = window.innerWidth < 700, W = narrow ? 360 : 700, H = narrow ? 200 : 170, padL = 8, padB = 24, padT = 10, bw = narrow ? 14 : 26, gap = narrow ? 4 : 6;
    const vals = days.map(function (d) { return { d: d.date, p: d.plan.totals[metric], l: d.plan.eatenTotals[metric] || 0 }; });
    const t = tg && tg[metric] > 0 ? tg[metric] : 0;
    const max = Math.max(1, t, Math.max.apply(null, vals.map(function (v) { return Math.max(v.p, v.l); }))) * 1.08;
    const ch = H - padB - padT, colW = (W - padL * 2) / 7;
    let out = '<svg class="mp-chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="' + esc("Planned and eaten " + metric + " for each day of the week") + '">';
    out += '<line x1="' + padL + '" y1="' + (H - padB) + '" x2="' + (W - padL) + '" y2="' + (H - padB) + '" class="mp-ax"/>';
    if (t) { const y = H - padB - t / max * ch; out += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padL) + '" y2="' + y.toFixed(1) + '" class="mp-tgt"/>'; }
    vals.forEach(function (v, i) {
      const cx = padL + colW * i + colW / 2, ph = v.p / max * ch, lh = v.l / max * ch;
      out += '<g><title>' + esc(k.prettyDay(v.d) + ": planned " + k.num(Math.round(v.p)) + ", eaten " + k.num(Math.round(v.l))) + '</title>' +
        '<rect x="' + (cx - bw - gap / 2).toFixed(1) + '" y="' + (H - padB - ph).toFixed(1) + '" width="' + bw + '" height="' + Math.max(0, ph).toFixed(1) + '" rx="4" class="mp-b-plan"/>' +
        '<rect x="' + (cx + gap / 2).toFixed(1) + '" y="' + (H - padB - lh).toFixed(1) + '" width="' + bw + '" height="' + Math.max(0, lh).toFixed(1) + '" rx="4" class="mp-b-log"/>' +
        '<text x="' + cx.toFixed(1) + '" y="' + (H - 7) + '" text-anchor="middle" class="mp-ax-t">' + esc(dayShort(v.d)) + '</text></g>';
    });
    return out + '</svg>';
  }

  function overviewCard(plan, recipes, training) {
    const ds = dates(), sel = selected(), tg = k.targets();
    const days = ds.map(function (d) { return { date: d, plan: L.dayPlan(plan, recipes, d) }; });
    const cur = days.filter(function (d) { return d.date === sel; })[0], items = cur.plan.items;
    const doneItems = items.filter(function (i) { return i.eaten; }), upcoming = items.filter(function (i) { return !i.eaten; });
    const logged = sel <= k.today() ? k.logged(sel) : null;
    let h = '<details class="card mp-card" data-open-key="overview" ' + (k.isOpen("overview", true) ? "open" : "") + '><summary class="mp-card-sum"><span class="mp-card-title">Nutrition overview</span><span class="mp-dim">planned and eaten</span></summary><div class="mp-card-body">';
    h += '<div class="mp-pills" role="group" aria-label="Choose a day">' + ds.map(function (d) { return '<button type="button" class="mp-pill' + (d === sel ? ' is-on' : '') + '" aria-pressed="' + (d === sel) + '" data-mp="plan:sel" data-date="' + d + '">' + esc(dayShort(d)) + ' ' + dayNum(d) + '</button>'; }).join("") + '</div>';
    h += '<p class="mp-dim mp-ov-day">' + esc(k.prettyDay(sel, { weekday: "long", month: "long", day: "numeric" })) + ' · <strong>' + cur.plan.eaten + ' of ' + items.length + '</strong> ' + k.plural(items.length, "food") + ' eaten</p>';
    METRICS.forEach(function (m) { h += barRow(m[1], m[2], Math.round(cur.plan.totals[m[0]]), Math.round(cur.plan.eatenTotals[m[0]] || 0), tg ? tg[m[0]] : 0); });
    h += '<p class="mp-ov-meals"><strong>Eaten:</strong> ' + (doneItems.length ? doneItems.map(function (i) { return esc(foodName(i.entry, recipes)); }).join(", ") : 'nothing checked off yet') + '. <strong>Still to come:</strong> ' + (upcoming.length ? upcoming.map(function (i) { return esc(foodName(i.entry, recipes)); }).join(", ") : 'none') + '.</p>';
    const notes = ['Only foods you check off count as eaten. Checking one adds it to your Today food log and History.'];
    if (logged && logged.calories > (cur.plan.eatenTotals.calories || 0) + 5) notes.push('Your Today food log shows ' + k.num(logged.calories) + ' kcal for this day. It also includes foods you added there yourself.');
    if (tg && tg.calories > 0 && items.length && !cur.plan.withoutNumbers && cur.plan.totals.calories < tg.calories * 0.75) notes.push('The plan for this day is well under your calorie target. If you are training or hungry, add a snack or a bigger portion.');
    if (training[sel]) notes.push('Training day (' + esc(training[sel]) + '): protein and carbs in the meal after training help recovery.');
    if (cur.plan.anyEstimated) notes.push('Some numbers are estimates from a typical-values list, not a label. Treat them as approximate.');
    if (cur.plan.withoutNumbers) notes.push(cur.plan.withoutNumbers + ' ' + k.plural(cur.plan.withoutNumbers, 'food has', 'foods have') + ' no nutrition numbers, so ' + k.plural(cur.plan.withoutNumbers, 'it is', 'they are') + ' not in the totals.');
    h += '<ul class="mp-notes">' + notes.map(function (n) { return '<li>' + n + '</li>'; }).join("") + '</ul>';
    h += '<h3 class="mp-h3">This week</h3><div class="mp-pills" role="group" aria-label="What to chart">' + METRICS.map(function (m) { return '<button type="button" class="mp-pill' + (st.metric === m[0] ? ' is-on' : '') + '" aria-pressed="' + (st.metric === m[0]) + '" data-mp="plan:metric" data-metric="' + m[0] + '">' + m[1] + '</button>'; }).join("") + '</div>';
    h += chartSvg(days, st.metric, tg);
    h += '<p class="mp-legend"><span class="mp-key mp-key-plan"></span> Planned <span class="mp-key mp-key-log"></span> Eaten' + (tg && tg[st.metric] > 0 ? ' <span class="mp-key mp-key-tgt"></span> Your target' : '') + '</p>';
    h += '<details class="mp-tbl" data-open-key="chart-table"' + k.openAttr("chart-table", false) + '><summary>Show as a table</summary><table><thead><tr><th scope="col">Day</th><th scope="col">Planned</th><th scope="col">Eaten</th></tr></thead><tbody>' +
      days.map(function (d) { return '<tr><th scope="row">' + esc(k.prettyDay(d.date)) + '</th><td>' + k.num(Math.round(d.plan.totals[st.metric])) + '</td><td>' + k.num(Math.round(d.plan.eatenTotals[st.metric] || 0)) + '</td></tr>'; }).join("") + '</tbody></table></details>';
    h += '<p class="mp-foot">Planned numbers come from your foods and recipes (per serving × portion). Eaten numbers are the foods you checked off. Estimates are marked "est.".</p>';
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
      '<div class="mp-toolbar">' + (weekStart() !== L.mondayOf(today) ? '<button type="button" class="btn btn-secondary" data-mp="plan:today">This week</button>' : '') + '<button type="button" class="btn btn-primary" data-mp="plan:add" data-date="' + (selected()) + '">+ Add food</button><button type="button" class="btn btn-secondary" data-mp="plan:copyweek">Copy last week</button></div>';
    h += '<div class="mp-days">' + ds.map(function (d) { return dayHtml(d, p, recs, batches, training, today); }).join("") + '</div>';
    h += overviewCard(p, recs, training) + ideasCard(p, recs, training);
    h += '<p class="mp-foot">Check a food off when you eat it. Foods that repeat every week carry into the next one by themselves. Drag a food onto another day, or use Details › Move.</p>';
    return h;
  }

  /* ---------------- checking a food off ---------------- */

  // Checking a food off: one line in Today's food log (so in History), a prepared portion used if there is one, the ingredients out of the pantry
  // estimate if not. Done once: if the food already has its log line, no second one is made. -> true if it is now checked.
  function setEaten(id, date, on) {
    const plan = k.plan(), e = plan.filter(function (x) { return x.id === id; })[0];
    if (!e) return false;
    const was = (e.completedDates || []).indexOf(date) !== -1;
    if (!!on === was) return true;
    return on ? eat(plan, e, date) : uneat(plan, e, date);
  }
  function eat(plan, e, date) {
    if (date > k.today()) { k.toast("That day hasn't happened yet. You can check it off on the day."); return false; }
    const recs = k.recipes(), rec = L.recipeOf(e, recs), n = L.entryNutrition(e, recs, date), N = k.N(), t = k.now();
    let itemId = "", madeLine = false;
    const existing = e.loggedItems && e.loggedItems[date];
    if (existing && N && N.log && N.log.has && N.log.has(date, e.meal, existing)) itemId = existing;           // already in the log: not added again
    else if (N && N.log) {
      const nu = n.nutrition || { calories: 0, protein: 0, carbs: 0, fat: 0 };
      const r = N.log.add({ date: date, meal: e.meal, name: foodName(e, recs) + (rec ? " (" + servingsText(e.servings) + ")" : (Number(e.servings) !== 1 ? " (" + servingsText(e.servings) + ")" : "")), serving: e.serving || servingsText(e.servings), calories: nu.calories, protein: nu.protein, carbs: nu.carbs, fat: nu.fat });
      if (!r.ok) { k.toast(r.error); return false; }
      itemId = r.id; madeLine = true;
    }
    const batchesBefore = k.batches.raw();
    let used = [];
    if (rec && !(e.fromBatch && e.fromBatch[date])) {
      const u = L.useFromBatches(batchesBefore, rec.id, e.servings, date, t);
      used = u.used;
      if (used.length && !k.commitBatches(u.batches)) { if (madeLine) N.log.remove(date, e.meal, itemId); return false; }
    }
    const next = L.markEaten(plan, e.id, date, { nutrition: n.nutrition, name: foodName(e, recs), source: n.source, itemId: itemId, batches: used.length ? used : (e.fromBatch && e.fromBatch[date]) || [] }, t);
    const r2 = k.commitPlan(next);
    if (!r2.ok) { if (used.length) k.commitBatches(batchesBefore); if (madeLine) N.log.remove(date, e.meal, itemId); return false; }
    if (rec && !used.length && k.G() && !(e.fromBatch && e.fromBatch[date])) k.G().consume(rec.ingredients, (Number(e.servings) || 1) / L.servingsOf(rec));
    if (k.habitTick && e.meal === "breakfast") k.habitTick("breakfast", date);
    return true;
  }
  // Takes back what checking it did: the log line, the prepared portions, the pantry estimate.
  function undoEatEffects(e, date) {
    const N = k.N(), itemId = e.loggedItems && e.loggedItems[date], used = e.fromBatch && e.fromBatch[date] || [], rec = L.recipeOf(e, k.recipes());
    if (itemId && N) N.log.remove(date, e.meal, itemId);
    if (used.length) {
      let list = k.batches.raw();
      used.forEach(function (u) { list = L.restorePortions(list, u.batchId, u.n, date, k.now()); });
      k.commitBatches(list);
    }
    if (rec && !used.length && k.G()) k.G().consume(rec.ingredients, -(Number(e.servings) || 1) / L.servingsOf(rec));
  }
  function uneat(plan, e, date) {
    const r = k.commitPlan(L.unmarkEaten(plan, e.id, date, k.now()));
    if (!r.ok) return false;
    undoEatEffects(e, date);
    return true;
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

  /* ---------------- the food picker (Add and Replace) ---------------- */

  // Saved meals that are whole enough to use (a damaged record is skipped, never a crash): a name and at least one food with a name.
  function savedMeals() {
    return k.meals.all().map(function (m) {
      if (!m || typeof m.name !== "string" || !m.name.trim() || !Array.isArray(m.foods)) return null;
      const foods = m.foods.filter(function (f) { return f && typeof f === "object" && typeof f.recipeName === "string" && f.recipeName.trim(); });
      return foods.length ? Object.assign({}, m, { foods: foods }) : null;
    }).filter(Boolean);
  }
  function savedFoods() { const n = k.N(); return n && n.savedFoods ? n.savedFoods.all() : []; }
  function perLine(c) { return c.calories ? Math.round(c.calories) + " kcal" + (c.protein ? " · " + Math.round(c.protein) + " g protein" : "") : ""; }
  function pickerHtml(o) {
    const A = k.A(), recs = k.recipes().sort(function (a, b) { return a.name.localeCompare(b.name); }), foods = savedFoods().sort(function (a, b) { return a.name.localeCompare(b.name); });
    const meals = o.meals ? savedMeals().sort(function (a, b) { return a.name.localeCompare(b.name); }) : [];
    const rows = [];
    meals.forEach(function (m) { rows.push({ v: "meal:" + m.id, t: m.name, s: "Saved meal · " + m.foods.length + " " + k.plural(m.foods.length, "food") }); });
    foods.forEach(function (f) { rows.push({ v: "food:" + f.id, t: f.name, s: "Saved food" + (f.serving ? " · " + f.serving : "") + (perLine(f) ? " · " + perLine(f) : "") }); });
    recs.forEach(function (r) { const p = L.hasNutrition(r) ? L.roundMacros(L.recipePer(r)) : null; rows.push({ v: "recipe:" + r.id, t: r.name, s: "Recipe" + (p ? " · " + p.calories + " kcal · " + Math.round(p.protein) + " g protein" : "") }); });
    const only = o.only ? rows.filter(function (r) { return r.v.indexOf(o.only + ":") === 0; }) : rows;
    let h = '<input type="hidden" name="mode" value="search"><div class="mp-seg" role="group" aria-label="Choose a food"><button type="button" class="mp-seg-b is-on" data-sheet-act="tab-search" aria-pressed="true">Search my foods</button><button type="button" class="mp-seg-b" data-sheet-act="tab-new" aria-pressed="false">New food</button></div>';
    h += '<div data-pane="search"><div class="form-row"><label class="mp-sr" for="mpPickQ">Search</label><input type="search" id="mpPickQ" class="mp-pick-q" placeholder="' + esc(o.only === "meal" ? "Search saved meals" : "Search saved foods, recipes and meals") + '" autocomplete="off"></div>' +
      '<div class="mp-picklist" role="radiogroup" aria-label="Foods">' + (only.length ? only.map(function (r) {
        return '<label class="mp-pick" data-text="' + esc((r.t + " " + r.s).toLowerCase()) + '"><input type="radio" name="pick" value="' + esc(r.v) + '"' + (o.pick === r.v ? " checked" : "") + '><span class="mp-pick-t">' + esc(r.t) + '</span><span class="mp-pick-s">' + esc(r.s) + '</span></label>';
      }).join("") : '<p class="mp-dim mp-pick-none">' + (o.only === "meal" ? 'No saved meals yet. Use “Save this meal” on a meal that has foods.' : 'Nothing saved yet. Use “New food”, or save a recipe.') + '</p>') + '<p class="mp-dim mp-pick-nomatch hidden">Nothing matches. Try “New food”.</p></div>';
    h += '<p class="sp-err hidden" data-err="pick" role="alert"></p></div>';
    h += '<div data-pane="new" class="hidden">' + A.fText("nname", "Food name", "", { max: 80, placeholder: "e.g. Greek yogurt" }) +
      '<div class="form-row two-col"><div>' + A.fText("nserving", "Serving (optional)", "", { max: 40, placeholder: "e.g. 1 cup" }) + '</div><div>' + A.row("ncal", "Calories (optional)", '<input type="number" id="spf_ncal" name="ncal" min="0" step="any" inputmode="decimal">', {}) + '</div></div>' +
      '<div class="form-row two-col"><div>' + A.row("npro", "Protein g", '<input type="number" id="spf_npro" name="npro" min="0" step="any" inputmode="decimal">', {}) + '</div><div>' + A.row("ncarb", "Carbs g", '<input type="number" id="spf_ncarb" name="ncarb" min="0" step="any" inputmode="decimal">', {}) + '</div></div>' +
      A.row("nfat", "Fat g", '<input type="number" id="spf_nfat" name="nfat" min="0" step="any" inputmode="decimal">', {}) +
      '<label class="cal-check"><input type="checkbox" name="nsave" checked> Save it to my foods so I can pick it again</label><p class="field-hint">Numbers are per serving and are yours, so they are not marked as estimates. Leave them empty if you don’t know them: nothing is guessed.</p></div>';
    return h;
  }
  // The picker's behaviour inside the open sheet: the two tabs and the search box.
  function pickerWire() {
    return {
      act: function (act, root) {
        if (act !== "tab-search" && act !== "tab-new") return false;
        const nw = act === "tab-new";
        root.querySelector('[name="mode"]').value = nw ? "new" : "search";
        root.querySelector('[data-pane="search"]').classList.toggle("hidden", nw);
        root.querySelector('[data-pane="new"]').classList.toggle("hidden", !nw);
        Array.prototype.forEach.call(root.querySelectorAll(".mp-seg-b"), function (b) { const on = b.getAttribute("data-sheet-act") === act; b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", String(on)); });
        const f = root.querySelector(nw ? '[name="nname"]' : ".mp-pick-q"); if (f) f.focus();
        return true;
      },
      input: function (el, root) {
        if (!el.classList.contains("mp-pick-q")) return;
        const q = el.value.trim().toLowerCase();
        let shown = 0;
        Array.prototype.forEach.call(root.querySelectorAll(".mp-pick"), function (l) { const m = !q || l.getAttribute("data-text").indexOf(q) !== -1; l.classList.toggle("hidden", !m); if (m) shown++; });
        const none = root.querySelector(".mp-pick-nomatch"); if (none) none.classList.toggle("hidden", shown > 0 || !root.querySelector(".mp-pick"));
      }
    };
  }
  // The choice in the picker -> { fields } (a recipe or a food, ready for the plan), { meal } (a saved meal), or { errors }
  function readPick(v, servings) {
    const sv = Number(servings) || 1;
    if (v.mode === "new") {
      const name = String(v.nname || "").replace(/\s+/g, " ").trim();
      if (!name) return { errors: { nname: "Name the food." } };
      let foodId = "";
      const f = { name: name, serving: v.nserving, calories: v.ncal, protein: v.npro, carbs: v.ncarb, fat: v.nfat };
      if (v.nsave && k.N() && k.N().savedFoods) { const r = k.N().savedFoods.save(f); if (r.ok) foodId = r.food.id; else { k.toast(r.error); return { errors: { nname: r.error } }; } }
      return { fields: L.plainFood(Object.assign({}, f, { servings: sv, foodId: foodId })), saved: !!foodId };
    }
    const pick = String(v.pick || ""), kind = pick.split(":")[0], id = pick.slice(kind.length + 1);
    if (!pick) return { errors: { pick: "Choose a food, or make a new one." } };
    if (kind === "recipe") { const r = k.recipeById(id); return r ? { fields: L.recipeFood(r, sv) } : { errors: { pick: "That recipe isn't there any more." } }; }
    if (kind === "food") { const f = savedFoods().filter(function (x) { return x.id === id; })[0]; return f ? { fields: L.plainFood({ name: f.name, serving: f.serving, calories: f.calories, protein: f.protein, carbs: f.carbs, fat: f.fat, servings: sv, foodId: f.id }) } : { errors: { pick: "That food isn't there any more." } }; }
    if (kind === "meal") { const m = savedMeals().filter(function (x) { return x.id === id; })[0]; return m ? { meal: m } : { errors: { pick: "That meal isn't there any more." } }; }
    return { errors: { pick: "Choose a food." } };
  }

  /* ---------------- add a food ---------------- */

  function repeatBox(date, mode, checked) {
    if (mode === "week") {
      return '<div class="cal-chips">' + L.weekDates(L.mondayOf(date)).map(function (d, i) {
        return '<label class="cal-chip-btn hb-daychip"><input type="checkbox" data-multi name="rdates" value="' + d + '"' + (d === date ? " checked disabled" : (checked.indexOf(d) !== -1 ? " checked" : "")) + '> ' + DAY_LABELS[i] + ' ' + dayNum(d) + '</label>';
      }).join("") + '</div>';
    }
    if (mode === "weekly") {
      const dflt = checked.length ? checked : [String(L.weekday(date))];
      return '<div class="cal-chips">' + WEEKDAYS.map(function (w) { return '<label class="cal-chip-btn hb-daychip"><input type="checkbox" data-multi name="rdays" value="' + w[0] + '"' + (dflt.indexOf(w[0]) !== -1 ? " checked" : "") + '> ' + w[1] + '</label>'; }).join("") + '</div>';
    }
    return "";
  }
  const REPEAT_HINT = { none: "", week: "Each day gets its own copy for this week only.", weekly: "It repeats every week on these days, starting on the day above, and carries into next week by itself.", daily: "It repeats every day, every week, starting on the day above." };
  function repeatField(date) {
    const A = k.A();
    return A.fSelect("repeat", "Repeat", [["none", "Just this day"], ["week", "Selected days of this week only"], ["weekly", "Selected days every week"], ["daily", "Every day, every week"]], "none") +
      '<div class="form-row hidden" data-repeat-box><fieldset class="cdp-days"><legend id="mpRepLegend">On these days</legend><div data-repeat-chips></div><p class="field-hint" data-repeat-hint></p></fieldset></div>';
  }
  function repeatWire(root, getDate) {
    const sel = root.querySelector('[name="repeat"]'), box = root.querySelector("[data-repeat-box]"), chips = root.querySelector("[data-repeat-chips]");
    let last = "";
    return function sync() {
      const mode = sel.value, date = getDate();
      const on = last === mode ? Array.prototype.map.call(chips.querySelectorAll("input:checked"), function (c) { return c.value; }) : [];
      box.classList.toggle("hidden", mode === "none");
      chips.innerHTML = (mode === "week" || mode === "weekly") && L.isDate(date) ? repeatBox(date, mode, on) : "";
      root.querySelector("[data-repeat-hint]").textContent = REPEAT_HINT[mode] || "";
      last = mode;
    };
  }
  // The entries one food makes for a date and a repeat choice. opts.skipBase: the food is already on that date (repeating a meal).
  function makeEntries(fields, meal, date, rep, t, opts) {
    const o = opts || {};
    const base = Object.assign({ id: k.uid("plan"), type: "single", date: date, days: null, meal: meal, isRestaurant: false, includeInGroceries: false, completedDates: [], createdAt: t, updatedAt: t }, JSON.parse(JSON.stringify(fields)), { meal: meal });
    if (base.macros === null) delete base.macros; if (!base.foodId) delete base.foodId; if (!base.serving) delete base.serving;
    const mode = rep && rep.mode || "none";
    if (mode === "weekly" || mode === "daily") {
      const days = mode === "daily" ? [0, 1, 2, 3, 4, 5, 6] : (rep.days || []).map(Number);
      if (!days.length) return [];
      return [L.makeRecurring(Object.assign({}, base, { type: "single" }), days, o.skipBase ? L.addDays(date, 1) : date, k.uid("plan"), "", t)];
    }
    if (mode === "week") {
      const more = (rep.dates || []).filter(function (d) { return d !== date; });
      const group = more.length ? k.uid("grp") : "";
      if (group) base.group = group;
      const copies = L.repeatEntries(base, more, function () { return k.uid("plan"); }, group, t);
      return (o.skipBase ? [] : [base]).concat(copies);
    }
    return o.skipBase ? [] : [base];
  }

  // o: { date, meal, recipeId, only }
  function openAddFood(o) {
    const A = k.A();
    if (!A) { k.toast("Foods can't be added here right now."); return; }
    const op = o || {}, date = op.date || k.today();
    const recipe = op.recipeId ? k.recipeById(op.recipeId) : null;
    const meal = op.meal || (recipe && recipe.cats && recipe.cats[0]) || "breakfast";
    const wire = pickerWire();
    let body = pickerHtml({ meals: true, pick: recipe ? "recipe:" + recipe.id : "", only: op.only });
    body += A.fSelect("meal", "Meal", L.MEALS.map(function (m) { return [m, L.MEAL_LABELS[m]]; }), meal);
    body += A.fText("date", "Day", date, { type: "date" });
    body += A.row("servings", "How much (servings)", '<input type="number" id="spf_servings" name="servings" min="0.25" max="50" step="0.25" value="1" inputmode="decimal">', {});
    body += repeatField(date);
    let sync = function () {};
    A.openSheet({
      title: op.only === "meal" ? "Add a saved meal" : "Add a food", body: body, submit: "Add to plan", focus: ".mp-pick-q",
      onOpen: function (root) { sync = repeatWire(root, function () { return root.querySelector('[name="date"]').value; }); sync(); },
      onAct: function (act, el, root) { wire.act(act, root); },
      onInput: function (el, root) { wire.input(el, root); },
      onChange: function (el, root) {
        if (el.name === "repeat" || el.name === "date") sync();
        if (el.name === "pick") { const r = el.value.indexOf("recipe:") === 0 ? k.recipeById(el.value.slice(7)) : null; if (r && r.cats && r.cats.length && r.cats.indexOf(root.querySelector('[name="meal"]').value) === -1) root.querySelector('[name="meal"]').value = r.cats[0]; }
      },
      onSubmit: function (v) { return saveNew(v); }
    });
  }
  function saveNew(v) {
    const errors = {}, servings = Math.round((Number(v.servings) || 0) * 100) / 100;
    if (!L.isDate(v.date)) errors.date = "Choose a day.";
    if (!(servings > 0)) errors.servings = "Enter an amount above 0.";
    const pick = readPick(v, servings);
    if (pick.errors) Object.assign(errors, pick.errors);
    const mode = v.repeat || "none", days = (v.rdays || []).map(String);
    if (mode === "weekly" && !days.length) errors.repeat = "Choose at least one day.";
    if (Object.keys(errors).length) return { ok: false, errors: errors };
    const t = k.now(), before = k.plan(), rep = { mode: mode, days: days, dates: v.rdates || [] };
    let made = [];
    if (pick.meal) pick.meal.foods.forEach(function (f) { made = made.concat(makeEntries(Object.assign({}, f, { servings: servings === 1 ? f.servings : (Number(f.servings) || 1) * servings }), v.meal, v.date, rep, t)); });
    else made = makeEntries(pick.fields, v.meal, v.date, rep, t);
    if (!made.length) return { ok: false, errors: { repeat: "Nothing to add." } };
    if (!k.commitPlan(before.concat(made)).ok) return { ok: false, message: "That couldn't be saved." };
    st.start = L.mondayOf(v.date); st.sel = v.date;
    k.ui.open["day:" + v.date] = true;
    k.render({ keepScroll: true });
    const what = pick.meal ? "“" + pick.meal.name + "”" : "“" + (pick.fields.recipeName) + "”";
    k.undo("Added " + what + (mode === "daily" ? " every day." : mode === "weekly" ? " on " + days.length + " " + k.plural(days.length, "day") + " every week." : mode === "week" && rep.dates.filter(function (d) { return d !== v.date; }).length ? " to " + (1 + rep.dates.filter(function (d) { return d !== v.date; }).length) + " days." : " to " + day(v.date) + "."), function () { if (k.commitPlan(before).ok) k.render({ keepScroll: true }); });
    return { ok: true };
  }

  /* ---------------- replace and edit ---------------- */

  function scopeField(e, date) {
    const A = k.A();
    return e.type === "recurring" ? A.fSelect("scope", "Change", [["day", "Just " + day(date)], ["series", "This day and every week after"]], "day", { hint: "Earlier days keep what they had, and what you ate on them." }) : "";
  }
  // Applies a change to a food on a date. If it was checked off, its log line is taken back first and the changed food is checked again,
  // so Today's log shows what you actually ate. -> the id of the entry that holds the food on that date, or "" if it could not be saved.
  function applyChange(id, date, scope, fields, ateIt) {
    const before = k.plan(), e = before.filter(function (x) { return x.id === id; })[0];
    if (!e) return "";
    const wasEaten = (e.completedDates || []).indexOf(date) !== -1;
    let basePlan = before;
    if (wasEaten) basePlan = L.unmarkEaten(before, id, date, k.now());
    const r = L.changeFood(basePlan, id, date, scope, fields, k.uid("plan"), k.now());
    if (r.error) { k.toast(r.error); return ""; }
    if (!k.commitPlan(r.plan).ok) return "";
    if (wasEaten) undoEatEffects(e, date);
    if (wasEaten || ateIt) {
      const changed = k.plan().filter(function (x) { return x.id === r.id; })[0];
      if (changed && date <= k.today()) setEaten(r.id, date, true);
    }
    return r.id;
  }

  // Takes a replace or an edit back: the plan as it was, and Today's log as it was (what the new food logged is taken out; if the first food
  // had been checked off, it is checked off again, so the log line is made once, not twice).
  function undoChange(before, id, nid, date) {
    const cur = k.plan().filter(function (x) { return x.id === nid; })[0], orig = before.filter(function (x) { return x.id === id; })[0];
    const origEaten = !!orig && L.eatenOn(orig, date);
    if (!k.commitPlan(origEaten ? L.unmarkEaten(before, id, date, k.now()) : before).ok) return;
    if (cur && L.eatenOn(cur, date)) undoEatEffects(cur, date);
    if (origEaten) setEaten(id, date, true);
    k.render({ keepScroll: true });
  }

  function openReplace(id, date) {
    const A = k.A(), e = entryOf(id);
    if (!A || !e) { k.toast("That food isn't there any more."); return; }
    const recs = k.recipes(), n = L.entryNutrition(e, recs, date), wire = pickerWire(), canEat = date <= k.today();
    let body = '<p class="mp-instead">Instead of <strong>' + esc(foodName(e, recs)) + '</strong>' + (n.nutrition ? ' <span class="mp-dim">(' + esc(numsLine(n.nutrition)) + ')</span>' : '') + ' on ' + esc(day(date)) + '</p>';
    body += pickerHtml({});
    body += A.row("servings", "How much (servings)", '<input type="number" id="spf_servings" name="servings" min="0.25" max="50" step="0.25" value="' + esc(e.servings || 1) + '" inputmode="decimal">', {});
    body += scopeField(e, date);
    if (canEat) body += '<label class="cal-check"><input type="checkbox" name="ate" checked> I ate this (check it off)</label>';
    A.openSheet({
      title: "Replace food", body: body, submit: "Replace", focus: ".mp-pick-q",
      onAct: function (act, el, root) { wire.act(act, root); },
      onInput: function (el, root) { wire.input(el, root); },
      onSubmit: function (v) {
        const servings = Math.round((Number(v.servings) || 0) * 100) / 100;
        if (!(servings > 0)) return { ok: false, errors: { servings: "Enter an amount above 0." } };
        const pick = readPick(v, servings);
        if (pick.errors) return { ok: false, errors: pick.errors };
        if (pick.meal) return { ok: false, errors: { pick: "Choose a single food or recipe to replace it." } };
        const scope = v.scope === "series" ? "series" : "day", before = k.plan();
        const nid = applyChange(id, date, scope, pick.fields, !!v.ate && canEat);
        if (!nid) return { ok: false, message: "That couldn't be saved." };
        k.render({ keepScroll: true });
        k.undo("Replaced with “" + pick.fields.recipeName + "”" + (scope === "series" ? " from " + day(date) + " on." : "."), function () { undoChange(before, id, nid, date); });
        return { ok: true };
      }
    });
  }

  function openEditFood(id, date) {
    const A = k.A(), e = entryOf(id);
    if (!A || !e) { k.toast("That food isn't there any more."); return; }
    const recs = k.recipes(), rec = L.recipeOf(e, recs), plain = !rec;
    const m = e.macros || {};
    let body = plain ? A.fText("name", "Food name", e.recipeName, { required: true, max: 80 }) : '<p class="mp-instead"><strong>' + esc(rec.name) + '</strong> <span class="mp-dim">(a recipe. Use Replace to change what it is.)</span></p>';
    body += A.fSelect("meal", "Meal", L.MEALS.map(function (x) { return [x, L.MEAL_LABELS[x]]; }), e.meal);
    body += A.row("servings", "How much (servings)", '<input type="number" id="spf_servings" name="servings" min="0.25" max="50" step="0.25" value="' + esc(e.servings || 1) + '" inputmode="decimal">', {});
    if (plain) {
      body += A.fText("serving", "Serving (optional)", e.serving || "", { max: 40, placeholder: "e.g. 1 cup" });
      body += '<div class="form-row two-col"><div>' + A.row("cal", "Calories", '<input type="number" id="spf_cal" name="cal" min="0" step="any" inputmode="decimal" value="' + esc(m.calories || "") + '">', {}) + '</div><div>' + A.row("pro", "Protein g", '<input type="number" id="spf_pro" name="pro" min="0" step="any" inputmode="decimal" value="' + esc(m.protein || "") + '">', {}) + '</div></div>' +
        '<div class="form-row two-col"><div>' + A.row("carb", "Carbs g", '<input type="number" id="spf_carb" name="carb" min="0" step="any" inputmode="decimal" value="' + esc(m.carbs || "") + '">', {}) + '</div><div>' + A.row("fat", "Fat g", '<input type="number" id="spf_fat" name="fat" min="0" step="any" inputmode="decimal" value="' + esc(m.fat || "") + '">', {}) + '</div></div><p class="field-hint">Numbers are per serving and are yours.</p>';
    }
    body += '<label class="cal-check mp-eatout"><input type="checkbox" name="out"' + (e.isRestaurant ? " checked" : "") + '> Eating out or takeout (nothing to buy or prepare)</label>';
    body += scopeField(e, date);
    A.openSheet({
      title: "Edit food", body: body, submit: "Save", focus: plain ? '[name="name"]' : '[name="servings"]',
      onSubmit: function (v) {
        const servings = Math.round((Number(v.servings) || 0) * 100) / 100, errors = {};
        if (!(servings > 0)) errors.servings = "Enter an amount above 0.";
        const name = String(v.name || "").replace(/\s+/g, " ").trim();
        if (plain && !name) errors.name = "Name the food.";
        if (Object.keys(errors).length) return { ok: false, errors: errors };
        const fields = { meal: v.meal, servings: servings, isRestaurant: !!v.out };
        if (plain) Object.assign(fields, L.plainFood({ name: name, serving: v.serving, calories: v.cal, protein: v.pro, carbs: v.carb, fat: v.fat, servings: servings, foodId: e.foodId }));
        const before = k.plan(), scope = v.scope === "series" ? "series" : "day";
        const nid = applyChange(id, date, scope, fields, false);
        if (!nid) return { ok: false, message: "That couldn't be saved." };
        k.render({ keepScroll: true });
        k.undo("Saved “" + (plain ? name : rec.name) + "”" + (scope === "series" ? " from " + day(date) + " on." : "."), function () { undoChange(before, id, nid, date); });
        return { ok: true };
      }
    });
  }

  /* ---------------- removing and moving ---------------- */

  function askScope(e, date, title, cb) {
    if (e.type !== "recurring") { cb("day"); return; }
    window.JarvisMenu.open({ title: title, opener: document.activeElement, rows: [{ key: "day", label: "Just " + day(date) }, { key: "series", label: "This day and every week after", sub: "Earlier days keep what they had" }], onPick: cb });
  }
  function remove(id, date) {
    const before = k.plan(), e = entryOf(id);
    if (!e) return;
    const name = foodName(e);
    const finish = function (next, label) {
      if (!k.commitPlan(next).ok) return;
      k.render({ keepScroll: true });
      k.undo(label, function () { if (k.commitPlan(before).ok) k.render({ keepScroll: true }); });
    };
    if (e.type === "recurring") { askScope(e, date, "Remove “" + name + "”", function (scope) { finish(L.removeFood(before, id, date, scope, k.now()), scope === "series" ? "Removed “" + name + "” from " + day(date) + " on." : "Removed “" + name + "” from " + day(date) + " only."); }); return; }
    if (e.group && before.filter(function (x) { return x.group === e.group; }).length > 1) {
      window.JarvisMenu.open({ title: "Remove “" + name + "”", opener: document.activeElement, rows: [{ key: "one", label: "Just this day" }, { key: "all", label: "All the days I repeated it on", sub: "Removes every copy made together" }],
        onPick: function (key) { finish(L.removeEntry(before, id, key === "all"), key === "all" ? "Removed all repeats of “" + name + "”." : "Removed “" + name + "”."); } });
      return;
    }
    finish(L.removeEntry(before, id, false), "Removed “" + name + "”." + (e.completedDates && e.completedDates.length ? " What you ate stays in your food log." : ""));
  }
  function moveTo(id, from, to) {
    const before = k.plan(), e = entryOf(id);
    if (!e) return false;
    const r = L.moveOccurrence(before, id, from, to, k.uid("plan"), k.now());
    if (r.error) { k.toast(r.error); return false; }
    if (r.same) return false;
    if (!k.commitPlan(r.plan).ok) return false;
    k.render({ keepScroll: true });
    k.undo("Moved “" + foodName(e) + "” to " + day(to) + (e.type === "recurring" ? " (just that day)." : "."), function () { if (k.commitPlan(before).ok) k.render({ keepScroll: true }); });
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

  /* ---------------- a whole meal: save, repeat, check off, clear ---------------- */

  function slotItems(date, meal) { return L.occurrences(k.plan(), date, date).filter(function (o) { return o.meal === meal; }); }
  function openMealMenu(date, meal, opener) {
    const items = slotItems(date, meal), eatable = date <= k.today(), allDone = items.length && items.every(function (o) { return L.eatenOn(o.entry, o.date); });
    const rows = [{ key: "saved", label: "Add a saved meal", sub: savedMeals().length ? savedMeals().length + " saved" : "None saved yet" }];
    if (savedMeals().length) rows.push({ key: "manage", label: "Manage saved meals", sub: "Delete ones you no longer use" });
    if (items.length) {
      rows.push({ key: "save", label: "Save this meal", sub: "Reuse " + items.length + " " + k.plural(items.length, "food") + " any day" });
      rows.push({ key: "repeat", label: "Repeat this meal", sub: "On other days, or every week" });
      if (eatable) rows.push({ key: "toggle", label: allDone ? "Uncheck every food" : "Check off every food" });
      rows.push({ key: "clear", label: "Remove all foods in this meal" });
    }
    window.JarvisMenu.open({
      title: L.MEAL_LABELS[meal] + " · " + day(date), opener: opener, rows: rows,
      onPick: function (key) {
        if (key === "saved") openAddFood({ date: date, meal: meal, only: "meal" });
        else if (key === "manage") openManageMeals();
        else if (key === "save") openSaveMeal(date, meal);
        else if (key === "repeat") openRepeatMeal(date, meal);
        else if (key === "toggle") { let ok = true; slotItems(date, meal).forEach(function (o) { if (ok) ok = setEaten(o.planId, o.date, !allDone); }); k.render({ keepScroll: true }); k.say(allDone ? "Unchecked." : "Checked off."); }
        else if (key === "clear") clearMeal(date, meal);
      }
    });
  }
  function clearMeal(date, meal) {
    const before = k.plan(), items = slotItems(date, meal);
    let next = before;
    items.forEach(function (o) { next = L.removeFood(next, o.planId, o.date, "day", k.now()); });
    if (!k.commitPlan(next).ok) return;
    k.render({ keepScroll: true });
    k.undo("Removed " + items.length + " " + k.plural(items.length, "food") + " from " + L.MEAL_LABELS[meal].toLowerCase() + ".", function () { if (k.commitPlan(before).ok) k.render({ keepScroll: true }); });
  }
  // The saved meals, with a way to delete one (a deleted meal is marked for 30 days so the removal reaches your other devices, and can be undone here).
  function openManageMeals() {
    const A = k.A();
    if (!A) return;
    const sorted = function () { return savedMeals().sort(function (a, b) { return a.name.localeCompare(b.name); }); };
    const row = function (m) {
      return '<div class="mp-pick mp-saved-row" data-meal-id="' + esc(m.id) + '"><span class="mp-pick-t">' + esc(m.name) + '</span><span class="mp-pick-s">' + esc(L.MEAL_LABELS[m.meal] || "Meal") + ' \u00b7 ' + m.foods.length + ' ' + k.plural(m.foods.length, "food") + ': ' + esc(m.foods.map(function (f) { return f.recipeName; }).join(", ")) + '</span>' +
        '<button type="button" class="mp-fb mp-fb-del mp-saved-del" data-sheet-act="del:' + esc(m.id) + '" aria-label="' + esc("Delete " + m.name) + '">Delete</button></div>';
    };
    const body = '<p class="field-hint">Meals you saved with \u201cSave this meal\u201d. Deleting one does not change any day you already added it to.</p><div class="mp-picklist mp-saved-list">' + (sorted().length ? sorted().map(row).join("") : '<p class="mp-dim">No saved meals.</p>') + '</div>';
    A.openSheet({
      title: "Saved meals", body: body, focus: ".mp-saved-del",
      onAct: function (act, el, root) {
        const i = act.indexOf(":"), kind = act.slice(0, i), id = act.slice(i + 1), holder = root.querySelector('[data-meal-id="' + id + '"]');
        const rec = k.meals.raw().filter(function (m) { return m.id === id; })[0];
        if (!holder || !rec) return;
        if (kind === "del") {
          if (!k.meals.markDeleted(id)) { k.toast("That couldn't be saved. The browser may be full or blocking storage."); return; }
          holder.innerHTML = '<span class="mp-pick-t">Deleted \u201c' + esc(rec.name) + '\u201d.</span><button type="button" class="mp-fb mp-saved-undo" data-sheet-act="undel:' + esc(id) + '" aria-label="' + esc("Undo delete " + rec.name) + '">Undo</button>';
          const u = holder.querySelector(".mp-saved-undo"); if (u) u.focus();
        } else if (kind === "undel") {
          const back = Object.assign({}, rec, { updatedAt: k.now() }); delete back.deletedAt;
          if (!k.commitMeals(k.meals.raw().map(function (m) { return m.id === id ? back : m; }))) return;
          const m = savedMeals().filter(function (x) { return x.id === id; })[0];
          if (m) { holder.outerHTML = row(m); const d = root.querySelector('[data-meal-id="' + id + '"] .mp-saved-del'); if (d) d.focus(); }
        }
      }
    });
  }
  function openSaveMeal(date, meal) {
    const A = k.A(), items = slotItems(date, meal);
    if (!A || !items.length) return;
    A.openSheet({
      title: "Save this meal", body: '<p class="field-hint">' + items.length + ' ' + k.plural(items.length, "food") + ' will be saved with their numbers: ' + esc(items.map(function (o) { return foodName(o.entry); }).join(", ")) + '.</p>' + A.fText("name", "Name", "My usual " + L.MEAL_LABELS[meal].toLowerCase(), { required: true, max: 60 }), submit: "Save meal", focus: '[name="name"]',
      onSubmit: function (v) {
        const name = String(v.name || "").replace(/\s+/g, " ").trim();
        if (!name) return { ok: false, errors: { name: "Give it a name." } };
        const same = savedMeals().filter(function (m) { return m.name.toLowerCase() === name.toLowerCase(); })[0];
        const rec = L.savedMealFrom(name, meal, items.map(function (o) { return o.entry; }), same ? same.id : k.uid("meal"), k.now());
        if (same) rec.createdAt = same.createdAt;
        const next = same ? k.meals.raw().map(function (m) { return m.id === same.id ? rec : m; }) : k.meals.raw().concat([rec]);
        if (!k.commitMeals(next)) return { ok: false, message: "That couldn't be saved." };
        k.toast((same ? "Updated “" : "Saved “") + name + "”. Add it from any meal's More menu.");
        return { ok: true };
      }
    });
  }
  function openRepeatMeal(date, meal) {
    const A = k.A(), items = slotItems(date, meal);
    if (!A || !items.length) return;
    const body = '<p class="field-hint">Copies ' + esc(items.map(function (o) { return foodName(o.entry); }).join(", ")) + ' to the days you choose. This day keeps its foods.</p>' +
      A.fSelect("repeat", "Repeat", [["week", "Selected days of this week only"], ["weekly", "Selected days every week"], ["daily", "Every day, every week"]], "week") +
      '<div class="form-row" data-repeat-box><fieldset class="cdp-days"><legend>On these days</legend><div data-repeat-chips></div><p class="field-hint" data-repeat-hint></p></fieldset></div>';
    let sync = function () {};
    A.openSheet({
      title: "Repeat " + L.MEAL_LABELS[meal].toLowerCase(), body: body, submit: "Repeat", focus: '[name="repeat"]',
      onOpen: function (root) { sync = repeatWire(root, function () { return date; }); sync(); },
      onChange: function (el) { if (el.name === "repeat") sync(); },
      onSubmit: function (v) {
        const mode = v.repeat, rep = { mode: mode, days: (v.rdays || []).map(String), dates: v.rdates || [] };
        if (mode === "weekly" && !rep.days.length) return { ok: false, errors: { repeat: "Choose at least one day." } };
        if (mode === "week" && !rep.dates.filter(function (d) { return d !== date; }).length) return { ok: false, errors: { repeat: "Choose at least one other day." } };
        const before = k.plan(), t = k.now();
        let made = [];
        slotItems(date, meal).forEach(function (o) { made = made.concat(makeEntries(L.foodOf(o.entry), meal, date, rep, t, { skipBase: true })); });
        if (!made.length || !k.commitPlan(before.concat(made)).ok) return { ok: false, message: "That couldn't be saved." };
        k.render({ keepScroll: true });
        k.undo("Repeated " + L.MEAL_LABELS[meal].toLowerCase() + " (" + items.length + " " + k.plural(items.length, "food") + ").", function () { if (k.commitPlan(before).ok) k.render({ keepScroll: true }); });
        return { ok: true };
      }
    });
  }
  function copyLastWeek() {
    const before = k.plan(), start = weekStart(), r = L.copyWeek(before, L.addDays(start, -7), start, function () { return k.uid("plan"); }, k.now());
    if (!r.added) { k.toast("Nothing to copy: last week has no one-off foods that this week is missing. Foods that repeat every week are already here."); return; }
    if (!k.commitPlan(r.plan).ok) return;
    k.render({ keepScroll: true });
    k.undo("Copied " + r.added + " " + k.plural(r.added, "food") + " from last week.", function () { if (k.commitPlan(before).ok) k.render({ keepScroll: true }); });
  }

  /* ---------------- dragging a food to another day ---------------- */

  let drag = null;
  function dayAt(x, y) { const el = document.elementFromPoint(x, y); return el && el.closest ? el.closest(".mp-day") : null; }
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
    const info = e.target.closest ? e.target.closest(".mp-food-info") : null;
    if (!info || (e.pointerType === "mouse" && e.button !== 0)) return;
    const m = info.closest(".mp-food");
    endDrag(true);
    drag = { id: m.getAttribute("data-id"), from: m.getAttribute("data-date"), el: m, name: (m.querySelector(".mp-food-name") || { textContent: "Food" }).textContent.trim(), sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, touch: e.pointerType === "touch" || e.pointerType === "pen", active: false, timer: null, target: null };
    if (drag.touch) drag.timer = window.setTimeout(startDrag, 380);
    document.addEventListener("pointermove", onMove, { passive: false }); document.addEventListener("pointerup", onUp); document.addEventListener("pointercancel", onCancel);
  }

  /* ---------------- taps ---------------- */

  function click(act, el) {
    const id = el.getAttribute("data-id"), date = el.getAttribute("data-date");
    if (act === "check") return;                   // handled by change
    if (act === "prev") { st.start = L.addDays(weekStart(), -7); st.sel = ""; k.render({ keepScroll: true }); return; }
    if (act === "next") { st.start = L.addDays(weekStart(), 7); st.sel = ""; k.render({ keepScroll: true }); return; }
    if (act === "today") { st.start = L.mondayOf(k.today()); st.sel = ""; k.render({ keepScroll: true }); return; }
    if (act === "sel") { st.sel = date; k.render({ keepScroll: true, focus: '[data-mp="plan:sel"][data-date="' + date + '"]' }); return; }
    if (act === "metric") { st.metric = el.getAttribute("data-metric"); k.render({ keepScroll: true, focus: '[data-mp="plan:metric"][data-metric="' + st.metric + '"]' }); return; }
    if (act === "add") { openAddFood({ date: date, meal: el.getAttribute("data-meal") || "" }); return; }
    if (act === "mealmenu") { openMealMenu(date, el.getAttribute("data-meal"), el); return; }
    if (act === "copyweek") { copyLastWeek(); return; }
    if (act === "replace") { openReplace(id, date); return; }
    if (act === "edit") { openEditFood(id, date); return; }
    if (act === "remove") { remove(id, date); return; }
    if (act === "prepped") { togglePrepped(id, date); return; }
    if (act === "move") { openMove(id, date, el); return; }
    if (act === "addrecipe") { openAddFood({ recipeId: id, date: selected() }); return; }
    if (act === "fill") {
      const ds = dates(), today = k.today(), training = L.trainingDays(k.routines(), ds);
      const s = L.fillSuggestions({ dates: ds.filter(function (d) { return d >= today; }), plan: k.plan(), recipes: k.recipes(), training: training })[Number(el.getAttribute("data-i"))];
      if (!s) return;
      const before = k.plan(), t = k.now();
      const entry = { id: k.uid("plan"), type: "single", date: s.date, days: null, meal: s.meal, recipeId: s.recipe.id, recipeName: s.recipe.name, servings: 1, isRestaurant: false, includeInGroceries: false, completedDates: [], createdAt: t, updatedAt: t };
      if (k.commitPlan(before.concat([entry])).ok) { k.render({ keepScroll: true }); k.undo("Added “" + s.recipe.name + "” to " + L.MEAL_LABELS[s.meal].toLowerCase() + " on " + day(s.date) + ".", function () { if (k.commitPlan(before).ok) k.render({ keepScroll: true }); }); }
    }
  }
  function change(act, el) {
    if (act !== "check") return;
    const id = el.getAttribute("data-id"), date = el.getAttribute("data-date"), on = el.checked;
    const ok = setEaten(id, date, on);
    k.render({ keepScroll: true, focus: '[data-mp="plan:check"][data-id="' + id + '"][data-date="' + date + '"]' });
    if (ok) k.say(on ? "Checked off. Added to today's food log." : "Unchecked. Taken out of the food log.");
  }

  k.openMealSheet = openAddFood;
  k.planApi = { moveTo: moveTo, setEaten: setEaten };
  MP.setEaten = function (id, date, on) { const ok = setEaten(id, date, on !== false); if (ok) k.refresh({ keepScroll: true }); return ok; };

  MP.register("plan", {
    render: render, click: click, change: change,
    init: function () { const r = document.getElementById("mpRoot"); r.addEventListener("pointerdown", onDown); r.addEventListener("touchmove", function (e) { if (drag && drag.active && e.cancelable) e.preventDefault(); }, { passive: false }); }
  });
})();
